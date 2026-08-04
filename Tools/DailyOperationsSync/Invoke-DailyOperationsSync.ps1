[CmdletBinding()]
param(
    [ValidateSet('Manual', 'Scheduled')]
    [string] $Trigger = 'Manual',
    [ValidateSet('', 'customer-master', 'work-orders', 'sales-orders',
        'relationships', 'validation', 'sql-import', 'promotion',
        'finalization')]
    [string] $QualificationFailStep = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine $approvedIdentity -or $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Daily Operations Synchronization requires non-elevated $approvedIdentity."
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$root = 'C:\DLE-OS\Canonical\DailyOperationsSync'
$stateRoot = Join-Path $root 'State'
$runsRoot = Join-Path $root 'Runs'
$statusPath = Join-Path $stateRoot 'status.json'
$historyPath = Join-Path $stateRoot 'runs.jsonl'
$successPath = Join-Path $stateRoot 'last-successful.json'
$lockPath = Join-Path $stateRoot 'daily-operations-sync.lock'
$customerRunner = Join-Path $repo 'Tools\OperationsRefresh\Invoke-CustomerMasterRoutineRefresh.ps1'
$salesRunner = Join-Path $repo 'Tools\OperationsRefresh\Invoke-OpenSalesOrderRoutineRefresh.ps1'
$workOrderRunner = Join-Path $repo 'Tools\DailyOperationsSync\focused_work_order_refresh.py'
$importer = Join-Path $repo 'Tools\DailyOperationsSync\Import-DailyOperationsSnapshot.ps1'
$finalizer = Join-Path $repo 'Tools\DailyOperationsSync\Finalize-DailyOperationsPromotion.ps1'
$python = 'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$sourcePaths = @(
    'X:\AON\ADATA\ARM-01','X:\AON\ADATA\ARM-02','X:\AON\ADATA\ARM-03',
    'X:\AON\ADATA\ARM-05','X:\AON\ADATA\ARM-06','X:\AON\ADATA\ARM-09',
    'X:\AON\ADATA\ARM-10','X:\AON\ADATA\ARM-14','X:\AON\ADATA\ARE-03',
    'X:\AON\ADATA\ARE-13','X:\AON\ADATA\WOE-01','X:\AON\ADATA\WOE-03')
foreach ($path in @($customerRunner,$salesRunner,$workOrderRunner,$importer,$finalizer,$python) + $sourcePaths) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required SYNC-001 path is unavailable: $path" }
}
New-Item -ItemType Directory -Path $stateRoot,$runsRoot -Force | Out-Null
try {
    $lock = [IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,[IO.FileShare]::None)
} catch [IO.IOException] {
    [pscustomobject]@{ Result='ALREADY_RUNNING' } | ConvertTo-Json
    exit 2
}

$started = [DateTimeOffset]::UtcNow
$runId = 'DAILYOPSSYNC-' + $started.ToString('yyyyMMddTHHmmssZ') + '-' +
    ([Guid]::NewGuid().ToString('N')[0..7] -join '').ToUpperInvariant()
$runRoot = Join-Path $runsRoot $runId
$candidateRoot = Join-Path $runRoot 'Candidates'
New-Item -ItemType Directory -Path $candidateRoot | Out-Null
$componentOrder = @(
    'customer-master','sales-orders','work-orders','relationships','validation',
    'promotion','boundary-finalization','api-5042-readiness',
    'api-5052-readiness')
$components = [ordered]@{}
foreach ($id in $componentOrder) {
    $components[$id] = [ordered]@{ Id=$id; Status='Pending'; StartedAtUtc=$null;
        CompletedAtUtc=$null; RecordCount=$null; Message='' }
}
$currentComponent = ''
$overall = 'RUNNING'
$failureReason = $null
$importRunId = $null
$packageHash = $null
$sqlPromoted = $false
$finalizationEvidencePath = Join-Path $runRoot (
    'Finalization\finalization-evidence.json')

function Get-SourceIdentity {
    @($sourcePaths | ForEach-Object {
        $item = Get-Item -LiteralPath $_
        [ordered]@{ Path=$item.FullName; Length=[long]$item.Length;
            LastWriteTimeUtc=$item.LastWriteTimeUtc.ToString('O') }
    })
}
function Write-State {
    param([string]$State)
    $now = [DateTimeOffset]::UtcNow
    $value = [ordered]@{
        ContractVersion='daily-operations-sync-v1'; RunId=$runId; OverallStatus=$State
        CurrentComponent=$currentComponent; StartedAtUtc=$started.ToString('O')
        CompletedAtUtc=if($State -eq 'RUNNING'){$null}else{$now.ToString('O')}
        DurationSeconds=[long][Math]::Max(0,[Math]::Round(($now-$started).TotalSeconds))
        ImportRunId=$importRunId; PackageHash=$packageHash
        SqlPromotionCommitted=$sqlPromoted
        FinalizationEvidencePath=if(Test-Path $finalizationEvidencePath){
            $finalizationEvidencePath
        }else{$null}
        Components=@($components.Values)
        FailureReason=$failureReason; RequestedBy=$identity.Name; Trigger=$Trigger
        LastSuccessfulSynchronization=if(Test-Path $successPath){
            (Get-Content $successPath -Raw | ConvertFrom-Json).CompletedAtUtc
        }else{$null}
    }
    $stage=Join-Path $stateRoot ".$runId.status"
    [IO.File]::WriteAllText($stage,(($value|ConvertTo-Json -Depth 14)+"`n"),
        [Text.UTF8Encoding]::new($false))
    Move-Item $stage $statusPath -Force
}
function Set-Component {
    param([string]$Id,[string]$Status,[string]$Message='', [object]$Count=$null)
    $script:currentComponent=$Id
    $component=$components[$Id]
    if($Status -eq 'Running'){$component.StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')}
    if($Status -in @('Passed','Failed')){$component.CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')}
    $component.Status=$Status;$component.Message=$Message;$component.RecordCount=$Count
    Write-State 'RUNNING'
}
function Read-ChildDetails([string]$Path) {
    $state=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if($state.Result -cne 'CANDIDATE_READY'){throw "Candidate child failed: $($state.Message)"}
    return $state.Details
}
function Set-PromotedRunStatus([string]$Status) {
    $connection=[Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Application Name=DLE-OS Daily Operations Orchestrator')
    try {
        $connection.Open()
        $command=$connection.CreateCommand()
        $command.CommandText=@'
UPDATE platform.DailyOperationsSyncRun
SET Status=@Status
WHERE DailyOperationsSyncRunId=@RunId
  AND ImportRunId=@ImportRunId
  AND Status IN (
      N'PASSED_PROMOTED',
      N'PROMOTED_FINALIZATION_FAILED');
'@
        [void]$command.Parameters.AddWithValue('@Status',$Status)
        [void]$command.Parameters.AddWithValue('@RunId',$runId)
        [void]$command.Parameters.AddWithValue(
            '@ImportRunId',([Guid]$importRunId))
        if($command.ExecuteNonQuery() -ne 1){
            throw 'Promoted synchronization status was not finalized.'
        }
    }
    finally {$connection.Dispose()}
}

try {
    Write-State 'RUNNING'
    $sourceBefore=Get-SourceIdentity

    Set-Component 'customer-master' 'Running' 'Extracting governed Customer Master candidate.'
    if($QualificationFailStep -eq 'customer-master'){throw 'Controlled Customer Master failure.'}
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $customerRunner -CandidateOnly *>&1 |
        Set-Content (Join-Path $runRoot 'customer-master.log') -Encoding UTF8
    if($LASTEXITCODE -ne 0){throw "Customer Master candidate returned $LASTEXITCODE."}
    $customer=Read-ChildDetails 'C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\status.json'
    Set-Component 'customer-master' 'Passed' 'Customer Master candidate passed.' $customer.RecordCount

    Set-Component 'work-orders' 'Running' 'Extracting WOE-01 Work Orders read-only.'
    if($QualificationFailStep -eq 'work-orders'){throw 'Controlled Work Order failure.'}
    $workOrderPath=Join-Path $candidateRoot 'WorkOrders'
    $workOrderOutput=& $python $workOrderRunner --sync-run-id $runId --output $workOrderPath
    if($LASTEXITCODE -ne 0){throw "Work Order candidate returned $LASTEXITCODE."}
    $workOrder=$workOrderOutput -join "`n" | ConvertFrom-Json
    Set-Component 'work-orders' 'Passed' 'Work Order candidate passed.' $workOrder.RecordCount

    Set-Component 'sales-orders' 'Running' 'Extracting governed Open Sales Orders candidate.'
    if($QualificationFailStep -eq 'sales-orders'){throw 'Controlled Sales Order failure.'}
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $salesRunner -CandidateOnly -BasePackage $workOrder.BasePackagePath *>&1 |
        Set-Content (Join-Path $runRoot 'sales-orders.log') -Encoding UTF8
    if($LASTEXITCODE -ne 0){throw "Sales Order candidate returned $LASTEXITCODE."}
    $sales=Read-ChildDetails 'C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\status.json'
    Set-Component 'sales-orders' 'Passed' 'Sales Order candidate passed.' $sales.RecordCount

    Set-Component 'relationships' 'Running' 'Validating governed Work Order relationship evidence.'
    if($QualificationFailStep -eq 'relationships'){throw 'Controlled relationship failure.'}
    $relationshipFile=Join-Path $sales.PackagePath 'Canonical\SalesOrderWorkOrderRelationship.csv'
    if(-not(Test-Path $relationshipFile)){throw 'SalesOrderWorkOrderRelationship.csv is missing.'}
    $relationships=@(Import-Csv $relationshipFile)
    if([long]$sales.RecordCount -gt 0 -and $relationships.Count -eq 0){
        throw 'Relationship extraction returned zero rows for a non-empty open-order population.'
    }
    $workOrderNumbers=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    Import-Csv (Join-Path $workOrderPath 'Canonical\WorkOrder.csv') | ForEach-Object {
        [void]$workOrderNumbers.Add($_.WorkOrderNumber.Trim()) }
    $missing=@($relationships|Where-Object{-not $workOrderNumbers.Contains($_.WorkOrderNumber.Trim())})
    if($missing.Count){throw "Relationship candidate references $($missing.Count) missing Work Orders."}
    foreach($expected in @(
        @{Line='010';WorkOrder='0115619'},@{Line='050';WorkOrder='0115620'})){
        $openLine=Import-Csv (Join-Path $sales.PackagePath 'Canonical\SalesOrderLine.csv') |
            Where-Object {$_.SalesOrderNumber -eq '0012097' -and $_.LineNumber -eq $expected.Line}
        if($openLine -and -not($relationships|Where-Object{
            $_.SalesOrderNumber -eq '0012097' -and $_.AnchorSalesOrderLine -eq $expected.Line -and
            $_.WorkOrderNumber -eq $expected.WorkOrder})){
            throw "Required relationship 0012097/$($expected.Line)/$($expected.WorkOrder) is missing."
        }
    }
    Set-Component 'relationships' 'Passed' 'Relationship evidence passed without collapsing candidates.' $relationships.Count

    Set-Component 'validation' 'Running' 'Validating cross-dataset identity and atomic package.'
    if($QualificationFailStep -eq 'validation'){throw 'Controlled validation failure.'}
    $sourceAfter=Get-SourceIdentity
    if(($sourceBefore|ConvertTo-Json -Compress) -cne ($sourceAfter|ConvertTo-Json -Compress)){
        throw 'A governed VPro5 source changed during synchronization; promotion is blocked.'
    }
    $composite=[ordered]@{
        Schema='dle-daily-operations-snapshot';SchemaVersion='1.0';RunId=$runId
        CreatedAtUtc=[DateTimeOffset]::UtcNow.ToString('O');SourceIdentity=$sourceAfter
        CustomerPackagePath=[string]$customer.PackagePath;CustomerPackageSha256=[string]$customer.PackageSha256
        WorkOrderPackagePath=$workOrderPath;WorkOrderPackageSha256=[string]$workOrder.PackageSha256
        SalesOrderPackagePath=[string]$sales.PackagePath;SalesOrderPackageSha256=[string]$sales.PackageSha256
        Counts=[ordered]@{CustomerMaster=[long]$customer.RecordCount;SalesOrders=[long]$sales.RecordCount;
            WorkOrders=[long]$workOrder.RecordCount;WorkOrderRelationships=$relationships.Count}
        HeavyDatasetsRefreshed=@()
    }
    $manifestPath=Join-Path $runRoot 'manifest.json'
    $composite|ConvertTo-Json -Depth 14|Set-Content $manifestPath -Encoding UTF8
    $script:packageHash=(Get-FileHash $manifestPath -Algorithm SHA256).Hash
    Set-Component 'validation' 'Passed' 'All four datasets share one governed synchronization run.' 4

    Set-Component 'promotion' 'Running' 'Promoting all operational datasets in one SQL transaction.'
    if($QualificationFailStep -in @('sql-import','promotion')){throw 'Controlled atomic promotion failure.'}
    $importResult=& $importer -RunId $runId
    if($LASTEXITCODE -ne 0){throw "Daily Operations importer returned $LASTEXITCODE."}
    $import=$importResult -join "`n"|ConvertFrom-Json
    $script:importRunId=$import.ImportRunId
    if ($import.PackageHash -cne $packageHash) {
        throw 'Importer and synchronization manifest package hashes differ.'
    }
    $script:sqlPromoted=$true
    Set-Component 'promotion' 'Passed' 'Operational snapshot promoted atomically.' 4
    Set-Component 'boundary-finalization' 'Running' (
        'Advancing the qualified boundary for the promoted SQL snapshot.')
    if($QualificationFailStep -eq 'finalization'){
        throw 'Controlled post-promotion finalization failure.'
    }
    $finalizationOutput=& powershell.exe -NoLogo -NoProfile `
        -ExecutionPolicy Bypass -File $finalizer -RunId $runId `
        -ImportRunId $import.ImportRunId -PackageHash $packageHash
    $finalizationExitCode=$LASTEXITCODE
    $finalization=$null
    if(Test-Path $finalizationEvidencePath){
        $finalization=Get-Content $finalizationEvidencePath -Raw |
            ConvertFrom-Json
    }
    if($null -ne $finalization){
        if($finalization.BoundaryPromotion){
            Set-Component 'boundary-finalization' 'Passed' (
                'Qualified boundary matches the promoted SQL snapshot and manifest.')
        }
        if($finalization.ProductionApiReady){
            Set-Component 'api-5042-readiness' 'Passed' (
                'Production API 5042 is ReadyFresh on the promoted boundary.')
        }
        if($finalization.DevelopmentApiReady){
            Set-Component 'api-5052-readiness' 'Passed' (
                'Development API 5052 is ReadyFresh on the promoted boundary.')
        }
    }
    if($finalizationExitCode -ne 0 -or $null -eq $finalization -or
        $finalization.Verdict -cne 'PASS'){
        if($null -eq $finalization -or -not $finalization.BoundaryPromotion){
            Set-Component 'boundary-finalization' 'Failed' (
                'Qualified boundary finalization failed after SQL promotion.')
        }elseif(-not $finalization.ProductionApiReady){
            Set-Component 'api-5042-readiness' 'Failed' (
                'Production API 5042 did not become ReadyFresh.')
        }elseif(-not $finalization.DevelopmentApiReady){
            Set-Component 'api-5052-readiness' 'Failed' (
                'Development API 5052 did not become ReadyFresh.')
        }
        $detail=if($null -ne $finalization -and $finalization.Error){
            [string]$finalization.Error
        }else{($finalizationOutput -join "`n")}
        throw "Promoted snapshot finalization failed: $detail"
    }
    Set-Component 'boundary-finalization' 'Passed' (
        'Qualified boundary matches the promoted SQL snapshot and manifest.')
    Set-Component 'api-5042-readiness' 'Passed' (
        'Production API 5042 is ReadyFresh on the promoted boundary.')
    Set-Component 'api-5052-readiness' 'Passed' (
        'Development API 5052 is ReadyFresh on the promoted boundary.')
    $script:currentComponent=''
    $script:overall='PASSED_PROMOTED_READY'
    Write-State $overall
    Copy-Item $statusPath $successPath -Force
    (Get-Content $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json |
        ConvertTo-Json -Depth 14 -Compress) | Add-Content $historyPath -Encoding UTF8
    Get-Content $statusPath -Raw
}
catch {
    $script:failureReason=$_.Exception.Message
    if($currentComponent -and $components[$currentComponent].Status -eq 'Running'){
        $components[$currentComponent].Status='Failed'
        $components[$currentComponent].CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
        $components[$currentComponent].Message=$failureReason
    }
    if($sqlPromoted){
        $script:overall='PROMOTED_FINALIZATION_FAILED'
        try {Set-PromotedRunStatus $overall}
        catch {
            $script:failureReason +=
                " Metadata status update also failed: $($_.Exception.Message)"
        }
    }else{
        $script:overall='FAILED_NOT_PROMOTED'
    }
    Write-State $overall
    (Get-Content $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json |
        ConvertTo-Json -Depth 14 -Compress) | Add-Content $historyPath -Encoding UTF8
    Write-Error $failureReason
    exit 1
}
finally {
    if($lock){$lock.Dispose()}
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
}

[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$results=[Collections.Generic.List[object]]::new()
function Test-Rule([string]$Name,[scriptblock]$Rule){
    try{& $Rule;$results.Add([pscustomobject]@{Test=$Name;Result='PASS';Detail=''})}
    catch{$results.Add([pscustomobject]@{Test=$Name;Result='FAIL';Detail=$_.Exception.Message})}
}
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Text([string]$Path){Get-Content (Join-Path $repo $Path) -Raw}

$orchestrator=Text 'Tools\DailyOperationsSync\Invoke-DailyOperationsSync.ps1'
$importer=Text 'Tools\DailyOperationsSync\Import-DailyOperationsSnapshot.ps1'
$finalizer=Text 'Tools\DailyOperationsSync\Finalize-DailyOperationsPromotion.ps1'
$promoter=Text 'Tools\LiveSnapshotRefresh\Promote-DailyOperationsQualifiedBoundary.ps1'
$developmentLauncher=Text 'Tools\DevelopmentRuntime\Start-DevelopmentApi.ps1'
$reader=Text 'Tools\DailyOperationsSync\VPro\FOCUSED_WORK_ORDER_READER.src'
$builder=Text 'Artifacts\Platform002\Qualification\build_sales_order_package.py'
$salesExtractor=Text 'Tools\OperationsRefresh\focused_sales_order_refresh.py'
$control=Text 'Tools\LiveSnapshotRefresh\ControlHost\DailyOperationsSyncCenter.cs'
$ui=Text 'SRC\modules\system-center\system-center.html'
$uiJs=Text 'SRC\modules\system-center\system-center.js'

Test-Rule 'four candidates coordinated' {foreach($value in @('customer-master','sales-orders','work-orders','relationships')){Require ($orchestrator.Contains($value)) "missing $value"}}
Test-Rule 'no historical refresh' {Require (-not $orchestrator.Contains('InvoiceHistory')) 'Invoice History is in daily synchronization'}
Test-Rule 'WOE-01 only Work Order reader' {Require ($reader.Contains('X:\AON\ADATA\WOE-01')) 'WOE-01 absent';Require (-not ($reader -match 'BMM-01|IVM-01|GLM-01')) 'heavy source present'}
Test-Rule 'read only VPro source' {Require ($reader.Contains('MODE="O_RDONLY"')) 'O_RDONLY absent';Require (-not ($reader -match '(?im)^\d+\s+(WRITE|EXTRACT|REMOVE|INITFILE|ERASE|LOCK|UNLOCK)\b')) 'write statement present'}
Test-Rule 'relationship package generated' {Require ($builder.Contains('SalesOrderWorkOrderRelationship.csv')) 'relationship CSV not emitted'}
Test-Rule 'zero relationships block' {Require ($builder.Contains('relationship output is empty')) 'zero-row gate missing'}
Test-Rule 'missing Work Order blocks' {Require ($builder.Contains('references missing canonical Work Orders')) 'missing WO gate absent'}
Test-Rule 'ambiguity preserved' {Require ($builder.Contains('workOrderAmbiguous')) 'ambiguity metric absent';Require ($builder.Contains('set[str]')) 'candidate set absent'}
Test-Rule 'single SQL transaction' {Require (($importer|Select-String 'BeginTransaction' -AllMatches).Matches.Count -eq 1) 'not one transaction';Require (($importer|Select-String '\.Commit\(' -AllMatches).Matches.Count -eq 1) 'not one commit'}
Test-Rule 'transaction rollback' {Require $importer.Contains('$transaction.Rollback()') 'rollback absent'}
Test-Rule 'deployed ImportRun contract' {Require $importer.Contains('EnvironmentId') 'EnvironmentId absent';Require $importer.Contains('ImportOperation') 'ImportOperation absent'}
Test-Rule 'Customer package metadata contract' {Require $importer.Contains("'metadata.json'") 'Customer metadata.json absent';Require (-not $importer.Contains("customerRoot 'manifest.json'")) 'invalid Customer manifest reference remains'}
Test-Rule 'component hashes gate promotion' {foreach($value in @('CustomerPackageSha256','SalesOrderPackageSha256','WorkOrderPackageSha256')){Require $importer.Contains($value) "missing $value hash gate"}}
Test-Rule 'relationship schema additive' {Require $importer.Contains("COL_LENGTH(N'platform.SalesOrderExtensionRun'") 'relationship count migration absent';Require $importer.Contains("OBJECT_ID(N'canonical.SalesOrderWorkOrderRelationshipEvidence'") 'relationship table migration absent'}
Test-Rule 'bounded relationship completeness' {Require $salesExtractor.Contains('expected_relationships - actual_relationships') 'missing relationship comparison absent';Require $salesExtractor.Contains('seed_by_prefix') 'exact seed generation absent';Require $salesExtractor.Contains('woe03CompleteScans": 0') 'bounded extraction evidence absent'}
Test-Rule 'duplicate run lock' {Require $orchestrator.Contains('FileMode]::CreateNew') 'exclusive lock absent';Require $control.Contains('already_running') 'API conflict absent'}
Test-Rule 'cross-refresh concurrency block' {Require $control.Contains('IncompatibleStatePaths') 'incompatible refresh gate absent';Require $control.Contains('StateIsRunning') 'incompatible state evaluator absent'}
Test-Rule 'status persistence' {Require $orchestrator.Contains('last-successful.json') 'last success absent';Require $orchestrator.Contains('runs.jsonl') 'history absent'}
Test-Rule 'browser close independence' {Require $control.Contains('Process.Start') 'server process launch absent';Require (-not $uiJs.Contains('powershell')) 'browser exposes PowerShell'}
Test-Rule 'required API endpoints' {foreach($route in @('/run','/status','/latest','/last-successful')){Require $control.Contains($route) "missing $route"}}
Test-Rule 'required UI labels' {foreach($label in @('Daily Operations Synchronization','Run Daily Operations Synchronization','Full Platform Synchronization')){Require $ui.Contains($label) "missing $label"}}
Test-Rule 'component UI states' {foreach($label in @('Customer Master','Sales Orders','Work Orders','Work Order Relationships','Validation','Promotion')){Require $uiJs.Contains($label) "missing $label"}}
Test-Rule 'finalization UI states' {foreach($label in @('SQL Promotion','Qualified Boundary','Production API 5042','Development API 5052')){Require $uiJs.Contains($label) "missing $label"}}
Test-Rule 'daily status independent of full refresh' {Require $uiJs.Contains('Promise.all([') 'independent refresh startup absent'}
Test-Rule 'known ABBOTT acceptance records' {foreach($value in @('0012097','0115619','0115620')){Require $orchestrator.Contains($value) "missing $value"}}
Test-Rule 'same-run identity gate' {Require $orchestrator.Contains('sourceBefore') 'before identity absent';Require $orchestrator.Contains('sourceAfter') 'after identity absent'}
Test-Rule 'required quantity contract retained' {Require $builder.Contains('QuantityOrdered') 'quantity source absent';Require (-not $builder.Contains('QuantityOrdered -')) 'derived Qty Open detected'}

Test-Rule 'governed terminal states' {foreach($state in @('PASSED_PROMOTED_READY','PROMOTED_FINALIZATION_FAILED','FAILED_NOT_PROMOTED')){Require $orchestrator.Contains($state) "missing $state"}}
Test-Rule 'finalization follows SQL promotion' {
    $importPosition=$orchestrator.IndexOf('$importResult=& $importer')
    $finalizerPosition=$orchestrator.IndexOf('-File $finalizer')
    Require ($importPosition -ge 0 -and $finalizerPosition -gt $importPosition) 'finalizer does not follow importer'
}
Test-Rule 'promoted identity passed to finalizer' {foreach($value in @('-RunId $runId','-ImportRunId $import.ImportRunId','-PackageHash $packageHash')){Require $orchestrator.Contains($value) "missing finalizer argument $value"}}
Test-Rule 'boundary promoter invoked' {Require $finalizer.Contains('& $promoter -RunId $RunId -RecoveryRoot $RecoveryRoot') 'governed promoter call absent'}
Test-Rule 'failed finalization remains retryable' {Require $promoter.Contains("N'PROMOTED_FINALIZATION_FAILED'") 'promoter retry state absent'}
Test-Rule 'stale boundary replaced in all governed locations' {
    foreach($path in @('$configurationPath','$runtimeBoundaryPath','$currentBoundaryPath')){
        Require $promoter.Contains("Replace-JsonFile -Path $path") "boundary write absent for $path"
    }
    foreach($field in @('ExpectedImportRunId','ExpectedMirrorRunId','ExpectedPackageHash')){
        Require $promoter.Contains($field) "boundary identity field absent: $field"
    }
}
Test-Rule 'governed restart order' {
    $promotePosition=$finalizer.IndexOf('$promotionResult = & $promoter')
    $productionPosition=$finalizer.IndexOf('$productionResult = & $productionLauncher')
    $developmentPosition=$finalizer.IndexOf('& $developmentLauncher -ElevatedStage -ReloadQualifiedBoundary')
    Require ($promotePosition -ge 0 -and $productionPosition -gt $promotePosition -and $developmentPosition -gt $productionPosition) 'boundary/5042/5052 sequence is invalid'
}
Test-Rule 'both APIs require ReadyFresh' {Require (($finalizer|Select-String 'Get-Ready 5042' -AllMatches).Matches.Count -eq 1) '5042 ReadyFresh probe absent';Require (($finalizer|Select-String 'Get-Ready 5052' -AllMatches).Matches.Count -eq 1) '5052 ReadyFresh probe absent'}
Test-Rule 'promoter failure is explicit' {Require $finalizer.Contains("Set-SyncRunStatus 'PROMOTED_FINALIZATION_FAILED'") 'finalization failure metadata absent';Require $uiJs.Contains('Data promotion succeeded; API readiness finalization failed') 'operator failure message absent'}
Test-Rule 'API restart failures are distinct' {Require $orchestrator.Contains("Set-Component 'api-5042-readiness' 'Failed'") '5042 failure component absent';Require $orchestrator.Contains("Set-Component 'api-5052-readiness' 'Failed'") '5052 failure component absent'}
Test-Rule 'no boundary promotion after failed SQL promotion' {
    $commitPosition=$orchestrator.IndexOf('$script:sqlPromoted=$true')
    $finalizerPosition=$orchestrator.IndexOf('-File $finalizer')
    Require ($commitPosition -ge 0 -and $finalizerPosition -gt $commitPosition) 'finalizer is reachable before committed promotion'
}
Test-Rule 'canonical facts immutable in finalization' {foreach($value in @('CanonicalSignaturesBefore','CanonicalSignaturesAfter','Canonical facts changed during readiness finalization')){Require $finalizer.Contains($value) "missing integrity evidence $value"}}
Test-Rule '5052 reload preserves deployed binary' {Require $developmentLauncher.Contains('ReloadQualifiedBoundary') 'reload mode absent';Require $developmentLauncher.Contains('The development API assembly changed during boundary reload.') 'assembly immutability gate absent'}

$failed=@($results|Where-Object Result -eq 'FAIL')
$results|Format-Table -AutoSize|Out-String|Write-Output
[pscustomobject]@{Total=$results.Count;Passed=$results.Count-$failed.Count;Failed=$failed.Count}|ConvertTo-Json
if($failed.Count){exit 1}

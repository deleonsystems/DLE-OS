[CmdletBinding()]
param(
    [switch] $ForceFullExtraction,
    [switch] $QualificationCurrentFixture,
    [switch] $QualificationInduceFailure,
    [ValidateRange(0, 30)]
    [int] $QualificationHoldLockSeconds = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ForceFullExtraction -and $QualificationCurrentFixture) {
    throw (
        'ForceFullExtraction and QualificationCurrentFixture are mutually ' +
        'exclusive.'
    )
}

$approvedIdentity = 'DLE-OS-HOST\DLE-OS'
$refreshRoot = 'C:\DLE-OS\Canonical\LiveMirror\Refresh'
$runsRoot = 'C:\DLE-OS\Canonical\LiveMirror\RefreshRuns'
$stateRoot = 'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State'
$statusPath = Join-Path $stateRoot 'status.json'
$sourceStatePath = Join-Path $stateRoot 'qualified-source-state.json'
$lockPath = Join-Path $stateRoot 'refresh.lock'
$baseRoot = 'C:\DLE-OS\Canonical\LiveMirror'
$baseCurrent = Join-Path $baseRoot 'Current'
$basePrevious = Join-Path $baseRoot 'Previous'
$salesRoot = Join-Path $baseRoot 'Platform002'
$salesCurrent = Join-Path $salesRoot 'Current'
$salesPrevious = Join-Path $salesRoot 'Previous'
$baseEngine = Join-Path $baseRoot 'Engine\live_mirror_engine.py'
$salesHelper = Join-Path $refreshRoot 'sales_order_refresh.py'
$decisionModule = Join-Path $refreshRoot 'RefreshDecision.psm1'
$boundaryPromoter =
    Join-Path $refreshRoot 'Promote-QualifiedSnapshotBoundary.ps1'
$promotionCompleter =
    Join-Path $refreshRoot 'Complete-LiveSnapshotPromotion.ps1'
$importerAssembly =
    'C:\DLE-OS\Repositories\DLE-OS-Server\DleOs.PlatformImporter\bin\Release\net8.0\DleOs.PlatformImporter.dll'
$salesImporter =
    'C:\DLE-OS\Repositories\DLE-OS-Server\Tools\Import-Platform002SalesOrders.ps1'
$liveLauncher =
    'C:\DLE-OS\Repositories\DLE-OS-Server\DleOs.PlatformApi.Tests\Start-LiveCanonicalApiAsDedicatedIdentity.ps1'
$dotnet = 'C:\Program Files\dotnet\dotnet.exe'
$python =
    'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$sourcePaths = @(
    'X:\AON\ADATA\BMM-01',
    'X:\AON\ADATA\IVM-01',
    'X:\AON\ADATA\WOE-01',
    'X:\AON\ADATA\GLM-01',
    'X:\AON\ADATA\ARE-03',
    'X:\AON\ADATA\ARE-13',
    'X:\AON\ADATA\ARM-01',
    'X:\AON\ADATA\ARM-10',
    'X:\AON\ADATA\WOE-03'
)

function Get-UtcNow {
    [DateTimeOffset]::UtcNow.ToString('O')
}

function Convert-BytesToHex {
    param([byte[]] $Bytes)
    ([BitConverter]::ToString($Bytes)).Replace('-', '')
}

function Read-Status {
    if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
        return [ordered]@{}
    }
    $value = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    $result = [ordered]@{}
    foreach ($property in $value.PSObject.Properties) {
        $result[$property.Name] = $property.Value
    }
    return $result
}

function Write-Status {
    param([hashtable] $Values)
    $current = Read-Status
    foreach ($key in $Values.Keys) {
        $current[$key] = $Values[$key]
    }
    $stage =
        Join-Path $stateRoot (
            '.status.' + [Guid]::NewGuid().ToString('N') + '.staging'
        )
    $text = $current | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText(
        $stage,
        $text + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $stage -Destination $statusPath -Force
}

function Get-SourceState {
    $items = foreach ($path in $sourcePaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Approved source file is unavailable: $path"
        }
        $item = Get-Item -LiteralPath $path
        [ordered]@{
            Path = $item.FullName
            Length = [long]$item.Length
            LastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('O')
            Access = 'READ_ONLY_FILESYSTEM_METADATA'
        }
    }
    return @($items)
}

function Test-SourceStateEqual {
    param([object[]] $First, [object[]] $Second)
    if ($First.Count -ne $Second.Count) { return $false }
    for ($index = 0; $index -lt $First.Count; $index++) {
        foreach ($name in @(
            'Path', 'Length', 'LastWriteTimeUtc'
        )) {
            if (
                [string]$First[$index].$name -cne
                [string]$Second[$index].$name
            ) {
                return $false
            }
        }
    }
    return $true
}

function Get-SourceIndicatorFingerprint {
    param([object[]] $State)
    $material = foreach ($source in $State) {
        @(
            [string]$source.Path,
            [string]$source.Length,
            [string]$source.LastWriteTimeUtc,
            [string]$source.Access
        ) -join "`0"
    }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        Convert-BytesToHex (
            $algorithm.ComputeHash(
                [Text.Encoding]::UTF8.GetBytes(($material -join "`n"))))
    }
    finally {
        $algorithm.Dispose()
    }
}

function Write-SqlSourceCheck {
    param(
        [Guid] $ImportRunId,
        [string] $CheckedAtUtc,
        [string] $Result,
        [string] $IndicatorFingerprint,
        [bool] $IndicatorsUnchanged
    )
    $connectionString =
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Connect Timeout=5;Application Name=DLE-OS Source Check'
    $connection = [System.Data.SqlClient.SqlConnection]::new(
        $connectionString)
    try {
        $connection.Open()
        $transaction = $connection.BeginTransaction(
            [System.Data.IsolationLevel]::Serializable)
        try {
            $command = $connection.CreateCommand()
            $command.Transaction = $transaction
            $command.CommandType =
                [System.Data.CommandType]::StoredProcedure
            $command.CommandText = 'platform.RecordLiveSourceCheck'
            [void]$command.Parameters.AddWithValue(
                '@ImportRunId', $ImportRunId)
            $checkedAtParameter = $command.Parameters.Add(
                '@CheckedAtUtc', [Data.SqlDbType]::DateTime2)
            $checkedAtParameter.Scale = 7
            $checkedAtParameter.Value =
                ([DateTimeOffset]$CheckedAtUtc).UtcDateTime
            [void]$command.Parameters.AddWithValue('@Result', $Result)
            [void]$command.Parameters.AddWithValue(
                '@IndicatorFingerprint', $IndicatorFingerprint)
            [void]$command.Parameters.AddWithValue(
                '@IndicatorsUnchanged', $IndicatorsUnchanged)
            [void]$command.ExecuteNonQuery()
            $transaction.Commit()
        }
        catch {
            $transaction.Rollback()
            throw
        }
        finally {
            $transaction.Dispose()
        }
    }
    finally {
        $connection.Dispose()
    }
}

function Write-SourceState {
    param([object[]] $State)
    $stage =
        Join-Path $stateRoot (
            '.source-state.' + [Guid]::NewGuid().ToString('N') + '.staging'
        )
    [ordered]@{
        QualifiedAtUtc = Get-UtcNow
        SourceCount = $State.Count
        Sources = $State
        FingerprintDescription =
            'Filesystem length and UTC last-write time change indicators; full VPro fingerprints are validated during changed-source extraction.'
    } |
        ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $stage -Encoding UTF8
    Move-Item -LiteralPath $stage -Destination $sourceStatePath -Force
}

function Get-SqlSnapshot {
    $connectionString =
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Connect Timeout=5;Application Name=DLE-OS Manual Refresh Status'
    $connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT ImportRunId, MirrorRunId, PackageHash, ContractVersion,
       BillOfMaterialCount, InventoryItemCount, WorkOrderCount,
       GeneralLedgerAccountCount, TotalCount
FROM liveapi.SnapshotMetadata;
'@
        $table = [System.Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        if ($table.Rows.Count -ne 1) {
            throw 'LIVE snapshot metadata did not return exactly one row.'
        }
        return $table.Rows[0]
    }
    finally {
        $connection.Dispose()
    }
}

function Get-DirectoryIdentity {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return 'ABSENT'
    }
    $material = foreach (
        $file in Get-ChildItem -LiteralPath $Path -Recurse -File |
            Sort-Object FullName
    ) {
        $relative = $file.FullName.Substring($Path.Length).TrimStart('\')
        "$relative`0$($file.Length)`0$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)"
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($material -join "`n"))
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return Convert-BytesToHex ($algorithm.ComputeHash($bytes))
    }
    finally {
        $algorithm.Dispose()
    }
}

function Copy-DirectorySnapshot {
    param([string] $Source, [string] $Destination)
    if (Test-Path -LiteralPath $Source -PathType Container) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        Copy-Item -Path (Join-Path $Source '*') `
            -Destination $Destination -Recurse -Force
    }
}

function Restore-DirectorySnapshot {
    param([string] $Backup, [string] $Target)
    $approvedTargets = @(
        $baseCurrent, $basePrevious, $salesCurrent, $salesPrevious
    )
    if ($Target -notin $approvedTargets) {
        throw "Restore target is outside the approved package slots: $Target"
    }
    if (Test-Path -LiteralPath $Target) {
        Remove-Item -LiteralPath $Target -Recurse -Force
    }
    if (Test-Path -LiteralPath $Backup -PathType Container) {
        New-Item -ItemType Directory -Path $Target -Force | Out-Null
        Copy-Item -Path (Join-Path $Backup '*') `
            -Destination $Target -Recurse -Force
    }
}

function Invoke-Checked {
    param(
        [string] $FilePath,
        [string[]] $Arguments,
        [string] $Description
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description returned exit code $LASTEXITCODE."
    }
}

function Stop-QualifiedLiveApi {
    $listener =
        Get-NetTCPConnection -State Listen -LocalPort 5042 `
            -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $listener) { return $null }
    $process = Get-CimInstance Win32_Process -Filter (
        "ProcessId=$($listener.OwningProcess)"
    )
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    if (
        "$($owner.Domain)\$($owner.User)" -ine
            'DLE-OS-HOST\DLE-OS-LIVE-API' -or
        [string]$process.CommandLine -notlike
            '*C:\Program Files\DLE-OS\LiveCanonicalApi\DLE-OS-Server.dll*'
    ) {
        throw 'Port 5042 is owned by an unqualified process.'
    }
    Stop-Process -Id $listener.OwningProcess -Force
    return $listener.OwningProcess
}

function Start-QualifiedLiveApi {
    $launcherLog =
        'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\Logs\live-launcher.log'
    $launcherError =
        'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\Logs\live-launcher.error.log'
    $launcher = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            "`"$liveLauncher`""
        ) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $launcherLog `
        -RedirectStandardError $launcherError `
        -PassThru
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $readiness =
                Invoke-RestMethod `
                    -Uri (
                        'http://DLE-OS-HOST:5042/' +
                        'api/platform/live/v1/readiness'
                    ) `
                    -TimeoutSec 2
            if ($readiness.readinessVerdict -eq 'Ready') {
                return
            }
        }
        catch {
            $launcher.Refresh()
            if ($launcher.HasExited) {
                $detail =
                    Get-Content -LiteralPath $launcherError -Raw `
                        -ErrorAction SilentlyContinue
                throw (
                    'The detached LIVE launcher exited before readiness. ' +
                    $detail
                )
            }
        }
    }
    throw 'The detached LIVE launcher did not reach readiness in 20 seconds.'
}

function Promote-SalesCandidate {
    param([string] $Candidate)
    if (-not (Test-Path -LiteralPath (Join-Path $Candidate 'manifest.json'))) {
        throw 'The staged Sales Order candidate is incomplete.'
    }
    if (Test-Path -LiteralPath $salesPrevious) {
        Remove-Item -LiteralPath $salesPrevious -Recurse -Force
    }
    if (Test-Path -LiteralPath $salesCurrent) {
        Move-Item -LiteralPath $salesCurrent -Destination $salesPrevious
    }
    Move-Item -LiteralPath $Candidate -Destination $salesCurrent
}

New-Item -ItemType Directory -Path $stateRoot, $runsRoot -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $approvedIdentity) {
    throw "Manual refresh requires $approvedIdentity; actual identity is $identity."
}
foreach ($required in @(
    $baseEngine, $salesHelper, $decisionModule, $boundaryPromoter, $importerAssembly,
    $salesImporter, $liveLauncher, $promotionCompleter, $dotnet, $python
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required governed refresh component is absent: $required"
    }
}
Import-Module -Name $decisionModule -Force

$lock = $null
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$randomBytes = New-Object byte[] 4
try {
    $random.GetBytes($randomBytes)
    $randomText = Convert-BytesToHex $randomBytes
}
finally {
    $random.Dispose()
}
$runId =
    'LIVEREFRESH-' +
    [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ') +
    '-' +
    $randomText
try {
    try {
        $lock = [IO.File]::Open(
            $lockPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::ReadWrite,
            [IO.FileShare]::None)
    }
    catch [IO.IOException] {
        [pscustomobject]@{
            Status = 'ALREADY_RUNNING'
            Result = 'ALREADY_RUNNING'
        } | ConvertTo-Json
        exit 2
    }

    $runRoot = Join-Path $runsRoot $runId
    New-Item -ItemType Directory -Path $runRoot | Out-Null
    Write-Status @{
        Running = $true
        Status = 'RUNNING'
        Phase = 'SOURCE_CHECK'
        Message = 'Reading fixed qualified source change indicators.'
        InvocationMode =
            if ($ForceFullExtraction) {
                'FORCE_FULL_EXTRACTION'
            } elseif ($QualificationCurrentFixture) {
                'QUALIFICATION_CURRENT_FIXTURE'
            } else {
                'NORMAL'
            }
        ForceFullExtraction = [bool]$ForceFullExtraction
        RunId = $runId
        StartedAtUtc = Get-UtcNow
        LastFailureReason = $null
    }
    if ($QualificationHoldLockSeconds -gt 0) {
        Start-Sleep -Seconds $QualificationHoldLockSeconds
    }

    $sourceState = Get-SourceState
    $sourceCheckedAt = Get-UtcNow
    $sourceIndicatorFingerprint =
        Get-SourceIndicatorFingerprint @($sourceState)
    $priorSourceState = $null
    if (Test-Path -LiteralPath $sourceStatePath -PathType Leaf) {
        $priorSourceState =
            (Get-Content -LiteralPath $sourceStatePath -Raw |
                ConvertFrom-Json).Sources
    }
    $unchanged =
        $null -ne $priorSourceState -and
        (Test-SourceStateEqual @($sourceState) @($priorSourceState))
    $disposition = Get-LiveSnapshotRefreshDisposition `
        -SourceUnchanged $unchanged `
        -ForceFullExtraction ([bool]$ForceFullExtraction) `
        -QualificationCurrentFixture ([bool]$QualificationCurrentFixture)
    $sqlBefore = Get-SqlSnapshot
    if ($disposition -eq 'NO_SOURCE_CHANGES') {
        Write-SqlSourceCheck `
            -ImportRunId ([Guid]$sqlBefore.ImportRunId) `
            -CheckedAtUtc $sourceCheckedAt `
            -Result 'NO_SOURCE_CHANGES' `
            -IndicatorFingerprint $sourceIndicatorFingerprint `
            -IndicatorsUnchanged $true
        Write-Status @{
            Running = $false
            Status = 'NO_SOURCE_CHANGES'
            Phase = 'COMPLETED'
            Message =
                'No qualified ERP source changes were detected. The active snapshot was retained.'
            LastSourceCheckUtc = $sourceCheckedAt
            ActiveImportRunId = ([Guid]$sqlBefore.ImportRunId).ToString('D')
            CurrentPackageHash = [string]$sqlBefore.PackageHash
            LastResult = 'NO_SOURCE_CHANGES'
            CompletedAtUtc = Get-UtcNow
        }
        [pscustomobject]@{
            Status = 'NO_SOURCE_CHANGES'
            InvocationMode = 'NORMAL'
            ForceFullExtraction = $false
            ImportRunId = ([Guid]$sqlBefore.ImportRunId).ToString('D')
            PackageHash = [string]$sqlBefore.PackageHash
        } | ConvertTo-Json
        exit 0
    }
    if (
        -not $unchanged -and
        -not $ForceFullExtraction -and
        -not $QualificationCurrentFixture
    ) {
        Write-SqlSourceCheck `
            -ImportRunId ([Guid]$sqlBefore.ImportRunId) `
            -CheckedAtUtc $sourceCheckedAt `
            -Result 'SOURCE_CHANGED_FULL_EXTRACTION_REQUIRED' `
            -IndicatorFingerprint $sourceIndicatorFingerprint `
            -IndicatorsUnchanged $false
    }
    if ($ForceFullExtraction) {
        Write-Status @{
            Phase = 'FORCE_FULL_EXTRACTION_AUTHORIZED'
            Message =
                'Explicit force-full intent accepted; all extraction, validation, import, rollback, promotion, and readiness gates remain active.'
        }
    }

    $baseCurrentBefore = Get-DirectoryIdentity $baseCurrent
    $basePreviousBefore = Get-DirectoryIdentity $basePrevious
    $salesCurrentBefore = Get-DirectoryIdentity $salesCurrent
    $salesPreviousBefore = Get-DirectoryIdentity $salesPrevious
    if ($QualificationInduceFailure) {
        throw 'Controlled qualification failure before candidate mutation.'
    }

    $rollbackRoot = Join-Path $runRoot 'Rollback'
    Copy-DirectorySnapshot $baseCurrent (Join-Path $rollbackRoot 'BaseCurrent')
    Copy-DirectorySnapshot $basePrevious (Join-Path $rollbackRoot 'BasePrevious')
    Copy-DirectorySnapshot $salesCurrent (Join-Path $rollbackRoot 'SalesCurrent')
    Copy-DirectorySnapshot $salesPrevious (Join-Path $rollbackRoot 'SalesPrevious')
    $packagesMutated = $false
    $sqlMutated = $false

    if ($QualificationCurrentFixture) {
        Write-Status @{
            Phase = 'VALIDATING_FIXTURE'
            Message = 'Revalidating the existing qualified packages through the governed import boundary as a controlled fixture.'
        }
    }
    else {
        Write-Status @{
            Phase = 'EXTRACTING_BASE'
            Message = 'Running the four-entity O_RDONLY live mirror.'
        }
        Invoke-Checked $python @($baseEngine, 'run') `
            'Base live mirror'
        $packagesMutated = $true
        Write-Status @{
            Phase = 'EXTRACTING_SALES_ORDERS'
            Message = 'Running the five-source O_RDONLY Sales Order extraction.'
        }
        Invoke-Checked $python @(
            $salesHelper,
            '--run-id', $runId,
            '--run-root', $runRoot
        ) 'Sales Order live extraction'
    }

    Write-Status @{
        Phase = 'AWAITING_LOCAL_PROMOTION'
        Message = 'Awaiting operator elevation for local SQL and boundary promotion. No X: access occurs in the elevated phase.'
        CandidateSourceCheckedAtUtc = $sourceCheckedAt
        CandidateSourceIndicatorFingerprint =
            $sourceIndicatorFingerprint
    }
    $promotionUri =
        'http://localhost:5044/api/platform/refresh/v1/promote?' +
        'runId=' + [Uri]::EscapeDataString($runId) +
        '&fixture=' +
        ([bool]$QualificationCurrentFixture).ToString().ToLowerInvariant()
    $promotionStarted = $true
    $promotionResponse =
        Invoke-RestMethod `
            -Uri $promotionUri `
            -Method Post `
            -UseDefaultCredentials `
            -TimeoutSec 10
    if ($promotionResponse.status -ne 'PROMOTION_STARTED') {
        throw 'The elevated local promotion broker rejected the candidate.'
    }
    $promotionResultPath = Join-Path $runRoot 'promotion-result.json'
    for ($attempt = 0; $attempt -lt 3600; $attempt++) {
        if (Test-Path -LiteralPath $promotionResultPath -PathType Leaf) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $promotionResultPath -PathType Leaf)) {
        throw 'Local snapshot promotion did not complete within 15 minutes.'
    }
    $promotionResult =
        Get-Content -LiteralPath $promotionResultPath -Raw |
        ConvertFrom-Json
    if ($promotionResult.Verdict -ne 'PASS') {
        throw (
            'Local snapshot promotion failed. ' +
            [string]$promotionResult.Failure +
            ' Recovery: ' +
            [string]$promotionResult.Recovery
        )
    }
    Write-Status @{
        Phase = 'VERIFYING_PROMOTION'
        Message = 'Verifying the promoted SQL snapshot and qualified boundary.'
    }
    $sqlAfter = Get-SqlSnapshot
    if (-not $QualificationCurrentFixture) {
        Write-SourceState $sourceState
    }
    Write-Status @{
        Running = $false
        Status = 'SUCCESS'
        Phase = 'COMPLETED'
        Message =
            'A qualified snapshot was promoted. Use Refresh View when ready.'
        LastSourceCheckUtc = $sourceCheckedAt
        LastSuccessfulRefreshUtc = Get-UtcNow
        ActiveImportRunId = ([Guid]$sqlAfter.ImportRunId).ToString('D')
        CurrentPackageHash = [string]$sqlAfter.PackageHash
        LastResult = 'SUCCESS'
        CompletedAtUtc = Get-UtcNow
    }
    $refreshResultJson = [ordered]@{
        Status = 'SUCCESS'
        RunId = $runId
        ImportRunId = ([Guid]$sqlAfter.ImportRunId).ToString('D')
        MirrorRunId = [string]$sqlAfter.MirrorRunId
        PackageHash = [string]$sqlAfter.PackageHash
        Fixture = [bool]$QualificationCurrentFixture
        ForceFullExtraction = [bool]$ForceFullExtraction
        InvocationMode =
            if ($ForceFullExtraction) {
                'FORCE_FULL_EXTRACTION'
            } else {
                'NORMAL'
            }
    } | ConvertTo-Json -Depth 5
    $refreshResultJson |
        Set-Content -LiteralPath (
            Join-Path $runRoot 'refresh-result.json'
        ) -Encoding UTF8
    Write-Output $refreshResultJson
}
catch {
    $failure = $_.Exception.Message
    $recovery = @()
    try {
        $promotionWasStarted =
            $null -ne (
                Get-Variable promotionStarted -ErrorAction SilentlyContinue
            ) -and $promotionStarted
        if (
            -not $promotionWasStarted -and
            $null -ne (
                Get-Variable packagesMutated -ErrorAction SilentlyContinue
            ) -and
            $packagesMutated
        ) {
            Write-Status @{
                Phase = 'ROLLING_BACK'
                Message = 'Restoring package slots after pre-promotion failure.'
            }
            Restore-DirectorySnapshot (
                Join-Path $rollbackRoot 'BaseCurrent'
            ) $baseCurrent
            Restore-DirectorySnapshot (
                Join-Path $rollbackRoot 'BasePrevious'
            ) $basePrevious
            Restore-DirectorySnapshot (
                Join-Path $rollbackRoot 'SalesCurrent'
            ) $salesCurrent
            Restore-DirectorySnapshot (
                Join-Path $rollbackRoot 'SalesPrevious'
            ) $salesPrevious
            $recovery += 'PRE_PROMOTION_PACKAGES_RESTORED'
        }
    }
    catch {
        $recovery += 'RESTORATION_FAILED: ' + $_.Exception.Message
    }
    $active = $null
    try { $active = Get-SqlSnapshot } catch {}
    Write-Status @{
        Running = $false
        Status = 'FAILED'
        Phase = 'FAILED'
        Message = 'The refresh failed. The prior qualified snapshot remains active unless restoration evidence states otherwise.'
        LastSourceCheckUtc =
            if ($null -ne (Get-Variable sourceCheckedAt -ErrorAction SilentlyContinue)) {
                $sourceCheckedAt
            } else { Get-UtcNow }
        ActiveImportRunId =
            if ($null -ne $active) {
                ([Guid]$active.ImportRunId).ToString('D')
            } else { $null }
        CurrentPackageHash =
            if ($null -ne $active) { [string]$active.PackageHash } else { $null }
        LastResult = 'FAILED'
        LastFailureReason = $failure
        Recovery = @($recovery)
        CompletedAtUtc = Get-UtcNow
    }
    Write-Error $failure
    exit 1
}
finally {
    if ($null -ne $lock) {
        $lock.Dispose()
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
}

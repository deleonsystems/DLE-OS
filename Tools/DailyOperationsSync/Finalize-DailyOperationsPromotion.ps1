[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^DAILYOPSSYNC-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$')]
    [string] $RunId,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f-]{36}$')]
    [string] $ImportRunId,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-F]{64}$')]
    [string] $PackageHash,

    [switch] $ElevatedStage,
    [string] $RecoveryRoot,
    [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$operator = 'DLE-OS-HOST\DLE-OS'
$runtimeIdentity = 'DLE-OS-HOST\DLE-OS-LIVE-API'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$syncRoot = 'C:\DLE-OS\Canonical\DailyOperationsSync'
$runRoot = Join-Path (Join-Path $syncRoot 'Runs') $RunId
$manifestPath = Join-Path $runRoot 'manifest.json'
$finalizationRoot = Join-Path $runRoot 'Finalization'
$expectedRecoveryRoot = Join-Path $finalizationRoot 'Recovery'
$expectedEvidencePath = Join-Path $finalizationRoot 'finalization-evidence.json'
$promoter = Join-Path $repository (
    'Tools\LiveSnapshotRefresh\Promote-DailyOperationsQualifiedBoundary.ps1')
$productionLauncher =
    'C:\DLE-OS\Repositories\DLE-OS-Server\DleOs.PlatformApi.Tests\Start-LiveApiManualQualified.ps1'
$developmentLauncher = Join-Path $repository (
    'Tools\DevelopmentRuntime\Start-DevelopmentApi.ps1')
$developmentEvidencePath = Join-Path $repository (
    '.tmp\development-runtime\5052-launch.json')
$productionLaunchEvidence =
    'C:\DLE-OS\Repositories\DLE-OS-Server\Artifacts\LiveApi001\ManualRuntime\manual-launch-evidence.json'
$productionRuntime = 'C:\Program Files\DLE-OS\LiveCanonicalApi'
$productionAssembly = Join-Path $productionRuntime 'DLE-OS-Server.dll'
$developmentAssembly =
    'C:\ProgramData\DLE-OS\DevelopmentCanonicalApi\DleOs.DevelopmentApi.dll'
$configurationPath = Join-Path $productionRuntime 'appsettings.Live.json'
$runtimeBoundaryPath = Join-Path $productionRuntime 'live-qualified-boundary.json'
$qualifiedRoot =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\QualifiedBoundary'
$currentBoundaryPath = Join-Path $qualifiedRoot 'current-qualified-snapshot.json'
$previousBoundaryPath = Join-Path $qualifiedRoot 'previous-qualified-snapshot.json'
$productionAssemblyHash =
    '4806AFFE55C801A744CA1D412F0AFDFDAEC4DABDD71A4B6B31B58353B58A5043'
$connectionString =
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Daily Operations Finalization'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Listener {
    param([int] $Port)
    $row = netstat.exe -ano -p tcp |
        Select-String -Pattern (
            '^\s*TCP\s+\S+:' + $Port +
            '\s+\S+\s+LISTENING\s+\d+\s*$') |
        Select-Object -First 1
    if ($null -eq $row) { return $null }
    [int]((-split $row.Line)[-1])
}

function Wait-Listener {
    param([int] $Port, [int] $Seconds = 45)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        $listener = Get-Listener $Port
        if ($null -ne $listener) { return $listener }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Port $Port did not reach LISTENING."
}

function Wait-Stopped {
    param([int] $Port, [int] $Seconds = 15)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        if ($null -eq (Get-Listener $Port)) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Port $Port did not stop."
}

function Get-SnapshotEvidence {
    $connection = [Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT
    metadata.ImportRunId,
    metadata.EnvironmentId,
    metadata.MirrorRunId,
    metadata.PackageHash,
    metadata.ContractVersion,
    metadata.WorkOrderCount,
    status.SourceChangeStatus,
    status.LastSourceCheckResult,
    sync.Status,
    sync.CustomerCount,
    sync.SalesOrderLineCount,
    sync.WorkOrderCount AS SyncWorkOrderCount,
    sync.RelationshipCount
FROM liveapi.SnapshotMetadata AS metadata
JOIN liveapi.SnapshotOperationalStatus AS status
  ON status.ImportRunId = metadata.ImportRunId
JOIN platform.DailyOperationsSyncRun AS sync
  ON sync.ImportRunId = metadata.ImportRunId
WHERE sync.DailyOperationsSyncRunId = @RunId;
'@
        [void]$command.Parameters.AddWithValue('@RunId', $RunId)
        $reader = $command.ExecuteReader()
        if (-not $reader.Read()) {
            throw 'The promoted joined snapshot is absent.'
        }
        $value = [ordered]@{}
        foreach ($name in @(
            'ImportRunId', 'EnvironmentId', 'MirrorRunId', 'PackageHash',
            'ContractVersion', 'WorkOrderCount', 'SourceChangeStatus',
            'LastSourceCheckResult', 'Status', 'CustomerCount',
            'SalesOrderLineCount', 'SyncWorkOrderCount', 'RelationshipCount'
        )) {
            $value[$name] = $reader[$name]
        }
        if ($reader.Read()) {
            throw 'More than one joined synchronization snapshot was found.'
        }
        $reader.Dispose()
        return [pscustomobject]$value
    }
    finally {
        $connection.Dispose()
    }
}

function Get-CanonicalSignatures {
    $connection = [Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT N'CustomerMaster' Dataset,COUNT_BIG(*) [Rows],CHECKSUM_AGG(BINARY_CHECKSUM(*)) RowChecksum FROM canonical.CustomerMaster
UNION ALL SELECT N'CustomerAddress',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.CustomerAddress
UNION ALL SELECT N'SalesOrder',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.SalesOrder
UNION ALL SELECT N'SalesOrderLine',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.SalesOrderLine
UNION ALL SELECT N'WorkOrder',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.WorkOrder
UNION ALL SELECT N'Relationship',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.SalesOrderWorkOrderRelationshipEvidence
UNION ALL SELECT N'BillOfMaterial',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.BillOfMaterial
UNION ALL SELECT N'InventoryItem',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.InventoryItem
UNION ALL SELECT N'GeneralLedgerAccount',COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM canonical.GeneralLedgerAccount;
'@
        $reader = $command.ExecuteReader()
        $values = @()
        while ($reader.Read()) {
            $values += [ordered]@{
                Dataset = [string]$reader['Dataset']
                Rows = [long]$reader['Rows']
                RowChecksum = [int]$reader['RowChecksum']
            }
        }
        $reader.Dispose()
        return $values
    }
    finally {
        $connection.Dispose()
    }
}

function Set-SyncRunStatus {
    param([string] $Status)
    $connection = [Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @'
UPDATE platform.DailyOperationsSyncRun
SET Status = @Status
WHERE DailyOperationsSyncRunId = @RunId
  AND ImportRunId = @ImportRunId
  AND Status IN (
      N'PASSED_PROMOTED',
      N'PROMOTED_FINALIZATION_FAILED',
      N'PASSED_PROMOTED_READY');
'@
        [void]$command.Parameters.AddWithValue('@Status', $Status)
        [void]$command.Parameters.AddWithValue('@RunId', $RunId)
        [void]$command.Parameters.AddWithValue(
            '@ImportRunId', ([Guid]$ImportRunId))
        if ($command.ExecuteNonQuery() -ne 1) {
            throw 'The synchronization metadata status was not updated.'
        }
    }
    finally {
        $connection.Dispose()
    }
}

function Get-ProcessOwner {
    param([int] $ProcessId)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
    if ($null -eq $process) { throw "Process $ProcessId is absent." }
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    [pscustomobject]@{
        ProcessId = $ProcessId
        Owner = "$($owner.Domain)\$($owner.User)"
        Name = $process.Name
        ExecutablePath = $process.ExecutablePath
        CommandLine = $process.CommandLine
    }
}

function Get-Ready {
    param([int] $Port)
    $response = Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials `
        -Uri "http://DLE-OS-HOST:$Port/api/platform/live/v1/readiness" `
        -TimeoutSec 30
    $body = $response.Content | ConvertFrom-Json
    if (
        [int]$response.StatusCode -ne 200 -or
        $body.readinessState -cne 'ReadyFresh' -or
        ([Guid]$body.currentImportRunId) -ne ([Guid]$ImportRunId) -or
        $body.mirrorRunId -cne $RunId -or
        $body.packageHash -cne $PackageHash
    ) {
        throw "Port $Port did not become ReadyFresh on the promoted boundary."
    }
    return $body
}

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($currentIdentity -ine $operator) {
    throw "Finalization requires $operator; actual identity is $currentIdentity."
}

if (-not $ElevatedStage) {
    if (Test-Elevated) {
        throw 'Daily Operations finalization must begin under the normal operator token.'
    }
    foreach ($path in @(
        $manifestPath, $promoter, $productionLauncher,
        $developmentLauncher, $configurationPath, $runtimeBoundaryPath,
        $currentBoundaryPath, $productionLaunchEvidence,
        $developmentEvidencePath
    )) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required finalization path is absent: $path"
        }
    }
    if (
        (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash -cne
            $PackageHash
    ) {
        throw 'The supplied package hash does not match the run manifest.'
    }
    $snapshot = Get-SnapshotEvidence
    if (
        ([Guid]$snapshot.ImportRunId) -ne ([Guid]$ImportRunId) -or
        [string]$snapshot.MirrorRunId -cne $RunId -or
        [string]$snapshot.PackageHash -cne $PackageHash -or
        [string]$snapshot.Status -cne 'PASSED_PROMOTED' -or
        [string]$snapshot.SourceChangeStatus -cne 'Qualified' -or
        [string]$snapshot.LastSourceCheckResult -cne
            'DAILY_OPERATIONS_SYNC_QUALIFIED'
    ) {
        throw 'The supplied finalization identity is not the promoted SQL snapshot.'
    }

    New-Item -ItemType Directory -Path $finalizationRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (
        Join-Path $expectedRecoveryRoot 'ProductionConfigBefore') `
        -Force | Out-Null
    Copy-Item -LiteralPath $configurationPath -Destination (
        Join-Path $expectedRecoveryRoot (
            'ProductionConfigBefore\appsettings.Live.json')) -Force
    Copy-Item -LiteralPath $runtimeBoundaryPath -Destination (
        Join-Path $expectedRecoveryRoot (
            'ProductionConfigBefore\live-qualified-boundary.json')) -Force
    Copy-Item -LiteralPath $currentBoundaryPath -Destination (
        Join-Path $expectedRecoveryRoot 'current-qualified-snapshot.json') -Force
    if (Test-Path -LiteralPath $previousBoundaryPath -PathType Leaf) {
        Copy-Item -LiteralPath $previousBoundaryPath -Destination (
            Join-Path $expectedRecoveryRoot 'previous-qualified-snapshot.json') `
            -Force
    }
    Copy-Item -LiteralPath $productionLaunchEvidence -Destination (
        Join-Path $expectedRecoveryRoot '5042-launch-before.json') -Force
    Copy-Item -LiteralPath $developmentEvidencePath -Destination (
        Join-Path $expectedRecoveryRoot '5052-launch-before.json') -Force

    [ordered]@{
        RequestedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        RunId = $RunId
        ImportRunId = ([Guid]$ImportRunId).ToString('D')
        PackageHash = $PackageHash
        ManifestSha256 =
            (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash
        CanonicalSignatures = Get-CanonicalSignatures
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (
        Join-Path $expectedRecoveryRoot 'finalization-request.json') `
        -Encoding UTF8

    $arguments = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-RunId', $RunId,
        '-ImportRunId', $ImportRunId,
        '-PackageHash', $PackageHash,
        '-ElevatedStage',
        '-RecoveryRoot', "`"$expectedRecoveryRoot`"",
        '-EvidencePath', "`"$expectedEvidencePath`""
    )
    $child = Start-Process powershell.exe -ArgumentList $arguments `
        -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if (-not (Test-Path -LiteralPath $expectedEvidencePath -PathType Leaf)) {
        throw 'Elevated finalization returned without evidence.'
    }
    $result = Get-Content -LiteralPath $expectedEvidencePath -Raw |
        ConvertFrom-Json
    $result | ConvertTo-Json -Depth 12
    if ($child.ExitCode -ne 0 -or $result.Verdict -ne 'PASS') {
        exit 1
    }
    exit 0
}

if (
    -not (Test-Elevated) -or
    [string]::IsNullOrWhiteSpace($RecoveryRoot) -or
    [string]::IsNullOrWhiteSpace($EvidencePath) -or
    [IO.Path]::GetFullPath($RecoveryRoot) -ine
        [IO.Path]::GetFullPath($expectedRecoveryRoot) -or
    [IO.Path]::GetFullPath($EvidencePath) -ine
        [IO.Path]::GetFullPath($expectedEvidencePath)
) {
    throw 'The elevated Daily Operations finalization boundary is invalid.'
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    RunId = $RunId
    ImportRunId = ([Guid]$ImportRunId).ToString('D')
    PackageHash = $PackageHash
    SqlPromotionPreserved = $true
    BoundaryPromotion = $false
    ProductionApiReady = $false
    DevelopmentApiReady = $false
    CanonicalFactsUnchanged = $false
    RecoveryRoot = $RecoveryRoot
    FinalStage = 'VALIDATION'
}
$snapshotValidated = $false
$productionStopped = $false
try {
    foreach ($path in @(
        $manifestPath, $promoter, $productionLauncher,
        $developmentLauncher, $configurationPath, $runtimeBoundaryPath,
        $currentBoundaryPath, $productionAssembly, $developmentAssembly,
        $productionLaunchEvidence, $developmentEvidencePath,
        (Join-Path $RecoveryRoot (
            'ProductionConfigBefore\appsettings.Live.json')),
        (Join-Path $RecoveryRoot (
            'ProductionConfigBefore\live-qualified-boundary.json'))
    )) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required elevated finalization path is absent: $path"
        }
    }
    if (
        (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash -cne
            $PackageHash
    ) {
        throw 'The manifest hash changed before elevated finalization.'
    }
    $snapshot = Get-SnapshotEvidence
    if (
        ([Guid]$snapshot.ImportRunId) -ne ([Guid]$ImportRunId) -or
        [string]$snapshot.MirrorRunId -cne $RunId -or
        [string]$snapshot.PackageHash -cne $PackageHash -or
        [string]$snapshot.Status -cne 'PASSED_PROMOTED' -or
        [string]$snapshot.SourceChangeStatus -cne 'Qualified' -or
        [string]$snapshot.LastSourceCheckResult -cne
            'DAILY_OPERATIONS_SYNC_QUALIFIED'
    ) {
        throw 'SQL, manifest, and qualification identity do not agree.'
    }
    $snapshotValidated = $true
    $beforeSignatures = Get-CanonicalSignatures
    $evidence.CanonicalSignaturesBefore = $beforeSignatures

    $productionPid = Get-Listener 5042
    $developmentPid = Get-Listener 5052
    if ($null -eq $productionPid -or $null -eq $developmentPid) {
        throw 'Both 5042 and 5052 must be running before finalization.'
    }
    $productionProcess = Get-ProcessOwner $productionPid
    $developmentProcess = Get-ProcessOwner $developmentPid
    if (
        $productionProcess.Owner -ine $runtimeIdentity -or
        $developmentProcess.Owner -ine $runtimeIdentity
    ) {
        throw 'An API runtime is not owned by the governed Windows identity.'
    }
    $productionBefore =
        Get-Content -LiteralPath $productionLaunchEvidence -Raw |
        ConvertFrom-Json
    $developmentBefore =
        Get-Content -LiteralPath $developmentEvidencePath -Raw |
        ConvertFrom-Json
    if (
        [int]$productionBefore.ProcessId -ne $productionPid -or
        [int]$developmentBefore.ProcessId -ne $developmentPid
    ) {
        throw 'A listener does not match its governed launch evidence.'
    }
    if (
        (Get-FileHash -Algorithm SHA256 -LiteralPath $productionAssembly).Hash `
            -cne $productionAssemblyHash
    ) {
        throw 'The production API assembly is outside its qualified hash.'
    }
    $developmentHash =
        (Get-FileHash -Algorithm SHA256 -LiteralPath $developmentAssembly).Hash
    $evidence.ProcessIdentityBefore = [ordered]@{
        Production = $productionProcess
        Development = $developmentProcess
        ProductionAssemblySha256 = $productionAssemblyHash
        DevelopmentAssemblySha256 = $developmentHash
    }

    $evidence.FinalStage = 'BOUNDARY_PROMOTION'
    Stop-Process -Id $productionPid -Force
    Wait-Stopped 5042
    $productionStopped = $true
    $promotionResult = & $promoter -RunId $RunId -RecoveryRoot $RecoveryRoot |
        Out-String | ConvertFrom-Json
    if (
        $promotionResult.Verdict -ne 'PASS' -or
        ([Guid]$promotionResult.ImportRunId) -ne ([Guid]$ImportRunId) -or
        $promotionResult.MirrorRunId -cne $RunId -or
        $promotionResult.PackageHash -cne $PackageHash
    ) {
        throw 'The governed boundary promoter returned mismatched evidence.'
    }
    $evidence.BoundaryPromotion = $true
    $evidence.BoundaryPromotionEvidence = $promotionResult

    $evidence.FinalStage = 'PRODUCTION_API_RESTART'
    $productionResult = & $productionLauncher |
        Out-String | ConvertFrom-Json
    $productionStopped = $false
    if (
        $productionResult.Verdict -ne 'PASS' -or
        $productionResult.ReadinessVerdict -cne 'Ready' -or
        ([Guid]$productionResult.ImportRunId) -ne ([Guid]$ImportRunId) -or
        $productionResult.PackageHash -cne $PackageHash -or
        $productionResult.AssemblySha256 -cne $productionAssemblyHash
    ) {
        throw 'The governed 5042 restart did not qualify the promoted boundary.'
    }
    $ready5042 = Get-Ready 5042
    $evidence.ProductionApiReady = $true
    $evidence.ProductionApi = [ordered]@{
        Launch = $productionResult
        Readiness = $ready5042
    }

    $evidence.FinalStage = 'DEVELOPMENT_API_RESTART'
    & $developmentLauncher -ElevatedStage -ReloadQualifiedBoundary `
        -EvidencePath $developmentEvidencePath
    $developmentResult =
        Get-Content -LiteralPath $developmentEvidencePath -Raw |
        ConvertFrom-Json
    if (
        $developmentResult.Verdict -ne 'PASS' -or
        -not $developmentResult.ReloadQualifiedBoundary -or
        $developmentResult.AssemblySha256Before -cne $developmentHash -or
        $developmentResult.AssemblySha256After -cne $developmentHash -or
        $developmentResult.Readiness.readinessState -cne 'ReadyFresh' -or
        ([Guid]$developmentResult.Readiness.currentImportRunId) -ne
            ([Guid]$ImportRunId) -or
        $developmentResult.Readiness.mirrorRunId -cne $RunId -or
        $developmentResult.Readiness.packageHash -cne $PackageHash
    ) {
        throw 'The governed 5052 restart did not qualify the promoted boundary.'
    }
    $ready5052 = Get-Ready 5052
    $evidence.DevelopmentApiReady = $true
    $evidence.DevelopmentApi = [ordered]@{
        Launch = $developmentResult
        Readiness = $ready5052
    }

    $evidence.FinalStage = 'FACT_INTEGRITY'
    $afterSignatures = Get-CanonicalSignatures
    $evidence.CanonicalSignaturesAfter = $afterSignatures
    if (
        ($beforeSignatures | ConvertTo-Json -Depth 6 -Compress) -cne
        ($afterSignatures | ConvertTo-Json -Depth 6 -Compress)
    ) {
        throw 'Canonical facts changed during readiness finalization.'
    }
    $evidence.CanonicalFactsUnchanged = $true

    $evidence.FinalStage = 'RUN_STATUS'
    Set-SyncRunStatus 'PASSED_PROMOTED_READY'
    $evidence.SqlRunStatus = 'PASSED_PROMOTED_READY'
    $evidence.FinalStage = 'COMPLETE'
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    $evidence.FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    if ($snapshotValidated) {
        try {
            Set-SyncRunStatus 'PROMOTED_FINALIZATION_FAILED'
            $evidence.SqlRunStatus = 'PROMOTED_FINALIZATION_FAILED'
        }
        catch {
            $evidence.StatusUpdateError = $_.Exception.Message
        }
    }
    if ($productionStopped) {
        try {
            $recoveryLaunch = & $productionLauncher |
                Out-String | ConvertFrom-Json
            $evidence.ProductionRecoveryLaunch = $recoveryLaunch
        }
        catch {
            $evidence.ProductionRecoveryError = $_.Exception.Message
        }
    }
    if ($evidence.BoundaryPromotion -and $null -eq (Get-Listener 5052)) {
        try {
            & $developmentLauncher -ElevatedStage -ReloadQualifiedBoundary `
                -EvidencePath $developmentEvidencePath
            $evidence.DevelopmentRecoveryLaunch =
                Get-Content -LiteralPath $developmentEvidencePath -Raw |
                ConvertFrom-Json
        }
        catch {
            $evidence.DevelopmentRecoveryError = $_.Exception.Message
        }
    }
}
finally {
    $evidence | ConvertTo-Json -Depth 15 |
        Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}
if ($evidence.Verdict -ne 'PASS') {
    throw "Daily Operations finalization failed at $($evidence.FinalStage): $($evidence.Error)"
}
$evidence | ConvertTo-Json -Depth 15

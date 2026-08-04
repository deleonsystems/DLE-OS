[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^DAILYOPSSYNC-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$')]
    [string] $RunId,

    [Parameter(Mandatory)]
    [string] $RecoveryRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    -not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Qualified boundary promotion requires elevated DLE-OS-HOST\DLE-OS.'
}

$runtimeRoot = 'C:\Program Files\DLE-OS\LiveCanonicalApi'
$assemblyPath = Join-Path $runtimeRoot 'DLE-OS-Server.dll'
$configurationPath = Join-Path $runtimeRoot 'appsettings.Live.json'
$runtimeBoundaryPath = Join-Path $runtimeRoot 'live-qualified-boundary.json'
$qualifiedRoot =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\QualifiedBoundary'
$currentBoundaryPath =
    Join-Path $qualifiedRoot 'current-qualified-snapshot.json'
$previousBoundaryPath =
    Join-Path $qualifiedRoot 'previous-qualified-snapshot.json'
$runRoot = Join-Path 'C:\DLE-OS\Canonical\DailyOperationsSync\Runs' $RunId
$manifestPath = Join-Path $runRoot 'manifest.json'
$backupRoot = Join-Path $RecoveryRoot 'ProductionConfigBefore'
$expectedAssemblyHash =
    '4806AFFE55C801A744CA1D412F0AFDFDAEC4DABDD71A4B6B31B58353B58A5043'

foreach ($path in @(
    $assemblyPath,
    $configurationPath,
    $runtimeBoundaryPath,
    $manifestPath,
    (Join-Path $backupRoot 'appsettings.Live.json'),
    (Join-Path $backupRoot 'live-qualified-boundary.json')
)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required recovery boundary file is absent: $path"
    }
}
if (
    (Get-FileHash -LiteralPath $assemblyPath -Algorithm SHA256).Hash -cne
        $expectedAssemblyHash
) {
    throw 'The deployed production API assembly differs from the qualified binary.'
}
if (
    $null -ne (
        Get-NetTCPConnection -State Listen -LocalPort 5042 `
            -ErrorAction SilentlyContinue |
        Select-Object -First 1
    )
) {
    throw 'Port 5042 must remain stopped during qualified boundary promotion.'
}

$manifest =
    Get-Content -LiteralPath $manifestPath -Raw |
    ConvertFrom-Json
if (
    $manifest.Schema -cne 'dle-daily-operations-snapshot' -or
    $manifest.SchemaVersion -cne '1.0' -or
    $manifest.RunId -cne $RunId -or
    @($manifest.HeavyDatasetsRefreshed).Count -ne 0
) {
    throw 'The Daily Operations manifest is outside the qualified boundary.'
}
$manifestHash =
    (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash

$connection = [Data.SqlClient.SqlConnection]::new(
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Daily Operations Boundary Promotion')
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
    metadata.BillOfMaterialCount,
    metadata.InventoryItemCount,
    metadata.WorkOrderCount,
    metadata.GeneralLedgerAccountCount,
    metadata.TotalCount,
    status.SourceChangeStatus,
    status.LastSourceCheckResult,
    sync.CustomerCount,
    sync.SalesOrderLineCount,
    sync.WorkOrderCount AS SyncWorkOrderCount,
    sync.RelationshipCount,
    (SELECT COUNT_BIG(*) FROM canonical.SalesOrderLine) AS ActualSalesOrderLineCount,
    (SELECT COUNT_BIG(*) FROM canonical.SalesOrderWorkOrderRelationshipEvidence)
        AS ActualRelationshipCount,
    (SELECT COUNT_BIG(*) FROM canonical.CustomerMaster) AS ActualCustomerCount,
    (SELECT COUNT_BIG(*) FROM canonical.CustomerAddress) AS ActualAddressCount
FROM liveapi.SnapshotMetadata AS metadata
JOIN liveapi.SnapshotOperationalStatus AS status
  ON status.ImportRunId = metadata.ImportRunId
JOIN platform.DailyOperationsSyncRun AS sync
  ON sync.ImportRunId = metadata.ImportRunId
WHERE sync.DailyOperationsSyncRunId = @RunId
  AND sync.Status IN (
      N'PASSED_PROMOTED',
      N'PROMOTED_FINALIZATION_FAILED');
'@
    [void]$command.Parameters.AddWithValue('@RunId', $RunId)
    $table = [Data.DataTable]::new()
    $table.Load($command.ExecuteReader())
}
finally {
    $connection.Dispose()
}
if ($table.Rows.Count -ne 1) {
    throw 'Exactly one promoted joined snapshot was not found.'
}
$snapshot = $table.Rows[0]
if (
    [string]$snapshot.EnvironmentId -cne 'LIVE' -or
    [string]$snapshot.ContractVersion -cne 'V1.2' -or
    [string]$snapshot.MirrorRunId -cne $RunId -or
    [string]$snapshot.PackageHash -cne $manifestHash -or
    [string]$snapshot.SourceChangeStatus -cne 'Qualified' -or
    [string]$snapshot.LastSourceCheckResult -cne
        'DAILY_OPERATIONS_SYNC_QUALIFIED' -or
    [long]$snapshot.WorkOrderCount -ne [long]$manifest.Counts.WorkOrders -or
    [long]$snapshot.SyncWorkOrderCount -ne [long]$manifest.Counts.WorkOrders -or
    [long]$snapshot.ActualSalesOrderLineCount -ne [long]$manifest.Counts.SalesOrders -or
    [long]$snapshot.ActualRelationshipCount -ne
        [long]$manifest.Counts.WorkOrderRelationships -or
    ([long]$snapshot.ActualCustomerCount + [long]$snapshot.ActualAddressCount) -ne
        [long]$manifest.Counts.CustomerMaster
) {
    throw 'SQL, qualification status, and the promoted manifest do not agree.'
}

$configuration =
    Get-Content -LiteralPath $configurationPath -Raw |
    ConvertFrom-Json
if (
    $configuration.PlatformApi.RuntimeProfile -cne 'LIVE' -or
    $configuration.LiveApi.RequiredWindowsIdentity -cne
        'DLE-OS-HOST\DLE-OS-LIVE-API' -or
    $configuration.LiveApi.Database -cne 'DLE_OS_CANONICAL_LIVE' -or
    $configuration.Kestrel.Endpoints.Http.Url -cne
        'http://DLE-OS-HOST:5042' -or
    $configuration.LiveApi.AllowedBrowserOrigin -cne
        'http://dle-os-host:5041'
) {
    throw 'The production runtime configuration is outside its fixed safety boundary.'
}

$importRunId =
    ([Guid]$snapshot.ImportRunId).ToString('D').ToUpperInvariant()
$configuration.LiveApi.ExpectedImportRunId = $importRunId
$configuration.LiveApi.ExpectedMirrorRunId = [string]$snapshot.MirrorRunId
$configuration.LiveApi.ExpectedPackageHash = [string]$snapshot.PackageHash
$configuration.LiveApi.ExpectedBillOfMaterialCount =
    [long]$snapshot.BillOfMaterialCount
$configuration.LiveApi.ExpectedInventoryItemCount =
    [long]$snapshot.InventoryItemCount
$configuration.LiveApi.ExpectedWorkOrderCount = [long]$snapshot.WorkOrderCount
$configuration.LiveApi.ExpectedGeneralLedgerAccountCount =
    [long]$snapshot.GeneralLedgerAccountCount

$boundary = [ordered]@{
    LiveQualifiedBoundary = [ordered]@{
        RequiredWindowsIdentity = [string]$configuration.LiveApi.RequiredWindowsIdentity
        DataEnvironment = [string]$configuration.LiveApi.DataEnvironment
        Database = [string]$configuration.LiveApi.Database
        ContractVersion = [string]$configuration.LiveApi.ContractVersion
        StoredContractVersion = [string]$configuration.LiveApi.StoredContractVersion
        ExpectedImportRunId = $importRunId
        ExpectedMirrorRunId = [string]$snapshot.MirrorRunId
        ExpectedPackageHash = [string]$snapshot.PackageHash
        ExpectedBillOfMaterialCount = [long]$snapshot.BillOfMaterialCount
        ExpectedInventoryItemCount = [long]$snapshot.InventoryItemCount
        ExpectedWorkOrderCount = [long]$snapshot.WorkOrderCount
        ExpectedGeneralLedgerAccountCount =
            [long]$snapshot.GeneralLedgerAccountCount
        FreshnessThresholdMinutes =
            [int]$configuration.LiveApi.FreshnessThresholdMinutes
        WorkOrderNumberWidth = [int]$configuration.LiveApi.WorkOrderNumberWidth
        AllowedBrowserOrigin = [string]$configuration.LiveApi.AllowedBrowserOrigin
        StartupEvidencePath = [string]$configuration.LiveApi.StartupEvidencePath
        SnapshotWarningMinutes = [int]$configuration.LiveApi.SnapshotWarningMinutes
        SourceCheckWarningMinutes =
            [int]$configuration.LiveApi.SourceCheckWarningMinutes
        SourceCheckHardExpirationMinutes =
            [int]$configuration.LiveApi.SourceCheckHardExpirationMinutes
        QualificationWarningMinutes =
            [int]$configuration.LiveApi.QualificationWarningMinutes
    }
}

function Replace-JsonFile {
    param([string] $Path, [string] $Json)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $stage = Join-Path $directory ('.' + [IO.Path]::GetFileName($Path) + '.' +
        [Guid]::NewGuid().ToString('N') + '.staging')
    [IO.File]::WriteAllText(
        $stage,
        $Json + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
    try {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $replaceBackup = $stage + '.replace-backup'
            [IO.File]::Replace($stage, $Path, $replaceBackup, $true)
            Remove-Item -LiteralPath $replaceBackup -Force
        }
        else {
            Move-Item -LiteralPath $stage -Destination $Path
        }
    }
    finally {
        Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue
    }
}

$configurationJson = $configuration | ConvertTo-Json -Depth 12
$boundaryJson = $boundary | ConvertTo-Json -Depth 8
if (Test-Path -LiteralPath $currentBoundaryPath -PathType Leaf) {
    Copy-Item -LiteralPath $currentBoundaryPath `
        -Destination $previousBoundaryPath -Force
}
Replace-JsonFile -Path $configurationPath -Json $configurationJson
Replace-JsonFile -Path $runtimeBoundaryPath -Json $boundaryJson
Replace-JsonFile -Path $currentBoundaryPath -Json $boundaryJson

if (
    (Get-FileHash -LiteralPath $assemblyPath -Algorithm SHA256).Hash -cne
        $expectedAssemblyHash
) {
    throw 'The production API assembly changed during boundary promotion.'
}

[pscustomobject]@{
    Verdict = 'PASS'
    ImportRunId = $importRunId
    MirrorRunId = [string]$snapshot.MirrorRunId
    PackageHash = [string]$snapshot.PackageHash
    WorkOrderCount = [long]$snapshot.WorkOrderCount
    SalesOrderLineCount = [long]$snapshot.ActualSalesOrderLineCount
    RelationshipCount = [long]$snapshot.ActualRelationshipCount
    AssemblySha256 = $expectedAssemblyHash
    ConfigurationSha256 =
        (Get-FileHash -LiteralPath $configurationPath -Algorithm SHA256).Hash
    BoundarySha256 =
        (Get-FileHash -LiteralPath $runtimeBoundaryPath -Algorithm SHA256).Hash
} | ConvertTo-Json -Depth 5

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$qualifiedRoot =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\QualifiedBoundary'
$currentPath = Join-Path $qualifiedRoot 'current-qualified-snapshot.json'
$previousPath = Join-Path $qualifiedRoot 'previous-qualified-snapshot.json'
$livePackage = 'C:\DLE-OS\Canonical\LiveMirror\Current'
$manifestPath = Join-Path $livePackage 'manifest.json'
$connectionString =
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Connect Timeout=5;Application Name=DLE-OS Manual Snapshot Boundary'

if (
    [Security.Principal.WindowsIdentity]::GetCurrent().Name -ine
        'DLE-OS-HOST\DLE-OS'
) {
    throw 'Qualified snapshot promotion requires DLE-OS-HOST\DLE-OS.'
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The fixed live canonical package manifest is absent.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (
    $manifest.manifest_schema -ne 'dle-canonical-live-mirror-run' -or
    $manifest.package_state -ne 'COMMITTED' -or
    $manifest.run_outcome -ne 'SUCCESS' -or
    $manifest.contract_version -notin @('V1.1', 'V1.2') -or
    [string]$manifest.package_hash -notmatch '^[0-9A-F]{64}$'
) {
    throw 'The fixed live canonical package is not a committed qualified package.'
}

$connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandText = @'
SELECT ImportRunId, EnvironmentId, MirrorRunId, PackageHash, ContractVersion,
       BillOfMaterialCount, InventoryItemCount, WorkOrderCount,
       GeneralLedgerAccountCount, TotalCount
FROM liveapi.SnapshotMetadata;
'@
    $table = [System.Data.DataTable]::new()
    $table.Load($command.ExecuteReader())
}
finally {
    $connection.Dispose()
}
if ($table.Rows.Count -ne 1) {
    throw 'LIVE snapshot metadata did not return exactly one committed row.'
}
$snapshot = $table.Rows[0]
$sum =
    [long]$snapshot.BillOfMaterialCount +
    [long]$snapshot.InventoryItemCount +
    [long]$snapshot.WorkOrderCount +
    [long]$snapshot.GeneralLedgerAccountCount
if (
    [string]$snapshot.EnvironmentId -ne 'LIVE' -or
    [string]$snapshot.ContractVersion -ne 'V1.2' -or
    [string]$snapshot.MirrorRunId -cne [string]$manifest.run_id -or
    [string]$snapshot.PackageHash -cne [string]$manifest.package_hash -or
    [long]$snapshot.TotalCount -ne $sum -or
    [long]$manifest.entity_counts.BillOfMaterial -ne
        [long]$snapshot.BillOfMaterialCount -or
    [long]$manifest.entity_counts.InventoryItem -ne
        [long]$snapshot.InventoryItemCount -or
    [long]$manifest.entity_counts.WorkOrder -ne
        [long]$snapshot.WorkOrderCount -or
    [long]$manifest.entity_counts.GeneralLedgerAccount -ne
        [long]$snapshot.GeneralLedgerAccountCount
) {
    throw 'SQL metadata does not match the promoted, hashed canonical package.'
}

$boundary = [ordered]@{
    LiveQualifiedBoundary = [ordered]@{
        RequiredWindowsIdentity = 'DLE-OS-HOST\DLE-OS-LIVE-API'
        DataEnvironment = 'LIVE'
        Database = 'DLE_OS_CANONICAL_LIVE'
        ContractVersion = '1.2'
        StoredContractVersion = 'V1.2'
        ExpectedImportRunId =
            ([Guid]$snapshot.ImportRunId).ToString('D').ToUpperInvariant()
        ExpectedMirrorRunId = [string]$snapshot.MirrorRunId
        ExpectedPackageHash = [string]$snapshot.PackageHash
        ExpectedBillOfMaterialCount =
            [long]$snapshot.BillOfMaterialCount
        ExpectedInventoryItemCount =
            [long]$snapshot.InventoryItemCount
        ExpectedWorkOrderCount = [long]$snapshot.WorkOrderCount
        ExpectedGeneralLedgerAccountCount =
            [long]$snapshot.GeneralLedgerAccountCount
        FreshnessThresholdMinutes = 1440
        WorkOrderNumberWidth = 7
        AllowedBrowserOrigin = 'http://dle-os-host:5041'
        StartupEvidencePath =
            'C:\ProgramData\DLE-OS\LiveCanonicalApi\Logs\LIVE-API-001-startup-evidence.json'
    }
}

New-Item -ItemType Directory -Path $qualifiedRoot -Force | Out-Null
$stagePath =
    Join-Path $qualifiedRoot (
        '.current-qualified-snapshot.' +
        [Guid]::NewGuid().ToString('N') +
        '.staging'
    )
$backupPath =
    Join-Path $qualifiedRoot (
        '.previous-qualified-snapshot.' +
        [Guid]::NewGuid().ToString('N') +
        '.backup'
    )
$json = $boundary | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText(
    $stagePath,
    $json + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))
try {
    $roundTrip =
        Get-Content -LiteralPath $stagePath -Raw |
        ConvertFrom-Json
    if (
        [string]$roundTrip.LiveQualifiedBoundary.ExpectedImportRunId -cne
            ([Guid]$snapshot.ImportRunId).ToString('D').ToUpperInvariant()
    ) {
        throw 'Staged qualified-boundary verification failed.'
    }
    if (Test-Path -LiteralPath $currentPath -PathType Leaf) {
        [IO.File]::Replace($stagePath, $currentPath, $backupPath, $true)
        Move-Item -LiteralPath $backupPath -Destination $previousPath -Force
    }
    else {
        Move-Item -LiteralPath $stagePath -Destination $currentPath
    }
}
finally {
    Remove-Item -LiteralPath $stagePath -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
    Verdict = 'PASS'
    CurrentBoundary = $currentPath
    PreviousBoundary = $previousPath
    ImportRunId = ([Guid]$snapshot.ImportRunId).ToString('D')
    MirrorRunId = [string]$snapshot.MirrorRunId
    PackageHash = [string]$snapshot.PackageHash
    TotalCount = [long]$snapshot.TotalCount
} | ConvertTo-Json -Depth 5

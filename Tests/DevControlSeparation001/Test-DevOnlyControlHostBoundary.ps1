[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$project = Join-Path $repository `
    'Tools\DevelopmentRuntime\DleOs.DevOperationalControlHost\DleOs.DevOperationalControlHost.csproj'
$output = Join-Path $repository `
    'Tools\DevelopmentRuntime\DleOs.DevOperationalControlHost\bin\Debug\net8.0-windows\DleOs.DevOperationalControlHost.dll'

& dotnet build $project --no-restore
if ($LASTEXITCODE -ne 0) { throw 'The DEV-only ControlHost build failed.' }

$projectText = Get-Content -Raw -LiteralPath $project
$forbiddenSources = @(
    'PlatformRefreshCenter.cs',
    'OperationsRefreshCenter.cs',
    'DailyOperationsSyncCenter.cs',
    'SyncOperationsCenter.cs',
    'OpenSalesOrderShadowQualificationCenter.cs',
    'LegacyKittingMaterialStatusCenter.cs',
    'KittingCaseSchema.cs'
)
foreach ($source in $forbiddenSources) {
    if ($projectText.IndexOf($source, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Production-control source is compiled by the DEV project: $source"
    }
}
$forbiddenProjectTokens = @(
    'KittingCaseMigration.sql',
    'KittingCaseRunMigration.sql',
    '001_AddKittingCase.sql',
    '002_AddKittingCaseRuns.sql'
)
foreach ($token in $forbiddenProjectTokens) {
    if ($projectText.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Runtime migration content is present in the DEV project: $token"
    }
}
foreach ($token in 'DevOperationalSchema.cs','Start-DevOperationalControlHost5054.ps1') {
    if ($projectText.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Required release-boundary source is absent from the DEV project: $token"
    }
}

$bytes = [IO.File]::ReadAllBytes($output)
$assemblyText = [Text.Encoding]::UTF8.GetString($bytes) +
    [Text.Encoding]::Unicode.GetString($bytes) +
    $(if($bytes.Length -gt 1){[Text.Encoding]::Unicode.GetString($bytes,1,$bytes.Length-1)}else{''})
$forbiddenTokens = @(
    'DLE_OS_CANONICAL_LIVE',
    'deleon-server\Production',
    'Start-LiveSnapshotRefresh',
    'Start-InvoiceHistoryRefresh',
    'Start-OperationsRefresh',
    'Invoke-SyncOperations',
    'powershell.exe',
    'explorer.exe',
    'dle-os-host:5041',
    'DLE-OS-HOST:5042',
    'dle-os-host:5043',
    '/api/sync/operations',
    '/api/platform/refresh',
    'FROM canonical.SalesOrderLine',
    'C:\DLE-OS\Canonical'
)
foreach ($token in $forbiddenTokens) {
    if ($assemblyText.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Forbidden production-control token is present in the DEV assembly: $token"
    }
}

$requiredTokens = @(
    'DLE_OS_OPERATIONAL_DEV',
    'DLE_OS_SECURITY_DEV',
    'DLE-OS-HOST:5052',
    'DEV_OPERATIONAL_ONLY',
    'DevelopmentOperationalControl\Data'
)
foreach ($token in $requiredTokens) {
    if ($assemblyText.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Required DEV boundary token is absent from the DEV assembly: $token"
    }
}

[pscustomobject]@{
    Verdict = 'PASS'
    Project = $project
    Assembly = $output
    ForbiddenSourcesAbsent = $forbiddenSources.Count
    ForbiddenTokensAbsent = $forbiddenTokens.Count + $forbiddenProjectTokens.Count
    RequiredTokensPresent = $requiredTokens.Count
}

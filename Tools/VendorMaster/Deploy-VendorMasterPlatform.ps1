[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$server = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$overlay = Join-Path $repository 'Tools\VendorMaster\ServerOverlay'
$files = [ordered]@{
    'Contracts\Platform\VendorMasterDtos.cs' =
        'Contracts\Platform\VendorMasterDtos.cs'
    'Data\Platform\VendorMasterRepository.cs' =
        'Data\Platform\VendorMasterRepository.cs'
    'Controllers\Platform\LiveVendorMasterController.cs' =
        'Controllers\Platform\LiveVendorMasterController.cs'
}

foreach ($relative in $files.Keys) {
    $source = Join-Path $overlay $relative
    $destination = Join-Path $server $files[$relative]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required Vendor Master overlay is missing: $source"
    }
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $destinationHash = (
        Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($sourceHash -cne $destinationHash) {
        throw "Deployed source hash mismatch: $relative"
    }
}

$schemaSource = Join-Path $repository (
    'Tools\VendorMaster\Database\030_AddVendorMasterPlatform.sql')
$schemaDestination = Join-Path $server (
    'Database\Scripts\030_AddVendorMasterPlatform.sql')
Copy-Item -LiteralPath $schemaSource -Destination $schemaDestination -Force
if (
    (Get-FileHash -LiteralPath $schemaSource -Algorithm SHA256).Hash -cne
    (Get-FileHash -LiteralPath $schemaDestination -Algorithm SHA256).Hash
) {
    throw 'Deployed Vendor Master schema hash mismatch.'
}

dotnet build (Join-Path $server 'DLE-OS-Server.csproj') `
    --configuration Release `
    --nologo
if ($LASTEXITCODE -ne 0) {
    throw "Vendor Master API build failed with $LASTEXITCODE."
}

[ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ServerRepository = $server
    Files = @($files.Values) + @(
        'Database\Scripts\030_AddVendorMasterPlatform.sql')
} | ConvertTo-Json -Depth 5

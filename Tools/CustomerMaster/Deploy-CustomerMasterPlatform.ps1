[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$server = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$overlay = Join-Path $repository 'Tools\CustomerMaster\ServerOverlay'
$files = [ordered]@{
    'Contracts\Platform\CustomerMasterDtos.cs' =
        'Contracts\Platform\CustomerMasterDtos.cs'
    'Data\Platform\CustomerMasterRepository.cs' =
        'Data\Platform\CustomerMasterRepository.cs'
    'Controllers\Platform\LiveCustomerMasterController.cs' =
        'Controllers\Platform\LiveCustomerMasterController.cs'
}

foreach ($relative in $files.Keys) {
    $source = Join-Path $overlay $relative
    $destination = Join-Path $server $files[$relative]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required Customer Master overlay is missing: $source"
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
    'Tools\CustomerMaster\Database\020_AddCustomerMasterPlatform.sql')
$schemaDestination = Join-Path $server (
    'Database\Scripts\020_AddCustomerMasterPlatform.sql')
Copy-Item -LiteralPath $schemaSource -Destination $schemaDestination -Force
if (
    (Get-FileHash -LiteralPath $schemaSource -Algorithm SHA256).Hash -cne
    (Get-FileHash -LiteralPath $schemaDestination -Algorithm SHA256).Hash
) {
    throw 'Deployed Customer Master schema hash mismatch.'
}

dotnet build (Join-Path $server 'DLE-OS-Server.csproj') `
    --configuration Release `
    --nologo
if ($LASTEXITCODE -ne 0) {
    throw "Customer Master API build failed with $LASTEXITCODE."
}

[ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ServerRepository = $server
    Files = @($files.Values) + @(
        'Database\Scripts\020_AddCustomerMasterPlatform.sql')
} | ConvertTo-Json -Depth 5

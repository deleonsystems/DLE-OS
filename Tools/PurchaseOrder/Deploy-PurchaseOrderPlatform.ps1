[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$server = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$overlay = Join-Path $repository 'Tools\PurchaseOrder\ServerOverlay'
$files = [ordered]@{
    'Contracts\Platform\PurchaseOrderDtos.cs' =
        'Contracts\Platform\PurchaseOrderDtos.cs'
    'Data\Platform\PurchaseOrderRepository.cs' =
        'Data\Platform\PurchaseOrderRepository.cs'
    'Controllers\Platform\LivePurchaseOrdersController.cs' =
        'Controllers\Platform\LivePurchaseOrdersController.cs'
    'Hosting\FrontendApplicationExtensions.cs' =
        'Hosting\FrontendApplicationExtensions.cs'
}

foreach ($relative in $files.Keys) {
    $source = Join-Path $overlay $relative
    $destination = Join-Path $server $files[$relative]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required Purchase Order overlay is missing: $source"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) `
        -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if (
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    ) {
        throw "Deployed source hash mismatch: $relative"
    }
}

$schemaSource = Join-Path $repository (
    'Tools\PurchaseOrder\Database\031_AddPurchaseOrderPlatform.sql')
$schemaDestination = Join-Path $server (
    'Database\Scripts\031_AddPurchaseOrderPlatform.sql')
Copy-Item -LiteralPath $schemaSource -Destination $schemaDestination -Force
if (
    (Get-FileHash -LiteralPath $schemaSource -Algorithm SHA256).Hash -cne
    (Get-FileHash -LiteralPath $schemaDestination -Algorithm SHA256).Hash
) {
    throw 'Deployed Purchase Order schema hash mismatch.'
}

dotnet build (Join-Path $server 'DLE-OS-Server.csproj') `
    --configuration Release `
    --nologo
if ($LASTEXITCODE -ne 0) {
    throw "Purchase Order API build failed with $LASTEXITCODE."
}

[ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ServerRepository = $server
    Files = @($files.Values) + @(
        'Database\Scripts\031_AddPurchaseOrderPlatform.sql')
} | ConvertTo-Json -Depth 5

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$server = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$overlay = Join-Path $repository 'Tools\SupportingCodeTables\ServerOverlay'
$files = [ordered]@{
    'Contracts\Platform\ReferenceCodeDtos.cs' =
        'Contracts\Platform\ReferenceCodeDtos.cs'
    'Data\Platform\ReferenceCodeRepository.cs' =
        'Data\Platform\ReferenceCodeRepository.cs'
    'Controllers\Platform\LiveReferenceCodeController.cs' =
        'Controllers\Platform\LiveReferenceCodeController.cs'
}
foreach ($relative in $files.Keys) {
    $source = Join-Path $overlay $relative
    $destination = Join-Path $server $files[$relative]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required Reference Code overlay is missing: $source"
    }
    New-Item -ItemType Directory -Path (
        Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if (
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    ) {
        throw "Deployed Reference Code source hash mismatch: $relative"
    }
}
$enrichmentFiles = [ordered]@{
    'Tools\PurchaseOrder\ServerOverlay\Contracts\Platform\PurchaseOrderDtos.cs' =
        'Contracts\Platform\PurchaseOrderDtos.cs'
    'Tools\PurchaseOrder\ServerOverlay\Data\Platform\PurchaseOrderRepository.cs' =
        'Data\Platform\PurchaseOrderRepository.cs'
}
foreach ($sourceRelative in $enrichmentFiles.Keys) {
    $source = Join-Path $repository $sourceRelative
    $destination = Join-Path $server $enrichmentFiles[$sourceRelative]
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if (
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    ) {
        throw "Deployed enrichment source hash mismatch: $sourceRelative"
    }
}
$schemaSource = Join-Path $repository (
    'Tools\SupportingCodeTables\Database\034_AddSupportingCodeTablesPlatform.sql')
$schemaDestination = Join-Path $server (
    'Database\Scripts\034_AddSupportingCodeTablesPlatform.sql')
Copy-Item -LiteralPath $schemaSource -Destination $schemaDestination -Force

$buildOutput = Join-Path $repository (
    'Artifacts\SupportingCodeTablesPlatform001\' +
    'SUPPORTINGCODETABLESPLATFORM001-20260730T133739Z\' +
    'ServerBuildQualification-Final')
if (Test-Path -LiteralPath $buildOutput) {
    throw "Fresh build output already exists: $buildOutput"
}
New-Item -ItemType Directory -Path $buildOutput -Force | Out-Null
dotnet build (Join-Path $server 'DLE-OS-Server.csproj') `
    --configuration Release `
    --output $buildOutput `
    --nologo
if ($LASTEXITCODE -ne 0) {
    throw "Reference Code API build failed with $LASTEXITCODE."
}
[ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ServerRepository = $server
    BuildOutput = $buildOutput
    Files = @($files.Values) + @($enrichmentFiles.Values) + @(
        'Database\Scripts\034_AddSupportingCodeTablesPlatform.sql')
} | ConvertTo-Json -Depth 5

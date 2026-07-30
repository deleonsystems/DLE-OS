[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$server = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$overlay = Join-Path $repository 'Tools\EmployeeReference\ServerOverlay'
$files = [ordered]@{
    'Contracts\Platform\EmployeeReferenceDtos.cs' =
        'Contracts\Platform\EmployeeReferenceDtos.cs'
    'Data\Platform\EmployeeReferenceRepository.cs' =
        'Data\Platform\EmployeeReferenceRepository.cs'
    'Controllers\Platform\LiveEmployeeReferenceController.cs' =
        'Controllers\Platform\LiveEmployeeReferenceController.cs'
}

foreach ($relative in $files.Keys) {
    $source = Join-Path $overlay $relative
    $destination = Join-Path $server $files[$relative]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required Employee Reference overlay is missing: $source"
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
    'Tools\EmployeeReference\Database\033_AddEmployeeReferencePlatform.sql')
$schemaDestination = Join-Path $server (
    'Database\Scripts\033_AddEmployeeReferencePlatform.sql')
Copy-Item -LiteralPath $schemaSource -Destination $schemaDestination -Force
if (
    (Get-FileHash -LiteralPath $schemaSource -Algorithm SHA256).Hash -cne
    (Get-FileHash -LiteralPath $schemaDestination -Algorithm SHA256).Hash
) {
    throw 'Deployed Employee Reference schema hash mismatch.'
}

$buildOutput = Join-Path $repository (
    'Artifacts\EmployeeReferencePlatform001\' +
    'EMPLOYEEREFERENCEPLATFORM001-20260730T122647Z\' +
    'ServerBuildQualification')
if (Test-Path -LiteralPath $buildOutput) {
    throw "Fresh build output already exists: $buildOutput"
}
New-Item -ItemType Directory -Path $buildOutput -Force | Out-Null
dotnet build (Join-Path $server 'DLE-OS-Server.csproj') `
    --configuration Release `
    --output $buildOutput `
    --nologo
if ($LASTEXITCODE -ne 0) {
    throw "Employee Reference API build failed with $LASTEXITCODE."
}

[ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ServerRepository = $server
    BuildOutput = $buildOutput
    Files = @($files.Values) + @(
        'Database\Scripts\033_AddEmployeeReferencePlatform.sql')
} | ConvertTo-Json -Depth 5

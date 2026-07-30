[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$serverRoot = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$assembly = Join-Path $serverRoot 'bin\Release\net8.0\DLE-OS-Server.dll'
$dotnet = 'C:\Program Files\dotnet\dotnet.exe'
$logRoot =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\LiveViewer001\HistoricalRuntime'
$logPath = Join-Path $logRoot 'historical-api.log'

if (-not (Test-Path -LiteralPath $assembly -PathType Leaf)) {
    throw 'The qualified historical API assembly is absent.'
}
if (-not (Test-Path -LiteralPath $dotnet -PathType Leaf)) {
    throw 'The fixed .NET runtime is absent.'
}
if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
}

Set-Location -LiteralPath $serverRoot
& $dotnet $assembly *> $logPath
exit $LASTEXITCODE

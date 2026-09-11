[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$profilePath = Join-Path $env:LOCALAPPDATA 'DLE-OS\SIM\sim-profile.json'
$profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
& (Join-Path $profile.repoPath 'Tools\SimRuntime\Stop-DleOsSim.ps1') -ProfilePath $profilePath

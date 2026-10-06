[CmdletBinding()]
param([string] $SimHome = (Join-Path $env:USERPROFILE '.dle-os\SIM'))
$ErrorActionPreference = 'Stop'
$profilePath = Join-Path $SimHome 'sim-profile.json'
$profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
& (Join-Path $profile.repoPath 'Tools\SimRuntime\Stop-DleOsSim.ps1') -ProfilePath $profilePath

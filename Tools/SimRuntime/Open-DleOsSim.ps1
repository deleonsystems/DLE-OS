[CmdletBinding()]
param([string] $ProfilePath)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Developer\SimDeveloperTools.psm1') -Force
$profile = Get-DleOsSimProfile $ProfilePath
Start-Process $profile.url

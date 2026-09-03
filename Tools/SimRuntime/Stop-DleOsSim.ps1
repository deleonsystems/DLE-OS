[CmdletBinding()]
param(
    [string] $ProfilePath,
    [switch] $Json
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Developer\SimDeveloperTools.psm1') -Force
$result = Stop-DleOsSimSafely $ProfilePath
if ($Json) { $result | ConvertTo-Json -Depth 6 } else { $result | Format-List }

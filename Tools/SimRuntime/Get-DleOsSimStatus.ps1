[CmdletBinding()]
param(
    [string] $ProfilePath,
    [switch] $Json
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Developer\SimDeveloperTools.psm1') -Force
$status = Get-DleOsSimStatus $ProfilePath
if ($Json) {
    $status | ConvertTo-Json -Depth 12
    return
}
$status | Format-List

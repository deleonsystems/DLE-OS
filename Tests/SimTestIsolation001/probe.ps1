[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../Tools/SimRuntime/Invoke-DleOsSimTestIsolation.ps1')
if (Invoke-DleOsSimTestIsolation -ScriptPath $PSCommandPath -Parameters $PSBoundParameters) { return }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$state = Join-Path $root '.sim-state'
if (Test-Path -LiteralPath $state) { throw 'Probe inherited developer state.' }
New-Item -ItemType Directory -Path (Join-Path $state 'data') -Force | Out-Null
$sentinel = Join-Path $state 'data/probe.json'
Set-Content -LiteralPath $sentinel -Value '{"isolated":true}'
Remove-Item -LiteralPath $sentinel
Write-Host 'PASS: disposable probe writes/deletes only its own fresh state.'

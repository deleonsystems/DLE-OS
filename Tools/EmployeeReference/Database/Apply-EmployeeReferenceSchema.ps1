[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '033_AddEmployeeReferencePlatform.sql'
$sqlcmd = Get-Command sqlcmd.exe -ErrorAction Stop
& $sqlcmd.Source -S 'lpc:.\SQLEXPRESS' -E -b -i $script
if ($LASTEXITCODE -ne 0) {
    throw "Employee Reference schema application failed with $LASTEXITCODE."
}

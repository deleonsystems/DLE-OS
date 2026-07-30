[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '034_AddSupportingCodeTablesPlatform.sql'
& sqlcmd.exe -S 'lpc:.\SQLEXPRESS' -E -d 'DLE_OS_CANONICAL_LIVE' `
    -b -i $script
if ($LASTEXITCODE -ne 0) {
    throw "Supporting Code Tables schema application failed with $LASTEXITCODE."
}

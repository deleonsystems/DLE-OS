[CmdletBinding()]
param([ValidateSet('Probe','Quick','Full')][string] $Mode = 'Probe')
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $repo 'Tools/SimRuntime/Invoke-DleOsSimTestIsolation.ps1')
$before = Get-DleOsSimTestStateFingerprint $repo
$previous = $env:DLE_OS_SIM_TEST_REPOSITORY
try {
    $env:DLE_OS_SIM_TEST_REPOSITORY = $repo
    $failure = & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'probe.ps1') 2>&1
    if ($LASTEXITCODE -eq 0 -or "$failure" -notmatch 'isolation marker missing|not an isolated repository') { throw 'Unsafe active-root test invocation was not rejected.' }
} finally { $env:DLE_OS_SIM_TEST_REPOSITORY = $previous }
Write-Host 'PASS: active-root override fails closed before test execution.'
if ($Mode -eq 'Probe') {
    & (Join-Path $PSScriptRoot 'probe.ps1')
} else {
    if (-not (Test-Path (Join-Path $repo '.sim-state/data/rfq-intakes.json'))) { throw 'Dataset required for preservation regression.' }
    & (Join-Path $repo 'Tools/SimRuntime/Test-DleOsSim.ps1') -Mode $Mode
}
if ((Get-DleOsSimTestStateFingerprint $repo) -cne $before) { throw 'Developer dataset/uploads/generation/runtime changed.' }
Write-Host "PASS: $Mode left all active developer state files and hashes unchanged."

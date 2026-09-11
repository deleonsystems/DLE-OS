[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot)
$launcher = Join-Path $repo 'Tools\SimRuntime\DesktopControls\Start-DleOsSimServer.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('sim-launcher-test-' + [guid]::NewGuid())
New-Item -ItemType Directory $root | Out-Null
# Substitute only the Desktop popup; all profile/import/error handling runs unchanged.
$runner = Join-Path $root 'run.ps1'
@'
param($Launcher, $Fixture)
$env:LOCALAPPDATA = $Fixture
function New-Object {
    param($ComObject)
    if ($ComObject -ne 'WScript.Shell') { throw 'Unexpected COM object' }
    $shell = [pscustomobject]@{}
    $shell | Add-Member ScriptMethod Popup {
        param($Message, $Timeout, $Title, $Icon)
        Set-Content (Join-Path $env:LOCALAPPDATA 'popup.txt') $Message
        return 1
    }
    return $shell
}
& $Launcher
exit $LASTEXITCODE
'@ | Set-Content $runner
foreach ($case in 'malformed-profile','missing-module') {
    $fixture = Join-Path $root $case
    $sim = Join-Path $fixture 'DLE-OS\SIM'
    New-Item -ItemType Directory $sim -Force | Out-Null
    if ($case -eq 'malformed-profile') {
        '{broken' | Set-Content (Join-Path $sim 'sim-profile.json')
        $expectedStage = 'read-profile'
    } else {
        @{ repoPath = $fixture } | ConvertTo-Json | Set-Content (Join-Path $sim 'sim-profile.json')
        $expectedStage = 'import-developer-tools'
    }
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File $runner $launcher $fixture
    if ($LASTEXITCODE -ne 1) { throw "$case did not fail with exit code 1" }
    $status = Get-Content (Join-Path $sim 'start-status.json') -Raw | ConvertFrom-Json
    if ($status.result -ne 'failed' -or $status.stage -ne $expectedStage -or -not $status.errorId) {
        throw "$case did not record a useful early failure"
    }
    if (-not (Test-Path (Join-Path $fixture 'popup.txt'))) { throw "$case failed silently" }
    Write-Output "PASS: $case records failure and displays Desktop notification"
}

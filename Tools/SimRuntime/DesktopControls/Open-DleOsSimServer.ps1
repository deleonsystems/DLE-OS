[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$profilePath = Join-Path $env:LOCALAPPDATA 'DLE-OS\SIM\sim-profile.json'
$openStatusPath = Join-Path (Split-Path -Parent $profilePath) 'open-status.json'
$stage = 'read-profile'
trap {
    try {
        @{ result = 'failed'; stage = $stage; errorId = $_.FullyQualifiedErrorId; timestampUtc = [DateTimeOffset]::UtcNow.ToString('O') } |
            ConvertTo-Json | Set-Content -LiteralPath $openStatusPath -Encoding UTF8
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup("Open SIM failed during $stage. Details: $openStatusPath", 0, 'DLE-OS SIM', 16)
    } catch {}
    exit 1
}
@{ result = 'opening'; timestampUtc = [DateTimeOffset]::UtcNow.ToString('O') } |
    ConvertTo-Json | Set-Content -LiteralPath $openStatusPath -Encoding UTF8
$profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
# The start control probes the live authenticated HTTPS endpoint. Old runtime
# metadata alone is never proof that the server is still running.
$pwsh = Join-Path $PSHOME 'pwsh.exe'
$stage = 'verify-server'
& $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'Start-DleOsSimServer.ps1')
if ($LASTEXITCODE -ne 0) { throw 'SIM could not start. See the SIM start-status.json and launcher logs.' }
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
$stage = 'open-browser'
# The desktop launcher is hidden; the browser is an explicitly requested visible UI.
# A new window also avoids reusing a minimized window or disturbing an open form.
if (Test-Path -LiteralPath $edge) { Start-Process -FilePath $edge -ArgumentList @('--new-window', $profile.url) -WindowStyle Normal }
else { Start-Process $profile.url -WindowStyle Normal }
@{ result = 'browser-launch-requested'; url = $profile.url; timestampUtc = [DateTimeOffset]::UtcNow.ToString('O') } |
    ConvertTo-Json | Set-Content -LiteralPath $openStatusPath -Encoding UTF8

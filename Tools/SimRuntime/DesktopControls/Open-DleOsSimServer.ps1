[CmdletBinding()]
param([switch] $NoPopup, [string] $SimHome = (Join-Path $env:USERPROFILE '.dle-os\SIM'))
$ErrorActionPreference = 'Stop'
$base = $SimHome
$attempt = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + "-$PID"
$stage = 'read-profile'
$exitCode = 0
function Write-OpenStatus([hashtable] $Status) {
    $Status.stage=$stage
    $Status.timestampUtc=[DateTimeOffset]::UtcNow.ToString('O')
    $Status.attempt=$attempt
    $Status.processId=$PID
    $json=$Status | ConvertTo-Json -Depth 5
    $json | Set-Content -LiteralPath (Join-Path $base "Logs\open-$attempt.json") -Encoding UTF8
    $json | Set-Content -LiteralPath (Join-Path $base 'open-status.json') -Encoding UTF8
}
try {
    New-Item -ItemType Directory -Path (Join-Path $base 'Logs') -Force | Out-Null
    Write-OpenStatus @{result='opening'}
    $profile=Get-Content -LiteralPath (Join-Path $base 'sim-profile.json') -Raw | ConvertFrom-Json
    $stage='verify-server'
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Start-DleOsSimServer.ps1') -NoPopup -SimHome $base
    if ($LASTEXITCODE -ne 0) { throw "SIM startup failed (exit $LASTEXITCODE). See $base\Logs\start-*.json and start-status.json." }
    $stage='open-browser'
    $edge=Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path -LiteralPath $edge)) { throw 'Microsoft Edge executable is missing.' }
    # Explicit visible launch; success means dispatch, never proof of a rendered page.
    Start-Process -FilePath $edge -ArgumentList @('--new-window',$profile.url) -WindowStyle Normal
    Write-OpenStatus @{result='browser-launch-requested';url=$profile.url}
} catch {
    try { Write-OpenStatus @{result='failed';reason=$_.Exception.Message;errorId=$_.FullyQualifiedErrorId;scriptLine=$_.InvocationInfo.ScriptLineNumber} } catch {}
    if (-not $NoPopup) { try {$null=(New-Object -ComObject WScript.Shell).Popup("Open SIM failed during $stage. Details: $base\Logs\open-$attempt.json",30,'DLE-OS SIM',16)} catch {} }
    $exitCode=1
}
exit $exitCode

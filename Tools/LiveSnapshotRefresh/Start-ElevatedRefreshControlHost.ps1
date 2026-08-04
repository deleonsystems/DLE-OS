[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    -not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'The refresh control host requires the elevated approved DLE-OS identity.'
}

$runtime = 'C:\Program Files\DLE-OS\LiveSnapshotRefreshControl'
$executable =
    Join-Path $runtime 'DleOs.LiveSnapshotRefresh.ControlHost.exe'
$logRoot = 'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\Logs'
$evidencePath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\control-launch-evidence.json'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
if (
    Get-NetTCPConnection -State Listen -LocalPort 5043 `
        -ErrorAction SilentlyContinue
) {
    throw 'Port 5043 is already listening.'
}

$process = Start-Process `
    -FilePath $executable `
    -WorkingDirectory $runtime `
    -RedirectStandardOutput (
        Join-Path $logRoot 'control-host.stdout.log'
    ) `
    -RedirectStandardError (
        Join-Path $logRoot 'control-host.stderr.log'
    ) `
    -WindowStyle Hidden `
    -PassThru

[ordered]@{
    LaunchedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ProcessId = $process.Id
    WindowsIdentity = $identity.Name
    Elevated = $true
    Executable = $executable
    Endpoint = 'http://dle-os-host:5043'
} |
    ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath $evidencePath -Encoding UTF8

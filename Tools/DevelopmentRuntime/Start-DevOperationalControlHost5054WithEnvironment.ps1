[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Runtime,

    [Parameter(Mandatory = $true)]
    [string] $LogPrefix
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$allowedRoot = 'C:\DLE-OS\Development\OperationalControlHost5054\'
$runtimePointer =
    'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\CurrentRuntime.txt'
if (Test-Path -LiteralPath $runtimePointer -PathType Leaf) {
    $pointedRuntime = (Get-Content -Raw -LiteralPath $runtimePointer).Trim()
    if ($pointedRuntime) { $Runtime = $pointedRuntime }
}
$resolvedRuntime = (Resolve-Path -LiteralPath $Runtime).Path
if (-not $resolvedRuntime.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The 5054 runtime is outside the governed DEV runtime root.'
}
$exe = Join-Path $resolvedRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw 'The governed DEV ControlHost executable is absent.'
}

$env:DLE_OS_ISOLATED_DEVELOPMENT = 'true'
$env:DLE_OS_CONTROL_PREFIX = 'http://dle-os-host:5054'
$env:DLE_OS_CANONICAL_API_BASE_URL = 'http://DLE-OS-HOST:5052'
$env:DLE_OS_OPERATIONAL_CONNECTION_STRING = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_OPERATIONAL_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadWrite;'
$env:DLE_OS_SECURITY_CONNECTION_STRING = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadOnly;'
$env:DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'

$canonicalReadiness =
    'http://127.0.0.1:5052/api/platform/live/v1/readiness'
$canonicalReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials `
            -Uri $canonicalReadiness -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $canonicalReady = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $canonicalReady) {
    throw 'DEV canonical API 5052 was not ready before 5054 startup.'
}

Set-Location -LiteralPath $resolvedRuntime
$process = Start-Process -FilePath $exe -WorkingDirectory $resolvedRuntime `
    -PassThru -RedirectStandardOutput ($LogPrefix + '.stdout.log') `
    -RedirectStandardError ($LogPrefix + '.stderr.log')
$listenerReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) {
        throw 'The DEV operational ControlHost exited before readiness.'
    }
    $listener = netstat.exe -ano -p tcp | Select-String `
        -Pattern ':5054\s+.*LISTENING\s+\d+$' | Select-Object -First 1
    if ($listener) { $listenerReady = $true; break }
}
if (-not $listenerReady) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'The DEV operational ControlHost did not register its 5054 listener.'
}
[ordered]@{
    Verdict = 'PASS'; StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ProcessId = $process.Id
    Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Runtime = $resolvedRuntime; Listener = 'http://DLE-OS-HOST:5054'
    Dependency5052 = 'Ready'; RuntimeMode = 'ISOLATED_DEVELOPMENT'
    OperationalDatabase = 'DLE_OS_OPERATIONAL_DEV'
    SecurityDatabase = 'DLE_OS_SECURITY_DEV'
    CanonicalApiBaseUrl = 'http://DLE-OS-HOST:5052'
} | ConvertTo-Json -Depth 10 | Set-Content ($LogPrefix + '.evidence.json') `
    -Encoding UTF8
$process.WaitForExit()
exit $process.ExitCode

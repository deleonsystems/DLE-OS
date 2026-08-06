[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $RuntimeDirectory,
    [Parameter(Mandatory)] [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The development operational ControlHost requires the elevated approved DLE-OS identity.'
}

$runtime = [IO.Path]::GetFullPath($RuntimeDirectory)
$exe = Join-Path $runtime 'DleOs.LiveSnapshotRefresh.ControlHost.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Development ControlHost executable is absent: $exe" }
$protectedBefore = [ordered]@{}
foreach ($port in 5041,5042,5043,5051,5052,5053) {
    $line = netstat.exe -ano -p tcp | Select-String -Pattern (':'+$port+'\s+.*LISTENING\s+\d+$') | Select-Object -First 1
    $protectedBefore[[string]$port] = if ($line) { [int]((-split $line.Line)[-1]) } else { 0 }
}
if (netstat.exe -ano -p tcp | Select-String -Pattern ':5054\s+.*LISTENING\s+\d+$') { throw 'Port 5054 is already listening.' }

$env:DLE_OS_ISOLATED_DEVELOPMENT = 'true'
$env:DLE_OS_CONTROL_PREFIX = 'http://dle-os-host:5054'
$env:DLE_OS_CANONICAL_API_BASE_URL = 'http://DLE-OS-HOST:5052'
$env:DLE_OS_OPERATIONAL_CONNECTION_STRING = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_OPERATIONAL_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=5;Application Intent=ReadWrite;'
$env:DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'
if (-not (Test-Path -LiteralPath $env:DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH -PathType Leaf)) {
    throw 'The development identity assertion verification key is absent.'
}
$logRoot = 'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$process = Start-Process -FilePath $exe -WorkingDirectory $runtime -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logRoot 'control-host-5054.stdout.log') `
    -RedirectStandardError (Join-Path $logRoot 'control-host-5054.stderr.log')

$deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
do {
    Start-Sleep -Milliseconds 250
    $listener = netstat.exe -ano -p tcp | Select-String -Pattern ':5054\s+.*LISTENING\s+\d+$' | Select-Object -First 1
} while (-not $listener -and [DateTimeOffset]::UtcNow -lt $deadline -and -not $process.HasExited)
if (-not $listener) { throw 'The development operational ControlHost did not listen on 5054.' }

$health = Invoke-RestMethod -UseDefaultCredentials -Uri 'http://DLE-OS-HOST:5054/health' -TimeoutSec 20
if ($health.status -ne 'Ready' -or $health.runtimeMode -ne 'ISOLATED_DEVELOPMENT' -or
    $health.operationalDatabase -ne 'DLE_OS_OPERATIONAL_DEV' -or
    $health.canonicalApiBaseUrl -ne 'http://DLE-OS-HOST:5052') {
    throw 'The development operational ControlHost readiness boundary is invalid.'
}
$protectedAfter = [ordered]@{}
foreach ($port in 5041,5042,5043,5051,5052,5053) {
    $line = netstat.exe -ano -p tcp | Select-String -Pattern (':'+$port+'\s+.*LISTENING\s+\d+$') | Select-Object -First 1
    $protectedAfter[[string]$port] = if ($line) { [int]((-split $line.Line)[-1]) } else { 0 }
    if ($protectedAfter[[string]$port] -ne $protectedBefore[[string]$port]) { throw "Protected listener $port changed." }
}

$evidence = [ordered]@{
    Verdict='PASS'; StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('O'); ProcessId=$process.Id;
    Identity=$identity.Name; RuntimeDirectory=$runtime; Executable=$exe;
    ExecutableHash=(Get-FileHash $exe -Algorithm SHA256).Hash;
    DllHash=(Get-FileHash (Join-Path $runtime 'DleOs.LiveSnapshotRefresh.ControlHost.dll') -Algorithm SHA256).Hash;
    OperationalDatabase='DLE_OS_OPERATIONAL_DEV'; CanonicalApi='http://DLE-OS-HOST:5052';
    Endpoint='http://DLE-OS-HOST:5054'; ProtectedBefore=$protectedBefore; ProtectedAfter=$protectedAfter;
    Health=$health; Logs=$logRoot
}
New-Item -ItemType Directory -Path (Split-Path $EvidencePath -Parent) -Force | Out-Null
$evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
[pscustomobject]$evidence

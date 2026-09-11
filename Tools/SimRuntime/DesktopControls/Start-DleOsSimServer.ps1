[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$profilePath = Join-Path $env:LOCALAPPDATA 'DLE-OS\SIM\sim-profile.json'
$statusPath = Join-Path (Split-Path -Parent $profilePath) 'start-status.json'
# Install a handler before profile parsing/imports: Desktop closes this console on failure.
trap {
    $failure = @{
        result = 'failed'
        timestampUtc = [DateTimeOffset]::UtcNow.ToString('O')
        shortcutProcessId = $PID
        reason = 'SIM launcher failed; see stage and errorId.'
        stage = $stage
        errorId = $_.FullyQualifiedErrorId
        scriptLine = $_.InvocationInfo.ScriptLineNumber
        stdout = $stdout
        stderr = $stderr
    }
    try { $failure | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8 } catch {}
    try {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup("Start SIM failed during $stage. Details: $statusPath", 0, 'DLE-OS SIM', 16)
    } catch {}
    exit 1
}
$stage = 'read-profile'
@{ result = 'initializing'; timestampUtc = [DateTimeOffset]::UtcNow.ToString('O'); shortcutProcessId = $PID } |
    ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
$profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
$logRoot = Join-Path (Split-Path -Parent $profilePath) 'Logs'
$statusPath = Join-Path (Split-Path -Parent $profilePath) 'start-status.json'
$pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
$module = Join-Path $profile.repoPath 'Tools\SimRuntime\Developer\SimDeveloperTools.psm1'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$stage = 'import-developer-tools'
Import-Module $module -Force

function Write-StartStatus {
    param([hashtable] $Status)
    $Status.timestampUtc = [DateTimeOffset]::UtcNow.ToString('O')
    $Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statusPath -Encoding UTF8
}

function Test-AuthenticatedReady {
    if (-not $usesUserConfiguredCode) { return $false }
    try {
        $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
        $null = Invoke-WebRequest -Uri ($profile.url.TrimEnd('/') + '/sim-access') -Method Post `
            -Body @{ sim_access = $configuredAccessCode.Trim() } -WebSession $session -TimeoutSec 3
        $status = Invoke-RestMethod -Uri ($profile.url.TrimEnd('/') + '/api/sim/status') `
            -WebSession $session -TimeoutSec 3
        return $status.status -eq 'READY' -and $status.environment -eq 'SIM' -and
            $status.networkBoundary -eq 'PRIVATE_LAN_HTTPS' -and $status.binding -eq $profile.url
    } catch { return $false }
}

$stage = 'resolve-user-access-code'
if (-not (Test-Path -LiteralPath $pwsh -PathType Leaf)) {
    Write-StartStatus @{ result = 'failed'; reason = 'Stable PowerShell 7 is missing'; path = $pwsh }
    throw "Stable PowerShell 7 is missing: $pwsh"
}

$configuredAccessCode = [Environment]::GetEnvironmentVariable(
    'DLE_OS_SIM_PERMANENT_ACCESS_CODE',
    [EnvironmentVariableTarget]::User)
$usesUserConfiguredCode = -not [string]::IsNullOrWhiteSpace($configuredAccessCode)
if (-not $usesUserConfiguredCode) { throw 'User-scope permanent SIM access code is missing.' }
$stage = 'inspect-existing-runtime'
$runtimePath = Join-Path $profile.repoPath '.sim-state\runtime\runtime.json'
if (Test-Path -LiteralPath $runtimePath -PathType Leaf) {
    $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    $runtimeStatus = Get-DleOsSimRuntimeStatus $profile
    if ($runtime.environment -eq 'SIM' -and
        $runtime.networkBoundary -eq 'PRIVATE_LAN_HTTPS' -and
        $runtimeStatus.binding -eq $profile.url -and
        $runtimeStatus.running -and (Test-AuthenticatedReady)) {
        Write-StartStatus @{
            result = 'already-running'
            shortcutProcessId = $PID
            simProcessId = $runtimeStatus.processId
            url = $profile.url
            usesUserConfiguredCode = $usesUserConfiguredCode
        }
        Write-Host "DLE-OS SIM is already running at $($profile.url)"
        return
    }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $logRoot "sim-server-$stamp.stdout.log"
$stderr = Join-Path $logRoot "sim-server-$stamp.stderr.log"
$runnerEnvironment = @{}
if ($usesUserConfiguredCode) {
    $runnerEnvironment['DLE_OS_SIM_PERMANENT_ACCESS_CODE'] = $configuredAccessCode.Trim()
}
$startParameters = @{
    FilePath = $pwsh
    ArgumentList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + (Join-Path $profile.repoPath 'Tools\SimRuntime\Start-DleOsSimDeveloper.ps1') + '"'),
        '-ProfilePath', ('"' + $profilePath + '"')
    )
    WorkingDirectory = $profile.repoPath
    RedirectStandardOutput = $stdout
    RedirectStandardError = $stderr
    PassThru = $true
    WindowStyle = 'Hidden'
}
if ($runnerEnvironment.Count -gt 0) {
    $startParameters.Environment = $runnerEnvironment
}
$stage = 'spawn-detached-runner'
$runner = Start-Process @startParameters

Write-StartStatus @{
    result = 'starting'
    shortcutProcessId = $PID
    runnerProcessId = $runner.Id
    stdout = $stdout
    stderr = $stderr
    url = $profile.url
    usesUserConfiguredCode = $usesUserConfiguredCode
}

$stage = 'wait-authenticated-ready'
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    if ($runner.HasExited) {
        $errorTail = if (Test-Path -LiteralPath $stderr) {
            Get-Content -LiteralPath $stderr -Tail 20 -ErrorAction SilentlyContinue
        } else { @() }
        Write-StartStatus @{
            result = 'failed'
            reason = 'SIM developer launcher exited before HTTPS readiness'
            exitCode = $runner.ExitCode
            stdout = $stdout
            stderr = $stderr
            url = $profile.url
            usesUserConfiguredCode = $usesUserConfiguredCode
        }
        throw "DLE-OS SIM did not start. See $stderr"
    }
    if (Test-Path -LiteralPath $runtimePath -PathType Leaf) {
        $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
        $runtimeStatus = Get-DleOsSimRuntimeStatus $profile
        if ($runtime.environment -eq 'SIM' -and
            $runtime.networkBoundary -eq 'PRIVATE_LAN_HTTPS' -and
            $runtimeStatus.binding -eq $profile.url -and
            $runtimeStatus.running -and (Test-AuthenticatedReady)) {
            Write-StartStatus @{
                result = 'started'
                shortcutProcessId = $PID
                runnerProcessId = $runner.Id
                simProcessId = $runtimeStatus.processId
                stdout = $stdout
                stderr = $stderr
                url = $profile.url
                usesUserConfiguredCode = $usesUserConfiguredCode
            }
            Write-Host "DLE-OS SIM started at $($profile.url)"
            return
        }
    }
    Start-Sleep -Milliseconds 500
}

Write-StartStatus @{
    result = 'failed'
    reason = 'Timed out waiting for SIM HTTPS listener'
    runnerProcessId = $runner.Id
    stdout = $stdout
    stderr = $stderr
    url = $profile.url
    usesUserConfiguredCode = $usesUserConfiguredCode
}
throw "Timed out waiting for DLE-OS SIM at $($profile.url). See $stdout and $stderr"

[CmdletBinding()]
param([switch] $NoPopup, [string] $SimHome = (Join-Path $env:USERPROFILE '.dle-os\SIM'))
$ErrorActionPreference = 'Stop'
$base = $SimHome
$profilePath = Join-Path $base 'sim-profile.json'
$statusPath = Join-Path $base 'start-status.json'
$logRoot = Join-Path $base 'Logs'
$attempt = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + "-$PID"
$stage = 'initialize'
$lock = $null
$configuredAccessCode = $null
$lastReadinessError = $null
$stdout = $null
$stderr = $null
$runner = $null
$exitCode = 0
function Protect-ErrorText([string] $Text) {
    if (-not [string]::IsNullOrWhiteSpace($configuredAccessCode)) {
        $Text = $Text.Replace($configuredAccessCode.Trim(), '[redacted]')
    }
    return $Text
}
function Write-StartStatus([hashtable] $Status) {
    $Status.timestampUtc = [DateTimeOffset]::UtcNow.ToString('O')
    $Status.attempt = $attempt
    $Status.shortcutProcessId = $PID
    $Status.stage = $stage
    $json = $Status | ConvertTo-Json -Depth 8
    $json | Set-Content -LiteralPath (Join-Path $logRoot "start-$attempt.json") -Encoding UTF8
    # A waiter must not overwrite the active owner's status.
    if ($lock) { $json | Set-Content -LiteralPath $statusPath -Encoding UTF8 }
}
function Test-PendingRunnerIdentity($Record, $Process) {
    if (-not $Record -or -not $Process) { return $false }
    try {
        return $Process.Path -eq 'C:\Program Files\PowerShell\7\pwsh.exe' -and
            $Process.StartTime.ToUniversalTime() -eq ([DateTimeOffset]$Record.processStartedAtUtc).UtcDateTime
    } catch { return $false }
}
function Test-AuthenticatedReady {
    param([int] $Attempts = 1)
    if (-not $usesUserConfiguredCode) { return $false }
    for ($i = 0; $i -lt $Attempts; $i++) {
        try {
            $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
            $null = Invoke-WebRequest -Uri ($profile.url.TrimEnd('/') + '/sim-access') -Method Post -Body @{sim_access=$configuredAccessCode.Trim()} -WebSession $session -TimeoutSec 5
            $status = Invoke-RestMethod -Uri ($profile.url.TrimEnd('/') + '/api/sim/status') -WebSession $session -TimeoutSec 5
            if ($status.status -eq 'READY' -and $status.environment -eq 'SIM' -and $status.networkBoundary -eq 'PRIVATE_LAN_HTTPS' -and $status.binding -eq $profile.url) {
                $script:lastReadinessError = $null
                return $true
            }
            $script:lastReadinessError = 'HTTPS status did not match READY/SIM/private LAN/configured binding.'
        } catch {
            $script:lastReadinessError = Protect-ErrorText ($_.Exception.Message + ' [' + $_.FullyQualifiedErrorId + ']')
        }
        if ($i + 1 -lt $Attempts) { Start-Sleep -Milliseconds 500 }
    }
    return $false
}
try {
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $stage = 'wait-start-lock'
    # Exclusive handle works across sessions; stale files are harmless and OS releases on exit.
    $lockDeadline = [DateTime]::UtcNow.AddSeconds(150)
    while (-not $lock) {
        try { $lock = [IO.File]::Open((Join-Path $base 'start.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch [IO.IOException] {
            if ([DateTime]::UtcNow -ge $lockDeadline) { throw 'Timed out waiting for another SIM start; inspect its start-status.json.' }
            Start-Sleep -Milliseconds 250
        }
    }
    $stage = 'read-profile'
    Write-StartStatus @{result='initializing'}
    $profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
    $stage = 'import-developer-tools'
    Import-Module (Join-Path $profile.repoPath 'Tools\SimRuntime\Developer\SimDeveloperTools.psm1') -Force
    $stage = 'resolve-user-access-code'
    $configuredAccessCode = [Environment]::GetEnvironmentVariable('DLE_OS_SIM_PERMANENT_ACCESS_CODE', 'User')
    $usesUserConfiguredCode = -not [string]::IsNullOrWhiteSpace($configuredAccessCode)
    if (-not $usesUserConfiguredCode) { throw 'User-scope permanent SIM access code is missing.' }
    $pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
    if (-not (Test-Path -LiteralPath $pwsh)) { throw 'Stable PowerShell 7 is missing.' }
    $stage = 'inspect-existing-runtime'
    $runtimeStatus = Get-DleOsSimRuntimeStatus $profile
    if ($runtimeStatus.running -and (Test-AuthenticatedReady -Attempts 3)) {
        Write-StartStatus @{result='already-running';simProcessId=$runtimeStatus.processId;url=$profile.url;usesUserConfiguredCode=$true}
    } else {
        if ($runtimeStatus.listenerPresent) {
            throw "Port 5177 is occupied but the configured SIM is not verified ready. $lastReadinessError"
        }
        # A previous attempt can time out while dotnet is still building. Never spawn a second runner.
        $pendingPath = Join-Path $base 'pending-runner.json'
        if (Test-Path -LiteralPath $pendingPath) {
            $pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
            $pendingProcess = Get-Process -Id $pending.processId -ErrorAction SilentlyContinue
            if (Test-PendingRunnerIdentity $pending $pendingProcess) {
                throw "Previous SIM runner $($pending.processId) is still active without readiness. See $($pending.stderr). Retry after it finishes; no second runner was started."
            }
        }
        $stdout = Join-Path $logRoot "sim-server-$attempt.stdout.log"
        $stderr = Join-Path $logRoot "sim-server-$attempt.stderr.log"
        $lifecycle = Join-Path $logRoot "sim-server-$attempt.lifecycle.jsonl"
        $stage = 'spawn-detached-runner'
        $runner = Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $profile.repoPath 'Tools\SimRuntime\Start-DleOsSimDeveloper.ps1')+'"'),'-ProfilePath',('"'+$profilePath+'"'),'-LifecyclePath',('"'+$lifecycle+'"')) -WorkingDirectory $profile.repoPath -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru -Environment @{DLE_OS_SIM_PERMANENT_ACCESS_CODE=$configuredAccessCode.Trim()}
        @{processId=$runner.Id;processStartedAtUtc=$runner.StartTime.ToUniversalTime().ToString('O');stdout=$stdout;stderr=$stderr;lifecycle=$lifecycle} |
            ConvertTo-Json | Set-Content -LiteralPath $pendingPath -Encoding UTF8
        Write-StartStatus @{result='starting';runnerProcessId=$runner.Id;stdout=$stdout;stderr=$stderr;lifecycle=$lifecycle;url=$profile.url;usesUserConfiguredCode=$true}
        $stage = 'wait-authenticated-ready'
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        $ready = $false
        while ([DateTime]::UtcNow -lt $deadline) {
            $runtimeStatus = Get-DleOsSimRuntimeStatus $profile
            if ($runtimeStatus.running -and (Test-AuthenticatedReady)) { $ready=$true; break }
            $runner.Refresh()
            if ($runner.HasExited) { throw "SIM developer runner exited before readiness (exit $($runner.ExitCode)); see $stderr" }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw "Timed out waiting for authenticated SIM readiness. $lastReadinessError" }
        Write-StartStatus @{result='started';runnerProcessId=$runner.Id;simProcessId=$runtimeStatus.processId;stdout=$stdout;stderr=$stderr;lifecycle=$lifecycle;url=$profile.url;usesUserConfiguredCode=$true}
    }
} catch {
    $failure = @{result='failed';reason=(Protect-ErrorText $_.Exception.Message);errorId=$_.FullyQualifiedErrorId;scriptLine=$_.InvocationInfo.ScriptLineNumber;stdout=$stdout;stderr=$stderr;readinessError=$lastReadinessError}
    if ($runner) { $failure.runnerProcessId=$runner.Id; $runner.Refresh(); if ($runner.HasExited) {$failure.exitCode=$runner.ExitCode} }
    if ($stderr -and (Test-Path -LiteralPath $stderr)) { $failure.stderrTail=Protect-ErrorText ((Get-Content -LiteralPath $stderr -Tail 12) -join "`n") }
    try { Write-StartStatus $failure } catch {}
    if (-not $NoPopup) { try { $null=(New-Object -ComObject WScript.Shell).Popup("Start SIM failed during $stage. Details: $logRoot\start-$attempt.json",30,'DLE-OS SIM',16) } catch {} }
    $exitCode=1
} finally {
    if ($lock) { $lock.Dispose() }
}
exit $exitCode

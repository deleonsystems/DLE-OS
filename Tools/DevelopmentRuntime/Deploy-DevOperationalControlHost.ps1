[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $StageDirectory,
    [Parameter(Mandatory)] [ValidatePattern('^\d{8}T\d{6}Z$')] [string] $BuildId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$requestedStage = [IO.Path]::GetFullPath($StageDirectory)

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    $arguments = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'),
        '-StageDirectory', ('"' + $requestedStage + '"'), '-BuildId', $BuildId
    )
    $elevated = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList $arguments
    exit $elevated.ExitCode
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stage = (Resolve-Path -LiteralPath $requestedStage).Path
$expectedStageRoot = [IO.Path]::GetFullPath((Join-Path $repository '.tmp\dev-operational-control-deployment'))
if (-not $stage.StartsWith($expectedStageRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The 5054 candidate stage is outside the governed repository evidence root.'
}
$runtimeRoot = 'C:\DLE-OS\Development\OperationalControlHost5054'
$candidateRuntime = Join-Path $runtimeRoot $BuildId
$pointer = 'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\CurrentRuntime.txt'
$startupEvidence = 'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Logs\startup.evidence.json'
$taskPath = '\DLE-OS\Development\'
$taskName = 'Operational ControlHost 5054'
$evidenceDirectory = Join-Path $expectedStageRoot $BuildId
$evidencePath = Join-Path $evidenceDirectory 'deployment.json'
$protectedPorts = 5041, 5042, 5043, 5051, 5052, 5053

function Get-ListenerOwner([int] $Port) {
    $line = netstat.exe -ano -p tcp | Select-String -Pattern (':' + $Port + '\s+.*LISTENING\s+\d+$') |
        Select-Object -First 1
    if ($null -eq $line) { return 0 }
    return [int]((-split $line.Line)[-1])
}

function Get-HttpSysProcess {
    $registeredUrl = 'HTTP://DLE-OS-HOST:5054/'
    $text = netsh.exe http show servicestate view=requestq | Out-String
    foreach ($block in ($text -split '(?m)^Request queue name:')) {
        if ($block -notmatch [regex]::Escape($registeredUrl)) { continue }
        $match = [regex]::Match($block, '(?m)^\s*ID:\s*(\d+),')
        if ($match.Success) { return [int]$match.Groups[1].Value }
    }
    return 0
}

function Require-CanonicalReadiness {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials `
            -Uri 'http://127.0.0.1:5052/api/platform/live/v1/readiness' `
            -TimeoutSec 5
    }
    catch {
        throw "DEV canonical API 5052 is not ready; refusing to stop 5054. $($_.Exception.Message)"
    }
    if ($response.StatusCode -ne 200) {
        throw "DEV canonical API 5052 returned $($response.StatusCode); refusing to stop 5054."
    }
}

function Wait-5054Released([int] $TimeoutSeconds = 30) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if ((Get-HttpSysProcess) -eq 0) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw 'The DEV 5054 HTTP.sys registration did not release.'
}

function Start-Governed5054([string] $ExpectedRuntime, [DateTimeOffset] $After) {
    $task = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName
    if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskPath $taskPath -TaskName $taskName
        $deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 250
            $task = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName
        } while ($task.State -eq 'Running' -and [DateTimeOffset]::UtcNow -lt $deadline)
    }
    Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(75)
    do {
        Start-Sleep -Milliseconds 500
        if (-not (Test-Path -LiteralPath $startupEvidence -PathType Leaf)) { continue }
        try { $startup = Get-Content -Raw -LiteralPath $startupEvidence | ConvertFrom-Json } catch { continue }
        if ($startup.Verdict -eq 'PASS' -and
            [IO.Path]::GetFullPath([string]$startup.Runtime) -ieq [IO.Path]::GetFullPath($ExpectedRuntime) -and
            [DateTimeOffset]::Parse([string]$startup.StartedAtUtc) -gt $After -and
            (Get-HttpSysProcess) -gt 0) { return $startup }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "The scheduled DEV 5054 runtime did not qualify: $ExpectedRuntime"
}

function Set-RuntimePointer([string] $Runtime) {
    $resolved = [IO.Path]::GetFullPath($Runtime)
    if (-not $resolved.StartsWith($runtimeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The candidate runtime pointer is outside the governed DEV 5054 root.'
    }
    [IO.File]::WriteAllText($pointer, $resolved + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
}

$candidateDll = Join-Path $stage 'DleOs.LiveSnapshotRefresh.ControlHost.dll'
if (-not (Test-Path -LiteralPath $candidateDll -PathType Leaf)) {
    throw 'The staged DEV 5054 candidate DLL is absent.'
}
$candidateHash = (Get-FileHash -LiteralPath $candidateDll -Algorithm SHA256).Hash
$reuseCandidate = Test-Path -LiteralPath $candidateRuntime -PathType Container
if ($reuseCandidate) {
    $existingDll = Join-Path $candidateRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.dll'
    if (-not (Test-Path -LiteralPath $existingDll -PathType Leaf) -or
        (Get-FileHash -LiteralPath $existingDll -Algorithm SHA256).Hash -cne $candidateHash) {
        throw "The existing immutable DEV 5054 candidate does not match the staged build: $candidateRuntime"
    }
}
Require-CanonicalReadiness
$oldRuntime = [IO.Path]::GetFullPath((Get-Content -Raw -LiteralPath $pointer).Trim())
if (-not $oldRuntime.StartsWith($runtimeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The current DEV 5054 runtime pointer is outside its governed root.'
}
$oldProcessId = Get-HttpSysProcess
if ($oldProcessId -le 0) { throw 'The current governed DEV 5054 worker was not found.' }
$oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$oldProcessId"
if (-not [string]$oldProcess.ExecutablePath -or
    -not ([string]$oldProcess.ExecutablePath).StartsWith($oldRuntime + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The current 5054 worker does not match the governed runtime pointer.'
}

$protectedBefore = [ordered]@{}
foreach ($port in $protectedPorts) { $protectedBefore[[string]$port] = Get-ListenerOwner $port }
$evidence = [ordered]@{
    Verdict = 'FAIL'; StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Environment = 'DEV'; ProductionDeploymentPerformed = $false
    OldRuntime = $oldRuntime; OldProcessId = $oldProcessId
    CandidateRuntime = $candidateRuntime
    CandidateDllSha256 = $candidateHash; ReusedCandidateRuntime = $reuseCandidate
    ProtectedBefore = $protectedBefore; Rollback = 'NotRequired'
}
$oldStopped = $false

try {
    if (-not $reuseCandidate) {
        New-Item -ItemType Directory -Path $candidateRuntime | Out-Null
        Copy-Item -Path (Join-Path $stage '*') -Destination $candidateRuntime -Recurse -Force
    }
    $runtimeDll = Join-Path $candidateRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.dll'
    if ((Get-FileHash -LiteralPath $runtimeDll -Algorithm SHA256).Hash -cne $evidence.CandidateDllSha256) {
        throw 'The staged DEV 5054 DLL changed while copying to the immutable runtime.'
    }
    Set-RuntimePointer $candidateRuntime
    Stop-Process -Id $oldProcessId -Force
    $oldStopped = $true
    Wait-5054Released
    $startedAfter = [DateTimeOffset]::UtcNow
    $startup = Start-Governed5054 $candidateRuntime $startedAfter
    $protectedAfter = [ordered]@{}
    foreach ($port in $protectedPorts) {
        $protectedAfter[[string]$port] = Get-ListenerOwner $port
        if ($protectedAfter[[string]$port] -ne $protectedBefore[[string]$port]) {
            throw "Protected DEV/LIVE listener $port changed during the 5054 deployment."
        }
    }
    $evidence.NewProcessId = [int]$startup.ProcessId
    $evidence.Startup = $startup
    $evidence.ProtectedAfter = $protectedAfter
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    Set-RuntimePointer $oldRuntime
    if ($oldStopped) {
        $newProcessId = Get-HttpSysProcess
        if ($newProcessId -gt 0) { Stop-Process -Id $newProcessId -Force -ErrorAction SilentlyContinue }
        Wait-5054Released
        $rollbackAfter = [DateTimeOffset]::UtcNow
        $rollback = Start-Governed5054 $oldRuntime $rollbackAfter
        $evidence.Rollback = "PASS: restored $oldRuntime as PID $($rollback.ProcessId)"
    }
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
}

[pscustomobject]$evidence

[CmdletBinding()]
param(
    [switch] $ApproveDevRestart
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$candidateBuildId = '20260810T222000Z'
$transactionId = '20260810T222100Z'
$candidateSource = Join-Path $repository ".tmp\operations-center-dev-regression\$candidateBuildId\publish"
$candidateRuntime = "C:\DLE-OS\Development\OperationalControlHost5054\$candidateBuildId"
$evidenceDirectory = Join-Path $repository ".tmp\operations-center-dev-regression\$transactionId\evidence"
$evidencePath = Join-Path $evidenceDirectory 'deployment.json'
$serviceIdentity = 'DLE-OS-HOST\DLE-OS'
$controlUrl = 'http://dle-os-host:5054/'
$expectedCandidateHash = '2E4B8F7F880B0F58E858FE02D1D9AF9B6154F1670C3A4B657E74785EEEA3139E'
$protectedPorts = 5041, 5042, 5043, 5051, 5052, 5053

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ListenerOwner([int] $Port) {
    $line = netstat.exe -ano -p tcp |
        Select-String -Pattern (':' + $Port + '\s+.*LISTENING\s+\d+$') |
        Select-Object -First 1
    if ($null -eq $line) { return 0 }
    return [int]((-split $line.Line)[-1])
}

function Get-HttpSysProcess([string] $RegisteredUrl) {
    $text = netsh.exe http show servicestate view=requestq | Out-String
    # Split only at top-level request queues. Each queue also contains an
    # indented "Request queue name" field inside its URL group; splitting on
    # that nested field separates the owning PID from its registered URL.
    foreach ($block in ($text -split '(?m)^Request queue name:')) {
        if ($block -notmatch [regex]::Escape($RegisteredUrl)) { continue }
        $match = [regex]::Match($block, '(?m)^\s*ID:\s*(\d+),')
        if ($match.Success) { return [int]$match.Groups[1].Value }
    }
    return 0
}

function Wait-5054Released([int] $TimeoutSeconds = 30) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if ((Get-ListenerOwner 5054) -eq 0 -and
            (Get-HttpSysProcess 'HTTP://DLE-OS-HOST:5054/') -eq 0) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw ('5054 did not release. TCP owner={0}; HTTP.sys process={1}.' -f
        (Get-ListenerOwner 5054),
        (Get-HttpSysProcess 'HTTP://DLE-OS-HOST:5054/'))
}

function Wait-5054Owned([Diagnostics.Process] $Launcher, [int] $TimeoutSeconds = 45) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $owner = Get-HttpSysProcess 'HTTP://DLE-OS-HOST:5054/'
        if ($owner -gt 0) { return $owner }
        $Launcher.Refresh()
        if ($Launcher.HasExited) { throw 'The 5054 launcher exited before registration.' }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "The 5054 launcher did not register the prefix within $TimeoutSeconds seconds."
}

function Start-ControlHost(
    [string] $Runtime,
    [Management.Automation.PSCredential] $Credential,
    [string] $LogPrefix) {
    $launcherScript = Join-Path $repository `
        'Tools\DevelopmentRuntime\Start-DevOperationalControlHost5054WithEnvironment.ps1'
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Runtime "{1}" -LogPrefix "{2}"' -f `
        $launcherScript, $Runtime, $LogPrefix
    return Start-Process powershell.exe -Credential $Credential -WindowStyle Hidden -PassThru `
        -ArgumentList $arguments
}

function Invoke-HealthAsServiceIdentity(
    [Management.Automation.PSCredential] $Credential,
    [string] $OutputPath) {
    $escapedOutput = $OutputPath.Replace("'", "''")
    $command = @"
`$ErrorActionPreference='Stop'
`$result=Invoke-RestMethod -UseDefaultCredentials -Uri 'http://DLE-OS-HOST:5054/health' -TimeoutSec 20
`$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath '$escapedOutput' -Encoding UTF8
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $probe = Start-Process powershell.exe -Credential $Credential -WindowStyle Hidden -Wait -PassThru `
        -ArgumentList '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-EncodedCommand', $encoded
    if ($probe.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $OutputPath)) {
        throw "5054 health qualification failed with exit code $($probe.ExitCode)."
    }
    $health = Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json
    if ($health.status -ne 'Ready' -or $health.runtimeMode -ne 'ISOLATED_DEVELOPMENT' -or
        $health.operationalDatabase -ne 'DLE_OS_OPERATIONAL_DEV' -or
        $health.canonicalApiBaseUrl -ne 'http://DLE-OS-HOST:5052') {
        throw '5054 health returned the wrong DEV boundary.'
    }
    return $health
}

if (-not $ApproveDevRestart) {
    throw 'Specify -ApproveDevRestart to cross the DEV 5054 restart boundary.'
}
if (-not (Test-Administrator)) { throw 'Run this transaction from an elevated PowerShell window.' }
if (-not (Test-Path -LiteralPath $candidateSource -PathType Container)) {
    throw "Candidate publish directory is absent: $candidateSource"
}
$candidateDll = Join-Path $candidateSource 'DleOs.LiveSnapshotRefresh.ControlHost.dll'
if ((Get-FileHash -LiteralPath $candidateDll -Algorithm SHA256).Hash -cne $expectedCandidateHash) {
    throw 'Candidate ControlHost hash mismatch.'
}
if (Test-Path -LiteralPath $candidateRuntime) {
    throw 'The final candidate runtime already exists; do not stage over prior state.'
}
$urlAclOutput = netsh.exe http show urlacl url=$controlUrl 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or
    $urlAclOutput -notmatch [regex]::Escape($controlUrl) -or
    $urlAclOutput -notmatch [regex]::Escape($serviceIdentity)) {
    throw 'The exact DEV 5054 URL ACL is absent or owned by the wrong identity.'
}

$current5054Pid = Get-HttpSysProcess 'HTTP://DLE-OS-HOST:5054/'
if ($current5054Pid -le 0) { throw 'The current 5054 worker could not be identified.' }
$currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$current5054Pid"
$currentExe = [string]$currentProcess.ExecutablePath
if ([string]::IsNullOrWhiteSpace($currentExe) -or
    -not $currentExe.StartsWith('C:\DLE-OS\Development\OperationalControlHost5054\',
        [StringComparison]::OrdinalIgnoreCase)) {
    throw "Current 5054 PID $current5054Pid is not the governed DEV ControlHost."
}
$currentRuntime = Split-Path -Parent $currentExe
$currentDll = Join-Path $currentRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.dll'
$currentDllHash = (Get-FileHash -LiteralPath $currentDll -Algorithm SHA256).Hash

$protectedBefore = [ordered]@{}
foreach ($port in $protectedPorts) { $protectedBefore[[string]$port] = Get-ListenerOwner $port }
$credential = Get-Credential -UserName $serviceIdentity `
    -Message 'Enter the existing DLE-OS-HOST\DLE-OS credential for the DEV 5054 restart only.'
if ($credential.UserName -ine $serviceIdentity) { throw "Credential must be exactly $serviceIdentity." }

New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$identityProbePath = Join-Path $evidenceDirectory 'credential-identity.txt'
$identityCommand = "[Security.Principal.WindowsIdentity]::GetCurrent().Name | Set-Content -LiteralPath '$($identityProbePath.Replace("'", "''"))' -Encoding UTF8"
$identityEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($identityCommand))
$identityProbe = Start-Process powershell.exe -Credential $credential -WindowStyle Hidden -Wait -PassThru `
    -ArgumentList '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', $identityEncoded
if ($identityProbe.ExitCode -ne 0 -or
    (Get-Content -LiteralPath $identityProbePath -Raw).Trim() -ine $serviceIdentity) {
    throw 'The supplied DLE-OS service credential did not validate. No runtime mutation occurred.'
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    Scope = 'DEV_5054_TRUST_CORRECTION'
    OldProcessId = $current5054Pid
    OldRuntime = $currentRuntime
    OldDllSha256 = $currentDllHash
    CandidateRuntime = $candidateRuntime
    CandidateDllSha256 = $expectedCandidateHash
    ProtectedBefore = $protectedBefore
    MutationBegan = $false
    Rollback = 'NotRequired'
}
$candidateProcess = $null
$candidateOwnerPid = 0
$oldStopped = $false
try {
    New-Item -ItemType Directory -Path $candidateRuntime -Force | Out-Null
    Copy-Item -Path (Join-Path $candidateSource '*') -Destination $candidateRuntime -Recurse -Force
    $runtimeCandidateDll = Join-Path $candidateRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.dll'
    if ((Get-FileHash -LiteralPath $runtimeCandidateDll -Algorithm SHA256).Hash -cne
        $expectedCandidateHash) {
        throw 'The staged final candidate hash changed.'
    }
    $evidence.MutationBegan = $true
    Stop-Process -Id $current5054Pid -Force
    $oldStopped = $true
    Wait-5054Released
    $candidateProcess = Start-ControlHost $candidateRuntime $credential `
        (Join-Path $evidenceDirectory 'candidate-5054')
    $candidateOwnerPid = Wait-5054Owned $candidateProcess
    $evidence.Health = Invoke-HealthAsServiceIdentity $credential `
        (Join-Path $evidenceDirectory 'candidate-health.json')
    $protectedAfter = [ordered]@{}
    foreach ($port in $protectedPorts) {
        $protectedAfter[[string]$port] = Get-ListenerOwner $port
        if ($protectedAfter[[string]$port] -ne $protectedBefore[[string]$port]) {
            throw "Protected listener $port changed."
        }
    }
    $evidence.LauncherProcessId = $candidateProcess.Id
    $evidence.NewProcessId = $candidateOwnerPid
    $evidence.ProtectedAfter = $protectedAfter
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    if ($null -ne $candidateProcess -and
        (Get-Process -Id $candidateProcess.Id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $candidateProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($oldStopped) {
        if ($candidateOwnerPid -gt 0 -and
            (Get-Process -Id $candidateOwnerPid -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $candidateOwnerPid -Force -ErrorAction SilentlyContinue
        }
        Wait-5054Released
        $rollback = Start-ControlHost $currentRuntime $credential `
            (Join-Path $evidenceDirectory 'rollback-5054')
        $rollbackOwnerPid = Wait-5054Owned $rollback
        $null = Invoke-HealthAsServiceIdentity $credential `
            (Join-Path $evidenceDirectory 'rollback-health.json')
        $evidence.Rollback = "PASS: restored PID $rollbackOwnerPid from $currentRuntime"
    }
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $evidence | ConvertTo-Json -Depth 12 |
        Set-Content -LiteralPath $evidencePath -Encoding UTF8
    $credential = $null
}

[pscustomobject]$evidence

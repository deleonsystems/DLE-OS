[CmdletBinding()]
param(
    [switch] $ApproveRollbackRecovery
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$transactionId = '20260810T214900Z'
$transactionRoot = Join-Path $repository ".tmp\operations-center-dev-regression\$transactionId"
$deploymentPath = Join-Path $transactionRoot 'evidence\deployment.json'
$priorRecoveryPath = Join-Path $transactionRoot 'evidence\rollback-recovery-v3.json'
$recoveryPath = Join-Path $transactionRoot 'evidence\rollback-recovery-v4.json'
$serviceIdentity = 'DLE-OS-HOST\DLE-OS'
$controlUrl = 'http://dle-os-host:5054/'
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
    foreach ($block in ($text -split '(?m)^Request queue name:')) {
        if ($block -notmatch [regex]::Escape($RegisteredUrl)) { continue }
        $match = [regex]::Match($block, '(?m)^\s*ID:\s*(\d+),')
        if ($match.Success) { return [int]$match.Groups[1].Value }
    }
    return 0
}

function Test-ControlUrlAcl {
    $output = netsh.exe http show urlacl url=$controlUrl 2>&1 | Out-String
    return ($LASTEXITCODE -eq 0 -and
        $output -match [regex]::Escape($controlUrl) -and
        $output -match [regex]::Escape($serviceIdentity))
}

function Start-ControlHostWithDevEnvironment(
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

function Wait-5054Registered(
    [Diagnostics.Process] $Launcher,
    [int] $TimeoutSeconds = 45) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $owner = Get-HttpSysProcess 'HTTP://DLE-OS-HOST:5054/'
        if ($owner -gt 0) { return $owner }
        $Launcher.Refresh()
        if ($Launcher.HasExited) {
            throw "Rollback launcher exited with code $($Launcher.ExitCode) before registering 5054."
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw 'The preserved rollback runtime did not register 5054 within 45 seconds.'
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
        throw "Rollback health qualification failed with exit code $($probe.ExitCode)."
    }
    $health = Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json
    if ($health.status -ne 'Ready' -or $health.runtimeMode -ne 'ISOLATED_DEVELOPMENT' -or
        $health.operationalDatabase -ne 'DLE_OS_OPERATIONAL_DEV' -or
        $health.canonicalApiBaseUrl -ne 'http://DLE-OS-HOST:5052') {
        throw 'Rollback health returned the wrong DEV boundary.'
    }
    return $health
}

if (-not $ApproveRollbackRecovery) {
    throw 'Specify -ApproveRollbackRecovery to restore the preserved DEV 5054 runtime.'
}
if (-not (Test-Administrator)) { throw 'Run this recovery from an elevated PowerShell window.' }
if (-not (Test-Path -LiteralPath $deploymentPath -PathType Leaf)) {
    throw 'The governed failed-deployment evidence is absent.'
}
if (-not (Test-Path -LiteralPath $priorRecoveryPath -PathType Leaf)) {
    throw 'The first rollback-recovery failure evidence is absent.'
}
if (Test-Path -LiteralPath $recoveryPath) {
    throw 'Rollback recovery v4 evidence already exists; do not retry over prior state.'
}

$deployment = Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json
$priorRecovery = Get-Content -LiteralPath $priorRecoveryPath -Raw | ConvertFrom-Json
if ($deployment.Verdict -ne 'FAIL' -or -not $deployment.MutationBegan -or
    $deployment.Scope -ne 'DEV_5054_TRUST_CORRECTION') {
    throw 'The deployment evidence does not authorize this exact rollback recovery.'
}
if ($priorRecovery.Verdict -ne 'FAIL' -or
    $priorRecovery.Error -notlike 'Rollback launcher exited with code*before registering 5054.') {
    throw 'Rollback-recovery v3 evidence does not authorize recovery v4.'
}
if (Test-ControlUrlAcl) {
    throw 'The exact 5054 URL ACL already exists; recovery v4 requires the captured absent baseline.'
}
$v3Log = Join-Path $transactionRoot 'evidence\recovery-5054.stdout.log'
if (-not (Test-Path -LiteralPath $v3Log -PathType Leaf) -or
    (Get-Content -LiteralPath $v3Log -Raw) -notmatch
        "prefix 'http://dle-os-host:5054/' is not registered") {
    throw 'The recovery-v3 HTTP.sys denial evidence is absent.'
}
if ((Get-HttpSysProcess 'HTTP://DLE-OS-HOST:5054/') -ne 0 -or
    (Get-ListenerOwner 5054) -ne 0) {
    throw '5054 is already owned; rollback recovery will not start another worker.'
}

$oldRuntime = [string]$deployment.OldRuntime
$oldDll = Join-Path $oldRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.dll'
if (-not (Test-Path -LiteralPath $oldDll -PathType Leaf) -or
    (Get-FileHash -LiteralPath $oldDll -Algorithm SHA256).Hash -cne
        [string]$deployment.OldDllSha256) {
    throw 'The preserved rollback runtime is absent or its DLL hash changed.'
}

$protectedBefore = [ordered]@{}
foreach ($port in $protectedPorts) {
    $actual = Get-ListenerOwner $port
    $expected = [int]$deployment.ProtectedBefore.([string]$port)
    if ($actual -ne $expected) {
        throw "Protected listener $port differs from the captured baseline: expected $expected; actual $actual."
    }
    $protectedBefore[[string]$port] = $actual
}

$credential = Get-Credential -UserName $serviceIdentity `
    -Message 'Enter the existing DLE-OS-HOST\DLE-OS credential to restore the preserved DEV 5054 runtime.'
if ($credential.UserName -ine $serviceIdentity) { throw "Credential must be exactly $serviceIdentity." }

$recovery = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    Scope = 'DEV_5054_EXACT_ROLLBACK_RECOVERY'
    Runtime = $oldRuntime
    DllSha256 = [string]$deployment.OldDllSha256
    ProtectedBefore = $protectedBefore
    UrlAclBefore = 'Absent'
    UrlAclAdded = $false
}
$launcher = $null
$ownerPid = 0
try {
    $urlAclOutput = netsh.exe http add urlacl url=$controlUrl user=$serviceIdentity `
        listen=yes delegate=no 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or -not (Test-ControlUrlAcl)) {
        throw "Failed to add the exact DEV 5054 URL ACL: $urlAclOutput"
    }
    $recovery.UrlAclAdded = $true
    $launcher = Start-ControlHostWithDevEnvironment $oldRuntime $credential `
        (Join-Path $transactionRoot 'evidence\recovery-5054-v4')
    $ownerPid = Wait-5054Registered $launcher
    $recovery.Health = Invoke-HealthAsServiceIdentity $credential `
        (Join-Path $transactionRoot 'evidence\recovery-health-v4.json')
    $protectedAfter = [ordered]@{}
    foreach ($port in $protectedPorts) {
        $protectedAfter[[string]$port] = Get-ListenerOwner $port
        if ($protectedAfter[[string]$port] -ne $protectedBefore[[string]$port]) {
            throw "Protected listener $port changed during rollback recovery."
        }
    }
    $recovery.LauncherProcessId = $launcher.Id
    $recovery.ControlHostProcessId = $ownerPid
    $recovery.ProtectedAfter = $protectedAfter
    $recovery.Verdict = 'PASS'
}
catch {
    $recovery.Error = $_.Exception.Message
    if ($ownerPid -gt 0 -and (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
        $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
        while ((Get-HttpSysProcess $controlUrl) -ne 0 -and
            [DateTimeOffset]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 250
        }
    }
    if ($recovery.UrlAclAdded -and (Get-HttpSysProcess $controlUrl) -eq 0) {
        $removeOutput = netsh.exe http delete urlacl url=$controlUrl 2>&1 | Out-String
        $recovery.UrlAclRollback = if ($LASTEXITCODE -eq 0) {
            'PASS: restored absent URL ACL baseline.'
        } else {
            "FAIL: $removeOutput"
        }
    }
    throw
}
finally {
    $recovery.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $recovery | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $recoveryPath -Encoding UTF8
    $credential = $null
}

[pscustomobject]$recovery

[CmdletBinding()]
param(
    [switch] $ApproveDevFrontendRestart
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$transactionId = '20260810T222400Z'
$serviceName = 'DleOsDevelopmentFrontend'
$serviceIdentity = 'DLE-OS-HOST\DLE-OS-DEV-FRONTEND'
$oldRelease = 'C:\ProgramData\DLE-OS\DevelopmentFrontend\Service\releases\20260810T211402200Z'
$candidateSource = Join-Path $repository ".tmp\operations-center-dev-regression\$transactionId\frontend-publish"
$candidateRelease = "C:\ProgramData\DLE-OS\DevelopmentFrontend\Service\releases\$transactionId"
$oldConfig = Join-Path $oldRelease 'service-runtime.json'
$candidateConfig = Join-Path $candidateRelease 'service-runtime.json'
$candidateExe = Join-Path $candidateRelease 'DleOs.DevelopmentFrontend.exe'
$candidateDll = Join-Path $candidateRelease 'DleOs.DevelopmentFrontend.dll'
$expectedCandidateHash = 'D33C9A24EA22C77BACBA4759A033AA0E4B5C90069300EB1650D8B60FB0EC0E03'
$expectedConfigHash = '0CA6366602798078E9E6B7C270D27751DAB1B56E10D9130EC0281DC8A9EE32A4'
$evidenceDirectory = Join-Path $repository ".tmp\operations-center-dev-regression\$transactionId\frontend-evidence"
$evidencePath = Join-Path $evidenceDirectory 'deployment.json'
$protectedPorts = 5041, 5042, 5043, 5052, 5053, 5054
$frontendPrefixes = @(
    'HTTP://DLE-OS-HOST:5051/',
    'HTTP://192.168.0.105:5051:192.168.0.105/',
    'HTTPS://DEV.DLE-OS.INTERNAL.DLEMFG.COM:443/',
    'HTTPS://AUTH.INTERNAL.DLEMFG.COM:443/'
)

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

function Get-ServiceRecord {
    Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
}

function Wait-ServiceState([string] $State, [int] $TimeoutSeconds = 45) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $record = Get-ServiceRecord
        if ($record.State -eq $State) { return $record }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Service $serviceName did not reach $State within $TimeoutSeconds seconds."
}

function Wait-FrontendReleased([int] $OldProcessId, [int] $TimeoutSeconds = 45) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $owners = @($frontendPrefixes | ForEach-Object { Get-HttpSysProcess $_ })
        if (-not (Get-Process -Id $OldProcessId -ErrorAction SilentlyContinue) -and
            (Get-ListenerOwner 5051) -eq 0 -and
            @($owners | Where-Object { $_ -ne 0 }).Count -eq 0) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw ('Frontend release timed out. ProcessAlive={0}; Tcp5051={1}; PrefixOwners={2}' -f
        [bool](Get-Process -Id $OldProcessId -ErrorAction SilentlyContinue),
        (Get-ListenerOwner 5051), ($owners -join ','))
}

function Wait-FrontendOwned([int] $ProcessId, [int] $TimeoutSeconds = 60) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $record = Get-ServiceRecord
        if ($record.State -ne 'Running') { throw 'The DEV frontend service left Running state.' }
        $owners = @($frontendPrefixes | ForEach-Object { Get-HttpSysProcess $_ })
        if ((Get-ListenerOwner 5051) -ne 0 -and
            @($owners | Where-Object { $_ -eq $ProcessId }).Count -eq $frontendPrefixes.Count) {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "The DEV frontend did not acquire all four prefixes under PID $ProcessId. Owners=$($owners -join ',')."
}

function Set-ServiceBinary([string] $Release) {
    $exe = Join-Path $Release 'DleOs.DevelopmentFrontend.exe'
    $config = Join-Path $Release 'service-runtime.json'
    $binaryPath = '"{0}" --dle-os-windows-service --service-config "{1}"' -f $exe, $config
    $output = sc.exe config $serviceName binPath= $binaryPath 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Failed to configure $serviceName`: $output" }
}

if (-not $ApproveDevFrontendRestart) {
    throw 'Specify -ApproveDevFrontendRestart to cross the DEV frontend restart boundary.'
}
if (-not (Test-Administrator)) { throw 'Run this transaction from an elevated PowerShell window.' }
if (Test-Path -LiteralPath $candidateRelease) {
    throw 'The final frontend candidate release already exists; do not stage over prior state.'
}
if (Test-Path -LiteralPath $evidencePath) {
    throw 'The final frontend transaction evidence already exists; do not retry over prior state.'
}
$sourceDll = Join-Path $candidateSource 'DleOs.DevelopmentFrontend.dll'
if (-not (Test-Path -LiteralPath $sourceDll -PathType Leaf) -or
    (Get-FileHash -LiteralPath $sourceDll -Algorithm SHA256).Hash -cne $expectedCandidateHash) {
    throw 'The final frontend candidate is absent or its hash changed.'
}
if ((Get-FileHash -LiteralPath $oldConfig -Algorithm SHA256).Hash -cne $expectedConfigHash) {
    throw 'The governed DEV service configuration hash changed.'
}

$serviceBefore = Get-ServiceRecord
if ($serviceBefore.State -ne 'Running' -or
    $serviceBefore.StartName -notin '.\DLE-OS-DEV-FRONTEND', $serviceIdentity -or
    $serviceBefore.PathName -notmatch [regex]::Escape($oldRelease)) {
    throw 'The current DEV frontend service baseline differs from the governed release.'
}
$oldProcessId = [int]$serviceBefore.ProcessId
$prefixOwnersBefore = [ordered]@{}
foreach ($prefix in $frontendPrefixes) {
    $prefixOwnersBefore[$prefix] = Get-HttpSysProcess $prefix
    if ($prefixOwnersBefore[$prefix] -ne $oldProcessId) {
        throw "The current DEV frontend does not own $prefix under PID $oldProcessId."
    }
}
$protectedBefore = [ordered]@{}
foreach ($port in $protectedPorts) { $protectedBefore[[string]$port] = Get-ListenerOwner $port }

New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    Scope = 'DEV_FRONTEND_ASSERTION_ENVIRONMENT_CORRECTION'
    ServiceName = $serviceName
    ServiceIdentity = $serviceIdentity
    OldProcessId = $oldProcessId
    OldRelease = $oldRelease
    CandidateRelease = $candidateRelease
    CandidateDllSha256 = $expectedCandidateHash
    ConfigSha256 = $expectedConfigHash
    PrefixOwnersBefore = $prefixOwnersBefore
    ProtectedBefore = $protectedBefore
    ServiceStopped = $false
    Rollback = 'NotRequired'
}

try {
    New-Item -ItemType Directory -Path $candidateRelease -Force | Out-Null
    Copy-Item -Path (Join-Path $candidateSource '*') -Destination $candidateRelease -Recurse -Force
    Copy-Item -LiteralPath $oldConfig -Destination $candidateConfig -Force
    Copy-Item -LiteralPath $oldConfig `
        -Destination (Join-Path $candidateRelease 'service-runtime.Development.json') -Force
    $aclOutput = icacls.exe $candidateRelease /grant:r `
        "$serviceIdentity`:(OI)(CI)(RX)" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Failed to apply candidate release ACL: $aclOutput" }
    if ((Get-FileHash -LiteralPath $candidateDll -Algorithm SHA256).Hash -cne $expectedCandidateHash -or
        (Get-FileHash -LiteralPath $candidateConfig -Algorithm SHA256).Hash -cne $expectedConfigHash) {
        throw 'The staged frontend release failed hash validation.'
    }

    Stop-Service -Name $serviceName -Force
    $evidence.ServiceStopped = $true
    $null = Wait-ServiceState 'Stopped'
    Wait-FrontendReleased $oldProcessId

    Set-ServiceBinary $candidateRelease
    Start-Service -Name $serviceName
    $serviceAfter = Wait-ServiceState 'Running'
    $newProcessId = [int]$serviceAfter.ProcessId
    if ($newProcessId -le 0 -or $newProcessId -eq $oldProcessId) {
        throw 'SCM did not record a distinct replacement DEV frontend PID.'
    }
    Wait-FrontendOwned $newProcessId

    $protectedAfter = [ordered]@{}
    foreach ($port in $protectedPorts) {
        $protectedAfter[[string]$port] = Get-ListenerOwner $port
        if ($protectedAfter[[string]$port] -ne $protectedBefore[[string]$port]) {
            throw "Protected listener $port changed during the DEV frontend restart."
        }
    }
    $prefixOwnersAfter = [ordered]@{}
    foreach ($prefix in $frontendPrefixes) { $prefixOwnersAfter[$prefix] = Get-HttpSysProcess $prefix }
    $evidence.NewProcessId = $newProcessId
    $evidence.PrefixOwnersAfter = $prefixOwnersAfter
    $evidence.ProtectedAfter = $protectedAfter
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    if ($evidence.ServiceStopped) {
        Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
        $null = Wait-ServiceState 'Stopped'
        Set-ServiceBinary $oldRelease
        Start-Service -Name $serviceName
        $rollbackService = Wait-ServiceState 'Running'
        $rollbackPid = [int]$rollbackService.ProcessId
        Wait-FrontendOwned $rollbackPid
        $evidence.Rollback = "PASS: restored $oldRelease under PID $rollbackPid"
    }
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
}

[pscustomobject]$evidence

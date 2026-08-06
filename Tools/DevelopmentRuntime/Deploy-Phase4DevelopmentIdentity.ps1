[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Phase 4 development deployment requires an elevated Administrator token.'
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serviceIdentity = 'DLE-OS-HOST\DLE-OS'
$protectedPorts = 5041,5042,5043,5052,5053
$keyDirectory = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys'
$privateKey = Join-Path $keyDirectory 'issuer-private.pem'
$publicKey = Join-Path $keyDirectory 'validator-public.pem'
$runtime = 'C:\DLE-OS\Development\OperationalControlHost5054\20260806TPhase4'
$stage = Join-Path $repository '.tmp\trusted-identity\controlhost-publish'
$evidencePath = Join-Path $repository '.tmp\trusted-identity\phase4-deployment.json'
$frontendTask = 'DLE-OS Development Authenticated Frontend 5051'
$operationalTask = 'DLE-OS Development Operational ControlHost 5054 Phase4'

function Get-ListenerPid([int] $Port) {
    $line = netstat.exe -ano -p tcp | Select-String -Pattern (':' + $Port + '\s+.*LISTENING\s+\d+$') |
        Select-Object -First 1
    if (-not $line) { return $null }
    return [int]((-split $line.Line)[-1])
}

function Get-ProtectedSnapshot {
    $result = [ordered]@{}
    foreach ($port in $protectedPorts) { $result[[string]$port] = Get-ListenerPid $port }
    return $result
}

function Find-Worker([string] $CommandFragment) {
    return @(Get-CimInstance Win32_Process | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
        $_.CommandLine.IndexOf($CommandFragment, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
}

function Wait-Port([int] $Port, [bool] $Present, [int] $Seconds = 45) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        Start-Sleep -Milliseconds 250
        $matches = ($null -ne (Get-ListenerPid $Port))
        if ($matches -eq $Present) { return }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Port $Port did not reach the expected listener state."
}

$protectedBefore = Get-ProtectedSnapshot
$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    DeploymentIdentity = $identity.Name
    ServiceIdentity = $serviceIdentity
    ProtectedBefore = $protectedBefore
}

try {
    if (-not (Test-Path $privateKey) -and -not (Test-Path $publicKey)) {
        & (Join-Path $repository 'Tools\TrustedIdentity\Initialize-DevelopmentIdentitySigningKey.ps1')
    }
    if (-not (Test-Path $privateKey) -or -not (Test-Path $publicKey)) {
        throw 'The development signing key pair is incomplete.'
    }
    $evidence.PrivateKeySha256 = (Get-FileHash $privateKey -Algorithm SHA256).Hash
    $evidence.PublicKeySha256 = (Get-FileHash $publicKey -Algorithm SHA256).Hash
    $evidence.KeyMaterialIncluded = $false

    if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    dotnet publish (Join-Path $repository 'Tools\LiveSnapshotRefresh\ControlHost\DleOs.LiveSnapshotRefresh.ControlHost.csproj') `
        -c Release -r win-x64 --self-contained false -o $stage
    if ($LASTEXITCODE -ne 0) { throw 'The Phase 4 operational ControlHost publish failed.' }
    if (Test-Path $runtime) {
        $resolvedRuntime = [IO.Path]::GetFullPath($runtime)
        if ($resolvedRuntime -ne 'C:\DLE-OS\Development\OperationalControlHost5054\20260806TPhase4') {
            throw 'The existing Phase 4 runtime path is outside the approved development target.'
        }
        Remove-Item -LiteralPath $resolvedRuntime -Recurse -Force
    }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    Copy-Item -Path (Join-Path $stage '*') -Destination $runtime -Recurse -Force

    $frontendWorkers = @(Find-Worker 'DleOs.DevelopmentFrontend.dll')
    if ($frontendWorkers.Count -ne 1) { throw 'The 5051 worker could not be identified uniquely.' }
    $operationalWorkers = @(Find-Worker 'Development\OperationalControlHost5054')
    if ($operationalWorkers.Count -ne 1) { throw 'The 5054 worker could not be identified uniquely.' }
    $evidence.FrontendPidBefore = [int]$frontendWorkers[0].ProcessId
    $evidence.OperationalPidBefore = [int]$operationalWorkers[0].ProcessId

    Stop-Process -Id $frontendWorkers[0].ProcessId -Force -ErrorAction Stop
    Wait-Port 5051 $false
    dotnet build (Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DleOs.DevelopmentFrontend.csproj') -c Release
    if ($LASTEXITCODE -ne 0) { throw 'The Phase 4 authenticated frontend build failed.' }

    Stop-Process -Id $operationalWorkers[0].ProcessId -Force -ErrorAction Stop
    Wait-Port 5054 $false

    $taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $serviceIdentity -LogonType Interactive -RunLevel Highest

    $operationalStart = Join-Path $repository 'Tools\DevelopmentRuntime\Start-DevelopmentOperationalControlHost.ps1'
    $operationalLaunchEvidence = Join-Path $repository '.tmp\trusted-identity\5054-phase4-launch.json'
    $operationalAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
        '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $operationalStart +
        '" -RuntimeDirectory "' + $runtime + '" -EvidencePath "' + $operationalLaunchEvidence + '"')
    Register-ScheduledTask -TaskName $operationalTask -Action $operationalAction -Principal $taskPrincipal `
        -Settings $taskSettings -Force | Out-Null
    Start-ScheduledTask -TaskName $operationalTask
    Wait-Port 5054 $true

    $frontendStart = Join-Path $repository 'Tools\DevelopmentRuntime\Start-DevelopmentFrontend.ps1'
    $frontendAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
        '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $frontendStart + '"')
    Register-ScheduledTask -TaskName $frontendTask -Action $frontendAction -Principal $taskPrincipal `
        -Settings $taskSettings -Force | Out-Null
    Start-ScheduledTask -TaskName $frontendTask
    Wait-Port 5051 $true

    $me = Invoke-RestMethod -UseDefaultCredentials -Uri 'http://dle-os-host:5051/api/auth/me' -TimeoutSec 20
    if ($me.user.userName -ne 'Miguel' -or -not $me.isSuperAdmin) {
        throw 'Miguel did not resolve after Phase 4 deployment.'
    }
    $shipments = Invoke-RestMethod -UseDefaultCredentials `
        -Uri 'http://dle-os-host:5051/api/shipment-staging/v1/shipments?page=1&pageSize=100' -TimeoutSec 20
    if ($shipments.totalItems -lt 1) { throw 'Shipment Staging did not load through the signed path.' }

    $frontendAfter = @(Find-Worker 'DleOs.DevelopmentFrontend.dll')
    $operationalAfter = @(Find-Worker 'Development\OperationalControlHost5054\20260806TPhase4')
    if ($frontendAfter.Count -ne 1 -or $operationalAfter.Count -ne 1) {
        throw 'Phase 4 development workers could not be identified after launch.'
    }
    $evidence.FrontendPidAfter = [int]$frontendAfter[0].ProcessId
    $evidence.OperationalPidAfter = [int]$operationalAfter[0].ProcessId
    $evidence.SignedOperationalRead = [ordered]@{ Status = 200; TotalItems = $shipments.totalItems }
    $evidence.CurrentUser = $me

    $protectedAfter = Get-ProtectedSnapshot
    $evidence.ProtectedAfter = $protectedAfter
    if (($protectedBefore | ConvertTo-Json -Compress) -ne ($protectedAfter | ConvertTo-Json -Compress)) {
        throw 'A protected production listener changed during Phase 4 deployment.'
    }
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    New-Item -ItemType Directory -Path (Split-Path $evidencePath -Parent) -Force | Out-Null
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding utf8
}

[pscustomobject]$evidence

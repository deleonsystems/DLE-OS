[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Phase 5.1 development deployment requires an elevated Administrator token.'
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repository
$serviceIdentity = 'DLE-OS-HOST\DLE-OS'
$protectedPorts = 5041,5042,5043,5052,5053
$runtimeRoot = 'C:\DLE-OS\Development\OperationalControlHost5054'
$runtime = Join-Path $runtimeRoot ('20260806TPhase51-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
$stage = Join-Path $repository '.tmp\role-permission\controlhost-publish'
$evidencePath = Join-Path $repository '.tmp\role-permission\phase51-deployment.json'
$frontendTask = 'DLE-OS Development Authenticated Frontend 5051'
$operationalTask = 'DLE-OS Development Operational ControlHost 5054 Phase51'

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
function Find-Worker([string] $fragment) {
    return @(Get-CimInstance Win32_Process | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
        $_.CommandLine.IndexOf($fragment,[StringComparison]::OrdinalIgnoreCase) -ge 0
    })
}
function Wait-Port([int] $Port,[bool] $Present,[int] $Seconds=45) {
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        Start-Sleep -Milliseconds 250
        if (($null -ne (Get-ListenerPid $Port)) -eq $Present) { return }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Port $Port did not reach the expected listener state."
}

$protectedBefore = Get-ProtectedSnapshot
$evidence = [ordered]@{
    Verdict='FAIL'; StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
    DeploymentIdentity=$identity.Name; ServiceIdentity=$serviceIdentity
    ProtectedBefore=$protectedBefore
}
try {
    $env:DLE_OS_SECURITY_DEVELOPMENT='true'
    $bootstrapOutput = @(& dotnet.exe run --project (Join-Path $repository 'Tools\SecurityFoundation\DleOs.Security.Bootstrap\DleOs.Security.Bootstrap.csproj') `
        -c Release --nologo 2>&1 | ForEach-Object { $_.ToString() })
    $bootstrapExitCode = $LASTEXITCODE
    $evidence.Bootstrap = [ordered]@{ ExitCode=$bootstrapExitCode; Output=$bootstrapOutput }
    if ($bootstrapExitCode -ne 0) {
        throw "The Phase 5.1 security catalog migration failed (exit $bootstrapExitCode)."
    }

    if (Test-Path $stage) {
        $resolvedStage=[IO.Path]::GetFullPath($stage)
        if (-not $resolvedStage.StartsWith((Join-Path $repository '.tmp\role-permission'),[StringComparison]::OrdinalIgnoreCase)) {
            throw 'The Phase 5.1 staging path is outside the approved temporary directory.'
        }
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
    dotnet publish (Join-Path $repository 'Tools\LiveSnapshotRefresh\ControlHost\DleOs.LiveSnapshotRefresh.ControlHost.csproj') `
        -c Release -r win-x64 --self-contained false -o $stage
    if ($LASTEXITCODE -ne 0) { throw 'The Phase 5.1 ControlHost publish failed.' }
    if (Test-Path $runtime) {
        $resolvedRuntime=[IO.Path]::GetFullPath($runtime)
        if (-not $resolvedRuntime.StartsWith(($runtimeRoot + '\'),[StringComparison]::OrdinalIgnoreCase)) {
            throw 'The Phase 5.1 runtime path is outside the approved development target.'
        }
        Remove-Item -LiteralPath $resolvedRuntime -Recurse -Force
    }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    Copy-Item -Path (Join-Path $stage '*') -Destination $runtime -Recurse -Force

    $frontendBefore=@(Find-Worker 'DleOs.DevelopmentFrontend.dll')
    $operationalBefore=@(Find-Worker 'Development\OperationalControlHost5054')
    if ($frontendBefore.Count -ne 1 -or $operationalBefore.Count -ne 1) {
        throw 'The existing development workers could not be identified uniquely.'
    }
    $evidence.FrontendPidBefore=[int]$frontendBefore[0].ProcessId
    $evidence.OperationalPidBefore=[int]$operationalBefore[0].ProcessId

    Stop-Process -Id $frontendBefore[0].ProcessId -Force
    Wait-Port 5051 $false
    dotnet build (Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DleOs.DevelopmentFrontend.csproj') -c Release
    if ($LASTEXITCODE -ne 0) { throw 'The Phase 5.1 frontend build failed.' }
    Stop-Process -Id $operationalBefore[0].ProcessId -Force
    Wait-Port 5054 $false

    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $taskPrincipal=New-ScheduledTaskPrincipal -UserId $serviceIdentity -LogonType Interactive -RunLevel Highest
    $operationalStart=Join-Path $repository 'Tools\DevelopmentRuntime\Start-DevelopmentOperationalControlHost.ps1'
    $operationalEvidence=Join-Path $repository '.tmp\role-permission\5054-phase51-launch.json'
    $operationalAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
        '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $operationalStart +
        '" -RuntimeDirectory "' + $runtime + '" -EvidencePath "' + $operationalEvidence + '"')
    Register-ScheduledTask -TaskName $operationalTask -Action $operationalAction `
        -Principal $taskPrincipal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $operationalTask
    Wait-Port 5054 $true

    $frontendStart=Join-Path $repository 'Tools\DevelopmentRuntime\Start-DevelopmentFrontend.ps1'
    $frontendAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
        '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $frontendStart + '"')
    Register-ScheduledTask -TaskName $frontendTask -Action $frontendAction `
        -Principal $taskPrincipal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $frontendTask
    Wait-Port 5051 $true

    $me=Invoke-RestMethod -UseDefaultCredentials -Uri 'http://dle-os-host:5051/api/auth/me' -TimeoutSec 20
    if ($me.user.userName -ne 'Miguel' -or -not $me.isSuperAdmin -or $null -eq $me.permissions) {
        throw 'Miguel capability resolution failed after Phase 5.1 deployment.'
    }
    $operationalLaunch = Get-Content -Raw -LiteralPath $operationalEvidence | ConvertFrom-Json
    $health = $operationalLaunch.Health
    if ($operationalLaunch.Verdict -ne 'PASS' -or
        $health.securityDatabase -ne 'DLE_OS_SECURITY_DEV') {
        throw 'The downstream security database boundary is invalid.'
    }
    $shipments=Invoke-RestMethod -UseDefaultCredentials `
        -Uri 'http://dle-os-host:5051/api/shipment-staging/v1/shipments?page=1&pageSize=100' -TimeoutSec 20
    $frontendAfter=@(Find-Worker 'DleOs.DevelopmentFrontend.dll')
    $operationalAfter=@(Find-Worker 'Development\OperationalControlHost5054\20260806TPhase51')
    if ($frontendAfter.Count -ne 1 -or $operationalAfter.Count -ne 1) {
        throw 'The Phase 5.1 development workers could not be identified after launch.'
    }
    $evidence.FrontendPidAfter=[int]$frontendAfter[0].ProcessId
    $evidence.OperationalPidAfter=[int]$operationalAfter[0].ProcessId
    $evidence.CurrentUser=$me
    $evidence.Health=$health
    $evidence.ShipmentCount=$shipments.totalItems
    $protectedAfter=Get-ProtectedSnapshot
    $evidence.ProtectedAfter=$protectedAfter
    if (($protectedBefore|ConvertTo-Json -Compress) -ne ($protectedAfter|ConvertTo-Json -Compress)) {
        throw 'A protected listener changed during Phase 5.1 deployment.'
    }
    $evidence.Verdict='PASS'
}
catch { $evidence.Error=$_.Exception.Message; throw }
finally {
    $evidence.CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
    New-Item -ItemType Directory -Path (Split-Path $evidencePath -Parent) -Force|Out-Null
    $evidence|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $evidencePath -Encoding utf8
}
[pscustomobject]$evidence

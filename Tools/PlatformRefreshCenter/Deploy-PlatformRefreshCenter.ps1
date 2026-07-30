[CmdletBinding()]
param(
    [switch] $ElevatedStage,
    [string] $ControlHostStagingRoot,
    [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$operator = 'DLE-OS-HOST\DLE-OS'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$runId = 'PLATFORMREFRESHCENTER001-20260730T150100Z'
$artifactRoot = Join-Path $repository (
    "Artifacts\PlatformRefreshCenter001\$runId")
$controlProject = Join-Path $repository (
    'Tools\LiveSnapshotRefresh\ControlHost\' +
    'DleOs.LiveSnapshotRefresh.ControlHost.csproj')
$controlRuntime =
    'C:\Program Files\DLE-OS\LiveSnapshotRefreshControl'
$controlExecutable = Join-Path $controlRuntime (
    'DleOs.LiveSnapshotRefresh.ControlHost.exe')
$controlLauncher = Join-Path $repository (
    'Tools\LiveSnapshotRefresh\Start-ElevatedRefreshControlHost.ps1')
$frontendPublisher = Join-Path $repository (
    'Tools\PlatformFreshnessCache\Publish-VersionedFrontend.ps1')
$frontendRollback = Join-Path $repository (
    'Tools\PlatformFreshnessCache\Rollback-VersionedFrontend.ps1')
$frontendRoot = 'C:\ProgramData\DLE-OS\Frontend'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Listener {
    param([int] $Port)
    $row = netstat.exe -ano -p tcp |
        Select-String -Pattern (
            '^\s*TCP\s+\S+:' + $Port +
            '\s+\S+\s+LISTENING\s+\d+\s*$') |
        Select-Object -First 1
    if ($null -eq $row) { return $null }
    [int]((-split $row.Line)[-1])
}

function Wait-Listener {
    param([int] $Port, [int] $Seconds = 45)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        $listener = Get-Listener -Port $Port
        if ($null -ne $listener) { return $listener }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Port $Port did not reach LISTENING."
}

function Get-ControlProcesses {
    @(Get-CimInstance Win32_Process -Filter (
        "Name='DleOs.LiveSnapshotRefresh.ControlHost.exe'"))
}

function Get-Owner {
    param([object] $Process)
    $owner = Invoke-CimMethod -InputObject $Process -MethodName GetOwner
    "$($owner.Domain)\$($owner.User)"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $operator) {
    throw "Deployment requires $operator; actual identity is $identity."
}

if (-not $ElevatedStage) {
    if (Test-Elevated) {
        throw 'Deployment preparation must begin under the non-elevated operator token.'
    }
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $staging = Join-Path $artifactRoot "ControlHostPublish-$stamp"
    $childEvidence = Join-Path $artifactRoot (
        "PLATFORM_REFRESH_CENTER_DEPLOYMENT_$stamp.json")
    & 'C:\Program Files\dotnet\dotnet.exe' publish $controlProject `
        -c Release --output $staging --nologo
    if ($LASTEXITCODE -ne 0) {
        throw 'Refresh Center control-host publication failed.'
    }
    $arguments = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-ElevatedStage',
        '-ControlHostStagingRoot', "`"$staging`"",
        '-EvidencePath', "`"$childEvidence`""
    )
    $uac = [ordered]@{
        Verdict = 'AWAITING_UAC'
        RequestedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        RequestingIdentity = $identity
        ControlHostStagingRoot = $staging
        EvidencePath = $childEvidence
    }
    $uac | ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath (
            Join-Path $artifactRoot "UAC_REQUEST_$stamp.json") -Encoding UTF8
    $child = Start-Process powershell.exe `
        -ArgumentList $arguments `
        -Verb RunAs `
        -PassThru
    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
    do {
        if ($child.HasExited) { break }
        Start-Sleep -Milliseconds 250
        $child.Refresh()
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if (-not $child.HasExited) {
        throw "Elevated deployment did not return. Evidence: $childEvidence"
    }
    if (
        $child.ExitCode -ne 0 -or
        -not (Test-Path -LiteralPath $childEvidence -PathType Leaf)
    ) {
        throw "Elevated deployment failed. Evidence: $childEvidence"
    }
    $result = Get-Content -LiteralPath $childEvidence -Raw |
        ConvertFrom-Json
    if ($result.Verdict -ne 'PASS') {
        throw "Deployment verdict was $($result.Verdict)."
    }
    $result | ConvertTo-Json -Depth 12
    exit 0
}

if (
    -not (Test-Elevated) -or
    [string]::IsNullOrWhiteSpace($ControlHostStagingRoot) -or
    [string]::IsNullOrWhiteSpace($EvidencePath)
) {
    throw 'The elevated Refresh Center deployment boundary is invalid.'
}
$resolvedStage = [IO.Path]::GetFullPath($ControlHostStagingRoot)
$resolvedArtifact = [IO.Path]::GetFullPath($artifactRoot)
if (
    -not $resolvedStage.StartsWith(
        $resolvedArtifact + '\',
        [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath (
        Join-Path $resolvedStage (
            'DleOs.LiveSnapshotRefresh.ControlHost.exe'))) -or
    -not (Test-Path -LiteralPath (
        Join-Path $resolvedStage 'PlatformRefreshRegistry.json'))
) {
    throw 'The staged governed control-host publication is invalid.'
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runtimeBackup = Join-Path $artifactRoot "ControlHostRuntimeBackup-$stamp"
$oldProcesses = @(Get-ControlProcesses)
$evidence = [ordered]@{
    Verdict = 'FAIL'
    DeployedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    DeploymentIdentity = $identity
    Elevated = $true
    PreviousProcessIds = @($oldProcesses | ForEach-Object ProcessId)
    ControlHostRuntime = $controlRuntime
    RuntimeBackup = $runtimeBackup
    FrontendPromoted = $false
    ExistingQualifiedRunnersModified = $false
    LiveApiModified = $false
    VProSourceAccessPerformed = $false
    XDriveWrites = 0
}
try {
    New-Item -ItemType Directory -Path $runtimeBackup -Force | Out-Null
    if (Test-Path -LiteralPath $controlRuntime) {
        Copy-Item -Path (Join-Path $controlRuntime '*') `
            -Destination $runtimeBackup -Recurse -Force
    }
    foreach ($process in $oldProcesses) {
        Stop-Process -Id $process.ProcessId -Force
        $nativeProcess = Get-Process -Id $process.ProcessId `
            -ErrorAction SilentlyContinue
        if ($null -ne $nativeProcess) {
            if (-not $nativeProcess.WaitForExit(15000)) {
                throw (
                    'The prior Refresh Center control-host process did not ' +
                    "exit cleanly: $($process.ProcessId)")
            }
        }
    }
    New-Item -ItemType Directory -Path $controlRuntime -Force | Out-Null
    Copy-Item -Path (Join-Path $resolvedStage '*') `
        -Destination $controlRuntime -Recurse -Force

    & $controlLauncher | Out-Null
    Wait-Listener -Port 5043 | Out-Null

    $frontend = & $frontendPublisher `
        -SourceRoot $repository `
        -PublicationRoot $frontendRoot `
        -PublishedAtUtc ([DateTimeOffset]::UtcNow) |
        Out-String |
        ConvertFrom-Json
    $evidence.Frontend = $frontend
    $evidence.FrontendPromoted = $true

    foreach ($port in 5041, 5042, 5043, 5044) {
        $evidence["Port${port}ProcessId"] = Wait-Listener -Port $port
    }
    $control = @(Get-ControlProcesses) |
        Sort-Object CreationDate -Descending |
        Select-Object -First 1
    if ($null -eq $control) {
        throw 'The named Refresh Center control-host process is absent.'
    }
    $evidence.ControlHostProcessId = [int]$control.ProcessId
    $evidence.ControlHostOwner = Get-Owner $control
    if ($evidence.ControlHostOwner -ine $operator) {
        throw 'The Refresh Center control host is not running as the approved operator.'
    }
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    foreach ($process in @(Get-ControlProcesses)) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $runtimeBackup) {
        Copy-Item -Path (Join-Path $runtimeBackup '*') `
            -Destination $controlRuntime -Recurse -Force
        try {
            & $controlLauncher | Out-Null
            Wait-Listener -Port 5043 | Out-Null
            $evidence.ControlHostRollback = 'PASS'
        }
        catch {
            $evidence.ControlHostRollback = 'FAIL'
            $evidence.ControlHostRollbackError = $_.Exception.Message
        }
    }
    if ($evidence.FrontendPromoted) {
        try {
            $evidence.FrontendRollback = (
                & $frontendRollback -PublicationRoot $frontendRoot |
                Out-String).Trim()
        }
        catch {
            $evidence.FrontendRollback = 'FAIL'
            $evidence.FrontendRollbackError = $_.Exception.Message
        }
    }
}
finally {
    $evidence | ConvertTo-Json -Depth 12 |
        Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}
if ($evidence.Verdict -ne 'PASS') {
    throw "Refresh Center deployment failed: $($evidence.Error)"
}
$evidence | ConvertTo-Json -Depth 12

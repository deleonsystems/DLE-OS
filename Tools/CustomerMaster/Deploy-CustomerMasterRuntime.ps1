[CmdletBinding()]
param(
    [switch] $ElevatedStage,
    [string] $EvidencePath,
    [switch] $VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$operator = 'DLE-OS-HOST\DLE-OS'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$server = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$artifactRoot = Join-Path $repository (
    'Artifacts\CustomerMasterPlatform001\' +
    'CUSTOMERMASTERPLATFORM001-20260729T170951Z')
$publisher = Join-Path $server (
    'DleOs.PlatformApi.Tests\Publish-LiveCanonicalApi.ps1')
$liveLauncher = Join-Path $server (
    'DleOs.PlatformApi.Tests\Start-LiveCanonicalApiAsDedicatedIdentity.ps1')
$liveStopper = Join-Path $server (
    'DleOs.PlatformApi.Tests\Stop-LiveCanonicalApiAsDedicatedIdentity.ps1')
$controlLauncher = Join-Path $repository (
    'Tools\LiveSnapshotRefresh\Start-ElevatedRefreshControlHost.ps1')
$promotionExecutable =
    'C:\Program Files\DLE-OS\LiveSnapshotRefreshPromotion\' +
    'DleOs.LiveSnapshotRefresh.PromotionHost.exe'
$promotionLogRoot = 'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\Logs'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
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
    return [int]((-split $row.Line)[-1])
}

function Wait-Listener {
    param([int] $Port, [int] $Seconds = 30)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        $processId = Get-Listener -Port $Port
        if ($null -ne $processId) { return $processId }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Port $Port did not reach LISTENING."
}

function Get-Owner {
    param([int] $ProcessId)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    return "$($owner.Domain)\$($owner.User)"
}

function Get-NamedRuntime {
    param([string] $Name)
    $process = Get-CimInstance Win32_Process -Filter "Name='$Name'" |
        Sort-Object CreationDate -Descending |
        Select-Object -First 1
    if ($null -eq $process) {
        throw "Required runtime process is absent: $Name"
    }
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    return [pscustomobject]@{
        ProcessId = [int]$process.ProcessId
        Owner = "$($owner.Domain)\$($owner.User)"
    }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $operator) {
    throw "Deployment requires $operator; actual identity is $identity."
}

if (-not $ElevatedStage) {
    if (Test-Elevated) {
        throw 'Preparation must begin from the non-elevated operator token.'
    }
    $historicalPid = Get-Listener -Port 5041
    if ($null -eq $historicalPid) {
        throw 'The qualified historical runtime is not listening on 5041.'
    }
    $historical = Invoke-RestMethod (
        'http://DLE-OS-HOST:5041/api/platform/v1/readiness') -TimeoutSec 10
    if ($historical.status -ne 'Ready') {
        throw 'The historical runtime is not Ready.'
    }
    $stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $childEvidence = Join-Path $artifactRoot (
        "CUSTOMER_MASTER_DEPLOYMENT_$stamp.json")
    $arguments = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-ElevatedStage',
        '-EvidencePath', "`"$childEvidence`""
    )
    if ($VerifyOnly) {
        $arguments += '-VerifyOnly'
    }
    $child = Start-Process powershell.exe `
        -ArgumentList $arguments `
        -Verb RunAs `
        -Wait `
        -PassThru
    if ($child.ExitCode -ne 0 -or
        -not (Test-Path -LiteralPath $childEvidence -PathType Leaf)) {
        throw (
            'Elevated Customer Master deployment failed. Evidence: ' +
            $childEvidence)
    }
    $result = Get-Content -LiteralPath $childEvidence -Raw |
        ConvertFrom-Json
    if ($result.Verdict -ne 'PASS') {
        throw "Deployment verdict was $($result.Verdict)."
    }
    $result | ConvertTo-Json -Depth 10
    exit 0
}

if (-not (Test-Elevated) -or
    [string]::IsNullOrWhiteSpace($EvidencePath)) {
    throw 'The elevated deployment boundary is invalid.'
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    DeployedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    DeploymentIdentity = $identity
    Elevated = $true
    HistoricalProcessId = Get-Listener -Port 5041
    LiveProcessId = $null
    RefreshControlProcessId = Get-Listener -Port 5043
    PromotionBrokerProcessId = Get-Listener -Port 5044
    SourceAccessPerformed = $false
    ExistingRefreshPipelinesModified = $false
}

try {
    foreach ($relative in @(
        'Contracts\Platform\CustomerMasterDtos.cs',
        'Data\Platform\CustomerMasterRepository.cs',
        'Controllers\Platform\LiveCustomerMasterController.cs'
    )) {
        $source = Join-Path (
            Join-Path $repository 'Tools\CustomerMaster\ServerOverlay') $relative
        $destination = Join-Path $server $relative
        if ((Get-FileHash $source -Algorithm SHA256).Hash -cne
            (Get-FileHash $destination -Algorithm SHA256).Hash) {
            throw "Server overlay differs before publication: $relative"
        }
    }

    if (-not $VerifyOnly) {
        if ($null -ne (Get-Listener -Port 5042)) {
            & $liveStopper | Out-Null
        }
        $publishOutput = @(& $publisher)
        $evidence.PublishOutput = ($publishOutput | Out-String).Trim()
        $launchOutput = @(& $liveLauncher)
        $evidence.LaunchOutput = ($launchOutput | Out-String).Trim()
    }
    $evidence.LiveProcessId = Wait-Listener -Port 5042

    if ($null -eq $evidence.RefreshControlProcessId) {
        & $controlLauncher | Out-Null
        $evidence.RefreshControlProcessId = Wait-Listener -Port 5043
    }
    if ($null -eq $evidence.PromotionBrokerProcessId) {
        if (-not (Test-Path -LiteralPath $promotionExecutable -PathType Leaf)) {
            throw 'The approved promotion broker runtime is absent.'
        }
        New-Item -ItemType Directory -Path $promotionLogRoot -Force |
            Out-Null
        Start-Process `
            -FilePath $promotionExecutable `
            -WorkingDirectory (Split-Path -Parent $promotionExecutable) `
            -RedirectStandardOutput (
                Join-Path $promotionLogRoot 'promotion-host.stdout.log') `
            -RedirectStandardError (
                Join-Path $promotionLogRoot 'promotion-host.stderr.log') `
            -WindowStyle Hidden | Out-Null
        $evidence.PromotionBrokerProcessId = Wait-Listener -Port 5044
    }

    $readiness = Invoke-RestMethod (
        'http://DLE-OS-HOST:5042/api/platform/live/v1/readiness') `
        -TimeoutSec 10
    $metadata = Invoke-RestMethod (
        'http://DLE-OS-HOST:5042/api/platform/live/v1/customer-master/metadata') `
        -TimeoutSec 10
    $sample = Invoke-RestMethod (
        'http://DLE-OS-HOST:5042/api/platform/live/v1/customer-master' +
        '?page=1&pageSize=50&customerNumber=1148') -TimeoutSec 10
    if ($readiness.readinessVerdict -ne 'Ready' -or
        $metadata.customerCount -ne 380 -or
        $metadata.customerAddressCount -ne 28 -or
        $sample.totalItems -ne 1 -or
        $sample.items[0].customerNumber -ne '001148' -or
        $sample.items[0].customerName -ne 'HUGHEY & PHILLIPS') {
        throw 'Customer Master post-publication HTTP qualification failed.'
    }
    if ((Get-Listener -Port 5041) -ne $evidence.HistoricalProcessId) {
        throw 'The historical runtime changed during publication.'
    }
    $evidence.LiveRuntimeOwner = Get-Owner $evidence.LiveProcessId
    $controlRuntime = Get-NamedRuntime (
        'DleOs.LiveSnapshotRefresh.ControlHost.exe')
    $promotionRuntime = Get-NamedRuntime (
        'DleOs.LiveSnapshotRefresh.PromotionHost.exe')
    $evidence.RefreshControlProcessId = $controlRuntime.ProcessId
    $evidence.PromotionBrokerProcessId = $promotionRuntime.ProcessId
    $evidence.RefreshControlOwner = $controlRuntime.Owner
    $evidence.PromotionBrokerOwner = $promotionRuntime.Owner
    if ($evidence.LiveRuntimeOwner -ne
        'DLE-OS-HOST\DLE-OS-LIVE-API' -or
        $evidence.RefreshControlOwner -ne $operator -or
        $evidence.PromotionBrokerOwner -ne $operator) {
        throw 'One or more runtime identities are outside the approved boundary.'
    }
    $evidence.Readiness = $readiness
    $evidence.CustomerMasterMetadata = $metadata
    $evidence.KnownCustomer = $sample.items[0]
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
}
finally {
    $evidence |
        ConvertTo-Json -Depth 12 |
        Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

if ($evidence.Verdict -ne 'PASS') {
    throw "Customer Master deployment failed: $($evidence.Error)"
}
$evidence | ConvertTo-Json -Depth 12

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
    'Artifacts\PurchaseOrderPlatform001\' +
    'PURCHASEORDERPLATFORM001-20260729T212157Z')
$publisher = Join-Path $server (
    'DleOs.PlatformApi.Tests\Publish-LiveCanonicalApi.ps1')
$liveLauncher = Join-Path $server (
    'DleOs.PlatformApi.Tests\Start-LiveCanonicalApiAsDedicatedIdentity.ps1')
$liveStopper = Join-Path $server (
    'DleOs.PlatformApi.Tests\Stop-LiveCanonicalApiAsDedicatedIdentity.ps1')

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
    param([int] $Port, [int] $Seconds = 45)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        $listener = Get-Listener -Port $Port
        if ($null -ne $listener) { return $listener }
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
    $stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $childEvidence = Join-Path $artifactRoot (
        "PURCHASE_ORDER_DEPLOYMENT_$stamp.json")
    $arguments = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-ElevatedStage',
        '-EvidencePath', "`"$childEvidence`""
    )
    if ($VerifyOnly) { $arguments += '-VerifyOnly' }
    $child = Start-Process powershell.exe `
        -ArgumentList $arguments `
        -Verb RunAs `
        -Wait `
        -PassThru
    if ($child.ExitCode -ne 0 -or
        -not (Test-Path -LiteralPath $childEvidence -PathType Leaf)) {
        throw (
            'Elevated Purchase Order deployment failed. Evidence: ' +
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
        'Contracts\Platform\PurchaseOrderDtos.cs',
        'Data\Platform\PurchaseOrderRepository.cs',
        'Controllers\Platform\LivePurchaseOrdersController.cs',
        'Hosting\FrontendApplicationExtensions.cs'
    )) {
        $source = Join-Path (
            Join-Path $repository 'Tools\PurchaseOrder\ServerOverlay') $relative
        $destination = Join-Path $server $relative
        if (
            (Get-FileHash $source -Algorithm SHA256).Hash -cne
            (Get-FileHash $destination -Algorithm SHA256).Hash
        ) {
            throw "Server overlay differs before publication: $relative"
        }
    }
    if (-not $VerifyOnly) {
        if ($null -ne (Get-Listener -Port 5042)) {
            & $liveStopper | Out-Null
        }
        $evidence.PublishOutput = (@(& $publisher) | Out-String).Trim()
        $evidence.LaunchOutput = (@(& $liveLauncher) | Out-String).Trim()
    }
    $evidence.LiveProcessId = Wait-Listener -Port 5042
    $readiness = Invoke-RestMethod (
        'http://DLE-OS-HOST:5042/api/platform/live/v1/readiness') `
        -TimeoutSec 10
    $metadata = Invoke-RestMethod (
        'http://DLE-OS-HOST:5042/api/platform/live/v1/purchase-orders/metadata') `
        -TimeoutSec 10
    $sample = Invoke-RestMethod (
        'http://DLE-OS-HOST:5042/api/platform/live/v1/purchase-orders' +
        '?page=1&pageSize=1') -TimeoutSec 10
    if (
        $readiness.readinessVerdict -ne 'Ready' -or
        $metadata.headerCount -le 0 -or
        $metadata.lineCount -le 0 -or
        $sample.items.Count -ne 1
    ) {
        throw 'Purchase Order post-publication HTTP qualification failed.'
    }
    $evidence.LiveRuntimeOwner = Get-Owner $evidence.LiveProcessId
    if ($evidence.LiveRuntimeOwner -ne
        'DLE-OS-HOST\DLE-OS-LIVE-API') {
        throw 'The LIVE runtime identity is outside the approved boundary.'
    }
    if (
        $null -eq $evidence.RefreshControlProcessId -or
        $null -eq $evidence.PromotionBrokerProcessId
    ) {
        throw 'An existing qualified refresh runtime is absent.'
    }
    $evidence.Readiness = $readiness
    $evidence.PurchaseOrderMetadata = $metadata
    $evidence.Sample = $sample.items[0]
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
    throw "Purchase Order deployment failed: $($evidence.Error)"
}
$evidence | ConvertTo-Json -Depth 12

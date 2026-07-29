[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$principal = New-Object Security.Principal.WindowsPrincipal (
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Invoice History LIVE API deployment requires elevation.'
}

$apiTools =
    'C:\DLE-OS\Repositories\DLE-OS-Server\DleOs.PlatformApi.Tests'
$stopScript = Join-Path $apiTools (
    'Stop-LiveCanonicalApiAsDedicatedIdentity.ps1')
$publishScript = Join-Path $apiTools 'Publish-LiveCanonicalApi.ps1'
$startScript = Join-Path $apiTools (
    'Start-LiveCanonicalApiAsDedicatedIdentity.ps1')
$runtimeRoot = 'C:\Program Files\DLE-OS\LiveCanonicalApi'
$evidenceRoot =
    'C:\DLE-OS\Repositories\DLE-OS-Server\Artifacts\InvoiceHistoryPlatform001'
$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$backupRoot = Join-Path $evidenceRoot "RuntimeBackup\$timestamp"
$evidencePath = Join-Path $evidenceRoot 'deployment-evidence.json'

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -Path (Join-Path $runtimeRoot '*') `
    -Destination $backupRoot -Recurse -Force

function Get-Listener {
    param([int]$Port)
    $listener = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction Stop |
        Select-Object -First 1
    if ($null -eq $listener) {
        throw "Port $Port is not listening."
    }
    return [int]$listener.OwningProcess
}

function Invoke-JsonScript {
    param(
        [Parameter(Mandatory)]
        [string]$ScriptPath
    )

    $output = @(& $ScriptPath)
    if (
        $output.Count -gt 0 -and
        $output[$output.Count - 1] -isnot [string]
    ) {
        return $output[$output.Count - 1]
    }
    $jsonStart = -1
    for ($index = $output.Count - 1; $index -ge 0; $index--) {
        if ([string]$output[$index] -match '^\s*\{') {
            $jsonStart = $index
            break
        }
    }
    if ($jsonStart -lt 0) {
        throw (
            "Script did not return a JSON result: $ScriptPath. " +
            "Output: " + (($output | ForEach-Object { [string]$_ }) -join ' ')
        )
    }
    return (
        ($output[$jsonStart..($output.Count - 1)] -join [Environment]::NewLine) |
            ConvertFrom-Json
    )
}

$preserved = @{
    Historical = Get-Listener -Port 5041
    RefreshControl = Get-Listener -Port 5043
    PromotionBroker = Get-Listener -Port 5044
}
$historicalBefore = Invoke-RestMethod `
    -Uri 'http://DLE-OS-HOST:5041/api/platform/v1/readiness' `
    -TimeoutSec 10
if ($historicalBefore.status -ne 'Ready') {
    throw 'Historical API was not Ready before deployment.'
}

$launch = $null
try {
    $stop = Invoke-JsonScript -ScriptPath $stopScript
    $publish = Invoke-JsonScript -ScriptPath $publishScript
    $launch = Invoke-JsonScript -ScriptPath $startScript

    $readiness = Invoke-RestMethod `
        -Uri 'http://DLE-OS-HOST:5042/api/platform/live/v1/readiness' `
        -TimeoutSec 10
    $metadata = Invoke-RestMethod `
        -Uri 'http://DLE-OS-HOST:5042/api/platform/live/v1/invoice-history/metadata' `
        -TimeoutSec 10
    $sample = Invoke-RestMethod `
        -Uri (
            'http://DLE-OS-HOST:5042/api/platform/live/v1/invoice-history' +
            '?page=1&pageSize=50&customerNumber=1148' +
            '&invoiceNumber=169292&salesOrderNumber=9422' +
            '&itemNumber=277-4169&workOrderNumber=111450'
        ) `
        -TimeoutSec 10

    if ($readiness.readinessVerdict -ne 'Ready' -or
        $metadata.customerInvoiceLineCount -ne 26036 -or
        $sample.totalItems -ne 1 -or
        $sample.items[0].workOrderNumber -ne '0111450') {
        throw 'Post-deployment Invoice History HTTP qualification failed.'
    }
    if ((Get-Listener -Port 5041) -ne $preserved.Historical -or
        (Get-Listener -Port 5043) -ne $preserved.RefreshControl -or
        (Get-Listener -Port 5044) -ne $preserved.PromotionBroker) {
        throw 'A preserved runtime process changed during API deployment.'
    }

    $process = Get-CimInstance Win32_Process -Filter (
        "ProcessId=$($launch.ProcessId)")
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    $ownerName = "$($owner.Domain)\$($owner.User)"
    if ($ownerName -ne 'DLE-OS-HOST\DLE-OS-LIVE-API') {
        throw "LIVE API owner was $ownerName."
    }

    $evidence = [ordered]@{
        Verdict = 'PASS'
        DeployedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        Stop = $stop
        Publish = $publish
        Launch = $launch
        RuntimeOwner = $ownerName
        ReadinessVerdict = $readiness.readinessVerdict
        ContractVersion = $readiness.contractVersion
        InvoiceHistoryImportRunId =
            $metadata.invoiceHistoryImportRunId
        InvoiceHistoryLineCount =
            $metadata.customerInvoiceLineCount
        KnownSampleCount = $sample.totalItems
        KnownSampleWorkOrder = $sample.items[0].workOrderNumber
        HistoricalProcessId = $preserved.Historical
        RefreshControlProcessId = $preserved.RefreshControl
        PromotionBrokerProcessId = $preserved.PromotionBroker
        RuntimeBackupPath = $backupRoot
    }
    $evidence |
        ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath $evidencePath -Encoding UTF8
    $evidence | ConvertTo-Json -Depth 10
}
catch {
    $message = $_.Exception.Message
    $rollback = $null
    $rollbackError = $null
    if ($null -ne $launch -and $null -ne $launch.ProcessId) {
        try { & $stopScript | Out-Null } catch {}
    }
    try {
        Copy-Item -Path (Join-Path $backupRoot '*') `
            -Destination $runtimeRoot -Recurse -Force
        $rollback = Invoke-JsonScript -ScriptPath $startScript
    }
    catch {
        $rollbackError = $_.Exception.Message
    }
    [ordered]@{
        Verdict = if ($null -eq $rollbackError) {
            'FAIL_ROLLED_BACK'
        } else {
            'FAIL_ROLLBACK_ERROR'
        }
        FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        Error = $message
        Rollback = $rollback
        RollbackError = $rollbackError
        RuntimeBackupPath = $backupRoot
    } |
        ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $evidencePath -Encoding UTF8
    throw $message
}

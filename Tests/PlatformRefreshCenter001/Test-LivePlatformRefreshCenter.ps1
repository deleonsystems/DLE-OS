[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$base = 'http://DLE-OS-HOST:5043'
$checks = [Collections.Generic.List[object]]::new()
function Test-Check {
    param([string] $Name, [bool] $Condition)
    $checks.Add([pscustomobject]@{
        Name = $Name
        Passed = $Condition
    })
}
function Get-HttpStatus {
    param(
        [string] $Uri,
        [string] $Method = 'GET',
        [string] $Body = ''
    )
    try {
        $parameters = @{
            Uri = $Uri
            Method = $Method
            UseDefaultCredentials = $true
            TimeoutSec = 30
        }
        if ($Method -eq 'POST') {
            $parameters.ContentType = 'application/json'
            $parameters.Body = $Body
        }
        Invoke-RestMethod @parameters | Out-Null
        return 200
    }
    catch {
        return [int]$_.Exception.Response.StatusCode
    }
}

$status = Invoke-RestMethod (
    "$base/api/platform/refresh-center/v1/status") `
    -UseDefaultCredentials -TimeoutSec 30
$datasets = @($status.datasets)
$byId = @{}
foreach ($dataset in $datasets) {
    $byId[$dataset.datasetId] = $dataset
}
$runResponse =
    Invoke-RestMethod "$base/api/platform/refresh-center/v1/runs" `
        -UseDefaultCredentials -TimeoutSec 30
$runs =
    if ($null -ne $runResponse.PSObject.Properties['value']) {
        @($runResponse.PSObject.Properties['value'].Value)
    }
    else {
        @($runResponse)
    }

Test-Check 'contract' (
    $status.contractVersion -ceq 'platform-refresh-center-v1')
Test-Check 'registry version' ($status.registryVersion -ceq '1.1.0')
Test-Check 'platform ready' ($status.overallPlatformState -ceq 'Ready')
Test-Check 'readiness v2' (
    $status.liveApiContractVersion -ceq 'live-readiness-v2')
Test-Check 'twelve datasets' ($datasets.Count -eq 12)
Test-Check 'no running operation' (
    @($status.runningOperations).Count -eq 0)
Test-Check 'frontend reachable' (
    $status.sharedRuntimeHealth.frontend -ceq 'Reachable')
Test-Check 'live API reachable' (
    $status.sharedRuntimeHealth.liveApi -ceq 'Reachable')
Test-Check 'control host ready' (
    $status.sharedRuntimeHealth.refreshControlHost -ceq 'Ready')
Test-Check 'core ImportRunId' (
    $byId['work-order'].activeImportRunId -ceq
        '27f0ed25-adcc-46aa-96f4-f0cc7d6ae8b6')
Test-Check 'BOM count' (
    $byId['bill-of-material'].rowCounts.BillOfMaterial -eq 1290)
Test-Check 'inventory count' (
    $byId['inventory-item'].rowCounts.InventoryItem -eq 28662)
Test-Check 'work order count' (
    $byId['work-order'].rowCounts.WorkOrder -eq 12113)
Test-Check 'GL count' (
    $byId['general-ledger-account'].rowCounts.GeneralLedgerAccount -eq 257)
Test-Check 'sales order count' (
    $byId['sales-order'].rowCounts.SalesOrder -eq 105)
Test-Check 'invoice counts' (
    $byId['invoice-history'].rowCounts.customerInvoiceCount -eq 19092 -and
    $byId['invoice-history'].rowCounts.customerInvoiceLineCount -eq 26036)
Test-Check 'customer counts' (
    $byId['customer-master'].rowCounts.customerCount -eq 380)
Test-Check 'vendor counts' (
    $byId['vendor-master'].rowCounts.vendorCount -eq 805)
Test-Check 'purchase order counts' (
    $byId['purchase-order'].rowCounts.headerCount -eq 518 -and
    $byId['purchase-order'].rowCounts.lineCount -eq 1384)
Test-Check 'receiving counts' (
    $byId['receiving-history'].rowCounts.headerCount -eq 39564 -and
    $byId['receiving-history'].rowCounts.lineCount -eq 189272)
Test-Check 'employee counts' (
    $byId['employee-reference'].rowCounts.employeeCount -eq 11)
Test-Check 'code count' (
    $byId['reference-code'].rowCounts.referenceCodeCount -eq 1209)
Test-Check 'six pending warnings' (@($status.warnings).Count -eq 6)
Test-Check 'PO refresh disabled' (
    -not $byId['purchase-order'].supportsRoutineRefresh)
Test-Check 'receiving refresh disabled' (
    -not $byId['receiving-history'].supportsRoutineRefresh)
Test-Check 'invoice refresh enabled' (
    $byId['invoice-history'].supportsRoutineRefresh)
Test-Check 'core source check enabled' (
    $byId['work-order'].supportsSourceCheck)
Test-Check 'audit history populated' ($runs.Count -ge 3)
Test-Check 'audit identity' (
    @($runs | Where-Object requestedBy -eq 'DLE-OS-HOST\DLE-OS').Count -ge 3)
Test-Check 'audit force full false' (
    @($runs | Where-Object forceFullIntent).Count -eq 0)
Test-Check 'unsupported bounded' (
    (Get-HttpStatus (
        "$base/api/platform/refresh-center/v1/datasets/" +
        'purchase-order/refresh') 'POST' '{}') -eq 409)
Test-Check 'unconfirmed force full denied' (
    (Get-HttpStatus "$base/api/platform/refresh-center/v1/core/force-full" `
        'POST' '{"forceFullIntent":false}') -eq 400)
$anonymous = [int](& curl.exe -s -o NUL -w '%{http_code}' (
    "$base/api/platform/refresh-center/v1/status"))
Test-Check 'anonymous denied' ($anonymous -eq 401)

$failed = @($checks | Where-Object { -not $_.Passed })
$checks | ForEach-Object {
    '{0} | {1}' -f ($(if ($_.Passed) { 'PASS' } else { 'FAIL' })), $_.Name
}
"TOTAL=$($checks.Count) PASS=$($checks.Count - $failed.Count) FAIL=$($failed.Count)"
if ($failed.Count -ne 0) {
    exit 1
}

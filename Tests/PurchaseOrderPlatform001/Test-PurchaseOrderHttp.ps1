[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$artifactRoot = Join-Path $repository (
    'Artifacts\PurchaseOrderPlatform001\' +
    'PURCHASEORDERPLATFORM001-20260729T212157Z')
$package = Join-Path $artifactRoot 'BaselinePackage'
$base = 'http://DLE-OS-HOST:5042/api/platform/live/v1/purchase-orders'
$historicalBase = 'http://DLE-OS-HOST:5041/api/platform/v1'
$metadataExpected = Get-Content -Raw (
    Join-Path $package 'metadata.json') | ConvertFrom-Json
$allLines = @(Import-Csv (Join-Path $package 'PurchaseOrderLine.csv'))
$allHeaders = @(Import-Csv (Join-Path $package 'PurchaseOrder.csv'))
$sample = $allLines |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.ItemNumber) } |
    Select-Object -First 1
$assertions = [Collections.Generic.List[object]]::new()

function Assert-True {
    param([bool] $Condition, [string] $Name, [string] $Evidence)
    $assertions.Add([ordered]@{
        Name = $Name
        Passed = $Condition
        Evidence = $Evidence
    })
    if (-not $Condition) { throw "$Name failed: $Evidence" }
}

function Get-ExpectedStatus {
    param([string] $Uri, [string] $Method = 'GET')
    try {
        $response = Invoke-WebRequest -Uri $Uri -Method $Method `
            -UseBasicParsing -TimeoutSec 10
        return [int]$response.StatusCode
    }
    catch {
        if ($null -ne $_.Exception.Response) {
            return [int]$_.Exception.Response.StatusCode
        }
        throw
    }
}

$timer = [Diagnostics.Stopwatch]::StartNew()
$metadata = Invoke-RestMethod "$base/metadata" -TimeoutSec 10
$metadataMs = $timer.Elapsed.TotalMilliseconds
Assert-True (
    $metadata.headerCount -eq $metadataExpected.HeaderCount
) 'metadata-header-count' "count=$($metadata.headerCount)"
Assert-True (
    $metadata.lineCount -eq $metadataExpected.LineCount
) 'metadata-line-count' "count=$($metadata.lineCount)"
Assert-True (
    $metadata.sourceQualificationRunId -eq
        $metadataExpected.HarnessAttemptId
) 'metadata-source-run' ([string]$metadata.sourceQualificationRunId)

$timer.Restart()
$page = Invoke-RestMethod "${base}?page=1&pageSize=25" -TimeoutSec 10
$pageMs = $timer.Elapsed.TotalMilliseconds
Assert-True (
    $page.totalItems -eq $metadataExpected.LineCount
) 'list-total' "total=$($page.totalItems)"
Assert-True ($page.items.Count -eq 25) 'list-page-size' (
    "rows=$($page.items.Count)")
$pageTwo = Invoke-RestMethod "${base}?page=2&pageSize=25" -TimeoutSec 10
Assert-True (
    $pageTwo.items.Count -eq 25 -and
    $pageTwo.items[0].purchaseOrderLineId -ne
        $page.items[0].purchaseOrderLineId
) 'pagination-page-two' "first=$($pageTwo.items[0].purchaseOrderLineId)"

$poUnpadded = $sample.PurchaseOrderNumber.TrimStart('0')
if (-not $poUnpadded) { $poUnpadded = '0' }
$poFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&purchaseOrderNumber=$poUnpadded") `
    -TimeoutSec 10
Assert-True (
    $poFilter.totalItems -ge 1 -and
    $poFilter.items[0].purchaseOrderNumber -eq $sample.PurchaseOrderNumber
) 'purchase-order-leading-zero-normalization' (
    "rows=$($poFilter.totalItems)")
$poPadded = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&purchaseOrderNumber=" +
    $sample.PurchaseOrderNumber) -TimeoutSec 10
Assert-True (
    $poPadded.totalItems -eq $poFilter.totalItems
) 'purchase-order-padded-exact' "rows=$($poPadded.totalItems)"

$vendorUnpadded = $sample.VendorNumber.TrimStart('0')
if (-not $vendorUnpadded) { $vendorUnpadded = '0' }
$vendorFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&vendorNumber=$vendorUnpadded") `
    -TimeoutSec 10
Assert-True (
    $vendorFilter.totalItems -ge 1 -and
    $vendorFilter.items[0].vendorNumber -eq $sample.VendorNumber
) 'vendor-leading-zero-normalization' "rows=$($vendorFilter.totalItems)"
$sampleHeader = $allHeaders | Where-Object {
    $_.FirmId -eq $sample.FirmId -and
    $_.VendorNumber -eq $sample.VendorNumber -and
    $_.PurchaseOrderNumber -eq $sample.PurchaseOrderNumber
} | Select-Object -First 1
$vendorNameFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&vendorName=" +
    [uri]::EscapeDataString($sampleHeader.VendorName)) -TimeoutSec 10
Assert-True (
    $vendorNameFilter.totalItems -ge 1
) 'vendor-name-filter' "rows=$($vendorNameFilter.totalItems)"

$itemFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&itemNumber=" +
    [uri]::EscapeDataString($sample.ItemNumber)) -TimeoutSec 10
Assert-True (
    $itemFilter.totalItems -ge 1 -and
    $itemFilter.items[0].itemNumber -eq $sample.ItemNumber
) 'item-exact-filter' "rows=$($itemFilter.totalItems)"

$open = Invoke-RestMethod "${base}?page=1&pageSize=200&openOnly=true" `
    -TimeoutSec 10
Assert-True (
    $open.items.Count -gt 0 -and
    @($open.items | Where-Object { -not $_.isOpen }).Count -eq 0
) 'open-only-filter' "rows=$($open.totalItems)"
$nonStock = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&lineType=NonStock") -TimeoutSec 10
Assert-True (
    $nonStock.items.Count -gt 0 -and
    @($nonStock.items | Where-Object { $_.lineType -ne 'NonStock' }).Count -eq 0
) 'non-stock-filter' "rows=$($nonStock.totalItems)"
$statusFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&status=Open") -TimeoutSec 10
Assert-True (
    $statusFilter.items.Count -gt 0 -and
    @($statusFilter.items | Where-Object { $_.lineStatus -ne 'Open' }).Count -eq 0
) 'status-filter' "rows=$($statusFilter.totalItems)"

$workOrderSample = $allLines |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.WorkOrderNumber) } |
    Select-Object -First 1
$workOrderUnpadded = $workOrderSample.WorkOrderNumber.TrimStart('0')
if (-not $workOrderUnpadded) { $workOrderUnpadded = '0' }
$workOrderFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&workOrderNumber=$workOrderUnpadded") `
    -TimeoutSec 10
Assert-True (
    $workOrderFilter.totalItems -ge 1 -and
    $workOrderFilter.items[0].workOrderNumber -eq
        $workOrderSample.WorkOrderNumber
) 'work-order-filter' "rows=$($workOrderFilter.totalItems)"

$salesOrderSample = $allLines |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.SalesOrderNumber) } |
    Select-Object -First 1
$salesOrderUnpadded = $salesOrderSample.SalesOrderNumber.TrimStart('0')
if (-not $salesOrderUnpadded) { $salesOrderUnpadded = '0' }
$salesOrderFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&salesOrderNumber=$salesOrderUnpadded") `
    -TimeoutSec 10
Assert-True (
    $salesOrderFilter.totalItems -ge 1 -and
    $salesOrderFilter.items[0].salesOrderNumber -eq
        $salesOrderSample.SalesOrderNumber
) 'sales-order-filter' "rows=$($salesOrderFilter.totalItems)"

$requiredSample = $allLines |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.RequiredDateIso) } |
    Select-Object -First 1
$requiredFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&requiredFrom=" +
    "$($requiredSample.RequiredDateIso)&requiredTo=" +
    $requiredSample.RequiredDateIso) -TimeoutSec 10
Assert-True (
    $requiredFilter.totalItems -ge 1
) 'required-date-range' "rows=$($requiredFilter.totalItems)"

$negativeSample = $allLines |
    Where-Object {
        [decimal]$_.QuantityOrdered -lt 0 -or
        [decimal]$_.QuantityReceived -lt 0 -or
        [decimal]$_.QuantityOpen -lt 0
    } | Select-Object -First 1
$negativePath = (
    "$($negativeSample.FirmId)/$($negativeSample.VendorNumber)/" +
    "$($negativeSample.PurchaseOrderNumber)/lines/" +
    $negativeSample.PurchaseOrderLineNumber)
$negativeDetail = Invoke-RestMethod "$base/$negativePath" -TimeoutSec 10
Assert-True (
    [decimal]$negativeDetail.quantityOrdered -lt 0 -or
    [decimal]$negativeDetail.quantityReceived -lt 0 -or
    [decimal]$negativeDetail.quantityOpen -lt 0
) 'negative-quantity-preserved' (
    "ordered=$($negativeDetail.quantityOrdered);" +
    "received=$($negativeDetail.quantityReceived);" +
    "open=$($negativeDetail.quantityOpen)")

$linePath = (
    "$($sample.FirmId)/$($sample.VendorNumber)/" +
    "$($sample.PurchaseOrderNumber)/lines/" +
    $sample.PurchaseOrderLineNumber)
$detail = Invoke-RestMethod "$base/$linePath" -TimeoutSec 10
$header = Invoke-RestMethod (
    "$base/$($sample.FirmId)/$($sample.VendorNumber)/" +
    $sample.PurchaseOrderNumber) -TimeoutSec 10
$lines = Invoke-RestMethod (
    "$base/$($sample.FirmId)/$($sample.VendorNumber)/" +
    "$($sample.PurchaseOrderNumber)/lines") -TimeoutSec 10
Assert-True (
    $detail.purchaseOrderLineId -eq
        "$($sample.FirmId)$($sample.VendorNumber)" +
        "$($sample.PurchaseOrderNumber)$($sample.PurchaseOrderLineNumber)"
) 'line-detail' ([string]$detail.purchaseOrderLineId)
Assert-True (
    $header.purchaseOrderNumber -eq $sample.PurchaseOrderNumber
) 'header-detail' ([string]$header.purchaseOrderNumber)
Assert-True ($lines.Count -ge 1) 'header-lines' "rows=$($lines.Count)"

$detailJson = $detail | ConvertTo-Json -Depth 5
Assert-True (
    $detailJson -notmatch
        'UnitCost|ExtendedCost|InternalApproval|Accounting'
) 'restricted-fields-absent' 'No restricted properties in API DTO.'
Assert-True (
    (Get-ExpectedStatus "${base}?page=0&pageSize=50") -eq 400
) 'invalid-page' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?page=1&pageSize=201") -eq 400
) 'invalid-page-size' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?page=1&pageSize=50&openOnly=maybe") -eq 400
) 'invalid-boolean' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?page=1&pageSize=50&requiredFrom=07/29/26") -eq 400
) 'invalid-date' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus $base 'POST') -eq 405
) 'write-route-absent' 'POST returned HTTP 405'

$allowed = Invoke-WebRequest "$base/metadata" `
    -Headers @{ Origin = 'http://dle-os-host:5041' } `
    -UseBasicParsing -TimeoutSec 10
$denied = Invoke-WebRequest "$base/metadata" `
    -Headers @{ Origin = 'http://example.invalid' } `
    -UseBasicParsing -TimeoutSec 10
Assert-True (
    $allowed.Headers['Access-Control-Allow-Origin'] -eq
        'http://dle-os-host:5041'
) 'cors-exact-origin' (
    [string]$allowed.Headers['Access-Control-Allow-Origin'])
Assert-True (
    [string]::IsNullOrWhiteSpace(
        [string]$denied.Headers['Access-Control-Allow-Origin'])
) 'cors-arbitrary-origin-denied' 'No allow-origin header.'

$historical = Invoke-RestMethod "$historicalBase/readiness" -TimeoutSec 10
$historicalSnapshot = Invoke-RestMethod "$historicalBase/snapshot" `
    -TimeoutSec 10
Assert-True ($historical.status -eq 'Ready') `
    'historical-readiness' ([string]$historical.status)
Assert-True ($historicalSnapshot.totalCount -eq 26902) `
    'historical-count' "total=$($historicalSnapshot.totalCount)"
Assert-True (
    (Get-ExpectedStatus "$historicalBase/purchase-orders?page=1&pageSize=50") -eq 404
) 'historical-route-isolation' 'HTTP 404; no profile fallback.'

foreach ($port in 5041, 5042, 5043, 5044) {
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort $port `
        -ErrorAction SilentlyContinue)
    $listenerEvidence = if ($listener.Count -gt 0) {
        "pid=$($listener[0].OwningProcess)"
    } else { 'no listener' }
    Assert-True ($listener.Count -gt 0) "port-$port-listening" `
        $listenerEvidence
}

$result = [ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    AssertionsPassed = $assertions.Count
    MetadataLatencyMs = [Math]::Round($metadataMs, 2)
    ListLatencyMs = [Math]::Round($pageMs, 2)
    PurchaseOrderImportRunId = $metadata.purchaseOrderImportRunId
    PackageSha256 = $metadata.packageSha256
    RepresentativeLineId = $detail.purchaseOrderLineId
    Results = $assertions
}
$result | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (
        Join-Path $artifactRoot 'PURCHASE_ORDER_HTTP_TEST_RESULTS.json') `
        -Encoding UTF8
$result | ConvertTo-Json -Depth 8

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$artifactRoot = Join-Path $repository (
    'Artifacts\ReceivingHistoryPlatform001\' +
    'RECEIVINGHISTORYPLATFORM001-20260730T030741Z')
$package = Join-Path $artifactRoot 'BaselinePackage'
$base = 'http://DLE-OS-HOST:5042/api/platform/live/v1/receiving-history'
$metadataExpected = Get-Content -Raw (
    Join-Path $package 'metadata.json') | ConvertFrom-Json
$allLines = @(Import-Csv (Join-Path $package 'PurchaseReceiptLine.csv'))
$sample = $allLines |
    Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.ItemNumber) -and
        -not [string]::IsNullOrWhiteSpace($_.WorkOrderNumber)
    } | Select-Object -First 1
$assertions = [Collections.Generic.List[object]]::new()

function Assert-True {
    param([bool] $Condition, [string] $Name, [string] $Evidence)
    $assertions.Add([ordered]@{
        Name = $Name; Passed = $Condition; Evidence = $Evidence
    })
    if (-not $Condition) { throw "$Name failed: $Evidence" }
}

function Get-ExpectedStatus {
    param([string] $Uri, [string] $Method = 'GET')
    try {
        return [int](Invoke-WebRequest -Uri $Uri -Method $Method `
            -UseBasicParsing -TimeoutSec 10).StatusCode
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
    $metadata.headerCount -eq $metadataExpected.Counts.PurchaseReceipt
) 'metadata-header-count' "count=$($metadata.headerCount)"
Assert-True (
    $metadata.lineCount -eq $metadataExpected.Counts.PurchaseReceiptLine
) 'metadata-line-count' "count=$($metadata.lineCount)"
Assert-True (
    $metadata.rejectionCount -eq $metadataExpected.Counts.ReceiptRejection
) 'metadata-rejection-count' "count=$($metadata.rejectionCount)"
Assert-True (
    $metadata.missingPurchaseOrderCount -eq 1
) 'metadata-missing-po-count' "count=$($metadata.missingPurchaseOrderCount)"
Assert-True (
    $metadata.malformedOrderDateCount -eq 5 -and
    $metadata.malformedReceiptDateCount -eq 1 -and
    $metadata.malformedRequiredDateCount -eq 26
) 'metadata-field-date-counts' (
    "order=$($metadata.malformedOrderDateCount);" +
    "receipt=$($metadata.malformedReceiptDateCount);" +
    "required=$($metadata.malformedRequiredDateCount)")

$timer.Restart()
$page = Invoke-RestMethod "${base}?page=1&pageSize=25" -TimeoutSec 10
$pageMs = $timer.Elapsed.TotalMilliseconds
Assert-True (
    $page.totalItems -eq $metadataExpected.Counts.PurchaseReceiptLine
) 'list-total' "total=$($page.totalItems)"
Assert-True ($page.items.Count -eq 25) 'list-page-size' (
    "rows=$($page.items.Count)")
$pageTwo = Invoke-RestMethod "${base}?page=2&pageSize=25" -TimeoutSec 10
Assert-True (
    $pageTwo.items.Count -eq 25 -and
    $pageTwo.items[0].purchaseReceiptLineId -ne
        $page.items[0].purchaseReceiptLineId
) 'pagination-page-two' "first=$($pageTwo.items[0].purchaseReceiptLineId)"

$receiverUnpadded = $sample.ReceiverNumber.TrimStart('0')
if (-not $receiverUnpadded) { $receiverUnpadded = '0' }
$receiver = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&receiverNumber=$receiverUnpadded") `
    -TimeoutSec 10
Assert-True (
    $receiver.totalItems -ge 1 -and
    @($receiver.items | Where-Object {
        $_.receiverNumber -ne $sample.ReceiverNumber
    }).Count -eq 0
) 'receiver-leading-zero-normalization' "rows=$($receiver.totalItems)"

$poUnpadded = $sample.PurchaseOrderNumber.TrimStart('0')
if (-not $poUnpadded) { $poUnpadded = '0' }
$po = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&purchaseOrderNumber=$poUnpadded") `
    -TimeoutSec 10
Assert-True (
    $po.totalItems -ge 1 -and
    @($po.items | Where-Object {
        $_.purchaseOrderNumber -ne $sample.PurchaseOrderNumber
    }).Count -eq 0
) 'purchase-order-filter' "rows=$($po.totalItems)"

$vendor = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&vendorNumber=" +
    $sample.VendorNumber.TrimStart('0')) -TimeoutSec 10
Assert-True (
    $vendor.totalItems -ge 1
) 'vendor-filter' "rows=$($vendor.totalItems)"
$item = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&itemNumber=" +
    [uri]::EscapeDataString($sample.ItemNumber)) -TimeoutSec 10
Assert-True (
    $item.totalItems -ge 1 -and
    $item.items[0].itemNumber -eq $sample.ItemNumber
) 'item-exact-filter' "rows=$($item.totalItems)"
$workOrder = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&workOrderNumber=" +
    $sample.WorkOrderNumber.TrimStart('0')) -TimeoutSec 10
Assert-True (
    $workOrder.totalItems -ge 1
) 'work-order-filter' "rows=$($workOrder.totalItems)"

$dated = $allLines |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.ReceiptDateIso) } |
    Select-Object -First 1
$datePage = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&receiptFrom=$($dated.ReceiptDateIso)" +
    "&receiptTo=$($dated.ReceiptDateIso)") -TimeoutSec 10
Assert-True ($datePage.totalItems -ge 1) 'receipt-date-filter' (
    "rows=$($datePage.totalItems)")

$negative = $allLines |
    Where-Object { [decimal]$_.QuantityPostedSigned -lt 0 } |
    Select-Object -First 1
$negativePage = Invoke-RestMethod (
    "${base}?page=1&pageSize=200&returnedOnly=true") -TimeoutSec 10
Assert-True (
    $null -ne $negative -and $negativePage.totalItems -ge 1 -and
    @($negativePage.items | Where-Object {
        [decimal]$_.quantityPostedSigned -ge 0 -or
        [decimal]$_.quantityReturned -le 0
    }).Count -eq 0
) 'negative-receipt-filter' "rows=$($negativePage.totalItems)"

$detail = Invoke-RestMethod "$base/$($sample.SourceRecordIdentity)" `
    -TimeoutSec 10
Assert-True (
    $detail.itemNumber -eq $sample.ItemNumber -and
    $detail.receivingHistoryImportRunId -eq
        $metadata.receivingHistoryImportRunId
) 'detail-parity' ([string]$detail.purchaseReceiptLineId)
$detailJson = $detail | ConvertTo-Json -Depth 5
Assert-True (
    $detailJson -notmatch 'UnitCost|ExtendedCost|LandedCost|CostVariance'
) 'restricted-fields-absent' 'No restricted properties in API DTO.'

$missingPoSource = $allLines |
    Where-Object {
        [string]::IsNullOrWhiteSpace($_.PurchaseOrderNumber)
    } | Select-Object -First 1
$missingPoPage = Invoke-RestMethod (
    "${base}?page=1&pageSize=10&receiverNumber=30511") -TimeoutSec 10
Assert-True (
    $null -ne $missingPoSource -and
    $missingPoPage.totalItems -eq 1 -and
    $null -eq $missingPoPage.items[0].purchaseOrderNumber -and
    $missingPoPage.items[0].purchaseOrderResolutionStatus -eq
        'MissingRequiredSourceValue'
) 'missing-po-list-contract' "rows=$($missingPoPage.totalItems)"
$missingPoDetail = Invoke-RestMethod (
    "$base/$($missingPoSource.SourceRecordIdentity)") -TimeoutSec 10
Assert-True (
    $null -eq $missingPoDetail.purchaseOrderNumber -and
    $missingPoDetail.purchaseOrderResolutionStatus -eq
        'MissingRequiredSourceValue'
) 'missing-po-detail-contract' (
    [string]$missingPoDetail.purchaseReceiptLineId)

$malformedReceipt = Import-Csv (
    Join-Path $package 'MalformedReceiptDate.csv') | Select-Object -First 1
$malformedReceiptLine = $allLines | Where-Object {
    $_.PurchaseReceiptSourceRecordIdentity -eq
        $malformedReceipt.HeaderSourceRecordIdentity
} | Select-Object -First 1
$malformedReceiptDetail = Invoke-RestMethod (
    "$base/$($malformedReceiptLine.SourceRecordIdentity)") -TimeoutSec 10
Assert-True (
    $null -eq $malformedReceiptDetail.receiptDateIso -and
    $malformedReceiptDetail.receiptDateRaw -eq 'D01129' -and
    $malformedReceiptDetail.receiptDateResolutionStatus -eq
        'InvalidSourceValue'
) 'malformed-receipt-date-api-contract' (
    [string]$malformedReceiptDetail.purchaseReceiptLineId)

$malformedRequired = Import-Csv (
    Join-Path $package 'MalformedRequiredDate.csv') | Select-Object -First 1
$malformedRequiredDetail = Invoke-RestMethod (
    "$base/$($malformedRequired.LineSourceRecordIdentity)") -TimeoutSec 10
Assert-True (
    $null -eq $malformedRequiredDetail.requiredDateIso -and
    $malformedRequiredDetail.requiredDateRaw -eq
        $malformedRequired.RequiredDateRaw -and
    $malformedRequiredDetail.requiredDateResolutionStatus -eq
        'InvalidSourceValue'
) 'malformed-required-date-api-contract' (
    [string]$malformedRequiredDetail.purchaseReceiptLineId)

Assert-True (
    (Get-ExpectedStatus "${base}?page=0&pageSize=50") -eq 400
) 'invalid-page' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?page=1&pageSize=201") -eq 400
) 'invalid-page-size' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?receiptFrom=07/29/26") -eq 400
) 'invalid-date' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?returnedOnly=maybe") -eq 400
) 'invalid-boolean' 'HTTP 400'
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

$historical = Invoke-RestMethod (
    'http://DLE-OS-HOST:5041/api/platform/v1/readiness') -TimeoutSec 10
Assert-True ($historical.status -eq 'Ready') `
    'historical-readiness' ([string]$historical.status)
Assert-True (
    (Get-ExpectedStatus (
        'http://DLE-OS-HOST:5041/api/platform/v1/receiving-history')) -eq 404
) 'historical-route-isolation' 'HTTP 404; no profile fallback.'

$result = [ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    AssertionsPassed = $assertions.Count
    MetadataLatencyMs = [Math]::Round($metadataMs, 2)
    ListLatencyMs = [Math]::Round($pageMs, 2)
    ReceivingHistoryImportRunId = $metadata.receivingHistoryImportRunId
    PackageSha256 = $metadata.packageSha256
    RepresentativeLineId = $detail.purchaseReceiptLineId
    Results = $assertions
}
$result | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (
        Join-Path $artifactRoot 'RECEIVING_HISTORY_HTTP_TEST_RESULTS.json') `
        -Encoding UTF8
$result | ConvertTo-Json -Depth 8

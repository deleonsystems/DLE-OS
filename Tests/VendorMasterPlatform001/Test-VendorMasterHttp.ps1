[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$base = 'http://DLE-OS-HOST:5042/api/platform/live/v1/vendor-master'
$historicalBase = 'http://DLE-OS-HOST:5041/api/platform/v1'
$artifact = (
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
    'VendorMasterPlatform001\' +
    'VENDORMASTERPLATFORM001-20260729T200737Z\' +
    'VENDOR_MASTER_HTTP_TEST_RESULTS.json')
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
    param([string] $Uri, [int] $StatusCode, [string] $Method = 'GET')
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
Assert-True ($metadata.vendorCount -eq 805) 'metadata-vendor-count' (
    "count=$($metadata.vendorCount)")
Assert-True ($metadata.vendorAddressCount -eq 106) `
    'metadata-address-count' "count=$($metadata.vendorAddressCount)"
Assert-True ($metadata.orphanAddressCount -eq 1) `
    'metadata-orphan-count' "count=$($metadata.orphanAddressCount)"
Assert-True (
    $metadata.vendorMasterImportRunId -eq
    'c5fb45a4-ef13-4d7f-ae16-9bcac4945571'
) 'metadata-import-run' ([string]$metadata.vendorMasterImportRunId)
Assert-True (
    $metadata.packageSha256 -eq
    '15BA2F0152940D80DDF7AF7B88427D8E8A9850931983B290785C79FCDD527FE7'
) 'metadata-package-hash' $metadata.packageSha256

$timer.Restart()
$page = Invoke-RestMethod "${base}?page=1&pageSize=25" -TimeoutSec 10
$pageMs = $timer.Elapsed.TotalMilliseconds
Assert-True ($page.totalItems -eq 805) 'list-total' "total=$($page.totalItems)"
Assert-True ($page.items.Count -eq 25) 'list-page-size' "rows=$($page.items.Count)"
Assert-True ($page.totalPages -eq 33) 'list-total-pages' (
    "pages=$($page.totalPages)")

$unpadded = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&vendorNumber=34") -TimeoutSec 10
$padded = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&vendorNumber=000034") -TimeoutSec 10
Assert-True (
    $unpadded.totalItems -eq 1 -and
    $unpadded.items[0].vendorNumber -eq '000034'
) 'vendor-number-unpadded' "rows=$($unpadded.totalItems)"
Assert-True (
    $padded.totalItems -eq 1 -and
    $padded.items[0].vendorName -eq 'WALKER COMPONENT GROUP'
) 'vendor-number-padded' "rows=$($padded.totalItems)"

$name = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&vendorName=WALKER") -TimeoutSec 10
$postal = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&postalCode=802010359") -TimeoutSec 10
$terms = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&paymentTermsCode=01") -TimeoutSec 10
Assert-True ($name.totalItems -ge 1) 'vendor-name-filter' (
    "rows=$($name.totalItems)")
Assert-True ($postal.totalItems -ge 1) 'postal-code-filter' (
    "rows=$($postal.totalItems)")
Assert-True ($terms.totalItems -ge 1) 'payment-terms-filter' (
    "rows=$($terms.totalItems)")

$detail = Invoke-RestMethod "$base/01000034" -TimeoutSec 10
$addresses = Invoke-RestMethod "$base/01000034/addresses" -TimeoutSec 10
Assert-True (
    $detail.vendorNumber -eq '000034' -and
    $detail.vendorName -eq 'WALKER COMPONENT GROUP' -and
    $detail.primaryContactName -eq 'TOM' -and
    $detail.paymentTermsDescription -eq 'NET 30 DAYS' -and
    $detail.purchasingAddressCount -eq 3
) 'known-vendor-detail' (
    "$($detail.vendorName); $($detail.primaryContactName)")
Assert-True ($addresses.Count -eq 3) 'purchasing-address-detail' (
    "rows=$($addresses.Count)")

$json = $detail | ConvertTo-Json -Depth 5
Assert-True (
    $json -notmatch
    'Credit|FederalTax|HoldInvoices|Print1099|GlAccount|LastInvoice|' +
    'LastPayment|Comment|AccountingNumeric|VendorAccount|Fax'
) 'restricted-fields-absent' 'No restricted property names in DTO.'
Assert-True (
    (Get-ExpectedStatus "${base}?page=0&pageSize=50" 400) -eq 400
) 'invalid-page' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?page=1&pageSize=201" 400) -eq 400
) 'invalid-page-size' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus $base 405 'POST') -eq 405
) 'write-endpoint-absent' 'POST returned HTTP 405'

$allowed = Invoke-WebRequest "$base/metadata" `
    -Headers @{ Origin = 'http://dle-os-host:5041' } `
    -UseBasicParsing -TimeoutSec 10
$denied = Invoke-WebRequest "$base/metadata" `
    -Headers @{ Origin = 'http://example.invalid' } `
    -UseBasicParsing -TimeoutSec 10
Assert-True (
    $allowed.Headers['Access-Control-Allow-Origin'] -eq
    'http://dle-os-host:5041'
) 'cors-exact-origin' ([string]$allowed.Headers['Access-Control-Allow-Origin'])
Assert-True (
    [string]::IsNullOrWhiteSpace(
        [string]$denied.Headers['Access-Control-Allow-Origin'])
) 'cors-arbitrary-origin-denied' 'No allow-origin header.'

$historicalReadiness = Invoke-RestMethod "$historicalBase/readiness" `
    -TimeoutSec 10
$historicalSnapshot = Invoke-RestMethod "$historicalBase/snapshot" `
    -TimeoutSec 10
Assert-True ($historicalReadiness.status -eq 'Ready') `
    'historical-readiness' $historicalReadiness.status
Assert-True ($historicalSnapshot.totalCount -eq 26902) `
    'historical-count' "total=$($historicalSnapshot.totalCount)"
Assert-True (
    (Get-ExpectedStatus (
        "$historicalBase/vendor-master?page=1&pageSize=50") 404) -eq 404
) 'historical-vendor-route-absent' 'HTTP 404; no cross-profile fallback.'

$result = [ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    AssertionsPassed = $assertions.Count
    MetadataLatencyMs = [Math]::Round($metadataMs, 2)
    ListLatencyMs = [Math]::Round($pageMs, 2)
    VendorMasterImportRunId = $metadata.vendorMasterImportRunId
    PackageSha256 = $metadata.packageSha256
    Results = $assertions
}
$result | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $artifact -Encoding UTF8
$result | ConvertTo-Json -Depth 8

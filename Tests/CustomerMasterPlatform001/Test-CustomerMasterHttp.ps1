[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$base = 'http://DLE-OS-HOST:5042/api/platform/live/v1/customer-master'
$historicalBase = 'http://DLE-OS-HOST:5041/api/platform/v1'
$artifact = (
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
    'CustomerMasterPlatform001\' +
    'CUSTOMERMASTERPLATFORM001-20260729T170951Z\' +
    'CUSTOMER_MASTER_HTTP_TEST_RESULTS.json')
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
Assert-True ($metadata.customerCount -eq 380) 'metadata-customer-count' (
    "count=$($metadata.customerCount)")
Assert-True ($metadata.customerAddressCount -eq 28) `
    'metadata-address-count' "count=$($metadata.customerAddressCount)"
Assert-True ($metadata.orphanAddressCount -eq 1) `
    'metadata-orphan-count' "count=$($metadata.orphanAddressCount)"
Assert-True (
    $metadata.customerMasterImportRunId -eq
    'b3ec1b7c-7806-49f5-b589-62ddb093e6a8'
) 'metadata-import-run' ([string]$metadata.customerMasterImportRunId)
Assert-True (
    $metadata.packageSha256 -eq
    '926160D5BFBEAD171BE6DA481016B6810DF20BE6CA7577EF82AA8421C173D608'
) 'metadata-package-hash' $metadata.packageSha256

$timer.Restart()
$page = Invoke-RestMethod "${base}?page=1&pageSize=25" -TimeoutSec 10
$pageMs = $timer.Elapsed.TotalMilliseconds
Assert-True ($page.totalItems -eq 380) 'list-total' "total=$($page.totalItems)"
Assert-True ($page.items.Count -eq 25) 'list-page-size' "rows=$($page.items.Count)"
Assert-True ($page.totalPages -eq 16) 'list-total-pages' (
    "pages=$($page.totalPages)")

$unpadded = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&customerNumber=1148") -TimeoutSec 10
$padded = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&customerNumber=001148") -TimeoutSec 10
Assert-True (
    $unpadded.totalItems -eq 1 -and
    $unpadded.items[0].customerNumber -eq '001148'
) 'customer-number-unpadded' "rows=$($unpadded.totalItems)"
Assert-True (
    $padded.totalItems -eq 1 -and
    $padded.items[0].customerName -eq 'HUGHEY & PHILLIPS'
) 'customer-number-padded' "rows=$($padded.totalItems)"

$name = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&customerName=HUGHEY") -TimeoutSec 10
$postal = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&postalCode=43078") -TimeoutSec 10
$salesperson = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&salespersonCode=001") -TimeoutSec 10
$territory = Invoke-RestMethod (
    "${base}?page=1&pageSize=50&territoryCode=001") -TimeoutSec 10
Assert-True ($name.totalItems -ge 1) 'customer-name-filter' (
    "rows=$($name.totalItems)")
Assert-True ($postal.totalItems -ge 1) 'postal-code-filter' (
    "rows=$($postal.totalItems)")
Assert-True ($salesperson.totalItems -ge 1) 'salesperson-filter' (
    "rows=$($salesperson.totalItems)")
Assert-True ($territory.totalItems -ge 1) 'territory-filter' (
    "rows=$($territory.totalItems)")

$detail = Invoke-RestMethod "$base/01001148" -TimeoutSec 10
$addresses = Invoke-RestMethod "$base/01001148/addresses" -TimeoutSec 10
Assert-True (
    $detail.customerNumber -eq '001148' -and
    $detail.salespersonName -eq 'RAY PAYNE' -and
    $detail.paymentTermsDescription -eq 'NET 60' -and
    $detail.territoryName -eq 'SOUTHERN CALIFORNIA'
) 'known-customer-detail' (
    "$($detail.customerName); $($detail.salespersonName)")
Assert-True ($addresses.Count -eq 1) 'alternate-address-detail' (
    "rows=$($addresses.Count)")

$json = $detail | ConvertTo-Json -Depth 5
Assert-True (
    $json -notmatch
    'Credit|Tax|Resale|Dunn|Sic|Comment|PaymentSummary|Aging'
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
        "$historicalBase/customer-master?page=1&pageSize=50") 404) -eq 404
) 'historical-customer-route-absent' 'HTTP 404; no cross-profile fallback.'

$result = [ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    AssertionsPassed = $assertions.Count
    MetadataLatencyMs = [Math]::Round($metadataMs, 2)
    ListLatencyMs = [Math]::Round($pageMs, 2)
    CustomerMasterImportRunId = $metadata.customerMasterImportRunId
    PackageSha256 = $metadata.packageSha256
    Results = $assertions
}
$result | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $artifact -Encoding UTF8
$result | ConvertTo-Json -Depth 8

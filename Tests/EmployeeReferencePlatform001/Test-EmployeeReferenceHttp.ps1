[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$artifactRoot = Join-Path $repository (
    'Artifacts\EmployeeReferencePlatform001\' +
    'EMPLOYEEREFERENCEPLATFORM001-20260730T122647Z')
$package = Join-Path $artifactRoot 'BaselinePackage'
$base = 'http://DLE-OS-HOST:5042/api/platform/live/v1/employee-reference'
$expected = Get-Content -Raw (Join-Path $package 'metadata.json') |
    ConvertFrom-Json
$packageEmployees = @(Import-Csv (
    Join-Path $package 'EmployeeReference.csv'))
$packageCodes = @(Import-Csv (
    Join-Path $package 'EmployeeOperationalCode.csv'))
$sample = $packageEmployees | Select-Object -First 1
$resolvedCode = $packageCodes | Where-Object {
    $_.ResolutionStatus -eq 'ResolvedUnique'
} | Select-Object -First 1
$assertions = [Collections.Generic.List[object]]::new()

function Assert-True {
    param([bool]$Condition, [string]$Name, [string]$Evidence)
    $assertions.Add([ordered]@{
        Name = $Name; Passed = $Condition; Evidence = $Evidence
    })
    if (-not $Condition) { throw "$Name failed: $Evidence" }
}

function Get-ExpectedStatus {
    param([string]$Uri, [string]$Method = 'GET')
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
    $metadata.employeeCount -eq $expected.counts.EmployeeReference
) 'metadata-employee-count' "count=$($metadata.employeeCount)"
Assert-True (
    $metadata.operationalCodeCount -eq
        $expected.counts.EmployeeOperationalCode
) 'metadata-code-count' "count=$($metadata.operationalCodeCount)"
Assert-True (
    $metadata.departmentCount -eq $expected.counts.DepartmentReference -and
    $metadata.jobTitleCount -eq $expected.counts.JobTitleReference
) 'metadata-reference-counts' (
    "departments=$($metadata.departmentCount);titles=$($metadata.jobTitleCount)")
Assert-True (
    $metadata.packageSha256 -eq
        (Get-Content -Raw (Join-Path $package 'package.sha256')).Trim()
) 'metadata-package-hash' ([string]$metadata.packageSha256)

$timer.Restart()
$page = Invoke-RestMethod "${base}?page=1&pageSize=5" -TimeoutSec 10
$pageMs = $timer.Elapsed.TotalMilliseconds
Assert-True (
    $page.totalItems -eq $expected.counts.EmployeeReference -and
    $page.items.Count -eq 5
) 'list-count-and-page-size' (
    "total=$($page.totalItems);rows=$($page.items.Count)")
$pageTwo = Invoke-RestMethod "${base}?page=2&pageSize=5" -TimeoutSec 10
Assert-True (
    $pageTwo.items.Count -eq 5 -and
    $pageTwo.items[0].employeeReferenceId -ne
        $page.items[0].employeeReferenceId
) 'pagination-page-two' ([string]$pageTwo.items[0].employeeReferenceId)

$unpadded = $sample.EmployeeNumber.TrimStart('0')
if (-not $unpadded) { $unpadded = '0' }
$employeeNumber = Invoke-RestMethod (
    "${base}?page=1&pageSize=25&employeeNumber=$unpadded") -TimeoutSec 10
Assert-True (
    $employeeNumber.totalItems -eq 1 -and
    $employeeNumber.items[0].employeeNumber -eq $sample.EmployeeNumber
) 'employee-leading-zero-normalization' (
    [string]$employeeNumber.items[0].employeeNumber)
$name = Invoke-RestMethod (
    "${base}?page=1&pageSize=25&employeeName=" +
    [uri]::EscapeDataString($sample.FirstName)) -TimeoutSec 10
Assert-True ($name.totalItems -ge 1) 'employee-name-filter' (
    "rows=$($name.totalItems)")
$department = Invoke-RestMethod (
    "${base}?page=1&pageSize=25&department=" +
    [uri]::EscapeDataString($sample.DepartmentCode)) -TimeoutSec 10
Assert-True ($department.totalItems -ge 1) 'department-filter' (
    "rows=$($department.totalItems)")
$title = Invoke-RestMethod (
    "${base}?page=1&pageSize=25&jobTitle=" +
    [uri]::EscapeDataString($sample.JobTitleCode)) -TimeoutSec 10
Assert-True ($title.totalItems -ge 1) 'job-title-filter' (
    "rows=$($title.totalItems)")
$active = Invoke-RestMethod (
    "${base}?page=1&pageSize=25&isActive=true") -TimeoutSec 10
Assert-True (
    $active.totalItems -eq $expected.counts.ActiveEmployees
) 'active-filter' "rows=$($active.totalItems)"
$codeFilter = Invoke-RestMethod (
    "${base}?page=1&pageSize=25&operationalCode=" +
    [uri]::EscapeDataString($resolvedCode.OperationalCode) +
    "&codeType=$($resolvedCode.CodeType)") -TimeoutSec 10
Assert-True (
    $codeFilter.totalItems -eq 1 -and
    $codeFilter.items[0].employeeNumber -eq $resolvedCode.EmployeeNumber
) 'operational-code-filter' "rows=$($codeFilter.totalItems)"

$detailId = "$($sample.FirmId)$($sample.EmployeeNumber)"
$detail = Invoke-RestMethod "$base/$detailId" -TimeoutSec 10
Assert-True (
    $detail.employeeReferenceId -eq $detailId -and
    $detail.employeeReferenceImportRunId -eq
        $metadata.employeeReferenceImportRunId
) 'detail-parity' $detailId
$codesResponse = Invoke-WebRequest "$base/$detailId/codes" `
    -UseBasicParsing -TimeoutSec 10
$codes = @($codesResponse.Content | ConvertFrom-Json)
$codeCount = if ($codesResponse.Content.Trim() -eq '[]') {
    0
} else {
    $codes.Count
}
Assert-True (
    $codeCount -eq [int]$detail.operationalCodeCount
) 'detail-code-count' "codes=$codeCount"
$apiJson = @($metadata, $page, $detail, $codes) |
    ConvertTo-Json -Depth 8
Assert-True (
    $apiJson -notmatch (
        'SocialSecurity|TaxId|PayRate|Salary|Bank|Routing|Deduction|' +
        'Withholding|BirthDate|HomeAddress|Password|PIN')
) 'restricted-fields-absent' 'No restricted properties in API responses.'

Assert-True (
    (Get-ExpectedStatus "${base}?page=0&pageSize=50") -eq 400
) 'invalid-page' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?page=1&pageSize=201") -eq 400
) 'invalid-page-size' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?isActive=maybe") -eq 400
) 'invalid-boolean' 'HTTP 400'
Assert-True (
    (Get-ExpectedStatus "${base}?codeType=Payroll") -eq 400
) 'invalid-code-type' 'HTTP 400'
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
        'http://DLE-OS-HOST:5041/api/platform/v1/employee-reference')) -eq 404
) 'historical-route-isolation' 'HTTP 404; no profile fallback.'

$result = [ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    AssertionsPassed = $assertions.Count
    MetadataLatencyMs = [Math]::Round($metadataMs, 2)
    ListLatencyMs = [Math]::Round($pageMs, 2)
    EmployeeReferenceImportRunId = $metadata.employeeReferenceImportRunId
    PackageSha256 = $metadata.packageSha256
    RepresentativeEmployeeId = $detail.employeeReferenceId
    Results = $assertions
}
$result | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (
        Join-Path $artifactRoot 'EMPLOYEE_REFERENCE_HTTP_TEST_RESULTS.json') `
        -Encoding UTF8
$result | ConvertTo-Json -Depth 8

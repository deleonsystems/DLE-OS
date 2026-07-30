[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$root = Join-Path $repository (
    'Artifacts\PurchaseOrderPlatform001\' +
    'PURCHASEORDERPLATFORM001-20260729T212157Z')
$package = Join-Path $root 'BaselinePackage'
$metadata = Get-Content -Raw (Join-Path $package 'metadata.json') |
    ConvertFrom-Json
$packageHash = (
    Get-Content (Join-Path $package 'package.sha256')).Split(' ')[0]
$harnessAttempt = (
    'C:\Add-On\Lab\VProQualificationHarness\PurchaseOrder\Attempts\' +
    'PURCHASE_ORDER_PLATFORM_001-20260729T211849160Z-EEA532B4')
$harness = Get-Content -Raw (
    Join-Path $harnessAttempt 'attempt-verdict.json') | ConvertFrom-Json
$summary = Import-Csv (
    Join-Path $harnessAttempt 'Runtime\SOURCE_PASS_SUMMARY.csv')
$headers = Import-Csv (Join-Path $package 'PurchaseOrder.csv')
$lines = Import-Csv (Join-Path $package 'PurchaseOrderLine.csv')
$importEvidencePath = Join-Path $root 'PURCHASE_ORDER_IMPORT_RESULTS.json'
$importEvidence = if (Test-Path $importEvidencePath) {
    Get-Content -Raw $importEvidencePath | ConvertFrom-Json
} else { $null }
$httpPath = Join-Path $root 'PURCHASE_ORDER_HTTP_TEST_RESULTS.json'
$http = if (Test-Path $httpPath) {
    Get-Content -Raw $httpPath | ConvertFrom-Json
} else { $null }
$browserPath = Join-Path $root 'PURCHASE_ORDER_BROWSER_RESULT.json'
$browser = if (Test-Path $browserPath) {
    Get-Content -Raw $browserPath | ConvertFrom-Json
} else { $null }

function Write-Doc {
    param([string] $Name, [string] $Text)
    [IO.File]::WriteAllText(
        (Join-Path $root $Name),
        $Text.Trim() + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
}

$attemptDuration = (
    [DateTimeOffset]$harness.CompletedAtUtc -
    [DateTimeOffset]$harness.StartedAtUtc)
$sourceCounts = @{}
foreach ($row in $summary | Where-Object pass -eq '1') {
    $sourceCounts[$row.source] = [int]$row.count
}
$importRun = if ($null -ne $importEvidence) {
    $importEvidence.Initial.PurchaseOrderImportRunId
} else { 'PENDING' }
$httpVerdict = if ($null -ne $http) { $http.Verdict } else { 'PENDING' }
$browserVerdict = if ($null -ne $browser) {
    $browser.Verdict
} else { 'PENDING' }
$finalVerdict = if (
    $harness.Verdict -eq 'PASS' -and
    $httpVerdict -eq 'PASS' -and
    $browserVerdict -eq 'PASS' -and
    $null -ne $importEvidence -and
    $importEvidence.Verdict -eq 'PASS'
) {
    'PASS WITH CLARIFICATIONS'
} else {
    'PROVISIONAL - ACCEPTANCE INCOMPLETE'
}
$browserDetails = if ($null -ne $browser) {
@"

- Viewer sections: $($browser.ViewerSectionCount)
- Purchase Orders tab visible: $($browser.PurchaseOrdersTabVisible)
- Purchase Order line count: $($browser.PurchaseOrderLineCount)
- Representative line: $($browser.RepresentativeLineId)
- Existing section regression: $($browser.ExistingSectionsVerdict)
- Console/CORS errors: $($browser.ConsoleOrCorsErrors)
"@
} else {
    "`nInteractive visual evidence is pending."
}

Write-Doc 'PURCHASE_ORDER_SOURCE_CONTRACT.md' @"
# Purchase Order Source Contract

Verdict: qualified active Purchase Order contract.

Authoritative operational files are `POE-02` (header) and `POE-12`
(detail). `POE-04`/`POE-14` are current receiving work files.
`POT-04`/`POT-14` are receiving history and are supporting qualification
sources only; they are not promoted as Purchase Order rows.

All six fixed files were opened twice with `MODE="O_RDONLY"` under
`DLE-OS-HOST\DLE-OS`. Source identity was stable, writes were 0, locks were
0, and mission-owned processes remaining were 0.

Header physical key: `FirmId(2) + VendorNumber(6) + PurchaseOrderNumber(7)`.
Line physical key adds `PurchaseOrderLineNumber(3)`. PO number alone is not
unique because the active source contains PO reuse across vendors.

The active POE files are an operational open-file population. They do not
provide a qualified closed/canceled/deleted history contract.
"@

Write-Doc 'PURCHASE_ORDER_PROGRAM_AND_FILE_RELATIONSHIPS.md' @"
# Purchase Order Program and File Relationships

| Chain | Role | Files and logic |
|---|---|---|
| `POE.AA -> POE.AB` | PO entry/maintenance | POE header/detail maintenance |
| `POE.BA -> POE.BB` | PO line maintenance | Uses `ordered - received` open balance |
| `POC.BA -> POC.RA` | PO inquiry | Header/line display and lookups |
| `POR.KA -> POR.KB` | Open PO report | Opens POE-02/POE-12; `QTY=B[3]-B[7]` |
| `POR.SA -> POR.SB` | Receiving history/report | Uses POT-04/POT-14 |

The qualified date display routine is `FNB6$` with `FNYY21_YY$`. Its
first year character uses the Add+ON A-J decade encoding. Receiving history
is separable from the header/line contract and remains deferred.
"@

$fieldMap = @(
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='FirmId';Source='POE-02 key';Offset='1-2';Type='char(2)';Meaning='Firm identifier'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='VendorNumber';Source='POE-02 key';Offset='3-8';Type='char(6)';Meaning='Vendor natural-key member'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='PurchaseOrderNumber';Source='POE-02 key';Offset='9-15';Type='char(7)';Meaning='PO identifier'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='WarehouseId';Source='POE-02 record block 1';Offset='1-2';Type='char(2)';Meaning='Warehouse/location'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='PurchasingAddressCode';Source='POE-02 record block 1';Offset='3-4';Type='char(2)';Meaning='Vendor purchasing address reference'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='OrderDateRaw';Source='POE-02 record block 1';Offset='5-10';Type='char(6)';Meaning='Add+ON YY21 date'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='PromisedDateRaw';Source='POE-02 record block 1';Offset='11-16';Type='char(6)';Meaning='Header promised date'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='NotBeforeDateRaw';Source='POE-02 record block 1';Offset='17-22';Type='char(6)';Meaning='Header not-before date'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='RequiredDateRaw';Source='POE-02 record block 1';Offset='23-28';Type='char(6)';Meaning='Header required date'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='LastReceiptDateRaw';Source='POE-02 record block 1';Offset='29-34';Type='char(6)';Meaning='Header receipt summary date'}
    [pscustomobject]@{Entity='PurchaseOrder';CanonicalField='Commercial terms';Source='POE-02 record block 1';Offset='39-118';Type='fixed text';Meaning='Terms, freight, ship method, acknowledgment, FOB'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='Natural key';Source='POE-12 key';Offset='1-18';Type='char(18)';Meaning='Firm+vendor+PO+line'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='LineCode';Source='POE-12 group 1';Offset='1-2';Type='char(2)';Meaning='Stock/non-stock classification'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='RequiredDateRaw';Source='POE-12 group 1';Offset='3-8';Type='char(6)';Meaning='Line required date'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='PromisedDateRaw';Source='POE-12 group 1';Offset='9-14';Type='char(6)';Meaning='Line promised date'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='NotBeforeDateRaw';Source='POE-12 group 1';Offset='15-20';Type='char(6)';Meaning='Line not-before date'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='Demand references';Source='POE-12 group 2';Offset='1-32';Type='fixed text';Meaning='WO, customer, SO, SO line, ship-to'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='ItemNumber';Source='POE-12 group 3';Offset='3-22';Type='char(20)';Meaning='Transaction item'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='OrderMemo';Source='POE-12 group 4';Offset='1-40';Type='char(40)';Meaning='Transaction-stored memo/description'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='Quantities';Source='POE-12 numeric groups 9-17';Offset='numeric';Type='numeric';Meaning='Requested, ordered, quality, rejected, received, invoiced'}
    [pscustomobject]@{Entity='PurchaseOrderLine';CanonicalField='UnitCost';Source='POE-12 numeric group 8';Offset='numeric';Type='numeric';Meaning='AccountingRestricted; package evidence only'}
)
$fieldMap | Export-Csv (
    Join-Path $root 'PURCHASE_ORDER_PHYSICAL_FIELD_MAP.csv') `
    -NoTypeInformation -Encoding UTF8

$classifications = @(
    [pscustomobject]@{FieldGroup='Identifiers/status/dates/quantities';Classification='PurchasingOperational';Viewer='Yes';Reason='Operational PO state'}
    [pscustomobject]@{FieldGroup='Item and demand references';Classification='ProductionOperational';Viewer='Yes';Reason='Qualified direct references'}
    [pscustomobject]@{FieldGroup='Vendor name and terms';Classification='GeneralOperational';Viewer='Yes';Reason='Operational context'}
    [pscustomobject]@{FieldGroup='UnitCost/ExtendedCost';Classification='AccountingRestricted';Viewer='No';Reason='No viewer role enforcement'}
    [pscustomobject]@{FieldGroup='Internal/reserved fields';Classification='InternalOnly';Viewer='No';Reason='No proven business meaning'}
    [pscustomobject]@{FieldGroup='Receipt transaction details';Classification='NotRecommended';Viewer='No';Reason='Deferred entity'}
)
$classifications | Export-Csv (
    Join-Path $root 'PURCHASE_ORDER_ACCESS_CLASSIFICATION.csv') `
    -NoTypeInformation -Encoding UTF8

Write-Doc 'PURCHASE_ORDER_CANONICAL_PROPOSAL.md' @"
# Purchase Order Canonical Proposal

`PurchaseOrder` owns the composite key `FirmId + VendorNumber +
PurchaseOrderNumber`, operational header dates/terms, inferred active-file
status, Vendor resolution, source identity, and import identity.

`PurchaseOrderLine` owns the header key plus `PurchaseOrderLineNumber`,
item/demand references, qualified quantities, line dates, resolution states,
source identity, and import identity.

Costs are excluded from the public contract. `PurchaseReceipt` is not created.
The later receipt entity should be governed by
`RECEIVING-HISTORY-PLATFORM-001`.
"@

Write-Doc 'PURCHASE_ORDER_POPULATION_RECONCILIATION.md' @"
# Purchase Order Population Reconciliation

- Physical POE-02 records: $($sourceCounts['POE-02'])
- Canonical headers: $($metadata.HeaderCount)
- Physical POE-12 records: $($sourceCounts['POE-12'])
- Canonical lines: $($metadata.LineCount)
- Blank placeholder headers excluded: $($metadata.BlankPhysicalHeadersExcluded)
- Headers with missing natural-key members excluded: $($metadata.InvalidPhysicalHeaderKeysExcluded)
- Lines with missing natural-key members excluded: $($metadata.InvalidPhysicalLineKeysExcluded)
- Source orphan lines explicitly excluded: $($metadata.SourceOrphanLinesExcluded)
- Canonical orphan lines: $($metadata.CanonicalOrphanLines)
- Headers without lines: $($metadata.HeadersWithoutLines)
- Negative-quantity lines: $($metadata.NegativeQuantityLines)
- Zero-quantity lines: $($metadata.ZeroQuantityLines)
- Stock/non-stock: $($metadata.LineTypeCounts.Stock) / $($metadata.LineTypeCounts.NonStock)

Five physical orphan details have no exact POE-02 parent under the proven
firm/vendor/PO key. Two headers and fifteen lines have blank required key
members. All are retained in bounded exception evidence and are not silently
attached or promoted.
"@

Write-Doc 'PURCHASE_ORDER_QUANTITY_AND_STATUS_RULES.md' @"
# Purchase Order Quantity and Status Rules

The governing report and maintenance programs prove:

`QuantityOpen = QuantityOrdered - QuantityReceived`

No cancellation adjustment is made by the report formula. Line labels are:
`Open` when open quantity is positive; `FullyReceivedPendingClose` when zero;
and `OverReceivedOrReturn` when negative. Counts are:

- Open: $($metadata.LineStatusCounts.Open)
- Fully received pending close: $($metadata.LineStatusCounts.FullyReceivedPendingClose)
- Over-received/return: $($metadata.LineStatusCounts.OverReceivedOrReturn)
- No receipts/open: $($metadata.OpenLinesNoReceipts)
- Partially received: $($metadata.PartiallyReceivedLines)
- Fully received: $($metadata.FullyReceivedLines)

Header status is `ActiveOpenFile`. Closed and canceled counts are zero because
the qualified active source does not expose historical close/cancel records.
"@

Write-Doc 'PURCHASE_ORDER_RECEIVING_RELATIONSHIP_ASSESSMENT.md' @"
# Purchase Order Receiving Relationship Assessment

POE-12 contains current accumulated receipt, quality-WIP, accepted, rejected,
and invoiced quantities. POE-02 contains a last-receipt summary date.
POE-04/POE-14 are current receiver work files. POT-04/POT-14 contain separable
receipt history.

Receipt transaction identity, packing slip, receiver, lot/date code, and
individual acceptance/rejection events should not be flattened into PO lines.
Recommendation: implement `RECEIVING-HISTORY-PLATFORM-001` separately.
"@

Write-Doc 'PURCHASE_ORDER_VENDOR_RECONCILIATION.md' @"
# Purchase Order Vendor Reconciliation

Vendor Master key is `FirmId + VendorNumber`.

- Resolved headers: $($metadata.VendorResolution.Resolved)
- Missing current Vendor Master: $($metadata.VendorResolution.MissingCurrentVendor)
- Blank vendor keys: 0

No name-similarity substitution is performed. The missing reference remains
explicit and may represent a deleted/historical vendor.
"@

Write-Doc 'PURCHASE_ORDER_INVENTORY_AND_DEMAND_RECONCILIATION.md' @"
# Purchase Order Inventory and Demand Reconciliation

- Inventory resolved: $($metadata.InventoryResolution.Resolved)
- Non-stock/not applicable: $($metadata.InventoryResolution.NotApplicableNonStock)
- Work Orders resolved: $($metadata.WorkOrderResolution.Resolved)
- Work Orders missing current snapshot: $(if ($metadata.WorkOrderResolution.PSObject.Properties['MissingCurrentWorkOrder']) { $metadata.WorkOrderResolution.MissingCurrentWorkOrder } else { 0 })
- Work Orders not referenced: $($metadata.WorkOrderResolution.NotReferenced)
- Sales Orders resolved: $($metadata.SalesOrderResolution.Resolved)
- Sales Orders missing current dataset: $($metadata.SalesOrderResolution.MissingCurrentSalesOrder)
- Sales Orders not referenced: $($metadata.SalesOrderResolution.NotReferenced)

Only direct transaction references are used. Item-number coincidence is never
used to reconstruct demand, and ambiguous candidates are never selected.
"@

Write-Doc 'PURCHASE_ORDER_SQL_SCHEMA.md' @"
# Purchase Order SQL Schema

Database: `DLE_OS_CANONICAL_LIVE` only.

Objects: `platform.PurchaseOrderImportRun`,
`canonical.PurchaseOrder`, `canonical.PurchaseOrderLine`,
`canonical.PurchaseOrderViewer`, and `liveapi.PurchaseOrderMetadata`.
The schema enforces composite primary/foreign keys and
`QuantityOpen = QuantityOrdered - QuantityReceived`.
The existing LIVE API reader receives SELECT only. There are no write routes.
"@

Write-Doc 'PURCHASE_ORDER_BASELINE_EXTRACTION_REPORT.md' @"
# Purchase Order Baseline Extraction Report

Harness attempt: `$($harness.AttemptId)`

- Verdict: $($harness.Verdict)
- Duration: $([Math]::Round($attemptDuration.TotalSeconds, 2)) seconds
- Identity: $($harness.Identity)
- Elevated: $($harness.Elevated)
- Mode: $($harness.SourceAccessMode)
- Writes/locks: $($harness.SourceWrites) / $($harness.SourceLocks)
- Remaining mission processes: $($harness.MissionOwnedProcessesRemaining)
- Header/line package counts: $($metadata.HeaderCount) / $($metadata.LineCount)
- Package SHA-256: $packageHash
"@

Write-Doc 'PURCHASE_ORDER_IMPORT_REPORT.md' @"
# Purchase Order Import Report

ImportRunId: $importRun

The importer validates the package manifest, file hashes, counts, natural keys,
parent integrity, and open-quantity formula before mutation. Header and line
replacement occurs in one serializable transaction. Identical current package
returns `NO-OP`; the induced failure after delete must roll back before this
report is finalized.
"@

Write-Doc 'PURCHASE_ORDER_API_CONTRACT.md' @"
# Purchase Order LIVE API Contract

- `GET /api/platform/live/v1/purchase-orders`
- `GET /api/platform/live/v1/purchase-orders/metadata`
- `GET /api/platform/live/v1/purchase-orders/{firm}/{vendor}/{po}`
- `GET /api/platform/live/v1/purchase-orders/{firm}/{vendor}/{po}/lines`
- `GET /api/platform/live/v1/purchase-orders/{firm}/{vendor}/{po}/lines/{line}`

All list filters are server-side, exact for identifiers/items, bounded to page
sizes 1-200, and parameterized. Numeric PO, vendor, Work Order, and Sales Order
identifiers are left-padded only when shorter than their canonical width.
Costs and restricted internal fields are absent.
"@

Write-Doc 'PURCHASE_ORDER_BROWSER_ACCEPTANCE.md' @"
# Purchase Order Browser Acceptance

Runtime/HTTP qualification verdict: $httpVerdict
Interactive browser verdict: $browserVerdict
$browserDetails

The ninth tab is `Workspace View -> Platform -> Canonical Data Viewer ->
Purchase Orders`. It is LIVE-only, safe-hidden when metadata is unavailable,
line-oriented, read-only, and retains shared server filtering, cancellation,
stale-response protection, loading/error handling, paging, and direct-page
navigation.
"@

Write-Doc 'PURCHASE_ORDER_REFRESH_ASSESSMENT.md' @"
# Purchase Order Refresh Assessment

The active POE population is small, mutable, and lacks a qualified reliable
update timestamp. Records can change while open and can disappear on close.
The simplest safe initial strategy is a complete governed read of POE-02 and
POE-12 followed by package validation and transactional replacement.

Receipt history should not be reread for every PO viewer refresh. A separate
receiving-history refresh can qualify POT-04/POT-14 later. Schedule/control
implementation is deferred to `PURCHASE-ORDER-REFRESH-001`.
"@

Write-Doc 'PURCHASE_ORDER_SOURCE_SAFETY_EVIDENCE.md' @"
# Purchase Order Source Safety Evidence

The reusable harness commit boundary was used. The run was non-elevated under
`DLE-OS-HOST\DLE-OS`, used six exact X: paths, opened records only with
`MODE="O_RDONLY"`, wrote all outputs to `C:\Add-On\Lab`, and did not remap X:.

Harness verdict: $($harness.Verdict)
Identity stable: $($harness.SourceIdentityStable)
Source writes: $($harness.SourceWrites)
Source locks: $($harness.SourceLocks)
Mission processes remaining: $($harness.MissionOwnedProcessesRemaining)
"@

Write-Doc 'PURCHASE_ORDER_HARNESS_RESULT.md' @"
# Purchase Order Harness Result

Final attempt `$($harness.AttemptId)` returned `$($harness.Verdict)`.
Both complete passes retained ordered records and stable identities. The first
attempt was cleanly stopped by the reusable progress timeout while reading the
large POT-14 file; it left zero owned processes. Raising the dataset-specific
progress gate from 180 to 900 seconds allowed the complete source to remain
within the harness without a custom supervisor.
"@

$packageTest = if (Test-Path (Join-Path $root 'PACKAGE_TEST_RESULTS.txt')) {
    Get-Content -Raw (Join-Path $root 'PACKAGE_TEST_RESULTS.txt')
} else { 'PENDING' }
$frontendTest = if (Test-Path (Join-Path $root 'FRONTEND_TEST_RESULTS.txt')) {
    Get-Content -Raw (Join-Path $root 'FRONTEND_TEST_RESULTS.txt')
} else { 'PENDING' }
Write-Doc 'PURCHASE_ORDER_TEST_RESULTS.md' @"
# Purchase Order Test Results

Package/static tests:

```
$packageTest
```

Frontend tests:

```
$frontendTest
```

HTTP assertions: $(if ($null -ne $http) { $http.AssertionsPassed } else { 'PENDING' })
HTTP verdict: $httpVerdict
"@

Write-Doc 'PURCHASE_ORDER_PLATFORM_001_FINAL_REPORT.md' @"
# PURCHASE-ORDER-PLATFORM-001 Final Report

Final verdict: $finalVerdict

The active Purchase Order header/line dataset is qualified through the reusable
supervised VPro harness, packaged with composite vendor-bearing keys, imported
transactionally, and exposed as a bounded read-only ninth Platform section.

Clarifications: receiving transaction history is deferred; closed/canceled and
revision history are unavailable from the active POE population; buyer identity
was not physically proven; one current Vendor reference is absent; and direct
current Sales Order/Work Order resolution remains explicitly nullable.

Header/line counts: $($metadata.HeaderCount) / $($metadata.LineCount)
ImportRunId: $importRun
Package SHA-256: $packageHash
Harness: $($harness.Verdict)
HTTP: $httpVerdict
Browser: $browserVerdict
"@

$manifestPath = Join-Path $root 'ARTIFACT_MANIFEST.csv'
$manifestRows = Get-ChildItem -LiteralPath $root -Recurse -File |
    Where-Object FullName -ne $manifestPath |
    Sort-Object FullName |
    ForEach-Object {
        [pscustomobject]@{
            Path = $_.FullName.Substring($root.Length + 1)
            Length = $_.Length
            Sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
        }
    }
$manifestRows | Export-Csv $manifestPath -NoTypeInformation -Encoding UTF8
[ordered]@{
    Verdict = $finalVerdict
    ArtifactRoot = $root
    ManifestEntries = $manifestRows.Count
    ManifestSha256 = (
        Get-FileHash $manifestPath -Algorithm SHA256).Hash
} | ConvertTo-Json

# Invoice History routine refresh contract

Mission: `INVOICE-HISTORY-REFRESH-001`

Contract run: `INVOICEHISTORYREFRESH001-20260729T135205Z`

Status: `QUALIFIED AND IMPLEMENTED`

## Qualified source boundary

Routine refresh reads only these established sources and relationships:

- `X:\AON\ADATA\ART-03` — invoice headers
- `X:\AON\ADATA\ART-13` — invoice lines
- exact supporting lookups already qualified for customer, item, Work Order,
  and manufacturing resolution

Every VPro record open must specify `MODE="O_RDONLY"`. No report program is
executed. All output is local.

The overlap boundary is the historical invoice date stored in
`ART-03A090 INVOICE DATE`, physical `A0$(24,3)`. It is not a shipment date,
posting timestamp, source key, or identity field.

## Date decoding and validation

The three stored bytes are decoded as:

`YY=(byte1-0x20) mod 100`

`Month=(byte2-0x20) mod 100`

`Day=(byte3-0x20) mod 100`

The year must resolve uniquely within 1995 through the extraction year. Month
and day must form a valid calendar date. The qualified ART-03 population had
19,446 headers: 296 void headers, 19,150 valid non-void dates, and zero blank,
invalid, or future dates.

- Blank or invalid dates fail candidate validation.
- A date after the extraction timestamp fails candidate validation.
- No pivot year or epoch is invented.
- The original three bytes and source-record hash are retained as evidence.

## Overlap calculation

The default window is 45 calendar days inclusive:

`OverlapStartDate = ExtractionBusinessDate - 44 days`

`ExtractionEnd = the reader's captured UTC end timestamp`

The maximum successfully imported invoice date is a query watermark only. It
is never identity. The window may be widened by a protected configuration, but
normal operator input cannot reduce it below 45 days.

ART-03 has no invoice-date key. A routine run therefore performs one ordered
read of the small ART-03 header file and selects non-void headers inside the
window.

ART-13 requires a complete qualified key. For each selected invoice prefix the
reader enumerates the exact three-digit suffix keys `000` through `999` and
uses `READ RECORD(..., KEY=..., DOM=...)`. Only matching records are decoded.
Suffixes are not assumed to be multiples of ten. A partial-key seek, a
single-`000` probe, and a full sequential ART-13 scan are prohibited during
routine refresh.

The qualified 2026-06-15 through 2026-07-29 run examined 19,446 headers,
selected 38, issued 38,000 exact line-key probes, and read 219 matching
ART-13 records rather than the 79,003-record full population.

## Identity

Header natural key:

`FirmId + ArType + CustomerNumber + InvoiceNumber`

Line natural/upsert key:

`FirmId + ArType + CustomerNumber + InvoiceNumber + InvoiceLineNumber`

Invoice number alone and invoice date alone are unsafe. Natural-key fields are
immutable. A source record with a changed natural key is an insertion plus a
potential `MissingFromSource` exception; it is never silently renamed.

## Business comparison

Import metadata, run IDs, timestamps, and package hashes are excluded from
business-value comparison.

Header updateable fields:

- InvoiceDate
- CustomerName and CustomerNameResolutionType
- AccountsReceivablePurchaseOrderNumber
- SalesOrderNumber
- SourceKeyRaw and SourceRecordHash

Line updateable fields:

- InvoiceDate
- SalesOrderNumber and SalesOrderLineNumber
- LineCode
- ItemNumber
- ItemDescription and ItemDescriptionResolutionType
- EstimatedShipDate and OnTimeIndicator
- QuantityShipped, UnitPrice, and ExtendedPrice
- WorkOrderNumber, WorkOrderResolutionStatus, and candidate count
- BillNumber, BomRevision, DrawingNumber, DrawingRevision, RevisionCode
- ManufacturingResolutionType
- SourceKeyRaw and SourceRecordHash

Created timestamps and natural-key fields are immutable. Updated timestamps
and last-change provenance change only for rows classified `Insert` or
`Update`. `Unchanged` rows are not rewritten.

## Classification rules

Each candidate line is exactly one of:

- `Insert` — natural key is absent from active SQL.
- `Update` — natural key exists and at least one qualified business value
  differs.
- `Unchanged` — natural key and all qualified business values match.

Each active SQL row in the overlap window absent from the candidate is
`MissingFromSource`.

For every update, evidence records the natural key, changed field name, prior
value hash/value as permitted, and candidate value hash/value.

## Insert and update rules

- Headers are inserted or updated before their lines inside one SQL
  transaction.
- Inserts and updates use the complete qualified natural keys.
- Signed credits and reversals are ordinary historical values; their signs are
  preserved.
- Zero-quantity rows remain outside the qualified report population. A
  transition to zero is not treated as an automatic deletion; it becomes a
  reconciliation exception unless a separately qualified void rule applies.
- Derived values are recalculated from the candidate source material.
- Work Order resolution always rechecks cardinality and never chooses among
  multiple candidates.
- Current-master enrichment remains explicitly
  `CurrentMasterResolved`, never historical truth.

## Missing-row and correction rules

No routine refresh hard-deletes or deactivates an Invoice History row.

A `MissingFromSource` row remains active, is written to reconciliation
evidence, and produces `PASS WITH CLARIFICATIONS` unless an already-qualified
non-destructive explanation exists.

Physical disappearance after posting is not assumed impossible. The source
contains void indicators and may receive corrections without changing the
invoice date. Therefore every overlap record is compared on every run, and
changes outside the window are detected only by deliberate full
reconciliation.

## Package and validation

Package schema: `DLE_INVOICE_HISTORY_REFRESH_V1`, version `1`.

The immutable local package contains:

- refresh run ID and timestamps
- 45-day boundary
- source identities before and after
- examined and selected counts and bytes
- canonical header and line payloads
- Insert/Update/Unchanged/MissingFromSource counts
- field-level differences
- Work Order and manufacturing summaries
- negative quantity count
- natural-key, schema, count, and relationship verdicts
- per-file hashes and package SHA-256

Duplicate keys, missing key fields, identity changes, malformed values, invalid
dates/status/cardinality, count mismatches, or package-hash failures reject the
package before SQL mutation.

## Transaction, promotion, and rollback

One governed SQL transaction stages and validates the candidate, applies only
header/line inserts and updates, records the refresh run, revalidates counts
and relationships, and commits atomically.

Any failure rolls back the complete transaction and leaves the prior active
dataset and viewer metadata unchanged. Failure evidence is retained locally.
Promotion records independent Invoice History refresh provenance and does not
alter the full ERP snapshot boundary.

## No-source-change behavior

An identical re-execution returns `NO_SOURCE_CHANGES`:

- zero inserts
- zero updates
- zero row rewrites
- current Invoice History baseline ImportRunId retained
- a non-promoted attempt/status record may be retained for audit

## Full reconciliation

Full reconciliation is a separate deliberate operation:

- complete ART-03/ART-13 key-plus-record comparison
- no automatic daily execution
- weekly recommended qualification cadence
- monthly retained hash-qualified report
- required after reader/contract changes or any identity/count anomaly
- never silently rewrites or deletes history

Routine refresh and full reconciliation have separate run types, evidence, and
promotion decisions.

## Control boundary

The existing Windows-authenticated control host on port 5043 may expose
separate Invoice History routes only with:

- the existing exact operator allowlist `DLE-OS-HOST\DLE-OS`
- a separate runner path, process gate, status file, and rollback boundary
- no call into `Invoke-LiveSnapshotRefresh.ps1`
- no change to existing ERP refresh routes
- no anonymous POST

The viewer control is labeled `Refresh Invoice History`, appears only in the
Invoice History section, and does not automatically trigger or imply a full ERP
snapshot refresh.

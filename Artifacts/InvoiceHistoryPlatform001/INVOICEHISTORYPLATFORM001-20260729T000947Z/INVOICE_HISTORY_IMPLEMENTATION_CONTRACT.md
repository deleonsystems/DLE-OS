# Invoice History implementation contract

Run ID: `INVOICEHISTORYPLATFORM001-20260729T000947Z`

## Qualified boundary

This implementation consumes the two-pass, read-only qualification from
`INVOICEHISTORY001-20260728T233255Z`. ART-03 and ART-13 retained their
qualified byte lengths, timestamps, and SHA-256 identities at implementation
start. The qualified current projection contains 26,036 nonzero invoice lines
and has no duplicate natural keys.

The 13 report fields remain:

1. Customer Number
2. Customer Name
3. Invoice Number
4. Accounts Receivable Purchase Order Number
5. Sales Order Number and line
6. Quantity Shipped
7. Item Number
8. Item Description
9. Estimated Ship Date
10. Invoice Date
11. On-time indicator
12. Unit Price
13. Extended Price

`Ship/Inv Dt` is implemented as `InvoiceDate`; it is not represented as a
shipment date. `ExtendedPrice` is `UnitPrice * QuantityShipped`, preserving
signed values. Zero-quantity rows remain outside the qualified report
population.

## Entities and keys

`canonical.CustomerInvoice` owns ART-03 header facts. Its natural key is:

`FirmId + ArType + CustomerNumber + InvoiceNumber`

`canonical.CustomerInvoiceLine` owns ART-13 line facts. Its natural key is:

`FirmId + ArType + CustomerNumber + InvoiceNumber + InvoiceLineNumber`

The qualified population is Firm `01` and preserves the two-character blank
A/R type as two spaces. Key display values retain leading zeroes.

## Resolution rules

Work Orders use the exact relationship:

`CustomerNumber + SalesOrderNumber + SalesOrderLineNumber`
→ WOE-03 layout B → WOE-01.

- One candidate present in WOE-01: `Unique`; the Work Order number is stored.
- No qualified candidate: `Unresolved`; Work Order is null.
- More than one candidate: `Ambiguous`; Work Order is null and no tie-break is
  performed.

Work Order-specific WOE-01 manufacturing values are
`HistoricalReconstructed`. A unique current BMM match used without a unique
Work Order is `CurrentMasterResolved` and must not be described as shipment
truth. Multiple current-master matches are `Ambiguous`; no match is
`Unavailable`. `RevisionCode` remains null because qualification did not prove
a distinct source separate from BOM revision.

Customer names come from current ARM-01 lookup and are classified
`CurrentMasterResolved`. Item descriptions are `HistoricalStored` when the
ART-13 memo is populated, `CurrentMasterResolved` when the report used its
IVM-01 fallback, and `Unavailable` when neither supplies a value.

## Null and data rules

Source blanks become SQL null except `ArType`, whose two spaces are part of the
qualified source key. No `UNKNOWN`, `N/A`, fabricated zero, fabricated date,
or empty GUID is introduced. Dates are ISO `date` values in SQL/API. Decimal
values are loaded as signed `decimal(38,10)` without clamping.

## Boundary and versioning

The package schema is `DLE_INVOICE_HISTORY_BASELINE_V1`; the established
platform contract remains `1.2`. Invoice History has an independent
`InvoiceHistoryImportRunId` and does not alter the active full-snapshot
`ImportRunId` or qualified-boundary file. It is not part of
`Invoke-LiveSnapshotRefresh.ps1`.

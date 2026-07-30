# Receiving History Missing Purchase Order Policy

Verdict for the missing-PO question: **RETAIN (Option A)**

The retained POT-04 row is a genuine posted receipt-history record. Its exact
fixed-width source key is unique and can safely identify it without inventing
a Purchase Order Number. Canonically, `PurchaseOrderNumber` is null and
`PurchaseOrderResolutionStatus` is `MissingRequiredSourceValue`.

## Qualified record

| Property | Qualified value |
|---|---|
| POT-04 key | `01000174       0030511` |
| POT-04 source identity | `30313030303137342020202020202030303330353131` |
| Firm | `01` |
| Vendor | `000174` |
| Purchase Order segment | seven spaces |
| Receiver | `0030511` |
| Warehouse | `12` |
| Purchasing address | blank |
| Order Date raw / ISO / status | `B31213` / `2013-12-13` / `Resolved` |
| Required Date raw / ISO | `B30226` / `2013-02-26` |
| Receipt Date raw / ISO | `B60613` / `2016-06-13` |
| Hold flag | `N` |
| Print status | blank |
| Payment terms | `60` |
| Requisition | `0000010` |
| Packing slip | blank |
| Received-complete source indicator | `N` |
| Freight, shipping, acknowledgment, FOB, message | blank |

The only child is POT-14 key `01000174       0030511010`, exact identity
`30313030303137342020202020202030303330353131303130`.

| Child property | Qualified value |
|---|---|
| Receipt line | `010` |
| Line code / type | `S` / Stock |
| Warehouse | `12` |
| Item Number | `77-3714-6` |
| Required Date | `2013-02-26` |
| Unit of measure | `EA` |
| Source code | `W` |
| Work Order / sequence | `0109522` / `032` |
| Requisition quantity | `104` |
| Ordered quantity | `104` |
| Posted quantity | `0` |
| Invoiced quantity | `0` |
| Memo / description | blank |
| Restricted cost | present in source; value not exposed |
| Related POT-03 rejections | `0` |

The work order supplied an Item Number of `277-3714-6`. The retained DDM
layout and POT-14 program I/O split the 22-character item block into a
two-character Warehouse (`12`) followed by a 20-character Item Number
(`77-3714-6`). The canonical value is therefore `77-3714-6`; no character is
dropped.

## Cardinality

- Retained POT-04 population: 39,564
- Retained POT-14 population: 189,272
- Blank-PO POT-04 headers: exactly 1
- Blank-PO POT-14 lines: exactly 1
- Receiver `0030511`: 1 header globally, 1 within Firm `01`, and 1 within
  Firm `01` + Vendor `000174`
- Related POT-03 rows: 0 (the entire qualified POT-03 population is empty)
- Exact POT-04 source identities: unique
- Exact POT-14 source identities: unique

Receiver uniqueness is supporting evidence, not the selected key policy.
Option B is unnecessary. The immutable identity is the exact source key
already emitted by VPro.

## Program behavior

The retained program listings establish normal receipt-history behavior:

- `POU.DA` lines 3505-3510 rearrange the live receipt key into
  Firm + Vendor + PO + Receiver and write POT-04 without a blank-PO skip.
  POT-14 is written at line 2910.
- `POR.SB` lines 1020-1560 read POT-04 and its POT-14 children; line 1440
  assigns the PO segment and line 6570 prints it. No blank-PO exclusion exists.
- `POR.PB` lines 1670-2120 and `POR.PC` lines 1670-2140 read the same exact
  header/child relationship. `POR.PC` lines 6320-6460 label and print the PO
  and receiver even when the PO value is blank.
- `POC.LA` lines 2420-2490 and `POC.LB` lines 2415 onward use the PO and
  receiver fields in receipt lookup displays.
- `POR.DA`, `POR.DB`, and `POR.DC` display receipt quantities, PO, receiver,
  and completion state. They do not define posted quantity zero as void,
  deletion, initialization, or test data.

The source programs provide no explicit void, cancellation, deletion,
initialization, or nonbusiness marker for this row. Zero quantity is retained
as `ZeroPostedQuantity`; it is not an exclusion criterion.

## Alternate PO assessment

No deterministic direct PO recovery exists.

- The authoritative POT-04 and POT-14 keys both contain the same blank
  seven-character PO segment.
- Receipt-history secondary indexes constructed by `POU.DA` repeat that same
  PO value; they do not supply an alternate one.
- The Purchase Order package independently preserves the corresponding source
  identity in `InvalidPurchaseOrderHeader.csv` as
  `MissingRequiredNaturalKeyExcluded`.
- The Work Order (`0109522`), requisition (`0000010`), vendor, item, warehouse,
  and dates are direct facts but are not authoritative PO relationships.
- Similar item/vendor/date records cannot be used to infer a PO.

## Canonical and relational policy

- `SourceRecordIdentity` is the immutable key for `PurchaseReceipt`,
  `PurchaseReceiptLine`, and `ReceiptRejection`.
- Child rows carry the exact parent source identity for referential integrity.
- `PurchaseOrderNumber` is nullable.
- The qualified row and line carry
  `PurchaseOrderResolutionStatus=MissingRequiredSourceValue`.
- The row remains in data-quality/orphan counts.
- Blank-PO rows do not contribute to Purchase Order receipt-total
  reconciliation.
- The exact baseline gate is one blank-PO header. Zero or more than one fails
  closed pending review.
- No receiver, PO placeholder, item, vendor, date, or description is
  hard-coded.

## Current continuation blocker

The first full package rebuild progressed beyond this missing-PO row and then
failed correctly on `ReceiptDateRaw=D01129`. A complete retained-source scan
found additional out-of-horizon dates outside the previously authorized
Order-Date-only policy:

- POT-04 `ReceiptDateRaw`: 1 record (`D01129`)
- POT-14 `RequiredDateRaw`: 26 records
  (`291120` x1, `F50917` x2, `300802` x1, `C70103` x22)

The approved malformed-date boundary covers exactly five malformed
`OrderDateRaw` values and does not define null/status fields or count gates for
Receipt Date or Required Date. No candidate package, SQL import, deployment,
or promotion was performed.

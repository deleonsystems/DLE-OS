# Receiving History Malformed Source Date Policy

## Verdict

The malformed-source-date policy is implemented and passes focused tests.
Platform package construction remains `BLOCKED` by a separate blank Purchase
Order natural-key record.

## Generic date handling

`Tools\ReceivingHistory\build_receiving_history_package.py` now resolves
`OrderDateRaw` into:

- `OrderDateIso`
- `OrderDateResolutionStatus`
- `OrderDateResolutionReason`

The outcomes are:

| Source condition | ISO value | Status | Reason |
|---|---|---|---|
| Valid YY21 date within 1995 through snapshot year | decoded date | `Resolved` | null |
| Blank, `000000`, or `XXXXXX` | null | `BlankSourceValue` | null |
| Structurally valid date outside the qualified horizon | null | `InvalidSourceValue` | `Decoded date exceeds qualified snapshot horizon` |
| Wrong length, invalid YY21 prefix, nonnumeric remainder, invalid month/day | package failure | none | exception |

The raw value is always retained in `OrderDateRaw`. No replacement date is
inferred.

The builder requires an explicit
`--expected-invalid-order-date-count`. The qualified baseline invocation uses
`5`; any observed count other than exactly five fails closed. The implementation
contains no checks for `311029`, `490916`, or `481114`.

## Downstream representation prepared

The prepared SQL/API/viewer implementation adds:

- SQL `OrderDateResolutionStatus`
- SQL `OrderDateResolutionReason`
- import-run `MalformedOrderDateCount`
- API raw, nullable ISO, status, and reason properties
- viewer Order Date, raw trace value, resolution, and resolution-detail fields

The viewer cannot display 2031 for an invalid source value because the parsed
ISO member is null.

## Focused tests

- generic date policy: 4/4 pass
- frontend policy assertions: pass
- Python syntax: pass
- PowerShell importer parser: pass

Full package-dependent tests were not run because no package was accepted.

## New natural-key blocker

The retained accepted `POT-04` stream contains exactly one header with a blank
seven-character Purchase Order segment:

- physical key: `01000174       0030511`
- firm: `01`
- vendor: `000174`
- purchase order segment: seven spaces
- receiver: `0030511`
- order date: `B31213` (`2013-12-13`)
- receipt date: `B60613` (`2016-06-13`)

The retained `POT-14` stream contains one matching child:

- physical line key: `01000174       0030511010`
- item: `277-3714-6`
- posted quantity: `0`

The existing canonical natural key requires:

`FirmId + VendorNumber + PurchaseOrderNumber + ReceiverNumber`

The existing Purchase Order package independently records the blank-PO source
header for firm `01`, vendor `000174` as
`MissingRequiredNaturalKeyExcluded`.

Package construction stopped at the unchanged required-key guard:

`Missing required receipt-header key: '01000174       0030511'`

No package, SQL mutation, API publication, viewer deployment, or commit
followed. A separate governance decision is required to either define a
canonical missing-PO receipt identity or explicitly exclude this header and
its line with reconciliation evidence. No placeholder or inferred Purchase
Order number was introduced.

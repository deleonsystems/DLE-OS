# Receiving History Source Contract

## Authoritative retained history

- `X:\AON\ADATA\POT-04` — posted purchase-receipt headers.
- `X:\AON\ADATA\POT-14` — posted purchase-receipt lines.
- `X:\AON\ADATA\POT-03` — retained QA rejection events.

Every live open is performed by the supervised qualifier with
`MODE="O_RDONLY"`. Paths are fixed in source and harness configuration; no
operator-provided path is accepted.

`POE-04` and `POE-14` are current receipt work files, not the authoritative
posted-history baseline. `POT-24`, `POT-34`, and `POT-44` are secondary
sort/index files and do not own additional business facts.

## Proven keys

- Header: `FirmId(2) + VendorNumber(6) + PurchaseOrderNumber(7) +
  ReceiverNumber(7)`.
- Line: header key + `ReceiptLineNumber(3)`.
- Rejection: physical key `FirmId(2) + VendorNumber(6) +
  ReceiverNumber(7) + PurchaseOrderNumber(7) + ReceiptLineNumber(3) +
  RejectionSequence(3)`. The canonical order groups PO before receiver but
  retains every physical key member.

Packing-slip number and receipt date are attributes, not keys. Receiver
numbers are not treated as globally unique across firms/vendors/POs.

## Population boundary

The contract represents retained posted receipt history. Purge utilities
`POU.FA` and `POU.HA` prove that retention is governed and is not guaranteed
to be an immutable all-time ledger. Current/open work files and derived index
files are outside this baseline.

## Relationships

Vendor, Inventory, Work Order, and active Purchase Order attributes are
resolved only against already-qualified local packages. A missing current
master or active PO does not erase the historical receipt; it is preserved
with an explicit resolution status. No ambiguous reference is silently
selected.

## Fail-closed rules

The package is rejected for source identity/pass mismatch, duplicate required
keys, orphan lines or rejection rows, malformed dates/numerics, invalid signed
quantity mapping, restricted cost leakage, schema/hash mismatch, or an
unexplained population collapse.

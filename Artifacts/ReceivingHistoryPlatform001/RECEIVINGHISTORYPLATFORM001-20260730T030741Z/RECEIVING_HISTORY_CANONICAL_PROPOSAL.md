# Receiving History Canonical Proposal

## PurchaseReceipt

One retained posted receipt header, keyed by:

`FirmId + VendorNumber + PurchaseOrderNumber + ReceiverNumber`

It owns receipt/order dates, warehouse, purchasing-address code, packing slip,
freight/shipping documentation, receipt classification, direct source
identity, current Vendor resolution status, and active-PO resolution status.

## PurchaseReceiptLine

One retained posted receipt line, keyed by:

`FirmId + VendorNumber + PurchaseOrderNumber + ReceiverNumber +
ReceiptLineNumber`

It owns PO-line/item/location references, signed posted quantity, explicitly
derived positive received/accepted and negative/reversal quantities, retained
invoiced quantity, current Inventory/Work Order references, and resolution
statuses.

## ReceiptRejection

An optional child event keyed by:

`FirmId + VendorNumber + PurchaseOrderNumber + ReceiverNumber +
ReceiptLineNumber + RejectionSequence`

It is created only from retained `POT-03` events. No empty inspection or
quality entity is fabricated when the source population is absent.

## Deliberately excluded or deferred

- Unit and extended receipt cost: accounting-restricted.
- General received-by employee: no retained field proven.
- Lot/date-code and serial detail: no retained field proven.
- Full inspection/nonconformance entity: deferred; retained source is
  insufficient.
- `QuantityReturned` is labeled as negative receipt/reversal quantity because
  source evidence does not distinguish every negative posting.

Package contract identifier: `RECEIVING_HISTORY_CANONICAL_V1`.

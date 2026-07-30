# Receiving History Purchase Order Reconciliation

Status: **NOT RUN**

The canonical PO reconciliation was not run because the source baseline failed
the preceding cross-pass FIN identity gate. No historical receipt was matched
or promoted against the active Purchase Order package.

The prepared implementation uses the qualified PO natural key:

`FirmId + VendorNumber + PurchaseOrderNumber + PurchaseOrderLineNumber`

and preserves missing active PO headers/lines as explicit historical
resolution statuses. It was not executed against the rejected baseline.

# Purchase Order Canonical Proposal

PurchaseOrder owns the composite key FirmId + VendorNumber +
PurchaseOrderNumber, operational header dates/terms, inferred active-file
status, Vendor resolution, source identity, and import identity.

PurchaseOrderLine owns the header key plus PurchaseOrderLineNumber,
item/demand references, qualified quantities, line dates, resolution states,
source identity, and import identity.

Costs are excluded from the public contract. PurchaseReceipt is not created.
The later receipt entity should be governed by
RECEIVING-HISTORY-PLATFORM-001.

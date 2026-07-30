# Purchase Order SQL Schema

Database: DLE_OS_CANONICAL_LIVE only.

Objects: platform.PurchaseOrderImportRun,
canonical.PurchaseOrder, canonical.PurchaseOrderLine,
canonical.PurchaseOrderViewer, and liveapi.PurchaseOrderMetadata.
The schema enforces composite primary/foreign keys and
QuantityOpen = QuantityOrdered - QuantityReceived.
The existing LIVE API reader receives SELECT only. There are no write routes.

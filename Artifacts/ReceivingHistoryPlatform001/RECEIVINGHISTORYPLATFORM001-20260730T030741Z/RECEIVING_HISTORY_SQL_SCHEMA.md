# Receiving History SQL Schema

Target database is fixed to `DLE_OS_CANONICAL_LIVE`.

Objects:

- `platform.ReceivingHistoryImportRun`
- `canonical.PurchaseReceipt`
- `canonical.PurchaseReceiptLine`
- `canonical.ReceiptRejection`
- `canonical.ReceivingHistoryViewer`
- `liveapi.ReceivingHistoryMetadata`

Primary and foreign keys enforce the proven header, line, rejection, and
ImportRun relationships. A quantity check constraint preserves the exact
signed-to-positive/negative mapping.

The database-local `dle_receiving_history_importer` role can select/insert/
delete the three mission tables and update its import-run metadata. It has no
ALTER, CONTROL, or EXECUTE permission. The operator may impersonate only the
database-local executor for the governed import.

The existing `dle_live_api_reader` role receives SELECT only on the approved
viewer, receipt tables, and metadata view. No write or execution permission is
granted.

Schema source:
`Tools\ReceivingHistory\Database\032_AddReceivingHistoryPlatform.sql`.

# Invoice History SQL schema

Database: `DLE_OS_CANONICAL_LIVE`

Migration:
`C:\DLE-OS\Repositories\DLE-OS-Server\Database\Scripts\019_AddInvoiceHistoryPlatform.sql`

Objects created:

- `platform.InvoiceHistoryImportRun`
- `canonical.CustomerInvoice`
- `canonical.CustomerInvoiceLine`
- `canonical.InvoiceHistoryViewer`
- `liveapi.InvoiceHistoryMetadata`
- indexes for invoice date, Sales Order, item, and Work Order filtering

`CustomerInvoice` is protected by the four-part header natural key.
`CustomerInvoiceLine` is protected by the complete five-part line natural key.
Foreign keys enforce header-to-line and import-run relationships. Check
constraints enforce the bounded resolution values and prohibit a selected Work
Order on ambiguous or unresolved rows.

The import uses a serializable SQL transaction. It inserts an independent
Invoice History run, replaces both active entity tables, reconciles counts,
keys, and relationships, then atomically activates that run. An exception
rolls the entire operation back.

The existing `dle_live_api_reader` schema grant permits SELECT on the canonical
view. A specific SELECT grant permits `liveapi.InvoiceHistoryMetadata`.
INSERT, UPDATE, DELETE, ALTER, and EXECUTE remain denied.

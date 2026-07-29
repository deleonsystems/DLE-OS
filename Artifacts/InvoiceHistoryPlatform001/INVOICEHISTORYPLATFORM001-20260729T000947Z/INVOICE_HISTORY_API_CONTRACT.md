# Invoice History LIVE API contract

Base route:

`GET /api/platform/live/v1/invoice-history`

Exact detail:

`GET /api/platform/live/v1/invoice-history/{invoiceHistoryLineId}`

Independent baseline metadata:

`GET /api/platform/live/v1/invoice-history/metadata`

The list route uses the existing platform page/pageSize contract (default 1/50,
maximum 200), deterministic newest-invoice-first ordering, and server-side
exact filters:

- `invoiceDateFrom` / `invoiceDateTo` as inclusive ISO dates
- `customerNumber`
- `invoiceNumber`
- `salesOrderNumber`
- `itemNumber`
- `workOrderNumber`

Numeric identifiers shorter than their canonical widths are left-padded only
for the request. Item numbers are trimmed but otherwise unchanged. Matching is
exact; there is no contains or partial matching.

Rows include nullable Work Order/manufacturing values, explicit resolution
classifications, candidate count, independent Invoice History import ID,
source extraction/qualification run IDs, package content hash, and activated
timestamp. No write route exists.

The repository uses parameterized Dapper commands against
`canonical.InvoiceHistoryViewer` and `liveapi.InvoiceHistoryMetadata`.

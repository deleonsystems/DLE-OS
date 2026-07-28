# PLATFORM-002 Platform Viewer Sales Order Implementation

Implementation verdict: **PASS**

The Live Snapshot viewer now has five sections:

1. Work Orders
2. Inventory Items
3. Bills of Material
4. General Ledger Accounts
5. Sales Orders

Navigation:
`Workspace View → Platform → Canonical Data Viewer — Live Snapshot → Sales Orders`

The Sales Orders tab is live-only and never falls back to Historical Test. It
uses `GET /api/platform/live/v1/sales-orders` and exact record lookup through
`GET /api/platform/live/v1/sales-orders/{salesOrderLineId}`. The API remains
GET-only and the existing exact-origin CORS policy is unchanged.

The line-level table exposes the 18 requested display columns. Filters cover
Customer Number, Customer Name, Sales Order Number, Customer PO, Item Number,
Work Order Number, Estimated Ship Date, negative quantity status, and unresolved
Work Order status. Existing pagination, page size, request cancellation,
stale-response protection, loading, error, and read-only patterns are reused.

Automated results:

- PLATFORM-002 frontend assertions: 15/15
- PLATFORM-003 viewer regression: 40/40
- Platform API regression executable: 25/25
- Server build: PASS, zero warnings
- SQL/package/source validation: PASS

Browser QA confirmed the five-tab Live Snapshot layout, the unavoidable
read-only banner, all nine filters, all 18 column labels, and the unchanged
historical viewer with 26,902 rows. Data-bearing live HTTP QA remains blocked
only by the runtime-launch item documented in `UNRESOLVED_ITEMS.md`.

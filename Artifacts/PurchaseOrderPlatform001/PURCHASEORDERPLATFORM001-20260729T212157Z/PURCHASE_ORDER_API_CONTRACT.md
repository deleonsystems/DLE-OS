# Purchase Order LIVE API Contract

- GET /api/platform/live/v1/purchase-orders
- GET /api/platform/live/v1/purchase-orders/metadata
- GET /api/platform/live/v1/purchase-orders/{firm}/{vendor}/{po}
- GET /api/platform/live/v1/purchase-orders/{firm}/{vendor}/{po}/lines
- GET /api/platform/live/v1/purchase-orders/{firm}/{vendor}/{po}/lines/{line}

All list filters are server-side, exact for identifiers/items, bounded to page
sizes 1-200, and parameterized. Numeric PO, vendor, Work Order, and Sales Order
identifiers are left-padded only when shorter than their canonical width.
Costs and restricted internal fields are absent.

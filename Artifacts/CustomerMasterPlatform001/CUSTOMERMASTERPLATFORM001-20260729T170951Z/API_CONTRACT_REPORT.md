# API Contract Report

LIVE-only read routes:

- `GET /api/platform/live/v1/customer-master`
- `GET /api/platform/live/v1/customer-master/metadata`
- `GET /api/platform/live/v1/customer-master/{customerMasterId}`
- `GET /api/platform/live/v1/customer-master/{customerMasterId}/addresses`

List filters are server-side: `customerNumber` exact, `customerName` contains, `postalCode` exact, `contactName` contains, `salespersonCode` exact, and `territoryCode` exact. Numeric Customer Number input shorter than the established six-character canonical width is left-padded for the request only. Overlength and nonnumeric values are not truncated or rewritten.

Pagination uses the existing `page` and `pageSize` contract (1–200). Invalid values return HTTP 400. POST returns HTTP 405. Historical `/api/platform/v1` has no Customer Master route and no LIVE fallback.

The DTO exposes only approved operational and provenance members. Restricted credit, tax, accounting, internal-comment, and compliance properties are absent.

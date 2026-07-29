# Vendor Master API Contract

- `GET /api/platform/live/v1/vendor-master`
- `GET /api/platform/live/v1/vendor-master/metadata`
- `GET /api/platform/live/v1/vendor-master/{FirmId+VendorNumber}`
- `GET /api/platform/live/v1/vendor-master/{FirmId+VendorNumber}/addresses`

List parameters: `page`, `pageSize`, exact `vendorNumber`, contains `vendorName`, exact `postalCode`, contains `contactName`, and exact `paymentTermsCode`. Numeric Vendor Numbers shorter than six characters are left-padded for the API request; the typed viewer value is retained. Matching remains server-side and does not become partial for Vendor Number.

Pagination is bounded at 1–200. Queries are parameterized. POST is HTTP 405. Runtime identity remains `DLE-OS-HOST\DLE-OS-LIVE-API`; exact browser CORS remains `http://dle-os-host:5041`. Arbitrary origins receive no allow-origin header. Restricted DTO properties are absent.

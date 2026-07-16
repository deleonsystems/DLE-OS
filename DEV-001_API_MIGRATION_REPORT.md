# DEV-001 - Development PC API Migration Report

Date: 2026-07-16

## Summary

The development UI now has a shared API client at `SRC/api/dle-api-client.js`.
It defaults to `http://DLE-OS-HOST` and attempts API reads before falling back to the existing project JSON files.

API discovery against `DLE-OS-HOST` timed out for:

- `http://DLE-OS-HOST/swagger/v1/swagger.json`
- `https://DLE-OS-HOST/swagger/v1/swagger.json`
- `http://DLE-OS-HOST:5000/swagger/v1/swagger.json`
- `https://DLE-OS-HOST:5001/swagger/v1/swagger.json`
- `http://DLE-OS-HOST:8080/swagger/v1/swagger.json`

Because the backend contract was not reachable from this workstation session, endpoint paths are configurable and should be confirmed against the SQL/API platform before removing JSON fallbacks.

## API Client Configuration

Default base URL:

```js
http://DLE-OS-HOST
```

Default endpoint map:

```js
{
  masterData: '/api/master-data',
  operationsOverlay: '/api/operations/overlay',
  shipmentStaging: '/api/shipments/staging',
  shipmentHistory: '/api/shipments/history'
}
```

Override at runtime before module initialization:

```js
window.DLE_API_CONFIG = {
  enabled: true,
  baseUrl: 'http://DLE-OS-HOST',
  endpoints: {
    masterData: '/confirmed/path',
    operationsOverlay: '/confirmed/path',
    shipmentStaging: '/confirmed/path',
    shipmentHistory: '/confirmed/path'
  }
};
```

Or store the same object in browser local storage key `DLE_OS_API_CONFIG`.

## Modules Wired Through API Client

These modules now try DLE-OS-HOST first and preserve existing JSON fallback behavior:

- Master Data auto-load: `DLE_Work_Center_v4.0.0.html`
- Operations Center overlay: `SRC/modules/operations-center/operations-overlay-service.js`
- Shipment Staging read model: `SRC/modules/shipment-staging/shipment-staging-service.js`
- Shipment History module: `SRC/modules/shipment-history/shipment-history.js`
- System Center Shipment History data viewer: `SRC/modules/system-center/system-center.js`

## Modules Still Using Local Files

These are not yet migrated to API-backed operational data:

- Kitting workspace: consumes Operations Center in-memory master records, but temporary kitting fields remain browser-only.
- Kitting workbench: receives selected work order context from the workspace, no direct API read.
- DLE BOM test loader: reads `TEST_DATA/BOM-500144-103.TXT`.
- ERP Open Orders import/reconciliation workflow: still file-driven for imported snapshots and writable master-data approval flows.
- JSON write paths for Operations Overlay, Shipment Staging, and Shipment History remain local file handle or browser storage fallbacks.

## Missing Or Unconfirmed API Endpoints

Confirm these backend endpoints before removing fallbacks:

- `GET` master data records for Operations Center/System Center.
- `GET` operations overlay records.
- `PUT/PATCH` operations overlay records.
- `GET` shipment staging records.
- `PUT/PATCH` shipment staging records.
- `GET` shipment history records.
- `POST` archive shipment history records.
- `DELETE` shipment history record.
- `GET` kitting queue records or official decision that kitting derives only from master data.
- `PUT/PATCH` kitting status fields.
- `GET` BOM by part/revision or work order, replacing `TEST_DATA/BOM-500144-103.TXT`.
- Reconciliation endpoints for ERP snapshot upload, preview, approval, and persisted review events.

## Recommended Migration Order

1. Confirm API base URL, port, CORS policy, and published OpenAPI/Swagger URL from DLE-OS-HOST.
2. Confirm read endpoints for Master Data, Shipment Staging, Shipment History, and Operations Overlay.
3. Update `window.DLE_API_CONFIG` or `DLE_OS_API_CONFIG` with confirmed endpoint paths.
4. Validate UI screens against DLE-OS-HOST API reads while JSON fallbacks remain enabled.
5. Migrate write paths: Operations Overlay first, then Shipment Staging, then Shipment History archive/delete.
6. Migrate Reconciliation once snapshot upload/preview/approval endpoints exist.
7. Migrate Kitting temporary fields to API persistence.
8. Remove local JSON fallbacks after each module has a verified API read/write path and operational acceptance.

## Fallback Policy

JSON services are intentionally preserved as temporary fallbacks. They should be removed module-by-module only after the matching API endpoint is confirmed and tested from the development PC.

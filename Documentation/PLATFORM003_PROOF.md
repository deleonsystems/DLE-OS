# PLATFORM-003 Proof

## 1. End-to-end architecture

Historical Add+ON test data flows through the qualified mirror, Canonical
Contract v1.1, `DLE_OS_PLATFORM_LAB`, and the PLATFORM-002 GET API before
reaching the viewer. The frontend has no alternate business-data path.

## 2. Files created

The isolated module consists of:

- `SRC/modules/canonical-data-viewer/canonical-data-viewer.html`
- `SRC/modules/canonical-data-viewer/canonical-data-viewer.css`
- `SRC/modules/canonical-data-viewer/canonical-data-viewer.js`

Documentation, tests, and evidence are listed in the change inventory.

## 3. Navigation integration

`workspace-registry.js` adds one `Platform` workspace. The main shell adds
one corresponding mount. The module renders one selected child:
`Canonical Data Viewer — Test Data`. No existing navigation item moved or
changed names.

## 4. API calls

The shared client provides readiness, snapshot, four paginated lists, and
four exact lookups under `/api/platform/v1`. Canonical query parameters are
allowlisted, page size is capped at 200, and path identifiers are
component-encoded, including `*`.

## 5. Test-data source

The live qualification returned `Ready`, Contract `V1.1`, import status
`SUCCESS`, and 26,902 rows from `DLE_OS_PLATFORM_LAB`:

- BillOfMaterial: 523
- InventoryItem: 20,257
- WorkOrder: 5,868
- GeneralLedgerAccount: 254

Counts are rendered from snapshot metadata, never from frontend constants.

## 6. Canonical Contract boundary

Detail definitions contain exactly 33 members: 5 BOM, 7 InventoryItem, 18
WorkOrder, and 3 GeneralLedgerAccount. No source file, DDM, mirror column,
SQL key, path, or legacy field identifier is public.

## 7. WorkOrder behavior

The stocked record `0000001` displayed the API-resolved inventory
ItemDescription. The non-stock record `0000005` displayed a null marker for
ItemDescription and preserved both description lines as separate exact
strings. No join, trim, separator, or fallback rule exists.

Work Order Number search remains an exact server-side filter. The shared
frontend client derives the seven-character width from the qualified
canonical platform representation and pads only shorter numeric input before
the request. The raw typed value remains in viewer state and in the input.

## 8. Read-only proof

The viewer contains browse controls only. Every canonical client request
sets HTTP method GET. Static and dynamic tests found no POST, PUT, PATCH,
DELETE, fallback, direct SQL, mirror, CSV, Add+ON, importer, or network-drive
access.

## 9. Visual qualification

The viewer passed at 1366×768, 1920×1080, and 900×900. The banner remained
within the viewport, tabs stayed usable, tables exposed horizontal scrolling
when needed, and the responsive Platform child moved above the content.
Visual review found and corrected an inappropriate Ready-state Retry control
and banner occlusion in the detail drawer.

## 10. Tests

The final automated run passed 38 of 38 scenarios. Browser qualification
passed navigation, status, every entity, pagination, search, both
reserved-character BOMs, all detail boundaries, close/reopen, and
accessibility-oriented controls.

## 11. Existing-module regression

Administration activated with its existing Document Intake content.
Shipping activated its existing loaded mount with headings present. The
Platform workspace reopened with Ready status and 50 Work Order rows.
`workspace-shell.js` and all pre-existing dirty shipping/data files retained
their initial hashes.

## 12. Remaining limitations

The viewer remains historical test-data only. PLATFORM-002 has no
authentication, arbitrary sorting, full-text search, live data, scheduler,
sync, or production deployment. RawDate conversion and Decimal scale remain
undefined by contract. Browser tooling did not expose an HTTP-method network
panel; GET-only behavior was therefore proven by the client implementation,
intercepted automated requests, and live route tests.

## 13. Recommended next migration

After user review, migrate one read-only Work Order inspection surface to
the same canonical client methods. Do not add live data or writes until
separately governed and qualified.

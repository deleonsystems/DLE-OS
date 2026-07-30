# Receiving History Browser Acceptance

Status: **PASS**

Acceptance completed against the governed deployment published on
2026-07-30. The immutable frontend build was
`20260730T114315Z-5AB304D3E33F`.

## Runtime and readiness

- Historical frontend/API: port 5041, PID 25672, HTTP 200.
- LIVE API: port 5042, PID 11596.
- LIVE runtime identity:
  `DLE-OS-HOST\DLE-OS-LIVE-API`.
- Refresh control host: port 5043.
- Promotion broker: port 5044.
- LIVE readiness: `Ready` / `ReadyFresh`.
- Contract version: `1.2`.
- Qualified platform ImportRunId:
  `27f0ed25-adcc-46aa-96f4-f0cc7d6ae8b6`.
- Receiving History ImportRunId:
  `034f0f72-8713-4163-b20d-fb9d421a7961`.

## Ten-section acceptance

The in-app browser loaded
`Workspace View -> Platform -> Canonical Data Viewer — Live Snapshot`.
All ten sections were visible in the approved order and loaded data:

1. Work Orders: 12,113
2. Inventory Items: 28,662
3. Bills of Material: 1,290
4. General Ledger Accounts: 257
5. Sales Orders: 105
6. Invoice History: 26,036
7. Customer Master: 380
8. Vendor Master: 805
9. Purchase Orders: 1,384
10. Receiving History: 189,272

The LIVE read-only banner, qualified database, contract version, snapshot
metadata, frontend build identity, freshness, and existing
`Run ERP Snapshot Refresh` control remained present.

## Receiving History behavior

- Default list reported `Showing 50 of 189,272 canonical records`.
- Receiver `0037273` returned 16 rows. Its malformed Receipt Date displayed
  as unavailable, not as 2030. Detail preserved `D01129`, returned
  `Invalid source value`, and displayed
  `Decoded date exceeds qualified historical/snapshot horizon`.
- Receiver `0030956`, line `010`, preserved Required Date raw value `291120`;
  parsed Required Date was unavailable with the same explicit status/reason.
- Receiver `0030511` returned the exact retained blank-PO orphan. The list
  displayed a blank PO, and detail displayed
  `Missing PO reference (source value blank)` without a fabricated PO.
- Detail views preserved read-only source traceability and the Receiving
  History ImportRunId.

## Browser/runtime regression

No browser console errors were recorded for the Platform Viewer acceptance.
Four pre-existing warnings were emitted by unrelated Shipment
Staging/Shipment History/Operations fallback requests returning HTTP 404;
they did not affect any Platform Viewer section and were not changed by this
mission.

The exact-origin API HTTP qualification passed, including allowed origin
`http://dle-os-host:5041`, arbitrary-origin denial, GET-only behavior, and
historical/live route isolation.

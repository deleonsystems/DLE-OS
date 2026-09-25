# E2E-SIM-001 accepted-material visibility checkpoint

This source checkpoint follows c28e2cc4a9402e797c9484a7ab1bdff4cf26bde9. It preserves LPD, Receiving acceptance/staging and read-only return-to-kit visibility. It does not implement material application, consumption, successor Kitting submissions or Production release.

## Final queue and presentation contract

- Kit Short / Awaiting Parts is a WO queue governed by KIT_SHORT. Accepted supply does not remove the WO.
- Accepted Material / Needs Re-Kit is a separate physical-material queue, one row per receipt identity with distinct assigned demand destinations and quantities. It does not count WOs.
- Completed Kits / History is secondary navigation over the existing active/open-demand completed projection, not a new all-time archive query.
- Kit Short material detail is collapsed by default using native details/summary: `Accepted Material · 1 Ready`. Count is ready requirements, not receipts. Expanded compact Find rows open the exact governed source row. Multiple receipts remain individually visible in the destination workspace.
- Material-first and WO-first navigation use the same KittingJobWorkspace handoff. Viewing/disclosure does not acquire an editing lease or change evidence.

## Governed lineage and supply

The read-only planning snapshot joins purchasing demand, receiving allocations and the immutable Kitting shortage origin in one database transaction. It verifies the current case draft against its submission and exposes case/version, submission, released identity, source row, requirement, Find and released sequence. No part-number-only association is used. No separate Bag No. exists in this source structure.

Material Need-By is accepted customer due date minus frozen approved manufacturing lead using Monday–Friday days (weeks = five days). For this SIM: due 10/14/2026 minus 3 manufacturing days = 10/09/2026. Customer-facing quote delivery of 3 weeks is not manufacturing lead. Outstanding supply LPD retains missing-ETA, partial coverage, multiple shortage and receipt-verification safeguards. Arrival alone does not resolve Kitting.

Receiving owns append-only operational review, delivery, acceptance and staging evidence. Receiving command permissions remain separate from view access. Purchase receipt quantities are read-model overlays; the original purchase is not rewritten. Internal PO and accepted-material label previews read saved evidence without creating receipts or accounting entries. Accepted-material IDs are distinct from VPRO accounting receipt IDs.

## Preserved live checkpoint

- WO0999999 / SIM-ASSY-001 RevA / qty10: KIT_SHORT.
- Case38c8a2f2-06c4-4645-b3db-d0e124a46074, working version50, no editing lease, original sole submission3fe8d4ed-b4e0-432a-bd33-28db07299e3f.
- Find5 / G005 / released sequence5 / source row50e97c24-da69-4801-a10f-b59909926a84: SIM-OPTO-4, required20, previously kitted12, short8.
- SIM-AM-0000001: accepted8EA, staged available8EA, SIM / Kitting staging. PO SIM-PO-0001 /010, packing slip SIM-PS-0001. No consumption.
- Effective material PO traceability Not Required amendment remains; Traveler requirement unchanged.
- Production eligibility remains blocked by KIT_SHORT. No successor submission, KIT_COMPLETE or Production execution.

## Qualification

Final checkpoint build: Tests/SimMaterialPlanning001/SimMaterialPlanning001.csproj with isolated artifacts, zero warnings/errors. Its50 checks passed against a disposable pre-receipt copy; only receipt tables in that copy were removed to qualify outstanding LPD. Live database was read-only.

Final focused Node suites passed: KittingHomeOperatorQueue001; SimMaterialPlanning001 UI; SimReceiving001 workflow UI and preview UI; SimReceivingPrint001 (20checks). git diff --check passed. Prior unchanged baseline includes80 isolated Receiving/backend checks, MaterialStatus001 and ProductionWorkspace001 regressions, and Purchasing UI40checks.

Live browser qualification covered both paths to Find5, receipt lookup, default collapse, click expansion/collapse, keyboard Enter, exact-row View, disabled Save/Submit and desktop1366/tablet768/mobile390 layouts. Original viewport restored. No Resume/Reconnect used. All27 business tables and10 state files remained hash-identical after verification.

## Next authorized work boundary

Governed Apply is not implemented here. Future work must atomically validate demand assignment, case/version/lease, receipt balance/version, UOM and remaining shortage; append application evidence and support partial application. Save currently rejects unsupported accepted-material execution evidence. Receipt availability currently has no consumption ledger. Successor demand reconciliation must prevent duplicate buying and preserve predecessor shortage evidence. Do not implement by copying receipt quantities into manual counts or mutating original submissions.

## Checkpoint scope and exclusions

Receiving source/tests are included because they provide the accepted-material model consumed by the new read-only projection. Home-ordering remains excluded at SRC/home/work-area-home.js. Tests/SimRfqs001/install-demo.py is unrelated/pre-existing and excluded. All output/, tmp/, runtime/database/business evidence and binaries remain local. No push.

## Exact source/test/documentation manifest
- DOCS/workflow-notes/E2E-SIM-001-accepted-material-checkpoint.md
- SRC/modules/work-order-dashboard/work-order-dashboard.js
- SRC/workspaces/kitting/kitting-read-model.js
- SRC/workspaces/kitting/kitting-workspace.css
- SRC/workspaces/kitting/kitting-workspace.html
- SRC/workspaces/kitting/kitting-workspace.js
- SRC/workspaces/purchasing/purchasing-po-document.js
- SRC/workspaces/receiving/receiving-accepted-material-label.js
- SRC/workspaces/receiving/receiving-print-preview.html
- SRC/workspaces/receiving/receiving-print-preview.js
- SRC/workspaces/receiving/receiving-workspace.css
- SRC/workspaces/receiving/receiving-workspace.js
- Tests/KittingHomeOperatorQueue001/run-tests.mjs
- Tests/SimMaterialPlanning001/Program.cs
- Tests/SimMaterialPlanning001/run-ui-tests.mjs
- Tests/SimPurchasing001/Program.cs
- Tests/SimPurchasing001/run-receiving-ui-tests.mjs
- Tests/SimReceiving001/Program.cs
- Tests/SimReceiving001/SimReceiving001.csproj
- Tests/SimReceiving001/run-preview-tests.mjs
- Tests/SimReceiving001/run-ui-tests.mjs
- Tests/SimReceivingPrint001/run-tests.mjs
- Tools/SimRuntime/DleOs.SimHost/Program.cs
- Tools/SimRuntime/DleOs.SimHost/SimKittingSupplyStore.cs
- Tools/SimRuntime/DleOs.SimHost/SimMaterialPlanning.cs
- Tools/SimRuntime/DleOs.SimHost/SimPersonaCatalog.cs
- Tools/SimRuntime/DleOs.SimHost/SimPurchasing.cs
- Tools/SimRuntime/DleOs.SimHost/SimPurchasingStore.cs
- Tools/SimRuntime/DleOs.SimHost/SimReceiving.cs
- Tools/SimRuntime/DleOs.SimHost/SimReceivingEndpoints.cs
- Tools/SimRuntime/DleOs.SimHost/SimReceivingModels.cs
- Tools/SimRuntime/DleOs.SimHost/SimReceivingStore.cs

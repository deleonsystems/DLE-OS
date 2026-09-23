# E2E-SIM-001 — live Order Entry queue wiring

## Root cause and correction

The main HTML already contained a legacy `data-workspace-home="order-entry"` panel with three placeholder tiles. `ensureWorkspacePanel` returned that existing panel before creating a `data-workspace-mount="order-entry"`. The bridge JavaScript loaded but its render function found no mount and returned. Prior standalone rendered-UI tests did not exercise this shell integration.

The shell now replaces the legacy panel content with the bridge mount in SIM only. Existing module mounts are retained on repeated activation. No server restart or storage change is needed; refreshed pages load the updated assets.

The active queue includes READY_FOR_VPRO, IN_PROGRESS and READY_FOR_OPERATIONS_SYNC. It excludes RELEASED_TO_OPERATIONS. It shows Customer, PO / Source New Order, Assembly / Rev, Qty, Due Date, Status and Open. Pending acceptance stays separate. Selected detail makes accepted order identity and RFQ/quote lineage visible above evidence, the approved BOM, checklist and synthetic identifiers.

## Live record verified

- New Order RFQI-SIM-0043; accepted package revision 7.
- Acceptance 04c9d3d4-0262-43fe-aa92-e1c880696d02.
- Exactly one bridge: 2cdeb739-29a3-48be-bd6f-35476bf8d5f2; bridge revision 9.
- Actual live status READY_FOR_OPERATIONS_SYNC; displayed as Ready for Operations Sync — Awaiting simulated Operations recognition.
- DLE-SIM-CUSTOMER / SIM-E2E-001-PO / SIM-ASSY-001 / A / quantity 10 / due 10/14/2026.
- All five existing synthetic checklist attestations retained.
- Existing synthetic namespace SIM-VPRO5, SO SIM-SO-0043, line 001, WO SIM-WO-0043 retained.
- Source RFQI-SIM-0042 → SIM-Q-0042-R01 → accepted New Order baseline retained.

This is the existing live record, not isolated test output. No enqueue or mutation endpoint was called for this correction.

## Verification

- Fresh GET /api/sim/order-entry returned exactly one matching row.
- Fresh GET /api/sim/order-entry/RFQI-SIM-0043 returned the acceptance, bridge, 12 approved BOM rows and existing document URLs.
- `node Tests/SimOrderEntry001/run-ui-tests.mjs tmp/order-entry/queue-detail-live.json`: 15 checks passed.
- `node Tests/SimOrderEntry001/run-shell-queue-tests.mjs tmp/order-entry/queue-detail-live.json tmp/order-entry/queue-live.json`: integration checks passed, including actual shell loading into legacy panel, single matching row, detail, active-state filtering, no write requests, repeated activation and non-SIM preservation.
- `node --check SRC/shell/workspace-shell.js` and `node --check SRC/workspaces/order-entry/order-entry-workspace.js`: passed.
- PO, technical drawing, BOM PDF and accepted review PDF: HTTP 200.
- rfq-intakes.json, rfq-lanes.json and dle-os-sim.db hashes unchanged across this correction. No acceptance, checklist, identifiers, quote, technical authority or Operations changes.
- Browser visual verification pending access-code unlock in separate verification tab. User's original questionnaire tab left untouched.

## Files changed

- SRC/shell/workspace-shell.js
- SRC/workspaces/order-entry/order-entry-workspace.js
- SRC/workspaces/order-entry/order-entry-workspace.css
- Tests/SimOrderEntry001/run-ui-tests.mjs
- Tests/SimOrderEntry001/run-shell-queue-tests.mjs
- This report.

Branch feature/miguel-new-order-intake; HEAD 6b54b24cb8cf1fb053dc2979519c5b334aebb101. Working tree contains pre-existing and current uncommitted changes. No commit made.

Resume: refresh SIM, choose Order Entry (VPRO 5 Bridge), then Open on SIM-E2E-001-PO. Do not use the stale pre-acceptance questionnaire screen. Stop before any checklist or Operations action.

# E2E-SIM-001 — Operations field mapping patch

Verified 09/23/2026 for SO 0099999 / line 010 / WO 0999999. The patch changes packet/read/display contracts; it does not edit the imported row or any business state.

## A. Verdict

PASS: focused backend, frontend, live API/read-model and browser checks pass. The live Operations table was visually verified with all four distinct date labels and Needs Kitting, and left filtered to SO 0099999. One broader legacy regression fails identically against original HEAD sources; it is documented below.

## B–C. Order Date cause and recommendation

Operations `orderDate` represents ERP Sales Order Date. The canonical mapping document maps SalesOrder.OrderDate from ARE-03A240; the line EstimatedShipDate has a different ERP source, ARE-13A140. It is not Customer PO Date.

The prior SIM packet explicitly chose 09/23/2026, the accepted-order event calendar date, for its simulated ERP order/opened date. Customer PO Date remains 09/22/2026.

The patch retains `orderDate` and renames the visible column **ERP Order Date**. A separate **PO Date** column reads `customerPoDate`. New schema-2 packets carry the accepted Intake header PO Date; legacy schema-1 imports obtain that field in a read-only response projection after validating receipt, packet hash, runtime and accepted-source lineage. The original schema-1 packet, hash, receipt and stored canonical payload remain unchanged.

## D–E. Due date cause and patch

The old visible label “Due / Estimated Ship Date” used only `estimatedShipDate`, which is intentionally unset here. The importer already retained `customerDueDate`, but the Operations row normalizer and table omitted it.

The normalizer now preserves both fields. Separate **Customer Due Date** and **Estimated Ship Date** columns show **10/14/2026** and **Not set**. No substitution or conversion between these facts occurs. Date-only formatting uses string components, with no timezone conversion. Existing estimated-ship sorting remains unchanged. Mobile detail labels also distinguish all four dates.

## F. Material Status

Material Status is a Kitting/material-execution disposition. The correct initial state here is **Needs Kitting**, using existing `NEEDS_KITTING` / `KITTING_ELIGIBILITY` semantics. `NEW` is an existing compact Kitting card label, not a new material-state value. Last Verified Status remains unset until an actual verification event is recorded.

The SIM embedded read previously returned `materialStatus:null` and an empty material WO key whenever no KittingReadState existed. Operations accepted those embedded fields and skipped shared MaterialStatus resolution; Kitting independently applied its existing eligibility default.

The server read now exposes the eligible WO key for an exact, canonical, positive/open SO line with no case. Operations resolves only the missing eligible status through the existing `MaterialStatus.getMany` and governed read-only no-case endpoint. Existing Kit Short/Complete/In Progress projections are retained. Candidate-only, missing/mismatched keys, closed/negative, RMA and direct-fulfillment records are not assigned this default. Read failure surfaces instead of inventing status.

## G. Future import mapping

| Business fact | Packet/canonical mapping | Operations presentation |
|---|---|---|
| Customer PO Date | Accepted package Facts.PoDate → packet orderLine.customerPoDate → canonical customerPoDate | PO Date |
| ERP order date | Explicit simulated ERP orderLine.orderDate → canonical orderDate | ERP Order Date |
| WO opened date | Explicit workOrder.openedDate → canonical WO openedDate | Separate WO fact |
| Customer Due Date | Accepted order line CustomerDueDate → orderLine.customerDueDate → canonical customerDueDate | Customer Due Date |
| ERP/planning estimated ship date | Explicit orderLine.estimatedShipDate only; unset stays unset | Estimated Ship Date / Not set |
| Overall status | Canonical WO OPEN remains independent of verified-status event history | No invented NEW/verification event |
| Material status | Existing embedded case/evidence, or shared eligible no-case projection | Needs Kitting here |

Newly prepared packets use schema 2 and require a valid ISO date-only Customer PO Date. Schema 1 remains readable and idempotently retryable. The existing developmental adapter's E2E-SIM-001 authorization scope is unchanged; this patch does not authorize arbitrary orders.

## H. Live result

Normal API capture, actual Operations/Kitting source modules and the live browser Operations table verified:

| Field | Result |
|---|---|
| Customer | DLE-SIM-CUSTOMER |
| PO | SIM-E2E-001-PO |
| SO / Line / WO | 0099999 / 010 / 0999999 |
| Assembly / revision | SIM-ASSY-001 / A |
| Open quantity | 10 |
| ERP Order Date | 09/23/2026 |
| PO Date | 09/22/2026 |
| Customer Due Date | 10/14/2026 |
| Estimated Ship Date | Not set |
| Material Status | Needs Kitting |
| Last Verified Status | Unset |

Existing recognition remains **Recognized in SIM Operations**. Receipt ae0b6316-24dd-4649-a1ae-156982e06f03 and original schema-1 packet 1061138f-bcda-4bc8-8e7d-b8815fc03635/hash remain unchanged. Kitting still has no case for this WO.

## I. Files changed

Source:

- SRC/modules/operations-center/operations-center-data-service.js
- SRC/modules/operations-center/operations-center-fields.js
- SRC/modules/operations-center/operations-center-view-model.js
- SRC/modules/operations-center/operations-center.js
- Tools/SimRuntime/DleOs.SimHost/Program.cs
- Tools/SimRuntime/DleOs.SimHost/SimOperationsDataStore.cs
- Tools/SimRuntime/DleOs.SimHost/SimOperationsEndpoints.cs
- Tools/SimRuntime/DleOs.SimHost/SimOperationsHandoff.cs
- Tools/SimRuntime/DleOs.SimHost/SimOperationsPacketStore.cs

Tests:

- Tests/OperationsCenterManagerTable001/run-tests.mjs
- Tests/SimOperationsPacket001/Program.cs
- Tests/SimOperationsPacket001/CommercialContextChecks.cs (new)
- Tests/SimOperationsPacket001/run-date-display-tests.mjs (new)
- Tests/SimOrderEntry001/run-operations-material-mapping-tests.mjs (new)
- Tests/SimOrderEntry001/run-operations-readback.mjs

This report is new. Temporary captures and comparison scripts are in tmp/order-entry. No production importer, Kitting execution logic or storage schema was changed.

## J. Tests

Run from C:/DLE-OS/Repositories/DLE-OS:

```powershell
dotnet build Tests/SimOperationsPacket001 -p:NuGetAudit=false -p:OutputPath=C:/DLE-OS/Repositories/DLE-OS/tmp/packet-date-test-build/ --nologo -v:q
dotnet tmp/packet-date-test-build/SimAnalysis001.dll C:/DLE-OS/Repositories/DLE-OS
dotnet tmp/packet-date-test-build/SimAnalysis001.dll C:/DLE-OS/Repositories/DLE-OS commercial-context C:/DLE-OS/Repositories/DLE-OS/.sim-state
node Tests/SimOperationsPacket001/run-date-display-tests.mjs
node Tests/SimOrderEntry001/run-operations-material-mapping-tests.mjs
node Tests/SimOrderEntry001/run-operations-readback.mjs tmp/order-entry/field-mapping-live-readback.json
```

Build: zero warnings/errors. Results: **63** packet-store, **16** commercial-context, **38** date display, **30** material mapping and **37** live readback checks passed. Commercial-context tests use isolated cloned state and prove schema-1 hash/retry compatibility and no stored changes.

Additional passing commands:

```powershell
node Tests/MaterialStatus001/run-tests.mjs
node Tests/OperationsCenterManagerTable001/run-tests.mjs
node Tests/OperationsCenterWorkOrderStatus001/run-tests.mjs
node Tests/OperationsCenterDegradedRead001/run-tests.mjs
node Tests/OperationsCenterSyncReload001/run-tests.mjs
node Tests/WorkAreaHomeOperationsCenter001/run-tests.mjs
node Tests/KittingHomeOperatorQueue001/run-tests.mjs
```

Known pre-existing failure: `node Tests/OperationalMasterDataSql001/test_operations_center_phase2.mjs`, line 182 expects Kit Complete after the test explicitly marks a failed refresh; the view model returns Unavailable. The same failure was reproduced using original HEAD versions of all six Operations modules through a temporary read override, without checkout/reset. No expectation was weakened to hide it.

## K. Preservation and stopping point

All **119** business/state/evidence files remained byte-for-byte unchanged across activation and readback, including all 107 Intake document binaries, metadata/generation, SQLite, Intake and quote JSON. Zero files added, removed or changed within the checked state roots.

SQLite SHA256 remains 2219726FE2B0E223D3CC4D8904AE76485C0F4E418258676446AC63A78D7F1CF0. Existing counts remain SO lines 8, WOs 5, KittingReadState 3, verified events 3, receipt 1, evidence 1. No accepted New Order, quote, BOM, Labor, receipt, bridge or canonical row was modified.

Evidence: tmp/order-entry/field-mapping-live-readback.json, field-mapping-live-detail.json, field-mapping-live-handoff.json and field-mapping-preservation-report.json.

No real Sync Operations, VPRO, inventory, material demand, shortage work or Kitting execution occurred. Refresh Operations Center and find SO 0099999 / line 010 for read-only verification.

Git: branch feature/miguel-new-order-intake; HEAD 6b54b24cb8cf1fb053dc2979519c5b334aebb101. Earlier dirty work retained; no commit created.

# E2E-SIM-001 — generic SIM Kitting

Verification date: 09/23/2026. Scope: start one empty case for WO 0999999; no material execution or downstream activity.

## A. Verdict

**PASS WITH CONDITIONS.** Generic SIM Kitting, live Start, Save, Save & Exit, reload and Resume pass. Exactly one case exists with all 12 requirements and zero execution entries. The separate printable Released BOM popup was not observable in Codex after its View action; its generated contents are covered by isolated tests. The on-screen released BOM is fully verified. The retired-artifact test limitation and older DEV historical PDF issue remain separate from the functioning live case.

## B. Generic architecture

Reused the existing Kitting Job Workspace, released-requirement table, row dialogs, allocation/count rules, traceability model, lease/version contracts, history, labels and report writer. The active controller targets the selected canonical WO instead of prototype WO 0115621 or WorkOrderReleasedBom004. Unsupported paths remain read-only. DEV services were not deployed or instantiated inside SIM.

SIM uses three additive SQLite tables in the existing SIM database: SimKittingCase, SimKittingCaseEvent and SimKittingSubmission. Existing canonical tables are not rewritten. The pure draft validator is shared with the existing ControlHost; SIM owns its persistence and authenticated command adapter.

## C. Released requirements provider

WO 0999999 → canonical SO 0099999 / line 010 → verified SIM Operations import receipt/packet → RFQI-SIM-0043 accepted package revision 7 → frozen quoted technical definition → accepted 12-row BOM.

Validation checks runtime generation, canonical recognition, exact WO/SO/line identifiers, import/acceptance tokens, bridge eligibility and approved identities. It does not reread mutable Technical Review or extract PDFs. Start holds runtime → Intake → Operations locks through the commit so concurrent bridge changes cannot slip between source validation and Start.

Release version: 1. Deterministic identity:

`SIM-KITTING-V1:70C5C2F4477060EE2E4C7245C0381AD4BF0DE16D1CAB47451F6E068282B1477F`

Lineage retains accepted intake/revision, source RFQ/quote/approval, BOM and manufacturing definition, document hashes, source rows and approved identity evidence. Save compares the retained frozen requirements; execution changes cannot alter identity, quantity, DNP, references or alternatives.

## D. Released BOM

All quantities use EA. No DNP or inferred alternates.

| Approved requirement | Qty/assembly | Required | References |
|---|---:|---:|---|
| SIM-PCB-001 REV A | 1 | 10 | PCB1 |
| SIM-R-1K | 2 | 20 | R1, R2 |
| SIM-R-10K | 2 | 20 | R3, R4 |
| SIM-C-100N | 2 | 20 | C1, C2 |
| SIM-OPTO-4 | 2 | 20 | U1, U2 |
| SIM-J-4 | 2 | 20 | J1, J2 |
| SIM-LED-G | 2 | 20 | D1, D2 |
| SIM-D-REV | 2 | 20 | D3, D4 |
| SIM-TP | 4 | 40 | TP1–TP4 |
| SIM-HW-M3 | 4 | 40 | H1–H4 |
| SIM-LABEL | 1 | 10 | LBL1 |
| SIM-BAG | 1 | 10 | PKG1 |

## E. UI

The existing H24589-style workspace and six-column operator table are reused. Required cells retain per-assembly and total quantities, descriptions and references. Start/Resume, Save and Save & Exit are exposed only for a supported SIM WO with server editing capability and user permission. The former blanket SIM CSS that hid Kitting actions is narrowed to unsupported cases.

## F–G. Live case and persistence

- Case ID: `38c8a2f2-06c4-4645-b3db-d0e124a46074`.
- State: `KITTING_IN_PROGRESS`; run 1, working version 6.
- 12 actionable requirements; 0 dispositioned; 12 null execution entries; 0 short requirements, 0 total shortage; 0 submissions.
- Lease owner: SIM Administrator; acquired 09/23/2026 at 1:22:33 PM Pacific, expires 1:37:33 PM Pacific. Normal Resume/recovery applies after expiry.
- Browser path completed: Start (v1) → Save (v2) → Save & Exit (v3, lease released) → reload → reopen → Resume (v4). A second empty Save & Exit (v5), reload and Resume (v6) verified the final queue display correction. Case ID and frozen release identity remained identical.
- All 12 rows, accepted identities, descriptions, references, per-assembly and total quantities were visible after reload. No row result button, count or allocation was used.

Read-only preservation comparison found **118 non-database files unchanged and all 12 existing database tables unchanged**. The only changed business-data file is the SIM database, with additive Kitting tables containing 1 case, 6 audit events and 0 submissions. Intake JSON, accepted package, source quote, stored documents and canonical SO/WO records remain unchanged. No inventory, Purchasing, Receiving or Production records were created.

Evidence retained under `C:\DLE-OS\Repositories\DLE-OS\tmp\kitting`: `before.json`, `live-before.json`, `live-save-exit.json`, `live-after.json`, `release-before.json`, `release-after.json`, `live-history.json`, `preservation-after.json`, and `operations-before.json` / `operations-after.json`.

## H. Editing and durability

Server-backed row Submit waits for durable save; pending/failed save state is explicit. Save and Save & Exit use expected working version and the editing session. The server owns actor, timestamps and row revision stamps. Stale writes fail, and an expired lease must be recovered. Lease duration is 15 minutes. Isolated tests exercise row edit/save/reload without adding execution evidence to the live case.

## I. Fractional display

Shared compact formatting preserves nonzero fractions in table, released BOM report and bag labels without changing arithmetic. Tests include 0.001, 0.0001 and 0.0000001, whole numbers and floating-point display noise. The shared PDF formatter retains meaningful decimal precision and trims trailing zeros; its check uses 0.0000125. DEV deployment was left unchanged.

## J. Audit and events

SIM history is append-only and submissions/PDFs are immutable, enforced by database triggers. EDITING_ABANDONED is included in SIM event constraints and the checked-in SQL event constraints. No SQL migration was applied to DEV. Start, saves, exit and lease acquisition persist authenticated actor/server time/version. Future submission and stored PDF/hash behavior passed isolated tests only; live submission is prohibited for this task.

## K. PO traceability

The accepted contract requires traceability. The case starts REQUIRED and the server rejects disabling that contractual requirement. Existing manual PO evidence rules are available for positive allocations. Receipt-backed evidence fails closed until a real SIM Receiving adapter exists. No PO/allocation evidence is entered during live qualification.

## L. Operations/material status

Browser verification showed Operations Center SO 0099999 / 010 / WO 0999999 with **Material Status = Kitting In Progress**. Kitting remains in the **Needs Kitting** queue (which includes started unfinished cases), now labeled **IN PROGRESS**. Queue counts did not shift into Kit Short or Kit Complete.

The raw canonical SO snapshot's embedded materialStatus remains null; both workspaces resolve the current governed case using the shared Material Status service. The Kitting queue now fetches missing/null embedded statuses rather than treating null as proof that no case exists. No manual status or canonical SO/WO edit was made. The queue's existing DUE presentation still says N/A because Estimated Ship Date is unset; Operations separately retains Customer Due Date 10/14/2026 and PO Date 09/22/2026.

## M. H24589 preservation

Read-only DEV browser verification after implementation showed WO 0115621, H24589 Rev J, quantity 10, working version 253, 43/44 dispositioned, traceability REQUIRED and editing disabled. No mutation was performed in DEV. Its retained requirements remain visible without the retired prototype artifact. Existing Kit Complete V001 `kitting_pdf_not_found` remains a separate historical-evidence issue, as requested.

## N. Files changed for this task

Paths below are relative to `C:\DLE-OS\Repositories\DLE-OS`; the working tree also contains earlier E2E changes that are not part of this task.

Application:

- DLE_Work_Center_v4.0.0.html
- SRC/api/dle-api-client.js
- SRC/shared/kitting-quantity.js (new)
- SRC/workspaces/kitting/kitting-workspace.js
- SRC/modules/work-order-dashboard/work-order-dashboard.js
- SRC/modules/work-order-dashboard/work-order-dashboard.html
- SRC/modules/work-order-dashboard/active-kitting-trial.js
- SRC/modules/work-order-dashboard/kitting-bag-label.js
- Tools/SimRuntime/DleOs.SimHost/SimKittingRequirements.cs (new)
- Tools/SimRuntime/DleOs.SimHost/SimKittingCases.cs (new)
- Tools/SimRuntime/DleOs.SimHost/SimKittingEndpoints.cs (new)
- Tools/SimRuntime/DleOs.SimHost/SimOperationsDataStore.cs
- Tools/SimRuntime/DleOs.SimHost/SimOperationsEndpoints.cs
- Tools/SimRuntime/DleOs.SimHost/SimShellRenderer.cs
- Tools/SimRuntime/DleOs.SimHost/Program.cs
- Tools/SimRuntime/DleOs.SimHost/DleOs.SimHost.csproj
- Tools/KittingCase/Shared/KittingDraftValidator.cs (new)
- Tools/KittingCase/Database/001_AddKittingCase.sql
- Tools/KittingCase/Database/002_AddKittingCaseRuns.sql
- Tools/LiveSnapshotRefresh/ControlHost/KittingCaseCenter.cs
- Tools/LiveSnapshotRefresh/ControlHost/KittingCasePdfWriter.cs
- Tools/LiveSnapshotRefresh/ControlHost/DleOs.LiveSnapshotRefresh.ControlHost.csproj

Tests/documentation:

- Tests/SimKitting001/SimKitting001.csproj (new)
- Tests/SimKitting001/Program.cs (new)
- Tests/SimKitting001/RequirementsChecks.cs (new)
- Tests/SimKitting001/ConcurrencyChecks.cs (new)
- Tests/SimKitting001/PdfQuantityChecks.cs (new)
- Tests/SimKitting001/run-ui-tests.mjs (new)
- Tests/SimKitting001/README.md (new)
- Tests/KittingJobWorkspace001/run-tests.mjs
- Tests/KittingLeaseRecovery001/run-tests.mjs
- Tests/KittingHomeOperatorQueue001/run-tests.mjs
- Tests/KittingReleasedBomReport001/run-tests.mjs
- Tests/KittingAcceptedMaterialLabel001/run-tests.mjs
- Tests/Kitting001C1/run-kitting001c1-tests.mjs
- Tests/SimBroaderReadOnly001/run-tests.ps1
- Documentation/E2E-SIM-001-generic-kitting.md (this report)

## O. Tests

- `dotnet build Tests/SimKitting001/SimKitting001.csproj -p:NuGetAudit=false -o tmp/kitting/tests-bin --nologo -v:q`: PASS, 0 warnings/errors.
- `dotnet tmp/kitting/tests-bin/SimAnalysis001.dll C:/DLE-OS/Repositories/DLE-OS C:/DLE-OS/Repositories/DLE-OS/.sim-state`: PASS, 80 checks. Source checkpoint is copied; only the disposable copy receives test counts, shortages, submissions or resets of the three new Kitting tables. Includes concurrent bridge REOPEN, frozen requirements, duplicate Start, permissions, leases, stale saves, audit spoof rejection and immutable history/PDFs.
- `node Tests/SimKitting001/run-ui-tests.mjs`: PASS, 61 UI/precision/durability/capability checks.
- `pwsh -NoProfile -File Tests/SimBroaderReadOnly001/run-tests.ps1`: PASS, 59 checks in a selective disposable repository, 0 build warnings/errors; unsupported baseline mutations and no-access boundaries remain protected.
- `node Tests/KittingJobWorkspace001/run-tests.mjs`: PASS.
- `node Tests/KittingLeaseRecovery001/run-tests.mjs`: PASS.
- `node Tests/KittingNavigationGuard001/run-tests.mjs`: PASS.
- `node Tests/MaterialStatus001/run-tests.mjs`: PASS.
- `node Tests/KittingHomeOperatorQueue001/run-tests.mjs`: PASS.
- `dotnet run --project Tests/KittingPoTraceability001/KittingPoTraceability001.csproj --no-restore -p:NuGetAudit=false -p:OutputPath=C:/DLE-OS/Repositories/DLE-OS/tmp/kitting/traceability-bin/`: PASS, 12 checks after restoring existing packages.
- JavaScript syntax checks: PASS for changed controller, API and trial code.

The older ReleasedBomReport001 fixture suite cannot complete because it depends on the retired WorkOrderReleasedBom004 artifact. That artifact was not recreated. The new generic suite covers report rendering and retained saved DEV requirements instead.

## P. Git

Branch: `feature/miguel-new-order-intake`.

HEAD: `6b54b24cb8cf1fb053dc2979519c5b334aebb101`.

Working tree contains this implementation plus prior E2E edits (118 modified/untracked status entries at verification); index is empty. No commit, reset, cleanup, merge or push performed.

## Q. Resume point

The Codex SIM tab is left on the resumed case with all 12 requirements in the existing table. From Home: **Kitting → Needs Kitting → WO 0999999 / SIM-ASSY-001 Rev A → Resume Kitting** (or Continue Kitting while the lease remains active). All 12 execution entries are empty for Miguel. Do not submit or create the intentional SIM-OPTO-4 shortage until Miguel operates the case.

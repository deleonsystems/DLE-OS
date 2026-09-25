# E2E-SIM-001 Production / Traveler foundation checkpoint

Parent source checkpoint: `cbca94b8e14c63cd0cf36d3d75a7d1c54507de8d`.
Branch: `feature/miguel-new-order-intake`.

## Scope and stopping point

This checkpoint contains only the Production / Traveler foundation and its tests/documentation. It implements frozen accepted Labor -> reviewed Traveler Definition -> immutable approved version -> frozen WO Traveler. It does not implement Production execution.

WO 0999999 is KIT_COMPLETE / READY_TO_START_PRODUCTION. The first operation is 20 PCB Preparation, Ready / Not Started. Its Start control is visible and intentionally disabled pending a later execution slice. No execution event, start timestamp or operation execution record exists.

Material Status remains owned by Materials/Kitting. Production status is a separate pre-start projection: Needs Kitting and Kitting In Progress -> Awaiting Kitting; Kit Short -> Awaiting Parts; Kit Complete with approved/bound Traveler and valid lineage -> Ready to Start Production. Missing approval/binding or invalid sources cannot imply readiness. Future Start must introduce Production-owned execution lifecycle rather than continue deriving a started job's lifecycle from Materials labels.

The first definition is scoped to the WO's frozen accepted package. A reusable cross-order assembly catalog, amendment/rebinding commands, operator/department screens and execution are outside this slice.

## Live governance and source lineage

- WO 0999999; DLE-SIM-CUSTOMER; SIM-ASSY-001 Rev A; quantity 10; customer due 10/14/2026.
- Accepted New Order RFQI-SIM-0043 -> source quote SIM-Q-0042-R01 -> frozen approved Labor v2.
- Manufacturing definition `c545f92b-d0ac-40f6-b072-ff1ce68a1f6b`; LABOR_BATCH_ALLOCATION_V6; manufacturing lead 3 Days.
- Traveler Definition `7bc1ef6f-9e18-41a8-ae72-9de8fbc1dc44`, Approved v1, working concurrency version 4.
- WO Traveler `9573a643-5430-4d7d-87b7-225e3e681ed5`, frozen v1, bound to approved definition v1.
- Initial approval: SIM Administrator, 2026-09-25T18:02:24.5288099+00:00.
- Append-only history: SEEDED, EDIT_LEASE_ACQUIRED, APPROVED, WO_BOUND. No execution events.

Expected working versions, source validation, edit leases and transaction-time release checks guard mutations. Approved versions and bindings are immutable; editing a later definition version does not change the bound WO. Source instructions remain read-only and separate from editable shop instructions, management notes and inspection guidance.

## Route, notes and references

All 13 source operations and source IDs are retained. Source op-1 / sequence 10 Kitting is explicitly a Materials prerequisite, excluded from active Production rather than deleted.

The twelve active operations, all NOT_STARTED:

1. 20 PCB Preparation
2. 30 SMT Setup
3. 40 Solder Paste
4. 50 SMT Placement
5. 60 Reflow
6. 70 First Piece / In-Process Inspection
7. 80 Thru-Hole Assembly
8. 90 Hand Solder
9. 100 Cleaning
10. 110 Final Inspection
11. 120 Test
12. 130 Packaging

Stable Traveler IDs are independent of sequence values. Work centers remain Not Assigned. Frozen source instructions and PRODUCTION notes are retained; INTERNAL_RFQ notes are excluded. Existing visual binaries for op-5, op-7, op-8 and op-11 are reused and verified. Hand Solder remains text-only.

Production management provides read-only BOM, final Kitting Result, Technical Definition, accepted Customer Requirements and audit History. The BOM joins frozen released requirements to final governed submission evidence by requirement identity. Completion-only dispositions are not represented as measured counts.

SIM-OPTO-4: required 20 EA, original Kitting 12 EA, accepted material applied 8 EA, final recorded 20 EA, shortage 0, Counted Exact. Evidence retains SIM-AM-0000001, SIM-PO-0001 / 010 and application `b2343bcf-681b-48ca-86fe-ddd716113fe2`.

Final Kitting submission `f5ad0f78-8c37-430c-a551-8b452204aa2d`, version 1, is the bound reference. SHA-256: `EEF8C196F855EC480A4A0C9C941CE1C01FA0C25A61BD40C59034EB194D8807B0`.

## Printing

Server-generated Traveler and BOM PDFs represent the package as of generation. Every page is marked NON-CONTROLLED COPY and DLE-OS ELECTRONIC RECORD GOVERNS, with actor/time and version/source context. Printing is read-only and is not a signoff. Live outputs were verified at 7 Traveler pages and 5 BOM pages; all pages were visually inspected.

## Final checkpoint qualification

An isolated source candidate was built from the exact parent HEAD plus only the 19 Production source/test files below. None of the excluded re-kit, Materials reconciliation or Home edits were copied into that candidate. Host/test project build succeeded with zero warnings/errors.

- Traveler backend/governance harness: 83 checks passed against a disposable copy of current SIM state. Covers source, BOM join, readiness, concurrency, immutable approval/binding, references and PDF generation.
- Production UI: 50 checks passed.
- Actual backend-projection UI: 41 checks passed.
- ProductionWorkspace001 legacy queue/search/navigation contracts: passed.
- Independent read-only live verification: 56 checks passed.
- Final authenticated API: KIT_COMPLETE, READY_TO_START_PRODUCTION, approved/frozen v1, 12 active operations, no validation errors, executionStarted false, first operation READY/NOT_STARTED, startAvailable false.
- `git diff --check`: passed.

The harness was adjusted to remove Traveler tables only in its newly created disposable database copy. This permits repeated initial-governance testing after the live reference has been approved. The source database is opened read-only and is never reset by tests.

Unchanged PDF baseline: 94 renderer checks and 156 live projection/PDF checks passed, plus visual review of all 12 pages. PDF implementation did not change during checkpointing. Earlier Kitting, Purchasing, Receiving and Material Planning regressions remain baseline evidence; they were not unnecessarily rerun.

## Change classification and exclusions

Audit before staging: branch as above; parent HEAD as above; upstream `origin/feature/miguel-new-order-intake`; 4 ahead / 0 behind relative to the locally available upstream ref; index empty. No fetch/push was performed.

Category A: the 19 Production source/test files below, plus this checkpoint document.

Category B, existing Material Status reconciliation, excluded:

- SRC/workspaces/purchasing/purchasing-buyer-workspace.js
- SRC/workspaces/receiving/receiving-workspace.js
- Tests/SimMaterialPlanning001/Program.cs
- Tests/SimPurchasing001/run-ui-tests.mjs
- Tests/SimReceiving001/run-ui-tests.mjs
- Tools/SimRuntime/DleOs.SimHost/SimKittingSupplyStore.cs
- Tools/SimRuntime/DleOs.SimHost/SimMaterialPlanning.cs

Category C, existing Home ordering, excluded: SRC/home/work-area-home.js.

Category F, earlier governed re-kit/application work and unrelated helper, excluded. Some shared re-kit files also retain later reconciliation/display changes; their entire existing working copies remain untouched:

- SRC/api/dle-api-client.js
- SRC/modules/work-order-dashboard/active-kitting-trial.js
- SRC/modules/work-order-dashboard/work-order-dashboard.css
- SRC/modules/work-order-dashboard/work-order-dashboard.js
- Tools/KittingCase/Shared/KittingDraftValidator.cs
- Tools/SimRuntime/DleOs.SimHost/SimKittingCases.cs
- Tools/SimRuntime/DleOs.SimHost/SimKittingEndpoints.cs
- Tools/SimRuntime/DleOs.SimHost/SimPurchasing.cs
- Tools/SimRuntime/DleOs.SimHost/SimPurchasingStore.cs
- Tools/SimRuntime/DleOs.SimHost/SimReceivingModels.cs
- Tools/SimRuntime/DleOs.SimHost/SimReceivingStore.cs
- Tools/SimRuntime/DleOs.SimHost/SimKittingMaterial.cs
- Tests/SimKittingMaterial001/MaterialScenarios.cs
- Tests/SimKittingMaterial001/Program.cs
- Tests/SimKittingMaterial001/SimKittingMaterial001.csproj
- Tests/SimKittingMaterial001/run-ui-tests.mjs
- Tests/SimRfqs001/install-demo.py

Category D: all output/ and tmp/ generated reports, PDFs, logs, builds, test copies and verification artifacts stay local and untracked. The complete pre-stage per-file inventory is retained locally in tmp/production-checkpoint/audit-before.json. Category E: ignored .sim-state/ live database, business documents and runtime metadata are never staged. No cleanup or reset is part of checkpointing.

This is a scoped source checkpoint, not a claim that the separately excluded Materials/re-kit milestones are committed. The live verified package and those working-tree changes must both be preserved for the next task.

## Exact commit manifest

- DOCS/workflow-notes/E2E-SIM-001-production-traveler-checkpoint.md
- SRC/workspaces/production/production-workspace.css
- SRC/workspaces/production/production-workspace.html
- SRC/workspaces/production/production-workspace.js
- Tests/ProductionWorkspace001/run-tests.mjs
- Tests/SimProduction001/Program.cs
- Tests/SimProduction001/SimProduction001.csproj
- Tests/SimProduction001/run-projection-ui-tests.mjs
- Tests/SimProduction001/run-ui-tests.mjs
- Tests/SimProductionPrint001/test_pdf.py
- Tests/SimProductionPrint001/verify_projection_pdfs.py
- Tools/SimRuntime/DleOs.SimHost/DleOs.SimHost.csproj
- Tools/SimRuntime/DleOs.SimHost/Program.cs
- Tools/SimRuntime/DleOs.SimHost/SimPersonaCatalog.cs
- Tools/SimRuntime/DleOs.SimHost/SimProduction.cs
- Tools/SimRuntime/DleOs.SimHost/SimProductionEndpoints.cs
- Tools/SimRuntime/DleOs.SimHost/SimProductionModels.cs
- Tools/SimRuntime/DleOs.SimHost/SimProductionPrint.cs
- Tools/SimRuntime/DleOs.SimHost/SimProductionStore.cs
- Tools/SimRuntime/DleOs.SimHost/sim_production_pdf.py

## Preservation and resume point

Checkpointing is source-only. Preserve all 34 current business tables, including the four Traveler governance tables, all existing state files and stored binaries. Kitting case 38c8a2f2-06c4-4645-b3db-d0e124a46074 remains v61, KIT_COMPLETE, with final submission and original shortage history unchanged. Purchasing, Receiving, accepted-material application and frozen Labor/order records remain unchanged.

Resume: Production -> WO 0999999 -> Traveler. Approved/Frozen v1; first operation 20 PCB Preparation Ready / Not Started; Start visible and disabled. Do not enable Start or execute Production while checkpointing. No push.

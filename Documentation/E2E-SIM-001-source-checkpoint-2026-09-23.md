# E2E-SIM-001 source checkpoint - 2026-09-23

This checkpoint preserves the intentional quote-to-Kitting source, tests and documentation. It does not contain the live SIM database, uploaded documents, local profiles or generated evidence. Historical documents describe their observed checkpoints; the resume state below supersedes their earlier pending states.

## Git boundary

- Branch: `feature/miguel-new-order-intake`.
- Parent: `6b54b24cb8cf1fb053dc2979519c5b334aebb101`.
- Upstream: `origin/feature/miguel-new-order-intake`; local tracking comparison before checkpoint: ahead 0 / behind 0. No fetch, push, branch change, merge or reset.
- Initial audit: 70 tracked modified files, 5,466 untracked files, nothing staged. Of these, 155 files were intentional source/test/docs, 5,380 were generated/temp evidence, and one was unrelated. Test execution subsequently added excluded disposable artifacts.
- Exact checkpoint allowlist: 156 files (the original 155 plus this report). Every other path is excluded.
- The test correction made while preparing this checkpoint was to `Tests/SimNewOrder001/test_po_parser.py`: remove its obsolete expectation of automatic PO Date extraction and assert that explicit PO/Due dates remain manual. The initial run was 4 passes / 1 error; the corrected suite passes all 6 tests. Staged diff checking also found and removed surplus blank lines at EOF in `Tests/SimRfqCommercial001/Program.cs`, `Tests/SimRfqCommercial001/README.md`, and `Tools/SimRuntime/DleOs.SimHost/SimPoParser.cs`. No product logic changed during checkpoint preparation.

## Current live resume state, inspected without workflow commands

- RFQI-SIM-0042 -> SIM-Q-0042-R01 -> SIM-E2E-001-PO -> RFQI-SIM-0043, accepted revision 7.
- Customer DLE-SIM-CUSTOMER; SIM-ASSY-001 / A; quantity 10; unit price $70.64; total $706.40.
- PO Date 09/22/2026, verified. Reviewed Customer Due Date 10/14/2026, accepted. Original relative PO delivery wording is retained; the fixed due date is a reviewed order fact, not claimed as original printed PO text.
- Accepted package ID `04c9d3d4-0262-43fe-aa92-e1c880696d02`; bridge `2cdeb739-29a3-48be-bd6f-35476bf8d5f2` remains recognized through the canonical SIM import.
- SIM-VPRO5 SO 0099999 / line 010 / WO 0999999; EXACT_LINE_UNIQUE; open quantity 10, shipped 0.
- Kitting case `38c8a2f2-06c4-4645-b3db-d0e124a46074`: KITTING_IN_PROGRESS, working version 17, 12 requirements, 0/12 dispositions, no entries/allocations, no shortages or submissions.
- Version 17 was already present at the first capture: an empty-draft AUTOSAVED event at 2026-09-23T22:04:52.8260333Z. The handoff allowed verification of actual version instead of assuming 16. No event was added or undone for this checkpoint.
- Effective PO traceability: Not Required / Amended; original frozen policy: Required. Amendment `33f997f6-729f-4d8b-8e29-a8f1570af5d1` and original release `SIM-KITTING-V1:70C5C2F4477060EE2E4C7245C0381AD4BF0DE16D1CAB47451F6E068282B1477F` remain intact.
- SHA-256 comparison: all 119 captured business/document files unchanged; row-count/content digests of all 15 SIM database tables unchanged; tracked H24589/WO 0115621 reference unchanged. Source RFQ, quote lane, accepted package, canonical WO and full Kitting payload hashes also unchanged.
- No live Purchasing, Receiving, production, shipment, Kitting execution or Operations-sync commands were issued. All simulated execution in tests occurred in disposable copies; no production/DEV database was opened.

## Scope classification and exclusions

- A: product UI/server, test sources, scenario tooling, documentation, shared Kitting validator/PDF precision, and SIM desktop-launcher fixes from this E2E work. The exact allowlist is below.
- B: every `tmp/` and `output/` file, including generated PDFs/screenshots, saved API fixtures, copied state, binaries and test logs. Preserve locally; do not stage. Ignored bin/obj and Python cache outputs are also excluded.
- C: all `.sim-state/` runtime/business files and external local SIM profiles/controls/desktop shortcuts. No runtime files, database, uploaded PDF or machine configuration is in the allowlist.
- D: `Tests/SimRfqs001/install-demo.py` predates the mission (recorded at CP-001). Preserve unchanged and uncommitted.
- Machine-local exhaustive evidence: `tmp/e2e-checkpoint/git-baseline.json`, `classification-before-stage.csv`, `classification-final.csv`, `runtime-exclusions.csv`, `business-before.json`, `business-preservation.json`, and test logs. These are intentionally excluded, not portable repository fixtures.

## Verification and limits

All final executed checks passed. 36 focused Node suites; 18 JavaScript, 9 Python and 9 PowerShell syntax checks; 10 affected project builds; backend/PDF checks below; shared PO traceability validator (12 checks); PO parser (6 tests); `git diff --check`.
The build command for each project was `dotnet build <project> -p:NuGetAudit=false -p:UseAppHost=false -o tmp/e2e-checkpoint/build-<project-name> --nologo -v:q`. This is compilation validation, not a NuGet vulnerability audit.
Backend invocations use `DLE_OS_SIM_BOM_PYTHON` set to the installed Python runtime. No test used the real analysis provider or wrote the live SIM state.

| Backend suite | Final result |
|---|---|
| SimAnalysis001 | 1,221 PASS lines, including standalone BOM, source P/N review and customer request documents |
| SimNewOrder001 | 74 checks |
| SimRfqCommercial001 | 34 checks |
| SimContractReviewPreview001 | 14 checks |
| SimOrderEntry001 | 40 checks |
| SimOperationsPacket001 | 63 checks |
| Operations commercial context | 16 checks |
| SimKitting001 | 114 checks, including traceability amendment and persistence/lease/concurrency |
| SimQuotationPreview001 / verify-pdfs.py | Preview/final parity, immutable approved output, page-image parity and seven-page watermark/pagination checks |
| Contract Review PDF assertions | One-page draft fields and lossless overflow |

Test-fixture qualifications: several E2E backend/UI and PDF checks consume historical local snapshots or the generated synthetic PO under `tmp/` / `output/`. Those inputs are deliberately excluded from Git; a clean checkout needs equivalent caller-supplied fixtures. `source-pn-visual-preview.mjs` remains an optional historical visual helper requiring excluded captures and was not executed. Legacy suites requiring the absent retired `Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/work-order-0115621.json` were not run or claimed; current generic Kitting and shared-validator coverage passed.

### Built projects

- `Tools/SimRuntime/DleOs.SimHost/DleOs.SimHost.csproj`
- `Tools/LiveSnapshotRefresh/ControlHost/DleOs.LiveSnapshotRefresh.ControlHost.csproj`
- `Tests/SimAnalysis001/SimAnalysis001.csproj`
- `Tests/SimNewOrder001/SimNewOrder001.csproj`
- `Tests/SimRfqCommercial001/SimRfqCommercial001.csproj`
- `Tests/SimQuotationPreview001/SimQuotationPreview001.csproj`
- `Tests/SimContractReviewPreview001/SimContractReviewPreview001.csproj`
- `Tests/SimOrderEntry001/SimOrderEntry001.csproj`
- `Tests/SimOperationsPacket001/SimOperationsPacket001.csproj`
- `Tests/SimKitting001/SimKitting001.csproj`

### Exact focused frontend commands

- `node Tests/SimRfqIntakeWizard001/run-ui-contract-tests.mjs` - exit 0.
- `node Tests/SimRfqIntakeWizard001/run-back-navigation-tests.mjs` - exit 0.
- `node Tests/SimRfqIntakeWizard001/run-new-order-navigation-tests.mjs` - exit 0.
- `node Tests/SimRfqIntakeWizard001/run-new-order-ui-contract-tests.mjs` - exit 0.
- `node Tests/SimRfqIntakeWizard001/run-customer-request-tests.mjs` - exit 0.
- `node Tests/SimRfqIntakeWizard001/run-readability-tests.mjs` - exit 0.
- `node Tests/SimRfqIntakeWizard001/run-assembly-identification-tests.mjs` - exit 0.
- `node Tests/SimRfqIntakeWizard001/run-document-identification-tests.mjs` - exit 0.
- `node Tests/SimRfqCommercial001/ui-tests.mjs` - exit 0.
- `node Tests/SimRfqs001/run-ui-tests.mjs` - exit 0.
- `node Tests/SimRfqs001/run-final-review-ui-tests.mjs` - exit 0.
- `node Tests/SimRfqs001/run-materials-ui-tests.mjs` - exit 0.
- `node Tests/SimRfqs001/run-labor-ui-tests.mjs` - exit 0.
- `node Tests/SimRfqs001/run-bom-reference-tests.mjs` - exit 0.
- `node Tests/SimRfqs001/run-material-selection-tests.mjs` - exit 0.
- `node Tests/SimRfqs001/run-fee-disclosure-tests.mjs` - exit 0.
- `node Tests/SimRfqs001/run-material-width-tests.mjs` - exit 0.
- `node Tests/SimTechnicalReview001/run-unified-package-tests.mjs` - exit 0.
- `node Tests/SimTechnicalReview001/run-source-pn-tests.mjs` - exit 0.
- `node Tests/SimTechnicalReview001/run-source-pn-compact-tests.mjs` - exit 0.
- `node Tests/SimOrderEntry001/run-ui-tests.mjs tmp/order-entry/queue-detail-live.json` - exit 0.
- `node Tests/SimOrderEntry001/run-shell-queue-tests.mjs tmp/order-entry/queue-detail-live.json tmp/order-entry/queue-live.json` - exit 0.
- `node Tests/SimOrderEntry001/run-operations-handoff-ui-tests.mjs tmp/order-entry/queue-detail-live.json` - exit 0.
- `node Tests/SimOrderEntry001/run-operations-material-mapping-tests.mjs` - exit 0.
- `node Tests/SimOperationsPacket001/run-date-display-tests.mjs` - exit 0.
- `node Tests/OperationsCenterManagerTable001/run-tests.mjs` - exit 0.
- `node Tests/OperationsCenterDegradedRead001/run-tests.mjs` - exit 0.
- `node Tests/OperationsCenterSyncReload001/run-tests.mjs` - exit 0.
- `node Tests/OperationsCenterWorkOrderStatus001/run-tests.mjs` - exit 0.
- `node Tests/SimKitting001/run-ui-tests.mjs` - exit 0.
- `node Tests/SimKitting001/run-amendment-ui-tests.mjs` - exit 0.
- `node Tests/KittingHomeOperatorQueue001/run-tests.mjs` - exit 0.
- `node Tests/KittingJobWorkspace001/run-tests.mjs` - exit 0.
- `node Tests/KittingLeaseRecovery001/run-tests.mjs` - exit 0.
- `node Tests/KittingNavigationGuard001/run-tests.mjs` - exit 0.
- `node Tests/SimOrderEntry001/run-operations-readback.mjs tmp/order-entry/field-mapping-live-readback.json` - exit 0.

### Exact backend and PDF commands

- `python Tests/SimAnalysis001/fixture.py tmp/e2e-checkpoint/analysis-fixtures` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimAnalysis001/SimAnalysis001.dll tmp/e2e-checkpoint/analysis-fixtures` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimNewOrder001/SimAnalysis001.dll tmp/order-entry/id-reg-source tmp/e2e-checkpoint/new-order-state` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimContractReviewPreview001/SimAnalysis001.dll tmp/order-entry/id-reg-source tmp/e2e-checkpoint/contract-state tmp/e2e-checkpoint/contract-pdf` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimOrderEntry001/SimAnalysis001.dll tmp/order-entry/id-reg-source tmp/e2e-checkpoint/order-entry-state` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimRfqCommercial001/SimAnalysis001.dll output/E2E-SIM-001-three-views/fixture tmp/e2e-checkpoint/commercial-state` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimQuotationPreview001/SimAnalysis001.dll output/E2E-SIM-001-preview/verification/isolated-ab3be2ccd22c46a4bbebf76d7c547f54 tmp/e2e-checkpoint/quote-pdf` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimOperationsPacket001/SimAnalysis001.dll .` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimOperationsPacket001/SimAnalysis001.dll . commercial-context .sim-state` - exit 0.
- `dotnet tmp/e2e-checkpoint/build-SimKitting001/SimAnalysis001.dll . .sim-state` - exit 0.
- `python Tests/SimQuotationPreview001/verify-pdfs.py tmp/e2e-checkpoint/quote-pdf` - exit 0.
- `python Tests/SimNewOrder001/test_po_parser.py` - 6 tests, OK.
- `dotnet run --project Tests/KittingPoTraceability001/KittingPoTraceability001.csproj --no-restore -p:NuGetAudit=false -p:OutputPath=C:/DLE-OS/Repositories/DLE-OS/tmp/e2e-checkpoint/traceability-bin/` - 12 checks, PASS.
- `python tmp/e2e-checkpoint/finish-checks.py` - executes existing `Tests/SimContractReviewPreview001/test_pdf.py` assertions with only its three output-path literals redirected to this checkpoint's disposable renders; 2 PDF checks and 9 Python syntax checks passed. Its historical generated files were not overwritten.
- `git diff --check` - exit 0. Git reports configured LF-to-CRLF normalization warnings separately.

## Exact source/test/documentation allowlist

This list includes this report. The resulting Git commit tree is the authoritative record of the staged set.

- `DLE_Work_Center_v4.0.0.html`
- `Documentation/E2E-SIM-001-EOD-2026-09-21.md`
- `Documentation/E2E-SIM-001-checkpoints.md`
- `Documentation/E2E-SIM-001-consolidated-requirements.md`
- `Documentation/E2E-SIM-001-customer-prerequisite.md`
- `Documentation/E2E-SIM-001-generic-kitting.md`
- `Documentation/E2E-SIM-001-new-order-acceptance.md`
- `Documentation/E2E-SIM-001-new-order-replay-plan.md`
- `Documentation/E2E-SIM-001-operations-field-mapping.md`
- `Documentation/E2E-SIM-001-operations-import.md`
- `Documentation/E2E-SIM-001-order-entry-queue.md`
- `Documentation/E2E-SIM-001-quoted-new-order-foundation.md`
- `Documentation/E2E-SIM-001-source-checkpoint-2026-09-23.md`
- `Documentation/E2E-SIM-001-source-pn-review.md`
- `SRC/api/dle-api-client.js`
- `SRC/modules/operations-center/operations-center-data-service.js`
- `SRC/modules/operations-center/operations-center-fields.js`
- `SRC/modules/operations-center/operations-center-view-model.js`
- `SRC/modules/operations-center/operations-center.js`
- `SRC/modules/rfq-workspace/customer-request-documents.js`
- `SRC/modules/rfq-workspace/intake-wizard.js`
- `SRC/modules/rfq-workspace/rfq-workspace.css`
- `SRC/modules/work-order-dashboard/active-kitting-trial.js`
- `SRC/modules/work-order-dashboard/kitting-bag-label.js`
- `SRC/modules/work-order-dashboard/work-order-dashboard.css`
- `SRC/modules/work-order-dashboard/work-order-dashboard.html`
- `SRC/modules/work-order-dashboard/work-order-dashboard.js`
- `SRC/shared/kitting-quantity.js`
- `SRC/shell/workspace-registry.js`
- `SRC/shell/workspace-shell.js`
- `SRC/workspaces/kitting/kitting-job-workspace.css`
- `SRC/workspaces/kitting/kitting-job-workspace.html`
- `SRC/workspaces/kitting/kitting-workspace.js`
- `SRC/workspaces/order-entry/order-entry-workspace.css`
- `SRC/workspaces/order-entry/order-entry-workspace.js`
- `SRC/workspaces/rfqs/quotation-final-review.css`
- `SRC/workspaces/rfqs/quotation-final-review.js`
- `SRC/workspaces/rfqs/rfqs-workspace.css`
- `SRC/workspaces/rfqs/rfqs-workspace.js`
- `SRC/workspaces/technical-review/technical-review-workspace.css`
- `SRC/workspaces/technical-review/technical-review-workspace.js`
- `Tests/Kitting001C1/run-kitting001c1-tests.mjs`
- `Tests/KittingAcceptedMaterialLabel001/run-tests.mjs`
- `Tests/KittingHomeOperatorQueue001/run-tests.mjs`
- `Tests/KittingJobWorkspace001/run-tests.mjs`
- `Tests/KittingLeaseRecovery001/run-tests.mjs`
- `Tests/KittingReleasedBomReport001/run-tests.mjs`
- `Tests/OperationsCenterManagerTable001/run-tests.mjs`
- `Tests/SimAnalysis001/CustomerRequestDocumentChecks.cs`
- `Tests/SimAnalysis001/Program.cs`
- `Tests/SimAnalysis001/SourcePartNumberChecks.cs`
- `Tests/SimAnalysis001/StandaloneBomChecks.cs`
- `Tests/SimAnalysis001/UnifiedPackageChecks.cs`
- `Tests/SimAnalysis001/fixture.py`
- `Tests/SimBroaderReadOnly001/run-tests.ps1`
- `Tests/SimContractReviewPreview001/Program.cs`
- `Tests/SimContractReviewPreview001/SimContractReviewPreview001.csproj`
- `Tests/SimContractReviewPreview001/test_pdf.py`
- `Tests/SimKitting001/ConcurrencyChecks.cs`
- `Tests/SimKitting001/PdfQuantityChecks.cs`
- `Tests/SimKitting001/Program.cs`
- `Tests/SimKitting001/README.md`
- `Tests/SimKitting001/RequirementsChecks.cs`
- `Tests/SimKitting001/SimKitting001.csproj`
- `Tests/SimKitting001/TraceabilityAmendmentChecks.cs`
- `Tests/SimKitting001/run-amendment-ui-tests.mjs`
- `Tests/SimKitting001/run-ui-tests.mjs`
- `Tests/SimKitting001/ui-test-harness.mjs`
- `Tests/SimNewOrder001/Program.cs`
- `Tests/SimNewOrder001/SimNewOrder001.csproj`
- `Tests/SimNewOrder001/test_po_parser.py`
- `Tests/SimOperationsPacket001/CommercialContextChecks.cs`
- `Tests/SimOperationsPacket001/Program.cs`
- `Tests/SimOperationsPacket001/SimOperationsPacket001.csproj`
- `Tests/SimOperationsPacket001/run-date-display-tests.mjs`
- `Tests/SimOrderEntry001/HandoffChecks.cs`
- `Tests/SimOrderEntry001/IdentifierChecks.cs`
- `Tests/SimOrderEntry001/Program.cs`
- `Tests/SimOrderEntry001/SimOrderEntry001.csproj`
- `Tests/SimOrderEntry001/run-operations-handoff-ui-tests.mjs`
- `Tests/SimOrderEntry001/run-operations-material-mapping-tests.mjs`
- `Tests/SimOrderEntry001/run-operations-readback.mjs`
- `Tests/SimOrderEntry001/run-shell-queue-tests.mjs`
- `Tests/SimOrderEntry001/run-ui-tests.mjs`
- `Tests/SimQuotationPreview001/Program.cs`
- `Tests/SimQuotationPreview001/README.md`
- `Tests/SimQuotationPreview001/SimQuotationPreview001.csproj`
- `Tests/SimQuotationPreview001/verify-pdfs.py`
- `Tests/SimRfqCommercial001/Program.cs`
- `Tests/SimRfqCommercial001/README.md`
- `Tests/SimRfqCommercial001/SimRfqCommercial001.csproj`
- `Tests/SimRfqCommercial001/ui-tests.mjs`
- `Tests/SimRfqIntakeWizard001/run-back-navigation-tests.mjs`
- `Tests/SimRfqIntakeWizard001/run-customer-request-tests.mjs`
- `Tests/SimRfqIntakeWizard001/run-new-order-navigation-tests.mjs`
- `Tests/SimRfqIntakeWizard001/run-new-order-tests.ps1`
- `Tests/SimRfqIntakeWizard001/run-new-order-ui-contract-tests.mjs`
- `Tests/SimRfqs001/run-final-review-ui-tests.mjs`
- `Tests/SimRfqs001/run-ui-tests.mjs`
- `Tests/SimTechnicalReview001/run-source-pn-compact-tests.mjs`
- `Tests/SimTechnicalReview001/run-source-pn-tests.mjs`
- `Tests/SimTechnicalReview001/run-unified-package-tests.mjs`
- `Tests/SimTechnicalReview001/source-pn-visual-preview.mjs`
- `Tools/E2ESim001/activate_customer.ps1`
- `Tools/E2ESim001/build_package.py`
- `Tools/E2ESim001/resolve_blocker002.ps1`
- `Tools/E2ESim001/resume_blocker001.ps1`
- `Tools/E2ESim001/verify_blocker001_ui.mjs`
- `Tools/E2ESim001/verify_extraction.py`
- `Tools/E2ESim001/verify_source_pn.ps1`
- `Tools/KittingCase/Database/001_AddKittingCase.sql`
- `Tools/KittingCase/Database/002_AddKittingCaseRuns.sql`
- `Tools/KittingCase/Shared/KittingDraftValidator.cs`
- `Tools/LiveSnapshotRefresh/ControlHost/DleOs.LiveSnapshotRefresh.ControlHost.csproj`
- `Tools/LiveSnapshotRefresh/ControlHost/KittingCaseCenter.cs`
- `Tools/LiveSnapshotRefresh/ControlHost/KittingCasePdfWriter.cs`
- `Tools/SimRuntime/DesktopControls/Open-DleOsSimServer.ps1`
- `Tools/SimRuntime/DesktopControls/README.md`
- `Tools/SimRuntime/DleOs.SimHost/DleOs.SimHost.csproj`
- `Tools/SimRuntime/DleOs.SimHost/Program.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateApprovedParts.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateBom.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateIdentityBasis.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidatePrimary.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateProgress.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateRowReview.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimContractReviewPreview.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCustomerRequestDocuments.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimKittingCases.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimKittingEndpoints.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimKittingRequirements.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimNewOrderIntake.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimOperationsDataStore.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimOperationsEndpoints.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimOperationsHandoff.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimOperationsPacketStore.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimOrderContractDates.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimOrderEntry.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimOrderPoExtraction.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimPersonaCatalog.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimPoParser.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimQuotationPdf.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimRfqCommercial.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeAnalysis.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeEndpoints.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeStore.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimRfqs.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimShellRenderer.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimSourcePartNumberReview.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimStateStore.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimTechnicalPackageProvider.cs`
- `Tools/SimRuntime/DleOs.SimHost/sim_contract_review_pdf.py`
- `Tools/SimRuntime/DleOs.SimHost/sim_order_po.py`
- `Tools/SimRuntime/DleOs.SimHost/sim_quotation_pdf.py`
- `Tools/SimRuntime/Install-DleOsSimDesktopControls.ps1`
- `Tools/SimRuntime/Start-DleOsSimDeveloper.ps1`

## Stop / resume boundary

Resume only when Miguel chooses: WO 0999999 -> Kitting In Progress -> 0/12 dispositions. This checkpoint does not continue Kitting, create a shortage, or push a branch.

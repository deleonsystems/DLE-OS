# Scanned BOM review qualification

Scanned BOM Review preserves a reviewed transcription tied to its original document hash, setup and worksheet version. Candidate builds consume only saved, accepted transcription; no OCR or provider is invoked during a Candidate build. Non-component rows remain evidence. Accepted continuation rows without remaining content are excluded without inferring a merge; populated continuations block the build.

The local extraction layout is qualified only for the hash and geometry in `SRC/workspaces/technical-review/scanned-bom-layout.json`. Other layouts fail closed. Manufacturer identities remain separate proposals. Saving upstream edits archives the current derived Candidate; explicit rebuild creates fresh decisions, and identical retries reuse the current result.

## Checks

- Build `SimScannedBomReview001.csproj` into a temporary output directory. Pass the repository path and `--preserved` for open/save/setup persistence, or `--candidate` for corrected source mapping, provenance, fresh rebuild and idempotency. These modes do not invoke OCR. They copy local RFQI-SIM-0041 and Scenario-1 documents into disposable test storage; the local scenarios must exist. Candidate tests clear only the disposable copy's derived history.
- The default executable mode exercises the existing local OCR qualification. It requires Windows OCR and the original local scenarios.
- `test_structure.py` checks row retention, cell bounds and rejection of ambiguous OCR boxes without running OCR.
- `../SimTechnicalReview001/run-scanned-review-tests.mjs` covers transcription, persistence, source inspection, zoom/pan, navigation, resizing, row acceptance and Candidate handoff states.
- `../SimTechnicalReview001/run-scanned-setup-tests.mjs` covers setup reuse and scanned/text routing.
- The unified-package, Candidate, accepted-BOM and other Technical Review UI suites cover integration and navigation.

All test mutations use disposable storage. Customer source files, OCR output and runtime state are not committed as fixtures. Set `DLE_OS_SIM_BOM_PYTHON` when the installed PDFium runtime differs from the default local runtime.

Inline Description qualification: run `Tests/SimTechnicalReview001/run-candidate-workbench-browser-tests.mjs`
with `NODE_PATH` pointing to a Playwright installation (Edge by default). It uses saved scenarios in an
isolated browser and emits `inline-requests.json` in its reported temporary screenshot directory.
Build this test project with an isolated OutputPath, then run its DLL with
`<repository> --inline-description <inline-requests.json>` to replay the browser's exact acceptance
payloads through the real store. Both scenarios are copied into disposable storage; the completed
readable scenario is reopened only in that copy. Reopening a fresh store verifies descriptions,
current approval metadata, accepted state, other fields/rows, and unchanged normal SIM dataset bytes.
Enter commits a pending cell correction; row Accept performs the existing atomic persistence operation.
The replay also emits `inline-reopened.json`; set `DLE_INLINE_REPLAY_RESULTS` to that path when rerunning the browser test to verify and render the actual persisted result.

Candidate Save Progress: run the same isolated test DLL with `<repository> --progress`.
This qualifies accepted/unresolved rows, saved working values, later Accept, completion gates,
atomic stale-write rejection, manual/Subassembly identity drafts and fresh-store resume for both saved scenarios.
The workbench browser test covers Save Progress, dirty state, failed-save recovery and all three leave choices.

Candidate current-state qualification: run `<repository> --row-current-state` with the isolated test DLL.
It copies C10893-8 and B11283-17 into disposable stores, edits source lines 17/18/19 repeatedly,
checks stable row IDs/counts, legacy reaffirmation-copy consolidation, native multi-MFG and
Subassembly behavior, rejected-choice preservation and bounded current decisions. Ordinary
Description/Ref Des/Qty/line-number edits retain current values without appending correction history;
original extraction remains compatible source context. Saved Accepted BOM snapshots are untouched.

Approved P/N manager qualification: run `<repository> --approved-parts`. Uses isolated copies to
verify C10893-8 line 53 correction, manufacturer retention, multi-identity edits/additions,
Save Progress integration, duplicate/stale rejection, required re-acceptance, unchanged source
transcription and technical alternates, and Subassembly protection. The workbench browser suite
covers the Options → Edit / Add Approved P/Ns interaction and separate advanced alternates.

## Customer P/N identity basis (Pass 2)

Run `SimScannedBomReview001 <repository> --customer-identity` to exercise saved
C10893-8 and B11283-17 copies in temporary storage. The test covers explicit basis
changes, stale/invalid writes, Save Progress, H4-150 acceptance, completion,
Accepted BOM snapshots, manufacturer preservation and the Subassembly boundary.
The normal SIM dataset is never changed.

Optional row `primaryIdentity` stores `basis` (`CUSTOMER_PN` or `MANUFACTURER_PN`),
customer `partNumber`, the `customerBomPartNumber` reviewed, reviewer and timestamp.
Absent data defaults to manufacturer basis; Subassembly keeps its separate path.
Customer P/N never creates a manufacturer proposal or assigns supply responsibility.
Changing the governing row P/N requires reconfirming its customer identity.
Legacy rows require no migration. Older runtimes must not write datasets after
customer identities are introduced: they do not understand the new optional field.

`run-customer-identity-browser.mjs <test DLL> <accepted-fixture.json>` uses a real
store via the test-only `--identity-browser` bridge and temporary copied data.
It verifies the UI exception, Save/Accept/reopen, basis changes, Save Progress,
and an actual backend-produced Accepted BOM snapshot.

## DNP disposition

Run `SimScannedBomReview001 <repository> --dnp`, then
`run-dnp-browser.mjs <test DLL> <DNP_FIXTURE directory>` for backend and browser
qualification using temporary copies. These cover Find 6/Q2 and Find 7/Q3,
Save Progress, explicit Accept, reopen, reverse type changes, source preservation,
Accepted BOM rendering, and manufacturer/customer/Subassembly regressions.

`componentType: "DNP"` is a disposition; computed `identityBasis` is `DNP`.
No additional identity record is created. Entering DNP normalizes the working
description to `DO NOT POPULATE`; source values and existing identities remain.
Blank P/N and blank or nonnegative quantity are valid for DNP. Switching either
direction requires row acceptance again; populated types retain their identity
and positive-quantity requirements. Accepted BOM snapshots retain the DNP row.
Existing records need no migration. Older runtimes do not understand DNP and
must not edit a dataset after DNP dispositions have been saved.

Qualification limitation: the current saved C10893-8 Candidate excludes Finds
6/7, and its scanned worksheet records Q2/Q3 at those positions. The matching
Q2/Q3 examples are explicit test-only rows; these tests do not change normal
SIM data, source interpretation, or Candidate builder inclusion rules.

Files changed for DNP support:
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateBom.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateDnp.cs` (new)
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateRowReview.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidatePrimary.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateProgress.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateIdentityBasis.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateApprovedParts.cs`
- `SRC/workspaces/technical-review/technical-review-workspace.js`
- `Tests/SimScannedBomReview001/DnpTests.cs` (new)
- `Tests/SimScannedBomReview001/Program.cs`
- `Tests/SimScannedBomReview001/README.md`
- `Tests/SimTechnicalReview001/run-dnp-browser.mjs` (new)
- `Tests/SimTechnicalReview001/run-candidate-polish-tests.mjs`


Checkpoint qualification: identity and scanned-build tests establish their legacy,
unresolved, or active-review preconditions only in disposable copies, so completed
local review work does not invalidate the test setup. Failures return a nonzero
exit code without opening an unhandled-exception dialog. See POSITION-COVERAGE.md
for positional build/backend/browser commands. The Subassembly panel is qualified
with `run-subassembly-panel-browser.mjs <test DLL>`.

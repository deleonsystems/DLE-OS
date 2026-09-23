# E2E-SIM-001 — Row source P/N review

Verdict: PASS. Only SIM-R-1K received an identity confirmation. No row was accepted and Materials Quotation was not started.

## Implementation

Candidate rows now optionally carry `SourcePartNumberReview`, with a current decision and append-only history. No migration or render-time business writes are required. The badge beside Customer/BOM P/N exposes MFG, CUSTOMER, ASSEMBLY and UNRESOLVED. Manufacturer/customer document defaults are suggestions; mixed/unknown remains unresolved. Existing approved identities are retained rather than replaced by defaults.

The editor shows the supplied P/N, basis, proposed identity result, and Confirm P/N Identity. UNRESOLVED uses Mark P/N Unresolved. Confirmation uses the existing PUT candidate-bom endpoint with `sourcePartNumberChange: { basis, expectedToken }`. It reuses manufacturer proposals, primary customer identity or assembly identity, preserving document evidence and recording document ID/hash, source snapshot, row reference, default versus override, reviewer, timestamp and resulting identity reference. Manufacturer names are not inferred.

Identity confirmation clears whole-row acceptance and keeps Needs Review. Whole-row Accept is still a separate action. Conflicting/pending manufacturer proposals require explicit individual resolution. Source-number edits invalidate linked approval; explicit manual/approved-identity overrides retain provenance and invalidate the old source link. The decision participates in the row concurrency token. Accepted candidate versions remain read-only. The legacy PCB row has no new metadata or inferred audit history.

Type and source basis remain independent for new decisions, including Subassembly + MFG/CUSTOMER/ASSEMBLY. ASSEMBLY does not assert ownership.

## Exact files changed for this request

Source:

- `SRC/workspaces/technical-review/technical-review-workspace.js`
- `SRC/workspaces/technical-review/technical-review-workspace.css`
- `Tools/SimRuntime/DleOs.SimHost/SimSourcePartNumberReview.cs` (new)
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateBom.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateIdentityBasis.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidatePrimary.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateApprovedParts.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateProgress.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimCandidateRowReview.cs`
- `Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeStore.cs`

Tests:

- `Tests/SimAnalysis001/SourcePartNumberChecks.cs` (new)
- `Tests/SimAnalysis001/Program.cs`
- `Tests/SimTechnicalReview001/run-source-pn-tests.mjs` (new)

Verification/report:

- `Tools/E2ESim001/verify_source_pn.ps1` (new)
- `Documentation/E2E-SIM-001-source-pn-review.md` (this file)
- Evidence under `output/E2E-SIM-001-source-pn/` and `output/source-pn-tests/`.

Other dirty/untracked files predate this request and were preserved.

## SIM-R-1K before and after

| Field | Before | After |
|---|---|---|
| Customer/BOM P/N | SIM-R-1K | SIM-R-1K |
| Source basis | No saved decision; MFG inherited | MFG confirmed |
| Approved P/N | Not resolved; no manufacturer proposals | SIM-R-1K |
| Type | STANDARD_COTS | STANDARD_COTS |
| Row status | Needs Review | Needs Review |
| Confirmed/accepted | false | false |

Normal API confirmation occurred as SIM Administrator at `2026-09-21T20:57:29.4491698-07:00`. Identity reference: `manufacturer:source-7b1b5cc863684f4d9206f057b558f849`.

Source document ID: `5c8db6b9-eb37-499c-a168-b65f292fd6a7`.

Source SHA256: `45855a7832c50d0a032d66280b9805bf18f3d5f4ed43900e44a4dbca1d4b2418`.

The live operation used the normal API, not a direct state-file edit. UI verification ran the actual workspace renderer and confirmation handler in the test harness, including rendering the live API response. No claim of a live browser click is made.

## Preservation evidence

Candidate ID remains `bf7cf8ee-c819-4ced-9e94-8d25dbab8c2f`, with 12 rows and one accepted row (the existing PCB).

Replacing only SIM-R-1K in the after-record with its before snapshot produces the identical original intake record. This proves the other eleven rows, manufacturing snapshot, authority selections, request attachment, prior document IDs/hashes and all other intake/review fields were preserved.

The PCB remains SIM-PCB-001 / SIM-PCB-001 REV A / Subassembly / Accepted. The ten remaining unresolved rows have no source review decisions; each renders MFG inherited and the confirmation editor.

All 11 unrelated intake records, analysis jobs and 102 other business files are unchanged. No new business files were created. Restart also preserved the intake file byte-for-byte.

Evidence: `output/E2E-SIM-001-source-pn/verification.json`, `intakes-before.json`, `hashes-before.json`, `review-before.json`, `confirmation-request.json`, `confirmation-response.json`, `review-after.json`.

## Tests

Build: PASS, zero warnings/errors.

```powershell
dotnet build Tests/SimAnalysis001/SimAnalysis001.csproj -p:UseAppHost=false -p:OutputPath=C:/DLE-OS/Repositories/DLE-OS/output/source-pn-tests/bin/ -p:NuGetAudit=false --nologo
dotnet output/source-pn-tests/bin/SimAnalysis001.dll output/E2E-SIM-001-blocker-001/fixtures
```

The isolated C# suite passed 1,221 checks, including 42 new source-P/N checks. It exercises confirmation versus acceptance, inheritance, overrides, source edits, stale tokens, competing proposals, manual/customer/assembly overrides, type independence, PCB preservation and legacy JSON compatibility. Python environment used the existing bundled Python and site-packages through DLE_OS_SIM_BOM_PYTHON and DLE_OS_SIM_ANALYSIS_PACKAGES.

All these Node suites passed (each invoked with `node Tests/SimTechnicalReview001/<filename>`):

- `run-source-pn-tests.mjs output/E2E-SIM-001-source-pn/review-after.json`
- `run-quick-manufacturer-tests.mjs`
- `run-manufacturer-review-tests.mjs`
- `run-accepted-bom-tests.mjs`
- `run-unified-package-tests.mjs`
- `run-description-provenance-tests.mjs`
- `run-candidate-polish-tests.mjs`
- `run-review-document-tests.mjs`
- `run-ui-contract-tests.mjs`

Live verification: `Tools/E2ESim001/verify_source_pn.ps1 -Stage Prepare`, then `-Stage Confirm`, then `-Stage Verify` after the final restart. PASS. Do not rerun Confirm; it intentionally rejects a changed baseline.

`git diff --check`: PASS. Logs: `output/source-pn-tests/build.log`, `final-regression.log`, `ui-tests.log`.

## Git and resume point

Branch: `feature/miguel-new-order-intake`.

Observed final HEAD: `6b54b24cb8cf1fb053dc2979519c5b334aebb101`.

Working tree contains this implementation plus pre-existing changes; nothing was staged, committed or pushed by this task. Exact status: `output/E2E-SIM-001-source-pn/git-status.txt`.

Refresh RFQI-SIM-0042 and return to Review Candidate BOM. SIM-R-1K is ready for manual whole-row review and Accept; the other unresolved rows are ready for individual identity confirmation. No Technical Review replay is needed. Stop here; Materials Quotation has not begun.

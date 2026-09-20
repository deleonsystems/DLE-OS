# Scanned Candidate position coverage qualification

PASS in disposable storage. Active C10893-8 Candidate was not rebuilt or migrated.

## Audit of saved C10893-8

106 reviewed worksheet positions; 82 current Candidate rows; 24 omitted positions.

| Reviewed source group | Finds | Treatment |
|---|---|---|
| NOT_USED, description NOT USED, no Customer P/N | 6, 7, 11, 15, 23, 33, 48, 51, 55, 76, 77, 82, 96, 97 | 14 new review obligations; hidden with Show DNPs off |
| BLANK, Find number only | 38, 66, 79, 100, 101, 102 | 6 new review obligations; no inferred DNP or acceptance |
| OTHER, NOT TO BE INSTALLED BY VENDOR; C11,12,13 | 26 | Review obligation, hidden initially; reviewer decides disposition |
| OTHER, HUMISEAL / 1B73 manufacturer identity | 85 | Normal visible review obligation; not presumed unused |
| OTHER, manufacturer and P/N are dash placeholders | 99 | Review obligation, hidden initially; no inferred DNP |
| Resolved CONTINUATION, Find number only | 28 | Source-only entry with source-page link and full worksheet snapshot; no fabricated component or DNP obligation |

Find 6 retains Q2; Find 7 retains Q3. Original source values are retained, including
quantity `o` at Find 55 and `-` at Finds 96/97. Existing quantity validation still
requires the reviewer to correct invalid quantities before acceptance.

## Build/model and UI

Generic scanned construction retains COMPONENT rows and numbered non-CONTINUATION
rows. Optional row `sourcePositionKind` records the reviewed source classification;
this is provenance, not an identity or accepted technical disposition. Existing
rows without the property retain their prior behavior. No migration occurs on read
or repeated submission of an unchanged saved Candidate.

The qualified build contains 105 technical review rows plus 1 source-only position.
All new rows start unaccepted. Full source evidence remains in reviewedScanSource.
Resolved continuations stay outside component/acceptance rows; unresolved
continuation content still blocks building.

Show DNPs OFF hides DNP rows and unresolved source NOT_USED/BLANK rows, plus OTHER
rows without a usable Customer or manufacturer P/N. A dash-only manufacturer P/N
is not a usable identity. Accepted populated dispositions are shown normally.
Source-only continuation entries are revealed by the same control. ON restores
entries using worksheet source-position order, preserving Find text including
asterisk annotations. Existing row indices remain tied to the full Candidate model.
The header reports full review-row and source-only counts. The C10893-8 fixture
shows 83 rows normally and 106 positions with the toggle on.

The toggle changes only DOM visibility. Hidden row controls/drafts remain intact;
no API writes or readiness changes occur. Full-model completion checks still
block on unresolved hidden obligations. DNP acceptance uses the existing explicit
Accept path and preserves source, Find, and Ref Des in Accepted BOM.

## Tests

- Scanned Candidate lifecycle: PASS, 105 rows, full source snapshot, duplicate
  submission, stale-source guards, archive/rebuild behavior, unresolved continuation.
- PositionCoverageTests: PASS against the real builder output; Find 6/Q2 and 7/Q3
  Save Progress, Accept, reopen, reverse transition, hidden unresolved completion
  blocker, Accepted BOM, and B11283-17 Subassembly/multiple manufacturer regression.
- run-position-coverage-browser.mjs: PASS, 83/106 visibility, source order, blank
  and NOT USED Needs Review, no toggle writes, unchanged readiness, DNP Accept and
  OFF/ON preservation, Accepted BOM rendering. Normal SIM data byte-for-byte unchanged.
- All 20 Technical Review UI suites: PASS.
- Full offline SimAnalysis001 suite: PASS.

Commands: run the scanned test executable with `<repository> --candidate`; pass
its emitted `data/candidate-envelope.json` to `<repository> --positions <path>`;
then run `run-position-coverage-browser.mjs <test DLL> <DNP_FIXTURE directory>`.
All data-changing qualification uses disposable copies.

## Safe application to the active scenario

Do not use a blind rebuild: fresh construction intentionally does not inherit
technical decisions. Applying this to the current Candidate is a separate,
explicit additive migration:

1. Snapshot the latest dataset, Candidate, worksheet fingerprint and review token.
2. Build in a disposable copy from that exact saved worksheet.
3. Match by stable source row ID, preserve all 82 existing rows and their values,
   identities, decisions, alternates, files and review histories; add only the 23
   missing review obligations. Retain the continuation as source-only evidence.
4. Audit index-dependent references and preserve/remap them; compare every existing
   row and attachment before publishing. Abort on any intervening save/source change.
5. Archive the original Candidate, publish the verified additive result atomically,
   invalidate cached readiness, and verify all prior review work survived.

No active migration was performed. Existing Candidate remains 82 rows. Older
runtimes should not rebuild positional Candidates because their builder omits
these obligations. No DEV/LIVE changes or commit/push.

## Files changed in this task

- Tools/SimRuntime/DleOs.SimHost/SimCandidateBom.cs
- Tools/SimRuntime/DleOs.SimHost/SimScannedCandidate.cs
- SRC/workspaces/technical-review/technical-review-workspace.js
- Tests/SimScannedBomReview001/ScannedCandidateTests.cs
- Tests/SimScannedBomReview001/PositionCoverageTests.cs (new)
- Tests/SimScannedBomReview001/Program.cs
- Tests/SimScannedBomReview001/POSITION-COVERAGE.md (new)
- Tests/SimTechnicalReview001/run-position-coverage-browser.mjs (new)
- Tests/SimTechnicalReview001/run-candidate-polish-tests.mjs

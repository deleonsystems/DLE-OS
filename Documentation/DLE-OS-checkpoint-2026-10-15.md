# Local checkpoint — October 14 evening / October 15, 2026 UTC

Miguel requested a local checkpoint of all intentional progress. Branch: `feature/miguel-new-order-intake`; previous checkpoint: `90acba3`. This note is part of the new local checkpoint commit. No push, publication, service stop/restart, DEV/LIVE/ERP action, or business-state mutation was performed for this checkpoint.

## Starting point tomorrow

SIM is still running, PID 6196, at `https://sim-miguel.dle-os.internal.dlemfg.com:5177`, generation 154. Preserve any unsaved browser work before refreshing. Open Kitting, select **WO0999998**, then **Resume Kitting**. The main action now opens the full Production Slides workspace and restores the last location within that browser session. Print Labels and Reports remain directly on the job landing page. The old inline form and duplicate Slides entry are hidden for supported jobs; legacy jobs without an accepted instruction deck retain their existing fallback.

Do not repeat the original 0036 empty-labor trial reset. Continue from the latest saved data. This checkpoint is a continuation point, not permission for a new Production architecture or remote deployment.

## Progress preserved

- Labor: direct-text operation editing, focused grouped choices, Cleaning/Manual Entry, separate Materials/Kitting, main-section roles, calculations/time basis, notes, native clipboard editing, linear traveler and grouped slideshow authoring.
- Quotation 0036: **SIM-Q-0036-R02**, approval version 2. Saved Labor revision **48**, quantity **25**, **20 operations**, **20 authored slides**, **55 BOM rows**. Commercial lifecycle is **SUBMITTED**; recorded submission is October 14 at 23:11:46 UTC. The commercial expiry currently stored by the app is November 14 at 00:11:46 UTC; this is recorded state, not a new interpretation of policy.
- Abbott intake **RFQI-SIM-0044**: accepted package revision **4**, acceptance `33512ae4-b249-4c2a-9065-4542d7c0efaa`, source Abbott **B11283-17 Rev B**, quantity **25**. Frozen accepted Labor version **5**. Normal SIM handoff/import made **SO0099998 / line010 / WO0999998** available in Operations Center and Kitting. This was explicitly simulated setup, not actual ERP entry or activity by another person.
- Operations/Sales Order: related navigation, Team List, order folder and intake/final-review improvements are included in the source checkpoint.
- Work-order instructions: job-local instruction draft **version 1**, **20 operations / 25 authored slides**, baseline token `FDB854BE0AF3321F44EF29E1EA07B70EE5F0B6AB914654584C55E2E1AC32765E`. Draft edits, exclusions, stages, overlays and referenced assets are retained separately from the accepted source.
- Kitting: current saved case **working version 22**, **KITTING_IN_PROGRESS**. Its stored editing-session record is retained as-is; this checkpoint did not release or acquire a lease. All picks, quantities, PO evidence, notes, production types, FAIR classifications, correction provenance and history remain in the private state backup.
- BOM parity: all 55 internal/source numbers are primary in bold. Find 2 is **A4X117**, with accepted manufacturer identities **EEV-FK1H102M** and **AFK108M50P44T-F** distinct below. Actual saved selection is not rewritten. Find 1 preserves the separate approved pick identity **N4-554 REV -** below **N4-554**.
- Production Slides: full traveler, interactive Kitting BOM and drawings; ordinary BOMs and associated instruction order in other operation groups. Fixed Save & Exit blank shell, frozen drawing source resolution, generated BOM inclusion, and submission/terminal-state lifecycle. The existing Kitting form/controller is moved, not duplicated.

## Private backup and restoration

Backup root:
`C:\Users\migue\Documents\Codex\2026-10-13\task-4\checkpoint-20261015\snapshot-20261015T052811Z`

The `sim-state` child contains **143 files**, including a SQLite online backup with **42 tables** and every file under authoritative `data`, `state`, `documents`, `intake-documents`, and `generated` directories. It covers all saved scenarios, intakes, quote versions, accepted package, Operations/Sales Order relationships, Kitting events/submissions, job draft, notes/overlays and retained document/image bytes. `manifest.json` records byte lengths and SHA256 hashes. `database-tables.json` records logical table counts/hashes. Saved data was unchanged before/after copying. SQLite integrity is `ok`; an isolated restored copy was checked against every file/table. Snapshot also includes exact working-source copies, the excluded local demo helper and EOL-only test file, the Job List Draft workbook, and selected handoff/validation evidence.

`checkpoint-20261015/verify_restore.py` verifies the snapshot and can create a new isolated restore copy, refusing an existing target or the live repository. Verify before recovery. For source recovery prefer a new checkout of this checkpoint commit or its local Git bundle. Copy the backup's complete `sim-state` contents into the new checkout's `.sim-state`; the host derives state from the repository root. Do not launch it on the running instance's port. No duplicate instance was started for this checkpoint.

An actual in-place SIM recovery requires a separate controlled maintenance action: preserve any newer saves and browser drafts; obtain approval to stop SIM; verify the backup; restore the complete coherent state set (not an arbitrary old JSON file over a newer database); validate integrity; then restart through the supported SIM launcher using the existing private configuration. Do not restore captured process IDs, old runtime metadata, logs or credentials. None of those maintenance actions is authorized or performed here.

## Validation and limits

- Checkpoint host build: 0 warnings, 0 errors, isolated output directory; running host unchanged.
- 31 selected JavaScript/module syntax checks passed. No private-key/token patterns found by the scoped source scan. Existing root HTML legacy encoding is preserved byte-for-byte, not silently converted.
- Recent targeted tests: 63 isolated job-instruction backend checks; desktop Edge and tablet WebKit deck/BOM/Save & Exit tests; all-55-row identity/print comparisons; fresh Start/Resume, alternate/required-PO controls, shortage, KIT_SHORT and KIT_COMPLETE, metadata and last-location tests. Kitting navigation/lease/workspace and Labor UI regression suites pass. Twenty isolated accepted-material checks pass.
- The tablet run reports an unrelated background Shipping queue access-control warning; it did not fail Kitting actions. No permission expansion was made.
- Historical ActiveKittingTrial001/ReleasedBOM fixture checks remain unavailable where `Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/work-order-0115621.json` is missing. Other older suites encode superseded UI assumptions; no claim that every historical test passes. Physical tablet hardware and physical printing are not tested.
- Five existing extra-blank-line-at-EOF warnings are preserved; no cosmetic cleanup is mixed into the checkpoint.
- Unsaved browser-only edits, local/session storage (including last slide), credentials, certificates, logs, caches, build products, old backups, generated output/tmp trees are not committed or included as application state. They remain untouched in place. The snapshot protects saved application data, not an unsaved original browser tab.

## Git scope

The explicit allowlist includes intentional source and tests for Labor/quotes, Abbott intake/handoff, Operations/Sales Order, Kitting/BOM, and job-local instructions, plus this note. The old `Tests/SimRfqs001/install-demo.py` helper, EOL-only `Tests/SimProduction001/run-ui-tests.mjs`, `tmp/`, `output/`, private `.sim-state`, credentials and backup trees are not staged. No reset, clean, stash, discard or push was used. Exact post-checkpoint status, commit SHA, source hashes, archive hashes, and verification evidence are in the local `checkpoint-20261015` folder.

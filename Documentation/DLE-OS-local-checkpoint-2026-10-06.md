# Local checkpoint before slideshow work — 2026-10-06

Miguel authorized a local Git checkpoint of the intentional current source, tests, and relevant documentation, plus a private backup of saved SIM authoring/business data. No push, runtime restart, business mutation, or slideshow implementation is part of this checkpoint.

Branch: `feature/miguel-new-order-intake`. Parent: `80ac72a5d72dcbad2ccd6ded234d723d6ad46031`. The commit containing this note is the source checkpoint; use its actual Git object ID for recovery.

## Source scope

The explicit candidate allowlist contains 115 existing changed/new source and test paths, plus this note. Git may omit an existing EOL-only candidate. Scope includes Material/Kitting, Purchasing/Receiving, Shipping handoff/printing, Traveler/Production context, shell/mobile entry, desktop launcher, RFQ/Labor roles, and Drawing Notes authoring, shared layers, page navigation, and rendering. Existing intentional work is preserved together. The commit's file list is the authoritative source manifest.

No source file was changed while preparing this checkpoint; hashes of the 115 candidates matched the initial checkpoint inventory before staging. Tests use disposable fixtures. No live business API writes or service restarts were performed.

## Private saved-data backup

Local path: `.sim-state/checkpoints/liked-state-20261006T042750Z/attempt-1` beneath this repository.

The backup contains 124 files, 33,626,978 bytes including `manifest.json`, covering saved `data`, `state`, `intake-documents`, `documents`, and `generated` content. SQLite was copied with its online backup API from a read-only source connection. Logical database digests before/after capture and in the copy matched; the copy's integrity check returned `ok`. Non-database source/copy hashes and inventory were stable across capture. The manifest records per-file hashes and scope. The backup is private and excluded from Git.

This captures saved authoring and business state, including saved layers, marks, views, roles and source documents. It does not capture unsaved browser drafts, device/browser-local preferences (including iPad layer order/opening preferences), external profiles, credentials/environment values, shortcuts, process metadata, caches or logs. Later user saves are not automatically included in this point-in-time copy.

## Validation

- 58 JavaScript/module syntax checks, one Python AST check and nine PowerShell syntax checks passed.
- SimLaborDrawingNotes001 / SimHost build: zero warnings and errors.
- Backend drawing pages and responsible-role suites passed.
- Desktop launcher isolated entry and readiness suites passed.
- Eight focused Node suites passed: Operator Header, Kitting Material, Purchasing, Receiving, Shipping Handoff, Production Authoring, RFQ Labor, and BOM Reference.
- Five browser suites passed on Edge and WebKit: drawing pages, responsible roles, shape thickness, layer order, and active-layer label.
- Production projection integration check remains failing at `Actual projection renders twelve active route rows` using the existing bound fixture. The identical assertion fails with the parent commit's Production renderer, so this is a reproduced pre-checkpoint test failure, not a newly passing gate. An initial attempt omitted its required fixture argument and was superseded by these comparisons.
- `git diff --cached --check` reports one existing trailing-space line and eight extra blank lines at EOF in the captured files. These cosmetic warnings are preserved to keep the checkpoint exact; they do not affect the passing syntax/build/browser checks.
- This is focused validation, not a claim that every repository suite passes. Several existing test scripts depend on local excluded `tmp` fixtures and are not fully portable from Git alone. Browser automation does not replace physical iPad acceptance.

Detailed local evidence: `.tmp/checkpoint-20261006/` (excluded from Git), including allowlist, source hashes, backup result, syntax results, build/backend/launcher logs, Node/browser results and Production baseline comparison.

## Exclusions preserved

Following the prior E2E checkpoint convention, `Tests/SimRfqs001/install-demo.py` remains uncommitted. Existing `tmp/`, `output/`, ignored `.tmp/`, `.sim-state/`, build/cache files, generated screenshots and fixture evidence remain on disk outside this source commit. No customer documents, business-state payloads or live credentials are added to Git. Isolated launcher test access-code literals are mock test data.

## Recovery guidance — not executed

1. Inspect this commit with `git show --stat <checkpoint-sha>`. Prefer a separate recovery checkout/worktree to inspect or run its source; protect later work first. Do not reset or clean the current workspace to recover it.
2. Saved SIM data is a separate recovery unit from Git. Verify `manifest.json` hashes and SQLite integrity in the backup. First restore into a separate private state directory for inspection, retaining a fresh snapshot of current state.
3. Replacing live state requires a separately approved controlled SIM stop/start and restoration of the coherent backed-up directories/database together. Do not copy an old database over a running SIM, combine arbitrary old/new state files, or overwrite later user saves without review.
4. Unsaved drafts and device-local preferences require separate handling; neither this Git commit nor the saved-data backup restores them.

No recovery, shipped transition, checkpoint push, or slideshow work was performed.

# Full Production proposals (SIM)

Production uses the existing Quality packet editor with Edit, Organize Slides, native drawing/photo/text tools, insert/copy/move/delete, and durable Save Draft. Its full packet is a separate owned proposal stamped Needs Quality Review/Approval. Routing, estimating values and responsible roles remain outside the slide editor exactly as in Quality.

The append-only SimProductionProposal history retains the released baseline and every saved version. Removing a slide affects only a proposal; no released records or assets are deleted. A Production author may edit their own active proposal. Quality/Admin can inspect proposals through More > Production proposals, return them with a note, or accept them into a new QC draft version. Only the existing explicit Quality release publishes content.

Acceptance uses a three-way comparison against the proposal's original released operations. Independent changes to instruction text or slide sets are preserved; competing edits to the same instruction text or complete slide set conflict rather than overwrite Quality's saved work. Expected proposal/draft versions and released-source IDs are checked transactionally. Old addition records/endpoints remain supported. A changed published source locks the retained old proposal for reconciliation; no automatic rebase is performed.

## Run

`dotnet run --project Tests/SimProductionProposals001/SimProductionProposals001.csproj -- <repo> <saved-sim-state> <new-fixture>`

The destination must be new and outside the repository. All state is copied before tests mutate it. No live host is contacted. The harness seeds and edits published fixture slides, then covers ownership, full-save/reopen, removals/history, photo assets, conflicts, Quality return/acceptance, explicit release and unchanged source files.

Set DLE_TEST_REPO to the tested source checkout, DLE_PACKET_FIXTURE_DIR to the completed fixture and DLE_TEST_OUTPUT to an output directory. Run `node Tests/SimProductionProposals001/run-ui-tests.cjs`. Playwright uses NODE_REPL_NODE_MODULE_DIRS and installed Edge. Every request is intercepted under packet.test. Desktop and tablet sizes test actual Edit/Organize controls, existing slide edits/removal, insertion/copy/reorder, image upload, save/reopen, Quality review and no implicit publication.

Run existing SimProductionAdditions001 and SimInstructionPackets001 backend regressions, plus SimQualityInspection001 viewer/workspace and SimInstructionPackets001 UI regressions. Legacy UI fixtures may omit the new capability to test backward behavior.

## Activation

A separately approved SIM backend restart and browser refresh are required. productionProposalsVersion 1 and per-actor productionCanPropose gate the new full editor; the old running backend retains the earlier interface until activation. No Production release permission is granted.

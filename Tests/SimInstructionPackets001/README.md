# SIM instruction packet amendment checks

The tests use a new directory outside the repository. They never publish to the running SIM.

Build `Tests/SimInstructionPackets001/SimInstructionPackets001.csproj` into an isolated output directory, then run its `SimAnalysis001.dll` with three arguments: repository root, a verified snapshot's `sim-state` directory, and a **new** fixture directory. The harness refuses an existing fixture directory or a destination inside the repository.

The backend harness checks durable repeated drafts, release scopes, immutable approval and source evidence, idempotency, stale parents, asset retention, main packet compatibility and pinning, and downstream activity guards. It intentionally removes cloned release/kitting records only inside its disposable fixture to exercise a fresh initial-approval lifecycle.

For UI checks, set `DLE_PACKET_FIXTURE_DIR` to the completed fixture and `DLE_TEST_OUTPUT` to a writable evidence directory, then run `node Tests/SimInstructionPackets001/run-ui-tests.cjs`. Playwright is loaded from `NODE_REPL_NODE_MODULE_DIRS` and uses installed Microsoft Edge. All requests are intercepted under `https://packet.test`; unexpected API routes fail. Tests cover desktop and iPad viewport/touch layouts using real shared editor code and fixture transport. This does not replace physical iPad/Safari qualification or authenticated running-host checks.

## User workflow after approved SIM activation

QC - Inspection > Open job > Organize Slides or Edit. Use Save in the annotation editor to apply the changes and await durable draft persistence. This also applies organizer-local edits before saving. The viewer Save Draft uses the same version-checked write path. Failed or unconfirmed saves retain the editor and draft; resolve the error before retrying, and do not refresh away unsaved work. Repeated saves persist without advancing the released Traveler revision. Release Changes publishes only the saved draft after a scope and reason are supplied. The default is This W/O Only. Main-only and Both are explicit alternatives. View Released Packet opens the current released instructions.

An original Quality release displays Traveler Rev 1. W/O amendments advance Rev 2, 3, etc. Customer assembly revision and draft-save version remain separate. Main packets maintain independent revision numbers and immutable IDs. Both head updates commit in one SQLite transaction.

Main packet storage is SIM-local SQLite only. Reuse requires matching customer/assembly/customer revision and the exact accepted technical baseline, including definition, quantity and source identities. Existing approved jobs stay pinned. There is no network share or production-drive integration.

Concurrency is fail-closed. A changed main parent blocks main/both publication; no automatic rebase or merge is offered. A W/O with reviewed/bound production travelers or execution cannot receive an amendment here. Existing material activity protects Materials content. These conflicts require review, not a forced release.

The running backend must be restarted through the existing supported SIM controls **only after explicit approval**. A browser refresh alone cannot activate the new routes. Old backends keep the existing read-only QC viewer because the new UI is gated on `packetContractVersion: 1`.

## Highlighter opacity regression

The backend harness also validates optional strict numeric marker opacity (0 through 1), missing-field legacy serialization, mixed legacy/new/explicit marks, and durable draft/release round trips. Run `run-opacity-ui-tests.cjs` with the same fixture/output variables for the shared QC UI Save/Save Draft/released-view path. Run `Tests/SimRfqs001/run-highlighter-opacity.cjs` with `DLE_TEST_OUTPUT` for direct-editor, unsupported-backend, clone and Letter/print composition checks.

New markers use saved opacity 0.50 only when the backend advertises `markerOpacitySupported`. Missing opacity always renders at the legacy 0.28. Activation requires a separately approved SIM backend restart and a safe browser refresh; refreshing alone does not activate persistence support.

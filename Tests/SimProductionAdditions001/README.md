# Production pending slides (SIM only)

Production uses the same compact slide editor as Quality: photo upload/camera, text, pen, shapes, transforms, Undo and Save. Add slide opens one blank owned pending card. The stamp reads Needs Quality Review/Approval. Pending cards appear in the existing slide navigation, without being inserted into the released plan. The separate contribution form is removed.

Only the author may edit their PENDING or RETURNED additions; accepted cards are locked to Production. There are no released-slide edit, delete, reorder or organizer controls. Server validation rejects protected slide/stage/photo identities, changes of owner/operation, stale source/version, and unsupported card types. Save is append-only and retry-idempotent. Returned notes remain visible; revision retains history and requires fresh review.

Quality and Administrator may return or accept a pending card into the latest saved QC draft. Acceptance preserves independent draft work and requires expected draft/source versions. Existing explicit Release Changes remains necessary. This W/O Only remains the default; Main/Both, Materials, execution and bound-traveler protections are unchanged. Operations Manager has no Quality authority. No permissions were broadened in this correction.

Legacy addition records and creation endpoint remain compatible. Existing asset storage is reused; no assets or submissions are purged. A pending upload may remain as an unreferenced retained asset if editing is abandoned.

## Tests

Run the .NET 8 project with repository root, read-only snapshot (data/state/intake-documents/documents), and a NEW fixture destination outside the repository:

`dotnet run --project Tests/SimProductionAdditions001/SimProductionAdditions001.csproj -- <repo> <snapshot> <new-fixture>`

The harness refuses an existing fixture, copies saved data, and performs lifecycle checks only in the copy. Covers ownership/permissions, strict payloads, current-source/version guards, same-editor photo/annotation persistence, retries, service reopen, return/revision history, acceptance, immutable publication and release protections.

Set DLE_TEST_REPO, DLE_STAGED_REPO (may equal repo), DLE_PACKET_FIXTURE_DIR to a completed fixture, and DLE_TEST_OUTPUT. Run `node Tests/SimProductionAdditions001/run-ui-tests.cjs`. Playwright is loaded from NODE_REPL_NODE_MODULE_DIRS and runs Edge. Every request is intercepted under addition.test. Tests use actual shared editor controls at 1440x1000, 768x1024, 1024x768: photo/text/pen, save retry, reopen, original-slide protection, return/revise/accept and W/O-only release default without calling release.

Also run SimInstructionPackets001 backend/UI and SimQualityInspection001 viewer/workspace regressions. Browser UI tests of actual services and physical iPad/Safari are separate and require an appropriate authorized session.

## Activation

Requires a separately approved SIM backend build/restart, followed by browser refresh. The new integration requires productionAdditionsVersion 2. A v1 running backend hides the pending controls after loading this source until restarted. Never activate against DEV/LIVE.

# E2E-SIM-001 New Order replay plan

Status: proposed only, 2026-09-22. No reset command has been implemented or executed. Let Miguel finish Test A and explicitly authorize replay before applying any future reset.

## Scope and current persistence

Test A uses customer `SIM-CUSTOMER-E2E-001`, PO `SIM-E2E-001-PO`, source intake `RFQI-SIM-0042`, and quote `SIM-Q-0042-R01`, approval `706605ce-c034-4a8f-ad6c-f2c3a0c98868`, version 1.

Save draft or submit creates/updates a canonical `NEW_ORDER` record in `.sim-state/data/rfq-intakes.json`. Its `OrderIntake` package contains actual PO facts, exact frozen quote linkage/baseline, comparisons, discrepancies, questionnaire, PO evidence, revision, wizard step, and append-only save/submit history. Submission sets `READY_FOR_CONTRACT_REVIEW`; it does not create an SO/WO or award the source quote.

Uploaded evidence is stored through existing verified storage in `.sim-state/intake-documents/<RequestCorrelationId>/<DocumentId>.bin` and `.json` manifests. Staged uploads can exist before a saved order; inventory those separately. Preserve `output/pdf/SIM-E2E-001-PO.pdf` for Test B.

The actual runtime scenario metadata is `baseline`. `E2E-SIM-001` is the mission label, so filtering only by that label is insufficient. The exact Test A New Order intake ID, correlation ID, revision, and evidence IDs must be captured when Test A finishes; do not guess them now.

## Existing mechanisms

The existing SIM reset resets broad state and is unsuitable. Technical Review deletion does not cover this modern New Order package. Staged-document removal rejects evidence associated with a saved intake. Same-customer/same-PO lookup resumes an existing order, including a submitted package; changing its status alone would not enable a fresh test. There is no supported scoped New Order replay command today.

## Recommended implementation for a later authorized task

Implement a SIM-only **archive-and-replay command**, with a read-only dry run followed by explicit apply. Do not hand-edit JSON, roll back the live dataset to an old snapshot, delete audit history, or create another source quote.

1. Require the exact customer/PO/source approval tuple above plus the captured Test A intake ID, correlation ID, expected revision, and a unique replay request ID. Require SIM environment and use the mission label only as audit context. For a partial attempt without quote linkage, require exact intake/correlation ownership and explicitly identify that exception in the dry run.
2. Under the existing intake concurrency gate, produce a dry-run manifest: target record, current state/revision, all owned evidence/manifests/hashes, staged uploads, source quote linkage, and proposed effects. Reject ambiguity, shared evidence/correlation ownership, stale revisions, or any downstream accepted contract/order/SO/WO linkage. Ready for Contract Review is the intended stopping point, not permission to rewind later execution.
3. Capture a recovery snapshot and canonical hashes of all unrelated intake records and every other business file. A snapshot is for failure recovery, not wholesale live replay.
4. Atomically retire Test A from active order discovery and duplicate checks while retaining its full immutable package, history, and verified evidence references in an auditable archive. Use a narrowly scoped archive marker/envelope or equivalent atomic store representation. Add a replay ledger entry recording actor, time, reason, scope, original IDs/revision, and manifest hash. Do not manufacture business lifecycle events. Retain physical verified evidence in existing storage; no parallel binary store or physical deletion is required.
5. Make active queries and duplicate handling explicitly exclude retired attempts. Fence retired intake/correlation IDs against later saves or uploads from stale tabs. Make repeated apply with the same replay request ID idempotent. Never decrement the intake sequence or reuse Test A's identity.
6. Verify source and unrelated records against the manifest. Only Test A's archive membership/replay audit and necessary dataset metadata may differ. `.sim-state/data/rfq-lanes.json` must remain byte-identical; unrelated records within `rfq-intakes.json` must remain structurally identical. Preserve all source documents and hashes.
7. Only after successful verification, Miguel starts a fresh New Order wizard. Test B uses the same real synthetic PO and quote, with a new intake/correlation identity when saved. Preserve a trace from Test A to the replay attempt. No global reset, persona reset, or forced browser refresh.

Archive/query/fencing support is a small additional implementation, not an existing callable API. Final storage representation must be reviewed before implementation. If a partial failure occurs, recover atomically; do not leave evidence orphaned or reactivate an archived attempt accidentally.

## Preservation contract

Retire only the exact Test A New Order attempt from active workflow. Retain its audit/evidence for traceability. Preserve `RFQI-SIM-0042`, `SIM-Q-0042-R01`, approval version 1, SubmittedAt/ExpiresAt, SUBMITTED lifecycle/history, Materials COMPLETE, Labor COMPLETE, technical definition, BOM, labor visuals, original customer RFQ document, all source document IDs/hashes, unrelated intakes, and all unrelated business state. Do not generate SO/WO or award the quote.

Test B is a business-equivalent replay, not an identical-ID replay. Its intake ID, timestamps, correlation ID, and upload IDs may differ legitimately.

## Quote-first prerequisite and tests

Today Browse prior quotes selects a quote in memory and opens comparison, skipping PO authorization/attachment/facts. Text merely typed into the PO-number input is not captured by this shortcut until form submission. Before Test B, a separately reviewed navigation change should retain entered PO input and route the selected quote through missing prerequisites before comparison/questionnaire. Keep quote lookup/selection read-only until an explicit save/submit.

Test the future replay command on isolated fixture state: exact scope; same-PO resume before retirement; stale/repeated requests; downstream rejection; immutable archived history/evidence; rejection of old-tab saves/uploads; same-PO fresh attempt after retirement; unchanged source approval/lifecycle/lanes; unchanged unrelated records; failure recovery. Then verify both UI entry paths produce equivalent comparison/questionnaire/Contract Review packages with the same exact source approval. Do not run reset against live SIM until approved.

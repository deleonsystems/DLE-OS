# WO-specific pre-start Traveler revisions

The original `SimWoTraveler` remains the immutable as-quoted binding. Source
`SimTravelerDefinition` and `SimTravelerApprovedVersion` records are not revised
by this workflow. Read-only views adapt the original binding into revision v1;
opening Production does not migrate, seed, or create revision tables.

## Ownership and persistence

Four additive tables in the existing SIM database own the WO revision lifecycle:

- `SimWoTravelerRevisionHead`: WO/generation, stable Traveler identity, expected
  working version, effective revision identity/version.
- `SimWoTravelerDraft`: one complete pending snapshot per WO/generation; draft
  identity, display version, prior effective revision, reason, editor lease.
- `SimWoTravelerRevision`: immutable approved snapshots. Unique Traveler/version;
  database triggers prohibit update/delete.
- `SimWoTravelerRevisionEvent`: append-only created, lease-acquired, saved, and
  approved/effective events, including actor ID, timestamp, working version,
  reason/diff or content hash. Database triggers prohibit update/delete.

Snapshots retain the original frozen package (quote approval, accepted order,
Labor version, assembly/quantity, BOM/Kitting references), original definition
identity/version, full operation content, immutable source-sequence and parent
maps, change basis, creator/reviewer, approval, warnings and two comparisons.
The effective pointer defines supersession; prior snapshots are not rewritten.

## Commands

Relative to `/api/production/v1/work-orders/{wo}`:

- `POST /wo-traveler/edit`: expected working version + effective revision ID;
  creates/resumes a draft and acquires a 15-minute reviewer lease.
- `PUT /wo-traveler/draft`: expected working version, revision/lease IDs, reason,
  ordered stable operation IDs. Saves only a draft; renews the lease.
- `POST /wo-traveler/approve`: expected working version, revision/lease IDs,
  explicit warning review. Freezes the snapshot, advances the effective pointer,
  retires the draft and appends the approval event in one SQLite transaction.
- `GET /wo-traveler/revisions/{id}`: immutable revision content for this WO only.

Commands reuse `production.manage`; reads reuse `production.view`. Existing
runtime/intake/release locking and Kitting-version checks remain in force. SQLite
write transactions serialize competing service instances. Expected versions
reject stale commands; a lease prevents another reviewer editing until expiry.
Closing the editor retains the saved draft and its lease until expiry. The same
reviewer can explicitly resume/renew; unsaved browser changes require discard
confirmation on navigation. Read-only viewers do not acquire leases.

## Reorder-only boundary

The server accepts IDs, never replacement operation objects. All eligible IDs
must occur exactly once; unknown, duplicate, missing, or prerequisite IDs fail.
Parent operations and their source-linked children move as a contiguous group;
child order is retained. Excluded Materials prerequisites stay unchanged.
Sequence slots are reassigned using server-owned operation snapshots. Validation
compares every non-sequence field, source map and frozen package to v1.

The active route displays WO sequence; details, history and differences expose
source sequence too. Both previous-effective and as-quoted comparisons match by
stable operation ID and include unchanged operations. Text warnings highlight
first-piece holds, inspection/test gates, packaging, before/after requirements,
and numeric operation references. They are review aids, not scheduling or formal
dependency validation. Controlled instructions are never rewritten.

## Pre-start guard / later execution integration

This slice has no Start/Complete endpoint and writes no execution evidence.
Every Traveler write checks persisted execution inside its SQLite transaction.
Any record in WO-keyed Production/Traveler/Operation execution tables blocks
pre-start edits for that WO, including completed or voided evidence. Execution
tables without a recognized `WorkOrderNumber` key fail closed if nonempty. The
guard also checks retained operation execution state for WO revisions.

The future execution writer must persist WO-keyed execution evidence in the same
database before exposing a start, use the same transactional boundary, and bind
execution to the effective revision ID. `SimProductionExecutionRecord` is the
tested integration contract; no such table or records are seeded by this slice.
Any different future execution schema must be explicitly integrated and tested
before enabling Start. Post-start changes must use a separate amendment workflow.

## Projection and print

Only the effective immutable WO revision supplies the active route, first ready
operation and non-controlled Traveler PDF. Drafts do not alter readiness or
prints. BOM, final Kitting evidence, material state and source authorities remain
separate. Every printed page identifies the effective version, approval/change
basis and non-controlled/electronic-record authority. Pending drafts never print
as effective. Print generation is read-only and returns bytes without storing or
replacing business documents.

## Verification / live stop on 09/27/2026

`Tests/SimWoTravelerRevision001` exercises v1 → draft v2 → effective v2 → draft v3
in a disposable copy, including dual diffs, whole-operation preservation, child
groups, permissions, execution guards, lease expiry, stale save/approval,
concurrent writes, immutable history, print versioning and original-table/file
hash preservation. Existing Production foundation and PDF tests also pass.

Live WO 0999999 remains effective v1, As Quoted, no draft, working revision
version 0, zero WO-revision events, KIT_COMPLETE / READY_TO_START_PRODUCTION.
Edit is available to the authorized reviewer; Start remains disabled. No live
route reordering, source definition revision, Labor feedback or execution was
performed. Browser inspection was blocked by browser security policy; live API,
served asset hashes and isolated UI tests were verified instead.
## WO clarification authoring (09/27/2026)

The WO snapshot now has an optional `Clarifications` collection. Older snapshots
remain valid without migration. Operations and their frozen non-sequence fields
remain unchanged; clarification content lives in the separate WO-owned layer.

Draft save accepts optional clarification inputs (stable GUID, operation ID,
text). Omission preserves existing content for older reorder clients. An explicit
list is reconciled against retained content; removed items become tombstones.
IDs cannot be moved between operations or resurrected. The server owns source
operation linkage, reviewer/time, revision linkage and initial revision number.
Only active Production operations are eligible. Text is required, limited to
4,000 characters, and escaped on display. At most 200 retained items are allowed.

Both revision comparisons include typed Added/Changed/Removed clarification
changes, separate from route order. Saves append typed content events and the
existing saved snapshot event. Approval requires technical-consistency review
for retained clarifications or clarification changes, in addition to existing
warning review. This acknowledgment is not automated conflict detection.

The effective projection and Traveler PDF include approved clarification content.
`GET /wo-traveler/draft.pdf` prints the saved pending draft explicitly as
DRAFT / NOT EFFECTIVE and NON-CONTROLLED. It neither saves nor acquires a lease.
The ordinary Traveler PDF continues to print only the effective revision.

The compact worksheet retains grouped drag, keyboard arrows/Home/End and native
row disclosures. Its only plus action adds a Production Clarification locally;
Save Draft persists it. Visuals, source instructions, work center and estimating
basis remain read-only. Sticky actions distinguish draft, unsaved and effective
state. Technical metadata is behind Source Information / Revision details.
No substeps, visual uploads, post-start amendments or Labor feedback are added.

Live verification preserved effective v1 and existing draft v2 with working
version 3. Resume Edit Traveler acquires a lease and increments the working
version, so read-only verification stopped at that button. No clarification,
reorder, approval or execution action was performed in the live package.

# Operations Refresh Contract

Contract version: `operations-refresh-v1`

Status: FROZEN BEFORE IMPLEMENTATION

## Scope

`Operations Refresh` coordinates exactly these independently governed datasets,
in this order:

1. Customer Master — `CompleteMasterRead`
2. Open Sales Orders — `OpenTransactionRefresh`
3. Invoice History — existing `BoundedOverlapUpsert` with a 45-day window

Purchasing datasets and the full Core ERP qualification are out of scope.

## Transaction and dependency boundaries

Each step owns its package, hash, source identity, ImportRunId, SQL transaction,
rollback, evidence, counts, warnings, and duration. There is no combined SQL
transaction. A failed step retains its prior qualified data.

- Customer failure: Sales Orders may continue only when the prior Customer
  Master metadata is available and ready; the dependency warning is retained.
- Sales Order failure: Invoice History continues independently.
- Invoice History failure: completed Customer and Sales Order steps remain
  committed.

## Results

The coordinator returns one of `Completed`, `CompletedWithWarnings`,
`PartialSuccess`, `Failed`, `Blocked`, `NoSourceChanges`, or
`ALREADY_RUNNING`. Dataset steps additionally report `SUCCESS`,
`NO_SOURCE_CHANGES`, `FAILED`, `BLOCKED`, or `ALREADY_RUNNING`.

`NoSourceChanges` means all three steps proved no canonical change.
`PartialSuccess` means at least one step succeeded or proved no change and at
least one step failed or was blocked. `Failed` means no step succeeded.

## Source rules

Every VPro record channel uses `MODE="O_RDONLY"` under the non-elevated
`DLE-OS-HOST\DLE-OS` identity and the existing mapped `X:` drive. No UNC
substitution, remapping, locks, writes, report execution, or broad process
termination is permitted. All output is local.

Customer Master uses two complete reads of the already-qualified fixed source
set because the measured baseline is approximately ten seconds.

Open Sales Orders uses one complete read of the bounded open header/line
sources and exact indexed WOE-03 layout-B seeks for only qualifying lines. The
seek key is `FirmId + "B" + CustomerNumber + SalesOrderNumber + LineNumber`,
as proven by OPR.SB lines 5805–5811. It does not scan all WOE-03 records and
does not invoke the full Core ERP runner. Source identities are captured
before and after the operation. Any mismatch fails closed. Full two-pass
WOE-03 reconciliation remains the separate force-full/core qualification.

Invoice History reuses the existing qualified 45-day routine unchanged.

## Schedule

Automatic execution is Monday through Friday at `02:00`
`America/Los_Angeles`. The allowlisted runner independently enforces a start
window of `00:00` through `04:30` Pacific; a later launch records
`MissedQuietWindow` and performs no source read. Weekend launches are blocked.
An operation started within the allowed start window may complete after
05:59; it must not be terminated mid-transaction.

The Windows task uses `InteractiveToken`, `RunLevel=Limited`, and
`DLE-OS-HOST\DLE-OS`, stores no password, and runs only while that qualified
interactive identity is logged on with its established X: mapping. If the host
is off or the user is logged out, StartWhenAvailable is disabled and the run
is recorded as missed by the next status evaluation; it is not started during
business hours.

One bounded retry may occur only when the first attempt finishes before 03:30
and the retry can start by 04:30. Source or safety failures are not retried
automatically.

## Manual actions

`Refresh Operations`, `Refresh Customers`, `Refresh Open Sales Orders`, and
`Refresh Recent Shipment History` invoke the same routine runners used by the
schedule. Manual Customer and Invoice actions may run outside the quiet
window. Manual Sales Orders outside the window requires explicit
`quietWindowReady` acknowledgement and still fails on identity change.

`Force Full Core ERP Qualification` remains a separate, explicitly confirmed
operator-only action. No routine action accepts source paths, database names,
script paths, command lines, or arbitrary arguments.

## Authentication and CORS

All reads and actions use Windows Integrated Authentication. The exact
operator allowlist is `DLE-OS-HOST\DLE-OS`. Credentialed CORS allows only
`http://dle-os-host:5041`. Anonymous and other identities are denied.

## Concurrency

All live VPro readers share `vpro-live-read`. Duplicate coordinated runs,
manual/scheduled overlap, and overlap with Core ERP refresh return
`ALREADY_RUNNING`. Dataset steps execute serially. Locks are fixed local files;
stale recovery requires proof that the recorded owning process no longer
exists and is never implemented as broad termination.

## Audit and evidence

Every coordinated run records its request/run ID, trigger, identity, quiet
window evaluation, timestamps, current step, per-step before/after metadata,
counts, warnings, result, duration, prior-data-retained state, and bounded
evidence identifiers. Credentials and unrestricted paths are never stored.

Source metadata checks may advance only `SourceCheckedAt`. `SnapshotAsOf`,
ImportRunId, package hash, and `QualificationCompletedAt` advance only after a
genuine validated extraction/import/promotion.

## Deployment and rollback

Deployment is all-or-nothing through the governed publisher. It retains
runtime and task-definition backups, ports 5041–5044, existing identities,
exact CORS, immutable frontend assets, and the no-store shell. Rollback
restores the prior control host/frontend and imports the prior task definition
or removes the newly created task.

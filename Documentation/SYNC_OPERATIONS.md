# Sync Operations (DEV)

`Sync Operations` is the normal operator-facing path for current VPro5 data in
DLE-OS DEV. It is available from Operations Center to users with the
`sync.operations` permission. `SUPER_ADMIN` receives the permission through the
DEV security migration; it can later be granted through the normal role and
permission model.

The authenticated browser posts to the 5051 BFF at `/api/sync/operations`.
5051 forwards the signed user assertion to the isolated 5054 operational host.
5054 records the requesting DLE-OS user, acquires the machine-wide durable
synchronization lease, and starts the worker directly as
`DLE-OS-HOST\DLE-OS`. Closing the browser does not stop the worker.

The v1 operation is intentionally focused:

1. Customer Master
2. WOE-01 Work Orders
3. Open Sales Orders and Work Order relationship evidence
4. one-transaction daily operational SQL promotion
5. DEV canonical API 5052 generation/readiness verification
6. bounded 45-day Invoice History synchronization
7. final 5052 readiness verification

It does not run Full or Force-Full Core Snapshot, BOM, Inventory, or GL.
Legacy refresh controls remain in System Center as administrative recovery
surfaces. The disabled `DLE-OS Operations Refresh` schedule remains disabled.

Routine focused readers use the UNC source root
`\\deleon-server\Add-ON\AON\ADATA` with the integrated `DLE-OS` process token.
No drive mapping or SMB credential is created or stored. Every VPro source is
opened read-only and its before/after identity is checked.

Durable state is under `C:\ProgramData\DLE-OS\SyncOperations`. `lease.json`
contains the run ID, operation, requesting user, worker PID/start time,
heartbeat, step, and status. Per-run state is retained under `Runs`. A live
owner returns `409 ALREADY_RUNNING`; a dead or reboot-lost owner is marked
`ABANDONED_STALE_OWNER` and recovered before a new run is admitted. Focused and
legacy canonical-changing entry points fail closed while another Sync
Operations lease is owned.

A successful daily SQL promotion must become `ReadyFresh` on 5052 with the
same import run ID. A committed generation that is not visible is reported as
`PROMOTED_BUT_NOT_VISIBLE`, not success. Changed Invoice History imports create
a new committed dataset generation and refresh its counts, activation time,
and import identity; a true no-change import retains the current generation.

Semantic endpoints:

- `POST /api/sync/operations`
- `GET /api/sync/operations/current`
- `GET /api/sync/operations/runs/{runId}`
- `GET /api/sync/operations/runs`

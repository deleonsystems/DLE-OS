# Force-Full Extraction Qualification

Status: PASS; QUALIFIED LIVE EXECUTION AND PROMOTION COMPLETE

## Scope

`-ForceFullExtraction` bypasses only the metadata-based
`NO_SOURCE_CHANGES` return. It is an explicit switch and is not used by the
ordinary browser refresh action.

All downstream governed operations remain unchanged:

- four-entity live mirror extraction;
- two complete Sales Order passes, including two complete WOE-03 reads;
- `MODE="O_RDONLY"` source access;
- source identity and pass-consistency validation;
- candidate package validation;
- transactional SQL import and rollback;
- package and qualified-boundary promotion;
- LIVE API restart and readiness verification.

`-ForceFullExtraction` and `-QualificationCurrentFixture` are mutually
exclusive.

## Operator Boundary

The deliberate launcher is:

`Tools\LiveSnapshotRefresh\Start-LiveSnapshotForceFullRefresh.ps1`

It requires the authenticated Windows identity
`DLE-OS-HOST\DLE-OS`. No force-full HTTP route is exposed. The normal viewer
button continues to invoke normal mode.

## Qualification Results

- Decision tests: 6/6 PASS.
- Static safety tests: 15/15 PASS.
- Controlled induced failure: PASS; prior snapshot retained.
- Concurrent invocation: PASS; overlap returned `ALREADY_RUNNING`.
- Fixture separation: PASS; combined force/fixture invocation rejected.
- Anonymous ordinary refresh request: denied.
- Anonymous force-full route: absent.
- VPro record reads during controlled qualification: 0.
- Writes beneath `X:` during controlled qualification: 0.

## Interrupted Live Attempt

Run `LIVEREFRESH-20260729T230947Z-22BFDD66` was stopped immediately when the
operator required a quiet-window confirmation before live source reading.
The exact mission-owned process tree was terminated before the Sales Order
or WOE-03 phase. The runner recorded a fail-closed result and removed its
execution lock.

Retention checks proved:

- active ImportRunId remained
  `e66391d9-7422-4c6f-9992-feed3d401a75`;
- active package hash remained
  `BFEAAAF09C6690120CF85E64BEBECBBADB3C049214CCCF9BB993D19363110E77`;
- qualified-boundary SHA-256 remained
  `785E62ED433E281D9F1F41DBBE02444ED3D6F91C2CE1D4EC6775E83B95FC031B`;
- qualified source-state SHA-256 remained
  `E68DB2E76FCEABA2D9E4050ED9ECBA1CC9D634FC1009FBB916201853425E217E`;
- no package or qualified-boundary promotion occurred;
- ports 5041, 5042, 5043, and 5044 remained listening.

The interrupted run directory and bounded failure package were preserved as
evidence. They must not be presented as a completed ERP synchronization.

## Authorized Quiet-Window Run

The operator subsequently confirmed the Purchase Order quiet window and
authorized one complete force-full run:

`LIVEREFRESH-20260729T232138Z-AF742233`

The run completed the four-entity base extraction and two complete sequential
Sales Order passes. Both WOE-03 passes read 370,689 records with
`MODE="O_RDONLY"`. Source identity, key order, and semantic pass comparison
all returned PASS. No writes or locks occurred beneath `X:`.

The initial promotion failed closed on an importer integration defect:
identical canonical content with a new mirror run ID was handled as the normal
same-snapshot no-op. The prior package and qualified boundary remained active.
The repair added a LIVE-only internal `refresh-import` operation while
preserving normal-mode no-op behavior. Unit, static, concurrency, fixture
separation, and induced transactional rollback tests passed.

Promotion then resumed only from the already qualified local pass outputs; no
additional VPro or `X:` access occurred. Final LIVE readiness is `Ready` and
`Fresh` with ImportRunId
`27f0ed25-adcc-46aa-96f4-f0cc7d6ae8b6`, mirror run ID
`LIVEMIRROR001-20260729T232139Z-7CAB3382`, and snapshot timestamp
`2026-07-30T00:37:50.691511Z`.

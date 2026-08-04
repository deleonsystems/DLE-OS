# VPro Standing Level 2 Access Policy

Effective: 2026-07-27
Authority: explicit operator authorization in `VPRO-LIVE-ACCESS-002`

The authoritative engineering-lab instruction is `C:\Add-On\AGENTS.md`.
This repository copy records the approved operating boundary for audit and
change control.

## Authorized read-only access

X: has standing Level 2 authorization. Codex may use it without a separate
mission-by-mission approval for directory discovery, metadata and identity
inspection, hashing, static program and dictionary analysis, read-only record
decoding, relationship tracing, local evidence copies, comparison with local
snapshots, previously qualified read-only readers, known read-only VPro
execution, and local mirror creation.

Qualified SQL imports and downstream SQL, API, UI, reconciliation, or scheduling
work are permitted only when they are part of the active mission.

Codex must not stop merely because read-only X: access is required.

## Execution boundary

Known VPro programs, reports, SYS.ZA paths, or T8 paths may run only when the
relevant execution chain has been inspected or previously qualified, the active
mission requires it, its live behavior is proven or constrained to read-only,
and every output is redirected to a local approved destination.

Unknown startup chains must be inspected statically rather than executed for
discovery.

## Permanent no-live-write boundary

No standing authorization exists to create, modify, replace, rename, move, or
delete anything on X:. Live records and files must never be written, removed,
locked, initialized, repaired, rebuilt, purged, or converted. Temporary, log,
spool, export, cache, listing, and evidence output must not be written to X:.
Live configuration, dictionaries, and programs remain immutable.

Record access must use `MODE="O_RDONLY"`. Any unknown or uncontrolled write
behavior is a fail-closed condition.

All output belongs in an approved local lab, repository, artifact, mirror, or
SQL destination.

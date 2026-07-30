# Customer Master Routine Refresh Qualification

Status: **IMPLEMENTED; LIVE ACCEPTANCE PENDING DEPLOYMENT**

The routine reuses the qualified eight-source, two-pass Customer Master reader
under non-elevated `DLE-OS-HOST\DLE-OS`. It builds a local candidate, compares
canonical CSV rows by the qualified natural keys, reports inserted, updated,
unchanged, and missing rows, returns `NO_SOURCE_CHANGES` for identical
content, and imports transactionally only when content changed.

Missing master records are removed only from the current canonical master
snapshot; historical transaction datasets are not deleted. No active/inactive
meaning is inferred. Candidate and prior package promotion uses
Current/Previous, and importer failure retains both prior SQL and package
state.

Static, parser, comparison, duplicate-key, no-op, and rollback-path tests pass.
The required live no-op/change/rollback/source-safety tests remain blocked by
the canceled deployment UAC gate.

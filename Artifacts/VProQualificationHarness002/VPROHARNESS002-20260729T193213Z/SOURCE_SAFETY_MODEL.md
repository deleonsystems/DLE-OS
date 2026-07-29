# Source Safety Model

Production qualification runs only as non-elevated
`DLE-OS-HOST\DLE-OS`, using the existing mapped `X:`. The harness does not map,
reconnect, or substitute a drive; use UNC paths, credentials, registry changes,
or an elevated source reader; or invoke production reports.

Configurations contain exact source paths. Before launch, the harness verifies
mapping/source visibility and records length, UTC modification time, and
attributes. After the read it records the same identities and fails on change.
The qualifier must report `O_RDONLY`, zero writes, and zero locks. Missing
safety evidence blocks PASS.

No `WRITE`, `WRITE RECORD`, `EXTRACT`, `REMOVE`, `INITFILE`, `ERASE`, `LOCK`,
repair, or live output is authorized. All compiler/runtime files are local.
The two live acceptance passes and both migrated-qualifier passes reported
stable identities, zero writes, and zero locks.

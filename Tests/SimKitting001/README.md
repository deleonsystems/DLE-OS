# Generic SIM Kitting qualification

The integration harness copies a supplied SIM checkpoint into a unique repository-local temporary directory. It never writes to the supplied checkpoint. SQLite backup provides a consistent database copy. Only in that disposable copy, the three SIM Kitting tables are reset before Start/lease tests; this allows repeatable qualification after the live case has started. All counts, shortage examples, lease changes and submission tests occur only in that disposable copy.

```powershell
dotnet build Tests/SimKitting001/SimKitting001.csproj -o tmp/kitting/tests-bin
dotnet tmp/kitting/tests-bin/SimAnalysis001.dll C:\DLE-OS\Repositories\DLE-OS C:\DLE-OS\Repositories\DLE-OS\.sim-state
```

The live E2E case is separately started through normal commands with empty execution entries. No material counts or final submissions are authorized on that live case during this task.

## Reviewed PO traceability amendments

`TraceabilityAmendmentChecks.cs` runs in a second disposable checkpoint. It verifies reviewer authorization, case/version/lease guards, required reasons, immutable frozen policy and lineage, append-only audit, persistence, and effective-policy enforcement. Its positive counts and completed report are isolated test evidence only.

```powershell
node Tests/SimKitting001/run-ui-tests.mjs
node Tests/SimKitting001/run-amendment-ui-tests.mjs
```

The UI suites share an in-memory server harness. Amendment checks include dirty/pending-save protection and delayed background-read races. `PoTraceabilityRequired=false` means supplier PO evidence is not mandatory; the user-facing label is **Not Required**. The original policy stays in `FrozenDraft` and source lineage. Only the case's effective policy changes through the reviewed amendment command.

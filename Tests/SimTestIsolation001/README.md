# SIM qualification isolation

Run `Tools/SimRuntime/Test-DleOsSim.ps1 -Mode Quick` or `-Mode Full` normally.
The entry point and each SIM PowerShell suite enter
`Invoke-DleOsSimTestIsolation.ps1` before creating files or launching a host.

The runner copies current tracked and nonignored untracked source into a unique
`%TEMP%/DleOsSimTests/<guid>/repo` directory. It excludes `.git`, `.sim-state`
and `.tmp`, initializes Git only in the disposable copy for ignore-contract
checks, and runs the requested suite there. Normal runtime root resolution is
unchanged: its `.sim-state` now belongs to the disposable repository. Builds,
SQLite databases, reset targets, documents and runtime metadata are isolated
together. No developer runtime restart is needed.

A child context must match both its marker and process environment, lie outside
its source repository under the temporary test pool, and contain no ancestor
reparse point. A missing/mismatched context fails before suite execution. Suites
print their state root. Parent execution hashes every active `.sim-state` file
before and after, including on failure, and rejects any change. Test copies are
retained for diagnostics; the runner never recursively removes developer state.

Regression commands:

```powershell
& Tests/SimTestIsolation001/verify.ps1 -Mode Probe
& Tests/SimTestIsolation001/verify.ps1 -Mode Quick
& Tests/SimTestIsolation001/verify.ps1 -Mode Full
```

Probe first proves an active-root override is rejected and a disposable write/
delete cannot reach developer state. Quick/Full additionally require a developer
intake dataset to exist, then compare its complete state tree, uploads, runtime
metadata and generation before/after. They do not create or alter that dataset.

Incident root cause: the old suites changed ports only. `SimRuntimeOptions.Create`
always chose `<current repository>/.sim-state`; `SimStateReset001` used that same
directory and its reset API deleted/recreated data, documents, generated and temp.
An HTTP listener on a different port did not provide storage isolation.

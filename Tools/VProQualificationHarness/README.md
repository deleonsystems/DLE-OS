# VPro Qualification Harness

This runner owns the infrastructure lifecycle around fixed, approved Visual
PRO/5 qualifiers. It does not own dataset mapping.

Run it in the normal, non-elevated `DLE-OS-HOST\DLE-OS` session:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\Tools\VProQualificationHarness\Invoke-VProQualificationHarness.ps1 `
  -ConfigurationPath .\Tools\VProQualificationHarness\Configurations\CustomerMaster.json
```

The configuration is data, not a shell command. Executables, source files,
source paths, artifact root, arguments and timeout policy are fixed. Arguments
may use only the documented attempt tokens. The runner creates a fresh attempt,
preflights identity/elevation/mapped paths/sources/variables, compiles, rejects
compiler failure text and stale output, launches processes directly, validates
JSON Lines events, supervises progress, and cleans up only ledgered exact PIDs.

The repository is the deployment model for this phase. No service, scheduled
task, credential, drive mapping, UNC alternative, or elevated source reader is
created. Rollback is removal/reversion of this bounded tool and its dataset
configuration; existing direct dataset wrappers remain available.

See the mission artifact contract for lifecycle and protocol details.

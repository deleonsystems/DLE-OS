# Source Safety Evidence

| Experiment | Source access | Writes | Locks | Residual owned processes |
|---|---|---:|---:|---:|
| A | Not opened | 0 | 0 | 0 |
| B | `O_RDONLY`, no key/record read | 0 | 0 | 0 |
| C | `O_RDONLY`, one record | 0 | 0 | 0 |
| D | `O_RDONLY`, at most 100 records | 0 | 0 | 0 |
| E | `O_RDONLY`, complete read | 0 | 0 | 0 |
| F | `O_RDONLY`, complete read | 0 | 0 | 0 |
| G | `O_RDONLY`, no record read | 0 | 0 | 0 |

No report was executed. No drive was mapped, unmapped, substituted, or
reconnected. No UNC path was used. No VPro source, program, or configuration
under `X:` was modified.

All generated programs, streams, logs, configurations, and process ledgers are
local. Raw full record streams remain beneath their governed
`C:\Add-On\Lab\VProQualificationHarness\ReceivingHistorySourceIdentity`
attempts and are not stored in Git artifacts.

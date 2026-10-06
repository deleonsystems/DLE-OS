The installed home is USERPROFILE/.dle-os/SIM. Do not install employee launchers under LOCALAPPDATA from packaged Codex: MSIX redirects those writes to its package LocalCache, which Explorer cannot see at the apparent path. Installer migration copies only the nonsecret profile and launcher scripts; credentials remain in User scope and legacy logs/backups remain in place.

# SIM Desktop controls

Run Tools/SimRuntime/Install-DleOsSimDesktopControls.ps1 with PowerShell 7 as the SIM user. It installs the source Start/Open helpers and repairs the known desktop entries. The primary entry is Desktop/DLE-OS SIM/Start and Open SIM; both existing Open aliases use the same helper. Stop uses the same guarded operation with the stable profile path. Optional -OpenShortcutPath accepts additional existing SIM links.

The installer backs up scripts and each shortcut and records original and installed paths in Controls/installation.json. To roll back, restore each backed-up link to originalPath, removing only the renamed installedPath when different, and restore backed-up helpers. Repository source changes must also be reverted selectively; never reset unrelated work.

Open waits for Start to succeed, then explicitly requests a visible new Edge window. Browser-launch-requested records dispatch, not successful rendering. Existing Edge tabs are not closed. The employee chain does not use the old VBScript bootstrap.

Start serializes invocations with an exclusive user-profile file handle; it is released on normal exit or process termination. An existing empty start.lock file is harmless. Waiting is bounded to 150 seconds; readiness to approximately 90 seconds plus an in-flight request. All entry points use the same lock. Development-only manual host commands remain outside it.

Readiness requires the configured metadata, listener PID equal to metadata PID, expected host executable path, process creation no later than runtime metadata, and authenticated HTTPS READY/SIM/PRIVATE_LAN_HTTPS/configured binding. Unknown listeners are never stopped. Missing configuration and TLS errors fail closed. Credentials are freshly read from User scope, passed only in child environment, and redacted from readiness errors.

Each invocation writes Logs/start-<timestamp>-<pid>.json or open-<timestamp>-<pid>.json; latest summaries remain start-status.json/open-status.json. Start records underlying readiness errors, exit code and stderr tail without a second generic trap overwriting them. Failures show a bounded 30-second notification. -NoPopup supports unattended diagnostics without changing startup behavior.

The detached runner records entry/error/exit in a unique lifecycle.jsonl. Missing exit after a process disappears indicates that orderly exit was not captured; it does not identify the killer. No service, task, reboot hook, or automatic restart is installed. dotnet run builds on cold start; an already healthy host is reused and does not automatically load backend source changes.
DNS preflight retries three times and records resolver answers/errors in lifecycle preflight evidence. This tolerates transient resolution errors but does not repair inconsistent upstream DNS, which can independently affect Edge. A pending-runner identity record prevents a timed-out build from causing a second runner on the next click.

## Confirmed Explorer acceptance — 2026-10-01

At 04:06:03 UTC Miguel reported “yes it worked” after retrying the exact Desktop/DLE-OS SIM/Open SIM shortcut (message Sentinel_e44d2a283dcc81918f66513d31aaedd5). This is user-reported visible acceptance following the Explorer-context tests, not independently captured browser imagery.

The proven flash-and-close cause was packaged-AppData virtualization: Codex and its children saw the helpers at the apparent LOCALAPPDATA/DLE-OS/SIM path, backed by OpenAI.Codex's private LocalCache, while ordinary Explorer's PowerShell could not find that path. Earlier Codex-child dispatch tests therefore gave misleading assurance. The installed USERPROFILE/.dle-os/SIM home is the required nonvirtualized path shared with Explorer. Keep Start, Open, Stop, profile and diagnostics on that explicit home; do not regress installation to LOCALAPPDATA from packaged tools. Qualification must include ordinary Explorer context and the employee's real click.

User acceptance does not resolve the separately demonstrated authoritative DNS inconsistency (ns13 serves the SIM A record while ns14 returned authoritative NXDOMAIN from an older zone serial), nor the original server process's unexplained exit. Neither issue was changed during this closeout. No commit or push was made.

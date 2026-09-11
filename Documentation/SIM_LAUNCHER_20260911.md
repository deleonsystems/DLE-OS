# MichaelDesk SIM launcher investigation — 2026-09-11

## Verdict and limits

SIM service restored and launcher hardening installed and tested. The original
failure's exact exception was not captured and could not be reproduced. This is
not proof that its underlying cause has been eliminated.

Miguel clarified that Start briefly opened PowerShell and closed, while Open
successfully opened Edge to an unavailable-site message. Initially no SimHost
process or port 5177 listener existed. Runtime metadata still named PID 27348
(September 10, 22:39 local). The Start status record was stale: September 9,
09:22 local, PID 7248, `already-running`. No server logs existed after September
9 before this investigation. The first execution of the unchanged exact Start
command succeeded. The unchanged Open command also succeeded.

The evidence places the symptom on server startup/availability, not a broken
Edge executable or URL. It does not identify why the reported invocation exited.
No relevant historical exception was recovered from the inspected event logs.

## Recurrence and provenance

The September 9 permanent-code repair was still installed: fresh User-scope
resolution and explicit `Start-Process -Environment` were both present. No
repository/local generator, matching scheduled task, or SIM startup entry was
found recreating these controls. Git branch changes do not themselves rewrite
AppData scripts. There is no evidence that the prior repair was overwritten.

Initial helper evidence:

| Helper | Last write (local) | SHA256 |
|---|---|---|
| Start-DleOsSimServer.ps1 | September 9, 09:18:15 | 7A10020A43C602F43E2D145C0A8EB7895672B331153304CE749C0E351EB5FC9E |
| Stop-DleOsSimServer.ps1 | September 3, 14:05:45 | 644FC34AC2364069026F742479A27CB05AE9EE1A58082AFDD6C90EE9D4DBE444 |

The confirmed diagnostic gap was that profile loading, module import and runtime
inspection could fail before any new status/server log was written, and Desktop
would close the console. Success also checked only process/listener availability.

## Launch chains

- Start: `C:\Users\migue\OneDrive\Desktop\DLE-OS SIM\Start SIM.lnk`
  → `C:\Program Files\PowerShell\7\pwsh.exe`
  → `-NoProfile -ExecutionPolicy Bypass -File "C:\Users\migue\AppData\Local\DLE-OS\SIM\Controls\Start-DleOsSimServer.ps1"`
  → user SIM profile → detached PowerShell → repository
  `Tools\SimRuntime\Start-DleOsSimDeveloper.ps1` → preflight →
  `Start-DleOsSim.ps1` → `dotnet run` → `DleOs.SimHost`.
- Stop: same PowerShell executable/options, local
  `Stop-DleOsSimServer.ps1` → repository `Stop-DleOsSim.ps1` →
  `Stop-DleOsSimSafely`, with SIM identity/process-path validation.
- Open: `Open SIM.lnk` →
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
  with `https://sim-miguel.dle-os.internal.dlemfg.com:5177`.
  There is no Open helper in this Desktop chain. The separate repository
  `Open-DleOsSim.ps1` uses `Start-Process $profile.url` and is not invoked here.

All shortcut targets and working directories existed. Shortcuts were unchanged.

## Changes

Repository additions:

- `Tools/SimRuntime/DesktopControls/Start-DleOsSimServer.ps1`: authoritative Start
  source copied from the repaired local helper, then hardened with early status,
  stage/error/line/log-path diagnostics, visible failure notification, quoted
  child script/profile paths, and a 90-second readiness window. Missing permanent
  configuration fails closed. Started/already-running require authenticated HTTPS
  `READY`, `SIM`, `PRIVATE_LAN_HTTPS`, and the configured binding.
- `Tools/SimRuntime/DesktopControls/Stop-DleOsSimServer.ps1`: unchanged Stop helper
  brought under the same source directory.
- `Tools/SimRuntime/DesktopControls/README.md`: installation and maintenance rules.
- `Tools/SimRuntime/Install-DleOsSimDesktopControls.ps1`: explicit installer with
  timestamped local backups and source/hash manifest. No automatic checkout,
  login, reboot or startup regeneration was added.
- `Tests/SimDesktopLauncher001/run-tests.ps1`: isolated early-failure regression
  tests; substitutes the notification object without touching real configuration.
- This report.

User-local changes under `C:\Users\migue\AppData\Local\DLE-OS\SIM`:

- Installed Start helper hash:
  `A3590560764EC9EA6351C6923419048152B339E57C66CBB906FF26DE75E62680`.
- Stop copied byte-identically; original hash retained.
- Added `Controls/installation.json` and timestamped helper backup directories.
- Updated normal launch status/server logs. Runtime refreshed its PID metadata.
- Preservation hash evidence: repository-local `.tmp/sim-launcher-preservation-before.json`.

## Verification

| Check | Result |
|---|---|
| Current SimHost source build | Passed; zero warnings/errors |
| DNS | Expected hostname resolves to 192.168.0.201 |
| Certificate | LocalMachine/My, SAN matched, private key present; valid through December 1, 2026; normal HTTPS validation passed |
| Firewall | Existing private scoped TCP 5177 rule passed preflight; unchanged |
| Governed stop | Previous host stopped and listener disappeared |
| Exact detached Start, inherited code cleared | Passed before and after hardening |
| Start while already running | Passed; same host PID, authenticated `already-running` |
| Reinstall from source then stop/start | Passed; source/installed hashes match |
| Deliberately stale inherited code | Passed; fresh User value used |
| Permanent-code authentication | Passed over HTTPS; secret unchanged and never passed as an argument |
| New launcher logs | Eight logs scanned with shared read access; none contains the permanent code |
| Final runtime | PID 24556 owns 192.168.0.201:5177; READY / SIM / PRIVATE_LAN_HTTPS |
| Home | Authenticated HTTP 200 |
| Intake Wizard | JavaScript asset HTTP 200; interactive click-through pending |
| Technical Review | Workspace HTML/JS and review queue API HTTP 200; interactive click-through pending |
| Exact Open command | Edge opened; window title confirms SIM LAN access page after final restart |
| Early-failure regression tests | Malformed profile and missing module both record failure and request Desktop notification |
| Logout/reboot/Explorer restart/branch switch | Not performed; avoided interrupting work. Detached fresh-process and explicit regeneration tests passed |

Native Edge UI control is unavailable in this session; only the in-app browser is
exposed. HTTP checks and the real Edge window title are not a substitute for
interactive workspace verification. Final manual action: open Desktop → DLE-OS
SIM → Open SIM, sign in with the existing code, then open Intake Wizard and
Technical Review from Home. SIM is left running for this check.

## Preservation and remaining durability requirement

Branch remains `feature/miguel-new-order-intake`, HEAD
`9984fa7ed38b31ffb835c4d711dfc2c99c5b7513`. Existing tracked drift remains only
`Tools/DevelopmentRuntime/Invoke-DleOsGoDaddyDns01.ps1`; all task additions are
untracked. DNS script SHA256 remained
`432365720BB96E549233466B5A6EEE24FF25D5EDDA6382DA8D56D8C96F5D886E`.

All 37 hashed business files remained byte-identical across durability tests:
database, intake store (including Candidate BOM and Technical Review records),
state metadata, staged documents and intake documents. No state reset, credential
change, certificate/network configuration change, commit, push, DEV or LIVE
action was performed.

Future helper repairs must edit the repository source and use the explicit
installer. The installed snapshot survives branch changes, but these uncommitted
source additions still need normal review/integration later to be available in
other clones/branches. Do not silently replace local helpers from older copies.
If the symptom returns, inspect the newly recorded stage/error and referenced logs
first. Determining the original missing exception, or capturing a recurrence, is
still necessary before claiming the recurring root cause is permanently fixed.

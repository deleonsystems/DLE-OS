# DeLeon-Server Local VPro Timing Pilot Handoff

Status: **PAUSED / TIME-BOX CLOSED**

Recorded: 2026-08-19

Scope: Read-only Open Sales Order full-scan performance experiment

## Decision

Stop the DeLeon-Server local VPro pilot at the child-process launch boundary.
Do not continue troubleshooting, rerun the pilot, or make further server
changes as part of the current effort.

The existing DLE-OS-HOST authoritative extraction remains the accepted
fallback and is not blocked by this experiment.

The performance question remains unanswered: no local ARE-03, ARE-13,
ARM-01, or ARM-10 scan completed.

## Original question and remote baseline

The experiment was intended to determine whether the authoritative Open Sales
Order VPro extraction is materially faster when executed on DeLeon-Server
against local data at:

`C:\Add-ON\AON\ADATA`

rather than from DLE-OS-HOST through:

`\\DELEON-SERVER\Add-ON\AON\ADATA`

Authoritative remote benchmark:

| Phase | Remote duration |
|---|---:|
| Full extraction | approximately 143.7 seconds |
| ARE-03 | approximately 16.5 seconds |
| ARE-13 | approximately 120.4 seconds |
| ARM-01 | approximately 3.9 seconds |
| ARM-10 | approximately 1.5 seconds |

ARE-13 remains the main optimization hypothesis. Historical operator
observation also suggests that normal VPro reports run faster locally on
DeLeon-Server than from LAN-connected VPro workstations, but this pilot did
not produce measurements that prove or disprove that observation.

## Confirmed DeLeon-Server environment

- Windows Server 2008 R2 Foundation SP1, build 7601, x64, workgroup server.
- Approximately 4 GB RAM.
- Approximately 2 TB local disk with approximately 1.33 TB free at inventory.
- Windows PowerShell 2.0, build 6.1.7601.17514.
- CLR 2.0.50727.8806; .NET Framework 4.8 is also installed.
- Visual PRO/5 runtime: `C:\BASIS\VPRO5\vpro5.exe`.
- Visual PRO/5 compiler: `C:\BASIS\VPRO5\pro5cpl.exe`.
- Visual PRO/5 version reported as approximately 15.00; executables are x86.
- Local operational data: `C:\Add-ON\AON\ADATA`.
- BASIS License Manager is installed and running.

No modernization was performed. The standing recommendation is to avoid
installing WMF/PowerShell 5.1, Python, Git, Node.js, SDK/compiler tooling,
WinRM infrastructure, new management agents, or new database tooling merely
to support this optimization experiment.

## Pilot design and preserved locations

The pilot reused the authoritative Open Sales Order qualifier, changed the
source root to the equivalent local path, retained `MODE="O_RDONLY"`, and
confined all intended output beneath:

`C:\DLE-OS-Pilot\OpenSalesOrderLocalFullScan-v1`

It contained no SQL promotion, canonical promotion, service, scheduled-task,
share, firewall, VPro configuration, or ADATA write behavior.

Preserved original failure:

`C:\DLE-OS-Pilot\OpenSalesOrderLocalFullScan-v1\Runs\LOCALOPENSALES-20260819T124706Z-A478A4E5`

Preserved v1.1 failure and current restart point:

`C:\DLE-OS-Pilot\OpenSalesOrderLocalFullScan-v1\Runs\LOCALOPENSALES-20260819T132116Z-0887BADD`

The v1.1 transfer patch was found on DeLeon-Server at:

`C:\Groups\Production\DeLeon-Server-Local-Open-Sales-Pilot-v1.1-Launch-Fix.zip`

DLE-OS-HOST preparation artifacts remain ignored under `.tmp` and are not a
durable substitute for the server-side preserved run evidence. Package hashes
recorded during preparation were:

- Original pilot ZIP SHA-256:
  `B55354F2BA75F1FC5EE0E84A9F81EA46A3783A99906D10624C26A3F0933BEBE2`
- v1.1 launch-fix ZIP SHA-256:
  `F8364AAE9F6B4CBD6BDF7883E50B674038BC771DEDED846B79D01F61F5394393`

The originally assumed `P:` transfer drive was not available in the active
DeLeon-Server PowerShell/RDP session. Do not assume `P:` exists on a future
continuation.

## Failure history

### Initial wrapper

The first attempt printed `Compiling ARE-03...` and failed before capturing a
child PID:

`Exception calling "Start" with "0" argument(s): "Access is denied"`

Read-only diagnostics established:

- Identity was `DELEON-SERVER\Administrator` with a high-integrity token.
- Administrator and Administrators groups were enabled.
- `pro5cpl.exe` and `vpro5.exe` granted Full Control to Administrator,
  Administrators, SYSTEM, and Everyone.
- Pilot root, run, Compile, and Programs directories granted Administrators
  Full Control.
- No meaningful AppLocker/SRP restriction was found. The legacy Safer policy
  contained only `authenticodeenabled=0`; `SrpV2` was absent.
- `PROCESS_LOG.csv` contained only its header.

The best-supported initial hypothesis was incompatibility between PowerShell
2 / CLR 2 and the wrapper's raw `System.Diagnostics.ProcessStartInfo` setup,
not an ordinary file or directory ACL denial.

### v1.1 surgical launch correction

The only attempted correction replaced the raw `ProcessStartInfo` start with
PowerShell 2's `Start-Process -PassThru`. PID ownership, timeouts, exit-code
validation, owned-child cleanup, and failure evidence were retained. No server
policy or VPro change was made.

The replacement `Run-LocalOpenSalesFullScanPilot.ps1` was verified on the
server at 17,803 bytes with timestamp 2026-08-19 06:07:44 local time.

The second attempt again reached `Compiling ARE-03...` and failed immediately:

`This command cannot be executed due to the error: Access is denied.`

Exit code was 1. No full VPro extraction occurred.

## Data-safety outcome

- No ADATA write occurred.
- No VPro runtime, compiler, configuration, or permission was modified.
- No SQL or canonical promotion occurred.
- No service, task, ACL, UAC, SRP/AppLocker, firewall, WinRM, or execution
  policy was changed.
- No server modernization was performed.

## Exact future restart sequence

Do not repeat general server reconnaissance. Begin from the preserved v1.1
run `LOCALOPENSALES-20260819T132116Z-0887BADD`.

1. Retrieve and inspect its `PILOT_RESULT.txt` and `PROCESS_LOG.csv`.
2. Establish exactly which executable and command line received access denied.
3. Reproduce, at most once, with an extremely small direct/manual invocation
   of the existing `pro5cpl.exe` under the same Administrator session.
4. Prefer the native compiler/runtime command over another PowerShell launch
   abstraction.
5. Do not change ACLs, UAC, SRP/AppLocker, execution policy, WMF/PowerShell,
   VPro configuration/permissions, services, shares, firewall, or WinRM
   without specific new evidence and separate approval.
6. If resolution requires broad Windows Server 2008 R2 or security-policy
   archaeology, stop and reconsider whether the likely performance benefit
   justifies the production risk and manual effort.
7. If a local scan eventually succeeds, return the complete isolated run
   evidence and compare timings, raw counts/hashes, source generation, and
   S/O `0012009` parity before designing any permanent helper.

Do not proceed from a successful timing pilot into exact-key experiments or a
permanent bridge without a separate architectural review and approval.

## Longer-term access constraint

The dominant productivity problem was not VPro logic: Codex could not operate
inside the existing DeLeon-Server RDP session, requiring Miguel to perform
every command, transfer, and observation manually.

If the experiment is revisited and local execution proves materially faster,
the preferred eventual boundary remains:

`Codex / DLE-OS-HOST -> governed request -> minimal DeLeon-Server local runner
-> local O_RDONLY VPro operation -> validated evidence returned to DLE-OS-HOST`

That helper/bridge is only a future concept. It is not authorized or
implemented by this handoff.

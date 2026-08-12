# DLE-OS Canonical DEV Environment Manifest

This document is the authoritative description of the current DLE-OS DEV
runtime. It describes the operating architecture, not retired migration or
bootstrap states. Read it before changing or qualifying DEV runtime behavior.

## Endpoints and boundaries

| Boundary | Current endpoint | Purpose and access |
| --- | --- | --- |
| Authenticated DEV | `https://dev.dle-os.internal.dlemfg.com/` | Primary user entry point. An unauthenticated request is challenged through Keycloak. |
| DEV frontend | `http://dle-os-host:5051/` | Frontend/BFF boundary. `GET /shared` is the unauthenticated HTTP 200 deployment health check. |
| DEV runtime identity | `https://dev.dle-os.internal.dlemfg.com/api/runtime/info` | Safe read-only metadata for the exact deployed release. It is intentionally anonymous in DEV so deployment qualification does not require a user session. |
| Canonical API | `http://dle-os-host:5052/` | Read-only API over the qualified canonical LIVE mirror. `GET /api/platform/live/v1/readiness` is the readiness endpoint; use Windows credentials where required. |
| Operational ControlHost | `http://dle-os-host:5054/` | Isolated DEV operational API. It may write only to governed DEV operational data. `GET /health` uses Windows authentication and returns the runtime/database boundary to an authorized caller. |
| Sync Operations | 5051 BFF → 5054 | Permission-gated focused VPro5 synchronization. Durable state and lease are under `C:\ProgramData\DLE-OS\SyncOperations`; see `Documentation/SYNC_OPERATIONS.md`. |
| Keycloak | `https://auth.internal.dlemfg.com/` | DEV identity provider. `GET /realms/dle-os/.well-known/openid-configuration` is the external discovery check. Host-local readiness is `http://127.0.0.1:9190/health/ready`. |

`https://dev.dle-os.internal.dlemfg.com/shared` is the preferred exact-hostname
frontend health check. HTTP.sys can make TCP ownership appear as PID 4; use the
service record and HTTP.sys request-queue ownership when the application PID is
required.

## Current runtime ownership

### Authenticated frontend / BFF — 5051

- Windows service: `DleOsDevelopmentFrontend` (Automatic).
- Purpose: authenticated DEV shell, BFF/session boundary, and governed calls to
  the canonical and operational APIs.
- Identity: `DLE-OS-HOST\DLE-OS-DEV-FRONTEND`. Windows may display the same
  local account as `.\DLE-OS-DEV-FRONTEND`; compare its SID when validating it.
- Release root:
  `C:\ProgramData\DLE-OS\DevelopmentFrontend\Service\releases\<UTC-build-id>`.
- Owned HTTP.sys prefixes: `http://dle-os-host:5051/`,
  `http://192.168.0.105:5051/`,
  `https://dev.dle-os.internal.dlemfg.com:443/`, and
  `https://auth.internal.dlemfg.com:443/`.
- Safe transition: use only `.\Deploy-DevFrontend.cmd`. Do not kill its worker
  by PID or use the retired detached-process launcher.

The external `auth.internal` prefix is owned by the BFF's HTTP.sys boundary;
Keycloak itself listens on the host-local backend described below.

The authenticated header includes a muted `DEV • <release-id>` indicator. Its
hover detail contains the Git HEAD, clean/dirty state, and source digest. The
same values are returned by `/api/runtime/info` and recorded in deployment
evidence.

### Keycloak

- Windows service: `DleOsKeycloak` (Automatic).
- Purpose: DEV realm authentication and identity-provider operations.
- Identity: `NT SERVICE\DleOsKeycloak`.
- Runtime root: `C:\Program Files\DLE-OS\Keycloak\current`.
- Service backend/readiness: host-local port `9190`; external discovery is
  exposed through `https://auth.internal.dlemfg.com/`.
- Safe restart expectation: a normal frontend deployment must not restart or
  reconfigure Keycloak. Change it only in an explicitly authorized identity
  task.

### Canonical read-only API — 5052

- Formal Windows service: none. At boot it is owned by scheduled task
  `\DLE-OS\Development\Canonical API 5052` (startup trigger, 30-second delay,
  password logon).
- Identity: `DLE-OS-HOST\DLE-OS-LIVE-API`.
- Runtime root: `C:\ProgramData\DLE-OS\DevelopmentCanonicalApi`.
- Boot wrapper:
  `C:\ProgramData\DLE-OS\DevelopmentCanonicalApi\Start-DevelopmentCanonicalApiAtStartup.ps1`.
- Startup evidence:
  `C:\ProgramData\DLE-OS\DevelopmentCanonicalApi\Logs\startup-task-evidence.json`.
- Purpose: read-only access to the qualified `DLE_OS_CANONICAL_LIVE` mirror.
  Its connection and API boundary are read-only; DEV work must not turn this
  into a production write path.
- Safe restart expectation: preserve it during frontend-only deployment. Use
  its governed launcher only when a task explicitly requires a 5052 transition.
- The boot wrapper fails closed if LIVE ports 5041 and 5042 have a mixed
  present/absent state, records their pre-start ownership, and requires their
  state to remain unchanged after readiness. It never changes either LIVE
  boundary.

### Isolated operational ControlHost — 5054

- Formal Windows service: none. At boot it is owned by scheduled task
  `\DLE-OS\Development\Operational ControlHost 5054` (startup trigger,
  45-second delay, password logon).
- Identity: `DLE-OS-HOST\DLE-OS`.
- Runtime root:
  `C:\DLE-OS\Development\OperationalControlHost5054\<UTC-build-id>`.
- Owned prefix: `http://dle-os-host:5054/`.
- Boot wrapper:
  `Tools\DevelopmentRuntime\Start-DevOperationalControlHost5054WithEnvironment.ps1`.
- Startup evidence:
  `C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Logs\startup.evidence.json`.
- Purpose: authorized isolated DEV operational actions. It reads canonical
  data through 5052 and may write `DLE_OS_OPERATIONAL_DEV`; its security access
  is limited to `DLE_OS_SECURITY_DEV` as configured.
- Safe restart expectation: preserve it during frontend-only deployment. A
  component-specific, explicitly authorized workflow is required to replace it.
- The wrapper requires 5052 readiness before launching 5054, verifies that the
  child remains alive and registers the 5054 listener, then records the
  isolated runtime/database boundaries.

## Authentication flow

The high-level flow is:

`DEV hostname → frontend/BFF → Keycloak → /signin-oidc callback → authenticated DLE-OS session`

The browser receives a DLE-OS application session after Keycloak succeeds.
Codex browser sessions do not automatically inherit Miguel's existing browser
session. If Codex reaches the DLE-OS Keycloak sign-in page, routing and the
authentication challenge are working; do not create a bypass or handle a user
password merely to perform deployment qualification.

The DEV BFF stores its 30-minute, non-sliding OIDC tickets under
`C:\ProgramData\DLE-OS\DevelopmentFrontend\AuthState`. Ticket files are
protected with an application-purpose ASP.NET Core Data Protector; the
persistent key ring is encrypted with Windows DPAPI. The root ACL permits only
SYSTEM, Administrators, and `DLE-OS-DEV-FRONTEND`, and is not shared with LIVE.
This allows a valid DEV application session to survive a routine frontend
restart. The storage can be revoked by deleting it only through an explicitly
authorized maintenance action while the frontend is stopped.

Normal DEV challenges do not force `prompt=login`, so an existing Keycloak SSO
session may complete the governed OIDC flow without another password entry.
Expired browser `fetch()` requests receive a no-store HTTP 403 marked with
`X-DLE-OS-Authentication-Required: true` instead of following a cross-origin
OIDC redirect or invoking HTTP.sys Negotiate/NTLM; non-browser API challenges
remain HTTP 401. Interactive page navigation still uses the normal Keycloak
challenge. Modules must render an explicit sign-in or reload action for the
marker and retain bounded retry for genuine transient failures.
The explicit Sign Out control remains authoritative: it removes the persistent
BFF ticket, clears the secure browser cookie and local browser state, invokes
Keycloak end-session, and returns to `/shared`. Shared-device identity changes
must therefore use Sign Out before the next employee signs in.

## Official frontend deployment

Run from the repository root:

```powershell
.\Deploy-DevFrontend.cmd
```

The command validates the DEV target, builds, requests one controlled elevation,
publishes a versioned release, transitions only `DleOsDevelopmentFrontend`,
validates service/PID and HTTP.sys ownership, preserves protected listeners,
runs DEV/auth health checks, and rolls back the service ImagePath if the
candidate fails.

Evidence is written to:

`C:\DLE-OS\Repositories\DLE-OS\.tmp\windows-service-deployment\<UTC-build-id>\deployment.json`

## Unattended backend startup

Install or repair the two DEV backend startup tasks from an elevated operator
session with:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `
  .\Tools\DevelopmentRuntime\Install-DevelopmentBackendStartupTasks.ps1
```

The installer requests the existing `DLE-OS-HOST\DLE-OS` credential through a
secure Windows prompt. A one-time provisioner reads the existing
`DLE-OS/LIVE-CANONICAL-API/RUNTIME` Credential Manager entry in memory and
registers the permanent 5052 task directly as `DLE-OS-LIVE-API`. The
provisioner task is removed after successful registration. No credential value
is written to the repository, task action, environment, log, or evidence.

Windows Task Scheduler stores the two task credentials in its protected store.
If either runtime account password changes or expires, re-run the installer so
the affected task receives the current credential. Password rotation does not
update an existing task automatically.

The qualified reboot sequence is:

`SQL -> 5051/Keycloak -> 5052 readiness -> 5054 listener`

This sequence was proven across an actual host reboot on 2026-08-12 without a
manual backend launch or an interactive user-logon dependency.

## Protected boundaries

A normal frontend task must preserve:

- 5052 and its read-only canonical API process;
- 5054 and its isolated operational ControlHost process;
- Keycloak service, realm, clients, metadata, secrets, and database;
- every LIVE service, LIVE listener, production SQL database, credential, and
  data set; and
- existing Windows service identities and URL/certificate bindings.

Do not place passwords, tokens, private keys, client secrets, connection-string
credentials, or DPAPI material in repository documentation or evidence.

## Determine the deployed runtime identity

Use live state and the newest deployment evidence instead of assuming a PID or
release:

```powershell
$service = Get-CimInstance Win32_Service -Filter "Name='DleOsDevelopmentFrontend'"
$service | Select-Object Name, State, StartName, ProcessId, PathName

$evidence = Get-ChildItem .\.tmp\windows-service-deployment -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1 |
    ForEach-Object { Get-Content (Join-Path $_.FullName 'deployment.json') -Raw } |
    ConvertFrom-Json
$evidence | Select-Object Verdict, ReleasePath, ServiceProcessId, SourceHead
```

`PathName` is the authoritative current release path. Evidence `SourceHead`
identifies the Git base; the release manifest hashes identify the actual
published files, including builds made from an intentionally dirty working
tree. The evidence verdict must be `PASS` and its PID/release must agree with
the live service.

For HTTP.sys ownership, inspect `netsh.exe http show servicestate view=requestq`
and find the exact prefix block rather than relying on `Get-NetTCPConnection`
PID 4.

The safe runtime endpoint can be queried directly:

```powershell
Invoke-RestMethod https://dev.dle-os.internal.dlemfg.com/api/runtime/info
```

It returns only `environment`, `releaseId`, `builtAtUtc`, `gitHead`,
`sourceDirty`, `sourceDigestSha256`, `sourceFileCount`, `serviceName`, and
`serviceIdentity`. It does not return paths, configuration, credentials,
connection strings, tokens, or secrets. The source digest covers the frontend
project, its governed security/identity project inputs, the authenticated shell,
and `SRC`; tracked modifications and relevant untracked files therefore produce
a different identity even when Git HEAD is unchanged.

## Troubleshooting

- **Source changed but browser unchanged:** source was probably built but not
  deployed. Run `.\Deploy-DevFrontend.cmd`, require `PASS`, then reload the
  exact DEV hostname without cached content.
- **Service runs an old release:** compare service `PathName` with the newest
  PASS evidence. Do not edit `ImagePath` manually; rerun the official command.
- **UAC/elevation:** accept the single expected Miguel consent prompt. A denied
  prompt causes a failed deployment without authorizing broad administrator
  membership.
- **Redirected to Keycloak:** this is the expected unauthenticated flow. Codex
  may prove the challenge and runtime deployment while leaving authenticated
  visual acceptance to Miguel.
- **Protected-listener mismatch:** stop and investigate ownership of 5052/5054
  and other reported ports. Do not restart unrelated or LIVE services.
- **Deployment rollback:** inspect the deployment evidence `Error`, rollback
  fields, live service `PathName`, and health. A failed candidate is not resolved
  until the prior release is restored and healthy.

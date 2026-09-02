# DLE-OS Development Runtime Startup

These commands start only the development runtime. Production ports 5041 and
5042 must not be stopped, restarted, or replaced.

The authoritative current topology and ownership rules are in
[`DEV_ENVIRONMENT_MANIFEST.md`](DEV_ENVIRONMENT_MANIFEST.md). Historical phase
or migration scripts are not normal startup/deployment entry points.

## Deploy or restart the development frontend — port 5051

Run the supported command from the repository root in a normal developer or
operator session:

```powershell
.\Deploy-DevFrontend.cmd
```

The command requests one UAC approval, publishes a versioned DEV release, and
transitions only the SCM service `DleOsDevelopmentFrontend`. It fails closed
unless the configuration names the DEV environment and the governed 5051,
5052, 5054, 5056, and 5057 boundaries. Deployment evidence is written under
`C:\DLE-OS\Repositories\DLE-OS\.tmp\windows-service-deployment`.

## Start the development canonical API — port 5052

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\Start-DevelopmentApi.ps1
```

The existing launcher uses the qualified `DLE-OS-HOST\DLE-OS-LIVE-API`
identity and its managed credential. It may request UAC. If 5052 is already
running, verify it instead of replacing it.

Normal host startup does not use this interactive command. Scheduled task
`\DLE-OS\Development\Canonical API 5052` starts the deployed wrapper directly
as `DLE-OS-HOST\DLE-OS-LIVE-API` one minute after boot. It records readiness
and unchanged 5041/5042 state under
`C:\ProgramData\DLE-OS\DevelopmentCanonicalApi\Logs`.

## Start the operational ControlHost — port 5054

Normal host startup uses protected scheduled task
`\DLE-OS DEV Operational ControlHost 5054 Candidate` under
`DLE-OS-HOST\DLE-OS-DEV-CONTROL`, delayed two minutes after boot. The task is
pinned to release `dev5054-20260825T170328Z-4e01176a73ea`; its launcher fails
closed unless the 5052 security guard is healthy. The former
`\DLE-OS\Development\Operational ControlHost 5054` task remains disabled and
the diagnostic Windows service remains stopped/manual.

Do not use `Install-DevelopmentBackendStartupTasks.ps1` to replace the current
protected 5054 ownership model. It is historical bootstrap tooling. Task
credentials are held only by Windows Task Scheduler's protected store and are
changed only through an explicitly authorized protected registration flow.

## Sync Operations control — port 5056

Task `\DLE-OS\Development\Sync Operations ControlHost 5056 Candidate` starts
the exact qualified release one minute after boot as
`DLE-OS-HOST\DLE-OS`. It is `IgnoreNew`, has no execution time limit, and starts
real synchronization disabled. Normal browser traffic reaches its four
allowlisted routes only through authenticated 5051.

## Governed Invoice History refresh control — port 5057

Task `\DLE-OS\Development\Governed Refresh ControlHost Candidate` starts the
exact qualified release one minute after boot as `DLE-OS-HOST\DLE-OS`. It is
`IgnoreNew`, has no execution time limit, and starts live Invoice History
execution disabled. Canonical Invoice History reads remain on 5052.

## Start Customer Files control — port 5053

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\Start-CustomerFilesControl.ps1
```

5053 is intentionally offline and excluded from the current stable DEV
baseline. Do not run this legacy launcher or revive its obsolete direct
authentication model. Availability is deferred to the technical-drawings and
documents architecture review.

## Health checks

```powershell
Invoke-WebRequest -UseBasicParsing http://dle-os-host:5051/shared
Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials http://dle-os-host:5052/api/platform/live/v1/readiness
Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials http://dle-os-host:5054/health
```

The 5051 shared response must be HTTP 200. The deployment command also verifies
the exact DEV HTTPS hostname and Keycloak discovery endpoint.

To identify a down component, inspect only the development listeners:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5051,5052,5054,5056,5057 -ErrorAction SilentlyContinue |
    Select-Object LocalPort,LocalAddress,OwningProcess
```

A missing required port identifies the component that is down; 5053 is the
intentional exception. A listener with a
failing health check should be investigated through that component's log or
startup evidence; do not restart production as a workaround.

An API readiness response such as HTTP 503 can mean that the API process is
running but its governed data-readiness gate is closed. Check the JSON reason
before treating the component as a stopped process.

Do not stop the frontend worker by PID. SCM owns the process; use the governed
deployment command for a release transition. Ports 5041, 5042, 5052, 5054,
5056, and 5057 remain outside this workflow. HTTP.sys listeners can appear as PID 4;
consult the manifest before interpreting ownership.

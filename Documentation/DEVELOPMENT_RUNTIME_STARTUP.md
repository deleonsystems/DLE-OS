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
5052, and 5054 boundaries. Deployment evidence is written under
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
as `DLE-OS-HOST\DLE-OS-LIVE-API` 30 seconds after boot. It records readiness
and unchanged 5041/5042 state under
`C:\ProgramData\DLE-OS\DevelopmentCanonicalApi\Logs`.

## Start the operational ControlHost — port 5054

Normal host startup uses scheduled task
`\DLE-OS\Development\Operational ControlHost 5054` under
`DLE-OS-HOST\DLE-OS`, delayed 45 seconds after boot. Its wrapper waits for a
successful 5052 readiness response before launching the isolated DEV runtime.
Startup evidence is written to
`C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Logs\startup.evidence.json`.

Install or repair both unattended tasks with the governed DEV-only installer:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `
  .\Tools\DevelopmentRuntime\Install-DevelopmentBackendStartupTasks.ps1
```

Task credentials are held only by Windows Task Scheduler's protected store.
Re-run the installer after a password change for `DLE-OS` or
`DLE-OS-LIVE-API`; stored task credentials do not rotate automatically.

## Start Customer Files control — port 5053

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\Start-CustomerFilesControl.ps1
```

Run this existing launcher from the normal `DLE-OS-HOST\DLE-OS` operator
session. If 5053 is already listening, verify it instead of starting a second
instance.

## Health checks

```powershell
Invoke-WebRequest -UseBasicParsing http://dle-os-host:5051/shared
Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials http://dle-os-host:5052/api/platform/live/v1/readiness
Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials http://dle-os-host:5053/health
Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials http://dle-os-host:5054/health
```

The 5051 shared response must be HTTP 200. The deployment command also verifies
the exact DEV HTTPS hostname and Keycloak discovery endpoint.

To identify a down component, inspect only the development listeners:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5051,5052,5053,5054 -ErrorAction SilentlyContinue |
    Select-Object LocalPort,LocalAddress,OwningProcess
```

A missing port identifies the component that is down. A listener with a
failing health check should be investigated through that component's log or
startup evidence; do not restart production as a workaround.

An API readiness response such as HTTP 503 can mean that the API process is
running but its governed data-readiness gate is closed. Check the JSON reason
before treating the component as a stopped process.

Do not stop the frontend worker by PID. SCM owns the process; use the governed
deployment command for a release transition. Ports 5041, 5042, 5052, 5053,
and 5054 remain outside this workflow. HTTP.sys listeners can appear as PID 4;
consult the manifest before interpreting ownership.

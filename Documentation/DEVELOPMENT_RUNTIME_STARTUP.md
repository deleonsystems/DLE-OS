# DLE-OS Development Runtime Startup

These commands start only the development runtime. Production ports 5041 and
5042 must not be stopped, restarted, or replaced.

## Start the development frontend — port 5051

Run from a normal DLE-OS operator PowerShell session. The command works from
any current directory:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\Start-DevelopmentFrontend.ps1
```

The launcher builds Release only when its output is absent or stale, starts a
detached process on `http://0.0.0.0:5051`, and writes local startup evidence
under `C:\DLE-OS\Repositories\DLE-OS\.tmp\development-runtime`.

## Start the development canonical API — port 5052

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\Start-DevelopmentApi.ps1
```

The existing launcher uses the qualified `DLE-OS-HOST\DLE-OS-LIVE-API`
identity and its managed credential. It may request UAC. If 5052 is already
running, verify it instead of replacing it.

## Start Customer Files control — port 5053

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\Start-CustomerFilesControl.ps1
```

Run this existing launcher from the normal `DLE-OS-HOST\DLE-OS` operator
session. If 5053 is already listening, verify it instead of starting a second
instance.

## Health checks

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5051/
Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials http://dle-os-host:5052/api/platform/live/v1/readiness
Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials http://dle-os-host:5053/health
```

The 5051 response must be HTTP 200, contain `DEVELOPMENT — READ ONLY`, and
include `Cache-Control: no-store` and `Pragma: no-cache`.

To identify a down component, inspect only the development listeners:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5051,5052,5053 -ErrorAction SilentlyContinue |
    Select-Object LocalPort,LocalAddress,OwningProcess
```

A missing port identifies the component that is down. A listener with a
failing health check should be investigated through that component's log or
startup evidence; do not restart production as a workaround.

An API readiness response such as HTTP 503 can mean that the API process is
running but its governed data-readiness gate is closed. Check the JSON reason
before treating the component as a stopped process.

## Stop only the development frontend

Read the recorded PID, verify that it owns 5051 and that its command line names
`DleOs.DevelopmentFrontend.dll`, then stop that PID only:

```powershell
$evidence = Get-Content C:\DLE-OS\Repositories\DLE-OS\.tmp\development-runtime\5051-launch.json -Raw | ConvertFrom-Json
$listener = Get-NetTCPConnection -State Listen -LocalPort 5051 -ErrorAction Stop
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($evidence.ProcessId)"
if ($listener.OwningProcess -eq $evidence.ProcessId -and $process.CommandLine -like '*DleOs.DevelopmentFrontend.dll*') {
    Stop-Process -Id $evidence.ProcessId
}
```

This procedure must not be used against ports 5041, 5042, 5052, or 5053.

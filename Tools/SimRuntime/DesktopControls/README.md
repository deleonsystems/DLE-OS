# SIM Desktop controls

These scripts are the authoritative source for the user-local Start, Stop and
Open helpers. Install explicitly with PowerShell 7:

```powershell
& .\Tools\SimRuntime\Install-DleOsSimDesktopControls.ps1
```

The installer backs up the installed helpers and writes `installation.json` with
source and SHA256 hashes. It preserves the profile, shortcuts, certificates,
access code and SIM business state. To upgrade an existing browser-only Open SIM
shortcut, pass `-OpenShortcutPath` with its absolute `.lnk` path. The original link
is backed up before it is pointed at the Open helper. Open invokes the verified
Start helper before opening Edge, recovering a stopped server even when old
runtime metadata still reports that it started. Nothing automatically installs
on login, reboot, startup or checkout.
Open requests a visible new Edge window even though its PowerShell shortcut is
hidden. This leaves existing form tabs intact. `open-status.json` records browser
launch dispatch or failure; dispatch alone does not assert that a page loaded.
Changing branches does not overwrite the installed snapshot; runtime source still
comes from the repository selected in the local profile.

Start reads the permanent access code freshly from User scope and explicitly
passes it in the detached process environment. It never puts the code in command
arguments or diagnostic records. Success requires authenticated HTTPS status
`READY`, `SIM`, `PRIVATE_LAN_HTTPS`, and the configured binding, with normal TLS
certificate validation. Missing permanent configuration fails closed.

Each invocation writes `start-status.json` before parsing the profile or importing
repository tooling. Failures record stage, error identifier, line and server log
paths and show a Desktop error dialog. Investigate this record and the referenced
logs before making further repairs. A running PID/listener alone is insufficient
to report successful startup.

For updates, edit this source and run the installer. Do not repair only the local
copy. No commit is made by the installer; source changes must eventually be
reviewed and integrated through the normal repository workflow to remain
available on other branches and clones.

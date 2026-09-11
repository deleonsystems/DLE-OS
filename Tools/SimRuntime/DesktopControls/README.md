# SIM Desktop controls

These scripts are the authoritative source for the existing user-local Start and
Stop helpers. Install explicitly with PowerShell 7:

```powershell
& .\Tools\SimRuntime\Install-DleOsSimDesktopControls.ps1
```

The installer backs up the installed helpers and writes `installation.json` with
source and SHA256 hashes. It preserves the profile, shortcuts, certificates,
access code and SIM business state. Open SIM continues to use the existing Edge
shortcut. Nothing automatically installs on login, reboot, startup or checkout.
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

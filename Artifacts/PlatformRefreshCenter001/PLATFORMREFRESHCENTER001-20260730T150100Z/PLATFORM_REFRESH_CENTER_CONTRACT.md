# Platform Refresh Center Contract

Contract: `platform-refresh-center-v1`

Registry: `1.0.0`

Browser origin: `http://dle-os-host:5041`

Authorized operator: `DLE-OS-HOST\DLE-OS`

The Refresh Center is an administrative status-and-control boundary on port 5043. It represents twelve existing Platform datasets without becoming a dataset tab. It reads qualified metadata from the LIVE API, starts only fixed allowlisted launchers, accepts no paths or command lines, and never reads VPro data itself.

Enabled operations are limited to the existing governed core source-check/conditional-full pipeline, the existing Invoice History 45-day overlap pipeline, and an explicit confirmed core force-full action. All other operations return `RefreshNotImplemented` with a named follow-on milestone.

All source-reading runners retain `MODE="O_RDONLY"`, independent validation, SQL transaction, rollback, and promotion controls.

# Operations Refresh Deployment and Rollback

Result: **PASS**

Final protected publication completed at
`2026-07-30T17:47:58.2656825Z`.

- Control host runtime:
  `C:\Program Files\DLE-OS\LiveSnapshotRefreshControl`
- Control host PID: `27408`
- Runtime identity: `DLE-OS-HOST\DLE-OS`
- Frontend build: `20260730T174759Z-454253323EB7`
- Frontend source manifest:
  `454253323EB7E393D670481D6582FD4C4015C6326EE14D46D54707EC1D66390A`
- Frontend asset manifest:
  `B1310F667C7150F9EE1559E69F750A9B5110E8D2C5233C59C6F654F7C7705B62`
- Runtime backup:
  `Artifacts\PlatformRefreshCenter001\PLATFORMREFRESHCENTER001-20260730T150100Z\ControlHostRuntimeBackup-20260730T174758Z`

The publisher preserved ports 5041, 5042, and 5044 and restarted only the
Refresh Center control host. It did not modify the Live API, existing
qualified refresh runners, VPro sources, or X: data.

The scheduled task is enabled, Ready, uses the fixed governed launcher,
interactive token, Limited run level, and stores no credential. The next
run is July 31, 2026 at 2:00 AM Pacific.

Rollback remains the protected runtime backup plus the prior exported task
definition. Dataset runners retain their own transaction and prior-package
boundaries.

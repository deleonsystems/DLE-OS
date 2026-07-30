# Deployment and Rollback

The governed deployment publishes the revised port-5043 control host to a local artifact staging directory, elevates once, backs up the existing runtime, replaces only the control-host publication, restarts it as `DLE-OS-HOST\DLE-OS`, and publishes one immutable frontend build.

If deployment fails, the prior control-host runtime is restored and relaunched. If frontend promotion occurred, the established immutable frontend rollback command restores the prior build. The LIVE API, SQL, qualified boundary, extractors, importers, X: mapping, and promotion broker are not modified.

Deployment completed under elevated `DLE-OS-HOST\DLE-OS`.

- Final frontend build: `20260730T151518Z-5B1E030B115F`
- Frontend asset manifest: `E923A816F0675BD5ED9AB7EE65A79491FF7B640E74A5CFD7BED7CB2843F18CCF`
- Control-host PID: `31116`
- Control-host owner: `DLE-OS-HOST\DLE-OS`
- Ports 5041, 5042, 5043, and 5044: listening

The first accepted deployment found a bounded DLL-release race. The prior runtime rollback passed, and no frontend or source action occurred. The deployment script now waits up to 15 seconds for the old process to exit. The corrected deployment passed.

Runtime backup: `ControlHostRuntimeBackup-20260730T151516Z`. The LIVE API, SQL, qualified snapshot boundary, existing runners, and promotion broker were not replaced or modified.

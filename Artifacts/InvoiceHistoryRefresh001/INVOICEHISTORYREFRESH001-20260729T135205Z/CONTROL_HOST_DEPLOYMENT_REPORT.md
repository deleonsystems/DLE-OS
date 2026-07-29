# Control-host deployment report

Verdict: `PASS`

## Deployment

The updated control host was published through the governed UAC launcher and
installed only beneath:

`C:\Program Files\DLE-OS\LiveSnapshotRefreshControl`

The deployment ran elevated as `DLE-OS-HOST\DLE-OS`; the deployed runtime also
runs as that identity. Source access was not performed by deployment.

| Stage | Previous PID | New PID | Result |
| --- | ---: | ---: | --- |
| Invoice History routes | 14804 | 12404 | PASS |
| ERP token-handoff repair | 12404 | 20032 | PASS |
| ERP State ACL repair | 20032 | 3364 | PASS |

Final assembly SHA-256:

`06A05F18C2EE8F3DA7356558802CC80D160FEAECE2FF775B9B0925B47D2BE3D7`

The deployed assembly hash matched its governed staging publication.
Timestamped runtime backups were retained before every replacement.

## Deployment defects found and corrected

The pre-existing ERP trigger launched its runner directly from the elevated
control host. The child inherited the elevated token, which cannot see the
operator's qualified `X:` mapping. The first regression therefore failed
closed at `BMM-01` and retained the prior snapshot.

The smallest safe correction changed only the ERP control-host launch:

- the existing ERP runner remains unchanged;
- the trigger now hands a fixed `.cmd` launcher to the signed-in Explorer
  session, matching the already-qualified non-elevated execution boundary;
- an API-level running-state check supplements the runner's existing lock.

The failed elevated attempt had also recreated `status.json` as
Administrators-owned. The governed deployment restored `Modify` access for
only `DLE-OS-HOST\DLE-OS` on the existing ERP refresh State directory so the
non-elevated runner can atomically replace its status file. SYSTEM and
Administrators retain their existing access.

No source path, reader, SQL importer, package, API, qualified snapshot
boundary, or viewer behavior changed as part of these repairs.

## Runtime acceptance

- Port 5043: listening through HTTP.sys
- Control-host PID: `3364`
- Process path:
  `C:\Program Files\DLE-OS\LiveSnapshotRefreshControl\DleOs.LiveSnapshotRefresh.ControlHost.exe`
- Runtime identity: `DLE-OS-HOST\DLE-OS`
- Port 5044 promotion broker: preserved
- Port 5042 LIVE API: `Ready`
- Port 5041 historical API: `Ready`

The existing ERP trigger subsequently completed with
`NO_SOURCE_CHANGES`. Its active ImportRunId remained
`e66391d9-7422-4c6f-9992-feed3d401a75`, and it did not change the Invoice
History refresh run ID.

# Source-Check Heartbeat Recommendation

Status: RECOMMENDATION ONLY — NOT IMPLEMENTED

A future, separately qualified source-check operation should distinguish
three timestamps:

- `SnapshotAsOf`: when the active canonical package was genuinely extracted
  from ERP and imported;
- `SourceCheckedAt`: when the approved source identity indicators were last
  checked;
- `QualificationCompletedAt`: when full extraction and qualification last
  completed.

When an unchanged-source metadata check succeeds, it may update only
`SourceCheckedAt`. It must preserve `SnapshotAsOf`, the active ImportRunId,
the package hash, and `QualificationCompletedAt`. The UI and readiness
contract should then say that the source was checked and found unchanged,
not that the snapshot was re-extracted or synchronized at the check time.

This design requires its own contract, SQL, permission, atomic-update,
failure-retention, API, and browser qualification. It must not replace or
weaken the full extraction path, and it is intentionally outside the
force-full unblock.


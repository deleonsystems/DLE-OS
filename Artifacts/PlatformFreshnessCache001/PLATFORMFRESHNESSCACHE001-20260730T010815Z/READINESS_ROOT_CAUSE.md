# Readiness Root Cause

Verdict: PROVEN

`liveapi.SnapshotMetadata` derived one timestamp from the committed ImportRun.
`LivePlatformStatusRepository` compared its age to the single 1,440-minute
freshness threshold and converted a valid but older snapshot into hard
`NotReady`. The normal `NO_SOURCE_CHANGES` path updated only local status JSON,
so the API had no qualified SQL value representing a recent source-indicator
check.

The corrected model stores snapshot, source-check, and qualification timestamps
separately. Snapshot age is a warning only. A successful unchanged metadata
check advances only `SourceCheckedAt`. Structural, contract, package, SQL,
source-changed, expired-source-check, and runtime failures remain hard
NotReady states.

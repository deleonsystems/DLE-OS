# LIVE Readiness API Contract

Route: `GET /api/platform/live/v1/readiness`

API contract version: `live-readiness-v2`.

Additive fields:

- `readinessVerdict`
- `readinessState`
- `readinessReason`
- `snapshotAsOfUtc`
- `snapshotAgeSeconds`
- `sourceCheckedAtUtc`
- `sourceCheckAgeSeconds`
- `qualificationCompletedAtUtc`
- `qualificationAgeSeconds`
- `sourceChangeStatus`
- `lastSourceCheckResult`
- `warnings`
- `hardFailures`
- `apiContractVersion`

Legacy fields including `snapshotTimestampUtc` and `freshnessStatus` remain for
compatible consumers.

Ready states:

- `ReadyFresh`
- `ReadySourceRechecked`
- `ReadyWithStaleSnapshotWarning`

Hard states:

- `NotReadySourceChanged`
- `NotReadySourceCheckExpired`
- `NotReadyContractMismatch`
- `NotReadyPackageMismatch`
- `NotReadySqlMismatch`
- `NotReadyQualificationFailure`
- `NotReadyRuntimeFailure`

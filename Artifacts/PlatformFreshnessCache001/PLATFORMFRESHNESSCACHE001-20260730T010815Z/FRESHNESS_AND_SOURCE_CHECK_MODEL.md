# Freshness and Source-Check Model

## Qualified timestamps

- `SnapshotAsOf`: changes only after genuine extraction, validated import, and
  qualified promotion.
- `SourceCheckedAt`: changes after a successful exact approved-indicator check.
- `QualificationCompletedAt`: changes only after the full qualification and
  promotion path.

## Defaults

- snapshot warning: 1,440 minutes;
- source-check warning: 1,440 minutes;
- source-check hard expiration: 4,320 minutes;
- qualification warning: 10,080 minutes.

These thresholds reflect the qualified operating model: quick metadata checks
may be frequent, full extraction is not daily, and a valid snapshot remains
usable with truthful warnings.

## Normal no-change behavior

The runner validates the fixed approved paths, existence, length, UTC
last-write indicators, and the stored indicator fingerprint. When unchanged,
SQL procedure `platform.RecordLiveSourceCheck` transactionally advances only
`SourceCheckedAt`, records `NO_SOURCE_CHANGES`, and retains ImportRunId, package
hash, SnapshotAsOf, and QualificationCompletedAt.

When an indicator changes, the successful-check timestamp is not advanced and
the existing governed full-extraction path is required. Force-full remains an
explicit operator-only switch that skips only the early no-change return.

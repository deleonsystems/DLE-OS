# PLATFORM-FRESHNESS-CACHE-001 Contract

Status: FROZEN FOR IMPLEMENTATION

Frozen at: 2026-07-30T01:08:15Z

## Scope and invariants

This contract governs the DLE-OS frontend publication boundary and the LIVE
canonical snapshot readiness boundary. It does not authorize a new ERP dataset,
an ERP write, a mapped-drive change, a package reimport used only to refresh a
timestamp, or a weakening of any contract, package, SQL, schema, identity,
authorization, CORS, rollback, or source-validation check.

The active nine datasets and their current identifiers remain authoritative
until a genuine governed replacement succeeds.

## Frontend publication contract

### Build identity

`FrontendBuildId` is generated during publication from the complete deployable
frontend input. The ID is a UTC publication label plus a bounded SHA-256
content prefix:

`yyyyMMddTHHmmssZ-<12 uppercase SHA-256 characters>`

The SHA-256 covers a deterministic manifest of every published mutable
frontend file. Reusing an ID for different bytes is prohibited.

`LoadedFrontendBuildId` is embedded into the served shell and assigned to the
browser runtime before application modules execute. Every versioned script and
stylesheet receives the same build ID through its immutable URL.

### Publication layout and atomicity

Each complete frontend build is copied to:

`C:\ProgramData\DLE-OS\Frontend\Builds\<FrontendBuildId>\`

The build contains a generated shell, all mutable `SRC` and `ASSETS` files, and
a manifest with path, length, and SHA-256. Files are staged in a sibling
directory, validated, and renamed into `Builds` only after completeness is
proved.

The current release pointer is a small protected manifest. It is replaced by
write-to-staging plus same-volume rename only after the complete build exists.
The server reads the current pointer when serving the shell. A shell can
therefore reference only a complete build. The previous pointer and build are
retained for rollback.

Repository `DATA` and `TEST_DATA` are not labeled immutable application assets.
They retain their existing bounded runtime behavior and are not copied into a
build merely to acquire a misleading immutable identity.

### URL and caching model

The one canonical application URL is `/`.

`/app` and `/<legacy-entry-file>` return permanent-compatible redirects to `/`.
They must not serve independent shells and cannot drift into another build.

The shell and current-build diagnostic responses use:

`Cache-Control: no-store, no-cache, must-revalidate, max-age=0`

plus `Pragma: no-cache` and `Expires: 0`.

Versioned assets use:

`/assets/<FrontendBuildId>/<relative-path>`

and:

`Cache-Control: public, max-age=31536000, immutable`

The build ID makes each mutable deployment URL unique. Manual query parameters,
hard refreshes, cache clearing, and emergency routes are not part of normal
operation.

### Browser diagnostics and mismatch recovery

The shell exposes `FrontendBuildId`; the running browser exposes
`LoadedFrontendBuildId`. The browser also fetches the no-store current-build
diagnostic after startup and when the Platform viewer opens.

If the IDs differ, the browser performs at most one automatic navigation to
`/?build-recovery=<expected-id>`. The query value is diagnostic loop
suppression, not asset versioning. If the mismatch remains, the application
shows a clear mixed-build error and does not loop.

Diagnostics include:

- served `FrontendBuildId`;
- `LoadedFrontendBuildId`;
- publication timestamp;
- LIVE API contract version;
- LIVE readiness state.

They appear in the existing Platform metadata/diagnostic area without
cluttering normal tables.

### Rollback

Rollback atomically restores the previous release pointer. Because every shell
references assets inside its own retained build directory, rollback restores a
complete shell/asset set. Deleting the current build is prohibited until after
the pointer has moved and rollback qualification has passed.

## LIVE timestamp truth model

### SnapshotAsOf

The timestamp represented by the ERP data in the active SQL snapshot. It
changes only after genuine source extraction, validation, transactional SQL
import, and qualified promotion. A metadata-only check never changes it.

For the existing model, the committed base `platform.ImportRun.CompletedAtUtc`
is the initial authoritative value. The status row persists the same value
explicitly for future contracts.

### SourceCheckedAt

The completion time of the most recent successful comparison of every approved
source indicator against the currently qualified source state.

It changes after a successful unchanged-source metadata check or a successful
full extraction. It does not change when an indicator differs or a source
check fails.

### QualificationCompletedAt

The completion time of the full governed qualification and qualified-boundary
promotion for the active snapshot. It changes only after that complete path
succeeds.

### Snapshot identity

`ImportRunId`, mirror run ID, and package hash identify the active snapshot.
They never change after a metadata-only no-change check.

### Source-check provenance

The status record also retains:

- last source-check result;
- deterministic SHA-256 of the normalized approved indicator set;
- last full extraction run ID;
- whether the last full extraction was explicitly force-full.

The indicator fingerprint is a hash of metadata evidence, not a VPro record
fingerprint and not a byte hash of source files.

## Persistence contract

A narrowly scoped `platform.LiveSnapshotOperationalStatus` singleton row is the
qualified store. It is created by a versioned SQL migration and exposed to the
LIVE API through a SELECT-only `liveapi` view.

The initial migration backfills:

- `SnapshotAsOf` from the current committed import completion;
- `QualificationCompletedAt` from the current protected qualified boundary or
  completed full-refresh evidence;
- `SourceCheckedAt` from the current qualified source-state timestamp;
- the current snapshot identities without changing them.

Normal no-change refresh updates only the source-check columns in one SQL
transaction after all approved indicators match. Full promotion updates the
complete row in the existing governed transaction/promotion boundary.

The LIVE API identity receives SELECT only. The refresh/import identity receives
only the narrowly required status-update permission. No browser endpoint writes
this table directly.

## Readiness states

The API retains backward-compatible `readinessVerdict` values `Ready` and
`NotReady`, and adds an explicit `readinessState`.

Ready states:

- `ReadyFresh`: snapshot and source check are within warning thresholds.
- `ReadySourceRechecked`: snapshot exceeds its warning age, but the source was
  recently checked and all indicators remain unchanged.
- `ReadyWithStaleSnapshotWarning`: the snapshot is old and the source check
  exceeds its warning threshold but not its hard expiration.

Hard-not-ready states:

- `NotReadySourceChanged`
- `NotReadySourceCheckExpired`
- `NotReadyContractMismatch`
- `NotReadyPackageMismatch`
- `NotReadySqlMismatch`
- `NotReadyQualificationFailure`
- `NotReadyRuntimeFailure`

Snapshot age alone is never a hard-not-ready condition.

Structural checks remain hard requirements: environment, database, contract,
active ImportRunId, mirror run ID, package hash, entity counts, SQL access,
runtime identity, schema, and startup boundary.

## Threshold policy

Defaults are explicit configuration and validated on startup:

- snapshot warning age: 24 hours;
- source-check warning age: 24 hours;
- source-check hard expiration: 72 hours;
- full-qualification warning age: 7 days.

Rationale: DLE does not intend to run the expensive full extraction daily; the
approved metadata comparison is sub-second; a three-day hard source-check
window tolerates weekends and short outages while preventing an indefinitely
unverified operational snapshot; and a seven-day qualification warning makes
periodic full qualification visible without confusing it with source currency.

There is no age-only hard expiration for `SnapshotAsOf` or
`QualificationCompletedAt`. A changed source, expired source check, or
structural failure is hard-not-ready.

Validation requires:

`0 < snapshot warning <= source-check hard expiration`

`0 < source-check warning < source-check hard expiration`

and all values must fit bounded integer minutes.

## Source-check behavior

Normal refresh reads only filesystem metadata for the exact approved paths and
compares path, existence, length, UTC last-write timestamp, and any previously
approved identity indicator.

If unchanged:

- update only `SourceCheckedAt`, source-check result, and indicator fingerprint;
- record `NO_SOURCE_CHANGES`;
- preserve `SnapshotAsOf`, `QualificationCompletedAt`, ImportRunId, mirror run
  ID, and package hash;
- record zero VPro record opens, zero SQL import, and zero package promotion.

If any indicator changed:

- do not record a successful `SourceCheckedAt`;
- record full extraction required;
- preserve the prior active snapshot;
- invoke the existing governed full extraction in normal mode;
- never mark the old source state recently unchanged.

If the technical check fails, the successful timestamp remains unchanged and
bounded failure evidence is retained.

Force-full remains an explicit operator-only switch. It bypasses only the
metadata no-change early return and executes all extraction, validation,
transaction, rollback, package, boundary, restart, and readiness gates.

Invoice History refresh remains independent and cannot alter these base LIVE
timestamps.

## API contract and UI wording

Readiness and snapshot metadata add:

- `readinessState` and `readinessReason`;
- `snapshotAsOfUtc` and `snapshotAgeSeconds`;
- `sourceCheckedAtUtc` and `sourceCheckAgeSeconds`;
- `qualificationCompletedAtUtc` and `qualificationAgeSeconds`;
- source-change status;
- warning and hard-failure arrays;
- snapshot identities and API contract version.

Existing fields, including `snapshotTimestampUtc`, remain during compatibility
and equal `snapshotAsOfUtc`.

The viewer remains usable for every Ready state. It displays exact timestamps
and truthful wording such as:

`Ready — ERP source checked recently; data snapshot is unchanged.`

or:

`Ready with warning — data snapshot is older than preferred; ERP source was
checked and remains unchanged.`

Only hard-not-ready states replace data access with a blocking status. The UI
never describes a snapshot as real-time.

## Failure and rollback

Metadata failure, changed indicators, failed full extraction, SQL failure, and
publication failure preserve the prior snapshot and build.

No failure path updates a success timestamp. No rollback fabricates freshness.
The prior release pointer, status row, package slots, qualified boundary,
ImportRunId, and package hash are captured before mutation and restored
atomically or transactionally as appropriate.

Exact-origin CORS remains `http://dle-os-host:5041`. Authentication,
least-privilege identities, read-only API behavior, and the no-write `X:`
boundary remain unchanged.

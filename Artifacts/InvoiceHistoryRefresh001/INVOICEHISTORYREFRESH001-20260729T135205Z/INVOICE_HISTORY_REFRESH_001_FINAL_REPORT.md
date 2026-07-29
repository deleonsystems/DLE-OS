# INVOICE-HISTORY-REFRESH-001 final report

Final verdict: `PASS`

## Outcome

Invoice History now has an independent, governed 45-day routine refresh.
Source extraction runs non-elevated as `DLE-OS-HOST\DLE-OS`; every VPro open
uses `MODE="O_RDONLY"`. SQL consumes only a validated local package and
performs a transactional natural-key upsert.

The new Windows-authenticated control is available only in the live Invoice
History viewer and remains separate from the existing full ERP Snapshot
Refresh.

## Bounded source result

- Window: `2026-06-15` through `2026-07-29`
- ART-03 examined/selected: `19,446 / 38`
- ART-13 records read/selected: `219 / 219`
- Full qualified ART-13 population: `79,003`
- Exact ART-13 key probes: `38,000`
- Qualified source elapsed: `4.465 seconds`
- Final acceptance source elapsed: `4.212 seconds`
- Full ART-13 scan: `No`
- Source writes: `0`
- Source locks: `0`

## Routine refresh result

Final result: `NO_SOURCE_CHANGES`

- Physical headers: 38
- Physical lines: 219
- Canonical headers: 38
- Canonical report lines: 50
- Header inserts/updates/unchanged/missing: `0 / 0 / 38 / 0`
- Line inserts/updates/unchanged/missing: `0 / 0 / 50 / 0`
- Invoice History base ImportRunId:
  `5D34047A-8D69-4839-89A9-70658A3DB6EE`
- Refresh-run audit ID:
  `82b3362b-ee60-4970-9726-17f7dc665492`
- Package SHA-256:
  `3322BC6B0167A6DC3A3BE2281D68F8F36FC99FAB6372CE865986CD3E03E35AA3`

## Safety and transaction qualification

- Concurrency: PASS; overlapping API trigger returned `ALREADY_RUNNING`.
- Induced transaction failure: PASS; the complete transaction rolled back.
- Promotion/restoration: PASS; one controlled update committed and the
  original value was restored with baseline counts/checksum unchanged.
- Missing-row retention: PASS; the row remained active and the result was
  `SUCCESS_WITH_CLARIFICATIONS`.
- Identical import: PASS, no-op without row rewrites.
- Active dataset retained on every failure.
- No hard delete was implemented.

## Full reconciliation

The separate deliberate local reconciliation compared the qualified full
baseline package with active SQL:

- CustomerInvoice: 19,092, zero missing/extra/mismatched
- CustomerInvoiceLine: 26,036, zero missing/extra/mismatched
- SQL access: SELECT-only
- Source access: none
- Mutation: none

## Deployment and runtime

- UAC deployment: PASS
- Old port-5043 PID: 14804
- Intermediate PIDs: 12404 and 20032
- Final port-5043 PID: 3364
- Runtime identity: `DLE-OS-HOST\DLE-OS`
- Runtime assembly SHA-256:
  `06A05F18C2EE8F3DA7356558802CC80D160FEAECE2FF775B9B0925B47D2BE3D7`
- Ports 5041, 5042, 5043, and 5044: listening
- Historical API: Ready
- LIVE API: Ready
- Existing ERP refresh: `NO_SOURCE_CHANGES`
- Invoice History refresh: `NO_SOURCE_CHANGES`

The ERP regression exposed and repaired a pre-existing elevated-child launch
defect. The ERP runner itself was not changed; only its control-host handoff
and the operator's least-privilege access to its State directory were
corrected.

## Authentication and browser acceptance

- Authorized Windows request: HTTP 200/202
- Anonymous request: HTTP 401
- Overlap: HTTP 409
- Exact-origin credentialed CORS: PASS
- Unapproved origin: no CORS allow headers
- Six viewer sections: PASS
- Invoice History rows: 26,036
- Known sample: PASS
- Refresh button running/disabled/final states: PASS
- Existing ERP control remained separate: PASS

## Automated regression

- Invoice History refresh: 43 assertions passed
- Invoice History frontend: 26 assertions passed
- Existing Live Snapshot Refresh: 10 regression groups passed
- JavaScript syntax: PASS
- PowerShell parse: PASS
- Control-host Release build: PASS, zero warnings and zero errors

No VPro or `X:` write, lock, drive remapping, UNC substitution, SQL
full-table replacement, API write endpoint, schedule, or service was added.

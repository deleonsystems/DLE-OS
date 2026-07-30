# Receiving History Test Results

## Passed before the source stop

- JavaScript syntax: pass.
- Python syntax: pass.
- PowerShell parser checks: pass.
- Receiving History frontend client/viewer test: pass.
- Purchase Order frontend regression: pass.
- Platform 002 frontend regression after scoping its Sales Order assertion:
  23 assertions pass.
- Platform 003 viewer regression updated for the intentional tenth tab:
  40 tests pass.
- Invoice History frontend regression: pass (26 assertions).
- Customer Master frontend regression: pass (31 assertions).
- Vendor Master frontend regression: pass.
- Server source compile in fresh mission output: pass, 0 warnings, 0 errors.
- Supervised process cleanup: pass, 0 remaining.
- Read-only source boundary: pass.
- Cross-pass row stream: pass for all 228,836 physical records per pass.

## Superseded source-identity result

- Cross-pass FIN identity: fail for `POT-04` and `POT-14`.

That result belongs to the rejected pass pair. The later accepted attempt
`RECEIVING_HISTORY_PLATFORM_001_POLICY-20260730T050803031Z-14EAF6C9`
passed the approved identity policy and all semantic two-pass checks.

## Date-decode continuation

- DDM physical-field lookup: pass (`POT-04A090`, type `D`, length 6).
- Program lineage from `POE-04` to `POT-04`: pass.
- ERP formatter rule (`YY21MMDD`): pass.
- Representative values from 1999, 2000, 2005, 2010, 2013, 2019, and 2026:
  consistent.
- `OrderDateRaw=311029` cardinality: 2.
- Additional out-of-horizon Order Date values: 3.
- Snapshot horizon rejection: pass/fail-closed.
- Intended historical date for `311029`: not proven.

No decoder change was made, so change-acceptance unit tests were not added or
run. Package, SQL, API HTTP, permissions, rollback/no-op, deployment, and
browser tests remain downstream of the unresolved source-data date.

## Authorized malformed-source-date policy

The later authorization added a generic result policy without changing YY21
decoding:

- focused date policy tests: 4/4 pass
- frontend raw/status/reason assertions: pass
- Python syntax: pass
- PowerShell importer parser: pass
- exact expected malformed count gate: pass in focused test
- unexpected sixth malformed value: rejected in focused test
- value-specific hard coding: absent

The candidate build then stopped at the existing nonblank natural-key guard
for header `01000174       0030511`. Package-dependent, SQL, HTTP, permissions,
deployment, and browser tests were not run.

## Missing-PO continuation

- Full retained population cardinality scan: pass.
- Exact blank-PO header count: 1.
- Exact blank-PO line count: 1.
- Receiver `0030511` uniqueness: pass globally, within Firm, and within
  Firm + Vendor.
- Related rejection cardinality: 0.
- Exact source-key preservation design: pass.
- Null canonical PO and `MissingRequiredSourceValue` projection: implemented.
- Blank-PO count gate: focused test pass; zero or two rejected.
- Duplicate source-identity gate: focused test pass.
- PO reconciliation exclusion: implemented and covered by package test.
- Frontend API-client/detail-status test: pass.
- Python syntax: pass.
- PowerShell importer parser: pass.

The full candidate build progressed beyond the blank-PO record and failed
closed on the newly exposed `ReceiptDateRaw=D01129`. A complete retained scan
found 1 out-of-horizon Receipt Date and 26 out-of-horizon Required Dates.
Because those fields are outside the authorized five-record malformed Order
Date policy, package-dependent tests, SQL import/no-op/rollback, HTTP tests,
deployment, and browser acceptance were not run.

## Additive date-quality continuation

- Physical-field and formatter verification: PASS.
- Field-specific focused policy tests: 5/5 PASS.
- Full package tests: 19/19 PASS.
- Receiving History frontend test: PASS.
- Purchase Order frontend regression: PASS.
- Invoice History frontend regression: PASS (26 assertions).
- Customer Master frontend regression: PASS (31 assertions).
- Vendor Master frontend regression: PASS.
- Platform 002 regression: PASS (23 assertions).
- Platform 003 regression: PASS (40 tests).
- Fresh Release API build: PASS, 0 warnings, 0 errors.
- Schema application to `DLE_OS_CANONICAL_LIVE`: PASS.
- Transactional import: PASS.
- Identical re-import: NO-OP.
- Induced-failure rollback: PASS.
- Importer and live API SQL permissions: PASS.

## Post-deployment qualification

- Governed UAC deployment: PASS.
- Receiving History HTTP qualification: 30/30 PASS.
- Receiving History package tests: 19/19 PASS.
- Receiving History frontend test: PASS.
- Purchase Order frontend regression: PASS.
- Invoice History frontend regression: PASS (26 assertions).
- Customer Master frontend regression: PASS (31 assertions).
- Vendor Master frontend regression: PASS.
- Platform 002 regression: PASS (23 assertions).
- Platform 003 regression: PASS (40 tests).
- Live Viewer regression: PASS (15 tests).
- In-app ten-section browser acceptance: PASS.
- Malformed Receipt Date browser detail: PASS.
- Malformed Required Date browser detail: PASS.
- Blank-PO orphan browser detail: PASS.
- Exact-origin CORS and arbitrary-origin denial: PASS.
- GET-only/read-only behavior: PASS.

The Live Viewer regression's qualified ImportRunId expectation was advanced
from the prior snapshot to the current protected platform boundary
`27f0ed25-adcc-46aa-96f4-f0cc7d6ae8b6`; the test then passed 15/15.

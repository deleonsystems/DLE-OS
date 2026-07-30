# RECEIVING-HISTORY-PLATFORM-001 Final Report

Verdict: **PASS**

## Qualified source boundary

The accepted two-pass qualification is
`RECEIVING_HISTORY_PLATFORM_001_POLICY-20260730T050803031Z-14EAF6C9`.
The prior rejected pass pairs remain rejected evidence and were not reused.

- POT-03 rejections: 0
- POT-04 headers: 39,564
- POT-14 lines: 189,272
- source mode: `O_RDONLY`
- source writes: 0
- source locks: 0
- source mutations: 0

All continuation work used retained local qualification evidence. No new
source extraction or access beneath `X:` occurred.

## Canonical package

- Package SHA-256:
  `84A4267E17412B373DC8868B98C1775134ED497FF1A5EF4EB2930BA4B9CC492E`
- Header natural-key duplicates: 0
- Line natural-key duplicates: 0
- Orphan lines: 0
- Header-only histories: 4
- Blank-PO source records: 1 header / 1 line
- Malformed Order Dates: 5
- Malformed Receipt Dates: 1
- Malformed Required Dates: 26

The three date fields preserve raw values independently. Structurally valid
out-of-horizon dates have a null canonical date, explicit
`InvalidSourceValue` status, and a bounded reason. No replacement dates were
inferred. The exact baseline counts fail closed if they expand.

The one blank-PO record is retained with a null canonical PO,
`MissingRequiredSourceValue`, and its exact source identity. No placeholder
or synthetic natural key was introduced.

## SQL qualification

Only `DLE_OS_CANONICAL_LIVE` was modified.

- Receiving History ImportRunId:
  `034f0f72-8713-4163-b20d-fb9d421a7961`
- Initial transactional import: PASS
- Imported headers / lines / rejections: 39,564 / 189,272 / 0
- Identical re-import: `NO-OP`
- Induced-failure rollback: PASS
- Importer role: approved data replacement rights only; no
  alter/control/unauthorized execute
- LIVE API identity: SELECT-only viewer/metadata access; writes denied

## Deployment and HTTP acceptance

The governed UAC deployment passed. Deployment evidence is
`RECEIVING_HISTORY_DEPLOYMENT_20260730T114301Z.json`.

- Historical runtime: port 5041, PID 25672
- LIVE API: port 5042, PID 11596
- LIVE API identity: `DLE-OS-HOST\DLE-OS-LIVE-API`
- Control host / promotion broker: ports 5043 / 5044
- Frontend build: `20260730T114315Z-5AB304D3E33F`
- LIVE readiness: `Ready` / `ReadyFresh`
- Qualified platform ImportRunId:
  `27f0ed25-adcc-46aa-96f4-f0cc7d6ae8b6`

Receiving History HTTP qualification passed 30 assertions. Metadata, list,
detail, filtering, pagination, malformed dates, blank PO, invalid parameters,
GET-only behavior, exact-origin CORS, route isolation, and restricted-field
absence all passed. Metadata/list latency measured 26.83 ms / 698.78 ms.

## Browser acceptance

The in-app browser verified all ten Platform Viewer sections. Receiving
History loaded 189,272 records. Malformed Receipt and Required Dates displayed
as unavailable with raw/status/reason traceability. The blank-PO orphan
remained blank and displayed its explicit missing-source status. Existing
Platform counts and the refresh control remained intact.

## Remaining clarifications

- Negative receipt postings remain preserved exactly but cannot be
  distinguished reliably as returns versus corrections/reversals.
- Received-by employee identity and complete inspection/lot detail are not
  available from retained receipt history.
- Four genuine header-only receipt histories are retained without synthetic
  lines.

No VPro or `X:` write occurred.

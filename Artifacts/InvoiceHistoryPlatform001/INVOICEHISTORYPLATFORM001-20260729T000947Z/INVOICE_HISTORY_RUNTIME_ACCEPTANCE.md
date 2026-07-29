# Invoice History runtime acceptance

Verdict: `PASS`

## Governed deployment

- Deployment evidence:
  `C:\DLE-OS\Repositories\DLE-OS-Server\Artifacts\InvoiceHistoryPlatform001\deployment-evidence.json`
- Deployed UTC: `2026-07-29T03:16:13.2279344+00:00`
- Publish run: `LIVEAPI001-PUBLISH-20260729T031608Z`
- Runtime owner: `DLE-OS-HOST\DLE-OS-LIVE-API`
- LIVE API PID: `19148`
- Historical API PID: `3096`
- Refresh control PID: `4`
- Promotion broker PID: `4`
- Readiness: `Ready`
- Contract: `1.2`

## Invoice History metadata

- ImportRunId: `5d34047a-8d69-4839-89a9-70658a3db6ee`
- Package SHA-256:
  `DA7EDC4C540750318A2AA73A938F14B5B820A7B482DAB2B29C94CE8555046DA8`
- Headers: `19,092`
- Lines: `26,036`
- Unique Work Orders: `16,465`
- Unresolved Work Orders: `9,466`
- Ambiguous Work Orders: `105`
- Negative quantities: `415`

## HTTP qualification

All calls used the deployed LIVE API on port 5042.

| Check | Result |
|---|---|
| Readiness | HTTP 200 / Ready |
| Metadata | HTTP 200 |
| Default page | 25 rows returned from 26,036; 138 ms |
| Invoice date 2016-03-25 | 2 rows; 33 ms |
| Customer 1148 | 6,510 rows; 52 ms |
| Invoice 169292 | 1 row; 51 ms |
| Sales Order 9422 | matched; exact server filter |
| Item 277-4169 | matched; exact server filter |
| Work Order 111450 | 1 row; 59 ms |
| Combined known sample | 1 row; 66 ms |

Existing route counts remained readable: BOM 1,290; Inventory 28,662; Work
Orders 12,113; GL 257; Sales Orders 105. The Sales Order count reflects the
currently active qualified live snapshot and was not changed by Invoice History
deployment.

The protected refresh-control endpoint returned its Windows-authentication
challenge to the non-interactive qualification host. The promotion broker
listener remained bound. The deployment wrapper independently proved that both
preserved processes retained their original PIDs.

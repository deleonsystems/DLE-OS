# INVOICE-HISTORY-PLATFORM-001 final report

## Verdict

`PASS`

The qualified Invoice History baseline is deployed through the governed LIVE
publisher, served by the dedicated read-only identity, and accepted through
the DLE-OS browser. The existing five Platform Viewer sections and the existing
ERP snapshot refresh operation remain intact.

## Qualified dataset

- Source lines: 26,036
- Imported headers: 19,092
- Imported lines: 26,036
- Invoice History ImportRunId:
  `5D34047A-8D69-4839-89A9-70658A3DB6EE`
- Package SHA-256:
  `DA7EDC4C540750318A2AA73A938F14B5B820A7B482DAB2B29C94CE8555046DA8`
- Natural-key duplicates: 0
- Orphans: 0
- Work Orders: 16,465 Unique; 9,466 Unresolved; 105 Ambiguous
- Manufacturing: 16,465 HistoricalReconstructed; 6,389
  CurrentMasterResolved; 3,182 Unavailable
- Negative quantities: 415
- Known sample:
  `001148 / 0169292 / 0009422-030 / 277-4169 / 0111450`

## Deployment and runtime acceptance

- UAC/elevation: accepted
- Governed deployment verdict: PASS
- Publish run: `LIVEAPI001-PUBLISH-20260729T031608Z`
- Published assembly SHA-256:
  `A81A6667629D66A03CE4258A8EB2ECE9E687380D32A844D881CD7CF91488CD8F`
- Historical API: port 5041, PID 3096, Ready
- LIVE API: port 5042, PID 19148, Ready
- LIVE runtime owner: `DLE-OS-HOST\DLE-OS-LIVE-API`
- Refresh control: port 5043, PID 4, protected endpoint reachable
- Promotion broker: port 5044, PID 4, listener preserved
- Runtime rollback backup:
  `C:\DLE-OS\Repositories\DLE-OS-Server\Artifacts\InvoiceHistoryPlatform001\RuntimeBackup\20260729T031603Z`

The deployment wrapper was corrected to accept both structured PowerShell
objects and JSON text from the existing approved stop/publish/start scripts.
Before that correction, normal publisher output caused `ConvertFrom-Json` to
misclassify a successful launcher handoff and could mask the original error
during rollback. The startup gates, publisher, launcher, identity checks,
runtime backup, and rollback design were not weakened.

## HTTP and browser acceptance

- Metadata route: HTTP 200; 19,092 headers and 26,036 lines
- Data route: HTTP 200; bounded default retrieval and server paging
- Date, customer, invoice, Sales Order, item, and Work Order filters: PASS
- Unpadded numeric identifier normalization: PASS
- Known sample: exactly one row and Work Order `0111450`
- Negative quantity and price signs: preserved
- Unresolved Work Orders: null and labeled `Unresolved`
- Ambiguous Work Orders: null and labeled `Ambiguous`
- Current-master manufacturing data: labeled `CurrentMasterResolved`
- Invoice History ImportRunId and package hash: visible in record detail
- Six viewer sections: visible and load successfully
- Existing refresh button: present and unchanged
- Exact-origin CORS: allowed only for `http://dle-os-host:5041`

## Regression and safety

- Automated suites: 69/69 PASS
- Release build: 0 warnings, 0 errors
- Existing five Platform Viewer sections: PASS
- Historical API remained Ready
- Existing refresh pipeline was not modified and does not include Invoice
  History
- No write endpoint was added
- No access to or write beneath `X:` occurred
- No VPro extraction or source qualification was repeated

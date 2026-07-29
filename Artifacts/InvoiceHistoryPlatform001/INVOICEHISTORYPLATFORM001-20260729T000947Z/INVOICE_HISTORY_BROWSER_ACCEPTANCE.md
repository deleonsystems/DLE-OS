# Invoice History browser acceptance

Verdict: `PASS`

Acceptance was completed against the deployed DLE-OS runtime at
`http://DLE-OS-HOST:5041/` and the dedicated-identity LIVE API at
`http://DLE-OS-HOST:5042/`.

Verified:

- Workspace View -> Platform exposes the existing Test Data viewer and the
  separate Live Snapshot viewer.
- The Live Snapshot viewer shows six sections: Work Orders, Inventory Items,
  Bills of Material, General Ledger Accounts, Sales Orders, and Invoice
  History.
- All six sections loaded a visible read-only table without an API or CORS
  error.
- Invoice History default retrieval showed 50 of 26,036 records and remained
  server-paged.
- The combined unpadded filter set `1148 / 169292 / 9422 / 277-4169 / 111450`
  plus date `2016-03-25` returned exactly the qualified sample:
  `001148 / 0169292 / 0009422-030 / 277-4169 / 0111450`.
- The record detail showed Invoice History ImportRunId
  `5d34047a-8d69-4839-89a9-70658a3db6ee` and package SHA-256
  `DA7EDC4C540750318A2AA73A938F14B5B820A7B482DAB2B29C94CE8555046DA8`.
- Invoice `0156460`, line `080`, retained quantity `-1` and extended price
  `-797.45`.
- Invoice `0163605`, line `010`, displayed a null Work Order, resolution
  `Ambiguous`, candidate count `2`, and manufacturing source
  `CurrentMasterResolved`.
- Invoice `0167891`, line `010`, displayed a null Work Order and resolution
  `Unresolved`.
- The existing `Run ERP Snapshot Refresh` button remained present. Its status
  remained `NO_SOURCE_CHANGES`; no Invoice History operation was added to it.
- The LIVE SOURCE SNAPSHOT - READ ONLY warning remained unavoidable.

Exact-origin CORS qualification:

- Allowed origin `http://dle-os-host:5041`: HTTP 204 with
  `Access-Control-Allow-Origin` set to the exact origin.
- Unapproved origin `http://evil.invalid`: HTTP 204 without an
  `Access-Control-Allow-Origin` header.

Local screenshots:

- `INVOICE_HISTORY_BROWSER_ACCEPTANCE.png`
- `INVOICE_HISTORY_BROWSER_ACCEPTANCE_VIEWER.png`

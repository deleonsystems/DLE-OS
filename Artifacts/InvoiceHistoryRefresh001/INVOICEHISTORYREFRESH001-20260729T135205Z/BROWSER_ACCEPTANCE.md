# Browser and HTTP acceptance

Verdict: `PASS`

## Windows authentication and CORS

The control host was exercised from the signed-in non-elevated
`DLE-OS-HOST\DLE-OS` desktop and from the DLE-OS browser origin.

- Authorized status: HTTP 200
- Authorized trigger: HTTP 202
- Overlapping trigger: HTTP 409, `ALREADY_RUNNING`
- Anonymous status: HTTP 401
- Authorization policy: exact `DLE-OS-HOST\DLE-OS` allowlist
- Allowed CORS origin: `http://dle-os-host:5041`
- Allowed-origin preflight: HTTP 204 with the exact origin and credentials
- `http://example.invalid`: HTTP 204 without any CORS allow-origin or
  allow-credentials header
- Wildcard origin: not configured

No separate authenticatable unauthorized Windows test account was created.
Authenticated unauthorized identities are rejected by the same exact
allowlist policy covered by the automated control-host regression.

## Invoice History control

Location:

`Workspace View → Platform → Canonical Data Viewer — Live Snapshot → Invoice History`

The browser proved:

- `Refresh Invoice History` is visible only in the live Invoice History
  section.
- It is separate from `Run ERP Snapshot Refresh`.
- Confirmation is required.
- The button disables while the routine refresh runs.
- The viewer table is not automatically reloaded.
- Final status displays `No Source Changes`.
- Window start/end display `2026-06-15` and `2026-07-29`.
- The displayed refresh run is
  `INVOICEHISTORYREFRESH-20260729T163226Z-862B03E3`.
- Invoice History remains at 26,036 lines.

The final HTTP qualification observed:

- 38 candidate headers, all `Unchanged`
- 50 candidate canonical lines, all `Unchanged`
- 0 inserts
- 0 updates
- 0 missing rows
- package SHA-256
  `3322BC6B0167A6DC3A3BE2281D68F8F36FC99FAB6372CE865986CD3E03E35AA3`

## Viewer regression

All six sections loaded:

| Section | Current rows |
| --- | ---: |
| Work Orders | 12,113 |
| Inventory Items | 28,662 |
| Bills of Material | 1,290 |
| General Ledger Accounts | 257 |
| Sales Orders | 105 |
| Invoice History | 26,036 |

Known sample filtering returned exactly one row:

`001148 / 0169292 / 0009422-030 / 277-4169 / 0111450`

The LIVE readiness metadata remained `Ready`, contract 1.2, and canonical
total 42,322. The historical API remained `Ready`.

The final screenshot is `BROWSER_ACCEPTANCE_FINAL.png`.

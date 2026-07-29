# Invoice History baseline extraction report

Verdict: `PASS`

Source extraction run:
`INVOICEHISTORYPLATFORM001-20260729T001740Z`

Package schema: `DLE_INVOICE_HISTORY_BASELINE_V1`

The governed builder used the current two-pass O_RDONLY projection qualified
under `INVOICEHISTORY001-20260728T233255Z`. Before and after package/import
work, ART-03 and ART-13 retained the exact qualified file identities:

| Source | Bytes | SHA-256 |
|---|---:|---|
| ART-03 | 4,809,216 | `2C74E6FE76D5FA6C7506AB7839CEFA32E9C9E60E03356660B80DD4A02B56B9CF` |
| ART-13 | 22,113,792 | `300266F4C955C9DBF2857E598C2D8F5429EEBA64D8A0637269014AE438C9AEC2` |

ART-13 qualified decoded fingerprint:
`9A03310D6A26CEBDDA3C81D0674F98F3641F7E63876665883327C4249D7EC92D`.

The source identities did not advance, so the qualified current projection
remained 26,036 lines. The package contains 19,092 headers and 26,036 lines.
It passed schema, key, date, decimal, enum, status/cardinality, orphan, and
known-sample validation.

Package content SHA-256:
`DA7EDC4C540750318A2AA73A938F14B5B820A7B482DAB2B29C94CE8555046DA8`

Candidate:
`C:\DLE-OS\Canonical\InvoiceHistory\Candidate`

No report was executed. No write or lock was requested beneath X:.

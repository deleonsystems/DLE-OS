# Bounded source retrieval qualification

Mission: `INVOICE-HISTORY-REFRESH-001`

Verdict: `PASS`

## Execution boundary

- Windows identity: `DLE-OS-HOST\DLE-OS`
- Token: non-elevated
- Source root: existing mapped `X:`
- Approved files: `X:\AON\ADATA\ART-03` and `ART-13`
- VPro open mode: `MODE="O_RDONLY"` on every source open
- Window: `2026-06-15` through `2026-07-29` (45 days inclusive)
- No drive remapping, UNC substitution, report execution, source copy, lock,
  or source write occurred.

The successful reusable run was:

`INVOICEHISTORYREFRESH-20260729T144540Z-0E301F3A`

## Proven retrieval method

`ART-03` has no invoice-date alternate key. The reader performs one ordered
read of the small header file, decodes the qualified invoice date, and selects
non-void headers inside the overlap window.

For each selected header, `ART-13` is accessed by complete qualified keys. The
line suffix is a three-digit numeric sequence but is not restricted to
multiples of ten. The reader therefore enumerates the exact keys `000` through
`999` beneath each selected invoice prefix and performs
`READ RECORD(..., KEY=..., DOM=...)`.

This is not a sequential or full-history `ART-13` scan. Missing exact keys
return through `DOM`; only matching records are decoded.

Two rejected probe iterations are retained under `Attempts`:

1. A partial 17-byte key seek returned zero lines because it was not a complete
   qualified key.
2. Probing only the `000` suffix returned zero lines because qualified line
   suffixes are distributed across 169 distinct three-digit values.

These were reader-tool defects, not source-access failures. Neither attempted
a write or lock.

## Measured result

| Metric | Result |
| --- | ---: |
| ART-03 records examined | 19,446 |
| ART-03 headers selected | 38 |
| ART-03 bytes processed | 4,122,552 |
| ART-13 exact key probes | 38,000 |
| ART-13 records examined | 219 |
| ART-13 records selected | 219 |
| ART-13 bytes processed | 53,436 |
| Full ART-13 records in prior qualification | 79,003 |
| Successful source phase elapsed | 4,465 ms |
| Routine canonical headers | 38 |
| Routine canonical report lines | 50 |

The 219 physical line records include 127 non-report line codes and 42
zero-quantity lines. Those 169 records are validated and filtered according to
the frozen report contract, leaving 50 canonical Invoice History lines.

`ART-13` scope was reduced from 79,003 physical records to 219 matching
records (99.72% fewer record reads). The 38,000 exact-key probes are bounded
key lookups, not decoded record reads.

## Selected-population fingerprints

The fingerprint frames are ordered UTF-8 text and are logical record-stream
fingerprints, not physical-file byte hashes.

- Raw: `key_hex|record_hex\n`
- ART-03 decoded:
  `key_hex|a0_hex|numeric_values|invoice_date_number\n`
- ART-13 decoded:
  `key_hex|w0_hex|w1_hex|numeric_values\n`

| Population | Ordered raw SHA-256 | Ordered decoded SHA-256 |
| --- | --- | --- |
| ART-03 selected headers | `E09621545820ED965C49E5DFAB4AE55B06CEFCAF1F0DAE1F70D9DF8AFF962E08` | `306D7EFC411B315C2C738BDC3AB24B13C637F2DA67A3994E91F3F8B0AC4D582A` |
| ART-13 selected lines | `F2CFD8C843F98E25159C19220B28DFC875B52B7689F86455EE762123B62782C5` | `8C5890663E220680EFFFA8A5FB8F38517AA31102574898CFF132DA2FD71EEB91` |

The final extraction output hashes were:

- `BOUNDED_HEADERS.csv`:
  `8805093E2745885BFE240DA1B4F657AB07EE1FFDDDD28994F52368CCDBE29810`
- `BOUNDED_LINES.csv`:
  `88378CA0BD40D01A2A084A5550F2201F1209C8B84E232BC999E90E41D205F241`
- `BOUNDED_SUMMARY.csv`:
  `58B064E34EE0F4D59E65FE239B40402799713570DE37335F94204D9891517B47`

## Stability and safety

VPro FID and FIN values matched before and after the successful run for both
files. Filesystem identities were stable across the same window. The source
reader requested no locks, and no source mutation was observed.

The VPro process exited normally after writing local output. A PowerShell
waiter retained stale process state after the VPro process had already
disappeared; only that stale PowerShell waiter was stopped. No VPro process,
operator session, report, or ERP user was terminated.

## Conclusion

Routine Invoice History refresh is genuinely feasible. It requires one
bounded-cost header scan plus exact line-key probes for only the headers inside
the 45-day window. It does not read the complete unrelated `ART-13` history.

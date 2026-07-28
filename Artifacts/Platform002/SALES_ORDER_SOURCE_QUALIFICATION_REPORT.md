# PLATFORM-002 Sales Order Source Qualification

Verdict: **PASS**

Final qualification run: `PLATFORM002-20260728T163200Z-SALESORDER4`

The T0 qualifier performed two complete sequential reads of the five fixed live
files. Both live channels used `MODE="O_RDONLY"`. Compiler output, listings,
runtime CSVs, and source-identity evidence were written only beneath
`C:\Add-On\Lab\Platform002\PLATFORM002-20260728T163200Z-SALESORDER4`.

| Source | Full records | Qualified layout | Qualified records |
|---|---:|---|---:|
| ARE-03 | 1,802 | A | 1,802 |
| ARE-13 | 12,074 | A | 12,074 |
| ARM-01 | 380 | A | 380 |
| ARM-10 | 120 | E | 15 |
| WOE-03 | 370,689 | B | 12,108 |

For every source, Pass 1 and Pass 2 matched on FID, FIN, count, first key, last
key, strict key order, ordered key-plus-raw-record fingerprint, ordered decoded
fingerprint, and an independent row-by-row comparison. The logical fingerprint
algorithms are `VPRO_KEY_RAWRECORD_SHA256_V1` and
`VPRO_DECODED_RECORD_SHA256_V1`; neither is described as a physical-file byte
hash.

Static listing inspection found exactly two source-open statements, both
`MODE="O_RDONLY"`, and no write, remove, erase, initialize, lock, unlock, keyed
creation, direct-file, or rename statement. Before/after source length,
last-write time, and attributes were unchanged for all five files. No report,
production program, `SYS.ZA`, or T8 program was run.

Machine evidence: `Qualification/TWO_PASS_STREAM_VALIDATION.json`. The complete
raw pass evidence remains in the governed Lab run directory above.

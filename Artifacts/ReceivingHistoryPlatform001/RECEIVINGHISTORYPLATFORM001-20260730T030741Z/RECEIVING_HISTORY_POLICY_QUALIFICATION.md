# Receiving History Qualification Under Approved FIN Policy

Qualification attempt:
`RECEIVING_HISTORY_PLATFORM_001_POLICY-20260730T050803031Z-14EAF6C9`

Verdict: **PASS**

The attempt ran from `2026-07-30T05:08:03.0392979Z` through
`2026-07-30T05:39:02.9423487Z` (30m 59.9s).

| Source | Pass 1 | Pass 2 | Ordered keys | Decoded key-records |
|---|---:|---:|---|---|
| POT-03 | 0 | 0 | exact | exact |
| POT-04 | 39,564 | 39,564 | exact | exact |
| POT-14 | 189,272 | 189,272 | exact | exact |

Cross-pass FIN differences were confined to the approved process-local
offsets:

- POT-03: offsets 15–17 (`03 3F 49 F0` → `03 43 D4 A0`)
- POT-04: no FIN difference
- POT-14: offset 17 (`03 43 D5 A8` → `03 43 D5 D8`)

Complete FID, all nonvolatile FIN bytes, file length, last-write time,
attributes, counts, key order, first/last keys, and both semantic hashes
matched. Opens were `MODE="O_RDONLY"`; writes and locks were zero; no
mission-owned process remained.

The qualifying hashes are recorded in
`POLICY_QUALIFIED_TWO_PASS_VALIDATION.json`.

## Downstream package gate

Package construction stopped before producing a package. Two POT-04 headers
contain `OrderDateRaw=311029`:

- key `0100007700266390026191`, receipt date raw `B31108`
- key `0100007700266390026233`, receipt date raw `B31111`

The current qualified YY21 decoder would interpret `31` as year 2031, outside
the 2026 snapshot horizon and inconsistent with the November 2013 receipt
dates. Interpreting it as 1931 or silently converting it to null would be an
unsupported guess. The original platform work order requires malformed dates
to reject the package, so no package, SQL import, API, viewer deployment, or
commit followed.

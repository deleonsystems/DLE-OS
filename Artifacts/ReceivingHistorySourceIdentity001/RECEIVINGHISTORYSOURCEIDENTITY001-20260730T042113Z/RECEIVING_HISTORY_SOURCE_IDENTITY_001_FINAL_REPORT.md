# RECEIVING-HISTORY-SOURCE-IDENTITY-001 Final Report

## Verdict

**PASS**

## Finding

Controlled Experiments A–G prove that FIN offsets 14–17 are opaque
Visual PRO/5 process/channel state for the three tested POT sources. They are
not stable file-content identity.

The four bytes:

- stayed exact within every individual source open;
- did not change after zero, one, 100, or all records were read;
- changed across fresh Visual PRO/5 processes;
- could be shared by three different files in one no-read process;
- could change between files after traversal activity in the same process;
- changed while all other FIN bytes, complete FID, filesystem metadata, and
  full semantic streams remained exact.

No undocumented pointer, counter, or cache name is asserted. The supported
classification is `ProcessLocal`.

## Full-read proof

Experiments E and F were independent fresh supervised processes.

| Source | Count | Ordered-key SHA-256 | Ordered key-record SHA-256 |
|---|---:|---|---|
| POT-03 | 0 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |
| POT-04 | 39,564 | `354404CC9A093051FD32DB808D506E18C47E2EF571E1A4BE7E9B3B9F8CBCAC1E` | `4F718D7C8074259F5CE9B706B278BD00C6456A1B478DDB0535A2AD231CA092F7` |
| POT-14 | 189,272 | `9863966526BAC47658F841AF0AFEEC991B8AF95DDD5AF78A365BB7EFA55B5656` | `3D29ACF8903E0794B8ADA3939DE9E6EAD33D5C02C8BC451EF5169383CDAD1F33` |

Counts, first/last keys, key order, and both hashes matched for every source.

## Approved policy

For the three exact POT paths only, cross-pass FIN comparison may exclude
zero-based offsets 14–17. Complete FIN equality is still required within every
individual open. All other physical and semantic controls remain mandatory.

## Safety

All opens were `MODE="O_RDONLY"`. Writes and locks were zero. File length,
creation time, last-write time, and attributes stayed stable. All seven
attempts ended with zero mission-owned processes.

## Tests

The identity-policy suite passed 20/20 tests. Actual E/F FIN pairs passed the
implemented exact-path policy. No global FIN behavior was changed.

## Continuation

The identity gate is nonblocking. `RECEIVING-HISTORY-PLATFORM-001` may continue
only with a completely new two-pass qualification using the approved policy.
Neither rejected pair may be reused.

That continuation was performed with attempt
`RECEIVING_HISTORY_PLATFORM_001_POLICY-20260730T050803031Z-14EAF6C9` and
passed the new identity and semantic gates. Package construction then stopped
on two out-of-horizon `OrderDateRaw=311029` values. The source-identity verdict
remains PASS; the Receiving History platform continuation is blocked at its
independent malformed-date package gate.

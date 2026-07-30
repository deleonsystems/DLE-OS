# Receiving History Baseline Extraction Report

Status: **NOT QUALIFIED**

The supervised extraction read two complete passes:

| Source | Pass 1 | Pass 2 | Key/record stream | Cross-pass FIN |
|---|---:|---:|---|---|
| POT-03 | 0 | 0 | identical | match |
| POT-04 | 39,564 | 39,564 | identical | mismatch |
| POT-14 | 189,272 | 189,272 | identical | mismatch |

Extraction ran from 2026-07-30 03:12:14Z through 03:44:08Z. All opens were
read-only and the harness cleaned up normally.

Because full FIN identity changed between passes, the baseline did not cross
the required stable-source gate. No canonical package, quantity aggregation,
relationship reconciliation, or representative parity result was promoted.

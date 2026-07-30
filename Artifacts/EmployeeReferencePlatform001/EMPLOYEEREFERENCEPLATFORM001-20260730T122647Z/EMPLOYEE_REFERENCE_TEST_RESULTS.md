# Employee Reference Test Results

All executed qualifications passed.

| Suite | Passed | Failed |
|---|---:|---:|
| Reusable VPro harness regression | 30 | 0 |
| Employee package/unit tests | 8 | 0 |
| Employee frontend assertions | 30 | 0 |
| Employee HTTP/API assertions | 24 | 0 |
| Freshness/cache static regression | 42 | 0 |
| Force-full ERP refresh static regression | 19 | 0 |
| Invoice History refresh assertions | 43 | 0 |
| Existing viewer frontend suites | 5 suites | 0 suites |
| SQL identity/read/write/protected-database checks | 12 | 0 |
| Browser section loads | 11 | 0 |

The required 35 categories are covered, including harness configuration/source
contract, natural keys, duplicate rejection, status/null/code behavior,
department and unavailable supervisor relationships, privacy scanners,
allowlist, rollback, no-op, API permissions/pagination/filters, viewer
registration/filter/detail, parity, cross-dataset reconciliation, all ten
existing sections, freshness/build/cache, both refresh systems, CORS, and zero
remaining qualifier processes.

The ARM-10F regression test specifically requires the first record string and
rejects the prior numeric-field expression.

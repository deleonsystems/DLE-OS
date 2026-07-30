# Regression Test Results

Verdict: PASS

| Suite | Passed | Failed |
|---|---:|---:|
| PLATFORM-FRESHNESS-CACHE static contract | 42 | 0 |
| Frontend publication/rollback | 15 | 0 |
| Readiness policy harness | 6 | 0 |
| PLATFORM-003 canonical viewer | 40 | 0 |
| Purchase Order HTTP/CORS regression | 36 | 0 |
| Force-full decision isolation | 6 | 0 |
| Total automated assertions | 145 | 0 |

Additional live checks:

- governed deployment: PASS;
- normal no-change source check: PASS;
- automatic open-tab build upgrade: PASS;
- all-nine browser regression: PASS;
- Platform console errors: 0.

The readiness harness explicitly covered warning-only usability, source-check
expiration, source-changed, and package mismatch. The viewer suite covers no
fallback and hard readiness failure. Deployment failure evidence proves
database/runtime/frontend rollback before the final successful deployment.

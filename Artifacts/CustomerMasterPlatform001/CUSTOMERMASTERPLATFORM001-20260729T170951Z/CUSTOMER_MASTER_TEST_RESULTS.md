# Customer Master Test Results

- Fresh-directory compile gate: PASS
- Bounded startup/output supervision: PASS
- Two-pass source identity/count/key/fingerprint comparison: PASS
- Package count, hash, duplicate, orphan, and restricted-field checks: PASS
- Transactional import: PASS
- Identical re-import: PASS (`NO-OP`)
- Induced-failure rollback: PASS
- API Release build: PASS (0 errors, 0 warnings)
- Customer frontend: 31 assertions PASS
- Customer HTTP/CORS/security/regression: 25 assertions PASS
- Invoice History frontend regression: 26 assertions PASS
- Sales Orders frontend regression: 23 assertions PASS
- LIVE viewer regression: 15 tests PASS
- Browser acceptance: PASS

HTTP latency observed:

- Metadata: 209.28 ms (first qualified call)
- 25-row list: 11.63 ms

Runtime:

- 5041 historical PID 3096, owner `DLE-OS-HOST\DLE-OS`
- 5042 LIVE PID 23140, owner `DLE-OS-HOST\DLE-OS-LIVE-API`
- Refresh control host PID 3364, owner `DLE-OS-HOST\DLE-OS`
- Promotion broker PID 22212, owner `DLE-OS-HOST\DLE-OS`

No VPro or `X:` write occurred.

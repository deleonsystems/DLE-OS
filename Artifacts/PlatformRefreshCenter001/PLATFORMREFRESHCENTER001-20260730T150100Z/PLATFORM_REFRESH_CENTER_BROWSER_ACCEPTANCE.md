# Browser Acceptance

Verdict: `PASS WITH CLARIFICATIONS`

The deployed page was opened at `http://DLE-OS-HOST:5041/`, then navigated through Administration → System Center → Refresh Center.

- Refresh Center visible as an operational System Center region, not a canonical dataset tab.
- Registry `1.0.0`, `Platform: Ready`, and frontend `20260730T151518Z-5B1E030B115F` displayed.
- Twelve dataset cards rendered with row counts, method, timestamps, last result, warnings, deterministic text, details, and capability-matched actions.
- Core `Check Source` and Invoice History `Refresh` are enabled.
- Unsupported refresh/reconcile actions are visibly disabled.
- Force-full is visually separate and warns about two WOE-03 passes, quiet window, source-read-only scope, and prior-snapshot retention.
- Recent governed request history is present.

The existing LIVE viewer exposed and loaded all twelve sections:

| Section | Browser result |
|---|---|
| Work Orders | 12,113 |
| Inventory Items | 28,662 |
| Bills of Material | 1,290 |
| General Ledger Accounts | 257 |
| Sales Orders | 105 |
| Invoice History | 26,036 lines |
| Customer Master | 380 |
| Vendor Master | 805 |
| Purchase Orders | 1,384 lines |
| Receiving History | 189,272 lines |
| Employee Reference | 11 employees |
| Code References | 1,209 |

Console errors: `0`. Four unrelated, pre-existing warnings reported normal local JSON fallback for shipment/operations endpoints. Screenshot: `PLATFORM_REFRESH_CENTER_BROWSER.png`.

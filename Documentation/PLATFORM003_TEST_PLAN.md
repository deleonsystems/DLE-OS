# PLATFORM-003 Test Plan

## Scope

Qualify the read-only Canonical Data Viewer against the existing
PLATFORM-002 API and the `DLE_OS_PLATFORM_LAB` historical snapshot. The plan
does not qualify production deployment, live Add+ON data, synchronization,
imports, or write behavior.

## Automated qualification

Run:

```powershell
$env:PLATFORM003_API_BASE_URL='http://127.0.0.1:5041'
& 'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' `
  'Tests\Platform003\run-platform003-tests.mjs'
```

The 38 scenarios cover:

1. Platform navigation registration.
2. One-time HTML, CSS, and JavaScript loading.
3. Persistent historical-data warning.
4. Live Ready response.
5. NotReady/unavailable handling with no fallback.
6. Live snapshot metadata and qualified counts.
7. Work Orders as the default tab.
8. Work Order pagination.
9. Stocked Work Order resolved description.
10. Non-stock null ItemDescription and two exact separate lines.
11. Inventory filter allowlisting.
12. `+` and `*` BOM identifier encoding and lookup.
13. Three-member General Ledger boundary.
14. Page-size maximum.
15. Stale-response protection.
16. Safe structured errors.
17. GET-only behavior.
18. No SQL, mirror, local business data, or Add+ON access.
19. No legacy public labels.
20. Module cleanup.
21. All 33 Contract v1.1 members.
22. Exact RawDate display.
23. Exact unscaled Decimal text.
24. Work Order filter allowlisting and Category exclusion.
25. Exactly four tabs in the required order.
26. Live GET list and lookup capture.
27. No displayed count constants.
28. Accessibility baseline.
29. Responsive CSS baseline.
30. Isolated shell integration.
31. Debounced Work Order Number server search.
32. Seven-character Work Order Number request normalization matrix.
33. Live short-number lookups for `5` and `102362`.
34. Raw typed Work Order Number remains the visible input value.
35. Direct-page target validation, including first, last, and bounded values.
36. Live direct navigation to page 1, page 75, and the last page.
37. Page input, Enter behavior, bounded validation, and current-page display.
38. Active filters and page size remain on direct navigation.

Pass criteria: 38 pass, 0 fail.

## Manual end-to-end qualification

Open `http://127.0.0.1:5041/`, select `Workspace View → Platform`, and verify:

- readiness and snapshot are Ready;
- Contract is V1.1 and the API-provided total is 26,902;
- every entity tab loads;
- Work Order pagination, page size, and exact search work with optional
  leading zeros;
- stocked and non-stock records render according to Contract v1.1;
- `+019057-1` and `*277-4163` open through exact lookup;
- detail panels contain only approved members;
- closing and reopening the workspace does not duplicate or lose state;
- Administration and Shipping still activate normally.

## Visual qualification

Review at 1366×768, 1920×1080, and 900×900. Check the banner, tabs,
filters, horizontal table scrolling, drawer, focus, long values, shell
boundaries, loading/status states, and responsive navigation.

## Performance qualification

Use one lightweight request per route and a single browser interaction pass.
Do not run load or stress tests. Record server elapsed time and browser
interaction time separately; browser values include automation round-trip
overhead.

## Security/read-only audit

Inspect the module and shared client for:

- canonical API routes only;
- GET as the sole canonical HTTP method;
- no fallback call from the viewer;
- no direct SQL, CSV, mirror, Add+ON, drive, importer, or backend access;
- allowlisted query parameters and encoded exact identifiers;
- `textContent` for canonical response values;
- sanitized errors without trace or server internals;
- no write-like controls.

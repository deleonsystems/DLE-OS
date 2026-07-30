# HTTP and API Acceptance

Verdict: **PASS**

Runtime:

- LIVE API PID: `33084`
- LIVE API owner: `DLE-OS-HOST\DLE-OS-LIVE-API`
- Historical/frontend PID: `25672`
- Refresh control PID: `3364`
- Promotion broker PID: `22212`
- LIVE readiness: `Ready` / `ReadyFresh`
- Active core ImportRunId: `27f0ed25-adcc-46aa-96f4-f0cc7d6ae8b6`

Reference Code acceptance:

- Metadata count: 1,209
- Reference Code ImportRunId: `36c23ba1-b09d-4df8-a794-6e324f46b483`
- Exact `Purchasing / PaymentTerms / 01`: one row, `NET 30 DAYS`
- Direct natural-key lookup: PASS
- Page 25 at size 50: 9 rows
- Invalid page, page size, and resolution status: HTTP 400
- Write routes: none

All twelve list routes returned HTTP 200 with a bounded first page. Totals:
1,290 BOM; 28,662 inventory; 12,113 work orders; 257 GL; 105 sales
orders; 26,036 invoice lines; 380 customers; 805 vendors; 1,384 purchase
orders; 189,272 receiving lines; 11 employee references; and 1,209 code
references.

Purchase Order enrichment returned:

- Payment terms `01` → `NET 30 DAYS` / `Resolved`
- Line code `S` → `Standard Item` / `Resolved`
- UOM `EA` → null description / `Unresolved`

This preserves the original code while making resolution quality explicit.

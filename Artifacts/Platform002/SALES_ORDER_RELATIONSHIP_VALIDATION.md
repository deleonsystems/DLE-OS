# PLATFORM-002 Sales Order Relationship Validation

Verdict: **PASS**

| Validation | Resolved | Unresolved |
|---|---:|---:|
| Customer | 109 | 0 |
| Inventory description dependency | 109 | 0 |
| Work Order | 25 | 84 |
| Bill of Material | 107 | 2 |

All 109 displayed lines have an eligible ARE-03 header and an ARM-01 Customer.
WOE-03 layout B resolves the Sales Order line relationship using Customer
Number, Sales Order Number, and Line Number; the candidate is accepted only
when the corresponding canonical WorkOrder exists. The 84 unresolved rows are
null, never the literal `UNKNOWN`.

BOM resolution uses the canonical Inventory Item identifier against
BillOfMaterial.BillNumber. The two missing results retain null Bill, Drawing,
Drawing Revision, and BOM Revision values. No fallback is invented.

Additional checks:

- Standard lines displayed: 109
- Nonstandard lines filtered during projection build: 399
- Negative quantities retained: 9
- SQL nonstandard rows: 0
- Derived Extended Price mismatches: 0
- Parent ImportRunId mismatches: 0
- Leading-zero identifiers remain text throughout CSV, SQL, API DTO, and UI

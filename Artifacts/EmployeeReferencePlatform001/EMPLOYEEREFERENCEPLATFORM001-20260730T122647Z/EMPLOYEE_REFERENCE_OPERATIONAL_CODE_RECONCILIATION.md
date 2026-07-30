# Employee Operational-Code Reconciliation

## Canonical code population

| Type | Distinct | Resolved | Unresolved | Ambiguous | Generic/system | Blank excluded |
|---|---:|---:|---:|---:|---:|---:|
| Buyer | 1 | 0 | 0 | 0 | 1 | 1 |
| Operator | 9 | 3 | 4 | 1 | 1 | 0 |
| Salesperson | 8 | 1 | 5 | 0 | 2 | 2 |
| Total | 18 | 4 | 9 | 1 | 4 | 3 |

Resolved code-to-employee links reference three employees. One employee owns
two codes in different namespaces (Operator and Salesperson). Operator alias
`MIG` has multiple candidate employees and remains `Ambiguous`; it is not
linked. No resolved code points to an inactive employee.

## Existing datasets

| Dataset/module | Qualified employee-code fields | Result |
|---|---|---|
| Purchase Orders | None in the qualified PO package | Buyer, entered-by, and approved-by unavailable; no inferred mapping |
| Receiving History | `OperatorCode` only on rejection rows | Baseline has zero rejection rows; received-by and inspector are physically unavailable |
| Customer Master | `SalespersonCode` | 380 customers; four distinct nonblank codes (`001`–`004`), two blank rows; all four codes exist in the Salesperson namespace, code `002` resolves uniquely |
| Vendor Master | No accepted buyer assignment | Qualified metadata reports zero vendor-buyer assignments |
| Sales Orders | No employee code in qualified package | Unavailable |
| Work Orders/production | No qualified planner/operator/supervisor/owner field | Unavailable |

Namespaces remain explicit. No Buyer, Salesperson, and Operator code is treated
as interchangeable merely because the text happens to match.

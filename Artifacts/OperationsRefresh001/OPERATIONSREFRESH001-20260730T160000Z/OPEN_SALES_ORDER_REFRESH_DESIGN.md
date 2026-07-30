# Focused Open Sales Order Refresh Design

Verdict: `QUALIFIED DESIGN — IMPLEMENTATION REQUIRED`

The existing `sales_order_refresh.py` is not a routine path: it performs two
complete reads of ARE-03, ARE-13, ARM-01, ARM-10, and WOE-03. The retained
qualified run measured 370,689 WOE-03 records per pass.

The Open Order report implementation proves that a complete WOE-03 scan is
unnecessary for current open lines. OPR.SB performs:

1. seek WOE-03 with `Firm + B + Customer + SalesOrder + Line`;
2. read the first key at or after that prefix;
3. require positions 1–19 to equal the prefix;
4. take Work Order Number from positions 22–28;
5. validate the related WOE-01 record.

The routine therefore reads the current open header/line sources, then performs
bounded indexed relationship reads only for the qualifying lines. Unresolved
and ambiguous results remain explicit; no Work Order is guessed. Current
Inventory, BOM, Work Order, and Customer canonical rows remain lookup
dependencies and are not re-extracted by this routine.

Source identity is captured before and after every run. The operation fails
closed on any identity change, duplicate natural key, invalid date, candidate
validation failure, SQL failure, or promotion failure. A periodic full
two-pass Core ERP qualification remains the reconciliation control.

Acceptance requires package parity with the existing qualified Sales Order
projection, a material runtime reduction versus the full two-pass WOE-03 path,
zero X: writes/locks, and proof that the normal routine cannot invoke
force-full behavior.

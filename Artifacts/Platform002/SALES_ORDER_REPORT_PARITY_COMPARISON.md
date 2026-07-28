# PLATFORM-002 Open Order Report Parity Comparison

Verdict: **PASS**

The canonical projection was compared with
`Artifacts\WorkOrderDate001\OPEN_ORDERS_0727261047.TXT`.

- Legacy export rows: 109
- Canonical qualifying rows: 109
- Unexplained mismatches: 0

The comparison covers resolved and unresolved Work Orders, all nine negative
quantity rows, both blank BOM results, multi-line orders, leading-zero
identifiers, customer resolution, dates, high-precision prices, quantities, and
derived Extended Price. Full canonical Customer Name and Description values are
allowed to extend the legacy report's display-width truncation.

Intentional canonical differences:

- `Quantity Ordered` replaces the misleading `Quantity Open` label.
- The hard-coded `Quantity Shipped` column is omitted.
- Unresolved Work Orders are null instead of `UNKNOWN`.
- Extended Price is derived from unrounded Unit Price times Quantity Ordered.

Machine evidence: `Qualification/REPORT_PARITY_VALIDATION.json`.

# Invoice History parity report

Package-to-SQL parity: `PASS`

| Measure | Package | SQL | Difference |
|---|---:|---:|---:|
| CustomerInvoice | 19,092 | 19,092 | 0 |
| CustomerInvoiceLine | 26,036 | 26,036 | 0 |
| Unique Work Order | 16,465 | 16,465 | 0 |
| Unresolved Work Order | 9,466 | 9,466 | 0 |
| Ambiguous Work Order | 105 | 105 | 0 |
| Negative quantity | 415 | 415 | 0 |
| Duplicate line keys | 0 | 0 | 0 |
| Orphan lines | 0 | 0 | 0 |

The earlier stable 26,028-row export remains an exact subset. The additional
eight qualified source rows are retained, producing the required 26,036-line
baseline.

Known sample:

- Customer: `001148` (search input `1148` normalizes to this value)
- Invoice: `0169292`
- Sales Order: `0009422`
- Sales Order line: `030`
- Item: `277-4169`
- Work Order: `0111450`
- Work Order status: `Unique`
- Manufacturing status: `HistoricalReconstructed`

Signed values are unchanged: 415 quantities are negative and 676 extended
prices are negative. No historical value was clamped or made positive.

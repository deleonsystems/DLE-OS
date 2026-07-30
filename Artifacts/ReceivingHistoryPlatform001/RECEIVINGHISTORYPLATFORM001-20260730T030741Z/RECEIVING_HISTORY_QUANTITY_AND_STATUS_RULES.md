# Receiving History Quantity and Status Rules

| Canonical value | Rule | Evidence status |
|---|---|---|
| `QuantityPostedSigned` | Direct `POT-14` numeric slot 7 | Direct |
| `QuantityReceived` | `max(QuantityPostedSigned, 0)` | Derived |
| `QuantityAccepted` | `max(QuantityPostedSigned, 0)` | Derived from proven QA promotion/direct posting |
| `QuantityRejected` | Sum of matching direct `POT-03` rejection quantities | Direct/aggregated |
| `QuantityReturned` | `max(-QuantityPostedSigned, 0)` | Derived with return/correction/reversal clarification |
| `QuantityInvoiced` | Direct `POT-14` numeric slot 8 | Direct accumulated value |

The implementation does not use `Accepted = Received - Rejected`. Rejections
are separate retained events. Positive and negative signed postings are never
silently converted into unsigned totals.

Line disposition is:

- positive: `PostedReceipt`
- negative: `NegativeReceiptOrReversal`
- zero: `ZeroPostedQuantity`

Header status is `Posted` because membership in `POT-04`/`POT-14` follows the
posting update. It does not imply that the source cannot later be purged.

Inspection status is explicitly
`UnavailableFromRetainedReceiptHistory`; the viewer must not imply that every
receipt has a complete retained inspection record.

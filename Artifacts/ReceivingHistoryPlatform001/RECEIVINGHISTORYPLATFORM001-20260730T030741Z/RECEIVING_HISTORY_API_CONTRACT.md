# Receiving History LIVE API Contract

All routes are GET-only under the isolated LIVE boundary:

- `GET /api/platform/live/v1/receiving-history`
- `GET /api/platform/live/v1/receiving-history/metadata`
- `GET /api/platform/live/v1/receiving-history/{id}`

The line ID is the exact 25-character numeric canonical natural-key
concatenation:

`FirmId + VendorNumber + PurchaseOrderNumber + ReceiverNumber +
ReceiptLineNumber`.

List requests use bounded page/pageSize parameters and server-side,
parameterized filters:

- receiver number
- receipt date from/through
- PO and PO line
- Vendor number/name
- Item number
- packing slip
- Work Order
- warehouse
- inspection status
- rejected-only
- negative receipt/reversal-only

Numeric identifiers accept omitted leading zeros and are normalized to their
proven canonical widths. Matching remains exact except Vendor name, which uses
the existing qualified contains convention. Item and packing-slip punctuation
are preserved.

Results order by receipt date descending, receiver, PO, and receipt line.
Metadata exposes Receiving History ImportRunId, source qualification attempt,
package SHA-256, contract identifier, snapshot/import timestamp, counts, and
status.

The route uses the existing LIVE integrated Windows identity and exact-origin
CORS policy. It never accesses X:, a package, or a backup at request time.
Cost fields are absent from the DTO.

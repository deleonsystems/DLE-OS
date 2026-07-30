# Receiving History Inspection Assessment

The QA entry/register/update chain is proven. `POU.CA` promotes accepted
quantity into the receipt work record and writes rejected events to `POT-03`.
`POU.DA` subsequently posts the receipt to `POT-04`/`POT-14`.

The retained receipt line does not contain complete inspection-detail,
inspection-date, hold/release, lot/date-code, or serial history. `POT-03`
supports a separate rejection child only when populated. A broader Quality,
Inspection, or Nonconformance entity would imply facts not retained by this
source contract and is therefore deferred.

The implemented line classification is
`UnavailableFromRetainedReceiptHistory`. Rejected quantity is never inferred
from received quantity.

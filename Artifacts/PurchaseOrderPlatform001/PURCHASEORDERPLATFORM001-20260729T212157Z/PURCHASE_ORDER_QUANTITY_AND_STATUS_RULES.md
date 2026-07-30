# Purchase Order Quantity and Status Rules

The governing report and maintenance programs prove:

QuantityOpen = QuantityOrdered - QuantityReceived

No cancellation adjustment is made by the report formula. Line labels are:
Open when open quantity is positive; FullyReceivedPendingClose when zero;
and OverReceivedOrReturn when negative. Counts are:

- Open: 1130
- Fully received pending close: 249
- Over-received/return: 5
- No receipts/open: 960
- Partially received: 170
- Fully received: 25

Header status is ActiveOpenFile. Closed and canceled counts are zero because
the qualified active source does not expose historical close/cancel records.

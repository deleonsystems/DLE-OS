# Purchase Order Receiving Relationship Assessment

POE-12 contains current accumulated receipt, quality-WIP, accepted, rejected,
and invoiced quantities. POE-02 contains a last-receipt summary date.
POE-04/POE-14 are current receiver work files. POT-04/POT-14 contain separable
receipt history.

Receipt transaction identity, packing slip, receiver, lot/date code, and
individual acceptance/rejection events should not be flattened into PO lines.
Recommendation: implement RECEIVING-HISTORY-PLATFORM-001 separately.

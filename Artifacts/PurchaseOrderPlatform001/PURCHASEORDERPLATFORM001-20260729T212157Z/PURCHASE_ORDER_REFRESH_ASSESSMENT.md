# Purchase Order Refresh Assessment

The active POE population is small, mutable, and lacks a qualified reliable
update timestamp. Records can change while open and can disappear on close.
The simplest safe initial strategy is a complete governed read of POE-02 and
POE-12 followed by package validation and transactional replacement.

Receipt history should not be reread for every PO viewer refresh. A separate
receiving-history refresh can qualify POT-04/POT-14 later. Schedule/control
implementation is deferred to PURCHASE-ORDER-REFRESH-001.

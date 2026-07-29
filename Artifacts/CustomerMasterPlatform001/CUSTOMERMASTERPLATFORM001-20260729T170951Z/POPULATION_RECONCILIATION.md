# Population Reconciliation

- ARM-01 customers: 380
- ARM-02 details: 380
- ARM-02 missing parents: 0
- Customer natural-key duplicates: 0
- ARM-03 physical addresses: 29
- Operational attached addresses: 28
- Classified orphan addresses: 1 (`FirmId=01`, `CustomerNumber=900003`, `AddressCode=000001`)
- Address natural-key duplicates: 0
- Blank customer names: 1
- SQL customers: 380
- SQL operational addresses: 28

Reference coverage:

- Sales Orders: 36 distinct customer references; 0 missing Customer Master parents.
- Invoice History: 258 distinct customer references; 0 missing Customer Master parents.

The orphan is retained in `OrphanCustomerAddress.csv` for evidence and excluded from the operational SQL table. No synthetic customer was created.

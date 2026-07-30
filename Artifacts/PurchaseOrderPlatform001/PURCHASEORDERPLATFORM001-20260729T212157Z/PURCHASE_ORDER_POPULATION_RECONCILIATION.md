# Purchase Order Population Reconciliation

- Physical POE-02 records: 521
- Canonical headers: 518
- Physical POE-12 records: 1404
- Canonical lines: 1384
- Blank placeholder headers excluded: 1
- Headers with missing natural-key members excluded: 2
- Lines with missing natural-key members excluded: 15
- Source orphan lines explicitly excluded: 20
- Canonical orphan lines: 0
- Headers without lines: 28
- Negative-quantity lines: 5
- Zero-quantity lines: 224
- Stock/non-stock: 1097 / 287

Five physical orphan details have no exact POE-02 parent under the proven
firm/vendor/PO key. Two headers and fifteen lines have blank required key
members. All are retained in bounded exception evidence and are not silently
attached or promoted.

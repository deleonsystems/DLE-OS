# Invoice History import report

Import verdict: `PASS`

- Invoice History import run:
  `5D34047A-8D69-4839-89A9-70658A3DB6EE`
- Source extraction run:
  `INVOICEHISTORYPLATFORM001-20260729T001740Z`
- Headers: 19,092
- Lines: 26,036
- Duplicate line natural keys: 0
- Orphan lines: 0
- Package content hash:
  `DA7EDC4C540750318A2AA73A938F14B5B820A7B482DAB2B29C94CE8555046DA8`

An identical re-import returned `NO-OP` and retained the same active run.

A controlled induced failure occurred after the transaction deleted the
candidate target rows but before bulk loading. Before and after evidence was
identical:

`19092|26036|5D34047A-8D69-4839-89A9-70658A3DB6EE`

This proves the transaction restored the complete active baseline.

The existing full-snapshot tables remained populated:

- BillOfMaterial: 1,290
- InventoryItem: 28,662
- WorkOrder: 12,113
- GeneralLedgerAccount: 257
- current SalesOrderViewer lines: 105

The importer and schema scripts are fixed to `DLE_OS_CANONICAL_LIVE`.

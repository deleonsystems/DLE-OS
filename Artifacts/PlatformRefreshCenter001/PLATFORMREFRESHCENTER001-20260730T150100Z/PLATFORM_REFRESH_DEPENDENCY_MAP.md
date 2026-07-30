# Dependency Map

- Reference Code and Employee Reference datasets support descriptive resolution but do not invalidate retained historical facts.
- Customer Master supports Sales Orders and Invoice History enrichment.
- Vendor Master supports Purchase Orders and Receiving History enrichment.
- Inventory Item supports BOM, Work Order, Sales Order, Purchase Order, and Receiving item resolution.
- Purchase Orders precede Receiving reconciliation when both focused refreshes become qualified.
- The five core datasets share one qualified snapshot/import boundary.

Dependencies influence recommendations and future ordering. They do not fabricate blocking relationships absent from an existing canonical contract.

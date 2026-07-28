# OPEN-ORDER-CANONICAL-VALIDATION-001

## Scope and evidence boundary

This validation uses the completed `OPEN-ORDER-FIELD-MAP-001` evidence. It does
not repeat report reverse engineering and it does not treat the operator's
selection as approval.

Evidence used:

- `OPEN_ORDER_FIELD_PROVENANCE.csv`
- `OPEN_ORDER_REPORT_LOGIC_TRACE.md`
- `OPEN_ORDER_CANONICAL_APPROVAL_QUEUE.md`
- the current Canonical Candidate Catalog and Canonical Contract v1.2 ownership

## Decision summary

| Recommendation | Count |
|---|---:|
| APPROVE SHARED CONCEPT | 6 |
| APPROVE WITH CLARIFICATION | 11 |
| SUPPORTING DEPENDENCY ONLY | 1 |
| DERIVED ONLY | 0 |
| REJECT | 4 |
| **Total selected concepts** | **22** |

No selected Shared Concept is itself derived-only. Two report-facing values
remain derived semantics outside the selected physical concepts:

- `OpenOrderReport.QuantityOpen` is currently an alias of
  `SalesOrderLine.QuantityOrdered`; no open-quantity calculation occurs.
- `OpenOrderReport.Description` is resolved from Sales Order line memo,
  ARM-10 line-type logic, and Inventory Item description fallback.

## Validation table

| Shared Concept | Operator Status | Physical Source | Used By Open Order Report | Canonical Owner | Reference Only | Recommended Canonical Name | Recommendation | Reason |
|---|---|---|---|---|---|---|---|---|
| AccountsReceivablePurchaseOrderNumber | SELECTED FOR OPEN ORDER VALIDATION | ARE-03A140 AR PO NUMBER | Yes — direct | SalesOrder | No | `SalesOrder.CustomerPurchaseOrderNumber` | APPROVE WITH CLARIFICATION | The export's Customer PO is this field, but the AR-prefixed ERP name obscures the business meaning. |
| BillNumber | SELECTED FOR OPEN ORDER VALIDATION | BMM-01A020 BILL NUMBER | Yes — lookup | BillOfMaterial | No | `BillOfMaterial.BillNumber` | APPROVE SHARED CONCEPT | Existing Contract v1.2 member and the matched BOM identifier used by the report. |
| BomRevision | SELECTED FOR OPEN ORDER VALIDATION | BMM-01A080 BILL REV | Yes — lookup | BillOfMaterial | No | `BillOfMaterial.BomRevision` | APPROVE SHARED CONCEPT | Existing Contract v1.2 member; exported as Revision Code. |
| CustName | SELECTED FOR OPEN ORDER VALIDATION | ARM-01A030 CUST NAME | Yes — lookup | Customer | No | `Customer.CustomerName` | APPROVE WITH CLARIFICATION | Prefer the full business name and Customer ownership; the 25-character truncation is report display behavior. |
| CustomerNumber | SELECTED FOR OPEN ORDER VALIDATION | ARE-03A030 CUSTOMER NBR | Yes — direct | Customer | ARE-03 is a reference | `Customer.CustomerNumber`; `SalesOrder.CustomerNumber` reference | APPROVE WITH CLARIFICATION | Customer owns the identifier; the report emits the Sales Order header's reference. |
| DrawingNumber | SELECTED FOR OPEN ORDER VALIDATION | BMM-01A030 DRAWING NBR | Yes — lookup | BillOfMaterial | No | `BillOfMaterial.DrawingNumber` | APPROVE SHARED CONCEPT | Existing Contract v1.2 member used from the matched BMM-01 record. |
| DrawingRevision | SELECTED FOR OPEN ORDER VALIDATION | BMM-01A040 DRAWING REV | Yes — lookup | BillOfMaterial | No | `BillOfMaterial.DrawingRevision` | APPROVE SHARED CONCEPT | Existing Contract v1.2 member used from the matched BMM-01 record. |
| DueDate | SELECTED FOR OPEN ORDER VALIDATION | None | No | None for this report | No | None | REJECT | Neither export date is a DUE DATE field. |
| EstShpDate | SELECTED FOR OPEN ORDER VALIDATION | ARE-13A140 EST SHP DATE | Yes — direct, filter, and sort | SalesOrderLine | No | `SalesOrderLine.EstimatedShipDate` | APPROVE WITH CLARIFICATION | This is the actual export Ship Date. Preserve raw traceability and use an approved conversion for a readable date. |
| ItemDescription | SELECTED FOR OPEN ORDER VALIDATION | IVM-01A030 ITEM DESC | Yes — conditional fallback | InventoryItem | Report-description dependency | `InventoryItem.ItemDescription` | APPROVE SHARED CONCEPT | Existing canonical fact; the report's final Description remains a separate resolved value. |
| ItemNumber | SELECTED FOR OPEN ORDER VALIDATION | ARE-13A120 ITEM NUMBER | Yes — direct | InventoryItem | SalesOrderLine reference | `InventoryItem.ItemNumber`; `SalesOrderLine.ItemNumber` reference | APPROVE WITH CLARIFICATION | InventoryItem owns the shared identifier; the Sales Order line retains the reference value. |
| LineCode | SELECTED FOR OPEN ORDER VALIDATION | ARE-13A060; ARM-10E interpretation | Yes — filter/control only | SalesOrderLine processing metadata | Yes | `SalesOrderLine.LineCode` (supporting only) | SUPPORTING DEPENDENCY ONLY | Required to reproduce Standard-line filtering and description logic, but not an exported business fact or global concept. |
| LineNumber | SELECTED FOR OPEN ORDER VALIDATION | ARE-13A050 LINE NUMBER | Yes — direct | SalesOrderLine | No | `SalesOrderLine.LineNumber` | APPROVE WITH CLARIFICATION | This is the Sales Order detail-line key; unrelated LineNumber fields retain their own owners. |
| OrderDate | SELECTED FOR OPEN ORDER VALIDATION | None; selected sources are SHE-01/SHT-01 | No | None for this report | No | None | REJECT | The export does not use the selected shipping-history Order Date fields. |
| SalesOrderNumber | SELECTED FOR OPEN ORDER VALIDATION | ARE-03A040 ORDER NUMBER | Yes — direct | SalesOrder | Other entity occurrences | `SalesOrder.SalesOrderNumber` | APPROVE WITH CLARIFICATION | SalesOrder owns the identifier; WorkOrder and other occurrences are references. |
| Order3Date | SELECTED FOR OPEN ORDER VALIDATION | ARE-03A240 ORDER3 DATE | Yes — direct | SalesOrder | No | `SalesOrder.OrderDate` | APPROVE WITH CLARIFICATION | This is the actual export Order Date; `Order3Date` is an ERP storage label, not the business name. |
| OrderedDate | SELECTED FOR OPEN ORDER VALIDATION | None; selected sources are POE/POT | No | None for this report | No | None | REJECT | These are Purchase Order dates, not the Open Order export date. |
| QuantityOrdered | SELECTED FOR OPEN ORDER VALIDATION | ARE-13A210 QTY ORDERED | Yes — direct | SalesOrderLine | No | `SalesOrderLine.QuantityOrdered` | APPROVE WITH CLARIFICATION | The report labels it Quantity Open but copies Quantity Ordered without subtraction. |
| SchProdQuantity | SELECTED FOR OPEN ORDER VALIDATION | WOE-01A320 SCH PROD QTY | Yes — lookup | WorkOrder | No | `WorkOrder.SchProdQuantity` | APPROVE SHARED CONCEPT | Existing Contract v1.2 member and the actual Work Order quantity returned. |
| ShipDate | SELECTED FOR OPEN ORDER VALIDATION | None; selected sources are ARE-15/MPW/SHE/SHT/SHW | No | None for this report | No | None | REJECT | The export's Ship Date comes from EST SHP DATE, not a SHIP DATE field. |
| UnitPrice | SELECTED FOR OPEN ORDER VALIDATION | ARE-13A200 UNIT PRICE | Yes — direct | SalesOrderLine | No | `SalesOrderLine.UnitPrice` | APPROVE WITH CLARIFICATION | The Sales Order line owns this price; other catalog price occurrences are context-specific and scale still requires qualification. |
| WorkOrderNumber | SELECTED FOR OPEN ORDER VALIDATION | WOE-03B070 relation; WOE-01A030 owner | Yes — lookup | WorkOrder | WOE-03 relation only | `WorkOrder.WorkOrderNumber` | APPROVE WITH CLARIFICATION | Existing canonical identifier; the report resolves it through the Sales Order line relationship and validates WOE-01. |

## Date determination

- Open Order export **Order Date** = `ARE-03A240 ORDER3 DATE`.
- Open Order export **Ship Date** = `ARE-13A140 EST SHP DATE`.
- `DueDate`, the selected `OrderDate` group, `OrderedDate`, and the selected
  `ShipDate` group do not supply these columns.
- Business names should be `SalesOrder.OrderDate` and
  `SalesOrderLine.EstimatedShipDate`; raw legacy values should remain available
  when readable fields are added under an approved date policy.

## Quantity determination

`ARE-13A210 QTY ORDERED` is the actual physical business fact. The report writes
that unchanged value under the label Quantity Open. Therefore:

- approve `SalesOrderLine.QuantityOrdered`;
- do not rename it to QuantityOpen;
- keep any future `OpenOrderReport.QuantityOpen` as a separately defined
  derived/report field, with its formula made explicit.

## Canonical ownership rules

- `Customer` owns Customer Number and Customer Name.
- `SalesOrder` owns Sales Order Number, Customer Purchase Order Number, and
  Order Date; its Customer Number is a reference.
- `SalesOrderLine` owns Line Number, Estimated Ship Date, Unit Price, and
  Quantity Ordered; its Item Number is a reference to Inventory Item.
- `InventoryItem`, `WorkOrder`, and `BillOfMaterial` retain ownership of their
  already-approved Contract v1.2 identifiers and attributes.
- WOE-03 layout B and ARE-13 Line Code remain relationship/processing support,
  not independent business owners.

## Operator approval boundary

These are validation recommendations only. No Canonical Candidate Catalog row
has been changed to an approved status, and no Canonical Contract change is
performed by this mission.

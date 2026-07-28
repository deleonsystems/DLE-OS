# PLATFORM-002 Sales Order Canonical Mapping

The implementation uses the approved findings from
OPEN-ORDER-FIELD-MAP-001 and OPEN-ORDER-CANONICAL-VALIDATION-001.

| Canonical field | Physical source | Rule |
|---|---|---|
| Customer.CustomerNumber | ARM-01 A key | Identifier owner |
| Customer.CustomerName | ARM-01A030 | Full 30-character customer name |
| SalesOrder.CustomerNumber | ARE-03A030 | Customer reference |
| SalesOrder.SalesOrderNumber | ARE-03A040 | Seven-character identifier |
| SalesOrder.CustomerPurchaseOrderNumber | ARE-03A140 | Business name replaces ERP-specific label |
| SalesOrder.OrderDate | ARE-03A240 | Add+ON date decoding; raw hex retained |
| SalesOrderLine.LineNumber | ARE-13A050 | Three-character line identifier |
| SalesOrderLine.ItemNumber | ARE-13A120 | Hyphens and leading zeros preserved |
| SalesOrderLine.OrderMemo | ARE-13A130 | Physical memo retained |
| SalesOrderLine.EstimatedShipDate | ARE-13A140 | Add+ON date decoding; raw hex retained |
| SalesOrderLine.UnitPrice | ARE-13A200 | High-precision numeric retained |
| SalesOrderLine.QuantityOrdered | ARE-13A210 | Correct canonical meaning |

Supporting fields are `CustomerNumber` on SalesOrderLine for the proven
composite relationship, ARE-13 LineCode, ARM-10 layout E interpretation, and
WOE-03 layout B relationship material. Sales Order Number is not globally
unique across customers; therefore the normalized SQL keys include Customer
Number. This prevents collisions without changing the business identifier.

Only Line Code `S` is imported into the initial projection. Resolved Description
uses nonblank Order Memo first, then InventoryItem.ItemDescription. Extended
Price is derived from the unrounded Unit Price multiplied by Quantity Ordered.
Quantity Shipped is neither stored nor displayed. Unresolved Work Order and BOM
relationships remain SQL null. Negative quantities are retained.

Order dates resolve inside 1995 through snapshot year. Estimated Ship Date is a
forward-looking business date, so the same proven byte conversion is resolved
inside 1995 through snapshot year plus ten; every observed value resolves
uniquely. Blank `202020` becomes null and invalid dates fail package creation.

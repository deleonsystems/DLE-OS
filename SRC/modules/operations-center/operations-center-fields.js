/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER FIELD DEFINITIONS
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  window.OperationsCenter.officialColumns = [
    { key: 'orderDate', label: 'Order Date' },
    { key: 'customer', label: 'Customer Name' },
    { key: 'customerPo', label: 'Customer PO' },
    { key: 'salesOrder', label: 'Sales Order' },
    { key: 'sequenceLine', label: 'SO Line' },
    { key: 'workOrder', label: 'Work Order' },
    { key: 'materialStatus', label: 'Material Status' },
    { key: 'quantityOrdered', label: 'Qty Ordered', diagnostic: true },
    { key: 'erpQtyOpen', label: 'ERP Qty Open', diagnostic: true },
    { key: 'pendingInvoiceQty', label: 'Pending Invoice Qty', diagnostic: true },
    { key: 'opQtyOpen', label: 'OP Qty Open' },
    { key: 'partNumber', label: 'Assembly / Item Number' },
    { key: 'description', label: 'Description' },
    { key: 'dueDate', label: 'Estimated Ship Date' },
    { key: 'price', label: 'Unit Price' },
    { key: 'extendedPrice', label: 'Extended Price' },
    { key: 'operationalStatus', label: 'Operational Status' }
  ];

  window.OperationsCenter.overlayFields = [
    { key: 'productionShipping', label: 'Production / Shipping' },
    {
      key: 'kitShort',
      label: 'Kit Short',
      documentLink: {
        type: 'kitShort'
      }
    },
    {
      key: 'purchasingComplete',
      label: 'Purchasing Complete',
      documentLink: {
        type: 'purchasingComplete'
      }
    },
    {
      key: 'kitComplete',
      label: 'Kit Complete',
      documentLink: {
        type: 'kitComplete'
      }
    },
    { key: 'holdIssue', label: 'HOLD / ISSUE' }
  ];
})();

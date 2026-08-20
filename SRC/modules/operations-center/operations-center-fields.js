/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER FIELD DEFINITIONS
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  window.OperationsCenter.officialColumns = [
    { key: 'orderDate', label: 'Order Date' },
    { key: 'customer', label: 'Customer' },
    { key: 'customerPo', label: 'Customer P.O.' },
    { key: 'salesOrder', label: 'Sales Order' },
    { key: 'sequenceLine', label: 'Line' },
    { key: 'workOrder', label: 'Work Order' },
    { key: 'partNumber', label: 'Item Number', className: 'operations-center-item-number-cell' },
    { key: 'description', label: 'Description', className: 'operations-center-description-cell' },
    { key: 'opQtyOpen', label: 'Qty Open', numeric: true },
    { key: 'dueDate', label: 'Due / Estimated Ship Date' },
    { key: 'price', label: 'Unit Price', numeric: true },
    { key: 'extendedPrice', label: 'Extended Price', numeric: true },
    { key: 'materialStatus', label: 'Material Status' },
    { key: 'operationalStatus', label: 'Production Status' },
    { key: 'quantityOrdered', label: 'Qty Ordered', diagnostic: true, numeric: true },
    { key: 'erpQtyOpen', label: 'ERP Qty Open', diagnostic: true, numeric: true },
    { key: 'pendingInvoiceQty', label: 'Pending Invoice Qty', diagnostic: true, numeric: true }
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
    {
      key: 'holdIssue',
      label: 'Special Request / Issue',
      tablePlacement: 'primary',
      className: 'operations-center-issue-cell'
    }
  ];
})();

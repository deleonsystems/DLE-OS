/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER FIELD DEFINITIONS
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  window.OperationsCenter.officialColumns = [
    { key: 'orderDate', label: 'ERP Order Date' },
    { key: 'customer', label: 'Customer' },
    { key: 'customerPo', label: 'Customer P.O.' },
    { key: 'poDate', label: 'PO Date' },
    { key: 'salesOrder', label: 'Sales Order' },
    { key: 'sequenceLine', label: 'Line' },
    { key: 'workOrder', label: 'Work Order' },
    { key: 'partNumber', label: 'Item Number', className: 'operations-center-item-number-cell' },
    { key: 'description', label: 'Description', className: 'operations-center-description-cell' },
    { key: 'opQtyOpen', label: 'Qty Open', numeric: true },
    { key: 'customerDueDate', label: 'Customer Due Date' },
    { key: 'dueDate', label: 'Estimated Ship Date' },
    { key: 'price', label: 'Unit Price', numeric: true },
    { key: 'extendedPrice', label: 'Extended Price', numeric: true },
    {
      key: 'verifiedStatus',
      label: 'Last Verified Status',
      className: 'operations-center-verified-status-cell'
    },
    { key: 'materialStatus', label: 'Material Status' },
    ...(window.DleIntegration.enabled ? [{ key: 'productionPlaceholder', label: 'Production Status', placeholder: true }] : []),
    { key: 'quantityOrdered', label: 'Qty Ordered', diagnostic: true, numeric: true },
    { key: 'erpQtyOpen', label: 'ERP Qty Open', diagnostic: true, numeric: true },
    { key: 'pendingInvoiceQty', label: 'Pending Invoice Qty', diagnostic: true, numeric: true }
  ];

})();

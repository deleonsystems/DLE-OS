/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER FIELD DEFINITIONS
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  window.OperationsCenter.officialColumns = [
    { key: 'orderDate', label: 'Ord Dt' },
    { key: 'customer', label: 'Cust Name' },
    { key: 'customerPo', label: 'P/O' },
    { key: 'salesOrder', label: 'Sls Ord#' },
    { key: 'sequenceLine', label: 'Seq Ln' },
    { key: 'workOrder', label: 'WorkOrd' },
    { key: 'qtyOpen', label: 'Qty Open' },
    { key: 'partNumber', label: 'Item#' },
    { key: 'description', label: 'Description' },
    { key: 'shipDate', label: 'Ship Dt' },
    { key: 'price', label: 'Price' },
    { key: 'extendedPrice', label: 'Ext Price' }
  ];

  window.OperationsCenter.overlayFields = [
    { key: 'notes', label: 'NOTES' },
    { key: 'status', label: 'STATUS' },
    { key: 'productionShipping', label: 'Production / Shipping' },
    { key: 'kitShort', label: 'Kit Short' },
    { key: 'purchasingComplete', label: 'Purchasing Complete' },
    { key: 'kitComplete', label: 'Kit Complete' },
    { key: 'holdIssue', label: 'HOLD / ISSUE' }
  ];
})();

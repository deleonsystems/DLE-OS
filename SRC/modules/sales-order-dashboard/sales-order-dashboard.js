/* -----------------------------------------------------
   470 - JS: SALES ORDER DASHBOARD MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.SalesOrderDashboard = window.SalesOrderDashboard || {};
  const dashboardState = {
    selectedOrder: null,
    selectedWorkOrder: null,
    requestDialogOpen: false
  };
  let requestDialogReturnFocus = null;
  let temporaryRequestSequence = 0;

  /*
    Sales Order Dashboard is the future digital replacement for the
    physical Sales Order folder. This phase only establishes the module
    boundary; existing Order Dashboard workflows remain untouched.
  */

  async function loadSalesOrderDashboardModule() {
    const placeholder = document.getElementById('salesOrderDashboard');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/sales-order-dashboard/sales-order-dashboard.html');
    if (!response.ok) {
      throw new Error('Unable to load Sales Order Dashboard module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;
  }

  function initializeSalesOrderDashboard() {
    renderSalesOrderDashboardModule();
  }

  function setSelectedOrder(order) {
    dashboardState.selectedOrder = order || null;
    dashboardState.selectedWorkOrder = null;
    renderSalesOrderDashboardModule();
  }

  function renderSalesOrderDashboardModule() {
    const status = document.getElementById('salesOrderDashboardStatus');
    if (status) {
      status.textContent = 'Sales Order Dashboard ready. Future digital Sales Order folder workflows will live here.';
    }
    renderSalesOrderSummary();
    renderRelatedWorkOrders();
    updateRequestToShipAction();
  }

  function renderSalesOrderSummary() {
    const official = dashboardState.selectedOrder?.official || {};
    const selectedWorkOrder = dashboardState.selectedWorkOrder?.official || {};

    setText('salesOrderSummaryCustomer', official.customer || 'Select an order');
    setText('salesOrderSummarySalesOrder', official.salesOrder || 'N/A');
    setText('salesOrderSummaryCustomerPo', official.customerPo || 'N/A');
    setText('salesOrderSummaryLineItems', String(getRelatedRows().length));
    setText('salesOrderSummaryWorkOrders', String(countRelatedWorkOrders()));
    setText('salesOrderSummaryOperationalStatus', official.operationalStatus || 'N/A');
    setText('salesOrderDashboardSelectedSalesOrder', official.salesOrder || 'None selected');
    setText('salesOrderDashboardSelectedWorkOrder', selectedWorkOrder.workOrder || 'None selected');
  }

  function renderRelatedWorkOrders() {
    const rows = document.getElementById('salesOrderDashboardWorkOrderRows');
    if (!rows) return;

    const relatedRows = getRelatedRows();
    if (!relatedRows.length) {
      rows.innerHTML = '<tr><td class="sales-order-dashboard-empty" colspan="5">Select a Sales Order from Operations Center.</td></tr>';
      return;
    }

    rows.innerHTML = relatedRows.map((row, index) => {
      const official = row.official || {};
      const rowClass = index % 2 === 0 ? 'rowEven' : 'rowOdd';
      const selected = row === dashboardState.selectedWorkOrder;
      return [
        '<tr class="',
        rowClass,
        ' sales-order-dashboard-work-order-row',
        selected ? ' sales-order-dashboard-work-order-row-selected' : '',
        '" data-related-row-index="',
        String(index),
        '" tabindex="0" aria-selected="',
        selected ? 'true' : 'false',
        '" onclick="selectSalesOrderDashboardWorkOrder(event)" onkeydown="handleSalesOrderDashboardWorkOrderKeydown(event)">',
        '<td>',
        '<button type="button" class="sales-order-dashboard-work-order-link" data-related-row-index="',
        String(index),
        '" onclick="openSalesOrderDashboardWorkOrder(event)">',
        escapeDashboardHtml(official.workOrder || 'Unknown'),
        '</button>',
        '</td>',
        '<td>',
        escapeDashboardHtml(official.partNumber || 'N/A'),
        '</td>',
        '<td>',
        escapeDashboardHtml(official.opQtyOpen || '0'),
        '</td>',
        '<td>',
        escapeDashboardHtml(official.dueDate || 'N/A'),
        '</td>',
        '<td><span class="sales-order-dashboard-status-pill">',
        escapeDashboardHtml(official.operationalStatus || 'N/A'),
        '</span></td>',
        '</tr>'
      ].join('');
    }).join('');
  }

  function selectWorkOrder(event) {
    const rowElement = event?.currentTarget;
    const index = Number(rowElement?.dataset?.relatedRowIndex);
    const selectedRow = getRelatedRows()[index];
    if (!selectedRow) return;

    dashboardState.selectedWorkOrder = dashboardState.selectedWorkOrder === selectedRow
      ? null
      : selectedRow;
    renderSalesOrderDashboardModule();
  }

  function handleWorkOrderKeydown(event) {
    if (event?.target !== event?.currentTarget) return;
    if (!['Enter', ' '].includes(event?.key)) return;
    event.preventDefault();
    selectWorkOrder(event);
  }

  function isValidWorkOrder(row) {
    const workOrder = String(row?.official?.workOrder || '').trim();
    return !!workOrder && workOrder.toUpperCase() !== 'UNKNOWN';
  }

  function updateRequestToShipAction() {
    const button = document.getElementById('salesOrderDashboardCreateRequestToShipButton');
    if (!button) return;

    const enabled = isValidWorkOrder(dashboardState.selectedWorkOrder);
    button.disabled = !enabled;
    button.title = enabled
      ? 'Create a Request to Ship for the selected work order.'
      : 'Select a valid work order before creating a Request to Ship.';
  }

  function openRequestToShipDialog() {
    if (!isValidWorkOrder(dashboardState.selectedWorkOrder)) return;

    const official = dashboardState.selectedWorkOrder.official || {};
    const openQuantity = parseDashboardQuantity(official.opQtyOpen);
    const dialog = document.getElementById('requestToShipDialog');
    const quantityInput = document.getElementById('requestToShipQuantity');
    if (!dialog || !quantityInput) return;

    setText('requestToShipCustomer', official.customer || 'N/A');
    setText('requestToShipSalesOrder', official.salesOrder || 'N/A');
    setText('requestToShipWorkOrder', official.workOrder || 'N/A');
    setText('requestToShipAssembly', official.partNumber || 'N/A');
    setText('requestToShipOpenQuantity', formatDashboardQuantity(openQuantity));
    setText('requestToShipDueDate', official.dueDate || 'N/A');

    quantityInput.max = String(openQuantity);
    quantityInput.value = formatDashboardQuantity(openQuantity);
    requestDialogReturnFocus = document.activeElement;
    dashboardState.requestDialogOpen = true;
    dialog.hidden = false;
    validateRequestToShipQuantity();
    quantityInput.focus();
    quantityInput.select();
  }

  function cancelRequestToShipDialog() {
    const dialog = document.getElementById('requestToShipDialog');
    if (dialog) dialog.hidden = true;
    dashboardState.requestDialogOpen = false;
    setText('requestToShipValidation', '');
    requestDialogReturnFocus?.focus?.();
    requestDialogReturnFocus = null;
  }

  function validateRequestToShipQuantity() {
    const quantityInput = document.getElementById('requestToShipQuantity');
    const sendButton = document.getElementById('sendRequestToShippingButton');
    const openQuantity = parseDashboardQuantity(dashboardState.selectedWorkOrder?.official?.opQtyOpen);
    const requestedQuantity = parseDashboardQuantity(quantityInput?.value);
    let message = '';

    if (!quantityInput?.value || requestedQuantity <= 0) {
      message = 'Qty Requested to Ship must be greater than zero.';
    } else if (requestedQuantity > openQuantity) {
      message = 'Qty Requested to Ship cannot exceed Open Quantity.';
    }

    setText('requestToShipValidation', message);
    if (sendButton) sendButton.disabled = !!message;
    if (quantityInput) quantityInput.setAttribute('aria-invalid', message ? 'true' : 'false');
    return {
      valid: !message,
      message,
      requestedQuantity,
      openQuantity
    };
  }

  function sendRequestToShipping(event) {
    event?.preventDefault?.();
    const validation = validateRequestToShipQuantity();
    if (!validation.valid || !dashboardState.selectedWorkOrder) return;

    if (typeof window.ShippingWorkspace?.openRequest !== 'function') {
      console.error('Shipping Workspace is not available.');
      return;
    }

    const official = dashboardState.selectedWorkOrder.official || {};
    const requestToShip = {
      requestId: createTemporaryRequestId(),
      requestType: 'Request To Ship',
      requestedBy: 'Operations',
      requestDateTime: new Date().toISOString(),
      customerNumber: official.customerNumber || '',
      customer: official.customer || '',
      salesOrder: official.salesOrder || '',
      workOrder: official.workOrder || '',
      assembly: official.partNumber || '',
      openQuantity: validation.openQuantity,
      qtyRequested: validation.requestedQuantity,
      dueDate: official.dueDate || '',
      status: 'Pending Shipping',
      sourceWorkOrder: dashboardState.selectedWorkOrder
    };

    cancelRequestToShipDialog();
    window.ShippingWorkspace.openRequest(requestToShip);
  }

  function createTemporaryRequestId() {
    temporaryRequestSequence += 1;
    return 'RTS-' + Date.now() + '-' + String(temporaryRequestSequence).padStart(3, '0');
  }

  function handleRequestToShipDialogKeydown(event) {
    if (event?.key === 'Escape' && dashboardState.requestDialogOpen) {
      cancelRequestToShipDialog();
    }
  }

  function parseDashboardQuantity(value) {
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDashboardQuantity(value) {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  function openWorkOrderDashboard(event) {
    event?.stopPropagation();
    const target = event?.currentTarget || event?.target;
    const index = Number(target?.dataset?.relatedRowIndex);
    const selectedRow = getRelatedRows()[index];
    if (!selectedRow) return;

    if (typeof window.WorkOrderDashboardModule?.setSelectedWorkOrder === 'function') {
      window.WorkOrderDashboardModule.setSelectedWorkOrder(selectedRow);
    }
    if (typeof go === 'function') {
      go('workOrderDashboardModule');
    }
  }

  function getRelatedRows() {
    const selectedOrder = dashboardState.selectedOrder;
    if (!selectedOrder) return [];
    return Array.isArray(selectedOrder.relatedRows) && selectedOrder.relatedRows.length
      ? selectedOrder.relatedRows
      : [selectedOrder];
  }

  function countRelatedWorkOrders() {
    const workOrders = new Set(getRelatedRows()
      .map(row => String(row.official?.workOrder || '').trim())
      .filter(workOrder => workOrder && workOrder.toUpperCase() !== 'UNKNOWN'));
    return workOrders.size;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function escapeDashboardHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  window.SalesOrderDashboard.loadModule = loadSalesOrderDashboardModule;
  window.SalesOrderDashboard.initialize = initializeSalesOrderDashboard;
  window.SalesOrderDashboard.setSelectedOrder = setSelectedOrder;
  window.SalesOrderDashboard.selectWorkOrder = selectWorkOrder;
  window.SalesOrderDashboard.openRequestToShipDialog = openRequestToShipDialog;
  window.SalesOrderDashboard.cancelRequestToShipDialog = cancelRequestToShipDialog;
  window.SalesOrderDashboard.sendRequestToShipping = sendRequestToShipping;
  window.SalesOrderDashboard.getState = () => ({ ...dashboardState });
  window.SalesOrderDashboard.openWorkOrderDashboard = openWorkOrderDashboard;
  window.SalesOrderDashboard.render = renderSalesOrderDashboardModule;

  window.loadSalesOrderDashboardModule = loadSalesOrderDashboardModule;
  window.initializeSalesOrderDashboard = initializeSalesOrderDashboard;
  window.setSalesOrderDashboardSelectedOrder = setSelectedOrder;
  window.selectSalesOrderDashboardWorkOrder = selectWorkOrder;
  window.handleSalesOrderDashboardWorkOrderKeydown = handleWorkOrderKeydown;
  window.openRequestToShipDialog = openRequestToShipDialog;
  window.cancelRequestToShipDialog = cancelRequestToShipDialog;
  window.validateRequestToShipQuantity = validateRequestToShipQuantity;
  window.sendRequestToShipping = sendRequestToShipping;
  window.openSalesOrderDashboardWorkOrder = openWorkOrderDashboard;
  window.renderSalesOrderDashboardModule = renderSalesOrderDashboardModule;

  document.addEventListener('keydown', handleRequestToShipDialogKeydown);
})();

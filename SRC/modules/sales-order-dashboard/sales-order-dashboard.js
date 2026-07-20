/* -----------------------------------------------------
   470 - JS: SALES ORDER DASHBOARD MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.SalesOrderDashboard = window.SalesOrderDashboard || {};
  const dashboardState = {
    selectedOrder: null,
    selectedWorkOrder: null,
    selectedWorkOrders: [],
    requestDialogLines: [],
    requestDialogOpen: false
  };
  const REQUESTED_SHIP_WINDOWS = Object.freeze(['Today', 'Tomorrow', 'This Week', 'No Rush']);
  const DEFAULT_REQUESTED_SHIP_WINDOW = REQUESTED_SHIP_WINDOWS[0];
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
    dashboardState.selectedWorkOrders = [];
    dashboardState.requestDialogLines = [];
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
    const selectedCount = dashboardState.selectedWorkOrders.length;

    setText('salesOrderSummaryCustomer', official.customer || 'Select an order');
    setText('salesOrderSummarySalesOrder', official.salesOrder || 'N/A');
    setText('salesOrderSummaryCustomerPo', official.customerPo || 'N/A');
    setText('salesOrderSummaryLineItems', String(getRelatedRows().length));
    setText('salesOrderSummaryWorkOrders', String(countRelatedWorkOrders()));
    setOperationalStatus(
      'salesOrderSummaryOperationalStatus',
      selectedWorkOrder.operationalStatus || official.operationalStatus
    );
    setText('salesOrderDashboardSelectedSalesOrder', official.salesOrder || 'None selected');
    setText(
      'salesOrderDashboardSelectedWorkOrder',
      selectedCount === 1
        ? selectedWorkOrder.workOrder || '1 line selected'
        : selectedCount > 1
          ? selectedCount + ' lines selected'
          : 'None selected'
    );
  }

  function renderRelatedWorkOrders() {
    const rows = document.getElementById('salesOrderDashboardWorkOrderRows');
    if (!rows) return;

    const relatedRows = getRelatedRows();
    if (!relatedRows.length) {
      rows.innerHTML = '<tr><td class="sales-order-dashboard-empty" colspan="6">Select a Sales Order from Operations Center.</td></tr>';
      return;
    }

    rows.innerHTML = relatedRows.map((row, index) => {
      const official = row.official || {};
      const rowClass = index % 2 === 0 ? 'rowEven' : 'rowOdd';
      const selected = dashboardState.selectedWorkOrders.includes(row);
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
        escapeDashboardHtml(official.sequenceLine || 'N/A'),
        '</td>',
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
        '<td>',
        renderOperationalStatus(official.operationalStatus, 'sales-order-dashboard-status-pill'),
        '</td>',
        '</tr>'
      ].join('');
    }).join('');
  }

  function selectWorkOrder(event) {
    const rowElement = event?.currentTarget;
    const index = Number(rowElement?.dataset?.relatedRowIndex);
    const selectedRow = getRelatedRows()[index];
    if (!selectedRow) return;

    const selectedIndex = dashboardState.selectedWorkOrders.indexOf(selectedRow);
    if (selectedIndex >= 0) {
      dashboardState.selectedWorkOrders.splice(selectedIndex, 1);
    } else {
      dashboardState.selectedWorkOrders.push(selectedRow);
    }
    dashboardState.selectedWorkOrder = dashboardState.selectedWorkOrders[dashboardState.selectedWorkOrders.length - 1] || null;
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

    const selectedRows = dashboardState.selectedWorkOrders;
    const enabled = selectedRows.length > 0 && selectedRows.every(isValidWorkOrder);
    button.disabled = !enabled;
    button.title = enabled
      ? 'Create one Request to Ship for the selected Sales Order line' + (selectedRows.length === 1 ? '.' : 's.')
      : 'Select one or more valid Sales Order lines before creating a Request to Ship.';
  }

  function openRequestToShipDialog() {
    const selectedRows = dashboardState.selectedWorkOrders.filter(isValidWorkOrder);
    if (!selectedRows.length || selectedRows.length !== dashboardState.selectedWorkOrders.length) return;

    const orderOfficial = dashboardState.selectedOrder?.official || {};
    const firstOfficial = selectedRows[0]?.official || {};
    const dialog = document.getElementById('requestToShipDialog');
    if (!dialog) return;

    dashboardState.requestDialogLines = selectedRows.map(buildRequestDialogLine);

    setText('requestToShipCustomer', orderOfficial.customer || firstOfficial.customer || 'N/A');
    setText('requestToShipSalesOrder', orderOfficial.salesOrder || firstOfficial.salesOrder || 'N/A');
    setText('requestToShipSelectedLineCount', String(dashboardState.requestDialogLines.length));
    const requestedShipWindow = document.getElementById('requestToShipWindow');
    if (requestedShipWindow) requestedShipWindow.value = DEFAULT_REQUESTED_SHIP_WINDOW;
    renderRequestToShipDialogLines();

    requestDialogReturnFocus = document.activeElement;
    dashboardState.requestDialogOpen = true;
    dialog.hidden = false;
    validateRequestToShipQuantity();
    const firstQuantityInput = getRequestLineQuantityInput(0);
    firstQuantityInput?.focus?.();
    firstQuantityInput?.select?.();
  }

  function buildRequestDialogLine(sourceWorkOrder, index) {
    const official = sourceWorkOrder?.official || {};
    const masterVpro5 = sourceWorkOrder?.masterRecord?.vpro5 || {};
    return {
      lineIndex: index,
      masterRecordKey: sourceWorkOrder?.masterRecordKey || '',
      customerNumber: official.customerNumber || masterVpro5.customerNumber || '',
      customer: official.customer || masterVpro5.customer || '',
      salesOrder: official.salesOrder || masterVpro5.salesOrder || '',
      salesOrderLine: official.sequenceLine || masterVpro5.sequenceLine || '',
      workOrder: official.workOrder || masterVpro5.workOrder || '',
      assembly: official.partNumber || masterVpro5.partNumber || '',
      description: official.description || masterVpro5.description || '',
      openQuantity: parseDashboardQuantity(official.opQtyOpen ?? masterVpro5.qtyOpen),
      dueDate: official.dueDate || masterVpro5.dueDate || '',
      sourceWorkOrder
    };
  }

  function renderRequestToShipDialogLines() {
    const target = document.getElementById('requestToShipLineRows');
    if (!target) return;

    target.innerHTML = dashboardState.requestDialogLines.map((line, index) => {
      const inputId = getRequestLineQuantityInputId(index);
      const validationId = 'requestToShipLineValidation-' + index;
      return [
        '<tr>',
        '<td>', escapeDashboardHtml(line.salesOrderLine || 'N/A'), '</td>',
        '<td>', escapeDashboardHtml(line.workOrder || 'Unknown'), '</td>',
        '<td>', escapeDashboardHtml(line.assembly || 'N/A'), '</td>',
        '<td>', escapeDashboardHtml(formatDashboardQuantity(line.openQuantity)), '</td>',
        '<td>',
        '<input class="sales-order-dashboard-request-quantity" id="', inputId,
        '" data-request-to-ship-quantity="true" data-request-line-index="', String(index),
        '" type="number" min="0" max="', escapeDashboardHtml(formatDashboardQuantity(line.openQuantity)),
        '" step="any" required value="', escapeDashboardHtml(formatDashboardQuantity(line.openQuantity)),
        '" aria-describedby="', validationId, '" oninput="validateRequestToShipQuantity()">',
        '<div id="', validationId, '" class="sales-order-dashboard-request-line-validation"></div>',
        '</td>',
        '</tr>'
      ].join('');
    }).join('');
  }

  function getRequestLineQuantityInputId(index) {
    return index === 0 ? 'requestToShipQuantity' : 'requestToShipQuantity-' + index;
  }

  function getRequestLineQuantityInput(index) {
    return document.getElementById(getRequestLineQuantityInputId(index));
  }

  function cancelRequestToShipDialog() {
    const dialog = document.getElementById('requestToShipDialog');
    if (dialog) dialog.hidden = true;
    dashboardState.requestDialogOpen = false;
    dashboardState.requestDialogLines = [];
    setText('requestToShipValidation', '');
    requestDialogReturnFocus?.focus?.();
    requestDialogReturnFocus = null;
  }

  function validateRequestToShipQuantity() {
    const sendButton = document.getElementById('sendRequestToShippingButton');
    const requestedShipWindow = String(document.getElementById('requestToShipWindow')?.value || '').trim();
    const hasValidRequestedShipWindow = REQUESTED_SHIP_WINDOWS.includes(requestedShipWindow);
    const lines = dashboardState.requestDialogLines.map((line, index) => {
      const quantityInput = getRequestLineQuantityInput(index);
      const requestedQuantity = parseDashboardQuantity(quantityInput?.value);
      let message = '';

      if (!quantityInput?.value || requestedQuantity <= 0) {
        message = 'Quantity must be greater than zero.';
      } else if (requestedQuantity > line.openQuantity) {
        message = 'Quantity cannot exceed ' + formatDashboardQuantity(line.openQuantity) + '.';
      }

      setText('requestToShipLineValidation-' + index, message);
      quantityInput?.setAttribute?.('aria-invalid', message ? 'true' : 'false');
      return {
        ...line,
        requestedQuantity,
        valid: !message,
        message
      };
    });
    const invalidLineCount = lines.filter(line => !line.valid).length;
    const message = !hasValidRequestedShipWindow
      ? 'Select a Requested Ship Window.'
      : !lines.length
      ? 'Select at least one Sales Order line.'
      : invalidLineCount
        ? 'Correct ' + invalidLineCount + ' invalid line ' + (invalidLineCount === 1 ? 'quantity.' : 'quantities.')
        : '';

    setText('requestToShipValidation', message);
    if (sendButton) sendButton.disabled = !!message;
    return {
      valid: !message,
      message,
      lines,
      requestedShipWindow,
      requestedQuantity: lines[0]?.requestedQuantity || 0,
      openQuantity: lines[0]?.openQuantity || 0
    };
  }

  function sendRequestToShipping(event) {
    event?.preventDefault?.();
    const validation = validateRequestToShipQuantity();
    if (!validation.valid || !validation.lines.length) return;

    if (typeof window.ShippingWorkspace?.openRequest !== 'function') {
      console.error('Shipping Workspace is not available.');
      return;
    }

    const requestLines = validation.lines.map(line => ({
      masterRecordKey: line.masterRecordKey,
      customerNumber: line.customerNumber,
      customer: line.customer,
      salesOrder: line.salesOrder,
      salesOrderLine: line.salesOrderLine,
      sequenceLine: line.salesOrderLine,
      workOrder: line.workOrder,
      assembly: line.assembly,
      partNumber: line.assembly,
      description: line.description,
      openQuantity: line.openQuantity,
      qtyRequested: line.requestedQuantity,
      dueDate: line.dueDate,
      sourceWorkOrder: line.sourceWorkOrder
    }));
    const firstLine = requestLines[0];
    const totalOpenQuantity = requestLines.reduce((total, line) => total + line.openQuantity, 0);
    const totalRequestedQuantity = requestLines.reduce((total, line) => total + line.qtyRequested, 0);
    const requestToShip = {
      requestId: createTemporaryRequestId(),
      requestType: 'Request To Ship',
      requestedBy: 'Operations',
      requestDateTime: new Date().toISOString(),
      customerNumber: firstLine.customerNumber,
      customer: firstLine.customer,
      salesOrder: firstLine.salesOrder,
      salesOrderLine: requestLines.length === 1 ? firstLine.salesOrderLine : requestLines.length + ' lines',
      workOrder: requestLines.length === 1 ? firstLine.workOrder : requestLines.length + ' work orders',
      assembly: requestLines.length === 1 ? firstLine.assembly : requestLines.length + ' assemblies',
      openQuantity: totalOpenQuantity,
      qtyRequested: totalRequestedQuantity,
      dueDate: summarizeRequestDueDates(requestLines),
      requestedShipWindow: validation.requestedShipWindow,
      status: 'Pending Shipping',
      lineCount: requestLines.length,
      lines: requestLines,
      sourceWorkOrder: firstLine.sourceWorkOrder,
      sourceWorkOrders: requestLines.map(line => line.sourceWorkOrder)
    };

    cancelRequestToShipDialog();
    window.ShippingWorkspace.openRequest(requestToShip);
  }

  function summarizeRequestDueDates(lines) {
    const dueDates = Array.from(new Set(lines.map(line => String(line.dueDate || '').trim()).filter(Boolean)));
    if (!dueDates.length) return '';
    return dueDates.length === 1 ? dueDates[0] : 'Multiple';
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

  function setOperationalStatus(id, value) {
    const element = document.getElementById(id);
    if (!element) return;

    const presentation = getOperationalStatusPresentation(value);
    element.textContent = presentation.label || 'N/A';
    element.classList.toggle('dle-operational-status-badge', presentation.isPacking);
    element.classList.toggle('dle-operational-status-packing', presentation.isPacking);
  }

  function renderOperationalStatus(value, baseClass) {
    const presentation = getOperationalStatusPresentation(value);
    const classes = [baseClass, presentation.className].filter(Boolean).join(' ');
    return '<span class="' + classes + '">' + escapeDashboardHtml(presentation.label || 'N/A') + '</span>';
  }

  function getOperationalStatusPresentation(value) {
    if (typeof window.OperationsCenter?.viewModel?.getOperationalStatusPresentation === 'function') {
      return window.OperationsCenter.viewModel.getOperationalStatusPresentation(value);
    }

    const status = String(value ?? '').trim();
    const isPacking = status.toLowerCase() === 'packing';
    return {
      label: isPacking ? '\u{1F7E8} Packing' : status,
      isPacking,
      className: isPacking
        ? 'dle-operational-status-badge dle-operational-status-packing'
        : ''
    };
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
  window.SalesOrderDashboard.getState = () => ({
    ...dashboardState,
    selectedWorkOrders: dashboardState.selectedWorkOrders.slice(),
    requestDialogLines: dashboardState.requestDialogLines.slice()
  });
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

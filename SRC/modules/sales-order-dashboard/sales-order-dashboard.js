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
    requestDialogOpen: false,
    approvalReviews: new Map(),
    approvalReviewRow: null,
    approvalRequestGeneration: 0,
    approvalSubmitting: false,
    approvalReasonState: null
  };
  const REQUESTED_SHIP_WINDOWS = Object.freeze(['Today', 'Tomorrow', 'This Week', 'No Rush']);
  const DEFAULT_REQUESTED_SHIP_WINDOW = REQUESTED_SHIP_WINDOWS[0];
  let requestDialogReturnFocus = null;
  let approvalDialogReturnFocus = null;
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
    dashboardState.approvalReviews.clear();
    dashboardState.approvalReviewRow = null;
    dashboardState.approvalReasonState = null;
    const generation = ++dashboardState.approvalRequestGeneration;
    renderSalesOrderDashboardModule();
    loadSelectedOrderApprovalReviews(generation);
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
      const presentation = getWorkOrderPresentation(row);
      const workOrderControl = renderWorkOrderPresentation(presentation, index);
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
        workOrderControl,
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
    const presentation = getWorkOrderPresentation(row);
    return presentation.actionable;
  }

  function getWorkOrderRelationship(row) {
    return row?.official?.workOrderRelationship || row?.masterRecord?.workOrderRelationship || {};
  }

  function getWorkOrderPresentation(row) {
    const approvalReview = getApprovalReview(row);
    const approved = approvalReview?.currentApproval?.approvedWorkOrderNumber;
    if (approved) {
      const classification = String(approvalReview.conflictClassification || 'APPROVED_NOT_IN_CURRENT_CANDIDATES');
      const details = {
        APPROVED_AGREES_EXACT: ['Approved · ERP Agrees', true, 'approved', ''],
        APPROVED_SUPPORTED_CANDIDATE: ['Approved · Candidate Supported', true, 'approved', ''],
        APPROVED_CONFLICTS_EXACT: ['Approved · ERP Conflict', false, 'conflict', 'Approval conflicts with the current exact ERP Work Order. Review is required.'],
        APPROVED_NOT_IN_CURRENT_CANDIDATES: ['Approved · Unsupported', false, 'conflict', 'Approved Work Order is not supported by current canonical candidates.'],
        APPROVED_WORK_ORDER_MISSING: ['Approved · WO Missing', false, 'conflict', 'Approved Work Order is missing from the canonical Work Order dataset.'],
        APPROVED_WITH_CURRENT_AMBIGUITY: ['Approved · Ambiguous', false, 'conflict', 'Approved Work Order remains one of multiple canonical candidates. Review is required.']
      }[classification] || ['Approved · Review Required', false, 'conflict', 'Approval state is not recognized. Review is required.'];
      return createWorkOrderPresentation(classification, approved, ...details);
    }
    const relationship = getWorkOrderRelationship(row);
    const status = String(relationship.status || 'UNRESOLVED').trim();
    const candidates = Array.isArray(relationship.candidates) ? relationship.candidates : [];
    const candidateNumbers = candidates
      .map(candidate => String(candidate?.workOrderNumber || '').trim())
      .filter(Boolean);
    const declaredCount = Number.isInteger(relationship.candidateCount) &&
      relationship.candidateCount >= 0
      ? relationship.candidateCount
      : null;
    if (status === 'EXACT_LINE_UNIQUE') {
      const workOrderNumber = String(relationship.actionableWorkOrderNumber || '').trim();
      if (workOrderNumber) {
        return createWorkOrderPresentation(
          status, workOrderNumber, 'ERP Confirmed', true, 'confirmed', ''
        );
      }
      return createWorkOrderPresentation(
        status, '\u2014', 'Exact Relationship Invalid', false, 'unknown',
        'Request to Ship is blocked because the exact relationship has no actionable Work Order.'
      );
    }
    if (status === 'AMBIGUOUS') {
      const countIsConsistent = declaredCount !== null && declaredCount > 1 &&
        candidateNumbers.length === declaredCount && candidates.length === declaredCount;
      return createWorkOrderPresentation(
        status,
        countIsConsistent ? 'Conflict (' + declaredCount + ')' : 'Conflict',
        'Review Required',
        false,
        'conflict',
        'Request to Ship is blocked because the Work Order relationship is ambiguous.'
      );
    }
    if (status === 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE' ||
        status === 'SALES_ORDER_LEVEL_CANDIDATE') {
      const candidateIsConsistent = candidates.length === 1 &&
        candidateNumbers.length === 1 &&
        (declaredCount === null || declaredCount === 1);
      const reason = status === 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE'
        ? 'Request to Ship is blocked because the Work Order is an inferred item candidate.'
        : 'Request to Ship is blocked because only Sales Order-level evidence exists.';
      if (candidateIsConsistent) {
        return createWorkOrderPresentation(
          status, candidateNumbers[0], 'Candidate', false, 'candidate', reason
        );
      }
      return createWorkOrderPresentation(
        status,
        candidateNumbers.length > 1 ? 'Conflict' : '\u2014',
        candidateNumbers.length > 1 ? 'Candidate Data Conflict' : 'Candidate Unavailable',
        false,
        candidateNumbers.length > 1 ? 'conflict' : 'unknown',
        'Request to Ship is blocked because the unique candidate data is incomplete or inconsistent.'
      );
    }
    if (status === 'UNRESOLVED') {
      return createWorkOrderPresentation(
        status, '\u2014', 'No Candidate', false, 'unresolved',
        'Request to Ship is blocked because no governed Work Order relationship was found.'
      );
    }
    return createWorkOrderPresentation(
      status || 'UNKNOWN', '\u2014', 'Unknown Relationship', false, 'unknown',
      'Request to Ship is blocked because the Work Order relationship status is not recognized.'
    );
  }

  function createWorkOrderPresentation(status, primary, secondary, actionable, kind, reason) {
    return { status, primary, secondary, label: primary, actionable, kind, reason };
  }

  function renderWorkOrderPresentation(presentation, index) {
    const primary = presentation.actionable
      ? [
          '<button type="button" class="sales-order-dashboard-work-order-link sales-order-dashboard-work-order-primary"',
          ' data-related-row-index="', String(index),
          '" aria-label="', escapeDashboardHtml(
            presentation.primary + ', ' + presentation.secondary + '. Open Work Order Dashboard.'
          ),
          '" onclick="openSalesOrderDashboardWorkOrder(event)">',
          escapeDashboardHtml(presentation.primary),
          '</button>'
        ].join('')
      : '<span class="sales-order-dashboard-work-order-primary">' +
        escapeDashboardHtml(presentation.primary) + '</span>';
    return [
      '<div class="sales-order-dashboard-work-order-presentation sales-order-dashboard-work-order-',
      escapeDashboardHtml(presentation.kind),
      '" title="', escapeDashboardHtml(presentation.reason), '">',
      primary,
      '<span class="sales-order-dashboard-work-order-secondary">',
      escapeDashboardHtml(presentation.secondary),
      '</span>',
      '<button type="button" class="sales-order-dashboard-work-order-review" data-related-row-index="',
      String(index),
      '" onclick="openWorkOrderApprovalReview(event)" aria-label="Review Work Order relationship for this Sales Order line">Review</button>',
      '</div>'
    ].join('');
  }

  function updateRequestToShipAction() {
    const button = document.getElementById('salesOrderDashboardCreateRequestToShipButton');
    if (!button) return;

    const selectedRows = dashboardState.selectedWorkOrders;
    const enabled = selectedRows.length > 0 && selectedRows.every(isValidWorkOrder);
    button.disabled = !enabled;
    const blocked = selectedRows.find(row => !isValidWorkOrder(row));
    button.title = enabled
      ? 'Create one Request to Ship for the selected Sales Order line' + (selectedRows.length === 1 ? '.' : 's.')
      : blocked
        ? getWorkOrderPresentation(blocked).reason
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
    if (!selectedRow || !isValidWorkOrder(selectedRow)) return;

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

  function getApprovalLineIdentity(row) {
    const official = row?.official || {};
    const source = row?.masterRecord?.vpro5 || {};
    return {
      customerNumber: String(official.customerNumber || source.customerNumber || '').trim(),
      salesOrderNumber: String(official.salesOrder || source.salesOrder || '').trim(),
      lineNumber: String(official.sequenceLine || source.sequenceLine || '').trim()
    };
  }

  function getApprovalKey(row) {
    const identity = getApprovalLineIdentity(row);
    return [identity.customerNumber, identity.salesOrderNumber, identity.lineNumber].join('|');
  }

  function getApprovalReview(row) {
    return dashboardState.approvalReviews.get(getApprovalKey(row)) || null;
  }

  async function loadSelectedOrderApprovalReviews(generation) {
    if (!window.DleApiClient?.getWorkOrderApprovalReview) return;
    await Promise.all(getRelatedRows().map(async row => {
      const identity = getApprovalLineIdentity(row);
      if (!identity.customerNumber || !identity.salesOrderNumber || !identity.lineNumber) return;
      try {
        const review = await window.DleApiClient.getWorkOrderApprovalReview(
          identity.customerNumber, identity.salesOrderNumber, identity.lineNumber
        );
        if (generation !== dashboardState.approvalRequestGeneration) return;
        dashboardState.approvalReviews.set(getApprovalKey(row), review);
      } catch (error) {
        console.warn('Governed Work Order approval state is unavailable for ' + getApprovalKey(row) + '.', error);
      }
    }));
    if (generation === dashboardState.approvalRequestGeneration) renderSalesOrderDashboardModule();
  }

  async function openWorkOrderApprovalReview(event) {
    event?.stopPropagation();
    const index = Number((event?.currentTarget || event?.target)?.dataset?.relatedRowIndex);
    const row = getRelatedRows()[index];
    if (!row) return;
    dashboardState.approvalReviewRow = row;
    dashboardState.approvalReasonState = null;
    approvalDialogReturnFocus = event?.currentTarget || null;
    const dialog = document.getElementById('workOrderApprovalDialog');
    if (dialog) dialog.hidden = false;
    setText('workOrderApprovalMessage', 'Loading current governed evidence…');
    try {
      const identity = getApprovalLineIdentity(row);
      const review = await window.DleApiClient.getWorkOrderApprovalReview(
        identity.customerNumber, identity.salesOrderNumber, identity.lineNumber
      );
      dashboardState.approvalReviews.set(getApprovalKey(row), review);
      renderSalesOrderDashboardModule();
      renderWorkOrderApprovalDialog(review, row);
    } catch (error) {
      setText('workOrderApprovalMessage', error.message || 'Approval evidence could not be loaded.');
    }
  }

  function normalizeApprovalIdentity(value, width) {
    const text = String(value || '').trim();
    return /^\d+$/.test(text) ? text.padStart(width, '0') : text;
  }

  function getCanonicalApprovalChoices(review) {
    const values = Array.isArray(review?.availableApprovalChoices)
      ? review.availableApprovalChoices : [];
    return [...new Set(values.map(value => normalizeApprovalIdentity(value, 7))
      .filter(value => /^\d{7}$/.test(value)))];
  }

  function getDefaultApprovalWorkOrder(review) {
    const status = String(review?.canonicalRelationship?.resolutionStatus ||
      review?.canonicalRelationship?.status || '').trim();
    const choices = getCanonicalApprovalChoices(review);
    if (review?.currentApproval || status === 'AMBIGUOUS' || choices.length !== 1) return null;
    return choices[0];
  }

  function getApprovalReasonRecommendation(row, selectedWorkOrder, relatedRows, options = {}) {
    const selected = normalizeApprovalIdentity(selectedWorkOrder, 7);
    if (!selected) return null;
    const identity = getApprovalLineIdentity(row);
    const customer = normalizeApprovalIdentity(identity.customerNumber, 6);
    const salesOrder = normalizeApprovalIdentity(identity.salesOrderNumber, 7);
    const line = normalizeApprovalIdentity(identity.lineNumber, 3);
    const references = (Array.isArray(relatedRows) ? relatedRows : []).flatMap(related => {
      const relatedIdentity = getApprovalLineIdentity(related);
      const relationship = getWorkOrderRelationship(related);
      const status = String(relationship.resolutionStatus || relationship.status || '').trim();
      const exactWorkOrder = normalizeApprovalIdentity(relationship.actionableWorkOrderNumber, 7);
      const relatedLine = normalizeApprovalIdentity(relatedIdentity.lineNumber, 3);
      const sameOrder = normalizeApprovalIdentity(relatedIdentity.customerNumber, 6) === customer &&
        normalizeApprovalIdentity(relatedIdentity.salesOrderNumber, 7) === salesOrder;
      return sameOrder && relatedLine !== line && status === 'EXACT_LINE_UNIQUE' &&
        exactWorkOrder === selected ? [relatedLine] : [];
    }).filter(Boolean).sort();
    if (references.length) {
      const distinctLines = [...new Set(references)];
      return {
        code: 'MATCHES_CONFIRMED_WO_ON_SAME_SALES_ORDER',
        referenceLines: distinctLines,
        referenceText: distinctLines.length === 1
          ? 'Confirmed reference: Line ' + distinctLines[0] + ' · WO ' + selected
          : 'Confirmed on lines ' + distinctLines.join(', ') + ' · WO ' + selected
      };
    }
    if (options.ambiguous && !options.explicitSelection) return null;
    return { code: 'CANDIDATE_EVIDENCE_VERIFIED', referenceLines: [], referenceText: '' };
  }

  function initializeApprovalReasonState(review, row) {
    const permissions = review?.permissions || {};
    const action = review?.currentApproval
      ? (permissions.canReplace ? 'replace' : 'revoke')
      : 'approve';
    dashboardState.approvalReasonState = {
      action,
      selectedWorkOrder: getDefaultApprovalWorkOrder(review),
      reasonCode: '',
      manuallySelected: false,
      recommendation: null,
      rowKey: getApprovalKey(row)
    };
  }

  function getReasonCatalog(review, action) {
    const key = action === 'revoke' ? 'revocation' : 'approval';
    return Array.isArray(review?.reasonCatalogs?.[key]) ? review.reasonCatalogs[key] : [];
  }

  function updateApprovalReasonControls(review, row, selectedWorkOrder, selectionChanged = false) {
    const state = dashboardState.approvalReasonState;
    if (!state) return;
    const relationship = review?.canonicalRelationship || {};
    const selected = String(selectedWorkOrder || '').trim();
    if (selectionChanged && selected !== state.selectedWorkOrder) {
      state.selectedWorkOrder = selected;
      state.manuallySelected = false;
      state.reasonCode = '';
    }
    const isRevoke = state.action === 'revoke';
    state.recommendation = isRevoke ? null : getApprovalReasonRecommendation(
      row, selected, getRelatedRows(), {
        ambiguous: String(relationship.resolutionStatus || relationship.status || '') === 'AMBIGUOUS',
        explicitSelection: Boolean(selected)
      }
    );
    if (!state.manuallySelected) state.reasonCode = state.recommendation?.code || '';
    setText('workOrderApprovalSelected', isRevoke ? '—' : selected || '—');

    const reasonSelect = document.getElementById('workOrderApprovalReasonCode');
    const catalog = getReasonCatalog(review, state.action);
    if (reasonSelect) {
      reasonSelect.innerHTML = '<option value="">Select a reason</option>' + catalog.map(reason =>
        '<option value="' + escapeDashboardHtml(reason.code) + '">' +
        escapeDashboardHtml(reason.label) + '</option>'
      ).join('');
      reasonSelect.value = state.reasonCode;
    }
    const recommendation = document.getElementById('workOrderApprovalRecommendation');
    if (recommendation) {
      const recommendationApplies = state.recommendation &&
        state.reasonCode === state.recommendation.code;
      recommendation.hidden = !recommendationApplies;
      recommendation.textContent = recommendationApplies
        ? 'Recommended by DLE-OS' + (state.recommendation.referenceText
          ? ' · ' + state.recommendation.referenceText : '')
        : '';
    }
    const note = document.getElementById('workOrderApprovalNote');
    const isOther = state.reasonCode === 'OTHER';
    setText('workOrderApprovalNoteLabel', isOther ? 'Explanation' : 'Additional note (optional)');
    if (note) note.required = isOther;
  }

  function changeWorkOrderApprovalCandidate(event) {
    const row = dashboardState.approvalReviewRow;
    const review = getApprovalReview(row);
    updateApprovalReasonControls(review, row, event?.target?.value, true);
  }

  function changeWorkOrderApprovalReason() {
    const state = dashboardState.approvalReasonState;
    if (!state) return;
    state.reasonCode = String(document.getElementById('workOrderApprovalReasonCode')?.value || '');
    state.manuallySelected = true;
    const note = document.getElementById('workOrderApprovalNote');
    const isOther = state.reasonCode === 'OTHER';
    setText('workOrderApprovalNoteLabel', isOther ? 'Explanation' : 'Additional note (optional)');
    if (note) note.required = isOther;
  }

  function changeWorkOrderApprovalAction() {
    const state = dashboardState.approvalReasonState;
    const row = dashboardState.approvalReviewRow;
    if (!state || !row) return;
    state.action = String(document.getElementById('workOrderApprovalActionMode')?.value || state.action);
    state.reasonCode = '';
    state.manuallySelected = false;
    const selected = document.querySelector('input[name="workOrderApprovalChoice"]:checked')?.value || '';
    updateApprovalActionVisibility(getApprovalReview(row));
    updateApprovalReasonControls(getApprovalReview(row), row, selected, false);
  }

  function updateApprovalActionVisibility(review) {
    const action = dashboardState.approvalReasonState?.action;
    toggleApprovalAction('workOrderApprovalApprove', action === 'approve' && review?.permissions?.canApprove);
    toggleApprovalAction('workOrderApprovalReplace', action === 'replace' && review?.permissions?.canReplace);
    toggleApprovalAction('workOrderApprovalRevoke', action === 'revoke' && review?.permissions?.canRevoke);
    const candidates = document.querySelector('.sales-order-dashboard-approval-candidates');
    if (candidates) candidates.disabled = action === 'revoke';
  }

  function renderWorkOrderApprovalDialog(review, row) {
    const initializingReasonState = !dashboardState.approvalReasonState ||
      dashboardState.approvalReasonState.rowKey !== getApprovalKey(row);
    if (initializingReasonState) {
      initializeApprovalReasonState(review, row);
      const note = document.getElementById('workOrderApprovalNote');
      if (note) note.value = '';
    }
    const identity = getApprovalLineIdentity(row);
    const relationship = review?.canonicalRelationship || {};
    const candidates = Array.isArray(relationship.candidates) ? relationship.candidates : [];
    const choices = getCanonicalApprovalChoices(review);
    setText('workOrderApprovalCustomer', row?.official?.customer || identity.customerNumber);
    setText('workOrderApprovalSalesOrder', identity.salesOrderNumber);
    setText('workOrderApprovalLine', identity.lineNumber);
    setText('workOrderApprovalItem', row?.official?.partNumber || relationship.salesOrderItemNumber || 'N/A');
    setText('workOrderApprovalRelationshipStatus', relationship.resolutionStatus || relationship.status || 'UNRESOLVED');
    setText('workOrderApprovalExact', relationship.actionableWorkOrderNumber || '—');
    setText('workOrderApprovalCurrent', review?.currentApproval?.approvedWorkOrderNumber || '—');
    setText('workOrderApprovalBy', review?.currentApproval?.approvedBy || '—');
    setText('workOrderApprovalAt', review?.currentApproval?.approvedAtUtc || '—');
    setText('workOrderApprovalClassification', review?.conflictClassification || 'NO_APPROVAL');
    const candidateList = document.getElementById('workOrderApprovalCandidates');
    if (candidateList) {
      candidateList.innerHTML = candidates.length ? candidates.map(candidate => {
        const number = normalizeApprovalIdentity(candidate.workOrderNumber, 7);
        const selectable = choices.includes(number);
        const selected = selectable &&
          dashboardState.approvalReasonState?.selectedWorkOrder === number;
        return '<li>' + (selectable
          ? '<label><input type="radio" name="workOrderApprovalChoice" onchange="changeWorkOrderApprovalCandidate(event)" value="' +
            escapeDashboardHtml(number) + '"' + (selected ? ' checked' : '') + '> '
          : '<span>') +
          '<strong>' + escapeDashboardHtml(number || 'Unknown') + '</strong> · ' +
          escapeDashboardHtml(candidate.itemNumber || 'No item') + ' · anchor ' +
          escapeDashboardHtml(candidate.anchorSalesOrderLine || '—') +
          (selectable ? '</label>' : '</span>') + '</li>';
      }).join('') : '<li>— No canonical candidates</li>';
    }
    const history = document.getElementById('workOrderApprovalHistory');
    if (history) {
      const events = Array.isArray(review?.decisionHistory) ? review.decisionHistory : [];
      history.innerHTML = events.length ? events.map(decision =>
        '<li><strong>' + escapeDashboardHtml(decision.decisionAction) + '</strong> ' +
        escapeDashboardHtml(decision.approvedWorkOrderNumber || '—') + ' · ' +
        escapeDashboardHtml(decision.approvedBy) + ' · ' +
        escapeDashboardHtml(decision.approvedAtUtc) + '<br>' +
        escapeDashboardHtml(decision.decisionReason) +
        (decision.decisionReasonCode ? ' <code>' + escapeDashboardHtml(decision.decisionReasonCode) + '</code>' : '') +
        (decision.decisionNote ? '<br><span>Note: ' + escapeDashboardHtml(decision.decisionNote) + '</span>' : '') + '</li>'
      ).join('') : '<li>No decisions recorded.</li>';
    }
    const actionSelect = document.getElementById('workOrderApprovalActionMode');
    const actionField = document.getElementById('workOrderApprovalActionField');
    const actions = [
      review?.permissions?.canApprove && ['approve', 'Approve'],
      review?.permissions?.canReplace && ['replace', 'Replace approval'],
      review?.permissions?.canRevoke && ['revoke', 'Revoke approval']
    ].filter(Boolean);
    if (actionSelect) {
      actionSelect.innerHTML = actions.map(([value, label]) => '<option value="' + value + '">' + label + '</option>').join('');
      actionSelect.value = dashboardState.approvalReasonState.action;
    }
    if (actionField) actionField.hidden = actions.length < 2;
    updateApprovalActionVisibility(review);
    updateApprovalReasonControls(review, row, dashboardState.approvalReasonState.selectedWorkOrder, false);
    setText('workOrderApprovalMessage', 'Review current canonical evidence before recording a decision.');
    document.getElementById('workOrderApprovalReasonCode')?.focus();
  }

  function toggleApprovalAction(id, visible) {
    const button = document.getElementById(id);
    if (button) button.hidden = !visible;
  }

  async function submitWorkOrderApproval(event) {
    event.preventDefault();
    if (dashboardState.approvalSubmitting) return;
    const action = event.submitter?.dataset?.approvalAction;
    if (!['approve', 'replace', 'revoke'].includes(action)) return;
    const row = dashboardState.approvalReviewRow;
    const review = getApprovalReview(row);
    const reasonCode = String(document.getElementById('workOrderApprovalReasonCode')?.value || '').trim();
    const decisionNote = String(document.getElementById('workOrderApprovalNote')?.value || '').trim();
    const selected = document.querySelector('input[name="workOrderApprovalChoice"]:checked')?.value || null;
    if (!reasonCode) {
      setText('workOrderApprovalMessage', 'Select a controlled decision reason.');
      return;
    }
    if (reasonCode === 'OTHER' && decisionNote.length < 3) {
      setText('workOrderApprovalMessage', 'Enter an explanation of at least three characters.');
      return;
    }
    if (action !== 'revoke' && !selected) {
      setText('workOrderApprovalMessage', 'Select one current canonical Work Order choice.');
      return;
    }
    dashboardState.approvalSubmitting = true;
    document.querySelectorAll('#workOrderApprovalDialog button').forEach(button => { button.disabled = true; });
    try {
      const identity = getApprovalLineIdentity(row);
      const updated = await window.DleApiClient.submitWorkOrderApprovalAction(
        identity.customerNumber, identity.salesOrderNumber, identity.lineNumber, action,
        {
          selectedWorkOrderNumber: selected,
          reasonCode,
          reasonText: reasonCode === 'OTHER' ? decisionNote :
            document.getElementById('workOrderApprovalReasonCode')?.selectedOptions?.[0]?.textContent,
          decisionNote: reasonCode === 'OTHER' ? null : decisionNote || null,
          evidenceToken: review.evidenceToken,
          expectedCurrentDecisionId: review.currentApproval?.decisionId || null
        }
      );
      dashboardState.approvalReviews.set(getApprovalKey(row), updated);
      dashboardState.approvalReasonState = null;
      renderSalesOrderDashboardModule();
      renderWorkOrderApprovalDialog(updated, row);
      setText('workOrderApprovalMessage', 'The governed decision was recorded.');
    } catch (error) {
      if (error.status === 409) {
        setText('workOrderApprovalMessage', 'Evidence changed. Reloading the current relationship for review…');
        await openWorkOrderApprovalReview({ currentTarget: approvalDialogReturnFocus, stopPropagation() {} });
      } else {
        setText('workOrderApprovalMessage', error.message || 'The governed decision could not be recorded.');
      }
    } finally {
      dashboardState.approvalSubmitting = false;
      document.querySelectorAll('#workOrderApprovalDialog button').forEach(button => { button.disabled = false; });
    }
  }

  function closeWorkOrderApprovalReview() {
    const dialog = document.getElementById('workOrderApprovalDialog');
    if (dialog) dialog.hidden = true;
    dashboardState.approvalReviewRow = null;
    dashboardState.approvalReasonState = null;
    approvalDialogReturnFocus?.focus?.();
  }

  function handleWorkOrderApprovalKeydown(event) {
    if (event?.key === 'Escape' && !document.getElementById('workOrderApprovalDialog')?.hidden)
      closeWorkOrderApprovalReview();
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
  window.SalesOrderDashboard.getWorkOrderPresentation = getWorkOrderPresentation;
  window.SalesOrderDashboard.openWorkOrderApprovalReview = openWorkOrderApprovalReview;
  window.SalesOrderDashboard.getApprovalReasonRecommendation = getApprovalReasonRecommendation;
  window.SalesOrderDashboard.getCanonicalApprovalChoices = getCanonicalApprovalChoices;
  window.SalesOrderDashboard.getDefaultApprovalWorkOrder = getDefaultApprovalWorkOrder;
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
  window.openWorkOrderApprovalReview = openWorkOrderApprovalReview;
  window.closeWorkOrderApprovalReview = closeWorkOrderApprovalReview;
  window.submitWorkOrderApproval = submitWorkOrderApproval;
  window.changeWorkOrderApprovalCandidate = changeWorkOrderApprovalCandidate;
  window.changeWorkOrderApprovalReason = changeWorkOrderApprovalReason;
  window.changeWorkOrderApprovalAction = changeWorkOrderApprovalAction;
  window.renderSalesOrderDashboardModule = renderSalesOrderDashboardModule;

  document.addEventListener('keydown', handleRequestToShipDialogKeydown);
  document.addEventListener('keydown', handleWorkOrderApprovalKeydown);
})();

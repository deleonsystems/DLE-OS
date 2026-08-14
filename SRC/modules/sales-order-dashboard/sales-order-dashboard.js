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
    reviewCandidateMode: false,
    rmaSelection: new Map(),
    rmaMemberships: new Map(),
    rmaCases: new Map(),
    rmaReview: null,
    rmaMatch: null,
    rmaWorkflowMode: 'group',
    rmaSingleRow: null,
    lineReviewRow: null,
    lineReviewTrigger: null,
    rmaSubmitting: false,
    rmaRequestGeneration: 0
  };
  const REQUESTED_SHIP_WINDOWS = Object.freeze(['Today', 'Tomorrow', 'This Week', 'No Rush']);
  const DEFAULT_REQUESTED_SHIP_WINDOW = REQUESTED_SHIP_WINDOWS[0];
  const WORK_ORDER_APPROVAL_REASON_SCHEMA = 'DLE_WORK_ORDER_APPROVAL_REASON_V1';
  const WORK_ORDER_APPROVAL_REASONS = Object.freeze([
    Object.freeze({ code: 'ERP_CONFIRMED_CANDIDATE_MATCH', label: 'ERP confirmed and candidate matches' }),
    Object.freeze({ code: 'SALES_ORDER_ITEM_MATCH', label: 'Candidate matches Sales Order and item' }),
    Object.freeze({ code: 'HISTORICAL_RELATIONSHIP_VERIFIED', label: 'Historical relationship verified' }),
    Object.freeze({ code: 'SUPPORTING_DOCUMENTATION_VERIFIED', label: 'Work Order verified from supporting documentation' }),
    Object.freeze({ code: 'CUSTOMER_RMA_RELATIONSHIP_VERIFIED', label: 'Customer or RMA relationship verified' }),
    Object.freeze({ code: 'SUPERVISOR_REVIEW', label: 'Supervisor review' }),
    Object.freeze({ code: 'OTHER', label: 'Other' })
  ]);
  const NO_WORK_ORDER_REASON_SCHEMA = 'DLE_NO_WORK_ORDER_REQUIRED_REASON_V2';
  let requestDialogReturnFocus = null;
  let approvalDialogReturnFocus = null;
  let rmaDialogReturnFocus = null;
  let temporaryRequestSequence = 0;
  let operationalStateSubscription = null;
  let materialStatusSubscription = null;

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
    if (!operationalStateSubscription && window.DleApiClient?.subscribeOperationalLineStateChange) {
      operationalStateSubscription = window.DleApiClient.subscribeOperationalLineStateChange(detail => {
        const refresh = refreshChangedOperationalLines(detail.lines);
        detail.waitUntil?.(refresh);
        return refresh;
      });
    }
    if (!materialStatusSubscription && window.MaterialStatus?.subscribe) {
      materialStatusSubscription = window.MaterialStatus.subscribe(detail => {
        void refreshSelectedMaterialStatuses(detail.workOrderNumbers || []);
      });
    }
    renderSalesOrderDashboardModule();
  }

  async function refreshChangedOperationalLines(lines) {
    const selectedSalesOrder = String(dashboardState.selectedOrder?.official?.salesOrder || '').trim();
    if (!selectedSalesOrder || !(lines || []).some(line => line.salesOrderNumber === selectedSalesOrder)) return;
    dashboardState.approvalReviews.clear();
    const approvalGeneration = ++dashboardState.approvalRequestGeneration;
    const rmaGeneration = ++dashboardState.rmaRequestGeneration;
    await Promise.all([
      loadSelectedOrderApprovalReviews(approvalGeneration),
      loadSelectedOrderRmaMemberships(rmaGeneration)
    ]);
  }

  function setSelectedOrder(order) {
    dashboardState.selectedOrder = order || null;
    dashboardState.selectedWorkOrder = null;
    dashboardState.selectedWorkOrders = [];
    dashboardState.requestDialogLines = [];
    dashboardState.approvalReviews.clear();
    dashboardState.approvalReviewRow = null;
    if (!dashboardState.reviewCandidateMode) dashboardState.rmaSelection.clear();
    const generation = ++dashboardState.approvalRequestGeneration;
    const rmaGeneration = ++dashboardState.rmaRequestGeneration;
    renderSalesOrderDashboardModule();
    loadSelectedOrderApprovalReviews(generation);
    loadSelectedOrderRmaMemberships(rmaGeneration);
    void refreshSelectedMaterialStatuses([]);
  }

  function renderSalesOrderDashboardModule() {
    const status = document.getElementById('salesOrderDashboardStatus');
    if (status) {
      status.textContent = 'Sales Order Dashboard ready. Future digital Sales Order folder workflows will live here.';
    }
    renderSalesOrderSummary();
    renderRelatedWorkOrders();
    renderRmaReworkSummaries();
    updateRequestToShipAction();
    updateRmaReworkActions();
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
    setText('salesOrderSummaryMaterialStatus', getSalesOrderMaterialStatusSummary());
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
      const message = dashboardState.selectedOperationsRecord
        ? 'No active Sales Order lines remain. Shipped lines are available in Shipment Staging.'
        : 'Select a Sales Order from Operations Center.';
      rows.innerHTML = '<tr><td class="sales-order-dashboard-empty" colspan="6">' + message + '</td></tr>';
      return;
    }

    rows.innerHTML = relatedRows.map((row, index) => {
      const official = row.official || {};
      const rowClass = index % 2 === 0 ? 'rowEven' : 'rowOdd';
      const selected = dashboardState.selectedWorkOrders.includes(row);
      const presentation = getWorkOrderPresentation(row);
      const workOrderControl = renderWorkOrderPresentation(presentation, index);
      const identity = getApprovalLineIdentity(row);
      const lineKey = getApprovalKey(row);
      const membership = dashboardState.rmaMemberships.get(lineKey);
      const quantities = getRmaLineQuantities(row);
      const shipmentProjection = getShipmentProjection(row);
      const quantityDisplay = shipmentProjection.isPartiallyStaged
        ? formatDashboardQuantity(quantities.operationalQuantityOpen) +
          '<br><span class="sales-order-dashboard-shipment-pending">' +
          escapeDashboardHtml(formatDashboardQuantity(shipmentProjection.stagedQuantity)) +
          ' staged · awaiting ERP evidence</span>'
        : escapeDashboardHtml(formatDashboardQuantity(quantities.operationalQuantityOpen));
      const materialStatus = getRowMaterialStatus(row);
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
        '<td>', escapeDashboardHtml(identity.salesOrderNumber || 'N/A'), ' / ', escapeDashboardHtml(identity.lineNumber || 'N/A'), '</td>',
        '<td>',
        workOrderControl,
        '</td>',
        '<td>',
        escapeDashboardHtml(official.partNumber || 'N/A'), membership ? '<br><span class="sales-order-dashboard-rma-badge">RMA / Rework</span>' : '',
        '</td>',
        '<td>', quantityDisplay, '</td>',
        '<td>',
        escapeDashboardHtml(official.dueDate || 'N/A'),
        '</td>',
        '<td>',
        '<span class="sales-order-dashboard-status-pill">',
        escapeDashboardHtml(materialStatus?.label || getUnavailableMaterialStatusLabel(row)),
        '</span>',
        '</td>',
        '</tr>'
      ].join('');
    }).join('');
  }

  function getRowMaterialStatus(row) {
    return row?.masterRecord?.materialStatus || null;
  }

  function getUnavailableMaterialStatusLabel(row) {
    const presentation = getWorkOrderPresentation(row);
    return presentation.actionable ? 'Loading' :
      presentation.kind === 'conflict' || presentation.kind === 'candidate' || presentation.kind === 'unknown'
        ? 'Needs Relationship Resolution' : 'Not Applicable';
  }

  function getSalesOrderMaterialStatusSummary() {
    const rows = getRelatedRows();
    const actionable = rows.map(row => ({ row, workOrder: String(getWorkOrderPresentation(row).primary || '').trim() }))
      .filter(item => getWorkOrderPresentation(item.row).actionable && item.workOrder);
    const workOrders = new Set(actionable.map(item => item.workOrder));
    if (workOrders.size > 1) return 'Multiple Work Orders — see line status';
    if (workOrders.size === 1) return getRowMaterialStatus(actionable[0].row)?.label || 'Loading';
    return rows.length ? 'Needs Relationship Resolution' : 'N/A';
  }

  async function refreshSelectedMaterialStatuses(changedWorkOrders) {
    const rows = getRelatedRows();
    if (!rows.length || !window.MaterialStatus?.getMany) return;
    const targets = rows.map(row => ({ row, presentation: getWorkOrderPresentation(row) }))
      .filter(item => item.presentation.actionable && /^\d+$/.test(String(item.presentation.primary || '')));
    const normalizedChanges = new Set((changedWorkOrders || []).map(value =>
      window.MaterialStatus.normalizeWorkOrderNumber(value)).filter(Boolean));
    if (normalizedChanges.size && !targets.some(item => normalizedChanges.has(
      window.MaterialStatus.normalizeWorkOrderNumber(item.presentation.primary)))) return;
    const statuses = await window.MaterialStatus.getMany(targets.map(item => item.presentation.primary));
    targets.forEach(item => {
      const workOrderNumber = window.MaterialStatus.normalizeWorkOrderNumber(item.presentation.primary);
      item.row.masterRecord = item.row.masterRecord || {};
      item.row.masterRecord.materialStatus = statuses.get(workOrderNumber) || null;
      item.row.official = item.row.official || {};
      item.row.official.materialStatus = item.row.masterRecord.materialStatus?.label || '';
    });
    renderSalesOrderDashboardModule();
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
    return presentation.fulfillmentEligible;
  }

  function getWorkOrderRelationship(row) {
    return row?.official?.workOrderRelationship || row?.masterRecord?.workOrderRelationship || {};
  }

  function getWorkOrderPresentation(row) {
    const operational = getApprovalReview(row)?.operationalRelationship;
    if (operational) {
      const active = String(operational.activeWorkOrderNumber || '').trim();
      if (active) {
        const source = String(operational.activeWorkOrderSource || '').trim();
        const secondary = source === 'RMA_DECISION' ? 'RMA / Rework Assigned' :
          source === 'APPROVED' ? 'Approved' : 'ERP Confirmed';
        return createWorkOrderPresentation(
          String(operational.operationalStatus || 'ACTIVE_PRODUCTION_WORK_ORDER'),
          active, secondary, true, source === 'RMA_DECISION' ? 'rma-controlled' : 'confirmed',
          String(operational.reason || '')
        );
      }
      if (['RMA_REWORK', 'RETURN_RMA_REVIEW_REQUIRED'].includes(operational.operationalRoute)) {
        const historical = Array.isArray(operational.historicalWorkOrders)
          ? operational.historicalWorkOrders.map(item => item.workOrderNumber).filter(Boolean) : [];
        const rmaControlled = operational.operationalRoute === 'RMA_REWORK';
        return createWorkOrderPresentation(
          String(operational.operationalStatus || 'RETURN_REVIEW_REQUIRED'),
          String(operational.workOrderDecision || (rmaControlled ? 'Decision Pending' : 'Return Review Required')),
          rmaControlled ? 'RMA / Rework' :
            (historical.length ? 'Original Build: ' + historical.join(', ') : 'RMA / Return Review'),
          false, 'rma-controlled', String(operational.reason || '')
        );
      }
      if (operational.operationalRoute === 'DIRECT_FULFILLMENT' &&
          operational.operationalStatus === 'NO_WORK_ORDER_REQUIRED') {
        return {
          ...createWorkOrderPresentation(
            'NO_WORK_ORDER_REQUIRED', 'No Work Order Required',
            reviewDecisionBasis(getApprovalReview(row)) || 'Direct Fulfillment',
            false, 'direct-fulfillment', String(operational.reason || '')
          ),
          fulfillmentEligible: operational.fulfillmentRequired !== false &&
            operational.shippingRequired !== false
        };
      }
    }
    const membership = dashboardState.rmaMemberships.get(getApprovalKey(row));
    if (membership) {
      return createWorkOrderPresentation(
        'RMA_CONTROLLED',
        'Decision Pending',
        'RMA / Rework · ' + (membership.caseReference || 'Active Case'),
        false,
        'rma-controlled',
        'The active RMA/Rework case controls this line. Canonical and approved Work Order evidence remains available in Review.'
      );
    }
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
    return { status, primary, secondary, label: primary, actionable, kind, reason,
      fulfillmentEligible: actionable };
  }

  function reviewDecisionBasis(review) {
    const code = review?.currentApproval?.decisionReasonCode;
    return getNoWorkOrderReasonOptions(review).find(reason => reason.code === code)?.label ||
      review?.currentApproval?.decisionReason || null;
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
      '" onclick="openSalesOrderLineReview(event)" aria-label="Review this Sales Order line">Review</button>',
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
    const shipmentProjection = getShipmentProjection(sourceWorkOrder);
    return {
      lineIndex: index,
      masterRecordKey: sourceWorkOrder?.masterRecordKey || '',
      customerNumber: official.customerNumber || masterVpro5.customerNumber || '',
      customer: official.customer || masterVpro5.customer || '',
      salesOrder: official.salesOrder || masterVpro5.salesOrder || '',
      salesOrderLine: official.sequenceLine || masterVpro5.sequenceLine || '',
      workOrder: getWorkOrderPresentation(sourceWorkOrder).status === 'NO_WORK_ORDER_REQUIRED'
        ? '' : (official.workOrder || masterVpro5.workOrder || ''),
      workOrderDecision: getWorkOrderPresentation(sourceWorkOrder).status === 'NO_WORK_ORDER_REQUIRED'
        ? 'No Work Order Required' : '',
      assembly: official.partNumber || masterVpro5.partNumber || '',
      description: official.description || masterVpro5.description || '',
      openQuantity: shipmentProjection.operationalRemainingQuantity,
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
        '<td>', escapeDashboardHtml(line.workOrder || 'Not Required'), '</td>',
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
      workOrderDecision: line.workOrderDecision,
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
      workOrderDecision: requestLines.length === 1 ? firstLine.workOrderDecision : '',
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
      window.WorkOrderDashboardModule.setSelectedWorkOrder({
        ...selectedRow,
        operationalRelationship: getApprovalReview(selectedRow)?.operationalRelationship || null,
        preferredDashboardView: 'standard'
      });
    }
    if (typeof go === 'function') {
      go('workOrderDashboardModule');
    }
  }

  function getRelatedRows() {
    const selectedOrder = dashboardState.selectedOrder;
    if (!selectedOrder) return [];
    const rows = Array.isArray(selectedOrder.relatedRows) && selectedOrder.relatedRows.length
      ? selectedOrder.relatedRows
      : [selectedOrder];
    return rows.filter(row => isRmaControlledRow(row) || !getShipmentProjection(row).isFullyStaged);
  }

  function getShipmentProjection(row) {
    const source = row?.masterRecord || row || {};
    const projector = window.ShipmentOperationalProjection;
    if (projector?.projectLine) return projector.projectLine(source);
    const canonicalOpenQuantity = parseDashboardQuantity(
      row?.official?.erpQtyOpen ?? source?.erpQuantityOpen ?? source?.vpro5?.qtyOpen
    );
    return {
      canonicalOpenQuantity,
      stagedQuantity: 0,
      operationalRemainingQuantity: canonicalOpenQuantity,
      isFullyStaged: false,
      isPartiallyStaged: false,
      statusLabel: ''
    };
  }

  function isRmaControlledRow(row) {
    const route = getApprovalReview(row)?.operationalRelationship?.operationalRoute;
    return !!row?.masterRecord?.rmaReworkMembership ||
      ['RMA_REWORK', 'RETURN_RMA_REVIEW_REQUIRED'].includes(route);
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
    if (generation === dashboardState.approvalRequestGeneration) {
      await refreshSelectedMaterialStatuses([]);
      renderSalesOrderDashboardModule();
    }
  }

  async function openWorkOrderApprovalReview(event) {
    event?.stopPropagation();
    const index = Number((event?.currentTarget || event?.target)?.dataset?.relatedRowIndex);
    const row = getRelatedRows()[index];
    if (!row) return;
    dashboardState.approvalReviewRow = row;
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

  function renderWorkOrderApprovalDialog(review, row) {
    const identity = getApprovalLineIdentity(row);
    const relationship = review?.canonicalRelationship || {};
    const candidates = Array.isArray(relationship.candidates) ? relationship.candidates : [];
    const choices = Array.isArray(review?.availableApprovalChoices)
      ? review.availableApprovalChoices : [];
    const membership = dashboardState.rmaMemberships.get(getApprovalKey(row)) || null;
    const canonicalEvidenceWorkOrders = [
      relationship.actionableWorkOrderNumber,
      ...candidates.map(candidate => candidate.workOrderNumber)
    ].map(value => String(value || '').trim()).filter(Boolean);
    const operational = review?.operationalRelationship || (membership ? {
      activeWorkOrderNumber: null,
      historicalWorkOrders: Array.from(new Set(canonicalEvidenceWorkOrders)).map(workOrderNumber => ({
        workOrderNumber, relationshipRole: 'HISTORICAL_REFERENCE'
      })),
      operationalRoute: 'RMA_REWORK',
      operationalStatus: 'RMA_DECISION_PENDING',
      workOrderDecision: 'Decision Pending',
      reason: 'Active RMA/Rework membership controls this line. Reloaded canonical Work Order evidence is historical only.'
    } : {});
    const historical = Array.isArray(operational.historicalWorkOrders)
      ? operational.historicalWorkOrders : [];
    setText('workOrderApprovalCustomer', row?.official?.customer || identity.customerNumber);
    setText('workOrderApprovalSalesOrder', identity.salesOrderNumber);
    setText('workOrderApprovalLine', identity.lineNumber);
    setText('workOrderApprovalItem', row?.official?.partNumber || relationship.salesOrderItemNumber || 'N/A');
    setText('workOrderApprovalRelationshipStatus', relationship.resolutionStatus || relationship.status || 'UNRESOLVED');
    setText('workOrderApprovalExact', relationship.actionableWorkOrderNumber || '—');
    setText('workOrderApprovalOperationalActive', operational.activeWorkOrderNumber || 'None');
    setText('workOrderApprovalHistorical', historical.length
      ? historical.map(item => item.workOrderNumber + ' · ' +
        (item.relationshipRole === 'ORIGINAL_BUILD' ? 'Original Build' : 'Historical reference only')).join(', ')
      : 'None');
    setText('workOrderApprovalOperationalRoute', operational.operationalRoute || 'NORMAL_PRODUCTION_REVIEW');
    setText('workOrderApprovalCurrent', review?.currentApproval?.approvedWorkOrderNumber || '—');
    setText('workOrderApprovalBy', review?.currentApproval?.approvedBy || '—');
    setText('workOrderApprovalAt', review?.currentApproval?.approvedAtUtc || '—');
    setText('workOrderApprovalClassification', review?.conflictClassification || 'NO_APPROVAL');
    const rmaControl = review?.rmaReworkControl || (membership ? {
      active: true,
      caseId: membership.caseId,
      caseReference: membership.caseReference,
      priorApprovalStatus: null
    } : null);
    const rmaControlField = document.getElementById('workOrderApprovalRmaControlField');
    const priorStatusField = document.getElementById('workOrderApprovalPriorStatusField');
    if (rmaControlField) rmaControlField.hidden = !rmaControl?.active;
    if (priorStatusField) priorStatusField.hidden = !rmaControl?.priorApprovalStatus;
    setText('workOrderApprovalRmaControl', rmaControl?.active
      ? 'RMA / Rework · ' + (rmaControl.caseReference || 'Active Case') + ' · Decision Pending'
      : '—');
    setText('workOrderApprovalPriorStatus', rmaControl?.priorApprovalStatus || '—');
    const candidateList = document.getElementById('workOrderApprovalCandidates');
    if (candidateList) {
      candidateList.innerHTML = candidates.length ? candidates.map(candidate => {
        const number = String(candidate.workOrderNumber || '').trim();
        const selectable = choices.includes(number);
        return '<li>' + (selectable
          ? '<label><input type="radio" name="workOrderApprovalChoice" value="' +
            escapeDashboardHtml(number) + '"> '
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
        escapeDashboardHtml(decision.decisionClassification === 'NO_WORK_ORDER_REQUIRED_COMPONENT'
          ? 'No Work Order Required' : (decision.approvedWorkOrderNumber || '—')) + ' · ' +
        escapeDashboardHtml(decision.approvedBy) + ' · ' +
        escapeDashboardHtml(decision.approvedAtUtc) + '<br>' +
        renderApprovalDecisionReasonHistory(decision) + '</li>'
      ).join('') : '<li>No decisions recorded.</li>';
    }
    const reasonContractAvailable = configureWorkOrderApprovalReasons(review);
    const noWorkOrderReasonContractAvailable = configureNoWorkOrderReasons(review);
    toggleApprovalAction('workOrderApprovalApprove', reasonContractAvailable && !membership && review?.permissions?.canApprove);
    toggleApprovalAction('workOrderApprovalReplace', reasonContractAvailable && !membership && review?.permissions?.canReplace);
    toggleApprovalAction('noWorkOrderApprove', noWorkOrderReasonContractAvailable && !membership &&
      review?.permissions?.canApproveNoWorkOrder);
    toggleApprovalAction('noWorkOrderReplace', noWorkOrderReasonContractAvailable && !membership &&
      review?.permissions?.canReplaceWithNoWorkOrder);
    toggleApprovalAction('workOrderApprovalRevoke', reasonContractAvailable && review?.permissions?.canRevoke);
    const returnControlled = ['RMA_REWORK', 'RETURN_RMA_REVIEW_REQUIRED']
      .includes(operational.operationalRoute);
    setText('workOrderApprovalMessage', returnControlled
      ? (operational.reason || 'Read-only historical evidence. RMA/return review controls the Work Order decision.')
      : reasonContractAvailable
        ? 'Review current canonical evidence before recording a decision.'
        : 'Governed decision reason choices are unavailable from this ControlHost. Approval is disabled.');
    const reasonFields = document.getElementById('workOrderApprovalReasonFields');
    if (reasonFields) reasonFields.hidden = returnControlled;
    const noWorkOrderReasonFields = document.getElementById('noWorkOrderReasonFields');
    if (noWorkOrderReasonFields) noWorkOrderReasonFields.hidden = returnControlled ||
      !(review?.permissions?.canApproveNoWorkOrder || review?.permissions?.canReplaceWithNoWorkOrder);
    if (!returnControlled && reasonContractAvailable)
      document.getElementById('workOrderApprovalReasonCode')?.focus();
  }

  function hasExactWorkOrderApprovalReasonContract(review) {
    const contract = review?.decisionReasonContract;
    const options = Array.isArray(contract?.options) ? contract.options : [];
    return contract?.schema === WORK_ORDER_APPROVAL_REASON_SCHEMA &&
      contract?.otherCode === 'OTHER' &&
      options.length === WORK_ORDER_APPROVAL_REASONS.length &&
      options.every((option, index) => option?.code === WORK_ORDER_APPROVAL_REASONS[index].code &&
        option?.label === WORK_ORDER_APPROVAL_REASONS[index].label);
  }

  function configureWorkOrderApprovalReasons(review) {
    const select = document.getElementById('workOrderApprovalReasonCode');
    if (!select) return false;
    const available = hasExactWorkOrderApprovalReasonContract(review);
    select.innerHTML = '<option value="" selected disabled>Select a reason</option>' +
      (available ? WORK_ORDER_APPROVAL_REASONS.map(reason => '<option value="' +
        escapeDashboardHtml(reason.code) + '">' + escapeDashboardHtml(reason.label) + '</option>').join('') : '');
    select.disabled = !available;
    select.required = false;
    updateWorkOrderApprovalReason();
    return available;
  }

  function hasExactNoWorkOrderReasonContract(review) {
    const contract = review?.noWorkOrderDecisionReasonContract;
    const options = Array.isArray(contract?.options) ? contract.options : [];
    const codes = options.map(option => option?.code);
    return contract?.schema === NO_WORK_ORDER_REASON_SCHEMA && contract?.otherCode === 'OTHER' &&
      options.length === 4 && new Set(codes).size === options.length &&
      !codes.includes('PURCHASED_RESALE_ITEM') && codes.includes('OTHER') &&
      options.every(option => typeof option?.code === 'string' &&
        /^[A-Z][A-Z0-9_]{2,63}$/.test(option.code) &&
        typeof option?.label === 'string' && option.label.trim().length >= 3);
  }

  function getNoWorkOrderReasonOptions(review) {
    return hasExactNoWorkOrderReasonContract(review)
      ? review.noWorkOrderDecisionReasonContract.options.map(option => ({
        code: option.code, label: option.label
      }))
      : [];
  }

  function configureNoWorkOrderReasons(review) {
    const select = document.getElementById('noWorkOrderReasonCode');
    if (!select) return false;
    const reasons = getNoWorkOrderReasonOptions(review);
    const available = reasons.length > 0;
    select.innerHTML = '<option value="" selected disabled>Select a reason</option>' +
      (available ? reasons.map(reason => '<option value="' +
        escapeDashboardHtml(reason.code) + '">' + escapeDashboardHtml(reason.label) + '</option>').join('') : '');
    select.disabled = !available;
    select.required = false;
    updateNoWorkOrderReason();
    return available;
  }

  function validateWorkOrderApprovalReason(codeValue, otherReasonValue) {
    const code = String(codeValue || '').trim();
    if (!WORK_ORDER_APPROVAL_REASONS.some(reason => reason.code === code)) {
      return { valid: false, decisionReasonCode: null, decisionNote: null,
        message: 'Select a Decision Reason.' };
    }
    if (code !== 'OTHER') {
      return { valid: true, decisionReasonCode: code, decisionNote: null, message: '' };
    }
    const note = String(otherReasonValue || '').trim();
    if (!note) {
      return { valid: false, decisionReasonCode: code, decisionNote: null,
        message: 'Enter the Other reason.' };
    }
    return { valid: true, decisionReasonCode: code, decisionNote: note, message: '' };
  }

  function validateNoWorkOrderReason(codeValue, otherReasonValue, review) {
    const code = String(codeValue || '').trim();
    if (!getNoWorkOrderReasonOptions(review).some(reason => reason.code === code))
      return { valid: false, decisionReasonCode: null, decisionNote: null,
        message: 'Select a No Work Order Required reason.' };
    if (code !== 'OTHER')
      return { valid: true, decisionReasonCode: code, decisionNote: null, message: '' };
    const note = String(otherReasonValue || '').trim();
    if (!note)
      return { valid: false, decisionReasonCode: code, decisionNote: null,
        message: 'Enter the Other reason.' };
    return { valid: true, decisionReasonCode: code, decisionNote: note, message: '' };
  }

  function updateWorkOrderApprovalReason() {
    const select = document.getElementById('workOrderApprovalReasonCode');
    const otherField = document.getElementById('workOrderApprovalOtherReasonField');
    const otherInput = document.getElementById('workOrderApprovalOtherReason');
    const isOther = select?.value === 'OTHER';
    if (otherField) otherField.hidden = !isOther;
    if (otherInput) {
      otherInput.disabled = !isOther;
      otherInput.required = isOther;
      if (!isOther) otherInput.value = '';
    }
  }

  function updateNoWorkOrderReason() {
    const select = document.getElementById('noWorkOrderReasonCode');
    const field = document.getElementById('noWorkOrderOtherReasonField');
    const input = document.getElementById('noWorkOrderOtherReason');
    const isOther = select?.value === 'OTHER';
    if (field) field.hidden = !isOther;
    if (input) {
      input.disabled = !isOther;
      input.required = isOther;
      if (!isOther) input.value = '';
    }
  }

  function renderApprovalDecisionReasonHistory(decision) {
    const reason = WORK_ORDER_APPROVAL_REASONS.find(
      item => item.code === decision?.decisionReasonCode);
    const label = reason?.label || decision?.decisionReason;
    if (!label) {
      return '<strong>Legacy decision reason</strong> · ' +
        escapeDashboardHtml(decision?.decisionReason || 'Not recorded');
    }
    return '<strong>' + escapeDashboardHtml(label) + '</strong>' +
      (decision?.decisionNote ? '<br>' + escapeDashboardHtml(decision.decisionNote) : '');
  }

  function toggleApprovalAction(id, visible) {
    const button = document.getElementById(id);
    const permissions = {
      workOrderApprovalApprove: 'work_orders.approve',
      workOrderApprovalReplace: 'work_orders.replace',
      workOrderApprovalRevoke: 'work_orders.revoke',
      noWorkOrderApprove: 'work_orders.mark_no_work_order_required',
      noWorkOrderReplace: 'work_orders.mark_no_work_order_required'
    };
    const allowed = !permissions[id] || window.DleOsCapabilities?.can(permissions[id]) !== false;
    if (button) button.hidden = !visible || !allowed;
  }

  function formatWorkOrderApprovalFailure(error) {
    let message = error?.message || 'The governed decision could not be recorded.';
    if (error?.status === 401 || error?.status === 403) {
      message = 'You are not authorized to record this governed Work Order decision.';
    } else if (error?.code === 'approval_schema_unavailable') {
      message = 'The required Work Order approval migration or schema is unavailable.';
    } else if (error?.code === 'approval_store_unavailable') {
      message = 'The governed Work Order approval store is unavailable.';
    } else if (error?.code === 'approval_database_write_failed') {
      message = 'The governed Work Order decision could not be written. No decision was recorded.';
    }
    return message + (error?.requestId ? ' Reference: ' + error.requestId : '');
  }

  async function submitWorkOrderApproval(event) {
    event.preventDefault();
    if (dashboardState.approvalSubmitting) return;
    const action = event.submitter?.dataset?.approvalAction;
    if (!['approve', 'replace', 'approve-no-work-order',
        'replace-no-work-order', 'revoke'].includes(action)) return;
    const noWorkOrderAction = action.endsWith('no-work-order');
    const row = dashboardState.approvalReviewRow;
    const review = getApprovalReview(row);
    if (action !== 'revoke' && dashboardState.rmaMemberships.has(getApprovalKey(row))) {
      setText('workOrderApprovalMessage', 'RMA/Rework membership controls this line. Normal Work Order approval is blocked.');
      return;
    }
    if (noWorkOrderAction ? !hasExactNoWorkOrderReasonContract(review) :
        !hasExactWorkOrderApprovalReasonContract(review)) {
      setText('workOrderApprovalMessage', 'Governed decision reason choices are unavailable. Approval is disabled.');
      return;
    }
    const reason = noWorkOrderAction
      ? validateNoWorkOrderReason(
        document.getElementById('noWorkOrderReasonCode')?.value,
        document.getElementById('noWorkOrderOtherReason')?.value, review)
      : validateWorkOrderApprovalReason(
        document.getElementById('workOrderApprovalReasonCode')?.value,
        document.getElementById('workOrderApprovalOtherReason')?.value);
    const selected = document.querySelector('input[name="workOrderApprovalChoice"]:checked')?.value || null;
    if (!reason.valid) {
      setText('workOrderApprovalMessage', reason.message);
      return;
    }
    if (action !== 'revoke' && !noWorkOrderAction && !selected) {
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
          decisionReasonCode: reason.decisionReasonCode,
          decisionNote: reason.decisionNote,
          evidenceToken: review.evidenceToken,
          expectedCurrentDecisionId: review.currentApproval?.decisionId || null
        }
      );
      dashboardState.approvalReviews.set(getApprovalKey(row), updated);
      renderSalesOrderDashboardModule();
      renderWorkOrderApprovalDialog(updated, row);
      await window.DleApiClient.publishOperationalLineStateChange([
        {
          customerNumber: identity.customerNumber,
          salesOrderNumber: identity.salesOrderNumber,
          lineNumber: identity.lineNumber
        }
      ], 'work-order-approval-' + action);
      setText('workOrderApprovalMessage', 'The governed decision was recorded.');
      const reasonSelect = document.getElementById('workOrderApprovalReasonCode');
      if (reasonSelect) reasonSelect.value = '';
      updateWorkOrderApprovalReason();
      const noWorkOrderReasonSelect = document.getElementById('noWorkOrderReasonCode');
      if (noWorkOrderReasonSelect) noWorkOrderReasonSelect.value = '';
      updateNoWorkOrderReason();
    } catch (error) {
      if (error.status === 409) {
        setText('workOrderApprovalMessage', 'Evidence changed. Reloading the current relationship for review…');
        await openWorkOrderApprovalReview({ currentTarget: approvalDialogReturnFocus, stopPropagation() {} });
      } else {
        setText('workOrderApprovalMessage', formatWorkOrderApprovalFailure(error));
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
    approvalDialogReturnFocus?.focus?.();
  }

  function handleWorkOrderApprovalKeydown(event) {
    if (event?.key === 'Escape' && !document.getElementById('workOrderApprovalDialog')?.hidden)
      closeWorkOrderApprovalReview();
  }

  function getRmaLineQuantities(row) {
    const official = row?.official || {};
    const source = row?.masterRecord || {};
    const vpro5 = source.vpro5 || {};
    const shipmentProjection = getShipmentProjection(row);
    return {
      revision: String(source.drawingRevision || source.bomRevision || official.revision || vpro5.revision || '').trim(),
      quantityOrdered: parseDashboardQuantity(official.quantityOrdered ?? source.quantityOrdered ?? vpro5.quantityOrdered),
      erpQuantityOpen: parseDashboardQuantity(official.erpQtyOpen ?? source.erpQuantityOpen ?? vpro5.qtyOpen),
      pendingInvoiceQuantity: shipmentProjection.stagedQuantity,
      operationalQuantityOpen: shipmentProjection.operationalRemainingQuantity
    };
  }

  function quantitySign(value) {
    const number = parseDashboardQuantity(value);
    return number < 0 ? 'Negative' : number > 0 ? 'Positive' : 'Zero';
  }

  function toggleSalesOrderReviewCandidate() {
    dashboardState.reviewCandidateMode = !dashboardState.reviewCandidateMode;
    if (!dashboardState.reviewCandidateMode) dashboardState.rmaSelection.clear();
    renderSalesOrderDashboardModule();
  }

  function toggleRmaReworkLine(event) {
    event?.stopPropagation?.();
    if (!dashboardState.reviewCandidateMode) return;
    const index = Number(event?.currentTarget?.dataset?.relatedRowIndex);
    const row = getRelatedRows()[index];
    if (!row) return;
    const key = getApprovalKey(row);
    if (dashboardState.rmaMemberships.has(key)) return;
    if (event.currentTarget.checked) dashboardState.rmaSelection.set(key, row);
    else dashboardState.rmaSelection.delete(key);
    updateRmaReworkActions();
  }

  function updateRmaReworkActions() {
    const button = document.getElementById('salesOrderDashboardClassifyRmaButton');
    const modeButton = document.getElementById('salesOrderDashboardReviewCandidateButton');
    const selected = Array.from(dashboardState.rmaSelection.values());
    if (button) button.disabled = !dashboardState.reviewCandidateMode || selected.length < 2;
    if (modeButton) modeButton.textContent = dashboardState.reviewCandidateMode ? 'Exit Review Candidate' : 'Enter Review Candidate';
    setText('salesOrderDashboardReviewCandidateState', dashboardState.reviewCandidateMode ? 'Active' : 'Not active');
    setText('salesOrderDashboardRmaSelectionCount', selected.length + ' selected');
    const customers = new Set(selected.map(row => getApprovalLineIdentity(row).customerNumber));
    const salesOrders = new Set(selected.map(row => getApprovalLineIdentity(row).salesOrderNumber));
    setText('salesOrderDashboardRmaSelectionWarning', customers.size > 1
      ? 'Selected lines span multiple customers and cannot form one case.'
      : salesOrders.size > 1 ? 'Selected lines span multiple Sales Orders. Confirm that they belong to one case.' : '');
  }

  async function loadSelectedOrderRmaMemberships(generation) {
    if (!window.DleApiClient?.getRmaReworkCases) return;
    const first = getRelatedRows()[0];
    const identity = getApprovalLineIdentity(first);
    if (!identity.customerNumber || !identity.salesOrderNumber) return;
    try {
      const response = await window.DleApiClient.getRmaReworkCases({
        status: 'ACTIVE', customerNumber: identity.customerNumber,
        salesOrderNumber: identity.salesOrderNumber, page: 1, pageSize: 200
      });
      if (generation !== dashboardState.rmaRequestGeneration) return;
      (response?.items || []).forEach(caseRecord => {
        dashboardState.rmaCases.set(caseRecord.caseId, caseRecord);
        (caseRecord.members || []).forEach(member => dashboardState.rmaMemberships.set(
          [member.customerNumber, member.salesOrderNumber, member.salesOrderLineNumber].join('|'),
          { caseId: caseRecord.caseId, caseReference: caseRecord.caseReference, caseRecord }
        ));
      });
      renderSalesOrderDashboardModule();
    } catch (error) {
      console.warn('Active RMA/Rework membership is unavailable.', error);
      setText('salesOrderDashboardRmaSelectionWarning', 'RMA/Rework membership could not be loaded; classification is unavailable.');
      const button = document.getElementById('salesOrderDashboardClassifyRmaButton');
      if (button) button.disabled = true;
    }
  }

  function buildRmaMemberRequest(row) {
    const identity = getApprovalLineIdentity(row);
    return { customerNumber: identity.customerNumber, salesOrderNumber: identity.salesOrderNumber, lineNumber: identity.lineNumber };
  }

  function openSalesOrderLineReview(event) {
    event?.stopPropagation?.();
    const index = Number(event?.currentTarget?.dataset?.relatedRowIndex);
    const row = getRelatedRows()[index];
    if (!row) return;
    dashboardState.lineReviewRow = row;
    dashboardState.lineReviewTrigger = event.currentTarget;
    const membership = dashboardState.rmaMemberships.get(getApprovalKey(row));
    setText('salesOrderLineRmaStatus', membership ? 'RMA / Rework' : 'Not classified');
    setText('salesOrderLineRmaClassification', membership?.caseRecord?.caseType || membership?.caseReference || '—');
    const selected = dashboardState.selectedWorkOrders.includes(row) ? dashboardState.selectedWorkOrders : [row];
    const available = selected.filter(item => !dashboardState.rmaMemberships.has(getApprovalKey(item)));
    const button = document.getElementById('salesOrderLineRmaReviewButton');
    if (button) {
      button.disabled = !!membership;
      button.textContent = membership ? 'RMA / Rework Classified' :
        available.length > 1 ? 'RMA / Rework Review (' + available.length + ' selected)' : 'RMA / Rework Review';
    }
    const dialog = document.getElementById('salesOrderLineReviewDialog');
    if (dialog) dialog.hidden = false;
  }

  function closeSalesOrderLineReview() {
    const dialog = document.getElementById('salesOrderLineReviewDialog');
    if (dialog) dialog.hidden = true;
    dashboardState.lineReviewTrigger?.focus?.();
  }

  function continueWorkOrderRelationshipReview() {
    const trigger = dashboardState.lineReviewTrigger;
    closeSalesOrderLineReview();
    if (trigger) openWorkOrderApprovalReview({ currentTarget: trigger, stopPropagation() {} });
  }

  function continueRmaReworkLineReview() {
    const row = dashboardState.lineReviewRow;
    const trigger = dashboardState.lineReviewTrigger;
    closeSalesOrderLineReview();
    const selected = dashboardState.selectedWorkOrders.includes(row)
      ? dashboardState.selectedWorkOrders.filter(item => !dashboardState.rmaMemberships.has(getApprovalKey(item))) : [row];
    if (selected.length > 1) {
      dashboardState.rmaSelection = new Map(selected.map(item => [getApprovalKey(item), item]));
      openRmaReworkClassification({ currentTarget: trigger, stopPropagation() {} });
    } else if (row) openRmaReworkClassification({ currentTarget: trigger, stopPropagation() {} }, row);
  }

  async function openRmaReworkClassification(event, singleRow = null) {
    if (dashboardState.rmaSubmitting) return;
    if (!singleRow && dashboardState.rmaSelection.size < 2) return;
    dashboardState.rmaWorkflowMode = singleRow ? 'single' : 'group';
    dashboardState.rmaSingleRow = singleRow;
    dashboardState.rmaMatch = null;
    rmaDialogReturnFocus = event?.currentTarget || document.activeElement;
    const dialog = document.getElementById('rmaReworkClassificationDialog');
    if (dialog) dialog.hidden = false;
    setText('rmaReworkMessage', 'Validating exact canonical Sales Order lines…');
    const lines = document.getElementById('rmaReworkSelectedLines');
    if (lines) lines.innerHTML = '<tr><td colspan="12">Validating exact canonical Sales Order lines…</td></tr>';
    try {
      const rows = singleRow ? [singleRow] : Array.from(dashboardState.rmaSelection.values());
      const members = rows.map(buildRmaMemberRequest);
      dashboardState.rmaReview = await window.DleApiClient.reviewRmaReworkCaseMembers(members);
      renderRmaReworkReview(dashboardState.rmaReview);
      const orders = new Set(dashboardState.rmaReview.members.map(item => item.identity.salesOrderNumber));
      const internal = document.getElementById('rmaReworkInternalReference');
      if (internal) internal.placeholder = orders.size === 1 ? 'Suggested: PENDING-RMA-' + Array.from(orders)[0] : 'Enter an internal reference';
      setText('rmaReworkClassificationTitle', singleRow ? 'Classify Line as RMA / Rework' : 'Group Selected Lines as RMA / Rework');
      setText('rmaReworkClassificationPurpose', singleRow
        ? 'Enter one controlled reference, review active case matching, then explicitly confirm the proposed action.'
        : 'Create one governed case from the selected canonical lines.');
      setText('rmaReworkMessage', singleRow ? 'Enter one reference to review its active-case match.' : 'Review the server-validated lines and explicitly confirm case creation.');
      validateRmaReworkClassification();
    } catch (error) {
      dashboardState.rmaReview = null;
      setText('rmaReworkMessage', error.message || 'The selected canonical lines could not be reviewed.');
      validateRmaReworkClassification();
    }
  }

  function resetRmaReworkMatch() {
    dashboardState.rmaMatch = null;
    const summary = document.getElementById('rmaReworkMatchSummary');
    if (summary) summary.innerHTML = '';
    validateRmaReworkClassification();
  }

  function renderRmaReworkMatch(match) {
    const target = document.getElementById('rmaReworkMatchSummary');
    if (!target) return;
    const existing = match?.existingCase;
    const members = existing?.members || [];
    const actionLabels = {
      CREATE_NEW_CASE: 'Create new RMA / Rework Case',
      ADD_TO_EXISTING_CASE: 'Add to existing RMA / Rework Case',
      ALREADY_MEMBER: 'This line is already a member',
      CASE_TYPE_MISMATCH: 'Case type does not match',
      AMBIGUOUS: 'Multiple active cases match'
    };
    target.innerHTML = '<div class="sales-order-dashboard-rma-summary"><strong>' +
      escapeDashboardHtml(actionLabels[match?.proposedAction] || match?.proposedAction || 'Match unavailable') +
      '</strong><small>Entered ' + escapeDashboardHtml(match?.referenceType || '') + ': ' +
      escapeDashboardHtml(match?.enteredReference || '') + ' · matching active cases: ' +
      escapeDashboardHtml(match?.matchingCaseCount ?? 0) + (existing ? ' · Case ' +
      escapeDashboardHtml(existing.caseId) + ' · ' + escapeDashboardHtml(existing.caseReference || existing.customerRmaNumber || existing.internalReference || '') +
      ' · ' + escapeDashboardHtml(existing.caseType) + ' · current lines: ' +
      escapeDashboardHtml(members.map(member => member.salesOrderNumber + '/' + member.salesOrderLineNumber).join(', ')) : '') +
      '</small></div>';
  }

  async function reviewRmaReworkReference(values) {
    const row = dashboardState.rmaSingleRow;
    let match = await window.DleApiClient.matchRmaReworkCase({
      ...values, member: buildRmaMemberRequest(row)
    });
    if (match?.proposedAction === 'CASE_TYPE_MISMATCH' && match?.existingCase?.caseType) {
      const type = document.getElementById('rmaReworkCaseType');
      if (type) type.value = match.existingCase.caseType;
      match = await window.DleApiClient.matchRmaReworkCase({
        ...values, caseType: match.existingCase.caseType, member: buildRmaMemberRequest(row)
      });
    }
    dashboardState.rmaMatch = match;
    renderRmaReworkMatch(match);
    validateRmaReworkClassification();
  }

  function renderRmaReworkReview(review) {
    const target = document.getElementById('rmaReworkSelectedLines');
    if (target) target.innerHTML = (review?.members || []).map(member => {
      const identity = member.identity || {};
      return '<tr><td>' + escapeDashboardHtml(identity.salesOrderNumber) + '</td><td>' + escapeDashboardHtml(identity.lineNumber) +
        '</td><td>' + escapeDashboardHtml(member.itemNumber || 'N/A') + '</td><td>' + escapeDashboardHtml(member.revision || 'N/A') +
        '</td><td>' + escapeDashboardHtml(formatDashboardQuantity(member.quantityOrdered)) + '</td><td>' + escapeDashboardHtml(formatDashboardQuantity(member.erpQuantityOpen)) +
        '</td><td>' + escapeDashboardHtml(formatDashboardQuantity(member.pendingInvoiceQuantity)) + '</td><td>' + escapeDashboardHtml(formatDashboardQuantity(member.operationalQuantityOpen)) +
        '</td><td>' + escapeDashboardHtml(quantitySign(member.erpQuantityOpen)) + '</td><td>' + escapeDashboardHtml(member.relatedWorkOrderNumber || '—') +
        '</td><td>' + escapeDashboardHtml(member.relationshipStatus || 'UNRESOLVED') + '</td><td>' + escapeDashboardHtml(member.currentCaseReference || '—') + '</td></tr>';
    }).join('');
    setText('rmaReworkSignedNet', formatDashboardQuantity(review?.signedNetQuantity));
    setText('rmaReworkOperationalNet', formatDashboardQuantity(review?.operationalNetQuantity));
    const warnings = [];
    if (review?.multipleSalesOrders) warnings.push('Multiple Sales Orders are selected.');
    if (review?.sameSignOnly) warnings.push('All selected ERP quantities have the same sign; classification remains permitted but must be intentional.');
    if ((review?.members || []).some(member => member.currentCaseId)) warnings.push('One or more lines already belong to an active case.');
    setText('rmaReworkWarnings', warnings.join(' '));
  }

  function validateRmaReworkClassification() {
    const customerRma = String(document.getElementById('rmaReworkCustomerNumber')?.value || '').trim();
    const internalReference = String(document.getElementById('rmaReworkInternalReference')?.value || '').trim();
    const caseType = String(document.getElementById('rmaReworkCaseType')?.value || '');
    const notes = String(document.getElementById('rmaReworkNotes')?.value || '').trim();
    let message = '';
    if (!dashboardState.rmaReview) message = 'Review current canonical line evidence first.';
    else if (dashboardState.rmaWorkflowMode === 'group' && (dashboardState.rmaReview.members || []).some(member => member.currentCaseId)) message = 'A selected line already belongs to an active case.';
    else if (!customerRma && !internalReference) message = 'Enter a Customer RMA Number or an Internal RMA Reference.';
    else if (customerRma && internalReference) message = 'Enter either a Customer RMA Number or an Internal RMA Reference, not both.';
    else if (caseType === 'OTHER' && !notes) message = 'A note is required for Other.';
    else if (dashboardState.rmaWorkflowMode === 'single' && dashboardState.rmaMatch &&
      !['CREATE_NEW_CASE', 'ADD_TO_EXISTING_CASE'].includes(dashboardState.rmaMatch.proposedAction))
      message = dashboardState.rmaMatch.proposedAction === 'ALREADY_MEMBER' ? 'This exact Sales Order line already belongs to the matching active case.' :
        dashboardState.rmaMatch.proposedAction === 'AMBIGUOUS' ? 'More than one active case matches. No case was selected.' :
        'The proposed classification is not actionable.';
    const button = document.getElementById('rmaReworkConfirmButton');
    const canManageRma = window.DleOsCapabilities?.can('rma_rework.manage') !== false;
    if (button) button.disabled = !!message || dashboardState.rmaSubmitting || !canManageRma;
    if (button) button.hidden = !canManageRma;
    if (button) button.textContent = dashboardState.rmaWorkflowMode === 'single' && !dashboardState.rmaMatch
      ? 'Review Reference Match' : dashboardState.rmaMatch?.proposedAction === 'ADD_TO_EXISTING_CASE'
        ? 'Confirm Add to Existing Case' : 'Confirm Case Creation';
    if (dashboardState.rmaReview) setText('rmaReworkMessage', message ||
      (dashboardState.rmaWorkflowMode === 'single' && !dashboardState.rmaMatch
        ? 'Review the reference before any write.' : 'Ready for explicit confirmation.'));
    return { valid: !message, caseType, customerRmaNumber: customerRma || null, internalReference: internalReference || null, notes: notes || null };
  }

  async function submitRmaReworkClassification(event) {
    event?.preventDefault?.();
    if (dashboardState.rmaSubmitting) return;
    const values = validateRmaReworkClassification();
    if (!values.valid) return;
    if (dashboardState.rmaWorkflowMode === 'single' && !dashboardState.rmaMatch) {
      dashboardState.rmaSubmitting = true;
      setText('rmaReworkMessage', 'Matching the controlled reference against active cases…');
      try { await reviewRmaReworkReference(values); }
      catch (error) { setText('rmaReworkMessage', error.message || 'Reference matching failed.'); }
      finally { dashboardState.rmaSubmitting = false; validateRmaReworkClassification(); }
      return;
    }
    dashboardState.rmaSubmitting = true;
    validateRmaReworkClassification();
    setText('rmaReworkMessage', 'Creating the governed RMA / Rework Case…');
    try {
      const match = dashboardState.rmaMatch;
      const created = dashboardState.rmaWorkflowMode === 'single' && match?.proposedAction === 'ADD_TO_EXISTING_CASE'
        ? await window.DleApiClient.addRmaReworkCaseMember(match.existingCase.caseId, {
            ...values, member: buildRmaMemberRequest(dashboardState.rmaSingleRow),
            referenceMatchEvidenceToken: match.evidenceToken,
            expectedCurrentEventId: match.expectedCurrentEventId,
            requestCorrelationId: createDashboardCorrelationId()
          })
        : await window.DleApiClient.createRmaReworkCase({
            ...values,
            members: dashboardState.rmaWorkflowMode === 'single' ? [buildRmaMemberRequest(dashboardState.rmaSingleRow)] : Array.from(dashboardState.rmaSelection.values()).map(buildRmaMemberRequest),
            evidenceToken: dashboardState.rmaReview.evidenceToken,
            referenceMatchEvidenceToken: match?.evidenceToken || null,
            requestCorrelationId: createDashboardCorrelationId()
          });
      dashboardState.rmaCases.set(created.caseId, created);
      (created.members || []).forEach(member => dashboardState.rmaMemberships.set(
        [member.customerNumber, member.salesOrderNumber, member.salesOrderLineNumber].join('|'),
        { caseId: created.caseId, caseReference: created.caseReference, caseRecord: created }
      ));
      dashboardState.rmaSelection.clear();
      closeRmaReworkClassification();
      renderSalesOrderDashboardModule();
      await window.DleApiClient.publishOperationalLineStateChange(
        (created.members || []).map(member => ({
          customerNumber: member.customerNumber,
          salesOrderNumber: member.salesOrderNumber,
          lineNumber: member.salesOrderLineNumber
        })),
        'rma-rework-membership-issued'
      );
      setText('salesOrderDashboardStatus', 'RMA / Rework Case ' + created.caseReference +
        (match?.proposedAction === 'ADD_TO_EXISTING_CASE' ? ' received the canonical Sales Order line.' : ' was created from exact canonical line evidence.'));
    } catch (error) {
      setText('rmaReworkMessage', error.status === 409
        ? 'Evidence changed. Close and review the selected lines again.'
        : error.message || 'The RMA / Rework Case could not be created.');
    } finally {
      dashboardState.rmaSubmitting = false;
      validateRmaReworkClassification();
    }
  }

  function closeRmaReworkClassification() {
    const dialog = document.getElementById('rmaReworkClassificationDialog');
    if (dialog) dialog.hidden = true;
    dashboardState.rmaReview = null;
    dashboardState.rmaMatch = null;
    dashboardState.rmaSingleRow = null;
    rmaDialogReturnFocus?.focus?.();
    rmaDialogReturnFocus = null;
  }

  function renderRmaReworkSummaries() {
    const target = document.getElementById('salesOrderDashboardRmaCases');
    if (!target) return;
    const keys = new Set(getRelatedRows().map(getApprovalKey));
    const cases = Array.from(dashboardState.rmaCases.values()).filter(caseRecord =>
      (caseRecord.members || []).some(member => keys.has([member.customerNumber, member.salesOrderNumber, member.salesOrderLineNumber].join('|'))));
    target.innerHTML = cases.map(caseRecord => '<div class="sales-order-dashboard-rma-summary" data-rma-case-summary="' +
      escapeDashboardHtml(caseRecord.caseId) + '"><strong>' + escapeDashboardHtml(caseRecord.caseReference) +
      ' · ' + escapeDashboardHtml(caseRecord.caseType) + ' · ' + escapeDashboardHtml(caseRecord.statusLabel) + '</strong><small>' +
      escapeDashboardHtml((caseRecord.members || []).map(member => member.salesOrderNumber + '/' + member.salesOrderLineNumber +
        ' (' + formatDashboardQuantity(member.erpQuantityOpen) + ')').join(', ')) + ' · Net ' +
      escapeDashboardHtml(formatDashboardQuantity(caseRecord.signedNetQuantity)) + ' · Created by ' +
      escapeDashboardHtml(caseRecord.createdBy) + ' at ' + escapeDashboardHtml(caseRecord.createdAtUtc) +
      (caseRecord.notes ? ' · ' + escapeDashboardHtml(caseRecord.notes) : '') + '</small></div>').join('');
  }

  function showRmaReworkCase(event) {
    event?.stopPropagation?.();
    const caseId = event?.currentTarget?.dataset?.rmaCaseId;
    const summary = document.querySelector('[data-rma-case-summary="' + CSS.escape(caseId || '') + '"]');
    summary?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  function createDashboardCorrelationId() {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
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
  window.SalesOrderDashboard.getActiveRelatedRows = getRelatedRows;
  window.SalesOrderDashboard.getShipmentProjection = getShipmentProjection;
  window.SalesOrderDashboard.openWorkOrderDashboard = openWorkOrderDashboard;
  window.SalesOrderDashboard.getWorkOrderPresentation = getWorkOrderPresentation;
  window.SalesOrderDashboard.openWorkOrderApprovalReview = openWorkOrderApprovalReview;
  window.SalesOrderDashboard.openSalesOrderLineReview = openSalesOrderLineReview;
  window.SalesOrderDashboard.render = renderSalesOrderDashboardModule;
  window.SalesOrderDashboard.toggleReviewCandidate = toggleSalesOrderReviewCandidate;
  window.SalesOrderDashboard.openRmaReworkClassification = openRmaReworkClassification;
  window.SalesOrderDashboard.hasExactWorkOrderApprovalReasonContract = hasExactWorkOrderApprovalReasonContract;
  window.SalesOrderDashboard.validateWorkOrderApprovalReason = validateWorkOrderApprovalReason;
  window.SalesOrderDashboard.getWorkOrderApprovalReasons = () => WORK_ORDER_APPROVAL_REASONS.slice();
  window.SalesOrderDashboard.getNoWorkOrderReasons = getNoWorkOrderReasonOptions;
  window.SalesOrderDashboard.hasExactNoWorkOrderReasonContract = hasExactNoWorkOrderReasonContract;
  window.SalesOrderDashboard.validateNoWorkOrderReason = validateNoWorkOrderReason;
  window.SalesOrderDashboard.renderApprovalDecisionReasonHistory = renderApprovalDecisionReasonHistory;
  window.SalesOrderDashboard.formatWorkOrderApprovalFailure = formatWorkOrderApprovalFailure;

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
  window.openSalesOrderLineReview = openSalesOrderLineReview;
  window.closeSalesOrderLineReview = closeSalesOrderLineReview;
  window.continueWorkOrderRelationshipReview = continueWorkOrderRelationshipReview;
  window.continueRmaReworkLineReview = continueRmaReworkLineReview;
  window.closeWorkOrderApprovalReview = closeWorkOrderApprovalReview;
  window.submitWorkOrderApproval = submitWorkOrderApproval;
  window.updateWorkOrderApprovalReason = updateWorkOrderApprovalReason;
  window.updateNoWorkOrderReason = updateNoWorkOrderReason;
  window.toggleSalesOrderReviewCandidate = toggleSalesOrderReviewCandidate;
  window.toggleRmaReworkLine = toggleRmaReworkLine;
  window.openRmaReworkClassification = openRmaReworkClassification;
  window.closeRmaReworkClassification = closeRmaReworkClassification;
  window.submitRmaReworkClassification = submitRmaReworkClassification;
  window.validateRmaReworkClassification = validateRmaReworkClassification;
  window.resetRmaReworkMatch = resetRmaReworkMatch;
  window.showRmaReworkCase = showRmaReworkCase;
  window.renderSalesOrderDashboardModule = renderSalesOrderDashboardModule;

  document.addEventListener('keydown', handleRequestToShipDialogKeydown);
  document.addEventListener('keydown', handleWorkOrderApprovalKeydown);
})();

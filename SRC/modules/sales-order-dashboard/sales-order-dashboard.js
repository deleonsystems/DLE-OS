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
    approvalReasonState: null,
    workOrderActionInProgress: false,
    workOrderActionMessage: '',
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
  let requestDialogReturnFocus = null;
  let approvalDialogReturnFocus = null;
  let rmaDialogReturnFocus = null;
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
    dashboardState.workOrderActionInProgress = false;
    dashboardState.workOrderActionMessage = '';
    if (!dashboardState.reviewCandidateMode) dashboardState.rmaSelection.clear();
    const generation = ++dashboardState.approvalRequestGeneration;
    const rmaGeneration = ++dashboardState.rmaRequestGeneration;
    renderSalesOrderDashboardModule();
    loadSelectedOrderApprovalReviews(generation);
    loadSelectedOrderRmaMemberships(rmaGeneration);
  }

  function renderSalesOrderDashboardModule() {
    const status = document.getElementById('salesOrderDashboardStatus');
    if (status) {
      status.textContent = dashboardState.workOrderActionMessage ||
        'Sales Order Dashboard ready. Future digital Sales Order folder workflows will live here.';
    }
    renderSalesOrderSummary();
    renderRelatedWorkOrders();
    renderRmaReworkSummaries();
    updateRequestToShipAction();
    updateWorkOrderDashboardAction();
    updateRmaReworkActions();
  }

  function renderSalesOrderSummary() {
    const official = dashboardState.selectedOrder?.official || {};
    const selectedWorkOrder = dashboardState.selectedWorkOrder?.official || {};
    const selectedResolution = dashboardState.selectedWorkOrder
      ? resolveGovernedWorkOrderForAction(dashboardState.selectedWorkOrder)
      : null;
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
        ? selectedResolution?.workOrderNumber || selectedResolution?.evidenceWorkOrderNumber || '1 line selected'
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
      const identity = getApprovalLineIdentity(row);
      const membership = dashboardState.rmaMemberships.get(getApprovalKey(row));
      const quantities = getRmaLineQuantities(row);
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
        escapeDashboardHtml(identity.salesOrderNumber || 'N/A'), ' / ',
        escapeDashboardHtml(identity.lineNumber || 'N/A'),
        '</td>',
        '<td>',
        workOrderControl,
        '</td>',
        '<td>',
        escapeDashboardHtml(official.partNumber || 'N/A'),
        membership ? '<br><span class="sales-order-dashboard-rma-badge">RMA / Rework</span>' : '',
        '</td>',
        '<td>',
        escapeDashboardHtml(formatDashboardQuantity(quantities.operationalQuantityOpen)),
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
    return resolveGovernedWorkOrderForAction(row).actionable;
  }

  function getWorkOrderRelationship(row) {
    return row?.official?.workOrderRelationship || row?.masterRecord?.workOrderRelationship || {};
  }

  function normalizeGovernedWorkOrderNumber(value) {
    const text = String(value ?? '').trim();
    return /^\d{1,7}$/.test(text) ? text.padStart(7, '0') : '';
  }

  function getGovernedEvidenceIdentity(relationship, workOrderNumber) {
    const candidates = Array.isArray(relationship?.candidates) ? relationship.candidates : [];
    const matchingCandidate = candidates.find(candidate =>
      normalizeGovernedWorkOrderNumber(candidate?.workOrderNumber) === workOrderNumber
    ) || {};
    return {
      snapshotId: String(matchingCandidate.sourceSnapshotId || relationship?.sourceSnapshotId || '').trim(),
      importRunId: String(matchingCandidate.sourceImportRunId || relationship?.sourceImportRunId || '').trim()
    };
  }

  function createGovernedResolution(options = {}) {
    return {
      actionable: Boolean(options.actionable),
      workOrderNumber: options.actionable ? String(options.workOrderNumber || '') : '',
      evidenceWorkOrderNumber: String(options.evidenceWorkOrderNumber || ''),
      source: options.actionable ? String(options.source || 'NONE') : 'NONE',
      relationshipStatus: String(options.relationshipStatus || 'UNRESOLVED'),
      approvalClassification: String(options.approvalClassification || 'NO_APPROVAL'),
      approvalDecisionId: String(options.approvalDecisionId || ''),
      reason: String(options.reason || ''),
      snapshotId: String(options.snapshotId || ''),
      importRunId: String(options.importRunId || ''),
      presentationPrimary: String(options.presentationPrimary || options.workOrderNumber || '\u2014'),
      presentationSecondary: String(options.presentationSecondary || ''),
      presentationKind: String(options.presentationKind || 'unknown')
    };
  }

  function resolveGovernedWorkOrderForAction(row, approvalState = getApprovalReview(row)) {
    const relationship = getWorkOrderRelationship(row);
    const status = String(relationship.resolutionStatus || relationship.status || 'UNRESOLVED').trim();
    const membership = dashboardState.rmaMemberships.get(getApprovalKey(row));
    if (membership) {
      const approvalNumber = normalizeGovernedWorkOrderNumber(
        approvalState?.currentApproval?.approvedWorkOrderNumber
      );
      const exactNumber = normalizeGovernedWorkOrderNumber(relationship.actionableWorkOrderNumber);
      const candidateNumber = normalizeGovernedWorkOrderNumber(relationship.candidates?.[0]?.workOrderNumber);
      return createGovernedResolution({
        relationshipStatus: 'RMA_CONTROLLED',
        approvalClassification: approvalState?.conflictClassification || 'NO_APPROVAL',
        approvalDecisionId: approvalState?.currentApproval?.decisionId,
        evidenceWorkOrderNumber: approvalNumber || exactNumber || candidateNumber,
        reason: 'The active RMA/Rework case controls this line. Canonical and approved Work Order evidence remains available in Review.',
        presentationPrimary: 'Decision Pending',
        presentationSecondary: 'RMA / Rework · ' + (membership.caseReference || 'Active Case'),
        presentationKind: 'rma-controlled'
      });
    }
    const currentApproval = approvalState?.currentApproval || null;
    const approvalClassification = String(
      approvalState?.conflictClassification || (currentApproval ? 'UNKNOWN_APPROVAL' : 'NO_APPROVAL')
    ).trim();
    const approvalDecisionId = String(currentApproval?.decisionId || '').trim();

    if (currentApproval) {
      const approved = normalizeGovernedWorkOrderNumber(currentApproval.approvedWorkOrderNumber);
      const evidence = getGovernedEvidenceIdentity(relationship, approved);
      const safeLabels = {
        APPROVED_AGREES_EXACT: 'Approved · ERP Agrees',
        APPROVED_SUPPORTED_CANDIDATE: 'Approved · Candidate Supported'
      };
      if (approved && safeLabels[approvalClassification]) {
        return createGovernedResolution({
          actionable: true,
          workOrderNumber: approved,
          evidenceWorkOrderNumber: approved,
          source: 'APPROVAL',
          relationshipStatus: status,
          approvalClassification,
          approvalDecisionId,
          snapshotId: evidence.snapshotId,
          importRunId: evidence.importRunId,
          presentationPrimary: approved,
          presentationSecondary: safeLabels[approvalClassification],
          presentationKind: 'approved'
        });
      }
      const blocked = {
        APPROVED_CONFLICTS_EXACT: ['Approved · ERP Conflict', 'Approved Work Order conflicts with current ERP evidence.'],
        APPROVED_NOT_IN_CURRENT_CANDIDATES: ['Approved · Unsupported', 'Approved Work Order is no longer supported by current canonical data.'],
        APPROVED_WORK_ORDER_MISSING: ['Approved · WO Missing', 'Approved Work Order is missing from the canonical Work Order dataset.'],
        APPROVED_WITH_CURRENT_AMBIGUITY: ['Approved · Ambiguous', 'Multiple Work Order candidates must be resolved first.']
      }[approvalClassification] || [
        'Approved · Review Required',
        approved
          ? 'Approval state is not recognized. Review is required.'
          : 'Approved Work Order is incomplete or invalid. Review is required.'
      ];
      return createGovernedResolution({
        relationshipStatus: status,
        approvalClassification,
        approvalDecisionId,
        evidenceWorkOrderNumber: approved,
        reason: blocked[1],
        snapshotId: evidence.snapshotId,
        importRunId: evidence.importRunId,
        presentationPrimary: approved || '\u2014',
        presentationSecondary: blocked[0],
        presentationKind: 'conflict'
      });
    }

    if (approvalClassification && approvalClassification !== 'NO_APPROVAL') {
      return createGovernedResolution({
        relationshipStatus: status,
        approvalClassification,
        reason: 'Approval state is not recognized. Review is required.',
        presentationSecondary: 'Approval Review Required',
        presentationKind: 'conflict'
      });
    }

    const candidates = Array.isArray(relationship.candidates) ? relationship.candidates : [];
    const candidateNumbers = candidates
      .map(candidate => normalizeGovernedWorkOrderNumber(candidate?.workOrderNumber))
      .filter(Boolean);
    const declaredCount = Number.isInteger(relationship.candidateCount) && relationship.candidateCount >= 0
      ? relationship.candidateCount
      : null;
    if (status === 'EXACT_LINE_UNIQUE') {
      const workOrderNumber = normalizeGovernedWorkOrderNumber(relationship.actionableWorkOrderNumber);
      if (workOrderNumber) {
        const evidence = getGovernedEvidenceIdentity(relationship, workOrderNumber);
        return createGovernedResolution({
          actionable: true,
          workOrderNumber,
          evidenceWorkOrderNumber: workOrderNumber,
          source: 'EXACT',
          relationshipStatus: status,
          snapshotId: evidence.snapshotId,
          importRunId: evidence.importRunId,
          presentationPrimary: workOrderNumber,
          presentationSecondary: 'ERP Confirmed',
          presentationKind: 'confirmed'
        });
      }
      return createGovernedResolution({
        relationshipStatus: status,
        reason: 'The exact ERP relationship has no valid governing Work Order.',
        presentationSecondary: 'Exact Relationship Invalid'
      });
    }
    if (status === 'AMBIGUOUS') {
      const consistent = declaredCount !== null && declaredCount > 1 &&
        candidateNumbers.length === declaredCount && candidates.length === declaredCount;
      return createGovernedResolution({
        relationshipStatus: status,
        reason: 'Multiple Work Order candidates must be resolved first.',
        presentationPrimary: consistent ? 'Conflict (' + declaredCount + ')' : 'Conflict',
        presentationSecondary: 'Review Required',
        presentationKind: 'conflict'
      });
    }
    if (status === 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE' || status === 'SALES_ORDER_LEVEL_CANDIDATE') {
      const consistent = candidates.length === 1 && candidateNumbers.length === 1 &&
        (declaredCount === null || declaredCount === 1);
      if (consistent) {
        const evidence = getGovernedEvidenceIdentity(relationship, candidateNumbers[0]);
        return createGovernedResolution({
          relationshipStatus: status,
          evidenceWorkOrderNumber: candidateNumbers[0],
          reason: 'Candidate Work Order must be approved before opening the Work Order Dashboard.',
          snapshotId: evidence.snapshotId,
          importRunId: evidence.importRunId,
          presentationPrimary: candidateNumbers[0],
          presentationSecondary: 'Candidate',
          presentationKind: 'candidate'
        });
      }
      return createGovernedResolution({
        relationshipStatus: status,
        reason: 'Candidate evidence is incomplete or inconsistent. Review is required.',
        presentationPrimary: candidateNumbers.length > 1 ? 'Conflict' : '\u2014',
        presentationSecondary: candidateNumbers.length > 1 ? 'Candidate Data Conflict' : 'Candidate Unavailable',
        presentationKind: candidateNumbers.length > 1 ? 'conflict' : 'unknown'
      });
    }
    if (status === 'UNRESOLVED') {
      return createGovernedResolution({
        relationshipStatus: status,
        reason: 'No governing Work Order is available for this Sales Order line.',
        presentationSecondary: 'No Candidate',
        presentationKind: 'unresolved'
      });
    }
    return createGovernedResolution({
      relationshipStatus: status || 'UNKNOWN',
      reason: 'The Work Order relationship status is not recognized. Review is required.',
      presentationSecondary: 'Unknown Relationship'
    });
  }

  function getWorkOrderPresentation(row) {
    const resolution = resolveGovernedWorkOrderForAction(row);
    return createWorkOrderPresentation(
      resolution.relationshipStatus,
      resolution.presentationPrimary,
      resolution.presentationSecondary,
      resolution.actionable,
      resolution.presentationKind,
      resolution.reason
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
          dashboardState.workOrderActionInProgress ? ' disabled aria-busy="true"' : '',
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

  function getSelectedWorkOrderActionState(selectedRows = dashboardState.selectedWorkOrders) {
    if (selectedRows.length !== 1) {
      return {
        enabled: false,
        row: null,
        reason: selectedRows.length > 1
          ? 'Select exactly one Sales Order line to open a Work Order Dashboard.'
          : 'Select one actionable Sales Order line to open a Work Order Dashboard.'
      };
    }
    const row = selectedRows[0];
    const resolution = resolveGovernedWorkOrderForAction(row);
    return {
      enabled: resolution.actionable && !dashboardState.workOrderActionInProgress,
      row,
      resolution,
      reason: resolution.actionable
        ? 'Open governed Work Order ' + resolution.workOrderNumber + '.'
        : resolution.reason
    };
  }

  function updateWorkOrderDashboardAction() {
    const button = document.getElementById('salesOrderDashboardOpenWorkOrderButton');
    if (!button) return;
    const actionState = getSelectedWorkOrderActionState();
    button.disabled = !actionState.enabled;
    button.title = actionState.reason;
    button.setAttribute('aria-busy', dashboardState.workOrderActionInProgress ? 'true' : 'false');
  }

  function setWorkOrderActionMessage(message) {
    dashboardState.workOrderActionMessage = String(message || '');
    const status = document.getElementById('salesOrderDashboardStatus');
    if (status) status.textContent = dashboardState.workOrderActionMessage ||
      'Sales Order Dashboard ready. Future digital Sales Order folder workflows will live here.';
  }

  function isCurrentActionRow(row, generation) {
    if (generation !== dashboardState.approvalRequestGeneration) return false;
    const rowKey = getApprovalKey(row);
    return Boolean(rowKey && getRelatedRows().some(current => getApprovalKey(current) === rowKey));
  }

  async function refreshApprovalReviewForAction(row, generation) {
    if (!window.DleApiClient?.getWorkOrderApprovalReview) {
      throw new Error('Current governed Work Order approval evidence is unavailable.');
    }
    const identity = getApprovalLineIdentity(row);
    const review = await window.DleApiClient.getWorkOrderApprovalReview(
      identity.customerNumber, identity.salesOrderNumber, identity.lineNumber
    );
    if (!isCurrentActionRow(row, generation)) {
      const error = new Error('The selected Sales Order line changed while evidence was loading.');
      error.code = 'STALE_ACTION';
      throw error;
    }
    dashboardState.approvalReviews.set(getApprovalKey(row), review);
    return review;
  }

  async function loadCanonicalWorkOrderForResolution(resolution) {
    if (!resolution?.actionable || !resolution.workOrderNumber) {
      throw new Error(resolution?.reason || 'No governing Work Order is available.');
    }
    const getWorkOrders = window.DleApiClient?.liveCanonical?.getCanonicalWorkOrders;
    if (typeof getWorkOrders !== 'function') {
      throw new Error('Canonical Work Order lookup is unavailable.');
    }
    const result = await getWorkOrders({
      page: 1,
      pageSize: 2,
      workOrderNumber: resolution.workOrderNumber
    });
    const items = Array.isArray(result?.items) ? result.items : [];
    const totalItems = Number.isInteger(result?.totalItems) ? result.totalItems : items.length;
    if (totalItems !== 1 || items.length !== 1) {
      throw new Error(totalItems > 1 || items.length > 1
        ? 'Canonical Work Order lookup returned multiple records. Navigation is blocked.'
        : 'Canonical Work Order was not found. Navigation is blocked.');
    }
    const canonicalNumber = normalizeGovernedWorkOrderNumber(items[0]?.workOrderNumber);
    if (!canonicalNumber || canonicalNumber !== resolution.workOrderNumber) {
      throw new Error('Canonical Work Order lookup returned an inconsistent record. Navigation is blocked.');
    }
    return { ...items[0], workOrderNumber: canonicalNumber };
  }

  function getOriginRevision(row) {
    return String(
      row?.official?.revision || row?.masterRecord?.vpro5?.revisionCode ||
      row?.masterRecord?.vpro5?.revision || row?.masterRecord?.revision || ''
    ).trim();
  }

  function buildGovernedWorkOrderHandoff(row, resolution, canonicalWorkOrder) {
    const official = row?.official || {};
    const source = row?.masterRecord?.vpro5 || {};
    const canonical = { ...canonicalWorkOrder };
    return {
      canonicalWorkOrder: canonical,
      originRow: row,
      workOrderNumber: resolution.workOrderNumber,
      canonicalCustomerNumber: String(canonical.customerNumber || '').trim(),
      canonicalSalesOrderNumber: String(canonical.salesOrderNumber || '').trim(),
      canonicalAnchorLine: String(canonical.salesOrderLineNumber || '').trim(),
      itemNumber: String(canonical.itemNumber || '').trim(),
      workOrderQuantity: canonical.schProdQuantity,
      workOrderStatus: String(canonical.workOrderStatus || '').trim(),
      originCustomerNumber: String(official.customerNumber || source.customerNumber || '').trim(),
      originCustomerName: String(official.customer || source.customer || '').trim(),
      originSalesOrderNumber: String(official.salesOrder || source.salesOrder || '').trim(),
      originSalesOrderLine: String(official.sequenceLine || source.sequenceLine || '').trim(),
      originItemNumber: String(official.partNumber || source.partNumber || '').trim(),
      originRevision: getOriginRevision(row),
      originQuantity: parseDashboardQuantity(official.opQtyOpen ?? source.qtyOpen),
      originDueDate: String(official.dueDate || source.dueDate || '').trim(),
      relationshipStatus: resolution.relationshipStatus,
      approvalClassification: resolution.approvalClassification,
      approvalDecisionId: resolution.approvalDecisionId,
      governingSource: resolution.source,
      snapshotId: resolution.snapshotId,
      importRunId: resolution.importRunId
    };
  }

  async function qualifyGovernedWorkOrderForAction(row, generation) {
    const approvalReview = await refreshApprovalReviewForAction(row, generation);
    const resolution = resolveGovernedWorkOrderForAction(row, approvalReview);
    if (!resolution.actionable) throw new Error(resolution.reason);
    const canonicalWorkOrder = await loadCanonicalWorkOrderForResolution(resolution);
    if (!isCurrentActionRow(row, generation)) {
      const error = new Error('The selected Sales Order line changed while the Work Order was loading.');
      error.code = 'STALE_ACTION';
      throw error;
    }
    return { resolution, canonicalWorkOrder };
  }

  function updateRequestToShipAction() {
    const button = document.getElementById('salesOrderDashboardCreateRequestToShipButton');
    if (!button) return;

    const selectedRows = dashboardState.selectedWorkOrders;
    const enabled = selectedRows.length > 0 && selectedRows.every(isValidWorkOrder) &&
      !dashboardState.workOrderActionInProgress;
    button.disabled = !enabled;
    const blocked = selectedRows.find(row => !isValidWorkOrder(row));
    button.title = enabled
      ? 'Create one Request to Ship for the selected Sales Order line' + (selectedRows.length === 1 ? '.' : 's.')
      : blocked
        ? getWorkOrderPresentation(blocked).reason
        : 'Select one or more valid Sales Order lines before creating a Request to Ship.';
  }

  async function openRequestToShipDialog() {
    if (dashboardState.workOrderActionInProgress) return;
    const selectedRows = dashboardState.selectedWorkOrders.filter(isValidWorkOrder);
    if (!selectedRows.length || selectedRows.length !== dashboardState.selectedWorkOrders.length) return;

    const orderOfficial = dashboardState.selectedOrder?.official || {};
    const firstOfficial = selectedRows[0]?.official || {};
    const dialog = document.getElementById('requestToShipDialog');
    if (!dialog) return;

    const generation = dashboardState.approvalRequestGeneration;
    const returnFocus = document.activeElement;
    dashboardState.workOrderActionInProgress = true;
    setWorkOrderActionMessage('Confirming current governed Work Order evidence…');
    updateRequestToShipAction();
    updateWorkOrderDashboardAction();
    try {
      const qualified = await Promise.all(selectedRows.map(row =>
        qualifyGovernedWorkOrderForAction(row, generation)
      ));
      dashboardState.requestDialogLines = selectedRows.map((row, index) =>
        buildRequestDialogLine(row, index, qualified[index].resolution, qualified[index].canonicalWorkOrder)
      );

      setText('requestToShipCustomer', orderOfficial.customer || firstOfficial.customer || 'N/A');
      setText('requestToShipSalesOrder', orderOfficial.salesOrder || firstOfficial.salesOrder || 'N/A');
      setText('requestToShipSelectedLineCount', String(dashboardState.requestDialogLines.length));
      const requestedShipWindow = document.getElementById('requestToShipWindow');
      if (requestedShipWindow) requestedShipWindow.value = DEFAULT_REQUESTED_SHIP_WINDOW;
      renderRequestToShipDialogLines();

      requestDialogReturnFocus = returnFocus;
      dashboardState.requestDialogOpen = true;
      dialog.hidden = false;
      validateRequestToShipQuantity();
      const firstQuantityInput = getRequestLineQuantityInput(0);
      firstQuantityInput?.focus?.();
      firstQuantityInput?.select?.();
      setWorkOrderActionMessage('Current governed Work Order evidence confirmed.');
    } catch (error) {
      if (generation === dashboardState.approvalRequestGeneration) {
        setWorkOrderActionMessage(error?.message || 'Request to Ship is blocked because governed evidence could not be confirmed.');
      }
    } finally {
      if (generation === dashboardState.approvalRequestGeneration) {
        dashboardState.workOrderActionInProgress = false;
        renderSalesOrderDashboardModule();
      }
    }
  }

  function buildRequestDialogLine(sourceWorkOrder, index, resolution = resolveGovernedWorkOrderForAction(sourceWorkOrder), canonicalWorkOrder = null) {
    const official = sourceWorkOrder?.official || {};
    const masterVpro5 = sourceWorkOrder?.masterRecord?.vpro5 || {};
    if (!resolution.actionable || !resolution.workOrderNumber) {
      throw new Error(resolution.reason || 'No governing Work Order is available for this Sales Order line.');
    }
    return {
      lineIndex: index,
      masterRecordKey: sourceWorkOrder?.masterRecordKey || '',
      customerNumber: official.customerNumber || masterVpro5.customerNumber || '',
      customer: official.customer || masterVpro5.customer || '',
      salesOrder: official.salesOrder || masterVpro5.salesOrder || '',
      salesOrderLine: official.sequenceLine || masterVpro5.sequenceLine || '',
      workOrder: resolution.workOrderNumber,
      assembly: official.partNumber || masterVpro5.partNumber || '',
      description: official.description || masterVpro5.description || '',
      openQuantity: parseDashboardQuantity(official.opQtyOpen ?? masterVpro5.qtyOpen),
      dueDate: official.dueDate || masterVpro5.dueDate || '',
      sourceWorkOrder,
      governedWorkOrder: { ...resolution },
      canonicalWorkOrder: canonicalWorkOrder ? { ...canonicalWorkOrder } : null
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

  async function openWorkOrderDashboard(event) {
    event?.stopPropagation();
    const target = event?.currentTarget || event?.target;
    const index = Number(target?.dataset?.relatedRowIndex);
    const selectedRow = getRelatedRows()[index];
    if (!selectedRow) return false;
    return navigateToGovernedWorkOrder(selectedRow, target);
  }

  async function openSelectedWorkOrderDashboard(event) {
    event?.stopPropagation();
    const actionState = getSelectedWorkOrderActionState();
    if (!actionState.enabled || !actionState.row) {
      setWorkOrderActionMessage(actionState.reason);
      return false;
    }
    return navigateToGovernedWorkOrder(actionState.row, event?.currentTarget || event?.target);
  }

  async function navigateToGovernedWorkOrder(row, returnFocusElement = null) {
    if (dashboardState.workOrderActionInProgress) return false;
    const initialResolution = resolveGovernedWorkOrderForAction(row);
    if (!initialResolution.actionable) {
      setWorkOrderActionMessage(initialResolution.reason);
      return false;
    }

    const generation = dashboardState.approvalRequestGeneration;
    dashboardState.workOrderActionInProgress = true;
    setWorkOrderActionMessage('Loading canonical Work Order ' + initialResolution.workOrderNumber + '…');
    document.querySelectorAll('.sales-order-dashboard-work-order-link').forEach(button => {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    });
    updateRequestToShipAction();
    updateWorkOrderDashboardAction();
    let navigated = false;
    try {
      const qualified = await qualifyGovernedWorkOrderForAction(row, generation);
      const handoff = buildGovernedWorkOrderHandoff(
        row, qualified.resolution, qualified.canonicalWorkOrder
      );
      if (typeof window.WorkOrderDashboardModule?.setSelectedWorkOrder !== 'function' ||
          typeof go !== 'function') {
        throw new Error('Work Order Dashboard navigation is unavailable.');
      }
      window.WorkOrderDashboardModule.setSelectedWorkOrder(handoff);
      setWorkOrderActionMessage('Canonical Work Order ' + qualified.resolution.workOrderNumber + ' loaded.');
      go('workOrderDashboardModule');
      navigated = true;
      return true;
    } catch (error) {
      if (generation === dashboardState.approvalRequestGeneration) {
        setWorkOrderActionMessage(error?.message || 'Work Order Dashboard navigation was blocked.');
      }
      return false;
    } finally {
      const actionStillCurrent = generation === dashboardState.approvalRequestGeneration;
      if (actionStillCurrent) {
        dashboardState.workOrderActionInProgress = false;
        renderSalesOrderDashboardModule();
      }
      if (!navigated && actionStillCurrent) {
        const rowIndex = getRelatedRows().findIndex(current => getApprovalKey(current) === getApprovalKey(row));
        const refreshedInline = rowIndex >= 0
          ? document.querySelector('.sales-order-dashboard-work-order-link[data-related-row-index="' + rowIndex + '"]')
          : null;
        const focusTarget = returnFocusElement?.isConnected ? returnFocusElement :
          refreshedInline || document.getElementById('salesOrderDashboardOpenWorkOrderButton');
        focusTarget?.focus?.();
      }
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
      .map(row => resolveGovernedWorkOrderForAction(row).workOrderNumber)
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
    const generation = dashboardState.approvalRequestGeneration;
    const rowKey = getApprovalKey(row);
    dashboardState.approvalReviewRow = row;
    dashboardState.approvalReasonState = null;
    approvalDialogReturnFocus = {
      element: event?.currentTarget || null,
      rowKey
    };
    const dialog = document.getElementById('workOrderApprovalDialog');
    if (dialog) dialog.hidden = false;
    setText('workOrderApprovalMessage', 'Loading current governed evidence…');
    try {
      const identity = getApprovalLineIdentity(row);
      const review = await window.DleApiClient.getWorkOrderApprovalReview(
        identity.customerNumber, identity.salesOrderNumber, identity.lineNumber
      );
      const reviewStillCurrent = generation === dashboardState.approvalRequestGeneration &&
        dashboardState.approvalReviewRow &&
        getApprovalKey(dashboardState.approvalReviewRow) === rowKey &&
        getRelatedRows().some(current => getApprovalKey(current) === rowKey);
      if (!reviewStillCurrent) return;
      dashboardState.approvalReviews.set(rowKey, review);
      renderSalesOrderDashboardModule();
      renderWorkOrderApprovalDialog(review, row);
    } catch (error) {
      if (generation === dashboardState.approvalRequestGeneration &&
          getApprovalKey(dashboardState.approvalReviewRow) === rowKey) {
        setText('workOrderApprovalMessage', error.message || 'Approval evidence could not be loaded.');
      }
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
    const rmaControl = review?.rmaReworkControl;
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
    const readOnlyRma = !!rmaControl?.active;
    document.querySelector('label[for="workOrderApprovalReasonCode"]')?.toggleAttribute('hidden', readOnlyRma);
    document.querySelector('label[for="workOrderApprovalNote"]')?.toggleAttribute('hidden', readOnlyRma);
    if (actionField) actionField.hidden = readOnlyRma || actions.length < 2;
    setText('workOrderApprovalMessage', readOnlyRma
      ? 'Read-only historical evidence. The active RMA/Rework case controls the Work Order decision.'
      : 'Review current canonical evidence before recording a decision.');
    if (!readOnlyRma) document.getElementById('workOrderApprovalReasonCode')?.focus();
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
        await openWorkOrderApprovalReview({
          currentTarget: approvalDialogReturnFocus?.element,
          stopPropagation() {}
        });
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
    const returnState = approvalDialogReturnFocus;
    approvalDialogReturnFocus = null;
    if (returnState?.element?.isConnected) {
      returnState.element.focus?.();
      return;
    }
    const rowIndex = getRelatedRows().findIndex(row => getApprovalKey(row) === returnState?.rowKey);
    const refreshedReview = rowIndex >= 0
      ? document.querySelector('.sales-order-dashboard-work-order-review[data-related-row-index="' + rowIndex + '"]')
      : null;
    refreshedReview?.focus?.();
  }

  function handleWorkOrderApprovalKeydown(event) {
    if (event?.key === 'Escape' && !document.getElementById('workOrderApprovalDialog')?.hidden)
      closeWorkOrderApprovalReview();
  }

  function getRmaLineQuantities(row) {
    const official = row?.official || {};
    const source = row?.masterRecord || {};
    const vpro5 = source.vpro5 || {};
    return {
      revision: String(source.drawingRevision || source.bomRevision || official.revision || vpro5.revision || '').trim(),
      quantityOrdered: parseDashboardQuantity(official.quantityOrdered ?? source.quantityOrdered ?? vpro5.quantityOrdered),
      erpQuantityOpen: parseDashboardQuantity(official.erpQtyOpen ?? source.erpQuantityOpen ?? vpro5.qtyOpen),
      pendingInvoiceQuantity: parseDashboardQuantity(official.pendingInvoiceQty),
      operationalQuantityOpen: parseDashboardQuantity(official.opQtyOpen ?? source.erpQuantityOpen ?? vpro5.qtyOpen)
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
    if (button) button.disabled = !!message || dashboardState.rmaSubmitting;
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
  window.SalesOrderDashboard.openWorkOrderDashboard = openWorkOrderDashboard;
  window.SalesOrderDashboard.openSelectedWorkOrderDashboard = openSelectedWorkOrderDashboard;
  window.SalesOrderDashboard.navigateToGovernedWorkOrder = navigateToGovernedWorkOrder;
  window.SalesOrderDashboard.resolveGovernedWorkOrderForAction = resolveGovernedWorkOrderForAction;
  window.SalesOrderDashboard.loadCanonicalWorkOrderForResolution = loadCanonicalWorkOrderForResolution;
  window.SalesOrderDashboard.buildGovernedWorkOrderHandoff = buildGovernedWorkOrderHandoff;
  window.SalesOrderDashboard.buildRequestDialogLine = buildRequestDialogLine;
  window.SalesOrderDashboard.getSelectedWorkOrderActionState = getSelectedWorkOrderActionState;
  window.SalesOrderDashboard.getWorkOrderPresentation = getWorkOrderPresentation;
  window.SalesOrderDashboard.openWorkOrderApprovalReview = openWorkOrderApprovalReview;
  window.SalesOrderDashboard.getApprovalReasonRecommendation = getApprovalReasonRecommendation;
  window.SalesOrderDashboard.getCanonicalApprovalChoices = getCanonicalApprovalChoices;
  window.SalesOrderDashboard.getDefaultApprovalWorkOrder = getDefaultApprovalWorkOrder;
  window.SalesOrderDashboard.openSalesOrderLineReview = openSalesOrderLineReview;
  window.SalesOrderDashboard.toggleReviewCandidate = toggleSalesOrderReviewCandidate;
  window.SalesOrderDashboard.openRmaReworkClassification = openRmaReworkClassification;
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
  window.openSelectedSalesOrderDashboardWorkOrder = openSelectedWorkOrderDashboard;
  window.openWorkOrderApprovalReview = openWorkOrderApprovalReview;
  window.openSalesOrderLineReview = openSalesOrderLineReview;
  window.closeSalesOrderLineReview = closeSalesOrderLineReview;
  window.continueWorkOrderRelationshipReview = continueWorkOrderRelationshipReview;
  window.continueRmaReworkLineReview = continueRmaReworkLineReview;
  window.closeWorkOrderApprovalReview = closeWorkOrderApprovalReview;
  window.submitWorkOrderApproval = submitWorkOrderApproval;
  window.changeWorkOrderApprovalCandidate = changeWorkOrderApprovalCandidate;
  window.changeWorkOrderApprovalReason = changeWorkOrderApprovalReason;
  window.changeWorkOrderApprovalAction = changeWorkOrderApprovalAction;
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

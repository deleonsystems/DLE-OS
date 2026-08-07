/* -----------------------------------------------------
   480 - JS: WORK ORDER DASHBOARD MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.WorkOrderDashboardModule = window.WorkOrderDashboardModule || {};
  let selectedWorkOrder = null;
  let currentView = 'standard';
  let scheduledReleasesExpanded = false;
  let kittedBomEvidence = null;
  let kittedBomEvidenceState = 'idle';
  let kittedBomRequestId = 0;
  let dispositionReview = null;
  let dispositionHistory = [];
  let dispositionState = 'idle';
  let dispositionRequestId = 0;
  let operationalStateSubscription = null;
  const kittedBomEndpoint = '/api/development/kitting-documents/v1/work-orders/';
  const releasedBomPrototypeWorkOrder = '0115621';
  const releasedBomPrototypePath = '/Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/index.html';

  const dashboardViews = {
    standard: ['overview', 'scheduled-releases', 'manufacturing-documents', 'module-placeholder'],
    kitting: ['overview', 'scheduled-releases', 'manufacturing-documents', 'kitting-workspace'],
    production: ['overview', 'manufacturing-documents', 'production-workspace']
  };
  const supportedDashboardViews = new Set(Object.keys(dashboardViews));

  /*
    Work Order Dashboard is the future digital replacement for the
    physical Work Order packet. This phase establishes module ownership,
    contextual navigation, and selected-record data passing only.
  */

  async function loadWorkOrderDashboardModule() {
    const placeholder = document.getElementById('workOrderDashboardModule');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/work-order-dashboard/work-order-dashboard.html');
    if (!response.ok) {
      throw new Error('Unable to load Work Order Dashboard module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;
  }

  function initializeWorkOrderDashboardModule() {
    ensureOperationalStateSubscription();
    currentView = 'standard';
    scheduledReleasesExpanded = false;
    resetKittedBomEvidence();
    resetKittingDisposition();
    renderWorkOrderDashboardModule();
  }

  function setSelectedWorkOrder(selection) {
    const route = cleanText(selection?.operationalRelationship?.operationalRoute);
    const blockedReturnNavigation = ['RMA_REWORK', 'RETURN_RMA_REVIEW_REQUIRED'].includes(route) &&
      !cleanText(selection?.operationalRelationship?.activeWorkOrderNumber);
    selectedWorkOrder = !blockedReturnNavigation && (isGovernedHandoff(selection) || selection?.official)
      ? selection
      : null;
    currentView = getPreferredDashboardView(selection);
    scheduledReleasesExpanded = false;
    resetKittedBomEvidence();
    resetKittingDisposition();
    renderWorkOrderDashboardModule();
  }

  function setDashboardView(viewName) {
    currentView = supportedDashboardViews.has(viewName) ? viewName : 'standard';
    renderWorkOrderDashboardModule();
  }

  function ensureOperationalStateSubscription() {
    if (operationalStateSubscription || !window.DleApiClient?.subscribeOperationalLineStateChange) return;
    operationalStateSubscription = window.DleApiClient.subscribeOperationalLineStateChange(detail => {
      const refresh = refreshSelectedOperationalRelationship(detail.lines);
      detail.waitUntil?.(refresh);
      return refresh;
    });
  }

  async function refreshSelectedOperationalRelationship(lines) {
    if (!selectedWorkOrder) return;
    const customerNumber = cleanText(selectedWorkOrder.customerNumber ||
      selectedWorkOrder.originCustomerNumber || selectedWorkOrder.originRow?.official?.customerNumber ||
      selectedWorkOrder.official?.customerNumber);
    const salesOrderNumber = cleanText(selectedWorkOrder.salesOrderNumber ||
      selectedWorkOrder.originSalesOrderNumber || selectedWorkOrder.originRow?.official?.salesOrder ||
      selectedWorkOrder.official?.salesOrder);
    const lineNumber = cleanText(selectedWorkOrder.salesOrderLineNumber ||
      selectedWorkOrder.originSalesOrderLine || selectedWorkOrder.originRow?.official?.sequenceLine ||
      selectedWorkOrder.official?.sequenceLine);
    if (!(lines || []).some(line => line.customerNumber === customerNumber &&
        line.salesOrderNumber === salesOrderNumber && line.lineNumber === lineNumber)) return;
    const operationalRelationship = await window.DleApiClient.getOperationalWorkOrderRelationship(
      customerNumber, salesOrderNumber, lineNumber
    );
    if (['RMA_REWORK', 'RETURN_RMA_REVIEW_REQUIRED'].includes(operationalRelationship?.operationalRoute) &&
        !cleanText(operationalRelationship?.activeWorkOrderNumber)) {
      selectedWorkOrder = null;
    } else {
      selectedWorkOrder = { ...selectedWorkOrder, operationalRelationship };
    }
    renderWorkOrderDashboardModule();
  }

  function getPreferredDashboardView(handoff) {
    const preferredView = cleanText(handoff?.preferredDashboardView).toLowerCase();
    return supportedDashboardViews.has(preferredView) ? preferredView : 'standard';
  }

  function renderWorkOrderDashboardModule() {
    const status = document.getElementById('workOrderDashboardModuleStatus');
    if (status) {
      status.textContent = isGovernedHandoff(selectedWorkOrder)
        ? 'Canonical Work Order ' + selectedWorkOrder.workOrderNumber +
          ' loaded. Current view: ' + getViewLabel(currentView) + '.'
        : 'Work Order Dashboard ready. Current view: ' + getViewLabel(currentView) + '.';
    }
    const returnButton = document.getElementById('workOrderDashboardReturnToKitting');
    if (returnButton) returnButton.hidden = selectedWorkOrder?.returnWorkspaceId !== 'kitting';
    syncDashboardViewSelector();
    applyDashboardView();
    syncScheduledReleasesCollapseState();
    renderSelectedWorkOrderSummary();
    renderRelatedWorkOrders();
    renderReleasedBomControl();
    renderKittedBomEvidenceControl();
    renderKittingDisposition();
    if (currentView === 'kitting') {
      void ensureKittedBomEvidence();
      void ensureKittingDisposition();
    }
  }

  function resetKittingDisposition() {
    dispositionRequestId += 1;
    dispositionReview = null;
    dispositionHistory = [];
    dispositionState = 'idle';
  }

  function normalizeReleasedBomWorkOrder(value) {
    const workOrder = cleanText(value);
    if (!/^\d{6,7}$/.test(workOrder)) return '';
    return workOrder.padStart(7, '0');
  }

  function getSelectedReleasedBomWorkOrder() {
    return normalizeReleasedBomWorkOrder(
      selectedWorkOrder?.workOrderNumber || selectedWorkOrder?.official?.workOrder
    );
  }

  function isReleasedBomPrototypeAvailable() {
    return window.location.port === '5051' && currentView === 'kitting' &&
      getSelectedReleasedBomWorkOrder() === releasedBomPrototypeWorkOrder;
  }

  function renderReleasedBomControl() {
    const button = document.getElementById('workOrderDashboardReleasedBom');
    if (!button) return;
    const inDevelopmentKittingView = window.location.port === '5051' && currentView === 'kitting';
    const available = isReleasedBomPrototypeAvailable();
    button.hidden = !inDevelopmentKittingView;
    button.disabled = !available;
    setText('workOrderDashboardReleasedBomLabel', available
      ? 'View Released BOM' : 'Released BOM prototype not yet available');
    setText('workOrderDashboardReleasedBomMessage', available
      ? 'WO 0115621 · 52 components · 48 messages · read only'
      : 'Available only for canonical WO 0115621 in development Kitting view.');
  }

  function openReleasedBomPrototype() {
    if (!isReleasedBomPrototypeAvailable()) return false;
    const reportUrl = new URL(releasedBomPrototypePath, window.location.origin);
    reportUrl.searchParams.set('source', '5051-kitting');
    reportUrl.searchParams.set('workOrder', releasedBomPrototypeWorkOrder);
    reportUrl.searchParams.set('return', window.location.pathname + window.location.search + window.location.hash);
    window.location.assign(reportUrl.href);
    return true;
  }

  async function ensureKittingDisposition(force = false) {
    if (currentView !== 'kitting' || !isActionableKittingDocumentHandoff(selectedWorkOrder) ||
        dispositionState === 'loading' || (!force && dispositionState === 'loaded')) return;
    const requestId = ++dispositionRequestId;
    dispositionState = 'loading'; renderKittingDisposition();
    try {
      const workOrder = selectedWorkOrder.workOrderNumber;
      const [review, history] = await Promise.all([
        window.DleApiClient.getKittingDisposition(workOrder),
        window.DleApiClient.getKittingDispositionHistory(workOrder)
      ]);
      if (requestId !== dispositionRequestId) return;
      dispositionReview = review;
      dispositionHistory = Array.isArray(history?.history) ? history.history : [];
      dispositionState = 'loaded';
    } catch (error) {
      if (requestId !== dispositionRequestId) return;
      dispositionState = 'error';
    }
    renderKittingDisposition();
  }

  function renderKittingDisposition() {
    const current = dispositionReview?.currentEvent || null;
    const value = dispositionReview?.currentDisposition || 'NOT_DISPOSITIONED';
    const labels = { NOT_DISPOSITIONED: 'Not Dispositioned', NEEDS_KITTING: 'Needs Kitting', KIT_SHORT: 'Kit Short', KIT_COMPLETE: 'Kit Complete' };
    setText('workOrderDashboardDispositionStatus', labels[value] || 'Not Dispositioned');
    setText('workOrderDashboardDispositionBy', current?.recordedBy || 'N/A');
    setText('workOrderDashboardDispositionAt', current?.recordedAtUtc ? new Date(current.recordedAtUtc).toLocaleString() : 'N/A');
    setText('workOrderDashboardDispositionNote', [current?.reasonCode, current?.note].filter(Boolean).join(' — ') || 'N/A');
    const button = document.getElementById('workOrderDashboardSetDisposition');
    const actionable = isActionableKittingDocumentHandoff(selectedWorkOrder) && Number(selectedWorkOrder?.originQuantity) > 0;
    const canDisposition = window.DleOsCapabilities?.can('kitting.disposition') !== false;
    if (button) {
      button.disabled = dispositionState !== 'loaded' || !actionable || !canDisposition;
      button.hidden = !canDisposition;
      button.textContent = current ? 'Change Disposition' : 'Set Kitting Disposition';
    }
    setText('workOrderDashboardDispositionMessage', dispositionState === 'error'
      ? 'Manual kitting disposition could not be loaded.' : dispositionState === 'loaded'
        ? 'Manual disposition is authoritative; document evidence is informational.' : 'Loading manual disposition...');
    const history = document.getElementById('workOrderDashboardDispositionHistory');
    if (history) history.innerHTML = dispositionHistory.length ? dispositionHistory.map(event =>
      '<li><strong>' + escapeDashboardHtml(labels[event.resultingDisposition] || event.resultingDisposition) + '</strong> — ' +
      escapeDashboardHtml(event.recordedBy) + ' · ' + escapeDashboardHtml(new Date(event.recordedAtUtc).toLocaleString()) +
      (event.reasonCode || event.note ? '<br>' + escapeDashboardHtml([event.reasonCode, event.note].filter(Boolean).join(' — ')) : '') +
      '</li>').join('') : '<li>No manual disposition events.</li>';
  }

  function openKittingDispositionDialog() {
    if (dispositionState !== 'loaded' || !isActionableKittingDocumentHandoff(selectedWorkOrder) || Number(selectedWorkOrder?.originQuantity) <= 0) return false;
    const dialog = document.getElementById('workOrderDashboardDispositionDialog');
    if (!dialog) return false;
    dialog.querySelectorAll('input[name="kittingDisposition"]').forEach(input => { input.checked = false; });
    document.getElementById('workOrderDispositionNote').value = '';
    setText('workOrderDispositionDialogError', '');
    setText('workOrderDispositionDialogWorkOrder', selectedWorkOrder.workOrderNumber);
    setText('workOrderDispositionDialogCustomer', [selectedWorkOrder.originCustomerNumber, selectedWorkOrder.originCustomerName].filter(Boolean).join(' · '));
    setText('workOrderDispositionDialogAssembly', [selectedWorkOrder.itemNumber, selectedWorkOrder.canonicalWorkOrder?.drawingRevision || selectedWorkOrder.canonicalWorkOrder?.bomRevision].filter(Boolean).join(' · '));
    setText('workOrderDispositionDialogOpenQuantity', formatQuantity(Number(selectedWorkOrder.originQuantity)));
    setText('workOrderDispositionDialogCurrent', dispositionReview.currentDisposition === 'NEEDS_KITTING' ? 'Needs Kitting' : dispositionReview.currentDisposition === 'KIT_SHORT' ? 'Kit Short' : dispositionReview.currentDisposition === 'KIT_COMPLETE' ? 'Kit Complete' : 'Not Dispositioned');
    setText('workOrderDispositionDialogCompleteEvidence', kittedBomEvidence?.primaryDocument?.documentType === 'complete' ? kittedBomEvidence.primaryDocument.fileName : 'Not found');
    const shortage = kittedBomEvidence?.secondaryPriorShortageDocument || (kittedBomEvidence?.primaryDocument?.documentType === 'shortage' ? kittedBomEvidence.primaryDocument : null);
    setText('workOrderDispositionDialogShortageEvidence', shortage?.fileName || 'Not found');
    updateKittingDispositionDialog(); dialog.showModal(); return true;
  }

  function updateKittingDispositionDialog() {
    const selected = document.querySelector('input[name="kittingDisposition"]:checked')?.value || '';
    const current = dispositionReview?.currentEvent;
    const select = document.getElementById('workOrderDispositionReason');
    const initialShort = !current && selected === 'KIT_SHORT';
    const changeToNeedsKitting = Boolean(current) && selected === 'NEEDS_KITTING';
    const reasons = current
      ? changeToNeedsKitting
        ? ['SHORTAGE_RETURNED_TO_KITTING','COMPLETION_REVERSED','ORDER_REQUIRES_REKIT','STATUS_ENTERED_IN_ERROR','ORDER_MODIFIED','OTHER']
        : ['SHORTAGE_RESOLVED','COMPLETION_REVERSED','ORDER_REQUIRES_REKIT','ORDER_MODIFIED','DOCUMENT_CORRECTION','STATUS_ENTERED_IN_ERROR','OTHER']
      : initialShort ? ['MATERIAL_UNAVAILABLE','INSUFFICIENT_QUANTITY','WRONG_MATERIAL','MATERIAL_ON_ORDER','BOM_DISCREPANCY','DOCUMENTATION_ISSUE','OTHER'] : [];
    if (select) {
      select.innerHTML = '<option value="">' + (changeToNeedsKitting ? 'Select reason or enter note' : reasons.length ? 'Select reason' : 'Not required') + '</option>' +
        reasons.map(reason => '<option value="' + reason + '">' + reason.replaceAll('_', ' ') + '</option>').join('');
      select.disabled = reasons.length === 0;
      select.required = reasons.length > 0 && !changeToNeedsKitting;
    }
  }

  function closeKittingDispositionDialog() {
    document.getElementById('workOrderDashboardDispositionDialog')?.close();
  }

  async function submitKittingDisposition(event) {
    event.preventDefault();
    const selected = document.querySelector('input[name="kittingDisposition"]:checked')?.value;
    const reason = document.getElementById('workOrderDispositionReason')?.value || null;
    const note = document.getElementById('workOrderDispositionNote')?.value.trim() || null;
    if (!selected) { setText('workOrderDispositionDialogError', 'Select Needs Kitting, Kit Short, or Kit Complete.'); return; }
    const confirm = document.getElementById('workOrderDispositionConfirm'); if (confirm) confirm.disabled = true;
    try {
      const updated = await window.DleApiClient.appendKittingDisposition(selectedWorkOrder.workOrderNumber, {
        resultingDisposition: selected, reasonCode: reason, note,
        expectedCurrentEventId: dispositionReview?.currentEvent?.eventId || null,
        customerNumber: selectedWorkOrder.originCustomerNumber,
        originSalesOrderNumber: selectedWorkOrder.originSalesOrderNumber,
        originSalesOrderLineNumber: selectedWorkOrder.originSalesOrderLine,
        assemblyItemNumber: selectedWorkOrder.itemNumber
      });
      dispositionReview = updated; dispositionHistory = updated.history || []; dispositionState = 'loaded';
      closeKittingDispositionDialog(); renderKittingDisposition();
      await window.DleWorkspaces?.kitting?.refresh?.();
    } catch (error) { setText('workOrderDispositionDialogError', error?.message || 'Disposition could not be recorded.'); }
    finally { if (confirm) confirm.disabled = false; }
  }

  function resetKittedBomEvidence() {
    kittedBomRequestId += 1;
    kittedBomEvidence = null;
    kittedBomEvidenceState = 'idle';
  }

  async function ensureKittedBomEvidence() {
    if (currentView !== 'kitting' || !isActionableKittingDocumentHandoff(selectedWorkOrder) ||
        kittedBomEvidenceState === 'loading' || kittedBomEvidenceState === 'loaded') return;

    const workOrderNumber = cleanText(selectedWorkOrder.workOrderNumber);
    if (!/^\d+$/.test(workOrderNumber)) {
      kittedBomEvidenceState = 'error';
      renderKittedBomEvidenceControl();
      return;
    }

    const requestId = ++kittedBomRequestId;
    kittedBomEvidenceState = 'loading';
    renderKittedBomEvidenceControl();
    try {
      const response = await fetch(kittedBomEndpoint + encodeURIComponent(workOrderNumber), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Kitted BOM evidence lookup failed.');
      const evidence = await response.json();
      if (requestId !== kittedBomRequestId || cleanText(selectedWorkOrder?.workOrderNumber) !== workOrderNumber) return;
      kittedBomEvidence = evidence;
      kittedBomEvidenceState = 'loaded';
    } catch (error) {
      if (requestId !== kittedBomRequestId) return;
      kittedBomEvidence = null;
      kittedBomEvidenceState = 'error';
    }
    renderKittedBomEvidenceControl();
  }

  function renderKittedBomEvidenceControl() {
    const placeholder = document.getElementById('workOrderDashboardKittedBomPlaceholder');
    const panel = document.getElementById('workOrderDashboardKittedBomEvidence');
    if (!placeholder || !panel) return;

    const showEvidence = currentView === 'kitting';
    placeholder.hidden = showEvidence;
    panel.hidden = !showEvidence;
    if (!showEvidence) return;

    const primaryButton = document.getElementById('workOrderDashboardKittedBomOpenPrimary');
    const priorButton = document.getElementById('workOrderDashboardKittedBomOpenPrior');
    const evidence = kittedBomEvidence;
    const primary = evidence?.primaryDocument || null;
    const prior = evidence?.secondaryPriorShortageDocument || null;
    const actionable = isActionableKittingDocumentHandoff(selectedWorkOrder);
    const loading = actionable && (kittedBomEvidenceState === 'loading' || kittedBomEvidenceState === 'idle');

    setText('workOrderDashboardKittedBomStatus', !actionable
      ? 'Governed Work Order required'
      : loading
      ? 'Checking Kitted BOM evidence...'
      : kittedBomEvidenceState === 'error'
        ? 'Kitted BOM evidence unavailable'
        : evidence?.displayLabel || 'No Kitted BOM Found');
    setText('workOrderDashboardKittedBomFilename', primary?.fileName || (loading ? 'Checking...' : 'Not found'));
    setText('workOrderDashboardKittedBomFolder', primary?.folder || (loading ? 'Checking...' : 'None'));
    setText('workOrderDashboardKittedBomPriorShortage', loading
      ? 'Checking...'
      : evidence?.priorShortageEvidenceExists ? 'Yes' : 'No');
    setText('workOrderDashboardKittedBomMessage', !actionable
      ? 'Only an exact or approved governed Work Order can open Kitted BOM evidence.'
      : loading
      ? 'Verifying approved Kitting folders.'
      : kittedBomEvidenceState === 'error'
        ? 'The read-only server lookup could not be completed.'
        : primary ? 'Read-only filesystem evidence. No kitting status was persisted.' : 'No matching PDF exists in either approved Kitting folder.');

    if (primaryButton) primaryButton.disabled = !primary?.openUrl;
    if (priorButton) {
      priorButton.hidden = !prior?.openUrl;
      priorButton.disabled = !prior?.openUrl;
    }
  }

  function openKittedBomDocument(kind) {
    if (currentView !== 'kitting' || !isActionableKittingDocumentHandoff(selectedWorkOrder)) return false;
    const documentEvidence = kind === 'prior-shortage'
      ? kittedBomEvidence?.secondaryPriorShortageDocument
      : kind === 'primary' ? kittedBomEvidence?.primaryDocument : null;
    if (!documentEvidence?.openUrl || !documentEvidence.openUrl.startsWith(kittedBomEndpoint)) return false;
    window.open(documentEvidence.openUrl, '_blank', 'noopener');
    return true;
  }

  function syncDashboardViewSelector() {
    const selector = document.getElementById('workOrderDashboardView');
    if (selector) selector.value = currentView;
  }

  function applyDashboardView() {
    const visibleSections = new Set(dashboardViews[currentView] || dashboardViews.standard);
    document.querySelectorAll('[data-work-order-dashboard-section]').forEach(section => {
      const sectionName = section.dataset.workOrderDashboardSection || '';
      section.hidden = !visibleSections.has(sectionName);
    });
  }

  function getViewLabel(viewName) {
    const labels = {
      standard: 'Standard View',
      kitting: 'Kitting View',
      production: 'Production View'
    };
    return labels[viewName] || labels.standard;
  }

  function toggleScheduledReleases() {
    scheduledReleasesExpanded = !scheduledReleasesExpanded;
    syncScheduledReleasesCollapseState();
  }

  function syncScheduledReleasesCollapseState() {
    const body = document.getElementById('workOrderDashboardScheduledReleasesBody');
    const indicator = document.getElementById('workOrderDashboardScheduledReleasesIndicator');
    if (body) body.hidden = !scheduledReleasesExpanded;
    if (indicator) indicator.textContent = scheduledReleasesExpanded ? '▼' : '▶';
  }

  function renderSelectedWorkOrderSummary() {
    if (isGovernedHandoff(selectedWorkOrder)) {
      const canonical = selectedWorkOrder.canonicalWorkOrder || {};
      setText('workOrderDashboardSummaryWorkOrder', selectedWorkOrder.workOrderNumber);
      setText('workOrderDashboardSummaryAssembly', cleanText(canonical.itemNumber) || 'N/A');
      setText('workOrderDashboardSummaryRevision', cleanText(canonical.drawingRevision || canonical.bomRevision) || 'Unknown');
      setText('workOrderDashboardSummaryQuantity', formatQuantity(parseQuantity(canonical.schProdQuantity)));
      setText('workOrderDashboardSummaryDueDate', selectedWorkOrder.originDueDate || 'N/A');
      setOperationalStatus('workOrderDashboardSummaryStatus', canonical.workOrderStatus);
      setText('workOrderDashboardCanonicalAnchor', formatSalesOrderLine(
        selectedWorkOrder.canonicalSalesOrderNumber, selectedWorkOrder.canonicalAnchorLine));
      setText('workOrderDashboardOpenedFrom', formatSalesOrderLine(
        selectedWorkOrder.originSalesOrderNumber, selectedWorkOrder.originSalesOrderLine));
      setText('workOrderDashboardGoverningSource',
        selectedWorkOrder.governingSource === 'APPROVED' ? 'Approved Work Order' : 'ERP-confirmed exact relationship');
      return;
    }
    const official = selectedWorkOrder?.official || {};
    const relatedRows = getRelatedWorkOrderRows();

    setText('workOrderDashboardSummaryWorkOrder', official.workOrder || 'None selected');
    setText('workOrderDashboardSummaryAssembly', official.partNumber || 'N/A');
    setText('workOrderDashboardSummaryRevision', getRecordRevision(selectedWorkOrder) || 'Unknown');
    setText('workOrderDashboardSummaryQuantity', formatQuantity(sumOpenQuantity(relatedRows)));
    setText('workOrderDashboardSummaryDueDate', getNextDueDate(relatedRows) || 'N/A');
    setOperationalStatus('workOrderDashboardSummaryStatus', official.operationalStatus);
    setText('workOrderDashboardCanonicalAnchor', 'N/A');
    setText('workOrderDashboardOpenedFrom', 'N/A');
    setText('workOrderDashboardGoverningSource', 'N/A');
  }

  function renderRelatedWorkOrders() {
    const rows = document.getElementById('workOrderDashboardRelatedRows');
    if (!rows) return;

    const relatedRows = getRelatedWorkOrderRows();
    if (!relatedRows.length) {
      rows.innerHTML = '<tr><td class="work-order-dashboard-module-empty" colspan="6">Select a Work Order from Sales Order Dashboard.</td></tr>';
      return;
    }

    rows.innerHTML = relatedRows.map((row, index) => {
      const official = row.official || {};
      const rowClass = [
        index % 2 === 0 ? 'rowEven' : 'rowOdd',
        isSelectedRelease(row) ? 'selected-release' : ''
      ].filter(Boolean).join(' ');

      return [
        '<tr class="',
        escapeDashboardHtml(rowClass),
        '">',
        '<td>',
        escapeDashboardHtml(official.workOrder || 'Unknown'),
        '</td>',
        '<td>',
        escapeDashboardHtml(official.partNumber || 'N/A'),
        '</td>',
        '<td>',
        escapeDashboardHtml(getRecordRevision(row) || 'Unknown'),
        '</td>',
        '<td>',
        escapeDashboardHtml(official.opQtyOpen || '0'),
        '</td>',
        '<td>',
        escapeDashboardHtml(official.dueDate || 'N/A'),
        '</td>',
        '<td>',
        renderOperationalStatus(official.operationalStatus, 'work-order-dashboard-module-status-pill'),
        '</td>',
        '</tr>'
      ].join('');
    }).join('');
  }

  function getRelatedWorkOrderRows() {
    if (!selectedWorkOrder) return [];

    if (isGovernedHandoff(selectedWorkOrder)) {
      return Array.isArray(selectedWorkOrder.relatedRows) && selectedWorkOrder.relatedRows.length
        ? selectedWorkOrder.relatedRows
        : selectedWorkOrder.originRow ? [selectedWorkOrder.originRow] : [];
    }

    const workOrder = normalizeWorkOrder(selectedWorkOrder.official?.workOrder);
    if (!workOrder || workOrder === 'UNKNOWN') return [selectedWorkOrder];

    const records = window.OperationsCenter?.viewModel?.getMasterRecords?.();
    const officialColumns = window.OperationsCenter?.officialColumns || [];
    if (!Array.isArray(records) || !records.length || !officialColumns.length) return [selectedWorkOrder];

    const matches = records
      .filter(record => normalizeWorkOrder(window.OperationsCenter.viewModel.getOfficialField(record, 'workOrder')) === workOrder)
      .map(record => buildRelatedRow(record, officialColumns));

    return matches.length ? matches : [selectedWorkOrder];
  }

  function buildRelatedRow(record, officialColumns) {
    const viewModel = window.OperationsCenter.viewModel;
    const masterRecordKey = viewModel.getMasterRecordKey(record);
    const official = officialColumns.reduce((fields, column) => {
      fields[column.key] = viewModel.getOfficialField(record, column.key);
      return fields;
    }, {});
    const overlay = window.OperationsCenter?.stateActions?.getOverlayRecord?.(masterRecordKey) || {};

    return {
      masterRecordKey,
      official,
      overlay: { ...overlay },
      masterRecord: cloneRecord(record)
    };
  }

  function isSelectedRelease(row) {
    const selectedKey = isGovernedHandoff(selectedWorkOrder)
      ? selectedWorkOrder?.originRow?.masterRecordKey
      : selectedWorkOrder?.masterRecordKey;
    return String(row?.masterRecordKey || '') === String(selectedKey || '');
  }

  function returnToKittingWorkspace() {
    if (selectedWorkOrder?.returnWorkspaceId !== 'kitting') return false;
    if (typeof go === 'function') go('home');
    window.DleWorkspaceShell?.setWorkspaceView?.('kitting');
    return true;
  }

  function isGovernedHandoff(value) {
    return !!(value?.canonicalWorkOrder && cleanText(value?.workOrderNumber));
  }

  function isActionableKittingDocumentHandoff(value) {
    if (!isGovernedHandoff(value)) return false;
    const governingSource = cleanText(value?.governingSource).toUpperCase();
    return governingSource === 'EXACT' || governingSource === 'APPROVED';
  }

  function cleanText(value) {
    return String(value ?? '').trim();
  }

  function formatSalesOrderLine(salesOrderNumber, lineNumber) {
    const order = cleanText(salesOrderNumber);
    const line = cleanText(lineNumber);
    return order && line ? 'SO ' + order + ' · Line ' + line : 'N/A';
  }

  function sumOpenQuantity(rows) {
    return rows.reduce((total, row) => total + parseQuantity(row?.official?.opQtyOpen), 0);
  }

  function parseQuantity(value) {
    const cleaned = String(value ?? '').replace(/,/g, '').trim();
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatQuantity(value) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function getNextDueDate(rows) {
    const candidates = rows
      .map(row => {
        const value = String(row?.official?.dueDate || '').trim();
        const time = parseDueDateTime(value);
        return { value, time };
      })
      .filter(candidate => candidate.value && Number.isFinite(candidate.time))
      .sort((a, b) => a.time - b.time);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const upcoming = candidates.find(candidate => candidate.time >= startOfToday.getTime());

    return upcoming?.value || candidates[0]?.value || '';
  }

  function parseDueDateTime(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return NaN;

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;

    const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!match) return NaN;

    const month = Number(match[1]) - 1;
    const day = Number(match[2]);
    const yearValue = Number(match[3]);
    const year = yearValue < 100 ? 2000 + yearValue : yearValue;
    const date = new Date(year, month, day);
    return date.getTime();
  }

  function normalizeWorkOrder(value) {
    return String(value ?? '').trim().toUpperCase();
  }

  function getRecordRevision(row) {
    return row?.official?.revision
      || row?.masterRecord?.vpro5?.revision
      || row?.masterRecord?.dle?.revision
      || row?.masterRecord?.revision
      || '';
  }

  function cloneRecord(record) {
    try {
      return structuredClone(record);
    } catch (error) {
      return JSON.parse(JSON.stringify(record || {}));
    }
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

  window.WorkOrderDashboardModule.loadModule = loadWorkOrderDashboardModule;
  window.WorkOrderDashboardModule.initialize = initializeWorkOrderDashboardModule;
  window.WorkOrderDashboardModule.setSelectedWorkOrder = setSelectedWorkOrder;
  window.WorkOrderDashboardModule.setView = setDashboardView;
  window.WorkOrderDashboardModule.toggleScheduledReleases = toggleScheduledReleases;
  window.WorkOrderDashboardModule.render = renderWorkOrderDashboardModule;
  window.WorkOrderDashboardModule.returnToKitting = returnToKittingWorkspace;
  window.WorkOrderDashboardModule.openKittedBom = openKittedBomDocument;
  window.WorkOrderDashboardModule.openKittingDisposition = openKittingDispositionDialog;
  window.WorkOrderDashboardModule.openReleasedBom = openReleasedBomPrototype;
  window.WorkOrderDashboardModule.normalizeReleasedBomWorkOrder = normalizeReleasedBomWorkOrder;
  window.WorkOrderDashboardModule.getCurrentView = () => currentView;
  window.WorkOrderDashboardModule.getSelectedHandoff = () => selectedWorkOrder;
  window.WorkOrderDashboardModule.supportedViews = Object.freeze(Array.from(supportedDashboardViews));

  window.loadWorkOrderDashboardModule = loadWorkOrderDashboardModule;
  window.initializeWorkOrderDashboardModule = initializeWorkOrderDashboardModule;
  window.setWorkOrderDashboardModuleSelectedWorkOrder = setSelectedWorkOrder;
  window.setWorkOrderDashboardModuleView = setDashboardView;
  window.toggleWorkOrderDashboardScheduledReleases = toggleScheduledReleases;
  window.renderWorkOrderDashboardModule = renderWorkOrderDashboardModule;
  window.returnToKittingWorkspace = returnToKittingWorkspace;
  window.openWorkOrderDashboardKittedBom = openKittedBomDocument;
  window.openWorkOrderDashboardReleasedBom = openReleasedBomPrototype;
  window.openWorkOrderDashboardDispositionDialog = openKittingDispositionDialog;
  window.updateWorkOrderDashboardDispositionDialog = updateKittingDispositionDialog;
  window.closeWorkOrderDashboardDispositionDialog = closeKittingDispositionDialog;
  window.submitWorkOrderDashboardDisposition = submitKittingDisposition;
})();

/* -----------------------------------------------------
   480 - JS: WORK ORDER DASHBOARD MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.WorkOrderDashboardModule = window.WorkOrderDashboardModule || {};
  let selectedWorkOrder = null;
  let currentView = 'standard';
  let presentationMode = 'dashboard';
  let scheduledReleasesExpanded = false;
  let kittedBomEvidence = null;
  let kittedBomEvidenceState = 'idle';
  let kittedBomRequestId = 0;
  let assemblyDrawingResolution = null;
  let assemblyDrawingState = 'idle';
  let assemblyDrawingRequestId = 0;
  let dispositionReview = null;
  let dispositionHistory = [];
  let dispositionState = 'idle';
  let dispositionRequestId = 0;
  let operationalStateSubscription = null;
  let materialStatusSubscription = null;
  let materialStatusReview = null;
  let materialStatusRequestId = 0;
  let activeKittingTrialOpen = false;
  let activeKittingTrialState = 'idle';
  let activeKittingTrialDraft = null;
  let activeKittingTrialError = '';
  let activeKittingTrialRequestId = 0;
  let activeKittingSubmissionPreview = '';
  let activeKittingDialogSequence = '';
  let activeKittingDetailSequence = '';
  let activeKittingNextSequence = '';
  let activeKittingRecovery = null;
  let activeKittingResumeVerification = null;
  let kittingCaseReview = null;
  let kittingCaseState = 'idle';
  let kittingCaseRequestId = 0;
  let activeKittingEditable = false;
  let activeKittingAutosaveTimer = null;
  let activeKittingAutosavePausedForNavigation = false;
  let activeKittingSaveState = '';
  let activeKittingSaveQueue = Promise.resolve(false);
  const acceptedMaterialLabelState = new Map();
  const acceptedMaterialLookupTimers = new Map();
  const acceptedMaterialTrialEnabledInKitting = false;
  let kittingCaseSubmissions = [];
  const kittedBomEndpoint = '/api/development/kitting-documents/v1/work-orders/';
  const assemblyDrawingEndpoint = '/api/development/drawing-prints/v1/resolve';
  const releasedBomPrototypeWorkOrder = '0115621';
  const releasedBomPrototypePath = '/Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/index.html';
  const releasedBomPrototypeDataPath = '/Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/work-order-0115621.json';
  const isDevelopmentRuntime =
    window.DleOsRuntimeConfig?.environment === 'ISOLATED_DEVELOPMENT';
  const isSimRuntime = window.DleOsRuntimeConfig?.environment === 'SIMULATION';
  const kittingEditingTemporarilyAvailable = false;
  const kittingEditingDeferredMessage =
    'Kitting editing temporarily unavailable. Saved Kitting information remains available read-only.';

  document.addEventListener?.('dle-os-desktop-capabilities-ready', () => {
    if (assemblyDrawingState === 'loaded') renderAssemblyDrawingControl();
  });
  document.addEventListener?.('dle-os-desktop-capability-result', event => {
    const detail = event?.detail || {};
    if (detail.operation !== 'open-drawing-folder' ||
        detail.correlationId !== assemblyDrawingResolution?.capabilityCorrelationId) return;
    setText('workOrderDashboardAssemblyDrawingMessage',
      detail.success ? 'Drawing folder opened' :
        detail.category === 'Opening' ? 'Opening drawing folder...' :
          cleanText(detail.message) || 'Desktop folder access unavailable');
  });

  const dashboardViews = {
    standard: ['overview', 'scheduled-releases', 'manufacturing-documents', 'module-placeholder'],
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
    ensureMaterialStatusSubscription();
    ensureActiveKittingResumeVerification();
    currentView = 'standard';
    presentationMode = 'dashboard';
    scheduledReleasesExpanded = false;
    resetKittedBomEvidence();
    resetAssemblyDrawingResolution();
    resetKittingDisposition();
    resetActiveKittingTrial();
    if (window.KittingJobWorkspace?.restoreReleasedBomReturn?.()) return true;
    renderWorkOrderDashboardModule();
    return false;
  }

  function setSelectedWorkOrder(selection) {
    const route = cleanText(selection?.operationalRelationship?.operationalRoute);
    const blockedReturnNavigation = ['RMA_REWORK', 'RETURN_RMA_REVIEW_REQUIRED'].includes(route) &&
      !cleanText(selection?.operationalRelationship?.activeWorkOrderNumber);
    selectedWorkOrder = !blockedReturnNavigation && (isGovernedHandoff(selection) || selection?.official)
      ? selection
      : null;
    materialStatusRequestId += 1;
    materialStatusReview = selection?.materialStatusProjection || selection?.materialStatus ||
      selection?.masterRecord?.materialStatus || null;
    currentView = getPreferredDashboardView(selection);
    presentationMode = cleanText(selection?.preferredPresentation).toLowerCase() === 'kitting-job'
      ? 'kitting-job'
      : 'dashboard';
    scheduledReleasesExpanded = false;
    resetKittedBomEvidence();
    resetAssemblyDrawingResolution();
    resetKittingDisposition();
    resetActiveKittingTrial();
    renderWorkOrderDashboardModule();
    void ensureMaterialStatus();
  }

  function ensureMaterialStatusSubscription() {
    if (materialStatusSubscription || !window.MaterialStatus?.subscribe) return;
    materialStatusSubscription = window.MaterialStatus.subscribe(detail => {
      const current = getSelectedMaterialStatusWorkOrder();
      if (!current || !(detail.workOrderNumbers || []).includes(current)) return;
      materialStatusReview = detail.materialStatus || null;
      renderSelectedWorkOrderSummary();
      renderKittedBomEvidenceControl();
      if (isProductionKittedBomPresentation() && materialStatusReview) void ensureKittedBomEvidence();
      if (!materialStatusReview) void ensureMaterialStatus(true);
    });
  }

  function getSelectedMaterialStatusWorkOrder() {
    return window.MaterialStatus?.normalizeWorkOrderNumber(
      selectedWorkOrder?.workOrderNumber || selectedWorkOrder?.official?.workOrder
    ) || '';
  }

  async function ensureMaterialStatus(force = false) {
    const workOrderNumber = getSelectedMaterialStatusWorkOrder();
    if (!workOrderNumber || !window.MaterialStatus?.get) {
      materialStatusReview = null;
      renderSelectedWorkOrderSummary();
      return null;
    }
    const requestId = ++materialStatusRequestId;
    try {
      const status = await window.MaterialStatus.get(workOrderNumber, { force });
      if (requestId !== materialStatusRequestId || workOrderNumber !== getSelectedMaterialStatusWorkOrder()) return null;
      materialStatusReview = status;
      renderSelectedWorkOrderSummary();
      renderReleasedBomControl();
      renderKittedBomEvidenceControl();
      if (isProductionKittedBomPresentation()) void ensureKittedBomEvidence();
      return status;
    } catch (error) {
      if (requestId === materialStatusRequestId) {
        materialStatusReview = null;
        renderSelectedWorkOrderSummary();
        renderReleasedBomControl();
        renderKittedBomEvidenceControl();
      }
      return null;
    }
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

  function isKittingWorkflowPresentation() {
    return presentationMode === 'kitting-job';
  }

  function isProductionKittedBomPresentation() {
    return presentationMode === 'dashboard' && currentView === 'production';
  }

  function canViewKittedBomEvidence() {
    return isKittingWorkflowPresentation() || isProductionKittedBomPresentation();
  }

  function getProductionKittedBomDocumentType() {
    if (materialStatusReview?.machineValue === 'KIT_SHORT') return 'shortage';
    if (materialStatusReview?.machineValue === 'KIT_COMPLETE') return 'complete';
    return '';
  }

  function renderWorkOrderDashboardModule() {
    window.KittingJobWorkspace?.setPresentationMode?.(presentationMode);
    const moduleRoot = document.getElementById('workOrderDashboardModule');
    if (moduleRoot) moduleRoot.dataset.dashboardView = currentView;
    const status = document.getElementById('workOrderDashboardModuleStatus');
    if (status) {
      const governedSelection = isGovernedHandoff(selectedWorkOrder);
      status.textContent = governedSelection
        ? 'Canonical Work Order ' + selectedWorkOrder.workOrderNumber +
          ' loaded. Current view: ' + getViewLabel(currentView) + '.'
        : 'Work Order Dashboard ready. Current view: ' + getViewLabel(currentView) + '.';
      status.hidden = currentView === 'production' && governedSelection;
    }
    const returnButton = document.getElementById('workOrderDashboardReturnToKitting');
    if (returnButton) returnButton.hidden = selectedWorkOrder?.returnWorkspaceId !== 'kitting';
    const productionReturnButton = document.getElementById('workOrderDashboardReturnToProduction');
    if (productionReturnButton) productionReturnButton.hidden = selectedWorkOrder?.returnWorkspaceId !== 'production';
    const headerActions = document.getElementById('workOrderDashboardHeaderActions');
    if (headerActions) headerActions.hidden = currentView === 'production';
    syncDashboardViewSelector();
    applyDashboardView();
    syncScheduledReleasesCollapseState();
    renderSelectedWorkOrderSummary();
    renderRelatedWorkOrders();
    renderReleasedBomControl();
    renderKitReleasedBomMessage();
    renderActiveKittingTrial();
    renderKittedBomEvidenceControl();
    renderAssemblyDrawingControl();
    renderKittingDisposition();
    window.KittingJobWorkspace?.render?.({
      selection: selectedWorkOrder,
      materialStatus: materialStatusReview,
      relatedRows: getRelatedWorkOrderRows()
    });
    if (isKittingWorkflowPresentation()) {
      void ensureKittedBomEvidence();
      void ensureKittingDisposition();
      void ensureKittingCase();
    } else if (isProductionKittedBomPresentation() && getProductionKittedBomDocumentType()) {
      void ensureKittedBomEvidence();
    }
    if (isProductionKittedBomPresentation()) void ensureAssemblyDrawingResolution();
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
    return isDevelopmentRuntime && isKittingWorkflowPresentation() &&
      getSelectedReleasedBomWorkOrder() === releasedBomPrototypeWorkOrder;
  }

  function isSimKitIdLabelAvailable() {
    return isSimRuntime && isKittingWorkflowPresentation() &&
      isActionableKittingDocumentHandoff(selectedWorkOrder);
  }

  function renderReleasedBomControl() {
    const button = document.getElementById('workOrderDashboardReleasedBom');
    const kitButton = document.getElementById('workOrderDashboardKitReleasedBom');
    const printTarget = document.getElementById('kittingJobPrintLabelsAction');
    if (!button && !kitButton && !printTarget) return;
    const inDevelopmentKittingWorkspace = isDevelopmentRuntime && isKittingWorkflowPresentation();
    const available = isReleasedBomPrototypeAvailable();
    const labelAvailable = available || isSimKitIdLabelAvailable();
    const printAllAction = '<details class="kitting-label-menu" ontoggle="handleKittingJobPrintLabelsToggle(this)"><summary>Print Labels' +
      '<span aria-hidden="true">&#9662;</span></summary><div class="kitting-label-menu-options" role="menu">' +
      (available ? '<button type="button" role="menuitem" onclick="this.closest(\'details\').removeAttribute(\'open\');' +
      'printAllWorkOrderDashboardKittingBagLabels()">Bag Labels</button>' : '') +
      '<button type="button" role="menuitem" onclick="this.closest(\'details\').removeAttribute(\'open\');' +
      'printWorkOrderDashboardKittingKitIdLabel()">Kit ID</button>' +
      '<button type="button" role="menuitem" disabled><span>Master Kit ID</span><small>Coming Soon</small></button>' +
      '</div></details>';
    if (button) {
      button.hidden = !inDevelopmentKittingWorkspace;
      button.disabled = !available;
    }
    if (kitButton) {
      const canKit = window.DleOsCapabilities?.can('kitting.disposition') !== false;
      const canStart = !!kittingCaseReview || materialStatusReview?.machineValue === 'NEEDS_KITTING';
      kitButton.hidden = !inDevelopmentKittingWorkspace || !canKit;
      kitButton.disabled = !kittingEditingTemporarilyAvailable || !available || !canKit ||
        kittingCaseState === 'loading' || !canStart;
    }
    setText('workOrderDashboardReleasedBomLabel', available
      ? 'View Released BOM' : 'Released BOM prototype not yet available');
    setText('workOrderDashboardReleasedBomMessage', available
      ? 'WO 0115621 · 52 components · 48 messages · read only'
      : 'Available only for canonical WO 0115621 in development Kitting view.');
    const actionLabel = !kittingEditingTemporarilyAvailable
      ? 'Kitting Editing Unavailable'
      : !kittingCaseReview
      ? (materialStatusReview?.machineValue === 'NEEDS_KITTING' ? 'Start Kitting' : 'Needs Kitting Required')
      : kittingCaseReview.state === 'KIT_COMPLETE' ? 'View Kit Complete'
        : kittingCaseReview.isEditing ? (activeKittingEditable ? 'Continue Kitting' : 'View Kitting In Progress')
          : kittingCaseReview.state === 'KIT_SHORT' ? 'Resume Kit Short' : 'Resume Kitting';
    setText('workOrderDashboardKitReleasedBomLabel', actionLabel);
    const compactStatus = kittingCaseReview?.state || materialStatusReview?.machineValue || 'NEEDS_KITTING';
    const compactStatusLabel = ({
      NEEDS_KITTING: 'NEW', KITTING_IN_PROGRESS: 'IN PROGRESS', KIT_SHORT: 'KIT SHORT', KIT_COMPLETE: 'KIT COMPLETE'
    })[compactStatus] || compactStatus.replaceAll('_', ' ');
    setText('kittingJobMaterialStatus', compactStatusLabel);
    const compactStatusBadge = document.getElementById('kittingJobMaterialStatus');
    if (compactStatusBadge) compactStatusBadge.dataset.status = compactStatus;
    const compactTraceability = kittingCaseReview
      ? (kittingCaseReview.poTraceabilityRequired ? 'REQUIRED' : 'OPTIONAL')
      : 'NOT SET';
    setText('kittingJobPoTraceability', compactTraceability);
    const compactTraceabilityValue = document.getElementById('kittingJobPoTraceability');
    if (compactTraceabilityValue) compactTraceabilityValue.dataset.policy = compactTraceability.replace(' ', '_');
    const summary = document.getElementById('workOrderDashboardKittingCaseSummary');
    if (summary) {
      const hasSubmissionHistory = kittingCaseSubmissions.length > 0;
      const dedicatedWorkspace = presentationMode === 'kitting-job';
      const historyTarget = document.getElementById('kittingJobSubmissionHistory');
      const developmentHistoryTarget = document.getElementById('kittingJobDevelopmentHistory');
      summary.hidden = dedicatedWorkspace || !available;
      const currentStatus = kittingCaseReview ? '<strong>' + escapeDashboardHtml(
        kittingCaseReview.state.replaceAll('_', ' ') + ' · Run ' +
          String(kittingCaseReview.runNumber || 1).padStart(3, '0')) + '</strong><span>' +
        escapeDashboardHtml(kittingCaseReview.completedCount + ' / ' + kittingCaseReview.actionableCount +
          ' requirements · last operator ' + kittingCaseReview.lastOperator) + '</span>' +
        '<span>P.O. Traceability: <b>' + (kittingCaseReview.poTraceabilityRequired ? 'REQUIRED' : 'OPTIONAL') + '</b></span>' +
        (kittingCaseReview.state === 'KIT_SHORT' ? '<span>' + escapeDashboardHtml(
          kittingCaseReview.shortRequirementCount + ' short requirement(s)') + '</span>' : '')
        : '<strong>' + (hasSubmissionHistory ? 'Archived Kitting runs' : 'Released BOM bag labels') +
        '</strong><span>No active Kitting Case. Start Kitting creates the next run. ' +
        'Read-only printing does not start or modify a Kitting Case.</span>';
      summary.innerHTML = dedicatedWorkspace ? '' : currentStatus + printAllAction +
        (hasSubmissionHistory ? renderKittingSubmissionHistory() : '');
      if (historyTarget) {
        historyTarget.innerHTML = hasSubmissionHistory
          ? renderKittingSubmissionHistory(false, 'operator')
          : '<p class="kitting-job-report-empty">No prior Kitting submissions.</p>';
      }
      if (developmentHistoryTarget) {
        developmentHistoryTarget.innerHTML = hasSubmissionHistory
          ? renderKittingSubmissionHistory(false, 'development')
          : '<p class="kitting-job-report-empty">No DEV submission artifacts.</p>';
      }
      window.KittingJobWorkspace?.refreshPrimaryToolPresentation?.();
    }
    if (printTarget) {
      printTarget.hidden = !isKittingWorkflowPresentation() || !labelAvailable;
      printTarget.innerHTML = isKittingWorkflowPresentation() && labelAvailable ? printAllAction : '';
    }
    window.KittingJobWorkspace?.refreshPrimaryToolPresentation?.();
  }

  function renderKitReleasedBomMessage() {
    setText('workOrderDashboardKitReleasedBomMessage', !kittingEditingTemporarilyAvailable
      ? kittingEditingDeferredMessage
      : isReleasedBomPrototypeAvailable()
      ? (!kittingCaseReview ? 'Start a fresh governed Kitting run for WO 0115621.'
        : kittingCaseReview.state === 'KIT_COMPLETE'
          ? 'Terminal persistent case · read only · working version ' + kittingCaseReview.workingVersion
        : kittingCaseReview.isEditing && !activeKittingEditable
          ? kittingLeaseReadOnlyMessage(kittingCaseReview)
          : 'Persistent case · working version ' + kittingCaseReview.workingVersion)
      : 'Available only for canonical WO 0115621 in development Kitting view.');
  }

  function openReleasedBomPrototype() {
    if (!isReleasedBomPrototypeAvailable() || !window.ActiveKittingTrial?.releasedBomDocument) return false;
    const draft = activeKittingTrialDraft ? structuredClone(activeKittingTrialDraft) :
      kittingCaseReview?.draft ? structuredClone(kittingCaseReview.draft) : null;
    if (!draft) return false;
    const handoff = {
      ...selectedWorkOrder,
      sourceWorkspaceId: selectedWorkOrder?.sourceWorkspaceId || 'kitting',
      returnWorkspaceId: selectedWorkOrder?.returnWorkspaceId || 'kitting',
      preferredPresentation: 'kitting-job'
    };
    const returnUrl = window.KittingJobWorkspace?.createReleasedBomReturnPath?.(handoff) ||
      window.location.pathname + window.location.search + window.location.hash;
    const reportHtml = window.ActiveKittingTrial.releasedBomDocument(draft, { returnUrl });
    if (!reportHtml) return false;
    const preview = window.open('', '_blank');
    if (!preview) return false;
    preview.document.open();
    preview.document.write(reportHtml);
    preview.document.close();
    return true;
  }

  function resetActiveKittingTrial() {
    activeKittingTrialRequestId += 1;
    activeKittingTrialOpen = false;
    activeKittingTrialState = 'idle';
    activeKittingTrialDraft = null;
    activeKittingTrialError = '';
    activeKittingSubmissionPreview = '';
    activeKittingDialogSequence = '';
    activeKittingDetailSequence = '';
    activeKittingNextSequence = '';
    activeKittingRecovery = null;
    kittingCaseRequestId += 1;
    kittingCaseReview = null;
    kittingCaseState = 'idle';
    activeKittingEditable = false;
    activeKittingSaveState = '';
    activeKittingSaveQueue = Promise.resolve(false);
    acceptedMaterialLabelState.clear();
    acceptedMaterialLookupTimers.forEach(timer => window.clearTimeout(timer));
    acceptedMaterialLookupTimers.clear();
    kittingCaseSubmissions = [];
    if (activeKittingAutosaveTimer) window.clearTimeout(activeKittingAutosaveTimer);
    activeKittingAutosaveTimer = null;
    activeKittingAutosavePausedForNavigation = false;
  }

  async function ensureKittingCase(force = false) {
    if (!isReleasedBomPrototypeAvailable() || !window.DleApiClient?.getKittingCase) return null;
    if (!force && ['loading', 'loaded'].includes(kittingCaseState)) return kittingCaseReview;
    const requestId = ++kittingCaseRequestId;
    kittingCaseState = 'loading';
    renderReleasedBomControl();
    try {
      const response = await window.DleApiClient.getKittingCase(releasedBomPrototypeWorkOrder);
      if (requestId !== kittingCaseRequestId) return null;
      kittingCaseReview = response?.kittingCase || null;
      try {
        const history = await window.DleApiClient.getKittingCaseSubmissions?.(releasedBomPrototypeWorkOrder);
        if (requestId !== kittingCaseRequestId) return null;
        kittingCaseSubmissions = Array.isArray(history?.submissions) ? history.submissions : [];
      } catch (error) {
        kittingCaseSubmissions = [];
      }
      kittingCaseState = 'loaded';
      hydratePersistedKittingCaseForReadOnly(kittingCaseReview);
    } catch (error) {
      if (requestId !== kittingCaseRequestId) return null;
      kittingCaseState = 'error';
      activeKittingTrialError = error?.message || 'Kitting Case status is unavailable.';
    }
    renderReleasedBomControl();
    renderKitReleasedBomMessage();
    return kittingCaseReview;
  }

  function hydratePersistedKittingCaseForReadOnly(review) {
    if (!isKittingWorkflowPresentation() || activeKittingTrialOpen || !review?.draft) return false;
    activeKittingTrialDraft = structuredClone(review.draft);
    activeKittingEditable = false;
    activeKittingRecovery = review.state === 'KIT_COMPLETE' ? null : {
      kind: review.isEditing ? 'LEASE_RECONNECT_REQUIRED' : 'LEASE_EXPIRED',
      message: kittingEditingDeferredMessage,
      code: review.isEditing ? 'same_user_reconnect_required' : 'editing_lease_required',
      status: review.isEditing ? 0 : 409,
      editingSessionId: review.editingSessionId || '',
      capturedAtUtc: new Date().toISOString(),
      draft: structuredClone(review.draft)
    };
    activeKittingTrialError = '';
    activeKittingTrialState = 'loaded';
    activeKittingTrialOpen = true;
    activeKittingSaveState = review.state === 'KIT_COMPLETE'
      ? 'Kit Complete is read only.'
      : activeKittingRecovery.message;
    renderActiveKittingTrial();
    return true;
  }

  function currentEmployeeName() {
    return cleanText(window.DleOsSession?.user?.displayName || window.DleOsSession?.user?.userName);
  }

  function isCurrentKittingEditor(review) {
    const owner = cleanText(review?.editingOwner).toLowerCase();
    if (!owner || !review?.editingSessionId) return false;
    return [window.DleOsSession?.user?.userName, window.DleOsSession?.user?.displayName]
      .map(value => cleanText(value).toLowerCase())
      .filter(Boolean)
      .includes(owner);
  }

  function ownsKittingLease() {
    return !!(!activeKittingRecovery && activeKittingEditable && kittingCaseReview?.editingSessionId &&
      activeKittingTrialDraft && kittingCaseReview.state !== 'KIT_COMPLETE');
  }

  function ensureActiveKittingResumeVerification() {
    if (activeKittingResumeVerification) return;
    const verify = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      void verifyActiveKittingAfterBrowserResume();
    };
    document.addEventListener('visibilitychange', verify);
    window.addEventListener('pageshow', verify);
    activeKittingResumeVerification = verify;
  }

  async function verifyActiveKittingAfterBrowserResume() {
    if (!activeKittingTrialOpen || activeKittingTrialState !== 'loaded' || !activeKittingTrialDraft ||
        activeKittingRecovery || !kittingCaseReview?.editingSessionId) return false;
    const expectedSessionId = kittingCaseReview.editingSessionId;
    try {
      const response = await window.DleApiClient.getKittingCase(releasedBomPrototypeWorkOrder);
      const current = response?.kittingCase || null;
      if (!current) return stopActiveKittingEditing('RECONNECT_FAILED',
        'Kitting Case state is unavailable. Resume / Reconnect Kitting to continue.');
      if (current.state === 'KIT_COMPLETE') {
        kittingCaseReview = current;
        activeKittingEditable = false;
        activeKittingSaveState = 'Kit Complete is read only.';
        renderActiveKittingTrial();
        return false;
      }
      if (!current.isEditing || current.editingSessionId !== expectedSessionId) {
        kittingCaseReview = current;
        return stopActiveKittingEditing('LEASE_EXPIRED',
          'Kitting editing lease needs reconnection after the iPad was idle. Resume / Reconnect Kitting to continue.');
      }
      kittingCaseReview = current;
      activeKittingEditable = true;
      activeKittingSaveState = 'Kitting lease verified after resume.';
      renderActiveKittingTrial();
      return true;
    } catch (error) {
      return handleActiveKittingApiFailure(error, 'Kitting state could not be verified after resume.');
    }
  }

  function isKittingLeaseExpiredError(error) {
    return error?.status === 409 && error?.code === 'editing_lease_required';
  }

  function isKittingAuthenticationRequiredError(error) {
    return !!error?.authenticationRequired ||
      error?.status === 401 ||
      error?.code === 'DLE_OS_ACTIVE_USER_REQUIRED';
  }

  function isSameKittingOperator(ownerName) {
    const owner = cleanText(ownerName).toLowerCase();
    if (!owner) return false;
    return [window.DleOsSession?.user?.userName, window.DleOsSession?.user?.displayName]
      .map(value => cleanText(value).toLowerCase())
      .filter(Boolean)
      .includes(owner);
  }

  function kittingLeaseReadOnlyMessage(review) {
    if (review?.editingOwner && isSameKittingOperator(review.editingOwner)) {
      return 'Read-only until this ' + review.editingOwner +
        ' session reconnects to the active editing lease.';
    }
    return 'Read-only while ' + (review?.editingOwner || 'another operator') +
      ' owns the active editing lease.';
  }

  function stopActiveKittingEditing(kind, message, error = null) {
    if (activeKittingAutosaveTimer) window.clearTimeout(activeKittingAutosaveTimer);
    activeKittingAutosaveTimer = null;
    activeKittingEditable = false;
    activeKittingDialogSequence = '';
    activeKittingDetailSequence = '';
    activeKittingNextSequence = '';
    activeKittingRecovery = {
      kind,
      message,
      code: error?.code || '',
      status: error?.status || 0,
      editingSessionId: kittingCaseReview?.editingSessionId || '',
      capturedAtUtc: new Date().toISOString(),
      draft: activeKittingTrialDraft ? structuredClone(activeKittingTrialDraft) : null
    };
    activeKittingSaveState = message;
    activeKittingSubmissionPreview = message;
    renderReleasedBomControl();
    renderKitReleasedBomMessage();
    renderActiveKittingTrial();
    return false;
  }

  function handleActiveKittingApiFailure(error, fallbackMessage) {
    if (isKittingLeaseExpiredError(error)) {
      return stopActiveKittingEditing('LEASE_EXPIRED',
        'Kitting editing paused because the editing lease expired. Resume / Reconnect Kitting to continue.',
        error);
    }
    if (isKittingAuthenticationRequiredError(error)) {
      return stopActiveKittingEditing('AUTHENTICATION_REQUIRED',
        'Your DLE-OS session needs authentication. Sign in again to continue Kitting.',
        error);
    }
    activeKittingSaveState = error?.message || fallbackMessage;
    renderActiveKittingTrial();
    return false;
  }

  function isActiveKittingEditing() {
    const workspace = document.getElementById('kittingJobWorkspace');
    return activeKittingTrialOpen && ownsKittingLease() &&
      workspace?.classList.contains('is-focused-kitting') === true;
  }

  async function loadReleasedBomDraft() {
    const response = await fetch(releasedBomPrototypeDataPath, {
      credentials: 'same-origin', headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Released BOM source returned HTTP ' + response.status + '.');
    const report = await response.json();
    if (normalizeReleasedBomWorkOrder(report?.header?.workOrder) !== releasedBomPrototypeWorkOrder) {
      throw new Error('Released BOM source did not match WO 0115621.');
    }
    return { report, draft: window.ActiveKittingTrial.createDraft(report, currentEmployeeName()) };
  }

  async function startOrResumeActiveKitting() {
    if (!kittingEditingTemporarilyAvailable) {
      activeKittingEditable = false;
      activeKittingSaveState = kittingEditingDeferredMessage;
      renderActiveKittingTrial();
      return false;
    }
    if (activeKittingRecovery) return reconnectActiveKitting();
    if (activeKittingTrialOpen && (activeKittingEditable || kittingCaseReview?.isEditing ||
        kittingCaseReview?.state === 'KIT_COMPLETE')) {
      window.KittingJobWorkspace?.setPrimaryTool?.('kitting', true);
      scrollActiveKittingTrialIntoView();
      return true;
    }
    if (!isReleasedBomPrototypeAvailable() || window.DleOsCapabilities?.can('kitting.disposition') === false) return false;
    window.KittingJobWorkspace?.setPrimaryTool?.('kitting', true);
    if (activeKittingTrialState === 'loaded' && activeKittingTrialDraft && kittingCaseReview &&
        (activeKittingEditable || kittingCaseReview.isEditing || kittingCaseReview.state === 'KIT_COMPLETE')) {
      activeKittingTrialOpen = true;
      renderReleasedBomControl();
      renderActiveKittingTrial();
      scrollActiveKittingTrialIntoView();
      return true;
    }
    activeKittingRecovery = null;
    activeKittingTrialError = '';
    activeKittingTrialState = 'loading';
    activeKittingTrialOpen = true;
    renderActiveKittingTrial();
    await ensureKittingCase();
    try {
      let currentReleasedBomDraft = null;
      if (!kittingCaseReview) {
        const { report, draft } = await loadReleasedBomDraft();
        currentReleasedBomDraft = draft;
        kittingCaseReview = await window.DleApiClient.startKittingCase(releasedBomPrototypeWorkOrder, {
          customerNumber: selectedWorkOrder?.customerNumber || selectedWorkOrder?.originCustomerNumber ||
            selectedWorkOrder?.originRow?.official?.customerNumber || selectedWorkOrder?.official?.customerNumber,
          originSalesOrderNumber: selectedWorkOrder?.salesOrderNumber || selectedWorkOrder?.originSalesOrderNumber ||
            selectedWorkOrder?.originRow?.official?.salesOrder || selectedWorkOrder?.official?.salesOrder,
          originSalesOrderLineNumber: selectedWorkOrder?.salesOrderLineNumber || selectedWorkOrder?.originSalesOrderLine ||
            selectedWorkOrder?.originRow?.official?.sequenceLine || selectedWorkOrder?.official?.sequenceLine,
          assemblyItemNumber: report.header.billNumber,
          revision: report.header.revision,
          releasedBomIdentity: [report.header.workOrder, report.header.billNumber, report.header.revision,
            report.generatedAt, report.sourceIdentity?.sizeAfter, report.sourceIdentity?.timestampAfterUtc].join('|'),
          draft
        });
        materialStatusReview = window.MaterialStatus?.publish(releasedBomPrototypeWorkOrder, kittingCaseReview) ||
          materialStatusReview;
      } else if (kittingCaseReview.state === 'KIT_COMPLETE') {
        activeKittingEditable = false;
      } else if (!kittingCaseReview.isEditing) {
        const releasedBom = await loadReleasedBomDraft();
        currentReleasedBomDraft = releasedBom.draft;
        kittingCaseReview = await window.DleApiClient.resumeKittingCase(releasedBomPrototypeWorkOrder, {
          expectedWorkingVersion: kittingCaseReview.workingVersion
        });
      } else if (!activeKittingEditable) {
        activeKittingEditable = false;
      }
      activeKittingTrialDraft = structuredClone(kittingCaseReview.draft);
      if (currentReleasedBomDraft) {
        window.ActiveKittingTrial.refreshReleasedBomMessageProjection(
          activeKittingTrialDraft, currentReleasedBomDraft);
      }
      activeKittingEditable = kittingCaseReview.state !== 'KIT_COMPLETE' && isCurrentKittingEditor(kittingCaseReview);
      if (activeKittingEditable) activeKittingTrialDraft.employeeName = currentEmployeeName();
      activeKittingTrialState = 'loaded';
      activeKittingTrialOpen = true;
      renderReleasedBomControl();
      renderActiveKittingTrial();
      scrollActiveKittingTrialIntoView();
      return true;
    } catch (error) {
      if (isKittingAuthenticationRequiredError(error)) {
        activeKittingTrialState = 'loaded';
        activeKittingTrialOpen = true;
        return stopActiveKittingEditing('AUTHENTICATION_REQUIRED',
          'Your DLE-OS session needs authentication. Sign in again to continue Kitting.',
          error);
      }
      if (kittingCaseReview?.draft && activeKittingTrialDraft) {
        activeKittingEditable = false;
        activeKittingTrialState = 'loaded';
        activeKittingTrialOpen = true;
        activeKittingSaveState = error?.message || 'Resume Kitting prerequisite validation failed.';
      } else {
        activeKittingTrialState = 'error';
        activeKittingTrialError = error?.message || 'The Kitting Case could not be opened.';
      }
      renderActiveKittingTrial();
      return false;
    }
  }

  async function openActiveKittingTrial() {
    return startOrResumeActiveKitting();
  }

  async function reconnectActiveKitting() {
    if (!kittingEditingTemporarilyAvailable) {
      activeKittingEditable = false;
      activeKittingSaveState = kittingEditingDeferredMessage;
      renderActiveKittingTrial();
      return false;
    }
    if (!isReleasedBomPrototypeAvailable() || window.DleOsCapabilities?.can('kitting.disposition') === false) return false;
    const retainedDraft = activeKittingRecovery?.draft
      ? structuredClone(activeKittingRecovery.draft)
      : activeKittingTrialDraft ? structuredClone(activeKittingTrialDraft) : null;
    activeKittingRecovery = null;
    activeKittingEditable = false;
    activeKittingSaveState = 'Reconnecting Kitting...';
    activeKittingTrialState = 'loading';
    activeKittingTrialOpen = true;
    renderActiveKittingTrial();
    try {
      await ensureKittingCase(true);
      if (!kittingCaseReview) throw new Error('No Kitting Case exists for this Work Order.');
      if (kittingCaseReview.state === 'KIT_COMPLETE') {
        activeKittingTrialDraft = structuredClone(kittingCaseReview.draft);
        activeKittingTrialState = 'loaded';
        activeKittingSaveState = 'Kit Complete is read only.';
        renderActiveKittingTrial();
        return false;
      }
      if (kittingCaseReview.isEditing && isSameKittingOperator(kittingCaseReview.editingOwner)) {
        activeKittingTrialDraft = retainedDraft || structuredClone(kittingCaseReview.draft);
        activeKittingEditable = true;
        activeKittingTrialState = 'loaded';
        activeKittingSaveState = 'Kitting reconnected. Review retained entries and continue.';
        renderReleasedBomControl();
        renderKitReleasedBomMessage();
        renderActiveKittingTrial();
        return true;
      }
      if (kittingCaseReview.isEditing) {
        activeKittingTrialDraft = retainedDraft || structuredClone(kittingCaseReview.draft);
        activeKittingTrialState = 'loaded';
        activeKittingSaveState = kittingLeaseReadOnlyMessage(kittingCaseReview);
        activeKittingRecovery = {
          kind: 'LEASE_OWNED',
          message: activeKittingSaveState,
          code: 'kitting_case_in_use',
          status: 409,
          capturedAtUtc: new Date().toISOString(),
          draft: activeKittingTrialDraft ? structuredClone(activeKittingTrialDraft) : null
        };
        renderActiveKittingTrial();
        return false;
      }
      const { draft: currentReleasedBomDraft } = await loadReleasedBomDraft();
      kittingCaseReview = await window.DleApiClient.resumeKittingCase(releasedBomPrototypeWorkOrder, {
        expectedWorkingVersion: kittingCaseReview.workingVersion
      });
      activeKittingTrialDraft = retainedDraft || structuredClone(kittingCaseReview.draft);
      window.ActiveKittingTrial.refreshReleasedBomMessageProjection(
        activeKittingTrialDraft, currentReleasedBomDraft);
      activeKittingEditable = !!kittingCaseReview.editingSessionId && kittingCaseReview.state !== 'KIT_COMPLETE';
      if (activeKittingEditable) activeKittingTrialDraft.employeeName = currentEmployeeName();
      activeKittingTrialState = 'loaded';
      activeKittingSaveState = 'Kitting reconnected. Review retained entries and continue.';
      renderReleasedBomControl();
      renderKitReleasedBomMessage();
      renderActiveKittingTrial();
      return true;
    } catch (error) {
      if (isKittingAuthenticationRequiredError(error)) {
        activeKittingTrialState = retainedDraft ? 'loaded' : 'error';
        activeKittingTrialDraft = retainedDraft;
        return stopActiveKittingEditing('AUTHENTICATION_REQUIRED',
          'Your DLE-OS session needs authentication. Sign in again to continue Kitting.',
          error);
      }
      activeKittingTrialState = retainedDraft ? 'loaded' : 'error';
      activeKittingTrialDraft = retainedDraft;
      return stopActiveKittingEditing(isKittingLeaseExpiredError(error) ? 'LEASE_EXPIRED' : 'RECONNECT_FAILED',
        error?.message || 'Kitting could not reconnect. Try Resume / Reconnect Kitting again.',
        error);
    }
  }

  function signInAgainActiveKitting() {
    window.location.assign('/auth/signin');
    return true;
  }

  function closeActiveKittingTrial() {
    const blockers = getActiveKittingRequiredPoBlockers();
    if (blockers.length) {
      blockActiveKittingRequiredPoExit(blockers[0].sequence);
      return false;
    }
    activeKittingTrialOpen = false;
    activeKittingSubmissionPreview = '';
    activeKittingDialogSequence = '';
    activeKittingDetailSequence = '';
    renderActiveKittingTrial();
    return true;
  }

  function scrollActiveKittingTrialIntoView() {
    requestAnimationFrame(() => document.getElementById('workOrderDashboardActiveKitting')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function chooseActiveKittingMethod(sequence, method) {
    if (activeKittingTrialState !== 'loaded' || !ownsKittingLease()) return;
    const group = activeKittingTrialDraft?.groups?.find(item => item.sequence === String(sequence));
    const retainedCount = method === window.ActiveKittingTrial.METHODS.COUNT ? 0 : null;
    const entry = window.ActiveKittingTrial.applyMethod(activeKittingTrialDraft, sequence, method, retainedCount);
    activeKittingDialogSequence = String(sequence);
    activeKittingSubmissionPreview = '';
    if (entry) {
      scheduleActiveKittingAutosave();
      openActiveKittingResultDialog(sequence,
      method === window.ActiveKittingTrial.METHODS.COUNT ? 'count'
        : group?.eligibleParts?.length > 1 ? 'part' : 'po');
    }
  }

  function updateActiveKittingAllocation(sequence, allocationId, field, value, input) {
    if (activeKittingTrialState !== 'loaded' || !ownsKittingLease()) return;
    const nextValue = field === 'quantity' ? window.ActiveKittingTrial.sanitizeCountInput(value) : value;
    if (field === 'quantity' && input && input.value !== nextValue) input.value = nextValue;
    window.ActiveKittingTrial.updateAllocation(activeKittingTrialDraft, sequence, allocationId, { [field]: nextValue });
    activeKittingSubmissionPreview = '';
    refreshActiveKittingAllocationRollup(sequence);
    scheduleActiveKittingAutosave();
    if (field === 'partNumber' || field === 'purchaseOrder') {
      if (acceptedMaterialTrialEnabledInKitting) scheduleAcceptedMaterialLookup(sequence, allocationId);
      if (field === 'partNumber') refreshKittingBagLabelArea(sequence);
    }
  }

  function addActiveKittingAllocation(sequence) {
    const entry = window.ActiveKittingTrial.addAllocation(activeKittingTrialDraft, sequence);
    if (!entry) return false;
    scheduleActiveKittingAutosave();
    openActiveKittingResultDialog(sequence, 'last-count');
    return true;
  }

  function removeActiveKittingAllocation(sequence, allocationId) {
    const entry = window.ActiveKittingTrial.removeAllocation(activeKittingTrialDraft, sequence, allocationId);
    if (!entry) return false;
    scheduleActiveKittingAutosave();
    openActiveKittingResultDialog(sequence, 'count');
    return true;
  }

  function updateActiveKittingSelectedPart(sequence, value) {
    window.ActiveKittingTrial.setSelectedPart(activeKittingTrialDraft, sequence, value);
    refreshActiveKittingDialogSubmit(sequence);
    scheduleActiveKittingAutosave();
    if (acceptedMaterialTrialEnabledInKitting) scheduleAcceptedMaterialLookup(sequence, '');
    refreshKittingBagLabelArea(sequence);
  }

  function placeActiveKittingCountCaret(input) {
    if (!input) return;
    const end = input.value.length;
    input.setSelectionRange?.(end, end);
    requestAnimationFrame(() => {
      const finalEnd = input.value.length;
      input.setSelectionRange?.(finalEnd, finalEnd);
    });
  }

  function updateActiveKittingPurchaseOrder(sequence, value) {
    if (activeKittingTrialState !== 'loaded' || !ownsKittingLease()) return;
    window.ActiveKittingTrial.setPurchaseOrder(activeKittingTrialDraft, sequence, value);
    refreshActiveKittingDialogSubmit(sequence);
    scheduleActiveKittingAutosave();
    if (acceptedMaterialTrialEnabledInKitting) scheduleAcceptedMaterialLookup(sequence, '');
  }

  async function setActiveKittingPoTraceability(value) {
    if (!ownsKittingLease() || !window.DleApiClient?.setKittingCasePoTraceability) return false;
    const required = value !== 'optional';
    if (required === !!kittingCaseReview.poTraceabilityRequired) return true;
    if (activeKittingAutosaveTimer) window.clearTimeout(activeKittingAutosaveTimer);
    activeKittingAutosaveTimer = null;
    await activeKittingSaveQueue.catch(() => false);
    activeKittingSaveState = 'Saving traceability policy…';
    renderActiveKittingTrial();
    try {
      kittingCaseReview = await window.DleApiClient.setKittingCasePoTraceability(releasedBomPrototypeWorkOrder, {
        expectedWorkingVersion: kittingCaseReview.workingVersion,
        editingSessionId: kittingCaseReview.editingSessionId,
        poTraceabilityRequired: required
      });
      activeKittingSaveState = 'P.O. traceability ' + (required ? 'REQUIRED' : 'OPTIONAL');
      renderReleasedBomControl();
      renderKitReleasedBomMessage();
      renderActiveKittingTrial();
      return true;
    } catch (error) {
      return handleActiveKittingApiFailure(error, 'Traceability policy change failed.');
    }
  }

  function handleActiveKittingCountKeydown(event, sequence, allocationId) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    completeActiveKittingCount(sequence, allocationId, event.currentTarget.value);
  }

  function completeActiveKittingCount(sequence, allocationId, value) {
    if (activeKittingTrialState !== 'loaded' || !ownsKittingLease()) return false;
    const entry = window.ActiveKittingTrial.updateAllocation(activeKittingTrialDraft, sequence, allocationId,
      { quantity: value });
    if (!entry || entry.shortageQuantity === null) {
      document.querySelector('[data-active-kitting-allocation="' + CSS.escape(String(allocationId)) + '"]')?.focus();
      return false;
    }
    activeKittingDialogSequence = String(sequence);
    activeKittingSubmissionPreview = '';
    scheduleActiveKittingAutosave();
    openActiveKittingResultDialog(sequence, 'submit');
    return true;
  }

  function openActiveKittingResultDialog(sequence, focusTarget = 'method') {
    if (activeKittingTrialState !== 'loaded' || !ownsKittingLease()) return false;
    const group = activeKittingTrialDraft?.groups?.find(item => item.sequence === String(sequence));
    if (!group?.actionable || group.rowState === 'SUBMITTED') return false;
    activeKittingDialogSequence = String(sequence);
    renderActiveKittingTrial();
    const dialog = document.getElementById('activeKittingResultDialog');
    if (!dialog) return false;
    dialog.showModal();
    if (acceptedMaterialTrialEnabledInKitting) void resolveGroupAcceptedMaterialLabels(group, true);
    const count = dialog.querySelector('[data-active-kitting-count]');
    const target = focusTarget === 'count' ? count
      : focusTarget === 'last-count' ? [...dialog.querySelectorAll('[data-active-kitting-count]')].at(-1)
        : focusTarget === 'part' ? dialog.querySelector('.active-kitting-part-select')
      : focusTarget === 'po' ? dialog.querySelector('.active-kitting-po')
        : focusTarget === 'submit' ? dialog.querySelector('.active-kitting-dialog-submit')
          : dialog.querySelector('.active-kitting-method');
    target?.focus();
    if (target === count) placeActiveKittingCountCaret(count);
    return true;
  }

  function refreshActiveKittingAllocationRollup(sequence) {
    const group = activeKittingTrialDraft?.groups?.find(item => item.sequence === String(sequence));
    const output = document.querySelector('[data-active-kitting-rollup="' + CSS.escape(String(sequence)) + '"]');
    if (group?.entry && output) output.innerHTML = renderActiveKittingCountPreview(group.entry, group);
    refreshActiveKittingDialogSubmit(sequence);
  }

  function refreshActiveKittingDialogSubmit(sequence) {
    const group = activeKittingTrialDraft?.groups?.find(item => item.sequence === String(sequence));
    const submit = document.querySelector('#activeKittingResultDialog .active-kitting-dialog-submit');
    if (!submit) return;
    const count = group?.entry?.method === window.ActiveKittingTrial.METHODS.COUNT;
    submit.disabled = !group?.entry || group.entry.shortageQuantity === null ||
      (!count && !group.eligibleParts.includes(group.entry.selectedPartNumber)) ||
      (!!kittingCaseReview?.poTraceabilityRequired && !window.ActiveKittingTrial.hasRequiredPoTraceability(group));
  }

  function getActiveKittingRequiredPoBlockers(sequence = '') {
    return window.ActiveKittingTrial.getRequiredPoTraceabilityBlockers(activeKittingTrialDraft,
      !!kittingCaseReview?.poTraceabilityRequired, {
        includeEditingComplete: true,
        sequence
      });
  }

  function blockActiveKittingRequiredPoExit(sequence = activeKittingDialogSequence) {
    const targetSequence = String(sequence || '');
    activeKittingSubmissionPreview = 'P.O. is required before this Complete Kitting result can be saved or closed.';
    activeKittingSaveState = activeKittingSubmissionPreview;
    activeKittingDialogSequence = targetSequence;
    renderActiveKittingTrial();
    requestAnimationFrame(() => {
      openActiveKittingResultDialog(targetSequence, 'po');
      document.querySelector('#activeKittingResultDialog .active-kitting-po')?.focus();
    });
    return false;
  }

  function cancelActiveKittingResultDialog(event) {
    const blockers = getActiveKittingRequiredPoBlockers(activeKittingDialogSequence);
    if (!blockers.length) return true;
    event?.preventDefault?.();
    blockActiveKittingRequiredPoExit(activeKittingDialogSequence);
    return false;
  }

  function closeActiveKittingResultDialog() {
    const blockers = getActiveKittingRequiredPoBlockers(activeKittingDialogSequence);
    if (blockers.length) {
      blockActiveKittingRequiredPoExit(activeKittingDialogSequence);
      return false;
    }
    activeKittingDialogSequence = '';
    return true;
  }

  function openActiveKittingSubmittedDetail(sequence) {
    if (activeKittingTrialState !== 'loaded') return false;
    const group = activeKittingTrialDraft?.groups?.find(item => item.sequence === String(sequence));
    if (!group?.actionable || group.rowState !== 'SUBMITTED') return false;
    activeKittingDetailSequence = String(sequence);
    renderActiveKittingTrial();
    requestAnimationFrame(() => {
      document.getElementById('activeKittingSubmittedDetailDialog')?.showModal();
      if (acceptedMaterialTrialEnabledInKitting) void resolveGroupAcceptedMaterialLabels(group, false);
    });
    return true;
  }

  function closeActiveKittingSubmittedDetail() {
    activeKittingDetailSequence = '';
  }

  function refreshKittingBagLabelArea(sequence) {
    const group = activeKittingTrialDraft?.groups?.find(item => item.sequence === String(sequence));
    const element = document.querySelector('[data-kitting-bag-label-sequence="' + CSS.escape(String(sequence)) + '"]');
    if (group && element) element.outerHTML = renderKittingBagLabelArea(activeKittingTrialDraft, group);
  }

  function renderKittingBagLabelArea(draft, group) {
    const variants = window.KittingBagLabel?.createVariants(draft, group) || [];
    if (!variants.length) return '';
    const actionLabel = group.rowState === 'SUBMITTED' ? 'Print / Reprint Bag Label' : 'Print Bag Label';
    const actions = variants.map((item, index) => '<button type="button" onclick="viewWorkOrderDashboardKittingBagLabel(\'' +
      escapeDashboardHtml(group.sequence) + '\',' + index + ')">' + actionLabel +
      (variants.length > 1 ? ' \u00b7 ' + escapeDashboardHtml(item.partNumber) : '') + '</button>').join('');
    return '<div class="kitting-bag-label-print-action" data-kitting-bag-label-sequence="' +
      escapeDashboardHtml(group.sequence) + '">' + actions + '</div>';
  }

  function viewKittingBagLabel(sequence, variantIndex = 0) {
    const group = activeKittingTrialDraft?.groups?.find(item => item.sequence === String(sequence));
    const variants = window.KittingBagLabel?.createVariants(activeKittingTrialDraft, group) || [];
    const model = variants[Number(variantIndex) || 0];
    if (!model) return false;
    const preview = window.open('', '_blank');
    if (!preview) return false;
    preview.document.open();
    preview.document.write(window.KittingBagLabel.printDocument(model));
    preview.document.close();
    preview.opener = null;
    return true;
  }

  async function printAllKittingBagLabels() {
    if (!isReleasedBomPrototypeAvailable() || !window.KittingBagLabel?.avery5163Document) return false;
    const preview = window.open('', '_blank');
    if (!preview) return false;
    preview.document.open();
    preview.document.write('<!doctype html><html><head><title>Preparing bag labels</title></head>' +
      '<body><p>Preparing Avery 5163 bag-label sheets\u2026</p></body></html>');
    preview.document.close();
    try {
      let draft = activeKittingTrialDraft ? structuredClone(activeKittingTrialDraft) :
        kittingCaseReview?.draft ? structuredClone(kittingCaseReview.draft) : null;
      if (!draft) {
        const released = await loadReleasedBomDraft();
        draft = released.draft;
      }
      const documentHtml = window.KittingBagLabel.avery5163Document(draft, {
        returnUrl: window.location.href
      });
      preview.document.open();
      preview.document.write(documentHtml);
      preview.document.close();
      return true;
    } catch (error) {
      preview.document.body.textContent = error?.message || 'The Avery 5163 label set could not be prepared.';
      return false;
    }
  }

  function acceptedMaterialKey(sequence, allocationId = '') {
    return String(sequence) + '::' + (allocationId || 'ENTRY');
  }

  function acceptedMaterialSource(sequence, allocationId = '') {
    const group = activeKittingTrialDraft?.groups?.find(item => item.sequence === String(sequence));
    if (!group?.entry) return null;
    if (allocationId) {
      const allocation = group.entry.allocations?.find(item => item.allocationId === String(allocationId));
      return allocation ? { group, source: allocation, partNumber: allocation.partNumber,
        purchaseOrder: allocation.purchaseOrder } : null;
    }
    return { group, source: group.entry, partNumber: group.entry.selectedPartNumber,
      purchaseOrder: group.entry.purchaseOrder };
  }

  function scheduleAcceptedMaterialLookup(sequence, allocationId) {
    const key = acceptedMaterialKey(sequence, allocationId);
    if (acceptedMaterialLookupTimers.has(key)) window.clearTimeout(acceptedMaterialLookupTimers.get(key));
    acceptedMaterialLookupTimers.set(key, window.setTimeout(() => {
      acceptedMaterialLookupTimers.delete(key);
      void resolveAcceptedMaterialLabel(sequence, allocationId, true);
    }, 350));
    refreshAcceptedMaterialLabelArea(sequence, allocationId);
  }

  async function resolveGroupAcceptedMaterialLabels(group, persistIdentity) {
    if (!group?.entry) return;
    if (group.entry.method === window.ActiveKittingTrial.METHODS.COUNT) {
      await Promise.all(group.entry.allocations.map(allocation =>
        resolveAcceptedMaterialLabel(group.sequence, allocation.allocationId, persistIdentity)));
      return;
    }
    await resolveAcceptedMaterialLabel(group.sequence, '', persistIdentity);
  }

  async function resolveAcceptedMaterialLabel(sequence, allocationId, persistIdentity) {
    const reference = acceptedMaterialSource(sequence, allocationId);
    if (!reference) return null;
    const key = acceptedMaterialKey(sequence, allocationId);
    const partNumber = String(reference.partNumber || '').trim();
    const purchaseOrder = String(reference.purchaseOrder || '').trim();
    if (!partNumber || !purchaseOrder) {
      acceptedMaterialLabelState.set(key, {
        partNumber, purchaseOrder,
        resolutionStatus: partNumber ? 'PO_REQUIRED' : 'PART_REQUIRED',
        message: partNumber
          ? 'Enter the material source P.O. to resolve the accepted receipt line.'
          : 'Select the actual main or governed Related part first.'
      });
      refreshAcceptedMaterialLabelArea(sequence, allocationId);
      return null;
    }
    const requestIdentity = partNumber + '\n' + purchaseOrder;
    acceptedMaterialLabelState.set(key, { partNumber, purchaseOrder, requestIdentity,
      resolutionStatus: 'LOADING', message: 'Resolving canonical Receiving evidence\u2026' });
    refreshAcceptedMaterialLabelArea(sequence, allocationId);
    try {
      const result = await window.DleApiClient.resolveAcceptedMaterialLabel(partNumber, purchaseOrder);
      if (acceptedMaterialLabelState.get(key)?.requestIdentity !== requestIdentity) return null;
      acceptedMaterialLabelState.set(key, { ...result, partNumber, purchaseOrder, requestIdentity });
      if (persistIdentity && result.resolutionStatus === 'RESOLVED' && ownsKittingLease()) {
        const identity = window.AcceptedMaterialLabel.toPersistedIdentity(result);
        if (identity && reference.source.acceptedMaterial?.purchaseReceiptLineId !== identity.purchaseReceiptLineId) {
          window.ActiveKittingTrial.setAcceptedMaterial(activeKittingTrialDraft, sequence, allocationId, identity);
          scheduleActiveKittingAutosave();
        }
      }
      refreshAcceptedMaterialLabelArea(sequence, allocationId);
      return result;
    } catch (error) {
      if (acceptedMaterialLabelState.get(key)?.requestIdentity !== requestIdentity) return null;
      acceptedMaterialLabelState.set(key, { partNumber, purchaseOrder, requestIdentity,
        resolutionStatus: 'ERROR', message: error?.message || 'Accepted Material evidence is unavailable.' });
      refreshAcceptedMaterialLabelArea(sequence, allocationId);
      return null;
    }
  }

  function refreshAcceptedMaterialLabelArea(sequence, allocationId) {
    const key = acceptedMaterialKey(sequence, allocationId);
    const element = document.querySelector('[data-accepted-material-key="' + CSS.escape(key) + '"]');
    const reference = acceptedMaterialSource(sequence, allocationId);
    if (element && reference) element.outerHTML = renderAcceptedMaterialLabelArea(
      sequence, allocationId, reference.partNumber, reference.purchaseOrder
    );
  }

  function renderAcceptedMaterialLabelArea(sequence, allocationId, partNumber, purchaseOrder) {
    const key = acceptedMaterialKey(sequence, allocationId);
    const state = acceptedMaterialLabelState.get(key);
    const sourceMatches = state && state.partNumber === String(partNumber || '').trim() &&
      state.purchaseOrder === String(purchaseOrder || '').trim();
    const current = sourceMatches ? state : null;
    const status = current?.resolutionStatus || (!partNumber ? 'PART_REQUIRED' : !purchaseOrder ? 'PO_REQUIRED' : 'READY');
    const defaultMessage = status === 'PART_REQUIRED' ? 'Select the actual main or governed Related part first.'
      : status === 'PO_REQUIRED' ? 'Enter the material source P.O. to resolve the accepted receipt line.'
        : 'Ready to resolve this part and P.O. against canonical Receiving history.';
    let body = '<p class="accepted-material-status ' + escapeDashboardHtml(status.toLowerCase()) + '">' +
      escapeDashboardHtml(current?.message || defaultMessage) + '</p>';
    if (status === 'RESOLVED' && current.material) {
      const material = current.material;
      const field = (label, value) => '<div><span>' + escapeDashboardHtml(label) + '</span><strong>' +
        escapeDashboardHtml(value || '\u2014') + '</strong></div>';
      body = '<div class="accepted-material-label-card"><div class="accepted-material-label-title"><strong>DE LEON ENTERPRISES</strong>' +
        '<span>ACCEPTED MATERIAL</span></div><div class="accepted-material-label-part">' +
        escapeDashboardHtml(material.partNumber) + '</div><div class="accepted-material-label-grid">' +
        field('Receiver', material.receiverNumber) + field('Received', String(material.receiptDateIso || '').slice(0, 10)) +
        field('P.O. / Line', [material.purchaseOrderNumber, material.purchaseOrderLineNumber].filter(Boolean).join(' / ')) +
        field('Accepted', [material.quantityAccepted, material.unitOfMeasure].filter(value => String(value ?? '').trim()).join(' ')) +
        field('Vendor', material.vendorName) + field('Warehouse / Location',
          [material.warehouseId, material.inventoryLocation].filter(Boolean).join(' / ')) +
        '</div><small>Receipt identity ' + escapeDashboardHtml(material.purchaseReceiptLineId) + '</small></div>' +
        '<div class="accepted-material-actions"><button type="button" onclick="printWorkOrderDashboardAcceptedMaterialLabel(\'' +
        escapeDashboardHtml(sequence) + '\',\'' + escapeDashboardHtml(allocationId) + '\')">Print / Reprint Label</button>' +
        '<span>Uses the existing canonical receipt identity; no new acceptance record is created.</span></div>' +
        (!current.physicalLabelIdAvailable || !current.lotIdentityAvailable
          ? '<p class="accepted-material-caveat">The retained source has no separate physical label ID or lot ID. The canonical receipt-line identity is the exact governed reference for this trial.</p>' : '');
    }
    return '<section class="accepted-material-panel" data-accepted-material-key="' + escapeDashboardHtml(key) + '">' +
      '<header><div><strong>Accepted Material</strong><span>' + escapeDashboardHtml(partNumber || 'Part not selected') +
      (purchaseOrder ? ' \u00b7 P.O. ' + escapeDashboardHtml(purchaseOrder) : '') + '</span></div>' +
      '<small>Receiving / Quality owned</small></header>' + body + '</section>';
  }

  function printAcceptedMaterialLabel(sequence, allocationId) {
    const state = acceptedMaterialLabelState.get(acceptedMaterialKey(sequence, allocationId));
    if (state?.resolutionStatus !== 'RESOLVED' || !state.material) return false;
    const preview = window.open('', '_blank');
    if (!preview) return false;
    preview.document.open();
    preview.document.write(window.AcceptedMaterialLabel.printDocument(state.material));
    preview.document.close();
    preview.opener = null;
    return true;
  }

  function submitActiveKittingRow(sequence) {
    if (activeKittingTrialState !== 'loaded' || !ownsKittingLease()) return false;
    const submitted = window.ActiveKittingTrial.submitGroup(activeKittingTrialDraft, sequence,
      !!kittingCaseReview?.poTraceabilityRequired);
    if (!submitted) {
      document.querySelector('[data-active-kitting-count="' + CSS.escape(String(sequence)) + '"]')?.focus();
      return false;
    }
    activeKittingDialogSequence = '';
    activeKittingDetailSequence = '';
    activeKittingSubmissionPreview = '';
    renderActiveKittingTrial();
    positionNextActiveKittingRow(sequence);
    return true;
  }

  function editActiveKittingRow(sequence) {
    if (activeKittingTrialState !== 'loaded' || !ownsKittingLease()) return false;
    const editing = window.ActiveKittingTrial.editGroup(activeKittingTrialDraft, sequence);
    if (!editing) return false;
    activeKittingDetailSequence = '';
    activeKittingSubmissionPreview = '';
    scheduleActiveKittingAutosave();
    return openActiveKittingResultDialog(sequence);
  }

  function scheduleActiveKittingAutosave() {
    if (!ownsKittingLease()) return;
    activeKittingAutosavePausedForNavigation = false;
    activeKittingSaveState = 'Saving…';
    if (activeKittingAutosaveTimer) window.clearTimeout(activeKittingAutosaveTimer);
    activeKittingAutosaveTimer = window.setTimeout(() => void persistActiveKittingDraft(false), 500);
  }

  function persistActiveKittingDraft(release) {
    if (!ownsKittingLease()) return false;
    if (activeKittingAutosaveTimer) window.clearTimeout(activeKittingAutosaveTimer);
    activeKittingAutosaveTimer = null;
    activeKittingSaveQueue = activeKittingSaveQueue.catch(() => false).then(async () => {
      if (!ownsKittingLease()) return false;
      const blockers = getActiveKittingRequiredPoBlockers();
      if (blockers.length) return blockActiveKittingRequiredPoExit(blockers[0].sequence);
    try {
      const request = {
        expectedWorkingVersion: kittingCaseReview.workingVersion,
        editingSessionId: kittingCaseReview.editingSessionId,
        draft: activeKittingTrialDraft
      };
      kittingCaseReview = release
        ? await window.DleApiClient.saveAndExitKittingCase(releasedBomPrototypeWorkOrder, request)
        : await window.DleApiClient.saveKittingCaseDraft(releasedBomPrototypeWorkOrder, request);
      activeKittingSaveState = release ? 'Saved and editing released.' : 'Saved';
      if (release) {
        activeKittingAutosavePausedForNavigation = false;
        activeKittingEditable = false;
        activeKittingTrialOpen = false;
        activeKittingTrialState = 'idle';
        activeKittingTrialDraft = null;
      }
      renderReleasedBomControl();
      renderKitReleasedBomMessage();
      if (release) renderActiveKittingTrial();
      else setText('activeKittingTrialStatus', window.ActiveKittingTrial.getSummary(activeKittingTrialDraft).completedCount +
        ' of ' + window.ActiveKittingTrial.getSummary(activeKittingTrialDraft).actionableCount +
        ' actionable requirements dispositioned · ' + activeKittingSaveState);
      if (release) window.KittingJobWorkspace?.setPrimaryTool?.('kitting', false);
      return true;
    } catch (error) {
      return handleActiveKittingApiFailure(error, 'Autosave failed.');
    }
    });
    return activeKittingSaveQueue;
  }

  async function saveAndExitActiveKitting() {
    return persistActiveKittingDraft(true);
  }

  function pauseActiveKittingAutosaveForNavigation() {
    if (!isActiveKittingEditing()) return false;
    activeKittingAutosavePausedForNavigation = !!activeKittingAutosaveTimer;
    if (activeKittingAutosaveTimer) window.clearTimeout(activeKittingAutosaveTimer);
    activeKittingAutosaveTimer = null;
    return true;
  }

  function resumeActiveKittingAutosaveAfterNavigationCancel() {
    const shouldResume = activeKittingAutosavePausedForNavigation;
    activeKittingAutosavePausedForNavigation = false;
    if (shouldResume && ownsKittingLease()) scheduleActiveKittingAutosave();
    return shouldResume;
  }

  async function abandonActiveKittingWithoutSaving() {
    if (!isActiveKittingEditing() || !window.DleApiClient?.abandonKittingCase) return false;
    if (activeKittingAutosaveTimer) window.clearTimeout(activeKittingAutosaveTimer);
    activeKittingAutosaveTimer = null;
    await activeKittingSaveQueue.catch(() => false);
    if (!ownsKittingLease()) return false;
    activeKittingSaveState = 'Releasing editing...';
    renderActiveKittingTrial();
    try {
      kittingCaseReview = await window.DleApiClient.abandonKittingCase(releasedBomPrototypeWorkOrder, {
        expectedWorkingVersion: kittingCaseReview.workingVersion,
        editingSessionId: kittingCaseReview.editingSessionId
      });
      activeKittingAutosavePausedForNavigation = false;
      activeKittingSaveState = 'Editing released without a final save.';
      activeKittingEditable = false;
      activeKittingTrialOpen = false;
      activeKittingTrialState = 'idle';
      activeKittingTrialDraft = null;
      renderReleasedBomControl();
      renderKitReleasedBomMessage();
      renderActiveKittingTrial();
      window.KittingJobWorkspace?.setPrimaryTool?.('kitting', false);
      return true;
    } catch (error) {
      activeKittingSaveState = error?.message || 'Editing could not be released.';
      renderActiveKittingTrial();
      return false;
    }
  }

  function focusNextActiveKittingResult(sequence) {
    return positionNextActiveKittingRow(sequence);
  }

  function positionNextActiveKittingRow(sequence) {
    const groups = activeKittingTrialDraft?.groups?.filter(group => group.actionable) || [];
    const current = groups.findIndex(group => group.sequence === String(sequence));
    const next = groups.slice(current + 1).find(group => group.rowState !== 'SUBMITTED')
      || groups.find(group => group.rowState !== 'SUBMITTED');
    activeKittingNextSequence = next?.sequence || '';
    requestAnimationFrame(() => {
      if (!next) {
        document.getElementById('activeKittingTrialSubmit')?.focus({ preventScroll: true });
        return;
      }
      const row = document.querySelector('[data-active-kitting-row="' + CSS.escape(next.sequence) + '"]');
      row?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      row?.classList.add('active-kitting-next-row');
      document.querySelector('[data-active-kitting-result="' + CSS.escape(next.sequence) + '"]')
        ?.focus({ preventScroll: true });
      window.setTimeout(() => {
        row?.classList.remove('active-kitting-next-row');
        if (activeKittingNextSequence === next.sequence) activeKittingNextSequence = '';
      }, 2200);
    });
  }

  async function submitActiveKittingTrial() {
    if (activeKittingTrialState !== 'loaded' || !ownsKittingLease()) return false;
    const blockers = getActiveKittingRequiredPoBlockers();
    if (blockers.length) return blockActiveKittingRequiredPoExit(blockers[0].sequence);
    const summary = window.ActiveKittingTrial.getSummary(activeKittingTrialDraft,
      !!kittingCaseReview?.poTraceabilityRequired);
    if (!summary.canSubmit) {
      activeKittingSubmissionPreview = summary.traceabilityBlockerCount
        ? summary.traceabilityBlockerCount + ' submitted requirement(s) need P.O. traceability.'
        : summary.remainingCount + ' actionable requirement' +
          (summary.remainingCount === 1 ? ' remains.' : 's remain.');
      renderActiveKittingTrial();
      return false;
    }
    if (activeKittingAutosaveTimer) window.clearTimeout(activeKittingAutosaveTimer);
    activeKittingAutosaveTimer = null;
    await activeKittingSaveQueue.catch(() => false);
    activeKittingSubmissionPreview = 'Creating immutable ' + summary.resultingDisposition + ' evidence…';
    renderActiveKittingTrial();
    try {
      kittingCaseReview = await window.DleApiClient.submitKittingCase(releasedBomPrototypeWorkOrder, {
        expectedWorkingVersion: kittingCaseReview.workingVersion,
        editingSessionId: kittingCaseReview.editingSessionId,
        draft: activeKittingTrialDraft
      });
      materialStatusReview = window.MaterialStatus?.publish(releasedBomPrototypeWorkOrder, kittingCaseReview) ||
        materialStatusReview;
      activeKittingEditable = false;
      activeKittingTrialOpen = false;
      activeKittingTrialState = 'idle';
      activeKittingTrialDraft = null;
      activeKittingSubmissionPreview = kittingCaseReview.state + ' submitted.';
      const history = await window.DleApiClient.getKittingCaseSubmissions?.(releasedBomPrototypeWorkOrder);
      kittingCaseSubmissions = Array.isArray(history?.submissions) ? history.submissions : [];
      renderWorkOrderDashboardModule();
      return true;
    } catch (error) {
      return handleActiveKittingApiFailure(error, 'Kitting submission failed.');
    }
  }

  function renderKittingSubmissionHistory(includeHeading = true, presentation = 'operator') {
    if (!kittingCaseSubmissions.length) return '';
    const developmentOnly = presentation === 'development';
    return '<div class="work-order-dashboard-kitting-submissions">' +
      (includeHeading ? '<strong>Submission history</strong>' : '') +
      kittingCaseSubmissions.map(submission => {
        const identity = escapeDashboardHtml('Run ' + String(submission.runNumber || 1).padStart(3, '0') +
          ' · ' + submission.submissionType.replaceAll('_', ' ') + ' V' +
          String(submission.versionNumber).padStart(3, '0'));
        const id = escapeDashboardHtml(submission.submissionId);
        return '<div class="work-order-dashboard-kitting-submission"><span>' + identity + '</span>' +
          (!developmentOnly
            ? '<button type="button" onclick="openWorkOrderDashboardKittingSubmissionPdf(\'' + id + '\')">' +
              'Official Submitted PDF</button>'
            : '') +
          (developmentOnly && isDevelopmentRuntime
            ? '<button type="button" class="layout-preview" onclick="openWorkOrderDashboardKittingSubmissionLayoutPreview(\'' +
              id + '\')">Preview New PDF Layout</button><small>DEV visual qualification only</small>'
            : '') + (developmentOnly && !submission.isActiveRun
              ? '<small>Archived DEV qualification evidence</small>' : '') + '</div>';
      }).join('') + '</div>';
  }

  function openKittingSubmissionPdf(submissionId) {
    const id = cleanText(submissionId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const path = '/api/kitting-cases/v1/work-orders/' + encodeURIComponent(releasedBomPrototypeWorkOrder) +
      '/submissions/' + encodeURIComponent(id) + '/pdf';
    window.open(path, '_blank', 'noopener');
    return true;
  }

  function openKittingSubmissionLayoutPreview(submissionId) {
    if (!isDevelopmentRuntime) return false;
    const id = cleanText(submissionId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const path = '/api/kitting-cases/v1/work-orders/' + encodeURIComponent(releasedBomPrototypeWorkOrder) +
      '/submissions/' + encodeURIComponent(id) + '/layout-preview.pdf';
    window.open(path, '_blank', 'noopener');
    return true;
  }

  function formatActiveKittingFocusedIdentity(draft, header, review, summary) {
    const separator = ' \u00b7 ';
    return 'WO ' + draft.workOrder + separator +
      [header.billNumber, header.revision ? 'Rev ' + header.revision : ''].filter(Boolean).join(' ') +
      separator + 'QTY ' + formatQuantity(header.scheduledProduction) + separator +
      (review?.state || 'KITTING_IN_PROGRESS').replaceAll('_', ' ') + separator +
      summary.completedCount + ' / ' + summary.actionableCount + ' complete' +
      (summary.shortCount ? separator + summary.shortCount + ' short' : '');
  }

  function renderActiveKittingTrial(options = {}) {
    const root = document.getElementById('workOrderDashboardActiveKitting');
    const body = document.getElementById('activeKittingTrialBody');
    if (!root || !body) return;
    const visible = activeKittingTrialOpen && isKittingWorkflowPresentation() && isReleasedBomPrototypeAvailable();
    root.hidden = !visible;
    if (!visible) return;
    if (activeKittingTrialState === 'loading') {
      setText('activeKittingTrialStatus', 'Loading the qualified WO 0115621 released BOM...');
      body.innerHTML = '<div class="active-kitting-trial-loading">Preparing active Kitting rows...</div>';
      return;
    }
    if (activeKittingTrialState === 'error') {
      setText('activeKittingTrialStatus', 'The governed Kitting Case could not open.');
      body.innerHTML = '<div class="active-kitting-trial-error" role="alert">' +
        escapeDashboardHtml(activeKittingTrialError) +
        '<button type="button" onclick="openWorkOrderDashboardActiveKitting()">Retry</button></div>';
      return;
    }
    if (activeKittingTrialState !== 'loaded' || !activeKittingTrialDraft) {
      setText('activeKittingTrialStatus', 'Select Kit Released BOM to begin.');
      body.replaceChildren();
      return;
    }

    const draft = activeKittingTrialDraft;
    const poRequired = !!kittingCaseReview?.poTraceabilityRequired;
    const summary = window.ActiveKittingTrial.getSummary(draft, poRequired);
    const canModify = ownsKittingLease();
    const terminal = kittingCaseReview?.state === 'KIT_COMPLETE';
    const header = draft.header || {};
    setText('activeKittingFocusedIdentity',
      formatActiveKittingFocusedIdentity(draft, header, kittingCaseReview, summary));
    setText('activeKittingTrialStatus', summary.completedCount + ' of ' + summary.actionableCount +
      ' actionable requirements dispositioned · working version ' +
      String(kittingCaseReview?.workingVersion || 0) + ' · ' +
      (activeKittingSaveState || 'Persistent case current'));
    const saveExit = document.getElementById('activeKittingSaveExit');
    if (saveExit) saveExit.disabled = !ownsKittingLease();
    const poPolicy = document.getElementById('activeKittingPoTraceability');
    if (poPolicy) {
      poPolicy.value = poRequired ? 'required' : 'optional';
      poPolicy.disabled = !ownsKittingLease() || window.DleOsCapabilities?.can('kitting.disposition') === false;
      poPolicy.title = poPolicy.disabled ? 'Visible to all operators; an authorized Kitting editor is required to change it.' : '';
    }
    body.innerHTML = renderActiveKittingContext(draft, summary) +
      renderActiveKittingRecovery() +
      renderActiveKittingInstructions(draft.assemblyInstructions) +
      '<div class="active-kitting-trial-table-wrap" role="region" aria-label="Active Kitting BOM requirements" tabindex="0">' +
      '<table class="active-kitting-trial-table"><thead><tr><th>WO Seq</th><th>Find</th><th>Part / Related</th>' +
      '<th>Description / References</th><th>Required</th><th>Kitting result</th>' +
      '</tr></thead><tbody>' + draft.groups.map(renderActiveKittingRow).join('') + '</tbody></table></div>' +
      renderActiveKittingResultDialog(draft) +
      renderActiveKittingSubmittedDetail(draft) +
      '<footer class="active-kitting-trial-footer"><div><strong>Submission preview</strong><span>' +
      (terminal ? 'KIT_COMPLETE is terminal and read only.' :
        summary.canSubmit ? 'All actionable requirements are ready. Result: ' + summary.resultingDisposition + '.' :
        summary.remainingCount + ' actionable requirement' + (summary.remainingCount === 1 ? '' : 's') + ' remaining.') +
      '</span><small>' + (canModify ? 'Draft changes autosave to the governed DEV operational Kitting Case.' :
        'This view cannot modify the governed Kitting Case.') + '</small></div>' +
      '<button id="activeKittingTrialSubmit" type="button" onclick="submitWorkOrderDashboardActiveKitting()"' +
      (summary.canSubmit && canModify ? '' : ' disabled') + '>Submit Kitting</button></footer>' +
      (activeKittingSubmissionPreview ? '<p class="active-kitting-trial-submit-message" role="status">' +
        escapeDashboardHtml(activeKittingSubmissionPreview) + '</p>' : '');

  }

  function renderActiveKittingRecovery() {
    if (!activeKittingRecovery) return '';
    const signIn = activeKittingRecovery.kind === 'AUTHENTICATION_REQUIRED';
    if (!signIn && !kittingEditingTemporarilyAvailable) {
      return '<section class="active-kitting-recovery" role="status"><div><strong>Kitting read-only</strong>' +
        '<span>' + escapeDashboardHtml(kittingEditingDeferredMessage) + '</span></div></section>';
    }
    const detail = activeKittingRecovery.kind === 'LEASE_OWNED' && kittingCaseReview?.editingOwner
      ? 'Currently held by ' + kittingCaseReview.editingOwner + '.'
      : 'Your local Kitting entries are retained on this device until you reconnect or reload.';
    return '<section class="active-kitting-recovery" role="alert"><div><strong>' +
      escapeDashboardHtml(signIn ? 'DLE-OS session needs sign-in' : 'Kitting needs reconnection') +
      '</strong><span>' + escapeDashboardHtml(activeKittingRecovery.message) + '</span><small>' +
      escapeDashboardHtml(detail) + '</small></div><button type="button" onclick="' +
      (signIn ? 'signInAgainWorkOrderDashboardKitting()' : 'reconnectWorkOrderDashboardKitting()') + '">' +
      (signIn ? 'Sign In Again' : 'Resume / Reconnect Kitting') + '</button></section>';
  }

  function renderActiveKittingContext(draft, summary) {
    const header = draft.header || {};
    const item = (label, value) => '<div><span>' + escapeDashboardHtml(label) + '</span><strong>' +
      escapeDashboardHtml(value || 'N/A') + '</strong></div>';
    return '<div class="active-kitting-trial-context">' + item('Work Order', draft.workOrder) +
      item('Assembly', [header.billNumber, header.revision ? 'Rev ' + header.revision : ''].filter(Boolean).join(' - ')) +
      item('Build quantity', formatQuantity(header.scheduledProduction) + ' ' + cleanText(header.unitOfMeasure)) +
      item('Employee', draft.employeeName) + item('Kitting state',
        (kittingCaseReview?.state || 'KITTING_IN_PROGRESS').replaceAll('_', ' ')) +
      item('Progress', summary.completedCount + ' / ' + summary.actionableCount) + '</div>';
  }

  function renderActiveKittingInstructions(instructions) {
    if (!instructions?.length) return '';
    return '<details class="active-kitting-trial-instructions" open><summary>Assembly instructions - ' +
      instructions.length + '</summary>' + instructions.map(row => '<p><span>SEQ ' +
        escapeDashboardHtml(row.sequence) + '</span>' + escapeDashboardHtml(row.materialMessage) + '</p>').join('') + '</details>';
  }

  function renderActiveKittingRow(group) {
    if (!group.actionable) return '<tr class="result-informational"><td><strong>' + escapeDashboardHtml(group.sequence) +
      '</strong></td><td>' + escapeDashboardHtml(group.findNumber ?? '-') + '</td><td><strong>' +
      escapeDashboardHtml(group.partNumber) + '</strong></td><td>' + escapeDashboardHtml(group.description) +
      renderActiveKittingReferences(group) + '</td><td><strong>Not actionable</strong></td><td>' +
      '<span class="active-kitting-result informational">Instruction / DNP - no Kitting entry required</span></td></tr>';

    const entry = group.entry;
    const locked = group.rowState === 'SUBMITTED';
    const submittedVisual = locked ? window.ActiveKittingTrial.getSubmittedVisualState(entry) : null;
    const rowClass = (entry?.result ? 'result-' + entry.result.toLowerCase().replaceAll('_', '-') : 'result-pending') +
      (locked ? ' row-locked' : '') + (group.sequence === activeKittingNextSequence ? ' active-kitting-next-row' : '');
    return '<tr class="' + rowClass + '" data-active-kitting-row="' + escapeDashboardHtml(group.sequence) + '">' +
      '<td><strong>' + escapeDashboardHtml(group.sequence) + '</strong>' +
      (group.relatedParts.length ? '<small>' + group.relatedParts.map(part => 'Seq ' + escapeDashboardHtml(part.row.sequence)).join('<br>') + '</small>' : '') + '</td>' +
      '<td>' + escapeDashboardHtml(group.findNumber ?? '-') + '</td><td><strong>' + escapeDashboardHtml(group.partNumber) + '</strong>' +
      (group.relatedParts.length ? '<small>Related: ' + group.relatedParts.map(part => escapeDashboardHtml(part.row.itemNumber)).join(' - ') + '</small>' : '') + '</td>' +
      '<td>' + escapeDashboardHtml(group.description) + renderActiveKittingReferences(group) + '</td>' +
      '<td class="active-kitting-required"><small>' + escapeDashboardHtml(formatQuantity(group.requiredEach)) + ' / assy</small><strong>' +
      escapeDashboardHtml(formatQuantity(group.requiredQuantity)) + ' ' + escapeDashboardHtml(group.unitOfMeasure) + '</strong></td>' +
      '<td class="active-kitting-result-cell"><button type="button" class="active-kitting-result-trigger" data-active-kitting-result="' +
      escapeDashboardHtml(group.sequence) + '"' + (!locked && !ownsKittingLease() ? ' disabled' : '') + ' aria-label="' + (locked
        ? 'Submitted Kitting result for WO sequence ' + escapeDashboardHtml(group.sequence) + ': ' +
          escapeDashboardHtml(submittedVisual.label) + '. Open details.'
        : 'Kitting result for WO sequence ' + escapeDashboardHtml(group.sequence)) + '" onclick="' + (locked
        ? 'openWorkOrderDashboardKittingDetail(\'' + escapeDashboardHtml(group.sequence) + '\')'
        : 'openWorkOrderDashboardKittingResultDialog(\'' + escapeDashboardHtml(group.sequence) + '\')') + '">' +
      (locked ? renderSubmittedActiveKittingResult(entry) : renderActiveKittingResult(entry)) + '</button></td></tr>';
  }

  function renderActiveKittingResultDialog(draft) {
    const group = draft.groups.find(item => item.sequence === activeKittingDialogSequence);
    if (!group || group.rowState === 'SUBMITTED') return '';
    const entry = group.entry;
    const methods = window.ActiveKittingTrial.METHODS;
    const button = (method, label) => '<button type="button" class="active-kitting-method' +
      (entry?.method === method ? ' selected' : '') + '" onclick="chooseWorkOrderDashboardKittingMethod(\'' +
      escapeDashboardHtml(group.sequence) + '\',\'' + method + '\')">' + label + '</button>';
    const needsCount = entry?.method === methods.COUNT;
    const partOptions = (selected = '') => '<option value="">Select part used</option>' + group.eligibleParts.map(part =>
      '<option value="' + escapeDashboardHtml(part) + '"' + (part === selected ? ' selected' : '') + '>' +
      escapeDashboardHtml(part) + '</option>').join('');
    const completeEvidence = entry && !needsCount
      ? '<div class="active-kitting-complete-evidence"><label>Part Used<select class="active-kitting-part-select" ' +
        'onchange="updateWorkOrderDashboardKittingPart(\'' + escapeDashboardHtml(group.sequence) + '\',this.value)">' +
        partOptions(entry.selectedPartNumber) + '</select></label><label>P.O. (' +
        (kittingCaseReview?.poTraceabilityRequired ? 'Required' : 'Optional') + ')<input class="active-kitting-po" type="text" ' +
        'maxlength="40" value="' + escapeDashboardHtml(entry.purchaseOrder) + '" placeholder="' +
        (kittingCaseReview?.poTraceabilityRequired ? 'Required' : 'Optional') + '" ' +
        'oninput="updateWorkOrderDashboardKittingPo(\'' + escapeDashboardHtml(group.sequence) + '\',this.value)"></label></div>'
      : '';
    const allocationLedger = needsCount ? renderActiveKittingAllocationEditor(group) : '';
    const entryReady = entry && entry.shortageQuantity !== null && (needsCount || group.eligibleParts.includes(entry.selectedPartNumber)) &&
      (!kittingCaseReview?.poTraceabilityRequired || window.ActiveKittingTrial.hasRequiredPoTraceability(group));
    return '<dialog id="activeKittingResultDialog" class="active-kitting-result-dialog active-kitting-work-card-dialog" ' +
      'oncancel="return cancelWorkOrderDashboardKittingResultDialog(event)" onclose="closeWorkOrderDashboardKittingResultDialog()">' +
      '<header><div><small>Governed material / bag</small><strong>Kitting Result &mdash; Seq ' +
      escapeDashboardHtml(String(group.sequence).padStart(3, '0')) + '</strong></div>' +
      '<button type="button" class="active-kitting-dialog-close" aria-label="Close" onclick="document.getElementById(\'activeKittingResultDialog\').close()">&times;</button></header>' +
      renderActiveKittingMaterialCard(draft, group) +
      '<div class="active-kitting-method-heading"><span>Kitting Result</span><small>Choose one method</small></div>' +
      '<div class="active-kitting-methods">' + button(methods.COMPLETE, 'Complete') +
      button(methods.COMPLETE_MIN_EXTRA, 'Min Extra') + button(methods.COUNT, 'Count') + '</div>' +
      completeEvidence + allocationLedger + renderKittingBagLabelArea(draft, group) + '<footer>' +
      '<button type="button" onclick="document.getElementById(\'activeKittingResultDialog\').close()">Cancel</button>' +
      '<button type="button" class="active-kitting-dialog-submit" onclick="submitWorkOrderDashboardKittingRow(\'' +
      escapeDashboardHtml(group.sequence) + '\')"' +
      (entryReady ? '' : ' disabled') + '>Submit</button></footer></dialog>';
  }

  function renderActiveKittingMaterialCard(draft, group) {
    const model = window.KittingBagLabel?.createModel(draft, group);
    if (!model) return '';
    const selectedPart = cleanText(group.entry?.selectedPartNumber);
    const selectedMaterial = selectedPart
      ? model.materialRows.find(row => cleanText(row.partNumber) === selectedPart)
      : null;
    const material = selectedMaterial || model.materialRows[0] || model;
    const item = (label, value, className = '') => '<div class="active-kitting-material-field' +
      (className ? ' ' + className : '') + '"><span>' + escapeDashboardHtml(label) + '</span><strong>' +
      escapeDashboardHtml(value || '\u2014') + '</strong></div>';
    const detailLines = [];
    if (model.references.length) detailLines.push(model.references.join(', '));
    detailLines.push(...model.materialNotes);
    if (!detailLines.length) detailLines.push('\u2014');
    const relatedContext = group.relatedParts?.length
      ? '<span class="active-kitting-related-context">Related options: ' + group.relatedParts.length + '</span>'
      : '';
    return '<section class="active-kitting-material-card" aria-label="Current material and bag identity">' +
      '<div class="active-kitting-material-primary">' +
      item('Seq', String(material.sequence || group.sequence).padStart(3, '0'), 'sequence') +
      item('Location', material.location || '\u2014', 'location') +
      item('Part Number', material.partNumber || group.partNumber, 'part') +
      item('Required', formatQuantity(group.requiredQuantity) + ' ' + group.unitOfMeasure, 'required') +
      item('FN', model.findNumber || '\u2014', 'find') + '</div>' +
      '<div class="active-kitting-material-description"><span>Description</span><strong>' +
      escapeDashboardHtml(material.description || group.description || 'NOT ON FILE') + '</strong>' + relatedContext + '</div>' +
      '<div class="active-kitting-material-detail"><span>REF. DES.</span><div>' + detailLines.map(line =>
        '<strong>' + escapeDashboardHtml(line) + '</strong>').join('') + '</div></div></section>';
  }

  function renderActiveKittingAllocationEditor(group) {
    const entry = group.entry;
    const options = selected => '<option value="">Select part used</option>' + group.eligibleParts.map(part =>
      '<option value="' + escapeDashboardHtml(part) + '"' + (part === selected ? ' selected' : '') + '>' +
      escapeDashboardHtml(part) + '</option>').join('');
    const rows = entry.allocations.map((allocation, index) => '<div class="active-kitting-allocation-row" data-allocation-row="' +
      escapeDashboardHtml(allocation.allocationId) + '"><label>Part Used<select onchange="updateWorkOrderDashboardKittingAllocation(\'' +
      escapeDashboardHtml(group.sequence) + '\',\'' + escapeDashboardHtml(allocation.allocationId) + '\',\'partNumber\',this.value,this)">' +
      options(allocation.partNumber) + '</select></label><label>Qty<input type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" value="' +
      escapeDashboardHtml(allocation.quantity ?? '') + '" data-active-kitting-count data-active-kitting-allocation="' +
      escapeDashboardHtml(allocation.allocationId) + '" oninput="updateWorkOrderDashboardKittingAllocation(\'' + escapeDashboardHtml(group.sequence) +
      '\',\'' + escapeDashboardHtml(allocation.allocationId) + '\',\'quantity\',this.value,this)" ' +
      'onfocus="placeWorkOrderDashboardKittingCountCaret(this)" onkeydown="handleWorkOrderDashboardKittingCountKeydown(event,\'' +
      escapeDashboardHtml(group.sequence) + '\',\'' + escapeDashboardHtml(allocation.allocationId) + '\')"></label>' +
      '<label>P.O. <span>(' + (kittingCaseReview?.poTraceabilityRequired && Number(allocation.quantity) > 0 ? 'Required' : 'Optional') +
      ')</span><input type="text" maxlength="40" value="' + escapeDashboardHtml(allocation.purchaseOrder) +
      '" placeholder="' + (kittingCaseReview?.poTraceabilityRequired && Number(allocation.quantity) > 0 ? 'Required' : 'Optional') +
      '" oninput="updateWorkOrderDashboardKittingAllocation(\'' + escapeDashboardHtml(group.sequence) + '\',\'' +
      escapeDashboardHtml(allocation.allocationId) + '\',\'purchaseOrder\',this.value,this)"></label><button type="button" class="active-kitting-allocation-remove" ' +
      'aria-label="Remove allocation ' + (index + 1) + '" onclick="removeWorkOrderDashboardKittingAllocation(\'' +
      escapeDashboardHtml(group.sequence) + '\',\'' + escapeDashboardHtml(allocation.allocationId) + '\')"' +
      (entry.allocations.length === 1 ? ' disabled' : '') + '>&times;</button></div>').join('');
    return '<section class="active-kitting-allocation-ledger"><header><div><strong>Material allocations</strong>' +
      '<span>Main and governed Related parts only</span></div><button type="button" onclick="addWorkOrderDashboardKittingAllocation(\'' +
      escapeDashboardHtml(group.sequence) + '\')">+ Add allocation</button></header>' + rows +
      '<output class="active-kitting-allocation-rollup" data-active-kitting-rollup="' + escapeDashboardHtml(group.sequence) +
      '" aria-live="polite">' + renderActiveKittingCountPreview(entry, group) + '</output></section>';
  }

  function renderActiveKittingSubmittedDetail(draft) {
    const group = draft.groups.find(item => item.sequence === activeKittingDetailSequence);
    if (!group || group.rowState !== 'SUBMITTED' || !group.entry) return '';
    const entry = group.entry;
    const canEdit = ownsKittingLease() && window.DleOsCapabilities?.can('kitting.disposition') !== false;
    const method = entry.method === window.ActiveKittingTrial.METHODS.COMPLETE
      ? 'Complete'
      : entry.method === window.ActiveKittingTrial.METHODS.COMPLETE_MIN_EXTRA
        ? 'Complete \u2014 Min Extra'
        : 'Count';
    const metric = (label, value, tone = '') => '<div class="active-kitting-summary-metric' +
      (tone ? ' ' + tone : '') + '"><span>' + escapeDashboardHtml(label) + '</span><strong>' +
      escapeDashboardHtml(value) + '</strong></div>';
    const totalKitted = entry.method === window.ActiveKittingTrial.METHODS.COUNT
      ? formatQuantity(entry.pickedQuantity)
      : '\u2014';
    const summary = '<div class="active-kitting-dialog-summary">' +
      metric('Required', formatQuantity(group.requiredQuantity) + ' ' + group.unitOfMeasure) +
      metric('Total Kitted', totalKitted) +
      metric('Short', formatQuantity(entry.shortageQuantity), entry.shortageQuantity > 0 ? 'short' : '') +
      metric('Extra', entry.extraQuantity === null ? '\u2014' : formatQuantity(entry.extraQuantity)) + '</div>';
    const allocationTable = entry.method === window.ActiveKittingTrial.METHODS.COUNT
      ? '<div class="active-kitting-evidence-table-wrap"><table class="active-kitting-evidence-table"><colgroup><col class="part"><col class="quantity"><col class="po"></colgroup><thead><tr><th>Part</th><th>Qty</th><th>P.O.</th></tr></thead><tbody>' +
        entry.allocations.map(allocation => '<tr><td>' + escapeDashboardHtml(allocation.partNumber) + '</td><td>' +
          escapeDashboardHtml(formatQuantity(allocation.quantity)) + '</td><td>' + escapeDashboardHtml(allocation.purchaseOrder || '\u2014') +
          '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="active-kitting-evidence-table-wrap"><table class="active-kitting-evidence-table"><colgroup><col class="part"><col class="quantity"><col class="po"></colgroup><thead><tr><th>Part</th><th>Method</th><th>P.O.</th></tr></thead><tbody><tr><td>' +
        escapeDashboardHtml(entry.selectedPartNumber) + '</td><td>' + escapeDashboardHtml(method) + '</td><td>' +
        escapeDashboardHtml(entry.purchaseOrder || '\u2014') + '</td></tr></tbody></table></div>';
    return '<dialog id="activeKittingSubmittedDetailDialog" class="active-kitting-result-dialog active-kitting-detail-dialog" ' +
      'onclose="closeWorkOrderDashboardKittingDetail()"><header><div class="active-kitting-dialog-heading"><small>WO Seq ' +
      escapeDashboardHtml(group.sequence) + '</small><strong>Kitting Result</strong>' + summary + '</div>' +
      '<button type="button" class="active-kitting-dialog-close" aria-label="Close" ' +
      'onclick="document.getElementById(\'activeKittingSubmittedDetailDialog\').close()">&times;</button></header>' +
      allocationTable + renderKittingBagLabelArea(draft, group) +
      '<footer><button type="button" class="active-kitting-row-action edit" data-dle-required-permission="kitting.disposition" ' +
      'onclick="editWorkOrderDashboardKittingRow(\'' + escapeDashboardHtml(group.sequence) + '\')"' +
      (canEdit ? '' : ' disabled') + '>Edit</button><button type="button" onclick="document.getElementById(\'activeKittingSubmittedDetailDialog\').close()">Close</button></footer></dialog>';
  }

  function renderActiveKittingCountPreview(entry, group) {
    if (!entry || entry.method !== window.ActiveKittingTrial.METHODS.COUNT || entry.shortageQuantity === null) return '';
    const interpretation = entry.shortageQuantity > 0
      ? 'Short ' + formatQuantity(entry.shortageQuantity)
      : entry.extraQuantity > 0
        ? '+' + formatQuantity(entry.extraQuantity) + ' Extra'
        : 'Complete';
    return '<span class="active-kitting-count-preview"><strong>Kitted ' +
      escapeDashboardHtml(formatQuantity(entry.pickedQuantity)) + ' / ' + escapeDashboardHtml(formatQuantity(group?.requiredQuantity ?? 0)) + '</strong><span>' +
      escapeDashboardHtml(interpretation) + '</span></span>';
  }

  function renderActiveKittingReferences(group) {
    const details = [];
    if (group.references.length) details.push('Refs: ' + group.references.join(', '));
    if (group.notes.length) details.push('Note: ' + group.notes.join(' - '));
    return details.length ? '<small>' + details.map(escapeDashboardHtml).join('<br>') + '</small>' : '';
  }

  function renderActiveKittingResult(entry) {
    if (!entry) return '<span class="active-kitting-result pending">Select result</span>';
    if (entry.result === 'COUNT_REQUIRED') return '<span class="active-kitting-result pending">Enter quantity</span>';
    if (entry.result === 'COMPLETE') {
      return '<span class="active-kitting-result completed"><strong>Complete</strong></span>';
    }
    if (entry.result === 'COMPLETE_MIN_EXTRA') {
      return '<span class="active-kitting-result completed"><strong>Complete</strong><small>Min Extra</small></span>';
    }
    const counted = '<strong>Counted ' + escapeDashboardHtml(formatQuantity(entry.pickedQuantity)) + '</strong>';
    if (entry.result === 'COUNTED_SHORT') {
      return '<span class="active-kitting-result completed short">' + counted + '<small>Short ' +
        escapeDashboardHtml(formatQuantity(entry.shortageQuantity)) + '</small></span>';
    }
    if (entry.result === 'COUNTED_EXTRA') {
      return '<span class="active-kitting-result completed">' + counted + '<small class="extra">+' +
        escapeDashboardHtml(formatQuantity(entry.extraQuantity)) + ' Extra</small></span>';
    }
    return '<span class="active-kitting-result completed">' + counted + '<small>&#10003; Complete</small></span>';
  }

  function renderSubmittedActiveKittingResult(entry) {
    const visual = window.ActiveKittingTrial.getSubmittedVisualState(entry);
    if (!visual) return renderActiveKittingResult(entry);
    const tone = visual.tone.toLowerCase();
    const shortage = visual.icon === 'WARNING';
    const icon = shortage ? '&#35;' : '&#10003;';
    const warning = shortage ? '<sup aria-hidden="true">!</sup>' : '';
    return '<span class="active-kitting-submitted-result state-' + tone + '" role="img" aria-label="' +
      escapeDashboardHtml(visual.label) + '" title="' + escapeDashboardHtml(visual.label) + '">' +
      '<span class="active-kitting-state-icon' + (shortage ? ' counted' : '') + '" aria-hidden="true">' +
      icon + warning + '</span></span>';
  }

  async function ensureKittingDisposition(force = false) {
    if (!isKittingWorkflowPresentation() || !isActionableKittingDocumentHandoff(selectedWorkOrder) ||
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
    renderReleasedBomControl();
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
    if (button) { button.disabled = true; button.hidden = true; }
    setText('workOrderDashboardDispositionMessage', dispositionState === 'error'
      ? 'Legacy manual disposition history could not be loaded.' : dispositionState === 'loaded'
        ? 'Material Status is system-derived; legacy disposition events remain historical evidence.'
        : 'Loading legacy disposition history...');
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
      closeKittingDispositionDialog(); renderKittingDisposition(); renderReleasedBomControl();
      await window.DleWorkspaces?.kitting?.refresh?.();
    } catch (error) { setText('workOrderDispositionDialogError', error?.message || 'Disposition could not be recorded.'); }
    finally { if (confirm) confirm.disabled = false; }
  }

  function resetKittedBomEvidence() {
    kittedBomRequestId += 1;
    kittedBomEvidence = null;
    kittedBomEvidenceState = 'idle';
  }

  let kittingKitIdLabelModulePromise = null;

  function ensureKittingKitIdLabelModule() {
    if (window.KittingKitIdLabel?.createModel && window.KittingKitIdLabel?.printDocument) {
      return Promise.resolve(window.KittingKitIdLabel);
    }
    if (!kittingKitIdLabelModulePromise) {
      kittingKitIdLabelModulePromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'SRC/modules/work-order-dashboard/kitting-kit-id-label.js';
        script.dataset.kittingKitIdLabelModule = 'true';
        script.onload = () => resolve(window.KittingKitIdLabel);
        script.onerror = () => reject(new Error('The Kit ID label module could not be loaded.'));
        document.head.appendChild(script);
      }).catch(error => {
        kittingKitIdLabelModulePromise = null;
        throw error;
      });
    }
    return kittingKitIdLabelModulePromise;
  }

  async function printKittingKitIdLabel() {
    if (!isActionableKittingDocumentHandoff(selectedWorkOrder)) return false;
    const preview = window.open('', '_blank');
    if (!preview) return false;
    preview.document.open();
    preview.document.write('<!doctype html><html><head><title>Preparing Kit ID</title></head>' +
      '<body><p>Preparing Kit ID print preview&hellip;</p></body></html>');
    preview.document.close();
    try {
      const labels = await ensureKittingKitIdLabelModule();
      if (!labels?.createModel || !labels?.printDocument) throw new Error('The Kit ID label module is unavailable.');
      const model = labels.createModel(selectedWorkOrder);
      preview.document.open();
      preview.document.write(labels.printDocument(model));
      preview.document.close();
      preview.opener = null;
      return true;
    } catch (error) {
      preview.document.body.textContent = error?.message || 'The Kit ID label could not be prepared.';
      return false;
    }
  }

  async function ensureKittedBomEvidence() {
    if (!canViewKittedBomEvidence() || !isActionableKittingDocumentHandoff(selectedWorkOrder) ||
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

    const productionPresentation = isProductionKittedBomPresentation();
    const expectedDocumentType = productionPresentation ? getProductionKittedBomDocumentType() : '';
    const actionable = isActionableKittingDocumentHandoff(selectedWorkOrder);
    const showEvidence = isKittingWorkflowPresentation();
    placeholder.hidden = showEvidence;
    panel.hidden = !showEvidence;
    if (!showEvidence) {
      const primary = kittedBomEvidence?.primaryDocument || null;
      const mismatchedEvidence = productionPresentation && primary &&
        primary.documentType !== expectedDocumentType;
      const governedPrimary = mismatchedEvidence ? null : primary;
      const loading = productionPresentation && actionable && !!expectedDocumentType &&
        (kittedBomEvidenceState === 'loading' || kittedBomEvidenceState === 'idle');
      const statusLabel = expectedDocumentType
        ? (expectedDocumentType === 'complete' ? 'Kit Complete' : 'Kit Short')
        : 'Kitted BOM Unavailable';
      const actionLabel = !productionPresentation
        ? 'Open from Kitting Workspace to inspect filesystem evidence'
        : loading
          ? 'Preparing Kitted BOM...'
          : kittedBomEvidenceState === 'error' || mismatchedEvidence || !governedPrimary
            ? 'Kitted BOM unavailable'
            : 'Open Kitted BOM';
      placeholder.disabled = !productionPresentation || !actionable || !expectedDocumentType ||
        !governedPrimary?.openUrl;
      setText('workOrderDashboardKittedBomPlaceholderLabel', productionPresentation ? statusLabel : 'Kitted BOM');
      setText('workOrderDashboardKittedBomPlaceholderMessage', actionLabel);
      return;
    }

    const primaryButton = document.getElementById('workOrderDashboardKittedBomOpenPrimary');
    const priorButton = document.getElementById('workOrderDashboardKittedBomOpenPrior');
    const evidence = kittedBomEvidence;
    const primary = evidence?.primaryDocument || null;
    const prior = evidence?.secondaryPriorShortageDocument || null;
    const mismatchedProductionEvidence = productionPresentation && primary &&
      primary.documentType !== expectedDocumentType;
    const governedPrimary = mismatchedProductionEvidence ? null : primary;
    const loading = actionable && (kittedBomEvidenceState === 'loading' || kittedBomEvidenceState === 'idle');

    const evidenceStatus = !actionable
      ? 'Governed Work Order required'
      : loading
      ? 'Checking Kitted BOM evidence...'
      : kittedBomEvidenceState === 'error'
        ? 'Kitted BOM evidence unavailable'
        : mismatchedProductionEvidence
          ? 'Kitted BOM evidence does not match current Material Status'
        : evidence?.displayLabel || 'No Kitted BOM Found';
    setText('workOrderDashboardKittedBomStatus', evidenceStatus);
    setText('kittingJobLegacyKittedBomStatus', evidenceStatus);
    setText('workOrderDashboardKittedBomFilename', governedPrimary?.fileName || (loading ? 'Checking...' : 'Not found'));
    setText('workOrderDashboardKittedBomFolder', governedPrimary?.folder || (loading ? 'Checking...' : 'None'));
    setText('workOrderDashboardKittedBomPriorShortage', loading
      ? 'Checking...'
      : evidence?.priorShortageEvidenceExists ? 'Yes' : 'No');
    setText('workOrderDashboardKittedBomMessage', !actionable
      ? 'Only an exact or approved governed Work Order can open Kitted BOM evidence.'
      : loading
      ? 'Verifying approved Kitting folders.'
      : kittedBomEvidenceState === 'error'
        ? 'The read-only server lookup could not be completed.'
        : mismatchedProductionEvidence
          ? 'The governed document result is inconsistent with the current Material Status and will not be opened.'
        : governedPrimary ? 'Read-only filesystem evidence. A governed legacy Material Status may reference this PDF without modifying it.' : 'No matching PDF exists in either approved Kitting folder.');

    if (primaryButton) {
      primaryButton.disabled = !governedPrimary?.openUrl;
      primaryButton.hidden = false;
    }
    if (priorButton) {
      priorButton.hidden = productionPresentation || !prior?.openUrl;
      priorButton.disabled = !prior?.openUrl;
    }
  }

  function openProductionKittedBomEvidence() {
    if (!isProductionKittedBomPresentation() ||
        !isActionableKittingDocumentHandoff(selectedWorkOrder) ||
        !getProductionKittedBomDocumentType()) return false;
    return openKittedBomDocument('primary');
  }

  function openKittedBomDocument(kind) {
    if (!canViewKittedBomEvidence() || !isActionableKittingDocumentHandoff(selectedWorkOrder)) return false;
    const documentEvidence = kind === 'prior-shortage'
      ? kittedBomEvidence?.secondaryPriorShortageDocument
      : kind === 'primary' ? kittedBomEvidence?.primaryDocument : null;
    if (isProductionKittedBomPresentation() &&
        (kind !== 'primary' || documentEvidence?.documentType !== getProductionKittedBomDocumentType())) return false;
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
    setText('workOrderDashboardMaterialStatus', materialStatusReview?.label ||
      (getSelectedMaterialStatusWorkOrder() ? 'Loading' : 'N/A'));
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
      setText('workOrderDashboardProductionSalesOrder',
        cleanText(selectedWorkOrder.originSalesOrderNumber) || 'N/A');
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
    setText('workOrderDashboardProductionSalesOrder', cleanText(official.salesOrder) || 'N/A');
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
    return {
      masterRecordKey,
      official,
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

  function resetAssemblyDrawingResolution() {
    assemblyDrawingRequestId += 1;
    assemblyDrawingResolution = null;
    assemblyDrawingState = 'idle';
    document.getElementById('workOrderDashboardAssemblyDrawingDialog')?.close?.();
  }

  function getAssemblyDrawingIdentity() {
    const canonical = selectedWorkOrder?.canonicalWorkOrder || {};
    return {
      customerName: cleanText(
        selectedWorkOrder?.originCustomerName || canonical.customerName ||
        selectedWorkOrder?.official?.customer),
      assemblyNumber: cleanText(
        canonical.itemNumber || selectedWorkOrder?.itemNumber ||
        selectedWorkOrder?.official?.partNumber),
      revision: cleanText(
        canonical.drawingRevision || canonical.bomRevision || canonical.revision ||
        canonical.revisionLevel || selectedWorkOrder?.revision)
    };
  }

  async function ensureAssemblyDrawingResolution() {
    if (!isProductionKittedBomPresentation() ||
        !isActionableKittingDocumentHandoff(selectedWorkOrder) ||
        assemblyDrawingState === 'loading' || assemblyDrawingState === 'loaded') return;
    const identity = getAssemblyDrawingIdentity();
    if (!identity.customerName || !identity.assemblyNumber) {
      assemblyDrawingState = 'unavailable';
      renderAssemblyDrawingControl();
      return;
    }
    const requestId = ++assemblyDrawingRequestId;
    assemblyDrawingState = 'loading';
    renderAssemblyDrawingControl();
    const parameters = new URLSearchParams({
      customerName: identity.customerName,
      assemblyNumber: identity.assemblyNumber
    });
    if (identity.revision) parameters.set('revision', identity.revision);
    try {
      const response = await fetch(assemblyDrawingEndpoint + '?' + parameters.toString(), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Assembly Drawing resolution failed.');
      const resolution = await response.json();
      if (requestId !== assemblyDrawingRequestId) return;
      assemblyDrawingResolution = resolution;
      assemblyDrawingState = 'loaded';
    } catch (error) {
      if (requestId !== assemblyDrawingRequestId) return;
      assemblyDrawingResolution = null;
      assemblyDrawingState = 'error';
    }
    renderAssemblyDrawingControl();
  }

  function renderAssemblyDrawingControl() {
    const link = document.getElementById('workOrderDashboardAssemblyDrawing');
    if (!link) return;
    if (!isProductionKittedBomPresentation()) {
      disableAssemblyDrawingLink(link);
      setText('workOrderDashboardAssemblyDrawingMessage', 'Coming Soon');
      return;
    }
    const status = cleanText(assemblyDrawingResolution?.status).toUpperCase();
    const actionableStates = new Set([
      'RESOLVED', 'ASSEMBLY_RESOLVED', 'REVISION_SELECTION_REQUIRED',
      'REVISION_NOT_FOUND', 'ASSEMBLY_SELECTION_REQUIRED', 'CUSTOMER_ONLY'
    ]);
    const bridgeAvailable = isDesktopCapabilityBridgeAvailable();
    const enabled = assemblyDrawingState === 'loaded' && actionableStates.has(status) && bridgeAvailable;
    const directUri = status === 'RESOLVED' || status === 'ASSEMBLY_RESOLVED' || status === 'CUSTOMER_ONLY'
      ? assemblyDrawingResolution?.openUri || assemblyDrawingResolution?.deepestOpenUri
      : '';
    const directCapability = assemblyDrawingResolution?.desktopCapability ||
      assemblyDrawingResolution?.deepestDesktopCapability;
    const correlationId = assemblyDrawingResolution?.capabilityCorrelationId;
    if (enabled && isApprovedAssemblyDrawingUri(directUri) &&
        isApprovedDesktopCapability(directCapability) && isApprovedDesktopCorrelationId(correlationId)) {
      enableAssemblyDrawingLink(link, directUri, 'launch', directCapability, correlationId);
    } else if (enabled) {
      enableAssemblyDrawingLink(link, '#workOrderDashboardAssemblyDrawingDialog', 'choose');
    } else {
      disableAssemblyDrawingLink(link);
    }
    setText('workOrderDashboardAssemblyDrawingMessage',
      assemblyDrawingState === 'loading' || assemblyDrawingState === 'idle'
        ? 'Resolving drawing folder...'
        : !bridgeAvailable && assemblyDrawingState === 'loaded' && actionableStates.has(status)
          ? 'Desktop folder access unavailable'
          : !enabled
          ? 'Drawing folder unavailable'
          : status === 'RESOLVED' || status === 'ASSEMBLY_RESOLVED'
            ? 'Open Drawing Folder'
            : status === 'REVISION_SELECTION_REQUIRED'
              ? 'Choose Revision'
              : status === 'ASSEMBLY_SELECTION_REQUIRED'
                ? 'Choose Assembly Folder'
                : status === 'CUSTOMER_ONLY'
                  ? 'Open Customer Folder'
                  : 'Review Available Folder');
  }

  function openAssemblyDrawing(event) {
    if (!isProductionKittedBomPresentation() || assemblyDrawingState !== 'loaded') {
      event?.preventDefault?.();
      return false;
    }
    const status = cleanText(assemblyDrawingResolution?.status).toUpperCase();
    if (status === 'RESOLVED' || status === 'ASSEMBLY_RESOLVED' || status === 'CUSTOMER_ONLY') {
      const expected = cleanText(
        assemblyDrawingResolution.openUri || assemblyDrawingResolution.deepestOpenUri);
      const rendered = cleanText(event?.currentTarget?.getAttribute?.('href'));
      const expectedCapability = cleanText(
        assemblyDrawingResolution.desktopCapability || assemblyDrawingResolution.deepestDesktopCapability);
      const renderedCapability = cleanText(
        event?.currentTarget?.getAttribute?.('data-dle-desktop-capability'));
      if (!isApprovedAssemblyDrawingUri(expected) || rendered !== expected ||
          !isApprovedDesktopCapability(expectedCapability) || renderedCapability !== expectedCapability) {
        event?.preventDefault?.();
        return false;
      }
      return true;
    }
    if (!['REVISION_SELECTION_REQUIRED', 'REVISION_NOT_FOUND', 'ASSEMBLY_SELECTION_REQUIRED'].includes(status)) {
      event?.preventDefault?.();
      return false;
    }
    event?.preventDefault?.();
    const opened = openAssemblyDrawingDialog();
    return event ? false : opened;
  }

  function openAssemblyDrawingDialog() {
    const dialog = document.getElementById('workOrderDashboardAssemblyDrawingDialog');
    const choices = document.getElementById('workOrderDashboardAssemblyDrawingChoices');
    const deepest = document.getElementById('workOrderDashboardAssemblyDrawingDeepest');
    if (!dialog || !choices || !deepest) return false;
    const identity = getAssemblyDrawingIdentity();
    setText('workOrderDashboardAssemblyDrawingIdentity',
      [identity.assemblyNumber, identity.revision ? 'Rev ' + identity.revision : '']
        .filter(Boolean).join(' — '));
    setText('workOrderDashboardAssemblyDrawingStatus',
      cleanText(assemblyDrawingResolution?.message) || 'Select an existing drawing folder.');
    const available = Array.isArray(assemblyDrawingResolution?.choices)
      ? assemblyDrawingResolution.choices : [];
    choices.innerHTML = available
      .filter(choice => isApprovedAssemblyDrawingUri(choice?.openUri) &&
        isApprovedDesktopCapability(choice?.desktopCapability))
      .map(choice => '<a href="' + escapeDashboardHtml(choice.openUri) + '" ' +
        'data-dle-desktop-operation="open-drawing-folder" ' +
        'data-dle-desktop-capability="' + escapeDashboardHtml(choice.desktopCapability) + '" ' +
        'data-dle-desktop-correlation-id="' +
        escapeDashboardHtml(assemblyDrawingResolution.capabilityCorrelationId) + '">' +
        escapeDashboardHtml(choice.displayLabel || choice.label || 'Open Folder') + '</a>').join('');
    const deepestUri = assemblyDrawingResolution?.deepestOpenUri;
    const deepestCapability = assemblyDrawingResolution?.deepestDesktopCapability;
    deepest.hidden = !isApprovedAssemblyDrawingUri(deepestUri) ||
      !isApprovedDesktopCapability(deepestCapability);
    if (deepest.hidden) {
      deepest.removeAttribute('href');
      deepest.removeAttribute('data-dle-desktop-operation');
      deepest.removeAttribute('data-dle-desktop-capability');
      deepest.removeAttribute('data-dle-desktop-correlation-id');
    } else {
      deepest.setAttribute('href', deepestUri);
      deepest.setAttribute('data-dle-desktop-operation', 'open-drawing-folder');
      deepest.setAttribute('data-dle-desktop-capability', deepestCapability);
      deepest.setAttribute('data-dle-desktop-correlation-id',
        assemblyDrawingResolution.capabilityCorrelationId);
    }
    deepest.textContent = cleanText(assemblyDrawingResolution?.status).toUpperCase() === 'CUSTOMER_ONLY'
      ? 'Open Customer Folder' : 'Open Confirmed Assembly Folder';
    dialog.showModal();
    return true;
  }

  function closeAssemblyDrawingDialog() {
    document.getElementById('workOrderDashboardAssemblyDrawingDialog')?.close?.();
  }

  function isApprovedAssemblyDrawingUri(value) {
    return /^dle-drawing-prints:\/\/open\/[A-Za-z0-9_-]{2,1366}$/.test(cleanText(value));
  }

  function isApprovedDesktopCapability(value) {
    return /^dlecap1_[A-Za-z0-9_-]{43}$/.test(cleanText(value));
  }

  function isApprovedDesktopCorrelationId(value) {
    const clean = cleanText(value);
    return clean.length > 0 && clean.length <= 128 &&
      !Array.from(clean).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  }

  function isDesktopCapabilityBridgeAvailable() {
    return document.documentElement?.getAttribute?.('data-dle-os-desktop-capabilities') === 'ready';
  }

  function enableAssemblyDrawingLink(link, href, action, capability, correlationId) {
    link.setAttribute('href', href);
    link.setAttribute('aria-disabled', 'false');
    link.setAttribute('data-assembly-drawing-action', action);
    if (action === 'choose') {
      link.setAttribute('onclick', 'return openWorkOrderDashboardAssemblyDrawing(event)');
      link.removeAttribute('data-dle-desktop-operation');
      link.removeAttribute('data-dle-desktop-capability');
      link.removeAttribute('data-dle-desktop-correlation-id');
    } else {
      link.removeAttribute('onclick');
      link.setAttribute('data-dle-desktop-operation', 'open-drawing-folder');
      link.setAttribute('data-dle-desktop-capability', capability);
      link.setAttribute('data-dle-desktop-correlation-id', correlationId);
    }
    link.removeAttribute('tabindex');
  }

  function disableAssemblyDrawingLink(link) {
    link.removeAttribute('href');
    link.removeAttribute('onclick');
    link.setAttribute('aria-disabled', 'true');
    link.removeAttribute('data-assembly-drawing-action');
    link.removeAttribute('data-dle-desktop-operation');
    link.removeAttribute('data-dle-desktop-capability');
    link.removeAttribute('data-dle-desktop-correlation-id');
    link.setAttribute('tabindex', '-1');
  }

  function returnToProductionWorkspace() {
    if (selectedWorkOrder?.returnWorkspaceId !== 'production') return false;
    if (typeof go === 'function') go('home');
    window.DleWorkspaceShell?.setWorkspaceView?.('production');
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
  window.WorkOrderDashboardModule.returnToProduction = returnToProductionWorkspace;
  window.WorkOrderDashboardModule.openKittedBom = openKittedBomDocument;
  window.WorkOrderDashboardModule.openProductionKittedBom = openProductionKittedBomEvidence;
  window.WorkOrderDashboardModule.openAssemblyDrawing = openAssemblyDrawing;
  window.WorkOrderDashboardModule.openKittingDisposition = openKittingDispositionDialog;
  window.WorkOrderDashboardModule.openReleasedBom = openReleasedBomPrototype;
  window.WorkOrderDashboardModule.openActiveKitting = openActiveKittingTrial;
  window.WorkOrderDashboardModule.getActiveKittingDraft = () => activeKittingTrialDraft;
  window.WorkOrderDashboardModule.isActiveKittingEditing = isActiveKittingEditing;
  window.WorkOrderDashboardModule.saveAndExitActiveKitting = saveAndExitActiveKitting;
  window.WorkOrderDashboardModule.abandonActiveKittingWithoutSaving = abandonActiveKittingWithoutSaving;
  window.WorkOrderDashboardModule.pauseActiveKittingAutosaveForNavigation = pauseActiveKittingAutosaveForNavigation;
  window.WorkOrderDashboardModule.resumeActiveKittingAutosaveAfterNavigationCancel = resumeActiveKittingAutosaveAfterNavigationCancel;
  window.WorkOrderDashboardModule.getActiveKittingSaveState = () => activeKittingSaveState;
  window.WorkOrderDashboardModule.normalizeReleasedBomWorkOrder = normalizeReleasedBomWorkOrder;
  window.WorkOrderDashboardModule.getCurrentView = () => currentView;
  window.WorkOrderDashboardModule.getPresentationMode = () => presentationMode;
  window.WorkOrderDashboardModule.getSelectedHandoff = () => selectedWorkOrder;
  window.WorkOrderDashboardModule.supportedViews = Object.freeze(Array.from(supportedDashboardViews));

  window.loadWorkOrderDashboardModule = loadWorkOrderDashboardModule;
  window.initializeWorkOrderDashboardModule = initializeWorkOrderDashboardModule;
  window.setWorkOrderDashboardModuleSelectedWorkOrder = setSelectedWorkOrder;
  window.setWorkOrderDashboardModuleView = setDashboardView;
  window.toggleWorkOrderDashboardScheduledReleases = toggleScheduledReleases;
  window.renderWorkOrderDashboardModule = renderWorkOrderDashboardModule;
  window.returnToKittingWorkspace = returnToKittingWorkspace;
  window.returnToProductionWorkspace = returnToProductionWorkspace;
  window.openWorkOrderDashboardKittedBom = openKittedBomDocument;
  window.openWorkOrderDashboardProductionKittedBom = openProductionKittedBomEvidence;
  window.openWorkOrderDashboardAssemblyDrawing = openAssemblyDrawing;
  window.closeWorkOrderDashboardAssemblyDrawing = closeAssemblyDrawingDialog;
  window.openWorkOrderDashboardReleasedBom = openReleasedBomPrototype;
  window.openWorkOrderDashboardActiveKitting = openActiveKittingTrial;
  window.startOrResumeWorkOrderDashboardKitting = startOrResumeActiveKitting;
  window.reconnectWorkOrderDashboardKitting = reconnectActiveKitting;
  window.signInAgainWorkOrderDashboardKitting = signInAgainActiveKitting;
  window.saveAndExitWorkOrderDashboardKitting = saveAndExitActiveKitting;
  window.closeWorkOrderDashboardActiveKitting = closeActiveKittingTrial;
  window.openWorkOrderDashboardKittingResultDialog = openActiveKittingResultDialog;
  window.closeWorkOrderDashboardKittingResultDialog = closeActiveKittingResultDialog;
  window.cancelWorkOrderDashboardKittingResultDialog = cancelActiveKittingResultDialog;
  window.openWorkOrderDashboardKittingDetail = openActiveKittingSubmittedDetail;
  window.closeWorkOrderDashboardKittingDetail = closeActiveKittingSubmittedDetail;
  window.chooseWorkOrderDashboardKittingMethod = chooseActiveKittingMethod;
  window.updateWorkOrderDashboardKittingAllocation = updateActiveKittingAllocation;
  window.addWorkOrderDashboardKittingAllocation = addActiveKittingAllocation;
  window.removeWorkOrderDashboardKittingAllocation = removeActiveKittingAllocation;
  window.updateWorkOrderDashboardKittingPart = updateActiveKittingSelectedPart;
  window.placeWorkOrderDashboardKittingCountCaret = placeActiveKittingCountCaret;
  window.completeWorkOrderDashboardKittingCount = completeActiveKittingCount;
  window.updateWorkOrderDashboardKittingPo = updateActiveKittingPurchaseOrder;
  window.printWorkOrderDashboardAcceptedMaterialLabel = printAcceptedMaterialLabel;
  window.viewWorkOrderDashboardKittingBagLabel = viewKittingBagLabel;
  window.printAllWorkOrderDashboardKittingBagLabels = printAllKittingBagLabels;
  window.printWorkOrderDashboardKittingKitIdLabel = printKittingKitIdLabel;
  window.setWorkOrderDashboardKittingPoTraceability = setActiveKittingPoTraceability;
  window.handleWorkOrderDashboardKittingCountKeydown = handleActiveKittingCountKeydown;
  window.submitWorkOrderDashboardKittingRow = submitActiveKittingRow;
  window.editWorkOrderDashboardKittingRow = editActiveKittingRow;
  window.submitWorkOrderDashboardActiveKitting = submitActiveKittingTrial;
  window.openWorkOrderDashboardKittingSubmissionPdf = openKittingSubmissionPdf;
  window.openWorkOrderDashboardKittingSubmissionLayoutPreview = openKittingSubmissionLayoutPreview;
  window.openWorkOrderDashboardDispositionDialog = openKittingDispositionDialog;
  window.updateWorkOrderDashboardDispositionDialog = updateKittingDispositionDialog;
  window.closeWorkOrderDashboardDispositionDialog = closeKittingDispositionDialog;
  window.submitWorkOrderDashboardDisposition = submitKittingDisposition;
})();

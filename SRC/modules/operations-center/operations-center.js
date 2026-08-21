/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};
  let operationalStateSubscription = null;
  let materialStatusSubscription = null;
  let syncOperationsPollTimer = null;
  let verifiedStatusDialogRecord = null;
  let verifiedStatusDialogGroup = null;
  let verifiedStatusSaving = false;
  let verifiedStatusInitialText = '';
  let verifiedStatusDirty = false;
  let verifiedStatusAttemptText = '';
  let verifiedStatusRequestCorrelationId = '';
  let verifiedStatusFeedbackTimer = null;
  let mobileSelectedRecordKey = '';

  async function loadOperationsCenterModule() {
    const placeholder = document.getElementById('operationsCenter');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/operations-center/operations-center.html');
    if (!response.ok) {
      throw new Error('Unable to load Operations Center module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;
  }

  async function initializeOperationsCenter() {
    if (!operationalStateSubscription && window.DleApiClient?.subscribeOperationalLineStateChange) {
      operationalStateSubscription = window.DleApiClient.subscribeOperationalLineStateChange(detail => {
        if (!window.OperationsCenter.state?.canonicalLoaded) return;
        const refresh = refreshOperationsCenterCanonicalData();
        detail.waitUntil?.(refresh);
        return refresh;
      });
    }
    if (!materialStatusSubscription && window.MaterialStatus?.subscribe) {
      materialStatusSubscription = window.MaterialStatus.subscribe(detail => {
        if (!window.OperationsCenter.state?.canonicalLoaded) return;
        const refresh = refreshOperationsCenterCanonicalData();
        detail.waitUntil?.(refresh);
        return refresh;
      });
    }
    window.OperationsCenter.projection.initialize();
    await refreshOperationsCenterCanonicalData();
    await refreshSyncOperationsStatus();
  }

  function renderOperationsCenterModule() {
    window.OperationsCenter.table.renderModule();
  }

  async function refreshOperationsCenterCanonicalData() {
    const stateActions = window.OperationsCenter.stateActions;
    const requestId = stateActions.beginCanonicalLoad();
    window.OperationsCenter.table.renderModule();
    try {
      const result = await window.OperationsCenter.dataService.loadCanonicalRows();
      if (stateActions.commitCanonicalLoad(result, requestId)) {
        await refreshOperationsCenterVerifiedStatuses();
      }
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      stateActions.failCanonicalLoad(error, requestId);
    }
    window.OperationsCenter.table.renderModule();
    return !window.OperationsCenter.state.canonicalError;
  }

  async function refreshOperationsCenterVerifiedStatuses() {
    const stateActions = window.OperationsCenter.stateActions;
    const service = window.OperationsCenter.verifiedStatusService;
    if (!service?.loadLatestForRows) return;
    stateActions.setVerifiedStatusLoading(true);
    try {
      await service.loadLatestForRows(window.OperationsCenter.state.canonicalRows);
    } catch (error) {
      stateActions.setVerifiedStatusError(error);
    }
  }

  function syncValue(state, name) {
    return state?.[name] ?? state?.[name.charAt(0).toUpperCase() + name.slice(1)];
  }

  function formatSyncDate(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
  }

  function renderSyncOperationsStatus(state) {
    const root = document.getElementById('syncOperationsStatus');
    const button = document.getElementById('syncOperationsButton');
    if (!root) return;
    const status = String(syncValue(state, 'status') || 'NEVER_RUN');
    const running = ['QUEUED', 'RUNNING'].includes(status);
    const daily = syncValue(state, 'dailyOperations');
    const dailyCounts = syncValue(daily, 'components') || [];
    const countSummary = dailyCounts.filter(item => syncValue(item, 'recordCount') !== null && syncValue(item, 'recordCount') !== undefined)
      .map(item => syncValue(item, 'id') + ': ' + syncValue(item, 'recordCount')).join(' · ');
    root.dataset.status = status.toLowerCase();
    root.innerHTML = '<strong>Sync Operations — ' + escapeOptionText(status.replaceAll('_', ' ')) + '</strong>' +
      '<span>' + escapeOptionText(syncValue(state, 'result') || syncValue(state, 'currentStep') || 'No synchronization has run.') + '</span>' +
      '<small>Requested by ' + escapeOptionText(syncValue(state, 'requestedBy') || '—') +
      ' · started ' + escapeOptionText(formatSyncDate(syncValue(state, 'startedAtUtc'))) +
      ' · elapsed ' + escapeOptionText(syncValue(state, 'elapsedSeconds') ?? 0) + 's' +
      (countSummary ? ' · ' + escapeOptionText(countSummary) : '') + '</small>';
    if (button) button.disabled = running;
    if (syncOperationsPollTimer) window.clearTimeout(syncOperationsPollTimer);
    syncOperationsPollTimer = running ? window.setTimeout(refreshSyncOperationsStatus, 2000) : null;
  }

  async function refreshSyncOperationsStatus() {
    try {
      renderSyncOperationsStatus(await window.DleApiClient.liveCanonical.getSyncOperationsCurrent());
    } catch (error) {
      const root = document.getElementById('syncOperationsStatus');
      if (root) root.innerHTML = '<strong>Sync Operations unavailable</strong><span>' +
        escapeOptionText(error?.message || error) + '</span>';
    }
  }

  async function startSyncOperations() {
    if (!window.confirm('Start the governed operational synchronization now? This updates Customer Master, Work Orders, Open Sales Orders, and relationships, then verifies the promoted generation through API 5052.')) return;
    const button = document.getElementById('syncOperationsButton');
    if (button) button.disabled = true;
    try {
      renderSyncOperationsStatus(await window.DleApiClient.liveCanonical.startSyncOperations());
    } catch (error) {
      window.alert('Sync Operations was not started.\n\n' + (error?.message || error));
      await refreshSyncOperationsStatus();
    }
  }

  function filterOperationsCenter() {
    window.OperationsCenter.table.filter();
    renderOperationsCenterMobileView();
  }

  function getMobileSearchTerms() {
    const input = document.getElementById('operationsCenterMobileSearch');
    return window.OperationsCenter.viewModel.parseSearchTerms(input?.value || '');
  }

  function getMobileRecords() {
    return window.OperationsCenter.viewModel.getOperationsCenterView({
      hideRmaRework: !!window.OperationsCenter.state.hideRmaRework
    }).records;
  }

  function getMobileGroups() {
    return window.OperationsCenter.viewModel.getWorkOrderGroups(getMobileRecords(), {
      searchTerms: getMobileSearchTerms()
    });
  }

  function toggleOperationsCenterMobileView(force) {
    const mobile = document.getElementById('operationsCenterMobileView');
    const table = document.getElementById('operationsCenterTable');
    const button = document.getElementById('operationsCenterMobileViewToggle');
    if (!mobile || !table) return;
    const active = typeof force === 'boolean' ? force : mobile.hidden;
    mobile.hidden = !active;
    table.hidden = active;
    if (button) button.classList.toggle('active', active);
    if (active) renderOperationsCenterMobileView();
  }

  function renderOperationsCenterMobileView() {
    const results = document.getElementById('operationsCenterMobileResults');
    if (!results || document.getElementById('operationsCenterMobileView')?.hidden) return;
    const groups = getMobileGroups().slice(0, 50);
    if (!groups.length) {
      results.innerHTML = '<div class="operations-center-empty">No matching Operations Center work orders.</div>';
      renderOperationsCenterMobileDetail(null);
      return;
    }
    results.innerHTML = groups.map(renderMobileResultCard).join('');
    const selected = groups.find(group => group.key === mobileSelectedRecordKey) || groups[0];
    renderOperationsCenterMobileDetail(selected);
  }

  function renderMobileResultCard(group) {
    const viewModel = window.OperationsCenter.viewModel;
    const primary = group.primaryRecord;
    const unresolved = group.type === 'UNRESOLVED_LINE';
    const active = group.key === mobileSelectedRecordKey ? ' active' : '';
    const status = group.statusPresentation?.statusText || '';
    const statusBadge = status
      ? '<small class="operations-center-mobile-status">' + escapeOptionText((unresolved ? 'Last Verified: ' : '') + status) +
        (group.overrideCount ? ' · ' + escapeOptionText(group.overrideCount + ' override' + (group.overrideCount === 1 ? '' : 's')) : '') + '</small>'
      : '';
    if (unresolved) {
      return '<button type="button" class="operations-center-mobile-card operations-center-mobile-card-unresolved' + active +
        '" data-mobile-group-key="' + escapeOptionText(group.key) + '" onclick="selectOperationsCenterMobileRecord(event)">' +
        '<strong>Awaiting WO Assignment</strong>' +
        '<span>' + escapeOptionText(viewModel.getOfficialField(primary, 'partNumber')) + ' · Qty ' +
        escapeOptionText(viewModel.getOfficialField(primary, 'opQtyOpen')) + '</span>' +
        '<small>SO ' + escapeOptionText(viewModel.getOfficialField(primary, 'salesOrder').replace(/^0+/, '') ||
          viewModel.getOfficialField(primary, 'salesOrder')) + ' · Line ' +
        escapeOptionText(viewModel.getOfficialField(primary, 'sequenceLine')) + ' · Due ' +
        escapeOptionText(viewModel.getOfficialField(primary, 'dueDate')) + '</small>' +
        '<small>' + escapeOptionText(viewModel.getOfficialField(primary, 'customer')) + '</small>' +
        statusBadge + '</button>';
    }
    return '<button type="button" class="operations-center-mobile-card' + active + '" data-mobile-group-key="' +
      escapeOptionText(group.key) + '" onclick="selectOperationsCenterMobileRecord(event)">' +
      '<strong>WO ' + escapeOptionText(group.workOrderNumber.replace(/^0+/, '') || group.workOrderNumber) +
      ' · ' + escapeOptionText(viewModel.getOfficialField(primary, 'partNumber')) + '</strong>' +
      '<span>Qty ' + escapeOptionText(group.groupedOpenQuantity) +
      ' · ' + escapeOptionText(group.lineCount + ' line' + (group.lineCount === 1 ? '' : 's')) +
      ' · Next ' + escapeOptionText(viewModel.getOfficialField(primary, 'dueDate')) +
      (group.hasQuantityException ? ' · RMA/MIXED qty' : '') + '</span>' +
      '<small>' + escapeOptionText(viewModel.getOfficialField(primary, 'customer')) +
      ' · PO ' + escapeOptionText(viewModel.getOfficialField(primary, 'customerPo')) + '</small>' +
      statusBadge + '</button>';
  }

  function selectOperationsCenterMobileRecord(event) {
    mobileSelectedRecordKey = event?.currentTarget?.dataset?.mobileGroupKey || '';
    renderOperationsCenterMobileView();
  }

  function renderOperationsCenterMobileDetail(group) {
    const detail = document.getElementById('operationsCenterMobileDetail');
    if (!detail) return;
    if (!group) { detail.hidden = true; detail.innerHTML = ''; return; }
    detail.hidden = false;
    mobileSelectedRecordKey = group.key;
    const viewModel = window.OperationsCenter.viewModel;
    const primary = group.primaryRecord;
    const status = group.statusPresentation || {};
    const unresolved = group.type === 'UNRESOLVED_LINE';
    if (unresolved) {
      detail.innerHTML = '<div class="operations-center-mobile-detail-card operations-center-mobile-detail-unresolved">' +
        '<h3>Awaiting WO Assignment · ' + escapeOptionText(viewModel.getOfficialField(primary, 'partNumber')) + '</h3>' +
        '<dl>' +
        mobileFact('Customer', viewModel.getOfficialField(primary, 'customer')) +
        mobileFact('Customer P.O.', viewModel.getOfficialField(primary, 'customerPo')) +
        mobileFact('Qty Open', viewModel.getOfficialField(primary, 'opQtyOpen')) +
        mobileFact('SO / Line', viewModel.getOfficialField(primary, 'salesOrder') + ' / ' + viewModel.getOfficialField(primary, 'sequenceLine')) +
        mobileFact('Due', viewModel.getOfficialField(primary, 'dueDate')) +
        mobileFact('Material', viewModel.getOfficialField(primary, 'materialStatus')) +
        '</dl>' +
        '<div class="operations-center-mobile-latest"><strong>Last Verified Status</strong><span>' +
        escapeOptionText(status.statusText || 'No status logged yet.') + '</span><small>' +
        escapeOptionText([status.recordedBy, status.timeLabel, status.statusText ? 'Individual line' : ''].filter(Boolean).join(' · ')) +
        '</small></div>' +
        '<button type="button" class="operations-center-mobile-log-button" onclick="openOperationsCenterVerifiedStatusLoggerForKey()">Log Status</button></div>';
      return;
    }
    detail.innerHTML = '<div class="operations-center-mobile-detail-card">' +
      '<h3>WO ' + escapeOptionText(group.workOrderNumber.replace(/^0+/, '') || group.workOrderNumber) + ' · ' +
      escapeOptionText(viewModel.getOfficialField(primary, 'partNumber')) + '</h3>' +
      '<dl>' +
      mobileFact('Customer', viewModel.getOfficialField(primary, 'customer')) +
      mobileFact('Customer P.O.', viewModel.getOfficialField(primary, 'customerPo')) +
      mobileFact('Grouped Qty', group.groupedOpenQuantity + (group.hasQuantityException ? ' + exception lines' : '')) +
      mobileFact('Lines', group.lineCount) +
      mobileFact('Next Due', viewModel.getOfficialField(primary, 'dueDate')) +
      mobileFact('Default Line', viewModel.getOfficialField(primary, 'salesOrder') + ' / ' + viewModel.getOfficialField(primary, 'sequenceLine')) +
      mobileFact('Material', viewModel.getOfficialField(primary, 'materialStatus')) +
      '</dl>' +
      '<div class="operations-center-mobile-latest"><strong>Last Verified Status</strong><span>' +
      escapeOptionText(status.statusText || 'No status logged yet.') + '</span><small>' +
      escapeOptionText([status.recordedBy, status.timeLabel, group.overrideCount ? group.overrideCount + ' line override' + (group.overrideCount === 1 ? '' : 's') : 'WO default'].filter(Boolean).join(' · ')) + '</small></div>' +
      '<div class="operations-center-mobile-lines">' + group.records.map(renderMobileLineSummary).join('') + '</div>' +
      '<button type="button" class="operations-center-mobile-log-button" onclick="openOperationsCenterVerifiedStatusLoggerForKey()">Log Status</button></div>';
  }

  function renderMobileLineSummary(record) {
    const viewModel = window.OperationsCenter.viewModel;
    const status = viewModel.getVerifiedStatusPresentation(record);
    const inherited = status.inherited ? 'Inherited' : status.statusText ? 'Override' : 'No status';
    return '<button type="button" class="operations-center-mobile-line" data-master-record-key="' +
      escapeOptionText(viewModel.getMasterRecordKey(record)) + '" onclick="openOperationsCenterLineVerifiedStatusLogger(event)">' +
      '<strong>SO ' + escapeOptionText(viewModel.getOfficialField(record, 'salesOrder')) +
      ' / Line ' + escapeOptionText(viewModel.getOfficialField(record, 'sequenceLine')) + '</strong>' +
      '<span>Due ' + escapeOptionText(viewModel.getOfficialField(record, 'dueDate')) +
      ' · Qty ' + escapeOptionText(viewModel.getOfficialField(record, 'opQtyOpen')) +
      ' · ' + escapeOptionText(inherited) + '</span>' +
      '<small>' + escapeOptionText(status.statusText || 'No status logged yet.') + '</small></button>';
  }

  function mobileFact(label, value) {
    return '<dt>' + escapeOptionText(label) + '</dt><dd>' + escapeOptionText(value || '-') + '</dd>';
  }

  function escapeOptionText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]));
  }

  function toggleOperationsCenterProjectionMode() {
    window.OperationsCenter.projection.toggleActive();
    window.OperationsCenter.table.renderModule();
  }

  function toggleOperationsCenterRmaVisibility() {
    window.OperationsCenter.stateActions.toggleHideRmaRework();
    window.OperationsCenter.table.renderModule();
  }

  function updateOperationsCenterProjectionSelection(event) {
    window.OperationsCenter.table.updateProjectionSelection(event);
  }

  function openVerifiedStatusLogger(record, group = null) {
    verifiedStatusDialogRecord = record;
    verifiedStatusDialogGroup = group;
    const dialog = document.getElementById('operationsCenterVerifiedStatusDialog');
    const context = document.getElementById('operationsCenterVerifiedStatusContext');
    const text = document.getElementById('operationsCenterVerifiedStatusText');
    const message = document.getElementById('operationsCenterVerifiedStatusMessage');
    if (!dialog || !context || !text) return;
    const viewModel = window.OperationsCenter.viewModel;
    const prefill = viewModel.getVerifiedStatusLoggerPrefill(record, group);
    if (group) {
      const primary = group.primaryRecord;
      context.innerHTML = '<strong>WO ' + escapeOptionText(group.workOrderNumber.replace(/^0+/, '') || group.workOrderNumber) +
        ' · ' + escapeOptionText(viewModel.getOfficialField(primary, 'partNumber')) + '</strong>' +
        '<span>Qty ' + escapeOptionText(group.groupedOpenQuantity) + ' / ' + escapeOptionText(group.lineCount + ' lines') +
        ' / Default SO ' + escapeOptionText(viewModel.getOfficialField(primary, 'salesOrder')) +
        ' Line ' + escapeOptionText(viewModel.getOfficialField(primary, 'sequenceLine')) + '</span>' +
        '<small>Saving as Work Order default. Individual lines may override later.</small>';
    } else {
      const workOrder = viewModel.resolveGovernedWorkOrderNumber(record);
      const lineContext = prefill.inheritedStatusText
        ? 'Inherits WO status: ' + prefill.inheritedStatusText + ' · Entering text creates an Individual Line override.'
        : 'Individual Line ' + (workOrder ? 'override' : 'status') + ' · ' +
          viewModel.getOfficialField(record, 'partNumber') + ' · ' + viewModel.getOfficialField(record, 'description');
      context.innerHTML = '<strong>' + escapeOptionText(viewModel.getOfficialField(record, 'customer')) + '</strong>' +
        '<span>SO ' + escapeOptionText(viewModel.getOfficialField(record, 'salesOrder')) +
        ' / Line ' + escapeOptionText(viewModel.getOfficialField(record, 'sequenceLine')) +
        (workOrder ? ' / WO ' + escapeOptionText(workOrder) : ' / Awaiting WO Assignment') + '</span>' +
        '<small>' + escapeOptionText(lineContext) + '</small>';
    }
    text.value = prefill.statusText;
    verifiedStatusInitialText = prefill.statusText;
    verifiedStatusDirty = false;
    verifiedStatusAttemptText = '';
    verifiedStatusRequestCorrelationId = '';
    const dirty = document.getElementById('operationsCenterVerifiedStatusDirty');
    const discardPrompt = document.getElementById('operationsCenterVerifiedStatusDiscardPrompt');
    if (dirty) dirty.hidden = true;
    if (discardPrompt) discardPrompt.hidden = true;
    if (message) message.textContent = '';
    dialog.hidden = false;
    text.focus();
    if (prefill.statusText && typeof text.select === 'function') text.select();
  }

  function updateVerifiedStatusDirtyState() {
    const text = document.getElementById('operationsCenterVerifiedStatusText');
    const dirty = document.getElementById('operationsCenterVerifiedStatusDirty');
    const discardPrompt = document.getElementById('operationsCenterVerifiedStatusDiscardPrompt');
    const currentText = String(text?.value || '');
    verifiedStatusDirty = currentText !== verifiedStatusInitialText;
    if (dirty) dirty.hidden = !verifiedStatusDirty;
    if (!verifiedStatusDirty && discardPrompt) discardPrompt.hidden = true;
    const normalizedText = currentText.trim();
    if (verifiedStatusAttemptText && normalizedText !== verifiedStatusAttemptText) {
      verifiedStatusAttemptText = '';
      verifiedStatusRequestCorrelationId = '';
    }
    return verifiedStatusDirty;
  }

  function resetVerifiedStatusDialogState() {
    verifiedStatusDialogRecord = null;
    verifiedStatusDialogGroup = null;
    verifiedStatusInitialText = '';
    verifiedStatusDirty = false;
    verifiedStatusAttemptText = '';
    verifiedStatusRequestCorrelationId = '';
    const dirty = document.getElementById('operationsCenterVerifiedStatusDirty');
    const discardPrompt = document.getElementById('operationsCenterVerifiedStatusDiscardPrompt');
    if (dirty) dirty.hidden = true;
    if (discardPrompt) discardPrompt.hidden = true;
  }

  function closeVerifiedStatusLogger(force = false) {
    if (verifiedStatusSaving) return;
    updateVerifiedStatusDirtyState();
    if (verifiedStatusDirty && !force) {
      const discardPrompt = document.getElementById('operationsCenterVerifiedStatusDiscardPrompt');
      if (discardPrompt) {
        discardPrompt.hidden = false;
        discardPrompt.querySelector('button:last-child')?.focus?.();
      }
      return;
    }
    resetVerifiedStatusDialogState();
    const dialog = document.getElementById('operationsCenterVerifiedStatusDialog');
    if (dialog) dialog.hidden = true;
  }

  function discardVerifiedStatusChanges() {
    closeVerifiedStatusLogger(true);
  }

  function keepEditingVerifiedStatus() {
    const discardPrompt = document.getElementById('operationsCenterVerifiedStatusDiscardPrompt');
    const text = document.getElementById('operationsCenterVerifiedStatusText');
    if (discardPrompt) discardPrompt.hidden = true;
    text?.focus?.();
  }

  function showVerifiedStatusLoggedFeedback() {
    const feedback = document.getElementById('operationsCenterMobileStatusFeedback');
    if (!feedback) return;
    feedback.textContent = 'Status logged';
    feedback.hidden = false;
    if (verifiedStatusFeedbackTimer) window.clearTimeout(verifiedStatusFeedbackTimer);
    verifiedStatusFeedbackTimer = window.setTimeout(() => {
      feedback.hidden = true;
      verifiedStatusFeedbackTimer = null;
    }, 2600);
  }

  function getCurrentMobileSelectedGroup() {
    return getMobileGroups().find(group => group.key === mobileSelectedRecordKey) || null;
  }

  function openVerifiedStatusLoggerForKey() {
    const group = getCurrentMobileSelectedGroup();
    if (group) openVerifiedStatusLogger(group.primaryRecord, group.type === 'UNRESOLVED_LINE' ? null : group);
  }

  function openLineVerifiedStatusLogger(event) {
    const key = event?.currentTarget?.dataset?.masterRecordKey || '';
    const group = getCurrentMobileSelectedGroup();
    const record = group?.records.find(item => window.OperationsCenter.viewModel.getMasterRecordKey(item) === key) || null;
    if (record) openVerifiedStatusLogger(record, null);
  }

  async function submitVerifiedStatus(event) {
    event?.preventDefault?.();
    if (verifiedStatusSaving || (!verifiedStatusDialogRecord && !verifiedStatusDialogGroup)) return;
    const text = document.getElementById('operationsCenterVerifiedStatusText');
    const button = document.getElementById('operationsCenterVerifiedStatusSave');
    const message = document.getElementById('operationsCenterVerifiedStatusMessage');
    const statusText = String(text?.value || '').trim();
    if (!statusText) {
      if (message) message.textContent = 'Status to log is required.';
      return;
    }
    if (!verifiedStatusRequestCorrelationId || verifiedStatusAttemptText !== statusText) {
      verifiedStatusAttemptText = statusText;
      verifiedStatusRequestCorrelationId = window.DleApiClient.createRequestCorrelationId();
    }
    const requestOptions = { requestCorrelationId: verifiedStatusRequestCorrelationId };
    verifiedStatusSaving = true;
    if (button) button.disabled = true;
    if (message) message.textContent = 'Saving...';
    try {
      if (verifiedStatusDialogGroup) {
        await window.OperationsCenter.verifiedStatusService.appendForWorkOrderGroup(verifiedStatusDialogGroup, statusText, requestOptions);
      } else {
        await window.OperationsCenter.verifiedStatusService.appendForRecord(verifiedStatusDialogRecord, statusText, requestOptions);
      }
      closeVerifiedStatusLoggerAfterSave();
      window.OperationsCenter.table.renderModule();
      renderOperationsCenterMobileView();
      showVerifiedStatusLoggedFeedback();
    } catch (error) {
      if (message) message.textContent = 'Save failed: ' + (error?.message || error);
    } finally {
      verifiedStatusSaving = false;
      if (button) button.disabled = false;
    }
  }

  function closeVerifiedStatusLoggerAfterSave() {
    verifiedStatusSaving = false;
    resetVerifiedStatusDialogState();
    const dialog = document.getElementById('operationsCenterVerifiedStatusDialog');
    if (dialog) dialog.hidden = true;
  }
  window.OperationsCenter.loadModule = loadOperationsCenterModule;
  window.OperationsCenter.initialize = initializeOperationsCenter;
  window.OperationsCenter.render = renderOperationsCenterModule;
  window.OperationsCenter.refreshCanonicalData = refreshOperationsCenterCanonicalData;
  window.OperationsCenter.refreshVerifiedStatuses = refreshOperationsCenterVerifiedStatuses;
  window.OperationsCenter.toggleMobileView = toggleOperationsCenterMobileView;
  window.OperationsCenter.renderMobileView = renderOperationsCenterMobileView;
  window.OperationsCenter.openVerifiedStatusLogger = openVerifiedStatusLogger;
  window.OperationsCenter.filter = filterOperationsCenter;
  window.OperationsCenter.toggleProjectionMode = toggleOperationsCenterProjectionMode;
  window.OperationsCenter.toggleRmaVisibility = toggleOperationsCenterRmaVisibility;
  window.OperationsCenter.updateProjectionSelection = updateOperationsCenterProjectionSelection;
  window.OperationsCenter.refreshSyncOperationsStatus = refreshSyncOperationsStatus;
  window.OperationsCenter.startSyncOperations = startSyncOperations;

  window.loadOperationsCenterModule = loadOperationsCenterModule;
  window.initializeOperationsCenter = initializeOperationsCenter;
  window.renderOperationsCenterModule = renderOperationsCenterModule;
  window.refreshOperationsCenterCanonicalData = refreshOperationsCenterCanonicalData;
  window.refreshOperationsCenterVerifiedStatuses = refreshOperationsCenterVerifiedStatuses;
  window.toggleOperationsCenterMobileView = toggleOperationsCenterMobileView;
  window.filterOperationsCenterMobileView = renderOperationsCenterMobileView;
  window.selectOperationsCenterMobileRecord = selectOperationsCenterMobileRecord;
  window.openOperationsCenterVerifiedStatusLoggerForKey = openVerifiedStatusLoggerForKey;
  window.openOperationsCenterLineVerifiedStatusLogger = openLineVerifiedStatusLogger;
  window.closeOperationsCenterVerifiedStatusLogger = closeVerifiedStatusLogger;
  window.updateOperationsCenterVerifiedStatusDirtyState = updateVerifiedStatusDirtyState;
  window.discardOperationsCenterVerifiedStatusChanges = discardVerifiedStatusChanges;
  window.keepEditingOperationsCenterVerifiedStatus = keepEditingVerifiedStatus;
  window.submitOperationsCenterVerifiedStatus = submitVerifiedStatus;
  window.filterOperationsCenter = filterOperationsCenter;
  window.toggleOperationsCenterProjectionMode = toggleOperationsCenterProjectionMode;
  window.toggleOperationsCenterRmaVisibility = toggleOperationsCenterRmaVisibility;
  window.updateOperationsCenterProjectionSelection = updateOperationsCenterProjectionSelection;
  window.refreshSyncOperationsStatus = refreshSyncOperationsStatus;
  window.startSyncOperations = startSyncOperations;
})();

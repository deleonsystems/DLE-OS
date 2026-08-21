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
  let verifiedStatusSaving = false;
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
      .map(item => syncValue(item, 'id') + ': ' + syncValue(item, 'recordCount')).join(' Â· ');
    root.dataset.status = status.toLowerCase();
    root.innerHTML = '<strong>Sync Operations â€” ' + escapeOptionText(status.replaceAll('_', ' ')) + '</strong>' +
      '<span>' + escapeOptionText(syncValue(state, 'result') || syncValue(state, 'currentStep') || 'No synchronization has run.') + '</span>' +
      '<small>Requested by ' + escapeOptionText(syncValue(state, 'requestedBy') || 'â€”') +
      ' Â· started ' + escapeOptionText(formatSyncDate(syncValue(state, 'startedAtUtc'))) +
      ' Â· elapsed ' + escapeOptionText(syncValue(state, 'elapsedSeconds') ?? 0) + 's' +
      (countSummary ? ' Â· ' + escapeOptionText(countSummary) : '') + '</small>';
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
      hideRmaRework: !!window.OperationsCenter.state.hideRmaRework,
      searchTerms: getMobileSearchTerms()
    }).records;
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
    const records = getMobileRecords().slice(0, 50);
    if (!records.length) {
      results.innerHTML = '<div class="operations-center-empty">No matching Operations Center lines.</div>';
      renderOperationsCenterMobileDetail(null);
      return;
    }
    results.innerHTML = records.map(renderMobileResultCard).join('');
    const selected = records.find(record => window.OperationsCenter.viewModel.getMasterRecordKey(record) === mobileSelectedRecordKey) || records[0];
    renderOperationsCenterMobileDetail(selected);
  }

  function renderMobileResultCard(record) {
    const viewModel = window.OperationsCenter.viewModel;
    const key = viewModel.getMasterRecordKey(record);
    const active = key === mobileSelectedRecordKey ? ' active' : '';
    return '<button type="button" class="operations-center-mobile-card' + active + '" data-master-record-key="' +
      escapeOptionText(key) + '" onclick="selectOperationsCenterMobileRecord(event)">' +
      '<strong>' + escapeOptionText(viewModel.getOfficialField(record, 'customer')) + '</strong>' +
      '<span>SO ' + escapeOptionText(viewModel.getOfficialField(record, 'salesOrder')) +
      ' · Line ' + escapeOptionText(viewModel.getOfficialField(record, 'sequenceLine')) +
      ' · WO ' + escapeOptionText(viewModel.getOfficialField(record, 'workOrder')) + '</span>' +
      '<small>' + escapeOptionText(viewModel.getOfficialField(record, 'partNumber')) + ' · ' +
      escapeOptionText(viewModel.getOfficialField(record, 'description')) + '</small></button>';
  }

  function selectOperationsCenterMobileRecord(event) {
    mobileSelectedRecordKey = event?.currentTarget?.dataset?.masterRecordKey || '';
    renderOperationsCenterMobileView();
  }

  function renderOperationsCenterMobileDetail(record) {
    const detail = document.getElementById('operationsCenterMobileDetail');
    if (!detail) return;
    if (!record) { detail.hidden = true; detail.innerHTML = ''; return; }
    detail.hidden = false;
    mobileSelectedRecordKey = window.OperationsCenter.viewModel.getMasterRecordKey(record);
    const viewModel = window.OperationsCenter.viewModel;
    const status = viewModel.getVerifiedStatusPresentation(record);
    detail.innerHTML = '<div class="operations-center-mobile-detail-card">' +
      '<h3>' + escapeOptionText(viewModel.getOfficialField(record, 'customer')) + '</h3>' +
      '<dl>' +
      mobileFact('Customer P.O.', viewModel.getOfficialField(record, 'customerPo')) +
      mobileFact('Sales Order', viewModel.getOfficialField(record, 'salesOrder') + ' / ' + viewModel.getOfficialField(record, 'sequenceLine')) +
      mobileFact('Work Order', viewModel.getOfficialField(record, 'workOrder')) +
      mobileFact('Item', viewModel.getOfficialField(record, 'partNumber')) +
      mobileFact('Description', viewModel.getOfficialField(record, 'description')) +
      mobileFact('Qty Open', viewModel.getOfficialField(record, 'opQtyOpen')) +
      mobileFact('Due', viewModel.getOfficialField(record, 'dueDate')) +
      mobileFact('Material', viewModel.getOfficialField(record, 'materialStatus')) +
      '</dl>' +
      '<div class="operations-center-mobile-latest"><strong>Last Verified Status</strong><span>' +
      escapeOptionText(status.statusText || 'No status logged yet.') + '</span><small>' +
      escapeOptionText([status.recordedBy, status.timeLabel].filter(Boolean).join(' · ')) + '</small></div>' +
      '<button type="button" class="operations-center-mobile-log-button" onclick="openOperationsCenterVerifiedStatusLoggerForKey()">Log Verified Status</button></div>';
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

  function openVerifiedStatusLogger(record) {
    verifiedStatusDialogRecord = record;
    const dialog = document.getElementById('operationsCenterVerifiedStatusDialog');
    const context = document.getElementById('operationsCenterVerifiedStatusContext');
    const text = document.getElementById('operationsCenterVerifiedStatusText');
    const message = document.getElementById('operationsCenterVerifiedStatusMessage');
    if (!dialog || !context || !text) return;
    const viewModel = window.OperationsCenter.viewModel;
    context.innerHTML = '<strong>' + escapeOptionText(viewModel.getOfficialField(record, 'customer')) + '</strong>' +
      '<span>SO ' + escapeOptionText(viewModel.getOfficialField(record, 'salesOrder')) +
      ' / Line ' + escapeOptionText(viewModel.getOfficialField(record, 'sequenceLine')) +
      ' / WO ' + escapeOptionText(viewModel.getOfficialField(record, 'workOrder')) + '</span>' +
      '<small>' + escapeOptionText(viewModel.getOfficialField(record, 'partNumber')) + ' · ' +
      escapeOptionText(viewModel.getOfficialField(record, 'description')) + '</small>';
    text.value = '';
    if (message) message.textContent = '';
    dialog.hidden = false;
    text.focus();
  }

  function closeVerifiedStatusLogger() {
    if (verifiedStatusSaving) return;
    verifiedStatusDialogRecord = null;
    const dialog = document.getElementById('operationsCenterVerifiedStatusDialog');
    if (dialog) dialog.hidden = true;
  }

  function getCurrentMobileSelectedRecord() {
    return window.OperationsCenter.viewModel.getOperationsCenterRecords()
      .find(record => window.OperationsCenter.viewModel.getMasterRecordKey(record) === mobileSelectedRecordKey) || null;
  }

  function openVerifiedStatusLoggerForKey() {
    const record = getCurrentMobileSelectedRecord();
    if (record) openVerifiedStatusLogger(record);
  }

  async function submitVerifiedStatus(event) {
    event?.preventDefault?.();
    if (verifiedStatusSaving || !verifiedStatusDialogRecord) return;
    const text = document.getElementById('operationsCenterVerifiedStatusText');
    const button = document.getElementById('operationsCenterVerifiedStatusSave');
    const message = document.getElementById('operationsCenterVerifiedStatusMessage');
    const statusText = String(text?.value || '').trim();
    if (!statusText) {
      if (message) message.textContent = 'Last Verified Status is required.';
      return;
    }
    verifiedStatusSaving = true;
    if (button) button.disabled = true;
    if (message) message.textContent = 'Saving...';
    try {
      await window.OperationsCenter.verifiedStatusService.appendForRecord(verifiedStatusDialogRecord, statusText);
      if (message) message.textContent = 'Saved.';
      closeVerifiedStatusLoggerAfterSave();
      window.OperationsCenter.table.renderModule();
      renderOperationsCenterMobileView();
    } catch (error) {
      if (message) message.textContent = 'Save failed: ' + (error?.message || error);
    } finally {
      verifiedStatusSaving = false;
      if (button) button.disabled = false;
    }
  }

  function closeVerifiedStatusLoggerAfterSave() {
    verifiedStatusSaving = false;
    verifiedStatusDialogRecord = null;
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
  window.closeOperationsCenterVerifiedStatusLogger = closeVerifiedStatusLogger;
  window.submitOperationsCenterVerifiedStatus = submitVerifiedStatus;
  window.filterOperationsCenter = filterOperationsCenter;
  window.toggleOperationsCenterProjectionMode = toggleOperationsCenterProjectionMode;
  window.toggleOperationsCenterRmaVisibility = toggleOperationsCenterRmaVisibility;
  window.updateOperationsCenterProjectionSelection = updateOperationsCenterProjectionSelection;
  window.refreshSyncOperationsStatus = refreshSyncOperationsStatus;
  window.startSyncOperations = startSyncOperations;
})();

/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};
  let operationalStateSubscription = null;
  let materialStatusSubscription = null;
  let syncOperationsPollTimer = null;

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
    await window.OperationsCenter.overlayService.initializeOverlay();
    window.OperationsCenter.projection.initialize();
    populateOperationsCenterDocumentTypes();
    window.OperationsCenter.table.updateSaveStatus('No unsaved changes.', 'saved');
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
      stateActions.commitCanonicalLoad(result, requestId);
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      stateActions.failCanonicalLoad(error, requestId);
    }
    window.OperationsCenter.table.renderModule();
    return !window.OperationsCenter.state.canonicalError;
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
    const invoice = syncValue(state, 'invoiceHistory');
    const dailyCounts = syncValue(daily, 'components') || [];
    const countSummary = dailyCounts.filter(item => syncValue(item, 'recordCount') !== null && syncValue(item, 'recordCount') !== undefined)
      .map(item => syncValue(item, 'id') + ': ' + syncValue(item, 'recordCount')).join(' · ');
    const invoiceImport = syncValue(syncValue(invoice, 'details'), 'import');
    const invoiceChanges = syncValue(invoiceImport, 'ChangeCount') ?? syncValue(invoiceImport, 'changeCount');
    root.dataset.status = status.toLowerCase();
    root.innerHTML = '<strong>Sync Operations — ' + escapeOptionText(status.replaceAll('_', ' ')) + '</strong>' +
      '<span>' + escapeOptionText(syncValue(state, 'currentStep') || syncValue(state, 'result') || 'No synchronization has run.') + '</span>' +
      '<small>Requested by ' + escapeOptionText(syncValue(state, 'requestedBy') || '—') +
      ' · started ' + escapeOptionText(formatSyncDate(syncValue(state, 'startedAtUtc'))) +
      ' · elapsed ' + escapeOptionText(syncValue(state, 'elapsedSeconds') ?? 0) + 's' +
      (countSummary ? ' · ' + escapeOptionText(countSummary) : '') +
      (invoiceChanges !== undefined ? ' · invoice changes: ' + escapeOptionText(invoiceChanges) : '') + '</small>';
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
    if (!window.confirm('Start the governed focused synchronization now? This updates Customer Master, Work Orders, Open Sales Orders, relationships, and the 45-day Invoice History window.')) return;
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
  }

  function getSelectedOperationsCenterDocumentType() {
    const selector = document.getElementById('operationsCenterDocumentType');
    return selector?.value || 'kitShort';
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

  function populateOperationsCenterDocumentTypes() {
    const selector = document.getElementById('operationsCenterDocumentType');
    const documentLinks = window.OperationsCenter.documentLinks;
    if (!selector || !documentLinks?.getDocumentTypes) return;

    const selected = selector.value || 'kitShort';
    selector.innerHTML = documentLinks.getDocumentTypes()
      .map(type => '<option value="' + escapeOptionText(type.key) + '">' + escapeOptionText(type.label) + '</option>')
      .join('');

    if (Array.from(selector.options).some(option => option.value === selected)) {
      selector.value = selected;
    }
  }

  function refreshOperationsCenterDocumentStatus() {
    const typeKey = getSelectedOperationsCenterDocumentType();
    const status = document.getElementById('operationsCenterDocumentStatus');
    if (!status) return;
    status.textContent = window.OperationsCenter.documentLinks.getStatus(typeKey);
    status.classList.remove('dirty', 'saved', 'error');
  }

  async function connectOperationsCenterDocumentFolder(typeKey = getSelectedOperationsCenterDocumentType()) {
    try {
      await window.OperationsCenter.documentLinks.connectType(typeKey);
      window.OperationsCenter.table.renderModule();
    } catch (error) {
      window.OperationsCenter.table.updateSaveStatus('Document folder connection failed: ' + (error?.message || error), 'error');
    }
  }

  async function openOperationsCenterDocumentLink(event) {
    const target = event?.currentTarget || event?.target;
    const typeKey = target?.dataset?.documentLinkType || '';
    const workOrder = target?.dataset?.workOrder || '';

    try {
      await window.OperationsCenter.documentLinks.openDocument(typeKey, workOrder);
    } catch (error) {
      window.OperationsCenter.table.updateSaveStatus('Unable to open document: ' + (error?.message || error), 'error');
    }
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

  function updateOperationsCenterOverlayField(event) {
    window.OperationsCenter.table.updateOverlayField(event);
  }

  async function saveOperationsCenterOverlay() {
    const state = window.OperationsCenter.state;
    if (!state.dirty) {
      window.OperationsCenter.table.updateSaveStatus('No unsaved changes.', 'saved');
      return;
    }

    const saveButton = document.getElementById('operationsCenterSaveButton');
    if (saveButton) saveButton.disabled = true;
    window.OperationsCenter.table.updateSaveStatus('Saving Operations Overlay...', '');

    try {
      const dataset = await window.OperationsCenter.overlayService.saveOverlay();
      window.OperationsCenter.table.updateSaveStatus(
        'Operations Overlay saved. ' + dataset.recordCount + ' record' + (dataset.recordCount === 1 ? '' : 's') + '.',
        'saved'
      );
      window.OperationsCenter.table.renderModule();
    } catch (error) {
      state.dirty = true;
      window.OperationsCenter.table.updateSaveStatus('Operations Overlay save failed: ' + (error?.message || error), 'error');
      throw error;
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  window.OperationsCenter.loadModule = loadOperationsCenterModule;
  window.OperationsCenter.initialize = initializeOperationsCenter;
  window.OperationsCenter.render = renderOperationsCenterModule;
  window.OperationsCenter.refreshCanonicalData = refreshOperationsCenterCanonicalData;
  window.OperationsCenter.filter = filterOperationsCenter;
  window.OperationsCenter.connectDocumentFolder = connectOperationsCenterDocumentFolder;
  window.OperationsCenter.openDocumentLink = openOperationsCenterDocumentLink;
  window.OperationsCenter.populateDocumentTypes = populateOperationsCenterDocumentTypes;
  window.OperationsCenter.refreshDocumentStatus = refreshOperationsCenterDocumentStatus;
  window.OperationsCenter.toggleProjectionMode = toggleOperationsCenterProjectionMode;
  window.OperationsCenter.toggleRmaVisibility = toggleOperationsCenterRmaVisibility;
  window.OperationsCenter.updateProjectionSelection = updateOperationsCenterProjectionSelection;
  window.OperationsCenter.updateOverlayField = updateOperationsCenterOverlayField;
  window.OperationsCenter.saveOverlay = saveOperationsCenterOverlay;
  window.OperationsCenter.refreshSyncOperationsStatus = refreshSyncOperationsStatus;
  window.OperationsCenter.startSyncOperations = startSyncOperations;

  window.loadOperationsCenterModule = loadOperationsCenterModule;
  window.initializeOperationsCenter = initializeOperationsCenter;
  window.renderOperationsCenterModule = renderOperationsCenterModule;
  window.refreshOperationsCenterCanonicalData = refreshOperationsCenterCanonicalData;
  window.filterOperationsCenter = filterOperationsCenter;
  window.connectOperationsCenterDocumentFolder = connectOperationsCenterDocumentFolder;
  window.openOperationsCenterDocumentLink = openOperationsCenterDocumentLink;
  window.populateOperationsCenterDocumentTypes = populateOperationsCenterDocumentTypes;
  window.refreshOperationsCenterDocumentStatus = refreshOperationsCenterDocumentStatus;
  window.toggleOperationsCenterProjectionMode = toggleOperationsCenterProjectionMode;
  window.toggleOperationsCenterRmaVisibility = toggleOperationsCenterRmaVisibility;
  window.updateOperationsCenterProjectionSelection = updateOperationsCenterProjectionSelection;
  window.updateOperationsCenterOverlayField = updateOperationsCenterOverlayField;
  window.saveOperationsCenterOverlay = saveOperationsCenterOverlay;
  window.refreshSyncOperationsStatus = refreshSyncOperationsStatus;
  window.startSyncOperations = startSyncOperations;
})();

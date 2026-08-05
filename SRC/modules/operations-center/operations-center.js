/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};
  let operationalStateSubscription = null;

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
    await window.OperationsCenter.overlayService.initializeOverlay();
    window.OperationsCenter.projection.initialize();
    populateOperationsCenterDocumentTypes();
    window.OperationsCenter.table.updateSaveStatus('No unsaved changes.', 'saved');
    await refreshOperationsCenterCanonicalData();
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
})();

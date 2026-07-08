/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

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
    await window.OperationsCenter.overlayService.initializeOverlay();
    window.OperationsCenter.table.updateSaveStatus('No unsaved changes.', 'saved');
    window.OperationsCenter.table.renderModule();
  }

  function renderOperationsCenterModule() {
    window.OperationsCenter.table.renderModule();
  }

  function filterOperationsCenter() {
    window.OperationsCenter.table.filter();
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
  window.OperationsCenter.filter = filterOperationsCenter;
  window.OperationsCenter.updateOverlayField = updateOperationsCenterOverlayField;
  window.OperationsCenter.saveOverlay = saveOperationsCenterOverlay;

  window.loadOperationsCenterModule = loadOperationsCenterModule;
  window.initializeOperationsCenter = initializeOperationsCenter;
  window.renderOperationsCenterModule = renderOperationsCenterModule;
  window.filterOperationsCenter = filterOperationsCenter;
  window.updateOperationsCenterOverlayField = updateOperationsCenterOverlayField;
  window.saveOperationsCenterOverlay = saveOperationsCenterOverlay;
})();

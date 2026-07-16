/* -----------------------------------------------------
   530 - JS: RECONCILIATION WORKSPACE LOADER
----------------------------------------------------- */

(function () {
  'use strict';

  async function loadSystemCenterReconciliationWorkspace() {
    const placeholder = document.getElementById('reconciliationWorkspace');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/system-center/reconciliation/reconciliation.html');
    if (!response.ok) {
      throw new Error('Unable to load Reconciliation workspace.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;
  }

  function refreshReconciliationWorkspaceContext() {
    if (typeof renderMasterDataDashboardStatus === 'function') {
      renderMasterDataDashboardStatus();
    }
    if (typeof renderErpImportDashboardStatus === 'function') {
      renderErpImportDashboardStatus();
    }
    if (typeof renderReconciliationDashboardStatus === 'function') {
      renderReconciliationDashboardStatus();
    }

    const masterSource = document.getElementById('masterDataDashboardStatus');
    const masterTarget = document.getElementById('reconciliationMasterDataContext');
    if (masterSource && masterTarget) {
      masterTarget.innerHTML = masterSource.innerHTML;
    }

  }

  function openReconciliationWorkspace() {
    refreshReconciliationWorkspaceContext();
    if (typeof go === 'function') {
      go('reconciliationWorkspace');
    }
  }

  window.loadSystemCenterReconciliationWorkspace = loadSystemCenterReconciliationWorkspace;
  window.refreshReconciliationWorkspaceContext = refreshReconciliationWorkspaceContext;
  window.openReconciliationWorkspace = openReconciliationWorkspace;
})();

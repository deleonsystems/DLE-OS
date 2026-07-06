(function () {
  'use strict';

  async function loadSystemCenterModule() {
    const placeholder = document.getElementById('systemCenter');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/system-center/system-center.html');
    if (!response.ok) {
      throw new Error('Unable to load System Center module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;

    if (typeof loadSystemCenterReconciliationWorkspace === 'function') {
      await loadSystemCenterReconciliationWorkspace();
    }
  }

  window.loadSystemCenterModule = loadSystemCenterModule;
})();

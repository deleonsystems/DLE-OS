(function receivingPrintPreview(window, document) {
  'use strict';

  function requestFor(search) {
    const query = new URLSearchParams(search), kind = query.get('kind'), id = (query.get('id') || '').trim();
    if (!id || id.length > 200 || !['po', 'label'].includes(kind)) throw new Error('Choose a saved PO or accepted material record to print.');
    return kind === 'po'
      ? { endpoint: '/api/sim/receiving/po/' + encodeURIComponent(id), renderer: 'PurchasingPoDocument' }
      : { endpoint: '/api/sim/receiving/accepted-material/' + encodeURIComponent(id), renderer: 'ReceivingAcceptedMaterialLabel' };
  }

  async function load() {
    try {
      const request = requestFor(window.location.search);
      const response = await window.fetch(request.endpoint, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('The saved record could not be opened (' + response.status + '). Unlock SIM and open the preview again.');
      if (!(response.headers?.get?.('content-type') || '').includes('json')) throw new Error('Unlock SIM and open the preview again.');
      const record = await response.json(), renderer = window[request.renderer];
      if (typeof renderer?.printDocument !== 'function') throw new Error('The print renderer could not be loaded. Refresh this preview.');
      const html = renderer.printDocument(record);
      // Keep the real, reloadable same-origin preview URL while rendering the existing
      // pure document. Its only print action invokes the browser's print dialog.
      document.open(); document.write(html); document.close();
      return html;
    } catch (error) {
      const status = document.getElementById('preview-status');
      if (status) { status.textContent = error.message || 'Print preview unavailable. Saved Receiving evidence is unchanged.'; status.setAttribute('role', 'alert'); }
      return null;
    }
  }
  window.DleReceivingPrintPreview = Object.freeze({ requestFor, load });
  void load();
})(window, document);

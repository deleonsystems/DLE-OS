(function (window) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function open(host, intakeId) {
    // Each mounted instance is bound to one existing Intake, never the wizard's draft.
    let record = null, busy = true, message = 'Loading Intake documents…';
    const canAttach = () => window.DleOsCapabilities?.can?.('rfq.intake.create') === true;
    function draw() {
      host.innerHTML = '<section class="intake-owned-documents" aria-label="Intake Documents"><h2>Intake Documents</h2><p><strong>Owned by Intake</strong> · Commercial source documents</p>' +
        (record ? '<div class="intake-document-identity"><strong>' + esc(record.intakeId) + ' · ' + esc(record.customer?.customerName) + '</strong><p>' +
          (record.assemblies || []).map(a => esc(a.assemblyNumber) + ' / Rev ' + esc(a.revision)).join('<br>') + '</p></div><h3>Customer Request Documents</h3><ul>' +
          (record.customerRequestDocuments || []).map(a => '<li><a target="_blank" rel="noopener noreferrer" href="/api/sim/rfq-intakes/' + encodeURIComponent(intakeId) + '/customer-request-documents/' + encodeURIComponent(a.document.documentId) + '">' + esc(a.document.name) + '</a> · Customer RFQ / Request · ' + esc(a.addedBy) + '</li>').join('') +
          '</ul>' + (!(record.customerRequestDocuments || []).length ? '<p>No customer request documents attached.</p>' : '') +
          (canAttach() ? '<form data-customer-request-upload><label>Customer RFQ / Request <input name="file" type="file" required ' + (busy ? 'disabled' : '') + '></label><button type="submit" ' + (busy ? 'disabled' : '') + '>Add Customer RFQ / Request</button></form>' : '<p>Read-only. Adding documents requires Intake creation permission.</p>') : '') +
        '<p role="status">' + esc(message) + '</p></section>';
    }
    host.onsubmit = async event => {
      const form = event.target.closest('[data-customer-request-upload]');
      if (!form) return;
      event.preventDefault(); event.stopPropagation();
      if (busy || !record || !canAttach()) return;
      const file = form.elements.file.files[0];
      if (!file) return;
      if (!file.size || file.size > 20 * 1024 * 1024) { message = 'Choose a nonempty file up to 20 MB.'; draw(); return; }
      busy = true; message = 'Saving verified customer request…'; draw();
      try {
        const response = await window.fetch('/api/sim/rfq-intakes/' + encodeURIComponent(intakeId) + '/customer-request-documents?name=' + encodeURIComponent(file.name) + '&lastModified=' + file.lastModified,
          {method:'POST',credentials:'include',headers:{'Content-Type':'application/octet-stream','X-SIM-Document-Upload':'1'},body:file});
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Unable to attach the customer request.');
        if (result.record?.intakeId !== intakeId) throw new Error('Unexpected intake response. Reopen Intake Documents.');
        record = result.record;
        message = result.duplicate ? 'Already attached; existing document preserved.' : 'Customer request attached to Intake. Technical Review is unchanged.';
      } catch (e) { message = e.message; }
      finally { busy = false; draw(); }
    };
    draw();
    try {
      const response = await window.fetch('/api/sim/rfq-intakes/' + encodeURIComponent(intakeId), {credentials:'include',cache:'no-store'});
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to open this intake.');
      if (result.intakeId !== intakeId || result.intakeType !== 'NEW_QUOTE_REQUEST') throw new Error('Select an existing New Quote Request intake.');
      record = result; message = 'Verify the intake identity before adding a document. Technical Review can view these documents read-only.';
    } catch (e) { message = e.message; }
    finally { busy = false; draw(); }
  }
  window.DleCustomerRequestDocuments = Object.freeze({open});
})(window);

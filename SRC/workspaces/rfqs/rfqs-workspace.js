(function (window, document) {
  'use strict';
  const labels = { NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', COMPLETE: 'Complete', READY_TO_WORK: 'Ready to Work', READY_FOR_QUOTE_ASSEMBLY: 'Ready for Quote Assembly' };
  let returnIntakeId = null;
  let mount, items = [], selected = null, opened = null, saving = false, error = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(url, options) {
    const response = await window.fetch(url, { credentials: 'include', cache: 'no-store', ...options });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'RFQs could not be loaded.');
    return body;
  }
  async function refresh() {
    try { items = (await request('/api/sim/rfqs')).items; selected = items.find(r => r.intakeId === (returnIntakeId || selected?.intakeId)) || null; returnIntakeId = null; error = ''; }
    catch (e) { error = e.message; }
    draw();
  }
  async function openMaterials() {
    try {
      if (!window.DleMaterialsWorkbench) {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'SRC/workspaces/rfqs/materials-workbench.css'; document.head.appendChild(link);
        await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'SRC/workspaces/rfqs/materials-workbench.js'; script.onload = resolve; script.onerror = () => reject(new Error('Materials could not load.')); document.head.appendChild(script); });
      }
      await window.DleMaterialsWorkbench.open(mount, selected, async () => { opened = null; await refresh(); });
    } catch (e) { error = e.message; draw(); }
  }
  async function render() {
    mount = document.querySelector('[data-workspace-mount="rfqs"]');
    if (!mount) return;
    if (document.body.dataset.simRuntime !== 'true') { mount.textContent = 'RFQs is available in SIM only.'; return; }
    selected = null; opened = null;
    mount.onclick = async event => {
      const button = event.target.closest('button'); if (!button || saving) return;
      if (button.dataset.rfq) { selected = items.find(r => r.intakeId === button.dataset.rfq); opened = null; draw(); }
      if (button.dataset.open === 'materials') { await openMaterials(); return; }
      if (button.dataset.open === 'labor') { opened = 'labor'; draw(); }
      if (button.dataset.action === 'queue') { selected = null; opened = null; await refresh(); }
      if (button.dataset.action === 'refresh') await refresh();
      if (button.dataset.action === 'source') {
        const id = selected.intakeId;
        window.DleWorkspaceShell.navigate({ workspaceId: 'technical-review' });
        // Navigation can lazy-load the destination; wait until its template is ready.
        for (let attempt = 0; attempt < 100; attempt++) {
          const review = window.DleWorkspaces['technical-review'];
          if (review && document.querySelector('[data-workspace-mount="technical-review"]')?.dataset.workspaceLoaded === 'true') {
            await review.openReview(id); break;
          }
          await new Promise(resolve => window.setTimeout(resolve, 50));
        }
      }
      if (button.dataset.save) {
        const lane = button.dataset.save, status = mount.querySelector('[data-status="' + lane + '"]').value;
        saving = true; error = ''; draw();
        try { selected = await request('/api/sim/rfqs/' + encodeURIComponent(selected.intakeId) + '/lanes/' + lane, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({status}) }); }
        catch (e) { error = e.message; }
        finally { saving = false; draw(); }
      }
    };
    await refresh();
  }
  function context(r) { return r.assemblies.map(a => esc(a.assemblyNumber) + ' · Rev ' + esc(a.revision) + ' · Qty ' + esc(a.quantity)).join('<br>'); }
  function lane(name) {
    const key = name.toLowerCase(), value = selected.lanes[key];
    if (key === 'materials') return '<section class="rfqs-lane"><h2>Materials</h2><p class="rfqs-status">' + labels[value.status] + '</p><p>Accepted BOM v' + selected.inputs.materials.version + ' · ' + selected.inputs.materials.candidate.rows.length + ' rows</p><button data-open="materials">Open Materials</button><p>Save and complete the quotation in Materials.</p></section>';
    const disabled = saving || window.DleOsCapabilities?.can?.('technical_review.disposition') !== true;
    return '<section class="rfqs-lane"><h2>' + name + '</h2><p class="rfqs-status">' + labels[value.status] + '</p><p>' + (key === 'materials' ? 'Accepted BOM v' + selected.inputs.materials.version + ' · ' + selected.inputs.materials.candidate.rows.length + ' rows' : 'Manufacturing Definition available') + '</p><button data-open="' + key + '">Open ' + name + '</button><div class="rfqs-controls"><label>' + name + ' status <select data-status="' + key + '" ' + (disabled ? 'disabled' : '') + '>' + ['NOT_STARTED','IN_PROGRESS','COMPLETE'].map(s => '<option value="' + s + '" ' + (s === value.status ? 'selected' : '') + '>' + labels[s] + '</option>').join('') + '</select></label><button data-save="' + key + '" ' + (disabled ? 'disabled' : '') + '>Save ' + name + ' status</button></div>' + (value.updatedAtUtc ? '<small>Updated by ' + esc(value.updatedBy) + ' · ' + esc(new Date(value.updatedAtUtc).toLocaleString()) + '</small>' : '') + '</section>';
  }
  function documentLinks(pkg) {
    return '<ul>' + pkg.documents.map(d => '<li>' + esc(d.role) + ' · ' + esc(d.documentType) + ' · <a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/' + encodeURIComponent(selected.intakeId) + '/documents/' + encodeURIComponent(d.documentId) + '">' + esc(d.name) + '</a></li>').join('') + '</ul>';
  }
  function inputView() {
    if (!opened) return '';
    if (opened === 'labor') {
      const m = selected.inputs.manufacturing;
      return '<section class="rfqs-input"><h2>Labor — trusted input</h2><p>Manufacturing Definition · ' + esc(m.id) + '</p><p>Governing document: ' + esc(m.governingDocumentId) + '</p><p>Reviewed by ' + esc(m.reviewer) + ' · ' + esc(m.atUtc) + '</p>' + documentLinks(m.package) + '<p>Read-only input. Labor Worksheet is not part of this phase.</p></section>';
    }
    return '';
  }
  function draw() {
    mount.innerHTML = '<section class="rfqs-workspace"><header><h1>RFQs</h1><button data-action="refresh" ' + (saving ? 'disabled' : '') + '>Refresh</button></header>' + (error ? '<p role="alert">' + esc(error) + '</p>' : '') + (selected ? '<button data-action="queue">← RFQ queue</button><div class="rfqs-context"><h2>' + esc(selected.customer.customerName) + '</h2><p>' + context(selected) + '</p><p>Scope: ' + esc(selected.scope.replaceAll('_',' ')) + '</p><strong>' + labels[selected.status] + '</strong><p>Source Technical Review: <button data-action="source">' + 'View Technical Review' + '</button> · ' + esc(selected.intakeId) + '</p></div><div class="rfqs-lanes">' + lane('Materials') + lane('Labor') + '</div>' + inputView() : '<p>Technically qualified RFQs ready for shared Materials and Labor work.</p>' + (items.length ? '<div class="rfqs-scroll"><table><thead><tr>' + ['RFQ / source review','Customer','Assembly','Revision','Qty','Materials Status','Labor Status','Overall RFQ Status'].map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + items.map(r => '<tr><td><button data-rfq="' + esc(r.intakeId) + '">' + esc(r.intakeId) + '</button></td><td>' + esc(r.customer.customerName) + '</td><td>' + r.assemblies.map(a => esc(a.assemblyNumber)).join('<br>') + '</td><td>' + r.assemblies.map(a => esc(a.revision)).join('<br>') + '</td><td>' + r.assemblies.map(a => esc(a.quantity)).join('<br>') + '</td><td>' + labels[r.lanes.materials.status] + '</td><td>' + labels[r.lanes.labor.status] + '</td><td>' + labels[r.status] + '</td></tr>').join('') + '</tbody></table></div>' : '<p>No RFQs have completed both required Technical Review inputs yet.</p>')) + '</section>';
  }
  window.DleWorkspaces = window.DleWorkspaces || {};
  document.addEventListener('dle:workspace-navigation', event => {
    if (event.detail?.workspace?.id === 'rfqs' && event.detail?.requestedState?.intakeId) returnIntakeId = event.detail.requestedState.intakeId;
  });
  window.DleWorkspaces.rfqs = Object.freeze({id:'rfqs', render, refresh});
})(window, document);

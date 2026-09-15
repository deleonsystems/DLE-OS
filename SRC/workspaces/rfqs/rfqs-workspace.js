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
  async function openLabor() {
    try {
      if (!window.DleLaborWorkbench) {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'SRC/workspaces/rfqs/labor-workbench.css'; document.head.appendChild(link);
        await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'SRC/workspaces/rfqs/labor-workbench.js'; script.onload = resolve; script.onerror = () => reject(new Error('Labor could not load.')); document.head.appendChild(script); });
      }
      await window.DleLaborWorkbench.open(mount, selected, async () => { opened = null; await refresh(); });
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
      if (button.dataset.open === 'labor') { await openLabor(); return; }
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
    };
    await refresh();
  }
  function context(r) { return r.assemblies.map(a => esc(a.assemblyNumber) + ' · Rev ' + esc(a.revision) + ' · Qty ' + esc(a.quantity)).join('<br>'); }
  function lane(name) {
    const key = name.toLowerCase(), value = selected.lanes[key];
    if (key === 'materials') return '<section class="rfqs-lane"><h2>Materials</h2><p class="rfqs-status">' + labels[value.status] + '</p><p>Accepted BOM v' + selected.inputs.materials.version + ' · ' + selected.inputs.materials.candidate.rows.length + ' rows</p><button data-open="materials">Open Materials</button><p>Save and complete the quotation in Materials.</p></section>';
    return '<section class="rfqs-lane"><h2>Labor</h2><p class="rfqs-status">' + labels[value.status] + '</p><p>Manufacturing Definition available</p><button data-open="labor">Open Labor</button><p>Save and complete the quotation in Labor.</p></section>';
  }
  function draw() {
    mount.innerHTML = '<section class="rfqs-workspace"><header><h1>RFQs</h1><button data-action="refresh" ' + (saving ? 'disabled' : '') + '>Refresh</button></header>' + (error ? '<p role="alert">' + esc(error) + '</p>' : '') + (selected ? '<button data-action="queue">← RFQ queue</button><div class="rfqs-context"><h2>' + esc(selected.customer.customerName) + '</h2><p>' + context(selected) + '</p><p>Scope: ' + esc(selected.scope.replaceAll('_',' ')) + '</p><strong>' + labels[selected.status] + '</strong><p>Source Technical Review: <button data-action="source">' + 'View Technical Review' + '</button> · ' + esc(selected.intakeId) + '</p></div><div class="rfqs-lanes">' + lane('Materials') + lane('Labor') + '</div>' : '<p>Technically qualified RFQs ready for shared Materials and Labor work.</p>' + (items.length ? '<div class="rfqs-scroll"><table><thead><tr>' + ['RFQ / source review','Customer','Assembly','Revision','Qty','Materials Status','Labor Status','Overall RFQ Status'].map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + items.map(r => '<tr><td><button data-rfq="' + esc(r.intakeId) + '">' + esc(r.intakeId) + '</button></td><td>' + esc(r.customer.customerName) + '</td><td>' + r.assemblies.map(a => esc(a.assemblyNumber)).join('<br>') + '</td><td>' + r.assemblies.map(a => esc(a.revision)).join('<br>') + '</td><td>' + r.assemblies.map(a => esc(a.quantity)).join('<br>') + '</td><td>' + labels[r.lanes.materials.status] + '</td><td>' + labels[r.lanes.labor.status] + '</td><td>' + labels[r.status] + '</td></tr>').join('') + '</tbody></table></div>' : '<p>No RFQs have completed both required Technical Review inputs yet.</p>')) + '</section>';
  }
  window.DleWorkspaces = window.DleWorkspaces || {};
  document.addEventListener('dle:workspace-navigation', event => {
    if (event.detail?.workspace?.id === 'rfqs' && event.detail?.requestedState?.intakeId) returnIntakeId = event.detail.requestedState.intakeId;
  });
  window.DleWorkspaces.rfqs = Object.freeze({id:'rfqs', render, refresh});
})(window, document);

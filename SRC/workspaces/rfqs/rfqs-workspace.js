(function (window, document) {
  'use strict';
  const labels = { QUOTE_APPROVED: 'Quote Approved', NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', COMPLETE: 'Complete', READY_TO_WORK: 'Ready to Work', READY_FOR_QUOTE_ASSEMBLY: 'Ready for Quote Assembly' };
  let returnIntakeId = null;
  let mount, items = [], selected = null, opened = null, saving = false, error = '', bucket = 'ACTIVE', pendingCommercial = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(url, options) {
    const response = await window.fetch(url, { credentials: 'include', cache: 'no-store', ...options });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'RFQs could not be loaded.');
    return body;
  }
  async function selectItem(id) {
    selected=items.find(r=>r.intakeId===id)||null;
    if(!selected)return;
    const review=await request('/api/sim/rfqs/'+encodeURIComponent(id)+'/final-review');
    selected={...selected,approvals:review.approvals,approvalCurrent:review.approvalCurrent};
    if(selected.workbenchEligible){const workspace=(await request('/api/sim/rfqs')).items.find(r=>r.intakeId===id);if(workspace)selected={...selected,lanes:workspace.lanes,inputs:workspace.inputs};else selected.workbenchEligible=false;}
  }
  async function refresh() {
    try { const id=returnIntakeId||selected?.intakeId;items=(await request('/api/sim/rfqs/commercial')).items;await selectItem(id);returnIntakeId=null;error=''; }
    catch(e){error=e.message;}
    draw();
  }
  async function commercialAction(action){
    if(window.DleOsCapabilities?.can?.('technical_review.disposition')!==true)return;
    const c=selected.commercial, approval=action==='SUBMIT'?selected.approvals.at(-1):null;
    const payload={expectedRevision:c.revision,action,approvalId:approval?.id||c.approvalId,approvalVersion:approval?.version||c.approvalVersion,reason:action==='SUBMIT'?'Explicit commercial submission; no customer communication sent.':'Quote validity elapsed'};
    const key=selected.intakeId+JSON.stringify(payload);
    if(pendingCommercial?.key!==key)pendingCommercial={key,request:{...payload,requestId:window.crypto.randomUUID()}};
    saving=true;error='';draw();
    try{await request('/api/sim/rfqs/'+encodeURIComponent(selected.intakeId)+'/commercial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pendingCommercial.request)});pendingCommercial=null;await refresh();}
    catch(e){error=e.message;}finally{saving=false;draw();}
  }
  let intakeDocumentsLoading;
  async function openIntakeDocuments() {
    const id = selected?.intakeId;
    if (!id) return;
    try {
      if (!window.DleCustomerRequestDocuments) {
        intakeDocumentsLoading ||= new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'SRC/modules/rfq-workspace/customer-request-documents.js';
          script.onload = resolve;
          script.onerror = () => { intakeDocumentsLoading = null; script.remove(); reject(new Error('Intake Documents could not load. Retry.')); };
          document.head.appendChild(script);
        });
        await intakeDocumentsLoading;
      }
      if (selected?.intakeId !== id) return;
      const host = mount.querySelector('[data-intake-documents-host]');
      if (host) await window.DleCustomerRequestDocuments.open(host, id);
    } catch (e) { error = e.message; draw(); }
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
  async function openFinalReview() {
    try {
      if (!window.DleQuotationFinalReview) {
        const link=document.createElement('link');link.rel='stylesheet';link.href='SRC/workspaces/rfqs/quotation-final-review.css';document.head.appendChild(link);
        await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/rfqs/quotation-final-review.js';script.onload=resolve;script.onerror=()=>reject(new Error('Final Review could not load.'));document.head.appendChild(script);});
      }
      await window.DleQuotationFinalReview.open(mount,selected,async()=>{opened=null;await refresh();});
    }catch(e){error=e.message;draw();}
  }
  async function render() {
    mount = document.querySelector('[data-workspace-mount="rfqs"]');
    if (!mount) return;
    if (document.body.dataset.simRuntime !== 'true') { mount.textContent = 'RFQs is available in SIM only.'; return; }
    selected = null; opened = null; bucket = 'ACTIVE';
    mount.onclick = async event => {
      const button = event.target.closest('button'); if (!button || saving) return;
      if(button.dataset.bucket){bucket=button.dataset.bucket;selected=null;draw();return;}
      if(button.dataset.rfq){try{await selectItem(button.dataset.rfq);error='';}catch(e){error=e.message;}opened=null;draw();return;}
      if(button.dataset.commercial){await commercialAction(button.dataset.commercial);return;}
      if (button.dataset.open === 'intake-documents') { await openIntakeDocuments(); return; }
      if (button.dataset.open === 'materials') { await openMaterials(); return; }
      if (button.dataset.open === 'final-review') { await openFinalReview(); return; }
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
  const money=v=>v==null?'—':Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const date=v=>v?new Date(v).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'}):'—';
  function commercialDetail(r){
    const c=r.commercial, latest=r.approvals?.at(-1), readonly=window.DleOsCapabilities?.can?.('technical_review.disposition')!==true;
    const canSubmit=r.approvalCurrent&&latest&&latest.id!==c.approvalId&&['OPEN','SUBMITTED','EXPIRED'].includes(c.status);
    return '<section class="rfq-commercial-detail"><h2>Commercial Lifecycle</h2><p><strong>'+esc(r.status)+'</strong> · '+esc(r.quoteNumber||'No approved quotation')+' · '+money(r.quoteTotal)+'</p><p>Approved: '+date(r.approvedAt)+' · Submitted: '+date(c.submittedAt)+' · Expires: '+date(c.expiresAt)+' (Pacific time)</p>'+ (r.revisionNeeded?'<p role="alert">Revision needed. Submitted quotation remains unchanged. Current work: '+esc(r.workStatus)+'.</p>':'')+(canSubmit?'<button data-commercial="SUBMIT" '+(readonly||saving?'disabled':'')+'>Mark Approved Quote Submitted</button><small>Records commercial submission and 30-day validity. Does not send customer communication.</small>':'')+(c.status==='SUBMITTED'&&r.status==='Expired'?'<button data-commercial="EXPIRE" '+(readonly||saving?'disabled':'')+'>Record Expiration</button>':'')+(c.closedAt?'<p>Closed: '+date(c.closedAt)+' · '+esc(c.closeReason)+'</p>':'')+(c.status==='AWARDED'&&!c.orderLinks?.length?'<p>Order handoff pending</p>':'')+'<details><summary>Lifecycle history ('+(c.history||[]).length+')</summary><ul>'+(c.history||[]).map(h=>'<li>'+esc(h.action)+' · '+esc(h.at)+' · '+esc(h.actor)+' · '+esc(h.reason)+'</li>').join('')+'</ul></details><details><summary>Approval history ('+(r.approvals||[]).length+')</summary><ul>'+(r.approvals||[]).map(a=>'<li>Version '+a.version+' · '+esc(a.id)+' · '+date(a.approvedAt)+' · '+money(a.summary.quoteTotal)+'</li>').join('')+'</ul></details><details><summary>Order links ('+(c.orderLinks||[]).length+')</summary><ul>'+(c.orderLinks||[]).map(l=>'<li>'+esc(l.quoteNumber)+' · New Order: '+esc(l.newOrderIntakeId||'Pending')+' · SO: '+esc(l.salesOrderId||'Pending')+' · WO: '+esc(l.workOrderId||'Pending')+'</li>').join('')+'</ul></details></section>';
  }
  function draw(){
    const rows=items.filter(r=>r.bucket===bucket);
    const toggles='<div class="rfq-lifecycle-tabs" role="group" aria-label="RFQ lifecycle">'+['ACTIVE','SUBMITTED','HISTORY'].map(b=>'<button data-bucket="'+b+'" aria-pressed="'+(bucket===b)+'" class="'+(bucket===b?'active':'')+'">'+b+' <span>'+items.filter(r=>r.bucket===b).length+'</span></button>').join('')+'</div>';
    const table='<div class="rfqs-scroll"><table><thead><tr>'+['RFQ / Quote Number','Customer','Assembly / Rev','Qty','Quote Total','Submitted','Expires','Status'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr><td><button data-rfq="'+esc(r.intakeId)+'">'+esc(r.intakeId)+'</button><br>'+esc(r.quoteNumber||'—')+'</td><td>'+esc(r.customer.customerName)+'</td><td>'+r.assemblies.map(a=>esc(a.assemblyNumber)+' / '+esc(a.revision)).join('<br>')+'</td><td>'+r.assemblies.map(a=>a.quantity).join('<br>')+'</td><td>'+money(r.quoteTotal)+'</td><td>'+date(r.commercial.submittedAt)+'</td><td>'+date(r.commercial.expiresAt)+'</td><td>'+esc(r.status)+(r.revisionNeeded?'<br><small>Revision needed</small>':'')+'</td></tr>').join('')+'</tbody></table></div>';
    const detail=selected?'<button data-action="queue">← RFQ queue</button><div class="rfqs-context"><h2>'+esc(selected.customer.customerName)+'</h2><p>'+context(selected)+'</p><p>Intake: '+esc(selected.intakeId)+' · '+esc(selected.intakeStatus)+' · Created '+date(selected.createdAt)+'</p><p>Scope: '+esc(selected.scope.replaceAll('_',' '))+'</p><button data-action="source">View Intake / Technical Review</button><button data-open="intake-documents">Intake Documents</button></div><div data-intake-documents-host></div>'+commercialDetail(selected)+(selected.workbenchEligible&&selected.inputs?'<div class="rfqs-lanes">'+lane('Materials')+lane('Labor')+'</div><button data-open="final-review">Quotation Final Review</button>':'<p>Materials and Labor become available after Technical Review qualification.</p>'):toggles+(rows.length?table:'<p>No '+bucket.toLowerCase()+' RFQs.</p>');
    mount.innerHTML='<section class="rfqs-workspace"><header><h1>RFQs</h1><button data-action="refresh" '+(saving?'disabled':'')+'>Refresh</button></header>'+(error?'<p role="alert">'+esc(error)+'</p>':'')+detail+'</section>';
  }
  window.DleWorkspaces = window.DleWorkspaces || {};
  document.addEventListener('dle:workspace-navigation', event => {
    if (event.detail?.workspace?.id === 'rfqs' && event.detail?.requestedState?.intakeId) returnIntakeId = event.detail.requestedState.intakeId;
  });
  window.DleWorkspaces.rfqs = Object.freeze({id:'rfqs', render, refresh});
})(window, document);

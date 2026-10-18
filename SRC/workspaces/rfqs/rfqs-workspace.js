(function (window, document) {
  'use strict';
  const labels = { QUOTE_APPROVED: 'Quote Approved', NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', COMPLETE: 'Complete', READY_TO_WORK: 'Ready to Work', READY_FOR_QUOTE_ASSEMBLY: 'Ready for Quote Assembly' };
  let returnIntakeId = null;
  const mobileOverview = () => document.body?.dataset?.simRuntime === 'true' && document.body?.dataset?.viewMode === 'mobile';
  const desktopOnly = () => mobileOverview() ? ' disabled aria-describedby="rfqsMobileScope"' : '';
  function syncMobileBoundary() {
    if (!mount || document.body.dataset.workspaceView !== 'rfqs') return;
    const overview = mount.querySelector('.rfqs-overview');
    const blocked = mobileOverview() && !overview && !!mount.querySelector('.rfqs-workspace') && !mount.querySelector('.labor-workbench');
    document.body.dataset.rfqsMobileWorkbench = String(blocked);
    mount.querySelector('[data-rfqs-mobile-boundary]')?.remove();
    if (overview) {
      overview.querySelectorAll('[data-open="materials"],[data-open="final-review"]').forEach(button => { button.disabled = mobileOverview(); });
      const scope = overview.querySelector('#rfqsMobileScope');
      if (scope) scope.hidden = !mobileOverview();
      return;
    }
    if (!blocked) return;
    const notice = document.createElement('section');
    notice.className = 'rfqs-mobile-boundary';
    notice.dataset.rfqsMobileBoundary = 'true';
    notice.innerHTML = '<h2>Continue in Desktop View</h2><p>Materials and Quotation Final Review require Desktop View. Your open work is preserved.</p><button type="button">Return to Desktop View</button>';
    notice.querySelector('button').onclick = event => { event.stopPropagation(); window.DleOperatorHeader.setViewMode('desktop'); };
    mount.prepend(notice);
  }

  let mount, items = [], selected = null, opened = null, saving = false, error = '', bucket = 'ACTIVE', pendingCommercial = null, historySearch = '';
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
    selected={...selected,approvals:review.approvals,approvalCurrent:review.approvalCurrent,reviewSummary:review.summary,reviewBlockers:review.blockers};
    if(selected.workbenchEligible){const workspace=(await request('/api/sim/rfqs')).items.find(r=>r.intakeId===id);if(workspace)selected={...selected,lanes:workspace.lanes,inputs:workspace.inputs};else selected.workbenchEligible=false;}
  }
  async function refresh() {
    mount?.setAttribute?.("aria-busy", "true");
    if (mount) mount.inert = true;
    try { const id=returnIntakeId||selected?.intakeId;items=(await request('/api/sim/rfqs/commercial')).items;await selectItem(id);returnIntakeId=null;error=''; }
    catch(e){error=e.message;}
    finally { if (mount) mount.inert = false; mount?.setAttribute?.('aria-busy', 'false'); }
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
    if (mobileOverview()) return;
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
    if (mobileOverview()) return;
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
    mount.oninput = event => {
      if(!event.target.matches('[data-history-search]')) return;
      const position=event.target.selectionStart;historySearch=event.target.value;draw();
      const input=mount.querySelector('[data-history-search]');input.focus();input.setSelectionRange(position,position);
    };
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
        returnIntakeId = id;
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
  function context(r) {
    return r.assemblies.map(a => '<div class="rfqs-assembly"><strong>'+esc(a.assemblyNumber)+'</strong><span>Rev <b>'+esc(a.revision)+'</b></span><span>Qty <b>'+esc(a.quantity)+'</b></span></div>').join('');
  }
  function lane(name) {
    const key = name.toLowerCase(), value = selected.lanes[key];
    if (key === 'materials') return '<section class="rfqs-lane"><h2>Materials</h2><p class="rfqs-status" data-status="' + esc(value.status) + '">' + labels[value.status] + '</p><p>' + selected.inputs.materials.candidate.rows.length + ' BOM rows</p><button data-open="materials"'+desktopOnly()+'>Open Materials</button><p>Save and complete the quotation in Materials.</p></section>';
    return '<section class="rfqs-lane"><h2>Labor</h2><p class="rfqs-status" data-status="' + esc(value.status) + '">' + labels[value.status] + '</p><p>Operations, time and production instructions</p><button data-open="labor">Open Labor</button><p>Save and complete the quotation in Labor.</p></section>';
  }
  const money=v=>v==null?'—':Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const date=v=>v?new Date(v).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'}):'—';
  function historyRows(values, query='') {
    const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const time=r=>{const n=Date.parse(r.history?.activityAt||'');return Number.isFinite(n)?n:-Infinity;};
    return values.filter(r=>{
      const text=[r.intakeId,r.quoteNumber,r.customer?.customerName,r.customer?.customerNumber,r.status,
        ...(r.assemblies||[]).flatMap(a=>[a.assemblyNumber,a.revision]),
        ...(r.history?.orders||[]).flatMap(o=>[o.customerPo,o.intakeId,o.status]),
        ...(r.commercial?.orderLinks||[]).flatMap(o=>[o.newOrderIntakeId,o.salesOrderId,o.workOrderId])].join(' ').toLowerCase();
      return words.every(word=>text.includes(word));
    }).slice().sort((a,b)=>time(a)>time(b)?-1:time(a)<time(b)?1:
      (a.intakeId||'').localeCompare(b.intakeId||'')||(a.quoteNumber||'').localeCompare(b.quoteNumber||''));
  }
  function linkedOrders(r){
    const orders=r.history?.orders||[];
    return orders.length?'<ul class="rfqs-linked-orders">'+orders.map(o=>'<li>'+(
      typeof o.poUrl==='string'&&o.poUrl.startsWith('/api/sim/new-orders/')?
        '<a href="'+esc(o.poUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(o.customerPo||'Customer PO')+'</a>':esc(o.customerPo||'PO not recorded'))+
      '<span>'+esc(o.intakeId)+' · Qty '+esc(o.quantity??'Not recorded')+'</span><strong>'+esc(o.status)+'</strong></li>').join('')+'</ul>':'—';
  }
  function commercialDetail(r){
    const c=r.commercial, latest=r.approvals?.at(-1), readonly=window.DleOsCapabilities?.can?.('technical_review.disposition')!==true;
    const canSubmit=r.approvalCurrent&&latest&&latest.id!==c.approvalId&&['OPEN','SUBMITTED','EXPIRED'].includes(c.status);
    return '<section class="rfq-commercial-detail"><h2>Commercial Lifecycle</h2><div class="rfqs-current-status"><span>Current status</span><strong>'+esc(r.status)+'</strong></div>'+ (latest&&!r.approvalCurrent?'<p class="rfqs-approval-note">Historical approval retained. Current work requires final review before a new approval.</p>':'') +'<p class="rfqs-quote-reference"><span>Quotation reference</span><strong>'+esc(r.quoteNumber||'No approved quotation')+'</strong></p><p><strong>Recorded quote total</strong> &middot; '+money(r.quoteTotal)+'</p><p>Approved: '+date(r.approvedAt)+' · Submitted: '+date(c.submittedAt)+' · Expires: '+date(c.expiresAt)+' (Pacific time)</p>'+ (r.revisionNeeded?'<p role="alert">Revision needed. Submitted quotation remains unchanged. Current work: '+esc(r.workStatus)+'.</p>':'')+(canSubmit?'<button data-commercial="SUBMIT" '+(readonly||saving?'disabled':'')+'>Mark Approved Quote Submitted</button><small>Records commercial submission and 30-day validity. Does not send customer communication.</small>':'')+(c.status==='SUBMITTED'&&r.status==='Expired'?'<button data-commercial="EXPIRE" '+(readonly||saving?'disabled':'')+'>Record Expiration</button>':'')+(c.closedAt?'<p>Closed: '+date(c.closedAt)+' · '+esc(c.closeReason)+'</p>':'')+(c.status==='AWARDED'&&!c.orderLinks?.length?'<p>Order handoff pending</p>':'')+'<details><summary>Lifecycle history ('+(c.history||[]).length+')</summary><ul>'+(c.history||[]).map(h=>'<li>'+esc(h.action)+' · '+esc(h.at)+' · '+esc(h.actor)+' · '+esc(h.reason)+'</li>').join('')+'</ul></details><details><summary>Approval history ('+(r.approvals||[]).length+')</summary><ul>'+(r.approvals||[]).map(a=>'<li>Version '+a.version+' · '+esc(a.id)+' · '+date(a.approvedAt)+' · '+money(a.summary.quoteTotal)+'</li>').join('')+'</ul></details><details><summary>Order links ('+(c.orderLinks||[]).length+')</summary><ul>'+(c.orderLinks||[]).map(l=>'<li>'+esc(l.quoteNumber)+' · New Order: '+esc(l.newOrderIntakeId||'Pending')+' · SO: '+esc(l.salesOrderId||'Pending')+' · WO: '+esc(l.workOrderId||'Pending')+'</li>').join('')+'</ul></details></section>';
  }
  function draw(){
    document.body.dataset.rfqsMobileWorkbench = "false";
    const inBucket=items.filter(r=>r.bucket===bucket);
    const rows=bucket==='HISTORY'?historyRows(inBucket,historySearch):inBucket;
    const toggles='<div class="rfq-lifecycle-tabs" role="group" aria-label="RFQ lifecycle">'+['ACTIVE','SUBMITTED','HISTORY'].map(b=>'<button data-bucket="'+b+'" aria-pressed="'+(bucket===b)+'" class="'+(bucket===b?'active':'')+'">'+b+' <span>'+items.filter(r=>r.bucket===b).length+'</span></button>').join('')+'</div>';
    const columns=['RFQ / Quote Number','Customer','Assembly / Rev','Quoted qty','Quote Total',bucket==='HISTORY'?'History activity (Pacific)':'Submitted','Expires','Status','Customer PO / Order'];
    const table='<div class="rfqs-scroll"><table><thead><tr>'+columns.map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+[
      '<button data-rfq="'+esc(r.intakeId)+'">'+esc(r.intakeId)+'</button><br>'+esc(r.quoteNumber||'-'),
      esc(r.customer.customerName),r.assemblies.map(a=>esc(a.assemblyNumber)+' / '+esc(a.revision)).join('<br>'),
      r.assemblies.map(a=>a.quantity).join('<br>'),money(r.quoteTotal),bucket==='HISTORY'?date(r.history?.activityAt)+'<small>'+esc(r.history?.activityLabel||'Date not recorded')+'</small>':date(r.commercial.submittedAt),date(r.commercial.expiresAt),
      esc(r.status)+(r.revisionNeeded?'<br><small>Revision needed</small>':''),linkedOrders(r)
    ].map((value,index)=>'<td data-label="'+columns[index]+'">'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    const historyTools=bucket==='HISTORY'?'<div class="rfqs-history-tools"><label>Search History<input type="search" data-history-search value="'+esc(historySearch)+'" placeholder="Quote, customer, assembly, PO or order"></label><p>Newest activity first · Pacific time. Awarded does not mean accepted or released.</p><small>'+rows.length+' of '+inBucket.length+' records</small></div>':'';
    const detail=selected?'<button data-action="queue">&larr; RFQ queue</button><div class="rfqs-context"><span class="rfqs-eyebrow">Customer</span><h2>'+esc(selected.customer.customerName)+'</h2>'+context(selected)+'<dl class="rfqs-identity"><div><dt>Intake</dt><dd>'+esc(selected.intakeId)+'</dd></div><div><dt>Intake status</dt><dd>'+esc(selected.intakeStatus)+'</dd></div><div><dt>Created</dt><dd>'+date(selected.createdAt)+'</dd></div><div><dt>Scope</dt><dd>'+esc(selected.scope.replaceAll('_',' '))+'</dd></div></dl><div class="rfqs-context-actions"><button data-action="source">View Intake / Technical Review</button><button data-open="intake-documents">Intake Documents</button></div></div><div data-intake-documents-host></div>'+((selected.history?.orders||[]).length?'<section class="rfqs-history-links"><h2>Linked customer orders</h2>'+linkedOrders(selected)+'</section>':'')+commercialDetail(selected)+(selected.workbenchEligible&&selected.inputs?'<p id="rfqsMobileScope" class="rfqs-mobile-scope"'+(mobileOverview()?'':' hidden')+'>Mobile View supports the RFQ overview and Labor. Use Desktop View for Materials and Quotation Final Review.</p>'+'<div class="rfqs-lanes">'+lane('Materials')+lane('Labor')+'</div><div class="rfqs-review-action"><button data-open="final-review"'+desktopOnly()+'>Quotation Final Review</button></div>':'<p>Materials and Labor become available after Technical Review qualification.</p>'):toggles+historyTools+(rows.length?table:'<p>No '+bucket.toLowerCase()+' RFQs.</p>');
    mount.innerHTML='<section class="rfqs-workspace rfqs-overview"><header class="rfqs-overview-header"><h1>RFQs</h1><button data-action="refresh" '+(saving?'disabled':'')+'>Refresh</button></header>'+(error?'<p role="alert">'+esc(error)+'</p>':'')+detail+'</section>';
    if(selected){
      const root=mount.querySelector('.rfqs-overview'),context=root.querySelector('.rfqs-context'),commercial=root.querySelector('.rfq-commercial-detail');
      const reference=document.createElement('p');reference.className='rfqs-quote-reference';reference.textContent=(selected.quoteNumber||selected.intakeId)+' · '+selected.status;context.append(reference);
      const s=selected.reviewSummary;
      if(s){const summary=document.createElement('p');summary.className='rfqs-price-summary';summary.textContent='Total quote '+money(s.quoteTotal)+' · Unit price '+money(s.combinedUnitPrice)+' · '+(selected.approvalCurrent?('Quoted delivery '+(selected.approvals.at(-1)?.answers.delivery||'Not set')):('Suggested lead '+(s.suggestedLeadDays==null?'Not available':s.suggestedLeadDays+' days')));context.append(summary);}
      const technical=document.createElement('details');technical.className='rfqs-secondary';technical.innerHTML='<summary>Intake and technical documents</summary>';
      for(const node of [...context.querySelectorAll('.rfqs-identity,.rfqs-context-actions')])technical.append(node);
      technical.append(root.querySelector('[data-intake-documents-host]'));root.append(technical);
      const audit=document.createElement('details');audit.className='rfqs-secondary';audit.innerHTML='<summary>Quote history and commercial details</summary>';audit.append(commercial);root.append(audit);
      const review=root.querySelector('.rfqs-review-action');if(review){const note=document.createElement('p');note.textContent=(selected.reviewBlockers||[]).join(' ')||(selected.approvalCurrent?'Review the approved quote and mark it submitted.':'Review pricing and delivery, approve, then mark submitted.');review.prepend(note);}
    }

  }
  document.addEventListener('dle:view-mode-change', syncMobileBoundary);
  window.DleWorkspaces = window.DleWorkspaces || {};
  document.addEventListener('dle:workspace-navigation', event => {
    if (event.detail?.workspace?.id === 'rfqs' && event.detail?.requestedState?.intakeId) returnIntakeId = event.detail.requestedState.intakeId;
  });
  window.DleWorkspaces.rfqs = Object.freeze({id:'rfqs', render, refresh});
})(window, document);

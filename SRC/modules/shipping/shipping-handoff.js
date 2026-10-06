(function (window, document) {
  'use strict';
  const API = '/api/shipping-handoff/v1/';
  const isSim = () => window.DleOsRuntimeConfig?.environment === 'SIMULATION';
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? `${x.slice(5,7)}/${x.slice(8)}/${x.slice(0,4)}` : 'Not set';
  const label = x => ({CLEARED_FOR_PACKAGING:'Cleared for Packaging',RELEASED:'Released',SIM_SHIPPED_AWAITING_INVOICE:'Shipped / Awaiting Invoice - SIM',HELD:'Held',REVOKED:'Revoked',READY_FOR_PACKING:'Ready for Packing',REVIEW_REQUIRED:'Review required',NOT_ESTABLISHED:'Not established',REQUIRED:'Required',REQUIRED_BY_RETAINED_PO_EVIDENCE:'Required — retained PO evidence'}[x] || x || 'Not released');
  async function api(path, body) {
    const options = {credentials:'same-origin',cache:'no-store'};
    if(body)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const r=await window.fetch(API+path,options);
    if(!(r.headers.get('content-type')||'').includes('json'))throw new Error('Unlock SIM and refresh this view.');
    const data=await r.json();if(!r.ok)throw new Error(data.message||'Shipping handoff unavailable.');return data;
  }
  const uniqueEvidence = rows => (rows || []).filter((x,i,all) => all.findIndex(y => y.documentId===x.documentId && y.sha256===x.sha256 && y.value===x.value)===i);
  const path = wo => 'work-orders/'+encodeURIComponent(wo);
  const action = (wo,mode,text,id='') => `<button type="button" data-handoff-wo="${esc(wo)}" data-handoff-mode="${mode}" data-handoff-id="${esc(id)}">${esc(text)}</button>`;
  const departed=a=>a?.state==='SIM_SHIPPED_AWAITING_INVOICE';
  function workStatus(v,a) {
    if(departed(a))return 'Shipped / Awaiting Invoice - SIM';
    const c=v.clearances?.find(c=>c.id===a.clearanceId);
    return v.sourceCurrent && a.state==='RELEASED' && c?.state==='CLEARED_FOR_PACKAGING' ? 'Released - SIM review required' : 'On hold / source review';
  }
  function row(v,a) {
    const c=a.context;
    const attention=workStatus(v,a)!=='Released - SIM review required' || c.shippingMethod?.status==='REVIEW_REQUIRED' ||
      Object.values(c.requiredDocuments||{}).some(x=>String(x).startsWith('REQUIRED'));
    const search=[v.workOrderNumber,'WO'+v.workOrderNumber,c.salesOrderNumber,'SO'+c.salesOrderNumber,c.customer,c.assembly].join(' ').toLowerCase();
    return `<button type="button" class="production-compact-row shipping-job" data-handoff-wo="${esc(v.workOrderNumber)}" data-handoff-mode="detail" data-handoff-id="${esc(a.id)}" data-shipping-tab="${departed(a)?'shipped':'active'}" data-shipping-search="${esc(search)}" aria-label="Open Work Order ${esc(v.workOrderNumber)} - ${esc(workStatus(v,a))}${attention?' - Review required':''}">
      <span class="production-compact-wo">WO ${esc(v.workOrderNumber)}</span>
      <span class="production-compact-assembly"><strong>${esc(c.assembly)}</strong><small>Rev ${esc(c.revision)}</small></span>
      <span class="production-compact-metric production-compact-quantity"><small>QTY</small><strong>${esc(a.quantity)} ${esc(c.uom)}</strong></span>
      <span class="production-compact-metric production-compact-due"><small>CUSTOMER DUE</small><strong>${date(c.customerDueDate)}</strong></span>
      <span class="production-compact-customer">${esc(c.customer)}</span>
      <span class="shipping-job-status"><span class="production-compact-state">${esc(workStatus(v,a))}</span>${attention?'<small class="shipping-attention">Review required</small>':''}</span>
      <span class="production-compact-arrow" aria-hidden="true">&#8250;</span></button>`;
  }
  let shippingMount=null, shippingSearch='', shippingRead=0, shippingTab='active';
  function filterShipping(mount) {
    const rows=mount.querySelectorAll?.('[data-shipping-search]');if(!rows)return;
    const term=shippingSearch.trim().toLowerCase();let visible=0,total=0;
    for(const item of rows){const inTab=item.dataset.shippingTab===shippingTab;if(inTab)total++;item.hidden=!inTab||!item.dataset.shippingSearch.includes(term);if(!item.hidden)visible++;}
    const empty=mount.querySelector('[data-shipping-empty]');
    if(empty){empty.hidden=visible>0;empty.textContent=term?'No jobs match your search.':(shippingTab==='shipped'?'No SIM departures recorded.':'No jobs are ready for Shipping.');}
    mount.querySelectorAll?.('[data-shipping-tab-select]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shippingTabSelect===shippingTab)));
    const title=mount.querySelector('[data-shipping-list-title]');if(title)title.textContent=shippingTab==='shipped'?'Shipped / Awaiting Invoice':'Released Work';
    const count=mount.querySelector('[data-shipping-count]');if(count)count.textContent=term?`${visible} of ${total}`:String(total);
  }
  const queueHeader=()=>`<header class="production-workspace-header"><div><h1>Shipping</h1><p>Review released jobs and prepare shipping documents.</p></div><span class="shipping-sim">SIM / Developmental</span></header>`;
  async function renderShipping(mount) {
    if(!isSim()||document.getElementById?.(JOB_SCREEN)?.classList.contains('active'))return;shippingMount=mount;const read=++shippingRead;
    mount.innerHTML=`<section class="production-workspace shipping-queue">${queueHeader()}<p role="status">Loading jobs...</p></section>`;
    try {
      const q=await api('queue');if(read!==shippingRead)return;
      const valid=q.rows.filter(v=>!v.unavailable);
      const released=valid.flatMap(v=>v.authorizations.filter(a=>a.state!=='REVOKED').map(a=>row(v,a)));
      const awaiting=valid.filter(v=>v.availableToRelease>0);
      mount.innerHTML=`<section class="production-workspace shipping-queue">${queueHeader()}
        <section class="production-workspace-controls" aria-label="Shipping queue controls"><label class="production-search-control"><span class="sr-only">Search Shipping jobs</span><input type="search" data-shipping-search-input autocomplete="off" placeholder="Search Work Order, Sales Order, Customer, Assembly..." value="${esc(shippingSearch)}"></label><button type="button" class="secondary-btn production-refresh" data-handoff-refresh>Refresh Queue</button></section>
        <nav class="shipping-tabs" aria-label="Shipping job lists"><button type="button" data-shipping-tab-select="active">Active Shipping (${valid.reduce((n,v)=>n+v.authorizations.filter(a=>a.state!=='REVOKED'&&!departed(a)).length,0)})</button><button type="button" data-shipping-tab-select="shipped">Shipped / Awaiting Invoice (${valid.reduce((n,v)=>n+v.authorizations.filter(departed).length,0)})</button></nav>
        <section class="production-operator-queue" aria-labelledby="shippingQueueTitle"><h2 id="shippingQueueTitle"><span data-shipping-list-title>Released Work</span> <span class="shipping-queue-count" data-shipping-count aria-live="polite">${released.length}</span></h2>
          <div class="production-compact-list">${released.join('')}</div><p class="production-queue-empty" data-shipping-empty ${released.length?'hidden':''}>No jobs are ready for Shipping.</p>
          ${q.rows.filter(v=>v.unavailable).map(v=>`<p class="shipping-source-warning" role="alert">WO ${esc(v.workOrderNumber)} - review required: ${esc(v.message)}</p>`).join('')}
        </section>
        <aside class="shipping-secondary" aria-label="Other Shipping information">
          <details><summary>Awaiting Release (${awaiting.length})</summary>${awaiting.map(v=>`<p>WO ${esc(v.workOrderNumber)} - ${esc(v.context.assembly)} - ${v.availableToRelease} ${esc(v.context.uom)} cleared - Due ${date(v.context.customerDueDate)} ${action(v.workOrderNumber,'detail','View clearance')}</p>`).join('')||'<p>No jobs awaiting release.</p>'}</details>
          <details><summary>Authorization History</summary>${valid.flatMap(v=>v.authorizations.filter(a=>a.state==='REVOKED').map(a=>`<p>WO ${esc(v.workOrderNumber)} - ${a.quantity} - Revoked ${action(v.workOrderNumber,'detail','View',a.id)}</p>`)).join('')||'<p>No revoked authorizations.</p>'}</details>
          <details><summary>Shipment Reconciliation</summary><p>Processed shipments and invoice reconciliation are separate from released work. SIM departures are retained in Shipped / Awaiting Invoice. No ERP shipment or invoice is created. Reconciliation execution is unavailable in SIM.</p></details>
        </aside></section>`;
      filterShipping(mount);
      if(returnToJob){returnToJob=false;const item=Array.from(mount.querySelectorAll?.('[data-handoff-id]')||[]).find(x=>x.dataset.handoffId===selectedJob?.id&&!x.hidden);item?.focus({preventScroll:true});document.querySelector('main')?.scrollTo({top:queueScroll,behavior:'auto'});}
    }catch(e){if(read!==shippingRead)return;mount.innerHTML=`<section class="production-workspace shipping-queue">${queueHeader()}<p role="alert">${esc(e.message)}</p><button type="button" class="secondary-btn production-refresh" data-handoff-refresh>Retry</button></section>`;}
  }
  async function hydrateOperations(container) {
    if(!isSim()||!container)return;
    try {const q=await api('queue');if(!container.isConnected)return;
      for(const node of container.querySelectorAll('[data-handoff-summary]')){
        const v=q.rows.find(x=>x.workOrderNumber===node.dataset.handoffSummary);if(!v||v.unavailable)continue;
        const shipped=v.authorizations.filter(departed).reduce((n,x)=>n+x.quantity,0);
        const released=v.authorizations.filter(x=>x.state==='RELEASED').reduce((n,x)=>n+x.quantity,0);
        node.innerHTML=`<small>${!v.sourceCurrent ? 'Clearance: Source review required' : v.clearances.length ? 'Clearance: '+esc(label(v.clearances[0].state))+' · '+v.clearances[0].quantity : 'Clearance: Not established'}</small><small>Shipping: ${shipped?'Shipped / Awaiting Invoice - SIM '+shipped:released?'Released · '+released:'Not released'}</small>${action(v.workOrderNumber,shipped?'detail':'release',shipped?'View SIM departure':released?'View release':'Shipment authorization',shipped?v.authorizations.find(departed).id:'')}`;
      }
    }catch(e){for(const node of container.querySelectorAll('[data-handoff-summary]'))node.textContent='Shipping handoff unavailable';}
  }
  function productionButton(wo) {return isSim()?`<div class="handoff-inline">${action(wo,'clearance','Production clearance')}<small>Separate from Traveler execution</small></div>`:'';}
  const fact=(key,value)=>`<div><dt>${esc(key)}</dt><dd>${esc(value||'Not established')}</dd></div>`;
  function detail(v,a) {
    const c=a?.context||v.context, clearance=v.clearances.find(x=>x.id===a?.clearanceId)||v.clearances[0], docs=c.requiredDocuments;
    const pkg=clearance?.packaging;
    return `<dl class="handoff-facts">${fact('Customer',c.customer)+fact('Customer PO',c.customerPo)+fact('SO / Line',c.salesOrderNumber+' / '+c.lineNumber)+fact('WO',v.workOrderNumber)+fact('Assembly / Rev',c.assembly+' / '+c.revision)+fact('Quantity',(a?.quantity??clearance?.quantity??0)+' '+c.uom)+fact('Customer Due',date(c.customerDueDate))+fact('Ship-to',typeof c.shipTo==='string'?c.shipTo:'Not established')+fact('Production clearance',label(clearance?.state))+fact('Authorization',label(a?.state))+fact('Ship date / window',a?.requestedShipWindow)+fact('Shipping work',a?workStatus(v,a)+' · Not Started':'Awaiting release')}</dl>
      <p class="handoff-warning">${clearance?'SIMULATED DEVELOPMENTAL clearance — no Production execution is implied.':'No clearance established.'}</p>
      ${pkg?`<h3>Governed Packaging operation</h3><p>Traveler v${clearance.travelerVersion} · ${pkg.sequence} ${esc(pkg.name)} · Not Started</p><p class="handoff-instructions">${esc(pkg.instructions)} ${esc(pkg.shopInstructions)}</p>`:''}
      <h3>Required documents</h3><dl class="handoff-facts">${fact('Customer CoC',label(docs.customerCoC))+fact('Serial list',label(docs.serialList))+fact('Test results',label(docs.testResults))+fact('FAI',label(docs.fai))}</dl>
      <details><summary>Retained requirements / packaging evidence</summary>${uniqueEvidence(c.requirementsEvidence).map(x=>'<p class="handoff-instructions">'+esc(x.value)+'</p>').join('')}</details>
      <h3>Shipping method · Review required</h3><p>Accepted questionnaire: ${esc(c.shippingMethod.questionnaire)}</p>${uniqueEvidence(c.shippingMethod.poEvidence).map(x=>'<p>Retained PO evidence: '+esc(x.value)+'</p>').join('')}<p>${esc(c.shippingMethod.note)}</p>
      <details><summary>Audit / lineage</summary><p>Clearance ${esc(clearance?.id)} · v${clearance?.version||0}<br>Authorization ${esc(a?.id)} · v${a?.version||0}</p>${v.history.map(e=>`<p>${esc(e.action)} · ${esc(e.actor)} · ${esc(e.atUtc)} · version ${e.sequence}</p>`).join('')}</details>`;
  }
  const JOB_SCREEN='shippingJobWorkspace';
  let jobRead=0, selectedJob=null, queueScroll=0, returnToJob=false;
  function jobBody(v,a) {
    const c=a?.context||v.context, clearance=v.clearances.find(x=>x.id===a?.clearanceId)||v.clearances[0], pkg=clearance?.packaging;
    const docs=c.requiredDocuments, required=x=>String(x||'').startsWith('REQUIRED');
    const shipTo=typeof c.shipTo==='string'&&c.shipTo.trim()?c.shipTo:'Not established';
    const doc=(title,value)=>`<div class="shipping-document"><dt>${esc(title)}</dt><dd>${required(value)?'Required':esc(label(value))}</dd><small>${required(value)?'Artifact missing / not established':'Availability not established'}</small></div>`;
    return `<div class="kitting-job-shell shipping-job-shell">
      <nav class="shipping-job-nav" aria-label="Shipping job navigation"><button type="button" data-shipping-back>&larr; Back to Shipping Queue</button><span>${departed(a)?'Shipped / Awaiting Invoice':'Active Shipping'}</span></nav>
      <header class="kitting-job-header"><div class="kitting-job-heading"><span class="kitting-job-eyebrow">Shipping &middot; SIM / Developmental</span><h2 tabindex="-1" data-shipping-job-heading>WO ${esc(v.workOrderNumber)} <small>${esc(c.assembly)} &middot; Rev ${esc(c.revision)}</small></h2></div><span class="kitting-job-status">${esc(a?workStatus(v,a):'Awaiting release')}</span></header>
      <section class="kitting-job-context" aria-label="Shipping job context"><dl>${fact('Quantity',(a?.quantity??clearance?.quantity??0)+' '+c.uom)+fact('Customer',c.customer)+fact('Customer PO',c.customerPo)+fact('SO / Line',c.salesOrderNumber+' / '+c.lineNumber)+fact('Customer Due',date(c.customerDueDate))}</dl></section>
      <section class="shipping-job-actions" aria-label="Shipping documents"><div data-shipping-job-actions></div></section>
      <aside class="shipping-job-issues" aria-labelledby="shippingIssuesTitle"><h3 id="shippingIssuesTitle">Unresolved items &middot; Review required</h3><p>Shipping method: <strong>${esc(c.shippingMethod.questionnaire)}</strong> versus retained PO instructions below. Ship-to: ${esc(shipTo)}. Required CoC, serial list and test-result artifacts remain missing / not established.</p>${!v.sourceCurrent?'<p>Source review required.</p>':''}<p>Production ${esc(v.productionExecution)}. ${departed(a)?'SIM departure does not resolve these items.':'Actual ship date is not established.'} Printing never fulfills document requirements.</p></aside>
      <section class="shipping-job-card shipping-job-documents" aria-labelledby="shippingDocumentsTitle"><h3 id="shippingDocumentsTitle">Required documents</h3><dl>${doc('Customer CoC',docs.customerCoC)+doc('Serial list',docs.serialList)+doc('Test results',docs.testResults)+doc('FAI',docs.fai)}</dl></section>
      <div class="shipping-job-sections">
        <section class="shipping-job-card" aria-labelledby="shippingPackagingTitle"><h3 id="shippingPackagingTitle">Packaging instructions</h3>${pkg?`<p class="shipping-section-meta">Traveler v${clearance.travelerVersion} &middot; ${pkg.sequence} ${esc(pkg.name)} &middot; Not Started</p><p class="shipping-instruction">${esc(pkg.instructions)}</p>${pkg.shopInstructions?`<p class="shipping-instruction">${esc(pkg.shopInstructions)}</p>`:''}`:'<p>No governed Packaging operation is established.</p>'}</section>
        <section class="shipping-job-card" aria-labelledby="shippingInstructionsTitle"><h3 id="shippingInstructionsTitle">Shipping instructions</h3><dl class="shipping-job-facts">${fact('Ship-to',shipTo)+fact('Requested ship date / window',a?.requestedShipWindow)}</dl><h4>Shipping method &middot; Review required</h4><p>Accepted questionnaire: <strong>${esc(c.shippingMethod.questionnaire)}</strong></p>${uniqueEvidence(c.shippingMethod.poEvidence).map(x=>`<p class="shipping-instruction">Retained PO evidence: ${esc(x.value)}</p>`).join('')}</section>
      </div>
      <details class="shipping-job-support"><summary>Retained requirements / packaging evidence</summary>${uniqueEvidence(c.requirementsEvidence).map(x=>`<p class="shipping-instruction">${esc(x.value)}</p>`).join('')}</details>

      <details class="shipping-job-support"><summary>Authorization, clearance and audit / lineage</summary><dl class="shipping-job-facts">${fact('Released quantity',a?`${a.quantity} ${c.uom}`:'Not released')+fact('Released by',a?.actor)+fact('Released at',a?.createdAt)+fact('Clearance source mode',clearance?.sourceMode)+fact('Production execution',Array.from(new Set(v.traveler.operations.filter(x=>x.enabled&&x.classification==='PRODUCTION').map(x=>x.executionState))).join(', '))+fact('Production clearance',label(clearance?.state))+fact('Clearance ID',clearance?.id)+fact('Clearance version',String(clearance?.version||0))+fact('Authorization',label(a?.state))+fact('Authorization ID',a?.id)+fact('Authorization version',String(a?.version||0))+fact('Shipping work',a?workStatus(v,a):'Awaiting release')}</dl>${v.history.map(e=>`<p>${esc(e.action)} &middot; ${esc(e.actor)} &middot; ${esc(e.atUtc)} &middot; version ${e.sequence}</p>`).join('')}</details>


      <footer class="shipping-departure" aria-label="SIM departure">
      ${departed(a)?`<h3>SIM departure recorded &middot; Awaiting invoice</h3><p>${esc(a.departure?.quantity)} ${esc(c.uom)} &middot; ${esc(a.departure?.actor)} &middot; <time>${esc(a.departure?.recordedAt)}</time></p><p>No invoice or ERP dispatch was created. Production and compliance evidence are unchanged.</p>`:`<div><h3>Record simulated departure</h3><p>Records this full ${esc(a?.quantity??0)} ${esc(c.uom)} authorization as having left the building in this SIM test, using your identity and the current server time. Unresolved items remain; no Production completion or certification is implied.</p></div>${a&&v.canConfirmSimDeparture&&window.DleOsCapabilities?.can('shipments.stage')?'<button type="button" data-sim-departure>SIMULATION: Confirm Shipped</button>':'<p>SIM departure is unavailable for this authorization or your current permissions.</p>'}<p data-departure-message role="status"></p>`}
      </footer>
    </div>`;
  }
  function renderJob(screen,v,a) {
    screen.innerHTML=jobBody(v,a);window.ShippingPrint?.attach(screen.querySelector('[data-shipping-job-actions]'),v,a,{cards:true});
    const button=screen.querySelector('[data-sim-departure]');if(!button)return;
    // One command ID survives ambiguous network failures; retries cannot append duplicate departures.
    const request={requestId:crypto.randomUUID(),expectedToken:v.token,expectedVersion:a.version};
    let busy=false;
    button.addEventListener('click',async()=>{
      if(busy||!isSim()||!window.DleOsCapabilities?.can('shipments.stage'))return;
      busy=true;button.disabled=true;const message=screen.querySelector('[data-departure-message]');message.textContent='Recording SIM departure...';
      try{
        const next=await api(path(v.workOrderNumber)+'/authorizations/'+encodeURIComponent(a.id)+'/sim-departure',request);
        const updated=next.authorizations.find(x=>x.id===a.id);
        if(!departed(updated))throw new Error('Departure was not verified. Refresh this job before continuing.');
        shippingTab='shipped';
        if(screen.contains(button)){renderJob(screen,next,updated);screen.querySelector('.shipping-departure').scrollIntoView({block:'nearest'});}
        if(shippingMount?.isConnected)await renderShipping(shippingMount);
        await hydrateOperations(document.getElementById('operationsCenterTable'));
      }catch(e){if(screen.contains(button))message.textContent=e.message+' Retry uses the same request. If the job changed, return to the queue and reopen it.';}
      finally{busy=false;button.disabled=false;}
    });
  }
  async function openJob(wo,id='') {
    if(!isSim())return;
    // Use the same in-app screen navigation as Kitting; do not invent URL routes.
    if(!window.DleWorkspaceShell?.navigate)throw new Error('Shipping navigation is unavailable. Refresh the workspace.');
    let screen=document.getElementById(JOB_SCREEN);
    if(!screen){screen=document.createElement('section');screen.id=JOB_SCREEN;screen.className='screen shipping-job-workspace';document.querySelector('main').append(screen);}
    queueScroll=document.querySelector('main').scrollTop;selectedJob={wo,id};returnToJob=false;const read=++jobRead;
    screen.innerHTML='<div class="shipping-job-shell"><button type="button" data-shipping-back>&larr; Back to Shipping Queue</button><p role="status">Loading job...</p></div>';
    window.DleWorkspaceShell.navigate({workspaceId:'shipping',screenId:JOB_SCREEN});document.querySelector('main').scrollTo({top:0,behavior:'auto'});
    try {
      const v=await api(path(wo));if(read!==jobRead)return;
      const a=id?v.authorizations.find(x=>x.id===id):v.authorizations.find(x=>x.state==='RELEASED');
      if(id&&!a)throw new Error('This authorization is no longer available. Return to Shipping and refresh.');
      renderJob(screen,v,a);
      if(screen.classList.contains('active'))screen.querySelector('[data-shipping-job-heading]').focus({preventScroll:true});
    }catch(e){if(read!==jobRead)return;screen.innerHTML=`<div class="shipping-job-shell"><button type="button" data-shipping-back>&larr; Back to Shipping Queue</button><h2>WO ${esc(wo)}</h2><p role="alert">${esc(e.message)}</p></div>`;}
  }
  function backToShipping() {
    if(window.DleWorkspaceShell?.canNavigateBack())window.DleWorkspaceShell.navigateBack();
    else window.DleWorkspaceShell?.navigate({workspaceId:'shipping',screenId:'home'},false);
  }
  document.addEventListener('dle:workspace-navigation',e=>{
    if(e.detail?.workspace?.id==='shipping'&&e.detail.screenId==='home')returnToJob=true;
    if(e.detail?.screenId!==JOB_SCREEN){jobRead++;document.getElementById('shippingPrintPreview')?.remove();}
  });
  async function open(wo,mode='detail',id='') {
    if(mode==='detail')return openJob(wo,id);
    if(!isSim())return;document.getElementById('shippingHandoffDialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='shippingHandoffDialog';dialog.className='handoff handoff-dialog';
    dialog.innerHTML='<button type="button" data-handoff-close>Close</button><p role="status">Loading verified handoff…</p>';document.body.append(dialog);dialog.showModal();
    try {
      const v=await api(path(wo));const a=v.authorizations.find(x=>x.id===id)||v.authorizations.find(x=>x.state==='RELEASED');
      dialog.innerHTML=`<div class="handoff-heading"><h2>WO ${esc(wo)} · ${mode==='clearance'?'Production clearance':'Shipment authorization'}</h2><button type="button" data-handoff-close>Close</button></div>`+detail(v,a);
      const warning=document.createElement('p');warning.className='handoff-warning';
      warning.textContent='Required CoC, serial list and test-result artifacts remain missing / not established in this handoff. Printing does not fulfill these requirements. Only an eligible Shipping operator can record a developmental SIM departure in Shipping. Real dispatch is unavailable.';
      dialog.append(warning);window.ShippingPrint?.attach(dialog,v,a);
      let form='';const route=v.traveler.operations.filter(x=>x.enabled&&x.classification==='PRODUCTION').sort((a,b)=>a.sequence-b.sequence);
      if(mode==='clearance'&&v.canCreateClearance)form=`<h3>Create developmental clearance</h3><p>SIM-only architecture test. Does not complete any operation.</p><label>Cleared quantity<input name="quantity" type="number" min="0.001" step="any" max="${v.remainingFulfillment}" value="${v.remainingFulfillment}" required></label><label>Pre-packaging gate<select name="gate">${route.slice(0,-1).map(x=>`<option value="${esc(x.id)}" ${x.id===route.at(-2)?.id?'selected':''}>${x.sequence} ${esc(x.name)}</option>`).join('')}</select></label><p>Packaging: ${route.at(-1)?.sequence} ${esc(route.at(-1)?.name)} · Traveler v${v.traveler.version}</p><label>Reason<textarea name="reason" required maxlength="2000">E2E-SIM-001 developmental Shipping handoff test. No Production execution occurred.</textarea></label><label><input type="checkbox" required> I understand this is simulated clearance, not completed Production.</label><button>Create SIM developmental clearance</button>`;
      if(mode==='release'&&v.canRelease&&v.availableToRelease>0)form=`<h3>Release for shipment</h3><p>Available: ${v.availableToRelease} ${esc(v.context.uom)}. Shipping method remains Review required.</p><label>Clearance<select name="clearance">${v.clearances.filter(c=>c.state==='CLEARED_FOR_PACKAGING').map(c=>`<option value="${c.id}">${c.quantity} cleared · Traveler v${c.travelerVersion}</option>`).join('')}</select></label><label>Quantity<input name="quantity" type="number" min="0.001" step="any" max="${v.availableToRelease}" value="${v.availableToRelease}" required></label><label>Requested ship date / window<input name="window" maxlength="200" value="Not set — dispatch planning pending" required></label><label>Reason<textarea name="reason" maxlength="2000" required></textarea></label><button>Release for shipment</button>`;
      if(form){const f=document.createElement('form');f.className='handoff-form';f.innerHTML=form+'<p role="status"></p>';dialog.append(f);
        let requestId=crypto.randomUUID(),lastBody='';
        f.addEventListener('submit',async event=>{event.preventDefault();if(f.dataset.busy==='true')return;const values=new FormData(f);
          const fields=mode==='clearance'?{quantity:Number(values.get('quantity')),sourceMode:'SIMULATED_DEVELOPMENTAL',gateOperationId:values.get('gate'),packagingOperationId:route.at(-1).id,reason:values.get('reason')}:{quantity:Number(values.get('quantity')),clearanceId:values.get('clearance'),requestedShipWindow:values.get('window'),reason:values.get('reason')};
          const serialized=JSON.stringify(fields);if(lastBody&&lastBody!==serialized)requestId=crypto.randomUUID();lastBody=serialized;
          f.dataset.busy='true';f.querySelector('button').disabled=true;
          try {await api(path(wo)+(mode==='clearance'?'/clearances':'/authorizations'),{...fields,requestId,expectedToken:v.token});await open(wo,mode);if(shippingMount?.isConnected)await renderShipping(shippingMount);await hydrateOperations(document.getElementById('operationsCenterTable'));}
          catch(e){f.querySelector('[role=status]').textContent=e.message;}finally{f.dataset.busy='false';f.querySelector('button').disabled=false;}
        });
      }
    }catch(e){dialog.innerHTML='<button type="button" data-handoff-close>Close</button><p role="alert">'+esc(e.message)+'</p>';}
  }
  document.addEventListener('input',e=>{if(e.target.matches?.('[data-shipping-search-input]')){shippingSearch=e.target.value;if(shippingMount)filterShipping(shippingMount);}});
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-handoff-wo]');if(b){e.preventDefault();e.stopPropagation();void open(b.dataset.handoffWo,b.dataset.handoffMode,b.dataset.handoffId);}
    const tab=e.target.closest?.('[data-shipping-tab-select]');if(tab){shippingTab=tab.dataset.shippingTabSelect;if(shippingMount)filterShipping(shippingMount);}
    if(e.target.closest?.('[data-shipping-back]'))backToShipping();
    if(e.target.closest?.('[data-handoff-close]'))document.getElementById('shippingHandoffDialog')?.close();
    if(e.target.closest?.('[data-handoff-refresh]')&&shippingMount)void renderShipping(shippingMount);
  });
  window.ShippingHandoff={isSim,open,renderShipping,hydrateOperations,productionButton,workStatus,date,detail,row};
})(window,document);

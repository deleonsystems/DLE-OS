(function (window, document) {
  'use strict';
  const dateTimeUtc=v=>window.DleDateFormat?.dateTime(v,{timeZone:'UTC',timeZoneName:'short',seconds:true})??v;
  const labels = { QUOTE_APPROVED: 'Quote Approved', NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', COMPLETE: 'Complete', READY_TO_WORK: 'Ready to Work', READY_FOR_QUOTE_ASSEMBLY: 'Ready for Quote Assembly' };
  let returnIntakeId = null,selectionGeneration=0,returnMaterials=null;
  const mobileOverview = () => document.body?.dataset?.simRuntime === 'true' && document.body?.dataset?.viewMode === 'mobile';
  const canReadiness=()=>window.DleOsCapabilities?.can?.('rfq.readiness.view')===true||window.DleOsCapabilities?.can?.('technical_review.view')===true;
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

  let holdControls = [];
  let mount, items = [], unavailableItems = [], selected = null, opened = null, saving = false, error = '', bucket = 'ACTIVE', pendingCommercial = null, historySearch = '', queueSort='REQUEST';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(url, options) {
    const response = await window.fetch(url, { credentials: 'include', cache: 'no-store', ...options });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'RFQs could not be loaded.');
    return body;
  }

  // Hold state is independent of quotation drafts and completed versions.
  const sectionHold=(rfq,section)=>rfq?.lanes?.[section+'Hold']??rfq?.[section+'Hold'];
  const heldSections=rfq=>['materials','labor'].filter(section=>sectionHold(rfq,section)?.active);
  const sectionName=section=>section==='materials'?'Materials':'Labor';
  function laneRequested(rfq,section){return !rfq?.libraryRfq||rfq.scope==='MATERIAL_AND_LABOR'||(section==='materials'?rfq.scope==='MATERIAL_ONLY':rfq.scope==='LABOR_ONLY');}
  function sectionStatus(rfq,section){
    if(!laneRequested(rfq,section))return 'Not requested';
    const hold=sectionHold(rfq,section),status=rfq?.lanes?.[section]?.status??rfq?.[section+'Status'];
    return hold?.active?'<strong class="rfq-on-hold">On Hold</strong><span class="rfq-hold-reason">'+esc(hold.reason)+'</span><small>'+esc(labels[status]||status||'Not Started')+'</small>':esc(labels[status]||status||'Not Started');
  }
  function mergeHolds(current,incoming){return Object.fromEntries(['materialsHold','laborHold'].map(key=>[key,(incoming?.[key]?.revision||0)>=(current?.[key]?.revision||0)?incoming?.[key]:current?.[key]]));}
  function reviewNote(rfq){if(rfq.libraryRfq)return 'Review this line and submit its completed estimate independently. Customer issuance is a separate step.';const holds=heldSections(rfq),blockers=(rfq.reviewBlockers||[]).filter(message=>! /^(Materials|Labor) on hold:/i.test(message));return [...holds.map(section=>sectionName(section)+' on hold: '+sectionHold(rfq,section).reason),...blockers].join(' ')||(rfq.approvalCurrent?'Review the approved quote and mark it submitted.':'Review pricing and delivery, approve, then mark submitted.');}
  function createHoldControl({section,getRfq,apply,onUpdate=()=>{},isBlocked=()=>false}){
    let root=null,draft=null,busy=false,error='',pending=null;
    const canEdit=()=>window.DleOsCapabilities?.can?.('technical_review.disposition')===true;
    const hold=()=>sectionHold(getRfq(),section);
    function contents(){
      const current=hold(),disabled=busy||isBlocked()?'disabled':'';
      return (current?.active?'<p class="rfq-hold-status"><strong class="rfq-on-hold">On Hold</strong><span class="rfq-hold-reason">'+esc(current.reason)+'</span></p>':'')+
        (canEdit()?(draft!==null&&!current?.active?'<label>Hold reason<input data-hold-reason aria-label="'+sectionName(section)+' hold reason" maxlength="500" required value="'+esc(draft)+'" '+disabled+'></label><div class="rfq-hold-actions"><button data-hold-action="confirm" '+disabled+'>Place on Hold</button><button data-hold-action="cancel" '+disabled+'>Cancel</button></div>':'<button data-hold-action="'+(current?.active?'release':'place')+'" '+disabled+'>'+(current?.active?'Release Hold':'Place on Hold')+'</button>'):'')+
        (error?'<p role="alert">'+esc(error)+'</p>':'');
    }
    function html(){return '<div class="rfq-section-hold" data-rfq-hold-section="'+section+'" aria-label="'+sectionName(section)+' hold">'+contents()+'</div>';}
    function bind(target){root=target;const panel=root?.querySelector('[data-rfq-hold-section="'+section+'"]');if(!panel)return;
      panel.onclick=async event=>{event.stopPropagation();const action=event.target.closest('button')?.dataset.holdAction;if(!action||busy||isBlocked()||!canEdit())return;
        if(action==='place'){draft='';error='';refresh();root.querySelector('[data-rfq-hold-section="'+section+'"] [data-hold-reason]')?.focus?.();return;}
        if(action==='cancel'){draft=null;error='';refresh();return;}
        if(action==='confirm'||action==='release')await change(action==='release'?'RELEASE':'PLACE');
      };
      panel.oninput=event=>{event.stopPropagation();if(event.target.dataset.holdReason!==undefined&&!busy&&canEdit())draft=event.target.value;};
    }
    function sync(){const panel=root?.querySelector('[data-rfq-hold-section="'+section+'"]');if(panel)panel.innerHTML=contents();bind(root);}
    function refresh(){sync();onUpdate();}
    function applyHoldState(workspace){apply(workspace);if(hold()?.active)draft=null;}
    async function change(action){
      const reason=action==='PLACE'?(draft||'').trim():'';
      if(action==='PLACE'&&(!reason||reason.length>500)){error='Enter a hold reason (up to 500 characters).';refresh();return;}
      const payload={action,reason,expectedRevision:hold()?.revision||0},key=JSON.stringify(payload);
      if(pending?.key!==key)pending={key,request:{...payload,requestId:window.crypto.randomUUID()}};
      busy=true;error='';refresh();
      try{const result=await request('/api/sim/rfqs/'+encodeURIComponent(getRfq().intakeId)+'/holds/'+section,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.request)});applyHoldState(result);draft=null;pending=null;}
      catch(e){error=e.message;try{const result=(await request('/api/sim/rfqs')).items.find(item=>item.intakeId===getRfq().intakeId);if(result)applyHoldState(result);}catch{}}
      finally{busy=false;refresh();}
    }
    return Object.freeze({html,bind,sync,isBusy:()=>busy});
  }
  window.DleRfqHolds=Object.freeze({get:sectionHold,active:heldSections,status:sectionStatus,merge:mergeHolds,create:createHoldControl});

  async function packageTools(){
    if(window.DleRfqPackageDocuments)return;
    if(!window.DleRfqPackageDocumentsLoading)window.DleRfqPackageDocumentsLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/rfqs/rfq-package-documents.js';script.onload=resolve;script.onerror=()=>{script.remove();window.DleRfqPackageDocumentsLoading=null;reject(Error('Approved document controls could not load. Retry.'));};document.head.append(script);});
    await window.DleRfqPackageDocumentsLoading;
  }
  const projectLabel=r=>r.libraryRfq?.displayId||r.intakeId;
  const requestLabel=r=>r.libraryRfq?.parentIntakeId||r.intakeId;
  const groupedOrder=(a,b)=>requestLabel(a).localeCompare(requestLabel(b),undefined,{numeric:true})||(a.libraryRfq?.lineNumber||0)-(b.libraryRfq?.lineNumber||0)||a.intakeId.localeCompare(b.intakeId);
  async function selectItem(id) {
    const generation=++selectionGeneration;selected=items.find(r=>r.intakeId===id)||null;
    if(!selected)return;
    const review=canReadiness()?await request('/api/sim/rfqs/'+encodeURIComponent(id)+'/final-review'):{approvals:[],approvalCurrent:false,summary:null,blockers:[]};
    if(generation!==selectionGeneration||selected?.intakeId!==id)return;
    selected={...selected,approvals:review.approvals,approvalCurrent:review.approvalCurrent,reviewSummary:review.summary,reviewBlockers:review.blockers};
    if(selected.workbenchEligible){const workspace=(await request('/api/sim/rfqs')).items.find(r=>r.intakeId===id);if(generation!==selectionGeneration||selected?.intakeId!==id)return;if(workspace)selected={...selected,lanes:workspace.lanes,inputs:workspace.inputs};else selected.workbenchEligible=false;}
  }
  let parentGroups=[];
  async function refresh() {
    mount?.setAttribute?.("aria-busy", "true");
    if (mount) mount.inert = true;
    try { const queue=await request('/api/sim/rfqs/commercial');const id=returnIntakeId||selected?.intakeId;items=queue.items;parentGroups=Array.isArray(queue.parentGroups)?queue.parentGroups:[];unavailableItems=Array.isArray(queue.unavailableItems)?queue.unavailableItems:[];if(items.some(r=>r.libraryRfq))await packageTools();await selectItem(id);returnIntakeId=null;error=''; }
    catch(e){error=e.message;}
    finally { if (mount) mount.inert = false; mount?.setAttribute?.('aria-busy', 'false'); }
    draw();
    if(returnMaterials&&selected?.intakeId===returnMaterials.intakeId){const next=returnMaterials;returnMaterials=null;await openMaterials(next.target);}
  }
  async function commercialAction(action){
    if(window.DleOsCapabilities?.can?.('technical_review.disposition')!==true||holdControls.some(control=>control.isBusy())||(action==='SUBMIT'&&heldSections(selected).length))return;
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
    if (!id||selected.libraryRfq) return;
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
  async function openMaterials(target=null,reviewParts=false) {
    if (mobileOverview()) return;
    try {
      if (!window.DleMaterialsWorkbench) {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'SRC/workspaces/rfqs/materials-workbench.css'; document.head.appendChild(link);
        await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'SRC/workspaces/rfqs/materials-workbench.js'; script.onload = resolve; script.onerror = () => reject(new Error('Materials could not load.')); document.head.appendChild(script); });
      }
      await window.DleMaterialsWorkbench.open(mount, selected, async () => { opened = null; await refresh(); },{target});
      if(reviewParts)mount.querySelector('[data-material-action="review-parts"]')?.click();
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
    if(!canReadiness())return;
    if (mobileOverview()) return;
    try {
      if (!window.DleQuotationFinalReview) {
        const link=document.createElement('link');link.rel='stylesheet';link.href='SRC/workspaces/rfqs/quotation-final-review.css';document.head.appendChild(link);
        await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/rfqs/quotation-final-review.js';script.onload=resolve;script.onerror=()=>reject(new Error('Final Review could not load.'));document.head.appendChild(script);});
      }
      await window.DleQuotationFinalReview.open(mount,selected,async()=>{opened=null;await refresh();},{onEditMaterials:target=>openMaterials(target),onReviewParts:()=>openMaterials(null,true)});
    }catch(e){error=e.message;draw();}
  }
  async function mountBomUpdates(host,rfq){try{if(!window.DleRfqBomUpdates){if(!window.DleRfqBomUpdatesLoading)window.DleRfqBomUpdatesLoading=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/SRC/workspaces/rfqs/bom-updates.js';s.onload=resolve;s.onerror=()=>{window.DleRfqBomUpdatesLoading=null;reject(Error('BOM update view unavailable.'));};document.head.append(s);});await window.DleRfqBomUpdatesLoading;}if(host.isConnected)await window.DleRfqBomUpdates.mount(host,rfq,()=>refresh());}catch(e){if(host.isConnected)host.textContent=e.message;}}
  async function render() {
    mount = document.querySelector('[data-workspace-mount="rfqs"]');
    if (!mount) return;
    if (document.body.dataset.simRuntime !== 'true') { mount.textContent = 'RFQs is available in SIM only.'; return; }
    selectionGeneration++;selected = null; opened = null; bucket = 'ACTIVE';
    mount.oninput = event => {
      if(!event.target.matches('[data-history-search]')) return;
      const position=event.target.selectionStart;historySearch=event.target.value;draw();
      const input=mount.querySelector('[data-history-search]');input.focus();input.setSelectionRange(position,position);
    };
    mount.onchange=event=>{if(event.target.matches('[data-rfq-sort]')){queueSort=event.target.value;draw();}};
    mount.onclick = async event => {
      const button = event.target.closest('button'); if (!button || saving || holdControls.some(control=>control.isBusy())) return;
      if(button.dataset.bucket){bucket=button.dataset.bucket;selectionGeneration++;selected=null;draw();return;}
      if(button.dataset.rfq){try{await selectItem(button.dataset.rfq);error='';}catch(e){error=e.message;}opened=null;draw();return;}
      if(button.dataset.commercial){await commercialAction(button.dataset.commercial);return;}
      if (button.dataset.open === 'intake-documents') { await openIntakeDocuments(); return; }
      if (button.dataset.open === 'materials') { await openMaterials(); return; }
      if (button.dataset.open === 'final-review') { await openFinalReview(); return; }
      if (button.dataset.open === 'labor') { await openLabor(); return; }
      if (button.dataset.action === 'queue') { selectionGeneration++;selected = null; opened = null; await refresh(); }
      if (button.dataset.action === 'refresh') await refresh();
      if (button.dataset.action === 'source') {
        if(selected.libraryRfq||window.DleOsCapabilities?.can?.('technical_review.view')!==true)return;
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
    if(!laneRequested(selected,key))return '<section class="rfqs-lane"><h2>'+name+'</h2><p>Not requested</p></section>';
    const control=createHoldControl({section:key,getRfq:()=>selected,isBlocked:()=>saving||holdControls.some(control=>control.isBusy()),apply:workspace=>{const holds=mergeHolds(selected.lanes,workspace.lanes);selected={...selected,...holds,lanes:{...selected.lanes,...holds}};const item=items.find(item=>item.intakeId===selected.intakeId);if(item)Object.assign(item,holds);},onUpdate:()=>{for(const control of holdControls)control.sync();const button=mount?.querySelector('[data-commercial="SUBMIT"]');if(button)button.disabled=saving||holdControls.some(item=>item.isBusy())||heldSections(selected).length>0||window.DleOsCapabilities?.can?.('technical_review.disposition')!==true;const note=mount?.querySelector('[data-rfq-review-note]');if(note)note.textContent=selected.libraryRfq?'Review the Materials and Labor totals for this assembly.':reviewNote(selected);}});holdControls.push(control);
    if (key === 'materials') return '<section class="rfqs-lane"><h2>Materials</h2><p class="rfqs-status" data-status="' + esc(value.status) + '">' + labels[value.status] + '</p>'+control.html()+'<p>' + selected.inputs.materials.candidate.rows.length + ' BOM rows</p><button data-open="materials"'+desktopOnly()+'>Open Materials</button><p>Save and complete the quotation in Materials.</p></section>';
    return '<section class="rfqs-lane"><h2>Labor</h2><p class="rfqs-status" data-status="' + esc(value.status) + '">' + labels[value.status] + '</p>'+control.html()+'<p>Operations, time and production instructions</p><button data-open="labor">Open Labor</button><p>Save and complete the quotation in Labor.</p></section>';
  }
  const money=v=>v==null?'—':Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const date=v=>window.DleDateFormat?.date(v,{timeZone:'America/Los_Angeles',empty:'\u2014'})??(v?new Date(v).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'}):'\u2014');
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
    if(r.libraryRfq)return '<section class="rfq-commercial-detail"><h2>Quote preparation</h2><p>Materials and Labor stay separate for '+esc(projectLabel(r))+'. Customer quote composition comes next.</p></section>';
    const c=r.commercial, latest=r.approvals?.at(-1), readonly=window.DleOsCapabilities?.can?.('technical_review.disposition')!==true;
    const canSubmit=!r.libraryRfq&&r.approvalCurrent&&latest&&latest.id!==c.approvalId&&['OPEN','SUBMITTED','EXPIRED'].includes(c.status);
    return '<section class="rfq-commercial-detail"><h2>Commercial Lifecycle</h2><div class="rfqs-current-status"><span>Current status</span><strong>'+esc(r.status)+'</strong></div>'+ (latest&&!r.approvalCurrent?'<p class="rfqs-approval-note">Historical approval retained. Current work requires final review before a new approval.</p>':'') +'<p class="rfqs-quote-reference"><span>Quotation reference</span><strong>'+esc(r.quoteNumber||'No approved quotation')+'</strong></p><p><strong>Recorded quote total</strong> &middot; '+money(r.quoteTotal)+'</p><p>Approved: '+date(r.approvedAt)+' · Submitted: '+date(c.submittedAt)+' · Expires: '+date(c.expiresAt)+' (Pacific time)</p>'+ (r.revisionNeeded?'<p role="alert">Revision needed. Submitted quotation remains unchanged. Current work: '+esc(r.workStatus)+'.</p>':'')+(canSubmit?'<button data-commercial="SUBMIT" '+(readonly||saving||heldSections(r).length?'disabled':'')+'>Mark Approved Quote Submitted</button><small>Records commercial submission and 30-day validity. Does not send customer communication.</small>':'')+(c.status==='SUBMITTED'&&r.status==='Expired'?'<button data-commercial="EXPIRE" '+(readonly||saving?'disabled':'')+'>Record Expiration</button>':'')+(c.closedAt?'<p>Closed: '+date(c.closedAt)+' · '+esc(c.closeReason)+'</p>':'')+(c.status==='AWARDED'&&!c.orderLinks?.length?'<p>Order handoff pending</p>':'')+'<details><summary>Lifecycle history ('+(c.history||[]).length+')</summary><ul>'+(c.history||[]).map(h=>'<li>'+esc(h.action)+' · '+esc(dateTimeUtc(h.at))+' · '+esc(h.actor)+' · '+esc(h.reason)+'</li>').join('')+'</ul></details><details><summary>Approval history ('+(r.approvals||[]).length+')</summary><ul>'+(r.approvals||[]).map(a=>'<li>Version '+a.version+' · '+esc(a.id)+' · '+date(a.approvedAt)+' · '+money(a.summary.quoteTotal)+'</li>').join('')+'</ul></details><details><summary>Order links ('+(c.orderLinks||[]).length+')</summary><ul>'+(c.orderLinks||[]).map(l=>'<li>'+esc(l.quoteNumber)+' · New Order: '+esc(l.newOrderIntakeId||'Pending')+' · SO: '+esc(l.salesOrderId||'Pending')+' · WO: '+esc(l.workOrderId||'Pending')+'</li>').join('')+'</ul></details></section>';
  }
  function draw(){
    document.body.dataset.rfqsMobileWorkbench = "false";
    holdControls=[];
    const inBucket=items.filter(r=>r.bucket===bucket);
    const rows=bucket==='HISTORY'?historyRows(inBucket,historySearch):inBucket.slice().sort((a,b)=>(queueSort==='ASSEMBLY'?(a.assemblies[0]?.assemblyNumber||'').localeCompare(b.assemblies[0]?.assemblyNumber||''):queueSort==='CUSTOMER'?(a.customer?.customerName||'').localeCompare(b.customer?.customerName||''):0)||groupedOrder(a,b));
    const sort=items.some(r=>r.libraryRfq)&&bucket!=='HISTORY'?'<label class="rfqs-queue-sort">Sort <select data-rfq-sort aria-label="Sort RFQ queue">'+[['REQUEST','Request / project'],['ASSEMBLY','Assembly'],['CUSTOMER','Customer']].map(([v,n])=>'<option value="'+v+'" '+(queueSort===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label>':'';
    const parentSummary=parentGroups.map(g=>'<p class="rfqs-approval-note">'+esc(g.parentIntakeId)+' · '+g.submittedLines+' of '+g.totalLines+' estimates submitted internally'+(g.manuallySentLines?' - '+g.manuallySentLines+' of '+g.totalLines+' lines sent manually':'')+(g.submittedLines&&g.submittedLines<g.totalLines?' · remaining lines pending':'')+'</p>').join('');
    const toggles=parentSummary+sort+'<div class="rfq-lifecycle-tabs" role="group" aria-label="RFQ lifecycle">'+['ACTIVE','SUBMITTED','HISTORY'].map(b=>'<button data-bucket="'+b+'" aria-pressed="'+(bucket===b)+'" class="'+(bucket===b?'active':'')+'">'+b+' <span>'+items.filter(r=>r.bucket===b).length+'</span></button>').join('')+'</div>';
    const columns=['RFQ / Quote Number','Customer','Assembly / Rev','Quoted qty','Quote Total',bucket==='HISTORY'?'History activity (Pacific)':'Submitted','Expires','Status','Materials','Labor','Customer PO / Order'];
    const table='<div class="rfqs-scroll"><table><thead><tr>'+columns.map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+[
      '<button data-rfq="'+esc(r.intakeId)+'">'+esc(projectLabel(r))+'</button>'+(r.libraryRfq?'<small>Request '+esc(r.libraryRfq.parentIntakeId.replace(/^RFQI-SIM-0*/,''))+'</small>':'<br>'+esc(r.quoteNumber||'-')),
      esc(r.customer.customerName),r.assemblies.map(a=>esc(a.assemblyNumber)+' / '+esc(a.revision)).join('<br>'),
      r.assemblies.map(a=>a.quantity).join('<br>'),money(r.quoteTotal),bucket==='HISTORY'?date(r.history?.activityAt)+'<small>'+esc(r.history?.activityLabel||'Date not recorded')+'</small>':date(r.commercial.submittedAt),date(r.commercial.expiresAt),
      esc(r.status)+(r.revisionNeeded?'<br><small>Revision needed</small>':''),sectionStatus(r,'materials'),sectionStatus(r,'labor'),linkedOrders(r)
    ].map((value,index)=>'<td data-label="'+columns[index]+'">'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    const historyTools=bucket==='HISTORY'?'<div class="rfqs-history-tools"><label>Search History<input type="search" data-history-search value="'+esc(historySearch)+'" placeholder="Quote, customer, assembly, PO or order"></label><p>Newest activity first · Pacific time. Awarded does not mean accepted or released.</p><small>'+rows.length+' of '+inBucket.length+' records</small></div>':'';
    const unavailable=bucket==='ACTIVE'&&unavailableItems.length?'<section class="rfqs-unavailable" aria-label="Projects needing attention">'+unavailableItems.map(r=>'<p><strong>'+esc(r.displayId)+'</strong> · '+esc(r.message||'The saved package is unavailable. Contact an administrator before continuing.')+'</p>').join('')+'</section>':'';
    const detail=selected?'<button data-action="queue">&larr; RFQ queue</button><div class="rfqs-context"><span class="rfqs-eyebrow">Customer</span><h2>'+esc(selected.customer.customerName)+'</h2>'+context(selected)+'<dl class="rfqs-identity"><div><dt>Intake</dt><dd>'+esc(selected.intakeId)+'</dd></div><div><dt>Intake status</dt><dd>'+esc(selected.intakeStatus)+'</dd></div><div><dt>Created</dt><dd>'+date(selected.createdAt)+'</dd></div><div><dt>Scope</dt><dd>'+esc(selected.scope.replaceAll('_',' '))+'</dd></div></dl><div class="rfqs-context-actions"><button data-action="source">View Intake / Technical Review</button><button data-open="intake-documents">Intake Documents</button></div></div><div data-intake-documents-host></div>'+((selected.history?.orders||[]).length?'<section class="rfqs-history-links"><h2>Linked customer orders</h2>'+linkedOrders(selected)+'</section>':'')+commercialDetail(selected)+(selected.workbenchEligible&&selected.inputs?'<p id="rfqsMobileScope" class="rfqs-mobile-scope"'+(mobileOverview()?'':' hidden')+'>Mobile View supports the RFQ overview and Labor. Use Desktop View for Materials and Quotation Final Review.</p>'+'<div class="rfqs-lanes">'+lane('Materials')+lane('Labor')+'</div><div class="rfqs-review-action"><button data-open="final-review"'+desktopOnly()+'>' +(selected.libraryRfq?'Quotation readiness':'Quotation Final Review')+'</button></div>':'<p>Materials and Labor become available after Technical Review qualification.</p>'):toggles+historyTools+unavailable+(rows.length?table:'<p>No '+bucket.toLowerCase()+' RFQs.</p>');
    mount.innerHTML='<section class="rfqs-workspace rfqs-overview"><header class="rfqs-overview-header"><h1>RFQs</h1><button data-action="refresh" '+(saving?'disabled':'')+'>Refresh</button></header>'+(error?'<p role="alert">'+esc(error)+'</p>':'')+detail+'</section>';
    if(window.DleOsCapabilities?.can?.('technical_review.view')!==true)mount.querySelectorAll('[data-action="source"],[data-open="intake-documents"],[data-commercial]').forEach(e=>e.remove());
    if(!canReadiness())mount.querySelectorAll('[data-open="final-review"]').forEach(e=>e.remove());
    for(const control of holdControls)control.bind(mount);
    if(selected){
      const root=mount.querySelector('.rfqs-overview'),context=root.querySelector('.rfqs-context'),commercial=root.querySelector('.rfq-commercial-detail');
      const reference=document.createElement('p');reference.className='rfqs-quote-reference';reference.textContent=(selected.quoteNumber||selected.intakeId)+' · '+selected.status;context.append(reference);
      const s=selected.reviewSummary;
      if(s){const summary=document.createElement('p');summary.className='rfqs-price-summary';summary.textContent='Total quote '+money(s.quoteTotal)+' · Unit price '+money(s.combinedUnitPrice)+' · '+(selected.approvalCurrent?('Quoted delivery '+(selected.approvals.at(-1)?.answers.delivery||'Not set')):('Suggested lead '+(s.suggestedLeadDays==null?'Not available':s.suggestedLeadDays+' days')));context.append(summary);}
      if(selected.libraryRfq){
        const b=selected.libraryRfq,reference=document.createElement('p');reference.className='rfqs-package-reference';reference.textContent=projectLabel(selected)+' · Request '+b.parentIntakeId.replace(/^RFQI-SIM-0*/,'')+' · Approved package v'+b.packageVersion+' · BOM v'+b.bomVersion;context.append(reference);
        if(selected.bomUpdateContractVersion===1){const updates=document.createElement('section');context.append(updates);void mountBomUpdates(updates,selected);}
        context.querySelector('.rfqs-identity')?.remove();context.querySelector('.rfqs-context-actions')?.remove();root.querySelector('[data-intake-documents-host]')?.remove();
        const docs=document.createElement('section');docs.className='rfqs-approved-documents';const mat=document.createElement('div'),lab=document.createElement('div');docs.append(mat,lab);root.append(docs);window.DleRfqPackageDocuments?.mount(mat,selected,'materials');window.DleRfqPackageDocuments?.mount(lab,selected,'labor');
      }
      const technical=document.createElement('details');technical.className='rfqs-secondary';technical.innerHTML='<summary>Intake and technical documents</summary>';
      for(const node of [...context.querySelectorAll('.rfqs-identity,.rfqs-context-actions')])technical.append(node);
      const intakeHost=root.querySelector('[data-intake-documents-host]');if(intakeHost)technical.append(intakeHost);if(!selected.libraryRfq)root.append(technical);
      const audit=document.createElement('details');audit.className='rfqs-secondary';audit.innerHTML='<summary>Quote history and commercial details</summary>';audit.append(commercial);root.append(audit);
      const review=root.querySelector('.rfqs-review-action');if(review){const note=document.createElement('p');note.dataset.rfqReviewNote='';note.textContent=reviewNote(selected);review.prepend(note);}
    }

  }
  document.addEventListener('dle:view-mode-change', syncMobileBoundary);
  window.DleWorkspaces = window.DleWorkspaces || {};
  document.addEventListener('dle:workspace-navigation', event => {
    if (event.detail?.workspace?.id === 'rfqs' && event.detail?.requestedState?.intakeId){const state=event.detail.requestedState;returnIntakeId=state.intakeId;if(state.open==='materials'){returnMaterials={intakeId:state.intakeId,target:state.materialsTarget||null};if(mount?.dataset.workspaceLoaded==='true'&&document.body.dataset.workspaceView==='rfqs')void refresh();}}
  });
  window.DleWorkspaces.rfqs = Object.freeze({id:'rfqs', render, refresh});
})(window, document);

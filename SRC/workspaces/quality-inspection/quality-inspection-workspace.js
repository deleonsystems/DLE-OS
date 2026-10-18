(function(window, document) {
  'use strict';
  const ID = 'quality-inspection';
  const state = { rows:[], filter:'ALL', search:'', loading:false, error:'', selected:null, packet:null, order:null, token:0 };
  const assets = new Map();
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value ?? '');
  const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {KIT_COMPLETE:'Kit Complete',KIT_SHORT:'Kit Short',NEEDS_KITTING:'Needs Kitting',KITTING_IN_PROGRESS:'Kitting In Progress',NEEDS_REKIT:'Needs Re-kit'};
  const inspectionLabel = row => row.inspectionStatus === 'AWAITING_INSPECTION' ? 'Awaiting Inspection' : 'Not Yet Submitted';
  const mount = () => document.querySelector('[data-workspace-mount="'+ID+'"]');
  const permitted = () => !!window.DleWorkspaceRegistry?.getById(ID) &&
    ['order_entry.view','kitting.view','work_orders.view'].every(p => window.DleOsCapabilities?.can?.(p));
  const active = token => state.token === token && document.body.dataset.workspaceView === ID && permitted();
  function buildRows(model) {
    const rows = new Map();
    for (const key of ['needsKitting','kittingInProgress','needsRekit','kitShort','kitComplete']) {
      for (const row of list(model?.queues?.[key])) {
        if (!row.workOrderNumber || !row.canonicalWorkOrder) continue;
        if (rows.get(row.workOrderNumber)?.materialStatus === 'KIT_SHORT' && row.materialStatus !== 'KIT_SHORT') continue;
        rows.set(row.workOrderNumber, {...row, inspectionStatus:'NOT_SUBMITTED'});
      }
    }
    // No durable Production-to-Inspection handoff contract exists in this slice.
    // Never derive inspection state from material completeness or operations.
    return [...rows.values()].sort((a,b) => text(a.earliestDueDate).localeCompare(text(b.earliestDueDate)) || text(a.workOrderNumber).localeCompare(text(b.workOrderNumber)));
  }
  function filteredRows(rows, filter, search) {
    const term = text(search).trim().toLowerCase();
    return rows.filter(row => (filter !== 'AWAITING' || row.inspectionStatus === 'AWAITING_INSPECTION') &&
      (filter !== 'SHORT' || row.materialStatus === 'KIT_SHORT') &&
      (filter !== 'COMPLETE' || row.materialStatus === 'KIT_COMPLETE') &&
      [row.workOrderNumber,row.customerName,row.customerNumber,row.assemblyItemNumber,row.revision,
        ...list(row.relatedLines).map(l=>l.customerPurchaseOrderNumber)].join(' ').toLowerCase().includes(term));
  }
  function statuses(row) {
    const complete=row.materialStatus==='KIT_COMPLETE',short=row.materialStatus==='KIT_SHORT';
    const symbol=complete?'&#10003;':short?'&#9888;&#65038;':'';
    return '<span class="qi-material '+(complete?'qi-complete':short?'qi-short':'')+'">'+
      (symbol?'<span class="qi-material-symbol" aria-hidden="true">'+symbol+'</span>':'')+
      esc(labels[row.materialStatus]||row.materialStatus||'Unavailable')+'</span>';
  }
  function rowHtml(row) {
    return '<tr'+(row.inspectionStatus==='AWAITING_INSPECTION'?' class="qi-awaiting"':'')+' data-qi-row="'+esc(row.workOrderNumber)+'">'+
      '<td><strong>'+esc(row.workOrderNumber)+'</strong></td>'+
      '<td>'+esc(row.assemblyItemNumber)+'<small>Rev '+esc(row.revision||'—')+'</small></td><td>'+esc(row.canonicalWorkOrderQuantity??'—')+'</td>'+
      '<td>'+esc(text(row.earliestDueDate).slice(0,10)||'—')+'</td><td>'+esc(row.customerName||row.customerNumber)+'</td><td>'+statuses(row)+'</td><td><span class="qi-inspection">'+inspectionLabel(row)+'</span></td>'+
      '<td><button type="button" data-qi-open="'+esc(row.workOrderNumber)+'">Open job</button></td></tr>';
  }
  function draw() {
    const host = mount(); if (!host) return;
    if (!permitted()) {host.innerHTML='<p role="status">Your current role or view does not allow access to inspection jobs.</p>';return;}
    host.innerHTML='<div class="qi-workspace"><header><div><h1>QC - Inspection</h1><p>Review job packets ahead of inspection. Opening a job does not submit or start inspection.</p></div>'+
      '<button type="button" data-qi-refresh '+(state.loading?'disabled':'')+'>Refresh jobs</button></header>'+
      (state.error?'<p role="alert">'+esc(state.error)+'</p>':'')+
      (state.selected?detailHtml():queueHtml())+'</div>';
    host.querySelector('[data-qi-refresh]').onclick=()=>{state.selected=null;void refresh();};
    host.querySelector('[data-qi-filter]')?.addEventListener('change',e=>{state.filter=e.target.value;draw();});
    host.querySelector('[data-qi-search]')?.addEventListener('input',e=>{state.search=e.target.value;drawRows();});
    host.querySelectorAll('[data-qi-open]').forEach(b=>b.onclick=()=>void openJob(b.dataset.qiOpen));
    host.querySelector('[data-qi-back]')?.addEventListener('click',backToJobs);
    host.querySelector('[data-qi-slides]')?.addEventListener('click',e=>void slides(e.currentTarget));
    host.querySelector('[data-qi-bom]')?.addEventListener('click',()=>void bom());
  }
  function queueHtml() {
    return '<div class="qi-controls"><label>Show<select data-qi-filter>'+[['ALL','All Jobs'],['AWAITING','Awaiting Inspection'],['SHORT','Kit Short'],['COMPLETE','Kit Complete']].map(([v,l])=>'<option value="'+v+'"'+(state.filter===v?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
      '<label>Search<input type="search" data-qi-search value="'+esc(state.search)+'" placeholder="Work Order, assembly, customer, PO"></label></div>'+
      (state.loading?'<p role="status">Loading jobs…</p>':'')+'<div data-qi-rows>'+tableHtml()+'</div>';
  }
  function tableHtml() {
    const rows=filteredRows(state.rows,state.filter,state.search);
    if (!rows.length) return '<p role="status">'+(state.loading?'Checking current job data…':state.filter==='AWAITING'?'No jobs have been submitted for inspection.':'No matching jobs.')+'</p>';
    return '<div class="qi-table-scroll"><table><caption class="qi-sr">Open inspection jobs</caption><thead><tr>'+['Work Order','Assembly / Rev','Qty','Due','Customer','Material Status','Inspection Status',''].map(l=>'<th scope="col">'+l+'</th>').join('')+'</tr></thead><tbody>'+rows.map(rowHtml).join('')+'</tbody></table></div>';
  }
  function drawRows() { const host=mount();host.querySelector('[data-qi-rows]').innerHTML=tableHtml();host.querySelectorAll('[data-qi-open]').forEach(b=>b.onclick=()=>void openJob(b.dataset.qiOpen)); }
  function safeDocumentUrl(value) {
    try {const url=new URL(value,window.location.href);return url.origin===window.location.origin && /^\/api\/(production\/v1\/work-orders\/[^/]+\/documents\/|sim\/(new-orders|rfq-intakes)\/[^/]+\/documents\/)/.test(url.pathname)?url.href:null;}catch{return null;}
  }
  function backToJobs() {
    const wo=state.selected?.workOrderNumber;++state.token;state.selected=null;state.packet=null;state.order=null;state.loading=false;state.error='';draw();
    [...(mount()?.querySelectorAll('[data-qi-open]')||[])].find(b=>b.dataset.qiOpen===wo)?.focus();
  }
  function detailHtml() {
    const row=state.selected;
    return '<section class="qi-detail"><button type="button" data-qi-back>Back to jobs</button><h2 tabindex="-1" data-qi-heading>WO '+esc(row.workOrderNumber)+' - '+esc(row.assemblyItemNumber)+'</h2><p>'+statuses(row)+' <span class="qi-inspection">'+inspectionLabel(row)+'</span></p><p role="status">'+(state.loading?'Opening read-only traveler and slides…':state.error?'Slides could not be opened. Return to jobs and try again.':'Read-only slides are open.')+'</p></section>';
  }
  async function get(url) {
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
    if (!response.ok) throw Error(response.status===404?'The job packet is not available yet.':'Job data could not be loaded. Refresh and try again.');
    return response.json();
  }
  async function refresh() {
    if(!permitted())return draw(); const token=++state.token;state.loading=true;state.error='';state.rows=[];draw();
    try {const loader=window.DleWorkspaces?.kitting?.loadReadModel;if(!loader)throw Error('Job data is unavailable. Refresh the page.');
      const model=await loader({forceMaterialStatus:true});if(!active(token))return;if(!model?.queues)throw Error('Job data is unavailable. Refresh and try again.');state.rows=buildRows(model);
    }catch(e){if(active(token))state.error=e.message;}finally{if(active(token)){state.loading=false;draw();}}
  }
  async function openJob(wo) {
    const row=state.rows.find(r=>r.workOrderNumber===wo);if(!permitted()||!row)return;
    const token=++state.token;state.selected=row;state.packet=null;state.order=null;state.error='';state.loading=true;draw();mount().querySelector('[data-qi-heading]')?.focus();
    try {const packet=await get('/api/production/v1/work-orders/'+encodeURIComponent(wo));if(!active(token))return;
      if(packet.workOrderNumber!==wo)throw Error('The returned packet does not match this Work Order.');state.packet=packet;
      if(packet.materialStatus)state.selected={...row,materialStatus:packet.materialStatus};
      if(packet.source?.acceptedIntakeId){
        const order=await get('/api/sim/order-entry/'+encodeURIComponent(packet.source.acceptedIntakeId));if(!active(token))return;
        if(order.orderEntry?.acceptance?.id!==packet.source.acceptanceId||order.orderEntry.acceptance.packageRevision!==packet.source.acceptedRevision)throw Error('The customer packet changed. Refresh and reopen this job.');
        state.order=order;
      }
      if(active(token))await slides(mount().querySelector('[data-qi-back]'));
    }catch(e){if(active(token))state.error=e.message;}finally{if(active(token)){state.loading=false;draw();}}
  }
  function loadAsset(url, style=false) {
    if(assets.has(url))return assets.get(url);
    const promise=new Promise((resolve,reject)=>{const el=document.createElement(style?'link':'script');if(style){el.rel='stylesheet';el.href=url;}else el.src=url;el.onload=resolve;el.onerror=()=>{assets.delete(url);el.remove();reject(Error('The document viewer could not load. Try again.'));};document.head.append(el);});assets.set(url,promise);return promise;
  }
  async function bom() {
    const token=state.token,packet=state.packet;if(!permitted()||!packet)return;
    try {if(!window.DleWorkspaces?.production?.renderBom)await loadAsset('/SRC/workspaces/production/production-workspace.js');await loadAsset('/SRC/workspaces/production/production-workspace.css',true);
      if(active(token))mount().querySelector('[data-qi-viewer]').innerHTML=window.DleWorkspaces.production.renderBom(packet);
    }catch(e){if(active(token)){state.error=e.message;draw();}}
  }
  async function slides(button) {
    const token=state.token,p=state.packet;if(!permitted()||!p)return;button.disabled=true;
    try {const intake=p.source?.acceptedIntakeId;if(!intake)throw Error('Slides are not available for this packet.');
      const order=await get('/api/sim/order-entry/'+encodeURIComponent(intake));
      if(order.orderEntry?.acceptance?.id!==p.source.acceptanceId||order.orderEntry.acceptance.packageRevision!==p.source.acceptedRevision)throw Error('The packet changed. Reopen this job.');
      if(!window.DleJobInstructions)await loadAsset('/SRC/workspaces/kitting/production-instruction-editor.js');if(!active(token))return;
      const opened=await window.DleJobInstructions.open({wo:p.workOrderNumber,job:{context:p.context},order,quality:true,readOnly:true,trigger:button,startAtTraveler:true,backLabel:'Back to jobs',isCurrent:()=>active(token),onExit:()=>{if(active(token))backToJobs();},onViewerMount:(dialog,heading)=>{const info=document.createElement('div');info.className='qi-viewer-context';info.innerHTML='<strong>WO '+esc(p.workOrderNumber)+' · '+esc(p.context?.assembly||state.selected.assemblyItemNumber)+' · Rev '+esc(p.context?.revision||state.selected.revision||'-')+'</strong> '+statuses(state.selected)+' <span class="qi-inspection">'+inspectionLabel(state.selected)+'</span>';heading.after(info);dialog.classList.add('qi-slides-viewer');dialog.addEventListener('cancel',e=>{e.preventDefault();dialog.querySelector('[data-back]')?.click();});}});
      if(opened===false)throw Error('Slides are not available for this packet.');
    }catch(e){if(active(token)){state.error=e.message;draw();}}finally{button.disabled=false;}
  }
  function render(){if(!permitted()){++state.token;return draw();}state.selected=null;state.packet=null;return refresh();}
  document.addEventListener('dle:workspace-change',e=>{if(e.detail?.workspace?.id!==ID)++state.token;});
  document.addEventListener('dle:view-mode-change',()=>{if(document.body.dataset.workspaceView===ID&&!permitted()){++state.token;draw();}});
  document.addEventListener('dle:capabilities-ready',()=>{if(document.body.dataset.workspaceView===ID&&!permitted()){++state.token;draw();}});
  window.DleWorkspaces=window.DleWorkspaces||{};
  window.DleWorkspaces[ID]=Object.freeze({id:ID,render,refresh,buildRows,filteredRows,rowHtml});
})(window,document);

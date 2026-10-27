(function(window,document){
  'use strict';
  let mount,items=[],selected=null,mode='review',search='',error='',busy=false,pending=null,handoff=null,handoffError='',prepared=null;
  const labels={READY_FOR_VPRO:'Ready for VPRO',IN_PROGRESS:'In Progress',READY_FOR_OPERATIONS_SYNC:'Ready for Operations Sync — Awaiting simulated Operations recognition',AWAITING_ACCEPTANCE:'Awaiting Acceptance',RELEASED_TO_OPERATIONS:'Released to Operations'};
  const checks={ASSEMBLY_ITEM:'Assembly item exists in VPRO 5',COMPONENT_ITEMS:'Component item masters verified / created without duplicates',BOM:'VPRO 5 BOM created / verified against approved DLE-OS BOM',SALES_ORDER:'Sales Order entered',WORK_ORDER:'Work Order issued'};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'')?x.slice(5,7)+'/'+x.slice(8,10)+'/'+x.slice(0,4):'Not entered';
  const can=p=>window.DleOsCapabilities?.can?.(p)===true;
  async function api(path='',body){const response=await window.DleIntegration.request('/api/quoting/v1/order-entry'+path,{credentials:'include',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw new Error(result.message||'Order Entry is unavailable.');return result;}
  async function select(id){
    const next=await api('/'+encodeURIComponent(id));
    if(prepared&&(prepared.intakeId!==next.intakeId||prepared.bridgeRevision!==next.orderEntry?.bridge.revision))prepared=null;
    selected=next;handoff=null;handoffError='';
    if(selected.orderEntry)try{handoff=await api('/'+encodeURIComponent(id)+'/operations-handoff');}catch(e){handoffError=e.message;}
  }
  async function refresh(){try{items=(await api()).items;if(selected)await select(selected.intakeId);error='';}catch(e){error=e.message;}draw();}
  const fields=section=>'<section><h3>'+esc(section.title)+'</h3><dl>'+section.fields.map(f=>'<div><dt>'+esc(f.label)+'</dt><dd>'+esc(f.value)+'</dd></div>').join('')+'</dl></section>';
  const files=docs=>docs.map(d=>'<a target="_blank" rel="noopener noreferrer" href="'+esc(d.url)+'">View '+esc(d.name)+' ('+esc(d.type)+')</a>').join('');
  function bomTable(){return '<table><thead><tr><th>Line</th><th>Approved P/N</th><th>Description</th><th>Qty / Assy</th><th>Total Requirement</th></tr></thead><tbody>'+selected.bom.map(r=>'<tr><td>'+esc(r.line)+'</td><td>'+esc(r.approvedPartNumber)+(r.customerSupply?'<small>C/S (Customer supplied) · Customer P/N '+esc(r.customerSupply.customerPartNumber)+'</small>':'')+'</td><td>'+esc(r.description)+'</td><td>'+r.quantityPerAssembly+'</td><td>'+r.totalRequirement+'</td></tr>').join('')+'</tbody></table>';}
  const recognitionLabel=value=>{
    const status=typeof value==='string'?value:value?.status;
    if(['RECOGNIZED','RECOGNIZED_IN_SIM_OPERATIONS'].includes(status))return 'Recognized in SIM Operations';
    if(['IMPORTED_ACK_PENDING','ACK_PENDING','IMPORTED_PENDING_ACKNOWLEDGMENT'].includes(status))return 'Imported — bridge acknowledgment pending';
    return value?.message||status||'Awaiting SIM Operations recognition';
  };
  const isRecognized=()=>recognitionLabel(handoff?.recognition)==='Recognized in SIM Operations';
  const factList=entries=>'<dl>'+entries.filter(([,value])=>value!==undefined).map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value??'Not set')+'</dd></div>').join('')+'</dl>';
  function operationsHandoff(){
    const state=selected.orderEntry.bridge.state,allowed=handoff?.enabled===true&&handoff?.canImport===true&&can('order_entry.sim_import');
    const ready=state.status==='READY_FOR_OPERATIONS_SYNC'&&!state.holdReason;
    let content='<section class="oe-handoff" aria-label="Operations Handoff"><h3>Operations Handoff</h3><p class="oe-development"><strong>DEVELOPMENT ONLY</strong><span>SIMULATED VPRO 5 DATA</span></p>'+factList([['ERP Source','VPRO 5 — SIM'],['Bridge Status',state.status],['Recognition',recognitionLabel(handoff?.recognition)]]);
    if(handoff?.receipt?.packet?.workOrder?.workOrderStatus==='AWAITING_RELEASE')return content+'<h4>Awaiting Release</h4><p>SIM VPRO entry is recorded. Quality packet review is pending. Kitting and production are blocked.</p></section>';
    if(handoffError)return content+'<p role="alert">'+esc(handoffError)+'</p><p>Refresh to check the SIM handoff. Import is unavailable until its safeguards are verified.</p></section>';
    if(!handoff?.enabled)return content+'<p>The developmental SIM Operations adapter is disabled.</p></section>';
    if(handoff?.scopeSupported===false)return content+'<p>'+esc(handoff.scopeMessage)+'</p></section>';
    content+='<p>Prepare a read-only dry run, review its simulated facts, then explicitly import that exact validated packet into SIM Operations.</p>';
    if(recognitionLabel(handoff?.recognition)==='Imported — bridge acknowledgment pending')content+='<p role="alert">Canonical import succeeded. Prepare again to recover the saved packet, then retry Import to record bridge acknowledgment without duplicating Operations records.</p>';
    if(!allowed)content+='<p>Preparing or importing a developmental packet requires SIM import permission.</p>';
    if(!ready)content+='<p>Complete the bridge checks and return it to Ready for Operations Sync before preparing a packet.</p>';
    content+='<button data-action="prepare-operations" '+(!allowed||!ready||busy||isRecognized()?'disabled':'')+'>Prepare SIM Operations Packet</button>';
    if(prepared){
      const result=prepared.result,p=result.packet||{},v=result.validation||{},line=p.orderLine||{},wo=p.workOrder||{},expired=result.expiresAt&&Date.parse(result.expiresAt)<=Date.now();
      const pass=v.status==='PASS',relationship=typeof v.relationship==='object'?v.relationship.status||v.relationship.resolution||v.relationship.result:v.relationship;
      content+='<div class="oe-packet"><h4>Prepared packet</h4>'+factList([['Packet',String(p.packetId||'')+' / v'+(p.schemaVersion??'')],['Validation',v.status||'BLOCKED'],['Relationship (derived)',relationship||'Unresolved'],['Source package revision',p.source?.acceptedRevision??selected.packageRevision],['Bridge revision',prepared.bridgeRevision]]);
      content+='<h4>Records and simulated facts</h4>';
      if(v.records?.length)content+='<div class="oe-table-scroll"><table><thead><tr><th>Record</th><th>Canonical identity</th><th>Action</th></tr></thead><tbody>'+v.records.map(record=>'<tr><td>'+esc(record.recordType)+'</td><td>'+esc(record.identity)+'</td><td>'+esc(record.action)+'</td></tr>').join('')+'</tbody></table></div>';
      content+=factList([['Sales Order',line.salesOrderNumber],['SO Line',line.lineNumber],['Work Order',wo.workOrderNumber],['Quantity ordered',line.quantityOrdered],['Opening ERP open quantity',line.erpQuantityOpen],['Opening shipped quantity',line.openingShippedQuantity],['WO scheduled quantity',wo.scheduledQuantity],['ERP order date',line.orderDate?date(line.orderDate):'Not set'],['WO opened date',wo.openedDate?date(wo.openedDate):'Not set'],['Reviewed customer due date',date(line.customerDueDate)],['Estimated ship date',line.estimatedShipDate?date(line.estimatedShipDate):'Not set'],['WO type',wo.workOrderType],['WO status',wo.workOrderStatus]]);
      content+='<p class="oe-muted">Opening ERP quantities and WO facts are explicitly simulated. The reviewed customer due date remains separate from estimated ship date.</p>';
      if(line.simulatedFacts?.length)content+='<ul class="oe-muted">'+line.simulatedFacts.map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>';
      if(v.warnings?.length)content+='<div class="oe-warnings"><h4>Warnings</h4><ul>'+v.warnings.map(w=>'<li>'+esc(typeof w==='string'?w:w.message||JSON.stringify(w))+'</li>').join('')+'</ul></div>';
      if(v.errors?.length)content+='<div role="alert"><h4>Blocking errors</h4><ul>'+v.errors.map(e=>'<li>'+esc(typeof e==='string'?e:e.message||JSON.stringify(e))+'</li>').join('')+'</ul></div>';
      if(expired)content+='<p role="alert">Validation expired. Prepare a fresh packet before importing.</p>';
      content+='<details><summary>Packet evidence / audit details</summary><pre>'+esc(JSON.stringify(p,null,2))+'</pre></details><button data-action="import-operations" '+(!allowed||!ready||busy||!pass||!result.validationToken||expired||isRecognized()?'disabled':'')+'>Import to SIM Operations</button></div>';
    }
    const receipt=handoff?.receipt;
    if(receipt)content+='<details><summary>SIM import receipt</summary><pre>'+esc(JSON.stringify(receipt,null,2))+'</pre></details>';
    return content+'<p class="oe-muted">This handoff does not release the bridge, create a Kitting case, or start production.</p></section>';
  }
  function detail(){
    const s=selected,entry=s.orderEntry,bridge=entry?.bridge,state=bridge?.state,editable=can('order_entry.manage')&&!busy&&state?.status!=='RELEASED_TO_OPERATIONS';
    const review='<details '+(!entry?'open':'')+'><summary>'+(entry?'Accepted New Order evidence':'Review exact submitted package')+' · revision '+s.packageRevision+'</summary>'+s.review.sections.map(fields).join('')+'<p>'+esc(s.review.notice)+'</p>'+(entry?'<p>Accepted by '+esc(entry.acceptance.actor)+' · '+esc(entry.acceptance.at)+'<br>'+esc(entry.acceptance.note)+'</p>':'')+'</details>';
    const documents='<section class="oe-docs"><h3>Order Entry Package</h3><a target="_blank" rel="noopener noreferrer" href="/api/quoting/v1/order-entry/'+encodeURIComponent(s.intakeId)+'/review.pdf">View / Print Review Report</a>'+files(s.review.poDocuments)+files(s.review.technicalDocuments)+'</section>';
    const bom='<details><summary>Approved DLE-OS BOM · '+s.bom.length+' rows</summary>'+bomTable()+'<button data-action="print-bom">Print Approved BOM</button><p>Approved alternatives are shown together; no substitution is selected here. Not-fitted rows have zero total requirement.</p></details>';
    if(!entry)return '<button data-action="back">Back to queue</button><h2>'+esc(s.intakeId)+' — Final New Order Acceptance</h2>'+review+documents+bom+'<section><h3>Acceptance decision</h3>'+(s.blockers.length?'<ul>'+s.blockers.map(b=>'<li>'+esc(b)+'</li>').join('')+'</ul>':'<p>Package guards pass. Acceptance freezes this revision and creates one VPRO bridge record.</p>')+'<label>Acceptance note (optional)<textarea name="accept-note" maxlength="4000"></textarea></label><label><input type="checkbox" name="accept-confirm"> I accept this exact reviewed New Order package for Order Entry.</label><button data-action="accept" '+(!can('order_entry.accept')||s.blockers.length||busy?'disabled':'')+'>Accept New Order &amp; Queue for VPRO</button></section>';
    const packageData=entry.acceptance.package,line=packageData.facts.lines[0],quote=packageData.quote?.reference;
    const identity=fields({title:'Order identity',fields:[['Customer',s.customer.customerName],['Customer PO',packageData.poNumber],['Source RFQ',quote?.intakeId],['Source Quote',quote?.quoteNumber],['New Order Intake',s.intakeId],['Assembly / Rev',line.assembly+' / '+line.revision],['Quantity',line.quantity],['Customer Due Date',date(line.customerDueDate)]].map(([label,value])=>({label,value}))});
    const ids=state.identifiers||{},locked=!editable||state.status==='READY_FOR_OPERATIONS_SYNC';
    return '<button data-action="back">Back to queue</button><h2>'+esc(s.intakeId)+' · '+esc(isRecognized()&&state.status==='READY_FOR_OPERATIONS_SYNC'?'Ready for Operations Sync · Recognized in SIM Operations':labels[state.status])+'</h2><p class="oe-sim">SIM ONLY — checklist attestations and identifiers are synthetic. Developmental import is explicitly controlled in Operations Handoff.</p>'+identity+review+documents+bom+
      '<section><h3>VPRO 5 Checklist</h3><p>Item-master existence does not mean material is in stock.</p>'+Object.entries(checks).map(([key,label])=>'<label class="oe-check"><input type="checkbox" data-check="'+key+'" '+(state.completed.includes(key)?'checked':'')+' '+(locked?'disabled':'')+'> '+label+'</label>').join('')+'</section>'+
      '<section><h3>Synthetic ERP Identifiers</h3><dl><div><dt>ERP Source</dt><dd>VPRO 5 &mdash; SIM</dd></div></dl><div class="oe-identifiers">'+[['salesOrder','Sales Order Number',ids.salesOrder],['salesOrderLine','Sales Order Line',ids.salesOrderLine],['workOrder','Work Order Number',ids.workOrder]].map(([name,label,value])=>'<label>'+label+'<input name="'+name+'" value="'+esc(value)+'" maxlength="80" '+(!editable?'disabled':'')+'></label>').join('')+'</div><p>Enter the identifiers created in VPRO 5. Leading zeros are preserved.</p><button data-action="identifiers" '+(!editable?'disabled':'')+'>Record identifiers</button></section>'+
      '<section><h3>Corrections / Hold</h3><label>Reason (required for corrections, reopening or holds)<textarea name="bridge-reason" maxlength="4000"></textarea></label>'+(state.holdReason?'<p role="alert">Hold: '+esc(state.holdReason)+'</p>':'')+'<button data-command="HOLD" '+(locked?'disabled':'')+'>Place on hold</button><button data-command="CLEAR_HOLD" '+(locked||!state.holdReason?'disabled':'')+'>Clear hold</button><button data-command="REOPEN" '+(!editable||state.status!=='READY_FOR_OPERATIONS_SYNC'?'disabled':'')+'>Reopen with reason</button></section>'+
      '<section><h3>Bridge readiness</h3><button data-command="READY" '+(locked||state.holdReason||!state.identifiers||s.checklist.some(k=>!state.completed.includes(k))?'disabled':'')+'>Ready for Operations Sync</button><p>Checklist completion alone does not establish Operations recognition.</p></section>'+operationsHandoff()+
      '<details><summary>Bridge audit history</summary><ol>'+bridge.history.map(h=>'<li>'+esc(h.action)+' · '+esc(h.actor)+' · '+esc(h.at)+(h.reason?' · '+esc(h.reason):'')+'</li>').join('')+'</ol></details>';
  }
  const activeStates=['READY_FOR_VPRO','IN_PROGRESS','READY_FOR_OPERATIONS_SYNC'];
  const activeItems=()=>items.filter(r=>r.accepted&&activeStates.includes(r.status));
  function draw(){
    if(!mount)return;
    const stageRows=mode==='bridge'?activeItems():items.filter(r=>!r.accepted);
    const words=search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows=stageRows.filter(r=>words.every(w=>[r.customer,r.poNumber,r.intakeId,r.assembly,r.revision].join(' ').toLowerCase().includes(w)));
    const queue='<nav class="oe-stages" aria-label="Order Entry stages">'+[['review','Awaiting Acceptance',items.filter(r=>!r.accepted).length],['bridge','Active',activeItems().length]].map(([key,label,count])=>'<button data-mode="'+key+'" aria-pressed="'+(mode===key)+'" class="'+(mode===key?'active':'')+'">'+label+'<strong>'+count+'</strong></button>').join('')+'</nav>'+
      '<div class="oe-queue-tools"><label for="oe-search">Search '+(mode==='review'?'Awaiting Acceptance':'Active')+'<input id="oe-search" type="search" value="'+esc(search)+'" placeholder="Customer, PO, source order or assembly"></label><button data-action="refresh" '+(busy?'disabled':'')+'>Refresh</button></div><h2 class="oe-queue-title">'+(mode==='review'?'Submitted packages awaiting acceptance':'Accepted orders in progress')+'</h2>'+
      (rows.length?'<div class="oe-table-scroll oe-queue-table"><table><thead><tr><th>Customer</th><th>PO / Source New Order</th><th>Assembly / Rev</th><th>Qty</th><th>Due Date</th><th>Status</th><th>Action</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.customer)+'</td><td>'+esc(r.poNumber)+'<br><small>'+esc(r.intakeId)+'</small></td><td>'+esc(r.assembly)+' / '+esc(r.revision)+'</td><td>'+esc(r.quantity)+'</td><td>'+date(r.customerDueDate)+'</td><td>'+esc(r.status==='READY_FOR_OPERATIONS_SYNC'?'Ready for Operations Sync':labels[r.status]||r.status)+'</td><td><button data-id="'+esc(r.intakeId)+'">Open</button></td></tr>').join('')+'</tbody></table></div>':search.trim()?'<p class="oe-empty">No matching orders in this stage.</p>':'<p class="oe-empty">No '+(mode==='bridge'?'active accepted orders':'submitted packages awaiting acceptance')+'. Drafts remain in Intake.</p>');
    mount.innerHTML='<div class="order-entry-workspace"><header class="oe-header"><div><h1>Order Entry</h1><p>Review submitted packages, then manage accepted orders through the VPRO 5 bridge.</p></div>'+ (selected?'<button data-action="refresh" '+(busy?'disabled':'')+'>Refresh</button>':'')+'</header>'+(error?'<p role="alert">'+esc(error)+'</p>':'')+(selected?detail():queue)+'</div>';
    if(!selected){const labels=['Customer','PO / Source New Order','Assembly / Rev','Qty','Due Date','Status','Action'];mount.querySelectorAll('.oe-queue-table tbody tr').forEach(row=>Array.from(row.cells).forEach((cell,i)=>cell.dataset.label=labels[i]));}
  }
  async function mutate(path,body){const key=selected.intakeId+path+JSON.stringify(body);if(pending?.key!==key)pending={key,body:{...body,requestId:window.crypto.randomUUID()}};busy=true;error='';try{await api('/'+encodeURIComponent(selected.intakeId)+path,pending.body);pending=null;await refresh();}catch(e){error=e.message;}finally{busy=false;draw();}}
  async function prepareOperations(){
    if(!handoff?.enabled||!handoff?.canImport||!can('order_entry.sim_import'))throw new Error('SIM import permission and the developmental feature are required.');
    if(selected.orderEntry.bridge.state.status!=='READY_FOR_OPERATIONS_SYNC'||selected.orderEntry.bridge.state.holdReason||isRecognized())throw new Error('Preparation requires an unrecognized bridge that is Ready for Operations Sync and not on hold.');
    busy=true;error='';prepared=null;draw();
    try{const result=await api('/'+encodeURIComponent(selected.intakeId)+'/operations-packet',{expectedBridgeRevision:selected.orderEntry.bridge.revision});prepared={intakeId:selected.intakeId,bridgeRevision:selected.orderEntry.bridge.revision,result};}
    catch(e){error=e.message;}finally{busy=false;draw();}
  }
  async function importOperations(){
    if(!handoff?.enabled||!handoff?.canImport||!can('order_entry.sim_import'))throw new Error('SIM import permission and the developmental feature are required.');
    if(selected.orderEntry.bridge.state.status!=='READY_FOR_OPERATIONS_SYNC'||selected.orderEntry.bridge.state.holdReason||isRecognized())throw new Error('Import requires an unrecognized bridge that is Ready for Operations Sync and not on hold.');
    if(!prepared||prepared.intakeId!==selected.intakeId||prepared.bridgeRevision!==selected.orderEntry.bridge.revision||prepared.result.validation?.status!=='PASS'||!prepared.result.validationToken)throw new Error('Prepare a passing packet for this exact bridge revision first.');
    if(prepared.result.expiresAt&&Date.parse(prepared.result.expiresAt)<=Date.now())throw new Error('Validation expired. Prepare a fresh packet before importing.');
    busy=true;error='';draw();
    try{const result=await api('/'+encodeURIComponent(selected.intakeId)+'/operations-import',{packet:prepared.result.packet,validationToken:prepared.result.validationToken});await refresh();handoff={...handoff,receipt:result.receipt||handoff?.receipt,recognition:result.recognition||handoff?.recognition};}
    catch(e){error=e.message;}finally{busy=false;draw();}
  }
  function reason(){return mount.querySelector('[name="bridge-reason"]')?.value.trim()||null;}
  async function command(action,extra={}){await mutate('/bridge',{expectedRevision:selected.orderEntry.bridge.revision,action,reason:reason(),...extra});}
  function printBom(){const popup=window.open('about:blank','_blank');if(!popup){error='Allow pop-ups to print the approved BOM.';draw();return;}popup.opener=null;popup.document.write('<!doctype html><html><head><title>Approved DLE-OS BOM</title><style>body{font:12px Arial}table{width:100%;border-collapse:collapse}th,td{padding:6px;border:1px solid #444;text-align:left}thead{display:table-header-group}</style></head><body><h1>Approved DLE-OS BOM</h1><p>'+esc(selected.intakeId)+' · Accepted package revision '+selected.packageRevision+' · SIM</p>'+bomTable()+'</body></html>');popup.document.close();popup.focus();popup.print();}
  async function render(){mount=document.querySelector('[data-workspace-mount="order-entry"]');if(!mount)return;if(document.body.dataset.simRuntime!=='true'){mount.textContent='This bridge is available in SIM only.';return;}
    mount.onclick=async event=>{const b=event.target.closest('button');if(!b||busy)return;try{
      if(b.dataset.id){await select(b.dataset.id);error='';draw();}
      else if(b.dataset.mode){mode=b.dataset.mode;selected=null;prepared=null;handoff=null;draw();}
      else if(b.dataset.command)await command(b.dataset.command);
      else switch(b.dataset.action){case 'refresh':await refresh();break;case 'back':selected=null;prepared=null;handoff=null;await refresh();break;case 'print-bom':printBom();break;
        case 'prepare-operations':await prepareOperations();break;case 'import-operations':await importOperations();break;
        case 'accept':if(!mount.querySelector('[name="accept-confirm"]').checked)throw new Error('Explicitly confirm acceptance of this reviewed package.');await mutate('/accept',{expectedRevision:selected.packageRevision,sourceToken:selected.sourceToken,confirm:true,note:mount.querySelector('[name="accept-note"]').value.trim()});break;
        case 'identifiers':{const identifiers=Object.fromEntries(['salesOrder','salesOrderLine','workOrder'].map(k=>[k,mount.querySelector('[name="'+k+'"]').value]));await command('IDENTIFIERS',{identifiers:{...identifiers,namespace:'SIM-VPRO5',orderLineKey:selected.orderLineKey}});break;}}
    }catch(e){error=e.message;draw();}};
    mount.oninput=event=>{if(event.target.id!=='oe-search')return;const position=event.target.selectionStart;search=event.target.value;draw();const input=mount.querySelector('#oe-search');input.focus();input.setSelectionRange(position,position);};
    mount.onchange=async event=>{if(!event.target.dataset.check||busy)return;await command('CHECK',{item:event.target.dataset.check,complete:event.target.checked});};await refresh();}
  window.DleWorkspaces=window.DleWorkspaces||{};window.DleWorkspaces['order-entry']=Object.freeze({id:'order-entry',render,refresh});
})(window,document);

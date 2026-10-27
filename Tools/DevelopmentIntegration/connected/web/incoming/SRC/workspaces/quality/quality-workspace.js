(function(window,document){
  'use strict';
  let mount, row=null, loading=false, error='', requestVersion=0, packet=null, pane='', stage='awaiting', search='', opening=false, approving=false, approvalUnknown=false, notice='';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function pendingRow(handoff){
    const receipt=handoff?.receipt, packet=receipt?.packet, readback=handoff?.readback;
    if(!readback?.verified || packet?.source?.intakeId!=='RFQI-SIM-0046' ||
       packet.workOrder?.workOrderStatus!=='AWAITING_RELEASE' || readback.workOrder?.workOrderStatus!=='AWAITING_RELEASE')return null;
    const line=readback.salesOrderLine, work=readback.workOrder;
    if(!line || line.releaseState!=='AWAITING_RELEASE' || line.salesOrderLineId!==receipt.salesOrderLineId ||
       work.workOrderNumber!==receipt.workOrderNumber)return null;
    return {customer:line.customerName,po:line.customerPurchaseOrderNumber,intake:packet.source.intakeId,
      salesOrder:line.salesOrderNumber,line:line.lineNumber,workOrder:work.workOrderNumber,
      assembly:line.itemNumber,revision:line.bomRevision,quantity:line.quantityOrdered,acceptanceId:packet.source.acceptanceId,acceptedRevision:packet.source.acceptedRevision};
  }
  function draw(){
    if(!mount)return;
    if(packet){drawPacket();return;}
    const focused=mount.querySelector('[data-quality-search]')===document.activeElement;
    const cursor=focused?document.activeElement.selectionStart:null;
    const labels=['Customer','Customer PO / Source Order','Sales Order / Line','Work Order','Assembly / Rev','Qty','Status',''];
    const awaiting=row&&!row.release?1:0,released=row?.release?1:0;
    const visible=row&&((stage==='released')===!!row.release)&&[row.customer,row.po,row.intake,row.salesOrder,row.workOrder,row.assembly,row.revision].join(' ').toLowerCase().includes(search.toLowerCase());
    const values=visible?[esc(row.customer),esc(row.po)+'<small>'+esc(row.intake)+'</small>',esc(row.salesOrder)+' / '+esc(row.line),esc(row.workOrder),esc(row.assembly)+' / '+esc(row.revision),esc(row.quantity),row.release?'Released to Kitting':row.releaseKnown===false?'Release status unavailable':'Awaiting Review / Release','<button type="button" data-quality-open '+(loading?'disabled':'')+'>Open packet</button>']:[];
    mount.innerHTML='<div class="quality-workspace"><header class="quality-header"><div><h1>Quality</h1><p>Review job packets and released jobs.</p></div><button type="button" data-quality-refresh '+(loading?'disabled aria-busy="true"':'')+'>Check status / Refresh</button></header>'+
      '<nav class="quality-stages" aria-label="Quality stages">'+[['awaiting','Awaiting Review / Release',awaiting],['released','Released Jobs',released]].map(([key,label,count])=>'<button type="button" data-quality-stage="'+key+'" aria-pressed="'+(stage===key)+'">'+label+'<strong>'+count+'</strong></button>').join('')+'</nav>'+
      '<label class="quality-search">Search jobs<input type="search" data-quality-search placeholder="Work Order, assembly, customer, PO..." value="'+esc(search)+'"></label>'+
      (error?'<p role="alert">'+esc(error)+'</p>':'')+(notice?'<p role="status">'+esc(notice)+'</p>':'')+(loading?'<p role="status">Checking saved release status...</p>':'')+
      (visible?'<div class="quality-table"><table><thead><tr>'+labels.map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody><tr>'+values.map((value,i)=>'<td data-label="'+labels[i]+'">'+value+'</td>').join('')+'</tr></tbody></table></div>':'<p class="quality-empty">'+(search?'No matching jobs.':stage==='released'?'No released jobs.':'No jobs awaiting review / release.')+'</p>')+'</div>';
    if(focused){const input=mount.querySelector('[data-quality-search]');input.focus();input.setSelectionRange(cursor,cursor);}
  }
  async function api(url,init={}){
    const controller=new AbortController();let timer;
    const request=(async()=>{
      const response=await window.DleIntegration.request(url,{credentials:'same-origin',cache:'no-store',...init,signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw Error(data.message||'The verified packet could not be loaded ('+response.status+').');
      return data;
    })();
    const timeout=new Promise((_,reject)=>{timer=window.setTimeout(()=>{reject(Error('The request timed out.'));controller.abort();},15000);});
    try{return await Promise.race([request,timeout]);}finally{window.clearTimeout(timer);}
  }
  const instructionBase=()=>'/api/quoting/v1/quality/work-orders/'+encodeURIComponent(row.workOrder)+'/instructions';
  function documentGroups(){
    const definition=packet.order.orderEntry.acceptance.package.technicalSource.baseline.definition;
    const metadata=[...(definition.manufacturing.package.documents||[]),...(definition.materials.package.documents||[])];
    const id=doc=>doc.url.split('/').pop();
    const technical=packet.order.review.technicalDocuments||[];
    const drawing=technical.filter(doc=>id(doc)===definition.manufacturing.governingDocumentId);
    const supporting=technical.filter(doc=>!drawing.includes(doc)&&!/\.txt$/i.test(doc.name)&&!metadata.some(source=>source.documentId===id(doc)&&source.identityReview?.type==='VPRO5_BOM_EXPORT'));
    return {po:packet.order.review.poDocuments||[],drawing,supporting};
  }
  const previewType=doc=>/\.pdf$/i.test(doc.name)?'application/pdf':/\.png$/i.test(doc.name)?'image/png':/\.jpe?g$/i.test(doc.name)?'image/jpeg':/\.gif$/i.test(doc.name)?'image/gif':/\.webp$/i.test(doc.name)?'image/webp':null;
  function documentUrl(doc){
    const url=new URL(doc.url,location.href);
    if(url.origin!==location.origin||!/^\/api\/sim\/(new-orders|rfq-intakes)\/[^/]+\/documents\/[^/]+$/.test(url.pathname))throw Error('This source document URL is not available.');
    return url.href;
  }
  async function previewDocument(doc,host){
    const report=message=>{let status=host.querySelector('[data-quality-preview-status]');if(!status){status=document.createElement('p');status.dataset.qualityPreviewStatus='';status.setAttribute('role','status');host.append(status);}status.textContent=message;};
    let url;try{url=documentUrl(doc);}catch(e){report(e.message);return;}
    const type=previewType(doc);if(!type){report('Browser preview is not available for this format. Download the file to open it in a compatible app.');return;}
    // Reserve the tab during the user click, before fetching. Same pattern as Sales Order PO previews.
    const popup=window.open('about:blank','_blank');
    if(!popup){report('The browser blocked the preview tab. Allow pop-ups for DLE-OS, then choose Open in new tab again. Download is also available.');return;}
    popup.opener=null;popup.document.title='Opening '+doc.name;popup.document.body.textContent='Opening '+doc.name+'...';
    report('Opening '+doc.name+'...');
    try{
      const response=await window.DleIntegration.request(url,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Document unavailable ('+response.status+'). Try again or use Download.');
      const blob=await response.blob(),bytes=new Uint8Array(await blob.slice(0,1024).arrayBuffer());
      const text=new TextDecoder('ascii').decode(bytes),starts=(...values)=>values.every((v,i)=>bytes[i]===v);
      const valid=type==='application/pdf'?text.includes('%PDF-'):type==='image/png'?starts(137,80,78,71,13,10,26,10):type==='image/jpeg'?starts(255,216,255):type==='image/gif'?/^GIF8[79]a/.test(text):text.startsWith('RIFF')&&text.slice(8,12)==='WEBP';
      if(blob.type.split(';')[0].toLowerCase()!==type||!valid)throw Error('This file cannot be previewed safely in the browser. Use Download to open the retained file.');
      if(popup.closed){report('Preview tab was closed. Choose Open in new tab to try again.');return;}
      const previewUrl=URL.createObjectURL(blob);popup.location.replace(previewUrl);
      const cleanup=window.setInterval(()=>{if(popup.closed){URL.revokeObjectURL(previewUrl);window.clearInterval(cleanup);}},2000);
      report(doc.name+' opened in a new tab.');
    }catch(e){popup.close();report(e.message||'Preview unavailable. Use Download to open the retained file.');}
  }
  function drawPacket(){
    const r=row,d=packet.instructions,order=packet.order;
    const groups=documentGroups();
    mount.innerHTML='<div class="quality-workspace quality-packet"><header class="quality-header"><div><h1>WO '+esc(r.workOrder)+' - '+esc(r.assembly)+' Rev '+esc(r.revision)+'</h1><p>'+esc(r.customer)+' - SO '+esc(r.salesOrder)+' / '+esc(r.line)+' - Qty '+esc(r.quantity)+' - '+esc(r.intake)+'</p></div><button type="button" data-quality-back '+(approving?'disabled':'')+'>Back to queue</button></header>'+
      '<p class="quality-held">'+(packet.review.release?'Released to Kitting - '+esc(packet.review.release.actor)+' - '+esc(packet.review.release.at):'Awaiting Release - Quality packet preparation')+'</p><nav class="quality-packet-tools" aria-label="Packet documents">'+
      [['po','Customer P.O.'],['drawing','Original Drawing'],['supporting','Supporting Source Files']].map(([key,label])=>'<button type="button" data-quality-group="'+key+'" '+(groups[key].length?'':'disabled')+'>'+label+'<small>'+esc(groups[key].map(doc=>doc.name).join(' / ')||'Not provided')+'</small></button>').join('')+
      '<button type="button" data-quality-slides>Production Slides<small>Traveler / DLE-OS BOM / Instructions</small></button></nav>'+
      '<p data-quality-version>'+ (d.version?'Saved instruction draft v'+esc(d.version)+' - '+esc(d.updatedBy)+' - '+esc(d.updatedAt):'Accepted Labor baseline - no saved WO draft yet')+'</p>'+
      '<p class="quality-note">'+(packet.review.release?'Released instruction snapshot - read only.':'Save slide changes to this Work Order from the slide editor.')+' Source documents are retained unchanged; BOM corrections go through Technical Review.</p>'+
      (packet.review.release?'':'<p><button type="button" data-quality-approve '+(approving?'aria-busy="true" ':'')+(!packet.review.canApprove||approving||approvalUnknown?'disabled':'')+'>'+(approving?'Approving packet...':'Approve Packet &amp; Release to Kitting')+'</button> <button type="button" data-quality-reopen '+(approving?'disabled':'')+'>Check status / Reopen packet</button></p>')+(error?'<p role="alert">'+esc(error)+'</p>':'')+'<section class="quality-packet-content" aria-label="Selected packet document"></section>'+
      '<details class="quality-note"><summary>Packet references</summary><p>Accepted package revision '+esc(order.orderEntry.acceptance.packageRevision)+' - Labor v'+esc(d.baselineVersion)+'</p><p>Instruction reference: <code>'+esc(JSON.stringify(d.reference))+'</code></p><p>Packing slip: not provided (optional).</p></details></div>';
    const host=mount.querySelector('.quality-packet-content');
    if(groups[pane]?.length){
      for(const doc of groups[pane]){
        let url;try{url=documentUrl(doc);}catch(_){continue;}
        const row=document.createElement('p'),title=document.createElement('strong');title.textContent=doc.name;row.append(title,document.createElement('br'));
        if(previewType(doc)){
          const view=document.createElement('a');view.textContent='Open in new tab';view.href=url;view.target='_blank';view.rel='noopener noreferrer';view.dataset.qualityPreview='';view.onclick=event=>{event.preventDefault();void previewDocument(doc,host);};row.append(view,document.createTextNode(' | '));
        }
        const download=document.createElement('a');download.textContent='Download';download.href=url;download.download=doc.name;download.dataset.qualityDownload='';row.append(download);host.append(row);
        if(!previewType(doc)){const note=document.createElement('p');note.textContent='Browser preview is not available for this format. Download it to open in a compatible app.';host.append(note);}
      }
    }else host.innerHTML='<p>Select a document or open Production Slides to view the traveler, DLE-OS BOM and instructions.</p>';

  }
  async function openPacket(){
    if(opening||approving)return;opening=true;error='';
    try{
      const [order,instructions,sources,review]=await Promise.all([api('/api/quoting/v1/order-entry/'+encodeURIComponent(row.intake)),api(instructionBase()),api(instructionBase()+'/sources'),api('/api/quoting/v1/quality/work-orders/'+row.workOrder+'/release')]);
      if(order.orderEntry?.acceptance.id!==row.acceptanceId||order.orderEntry.acceptance.packageRevision!==row.acceptedRevision||instructions.baselineToken!==sources.baselineToken)throw Error('The accepted packet changed. Refresh the queue before opening.');
      if(review.instructionVersion!==instructions.version||review.contentHash!==instructions.reference.contentHash)throw Error('The saved instructions changed while opening. Open the packet again.');
      packet={order,instructions,sources,review};row.release=review.release;row.releaseKnown=true;approvalUnknown=false;pane='';draw();
    }catch(e){error=e.message;draw();}finally{opening=false;}
  }
  async function slides(trigger){
    trigger.disabled=true;error='';
    try{
      if(!window.DleJobInstructions)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/incoming/SRC/workspaces/kitting/production-instruction-editor.js';s.onload=resolve;s.onerror=()=>reject(Error('The slide editor could not load.'));document.head.append(s);});
      await window.DleJobInstructions.open({wo:row.workOrder,quality:true,order:packet.order,job:{context:{assembly:row.assembly,revision:row.revision,quantity:row.quantity}},trigger,
        onSaved:result=>{if(packet)Object.assign(packet.instructions,result);},onExit:()=>{void openPacket();}});
    }catch(e){error=e.message||'The slide editor could not load. Refresh and try again.';draw();}finally{trigger.disabled=false;}
  }
  function released(release){
    if(!release?.id||release.workOrderNumber!==row.workOrder)throw Error('The saved release response could not be verified.');
    row.release=release;row.releaseKnown=true;approvalUnknown=false;packet=null;stage='released';search='';error='';notice='Packet released to Kitting. Starting Kitting is a separate action.';
    window.dispatchEvent(new CustomEvent('dle:quality-released',{detail:{workOrderNumber:row.workOrder}}));
  }
  async function approve(){
    if(opening||approving||approvalUnknown||!packet?.review.canApprove||packet.review.release)return;
    if(window.DleJobInstructions?.hasUnsavedChanges(row.workOrder)){error='Save your slide changes to this Work Order, or discard the draft, before approving.';draw();return;}
    approving=true;error='';notice='';const url='/api/quoting/v1/quality/work-orders/'+row.workOrder+'/release';
    const token=packet.review.reviewToken;draw();
    try{released(await api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewToken:token})}));}
    catch(e){
      // A lost response does not prove the write failed. Reconcile with a read; never replay the approval.
      try{
        const status=await api(url);
        if(status.release)released(status.release);
        else{packet.review.canApprove=false;error=e.message+' No saved release was found. Reopen the packet and review its current version before trying again.';}
      }catch(_){approvalUnknown=true;packet.review.canApprove=false;error='Could not confirm whether approval saved. Use Check status / Reopen packet before trying again. Your job remains visible.';}
    }finally{approving=false;draw();}
  }
  async function refresh(){
    if(approving)return;
    packet=null;const version=++requestVersion;loading=true;error='';notice='';draw();
    let candidate;
    try{
      const handoff=await api('/api/quoting/v1/order-entry/RFQI-SIM-0046/operations-handoff');
      if(version!==requestVersion)return;candidate=pendingRow(handoff);
      if(candidate){const status=await api('/api/quoting/v1/quality/work-orders/'+candidate.workOrder+'/release');if(version!==requestVersion)return;candidate.release=status.release;candidate.releaseKnown=true;}
      row=candidate;approvalUnknown=false;
    }catch(e){if(version!==requestVersion)return;if(!row&&candidate)row={...candidate,releaseKnown:false};error=e.message+' Check status again. The last known job remains visible.';}
    finally{if(version===requestVersion){loading=false;draw();}}
  }
  async function render(){
    mount=document.querySelector('[data-workspace-mount="quality"]');if(!mount)return;
    if(document.body.dataset.simRuntime!=='true'){mount.textContent='Quality queue is available in SIM only.';return;}
    mount.onclick=event=>{
      const button=event.target.closest('button');if(!button||button.disabled||approving)return;
      if(button.hasAttribute('data-quality-refresh')&&!loading)void refresh();
      else if(button.hasAttribute('data-quality-open')){button.disabled=true;void openPacket();}
      else if(button.hasAttribute('data-quality-back')){packet=null;void refresh();}
      else if(button.hasAttribute('data-quality-group')){pane=button.dataset.qualityGroup;draw();const docs=documentGroups()[pane]||[];if(docs.length===1&&previewType(docs[0]))void previewDocument(docs[0],mount.querySelector('.quality-packet-content'));}
      else if(button.hasAttribute('data-quality-slides'))void slides(button);
      else if(button.hasAttribute('data-quality-approve'))void approve();
      else if(button.hasAttribute('data-quality-reopen'))void openPacket();
      else if(button.hasAttribute('data-quality-stage')){stage=button.dataset.qualityStage;notice='';draw();}
    };
    mount.oninput=event=>{if(event.target.matches('[data-quality-search]')){search=event.target.value;draw();}};
    await refresh();
  }
  window.DleWorkspaces=window.DleWorkspaces||{};
  window.DleWorkspaces.quality=Object.freeze({id:'quality',render,refresh});
})(window,document);

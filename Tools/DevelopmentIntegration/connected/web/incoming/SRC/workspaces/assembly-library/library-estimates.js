(function(window,document){
 'use strict';
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
 const button=(text,action)=>{const b=node('button',text);b.type='button';b.onclick=e=>{if(e.detail<2)void action();};return b;};
 const value=v=>v==null||v===''?'\u2014':String(v);
 const money=v=>v==null?'\u2014':'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const unitCost=v=>v==null?'\u2014':'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:6});
 const date=v=>window.DleDateFormat?.dateTime(v,{timeZone:'UTC',timeZoneName:'short'})||(v?new Intl.DateTimeFormat('en-US',{month:'2-digit',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(v))+' UTC':'');
 function table(headers,rows,minWidth){const scroll=node('div',undefined,'estimate-table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',headers[0]+' details');const t=node('table',undefined,'estimate-table');if(minWidth)t.style.minWidth=minWidth+'px';const head=node('thead'),tr=node('tr');headers.forEach(h=>{const th=node('th',h);th.scope='col';tr.append(th);});head.append(tr);const body=node('tbody');for(const row of rows){const r=node('tr');for(const v of row){const td=node('td');td.append(v instanceof Node?v:document.createTextNode(value(v)));r.append(td);}body.append(r);}t.append(head,body);scroll.append(t);return scroll;}
 function notes(content){const d=node('details'),summary=node('summary','Details');d.append(summary);for(const [label,text] of content)if(text!=null&&text!=='')d.append(node('p',label+': '+text));return d;}
 function materials(host,data,edit){
  const snap=data.materials;if(!snap){host.append(node('p','Materials not requested.'));return;}
  host.append(node('h3','Materials'),node('p','Unit price '+money(snap.materialUnitSalePrice)+' \u00b7 Purchase cost '+money(snap.totalCost)+' \u00b7 Markup '+value(snap.markupPercent??0)+'%','estimate-summary'));
  if(edit)host.append(button('Edit Materials',()=>edit()));
  const rows=(data.materialRows||[]).map(r=>{const frozen=r.snapshot,q=frozen.quote,part=node('span',q.mfgPartNumber||q.assemblyPartNumber||'\u2014');
   if(q.partReviewMode==='REQUEST_ALTERNATE'||q.mfgPartNumber&&q.mfgPartNumberSource==='MANUAL_QUOTE_ONLY')part.append(node('small',q.partReviewMode==='REQUEST_ALTERNATE'?'Alternate requested':'Approval required','estimate-flag'));
   const lead=q.leadTimeMode==='STOCK'||!q.leadTimeMode&&q.leadDays===0?'Stock':q.leadTimeMode?value(q.leadTimeValue)+' '+(q.leadTimeMode==='WEEKS'?'weeks':'days'):q.leadDays!=null?q.leadDays+' days':'\u2014';
   const detail=notes([['Approved manufacturer P/Ns',(r.approvedPartNumbers||[]).join(' / ')],['Ref Des',r.referenceDesignators],['Required for this quote',frozen.requiredQuantity],['Notes',q.notes],...((q.evidence?.notes)||[]).map(n=>['Note',n.text]),...((q.evidence?.attachments)||[]).map(a=>['Saved attachment',a.name]),...((q.charges)||[]).map(c=>['Charge',c.description+' | '+value(c.quantity??1)+' x '+unitCost(c.rawCost)+' | '+value(c.treatment)])]);
   if(edit)detail.append(button('Edit this line',()=>edit({find:r.find,bomVersion:snap.bomVersion,candidateId:snap.candidateId})));
   return [r.find,r.customerPartNumber,part,r.description,r.quantityPerAssembly,q.uom,q.orderQuantity,unitCost(q.unitPrice),money(frozen.extendedCost),q.customerSupplied?'Customer supplied':q.vendor,lead,detail];
  });
  host.append(table(['Find','Customer P/N','P/N used','Description','Qty / unit','UoM','Buy qty','Unit cost','Purchase cost','Vendor / supply','Lead time','Details'],rows,1150));
 }
 function labor(host,data){
  const snap=data.labor;if(!snap){host.append(node('p','Labor not requested.'));return;}
  host.append(node('h3','Labor'),node('p','Unit price '+money(snap.totals.unitSalePrice)+' \u00b7 Rate '+money(snap.rate)+'/hour \u00b7 Pricing / batch qty '+value(snap.pricingQuantity??snap.quantity),'estimate-summary'));
  const positions=new Map(),counts=new Map();let main=0;
  const rows=snap.operations.map(o=>{const seq=o.parentId?(positions.get(o.parentId)||'')+'.'+((counts.get(o.parentId)||0)+1):String(++main);if(o.parentId)counts.set(o.parentId,(counts.get(o.parentId)||0)+1);positions.set(o.id,seq);
   const detail=notes([['Setup minutes',o.setupMinutes],...((o.notes)||[]).map(n=>['Note',n.text]),...((o.slides)||[]).flatMap(s=>[['Slide',s.title||s.source?.name||s.kind],...(s.stages||[]).map(st=>[st.name||'Stage',(st.marks||[]).filter(m=>m.kind==='text'&&m.text).map(m=>m.text).join(' | ')])])]);
   return [seq,o.name,o.operationQuantity,o.runSeconds!=null?o.runSeconds+' sec':o.runMinutes!=null?o.runMinutes+' min':'\u2014',o.timeBasis==='BATCH'?'Per-batch':'Per-unit',o.instructions,detail];
  });
  host.append(table(['Step','Operation','Work qty','Entered time','Time basis','Instructions','Notes / setup'],rows,850));
 }
 async function mount(host,context){
  host.classList.add('library-estimates');let alive=0,entries=[];
  const query=new URLSearchParams({key:context.key,drawingRevision:context.drawingRevision,bomRevision:context.bomRevision});
  async function api(suffix=''){const r=await window.DleIntegration.request('/api/quoting/v1/assembly-library/estimates'+suffix,{credentials:'same-origin',cache:'no-store'});let data;try{data=await r.json();}catch{}if(!r.ok)throw Error(data?.message||'Estimate history is unavailable.');if(data.contractVersion!==1)throw Error('Estimate history needs SIM activation.');return data;}
  function reset(){alive++;host.replaceChildren();return alive;}
  function summary(p){return p.customer.customerName+' \u00b7 '+p.assembly.assemblyNumber+' \u00b7 Rev '+value(p.assembly.revision)+' \u00b7 Qty '+p.assembly.quantity;}
  function versions(item){reset();host.append(button('Back to Quotes',list),node('h3',item.rfqId),node('p',summary(item),'estimate-summary'));savedCopies(item);const entries=[...item.versions].reverse(),rows=node('div',undefined,'estimate-records');
   const card=(p,latest)=>{const row=node('section',undefined,'estimate-record'),caption=node('div');row.dataset.checkpoint=p.version;caption.append(node('strong',latest?(item.currentReviewId===p.id?'Current estimate':'Last completed review'):'Saved review'),node('small',date(p.atUtc)));row.append(caption,button('Open estimate',()=>openVersion(item,p)));return row;};
   if(entries.length)rows.append(card(entries[0],true));if(entries.length>1){const history=node('details'),title=node('summary','Earlier review checkpoints ('+(entries.length-1)+')');history.append(title);for(const p of entries.slice(1))history.append(card(p,false));rows.append(history);}host.append(rows);
  }
  function savedCopies(item){const copies=item.quoteCopies||[];if(!copies.length)return;host.append(node('h3','Saved customer PDF copies'));for(const c of copies){
   const row=node('section',undefined,'estimate-record'),caption=node('div');caption.append(node('strong','Draft PDF - '+date(c.atUtc)),node('small',c.manualSend?'Sent manually - recorded '+date(c.manualSend.recordedAtUtc)+' by '+c.manualSend.actorName+'. Delivery not verified.':'No manual send recorded - '+c.actorName));if(c.revisionOf?.length)caption.append(node('small','Revised copy; earlier sent PDF retained.'));row.append(caption);
   for(const [label,url] of [['Open PDF',c.url],['Download PDF',c.url+'&download=true']]){const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener';row.append(a);}
   const p=item.versions.find(p=>p.id===c.estimateId);if(p){if(p.materialsVersion!=null)row.append(button('Saved Materials',()=>openVersion(item,p,'materials')));if(p.laborVersion!=null)row.append(button('Saved Labor',()=>openVersion(item,p,'labor')));}
   if(!c.manualSend&&c.token&&window.DleOsCapabilities?.can?.('rfq.quote.prepare')===true){const slot=node('div'),status=node('p');status.setAttribute('role','status');row.append(button('Mark as sent',async()=>{try{if(!window.DleCustomerQuote?.markSent){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/incoming/SRC/workspaces/rfqs/customer-quote.js?manual-send=1';script.onload=resolve;script.onerror=()=>reject(Error('Manual-send controls could not load.'));document.head.append(script);});}await window.DleCustomerQuote.markSent(slot,{...c,rfqIds:(c.sourceLines||[]).map(l=>l.rfqId)},item.rfqId,async()=>{const data=await api('?'+query);entries=data.items;versions(entries.find(i=>i.rfqId===item.rfqId));});}catch(error){status.textContent=error.message;}}),slot,status);}
   host.append(row);
  }}
  async function openVersion(item,p,initial){const token=reset(),status=node('p','Opening saved estimate.');status.setAttribute('role','status');host.append(button('Back to estimates',()=>versions(item)),status);
   try{const q=new URLSearchParams(query);q.set('rfqId',item.rfqId);q.set('estimateId',p.id);const data=await api('/version?'+q);if(!host.isConnected||token!==alive)return;status.remove();host.append(node('h3',item.rfqId+' \u00b7 '+(data.isCurrentReview?'Current estimate':'Saved review')),node('p',summary(data.pair),'estimate-summary'),node('p','Internal review. Not a customer quote revision.','estimate-kind'));
    const tabs=node('div',undefined,'estimate-tabs'),body=node('section');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Estimate components');const show=kind=>{body.replaceChildren();tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===kind)));if(kind==='materials')materials(body,data,data.materialEditContractVersion===1&&data.canEditMaterials===true&&typeof context.onEditMaterials==='function'?target=>context.onEditMaterials({rfqId:item.rfqId,target}):null);else labor(body,data);};
    for(const [kind,label] of [['materials','Materials'],['labor','Labor']]){const b=button(label,()=>show(kind));b.dataset.kind=kind;tabs.append(b);}host.append(tabs,body);show(initial||(data.materials?'materials':'labor'));
   }catch(error){if(host.isConnected&&token===alive)status.textContent=error.message;}
  }
  function list(){reset();host.append(node('p','Estimates for review','estimate-kind'));const rows=node('div',undefined,'estimate-records');if(!entries.length)rows.append(node('p','No completed estimates for this assembly revision.'));for(const item of entries){const row=node('section',undefined,'estimate-record'),caption=node('div');caption.append(node('strong',item.rfqId),node('small',summary(item)));row.append(caption,button('Open estimates',()=>versions(item)));rows.append(row);}host.append(rows);}
  const token=reset();const status=node('p','Loading completed estimates.');status.setAttribute('role','status');host.append(status);
  try{const data=await api('?'+query);if(!host.isConnected||token!==alive)return;entries=data.items;list();}catch(error){if(host.isConnected&&token===alive)status.textContent=error.message;}
 }
 window.DleLibraryEstimates=Object.freeze({mount});
})(window,document);

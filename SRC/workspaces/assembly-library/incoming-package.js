(function(window,document){'use strict';
 const el=(t,s)=>{const n=document.createElement(t);if(s!==undefined)n.textContent=s;return n;},button=(s,fn)=>{const b=el('button',s);b.type='button';b.onclick=fn;return b;};
 const kind={DRAWING_AND_BOM:'Drawing + BOM',DRAWING:'Drawing',BOM_ONLY:'BOM',VPRO5_BOM_EXPORT:'VPRO5 TXT',GERBER_FILES:'Gerber',DATASHEET:'Datasheet',SPECIFICATION:'Specification',OTHER:'Other',ENGINEERING_TEST_PROTOTYPE:'Engineering / Test / Prototype',UNKNOWN:'Not identified'};
 const statuses={AWAITING_ASSESSMENT:'Awaiting assessment',ASSESSMENT_DRAFT:'Assessment saved',NEEDS_PREPARATION:'Sent to Library',IN_PREPARATION:'In Library preparation',WAITING_FOR_INFORMATION:'Waiting for information'};
 const decisions={ALREADY_IN_RECORDS:'Already in Assembly Records',DO_NOT_USE:'Rejected / Do not use',REOPEN:'Return to active files'};
 function base(options){return '/api/sim/'+({intake:'intake',review:'technical-review',library:'assembly-library'}[options.module])+'/incoming-package';}
 function query(options){return options.module==='library'?{id:options.preparationId}:{intakeId:options.intakeId,lineNumber:options.lineNumber};}
 const active=new Map();
 async function open(options,trigger){
  const host=options.host||document.body;if(active.get(host)?.isConnected)return;
  const dialog=el('dialog'),top=el('div'),title=el('h3','Incoming package'),close=button('Close',()=>{if(canLeave())dialog.close();}),crumbs=el('nav'),context=el('p'),list=el('div'),message=el('p');
  let data=null,path=[],level=0,handled=false,draft=null,busy=false,unverified=false,documents=null,documentsLoading=false,documentsFailed=false;
  const url=base(options),params=query(options),abort=new AbortController(),scroll={x:scrollX,y:scrollY};
  dialog.className='dle-incoming-package';dialog.setAttribute('aria-label','Incoming package');crumbs.setAttribute('aria-label','Incoming package folders');message.className='incoming-message';message.setAttribute('role','status');top.className='incoming-title';top.append(title,close);dialog.append(top,crumbs,context,list,message);host.append(dialog);active.set(host,dialog);
  function canLeave(){if(busy){message.textContent='Wait for this file decision to finish saving.';return false;}if(draft&&!window.confirm('Discard the unsaved file decision?'))return false;draft=null;return true;}
  function beforeUnload(e){if(draft||busy){e.preventDefault();e.returnValue='';}}
  window.addEventListener('beforeunload',beforeUnload);
  dialog.addEventListener('cancel',e=>{e.preventDefault();if(canLeave())dialog.close();});
  // Copy controls load asynchronously. Inert plus capture protection keeps their own callbacks
  // from re-enabling a copy while a decision is pending; existing copy saves can close this view.
  function guardExternal(){for(const node of dialog.querySelectorAll('[data-incoming-external-actions]'))node.inert=busy||unverified||!!draft;}
  const observer=new MutationObserver(guardExternal);observer.observe(list,{childList:true,subtree:true});
  dialog.addEventListener('click',e=>{const external=e.target.closest?.('[data-incoming-external-actions]');if(external&&(busy||unverified||draft)){e.preventDefault();e.stopImmediatePropagation();message.textContent='Save or cancel this file decision before copying a file.';}},true);
  dialog.addEventListener('close',()=>{abort.abort();observer.disconnect();window.removeEventListener('beforeunload',beforeUnload);active.delete(host);dialog.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});window.scrollTo(scroll.x,scroll.y);},{once:true});
  dialog.showModal();message.textContent='Loading incoming files.';close.focus({preventScroll:true});
  const isLibrary=()=>options.module==='library'&&Array.isArray(data?.handledFiles);
  const canEdit=()=>isLibrary()&&data.canDisposition===true&&!unverified;
  async function loadDocuments(){
   if(documents||documentsLoading||documentsFailed||!data.libraryKey)return;documentsLoading=true;
   try{const r=await fetch('/api/sim/assembly-library/documents?'+new URLSearchParams({key:data.libraryKey}),{credentials:'same-origin',cache:'no-store',signal:abort.signal});const result=await r.json();if(!r.ok)throw Error(result.message||'Existing files could not be checked.');
    if(result.record?.sourceKeyRaw!==data.libraryKey||result.record.drawingRevision!==data.drawingRevision||result.record.bomRevision!==data.bomRevision)throw Error('Existing files belong to a different assembly revision.');
    const latest=new Map();for(const v of result.record.history||[])if(!latest.has(v.id)||latest.get(v.id).version<v.version)latest.set(v.id,v);
    documents={token:result.token,items:[...latest.values()].filter(v=>v.association?.sourceKeyRaw===data.libraryKey&&v.association.drawingRevision===data.drawingRevision&&v.association.bomRevision===data.bomRevision&&Array.isArray(v.purposes)&&v.purposes.length&&v.source?.relativePath)};
   }catch(e){if(e.name!=='AbortError')documentsFailed=true;}finally{documentsLoading=false;if(dialog.isConnected&&draft?.value==='ALREADY_IN_RECORDS')draw();}
  }
  function choose(file,value){
   if(busy||!canEdit())return;
   if(draft&&draft.documentId!==file.id&&!canLeave()){draw();return;}
   draft=value?{documentId:file.id,value,requestId:null,reference:''}:null;message.textContent='';draw();
   if(value==='ALREADY_IN_RECORDS')void loadDocuments();
   dialog.querySelector('[data-editing="true"] select')?.focus({preventScroll:true});
  }
  async function save(file){
   if(busy||!canEdit()||draft?.documentId!==file.id)return;
   const pending=draft;pending.requestId??=crypto.randomUUID();busy=true;message.textContent='Saving file decision.';draw();
   let committed=false;
   try{const payload={id:options.preparationId,token:data.token,documentId:file.id,decision:pending.value,confirmed:true,requestId:pending.requestId};
    if(pending.value==='ALREADY_IN_RECORDS'&&pending.reference){const v=documents?.items.find(v=>v.id===pending.reference);if(!v)throw Error('Choose an existing file again, or leave it unlinked.');Object.assign(payload,{libraryDocumentId:v.id,libraryDocumentVersion:v.version,libraryDocumentsToken:documents.token});}
    const response=await fetch('/api/sim/assembly-library/preparation/file-disposition',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload),signal:abort.signal});
    let result;try{result=await response.json();}catch{throw Error('The save result could not be verified. Your choice is retained; retry uses the same request.');}
    if(!response.ok)throw Error(result.message||([404,501].includes(response.status)?'File decisions await SIM activation.':'The file decision was not saved.'));
    if(result.record?.id!==options.preparationId||typeof result.token!=='string'||result.incomingPackage?.id!==options.preparationId||result.incomingPackage.token!==result.token||!Array.isArray(result.incomingPackage.files)||!Array.isArray(result.incomingPackage.handledFiles))throw Error('The save result could not be verified. Your choice is retained; retry uses the same request.');
    committed=true;data=result.incomingPackage;draft=null;await options.onSaved?.(result);
    message.textContent=pending.value==='REOPEN'?'File returned to active files.':'File decision saved. The original remains available under Handled.';
   }catch(e){if(!dialog.isConnected)return;if(committed){unverified=true;message.textContent='The decision was saved, but this view could not refresh. Close and reopen the package before continuing.';}else{message.textContent=e.message+' Your choice is still here.';}}
   finally{busy=false;if(dialog.isConnected){draw();if(committed)dialog.querySelector('.incoming-handled-toggle')?.focus({preventScroll:true});}}
  }
  async function openFile(file,control){
   if(control.disabled)return;control.disabled=true;let tab=null;
   try{if(file.type==='application/pdf'){tab=window.open('about:blank','_blank');if(tab)tab.opener=null;}const r=await fetch(url+'/file?'+new URLSearchParams({...params,documentId:file.id}),{credentials:'same-origin',cache:'no-store',signal:abort.signal});if(!r.ok){let error;try{error=await r.json();}catch{}throw Error(error?.message||'Retained file could not be opened.');}
    const blob=await r.blob(),objectUrl=URL.createObjectURL(blob);if(blob.type==='application/pdf'&&tab)tab.location.href=objectUrl;else{tab?.close();const link=el('a');link.href=objectUrl;link.download=file.name;dialog.append(link);link.click();link.remove();}setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);message.textContent='';
   }catch(e){tab?.close();message.textContent=e.message;}finally{if(control.isConnected)control.disabled=false;}
  }
  function draw(){
   const focused=document.activeElement,focusedRow=focused?.closest?.('tr[data-document-id]'),focus=focusedRow?{id:focusedRow.dataset.documentId,label:focused.getAttribute('aria-label'),text:focused.textContent,tag:focused.tagName}:null;
   const y=dialog.scrollTop,x=list.querySelector('.incoming-scroll')?.scrollLeft||0;close.disabled=busy;crumbs.replaceChildren();
   path.slice(0,level+1).forEach((part,i)=>{const b=button(part,()=>{if(canLeave()){level=i;draw();}});b.className='incoming-crumb';b.setAttribute('aria-label',part);b.disabled=busy;if(i===level)b.setAttribute('aria-current','location');crumbs.append(b);});list.replaceChildren();
   if(level<path.length-1){const folder=button(path[level+1],()=>{level++;draw();});folder.className='incoming-folder';folder.setAttribute('aria-label','Open folder '+path[level+1]);list.append(folder);dialog.scrollTop=y;return;}
   if(isLibrary()){const bar=el('div');bar.className='incoming-counts';const count=el('small',data.files.length+' '+(data.files.length===1?'file':'files')+' to review');const toggle=button(handled?'Back to active ('+data.files.length+')':'Handled ('+data.handledFiles.length+')',()=>{if(canLeave()){handled=!handled;message.textContent='';draw();}});toggle.className='incoming-handled-toggle';toggle.disabled=busy;toggle.setAttribute('aria-pressed',String(handled));bar.append(count,toggle);list.append(bar);}
   const rows=handled?data.handledFiles:data.files;
   if(!rows.length){list.append(el('p',handled?'No handled files.':isLibrary()?'No files awaiting disposition.':'No incoming files for this assembly.'));dialog.scrollTop=y;return;}
   const wrap=el('div');wrap.className='incoming-scroll';const table=el('table'),head=el('tr');for(const label of ['File','Initial identification','Size',''])head.append(el('th',label));table.append(head);
   for(const file of rows){
    const row=el('tr'),name=el('td',file.name),type=el('td',(file.identification==='OTHER'&&file.identificationDetails?file.identificationDetails:(kind[file.identification]||'Not identified'))+(file.addedInReview?' · Added in Technical Review':'')),size=el('td',file.size>=1048576?(file.size/1048576).toFixed(1)+' MB':(file.size/1024).toFixed(1)+' KB'),action=el('td'),primary=el('div');
    row.dataset.documentId=file.id;row.dataset.editing=String(draft?.documentId===file.id);name.className='incoming-filename';action.className='incoming-actions';primary.className='incoming-inline';
    const openButton=button('Open',()=>openFile(file,openButton));openButton.setAttribute('aria-label','Open '+file.name);openButton.disabled=busy||!data.canOpen||!file.available;primary.append(openButton);
    if(!file.available)action.append(el('small','Original unavailable'));else if(!data.canOpen)action.append(el('small','File access unavailable'));
    if(canEdit()&&!handled){const select=el('select');select.setAttribute('aria-label','File decision for '+file.name);for(const [value,label]of [['','Choose action'],['ALREADY_IN_RECORDS','Already in Assembly Records'],['DO_NOT_USE','Reject / Do not use']]){const option=el('option',label);option.value=value;select.append(option);}select.value=draft?.documentId===file.id?draft.value:'';select.disabled=busy;select.onchange=()=>choose(file,select.value);primary.append(select);}
    if(handled){const detail=el('details');detail.className='incoming-decision-detail';detail.append(el('summary',decisions[file.disposition?.decision]||'Handled'));const actor=file.disposition?.actor;const when=actor?.atUtc?(window.DleDateFormat?.dateTime(actor.atUtc,{seconds:true,empty:'Invalid Date'}) ?? new Date(actor.atUtc).toLocaleString()):'';detail.append(el('small',[actor?.name,when].filter(Boolean).join(' · ')||'Saved decision'));if(file.disposition?.existingDocument)detail.append(el('small','Linked to a saved Assembly Records file.'));name.append(detail);
     if(canEdit()){const reopen=button('Reopen',()=>choose(file,'REOPEN'));reopen.disabled=busy;primary.append(reopen);}}
    action.append(primary);
    if(draft?.documentId===file.id){
     if(draft.value==='ALREADY_IN_RECORDS'&&documents?.items.length){const reference=el('select');reference.className='incoming-reference';reference.setAttribute('aria-label','Existing file (optional) for '+file.name);const blank=el('option','Existing file (optional)');blank.value='';reference.append(blank);for(const v of documents.items){const option=el('option',v.source.relativePath.split('/').at(-1)+' · version '+v.version);option.value=v.id;reference.append(option);}reference.value=draft.reference;reference.disabled=busy;reference.onchange=()=>{draft.reference=reference.value;draft.requestId=null;};action.append(reference);}
     else if(draft.value==='ALREADY_IN_RECORDS'&&documentsFailed)action.append(el('small','Existing file list unavailable. Save records your decision without a file link.'));
     const controls=el('div');controls.className='incoming-inline';const saveButton=button(busy?'Saving…':'Save',()=>void save(file)),cancel=button('Cancel',()=>{draft=null;message.textContent='';draw();});saveButton.disabled=cancel.disabled=busy;controls.append(saveButton,cancel);action.append(controls);
    }
    if(!handled){const external=el('div');external.dataset.incomingExternalActions='';external.dataset.documentId=file.id;options.fileActions?.(file,external,dialog);action.append(external);}
    row.append(name,type,size,action);table.append(row);
   }
   wrap.append(table);list.append(wrap,el('small',data.notice||'Retained Intake files.'));guardExternal();dialog.scrollTop=y;wrap.scrollLeft=x;
   if(focus){const row=[...table.querySelectorAll('tr[data-document-id]')].find(r=>r.dataset.documentId===focus.id),controls=row?[...row.querySelectorAll('button,select,summary')]:[];const target=controls.find(n=>n.tagName===focus.tag&&(focus.label?n.getAttribute('aria-label')===focus.label:n.textContent===focus.text))||controls.find(n=>n.matches('select'))||controls[0];if(target&&!target.disabled&&!target.closest('[inert]'))target.focus({preventScroll:true});}
  }
  try{const response=await fetch(url+'?'+new URLSearchParams(params),{credentials:'same-origin',cache:'no-store',signal:abort.signal});try{data=await response.json();}catch{throw Error('Incoming package awaits SIM activation.');}if(!response.ok)throw Error(data.message||'Incoming package is unavailable.');if(!dialog.isConnected)return;
   message.textContent='';context.textContent=(statuses[data.status]||'Incoming files')+(data.routedFilesOnly?' · Files sent to Library':'');path=['New Quote Intake',data.customer||'Customer not provided',data.assembly||'Assembly not provided','Incoming revision '+(data.incomingRevision||'not provided'),data.request];level=path.length-1;draw();
  }catch(e){if(dialog.isConnected)message.textContent=e.message;}
 }
 const css=el('style');css.textContent=`
 .dle-incoming-package{position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);margin:0;box-sizing:border-box;width:min(1040px,calc(100vw - 24px));max-height:85vh;overflow:auto;border:1px solid #64748b;border-radius:8px;background:#0f172a;color:#f1f5f9;padding:14px;font:14px/1.4 system-ui}
 .dle-incoming-package::backdrop{background:#0008}.incoming-title{display:flex;justify-content:space-between;gap:12px;align-items:center}.incoming-title h3{font-size:17px;margin:0}
 .dle-incoming-package button,.dle-incoming-package select{font:inherit;background:#1e293b;color:#f1f5f9;border:1px solid #64748b;border-radius:4px;padding:5px 9px;min-height:32px}.dle-incoming-package button{cursor:pointer}.dle-incoming-package select{max-width:100%;min-width:0;padding:5px}
 .dle-incoming-package :is(button,select,summary):focus-visible{outline:2px solid #7dd3fc;outline-offset:2px}.dle-incoming-package button:disabled{opacity:.65;cursor:default}.dle-incoming-package [inert]{opacity:.55}.dle-incoming-package [hidden]{display:none!important}
 .dle-incoming-package nav{display:flex;flex-wrap:wrap;gap:4px;margin:12px 0}.dle-incoming-package .incoming-crumb{border:0;padding:3px 5px;color:#bae6fd;background:transparent;overflow-wrap:anywhere;text-align:left}.incoming-crumb:after{content:' /';color:#94a3b8}.incoming-crumb[aria-current]:after{content:''}
 .dle-incoming-package table{width:100%;min-width:680px;border-collapse:collapse;text-align:left;font:inherit}.dle-incoming-package td,.dle-incoming-package th{padding:7px 6px;border-bottom:1px solid #334155;vertical-align:top}.dle-incoming-package th{white-space:nowrap}.dle-incoming-package td:nth-child(3){white-space:nowrap}.dle-incoming-package td button{white-space:nowrap}.incoming-filename{overflow-wrap:anywhere;min-width:160px}.incoming-scroll{overflow-x:auto;max-width:100%}.dle-incoming-package small{color:#cbd5e1}.incoming-folder{margin:6px 0}
 .incoming-counts{display:flex;gap:12px;justify-content:space-between;align-items:center;margin:0 0 7px}.dle-incoming-package .incoming-handled-toggle{font-size:12px;padding:3px 8px;min-height:30px}.incoming-actions{min-width:230px;max-width:330px}.incoming-inline{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.incoming-inline select{flex:1}.dle-incoming-package .incoming-actions :is(select,button){font-size:12px}.incoming-actions>.incoming-inline+.incoming-inline,.incoming-reference{margin-top:6px}.incoming-reference{display:block;width:100%}.incoming-decision-detail{font-size:12px;color:#cbd5e1;margin-top:4px}.incoming-decision-detail summary{cursor:pointer}.incoming-decision-detail small{display:block}
 .incoming-file-more{margin-top:5px;white-space:normal;font-size:12px}.incoming-file-more summary{cursor:pointer;color:#bae6fd}.incoming-file-actions{display:flex;gap:6px;flex-direction:column;align-items:flex-start;padding-top:6px;max-width:300px}.incoming-file-actions button{white-space:normal!important;font-size:12px}.incoming-file-actions [popover]{white-space:normal}.incoming-message:empty{display:none}
 @media(max-width:600px){.dle-incoming-package table{min-width:0}.dle-incoming-package tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 8px;padding:8px 0;border-bottom:1px solid #334155}.dle-incoming-package tr:first-child{display:none}.dle-incoming-package td{border:0;padding:0;min-width:0;max-width:none}.dle-incoming-package td:first-child{grid-column:1 / -1;grid-row:1}.dle-incoming-package td:nth-child(2){grid-column:1;grid-row:2;font-size:12px;color:#cbd5e1}.dle-incoming-package td:nth-child(3){grid-column:2;grid-row:2;font-size:12px;color:#cbd5e1}.dle-incoming-package td:last-child{grid-column:1 / -1;grid-row:3}.dle-incoming-package td :is(button,select){min-height:40px}.incoming-inline select{flex-basis:180px}.incoming-filename{min-width:0}}
 `;document.head.append(css);
 window.DleIncomingPackage=Object.freeze({open});
})(window,document);

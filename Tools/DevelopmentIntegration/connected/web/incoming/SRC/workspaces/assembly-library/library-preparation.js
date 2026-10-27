(function(window,document){















 'use strict';















 const tr='/api/quoting/v1/technical-review/preparation',lib='/api/quoting/v1/assembly-library/preparation';















 const sessions=new Set();
 async function incoming(host,options,trigger){try{if(!window.DleIncomingPackage){if(!window.DleIncomingPackageLoading)window.DleIncomingPackageLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/incoming/SRC/workspaces/assembly-library/incoming-package.js';script.onload=resolve;script.onerror=()=>{window.DleIncomingPackageLoading=null;reject(Error('Incoming package could not load.'));};document.head.append(script);});await window.DleIncomingPackageLoading;}await window.DleIncomingPackage.open({...options,host},trigger);}catch(e){host.append(status(e.message));}}















 const sheet=document.createElement('style');sheet.textContent=`.library-preparation{color-scheme:dark;overflow-wrap:anywhere;font:14px/1.45 system-ui,sans-serif}.library-preparation input,.library-preparation select,.library-preparation textarea{color:#f1f5f9;background:#111c30;border:1px solid #94a3b8;border-radius:5px;font:inherit;max-width:100%;padding:.35rem;box-sizing:border-box}.library-preparation input::placeholder{color:#b8c5d6;opacity:1}.library-preparation button{color:#f1f5f9;background:#1e293b;border:1px solid #94a3b8;border-radius:5px;padding:.35rem .6rem;font:inherit;cursor:pointer;min-height:34px}.library-preparation button:disabled{color:#b8c5d6;background:#172033;cursor:default}.library-preparation select{width:100%;min-width:0}.library-preparation :focus-visible{outline:2px solid #93c5fd;outline-offset:3px}.library-preparation [hidden]{display:none!important}.library-preparation section{min-width:0}.library-preparation h2{font-size:21px}.library-preparation h3{font-size:16px;margin:.6rem 0}.library-preparation p{margin:.4rem 0}.library-preparation small{color:#cbd5e1}.library-preparation label,.library-preparation td,.library-preparation th{color:#f1f5f9}.library-preparation td,.library-preparation th{padding:.4rem;text-align:left;border-bottom:1px solid #475569}.library-preparation th{background:#1e293b}.library-preparation td{background:#0f172a}.library-preparation summary{color:#93c5fd;cursor:pointer}.library-preparation input[type=checkbox]{accent-color:#93c5fd;width:16px;height:16px;flex:none}.library-preparation .prep-task{display:flex;gap:.5rem;align-items:center;min-height:34px}.library-preparation .prep-file{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;padding:.3rem 0;border-bottom:1px solid #334155}.library-preparation .prep-file span:first-child{flex:1;min-width:160px}.library-preparation .prep-package{border:1px solid #475569;border-radius:6px;padding:10px 12px;margin:10px 0}.library-preparation .prep-package-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.library-preparation .prep-package-head h3{margin:0 0 2px}.library-preparation .prep-package-head small{display:block}.library-preparation .prep-package>details{margin-top:6px}.library-preparation .prep-package>h3{margin-top:0}.library-preparation .prep-package-names{list-style:none;padding:0;margin:7px 0 0;font-size:13px;color:#e2e8f0}.library-preparation .prep-package-names li{margin:2px 0;overflow-wrap:anywhere}.library-preparation .prep-record-documents{margin-top:8px}.library-preparation .prep-record-documents-scroll{max-height:190px;overflow:auto}.library-preparation .prep-record-documents table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px}.library-preparation .prep-record-documents th:first-child{width:52%}.library-preparation .prep-record-documents th,.library-preparation .prep-record-documents td{padding:5px 6px;vertical-align:top;overflow-wrap:anywhere}.library-preparation .prep-record-documents th{position:sticky;top:0}.library-preparation .prep-record-documents p{font-size:13px}@media(max-width:550px){.library-preparation .prep-record-documents table{font-size:12px}.library-preparation .prep-record-documents th:first-child{width:40%}.library-preparation .prep-record-documents th,.library-preparation .prep-record-documents td:not(:first-child){overflow-wrap:normal}}.library-preparation .prep-bom-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;margin:10px 0;border:1px solid #64748b;border-radius:5px;background:#172033;font-size:13px}.library-preparation .prep-bom-badge{padding:2px 8px;border-radius:4px;background:#374151;color:#f3f4f6}.library-preparation .prep-bom-status small{color:#cbd5e1}.library-preparation .prep-bom-status[data-tone=draft] .prep-bom-badge,.library-preparation .prep-bom-status[data-tone=changes] .prep-bom-badge{background:#713f12;color:#fef3c7}.library-preparation .prep-bom-status[data-tone=submitted] .prep-bom-badge{background:#1e40af;color:#eff6ff}.library-preparation .prep-bom-status[data-tone=approved] .prep-bom-badge{background:#166534;color:#f0fdf4}`;document.head.append(sheet);















 function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}















 function button(text,fn){const b=el('button',text);b.type='button';b.onclick=fn;return b;}















 async function request(url,body){const r=await window.DleIntegration.request(url,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});let data;try{data=await r.json();}catch{throw Error(r.status===404?'Preparation is installed but awaits SIM activation.':'Preparation response could not be verified. Reopen to check saved state.');}if(!r.ok)throw Error(data.message||'Preparation request failed.');return data;}















 function field(label,input){const wrap=el('label',label);wrap.style.display='grid';wrap.style.gap='.3rem';wrap.append(input);return wrap;}















 function section(title){const s=el('section');s.append(el('h3',title));return s;}
 function packageNames(files){const list=el('ul');list.className='prep-package-names';list.setAttribute('aria-label','Incoming filenames');for(const file of files)list.append(el('li',file.name));return list;}















 function status(text){const p=el('p',text);p.setAttribute('role','status');return p;}















 function style(host){host.classList.add('library-preparation');host.style.cssText='color:#f1f5f9;background:#0f172a;padding:1rem;border:1px solid #64748b;border-radius:8px;display:grid;gap:.7rem;';}















 async function download(url){const f=await request(url);const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));const u=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=el('a');a.href=u;a.download=f.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);}















 const taskLabels={IDENTIFY_FILES:'Identify and disposition files',COMPARE_FILES:'Compare incoming files with existing Library files',BUILD_BOM:'Build DLE-OS BOM',CHECK_FILES:'Check existing drawings/files',RESOLVE_REVISION:'Resolve revision difference'};







 const labels={AWAITING_ASSESSMENT:'Awaiting assessment',ASSESSMENT_DRAFT:'Assessment saved',NEEDS_PREPARATION:'Sent to Library',WAITING_FOR_INFORMATION:'Waiting for information',IN_PREPARATION:'In Library preparation'};















 async function assessment(host,intakeId,lineNumber,onBack){















  const s={host,dirty:false,busy:false};sessions.add(s);style(host);host.replaceChildren(status('Loading assessment…'));















  async function load(line){s.busy=true;host.querySelectorAll('button,input,select,textarea').forEach(n=>n.disabled=true);try{draw(await request(tr+'?'+new URLSearchParams({intakeId,lineNumber:line})));}catch(e){host.replaceChildren(button('Back to Technical Review',()=>{s.dirty=false;sessions.delete(s);onBack();}),status(e.message),button('Retry',()=>load(line)));}finally{s.busy=false;}}















  function draw(data){















   const r=data.record,source=data.source;host.replaceChildren();s.dirty=false;















   const back=button('Back to Technical Review',()=>{if(s.busy)return;if(s.dirty&&!confirm('Discard unsaved assessment edits?'))return;s.dirty=false;sessions.delete(s);onBack();});















   const message=status(labels[r.status]||r.status);const title=el('h2',`${r.displayId||r.intakeId} — Initial assessment`);















   host.append(back,title,el('p',`${source.customer.customerName} · ${r.assemblyNumber} · Incoming revision ${r.incomingRevision||'not provided'}${r.projectId?' · Qty '+source.assemblies[0].quantity+' · '+(source.assemblies[0].scope||'').replaceAll('_',' '):''}`),message);















   const line=el('select');line.setAttribute('aria-label','Assembly line');for(const a of source.assemblies){const o=el('option',`${a.assemblyNumber} · ${a.revision||'revision not provided'} · Qty ${a.quantity}`);o.value=a.lineNumber;line.append(o);}line.value=r.lineNumber;line.onchange=()=>{if(s.dirty&&!confirm('Discard unsaved assessment edits before changing assembly?')){line.value=r.lineNumber;return;}load(line.value);};if(source.assemblies.length>1)host.append(field('Assembly line',line));















   const editable=data.canEdit&&data.libraryResolvesDestination===true&&r.status!=='IN_PREPARATION';if(data.libraryResolvesDestination!==true)message.textContent='Library destination handoff awaits SIM restart. Viewing only for now.';















   const incoming=el('section');incoming.className='prep-package';incoming.setAttribute('aria-label','Incoming files');const packageHead=el('div');packageHead.className='prep-package-head';const packageTitle=el('div');packageTitle.append(el('h3','Incoming files'),el('small',source.files.length+' '+(source.files.length===1?'file':'files')));packageHead.append(packageTitle);const chosen=new Set(r.revision===0?source.files.filter(f=>f.binaryStatus==='VERIFIED').map(f=>f.documentId):r.files.map(f=>f.documentId));const included=status(''),change=el('details');change.append(el('summary','Change included files'));







   function count(){included.textContent=chosen.size+' of '+source.files.length+' files included in the Library handoff';}







   for(const f of source.files){const check=el('input');check.type='checkbox';check.checked=chosen.has(f.documentId);check.disabled=!editable||f.binaryStatus!=='VERIFIED';check.setAttribute('aria-label','Include '+f.name);check.onchange=()=>{check.checked?chosen.add(f.documentId):chosen.delete(f.documentId);s.dirty=true;count();};const label=el('label');label.className='prep-task';label.append(check,el('span',f.name));change.append(label);}







   const packageButton=button('Open incoming package',()=>void window.DleLibraryPreparation.incoming(host,{module:'review',intakeId,lineNumber:r.lineNumber},packageButton));packageHead.append(packageButton);incoming.append(packageHead,packageNames(source.files));count();change.insertBefore(included,change.children[1]||null);incoming.append(change);host.append(incoming);















   const matching=section('Assembly Library');matching.classList.add('prep-package');matching.setAttribute('aria-label','Assembly Library');let key=r.libraryKey||'',historicalKey=r.historicalMatch?.sourceKeyRaw||r.libraryKey||'',page=1,inspection=0;const display=v=>String(v??'').trimEnd();







   matching.append(el('small','Library catalog · Preliminary July 29 snapshot and Library records. See Details for available BOMs and files.'));







   const selectedLabel=status(''),summary=el('div'),browser=el('div'),preview=el('div');preview.setAttribute('role','region');preview.setAttribute('aria-label','Library record details');







   const search=el('input');search.type='search';search.maxLength=100;search.placeholder='Assembly or drawing number';search.setAttribute('aria-label','Search assemblies, drawings or revisions');







   const blank=el('input');blank.type='checkbox';blank.setAttribute('aria-label','Without drawing numbers');const blankLabel=field('Without drawing numbers',blank);







   const tools=el('div');tools.style.cssText='display:flex;gap:.6rem;align-items:center;flex-wrap:wrap';tools.append(search,blankLabel);







   const resultStatus=status(''),scroller=el('div');scroller.style.cssText='overflow:auto;max-width:100%;';const table=el('table');table.style.cssText='width:100%;border-collapse:collapse;color:#f1f5f9;background:#0f172a;font-size:.85rem';const head=el('thead'),hr=el('tr');for(const label of ['Assembly','Drawing','Drawing rev','BOM rev','']){const th=el('th',label);th.scope='col';hr.append(th);}head.append(hr);const body=el('tbody');table.append(head,body);scroller.append(table);







   const prev=button('Previous',()=>{page--;results();}),next=button('Next',()=>{page++;results();}),pageLabel=el('span'),pager=el('div');pager.style.cssText='display:flex;gap:.6rem;align-items:center;flex-wrap:wrap';pager.append(prev,pageLabel,next);browser.append(tools,resultStatus,scroller,preview);







   const dr=el('input'),br=el('input');dr.value=r.drawingRevision;br.value=r.bomRevision;dr.maxLength=br.maxLength=100;dr.disabled=br.disabled=!editable;dr.oninput=br.oninput=()=>s.dirty=true;







   function selection(){browser.hidden=!!historicalKey;changeSelection.hidden=!historicalKey;clear.hidden=!historicalKey;const h=data.headers.find(h=>h.sourceKeyRaw===historicalKey);selectedLabel.textContent=h?'Selected assembly: '+display(h.billNumber)+' · Drawing rev '+(display(h.drawingRevision)||'?')+' · BOM rev '+(display(h.bomRevision)||'?'):'No assembly selected';selectedLabel.style.fontWeight=historicalKey?'600':'';difference.textContent=h&&(display(h.billNumber)!==r.assemblyNumber||display(h.drawingRevision)!==r.incomingRevision||display(h.bomRevision)!==r.incomingRevision)?'Incoming: '+r.assemblyNumber+' · Revision '+r.incomingRevision:'';}









   function results(){body.replaceChildren();const q=search.value.toLocaleLowerCase();if(!q.trim()){resultStatus.textContent='Search by assembly, drawing or revision.';scroller.hidden=true;return;}scroller.hidden=false;const rows=data.headers.filter(h=>(!blank.checked||!display(h.drawingNumber))&&(!q||[h.billNumber,h.drawingNumber,h.drawingRevision,h.bomRevision].some(v=>String(v).toLocaleLowerCase().includes(q))));const pages=Math.max(1,Math.ceil(rows.length/10));page=Math.min(page,pages);for(const h of rows.slice(0,10)){const row=el('tr');row.dataset.sourceKey=h.sourceKeyRaw;for(const value of [h.billNumber,h.drawingNumber,h.drawingRevision,h.bomRevision]){const cell=el('td',display(value)||'—');cell.style.cssText='padding:.4rem;border-bottom:1px solid #d1dbe3;white-space:pre-wrap;overflow-wrap:anywhere';row.append(cell);}const cell=el('td');const inspect=button('Details',()=>inspectRecord(h,inspect));inspect.setAttribute('aria-label','Details for '+display(h.billNumber));const choose=button('Select this assembly',()=>{if(!editable||s.busy)return;historicalKey=h.sourceKeyRaw;s.dirty=true;selection();inspection++;preview.replaceChildren();changeSelection.focus({preventScroll:true});});choose.disabled=!editable;const actions=el('div');actions.style.cssText='display:flex;gap:.4rem;flex-wrap:wrap';actions.append(inspect,choose);cell.append(actions);row.append(cell);body.append(row);}if(!rows.length){const row=el('tr'),cell=el('td','No matching assemblies. Try another number or revision.');cell.colSpan=5;row.append(cell);body.append(row);}resultStatus.textContent=rows.length>10?'Showing 10 of '+rows.length+' matches. Refine your search.':rows.length+' matching record(s)';pageLabel.textContent='Page '+page+' of '+pages;prev.disabled=page===1;next.disabled=page===pages;}







   async function inspectRecord(h,origin){const generation=++inspection;preview.replaceChildren();const close=button('Close details',()=>{inspection++;preview.replaceChildren();origin.focus({preventScroll:true});});preview.append(close,el('h4',display(h.billNumber)),el('p','Incoming: '+r.assemblyNumber+' · Revision '+r.incomingRevision),el('p','Library: '+display(h.billNumber)+' · Drawing rev '+(display(h.drawingRevision)||'?')+' · BOM rev '+(display(h.bomRevision)||'?')),el('small','Incoming customer: '+source.customer.customerName+'. Customer ownership is not supplied by this Library catalog.'));







    if(display(h.billNumber)!==r.assemblyNumber||display(h.drawingRevision)!==r.incomingRevision||display(h.bomRevision)!==r.incomingRevision)preview.append(status('Assembly or revision differs from Intake. Library will review the difference.'));







    preview.append(el('p',h.contractVersion==='LIBRARY_MANAGED_V1'?'Library-managed identity':'Preliminary BMM header · July 29, 2026'));







    const availability=el('div');availability.append(status('Checking saved Library information…'));preview.append(availability);















    try{const [folder,bom,documents]=await Promise.all([request('/api/quoting/v1/assembly-library/folder?'+new URLSearchParams({key:h.sourceKeyRaw})),request('/api/quoting/v1/assembly-library/bom?'+new URLSearchParams({key:h.sourceKeyRaw})),request('/api/quoting/v1/assembly-library/documents?'+new URLSearchParams({key:h.sourceKeyRaw}))]);if(generation!==inspection)return;availability.replaceChildren();






     const saved=bom.record,draft=saved?.draft,reviews=saved?.reviews||[],approved=[...reviews].reverse().find(v=>v.status==='APPROVED'),latestReview=reviews.at(-1);






     const bomSection=section('DLE-OS BOM');






     if(!draft&&!reviews.length)bomSection.append(el('p','Not yet created — Library preparation needed.'));






     if(approved)bomSection.append(el('p','Approved — version '+(approved.snapshot?.internalVersion||approved.version)));






     if(draft)bomSection.append(el('p','Draft — version '+(draft.internalVersion||1)));






     if(latestReview&&latestReview!==approved)bomSection.append(el('p',({SUBMITTED:'Submitted for review',CHANGES_REQUESTED:'Changes requested',WITHDRAWN:'Withdrawn'})[latestReview.status]+' — version '+(latestReview.snapshot?.internalVersion||latestReview.version)));






     availability.append(bomSection);






     const folderSection=section('Linked folder');






     if(folder.record?.current){const path=folder.windowsPath;if(path){const address=el('p',path);address.style.cssText='user-select:text;overflow-wrap:anywhere';const copied=status('');const copy=button('Copy address',async()=>{try{await navigator.clipboard.writeText(path);copied.textContent='Address copied.';}catch{copied.textContent='Copy unavailable. Select the address above and copy it.';}});folderSection.append(address,copy,copied);}else folderSection.append(el('p','Linked; full address unavailable.'));}






     else folderSection.append(el('p','No folder linked.'));






     availability.append(folderSection);






     const latest=new Map();for(const d of documents.record?.history||[]){const prior=latest.get(d.id);if(!prior||d.version>prior.version)latest.set(d.id,d);}






     const purposes={DRAWING:'Drawing',BOM_SOURCE:'BOM source',VPRO5_TXT:'VPRO5 Export (.txt)',VPRO5_BMM_PDF:'VPRO5 BMM (.pdf)',WORK_INSTRUCTION:'Work instruction',IMAGE:'Image',PART_EVIDENCE:'Part approval / evidence',TRAVELER:'Traveler',CHANGE_NOTES:'Revision / change notes',QUOTE:'Quote / commercial reference',NOTES:'General notes',REFERENCE:'Reference',OTHER:'Other'};






     for(const [use,title] of [['PRODUCTION','Production files'],['MATERIALS','Materials files']]){const area=section(title),files=[...latest.values()].filter(d=>d.use===use||d.use==='BOTH');if(!files.length)area.append(el('p','None identified for '+use.toLowerCase()+'.'));for(const d of files){const row=el('p'),name=d.source?.relativePath||d.number||'Document';row.append(el('span',name),el('small',' — '+((d.purposes||[]).map(p=>purposes[p]||p).join(', ')||'Purpose not specified')));area.append(row);}availability.append(area);}






     availability.append(el('small','Identified files are not approval. Folder availability is not checked here.'));






     }catch(e){if(generation===inspection)availability.replaceChildren(status('Library details unavailable: '+e.message));}







   }







   search.oninput=()=>{page=1;results();};blank.onchange=()=>{page=1;results();};







   const clear=button('Clear selection',()=>{if(!editable||s.busy)return;historicalKey='';s.dirty=true;inspection++;preview.replaceChildren();selection();search.focus({preventScroll:true});});clear.disabled=!editable;







   const changeSelection=button('Change',()=>{inspection++;preview.replaceChildren();browser.hidden=false;changeSelection.hidden=true;search.focus({preventScroll:true});});changeSelection.disabled=!editable;const difference=el('small');const selectedActions=el('div');selectedActions.style.cssText='display:flex;gap:.4rem;align-items:center;flex-wrap:wrap';selectedActions.append(selectedLabel,changeSelection,clear);matching.append(selectedActions,difference,browser);host.append(matching);selection();







   if(data.canBrowseLibrary){results();}else{browser.replaceChildren(status('Library viewing access is required to search existing records.'));}















   const tasks=new Set(r.tasks||[]),taskSection=section('Preparation needed');for(const [id,labelText] of ['IDENTIFY_FILES','BUILD_BOM','COMPARE_FILES'].map(id=>[id,taskLabels[id]])){const check=el('input');check.type='checkbox';check.checked=tasks.has(id);check.disabled=!editable;check.setAttribute('aria-label',labelText);check.onchange=()=>{check.checked?tasks.add(id):tasks.delete(id);s.dirty=true;};const label=el('label');label.className='prep-task';label.append(check,el('span',labelText));taskSection.append(label);}for(const id of tasks)if(!['IDENTIFY_FILES','BUILD_BOM','COMPARE_FILES'].includes(id))taskSection.append(el('small','Previously requested: '+(taskLabels[id]||id)+'. Retained.'));host.append(taskSection);







   const work=el('textarea');work.rows=2;work.maxLength=4000;work.value=r.work;work.disabled=!editable;work.oninput=()=>s.dirty=true;host.append(field('Notes (optional)',work));















   const actions=el('div');actions.style.cssText='display:flex;gap:.5rem;flex-wrap:wrap;';















   async function save(action){if(s.busy)return;s.busy=true;const locked=[...host.querySelectorAll('button,input,select,textarea')].map(n=>[n,n.disabled]);locked.forEach(([n])=>n.disabled=true);try{const next=await request(tr,{intakeId,lineNumber:r.lineNumber,token:data.token,sourceFingerprint:data.sourceFingerprint,action,libraryKey:key||null,drawingRevision:dr.value,bomRevision:br.value,work:work.value,documentIds:[...chosen],tasks:[...tasks],historicalLibraryKey:historicalKey||null});draw(next);}catch(e){message.textContent=e.message+' Your edits are retained.';}finally{s.busy=false;locked.forEach(([n,disabled])=>{if(n.isConnected)n.disabled=disabled;});}}















   if(editable)for(const [a,label] of [['SAVE','Save'],['SEND','Send to Library']])actions.append(button(label,()=>save(a)));const later=button('Request information',()=>{});later.disabled=true;later.title='Available in a future update';actions.append(later);host.append(actions);































   if(r.history.length){const history=el('details');history.append(el('summary','Assessment history'));for(const e of r.history)history.append(el('p',`${e.action} · ${e.actor.name} · ${e.actor.atUtc} — ${e.notes}`));host.append(history);}















  }















  await load(lineNumber);















 }















 function documentTable(rows,label,regionLabel){
  const scroll=el('div');scroll.className='prep-record-documents-scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',regionLabel);
  const table=el('table');table.setAttribute('aria-label',label);const head=el('thead'),heading=el('tr');
  for(const text of ['Filename','Category','Use']){const th=el('th',text);th.scope='col';heading.append(th);}head.append(heading);const body=el('tbody');table.append(head,body);
  for(const item of rows){const row=el('tr'),name=el('td',item.name);if(item.path)name.title=item.path;row.append(name);
   for(const value of [item.category,item.use]){const cell=el('td',value||'\u2014');if(!value){cell.title='Not assigned';cell.setAttribute('aria-label','Not assigned');}row.append(cell);}body.append(row);}
  scroll.append(table);return scroll;
 }
 function incomingTable(files){
  const host=el('div');host.className='prep-record-documents prep-incoming-documents';
  // Intake identification is preliminary, not a saved Library category or use.
  if(files.length)host.append(documentTable(files.map(f=>({name:f.name})), 'Incoming request files','Incoming document list'));
  else host.append(el('p','No incoming files for this request.'));
  return host;
 }

 async function revisionName(host,key,options={}){
  try{if(!window.DleLibraryRevisionName){if(!window.DleLibraryRevisionNameLoading)window.DleLibraryRevisionNameLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/incoming/SRC/workspaces/assembly-library/library-revision-name.js';script.onload=resolve;script.onerror=()=>{window.DleLibraryRevisionNameLoading=null;reject(Error('Revision name controls could not load.'));};document.head.append(script);});await window.DleLibraryRevisionNameLoading;}await Promise.resolve();if(host.isConnected)return window.DleLibraryRevisionName.attach(host,key,options);}
  catch(e){host.textContent=e.message;}
 }

 function recordBomStatus(host,key,drawing,bom){
  let generation=0;
  function paint(text,tone='neutral',detail=''){host.dataset.tone=tone;const badge=el('strong',text);badge.className='prep-bom-badge';host.replaceChildren(el('span','DLE-OS BOM'),badge);if(detail)host.append(el('small',detail));}
  async function refresh(){
   const attempt=++generation;paint('Checking saved status…');host.removeAttribute('title');
   try{
    const q=new URLSearchParams({key}),[data,packages]=await Promise.all([request('/api/quoting/v1/assembly-library/bom?'+q),request('/api/quoting/v1/assembly-library/package?'+q)]);
    if(attempt!==generation||!host.isConnected)return;
    const record=data.record;
    if(record?.sourceKeyRaw!==key||packages.record?.sourceKeyRaw!==key)throw Error('Assembly identity differs. Reopen Assembly Records to check.');
    if(!data.token||packages.bomToken!==data.token)throw Error('The saved BOM changed while checking. Reopen this request.');
    const matches=d=>d&&d.drawingRevision===drawing&&d.bomRevision===bom;
    const draft=record.draft;
    if(draft&&!matches(draft))throw Error('BOM revision differs. Open Assembly Records to check.');
    const versions=[...(record.reviews||[]).map(v=>({...v,bom:v.snapshot})),...(packages.record.versions||[])].filter(v=>matches(v.bom)).sort((a,b)=>Date.parse(a.submittedBy?.atUtc||0)-Date.parse(b.submittedBy?.atUtc||0));
    const currentPackage=(packages.record.versions||[]).filter(v=>matches(v.bom)&&v.bom.id===draft?.id).at(-1);
    const pending=(record.reviews||[]).find(v=>v.status==='SUBMITTED'&&matches(v.snapshot));
    const current=currentPackage||(pending?{...pending,bom:pending.snapshot}:null)||(!draft?versions.at(-1):null);
    const labels={SUBMITTED:'Submitted for approval',APPROVED:'Approved',CHANGES_REQUESTED:'Changes requested',WITHDRAWN:'Withdrawn'};
    const saved=current?.bom||draft;
    const text=current?labels[current.status]:draft?'Draft':'Not built';let detail='';
    if(!text)throw Error('Saved review status could not be confirmed. Open Assembly Records to check.');
    if(saved){const version=saved.internalVersion||current?.version||1;detail='v'+version+' \u00b7 '+saved.rows.length+' '+(saved.rows.length===1?'row':'rows');}
    const approved=versions.filter(v=>v.status==='APPROVED').at(-1);
    if(approved&&current?.status!=='APPROVED'&&approved.bom.id!==saved?.id)detail+=' \u00b7 Approved v'+(approved.bom.internalVersion||approved.version)+' available';
    paint(text,current?({SUBMITTED:'submitted',APPROVED:'approved',CHANGES_REQUESTED:'changes',WITHDRAWN:'neutral'}[current.status]):draft?'draft':'neutral',detail);
   }catch(e){if(attempt===generation&&host.isConnected){paint('Status unavailable','neutral',e.message);host.title=e.message;}}
  }
  return refresh;
 }

 function recordDocuments(host,key,drawing,bom){
  let generation=0;
  async function refresh(){
   const attempt=++generation;
   host.replaceChildren(status('Loading identified files.'));
   try{
    const data=await request('/api/quoting/v1/assembly-library/documents?'+new URLSearchParams({key}));
    if(attempt!==generation||!host.isConnected)return;
    const r=data.record;
    if(!r||r.sourceKeyRaw!==key||r.drawingRevision!==drawing||r.bomRevision!==bom)throw Error('Document revisions differ from the selected records. Open Assembly Records to check.');
    const latest=new Map();for(const d of r.history||[]){const previous=latest.get(d.id);if(!previous||d.version>previous.version)latest.set(d.id,d);}
    const uses={MATERIALS:'Materials',PRODUCTION:'Production',BOTH:'Materials + Production',REFERENCE:'Reference only'};
    const files=[...latest.values()].filter(d=>d.association?.sourceKeyRaw===key&&d.association.drawingRevision===drawing&&d.association.bomRevision===bom&&uses[d.use]&&(d.purposes.includes('DRAWING')||d.purposes.includes('BOM_SOURCE')));
    host.replaceChildren();
    if(!files.length){host.append(el('p','No identified drawings/BOM files.'));return;}
    host.append(el('small','Identified drawings / BOM files'));
    const rows=files.map(d=>{const path=d.source?.relativePath||'',drawing=d.purposes.includes('DRAWING'),bom=d.purposes.includes('BOM_SOURCE');return {path,name:path.split(/[\\/]/).at(-1)||d.number||'Filename not recorded',category:drawing?(bom?'Drawing + BOM':'Drawing'):'BOM',use:uses[d.use]};});
    host.append(documentTable(rows,'Identified drawings and BOM files','Identified document list'));
   }catch(e){if(attempt===generation&&host.isConnected)host.replaceChildren(status('Identified files unavailable: '+e.message));}
  }
  return refresh;
 }

 async function queue(host,openAssembly,navigation={}){
  style(host);
  host.replaceChildren(el('h3','Library Requests'));
  const message=status('Loading requests.');host.append(message);
  try{
   let data=await request(lib),openedId=null,busy=false;
   const list=el('div'),panel=el('section');panel.hidden=true;
   panel.setAttribute('aria-label','Preparation request');host.append(list);
   if(navigation.workspace){style(navigation.workspace);navigation.workspace.replaceChildren(panel);}else host.append(panel);
   const brief={IDENTIFY_FILES:'Identify files',BUILD_BOM:'Build BOM',COMPARE_FILES:'Compare files',CHECK_FILES:'Check Library files',RESOLVE_REVISION:'Resolve revision'};
   const display=v=>String(v??'').trimEnd();
   let lastOpen;

   function drawList(){
    message.textContent=data.items.length?'':'No Library requests.';message.hidden=data.items.length>0;
    list.replaceChildren();
    if(!data.items.length)return;
    const scroll=el('div');scroll.style.overflowX='auto';
    const table=el('table');table.style.cssText='width:100%;border-collapse:collapse;font:inherit;font-size:.85rem';
    table.setAttribute('aria-label','Library requests');
    const head=el('thead'),heading=el('tr');
    for(const caption of ['Assembly','Incoming revision','Request','Qty','Work','']){const cell=el('th',caption);cell.scope='col';heading.append(cell);}
    head.append(heading);const body=el('tbody');table.append(head,body);
    for(const item of data.items){
     const r=item.record,row=el('tr');row.dataset.preparationId=r.id;
     const assembly=el('td'),name=el('strong',r.assemblyNumber);assembly.append(name);
     if(item.finalReview)assembly.append(el('small',' · '+(item.displayStatusLabel||labels[r.status])));else if(r.status==='IN_PREPARATION')assembly.append(el('small',' · In preparation'));
     row.append(assembly,el('td',r.incomingRevision||'Not provided'),el('td',r.displayId||r.intakeId),el('td',r.requestedQuantity??'—'));
     const work=el('td',(r.tasks||[]).map(t=>brief[t]||taskLabels[t]||t).join(' · ')||(r.work?'See notes':'Not specified'));
     const cell=el('td'),open=button('Open request',()=>{lastOpen=open;openItem(r.id);});
     open.setAttribute('aria-label','Open request '+(r.displayId||r.intakeId));if(r.id===openedId)lastOpen=open;cell.append(open);row.append(work,cell);body.append(row);
    }
    scroll.append(table);list.append(scroll);
   }

   function openItem(id){
    const item=data.items.find(i=>i.record.id===id);if(!item)return;
    const entering=openedId!==id,r=item.record;openedId=id;list.hidden=true;message.hidden=true;panel.hidden=false;panel.replaceChildren();
    let changed=false;
    const back=button(navigation.workspace?'Back to Library':'Back to requests',()=>{if(busy)return;if(changed&&!window.confirm('Leave without using this destination choice?'))return;openedId=null;panel.hidden=true;list.hidden=false;message.hidden=data.items.length>0;navigation.onBack?.();lastOpen?.focus({preventScroll:true});});
    const heading=el(navigation.workspace?'h2':'h3',r.assemblyNumber+' · '+(r.incomingRevision||'Revision not provided'));heading.tabIndex=-1;if(navigation.titleId)heading.id=navigation.titleId;
    panel.dataset.preparationId=r.id;
    panel.append(back,heading,el('p',(r.displayId||r.intakeId)+(r.requestedQuantity!=null?' · Qty '+r.requestedQuantity:'')+' · '+(item.displayStatusLabel||labels[r.status])));
    if(item.finalReview?.status==='CHANGES_REQUESTED'&&item.finalReview.comments){const returned=el('section');returned.className='prep-package';returned.append(el('h3','Changes requested'),el('p',item.finalReview.comments),el('small','Open Assembly Records to address the review note.'));panel.append(returned);}
    const work=el('p',(r.tasks||[]).map(t=>brief[t]||taskLabels[t]||t).join(' · '));if(work.textContent)panel.append(work);
    if(r.work){const notes=el('p');notes.style.whiteSpace='pre-wrap';notes.append(el('strong','Notes: '),el('span',r.work));panel.append(notes);}
    if(!r.libraryKey&&r.historicalMatch)panel.append(el('p','Selected Library assembly: '+display(r.historicalMatch.billNumber)+' · Drawing '+(display(r.historicalMatch.drawingRevision)||'?')+' · BOM '+(display(r.historicalMatch.bomRevision)||'?')));
    const err=status('');panel.append(err);

    async function action(action,documentId,extra={},dialog=null){
     if(busy)return;busy=true;
     const controls=[...panel.querySelectorAll('button,input,select')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);
     try{await request(lib,{id:r.id,token:item.token,action,documentId,...extra});changed=false;data=await request(lib);dialog?.close();drawList();openItem(id);}
     catch(e){err.textContent=e.message+' Check saved state before retrying if the outcome is uncertain.';const feedback=dialog?.querySelector('.incoming-message');if(feedback)feedback.textContent=err.textContent;}
     finally{busy=false;controls.forEach(([n,disabled])=>{if(n.isConnected)n.disabled=disabled;});}
    }

    const files=el('section');files.className='prep-package';files.setAttribute('aria-label','Incoming files');const packageHead=el('div');packageHead.className='prep-package-head';const packageTitle=el('div'),packageCount=el('small'),packageSummary=el('div');packageTitle.append(el('h3','Incoming files'),packageCount);packageHead.append(packageTitle);
    function isHandled(f){return (r.fileDispositions||[]).some(d=>['ALREADY_IN_RECORDS','DO_NOT_USE'].includes(d.decision)&&d.documentId===f.documentId&&d.file?.documentId===f.documentId&&d.file.name===f.name&&d.file.sha256===f.sha256&&d.file.size===f.size);}
    function updateIncomingSummary(){const active=r.files.filter(f=>!isHandled(f)),handled=r.files.length-active.length;packageCount.textContent=active.length+' '+(active.length===1?'file':'files')+' to review'+(handled?' \u00b7 '+handled+' handled':'');packageSummary.replaceChildren(active.length?incomingTable(active):el('small','No files awaiting disposition.'));}
    function dispositionSaved(result){
     if(result.record?.id!==r.id||typeof result.token!=='string')throw Error('The request has changed. Reopen its incoming package.');
     // Refresh this record/token and its summary only. Rebuilding openItem would discard
     // unsaved destination/revision inputs and the separate revision display-name editor.
     Object.assign(r,result.record);item.token=result.token;
     if(panel.isConnected&&openedId===id)updateIncomingSummary();
    }
    function fileActions(file,host,dialog){
     const f=r.files.find(f=>f.documentId===file.id);if(!f||isHandled(f))return;
     const more=el('details');more.className='incoming-file-more';more.setAttribute('aria-label','More for '+f.name);more.append(el('summary','More'));const actions=el('div');actions.className='incoming-file-actions';more.append(actions);
     if(r.status==='IN_PREPARATION'&&data.canEdit&&window.DleIntegration?.managedEvidence){
      let pendingTransfer=null;
      actions.append(button('Place in managed Library evidence',async()=>{if(busy)return;busy=true;try{
       const url='/api/quoting/v1/assembly-library/preparation/managed-evidence';
       const target=await request(url+'?id='+encodeURIComponent(r.id)+'&token='+encodeURIComponent(item.token)+'&documentId='+encodeURIComponent(f.documentId));
       pendingTransfer??={preparationId:r.id,expectedPreparationToken:item.token,documentId:f.documentId,requestId:crypto.randomUUID(),expectedFolderToken:target.expectedFolderToken};
       const result=await request(url,pendingTransfer);actions.append(el('p','Verified managed evidence: '+result.receipt.relativePath));
      }catch(e){err.textContent=e.message+' Verify saved state before retrying.';}finally{busy=false;}}));
     }
     if(r.promoted.includes(f.documentId))actions.append(el('small','Saved inside OS'));
     else if(r.status==='IN_PREPARATION'&&data.canEdit)actions.append(button('Save OS copy',()=>action('PROMOTE',f.documentId,{},dialog)));
     if(r.status==='IN_PREPARATION'&&data.canEdit&&window.DleOsCapabilities?.can?.('assembly_library.folder_copy')===true){const copy=el('span');actions.append(copy);void (async()=>{try{if(!window.DleLibraryFolderCopy){if(!window.DleLibraryFolderCopyLoading)window.DleLibraryFolderCopyLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/incoming/SRC/workspaces/assembly-library/library-folder-copy.js';script.onload=resolve;script.onerror=()=>{window.DleLibraryFolderCopyLoading=null;reject(Error('Folder copy controls unavailable.'));};document.head.append(script);});await window.DleLibraryFolderCopyLoading;}await Promise.resolve();if(copy.isConnected)window.DleLibraryFolderCopy.attach(copy,{preparationId:r.id,token:item.token,documentId:f.documentId,key:r.libraryKey});}catch(e){copy.textContent=e.message;}})();}
     if(actions.childElementCount)host.append(more);
    }
    const packageButton=button('Open incoming package',()=>void incoming(panel,{module:'library',preparationId:r.id,fileActions,onSaved:dispositionSaved},packageButton));packageHead.append(packageButton);files.append(packageHead,packageSummary);updateIncomingSummary();panel.append(files);
    if(r.status==='NEEDS_PREPARATION'&&data.canEdit&&data.libraryResolvesDestination){
     const setup=section('Library preparation');setup.style.maxWidth='42rem';
     const destination=el('select');destination.setAttribute('aria-label','Library destination');
     const blank=el('option','Choose where to prepare');blank.value='';destination.append(blank);
     const candidates=(data.headers||[]).filter(h=>display(h.billNumber)===r.assemblyNumber);
     for(const h of candidates){const option=el('option','Use existing: '+display(h.billNumber)+' · Drawing '+(display(h.drawingRevision)||'?')+' · BOM '+(display(h.bomRevision)||'?'));option.value=h.sourceKeyRaw;destination.append(option);}
     const create=el('option','Create a separate assembly revision');create.value='__new__';destination.append(create);
     const inspect=button('View existing assembly',async()=>{try{await openAssembly(destination.value,{preparationId:r.id},inspect);}catch(e){err.textContent=e.message;}});inspect.hidden=true;
     const drawing=el('input'),bom=el('input');drawing.maxLength=bom.maxLength=100;drawing.value=r.drawingRevision||r.incomingRevision;bom.value=r.bomRevision||'';
     const drawingField=field('Drawing revision',drawing),bomField=field('BOM revision (if known)',bom),difference=el('p');drawingField.hidden=bomField.hidden=true;
     const revisions=el('div');revisions.style.cssText='display:flex;gap:.7rem;flex-wrap:wrap';revisions.append(drawingField,bomField);
     const start=button('Start preparation',()=>{const h=candidates.find(h=>h.sourceKeyRaw===destination.value);void action('START',null,{destination:h?'existing':'new',libraryKey:h?.sourceKeyRaw||null,drawingRevision:h?display(h.drawingRevision):drawing.value,bomRevision:h?display(h.bomRevision):bom.value});});start.disabled=true;
     destination.onchange=()=>{changed=true;const fresh=destination.value==='__new__',h=candidates.find(h=>h.sourceKeyRaw===destination.value);inspect.hidden=!h;drawingField.hidden=bomField.hidden=!fresh;start.disabled=!fresh&&!h;difference.textContent=h&&(display(h.drawingRevision)!==r.incomingRevision||display(h.bomRevision)!==r.incomingRevision)?'Incoming revision: '+r.incomingRevision+'. Start preparation confirms use of this Library revision for this request only.':'';};
     drawing.oninput=bom.oninput=()=>changed=true;
     const actions=el('div');actions.style.cssText='display:flex;gap:.5rem;flex-wrap:wrap';actions.append(inspect,start);
     setup.append(field('Prepare in',destination),revisions,difference,actions);panel.append(setup);
    }else if(r.status==='NEEDS_PREPARATION'&&data.canEdit)panel.append(el('p','Destination selection awaits SIM activation.'));
    {
     const records=el('section');records.className='prep-package';records.setAttribute('aria-label','Assembly Records');
     const recordHead=el('div');recordHead.className='prep-package-head';const recordTitle=el('div');recordTitle.append(el('h3','Assembly Records'),el('small','Library BOM, identified files and linked folder'));
     recordHead.append(recordTitle);records.append(recordHead);
     if(r.libraryKey){
      const open=button('Open Assembly Records',async()=>{try{await openAssembly(r.libraryKey,{preparationId:r.id,incomingRevision:r.incomingRevision},open);}catch(e){err.textContent=e.message;}});recordHead.append(open);
      const selected=(data.headers||[]).find(h=>h.sourceKeyRaw===r.libraryKey);
      records.append(el('p',(selected?.contractVersion==='LIBRARY_MANAGED_V1'?'Library source: ':'VPRO5 source: ')+display(selected?selected.billNumber:r.assemblyNumber)+' \u00b7 Drawing revision '+(display(selected?selected.drawingRevision:r.drawingRevision)||'Not provided')+' \u00b7 BOM revision '+(display(selected?selected.bomRevision:r.bomRevision)||'Not provided')));
      const revision=el('div');records.append(revision);let revisionPanel;void revisionName(revision,r.libraryKey,{suggestion:r.incomingRevision,showSource:false,expectedSource:selected?{assemblyNumber:selected.billNumber,drawingRevision:selected.drawingRevision,bomRevision:selected.bomRevision}:null}).then(value=>revisionPanel=value);
      open.addEventListener('dle-library-records-return',()=>void revisionPanel?.refresh());
      const bomStatus=status('');bomStatus.className='prep-bom-status';bomStatus.style.fontSize='13px';records.append(bomStatus);
      const refreshBom=recordBomStatus(bomStatus,r.libraryKey,display(selected?selected.drawingRevision:r.drawingRevision),display(selected?selected.bomRevision:r.bomRevision));
      open.addEventListener('dle-library-records-return',()=>void refreshBom());void refreshBom();
      const documents=el('div');documents.className='prep-record-documents';records.append(documents);
      const refresh=recordDocuments(documents,r.libraryKey,display(selected?selected.drawingRevision:r.drawingRevision),display(selected?selected.bomRevision:r.bomRevision));
      open.addEventListener('dle-library-records-return',()=>void refresh());void refresh();
     }else records.append(el('p','No Assembly Records linked yet.'));
     panel.insertBefore(records,files);
    }
    navigation.onOpen?.(entering);heading.focus({preventScroll:true});
   }
   drawList();
  }catch(e){message.textContent=e.message;host.append(button('Retry',()=>queue(host,openAssembly,navigation)));}
 }

 async function attachQueue(host,items,options={}){







  for(const row of host.querySelectorAll('[data-technical-review-intake],[data-preparation-intake]')){







   if(row.dataset.preparationBound==='true'||row.nextElementSibling?.dataset.preparationEntry==='true')continue;







   const item=items.find(i=>row.dataset.preparationProject?i.projectId===row.dataset.preparationProject:i.intakeId===row.dataset.technicalReviewIntake&&!i.projectId);if(!item||item.status==='READY_FOR_RFQ_WORKING_QUEUE')continue;







   let b,opening=false;const open=async()=>{if(opening)return;opening=true;const queueView=document.getElementById('technicalReviewQueueView'),panel=el('section');queueView.hidden=true;queueView.after(panel);const back=async()=>{panel.remove();queueView.hidden=false;opening=false;await window.DleWorkspaces?.['technical-review']?.refresh?.();const target=[...host.querySelectorAll('[data-preparation-project]')].find(n=>n.dataset.preparationProject===item.projectId);(target||b).focus({preventScroll:true});};if(options.finalReviewRoundtrip===true&&item.projectId&&item.finalReview){try{if(!window.DleLibraryPackages){if(!window.DleLibraryPackagesLoading)window.DleLibraryPackagesLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/incoming/SRC/workspaces/assembly-library/library-packages.js';script.onload=resolve;script.onerror=()=>{window.DleLibraryPackagesLoading=null;reject(Error('Final review could not load.'));};document.head.append(script);});await window.DleLibraryPackagesLoading;}if(!panel.isConnected)return;await window.DleLibraryPackages.openReview(panel,item.finalReview,{rfqProjectHandoff:options.rfqProjectHandoff===true,rfqReceipt:item.rfqReceipt,onBack:back,onLeave:()=>{panel.remove();queueView.hidden=false;opening=false;},onChanged:()=>window.DleWorkspaces?.['technical-review']?.refresh?.()});}catch(e){panel.replaceChildren(button('Back to reviews',back),status(e.message));}}else void assessment(panel,item.intakeId,item.assembly?.lineNumber||1,back);};







   if(item.projectId){b=row;row.onclick=open;row.dataset.preparationBound='true';}else{b=button('Initial assessment',open);b.dataset.preparationEntry='true';row.after(b);}







  }







 }







 document.addEventListener('click',e=>{for(const s of sessions){if(s.host.isConnected&&(s.busy||s.dirty)&&!s.host.contains(e.target)&&e.target.closest?.('a,button,select')){e.preventDefault();e.stopImmediatePropagation();const m=s.host.querySelector('[role=status]');if(m)m.textContent='Save the assessment or use Back to discard pending edits before leaving.';break;}}},true);















 window.addEventListener('beforeunload',e=>{if([...sessions].some(s=>s.host.isConnected&&(s.busy||s.dirty))){e.preventDefault();e.returnValue='';}});















 window.DleLibraryPreparation=Object.freeze({assessment,queue,attachQueue,incoming,revisionName});















})(window,document);

(function(window,document){'use strict';

const api='/api/sim/assembly-library/documents',purposes={DRAWING:'Drawing',BOM_SOURCE:'BOM source',VPRO5_TXT:'VPRO5 Export (.txt)',VPRO5_BMM_PDF:'VPRO5 BMM (.pdf)',WORK_INSTRUCTION:'Work instruction',IMAGE:'Image',PART_EVIDENCE:'Part approval / evidence',TRAVELER:'Traveler',CHANGE_NOTES:'Revision / change notes',QUOTE:'Quote / commercial reference',NOTES:'General notes',REFERENCE:'Reference',OTHER:'Other'};

const origins={CUSTOMER_ORIGINAL:'Customer originals',DLE_LEGACY:'DLE legacy',DLE_OS_CREATED:'DLE-OS created',UNIDENTIFIED:'Not identified'};
const uses={UNIDENTIFIED:'Not yet identified',REFERENCE:'Reference only',MATERIALS:'Materials',PRODUCTION:'Production',BOTH:'Materials + Production'};
const originOf=v=>Object.hasOwn(origins,v?.origin)?v.origin:'UNIDENTIFIED';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};

const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};

const query=o=>new URLSearchParams(o).toString();

async function request(path,body){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(r.status===404)throw Error('Production documents await SIM activation. Existing BOMs and folder links are unchanged.');const d=await r.json();if(!r.ok)throw Error(d.message||'Document request failed.');return d;}

async function mount(host,header,screen){

 const key=header.sourceKeyRaw;let view,folder,relative,busy=false,anchor=null,opening=0;const status=el('p');status.setAttribute('role','status');

 const folderHost=el('section'),list=el('div'),details=el('section'),saved=el('details');saved.append(el('summary','Saved versions'));

 host.append(status,folderHost,list,details,saved);await window.DleLibraryBom.folderPanel(folderHost,header);

 details.setAttribute('popover','manual');details.setAttribute('role','dialog');details.setAttribute('aria-label','Identify document');
 details.style.cssText='position:fixed;inset:auto;margin:0;box-sizing:border-box;width:420px;padding:12px;border:1px solid #94a3b8;border-radius:8px;background:#0f172a;color:#f1f5f9;box-shadow:0 8px 28px #0008;font:13px/1.4 system-ui,sans-serif;overflow:auto';
 function positionEditor(){if(!details.matches(':popover-open')||!anchor?.isConnected)return;const r=anchor.closest('tr').getBoundingClientRect(),gap=7,edge=8,w=Math.min(420,innerWidth-16);details.style.width=w+'px';const below=Math.max(0,innerHeight-r.bottom-gap-edge),above=Math.max(0,r.top-gap-edge),desired=Math.min(details.scrollHeight,innerHeight-16),down=below>=desired||below>=above;const space=down?below:above;details.style.maxHeight=Math.max(100,Math.min(innerHeight-16,space))+'px';const height=details.getBoundingClientRect().height;details.style.left=Math.max(edge,Math.min(innerWidth-w-edge,anchor.getBoundingClientRect().right-w))+'px';details.style.top=Math.max(edge,Math.min(innerHeight-height-edge,down?r.bottom+gap:r.top-height-gap))+'px';}
 function closeEditor(restore=true){opening++;if(details.matches(':popover-open'))details.hidePopover();if(anchor){anchor.setAttribute('aria-expanded','false');anchor.closest('tr')?.style.removeProperty('outline');if(restore&&anchor.isConnected)anchor.focus({preventScroll:true});}details.replaceChildren();}
 function dismiss(){if(busy||!clean())return;screen.dataset.dirty='false';closeEditor();}
 details.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();const expanded=details.querySelector('details[open]');if(expanded){expanded.open=false;positionEditor();}else dismiss();}});
 const position=()=>positionEditor();window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
 const cleanup=new MutationObserver(()=>{if(!screen.isConnected){window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);window.removeEventListener('dle-library-folder-copied',copied);cleanup.disconnect();}});cleanup.observe(document.body,{childList:true,subtree:true});
 function clean(){return screen.dataset.dirty!=='true'||window.confirm('Discard unsaved document changes?');}

 const unload=e=>{if(screen.isConnected&&screen.dataset.dirty==='true'){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);

 // Guard module navigation too, without intercepting this workspace's own controls.

 document.addEventListener('click',e=>{if(!screen.isConnected||screen.hidden||!details.matches(':popover-open')||(screen.contains(e.target)&&!folderHost.contains(e.target)))return;if(e.target.closest('button,a')){if(busy||!clean()){e.preventDefault();e.stopImmediatePropagation();}else{screen.dataset.dirty='false';closeEditor(false);}}},true);

 function latest(){const map=new Map();for(const v of view.record.history)if(!map.has(v.id)||map.get(v.id).version<v.version)map.set(v.id,v);return [...map.values()];}

 async function load(){view=await request(api+'?'+query({key}));folder=await request('/api/sim/assembly-library/folder?'+query({key}));relative=folder.record.current?.relativePath;status.textContent='Drawing revision '+(view.record.drawingRevision||'unknown')+' · BOM revision '+(view.record.bomRevision||'unknown');history();if(relative!==undefined)await browse(relative);else list.replaceChildren(el('p','Link an Assembly Folder above, then refresh this list.'),button('Refresh folder list',()=>reload()));}

 async function reload(){if(busy||!clean())return;screen.dataset.dirty='false';closeEditor(false);await load();}

 const copied=e=>{if(e.detail?.key!==key||!screen.isConnected)return;if(busy||screen.dataset.dirty==='true'){status.textContent='A new file was copied. Save or cancel your edits, then refresh the folder list.';return;}void load().catch(e=>status.textContent=e.message);};window.addEventListener('dle-library-folder-copied',copied);
 async function history(){saved.replaceChildren(el('summary','Saved versions ('+view.record.history.length+')'));for(const v of [...view.record.history].reverse()){

  const row=el('p',v.source.relativePath.split('/').at(-1)+' · version '+v.version+' · '+(uses[v.use]||'Not yet identified')+' · '+(window.DleDateFormat?.dateTime(v.savedBy.atUtc,{seconds:true,empty:'Invalid Date'}) ?? new Date(v.savedBy.atUtc).toLocaleString()));

  if(v.evidenceHash)row.append(button('Download saved copy',async()=>{try{const d=await request(api+'/evidence?'+query({key,id:v.id,version:v.version}));const bytes=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),a=el('a');a.href=url;a.download=d.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status.textContent=e.message;}}));

  const meta=el('details');meta.append(el('summary','Details'),el('p','Origin: '+origins[originOf(v)]),el('p','Purposes: '+v.purposes.map(p=>purposes[p]||p).join(', ')),el('p','Number: '+(v.number||'unknown')+' · Revision: '+(v.revision||'unknown')+' · Source status: '+v.status),el('p','Source: '+v.source.rootId+' / '+v.source.relativePath),el('p','SHA-256 '+v.source.sha256),el('p','Saved by '+v.savedBy.name));row.append(meta);saved.append(row);

 }}

 async function browse(path,afterSave=false){if((busy&&!afterSave)||!clean())return;screen.dataset.dirty='false';closeEditor(false);try{const data=await request(api+'/list?'+query({key,folderToken:folder.token,relativePath:path}));if(!screen.isConnected)return;relative=path;list.replaceChildren(el('p',path));

  if(path!==folder.record.current.relativePath)list.append(button('Up one folder',()=>browse(path.split('/').slice(0,-1).join('/'))));list.append(button('Refresh folder list',()=>reload()));

  const wrap=el('div');wrap.style.overflowX='auto';const table=el('table');table.className='library-documents-list';table.setAttribute('aria-label','Assembly files by origin');const thead=el('thead'),head=el('tr');for(const t of ['Name','Type / date','Document type / use',''])head.append(el('th',t));thead.append(head);table.append(thead);
  const records=latest(),find=entry=>records.find(v=>v.source.rootId===folder.record.current.rootId&&v.source.relativePath.toLowerCase()===entry.relativePath.toLowerCase()),sort=(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'});
  const groups=[['FOLDERS','Folders',data.entries.filter(e=>e.isDirectory)],...Object.entries(origins).map(([id,label])=>[id,label,data.entries.filter(e=>!e.isDirectory&&originOf(find(e))===id)])];
  for(const [id,label,entries]of groups){if(!entries.length)continue;const body=el('tbody');body.dataset.origin=id;body.setAttribute('aria-label',id==='FOLDERS'?'Folders':'Origin: '+label);const heading=el('tr'),caption=el('th',label+' ('+entries.length+')');caption.colSpan=4;caption.scope='colgroup';heading.className='library-doc-origin';heading.append(caption);body.append(heading);
   for(const entry of entries.sort(sort)){const tr=el('tr');tr.className='library-doc-row';tr.append(el('td',entry.name));const type=entry.isDirectory?'Folder':entry.name.split('.').at(-1).toUpperCase();tr.append(el('td',type+(entry.modifiedUtc?' · '+(window.DleDateFormat?.date(entry.modifiedUtc,{empty:'Invalid Date'}) ?? new Date(entry.modifiedUtc).toLocaleDateString()):'')));
    const v=find(entry);let label=v?v.purposes.map(p=>purposes[p]||p).join(', ')+' · '+(uses[v.use]||'Not yet identified'):'Not yet identified';
    if(v&&(v.source.size!==entry.size||new Date(v.source.lastWriteUtc).getTime()!==new Date(entry.modifiedUtc).getTime()))label+=' · Source changed';
    tr.append(el('td',entry.isDirectory?'':label));const actions=el('td');const trigger=button(entry.isDirectory?'Open folder':'Identify / Details',()=>entry.isDirectory?browse(entry.relativePath):identify(entry.relativePath,v,trigger));trigger.dataset.documentPath=entry.relativePath;if(!entry.isDirectory){trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');}actions.append(trigger);tr.append(actions);body.append(tr);
   }table.append(body);
  }wrap.append(table);list.append(wrap);if(!data.entries.length)list.append(el('p','No files in this folder.'));if(data.truncated)list.append(el('p','First 200 entries shown. Open a subfolder to narrow the list.'));

  for(const v of records.filter(v=>v.source.rootId===folder.record.current.rootId&&v.source.relativePath.split('/').slice(0,-1).join('/')===path&&!data.truncated&&!data.entries.some(e=>e.relativePath.toLowerCase()===v.source.relativePath.toLowerCase())))list.append(el('p','Missing from this folder: '+v.source.relativePath.split('/').at(-1)+' — saved version retained.'));

 }catch(e){list.replaceChildren(el('p',e.message));}}

 async function identify(path,previous,trigger){if(busy||!clean())return;closeEditor(false);screen.dataset.dirty='false';const attempt=++opening;try{const selection=await request(api+'/describe?'+query({key,folderToken:folder.token,relativePath:path}));if(attempt!==opening||!screen.isConnected)return;anchor=trigger;
  const title=el('strong',selection.name);title.style.cssText='display:block;overflow-wrap:anywhere;margin-bottom:8px';details.append(title);
  if(previous&&previous.source.sha256!==selection.source.sha256)details.append(el('p','Source changed. Save creates a new version; earlier evidence is retained.'));
  const fields=el('div');fields.style.cssText='display:grid;gap:8px';const checks={},caption=el('span','Select'),choices=el('div');
  choices.setAttribute('role','listbox');choices.setAttribute('aria-label','Select');choices.setAttribute('aria-multiselectable','true');choices.style.cssText='display:grid;max-height:140px;overflow:auto;border:1px solid #64748b;border-radius:4px;background:#1e293b';
  function paint(c){c.setAttribute('aria-selected',String(c.checked));c.style.background=c.checked?'#334e68':'transparent';c.style.fontWeight=c.checked?'600':'400';}
  const purposeOptions={...purposes};for(const value of previous?.purposes||[])if(!Object.hasOwn(purposeOptions,value))purposeOptions[value]=value;
  for(const [value,label]of Object.entries(purposeOptions)){const c=button(label,()=>{if(!view.canEdit||busy)return;c.checked=!c.checked;paint(c);screen.dataset.dirty='true';});c.checked=previous?.purposes.includes(value)||false;c.setAttribute('role','option');c.disabled=!view.canEdit;c.style.cssText='font:inherit;text-align:left;color:#f1f5f9;padding:4px 8px;min-height:30px;border:0;border-radius:0';paint(c);checks[value]=c;choices.append(c);}
  choices.addEventListener('keydown',e=>{const options=[...choices.children],index=options.indexOf(document.activeElement);let next;if(e.key==='ArrowDown')next=Math.min(options.length-1,index+1);if(e.key==='ArrowUp')next=Math.max(0,index-1);if(e.key==='Home')next=0;if(e.key==='End')next=options.length-1;if(next!==undefined){e.preventDefault();options[next].focus({preventScroll:true});const option=options[next];if(option.offsetTop<choices.scrollTop)choices.scrollTop=option.offsetTop;else if(option.offsetTop+option.offsetHeight>choices.scrollTop+choices.clientHeight)choices.scrollTop=option.offsetTop+option.offsetHeight-choices.clientHeight;}});
  fields.append(caption,choices);
  function select(label,values,current){const l=el('label'),caption=el('span',label),s=el('select');l.style.cssText='display:grid;grid-template-columns:82px minmax(0,1fr);align-items:center;gap:8px;margin:0';s.setAttribute('aria-label',label);s.style.cssText='font:inherit;background:#1e293b;color:#f1f5f9;width:100%;min-width:0;height:32px;padding:3px 6px;border:1px solid #64748b;border-radius:4px';for(const [value,text]of values){const o=el('option',text);o.value=value;s.append(o);}s.value=current;l.append(caption,s);fields.append(l);return s;}
  const origin=view.documentOrigins===true?select('Origin',Object.entries(origins),originOf(previous)):null;
  if(origin)fields.prepend(origin.closest('label'));
  const useOptions=[['UNIDENTIFIED','Not yet identified'],['REFERENCE','Reference only'],['MATERIALS','Materials'],['PRODUCTION','Production']];if(view.combinedDocumentUse===true||previous?.use==='BOTH')useOptions.push(['BOTH','Both']);
  const use=select('Use',useOptions,previous?.use||'UNIDENTIFIED');if(view.combinedDocumentUse!==true&&previous?.use==='BOTH')use.querySelector('option[value="BOTH"]').disabled=true;
  const state=select('Source status',[['UNKNOWN','Unknown'],['ENGINEERING','Engineering'],['PROTOTYPE','Prototype'],['TESTING','Testing'],['USER_REPORTED_RELEASED','Released (user-reported)']],previous?.status||'UNKNOWN');
  const metadata=el('details');metadata.append(el('summary','Optional details'));const inputs={};for(const [name,label]of [['number','Document number'],['revision','Document revision']]){const l=el('label',label+' '),input=el('input');l.style.cssText='display:block;margin:5px 0';input.style.cssText='box-sizing:border-box;font:inherit;background:#1e293b;color:#f1f5f9;width:100%;height:32px';input.value=previous?.[name]||'';input.maxLength=name==='number'?200:100;input.setAttribute('aria-label',label);l.append(input);metadata.append(l);inputs[name]=input;}
  const evidence=el('p','SHA-256 '+selection.source.sha256);evidence.style.overflowWrap='anywhere';metadata.append(evidence,el('p','Materials identifies a use; it does not build a BOM. Production and Both retain a verified copy, up to 20 MB. Approval and slides remain separate.'));details.append(fields,metadata);
  for(const menu of [metadata])menu.addEventListener('toggle',positionEditor);
  const message=el('p');message.setAttribute('role','status');message.style.cssText='margin:6px 0 0;overflow-wrap:anywhere';const save=button('Save',async()=>{if(busy||!view.canEdit)return;busy=true;for(const control of details.querySelectorAll('input,select,button'))control.disabled=true;try{const command={key,expectedToken:view.token,folderToken:folder.token,relativePath:path,sourceToken:selection.source.sourceToken,purposes:Object.keys(checks).filter(k=>checks[k].checked),use:use.value,number:inputs.number.value,revision:inputs.revision.value,status:state.value,...(origin?{origin:origin.value}:{})};view=await request(api,command);const stored=latest().find(v=>v.source.rootId===folder.record.current.rootId&&v.source.relativePath.toLowerCase()===path.toLowerCase());if((origin&&originOf(stored)!==command.origin)||(command.use==='BOTH'&&stored?.use!=='BOTH'))throw Error('The saved result could not be verified. Reopen the file to check its saved version.');screen.dataset.dirty='false';history();await browse(relative,true);status.textContent='Document identification saved. BOM and jobs unchanged.';const target=[...list.querySelectorAll('[data-document-path]')].find(b=>b.dataset.documentPath===path);target?.focus({preventScroll:true});}catch(e){message.textContent=e.message+' Your edits are retained.';positionEditor();}finally{busy=false;for(const control of details.querySelectorAll('input,select,button'))control.disabled=!view.canEdit;}});
  details.oninput=()=>{screen.dataset.dirty='true';};details.onchange=()=>{screen.dataset.dirty='true';};for(const input of details.querySelectorAll('input,select'))input.disabled=!view.canEdit;save.disabled=!view.canEdit;
  const actions=el('div');actions.style.cssText='display:flex;gap:8px;margin-top:10px;padding-top:6px;position:sticky;bottom:0;background:#0f172a;z-index:2';for(const b of [save,button('Cancel',dismiss)]){b.style.cssText='font:inherit;padding:4px 10px;min-height:30px';actions.append(b);}details.append(actions,message);details.showPopover();anchor.setAttribute('aria-expanded','true');anchor.closest('tr').style.outline='1px solid #93c5fd';positionEditor();(choices.querySelector('[aria-selected="true"]')||choices.firstElementChild)?.focus({preventScroll:true});
 }catch(e){status.textContent=e.message;trigger?.focus({preventScroll:true});}}

 try{await load();}catch(e){status.textContent=e.message;}

}

window.DleLibraryDocuments=Object.freeze({mount});
const css=el('style');css.textContent='.library-documents-list{width:100%;font:inherit;font-size:13px;border-collapse:collapse}.library-documents-list td,.library-documents-list th{padding:6px 7px;text-align:left;vertical-align:top;border-bottom:1px solid #334155}.library-documents-list td:first-child{overflow-wrap:anywhere}.library-documents-list td:last-child{white-space:nowrap}.library-documents-list .library-doc-origin th{padding-top:12px;padding-bottom:4px;background:transparent;color:#cbd5e1;font-weight:600}.library-documents-list button{font:inherit;min-height:32px;white-space:nowrap}@media(max-width:600px){.assembly-library-view table.library-documents-list,.library-documents-list{display:block;width:100%;min-width:0;max-width:100%}.library-documents-list tbody{display:block;width:100%;min-width:0}.library-documents-list .library-doc-origin,.library-documents-list .library-doc-origin th{display:block;width:100%;box-sizing:border-box;white-space:normal}.library-documents-list .library-doc-row td{white-space:normal}.library-documents-list thead{display:none}.library-documents-list .library-doc-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;padding:7px 0;border-bottom:1px solid #334155}.library-documents-list .library-doc-row td{padding:0;border:0;min-width:0}.library-documents-list .library-doc-row td:first-child{grid-column:1 / -1;grid-row:1}.library-documents-list .library-doc-row td:nth-child(2){grid-column:1;grid-row:2;color:#cbd5e1}.library-documents-list .library-doc-row td:nth-child(3){grid-column:1;grid-row:3;overflow-wrap:anywhere}.library-documents-list .library-doc-row td:last-child{grid-column:2;grid-row:2 / 4;align-self:center}.library-documents-list button{min-height:40px}}';document.head.append(css);

})(window,document);


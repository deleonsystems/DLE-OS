(function(window,document){
 'use strict';
 const clone=value=>structuredClone(value),uid=()=>crypto.randomUUID();
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const loads=new Map();
 async function load(path,name){if(window[name])return;if(!loads.has(path))loads.set(path,new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=path;script.onload=resolve;script.onerror=()=>{loads.delete(path);script.remove();reject(Error('Slide tools unavailable. Retry.'));};document.head.append(script);}));return loads.get(path);}
 async function json(url,options){const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});const data=await response.json();if(!response.ok)throw Error(data.message||'Draft request failed.');return data;}
 const opening=page=>({page,x:.5,y:.5,width:1,height:1,rotation:0});
 const removable=frame=>frame?.kind==='REFERENCE'||frame?.kind==='NOTE';
 const key=frame=>frame.kind==='REFERENCE'?'REFERENCE:'+frame.documentId+':'+frame.page:frame.kind==='NOTE'?'NOTE:'+frame.note.id:frame.kind+':'+frame.page;
 function arrange(frames,order){const positions=new Map((order||[]).map((id,i)=>[id,i]));return frames.map((frame,i)=>({...frame,key:key(frame),defaultIndex:i})).sort((a,b)=>(positions.get(a.key)??positions.size+a.defaultIndex)-(positions.get(b.key)??positions.size+b.defaultIndex));}
 async function open({intakeId,onSaved,onClose,onError,trigger,entryContext}){
  if(entryContext!=='technical-review')throw Error('Open this draft workspace through Technical Review.');
  let access;
  async function checkAccess(){access=await json('/api/auth/me');if(access.environment!=='SIM'||!access.isAuthenticated||access.user?.accountStatus!=='ACTIVE'||!(access.isSuperAdmin===true||access.permissions?.includes('technical_review.view')))throw Error('Technical Review access is required for these draft slides.');}
  await checkAccess();
  await Promise.all([load('/SRC/workspaces/rfqs/labor-drawing-notes.js','DleLaborDrawingNotes'),load('/SRC/workspaces/rfqs/labor-bom-slides-v3.js','DleLaborBomSlidesV3'),load('/SRC/workspaces/rfqs/labor-traveler-print.js','DleLaborTravelerPrint'),load('/SRC/workspaces/rfqs/labor-workbench.js','DleLaborWorkbench'),load('/SRC/workspaces/rfqs/slide-organizer.js','DleSlideOrganizer')]);
  if(!document.querySelector('link[data-review-slide-style]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/SRC/workspaces/rfqs/labor-workbench.css';css.dataset.reviewSlideStyle='';document.head.append(css);}
  const base='/api/sim/technical-reviews/'+encodeURIComponent(intakeId)+'/presentation';
  let view=await json(base),busy=false,finished=false;
  const acceptanceDisplays=new Set();
  const canEdit=()=>!!(access.isSuperAdmin===true||access.permissions?.includes('technical_review.disposition'))&&view.record.environment==='SIM'&&['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(view.record.status)&&!!view.record.technicalReview?.workflow&&!view.record.technicalReview.workflow.outputs&&!view.record.technicalReview.downstreamHandoffState;
  async function requireEdit(){await checkAccess();if(!canEdit())throw Error('This Technical Review draft is read-only.');}
  function finish(){if(finished)return;finished=true;onClose?.();if(trigger?.isConnected)trigger.focus();}
  function failed(error){finish();onError?.(error);}
  const go=action=>{void action().catch(failed);};
  async function save(next){await requireEdit();if(busy)throw Error('A draft save is already in progress.');busy=true;try{view=await json(base,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:view.draft.revision,expectedBomToken:view.bomToken,draft:next})});onSaved?.(view.record);return view;}finally{busy=false;refreshAcceptanceChrome();}}
  function productionStatus(dirty=false){return dirty?'Unsaved draft · Not released':view.productionSlides?.ready?'Slides accepted · v'+view.productionSlides.acceptance.revision+' · Not released':view.productionSlides?.acceptance?'Draft changed · Acceptance needed':'Draft · Not released';}
  function refreshAcceptanceChrome(){for(const refresh of acceptanceDisplays)refresh();}
  async function acceptSavedProductionSlides(isDirty=()=>false){
   await requireEdit();if(view.record.status==='ON_HOLD')throw Error('Resolve the Technical Review hold before accepting production slides.');if(busy)throw Error('A draft action is already in progress.');if(isDirty())throw Error('Save draft changes before accepting the production slides.');
   const state=view.productionSlides;if(!state?.canAccept)throw Error(state?.message||'Refresh the saved draft before accepting.');if(state.ready)return;
   busy=true;refreshAcceptanceChrome();
   try{view=await json(base+'/accept-production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:view.draft.revision,expectedFingerprint:state.fingerprint})});onSaved?.(view.record);}
   finally{busy=false;refreshAcceptanceChrome();}
  }
  function framesFor(draft=view.draft){
   const rows=(view.record.technicalReview?.candidateBom?.rows||[]).map(row=>[row.values.lineNumber||'',row.values.partNumber||'',row.reviewState?.reviewed?(row.primaryIdentity?.partNumber||row.assemblyIdentity?.partNumber||(row.manufacturerIdentity?.proposals||[]).filter(p=>row.manufacturerIdentity.history?.filter(h=>h.proposalId===p.id).at(-1)?.decision==='CONFIRMED').map(p=>p.partNumber).join(' / ')):'',row.values.description||'',row.values.designators||'',row.values.quantity||'',row.componentType==='UNKNOWN'?'':row.componentType||'']);
   const table={header:'DLE-OS working BOM — DRAFT / NOT FOR PRODUCTION',columns:['Line','BOM P/N','Approved P/N','Description','References','Qty / Assy','Type'],rows,pages:window.DleLaborBomSlidesV3.paginate(rows)};
   const frames=[{kind:'TRAVELER',title:'Draft traveler',page:1},...table.pages.map((_,i)=>({kind:'BOM',title:'DLE-OS BOM — page '+(i+1),page:i+1,token:view.bomToken,svg:()=>window.DleLaborBomSlidesV3.svg(table,i+1)}))];
   if(view.reference)for(let page=1;page<=view.reference.pageCount;page++)frames.push({kind:'REFERENCE',title:view.reference.name+' — page '+page,page,token:view.reference.token,documentId:view.reference.documentId});
   for(const note of draft.slides.filter(s=>s.kind==='NOTE'))frames.push({kind:'NOTE',title:note.title,page:1,note,token:note.sourceToken});
   for(const frame of frames)frame.saved=frame.note||draft.slides.find(s=>s.kind===frame.kind&&s.page===frame.page&&s.sourceToken===frame.token&&s.documentId===(frame.documentId||null));
   const excluded=new Set(draft.excludedSlideKeys||[]);
   return arrange(frames,draft.slideOrder).filter(frame=>!removable(frame)||!excluded.has(frame.key));
  }
  function traveler(){return window.DleLaborTravelerPrint.build({operations:[],quantity:view.record.assemblies?.[0]?.quantity},view.record,window.DleLaborWorkbench,{technicalDraft:true});}
  function blankSvg(text){return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/><foreignObject x="35" y="35" width="1130" height="720"><div xmlns="http://www.w3.org/1999/xhtml" style="font:24px Arial;white-space:pre-wrap;color:#142436">'+esc(text)+'</div></foreignObject></svg>';}
  const loadBase=(frame,signal)=>frame.kind==='REFERENCE'?fetch('/api/sim/rfq-intakes/'+encodeURIComponent(intakeId)+'/documents/'+encodeURIComponent(frame.documentId)+'/pages/'+frame.page,{credentials:'same-origin',signal}):Promise.resolve(new Response(frame.svg?frame.svg():blankSvg(frame.note?.body||''),{headers:{'content-type':'image/svg+xml'}}));
  function conciseChrome(dialog,heading,{editable=false,dirty=()=>false}={}){
   dialog.classList.add('review-draft-viewer');
   // Keep QC's real toolbar and save guard; only this entry uses concise draft chrome.
   for(const notice of dialog.querySelectorAll('.labor-slide-draft-notice'))notice.remove();
   const status=document.createElement('span');status.className='review-draft-status';status.setAttribute('role','status');heading.append(status);
   let accept;
   if(canEdit()&&!editable){accept=document.createElement('button');accept.type='button';accept.dataset.acceptProductionSlides='';accept.textContent='Accept Production Slides';accept.onclick=async()=>{try{await acceptSavedProductionSlides(dirty);}catch(e){status.textContent=e.message;}};heading.append(accept);}
   const refresh=()=>{status.textContent=editable?'Draft · Not released':productionStatus(dirty());const accepted=view.productionSlides?.acceptance;status.title=accepted?'Saved v'+accepted.revision+' accepted by '+accepted.acceptedBy+' · '+(window.DleDateFormat?.dateTime(accepted.acceptedAtUtc,{seconds:true,empty:'Invalid Date'}) ?? new Date(accepted.acceptedAtUtc).toLocaleString()):view.productionSlides?.message||'';if(accept){accept.disabled=busy||dirty()||!view.productionSlides?.canAccept||view.productionSlides?.ready===true;accept.title=dirty()?'Save draft changes before accepting.':view.productionSlides?.message||'';}};
   acceptanceDisplays.add(refresh);dialog.addEventListener('close',()=>acceptanceDisplays.delete(refresh),{once:true});refresh();
   const guard=dialog.querySelector('.labor-unsaved-dialog>p');if(guard)guard.textContent='Save draft changes before continuing?';
   const back=dialog.querySelector('[data-back]');if(back)back.textContent=back.getAttribute('aria-label')||back.textContent;
   const tabs=dialog.querySelector('.labor-operation-tabs');if(tabs)tabs.setAttribute('aria-label','Draft workspace');
   const organize=dialog.querySelector('[data-organize-slides]');if(organize)heading.append(organize);
   const info=dialog.querySelector('[aria-label="Show operation and draft details"]');if(info)info.setAttribute('aria-label','Show slide details');
  }
  async function show(position=0,editable=false,session=null){
   await checkAccess();if(editable)await requireEdit();
   const read=session?.read||(()=>view.draft),frames=framesFor(read());
   const index=typeof position==='string'?Math.max(0,frames.findIndex(f=>f.key===position)):Math.max(0,Math.min(position,frames.length-1));
   const frame=frames[index],assembly=view.record.assemblies?.[0]||{},saved=frame.saved;
   const initial={layerId:saved?.id||uid(),stepId:'technical-review-draft',source:{documentId:frame.documentId||frame.kind,sha256:frame.token||'',definitionId:'technical-review-draft',assembly:assembly.assemblyNumber||'',revision:assembly.revision||'',name:frame.title},page:frame.page,name:frame.title,marks:clone(saved?.stage.marks||[]),savedView:clone(saved?.stage.savedView||opening(frame.page)),revision:0,note:''};
   const slide={kind:frame.kind==='TRAVELER'?'JOB':'IMAGE',caption:frame.title,layer:initial,markerOpacitySupported:true,photosSupported:false,loadBase:signal=>loadBase(frame,signal),save:async layer=>{
    const next=clone(read()),current=next.slides.find(s=>s.id===initial.layerId);
    const card={id:current?.id||initial.layerId,kind:frame.kind,sourceToken:frame.token,documentId:frame.documentId||null,page:frame.page,title:frame.title,body:frame.note?.body||'',stage:{...(current?.stage||{}),id:current?.stage.id||uid(),name:current?.stage.name||'Draft annotations',marks:clone(layer.marks),savedView:clone(layer.savedView)}};
    const at=next.slides.findIndex(s=>s.id===card.id);if(at<0)next.slides.push(card);else next.slides[at]=card;
    await (session?.save||save)(next);return {version:view.draft.revision};
   }};
   if(frame.kind==='TRAVELER')slide.mount=parent=>{window.DleLaborTravelerPrint.mount(parent,traveler());};
   const returnTo=session?.onReturn||finish;
   const options={intakeId,stepId:'technical-review-draft',stepLabel:frame.title,editable,trigger,slide,saveLabel:'Save Draft',compactControls:true,durableSave:true,pendingEditorDraft:session?.dirty,backLabel:session?'Back to organizer':'Back to Technical Review',onExit:returnTo,onReady:(dialog,heading)=>conciseChrome(dialog,heading,{editable,dirty:session?.dirty}),onOrganize:canEdit()?()=>go(session?async()=>session.onReturn():()=>organize(frame.key)):undefined};
   if(!editable)Object.assign(options,{operationTabs:[{id:'draft-slides',label:'Draft Slides',active:true}],onSelectOperation:()=>go(()=>show(0,false,session)),onAdvance:delta=>go(()=>show(index+delta,false,session)),hasPrevious:index>0,hasNext:index<frames.length-1,progress:(index+1)+' / '+frames.length,onEdit:canEdit()&&frame.kind!=='TRAVELER'?()=>go(()=>show(frame.key,true,session)):undefined,editLabel:'Edit current slide'});
   await window.DleLaborDrawingNotes.open(options);
  }
  async function organize(initialKey){
   await requireEdit();
   const ui=window.DleSlideOrganizer;
   let draft=clone(view.draft),baseline=JSON.stringify(draft),history=[],selected=initialKey,entries=[],saving=false,viewing=false,closed=false,generation=0;
   const urls=new Set(),abort=new AbortController();
   const dialog=ui.create({flat:true,returnLabel:'Back to Draft Slides',saveLabel:'Save Draft',helpText:'Select a slide, then drag to arrange it. Double-click or Enter opens it. Space picks up; arrows choose a position; Enter drops; Escape cancels. Delete removes the selected reference or instruction from this draft only. Undo restores changes before saving.'});
   const q=selector=>dialog.querySelector(selector),error=message=>{q('[data-org-error]').textContent=message||'';},dirty=()=>JSON.stringify(draft)!==baseline;
   for(const selector of ['[data-org-copy]','[data-org-paste]','[data-org-restore]','[data-org-apply]'])q(selector)?.remove();
   q('[data-org-delete]').textContent='Delete Slide';
   q('[data-org-delete]').title='Remove from this draft only; source files and annotations are retained. Undo restores it before saving.';
   const tools=q('.labor-organizer-tools');
   for(const [name,label]of [['text','Edit text'],['refresh','Refresh saved sources'],['retained','Retained annotations'],['accept','Accept Production Slides']]){const button=document.createElement('button');button.type='button';button.dataset['org'+name[0].toUpperCase()+name.slice(1)]='';button.textContent=label;tools.append(button);}
   const badge=document.createElement('span');badge.className='review-draft-status';badge.textContent='Draft · Not released';dialog.querySelector('header').append(badge);
   const stale=()=>draft.slides.filter(s=>!entries.some(f=>f.saved?.id===s.id));
   function controls(){
    const frame=entries.find(f=>f.key===selected),locked=saving||viewing;
    q('[data-org-save]').disabled=locked||!dirty();q('[data-org-undo]').disabled=locked||!history.length;q('[data-org-insert]').disabled=locked;q('[data-org-delete]').disabled=locked||!removable(frame);
    q('[data-org-text]').disabled=locked||frame?.kind!=='NOTE';q('[data-org-refresh]').disabled=locked||dirty();q('[data-org-retained]').hidden=!stale().length;
    q('[data-org-accept]').disabled=locked||busy||dirty()||!view.productionSlides?.canAccept||view.productionSlides?.ready===true;badge.textContent=productionStatus(dirty());badge.title=view.productionSlides?.message||'';
    q('[data-cancel]').disabled=locked;q('[data-org-return]').disabled=locked;
    q('[data-org-selection]').textContent=(frame?.title||'Select a slide')+(dirty()?' · Unsaved changes':'');
    for(const node of dialog.querySelectorAll('[data-org-card]')){node.setAttribute('aria-pressed',String(node.dataset.orgCard===selected));node.dataset.movable=String(!locked);}
   }
   acceptanceDisplays.add(controls);dialog.addEventListener('close',()=>acceptanceDisplays.delete(controls),{once:true});
   function remember(change){if(saving||viewing)return;const before=clone(draft);try{change();}catch(e){draft=before;throw e;}history.push(before);if(history.length>40)history.shift();error('');void render();}
   function setOrder(keys){const active=new Set(keys);draft.slideOrder=[...keys,...(draft.slideOrder||[]).filter(id=>!active.has(id))];}
   function move(id,target){if(!target||target.anchor===id)return;remember(()=>{const keys=entries.map(f=>f.key),from=keys.indexOf(id);if(from<0)throw Error('Slide changed. Reopen the organizer.');keys.splice(from,1);const at=target.anchor?keys.indexOf(target.anchor)+(target.side==='after'?1:0):keys.length;keys.splice(Math.max(0,at),0,id);setOrder(keys);selected=id;});}
   async function thumbnail(frame,node,token){try{
    const svg=node.querySelector('svg');
    if(frame.kind==='TRAVELER'){const def=traveler(),preview=document.createElement('iframe');preview.title='Draft traveler preview';preview.tabIndex=-1;preview.setAttribute('aria-hidden','true');preview.setAttribute('sandbox','');const box=document.createElement('div');box.style.cssText='width:100%;aspect-ratio:400/260;position:relative;overflow:hidden;background:white;border:1px solid #d3dce7';const scale=(svg.clientWidth*260/400)/1120;preview.style.cssText='position:absolute;top:0;left:50%;width:800px;height:1120px;pointer-events:none;border:0;background:white;transform-origin:top left;transform:scale('+scale+') translateX(-50%)';preview.srcdoc='<style>'+def.css+'html,body{overflow:hidden;margin:0!important;width:800px!important;min-width:0!important}</style>'+def.html;box.append(preview);svg.replaceWith(box);node.querySelector('[data-thumb-status]').textContent='';return;}
    const response=await loadBase(frame,abort.signal);if(!response.ok)throw Error('Preview unavailable');const url=URL.createObjectURL(await response.blob());urls.add(url);const img=new Image();img.src=url;await img.decode();if(closed||token!==generation)return;
    const ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g'),image=document.createElementNS(ns,'image'),paper={width:img.naturalWidth,height:img.naturalHeight};image.setAttribute('href',url);image.setAttribute('width',paper.width);image.setAttribute('height',paper.height);group.append(image);
    const matrix=window.DleLaborDrawingNotes.transform(frame.saved?.stage.savedView||opening(frame.page),paper,{width:400,height:260});group.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
    for(const mark of frame.saved?.stage.marks||[])window.DleLaborDrawingNotes.appendMark(group,mark,paper);svg.replaceChildren(group);node.querySelector('[data-thumb-status]').textContent='';
   }catch(e){if(!closed&&token===generation)node.querySelector('[data-thumb-status]').textContent=e.name==='AbortError'?'':e.message;}}
   async function render(){if(closed)return;const token=++generation;for(const url of urls)URL.revokeObjectURL(url);urls.clear();entries=framesFor(draft);if(!entries.some(f=>f.key===selected))selected=entries[0]?.key;
    q('.labor-organizer-groups').innerHTML='<div class="labor-organizer-grid">'+entries.map((frame,i)=>ui.tile({id:frame.key,title:frame.title,kindLabel:frame.kind==='REFERENCE'?'Reference':frame.kind==='NOTE'?'Instruction':frame.kind==='BOM'?'Saved BOM':'Traveler',snippet:frame.note?.body||'',protected:!removable(frame),stageCount:1},i)).join('')+'</div>';
    controls();const nodes=[...dialog.querySelectorAll('[data-org-card]')];async function worker(){while(nodes.length&&!closed&&token===generation){const node=nodes.shift();await thumbnail(entries.find(f=>f.key===node.dataset.orgCard),node,token);}}for(let i=0;i<3;i++)void worker();
   }
   async function persist(next=draft){await requireEdit();await save(next);draft=clone(view.draft);baseline=JSON.stringify(draft);history=[];error('');}
   async function openSelected(id){if(saving||viewing)return;selected=id;viewing=true;controls();try{await show(id,entries.find(f=>f.key===id)?.kind!=='TRAVELER',{read:()=>draft,save:persist,dirty,onReturn:()=>{viewing=false;void render();}});}catch(e){viewing=false;error(e.message);controls();}}
   const movement=ui.attachMovement(dialog,{getEntries:()=>entries.map(frame=>({id:frame.key,title:frame.title,movable:!saving&&!viewing})),getSelected:()=>selected,setSelected:id=>{selected=id;},move,open:openSelected,controls,error,isBusy:()=>saving||viewing||closed});
   function editText(frame){
    const form=ui.dialog(frame?'Edit instruction text':'Insert instruction slide','<form><label>Title<input name="title" maxlength="100" required value="'+esc(frame?.note.title||'')+'"></label><label>Instructions<textarea name="body" maxlength="4000" rows="6">'+esc(frame?.note.body||'')+'</textarea></label><button type="submit">Apply to draft</button></form>');
    form.classList.add('review-draft-form');
    form.querySelector('form').onsubmit=event=>{event.preventDefault();const title=form.querySelector('[name=title]').value.trim();if(!title)return;const body=form.querySelector('[name=body]').value;
     remember(()=>{if(frame){const note=draft.slides.find(s=>s.id===frame.note.id);note.title=title;note.body=body;}else{const id=uid(),note={id,kind:'NOTE',sourceToken:id,documentId:null,page:1,title,body,stage:{id:uid(),name:'Draft annotations',marks:[],savedView:opening(1)}};draft.slides.push(note);const keys=entries.map(f=>f.key),at=Math.max(0,keys.indexOf(selected)+1);keys.splice(at,0,'NOTE:'+id);setOrder(keys);selected='NOTE:'+id;}});form.close();};
   }
   function retained(){const items=stale(),excluded=new Set(draft.excludedSlideKeys||[]);const reason=s=>excluded.has(s.kind==='NOTE'?'NOTE:'+s.id:'REFERENCE:'+s.documentId+':'+s.page)?'Removed from this draft':'Earlier source';ui.dialog('Retained annotations',items.map(s=>'<section><h3>'+esc(s.title)+'</h3><p>'+reason(s)+', page '+s.page+' · '+s.stage.marks.length+' saved marks</p>'+s.stage.marks.map(mark=>'<p>'+esc(mark.kind)+(mark.text?': '+esc(mark.text):'')+'</p>').join('')+'</section>').join(''));}
   async function saveAndClose(){if(saving)return;saving=true;controls();try{await persist();dialog.close();}catch(e){error(e.message);}finally{saving=false;if(!closed)controls();}}
   function leave(){if(saving||viewing)return;if(!dirty()){dialog.close();return;}const guard=ui.dialog('Unsaved slide arrangement','<p>Save this draft before returning?</p><button data-save>Save Draft</button><button data-discard>Discard arrangement</button>');guard.querySelector('[data-save]').onclick=()=>{guard.close();void saveAndClose();};guard.querySelector('[data-discard]').onclick=()=>{draft=clone(view.draft);guard.close();dialog.close();};}
   q('[data-cancel]').onclick=leave;q('[data-org-return]').onclick=leave;
   dialog.addEventListener('cancel',e=>{e.preventDefault();if(movement.dragging)movement.cancel();else leave();});
   dialog.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button||saving||viewing||movement.suppressClick)return;try{
    if(button.dataset.orgCard){selected=button.dataset.orgCard;controls();return;}
    if(button.hasAttribute('data-org-save')){await saveAndClose();return;}
    if(button.hasAttribute('data-org-accept')){if(dirty())throw Error('Save draft changes before accepting the production slides.');saving=true;controls();try{await acceptSavedProductionSlides(dirty);draft=clone(view.draft);baseline=JSON.stringify(draft);error('');}finally{saving=false;controls();}return;}
    if(button.hasAttribute('data-org-undo')&&history.length){draft=history.pop();await render();return;}
    if(button.hasAttribute('data-org-delete')){
     const frame=entries.find(f=>f.key===selected);if(!removable(frame))return;
     await requireEdit();if(saving||viewing||closed)return;
     const at=entries.findIndex(f=>f.key===frame.key);if(at<0)return;
     remember(()=>{draft.excludedSlideKeys=[...new Set([...(draft.excludedSlideKeys||[]),frame.key])];selected=entries[at+1]?.key||entries[at-1]?.key;});return;
    }
    if(button.hasAttribute('data-org-insert')){await requireEdit();editText();return;}
    if(button.hasAttribute('data-org-text')){await requireEdit();editText(entries.find(f=>f.key===selected));return;}
    if(button.hasAttribute('data-org-retained')){retained();return;}
    if(button.hasAttribute('data-org-refresh')&&!dirty()){await checkAccess();view=await json(base);draft=clone(view.draft);baseline=JSON.stringify(draft);history=[];await render();error(view.warning);}
   }catch(e){error(e.message);}});
   dialog.addEventListener('close',e=>{if(e.target!==dialog)return;closed=true;generation++;abort.abort();movement.destroy();for(const url of urls)URL.revokeObjectURL(url);go(()=>show(selected));},{once:true});
   await render();error(view.warning);
  }
  await show(0);
 }
 window.DleTechnicalSlides=Object.freeze({open});
})(window,document);

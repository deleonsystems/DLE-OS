(function(window,document){
 'use strict';
 const drafts=new Map();
 async function json(url,init={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...init});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.message||'Job instructions unavailable ('+r.status+').');return data;}
 function move(node,target){if(!node)return ()=>{};const parent=node.parentNode,next=node.nextSibling;target.append(node);return ()=>{if(next?.parentNode===parent)parent.insertBefore(node,next);else parent.append(node);};}
 async function script(){
  if(!document.querySelector('link[href$="/labor-workbench.css"]'))await new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/SRC/workspaces/rfqs/labor-workbench.css';l.onload=resolve;l.onerror=reject;document.head.append(l);});
  if(!document.querySelector('link[data-job-instruction-style]'))await new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.dataset.jobInstructionStyle='';l.href='/SRC/workspaces/kitting/production-instruction-editor.css';l.onload=resolve;l.onerror=reject;document.head.append(l);});
  if(!window.DleLaborWorkbench)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/SRC/workspaces/rfqs/labor-workbench.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});
  if(window.DleLaborSlides)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/SRC/workspaces/rfqs/labor-slides.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});
 }
 window.addEventListener('beforeunload',e=>{if([...drafts.values()].some(d=>d.dirty)){e.preventDefault();e.returnValue='';}});
 async function open({wo,job,order,frame,trigger,material,quality=false,readOnly=false,onExit,onSaved}){
  const base=(quality?'/api/sim/quality/work-orders/':'/api/production/v1/work-orders/')+encodeURIComponent(wo)+'/instructions';
  const probe=await fetch(base,{credentials:'same-origin',cache:'no-store'});if(probe.status===404)return false;if(!probe.ok)throw Error('Work order instructions unavailable ('+probe.status+').');const remote=await probe.json();await script();
  const kit=!quality&&['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)?await json('/api/kitting-cases/v1/work-orders/'+encodeURIComponent(wo)):null;
  const viewOnly=readOnly===true||remote.released===true||kit?.kittingCase?.state==='KIT_COMPLETE';
  let d=drafts.get(wo);
  if(!viewOnly&&d?.dirty&&d.token!==remote.baselineToken)throw Error('The accepted baseline changed. Your unsaved job draft is retained in this window; review it before proceeding.');
  if(!d?.dirty){d={plan:{definitionId:remote.definitionId,quantity:remote.quantity,operations:remote.operations,revision:remote.version},version:remote.version,token:remote.baselineToken,dirty:false};drafts.set(wo,d);}
  d.canEdit=remote.canEdit;
  const plan=viewOnly?{definitionId:remote.definitionId,quantity:remote.quantity,operations:remote.operations,revision:remote.version}:d.plan;
  const baseline=order.orderEntry.acceptance.package.technicalSource.baseline;
  const frozen=await json(base+'/sources');if(frozen.baselineToken!==remote.baselineToken)throw Error('Accepted source changed. Reopen this job.');
  const source=baseline.labor.operations.flatMap(o=>o.slides||[]).find(c=>c.kind==='DRAWING')?.source;
  const save=async()=>{
   if(d.saving)return d.saving;
   if(viewOnly||!d.canEdit)throw Error('This session cannot edit job instructions.');
   const snapshot=structuredClone(d.plan.operations),serial=JSON.stringify(snapshot);
   d.saving=json(base,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:d.version,baselineToken:d.token,operations:snapshot})}).then(result=>{
    d.version=result.version;d.plan.revision=result.version;d.dirty=JSON.stringify(d.plan.operations)!==serial;onSaved?.(result);return true;
   }).finally(()=>{d.saving=null;});return d.saving;
  };
  const locationKey='dle-os:job-slides:'+wo+':'+d.token;
  let anchor=null;
  try { anchor=JSON.parse(sessionStorage.getItem(locationKey)||'null'); } catch (_) {}
  const adapter=window.DleLaborSlides.connect({
   onPosition:position=>{try {sessionStorage.setItem(locationKey,JSON.stringify(position));} catch (_) {}},
   intakeId:baseline.quote.intakeId,getPlan:()=>plan,onChange:()=>{if(!viewOnly)d.dirty=true;},canEdit:()=>!viewOnly&&d.canEdit,supported:()=>true,
   photosSupported:()=>true,imageTransformsSupported:()=>true,exclusionsSupported:()=>true,layoutSupported:()=>true,bomSupported:()=>true,
   drawingBase:base+'/pages',bomIdentity:()=>({assembly:job.context.assembly,revision:job.context.revision}),
   loadBomReference:async()=>{
    const data=await window.DleLaborBomSlides.fromFrozen(frozen,{definitionId:plan.definitionId,assembly:job.context.assembly,revision:job.context.revision});
    if(!quality){data.workOrder=wo;
    data.loadWorkOrderDraft=async()=>{const review=await json('/api/kitting-cases/v1/work-orders/'+encodeURIComponent(wo));return review.kittingCase?.draft||null;};
    await window.DleLaborBomSlides.refresh(data);}return data;
   },
   isDirty:()=>!viewOnly&&d.dirty,saveLabor:save,saveLabel:'Save to Work Order',visualBase:base,
   onMount:dialog=>{dialog.classList.add('job-instruction-viewer');},
   contextNotice:'WO '+wo+(remote.released?' - Released Quality instructions v'+remote.version:' - Job instruction draft based on accepted Labor v'+remote.baselineVersion+'. Not a production release.'),
   drawingContext:async()=>{if(!source)throw Error('No frozen drawing source is available.');return {source,layers:(baseline.labor.drawingNotes||[]).map(layer=>({layer,reviewRequired:false}))};},
   uploadPhoto:file=>viewOnly?Promise.reject(Error('Read-only job instructions.')):json(base+'/visuals',{method:'POST',headers:{'X-Instruction-Baseline':d.token,'X-File-Name':encodeURIComponent(file.name),'Content-Type':file.type},body:file}),
   travelerMaterial:()=>material,travelerMetadata:()=>({...job.context,workOrder:wo}),travelerRfq:()=>({customer:order.customer,assemblies:[{assemblyNumber:job.context.assembly,revision:job.context.revision}]}),
   onExit:()=>quality?onExit?.():window.KittingJobWorkspace.toggleProductionSlides(false),
   prefixGroup:quality?null:'Kitting',
   prefixSlides:quality?[]:[
    {label:'Traveler',mount:host=>{host.classList.add('job-traveler-sheet');const restore=move(frame,host);return ()=>{restore();host.classList.remove('job-traveler-sheet');};}},
    {label:'Kitting / BOM',mount:host=>{host.classList.add('job-kitting-sheet');const dialog=host.closest('dialog');dialog?.classList.add('job-kitting-active');const active=document.getElementById('workOrderDashboardActiveKitting');const restore=move(active,host);const exit=()=>{dialog?.addEventListener('close',()=>window.KittingJobWorkspace.toggleProductionSlides(false),{once:true});dialog?.close();};active?.addEventListener('dle:kitting-saved-exit',exit);active?.addEventListener('dle:kitting-submitted',exit);if(active?.hidden){const p=document.createElement('p');p.textContent='Return to the workspace and use Kitting to start or resume this kit.';host.prepend(p);}return ()=>{active?.removeEventListener('dle:kitting-saved-exit',exit);active?.removeEventListener('dle:kitting-submitted',exit);restore();host.classList.remove('job-kitting-sheet');dialog?.classList.remove('job-kitting-active');};}}
   ],
   editSource:(id,resume)=>{if(viewOnly)return;const op=d.plan.operations.find(o=>o.id===id);const dialog=document.createElement('dialog');dialog.className='labor-slide-dialog';const heading=document.createElement('h2');heading.textContent='Instructions — '+op.name;const text=document.createElement('textarea');text.value=op.instructions||'';text.maxLength=4000;text.rows=8;const apply=document.createElement('button');apply.textContent='Apply to job draft';apply.onclick=()=>{op.instructions=text.value;d.dirty=true;dialog.close();};const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>dialog.close();dialog.append(heading,text,apply,cancel);dialog.addEventListener('close',()=>{dialog.remove();resume();},{once:true});document.body.append(dialog);dialog.showModal();}
  });
  if(!quality)await window.WorkOrderDashboardModule.prepareKittingPreview?.();
  await adapter.playSequence(viewOnly?structuredClone(plan.operations):plan.operations,trigger,null,{includeMaterials:!quality,anchor});return true;
 }
 window.DleJobInstructions=Object.freeze({open,hasUnsavedChanges:wo=>!!(drafts.get(wo)?.dirty||drafts.get(wo)?.saving)});
})(window,document);

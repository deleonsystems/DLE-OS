(function(window,document){
 'use strict';
 const drafts=new Map();
 const signature=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
 const changed=d=>{if(!d)return false;return d.dirty=signature(d.plan.operations)!==d.savedSignature;};
 async function json(url,init={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...init});let data;try{data=await r.json();}catch{throw Error('The server response could not be confirmed ('+r.status+'). Your edits are retained; check the connection before retrying.');}if(!r.ok)throw Error(data.message||'Job instructions unavailable ('+r.status+'). Your edits are retained.');return data;}
 function move(node,target){if(!node)return ()=>{};const parent=node.parentNode,next=node.nextSibling;target.append(node);return ()=>{if(next?.parentNode===parent)parent.insertBefore(node,next);else parent.append(node);};}
 async function script(){
  if(!document.querySelector('link[href$="/labor-workbench.css"]'))await new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/SRC/workspaces/rfqs/labor-workbench.css';l.onload=resolve;l.onerror=reject;document.head.append(l);});
  if(!document.querySelector('link[data-job-instruction-style]'))await new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.dataset.jobInstructionStyle='';l.href='/SRC/workspaces/kitting/production-instruction-editor.css';l.onload=resolve;l.onerror=reject;document.head.append(l);});
  if(!window.DleLaborWorkbench)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/SRC/workspaces/rfqs/labor-workbench.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});
  if(window.DleLaborSlides)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/SRC/workspaces/rfqs/labor-slides.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});
 }
 window.addEventListener('beforeunload',e=>{if([...drafts.values()].some(d=>d.dirty)){e.preventDefault();e.returnValue='';}});
 async function open(config){
  const {wo,job,order,frame,trigger,material:providedMaterial,quality=false,readOnly=false,packetEdit=false,sourceOperationIds=null,startAtTraveler=false,startGroup=null,backLabel,onViewerMount,isCurrent,onExit,onSaved}=config;let material=providedMaterial;
  const base=(quality?'/api/sim/quality/work-orders/':'/api/production/v1/work-orders/')+encodeURIComponent(wo)+'/instructions';
  const probe=await fetch(base,{credentials:'same-origin',cache:'no-store'});if(probe.status===404)return false;if(!probe.ok)throw Error('Work order instructions unavailable ('+probe.status+').');let remote=await probe.json();
  const packetMode=packetEdit&&quality&&remote.packetContractVersion===1&&remote.released;
  if(packetMode)remote=await json(base+'/draft');
  await script();
  const kit=!quality&&['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)?await json('/api/kitting-cases/v1/work-orders/'+encodeURIComponent(wo)):null;
  const viewOnly=packetMode?remote.canEdit!==true:(readOnly===true||remote.released===true||kit?.kittingCase?.state==='KIT_COMPLETE');
  const draftKey=wo+(packetMode?':packet':'');let d=drafts.get(draftKey);
  if(!viewOnly&&d?.dirty&&d.token!==remote.baselineToken)throw Error('The accepted baseline changed. Your unsaved job draft is retained in this window; review it before proceeding.');
  if(!d?.dirty&&!d?.saving){d={savedSignature:signature(remote.operations),plan:{definitionId:remote.definitionId,quantity:remote.quantity,operations:remote.operations,revision:remote.version},version:packetMode?remote.draftVersion:remote.version,token:remote.baselineToken,dirty:false,parentJobId:remote.parentJobId,parentMainId:remote.parentMainId,hasSavedDraft:remote.hasSavedDraft};drafts.set(draftKey,d);}
  d.canEdit=remote.canEdit;
  if(packetMode&&d.dirty&&(d.version!==remote.draftVersion||d.parentJobId!==remote.parentJobId))throw Error('The saved packet changed in another session. Your local edits are retained; reopen after reviewing the conflict.');
  const plan=viewOnly?{definitionId:remote.definitionId,quantity:remote.quantity,operations:remote.operations,revision:remote.version}:d.plan;
  const selectedPreview=readOnly===true&&Array.isArray(sourceOperationIds);
  if(selectedPreview){
   const ids=new Set(sourceOperationIds);
   plan.operations=plan.operations.filter(op=>ids.has(op.id));
   if(!plan.operations.length)throw Error('No saved source slides match this operation.');
  }
  const baseline=order.orderEntry.acceptance.package.technicalSource.baseline;
  const frozen=await json(base+'/sources');if(frozen.baselineToken!==remote.baselineToken)throw Error('Accepted source changed. Reopen this job.');
  // Resolve evidence here for every work-order entry point, never trust a caller's cached completion.
  let materialNotice='',travelerJob=null,materialIdentity=null;material=undefined;
  try{
   if(!window.DleLaborTravelerPrint)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/SRC/workspaces/rfqs/labor-traveler-print.js';s.onload=resolve;s.onerror=()=>reject(Error('Material evidence viewer unavailable.'));document.head.append(s);});
   const packet=await json('/api/production/v1/work-orders/'+encodeURIComponent(wo));
   const accepted=order.orderEntry.acceptance,source=packet.source;
   if(packet.workOrderNumber!==wo||source?.acceptanceId!==accepted.id||source?.acceptedRevision!==accepted.packageRevision||source?.manufacturingDefinitionId!==remote.definitionId||source?.laborVersion!==remote.baselineVersion||!source?.releasedBomIdentity||
      packet.context?.assembly!==job.context.assembly||packet.context?.revision!==job.context.revision||packet.context?.quantity!==remote.quantity||
      quality&&remote.released&&(source.qualityRelease?.baselineToken!==remote.baselineToken||source.qualityRelease?.instructionVersion!==remote.version))throw Error('Material source does not match the selected instruction packet.');
   if(source.qualityRelease?.id){
    const bridge=order.orderEntry.bridge,ids=bridge?.state?.identifiers;
    const line=accepted.package.facts?.lines?.length===1?accepted.package.facts.lines[0]:null;
    travelerJob={released:true,workOrder:wo,salesOrder:bridge?.acceptanceId===accepted.id&&ids?.workOrder===wo?ids.salesOrder||'':'',purchaseOrder:accepted.package.poNumber||'',customer:packet.context.customer||'',assembly:packet.context.assembly,revision:packet.context.revision,quantity:packet.context.quantity,description:line?.assembly===packet.context.assembly&&line?.revision===packet.context.revision?line.description||'':'',releasedAt:source.instructionPacket?.at||source.qualityRelease.at||'',travelerRevision:remote.travelerRevision,packetDraft:packetMode};
   }
   materialIdentity={caseId:packet.kitting?.caseId,state:packet.kitting?.state,submissionId:packet.kitting?.submissionId,workingVersion:packet.kitting?.workingVersion,releasedBomIdentity:source.releasedBomIdentity};
   material=await window.DleLaborTravelerPrint.loadMaterialEvidence(wo,materialIdentity);
  }catch(error){materialNotice='Material completion unavailable: '+error.message;}
  const source=baseline.labor.operations.flatMap(o=>o.slides||[]).find(c=>c.kind==='DRAWING')?.source;
  const save=async()=>{
   if(d.saving)return d.saving;
   if(viewOnly||!d.canEdit)throw Error('This session cannot edit job instructions.');
   if(!changed(d))return d.lastSaved||{version:d.version,draftVersion:d.version};
   const snapshot=structuredClone(d.plan.operations),serial=signature(snapshot),expectedVersion=d.version;
   d.saving=json(base+(packetMode?'/draft':''),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(packetMode?{expectedVersion:d.version,parentJobId:d.parentJobId,parentMainId:d.parentMainId,operations:snapshot}:{expectedVersion:d.version,baselineToken:d.token,operations:snapshot,mainPacketId:remote.mainPacketId})}).then(result=>{
    if(!Number.isInteger(result.version)||result.version!==expectedVersion+1||(packetMode&&result.draftVersion!==result.version))throw Error('Save could not be confirmed. Your edits are retained. Keep this window open and check the saved draft before retrying.');d.lastSaved=result;d.version=result.version;d.hasSavedDraft=true;d.plan.revision=result.version;d.savedSignature=serial;changed(d);onSaved?.(result);refreshPacketTools();return result;
   }).finally(()=>{d.saving=null;refreshPacketTools();});refreshPacketTools();return d.saving;
  };
  const packetToolbars=new Set();
  function refreshPacketTools(){changed(d);for(const ui of packetToolbars){if(!ui.dialog.isConnected){packetToolbars.delete(ui);continue;}
   ui.state.textContent=(d.saving?'Saving draft…':d.dirty?'Unsaved draft':d.hasSavedDraft?'Saved draft '+d.version:'Draft · No saved amendment')+' | Released Traveler Rev '+remote.travelerRevision;
   ui.state.dataset.dirty=String(d.dirty);ui.save.disabled=!d.canEdit||!!d.saving||!d.dirty;ui.save.textContent=d.saving?'Saving…':d.dirty?'Save Draft':d.hasSavedDraft?'Saved':'No changes';
   ui.release.disabled=!d.canEdit||d.dirty||!d.hasSavedDraft||!!d.saving;
   ui.approved.disabled=!!d.saving;ui.discard.disabled=!!d.saving||!d.dirty;
  }}
  async function closeViewer(dialog){
   if(!dialog.open)return;
   await new Promise(resolve=>{dialog.addEventListener('close',resolve,{once:true});dialog.close();});
  }
  function reportReopenError(message){
   const notice=document.createElement('dialog');notice.className='job-packet-release';
   const text=document.createElement('p');text.setAttribute('role','alert');text.textContent=message;
   const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>notice.close();
   notice.append(text,close);notice.addEventListener('close',()=>notice.remove(),{once:true});document.body.append(notice);notice.showModal();
  }
  async function reopenViewer(dialog,next){await closeViewer(dialog);if(await open(next)===false)throw Error('The instruction viewer is unavailable. Return to jobs and reopen.');}
  function mountPacketTools(dialog,heading){
   if(!packetMode||viewOnly)return;
   const bar=document.createElement('div');bar.className='job-packet-tools';bar.innerHTML='<span data-packet-state role="status"></span><button type="button" data-packet-save>Save Draft</button><button type="button" data-packet-release>Release Changes</button><button type="button" data-packet-approved>View Released Packet</button><button type="button" data-packet-discard>Discard Unsaved Changes</button><span data-packet-error role="alert"></span>';
   heading.after(bar);packetToolbars.add({dialog,state:bar.querySelector('[data-packet-state]'),save:bar.querySelector('[data-packet-save]'),release:bar.querySelector('[data-packet-release]'),approved:bar.querySelector('[data-packet-approved]'),discard:bar.querySelector('[data-packet-discard]')});refreshPacketTools();
   const errorNode=bar.querySelector('[data-packet-error]');const error=e=>{errorNode.textContent=e.message;};
   bar.querySelector('[data-packet-save]').onclick=async()=>{errorNode.textContent='';try{await save();}catch(e){error(e);}finally{refreshPacketTools();}};
   bar.querySelector('[data-packet-discard]').onclick=()=>{if(d.dirty&&!window.confirm('Discard only unsaved changes? Your last saved draft and released packet stay retained.'))return;drafts.delete(draftKey);void reopenViewer(dialog,config).catch(e=>reportReopenError(e.message));};
   bar.querySelector('[data-packet-approved]').onclick=()=>{void reopenViewer(dialog,{...config,packetEdit:false,readOnly:true}).catch(e=>reportReopenError(e.message));};
   bar.querySelector('[data-packet-release]').onclick=()=>{
    if(d.dirty||d.saving){error(Error('Save Draft before releasing.'));return;}
    const modal=document.createElement('dialog');modal.className='job-packet-release';
    modal.innerHTML='<h2>Release Changes</h2><p>This publishes the saved draft. It does not start production or record inspection.</p><label>Release scope<select data-scope><option value="WO_ONLY">This W/O Only</option><option value="MAIN_ONLY">Update Main Assembly Packet only</option><option value="BOTH">This W/O + Update Main Assembly Packet</option></select></label><p data-scope-description></p><label>Change reason<textarea data-reason maxlength="1000" rows="3" required></textarea></label><p data-release-error role="alert"></p><button type="button" data-confirm>Release Saved Draft</button><button type="button" data-cancel>Cancel</button>';
    const scope=modal.querySelector('[data-scope]'),desc=modal.querySelector('[data-scope-description]');
    const describe=()=>{desc.textContent=scope.value==='WO_ONLY'?'Only WO '+wo+' will advance to Traveler Rev '+(remote.travelerRevision+1)+'.':scope.value==='MAIN_ONLY'?'Update the matching Main Assembly Packet. This W/O and other released W/Os remain unchanged.':'Publish this W/O and its matching Main Assembly Packet together. Other released W/Os remain unchanged.';};scope.onchange=describe;describe();
    if(remote.mainPacket?.compatible===false)for(const option of scope.options)if(option.value!=='WO_ONLY')option.disabled=true;
    const identity=document.createElement('p');identity.textContent='Main Assembly Packet: '+[remote.mainPacket?.customer,remote.mainPacket?.assembly,remote.mainPacket?.revision].filter(Boolean).join(' / ');desc.after(identity);
    modal.querySelector('[data-cancel]').onclick=()=>modal.close();modal.addEventListener('close',()=>modal.remove(),{once:true});
    let request=null,busy=false;
    modal.querySelector('[data-confirm]').onclick=async()=>{if(busy)return;const reason=modal.querySelector('[data-reason]').value.trim();if(!reason){modal.querySelector('[data-release-error]').textContent='Enter a concise change reason.';return;}
     request??={expectedVersion:d.version,requestId:crypto.randomUUID(),scope:scope.value,reason};busy=true;modal.querySelector('[data-confirm]').disabled=true;scope.disabled=true;modal.querySelector('[data-reason]').disabled=true;
     try{await json(base+'/release-changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});drafts.delete(draftKey);modal.close();
      try{await reopenViewer(dialog,{...config,packetEdit:false,readOnly:true});}
      catch(e){reportReopenError('Changes were released successfully. The viewer could not reopen: '+e.message+' Return to jobs and reopen the released packet.');}
     }
     catch(e){modal.querySelector('[data-release-error]').textContent=e.message+' Retry uses the same release request to prevent duplicate publication.';}
     finally{busy=false;if(modal.isConnected)modal.querySelector('[data-confirm]').disabled=false;}
    };
    document.body.append(modal);modal.showModal();scope.focus();
   };
  }
  function compactViewer(dialog,heading){
   dialog.classList.add('job-compact-viewer');dialog.classList.toggle('job-viewer-readonly',viewOnly);
   const q=selector=>dialog.querySelector(selector),back=q('[data-back]');
   const identity=document.createElement('div');identity.className='job-viewer-identity';
   const title=document.createElement('strong');title.textContent='WO '+wo+' · '+job.context.assembly+' · Rev '+(job.context.revision||'-');identity.append(title);
   const statuses=document.createElement('div');statuses.className='job-viewer-statuses';identity.append(statuses);
   const context=q('.qi-viewer-context');
   if(context){for(const child of [...context.children])if(child.tagName!=='STRONG'){if(child.classList.contains('qi-inspection'))child.prepend('QC: ');statuses.append(child);}context.remove();}
   else if(materialIdentity?.state){const kit=document.createElement('span');kit.textContent=materialIdentity.state.replaceAll('_',' ');statuses.append(kit);}
   const state=q('[data-packet-state]')||document.createElement('span');
   if(!state.hasAttribute('data-packet-state'))state.textContent=remote.released?(remote.travelerRevision?'Released Traveler Rev '+remote.travelerRevision:'Released instructions v'+remote.version):'Draft · Not released';
   state.classList.add('job-viewer-state');state.dataset.released=String(!packetMode&&remote.released===true);statuses.append(state);
   const actions=document.createElement('div');actions.className='job-viewer-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Slide actions');
   const more=document.createElement('details');more.className='job-viewer-more';more.innerHTML='<summary>More</summary><div class="job-viewer-menu" aria-label="More slide actions"></div>';
   const menu=more.lastElementChild;
   const operation=heading.querySelector(':scope > strong');if(operation){operation.classList.add('job-viewer-operation');menu.append(operation);}
   if(q('[data-edit-current-slide]'))heading.querySelector('[data-organize-slides]')?.remove();
   for(const selector of ['[data-edit-current-slide]','[data-edit-bom]','[data-packet-save]','[data-organize-slides]','[data-packet-release]']){const node=q(selector);if(node)actions.append(node);}
   if(packetMode)q('[data-save-labor]')?.remove();else if(q('[data-save-labor]'))actions.append(q('[data-save-labor]'));
   for(const selector of ['[data-print-operation]','.labor-preview-materials','[data-packet-approved]','[data-packet-discard]']){const node=q(selector);if(node)menu.append(node);}
   for(const notice of [...dialog.querySelectorAll(':scope > .labor-slide-draft-notice')]){
    if(/No .+ slides are available/.test(notice.textContent)){notice.classList.add('job-viewer-warning');continue;}
    menu.append(notice);
   }
   if(materialNotice){const warning=document.createElement('p');warning.className='job-viewer-warning';warning.setAttribute('role','alert');warning.textContent=materialNotice;heading.after(warning);}
   const error=q('[data-packet-error]');if(error){error.classList.add('job-viewer-error');heading.after(error);}
   const progress=q('.labor-slide-playback [data-slide-jump],.labor-slide-playback output'),contextBar=q('.labor-slide-context-bar');
   if(progress&&contextBar){if(!progress.hasAttribute('data-slide-jump')){progress.title=progress.textContent;progress.textContent=progress.textContent.replace(/ \| Stage 1 \/ 1$/,'');}progress.classList.add('job-viewer-progress');contextBar.append(progress);}
   const caption=q('.labor-slide-caption');if(caption)menu.append(caption);
   q('.labor-slide-playback')?.remove();q('.job-packet-tools')?.remove();
   actions.append(more);heading.append(identity,actions);if(back){back.title=back.textContent;back.setAttribute('aria-label',back.textContent);back.textContent='Back';heading.prepend(back);}
   // Native disclosure keeps ordinary button/checkbox keyboard behavior. No menu-role arrow trap.
   const close=focus=>{if(!more.open)return;more.open=false;if(focus)more.querySelector('summary').focus();};
   const outside=e=>{if(!more.contains(e.target))close(false);};
   dialog.addEventListener('pointerdown',outside,{capture:true});
   dialog.addEventListener('keydown',e=>{if(more.open&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);}},true);
   dialog.addEventListener('cancel',e=>{if(more.open){e.preventDefault();close(true);}});
   more.addEventListener('click',e=>{if(e.target.closest('button'))close(false);});
  }
  const locationKey='dle-os:job-slides:'+wo+':'+d.token;
  let anchor=null;
  try { anchor=JSON.parse(sessionStorage.getItem(locationKey)||'null'); } catch (_) {}
  if(selectedPreview||startAtTraveler||startGroup)anchor=null;
  if(isCurrent&&!isCurrent())return false;
  const adapter=window.DleLaborSlides.connect({
   onPosition:position=>{try {sessionStorage.setItem(locationKey,JSON.stringify(position));} catch (_) {}},
   intakeId:baseline.quote.intakeId,getPlan:()=>plan,onChange:()=>{if(!viewOnly)changed(d);refreshPacketTools();},canEdit:()=>!viewOnly&&d.canEdit,supported:()=>true,
   slideJump:true,markerOpacitySupported:()=>remote.markerOpacitySupported===true,compactControls:packetMode,photosSupported:()=>true,imageTransformsSupported:()=>true,exclusionsSupported:()=>true,layoutSupported:()=>true,bomSupported:()=>true,
   drawingBase:base+'/pages',bomIdentity:()=>({assembly:job.context.assembly,revision:job.context.revision}),
   loadBomReference:async()=>{
    const data=await window.DleLaborBomSlides.fromFrozen(frozen,{definitionId:plan.definitionId,assembly:job.context.assembly,revision:job.context.revision});
    data.workOrder=wo;
    data.loadWorkOrderDraft=()=>window.DleLaborBomSlides.loadSavedDraft(wo,materialIdentity);
    await window.DleLaborBomSlides.refresh(data);return data;
   },
   isDirty:()=>!viewOnly&&changed(d),durableEditorSave:true,saveLabor:save,saveLabel:packetMode?'Save Draft':'Save to Work Order',visualBase:base,
   backLabel,onMount:(dialog,heading,context)=>{dialog.classList.add('job-instruction-viewer');if(!context?.editing)mountPacketTools(dialog,heading);return onViewerMount?.(dialog,heading);},
   onReady:(dialog,heading,context)=>{if(!context?.editing)compactViewer(dialog,heading);},
   contextNotice:'WO '+wo+(packetMode?' - DRAFT — based on Traveler Rev '+remote.travelerRevision+' — not released':remote.released?(remote.travelerRevision?' - Released Traveler Rev '+remote.travelerRevision:' - Released Quality instructions v'+remote.version):' - Job instruction draft based on accepted Labor v'+remote.baselineVersion+'. Not a production release.')+(materialNotice?' | '+materialNotice:''),
   drawingContext:async()=>{if(!source)throw Error('No frozen drawing source is available.');return {source,layers:(baseline.labor.drawingNotes||[]).map(layer=>({layer,reviewRequired:false}))};},
   uploadPhoto:file=>viewOnly?Promise.reject(Error('Read-only job instructions.')):json(base+(packetMode?'/draft/visuals':'/visuals'),{method:'POST',headers:{'X-Instruction-Baseline':d.token,'X-File-Name':encodeURIComponent(file.name),'Content-Type':file.type},body:file}),
   travelerJob:()=>travelerJob,travelerMaterial:()=>material,travelerMetadata:()=>({...job.context,workOrder:wo}),travelerRfq:()=>({customer:order.customer,assemblies:[{assemblyNumber:job.context.assembly,revision:job.context.revision}]}),
   onExit:()=>quality||selectedPreview?onExit?.():window.KittingJobWorkspace.toggleProductionSlides(false),
   prefixGroup:quality||selectedPreview?null:'Kitting',
   prefixSlides:quality||selectedPreview?[]:[
    {label:'Traveler',preview:async signal=>{if(!travelerJob)throw Error('Legacy traveler preview unavailable');const forms=await window.DleLaborDrawingNotes.letterPages();return forms.compose({kind:'START',summary:{travelerPlan:structuredClone(plan),travelerRfq:{customer:order.customer,assemblies:[]},travelerJob,travelerMaterial:material},layer:{page:1,marks:[],photos:[]},signal});},mount:host=>{host.classList.add('job-traveler-sheet');if(travelerJob){const definition=window.DleLaborTravelerPrint.build(plan,{customer:order.customer,assemblies:[]},window.DleLaborWorkbench,{job:travelerJob,material});const page=window.DleLaborTravelerPrint.mount(host,definition);return ()=>{page.remove();host.classList.remove('job-traveler-sheet');};}const restore=move(frame,host);return ()=>{restore();host.classList.remove('job-traveler-sheet');};}},
    {label:'Kitting / BOM',mount:host=>{host.classList.add('job-kitting-sheet');const dialog=host.closest('dialog');dialog?.classList.add('job-kitting-active');const active=document.getElementById('workOrderDashboardActiveKitting');const restore=move(active,host);const exit=()=>{dialog?.addEventListener('close',()=>window.KittingJobWorkspace.toggleProductionSlides(false),{once:true});dialog?.close();};active?.addEventListener('dle:kitting-saved-exit',exit);active?.addEventListener('dle:kitting-submitted',exit);if(active?.hidden){const p=document.createElement('p');p.textContent='Return to the workspace and use Kitting to start or resume this kit.';host.prepend(p);}return ()=>{active?.removeEventListener('dle:kitting-saved-exit',exit);active?.removeEventListener('dle:kitting-submitted',exit);restore();host.classList.remove('job-kitting-sheet');dialog?.classList.remove('job-kitting-active');};}}
   ],
   editSource:(id,resume)=>{if(viewOnly)return;const op=d.plan.operations.find(o=>o.id===id);const dialog=document.createElement('dialog');dialog.className='labor-slide-dialog';const heading=document.createElement('h2');heading.textContent='Instructions — '+op.name;const text=document.createElement('textarea');text.value=op.instructions||'';text.maxLength=4000;text.rows=8;const apply=document.createElement('button'),status=document.createElement('p');status.setAttribute('role','status');apply.textContent='Save';let saving=false;const controls=()=>{apply.disabled=saving||(!changed(d)&&text.value===(op.instructions||''));};text.oninput=controls;controls();apply.onclick=async()=>{if(saving)return;saving=true;apply.disabled=cancel.disabled=text.disabled=true;status.textContent='Saving draft…';op.instructions=text.value;changed(d);try{await save();dialog.close();}catch(e){status.textContent=e.message+' Your edits remain here.';}finally{saving=false;cancel.disabled=text.disabled=false;controls();}};const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>{if(!saving)dialog.close();};dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});dialog.append(heading,text,apply,cancel,status);dialog.addEventListener('close',()=>{dialog.remove();resume();},{once:true});document.body.append(dialog);dialog.showModal();}
  });
  if(!quality&&!selectedPreview)await window.WorkOrderDashboardModule.prepareKittingPreview?.();
  const result=await adapter.playSequence(viewOnly?structuredClone(plan.operations):plan.operations,trigger,null,{includeMaterials:!quality&&!selectedPreview,anchor,startAtTraveler,startGroup});return result!==false;
 }
 window.DleJobInstructions=Object.freeze({open,hasUnsavedChanges:wo=>[drafts.get(wo),drafts.get(wo+':packet')].some(d=>d?.saving||changed(d))});
})(window,document);

(function(window,document){
 'use strict';
 const clone=v=>structuredClone(v),uid=()=>crypto.randomUUID(),reviews=new Map();
 async function json(url,init={}){const r=await window.DleIntegration.request(url,{credentials:'same-origin',cache:'no-store',...init});let data;try{data=await r.json();}catch{throw Error('The response could not be confirmed. Retry uses the same request.');}if(!r.ok)throw Error(data.message||'This action is unavailable ('+r.status+').');return data;}
 const base=wo=>'/api/production/v1/work-orders/'+encodeURIComponent(wo);
 function eligible(operations,id){let op=operations.find(o=>o.id===id);if(!op||op.instructionSourceId||operations.some(o=>o.instructionSourceId===id))return false;const seen=new Set();while(op.parentId&&!seen.has(op.id)){seen.add(op.id);op=operations.find(o=>o.id===op.parentId);if(!op)return false;}return op.name.trim().toLowerCase()!=='kitting';}
 function label(entry){return entry.addition.status==='ACCEPTED'?'Quality reviewed - awaiting release':entry.addition.status==='RETURNED'?'Returned by Quality - needs revision'+(entry.addition.note?': '+entry.addition.note:''):'Needs Quality Review/Approval';}
 function stamp(dialog,heading,text){const tag=document.createElement('div');tag.className='production-pending-stamp';tag.setAttribute('role','status');tag.textContent=text;heading.after(tag);dialog.dataset.pendingAddition='true';}
 async function edit({wo,plan,operationId,entry,parentJobId,onClose,metadata}){
  if(!eligible(plan.operations,operationId))throw Error('This operation cannot receive an independent Production slide.');
  const id=entry?.addition.id||uid(),card=clone(entry?.addition.slide||{id:uid(),kind:'BLANK',title:'Production addition',body:'',page:1,stages:[{id:uid(),name:'Stage 1',marks:[],photos:[],savedView:{page:1,x:.5,y:.5,width:1,height:1,rotation:0}}]});
  const pending=clone(plan),owner=pending.operations.find(o=>o.id===operationId);owner.slides=[card];owner.slidesOrganized=false;
  let version=entry?.addition.version||0,saved=entry?JSON.stringify(card):null,inflight=null,request=null;
  const save=async()=>{
   if(inflight)return inflight;
   const snapshot=JSON.stringify(card);if(snapshot===saved)return {version};
   request??={requestId:uid(),expectedVersion:version,parentJobId,operationId,slide:clone(card)};
   const sent=JSON.stringify(request.slide);
   inflight=json(base(wo)+'/additions/'+encodeURIComponent(id)+'/slide',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)}).then(result=>{
    if(result.id!==id||result.version!==version+1)throw Error('Save could not be confirmed. Keep this editor open and retry.');
    version=result.version;saved=sent;request=null;return {version};
   }).finally(()=>{inflight=null;});return inflight;
  };
  const adapter=window.DleLaborSlides.connect({intakeId:'production-pending-'+wo,getPlan:()=>pending,onChange:()=>{},canEdit:()=>true,supported:()=>true,
   compactControls:true,durableEditorSave:true,isDirty:()=>saved!==JSON.stringify(card),saveLabor:save,saveLabel:'Save',
   markerOpacitySupported:()=>true,photosSupported:()=>true,imageTransformsSupported:()=>true,
   visualBase:base(wo)+'/instructions',travelerMetadata:()=>({...metadata,workOrder:wo}),
   contextNotice:'Needs Quality Review/Approval — this addition is not released instructions.',
   uploadPhoto:file=>json(base(wo)+'/additions/visuals',{method:'POST',headers:{'X-Addition-Parent':parentJobId,'X-Addition-Operation':operationId,'X-File-Name':encodeURIComponent(file.name),'Content-Type':file.type},body:file}),
   onReady:(dialog,heading)=>stamp(dialog,heading,'Needs Quality Review/Approval'),
  });
  // Existing editor, one owned pending card. No organizer or released-slide navigation is supplied.
  await adapter.editSingle(owner,card,card.stages[0],null,{onClose:()=>onClose?.(version?{opId:operationId,cardId:card.id,stageId:card.stages[0].id}:null),backLabel:'Return to slideshow'});
 }
 async function review(wo,entry,data,decision,note){
  const key=JSON.stringify([wo,entry.addition.id,entry.addition.version,data.draftVersion,decision,note]);
  if(!reviews.has(key))reviews.set(key,uid());
  const result=await json('/api/quoting/v1/quality/work-orders/'+encodeURIComponent(wo)+'/additions/'+encodeURIComponent(entry.addition.id)+'/review',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:reviews.get(key),expectedVersion:entry.addition.version,expectedDraftVersion:data.draftVersion,decision,note})});
  reviews.delete(key);return result;
 }
 window.DleProductionAdditions=Object.freeze({read:wo=>json(base(wo)+'/additions'),eligible,label,stamp,edit,review,
  // A cached v1 caller may still exist during the controlled activation window.
  open:async()=>{throw Error('Refresh this page to load the updated slide editor controls.');}});
})(window,document);

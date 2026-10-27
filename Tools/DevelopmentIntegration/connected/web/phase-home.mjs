// Registry adapter only. Does not modify global fetch, runtime markers or existing authorization.
export const phaseModules=Object.freeze({
 'rfq-quoting':['Intake Wizard','rfq.intake.create'],
 'technical-review':['Technical Review','technical_review.view'],
 'assembly-library':['Library','assembly_library.view'],
 'rfqs':['RFQs','rfq.view']
});
export const simHomeOrder=Object.freeze(['rfq-quoting','technical-review','assembly-library','rfqs','order-entry',
 'operations-center','quality','kitting','purchasing','vendors','receiving','production','shipping','invoice-history']);
const labels={'order-entry':'Order Entry','operations-center':'Operations Center',quality:'Quality',kitting:'Kitting',
 purchasing:'Purchasing',vendors:'Vendors',receiving:'Receiving',production:'Production',shipping:'Shipping','invoice-history':'Invoice History'};
export function entries(existing,can,available={}){
 const legacy=existing.map(x=>Object.freeze({...x,id:`existing:${x.id}`,nativeId:x.id,
  provenance:'DEV — existing',enabled:can(x.requiredPermission),reason:can(x.requiredPermission)?'':'Not assigned'}));
 const incoming=simHomeOrder.map(id=>{
  const phase=phaseModules[id],assigned=phase&&can(phase[1]),ready=available[id]===true;
  return Object.freeze({id:`incoming:${id}`,nativeId:id,label:phase?.[0]??labels[id],
   provenance:phase&&ready?'DEV — phase 1, from SIM':'From SIM — not integrated',
   enabled:Boolean(phase&&assigned&&ready),reason:!phase?'Outside phase one':!ready?'Integration not ready':!assigned?'Not assigned':''});
 });
 return Object.freeze([...legacy,...incoming]);
}
export function navigate(entry,{existing,incoming}){
 if(!entry?.enabled)return false;
 if(entry.id===`existing:${entry.nativeId}`){existing(entry.nativeId);return true;}
 if(entry.id===`incoming:${entry.nativeId}`&&phaseModules[entry.nativeId]){incoming(entry.nativeId);return true;}
 return false;
}
export function render(root,items,handlers){
 root.replaceChildren();
 for(const [title,prefix] of [['Existing DEV tools','existing:'],['Incoming layout','incoming:']]){
  const section=document.createElement('section'),heading=document.createElement('h2');heading.textContent=title;section.append(heading);
  const grid=document.createElement('div');grid.className='phase-home-grid';section.append(grid);
  for(const entry of items.filter(x=>x.id.startsWith(prefix))){
   const button=document.createElement('button');button.type='button';button.disabled=!entry.enabled;
   button.setAttribute('aria-disabled',String(!entry.enabled));
   for(const text of [entry.label,entry.provenance,entry.reason]){const line=document.createElement('span');line.textContent=text;button.append(line);}
   button.addEventListener('click',()=>navigate(entry,handlers));grid.append(button);
  }
  root.append(section);
 }
}
// Workspace-scoped cancellation prevents an old response from painting into a new user's workspace.
export function requestScope(){
 let epoch=0;const pending=new Set();
 return {cancel(){epoch++;for(const controller of pending)controller.abort();pending.clear();},
  async read(url,fetcher=fetch){
   if(!/^\/api\/quoting\/v1\/intakes\/[0-9a-f-]+(?:\/evidence\/[0-9a-f-]+)?$/i.test(url))throw Error('Unmapped route');
   const generation=epoch,controller=new AbortController();pending.add(controller);
   try{const response=await fetcher(url,{credentials:'same-origin',signal:controller.signal,cache:'no-store'});
    if(generation!==epoch)throw new DOMException('Workspace changed','AbortError');return response;
   }finally{pending.delete(controller);}
  }};
}

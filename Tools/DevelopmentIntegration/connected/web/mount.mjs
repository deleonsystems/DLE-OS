import {entries,render,phaseModules} from './phase-home.mjs';
const profile=new URL(location.href).searchParams.get('profile')||'ray';
document.querySelector('#fixtureProfile').value=profile;
await fetch('/fixture/profile/'+encodeURIComponent(profile),{method:'POST',headers:{'X-Rehearsal-Intent':'fixture-only'}});
const session=await (await fetch('/api/quoting/v1/session')).json();
window.DleOsRuntimeConfig=Object.freeze({environment:'ISOLATED_DEVELOPMENT_REHEARSAL'});
window.DleOsSession=Object.freeze(session);window.DleOsCapabilities=Object.freeze({can:p=>session.permissions.includes(p),isSuperAdmin:false});
document.querySelector('#identity').textContent=session.user.displayName;
// Scoped transport called only by incoming source modules; global fetch is unchanged.
let epoch=0;const pending=new Set();
window.DleIntegration=Object.freeze({enabled:true,managedEvidence:true,async request(path,options={}){
 const u=new URL(path,location.href);if(u.origin!==location.origin||!(u.pathname.startsWith('/api/quoting/v1/')||u.pathname.startsWith('/incoming/SRC/')))throw Error('Unmapped integration resource');
 const generation=epoch,controller=new AbortController();pending.add(controller);
 try{const r=await fetch(u,{...options,credentials:'same-origin',signal:controller.signal,headers:{...options.headers,'X-Rehearsal-Intent':'fixture-only'}});if(generation!==epoch)throw new DOMException('Workspace changed','AbortError');return r;}finally{pending.delete(controller);}
}});
document.addEventListener('dle:workspace-change',()=>{epoch++;for(const c of pending)c.abort();pending.clear();});
window.DleApiClient=Object.freeze({async searchCanonicalCustomers(q){return(await window.DleIntegration.request('/api/quoting/v1/customers?q='+encodeURIComponent(q))).json();}});
const original=window.DleWorkspaceRegistry;
const definitions={
 'rfq-quoting':{id:'rfq-quoting',label:'Intake Wizard',modulePath:'/incoming/SRC/modules/rfq-workspace/intake-wizard.js',stylePath:'/incoming/SRC/modules/rfq-workspace/rfq-workspace.css'},
 'technical-review':{id:'technical-review',label:'Technical Review',modulePath:'/incoming/SRC/workspaces/technical-review/technical-review-workspace.js',stylePath:'/incoming/SRC/workspaces/technical-review/technical-review-workspace.css'},
 'assembly-library':{id:'assembly-library',label:'Library',modulePath:'/incoming/SRC/workspaces/assembly-library/assembly-library-workspace.js',stylePath:'/incoming/SRC/workspaces/assembly-library/assembly-library-workspace.css'},
 'rfqs':{id:'rfqs',label:'RFQs',modulePath:'/incoming/SRC/workspaces/rfqs/rfqs-workspace.js',stylePath:'/incoming/SRC/workspaces/rfqs/rfqs-workspace.css'}
};
const allowed=id=>(id==='dle-home'||definitions[id]&&session.permissions.includes(phaseModules[id][1]))&&(!Array.isArray(session.allowedWorkspaces)||session.allowedWorkspaces.includes(id));
window.DleWorkspaceRegistry=Object.freeze({...original,
 all(){return [original.getById('dle-home'),...Object.values(definitions).filter(d=>allowed(d.id))];},
 getById(id){return allowed(id)?definitions[id]||original.getById(id):null;},
 resolve(id){return allowed(id)?definitions[id]||original.getById(id):original.getById('dle-home');}
});
window.DleWorkspaces={'rfq-quoting':{render(){const m=document.querySelector('[data-workspace-mount="rfq-quoting"]');if(m)window.DleIntakeWizard.mount(m);}}};
const script=document.createElement('script');script.src='/incoming/SRC/modules/rfq-workspace/intake-wizard.js';await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.head.append(script);});
const existing=['operations-center','invoice-history','purchasing','kitting','production'].map(id=>({id,label:original.getById(id)?.label||id,requiredPermission:'fixture.no-live-access'}));
const tiles=entries(existing,p=>session.permissions.includes(p),Object.fromEntries(Object.keys(definitions).map(k=>[k,true]))).map(e=>({...e,provenance:e.id.startsWith('existing:')?'Existing DEV · disconnected in rehearsal':definitions[e.nativeId]?'Candidate rehearsal · from SIM':e.provenance,reason:e.id.startsWith('existing:')?'Preserved; no live data connection':e.reason}));
render(document.querySelector('#tiles'),tiles,{existing(){},incoming(id){window.DleWorkspaceShell.navigate({workspaceId:id});}});
document.querySelector('#homeButton').onclick=()=>window.DleWorkspaceShell.navigate({workspaceId:'dle-home'});
document.querySelector('#fixtureProfile').onchange=e=>{const u=new URL(location.href);u.searchParams.set('profile',e.target.value);location.assign(u);};
window.DleWorkspaceShell.init();window.DleWorkspaceShell.activateInitialWorkspace();

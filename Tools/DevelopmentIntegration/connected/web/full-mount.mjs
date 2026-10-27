import {entries,render,phaseModules} from './phase-home.mjs';
import {createQuotingTransport} from './quoting-transport.mjs';
await window.DleOsAuthorizationReady;
const session=window.DleOsSession;
if(!session?.user||!window.DleOsCapabilities)throw Error('Baseline identity unavailable');
const secureTransport=session.fixtureOnly===true?null:createQuotingTransport({origin:location.origin,csrf:()=>document.querySelector('#dle-auth-signout-form input[name="__RequestVerificationToken"]')?.value});
// Scoped transport called only by incoming source modules; global fetch is unchanged.
let epoch=0;const pending=new Set();
window.DleIntegration=Object.freeze({enabled:true,managedEvidence:true,async request(path,options={}){
 if(secureTransport)return secureTransport.request(path,options);
 const u=new URL(path,location.href);if(u.origin!==location.origin||!(u.pathname.startsWith('/api/quoting/v1/')||u.pathname.startsWith('/incoming/SRC/')))throw Error('Unmapped integration resource');
 const generation=epoch,controller=new AbortController();pending.add(controller);
 try{const r=await fetch(u,{...options,credentials:'same-origin',signal:controller.signal,headers:{...options.headers,'X-Rehearsal-Intent':'fixture-only'}});if(generation!==epoch)throw new DOMException('Workspace changed','AbortError');return r;}finally{pending.delete(controller);}
}});
document.addEventListener('dle:workspace-change',()=>{secureTransport?.cancel();epoch++;for(const c of pending)c.abort();pending.clear();});
document.addEventListener('submit',event=>{if(event.target?.id==='dle-auth-signout-form')secureTransport?.cancel();},true);
window.addEventListener('pagehide',()=>secureTransport?.close());
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
const oldHome=window.DleWorkAreaHome;
const existing=['operations-center','invoice-history','purchasing','kitting','production'].map(id=>({id,label:original.getById(id)?.label||id,requiredPermission:'fixture.no-live-access'}));
function showHome(){
 const root=document.querySelector('#dleWorkAreaHome');if(!root)return;
 const tiles=entries(existing,p=>window.DleOsCapabilities.can(p),Object.fromEntries(Object.keys(definitions).map(k=>[k,true]))).map(e=>({...e,provenance:e.id.startsWith('existing:')?'Existing DEV - disconnected in rehearsal':definitions[e.nativeId]?'Candidate rehearsal - from SIM':e.provenance,reason:e.id.startsWith('existing:')?'Preserved; no live data connection':e.reason}));
 render(root,tiles,{existing(){},incoming(id){window.DleWorkspaceShell.navigate({workspaceId:id});}});
}
window.DleWorkAreaHome=Object.freeze({...oldHome,render:showHome});
const css=document.createElement('link');css.rel='stylesheet';css.href='/phase-home.css';document.head.append(css);
window.DleWorkspaceShell.init();window.DleWorkspaceShell.activateInitialWorkspace();showHome();
document.addEventListener('dle:view-mode-change',showHome);

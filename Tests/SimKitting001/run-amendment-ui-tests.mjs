import assert from 'node:assert/strict';
import { read, wo, fixture, persistent, copy, flush, load } from './ui-test-harness.mjs';

let checks=0;
function equal(actual,expected,message){assert.deepEqual(actual,expected,message);checks++;}
const reset=()=>Object.assign(persistent,{record:null,calls:[],failSave:false,saveBarrier:null,getBarrier:null,amendBarrier:null,amendFailure:null});
const field=(app,id)=>app.elements.get('activeKittingPoAmendment'+id);
const policy=app=>app.elements.get('activeKittingPoTraceability').textContent;
const amendCalls=()=>persistent.calls.filter(c=>c[0]==='AMEND');
function choose(app,value,reason='Reviewed customer requirements: supplier PO evidence is not required.'){
  field(app,'Value').value=value;field(app,'Reason').value=reason;
  app.window.updateWorkOrderDashboardPoTraceabilityAmendment();
}
async function start(options){reset();const app=await load(options);await app.window.startOrResumeWorkOrderDashboardKitting();return app;}

const html=read('SRC/modules/work-order-dashboard/work-order-dashboard.html');
equal(/<select[^>]+id="activeKittingPoTraceability"/.test(html),false,'Normal policy is not an editable selector');
equal(/id="activeKittingPoTraceability"/.test(html),true,'Policy remains visibly available');
equal(/id="activeKittingPoAmendmentReason"[^>]+required/.test(html),true,'Reviewed reason is required');
const movedCard=html.match(/<section\b[^>]*id="workOrderDashboardActiveKitting"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
equal(/<dialog\b[^>]*id="activeKittingPoAmendmentDialog"/.test(movedCard),true,'Amendment modal travels inside the active Kitting card, outside the hidden dashboard after reparenting');
equal(/appendById\(active, 'workOrderDashboardActiveKitting'\)/.test(read('SRC/workspaces/kitting/kitting-job-workspace.js')),true,'Placement regression follows the actual card moved into the visible job workspace');
equal(/#activeKittingAmendPoTraceability\s*\{[^}]*background: #173043;[^}]*color: #dceef8;/.test(read('SRC/modules/work-order-dashboard/work-order-dashboard.css')),true,'Amendment action has scoped high-contrast dark styling');
const api=read('SRC/api/dle-api-client.js');
equal(/amendKittingCasePoTraceability[\s\S]*?requireDevelopmentCapability\('kitting.traceability.amend'\)[\s\S]*?\/po-traceability-amendment[\s\S]*?method: 'POST'/.test(api),true,'API uses the dedicated permission and command');

let app=await start();
equal(policy(app),'REQUIRED');
equal(app.elements.get('activeKittingAmendPoTraceability').hidden,false,'Authorized lease owner can find explicit amendment');
equal(app.window.openWorkOrderDashboardPoTraceabilityAmendment(),true);
equal(field(app,'WorkOrder').textContent,wo);
equal(field(app,'Current').textContent,'REQUIRED');
equal(field(app,'Apply').disabled,true,'Current unchanged policy cannot be applied');
choose(app,'not-required',' ');
equal(field(app,'Apply').disabled,true,'Blank reason cannot be applied');
equal(await app.window.applyWorkOrderDashboardPoTraceabilityAmendment(),false);
equal(amendCalls().length,0,'Missing reason produces no command');
choose(app,'not-required');
equal(field(app,'Apply').disabled,false);
const frozen=copy(app.window.WorkOrderDashboardModule.getActiveKittingDraft());
const anchored=copy(persistent.record);
let releaseAmend;
persistent.amendBarrier=new Promise(resolve=>releaseAmend=resolve);
const applying=app.window.applyWorkOrderDashboardPoTraceabilityAmendment();await flush();
equal(policy(app),'REQUIRED','Pending request does not optimistically change policy');
equal(field(app,'Apply').disabled,true,'Double apply is blocked');
equal(await app.window.applyWorkOrderDashboardPoTraceabilityAmendment(),false);
equal(await app.window.saveWorkOrderDashboardKitting(),false,'Save cannot race pending amendment');
equal(app.window.closeWorkOrderDashboardPoTraceabilityAmendment(),false,'Pending command retains its dialog');
releaseAmend();await applying;persistent.amendBarrier=null;
equal(amendCalls().length,1);
equal(amendCalls()[0].slice(1),[wo,{caseId:anchored.caseId,expectedWorkingVersion:anchored.workingVersion,editingSessionId:anchored.editingSessionId,poTraceabilityRequired:false,reason:'Reviewed customer requirements: supplier PO evidence is not required.'}],'Request is anchored to selected case/version/session');
equal(policy(app),'NOT REQUIRED','Server response changes effective policy');
equal(app.elements.get('kittingJobPoTraceability').textContent,'NOT REQUIRED','Compact job summary agrees');
equal(app.elements.get('activeKittingPoTraceabilityAmended').hidden,false);
equal(app.elements.get('activeKittingPoTraceabilityAmended').title.includes('Reviewer'),true,'Audit indicator retains reviewer');
equal(app.window.WorkOrderDashboardModule.getActiveKittingDraft(),frozen,'Amendment never replaces or edits the original released draft');
equal(persistent.record.draft,frozen,'Server test record preserves frozen original policy');
equal(persistent.record.originalPoTraceabilityRequired,true);
equal(field(app,'Dialog').open,false);

// A reload displays the effective value and audit even before reconnecting the lease.
app=await load();
equal(policy(app),'NOT REQUIRED');
equal(app.elements.get('activeKittingPoTraceabilityAmended').hidden,false);
equal(app.elements.get('activeKittingAmendPoTraceability').hidden,true,'Read-only reload cannot amend before owning lease');
equal(app.window.openWorkOrderDashboardPoTraceabilityAmendment(),false);
await app.window.reconnectWorkOrderDashboardKitting();
app.window.chooseWorkOrderDashboardKittingMethod('020','COMPLETE');
equal(app.elements.get('activeKittingAmendPoTraceability').disabled,true,'Unsaved row changes disable amendment immediately');
equal(app.window.openWorkOrderDashboardPoTraceabilityAmendment(),false);
const local=copy(app.window.WorkOrderDashboardModule.getActiveKittingDraft());
let releaseSave;persistent.saveBarrier=new Promise(resolve=>releaseSave=resolve);
const saving=app.window.saveWorkOrderDashboardKitting();await flush();
equal(app.elements.get('activeKittingAmendPoTraceability').disabled,true,'Queued/in-flight save blocks amendment');
releaseSave();await saving;persistent.saveBarrier=null;
equal(persistent.record.draft.groups[1].entry,local.groups[1].entry,'Not required permits blank PO evidence without losing row input');
equal(app.elements.get('activeKittingAmendPoTraceability').disabled,false,'Successful save permits subsequent review');
// A clean explicit save must also block amendment while pending.
persistent.saveBarrier=new Promise(resolve=>releaseSave=resolve);
const cleanSaving=app.window.saveWorkOrderDashboardKitting();await flush();
equal(app.window.openWorkOrderDashboardPoTraceabilityAmendment(),false);
releaseSave();await cleanSaving;persistent.saveBarrier=null;

// A GET begun before an amendment may not overwrite its newer effective policy.
app=await start();
let releaseGet;persistent.getBarrier=new Promise(resolve=>releaseGet=resolve);
app.events.get('visibilitychange')();await flush();
app.window.openWorkOrderDashboardPoTraceabilityAmendment();choose(app,'not-required');
await app.window.applyWorkOrderDashboardPoTraceabilityAmendment();
const amendedVersion=persistent.record.workingVersion;
releaseGet();await flush();persistent.getBarrier=null;
equal(policy(app),'NOT REQUIRED','Older browser-resume GET cannot visually revert amendment');
await app.window.saveWorkOrderDashboardKitting();
equal(persistent.calls.filter(c=>c[0]==='SAVE').at(-1)[2].expectedWorkingVersion,amendedVersion,'Next save uses amended working version');

app=await start();
let rejectGet;persistent.getBarrier=new Promise((_resolve,reject)=>rejectGet=reject);
app.events.get('visibilitychange')();await flush();
app.window.openWorkOrderDashboardPoTraceabilityAmendment();choose(app,'not-required');
await app.window.applyWorkOrderDashboardPoTraceabilityAmendment();
rejectGet(Object.assign(new Error('Old request lease expired'),{status:409,code:'editing_lease_required'}));
await flush();persistent.getBarrier=null;
equal(policy(app),'NOT REQUIRED','Older failed GET does not revert the successful amendment');
equal(app.elements.get('activeKittingSave').disabled,false,'Older failed GET does not revoke the newer valid editing state');

// Stale/lease/API failures preserve the previously confirmed policy and source graph.
for(const error of [Object.assign(new Error('The case changed.'),{status:409,code:'kitting_case_version_changed'}),Object.assign(new Error('Lease expired.'),{status:409,code:'editing_lease_required'}),new Error('Storage unavailable')]){
  app=await start();const original=copy(persistent.record.draft);
  app.window.openWorkOrderDashboardPoTraceabilityAmendment();choose(app,'not-required');persistent.amendFailure=error;
  equal(await app.window.applyWorkOrderDashboardPoTraceabilityAmendment(),false);
  equal(policy(app),'REQUIRED','Failed amendment preserves existing effective policy');
  equal(persistent.record.draft,original);
  equal(app.window.WorkOrderDashboardModule.getActiveKittingDraft(),original);
  equal(field(app,'Error').textContent,error.message,'Failure remains visible in dialog');
  if(error.status===409)equal(app.elements.get('activeKittingSave').disabled,true,'Stale/expired lease enters existing read-only recovery');
}

for(const options of [{canAmend:false},{amendPermission:false}]){
  app=await start(options);
  equal(app.elements.get('activeKittingAmendPoTraceability').hidden,true,'No amendment permission hides action');
  equal(app.window.openWorkOrderDashboardPoTraceabilityAmendment(),false);
  equal(amendCalls().length,0);
}
const saved=copy(persistent.record);
app=await load({environment:'ISOLATED_DEVELOPMENT',record:saved});
equal(app.elements.get('activeKittingAmendPoTraceability').hidden,true,'DEV remains read-only');
equal(app.window.openWorkOrderDashboardPoTraceabilityAmendment(),false);
delete saved.poTraceabilityRequired;
app=await load({record:saved});
equal(policy(app),'Not Recorded','Unknown legacy policy is not reported as optional/not required');
equal(app.elements.get('activeKittingAmendPoTraceability').hidden,true);
equal(fixture.poTraceabilityRequired,true,'Fixture original policy remains unchanged');
console.log('PASS '+checks+' reviewed PO amendment UI checks; isolated in-memory server only.');

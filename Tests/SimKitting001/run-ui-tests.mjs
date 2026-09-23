import assert from 'node:assert/strict';
import { controller, simShell, wo, fixture, persistent, flush, load } from './ui-test-harness.mjs';
let checks=0;
function equal(a,b,msg){assert.equal(a,b,msg);checks++;}

let app=await load();
equal(persistent.calls.some(c=>c[0]==='START'),false,'Read/preview does not start case');
equal(app.elements.get('workOrderDashboardKitReleasedBom').disabled,false,'Supported server-authorized SIM Start enabled');
for(const id of ['workOrderDashboardKitReleasedBom','activeKittingSave','activeKittingSaveExit']){
  equal(app.elements.get(id).dataset.kittingEditSupported,'true',id+' is exempt from the SIM readonly visibility gate');
  assert.ok(simShell.includes('#'+id+':not([data-kitting-edit-supported="true"])'),'SIM shell hides '+id+' only without explicit supported capability');checks++;
  assert.doesNotMatch(simShell,new RegExp('#'+id+'\\s*,'),'No blanket CSS override hides supported '+id);checks++;
}
equal(app.window.WorkOrderDashboardModule.openReleasedBom(),true,'Released preview available before Start');
equal(app.window.report.includes('0.001 / assy'),true,'Report retains fractional requirement');
const fractionalLabels=app.window.KittingBagLabel.createVariants(fixture,fixture.groups[0]);
equal(app.window.KittingBagLabel.printDocument(fractionalLabels[0]).includes('0.001'),true,'Bag label retains the same small fractional requirement');
await app.window.startOrResumeWorkOrderDashboardKitting();
equal(persistent.record.caseId,'case-one');equal(persistent.record.draft.groups.length,12);
equal(persistent.record.draft.groups.every(g=>g.entry===null),true,'Start creates zero execution entries');
equal(app.elements.get('activeKittingTrialBody').innerHTML.includes('0.001 / assy'),true,'Table retains small fractional value');
equal(app.window.WorkOrderDashboardModule.getActiveKittingDraft().groups.length,12);

// Exercise persistence only against the isolated in-memory fake server.
app.window.chooseWorkOrderDashboardKittingMethod('020','COUNT');
app.window.updateWorkOrderDashboardKittingAllocation('020','A1','quantity','12');
app.window.updateWorkOrderDashboardKittingAllocation('020','A1','purchaseOrder','ISOLATED-PO');
equal(app.window.WorkOrderDashboardModule.getActiveKittingSaveState().includes('Unsaved'),true);
await app.window.submitWorkOrderDashboardKittingRow('020');
equal(persistent.record.draft.groups[1].rowState,'SUBMITTED','Row action persisted without waiting for timer');
equal(persistent.record.draft.groups[1].entry.shortageQuantity,8,'Existing shortage arithmetic retained');
equal(app.window.WorkOrderDashboardModule.getActiveKittingSaveState(),'Saved');
equal(app.window.WorkOrderDashboardModule.getActiveKittingDraft().groups[1].lastSubmittedBy,'Server audit','Successful save retains server-owned audit values');
await app.window.saveAndExitWorkOrderDashboardKitting();
equal(persistent.record.isEditing,false);
const sameCase=persistent.record.caseId, sameRelease=persistent.record.releasedBomIdentity;
app=await load();
equal(app.window.WorkOrderDashboardModule.getActiveKittingDraft().groups[1].entry.pickedQuantity,12,'Reload sees persisted row');
equal(app.elements.get('activeKittingSave').disabled,true,'Reload starts read only');
await app.window.reconnectWorkOrderDashboardKitting();
equal(persistent.record.caseId,sameCase);equal(persistent.record.releasedBomIdentity,sameRelease);
equal(app.elements.get('activeKittingSave').disabled,false,'Resume obtains current lease');
equal(persistent.calls.filter(c=>c[0]==='START').length,1,'Reload/resume does not duplicate case');
app.window.editWorkOrderDashboardKittingRow('020');
app.window.updateWorkOrderDashboardKittingAllocation('020','A1','quantity','13');
persistent.failSave=true;await app.window.saveWorkOrderDashboardKitting();
equal(app.window.WorkOrderDashboardModule.getActiveKittingSaveState().includes('Unsaved changes'),true,'Failed save never claims durable completion');
equal(persistent.record.draft.groups[1].entry.pickedQuantity,12,'Failed save leaves server snapshot intact');
persistent.failSave=false;await app.window.saveWorkOrderDashboardKitting();
equal(persistent.record.draft.groups[1].entry.pickedQuantity,13,'Explicit Save persists later edits');
equal(persistent.calls.every(c=>c[1]===wo),true,'All case commands target selected generic WO');

let releaseSave;
persistent.saveBarrier=new Promise(resolve=>{releaseSave=resolve;});
app.window.updateWorkOrderDashboardKittingAllocation('020','A1','quantity','14');
const pendingSave=app.window.saveWorkOrderDashboardKitting();
await flush();
app.window.updateWorkOrderDashboardKittingAllocation('020','A1','quantity','15');
releaseSave();await pendingSave;persistent.saveBarrier=null;
equal(persistent.record.draft.groups[1].entry.pickedQuantity,14,'Save stores its captured snapshot');
equal(app.window.WorkOrderDashboardModule.getActiveKittingDraft().groups[1].entry.pickedQuantity,15,'Edits during save remain local');
equal(app.window.WorkOrderDashboardModule.getActiveKittingSaveState().includes('Unsaved'),true,'Concurrent local edits remain visibly unsaved');
await app.window.saveWorkOrderDashboardKitting();
equal(persistent.record.draft.groups[1].entry.pickedQuantity,15,'Next Save persists pending edits');

app.window.updateWorkOrderDashboardKittingAllocation('020','A1','quantity','16');
persistent.record.workingVersion++;
const resumes=persistent.calls.filter(c=>c[0]==='RESUME').length;
await app.window.reconnectWorkOrderDashboardKitting();
await app.window.reconnectWorkOrderDashboardKitting();
equal(app.window.WorkOrderDashboardModule.getActiveKittingSaveState().includes('newer saved Kitting version'),true,'Repeated reconnect cannot overwrite a newer saved version');
equal(app.elements.get('activeKittingSave').disabled,true,'Stale local evidence remains read only');
equal(persistent.record.draft.groups[1].entry.pickedQuantity,15,'Conflicting local count never overwrites saved evidence');
equal(persistent.calls.filter(c=>c[0]==='RESUME').length,resumes,'Stale draft does not acquire another editing lease');

const unsupported=await load({supported:false,canEdit:false});
const beforeUnsupported=persistent.calls.length;
equal(unsupported.elements.get('workOrderDashboardKitReleasedBom').disabled,true,'Server-disabled case cannot edit in SIM');
for(const id of ['workOrderDashboardKitReleasedBom','activeKittingSave','activeKittingSaveExit'])equal(unsupported.elements.get(id).dataset.kittingEditSupported,'false',id+' retains the unsupported SIM visibility gate');
await unsupported.window.startOrResumeWorkOrderDashboardKitting();
equal(persistent.calls.length,beforeUnsupported,'Unsupported action does not call Start or Resume');

const dev=await load({environment:'ISOLATED_DEVELOPMENT'});
equal(dev.window.WorkOrderDashboardModule.getActiveKittingDraft().groups.length,12,'Saved DEV requirements hydrate without provider');
equal(dev.elements.get('workOrderDashboardKitReleasedBom').disabled,true,'DEV editing stays read only');
equal(dev.elements.get('workOrderDashboardKitReleasedBom').dataset.kittingEditSupported,'false','DEV reference does not receive SIM edit visibility capability');
const writes=persistent.calls.filter(c=>['START','RESUME','SAVE','EXIT'].includes(c[0])).length;
await dev.window.startOrResumeWorkOrderDashboardKitting();
equal(persistent.calls.filter(c=>['START','RESUME','SAVE','EXIT'].includes(c[0])).length,writes,'DEV action cannot acquire lease');
equal(dev.window.WorkOrderDashboardModule.openReleasedBom(),true,'DEV saved report survives missing retired source');

for(const [input,expected] of [[.001,'0.001'],[.0001,'0.0001'],[.01,'0.01'],[10,'10'],[.0000001,'1e-7'],[.1+.2,'0.3']])equal(app.window.KittingQuantity.format(input),expected);
assert.doesNotMatch(controller,/0115621|WorkOrderReleasedBom004|releasedBomPrototype|kittingEditingTemporarilyAvailable/);checks++;
equal(persistent.calls.some(c=>c[0]==='SUBMIT'),false);
console.log('PASS '+checks+' generic Kitting UI/precision/durability checks; isolated fake server only.');

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {load,fixture,copy,persistent,wo,flush} from '../SimKitting001/ui-test-harness.mjs';
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};
const draft=copy(fixture),row=draft.groups[4];row.sourceRowId='row-five';
row.entry={method:'COUNT',allocations:[{allocationId:'A1',partNumber:row.partNumber,quantity:12,purchaseOrder:'',acceptedMaterial:null}],pickedQuantity:12,shortageQuantity:8,extraQuantity:0,result:'COUNTED_SHORT'};row.rowState='SUBMITTED';
const record={caseId:'case-one',state:'KIT_SHORT',workingVersion:55,releasedBomIdentity:'release-v1',isEditing:false,completedCount:12,actionableCount:12,poTraceabilityRequired:false,draft};
const demand={demandId:'demand-one',sourceRowId:'row-five',short:8,progress:'Ready for Kitting',orders:[],returnOrigin:{caseId:'case-one',workingVersion:55,releasedBomIdentity:'release-v1',requirementId:row.groupId},acceptedMaterials:[{receiptLineId:'SIM-AM-0000001',availableQuantity:8,uom:'EA',stagingLocation:'SIM / Kitting staging'}]};
const supply={workOrders:[{workOrderNumber:wo,demands:[demand]}]};
const app=await load({record,supply});await app.window.reconnectWorkOrderDashboardKitting();
const api=app.window.DleApiClient;
let requests=[],failOnce=true,correction=false;
api.getKittingMaterialContext=async()=>({caseId:persistent.record.caseId,workingVersion:persistent.record.workingVersion,requirements:[{
  demandId:'demand-one',submissionId:'source-submission',sourceRowId:'row-five',requirementId:row.groupId,findNumber:5,partNumber:row.partNumber,uom:'EA',requiredQuantity:20,previouslyKitted:12,remainingShort:8,
  corrections:correction?[{allocationId:'A2',quantity:8,allocationHash:'allocation-hash'}]:[],applications:[],materials:[{receiptLineId:'SIM-AM-0000001',version:2,poNumber:'SIM-PO-0001',poLine:'010',packingSlipNumber:'SIM-PS-0001',stagingLocation:'SIM / Kitting staging',uom:'EA',availableQuantity:8}]
}]});
api.applyKittingMaterial=async(target,request)=>{
  requests.push(copy(request));assert.equal(target,wo);
  if(failOnce){failOnce=false;throw new Error('Network retry required');}
  const result=copy(persistent.record),g=result.draft.groups[4];
  g.entry.allocations.push({allocationId:'AM-app-one',partNumber:g.partNumber,quantity:8,purchaseOrder:'SIM-PO-0001',acceptedMaterial:{applicationId:'app-one',receiptLineId:'SIM-AM-0000001',poLine:'010',packingSlipNumber:'SIM-PS-0001'}});
  g.entry.pickedQuantity=20;g.entry.shortageQuantity=0;g.entry.result='COUNTED_EXACT';result.workingVersion++;persistent.record=result;
  demand.acceptedMaterials=[];demand.appliedQuantity=8;demand.progress='Re-Kit Applied · Submission Required';
  return {kittingCase:copy(result)};
};
function node(){return {disabled:false,value:'',checked:false,textContent:'',onclick:null,addEventListener(event,fn){this[event]=fn;}};}
let dialog;
app.context.crypto={randomUUID};
app.context.document.createElement=()=>{
  const close=node(),apply=Object.assign(node(),{dataset:{apply:'0'}}),qty=Object.assign(node(),{value:'8'}),status=node(),reason=node(),correct=node();
  const nodes=new Map([['[data-close]',close],['[role="status"]',status],['[data-quantity="0"]',qty],['#kittingMaterialReason',reason],['[data-correct]',correct]]);
  dialog={innerHTML:'',open:false,querySelector:s=>s==='[data-correct]'&&!correction?null:nodes.get(s)||null,
    querySelectorAll:s=>s==='[data-apply]'&&!correction?[apply]:s==='[data-reverse]'?[]:[close,apply,qty,status,reason,correct],
    addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.open=false;},nodes,apply,correct,qty,reason};return dialog;
};
app.context.document.body={append(){}};
await app.window.reviewWorkOrderDashboardAcceptedMaterial('row-five');
check(dialog.open&&dialog.innerHTML.includes('SIM-AM-0000001')&&dialog.innerHTML.includes('value="8"'),'known receipt and quantity prefilled');
check(!dialog.innerHTML.includes('<select'),'no part PO WO Find or receipt re-entry');
check(requests.length===0,'opening confirmation consumes nothing');
await dialog.apply.onclick();check(requests.length===1&&dialog.nodes.get('[role="status"]').textContent.includes('retry'),'uncertain outcome retains visible retry');
await dialog.apply.onclick();check(requests.length===2&&JSON.stringify(requests[0])===JSON.stringify(requests[1]),'retry preserves command ID version quantity and identity');
check(persistent.record.state==='KIT_SHORT'&&persistent.record.draft.groups[4].entry.pickedQuantity===20,'application updates working20 without submission');
const html=app.elements.get('activeKittingTrialBody').innerHTML;
for(const text of ['Original Kitting 12','SIM-AM-0000001','Applied 8','Working Total 20 / 20','Submission Required'])check(html.includes(text),'visible '+text);
check(!persistent.calls.some(c=>c[0]==='SUBMIT'),'no successor submit');
const editable=copy(persistent.record.draft);editable.groups[4].rowState='EDITING';
const trial=app.window.ActiveKittingTrial;
check(trial.updateAllocation(editable,row.sequence,'AM-app-one',{quantity:99})===null,'receipt quantity protected');
check(trial.removeAllocation(editable,row.sequence,'AM-app-one')===null,'receipt delete protected');
check(trial.applyMethod(editable,row.sequence,'COMPLETE')===null,'generic method cannot erase receipt source');
await app.window.saveAndExitWorkOrderDashboardKitting();
const reloaded=await load({record:persistent.record,supply});
check(reloaded.window.WorkOrderDashboardModule.getActiveKittingDraft().groups[4].entry.allocations[1].acceptedMaterial.applicationId==='app-one','reload retains application identity');
check(reloaded.elements.get('activeKittingSave').disabled,'reload remains read-only until resume');
const completedRecord=copy(persistent.record);completedRecord.state='KIT_COMPLETE';completedRecord.isEditing=false;
const completeSupply=copy(supply);completeSupply.workOrders[0].materialStatus='KIT_COMPLETE';
Object.assign(completeSupply.workOrders[0].demands[0],{progress:'Kit Complete',resolved:true,materialStatus:'KIT_COMPLETE',acceptedMaterials:[],returnOrigin:null});
const callsBeforeComplete=persistent.calls.length;
const completedApp=await load({record:completedRecord,supply:completeSupply});
const completedHtml=completedApp.elements.get('activeKittingTrialBody').innerHTML;
check(completedHtml.includes('Submitted Total 20 / 20')&&completedHtml.includes('SIM-AM-0000001'),'completed detail retains submitted application evidence');
check(!completedHtml.includes('Submission Required')&&!completedHtml.includes('WO remains KIT SHORT')&&!completedHtml.includes('READY FOR RE-KIT'),'completed detail has no stale re-kit actions');
check(!persistent.calls.slice(callsBeforeComplete).some(c=>['RESUME','SAVE','SUBMIT'].includes(c[0])),'completed detail inspection sends no execution commands');
console.log(`PASS ${checks} governed material UI checks; isolated fake server only`);

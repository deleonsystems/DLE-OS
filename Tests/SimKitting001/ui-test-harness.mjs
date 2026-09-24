import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read=p=>fs.readFileSync(p,'utf8');
const controller=read('SRC/modules/work-order-dashboard/work-order-dashboard.js');
const simShell=read('Tools/SimRuntime/DleOs.SimHost/SimShellRenderer.cs');
const wo='0888888';
const fixture={schemaVersion:2,workOrder:wo,employeeName:'Operator',state:'KITTING_IN_PROGRESS',poTraceabilityRequired:true,header:{workOrder:wo,billNumber:'GENERIC-ASM',revision:'B',scheduledProduction:10,unitOfMeasure:'EA'},assemblyInstructions:[],groups:Array.from({length:12},(_,i)=>({groupId:'G'+(i+1),sequence:String((i+1)*10).padStart(3,'0'),findNumber:i+1,primaryPart:{sequence:String((i+1)*10),itemNumber:'PART-'+(i+1),description:'Part '+(i+1)},relatedParts:[],messageRows:[],sourceSequences:[String((i+1)*10)],partNumber:'PART-'+(i+1),eligibleParts:['PART-'+(i+1)],references:['R'+(i+1)],notes:[],description:'Part '+(i+1),requiredEach:i===0?.001:2,requiredQuantity:i===0?.01:20,unitOfMeasure:'EA',classification:i===0?'FRACTIONAL':'STANDARD',actionable:true,entry:null,rowState:'EDITING',revisionNumber:0}))};
const persistent={record:null,calls:[],failSave:false};
const copy=x=>structuredClone(x);
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}

async function load({supply=null,environment='SIMULATION',record=persistent.record,supported=true,canEdit=true,canAmend=true,amendPermission=true}={}){
  if(record)persistent.record=copy(record);
  const elements=new Map(), events=new Map();
  const ids=['workOrderDashboardReleasedBom','workOrderDashboardKitReleasedBom','workOrderDashboardReleasedBomLabel','workOrderDashboardReleasedBomMessage','workOrderDashboardKitReleasedBomLabel','workOrderDashboardKitReleasedBomMessage','workOrderDashboardKittingCaseSummary','workOrderDashboardActiveKitting','activeKittingTrialBody','activeKittingTrialStatus','activeKittingFocusedIdentity','activeKittingSave','activeKittingSaveExit','activeKittingPoTraceability','kittingJobWorkspace','activeKittingResultDialog','activeKittingPoTraceabilityAmended','kittingJobPoTraceability','kittingJobPoTraceabilityAmended','activeKittingAmendPoTraceability','activeKittingPoAmendmentDialog','activeKittingPoAmendmentWorkOrder','activeKittingPoAmendmentCurrent','activeKittingPoAmendmentValue','activeKittingPoAmendmentReason','activeKittingPoAmendmentApply','activeKittingPoAmendmentCancel','activeKittingPoAmendmentError'];
  for(const id of ids)elements.set(id,{innerHTML:'',textContent:'',dataset:{},value:'',classList:{contains:()=>true,add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){this.innerHTML='';},showModal(){this.open=true;},close(){this.open=false;},scrollIntoView(){},focus(){}});
  const api={
    async getKittingCase(target){persistent.calls.push(['GET',target]);const snapshot=copy(persistent.record);if(persistent.getBarrier)await persistent.getBarrier;return {kittingCase:snapshot,capabilities:environment==='SIMULATION'?{supported,canEdit,canAmendPoTraceability:canAmend}:undefined};},
    async getKittingCaseSubmissions(target){persistent.calls.push(['HISTORY',target]);return {submissions:[]};},
    async getKittingReleasedRequirements(target){persistent.calls.push(['PROVIDER',target]);return {supported:true,canEdit:true,releasedBomIdentity:'release-v1',draft:copy(fixture)};},
    async startKittingCase(target,request){persistent.calls.push(['START',target,copy(request)]);assert.equal(request.draft,undefined);persistent.record={caseId:'case-one',workOrderNumber:target,state:'KITTING_IN_PROGRESS',workingVersion:1,releasedBomIdentity:'release-v1',isEditing:true,editingOwner:'Operator',editingSessionId:'lease-one',poTraceabilityRequired:true,canAmendPoTraceability:canAmend,completedCount:0,actionableCount:12,draft:copy(fixture)};return copy(persistent.record);},
    async resumeKittingCase(target,request){persistent.calls.push(['RESUME',target,copy(request)]);assert.equal(request.expectedWorkingVersion,persistent.record.workingVersion);persistent.record={...persistent.record,isEditing:true,editingOwner:'Operator',editingSessionId:'lease-next',workingVersion:persistent.record.workingVersion+1};return copy(persistent.record);},
    async amendKittingCasePoTraceability(target,request){
      persistent.calls.push(['AMEND',target,copy(request)]);
      if(persistent.amendBarrier)await persistent.amendBarrier;
      if(persistent.amendFailure)throw persistent.amendFailure;
      assert.equal(request.caseId,persistent.record.caseId);
      assert.equal(request.expectedWorkingVersion,persistent.record.workingVersion);
      assert.equal(request.editingSessionId,persistent.record.editingSessionId);
      persistent.record={...persistent.record,workingVersion:persistent.record.workingVersion+1,
        originalPoTraceabilityRequired:persistent.record.draft.poTraceabilityRequired,
        poTraceabilityRequired:request.poTraceabilityRequired,
        poTraceabilityAmendment:{kind:'REVIEWED_AMENDMENT',previousEffectiveRequired:persistent.record.poTraceabilityRequired,newEffectiveRequired:request.poTraceabilityRequired,reason:request.reason,actor:'Reviewer',atUtc:'2026-09-23T10:00:00Z'}};
      return copy(persistent.record);
    },
    async saveKittingCaseDraft(target,request){return save(target,request,false);},
    async saveAndExitKittingCase(target,request){return save(target,request,true);}
  };
  async function save(target,request,release){persistent.calls.push([release?'EXIT':'SAVE',target,copy(request)]);if(persistent.saveBarrier)await persistent.saveBarrier;if(persistent.failSave)throw new Error('Isolated storage failure');assert.equal(request.expectedWorkingVersion,persistent.record.workingVersion);assert.equal(request.editingSessionId,persistent.record.editingSessionId);const draft=copy(request.draft);for(const group of draft.groups)if(group.rowState==='SUBMITTED')group.lastSubmittedBy='Server audit';persistent.record={...persistent.record,workingVersion:persistent.record.workingVersion+1,draft,isEditing:!release,editingSessionId:release?null:persistent.record.editingSessionId};return copy(persistent.record);}
  const timers=new Map();let timerId=0;
  const window={DleOsRuntimeConfig:{environment},DleOsCapabilities:{can:p=>p!=='kitting.traceability.amend'||amendPermission},DleOsSession:{user:{userName:'Operator',displayName:'Operator'}},DleApiClient:api,location:{pathname:'/',search:'',hash:'',href:'http://localhost/'},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),addEventListener(){},KittingJobWorkspace:{setPresentationMode(){},setPrimaryTool(){},render(){},refreshPrimaryToolPresentation(){}},MaterialStatus:{getSupplyProgress:async()=>copy(supply),normalizeWorkOrderNumber:v=>String(v).padStart(7,'0'),get:async()=>({machineValue:'NEEDS_KITTING'}),publish:(_wo,r)=>({machineValue:r.state})},open:()=>({document:{open(){},write(html){window.report=html;},close(){}},location:{}})};
  const context=vm.createContext({window,document:{addEventListener:(name,fn)=>events.set(name,fn),getElementById:id=>elements.get(id)||null,querySelectorAll:()=>[],querySelector:()=>null,visibilityState:'visible'},structuredClone,Intl,Date,CSS:{escape:String},requestAnimationFrame:()=>{},fetch:async()=>({ok:true,json:async()=>({})})});
  for(const script of ['SRC/shared/kitting-quantity.js','SRC/modules/work-order-dashboard/kitting-bag-label.js','SRC/modules/work-order-dashboard/active-kitting-trial.js'])vm.runInContext(read(script),context);
  vm.runInContext(controller,context);
  window.WorkOrderDashboardModule.initialize();
  window.WorkOrderDashboardModule.setSelectedWorkOrder({workOrderNumber:wo,canonicalWorkOrder:{workOrderNumber:wo,itemNumber:'GENERIC-ASM',schProdQuantity:10},originCustomerNumber:'990001',originSalesOrderNumber:'0088888',originSalesOrderLine:'020',preferredPresentation:'kitting-job',governingSource:'EXACT'});
  await flush();
  return {window,elements,context,events};
}


export { read, controller, simShell, wo, fixture, persistent, copy, flush, load };

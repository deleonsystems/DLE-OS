import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const source = fs.readFileSync(path.join(root, 'SRC/workspaces/purchasing/purchasing-buyer-workspace.js'), 'utf8');
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
const clone = value => JSON.parse(JSON.stringify(value));
const originalDemand = { demandId:'demand-5',version:0,state:'INCOMING',sourceCurrent:true,caseId:'case',submissionId:'submission',findNumber:'5',partNumber:'SIM-OPTO-4',approvedPartNumber:'SIM-OPTO-4',description:'Phototransistor optocoupler, SMD-4',requiredQuantity:20,kittedQuantity:12,shortQuantity:8,uom:'EA',workOrderNumber:'0999999',salesOrderNumber:'0099999',salesOrderLineNumber:'010',customer:'DLE-SIM-CUSTOMER',assemblyItemNumber:'SIM-ASSY-001',revision:'A',buildQuantity:10,customerDueDate:'2026-10-14',materialNeedBy:'',qualityRequirements:{poTraceabilityRequired:false,originalPoTraceabilityRequired:true,traceabilityAmendmentId:'amendment',travelerRequired:true} };
let model={canManage:true,demands:[clone(originalDemand)],plans:[],purchases:[]},history=[],calls=[],failNext=false;
const submitted={draft:{groups:Array.from({length:12},(_,i)=>({sequence:String(i+1),partNumber:i===4?'SIM-OPTO-4':'SIM-'+i,description:'Released requirement '+i,requiredQuantity:i===4?20:10,entry:{pickedQuantity:i===4?12:10,shortageQuantity:i===4?8:0,result:i===4?'COUNTED_SHORT':'COUNTED'}}))}};
submitted.draft.groups[0].entry={pickedQuantity:null,shortageQuantity:null,result:'COMPLETE'};
const submissionBefore=JSON.stringify(submitted), demandEvidence=JSON.stringify(originalDemand);
class Node {
  constructor(){this.innerHTML='';this.textContent='';this.events={};this.disabled=false;this.classList={add(){}};}
  addEventListener(type,handler){this.events[type]=handler;}
  setAttribute(){} scrollIntoView(){} showModal(){this.open=true;} close(){this.open=false;}
  querySelector(selector){return elements.get(selector) || null;}
  querySelectorAll(selector){return selector==='fieldset'?[fieldset]:selector==='button'?[formButton]:[];}
}
const elements=new Map(),mount=new Node(),workspace=new Node(),fieldset=new Node(),formButton=new Node();
for(const name of ['#buyerRows','#buyerDetails','#buyerBomDialog','#buyerBomContent','.buyer-status'])elements.set(name,new Node());
elements.set('.buyer-workspace',workspace);
class FakeFormData {constructor(form){this.fields=form.fields;} get(key){return this.fields.get(key)??null;} entries(){return this.fields.entries();}}
const planning={workOrders:[{workOrderNumber:'0999999',demands:[{demandId:'demand-5',workOrderNumber:'0999999',schedule:{customerDueDate:'2026-10-14',materialNeedBy:'2026-10-09',lead:{value:3,unit:'DAYS'}},orders:[{purchaseId:'purchase-one',expectedDate:'2026-10-07',risk:{bufferWorkingDays:2,status:'On Time'}}]}]}]};
const window={MaterialStatus:{getSupplyProgress:async()=>clone(planning)},crypto:{randomUUID},confirm:()=>true,fetch:async(url,options={})=>{
  const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
  calls.push({url,method,body});
  const response=(data,status=200)=>({ok:status===200,status,headers:{get:()=> 'application/json'},json:async()=>clone(data)});
  if(failNext&&method!=='GET'){failNext=false;return response({message:'Buying plan changed on another session.'},409);}
  if(method==='GET'){
    if(url.endsWith('/history'))return response(history);
    if(url.endsWith('/kitted-bom'))return response({workOrderNumber:'0999999',snapshot:submitted});
    return response(model);
  }
  check(typeof body.requestId==='string'&&body.requestId.length===36,'Every command has request identity');
  if(url.endsWith('/accept')){check(body.expectedVersion===0,'Accept carries expected demand version');Object.assign(model.demands[0],{version:1,state:'ACCEPTED',acceptedBy:'Test Buyer'});return response(model.demands[0]);}
  if(url.endsWith('/plans')&&method==='POST'){
    const plan={...body,planId:'plan-one',version:1,state:'DRAFT',partNumber:'SIM-OPTO-4',approvedPartNumber:'SIM-OPTO-4',description:originalDemand.description,extendedCost:body.buyQuantity*body.unitCost,excessQuantity:body.buyQuantity-body.coverage.reduce((sum,c)=>sum+c.quantity,0)};
    model.plans.push(plan);return response(plan);
  }
  if(url.endsWith('/ready')){check(body.expectedVersion===1,'Ready uses saved plan version');Object.assign(model.plans[0],{version:2,state:'READY_FOR_PO'});return response(model.plans[0]);}
  if(url.endsWith('/purchase')){
    check(body.expectedVersion===2,'Purchase uses ready plan version');const p=model.plans[0];
    const purchase={...p,...body,purchaseId:'purchase-one',orderedQuantity:p.buyQuantity,receivedQuantity:0,openQuantity:p.buyQuantity,provenance:'SIMULATED_DEVELOPMENTAL'};
    model.purchases.push(purchase);Object.assign(p,{version:3,state:'ORDERED'});return response(purchase);
  }
  throw new Error('Unexpected command '+method+' '+url);
}};
vm.runInNewContext(source,{window,document:{},console,Map,Intl,Number,String,Object,Array,JSON,FormData:FakeFormData});
const app=window.SimPurchasingWorkspace;
function html(selector){return elements.get(selector).innerHTML;}
async function click(action,id=''){
  const control={dataset:{buyerAction:action,id},disabled:false};
  await workspace.events.click({target:{closest:selector=>selector==='[data-buyer-action]'?control:null}});
}
function stage(name){return workspace.events.click({target:{closest:selector=>selector==='[data-buyer-stage]'?{dataset:{buyerStage:name}}:null}});}
function form(id,fields){const item=new Node();item.id=id;item.fields=new Map(Object.entries(fields));item.matches=()=>true;item.reportValidity=()=>true;elements.set('form',item);return item;}
async function submit(item){await workspace.events.submit({target:item,preventDefault(){}});}

await app.render(mount);
check(calls.every(c=>c.method==='GET'),'Opening Purchasing is read-only');
check(html('#buyerRows').includes('SIM-OPTO-4')&&html('#buyerRows').includes('10/14/2026'),'Incoming shortage shows part and authoritative date');
check(html('#buyerRows').includes('>20</td>')&&html('#buyerRows').includes('>12</td>')&&html('#buyerRows').includes('>8</td>'),'Required, counted, shortage remain separate');
check(!html('#buyerRows').includes('Build Qty'),'Build quantity does not occupy buying quantity columns');
check(app.formatDate('2026-10-14')==='10/14/2026'&&app.formatDate('')==='Not Established','Date-only formatting and missing-date truth');
await click('bom','demand-5');
check(elements.get('#buyerBomDialog').open===true,'BOM opens read-only dialog');
check(html('#buyerBomContent').includes('COUNTED SHORT')&&html('#buyerBomContent').includes('>12</td>'),'BOM uses immutable submitted entry results');
check(html('#buyerBomContent').includes('>Complete</td>')&&html('#buyerBomContent').includes('>—</td>'),'Complete disposition does not fabricate count zero from null');
check(JSON.stringify(submitted)===submissionBefore,'BOM reference has no mutation');
await click('bom-close');
await click('accept','demand-5');
check(model.demands[0].state==='ACCEPTED'&&html('#buyerRows').includes('Create Buying Plan'),'Accepted demand enters Sorting');
await click('create','demand-5');
check(html('#buyerDetails').includes('name="buyQuantity" type="number" value="8"'),'Buy quantity defaults to shortage, not build quantity10 or required20');
check(html('#buyerDetails').includes('name="expectedDate" type="date" value=""'),'Expected date is not silently copied from customer due');
check(html('#buyerDetails').includes('10/09/2026')&&html('#buyerDetails').includes('3 Days'),'Frozen manufacturing planning shown on plan');
check(!html('#buyerDetails').includes('name="materialNeedBy"'),'Need-by cannot be edited by buyer');
const fields={supplier:'DLE-SIM-SUPPLIER',vendorPartNumber:'SIM-OPTO-4',buyQuantity:'8',purchasingUom:'EA',unitCost:'0.50',currency:'USD',requestedDate:'2026-10-05',expectedDate:'2026-10-07',materialNeedBy:'',notes:'SIM scenario dates',excessPurpose:'','coverage-demand-5':'8'};
await submit(form('buyerPlanForm',fields));
check(model.plans[0].buyQuantity===8&&model.plans[0].coverage[0].quantity===8&&model.plans[0].coverage[0].expectedDemandVersion===1,'Plan carries buy quantity and versioned coverage separately');
check(model.demands[0].shortQuantity===8&&model.demands[0].requiredQuantity===20,'Plan does not rewrite shortage evidence');
await click('ready','plan-one');
check(html('#buyerRows').includes('Ready for PO')&&model.plans.length===1,'Shop List projects ready plan without copying it');
await click('record','plan-one');
check(html('#buyerDetails').includes('SIM-only developmental evidence'),'Purchase boundary clearly synthetic');
await submit(form('buyerPurchaseForm',{poNumber:'SIM-PO-0001',poLine:'010',orderDate:'2026-09-23',confirmation:'SIM-CONF-1',notes:'Developmental only'}));
check(html('#buyerRows').includes('Ordered / Awaiting Receipt')&&html('#buyerRows').includes('SIM-PO-0001'),'Purchased shows recorded PO awaiting receipt');
check(model.purchases[0].receivedQuantity===0&&model.purchases[0].openQuantity===8,'Purchasing never fabricates receipt');
check(model.plans.length===1&&model.demands.length===1&&model.purchases.length===1,'One demand, one plan, one purchase after flow');
await click('purchase','purchase-one');
check(html('#buyerDetails').includes('Customer Due')&&html('#buyerDetails').includes('10/14/2026'),'Purchase retains job due date and coverage');
check(html('#buyerDetails').includes('2 working days')&&html('#buyerDetails').includes('On Time')&&html('#buyerDetails').includes('10/09/2026'),'Purchase shows derived need-by, buffer and status');
check(calls.filter(c=>c.method!=='GET').length===4,'Exactly Accept, Save Plan, Ready, Record commands');
check(calls.every(c=>!/(kitting-cases|receipts|rfqs|canonical)/.test(c.url)),'No unrelated execution endpoints');

// Grouped plans and residual demand are projection cases, not live scenario expansion.
const residual=app.buildViewModel({demands:[{...originalDemand,state:'ACCEPTED'}],plans:[{state:'DRAFT',coverage:[{demandId:'demand-5',quantity:4}]}],purchases:[]});
check(residual.sorting.length===2&&residual.sorting[0].uncoveredQuantity===4&&residual.sorting[0].shortQuantity===8,'Partially planned demand remains visible; source short8 unchanged');
const grouped={plans:[{state:'READY_FOR_PO',coverage:[{demandId:'a',quantity:8},{demandId:'b',quantity:5}]}],demands:[{...originalDemand,demandId:'a',state:'ACCEPTED'},{...originalDemand,demandId:'b',workOrderNumber:'WO-B',shortQuantity:5,state:'ACCEPTED'}],purchases:[]};
check(app.buildViewModel(grouped,'WO-B').shop.length===1,'Grouped plan remains one record and is searchable by second WO');
check(app.buildViewModel(grouped).sorting.length===0,'Fully covered grouped demands do not duplicate Sorting');

// Reopen an isolated draft to ensure conflicts do not silently refresh away edits.
model={canManage:true,demands:[{...originalDemand,state:'ACCEPTED',version:1}],plans:[{...model.plans[0],state:'DRAFT',version:4}],purchases:[]};
await app.refresh();await stage('sorting');await click('plan','plan-one');
const edited=form('buyerPlanForm',{...fields,notes:'Unsaved evidence must remain'});failNext=true;
const countBefore=calls.length;await submit(edited);
check(calls.length===countBefore+1&&elements.get('.buyer-status').textContent.includes('Refresh'),'Conflict has no auto-retry or silent refresh');
check(edited.fields.get('notes')==='Unsaved evidence must remain'&&!fieldset.disabled,'Conflict retains input and enables user review');
model.canManage=false;await app.refresh();await stage('sorting');await click('plan','plan-one');
check(html('#buyerDetails').includes('<fieldset disabled>'),'Server readonly permission disables editing');
const writeCount=calls.filter(c=>c.method!=='GET').length;await submit(form('buyerPlanForm',fields));
check(calls.filter(c=>c.method!=='GET').length===writeCount,'Read-only persona cannot send commands');
check(JSON.stringify(originalDemand)===demandEvidence&&JSON.stringify(submitted)===submissionBefore,'UI preserved source fixture truth');
// Current outcome is separate from the immutable original shortage and purchase.
const historyPurchase={purchaseId:'purchase-one',poNumber:'SIM-PO-0001',poLine:'010',partNumber:'SIM-OPTO-4',purchasingUom:'EA',orderedQuantity:8,receivedQuantity:8,openQuantity:0,coverage:[{demandId:'demand-5',quantity:8}]};
model={canManage:true,demands:[{...originalDemand,state:'RESOLVED',sourceCurrent:false,remainingShortQuantity:0}],plans:[],purchases:[historyPurchase]};
Object.assign(planning.workOrders[0].demands[0],{materialStatus:'KIT_COMPLETE',progress:'Kit Complete',resolved:true});
planning.workOrders[0].demands[0].orders[0].appliedQuantity=8;
const commandsBefore=calls.filter(c=>c.method!=='GET').length;
await app.refresh();await stage('purchased');await click('purchase','purchase-one');
check(html('#buyerRows').includes('Received / Complete')&&html('#buyerRows').includes('Applied to Kit 8 EA')&&html('#buyerRows').includes('Kit Complete'),'Purchased history distinguishes receipt completion, application and WO outcome');
check(!html('#buyerDetails').includes('Awaiting Receipt')&&!html('#buyerDetails').includes('remain Kit Short')&&!html('#buyerDetails').includes('No physical receipt'),'Purchase detail has no stale action assertions');
check(app.buildViewModel(model).shortages.length===0&&app.buildViewModel(model).purchased.length===1,'Resolved demand leaves active buying and preserves purchase history');
check(app.purchaseStatus({...historyPurchase,receivedQuantity:3,openQuantity:5})==='Partially Received','Partial receipt is not complete');
check(app.purchaseStatus({...historyPurchase,receivedQuantity:0,openQuantity:8})==='Ordered / Awaiting Receipt','Ordered phase retains expected action');
planning.workOrders[0].demands[0].materialStatus='KIT_SHORT';planning.workOrders[0].demands[0].progress='Re-Kit Applied · Submission Required';
await app.refresh();await stage('purchased');
check(html('#buyerRows').includes('Submission Required')&&!html('#buyerRows').includes('Kit Complete'),'Applied before successor never grants readiness');
check(calls.filter(c=>c.method!=='GET').length===commandsBefore,'History reconciliation rendering sends no mutation');
console.log(`SIM Purchasing UI: ${assertions} checks PASS (isolated fake API; no live state changed)`);

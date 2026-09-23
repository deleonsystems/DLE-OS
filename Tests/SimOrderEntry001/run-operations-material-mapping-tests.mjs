import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const checks=[];
function check(condition,label){assert.ok(condition,label);checks.push(label);}
function row(index,overrides={}){
  const so=String(9900000+index),wo=String(9900000+index);
  return {salesOrderLineId:'990901'+so+'010',customerNumber:'990901',customerName:'Synthetic customer',
    customerPurchaseOrderNumber:'SIM-PO-'+index,salesOrderNumber:so,lineNumber:'010',itemNumber:'SIM-ASSY',
    orderDate:'2026-09-23',customerPoDate:'2026-09-22',customerDueDate:'2026-10-14',estimatedShipDate:'',
    quantityOrdered:10,erpQuantityOpen:10,unitPrice:70.64,extendedPrice:706.4,
    rmaReworkMembership:null,workOrderApprovalReview:null,materialStatus:null,materialStatusWorkOrderNumber:wo,
    ...overrides};
}
function relationship(source,status='EXACT_LINE_UNIQUE'){
  const actionable=status==='EXACT_LINE_UNIQUE'?source.salesOrderNumber:null;
  return {customerNumber:source.customerNumber,salesOrderNumber:source.salesOrderNumber,salesOrderLineNumber:source.lineNumber,
    salesOrderItemNumber:source.itemNumber,resolutionStatus:status,actionableWorkOrderNumber:actionable,
    candidateCount:1,candidates:[{workOrderNumber:source.salesOrderNumber,itemNumber:source.itemNumber}]};
}
function page(items){return {page:1,totalItems:items.length,totalPages:items.length?1:0,hasNextPage:false,items:structuredClone(items)};}
function setup(rows,relationships,fetchCase=async()=>({kittingCase:null,hasPersistentKittingHistory:false})){
  const reads=[];
  const context=vm.createContext({console,structuredClone,AbortController,DOMException,
    window:{DleApiClient:{liveCanonical:{
      async getCanonicalSalesOrders(){return page(rows);},
      async getCanonicalSalesOrderWorkOrderRelationships(){return page(relationships);}
    },async getKittingCase(wo){reads.push(wo);return fetchCase(wo);}}}});
  for(const filename of ['SRC/shared/material-status.js','SRC/modules/operations-center/operations-center-data-service.js',
    'SRC/modules/operations-center/operations-center-view-model.js','SRC/modules/operations-center/operations-center-fields.js'])
    vm.runInContext(fs.readFileSync(path.join(root,filename),'utf8'),context,{filename});
  return {context,reads,api:context.window.OperationsCenter.dataService,view:context.window.OperationsCenter.viewModel};
}
function existingStatus(index,state,label){return {workOrderNumber:String(9900000+index),machineValue:state,label,
  source:'KITTING_CASE',kittingCase:{state,runNumber:2,workingVersion:3},hasPersistentKittingHistory:true};}
const rows=[
  row(1),
  row(2,{materialStatus:existingStatus(2,'KIT_SHORT','Kit Short')}),
  row(3,{materialStatus:existingStatus(3,'KIT_COMPLETE','Kit Complete')}),
  row(4,{materialStatus:existingStatus(4,'KITTING_IN_PROGRESS','Kitting In Progress')}),
  row(5), // candidate-only relationship despite an explicit key
  row(6,{erpQuantityOpen:0}),
  row(7,{quantityOrdered:-10}),
  row(8,{materialStatusWorkOrderNumber:''}),
  row(9,{materialStatusWorkOrderNumber:'9990001'}),
  row(10,{workOrderApprovalReview:{operationalRelationship:{operationalRoute:'RMA_REWORK'}}}),
  row(11,{rmaReworkMembership:{caseId:'SIM-RMA-1',caseStatus:'ACTIVE'}}),
  row(12,{workOrderApprovalReview:{operationalRelationship:{operationalRoute:'DIRECT_FULFILLMENT',operationalStatus:'NO_WORK_ORDER_REQUIRED'}}})
];
const relationships=rows.map((source,index)=>relationship(source,index===4?'SALES_ORDER_ITEM_UNIQUE_CANDIDATE':'EXACT_LINE_UNIQUE'));
const before=JSON.stringify(rows), h=setup(rows,relationships);
const canonical=await h.api.loadCanonicalRows();
const enriched=await h.api.loadOperationalEnrichment(canonical);
check(enriched.rows.length===12,'Enrichment retains every canonical line');
check(h.reads.length===1 && h.reads[0]==='9900001','Only exact/open/positive/no-case row with matching authoritative key is fetched');
const material=enriched.rows[0].materialStatus;
check(material.machineValue==='NEEDS_KITTING' && material.label==='Needs Kitting','Shared no-case projection returns existing Needs Kitting state');
check(material.source==='KITTING_ELIGIBILITY' && material.kittingCase===null && material.hasPersistentKittingHistory===false,
  'Material default is eligibility projection, not a fabricated case/history');
for(let index=1;index<=3;index++)
  check(JSON.stringify(enriched.rows[index].materialStatus)===JSON.stringify(rows[index].materialStatus),
    'Existing '+rows[index].materialStatus.label+' projection is preserved');
for(let index=4;index<rows.length;index++)
  check(enriched.rows[index].materialStatus===null,'Ineligible or unverified row '+(index+1)+' remains unprojected');
check(JSON.stringify(rows)===before,'Read projection does not mutate source API records');

const target=enriched.rows[0];
check(target.customerPoDate==='2026-09-22' && target.customerDueDate==='2026-10-14','Canonical date normalization retains both contractual dates');
check(target.orderDate==='2026-09-23' && target.estimatedShipDate==='','ERP order date remains separate and estimated ship stays unset');
check(h.view.getOfficialField(target,'poDate')==='09/22/2026','PO Date displays MM/DD/YYYY');
check(h.view.getOfficialField(target,'customerDueDate')==='10/14/2026','Customer Due Date displays MM/DD/YYYY');
check(h.view.getOfficialField(target,'orderDate')==='09/23/2026','ERP Order Date displays its distinct date');
check(h.view.getOfficialField(target,'dueDate')==='Not set','Unset estimated ship date is explicit');
check(h.view.getOfficialField(target,'materialStatus')==='Needs Kitting','Operations displays the shared Kitting state');
contextDateCheck(h.context,h.view,target);
function contextDateCheck(context,view,target){
  const original=context.Date;
  context.Date=class {constructor(){throw new Error('Date-only presentation must not instantiate Date.');}};
  check(view.getOfficialField(target,'poDate')==='09/22/2026' && view.getOfficialField(target,'customerDueDate')==='10/14/2026',
    'Contractual date presentation performs no Date/timezone conversion');
  context.Date=original;
}
const columns=h.context.window.OperationsCenter.officialColumns;
check(columns.find(column=>column.key==='orderDate')?.label==='ERP Order Date','ERP date column is explicitly named');
check(columns.find(column=>column.key==='poDate')?.label==='PO Date' &&
  columns.find(column=>column.key==='customerDueDate')?.label==='Customer Due Date' &&
  columns.find(column=>column.key==='dueDate')?.label==='Estimated Ship Date','Contractual and planning dates have separate columns');

const planned=row(20,{estimatedShipDate:'2026-10-12'}),plannedHarness=setup([planned],[relationship(planned)]);
const plannedResult=await plannedHarness.api.loadCanonicalRows();
check(plannedHarness.view.getOfficialField(plannedResult.rows[0],'dueDate')==='10/12/2026' &&
  plannedHarness.view.getOfficialField(plannedResult.rows[0],'customerDueDate')==='10/14/2026',
  'An explicit estimated ship date displays independently of contractual due date');
const legacy=row(21,{customerPoDate:undefined,customerDueDate:undefined}),legacyHarness=setup([legacy],[relationship(legacy)]);
const legacyResult=await legacyHarness.api.loadCanonicalRows();
check(legacyHarness.view.getOfficialField(legacyResult.rows[0],'poDate')==='Not set' &&
  legacyHarness.view.getOfficialField(legacyResult.rows[0],'customerDueDate')==='Not set','Older rows remain valid with explicit unset contractual dates');

const unavailable=row(22),failure=setup([unavailable],[relationship(unavailable)],async()=>{throw new Error('SIM read unavailable');});
const unavailableCanonical=await failure.api.loadCanonicalRows();
await assert.rejects(()=>failure.api.loadOperationalEnrichment(unavailableCanonical),/SIM read unavailable/);
check(unavailableCanonical.rows[0].materialStatus===null && unavailable.materialStatus===null,
  'Read failure surfaces without inventing a material state');
check(failure.reads.length===1,'Unavailable authoritative no-case endpoint is attempted once');

console.log(JSON.stringify({verdict:'PASS',checks:checks.length,checkDescriptions:checks},null,2));

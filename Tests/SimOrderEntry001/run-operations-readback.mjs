// Read-only replay of captured normal SIM API responses through the real consumers.
// Usage: node Tests/SimOrderEntry001/run-operations-readback.mjs <responses.json>
// Required keys: salesOrders, relationships, workOrders (API page or array of API
// pages), verifiedStatuses, workOrderVerifiedStatuses ({records:[]}), and
// shipmentStaging ({records:[]}). Optional kittingCases maps WO to its GET response
// or {httpStatus:404,body:{...}}. Nothing is fetched or written by this script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.argv[2]) throw new Error('Supply the captured API response JSON path.');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const expected = {customerNumber:'990901', customerName:'DLE-SIM-CUSTOMER',
  purchaseOrder:'SIM-E2E-001-PO', itemNumber:'SIM-ASSY-001', revision:'A',
  quantity:10, unitPrice:70.64, extendedPrice:706.4, customerPoDate:'2026-09-22', customerDueDate:'2026-10-14',
  ...fixture.expected};
for (const key of ['salesOrderNumber', 'lineNumber', 'workOrderNumber'])
  assert.equal(typeof expected[key], 'string', `expected.${key} must retain string identity`);
const checks = [];
function check(condition, description) { assert.ok(condition, description); checks.push(description); }
function records(name) {
  assert.ok(Array.isArray(fixture[name]?.records), `${name}.records must be a captured response`);
  return fixture[name].records;
}
function pageRows(name) {
  const pages = Array.isArray(fixture[name]) ? fixture[name] : [fixture[name]];
  assert.ok(pages.length && pages.every(p => Array.isArray(p?.items)), `${name}: capture API pages`);
  const total = pages[0].totalItems;
  assert.ok(pages.every(p => p.totalItems === total), `${name}: total must be stable`);
  const rows = pages.flatMap(p => p.items);
  assert.equal(rows.length, total, `${name}: capture every page, not a partial snapshot`);
  assert.ok(pages.every(p => p.environment === 'SIM'), `${name}: SIM responses only`);
  return rows;
}
const sales = pageRows('salesOrders'), relationships = pageRows('relationships'), workOrders = pageRows('workOrders');
const lineStatuses = records('verifiedStatuses'), woStatuses = records('workOrderVerifiedStatuses');
const shipments = records('shipmentStaging');
const originals = JSON.stringify(fixture);
const calls = [];
function page(items, request = {}) {
  const current = request.page || 1, size = request.pageSize || 200;
  const totalPages = Math.ceil(items.length / size);
  return {page:current, pageSize:size, totalItems:items.length, totalPages,
    hasNextPage:current < totalPages, hasPreviousPage:current > 1,
    items:structuredClone(items.slice((current-1)*size,current*size)), environment:'SIM'};
}
function runModule(context, relative) {
  vm.runInContext(fs.readFileSync(path.join(root,relative),'utf8'),context,{filename:relative});
}
function createContext(salesRows = sales, relationRows = relationships, woRows = workOrders) {
  const window = {shipmentStagingState:{records:structuredClone(shipments)},
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){},
    DleApiClient:{liveCanonical:{
      async getCanonicalSalesOrders(request) {calls.push('GET sales-orders');return page(salesRows,request);},
      async getCanonicalSalesOrderWorkOrderRelationships(request) {calls.push('GET relationships');return page(relationRows,request);},
      async getCanonicalWorkOrders(request) {
        calls.push('GET work-orders');
        return page(woRows.filter(wo => !request.workOrderNumber || wo.workOrderNumber === request.workOrderNumber),request);
      }
    }, async getKittingCase(workOrderNumber) {
      calls.push('GET kitting-case');
      const response = fixture.kittingCases?.[workOrderNumber];
      if (!response) throw new Error(`No captured Kitting GET response for ${workOrderNumber}`);
      if (response.httpStatus >= 400) throw new Error(`Kitting GET ${workOrderNumber}: HTTP ${response.httpStatus}; ${response.body?.message || ''}`);
      return structuredClone(response.body || response);
    }}};
  const context = vm.createContext({window,console,structuredClone,AbortController,DOMException,
    document:{querySelector(){return null;},getElementById(){return null;},addEventListener(){}}});
  for(const file of [
    'SRC/modules/operations-center/operations-center-state.js',
    'SRC/shared/material-status.js',
    'SRC/modules/shipment-staging/shipment-operational-projection.js',
    'SRC/modules/operations-center/operations-center-data-service.js',
    'SRC/modules/operations-center/operations-center-view-model.js',
    'SRC/workspaces/kitting/kitting-read-model.js',
    'SRC/workspaces/kitting/kitting-workspace.js'
  ]) runModule(context,file);
  return context;
}

const context=createContext(), operations=context.window.OperationsCenter;
const requestId=operations.stateActions.beginCanonicalLoad();
const canonical=await operations.dataService.loadCanonicalRows();
check(operations.stateActions.commitCanonicalLoad(canonical,requestId),'Normal Operations canonical loader commits successfully');
const enriched=await operations.dataService.loadOperationalEnrichment(canonical);
check(operations.stateActions.commitOperationalEnrichment(enriched,requestId),'Normal Operations enrichment accepts actual SIM projections');
operations.stateActions.setVerifiedStatusRecords(lineStatuses,woStatuses);
const view=operations.viewModel;
const targetRows=view.getOperationsCenterRecords().filter(row => row.customerNumber===expected.customerNumber &&
  row.salesOrderNumber===expected.salesOrderNumber && row.salesOrderLineNumber===expected.lineNumber);
check(targetRows.length===1,'Exactly one E2E line is visible in the normal Operations read model');
const row=targetRows[0], raw=row.canonical;
for (const [field,value] of Object.entries({customerName:expected.customerName,customerPurchaseOrderNumber:expected.purchaseOrder,
  itemNumber:expected.itemNumber,quantityOrdered:expected.quantity,erpQuantityOpen:expected.quantity,
  unitPrice:expected.unitPrice,extendedPrice:expected.extendedPrice}))
  check(row[field]===value,`Operations ${field} matches accepted order`);
check(row.drawingRevision===expected.revision || row.bomRevision===expected.revision,'Assembly revision retained');
check(row.estimatedShipDate==='', 'Estimated ship date remains unset');
check(view.getOfficialField(row,'dueDate')==='Not set', 'Operations shows unset estimated ship date without substituting reviewed due date');
check(raw.customerPoDate===expected.customerPoDate,'Customer PO date retained separately in canonical context');
check(raw.customerDueDate===expected.customerDueDate,'Reviewed customer due date retained separately in canonical context');
check(view.getOfficialField(row,'poDate')==='09/22/2026','PO Date displays 09/22/2026');
check(view.getOfficialField(row,'customerDueDate')==='10/14/2026','Customer Due Date displays 10/14/2026');
check(view.getOfficialField(row,'materialStatus')==='Needs Kitting','Operations displays the shared Needs Kitting state');
check(row.workOrderRelationship.status==='EXACT_LINE_UNIQUE','Operations receives derived exact-line relationship');
const woPresentation=view.getWorkOrderPresentation(row);
check(woPresentation.actionable && woPresentation.label===expected.workOrderNumber,'Existing Work Order presentation is actionable');
check(workOrders.filter(wo=>wo.workOrderNumber===expected.workOrderNumber).length===1,'Exactly one matching canonical Work Order exists');
const shipment=view.getShipmentProjection(row);
check(shipment.operationalRemainingQuantity===expected.quantity && shipment.stagedQuantity===0,'Existing shipment projection leaves 10 operationally open and zero staged');
const verified=view.getVerifiedStatusPresentation(row);
check(!verified.unavailable,'Verified Status read is available');

// Calls the same workspace loader used by Kitting, including canonical WO lookup.
const model=await context.window.DleWorkspaces.kitting.loadReadModel();
const target=model.queues.needsKitting.filter(item=>item.workOrderNumber===expected.workOrderNumber);
check(target.length===1,'Existing Kitting queue naturally includes exactly one Needs Kitting row');
const kit=target[0];
check(kit.actionable && kit.governingSource==='EXACT','Kitting derives actionable exact authority');
check(kit.totalOperationalOpenQuantity===expected.quantity && kit.canonicalWorkOrderQuantity===expected.quantity,'Kitting open and scheduled quantities are 10');
check(kit.relatedOpenSalesOrderLineCount===1,'Kitting associates one order line with the Work Order');
check(kit.kittingCase===null,'No Kitting case is fabricated');
check(kit.materialStatusProjection.source==='KITTING_ELIGIBILITY','Needs Kitting derives from existing eligibility default');
check(model.counts.duplicatePrimaryQueueMembership===0,'Kitting does not duplicate queue membership');

// Prove the queue is governed: unavailable WO and candidate-only evidence block it.
const missingContext=createContext(sales,relationships,workOrders.filter(wo=>wo.workOrderNumber!==expected.workOrderNumber));
const missing=await missingContext.window.DleWorkspaces.kitting.loadReadModel();
check(!missing.queues.needsKitting.some(item=>item.workOrderNumber===expected.workOrderNumber),'A missing canonical WO cannot enter Needs Kitting');
check(missing.queues.needsResolution.some(item=>item.relatedLines.some(line=>line.lineKey===row.masterRecordKey) &&
  item.resolutionReason.includes('missing from the canonical')),'Missing canonical WO reports its real resolution gate');
const candidateRelationships=structuredClone(relationships);
const candidate=candidateRelationships.find(item=>item.customerNumber===expected.customerNumber &&
  item.salesOrderNumber===expected.salesOrderNumber && item.salesOrderLineNumber===expected.lineNumber);
candidate.resolutionStatus='SALES_ORDER_ITEM_UNIQUE_CANDIDATE';candidate.actionableWorkOrderNumber=null;
const candidateContext=createContext(sales,candidateRelationships,workOrders);
const candidateModel=await candidateContext.window.DleWorkspaces.kitting.loadReadModel();
check(!candidateModel.queues.needsKitting.some(item=>item.workOrderNumber===expected.workOrderNumber),'Candidate-only relationship cannot enter Needs Kitting');
check(candidateModel.queues.needsResolution.some(item=>item.relatedLines.some(line=>line.lineKey===row.masterRecordKey)),
  'Candidate-only relationship enters Needs Resolution');

let forcedRefresh={verified:false,reason:'Kitting GET captures were not supplied.'};
if(fixture.kittingCases) {
  try {
    const refreshed=await context.window.DleWorkspaces.kitting.loadReadModel({forceMaterialStatus:true});
    check(refreshed.queues.needsKitting.some(item=>item.workOrderNumber===expected.workOrderNumber),
      'Read-only forced material-status refresh retains the eligible row');
    forcedRefresh={verified:true};
  } catch(error) { forcedRefresh={verified:false,reason:error.message}; }
}
check(JSON.stringify(fixture)===originals,'Captured API evidence remained unchanged');
check(calls.every(call=>call.startsWith('GET ')),'Verification and negative cases use only read adapters');
console.log(JSON.stringify({verdict:'PASS',checks:checks.length,checkDescriptions:checks,
  source:'Captured normal SIM API responses, executed with actual Operations and Kitting source modules',
  operations:{salesOrderLineId:row.salesOrderLineId,customer:row.customerName,po:row.customerPurchaseOrderNumber,
    salesOrder:row.salesOrderNumber,line:row.salesOrderLineNumber,workOrder:woPresentation.label,
    assembly:row.itemNumber,revision:row.drawingRevision||row.bomRevision,ordered:row.quantityOrdered,
    erpOpen:row.erpQuantityOpen,operationalOpen:shipment.operationalRemainingQuantity,unitPrice:row.unitPrice,
    extendedPrice:row.extendedPrice,customerPoDate:raw.customerPoDate,customerDueDate:raw.customerDueDate,estimatedShipDate:row.estimatedShipDate||null,
    displayedErpOrderDate:view.getOfficialField(row,'orderDate'),displayedPoDate:view.getOfficialField(row,'poDate'),
    displayedCustomerDueDate:view.getOfficialField(row,'customerDueDate'),displayedEstimatedShipDate:view.getOfficialField(row,'dueDate'),
    relationshipStatus:woPresentation.status,verifiedStatus:verified.statusText||null,
    materialStatus:view.getOfficialField(row,'materialStatus')||null},
  kitting:{queue:kit.primaryQueue,label:kit.materialStatusLabel,source:kit.materialStatusProjection.source,
    workOrder:kit.workOrderNumber,relatedLines:kit.relatedOpenSalesOrderLineCount,kittingCase:kit.kittingCase,
    forcedRefresh},readAdapterCalls:calls.length},null,2));

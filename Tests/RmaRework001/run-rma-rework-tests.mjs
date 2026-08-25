import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sql = fs.readFileSync('Tools/RmaRework/Database/001_AddRmaReworkCase.sql', 'utf8');
const api = fs.readFileSync('Tools/LiveSnapshotRefresh/ControlHost/RmaReworkCenter.cs', 'utf8');
const dashboard = fs.readFileSync('SRC/modules/sales-order-dashboard/sales-order-dashboard.js', 'utf8');
const dashboardHtml = fs.readFileSync('SRC/modules/sales-order-dashboard/sales-order-dashboard.html', 'utf8');
const kitting = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.js', 'utf8');
const kittingHtml = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.html', 'utf8');
const kittingWorkspace = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.js', 'utf8');
const operationsDataService = fs.readFileSync('SRC/modules/operations-center/operations-center-data-service.js', 'utf8');
const operationsViewModel = fs.readFileSync('SRC/modules/operations-center/operations-center-view-model.js', 'utf8');
const operationsTable = fs.readFileSync('SRC/modules/operations-center/operations-center-table.js', 'utf8');

for (const type of ['RMA_RETURN_REPLACEMENT','CUSTOMER_REWORK','INTERNAL_REWORK','EVALUATION_REPAIR','OTHER']) {
  assert.match(sql, new RegExp(type));
  assert.match(api, new RegExp(type));
}
assert.match(sql, /UX_RmaReworkCaseMember_ActiveLine/);
assert.match(sql, /INSTEAD OF UPDATE, DELETE/);
assert.match(sql, /RMA\/Rework case events are append-only/);
assert.match(sql, /CaseStatus='ACTIVE'/);
assert.match(api, /case-candidates\/review/);
assert.match(api, /case-candidates\/match/);
assert.match(api, /cases\/\{caseId:guid\}\/members/);
assert.match(api, /CUSTOMER_RMA/);
assert.match(api, /INTERNAL_RMA/);
assert.match(api, /Regex\.Replace\(value\.Trim\(\), @"\\s\+", " "\)\.ToUpperInvariant/);
assert.match(api, /member\.Identity\.CustomerNumber/);
assert.match(api, /ambiguous_reference_match/);
assert.match(api, /case_type_mismatch/);
assert.match(api, /case_version_changed/);
assert.match(api, /active_case_membership_conflict/);
assert.match(api, /sp_getapplock/);
assert.match(api, /'LINE_ADDED'/);
assert.match(api, /ExpectedPriorEventId/);
assert.match(api, /sales-orders\/" \+ Uri\.EscapeDataString\(identity\.RecordId\)/);
assert.match(api, /mixed_customer_case/);
assert.match(api, /case_reference_required/);
assert.match(api, /active_case_membership_conflict/);
assert.match(api, /stale_case_evidence/);
assert.match(api, /Math\.Max\(erpOpen - pending, 0m\)/);
assert.match(api, /RequireAuthorization\(policy\)/);
assert.doesNotMatch(api, /UPDATE canonical\.|DELETE FROM canonical\.|OperationsOverlay/);

assert.match(dashboardHtml, /RMA \/ Rework Review/);
assert.match(dashboardHtml, /Select one or more rows, then choose Review on a selected row\./);
assert.match(dashboardHtml, /RMA \/ Rework Classification/);
assert.match(dashboardHtml, /Work Order Relationship Review/);
assert.match(dashboardHtml, /Current Classification/);
assert.match(dashboardHtml, /Customer RMA Number/);
assert.match(dashboardHtml, /Internal RMA Reference/);
const mainTable = dashboardHtml.match(/<table class="sales-order-dashboard-table">[\s\S]*?<\/table>/)?.[0] || '';
assert.doesNotMatch(mainTable, /<th>Classify<\/th>|<th>Sign<\/th>|<th>RMA \/ Rework Case<\/th>/);
assert.deepEqual(Array.from(mainTable.matchAll(/<th>/g)).length, 6);
assert.doesNotMatch(dashboardHtml, /salesOrderDashboardClassifyRmaButton|salesOrderDashboardReviewCandidateButton/);
assert.match(dashboard, /sales-order-dashboard-rma-badge/);
assert.match(dashboard, /dashboardState\.selectedWorkOrders\.includes\(row\)/);
assert.match(dashboard, /RMA \/ Rework Review \('\s*\+\s*available\.length/);
assert.match(dashboard, /sameSignOnly/);
assert.match(dashboard, /multipleSalesOrders/);
assert.match(dashboard, /reviewRmaReworkCaseMembers/);
assert.match(dashboard, /matchRmaReworkCase/);
assert.match(dashboard, /addRmaReworkCaseMember/);
assert.match(dashboard, /Review Reference Match/);
assert.match(dashboard, /ALREADY_MEMBER/);
assert.match(dashboard, /ADD_TO_EXISTING_CASE/);
assert.match(dashboard, /CREATE_NEW_CASE/);
assert.match(dashboard, /createRmaReworkCase/);
assert.match(dashboardHtml, /Enter the customer-issued RMA number used to group related return, replacement, or rework lines\./);
assert.match(dashboardHtml, /Use only when a customer RMA number has not yet been assigned\./);
assert.match(sql, /EventType IN \('CASE_CREATED','LINE_ADDED'\)/);
assert.match(sql, /EventType='LINE_ADDED' AND ExpectedPriorEventId IS NOT NULL/);
assert.doesNotMatch(kittingHtml + kitting, /Classify as RMA \/ Rework|createRmaReworkCase/);
assert.match(kitting,
  /Active RMA\/Rework cases control these Sales Order lines\.[\s\S]*normal Kitting demand is suppressed\./,
  'Kitting presents active RMA/Rework lines in their dedicated governed queue and suppresses normal demand');
assert.doesNotMatch(kittingHtml, /data-kitting-(?:queue-button|lifecycle-tab)="RMA_REWORK"/,
  'RMA/Rework-controlled lines are not exposed as a normal Kitting operator lifecycle tab');
assert.match(kittingWorkspace, /RMA_REWORK: queues\.rmaRework/,
  'Kitting retains governed RMA/Rework queue segregation in its read model');
assert.match(kittingWorkspace, /while \(expectedTotal === null \|\| cases\.length < expectedTotal\)/);
assert.match(kittingWorkspace, /membership could not be verified completely/);
assert.match(kittingWorkspace, /No BOM, shortage, purchasing, or production demand is generated here/);
assert.match(operationsDataService, /loadAllActiveRmaReworkMemberships/);
assert.match(operationsDataService, /loadAllApprovalReviews/);
assert.match(operationsDataService, /membership could not be verified completely/);
assert.match(operationsViewModel, /RMA_CONTROLLED/);
assert.match(operationsViewModel, /Superseded by active RMA\/Rework case/);
assert.match(operationsTable, /Review evidence/);
assert.doesNotMatch(operationsTable, /isOrdinaryProductionOverlay|operations-center-rma-suppressed/,
  'retired overlay cells no longer carry a separate RMA suppression presentation');

const normalizeReference = value => String(value).trim().replace(/\s+/g, ' ').toUpperCase();
const referenceKey = (customer, type, value) => [customer, type, normalizeReference(value)].join('|');
assert.equal(referenceKey('578350', 'INTERNAL_RMA', ' PENDING-RMA-0011694 '),
  referenceKey('578350', 'INTERNAL_RMA', 'pending-rma-0011694'));
assert.equal(normalizeReference('RMA  123 - A'), 'RMA 123 - A');
assert.notEqual(referenceKey('578350', 'CUSTOMER_RMA', 'RMA-12345'),
  referenceKey('578350', 'INTERNAL_RMA', 'RMA-12345'));
assert.notEqual(referenceKey('578350', 'CUSTOMER_RMA', 'RMA-12345'),
  referenceKey('001082', 'CUSTOMER_RMA', 'RMA-12345'));
const matchingCases = [
  { customer:'578350', type:'INTERNAL_RMA', value:'PENDING-RMA-0011694' },
  { customer:'001082', type:'INTERNAL_RMA', value:'PENDING-RMA-0011694' },
  { customer:'578350', type:'CUSTOMER_RMA', value:'PENDING-RMA-0011694' }
].filter(item => referenceKey(item.customer, item.type, item.value) ===
  referenceKey('578350', 'INTERNAL_RMA', ' pending-rma-0011694 '));
assert.equal(matchingCases.length, 1);

const readModelSource = fs.readFileSync('SRC/workspaces/kitting/kitting-read-model.js', 'utf8');
const context = { window: {} }; vm.createContext(context); vm.runInContext(readModelSource, context);
const line = (key, wo, qty) => ({ lineKey:key, customerNumber:'578350', customerName:'SAFRAN', salesOrderNumber:'0011694',
  salesOrderLineNumber:key.split('|')[2], itemNumber:'500144-103', quantityOrdered:qty, operationalQuantityOpen:Math.max(qty,0),
  relationship:{ resolutionStatus:'EXACT_LINE_UNIQUE', actionableWorkOrderNumber:wo } });
const lines = [line('578350|0011694|010','0115244',1), line('578350|0011694|040','0115244',-1)];
const base = { lines, approvalsByLineKey:new Map(), workOrdersByNumber:new Map([['0115244',{workOrderNumber:'0115244',itemNumber:'500144-103',schProdQuantity:20}]]),
  dispositionsByWorkOrder:new Map([['0115244',{currentDisposition:'NEEDS_KITTING'}]]) };
let model = context.window.KittingReadModel.buildReadModel(base);
assert.equal(model.readyRows[0].relatedOpenSalesOrderLineCount, 2);
model = context.window.KittingReadModel.buildReadModel({...base,
  rmaReworkByLineKey:new Map([['578350|0011694|040',{caseId:'case-1',caseReference:'PENDING-RMA-0011694'}]])});
assert.equal(model.readyRows[0].relatedOpenSalesOrderLineCount, 1);
assert.equal(model.readyRows[0].rmaReworkLines.length, 1);
assert.equal(model.counts.rmaReworkExcludedLines, 1);
assert.equal(model.queues.rmaRework.length, 1);
assert.equal(model.queues.rmaRework[0].rmaCaseReference, 'PENDING-RMA-0011694');
assert.equal(model.queues.rmaRework[0].workOrderDecision, 'Decision Pending');
assert.equal(model.queues.rmaRework[0].nextRequiredAction, 'Review RMA/Rework disposition');
assert.equal(model.queues.needsResolution.length, 0);
assert.equal(['notClassified','needsResolution','needsKitting','kitShort','kitComplete']
  .flatMap(name => model.queues[name]).flatMap(row => row.relatedLines)
  .some(item => item.lineKey.endsWith('|040')), false);
assert.equal(model.readyRows[0].manualKittingDisposition.currentDisposition, 'NEEDS_KITTING');
assert.equal(model.counts.duplicatePrimaryQueueMembership, 0);

const activeCases = Array.from({ length: 201 }, (_, index) => ({
  caseId: 'case-' + index, caseReference: 'RMA-' + index, caseType: 'CUSTOMER_REWORK', caseStatus: 'ACTIVE',
  members: [{ customerNumber:'578350', salesOrderNumber:String(1000000 + index).padStart(7, '0'), salesOrderLineNumber:'010' }]
}));
const kittingContext = { console, document:{ querySelector(){ return null; } }, window:{
  DleApiClient:{ getRmaReworkCases: async ({ page, pageSize }) => ({
    items: activeCases.slice((page - 1) * pageSize, page * pageSize), totalItems: activeCases.length
  }) }
} };
vm.createContext(kittingContext); vm.runInContext(kittingWorkspace, kittingContext);
const completeMemberships = await kittingContext.window.DleWorkspaces.kitting.loadActiveRmaReworkMemberships();
assert.equal(completeMemberships.size, 201);
let membershipFailureClosed = false;
kittingContext.window.DleApiClient.getRmaReworkCases = async () => { throw new Error('membership unavailable'); };
try { await kittingContext.window.DleWorkspaces.kitting.loadActiveRmaReworkMemberships(); }
catch { membershipFailureClosed = true; }
assert.equal(membershipFailureClosed, true);

const operationsContext = { window: { OperationsCenter: {
  state: { canonicalLoaded:true, canonicalRows:[] },
  stateActions: { getOverlayRecord(){ return {}; }, updateOverlayField(){ return false; } }
} }, shipmentStagingState:{ records:[] } };
vm.createContext(operationsContext); vm.runInContext(operationsViewModel, operationsContext);
const operationsApi = operationsContext.window.OperationsCenter.viewModel;
const sharedRelationship = { status:'EXACT_LINE_UNIQUE', actionableWorkOrderNumber:'0115244', candidates:[{workOrderNumber:'0115244'}] };
const controlledPresentation = operationsApi.getWorkOrderPresentation({
  itemNumber:'500144-103', workOrderRelationship:sharedRelationship,
  rmaReworkMembership:{caseId:'case-1',caseReference:'PENDING-RMA-0011694'},
  workOrderApprovalReview:{currentApproval:{approvedWorkOrderNumber:'0115244'}}
});
assert.equal(controlledPresentation.label, 'Decision Pending');
assert.equal(controlledPresentation.secondaryLabel, 'RMA / Rework');
assert.equal(controlledPresentation.actionable, false);
assert.equal(controlledPresentation.evidenceLabel, 'Superseded by active RMA/Rework case');
assert.deepEqual(Array.from(controlledPresentation.evidence), [
  'Prior approval: 0115244', 'Exact relationship: 0115244', 'Candidate: 0115244'
]);
const unrelatedNormalPresentation = operationsApi.getWorkOrderPresentation({
  itemNumber:'500144-103', workOrderRelationship:sharedRelationship,
  workOrderApprovalReview:{currentApproval:null}
});
assert.equal(unrelatedNormalPresentation.label, '0115244');
assert.equal(unrelatedNormalPresentation.actionable, true, 'shared Work Order remains actionable for a normal line');
const governedApprovalPresentation = operationsApi.getWorkOrderPresentation({
  itemNumber:'500144-103',
  workOrderRelationship:{ status:'SALES_ORDER_ITEM_UNIQUE_CANDIDATE', candidates:[{workOrderNumber:'0115000',itemNumber:'500144-103'}] },
  workOrderApprovalReview:{currentApproval:{approvedWorkOrderNumber:'0115244'}}
});
assert.equal(governedApprovalPresentation.label, '0115244');
assert.equal(governedApprovalPresentation.secondaryLabel, 'Approved');
assert.equal(governedApprovalPresentation.actionable, true);

console.log('RMA-REWORK-001 SQL, API, Sales Order Dashboard, Operations Center, Kitting consumption, and integrity contracts: PASS');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(path, 'utf8');
const sql = read('Tools/RmaRework/Database/002_AddSalesOrderLineWorkOrderInterpretation.sql');
const server = read('Tools/LiveSnapshotRefresh/ControlHost/OperationalWorkOrderRelationshipCenter.cs');
const approval = read('Tools/LiveSnapshotRefresh/ControlHost/WorkOrderApprovalCenter.cs');
const kittingServer = read('Tools/LiveSnapshotRefresh/ControlHost/KittingDispositionCenter.cs');
const program = read('Tools/LiveSnapshotRefresh/ControlHost/Program.cs');
const apiClient = read('SRC/api/dle-api-client.js');
const sales = read('SRC/modules/sales-order-dashboard/sales-order-dashboard.js');
const salesHtml = read('SRC/modules/sales-order-dashboard/sales-order-dashboard.html');
const operationsSource = read('SRC/modules/operations-center/operations-center-view-model.js');
const operationsTable = read('SRC/modules/operations-center/operations-center-table.js');
const kittingSource = read('SRC/workspaces/kitting/kitting-read-model.js');
const kittingWorkspace = read('SRC/workspaces/kitting/kitting-workspace.js');
const workOrderDashboard = read('SRC/modules/work-order-dashboard/work-order-dashboard.js');
const operationsModule = read('SRC/modules/operations-center/operations-center.js');
const rmaServer = read('Tools/LiveSnapshotRefresh/ControlHost/RmaReworkCenter.cs');
const refresh = read('Tools/DailyOperationsSync/Import-DailyOperationsSnapshot.ps1');

for (const field of [
  'RmaCaseId', 'RmaMemberSequence', 'CustomerNumber', 'SalesOrderNumber',
  'SalesOrderLineNumber', 'ActiveWorkOrderNumber', 'HistoricalWorkOrderNumber',
  'RelationshipRole', 'ResultingOperationalStatus', 'Reason', 'RecordedBy',
  'RecordedAtUtc', 'SupersedesEventId'
]) assert.match(sql, new RegExp(field));
assert.match(sql, /INSTEAD OF UPDATE, DELETE/);
assert.match(sql, /events are append-only/);
assert.match(sql, /vw_CurrentSalesOrderLineWorkOrderInterpretation/);
assert.match(sql, /PARTITION BY CustomerNumber,SalesOrderNumber,SalesOrderLineNumber/);
assert.doesNotMatch(sql, /UPDATE canonical\.|DELETE FROM canonical\.|INSERT canonical\./);
assert.doesNotMatch(refresh, /SalesOrderLineWorkOrderInterpretationEvent/,
  'canonical refresh must not delete operational interpretations');

assert.match(program, /MapOperationalWorkOrderRelationships/);
assert.match(server, /operational-work-order-relationships\/v1\/sales-order-lines/);
assert.match(server, /RETURN_REVIEW_REQUIRED/);
assert.match(server, /RMA_DECISION_PENDING/);
assert.match(server, /RMA_WORK_ORDER_ASSIGNED/);
assert.match(server, /ORIGINAL_BUILD/);
assert.match(server, /quantityShipped/);
assert.match(server, /workOrderOpenedDateIso/);
assert.match(server, /PredatesCurrentOccurrence/);
assert.match(server, /ExpectedPriorEventId/);
assert.match(server, /interpretation_changed/);
assert.match(server, /authenticated_identity_required/);
assert.match(server, /TrustedDevelopmentIdentity\.RequireActorName\(context\)/,
  'operational interpretations use the validated DLE-OS actor rather than the service account');
assert.match(server, /RequireAuthorization\(policy\)/);
assert.match(server, /BeginTransactionAsync\(\s*IsolationLevel\.Serializable/);
assert.doesNotMatch(server, /UPDATE canonical\.|DELETE FROM canonical\.|INSERT canonical\./);

assert.match(approval, /operationalRelationship = operational/);
assert.match(approval, /return_review_controls_work_order_decision/);
assert.match(approval, /QuantityOrdered FROM canonical\.SalesOrderLine WITH \(UPDLOCK,HOLDLOCK\)/);
assert.match(kittingServer, /operational_work_order_not_actionable/);
assert.match(kittingServer, /operational\.OperationalRoute != "NORMAL_PRODUCTION"/);
assert.match(apiClient, /getOperationalWorkOrderRelationship/);
assert.match(apiClient, /appendOperationalWorkOrderInterpretation/);

assert.match(sales, /operationalRelationship/);
assert.match(sales, /RETURN_RMA_REVIEW_REQUIRED/);
assert.match(sales, /Original Build/);
assert.match(salesHtml, /Active Operational Work Order/);
assert.match(salesHtml, /Historical \/ Original Build Work Order/);
assert.match(operationsSource, /Canonical evidence retained as historical only/);
assert.match(operationsTable, /isReturnReviewControlled/);
assert.match(kittingWorkspace, /Historical Work Order evidence/);
assert.match(workOrderDashboard, /blockedReturnNavigation/);
assert.match(apiClient, /dle:sales-order-line-operational-state-change/);
assert.match(apiClient, /publishOperationalLineStateChange/);
assert.match(apiClient, /subscribeOperationalLineStateChange/);
assert.match(sales, /rma-rework-membership-issued/);
assert.match(sales, /!membership && review\?\.permissions\?\.canApprove/);
assert.match(sales, /Normal Work Order approval is blocked/);
assert.match(operationsModule, /subscribeOperationalLineStateChange/);
assert.match(kittingWorkspace, /subscribeOperationalLineStateChange/);
assert.match(workOrderDashboard, /subscribeOperationalLineStateChange/);
assert.match(rmaServer, /InsertAutomaticInterpretationAsync/);
assert.match(rmaServer, /'RMA_DECISION_PENDING'/);
assert.match(rmaServer, /RMA\/Rework membership issued; canonical Work Order retained as historical evidence only/);

class QualificationCustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
}
const eventDocument = new EventTarget();
const eventWindow = {
  location: {
    protocol: 'http:', hostname: '127.0.0.1', port: '5051',
    origin: 'http://127.0.0.1:5051'
  },
  localStorage: { getItem(){ return null; }, setItem(){} }
};
const eventContext = {
  window: eventWindow, document: eventDocument, CustomEvent: QualificationCustomEvent,
  Event, EventTarget, URL, URLSearchParams, AbortController, DOMException,
  fetch: async () => { throw new Error('Network access is not expected in the propagation contract.'); },
  console
};
vm.createContext(eventContext);
vm.runInContext(apiClient, eventContext);
let membershipIssued = false;
const refreshed = { sales: null, operations: null, kitting: null, navigation: null };
const authoritativeReload = surface => Promise.resolve().then(() => {
  refreshed[surface] = membershipIssued ? {
    isRmaRework: true, caseId: 'be42eab9-1c24-403f-b005-a485d8d19989', memberSequence: 1,
    operationalRoute: 'RMA_REWORK', activeWorkOrderNumber: null,
    historicalWorkOrderNumber: '0115414', relationshipRole: 'ORIGINAL_BUILD',
    operationalStatus: 'RMA_DECISION_PENDING', approvalBlocked: true,
    ordinaryKittingBlocked: true, navigationBlocked: true
  } : { operationalRoute: 'RETURN_RMA_REVIEW_REQUIRED' };
});
for (const surface of Object.keys(refreshed)) {
  eventWindow.DleApiClient.subscribeOperationalLineStateChange(detail =>
    detail.waitUntil(authoritativeReload(surface)));
}
await authoritativeReload('sales');
assert.equal(refreshed.sales.operationalRoute, 'RETURN_RMA_REVIEW_REQUIRED');
membershipIssued = true;
await eventWindow.DleApiClient.publishOperationalLineStateChange(
  [{ customerNumber: '578350', salesOrderNumber: '0011896', lineNumber: '010' }],
  'rma-rework-membership-issued'
);
for (const surface of Object.keys(refreshed)) {
  assert.equal(refreshed[surface].operationalRoute, 'RMA_REWORK');
  assert.equal(refreshed[surface].activeWorkOrderNumber, null);
  assert.equal(refreshed[surface].historicalWorkOrderNumber, '0115414');
  assert.equal(refreshed[surface].relationshipRole, 'ORIGINAL_BUILD');
  assert.equal(refreshed[surface].operationalStatus, 'RMA_DECISION_PENDING');
}

const historical = [{
  workOrderNumber: '0115414', relationshipRole: 'ORIGINAL_BUILD',
  predatesCurrentOccurrence: true, positiveInvoiceEvidence: true,
  evidenceSummary: 'Earlier positive invoice and production evidence.'
}];
const protectedOperational = {
  quantityOrdered: -1,
  activeWorkOrderNumber: null,
  activeWorkOrderSource: 'NONE',
  historicalWorkOrders: historical,
  operationalStatus: 'RETURN_REVIEW_REQUIRED',
  operationalRoute: 'RETURN_RMA_REVIEW_REQUIRED',
  workOrderDecision: 'Return Review Required',
  reason: 'Negative current quantity blocks normal-production interpretation.'
};
const normalOperational = {
  quantityOrdered: 2,
  activeWorkOrderNumber: '0115414',
  activeWorkOrderSource: 'CANONICAL_EXACT',
  historicalWorkOrders: [],
  operationalStatus: 'ACTIVE_PRODUCTION_WORK_ORDER',
  operationalRoute: 'NORMAL_PRODUCTION',
  workOrderDecision: 'ERP Confirmed',
  reason: 'Positive normal-production exact relationship.'
};
const relationship = {
  resolutionStatus: 'EXACT_LINE_UNIQUE', status: 'EXACT_LINE_UNIQUE',
  actionableWorkOrderNumber: '0115414', candidateCount: 1,
  candidates: [{ workOrderNumber: '0115414', itemNumber: '500144-103' }]
};

const kittingContext = { window: {} };
vm.createContext(kittingContext);
vm.runInContext(kittingSource, kittingContext);
const line = (lineKey, quantity) => ({
  lineKey, customerNumber: '578350', customerName: 'SAFRAN',
  salesOrderNumber: lineKey.split('|')[1], salesOrderLineNumber: lineKey.split('|')[2],
  itemNumber: '500144-103', quantityOrdered: quantity,
  operationalQuantityOpen: Math.max(quantity, 0), dueDate: '2026-05-20', relationship
});
const negativeKey = '578350|0011896|010';
const positiveKey = '578350|0011896|020';
const model = kittingContext.window.KittingReadModel.buildReadModel({
  lines: [line(negativeKey, -1), line(positiveKey, 2)],
  approvalsByLineKey: new Map([
    [negativeKey, { operationalRelationship: protectedOperational }],
    [positiveKey, { operationalRelationship: normalOperational }]
  ]),
  workOrdersByNumber: new Map([['0115414', {
    workOrderNumber: '0115414', customerNumber: '578350', salesOrderNumber: '0011896',
    salesOrderLineNumber: '010', itemNumber: '500144-103', schProdQuantity: 20
  }]])
});
assert.equal(model.readyRows.length, 1, 'unrelated positive line remains actionable on shared WO');
assert.equal(model.readyRows[0].relatedOpenSalesOrderLineCount, 1);
assert.equal(model.readyRows[0].relatedLines[0].lineKey, positiveKey);
assert.equal(model.queues.rmaRework.length, 1);
assert.equal(model.queues.rmaRework[0].relatedLines[0].lineKey, negativeKey);
assert.equal(model.queues.rmaRework[0].workOrderDecision, 'Return Review Required');
assert.equal(model.queues.rmaRework[0].nextRequiredAction,
  'Create or confirm RMA/Rework membership');
assert.equal(model.counts.rmaReworkExcludedLines, 1);
assert.equal(kittingContext.window.KittingReadModel.collectActionableWorkOrderNumbers(
  [line(negativeKey, -1), line(positiveKey, 2)],
  new Map([
    [negativeKey, { operationalRelationship: protectedOperational }],
    [positiveKey, { operationalRelationship: normalOperational }]
  ]), new Map()).join(','), '0115414');

const operationsContext = { window: { OperationsCenter: {
  state: { canonicalLoaded: true, canonicalRows: [] },
  stateActions: { getOverlayRecord(){ return {}; }, updateOverlayField(){ return false; } }
} }, shipmentStagingState: { records: [] } };
vm.createContext(operationsContext);
vm.runInContext(operationsSource, operationsContext);
const operations = operationsContext.window.OperationsCenter.viewModel;
const protectedPresentation = operations.getWorkOrderPresentation({
  workOrderRelationship: relationship,
  workOrderApprovalReview: { operationalRelationship: protectedOperational }
});
assert.equal(protectedPresentation.label, 'Return Review Required');
assert.equal(protectedPresentation.actionable, false);
assert.deepEqual(Array.from(protectedPresentation.evidence), ['Original Build: 0115414']);
const normalPresentation = operations.getWorkOrderPresentation({
  workOrderRelationship: relationship,
  workOrderApprovalReview: { operationalRelationship: normalOperational }
});
assert.equal(normalPresentation.label, '0115414');
assert.equal(normalPresentation.actionable, true);

console.log('RMA-ERP-WORK-ORDER-RELATIONSHIP-001 operational projection, persistence, guard, and cross-module contracts: PASS');

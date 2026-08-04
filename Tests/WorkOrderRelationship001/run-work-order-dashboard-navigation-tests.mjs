import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) {
    elements.set(id, {
      id, textContent: '', innerHTML: '', hidden: false, disabled: false, value: '',
      classList: { toggle() {} }, setAttribute() {}, focus() {}, select() {}
    });
  }
  return elements.get(id);
};

let navigatedTo = '';
let capturedHandoff = null;
let approvalReview = { conflictClassification: 'NO_APPROVAL', currentApproval: null };
let approvalRead = async () => approvalReview;
let canonicalResult = { items: [], totalItems: 0 };
let canonicalCalls = 0;
const context = vm.createContext({
  console, structuredClone, setTimeout, clearTimeout,
  go(id) { navigatedTo = id; },
  document: {
    activeElement: null,
    addEventListener() {},
    getElementById(id) { return elements.has(id) ? elements.get(id) : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  },
  window: {
    DleApiClient: {
      async getWorkOrderApprovalReview(...args) { return approvalRead(...args); },
      liveCanonical: {
        async getCanonicalWorkOrders() {
          canonicalCalls += 1;
          if (canonicalResult instanceof Error) throw canonicalResult;
          return canonicalResult;
        }
      }
    },
    WorkOrderDashboardModule: { setSelectedWorkOrder(value) { capturedHandoff = value; } },
    OperationsCenter: { officialColumns: [], viewModel: { getMasterRecords() { return []; } } }
  }
});
context.window.window = context.window;
context.window.document = context.document;
context.window.structuredClone = structuredClone;

vm.runInContext(
  fs.readFileSync(path.join(root, 'SRC/modules/sales-order-dashboard/sales-order-dashboard.js'), 'utf8'),
  context
);
const api = context.window.SalesOrderDashboard;

const relationship = (status, options = {}) => ({
  status,
  resolutionStatus: status,
  actionableWorkOrderNumber: options.actionableWorkOrderNumber || '',
  candidateCount: options.candidates?.length || 0,
  candidates: options.candidates || []
});
const row = (status, options = {}) => ({
  masterRecordKey: options.key || '001082|0012067|040',
  official: {
    customerNumber: options.customerNumber || '001082',
    customer: options.customer || 'ABBOTT TECHNOLOGIES, INC.',
    salesOrder: options.salesOrder || '0012067',
    sequenceLine: options.line || '040',
    partNumber: options.item || 'B11020-26',
    revision: options.revision || 'F-RED',
    opQtyOpen: options.quantity ?? 10,
    dueDate: options.dueDate || '08/12/26',
    workOrderRelationship: relationship(status, options)
  },
  masterRecord: { vpro5: {} }
});
const candidate = {
  workOrderNumber: '115586', itemNumber: 'B11020-26', anchorSalesOrderLine: '010',
  sourceSnapshotId: 'SNAPSHOT-1', sourceImportRunId: 'IMPORT-1'
};
const approvedRow = row('SALES_ORDER_ITEM_UNIQUE_CANDIDATE', { candidates: [candidate] });
const approved = {
  conflictClassification: 'APPROVED_SUPPORTED_CANDIDATE',
  currentApproval: { approvedWorkOrderNumber: '115586', decisionId: 'DECISION-1' }
};

let resolved = api.resolveGovernedWorkOrderForAction(approvedRow, approved);
assert.equal(resolved.actionable, true);
assert.equal(resolved.workOrderNumber, '0115586');
assert.equal(resolved.source, 'APPROVAL');
assert.equal(resolved.approvalDecisionId, 'DECISION-1');
assert.equal(resolved.snapshotId, 'SNAPSHOT-1');

const exactRow = row('EXACT_LINE_UNIQUE', {
  customerNumber: '001021', salesOrder: '0012035', line: '010', item: 'QR196385',
  actionableWorkOrderNumber: '115593'
});
resolved = api.resolveGovernedWorkOrderForAction(exactRow, {
  conflictClassification: 'NO_APPROVAL', currentApproval: null
});
assert.equal(resolved.actionable, true);
assert.equal(resolved.workOrderNumber, '0115593');
assert.equal(resolved.source, 'EXACT');

for (const blocked of [
  [row('SALES_ORDER_ITEM_UNIQUE_CANDIDATE', { candidates: [candidate] }), null],
  [row('SALES_ORDER_LEVEL_CANDIDATE', { candidates: [candidate] }), null],
  [row('AMBIGUOUS', { candidates: [candidate, { workOrderNumber: '0115587' }] }), null],
  [row('UNRESOLVED'), null],
  [row('FUTURE_STATUS'), null],
  [approvedRow, { conflictClassification: 'APPROVED_CONFLICTS_EXACT', currentApproval: approved.currentApproval }],
  [approvedRow, { conflictClassification: 'APPROVED_NOT_IN_CURRENT_CANDIDATES', currentApproval: approved.currentApproval }],
  [approvedRow, { conflictClassification: 'APPROVED_WORK_ORDER_MISSING', currentApproval: approved.currentApproval }],
  [approvedRow, { conflictClassification: 'APPROVED_WITH_CURRENT_AMBIGUITY', currentApproval: approved.currentApproval }],
  [approvedRow, { conflictClassification: 'FUTURE_APPROVAL', currentApproval: approved.currentApproval }]
]) assert.equal(api.resolveGovernedWorkOrderForAction(blocked[0], blocked[1]).actionable, false);

canonicalResult = {
  items: [{ workOrderNumber: '0115586', customerNumber: '001082', salesOrderNumber: '0012067' }],
  totalItems: 1
};
assert.equal((await api.loadCanonicalWorkOrderForResolution(
  api.resolveGovernedWorkOrderForAction(approvedRow, approved)
)).workOrderNumber, '0115586');
for (const badResult of [
  { items: [], totalItems: 0 },
  { items: [{ workOrderNumber: '0115586' }, { workOrderNumber: '0115586' }], totalItems: 2 },
  { items: [{ workOrderNumber: '0115999' }], totalItems: 1 },
  new Error('5052 unavailable')
]) {
  canonicalResult = badResult;
  await assert.rejects(() => api.loadCanonicalWorkOrderForResolution(
    api.resolveGovernedWorkOrderForAction(approvedRow, approved)
  ));
}

const canonicalAbbott = {
  workOrderNumber: '0115586', customerNumber: '001082', salesOrderNumber: '0012067',
  salesOrderLineNumber: '010', itemNumber: 'B11020-26   ', schProdQuantity: '50',
  workOrderStatus: 'O', drawingRevision: 'F-RED'
};
const handoff = api.buildGovernedWorkOrderHandoff(
  approvedRow, api.resolveGovernedWorkOrderForAction(approvedRow, approved), canonicalAbbott
);
assert.equal(handoff.workOrderNumber, '0115586');
assert.equal(handoff.canonicalAnchorLine, '010');
assert.equal(handoff.originSalesOrderLine, '040');
assert.equal(handoff.governingSource, 'APPROVAL');
assert.notEqual(handoff.canonicalWorkOrder, canonicalAbbott);

const requestLine = api.buildRequestDialogLine(
  approvedRow, 0, api.resolveGovernedWorkOrderForAction(approvedRow, approved), canonicalAbbott
);
assert.equal(requestLine.workOrder, '0115586');
assert.equal(requestLine.openQuantity, 10);
assert.equal(requestLine.canonicalWorkOrder.workOrderNumber, '0115586');
assert.throws(() => api.buildRequestDialogLine(approvedRow, 0), /approved/i);
const exactRequestLine = api.buildRequestDialogLine(
  exactRow, 0, api.resolveGovernedWorkOrderForAction(exactRow, null),
  { workOrderNumber: '0115593' }
);
assert.equal(exactRequestLine.workOrder, '0115593');

approvalReview = approved;
canonicalResult = { items: [canonicalAbbott], totalItems: 1 };
api.setSelectedOrder({ official: approvedRow.official, relatedRows: [approvedRow] });
await new Promise(resolve => setTimeout(resolve, 0));
api.getState().approvalReviews.set('001082|0012067|040', approved);
navigatedTo = '';
capturedHandoff = null;
assert.equal(await api.navigateToGovernedWorkOrder(approvedRow), true);
assert.equal(navigatedTo, 'workOrderDashboardModule');
assert.equal(capturedHandoff.workOrderNumber, '0115586');
assert.equal(capturedHandoff.canonicalAnchorLine, '010');
assert.equal(capturedHandoff.originSalesOrderLine, '040');

api.getState().approvalReviews.set('001082|0012067|040', approved);
approvalReview = { conflictClassification: 'NO_APPROVAL', currentApproval: null };
canonicalCalls = 0;
assert.equal(await api.navigateToGovernedWorkOrder(approvedRow), false);
assert.equal(canonicalCalls, 0);

api.getState().approvalReviews.set('001082|0012067|040', approved);
assert.equal(api.getSelectedWorkOrderActionState([approvedRow]).enabled, true);
api.getState().approvalReviews.delete('001082|0012067|040');
assert.equal(api.getSelectedWorkOrderActionState([exactRow]).enabled, true);
assert.equal(api.getSelectedWorkOrderActionState([approvedRow]).enabled, false);
assert.equal(api.getSelectedWorkOrderActionState([exactRow, approvedRow]).enabled, false);
canonicalCalls = 0;
assert.equal(await api.navigateToGovernedWorkOrder(approvedRow), false);
assert.equal(canonicalCalls, 0, 'direct candidate navigation cannot bypass the governing gate');

// A delayed manual review response cannot contaminate a newly selected order.
api.setSelectedOrder({ official: approvedRow.official, relatedRows: [approvedRow] });
await new Promise(resolve => setTimeout(resolve, 0));
let releaseOldReview;
approvalRead = async (customerNumber, salesOrderNumber) => {
  if (salesOrderNumber === '0012067') {
    return new Promise(resolve => { releaseOldReview = resolve; });
  }
  return { conflictClassification: 'NO_APPROVAL', currentApproval: null };
};
const oldReviewPromise = api.openWorkOrderApprovalReview({
  currentTarget: { dataset: { relatedRowIndex: '0' } },
  stopPropagation() {}
});
await new Promise(resolve => setTimeout(resolve, 0));
api.setSelectedOrder({ official: exactRow.official, relatedRows: [exactRow] });
releaseOldReview(approved);
await oldReviewPromise;
assert.equal(api.getState().approvalReviews.has('001082|0012067|040'), false);
approvalRead = async () => approvalReview;

for (const id of [
  'workOrderDashboardModuleStatus', 'workOrderDashboardView', 'workOrderDashboardScheduledReleasesBody',
  'workOrderDashboardScheduledReleasesIndicator', 'workOrderDashboardSummaryWorkOrder',
  'workOrderDashboardSummaryAssembly', 'workOrderDashboardSummaryRevision',
  'workOrderDashboardSummaryQuantity', 'workOrderDashboardSummaryDueDate',
  'workOrderDashboardSummaryStatus', 'workOrderDashboardCanonicalAnchor',
  'workOrderDashboardOpenedFrom', 'workOrderDashboardGoverningSource', 'workOrderDashboardRelatedRows'
]) element(id);
vm.runInContext(
  fs.readFileSync(path.join(root, 'SRC/modules/work-order-dashboard/work-order-dashboard.js'), 'utf8'),
  context
);
context.window.WorkOrderDashboardModule.setSelectedWorkOrder(handoff);
assert.equal(element('workOrderDashboardSummaryWorkOrder').textContent, '0115586');
assert.equal(element('workOrderDashboardSummaryAssembly').textContent, 'B11020-26');
assert.equal(element('workOrderDashboardCanonicalAnchor').textContent, 'SO 0012067 · Line 010');
assert.equal(element('workOrderDashboardOpenedFrom').textContent, 'SO 0012067 · Line 040');
assert.equal(element('workOrderDashboardGoverningSource').textContent, 'Approved Work Order');
assert.match(element('workOrderDashboardRelatedRows').innerHTML, /0115586/);
context.window.WorkOrderDashboardModule.setSelectedWorkOrder(approvedRow);
assert.equal(context.window.WorkOrderDashboardModule.getSelectedHandoff(), null);

const dashboardSource = fs.readFileSync(
  path.join(root, 'SRC/modules/sales-order-dashboard/sales-order-dashboard.js'), 'utf8'
);
const dashboardHtml = fs.readFileSync(
  path.join(root, 'SRC/modules/sales-order-dashboard/sales-order-dashboard.html'), 'utf8'
);
const workOrderHtml = fs.readFileSync(
  path.join(root, 'SRC/modules/work-order-dashboard/work-order-dashboard.html'), 'utf8'
);
assert.doesNotMatch(dashboardSource, /workOrder:\s*official\.workOrder\s*\|\|\s*masterVpro5\.workOrder/);
assert.match(dashboardSource, /refreshApprovalReviewForAction/);
assert.match(dashboardSource, /reviewStillCurrent/);
assert.match(dashboardSource, /returnState\?\.element\?\.isConnected/);
assert.match(dashboardHtml, /id="salesOrderDashboardOpenWorkOrderButton"/);
assert.match(dashboardHtml, /openSelectedSalesOrderDashboardWorkOrder\(event\)/);
assert.match(workOrderHtml, /Work Order Quantity/);

console.log('WORKORDER-DASHBOARD-NAVIGATION-001 governed handoff contract: PASS');

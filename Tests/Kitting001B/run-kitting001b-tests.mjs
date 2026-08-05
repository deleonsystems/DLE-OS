import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readModelSource = fs.readFileSync(
  path.join(root, 'SRC', 'workspaces', 'kitting', 'kitting-read-model.js'), 'utf8');
const workspaceSource = fs.readFileSync(
  path.join(root, 'SRC', 'workspaces', 'kitting', 'kitting-workspace.js'), 'utf8');
const workspaceHtml = fs.readFileSync(
  path.join(root, 'SRC', 'workspaces', 'kitting', 'kitting-workspace.html'), 'utf8');
const dashboardSource = fs.readFileSync(
  path.join(root, 'SRC', 'modules', 'work-order-dashboard', 'work-order-dashboard.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'DLE_Work_Center_v4.0.0.html'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(readModelSource, context);
const modelApi = context.window.KittingReadModel;

const exact = workOrder => ({
  status: 'EXACT_LINE_UNIQUE',
  actionableWorkOrderNumber: workOrder,
  candidates: [{ workOrderNumber: workOrder }]
});
const candidate = workOrder => ({
  status: 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',
  actionableWorkOrderNumber: '',
  candidates: [{ workOrderNumber: workOrder }]
});
const baseLine = (line, relationship, overrides = {}) => ({
  lineKey: `C1|SO1|${line}`,
  customerNumber: 'C1',
  customerName: 'Customer One',
  salesOrderNumber: 'SO1',
  salesOrderLineNumber: line,
  itemNumber: 'ITEM-A',
  quantityOrdered: 10,
  operationalQuantityOpen: 8,
  dueDate: `2026-08-${line === '010' ? '10' : '20'}`,
  relationship,
  ...overrides
});

const lines = [
  baseLine('010', exact('WO100')),
  baseLine('020', exact('WO100')),
  baseLine('030', candidate('WO200')),
  baseLine('040', candidate('WO400')),
  baseLine('050', { status: 'AMBIGUOUS', candidates: [
    { workOrderNumber: 'WO500' }, { workOrderNumber: 'WO501' }
  ] }),
  baseLine('060', { status: 'UNRESOLVED', candidates: [] }),
  baseLine('070', { status: 'EXACT_LINE_UNIQUE', actionableWorkOrderNumber: '', candidates: [] }),
  baseLine('080', exact('WO300'), { salesOrderNumber: 'SO2', lineKey: 'C1|SO2|080' })
];
const approvals = new Map([
  ['C1|SO1|030', {
    currentApproval: { approvedWorkOrderNumber: 'WO200', decisionId: 'decision-1' }
  }]
]);
const workOrders = new Map([
  ['WO100', { workOrderNumber: 'WO100', customerNumber: 'C1', itemNumber: 'ITEM-A', drawingRevision: 'A', schProdQuantity: '20' }],
  ['WO200', { workOrderNumber: 'WO200', customerNumber: 'C1', itemNumber: 'ITEM-A', bomRevision: 'B', schProdQuantity: '10' }],
  ['WO300', { workOrderNumber: 'WO300', customerNumber: 'C1', itemNumber: 'ITEM-B', bomRevision: 'C', schProdQuantity: '5' }]
]);
const documents = new Map([
  ['WO100', { state: 'PRESENT', label: 'Kit Short PDF available', kitShortPresent: true }]
]);

const model = modelApi.buildReadModel({
  lines,
  approvalsByLineKey: approvals,
  workOrdersByNumber: workOrders,
  documentsByWorkOrder: documents
});

assert.equal(model.counts.openSalesOrderLinesEvaluated, 8);
assert.equal(model.counts.uniqueGovernedWorkOrders, 3);
assert.equal(model.counts.exactWorkOrders, 2);
assert.equal(model.counts.approvedWorkOrders, 1);
assert.equal(model.counts.candidateRecords, 1);
assert.equal(model.counts.ambiguousRecords, 1);
assert.equal(model.counts.unresolvedRecords, 2);
assert.equal(model.counts.uniqueWorkOrdersWithMultipleLines, 1);
assert.equal(model.counts.duplicatePrimaryQueueMembership, 0);
assert.equal(model.counts.blankActionableWorkOrders, 0);
assert.equal(model.counts.legacyFallbackRecords, 0);
assert.equal(model.counts.temporaryBrowserStateDependencies, 0);
assert.equal(model.counts.kitShortInferredFromDocumentPresence, 0);
assert.equal(model.counts.kitCompleteInferredWithoutAuthoritativeStatus, 0);
assert.equal(model.counts.unclassifiedRelationshipStates, 0);

const consolidated = model.queues.notClassified.find(row => row.workOrderNumber === 'WO100');
assert.equal(consolidated.relatedOpenSalesOrderLineCount, 2);
assert.equal(consolidated.totalOperationalOpenQuantity, 16);
assert.equal(consolidated.currentKittingClassification, 'Needs Disposition');
assert.equal(consolidated.documentPresence.state, 'PRESENT');
assert.equal(model.queues.kitShort.length, 0, 'document presence must not imply Kit Short');

const approved = model.queues.notClassified.find(row => row.workOrderNumber === 'WO200');
assert.equal(approved.relationshipState, 'APPROVED');
assert.equal(approved.actionable, true);
assert.equal(modelApi.collectActionableWorkOrderNumbers(lines, approvals).join(','), 'WO100,WO200,WO300');

assert.equal(model.queues.notClassified.some(row => row.workOrderNumber === 'WO300'), true,
  'different Work Orders must remain separate');
assert.equal(model.queues.needsResolution.every(row => row.actionable === false), true);
assert.equal(model.queues.needsResolution.every(row => row.workOrderNumber === ''), true,
  'candidate, ambiguous, unresolved, and blank evidence must not create actionable Work Orders');
assert.deepEqual(
  Array.from(model.queues.needsResolution.map(row => row.relationshipState)).sort(),
  ['AMBIGUOUS', 'CANDIDATE', 'UNRESOLVED', 'UNRESOLVED'].sort()
);

assert.doesNotMatch(workspaceSource, /temporaryKittingQueueByRecordKey|dateKitStatusSubmitted|contenteditable/i);
assert.doesNotMatch(workspaceSource, /api\/masterdata|Master Data JSON|0115602|910781-03/i);
assert.doesNotMatch(workspaceSource, /isKitShortStatus|isKitCompleteStatus|\.pdf<\/a>/i);
assert.doesNotMatch(workspaceSource, /DleWorkbenchShell|temporaryKitting/i,
  'the governed queue must not open or depend on the placeholder Kitting Workbench');
assert.doesNotMatch(workspaceHtml, /contenteditable|Date Kit Status Submitted|Kit Shortage PDF placeholder|Load DLE Master Data/i);
assert.match(workspaceSource, /WorkOrderDashboardModule\.setSelectedWorkOrder\(handoff\)/);
assert.match(workspaceSource, /if \(!row\?\.actionable \|\| !row\.workOrderNumber/);
assert.match(workspaceSource, /sourceWorkspaceId: WORKSPACE_ID/);
assert.match(workspaceSource, /loadCanonicalRows[\s\S]*requestScope:\s*["']kitting["']/,
  'Kitting uses an independent canonical-load cancellation scope during shared state refreshes');
assert.match(dashboardSource, /isGovernedHandoff/);
assert.match(dashboardSource, /returnToKittingWorkspace/);
assert.match(mainSource, /kitting\/kitting-read-model\.js[\s\S]*kitting\/kitting-workspace\.js/);

console.log(JSON.stringify({ verdict: 'PASS', counts: model.counts }, null, 2));

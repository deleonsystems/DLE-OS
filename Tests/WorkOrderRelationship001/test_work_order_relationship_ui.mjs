import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const context = vm.createContext({
  console,
  structuredClone,
  document: {
    addEventListener() {},
    getElementById() { return null; }
  },
  window: {
    OperationsCenter: {
      state: { canonicalLoaded: true, canonicalRows: [] },
      stateActions: {
        getOverlayRecord() { return {}; },
        updateOverlayField() { return true; }
      }
    },
    shipmentStagingState: { records: [] }
  }
});
vm.runInContext(
  fs.readFileSync(path.join(root, 'SRC/modules/operations-center/operations-center-view-model.js'), 'utf8'),
  context
);
const vmApi = context.window.OperationsCenter.viewModel;

function row(status, candidates = [], actionableWorkOrderNumber = '') {
  return {
    itemNumber: 'ITEM-1',
    masterRecordKey: '001082|0012088|010',
    vpro5: { workOrder: actionableWorkOrderNumber },
    workOrderRelationship: { status, candidates, actionableWorkOrderNumber }
  };
}

const exact = vmApi.getWorkOrderPresentation(row('EXACT_LINE_UNIQUE', [], '0115608'));
assert.equal(exact.status, 'EXACT_LINE_UNIQUE');
assert.equal(exact.label, '0115608');
assert.equal(exact.actionable, true);
assert.equal(exact.reason, '');
assert.equal(vmApi.getWorkOrderPresentation(row('AMBIGUOUS', [{}, {}])).label, 'Multiple Work Orders (2)');
assert.equal(vmApi.getWorkOrderPresentation(row('UNRESOLVED')).label, 'Work Order Not Resolved');
assert.equal(
  vmApi.getWorkOrderPresentation(row('SALES_ORDER_ITEM_UNIQUE_CANDIDATE', [
    { workOrderNumber: '0115505', itemNumber: 'ITEM-1' }
  ])).label,
  'Candidate: 0115505'
);
const operationsMalformedCandidate = row('SALES_ORDER_ITEM_UNIQUE_CANDIDATE', [
  { workOrderNumber: '0115602', itemNumber: 'OTHER-ITEM' },
  { workOrderNumber: '0115603', itemNumber: 'ITEM-1' }
]);
operationsMalformedCandidate.workOrderRelationship.candidateCount = 2;
assert.equal(
  vmApi.getWorkOrderPresentation(operationsMalformedCandidate).label,
  'Candidate Data Conflict',
  'Operations Center must not independently repair a malformed authoritative candidate payload'
);

vm.runInContext(
  fs.readFileSync(
    path.join(root, 'SRC/modules/sales-order-dashboard/sales-order-dashboard.js'),
    'utf8'
  ),
  context
);
const dashboardApi = context.window.SalesOrderDashboard;
const dashboardRow = (status, candidates = [], actionableWorkOrderNumber = '', candidateCount) => ({
  official: {
    workOrderRelationship: {
      status,
      candidates,
      actionableWorkOrderNumber,
      ...(candidateCount === undefined ? {} : { candidateCount })
    }
  }
});

const dashboardExact = dashboardApi.getWorkOrderPresentation(
  dashboardRow('EXACT_LINE_UNIQUE', [], '0115608', 1)
);
assert.equal(dashboardExact.primary, '0115608');
assert.equal(dashboardExact.secondary, 'ERP Confirmed');
assert.equal(dashboardExact.actionable, true);

for (const status of [
  'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',
  'SALES_ORDER_LEVEL_CANDIDATE'
]) {
  const candidate = dashboardApi.getWorkOrderPresentation(
    dashboardRow(status, [{ workOrderNumber: '0115505' }], '', 1)
  );
  assert.equal(candidate.primary, '0115505');
  assert.equal(candidate.secondary, 'Candidate');
  assert.equal(candidate.actionable, false);
  assert.notEqual(candidate.primary, 'Work Order Candidate');
}

const conflict = dashboardApi.getWorkOrderPresentation(dashboardRow(
  'AMBIGUOUS',
  [{ workOrderNumber: '0115350' }, { workOrderNumber: '0115417' }],
  '',
  2
));
assert.equal(conflict.primary, 'Conflict (2)');
assert.equal(conflict.actionable, false);

const inconsistentConflict = dashboardApi.getWorkOrderPresentation(dashboardRow(
  'AMBIGUOUS', [{ workOrderNumber: '0115350' }], '', 2
));
assert.equal(inconsistentConflict.primary, 'Conflict');

for (const value of [
  dashboardRow('UNRESOLVED', [], '', 0),
  { official: {} }
]) {
  const unresolved = dashboardApi.getWorkOrderPresentation(value);
  assert.equal(unresolved.primary, '\u2014');
  assert.equal(unresolved.secondary, 'No Candidate');
  assert.equal(unresolved.actionable, false);
}

const unknown = dashboardApi.getWorkOrderPresentation(
  dashboardRow('FUTURE_STATUS', [{ workOrderNumber: '0115999' }], '', 1)
);
assert.equal(unknown.primary, '\u2014');
assert.equal(unknown.secondary, 'Unknown Relationship');
assert.equal(unknown.actionable, false);

for (const candidates of [
  [],
  [{ workOrderNumber: '0115505' }, { workOrderNumber: '0115506' }]
]) {
  const inconsistent = dashboardApi.getWorkOrderPresentation(
    dashboardRow('SALES_ORDER_ITEM_UNIQUE_CANDIDATE', candidates, '', candidates.length)
  );
  assert.equal(inconsistent.actionable, false);
  assert.notEqual(inconsistent.primary, '0115505');
}

const consistentCrossSurface = dashboardRow(
  'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',
  [{ workOrderNumber: '0115603', itemNumber: 'ITEM-1' }], '', 1
);
const operationsConsistent = row(
  'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',
  [{ workOrderNumber: '0115603', itemNumber: 'ITEM-1' }]
);
operationsConsistent.workOrderRelationship.candidateCount = 1;
assert.equal(
  dashboardApi.getWorkOrderPresentation(consistentCrossSurface).primary,
  '0115603'
);
assert.equal(
  vmApi.getWorkOrderPresentation(operationsConsistent).label,
  'Candidate: 0115603'
);

const dashboard = fs.readFileSync(
  path.join(root, 'SRC/modules/sales-order-dashboard/sales-order-dashboard.js'),
  'utf8'
);
assert.doesNotMatch(dashboard, /official\.workOrder \|\| 'Unknown'/);
assert.match(dashboard, /ERP Confirmed/);
assert.match(dashboard, /No Candidate/);
assert.match(dashboard, /Conflict/);
assert.match(dashboard, /status === 'EXACT_LINE_UNIQUE'/);
assert.match(dashboard, /openSalesOrderDashboardWorkOrder\(event\)/);
assert.match(dashboard, /opQtyOpen \?\? masterVpro5\.qtyOpen/);

console.log('WORKORDER-RELATIONSHIP-002 dashboard presentation contract: PASS');

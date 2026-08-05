import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(path, 'utf8');
const stateSource = read('SRC/modules/operations-center/operations-center-state.js');
const viewModelSource = read('SRC/modules/operations-center/operations-center-view-model.js');
const projectionSource = read('SRC/modules/operations-center/operations-projection-service.js');
const tableSource = read('SRC/modules/operations-center/operations-center-table.js');
const moduleSource = read('SRC/modules/operations-center/operations-center.js');
const htmlSource = read('SRC/modules/operations-center/operations-center.html');

const context = vm.createContext({
  console,
  structuredClone,
  localStorage: { getItem(){ return null; }, setItem(){} },
  shipmentStagingState: { records: [] },
  window: {
    OperationsCenter: {
      overlaySchema: {
        dataPath: '', persistedFieldKeys: [], blankOverlayFields(){ return {}; },
        normalizeDataset(value){ return value; }, stripRecord(value){ return value; },
        isRecordEmpty(){ return false; }
      }
    }
  }
});
vm.runInContext(stateSource, context);
vm.runInContext(viewModelSource, context);
vm.runInContext(projectionSource, context);

const oc = context.window.OperationsCenter;
const normalOperational = {
  operationalRoute: 'NORMAL_PRODUCTION', operationalStatus: 'ACTIVE_PRODUCTION_WORK_ORDER',
  activeWorkOrderNumber: 'WO-NORMAL', activeWorkOrderSource: 'CANONICAL_EXACT'
};
const returnReviewOperational = {
  operationalRoute: 'RETURN_RMA_REVIEW_REQUIRED', operationalStatus: 'RETURN_REVIEW_REQUIRED',
  activeWorkOrderNumber: null, activeWorkOrderSource: 'NONE'
};
const rmaPendingOperational = {
  operationalRoute: 'RMA_REWORK', operationalStatus: 'RMA_DECISION_PENDING',
  activeWorkOrderNumber: null, activeWorkOrderSource: 'NONE', workOrderDecision: 'Decision Pending'
};
const rmaAssignedOperational = {
  operationalRoute: 'RMA_REWORK', operationalStatus: 'RMA_WORK_ORDER_ASSIGNED',
  activeWorkOrderNumber: 'WO-REPAIR', activeWorkOrderSource: 'RMA_DECISION'
};

function row(key, customer, quantity, operational, membership = null) {
  const [, salesOrder, line] = key.split('|');
  return {
    masterRecordKey: key,
    customerNumber: key.split('|')[0], customerName: customer,
    salesOrderNumber: salesOrder, salesOrderLineNumber: line,
    quantityOrdered: quantity, extendedPrice: quantity * 100,
    workOrderApprovalReview: { operationalRelationship: operational },
    rmaReworkMembership: membership,
    workOrderRelationship: { status: 'UNRESOLVED', candidates: [] },
    vpro5: {
      customerNumber: key.split('|')[0], customer, salesOrder, sequenceLine: line,
      workOrder: operational.activeWorkOrderNumber || '', description: customer + ' assembly',
      extendedPrice: String(quantity * 100)
    }
  };
}

const normal = row('100|SO-1|010', 'Normal Customer', 2, normalOperational);
const returnReview = row('100|SO-1|020', 'Return Review Customer', -1, returnReviewOperational);
const membership = { caseId: 'RMA-1', caseReference: 'RMA-1', classification: 'RMA' };
const activeMember = row('200|SO-2|010', 'Active RMA Customer', -1, rmaPendingOperational, membership);
const assigned = row('300|SO-3|010', 'Assigned Rework Customer', 1, rmaAssignedOperational);
const orderedRows = [assigned, returnReview, normal, activeMember];

let view = oc.viewModel.getOperationsCenterView({ records: orderedRows, hideRmaRework: false });
assert.deepEqual(Array.from(view.records, item => item.masterRecordKey), orderedRows.map(item => item.masterRecordKey),
  'toggle off shows every row and preserves the authoritative sort order');
assert.equal(view.hiddenRmaReworkCount, 0);

view = oc.viewModel.getOperationsCenterView({ records: orderedRows, hideRmaRework: true });
assert.deepEqual(Array.from(view.records, item => item.masterRecordKey), [returnReview.masterRecordKey, normal.masterRecordKey],
  'toggle on hides active RMA/Rework while retaining return review and normal production');
assert.equal(view.hiddenRmaReworkCount, 2, 'hidden count is exact');
assert.equal(oc.viewModel.isActiveRmaReworkRecord(returnReview), false,
  'negative return review does not become RMA/Rework from sign or label alone');
assert.equal(oc.viewModel.isActiveRmaReworkRecord(normal), false);

view = oc.viewModel.getOperationsCenterView({
  records: orderedRows, hideRmaRework: true, searchTerms: ['CUSTOMER', 'SO-1']
});
assert.deepEqual(Array.from(view.records, item => item.masterRecordKey), [returnReview.masterRecordKey, normal.masterRecordKey],
  'semicolon-style AND search operates on the RMA-filtered population without changing order');
assert.equal(view.hiddenRmaReworkCount, 0, 'hidden count reflects the current searched population');

oc.projection.initialize();
orderedRows.forEach(item => oc.projection.setSelected(item.masterRecordKey, true));
const projected = oc.projection.getSummary(
  oc.viewModel.getOperationsCenterView({ records: orderedRows, hideRmaRework: true }).records,
  oc.viewModel
);
assert.equal(projected.selectedJobs, 2, 'Projection Mode uses the same visible record set');

const liveRows = [returnReview, normal];
oc.state.canonicalRows = liveRows;
oc.state.canonicalLoaded = true;
oc.stateActions.setHideRmaRework(true);
let liveView = oc.viewModel.getOperationsCenterView({
  records: oc.state.canonicalRows, hideRmaRework: oc.state.hideRmaRework
});
assert.equal(liveView.records.includes(returnReview), true);
returnReview.rmaReworkMembership = membership;
returnReview.workOrderApprovalReview.operationalRelationship = rmaPendingOperational;
liveView = oc.viewModel.getOperationsCenterView({
  records: oc.state.canonicalRows, hideRmaRework: oc.state.hideRmaRework
});
assert.equal(liveView.records.includes(returnReview), false,
  'authoritative membership refresh immediately removes an issued RMA when hiding is on');
oc.stateActions.setHideRmaRework(false);
liveView = oc.viewModel.getOperationsCenterView({
  records: oc.state.canonicalRows, hideRmaRework: oc.state.hideRmaRework
});
assert.equal(liveView.records.includes(returnReview), true,
  'toggle off restores the existing read-model row without a server request');
assert.equal(oc.viewModel.getWorkOrderPresentation(returnReview).label, 'Decision Pending',
  'with hiding off, issued RMA stays visible and updates to its RMA presentation');

assert.match(htmlSource, /id="operationsCenterRmaVisibilityToggle"/);
assert.match(htmlSource, /aria-pressed="false"/);
assert.match(tableSource, /projection\.getSummary\(getDisplayedRecords\(\), viewModel\)/,
  'Projection Mode consumes the common filtered read model');
assert.match(tableSource, /hiddenRmaReworkCount/);
assert.match(moduleSource, /subscribeOperationalLineStateChange/,
  'shared operational state events trigger the existing authoritative refresh path');
assert.match(moduleSource, /toggleOperationsCenterRmaVisibility/);

console.log('Operations Center Hide RMA/Rework authoritative visibility and composition tests: PASS');

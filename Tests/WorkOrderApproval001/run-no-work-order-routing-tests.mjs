import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const operationsContext = vm.createContext({ window: {
  OperationsCenter: {
    stateActions: { getOverlayRecord() { return {}; } },
    state: { masterRecords: [] }
  }
} });
vm.runInContext(read('SRC/modules/operations-center/operations-center-view-model.js'), operationsContext);
const operations = operationsContext.window.OperationsCenter.viewModel;
const noWorkOrderReview = {
  currentApproval: {
    decisionClassification: 'NO_WORK_ORDER_REQUIRED_COMPONENT',
    approvedWorkOrderNumber: null,
    decisionReasonCode: 'PART_COMPONENT_ONLY'
  },
  operationalRelationship: {
    activeWorkOrderNumber: null,
    operationalRoute: 'DIRECT_FULFILLMENT',
    operationalStatus: 'NO_WORK_ORDER_REQUIRED',
    workOrderDecision: 'No Work Order Required',
    reason: 'Part/Component Only',
    fulfillmentRequired: true,
    shippingRequired: true,
    productionWorkOrderRequired: false
  }
};
const operationsRecord = {
  workOrderRelationship: {
    status: 'AMBIGUOUS', candidateCount: 2,
    candidates: [{ workOrderNumber: '0115611' }, { workOrderNumber: '0115612' }]
  },
  workOrderApprovalReview: noWorkOrderReview
};
const presentation = operations.getWorkOrderPresentation(operationsRecord);
assert.equal(presentation.label, 'Not Required');
assert.equal(presentation.secondaryLabel, 'Part/Component Only · Direct Fulfillment · Approved');
assert.equal(presentation.actionable, false);

const kittingContext = vm.createContext({ window: {} });
vm.runInContext(read('SRC/workspaces/kitting/kitting-read-model.js'), kittingContext);
const kitting = kittingContext.window.KittingReadModel;
const line = {
  lineKey: '001238|0012090|090', customerNumber: '001238',
  customerName: 'KING NUTRONICS CORPORATION', salesOrderNumber: '0012090',
  salesOrderLineNumber: '090', itemNumber: '3666-292-1 REV A', quantityOrdered: 60,
  operationalQuantityOpen: 60, dueDate: '2026-07-24',
  relationship: operationsRecord.workOrderRelationship
};
const model = kitting.buildReadModel({
  lines: [line],
  approvalsByLineKey: new Map([[line.lineKey, noWorkOrderReview]])
});
assert.equal(model.directFulfillmentLines.length, 1);
assert.equal(model.directFulfillmentLines[0].lineKey, line.lineKey);
assert.equal(model.counts.directFulfillmentExcludedLines, 1);
assert.equal(model.queues.needsResolution.length, 0);
assert.equal(model.readyRows.length, 0, 'no production Work Order or kitting demand is invented');
assert.equal(kitting.collectActionableWorkOrderNumbers([line],
  new Map([[line.lineKey, noWorkOrderReview]])).length, 0);

const shipmentContext = vm.createContext({ window: {}, shipmentStagingState: { records: [] } });
vm.runInContext(read('SRC/modules/shipment-staging/shipment-staging-service.js'), shipmentContext);
const staged = shipmentContext.window.buildShipmentStagingRecordsFromShippingRequest({
  requestId: 'TEST-NO-WO', customerNumber: '001238', salesOrder: '0012090',
  requestedShipWindow: 'Today', lines: [{
    customerNumber: '001238', salesOrder: '0012090', salesOrderLine: '090',
    workOrder: '', workOrderDecision: 'No Work Order Required',
    assembly: '3666-292-1 REV A', qtyRequested: 60, openQuantity: 60
  }]
}, { processedTimestamp: '2026-08-05T20:00:00.000Z', shipmentId: 'TEST-SHIPMENT' });
assert.equal(staged.length, 1);
assert.equal(staged[0].workOrder, '', 'shipment staging preserves a null/blank Work Order');
assert.equal(staged[0].salesOrderLine, '090');
assert.equal(staged[0].quantityShipped, 60);

console.log('NO-WORK-ORDER-REQUIRED routing contract: PASS');

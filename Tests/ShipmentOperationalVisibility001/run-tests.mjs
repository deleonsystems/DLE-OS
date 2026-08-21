import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const line = (open = 100) => ({
  customerNumber: '001037', salesOrderNumber: '0012087', salesOrderLineNumber: '010',
  quantityOrdered: 100, erpQuantityOpen: open,
  masterRecordKey: '001037|0012087|010',
  vpro5: { customerNumber: '001037', salesOrder: '0012087', sequenceLine: '010', qtyOpen: String(open) }
});
const staged = (quantity, status = 'AWAITING_ERP_EVIDENCE', extra = {}) => ({
  customerNumber: '001037', salesOrder: '0012087', salesOrderLine: '010',
  quantityShipped: quantity, status, ...extra
});

const projectionContext = vm.createContext({ window: {} });
vm.runInContext(read('SRC/modules/shipment-staging/shipment-operational-projection.js'), projectionContext);
const projection = projectionContext.window.ShipmentOperationalProjection;

let result = projection.projectLine(line(), [staged(100)]);
assert.equal(result.operationalRemainingQuantity, 0);
assert.equal(result.stagedQuantity, 100);
assert.equal(result.isFullyStaged, true);
assert.equal(result.operationalRoute, 'SHIPMENT_RECONCILIATION');
assert.equal(result.operationalStatus, 'SHIPPED_AWAITING_ERP_EVIDENCE');
assert.equal(result.statusLabel, 'Shipped — Awaiting ERP Evidence');

result = projection.projectLine(line(), [staged(35)]);
assert.equal(result.operationalRemainingQuantity, 65, 'partial shipment preserves remaining workload');
assert.equal(result.isPartiallyStaged, true);

result = projection.projectLine(line(), [staged(35), staged(65, 'MATCH_REVIEW_REQUIRED')]);
assert.equal(result.stagedQuantity, 100, 'multiple active staged shipments aggregate');
assert.equal(result.operationalRemainingQuantity, 0);

result = projection.projectLine(line(), [staged(100, 'CANCELLED')]);
assert.equal(result.stagedQuantity, 0, 'cancelled staging restores operational demand');
assert.equal(result.operationalRemainingQuantity, 100);

result = projection.projectLine(line(), [staged(100, 'MISMATCH_EXCEPTION')]);
assert.equal(result.operationalRemainingQuantity, 0, 'physical exception remains staged outbound demand');

const confirmed = staged(60, 'ERP_CONFIRMED', { canonicalOpenQuantityAtShipment: 100 });
assert.equal(projection.projectLine(line(100), [confirmed]).operationalRemainingQuantity, 40,
  'confirmed shipment remains excluded before canonical open quantity changes');
result = projection.projectLine(line(40), [confirmed]);
assert.equal(result.recognizedConfirmedQuantity, 60);
assert.equal(result.deductibleStagedQuantity, 0);
assert.equal(result.operationalRemainingQuantity, 40,
  'canonical ERP reduction is not subtracted a second time');

assert.equal(projection.validateShipmentQuantity(line(), 101, []).valid, false,
  'staged quantity cannot exceed operational remaining quantity');
assert.equal(projection.validateShipmentQuantity(line(), 40, [staged(60)]).valid, true);
assert.equal(projection.validateShipmentQuantity(line(), 41, [staged(60)]).valid, false);

const shipmentStagingState = { records: [staged(100)] };
const operationsWindow = {
  ShipmentOperationalProjection: projection,
  OperationsCenter: {
    state: { canonicalLoaded: true, canonicalRows: [line()] }
  }
};
const operationsContext = vm.createContext({ window: operationsWindow, shipmentStagingState });
vm.runInContext(read('SRC/modules/operations-center/operations-center-view-model.js'), operationsContext);
const operations = operationsWindow.OperationsCenter.viewModel;
assert.equal(operations.getOperationsCenterRecords().length, 0,
  'fully staged line is absent from default Operations Center workload');

shipmentStagingState.records = [staged(60)];
assert.equal(operations.getOperationsCenterRecords().length, 1);
assert.equal(operations.getOfficialField(line(), 'opQtyOpen'), '40');
assert.equal(operations.getOfficialField(line(), 'pendingInvoiceQty'), '60');

operationsWindow.OperationsCenter.state.canonicalRows = [{ ...line(), rmaReworkMembership: { caseId: 'RMA-1' } }];
shipmentStagingState.records = [staged(100)];
assert.equal(operations.getOperationsCenterRecords().length, 1,
  'active RMA/Rework precedence remains ahead of shipment suppression');

const kittingContext = vm.createContext({ window: {} });
vm.runInContext(read('SRC/workspaces/kitting/kitting-read-model.js'), kittingContext);
const kitting = kittingContext.window.KittingReadModel;
const kittingLine = {
  lineKey: '001037|0012087|010', customerNumber: '001037', customerName: 'Meggitt',
  salesOrderNumber: '0012087', salesOrderLineNumber: '010', itemNumber: '160192 REV NC',
  operationalQuantityOpen: 0, relationship: { status: 'UNRESOLVED', candidates: [] }
};
kittingLine.shipmentOperationalRoute = 'SHIPMENT_RECONCILIATION';
kittingLine.shipmentOperationalStatus = 'SHIPPED_AWAITING_ERP_EVIDENCE';
let model = kitting.buildReadModel({ lines: [kittingLine] });
assert.equal(model.shipmentReconciliationLines.length, 1);
assert.equal(model.queues.needsResolution.length, 0, 'fully staged line produces no ordinary kitting work');
model = kitting.buildReadModel({
  lines: [kittingLine],
  rmaReworkByLineKey: new Map([[kittingLine.lineKey, { caseId: 'RMA-1', caseStatus: 'ACTIVE' }]])
});
assert.equal(model.queues.rmaRework.length, 1, 'RMA precedence is preserved in Kitting');

const dashboardSource = read('SRC/modules/sales-order-dashboard/sales-order-dashboard.js');
assert.match(dashboardSource, /function getRelatedRows\(\)[\s\S]*return rows\.filter\(row => isRmaControlledRow\(row\) \|\| !getShipmentProjection\(row\)\.isFullyStaged\)/,
  'Sales Order Dashboard active rows apply the shared staging projection');
assert.match(dashboardSource, /shipmentProjection\.operationalRemainingQuantity/,
  'Request to Ship uses operational remaining quantity');
const shippingSource = read('SRC/modules/shipping/shipping-workspace.js');
assert.match(shippingSource, /validateShipmentQuantity/);
assert.match(shippingSource, /requested quantity exceeds the current operational remaining quantity/);
assert.match(read('SRC/modules/shipment-staging/shipment-staging-service.js'),
  /shipment-staging-read-model-change/,
  'shipment changes continue publishing the exact-line shared event');
assert.match(read('DLE_Work_Center_v4.0.0.html'), /shipment-operational-projection\.js/);

console.log('Post-shipment operational visibility contract: PASS (full, partial, aggregate, cancellation, confirmation, RMA, Kitting, events)');

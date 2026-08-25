import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const canonicalRow = {
  masterRecordKey: '100001|0000001|010',
  customerNumber: '100001',
  salesOrderNumber: '0000001',
  salesOrderLineNumber: '010',
  erpQuantityOpen: 3,
  workOrderRelationship: {
    status: 'EXACT_LINE_UNIQUE', actionableWorkOrderNumber: '0115000', candidates: []
  },
  vpro5: {
    customer: 'Qualified Customer', salesOrder: '0000001', sequenceLine: '010',
    partNumber: 'ASM-1', dueDate: '08/31/26', extendedPrice: '300.00'
  }
};

const elements = new Map();
const timers = [];
let projectionActive = true;
let enrichmentHealthy = false;
let verifiedReads = 0;
const context = vm.createContext({
  console,
  structuredClone,
  fetch,
  document: {
    addEventListener() {},
    getElementById(id) { return elements.get(id) || null; }
  },
  window: {
    confirm() { throw new Error('A degraded read must not prompt for a write.'); },
    alert() { throw new Error('Unexpected alert.'); },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
    DleApiClient: { liveCanonical: {} },
    OperationsCenter: {
      projection: {
        initialize() {}, isActive: () => projectionActive,
        setActive(value) { projectionActive = !!value; }, toggleActive() { projectionActive = !projectionActive; }
      },
      table: { renderModule() {} },
      dataService: {
        async loadCanonicalRows() {
          return { rows: [{ ...canonicalRow }], totalItems: 1, source: 'DLE_OS_CANONICAL_LIVE', endpoint: '/api/platform/live/v1/sales-orders' };
        },
        async loadOperationalEnrichment(result) {
          if (!enrichmentHealthy) throw new Error('The governed development service is temporarily unavailable.');
          return { ...result, rows: result.rows.map(row => ({ ...row, workOrderApprovalReview: { operationalRelationship: { operationalRoute: 'NORMAL_PRODUCTION', activeWorkOrderNumber: '0115000' } }, materialStatus: { label: 'Kit Complete' } })) };
        }
      },
      verifiedStatusService: { async loadLatestForRows() { verifiedReads += 1; } }
    }
  }
});

vm.runInContext(read('SRC/modules/operations-center/operations-center-state.js'), context);
vm.runInContext(read('SRC/modules/operations-center/operations-center.js'), context);

await context.window.refreshOperationsCenterCanonicalData();
const state = context.window.OperationsCenter.state;
assert.equal(state.canonicalLoaded, true, 'healthy canonical rows commit before enrichment');
assert.equal(state.canonicalRows.length, 1, '5054 failure does not discard canonical rows');
assert.equal(state.operationalEnrichmentAvailable, false, '5054 failure has an explicit unavailable state');
assert.match(state.operationalEnrichmentError, /temporarily unavailable/);
assert.equal(projectionActive, false, 'Projection Mode fails closed');
assert.equal(verifiedReads, 0, 'Verified Status is not read while 5054 is unavailable');
assert.equal(context.window.toggleOperationsCenterProjectionMode(), false, 'Projection cannot be enabled while degraded');
assert.equal(context.window.toggleOperationsCenterRmaVisibility(), false, 'RMA filtering cannot imply a complete membership set');
assert.equal(await context.window.startSyncOperations(), false, 'Sync Operations cannot issue a write while degraded');

enrichmentHealthy = true;
const retry = timers.shift();
assert.equal(typeof retry, 'function', 'degraded mode schedules a read-only enrichment retry');
retry();
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
assert.equal(state.operationalEnrichmentAvailable, true, 'healthy enrichment automatically restores full state');
assert.equal(state.canonicalRows[0].materialStatus.label, 'Kit Complete');
assert.equal(verifiedReads, 1, 'Verified Status resumes only after full enrichment succeeds');

const viewContext = vm.createContext({
  console,
  window: { OperationsCenter: {}, shipmentStagingState: { records: [{ masterRecordKey: canonicalRow.masterRecordKey, stagedQuantity: 3 }] } }
});
['operations-center-state.js', 'operations-center-view-model.js'].forEach(file =>
  vm.runInContext(read('SRC/modules/operations-center/' + file), viewContext));
const oc = viewContext.window.OperationsCenter;
oc.state.canonicalLoaded = true;
oc.state.canonicalRows = [{ ...canonicalRow }];
oc.state.operationalEnrichmentAvailable = false;
assert.equal(oc.viewModel.getOperationsCenterRecords().length, 1, 'unknown Shipment Staging state cannot hide a canonical row');
assert.equal(oc.viewModel.getOfficialField(canonicalRow, 'erpQtyOpen'), '3', 'canonical ERP quantity remains visible');
assert.equal(oc.viewModel.getOfficialField(canonicalRow, 'opQtyOpen'), 'Unavailable', 'operational quantity is not replaced with canonical quantity');
assert.equal(oc.viewModel.getOfficialField(canonicalRow, 'materialStatus'), 'Unavailable', 'missing Material Status is explicit');
assert.equal(oc.viewModel.getWorkOrderPresentation(canonicalRow).status, 'OPERATIONAL_UNAVAILABLE', 'canonical WO evidence is not treated as an operational routing decision');
assert.equal(oc.viewModel.getVerifiedStatusPresentation(canonicalRow).unavailable, true, 'Verified Status is not represented as empty');

const tableSource = read('SRC/modules/operations-center/operations-center-table.js');
const markup = read('SRC/modules/operations-center/operations-center.html');
assert.match(markup, /operationsCenterServiceAvailability/);
assert.match(tableSource, /Limited operational services/);
assert.match(tableSource, /Projection Mode is unavailable/);
assert.match(tableSource, /RMA\/Rework membership is unavailable/);

console.log('Operations Center degraded canonical-read and automatic recovery contracts: PASS');

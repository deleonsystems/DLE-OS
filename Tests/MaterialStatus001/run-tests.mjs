import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const listeners = new Map();
const calls = [];
const cases = new Map();
const responses = new Map();
const window = {
  DleApiClient: {
    async getKittingCase(workOrderNumber) {
      calls.push(workOrderNumber);
      return responses.get(workOrderNumber) || { kittingCase: cases.get(workOrderNumber) || null };
    }
  },
  addEventListener(name, handler) { listeners.set(name, handler); },
  removeEventListener(name) { listeners.delete(name); },
  dispatchEvent(event) { listeners.get(event.type)?.(event); }
};
class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
const context = { window, CustomEvent, Map, Set, Object, Promise, Number, String, Array };
vm.createContext(context);
vm.runInContext(fs.readFileSync('SRC/shared/material-status.js', 'utf8'), context);

const projection = window.MaterialStatus;
assert.equal(projection.project('115621', null, true).machineValue, 'NEEDS_KITTING');
for (const [state, label] of [
  ['KITTING_IN_PROGRESS', 'Kitting In Progress'],
  ['KIT_SHORT', 'Kit Short'],
  ['KIT_COMPLETE', 'Kit Complete']
]) {
  const value = projection.project('0115621', { state, runNumber: 2 }, true);
  assert.equal(value.machineValue, state);
  assert.equal(value.label, label);
  assert.equal(value.source, 'KITTING_CASE');
}
assert.equal(projection.project('0115621', null, false), null);
assert.equal((await projection.get('115621')).machineValue, 'NEEDS_KITTING');
assert.equal((await projection.get('0115621')).machineValue, 'NEEDS_KITTING');
assert.equal(calls.length, 1, 'Normalized equivalent Work Orders must share one cache entry.');
cases.set('0115621', { state: 'KITTING_IN_PROGRESS', runNumber: 2, workingVersion: 1 });
projection.invalidate('0115621');
assert.equal((await projection.get('0115621')).machineValue, 'KITTING_IN_PROGRESS');
let notifiedAfterSilentInvalidation = false;
const unsubscribe = projection.subscribe(() => { notifiedAfterSilentInvalidation = true; });
projection.invalidate('0115621', { notify: false });
assert.equal(notifiedAfterSilentInvalidation, false, 'Silent invalidation must not trigger a duplicate queue refresh.');
assert.equal((await projection.get('0115621', { force: true })).machineValue, 'KITTING_IN_PROGRESS');
unsubscribe();
assert.equal(projection.publish('0115621', { state: 'KIT_SHORT', runNumber: 2 }).machineValue, 'KIT_SHORT');
responses.set('0001001', { kittingCase: null, hasPersistentKittingHistory: false,
  legacyMaterialStatus: { machineValue: 'KIT_COMPLETE', source: 'LEGACY_KITTING_PDF' } });
assert.equal((await projection.get('1001')).machineValue, 'KIT_COMPLETE');
assert.equal((await projection.get('1001')).source, 'LEGACY_KITTING_PDF');
responses.set('0001002', { kittingCase: null, hasPersistentKittingHistory: true,
  legacyMaterialStatus: { machineValue: 'KIT_COMPLETE', source: 'LEGACY_KITTING_PDF' } });
assert.equal((await projection.get('1002')).machineValue, 'NEEDS_KITTING');
assert.equal((await projection.get('1002')).source, 'KITTING_CASE_HISTORY');

const operationsFields = fs.readFileSync('SRC/modules/operations-center/operations-center-fields.js', 'utf8');
const operationsData = fs.readFileSync('SRC/modules/operations-center/operations-center-data-service.js', 'utf8');
const salesHtml = fs.readFileSync('SRC/modules/sales-order-dashboard/sales-order-dashboard.html', 'utf8');
const sales = fs.readFileSync('SRC/modules/sales-order-dashboard/sales-order-dashboard.js', 'utf8');
const kitting = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.js', 'utf8');
const readModel = fs.readFileSync('SRC/workspaces/kitting/kitting-read-model.js', 'utf8');
const workOrderHtml = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.html', 'utf8');
const workOrder = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.js', 'utf8');
const shell = fs.readFileSync('DLE_Work_Center_v4.0.0.html', 'utf8');

assert.match(shell, /SRC\/shared\/material-status\.js/);
assert.match(operationsFields, /materialStatus.*Material Status/);
assert.doesNotMatch(operationsFields, /key: 'status', label: 'STATUS'/);
assert.match(operationsData, /MaterialStatus.*getMany|projection\.getMany/);
assert.match(salesHtml, /salesOrderSummaryMaterialStatus/);
assert.match(salesHtml, /<th>Material Status<\/th>/);
assert.match(sales, /Multiple Work Orders — see line status/);
assert.match(kitting, /<th>Material Status<\/th>/);
assert.match(readModel, /materialStatusesByWorkOrder/);
assert.doesNotMatch(readModel, /disposition\.currentDisposition === "KIT_SHORT"/);
assert.match(workOrderHtml, /workOrderDashboardMaterialStatus/);
assert.match(workOrder, /MaterialStatus\?\.publish/);
assert.match(workOrderHtml, /Legacy Manual Kitting Disposition History/);
assert.match(workOrderHtml, /Legacy events remain read-only/);
assert.doesNotMatch(workOrder, /Manual disposition is authoritative/);
console.log('Material Status shared projection and four-surface contracts: PASS');

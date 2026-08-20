import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = vm.createContext({
  console,
  structuredClone,
  window: {
    OperationsCenter: {},
    shipmentStagingState: { records: [] }
  }
});

[
  'SRC/modules/operations-center/operations-center-fields.js',
  'SRC/modules/operations-center/operations-overlay-schema.js',
  'SRC/modules/operations-center/operations-center-state.js',
  'SRC/modules/operations-center/operations-center-view-model.js'
].forEach(file => vm.runInContext(read(file), context, { filename: file }));

const oc = context.window.OperationsCenter;
const primaryOfficial = oc.officialColumns.filter(column => !column.diagnostic).map(column => column.key);
const primaryOverlay = oc.overlayFields.filter(field => field.tablePlacement === 'primary').map(field => field.key);
assert.equal(JSON.stringify(primaryOfficial.concat(primaryOverlay)), JSON.stringify([
  'orderDate',
  'customer',
  'customerPo',
  'salesOrder',
  'sequenceLine',
  'workOrder',
  'partNumber',
  'description',
  'opQtyOpen',
  'dueDate',
  'price',
  'extendedPrice',
  'materialStatus',
  'operationalStatus',
  'holdIssue'
]),
  'manager-first table scan order is preserved');

assert.equal(JSON.stringify(oc.officialColumns.filter(column => column.diagnostic).map(column => column.key)), JSON.stringify([
  'quantityOrdered',
  'erpQtyOpen',
  'pendingInvoiceQty'
]),
  'secondary ERP/detail columns remain available after the primary scan');

const production = oc.officialColumns.find(column => column.key === 'operationalStatus');
assert.equal(production.label, 'Production Status', 'existing overlay-backed status is manager-facing Production Status');
const special = oc.overlayFields.find(field => field.key === 'holdIssue');
assert.equal(special.label, 'Special Request / Issue', 'Hold/Issue is manager-facing free text');
assert.equal(special.tablePlacement, 'primary', 'Special Request / Issue remains in the primary scan');
assert.ok(!special.documentLink, 'Special Request / Issue is not a governed dropdown or document link');
assert.ok(oc.overlaySchema.persistedFieldKeys.includes('holdIssue'), 'Special Request / Issue persists through existing overlay key');
assert.ok(oc.overlaySchema.persistedFieldKeys.includes('operationalStatus'), 'Production Status preserves existing overlay storage');

const record = {
  masterRecordKey: '565650|12009|220',
  vpro5: {
    customer: 'ACME Aero',
    customerPo: 'PO-7788',
    salesOrder: '12009',
    sequenceLine: '220',
    workOrder: '0115621',
    qtyOpen: '9',
    partNumber: 'ASM-100',
    description: 'Actuator Assembly',
    dueDate: '08/29/26',
    price: '125.5',
    extendedPrice: '1129.5'
  },
  erpQuantityOpen: 9,
  materialStatus: { label: 'Kit Complete' },
  workOrderRelationship: { status: 'EXACT_LINE_UNIQUE', actionableWorkOrderNumber: '0115621', candidates: [] },
  dle: { operationalStatus: '' }
};
oc.state.canonicalLoaded = true;
oc.state.canonicalRows = [record];
oc.stateActions.updateOverlayField(record.masterRecordKey, 'holdIssue', 'Expedite customer request');

assert.equal(oc.viewModel.getOfficialField(record, 'partNumber'), 'ASM-100', 'Item Number uses existing item field');
assert.equal(oc.viewModel.getOfficialField(record, 'description'), 'Actuator Assembly', 'Description uses existing description field');
assert.equal(oc.viewModel.getOfficialField(record, 'opQtyOpen'), '9', 'Qty Open uses existing operational open quantity semantics');
assert.equal(oc.viewModel.getOfficialField(record, 'price'), '125.5', 'Unit Price uses existing value');
assert.equal(oc.viewModel.getOfficialField(record, 'extendedPrice'), '1129.5', 'Extended Price uses existing value');
assert.equal(oc.viewModel.getOfficialField(record, 'materialStatus'), 'Kit Complete', 'Material Status uses existing shared projection label');
assert.equal(oc.viewModel.getOfficialField(record, 'operationalStatus'), '', 'Production Status defaults to existing blank overlay value');

const searched = oc.viewModel.getOperationsCenterView({ records: [record], searchTerms: ['Kit Complete', 'Expedite'] });
assert.equal(searched.records.length, 1, 'search still includes material status and overlay issue text');
assert.equal(oc.viewModel.getOperationsCenterView({ records: [record], searchTerms: ['ASM-100'] }).records.length, 1,
  'search still includes item identity');
assert.equal(oc.viewModel.getOperationsCenterView({ records: [record], searchTerms: ['Actuator Assembly'] }).records.length, 1,
  'search still includes description text');

const tableSource = read('SRC/modules/operations-center/operations-center-table.js');
assert.match(tableSource, /primaryOfficial\.concat\(primaryOverlay, secondaryOfficial, secondaryOverlay\)/,
  'table renderer places primary manager fields before secondary details');
assert.match(tableSource, /renderOverlayCell\(field, record, masterRecordKey\)/,
  'overlay free text remains editable through the shared renderer');
assert.match(tableSource, /isReturnReviewControlled\(record\) && isOrdinaryProductionOverlay\(field\.key\)/,
  'RMA/Rework suppression is preserved for ordinary production overlay fields');

console.log('Operations Center manager-first table contracts: PASS');

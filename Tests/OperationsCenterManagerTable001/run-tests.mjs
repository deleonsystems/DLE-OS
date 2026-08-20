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
    DleOperatorHeader: { factoryTimeZone: 'America/Los_Angeles' },
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
  'verifiedStatus',
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
const productionShipping = oc.overlayFields.find(field => field.key === 'productionShipping');
assert.equal(productionShipping.label, 'Production / Shipping',
  'Production / Shipping remains an editable Operations Overlay field');
assert.ok(oc.overlaySchema.persistedFieldKeys.includes('productionShipping'),
  'Production / Shipping preserves its existing overlay contract');
assert.equal(JSON.stringify(oc.overlayFields.filter(field =>
  ['kitShort', 'purchasingComplete', 'kitComplete'].includes(field.key))), '[]',
  'legacy browser document-link columns are removed');
const verifiedStatus = oc.officialColumns.find(column => column.key === 'verifiedStatus');
assert.equal(verifiedStatus.label, 'Last Verified Status', 'latest append-only status has a manager-facing column');
assert.equal(verifiedStatus.className, 'operations-center-verified-status-cell',
  'Last Verified Status uses its compact desktop presentation');
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

const masonRecord = { masterRecordKey: '549250|0012084|010' };
const abbott115620Record = { masterRecordKey: '001082|0012097|050' };
const abbott115586Record = { masterRecordKey: '001082|0012067|040' };
oc.stateActions.setVerifiedStatusRecords([{
  eventId: '2624FEC9-DB5A-4505-BC62-1B2F9223A80E',
  masterRecordKey: masonRecord.masterRecordKey,
  statusText: 'Ready to ship, qty 9, in shipping',
  recordedBy: 'Miguel',
  recordedAtUtc: '2026-08-20T20:25:47.01',
  requestCorrelationId: 'F06F3072-8DEB-439C-A6EF-39CD4BADC253'
}, {
  masterRecordKey: abbott115620Record.masterRecordKey,
  statusText: 'In SMT … on hold pers cust',
  recordedBy: 'Miguel',
  recordedAtUtc: '2026-08-20T20:30:22.232'
}, {
  masterRecordKey: abbott115586Record.masterRecordKey,
  statusText: 'Ready to ship qty 10 in shipping',
  recordedBy: 'Miguel',
  recordedAtUtc: '2026-08-20T20:39:04.835'
}]);
const masonStatus = oc.viewModel.getVerifiedStatusPresentation(masonRecord);
assert.equal(masonStatus.statusText, 'Ready to ship, qty 9, in shipping',
  'Mason Electric row resolves the proven latest status text');
assert.equal(masonStatus.recordedBy, 'Miguel',
  'Mason Electric row resolves the authenticated recorder');
assert.equal(masonStatus.recordedAtUtc, '2026-08-20T20:25:47.01',
  'Mason Electric row preserves the API-projected UTC timestamp');
assert.equal(masonStatus.timeLabel, 'Aug 20, 1:25 PM',
  'zone-less SQL datetime2 JSON is interpreted as UTC and displayed in Pacific daylight time');
assert.equal(oc.viewModel.getVerifiedStatusPresentation(abbott115620Record).timeLabel, 'Aug 20, 1:30 PM',
  'WO 115620 displays its live DEV event in Pacific daylight time');
assert.equal(oc.viewModel.getVerifiedStatusPresentation(abbott115586Record).timeLabel, 'Aug 20, 1:39 PM',
  'WO 115586 displays its live DEV event in Pacific daylight time');

oc.stateActions.setVerifiedStatusRecords([{
  masterRecordKey: 'winter-test',
  statusText: 'Winter test',
  recordedBy: 'Miguel',
  recordedAtUtc: '2026-01-20T21:25:47.010'
}]);
const winterStatus = oc.viewModel.getVerifiedStatusPresentation({ masterRecordKey: 'winter-test' });
assert.equal(winterStatus.timeLabel, 'Jan 20, 1:25 PM',
  'winter Verified Status timestamps display in Pacific standard time without a fixed offset');

const searched = oc.viewModel.getOperationsCenterView({ records: [record], searchTerms: ['Kit Complete', 'Expedite'] });
assert.equal(searched.records.length, 1, 'search still includes material status and overlay issue text');
assert.equal(oc.viewModel.getOperationsCenterView({ records: [record], searchTerms: ['ASM-100'] }).records.length, 1,
  'search still includes item identity');
assert.equal(oc.viewModel.getOperationsCenterView({ records: [record], searchTerms: ['Actuator Assembly'] }).records.length, 1,
  'search still includes description text');

const tableSource = read('SRC/modules/operations-center/operations-center-table.js');
const operationsMarkup = read('SRC/modules/operations-center/operations-center.html');
const operationsStyles = read('SRC/modules/operations-center/operations-center.css');
const operationsModule = read('SRC/modules/operations-center/operations-center.js');
const applicationHost = read('DLE_Work_Center_v4.0.0.html');
const kittingWorkspace = read('SRC/workspaces/kitting/kitting-workspace.js');
assert.match(tableSource, /primaryOfficial\.concat\(primaryOverlay, secondaryOfficial, secondaryOverlay\)/,
  'table renderer places primary manager fields before secondary details');
assert.match(tableSource, /renderOverlayCell\(field, record, masterRecordKey\)/,
  'overlay free text remains editable through the shared renderer');
assert.match(tableSource, /column\.key === 'verifiedStatus'[\s\S]*renderVerifiedStatusCell\(record, masterRecordKey, className\)/,
  'desktop table renders the projected status through the intentional status cell');
assert.match(tableSource, /\[status\.recordedBy, status\.timeLabel\]/,
  'desktop table uses the shared Verified Status presentation timestamp');
assert.match(tableSource, /operations-center-verified-status-empty">&mdash;<\/span>/,
  'rows without a Verified Status remain visually quiet');
assert.match(tableSource, /onclick="openOperationsCenterVerifiedStatusLogger\(event\)"/,
  'desktop status cell preserves the deliberate append-only logging interaction');
assert.match(tableSource, /isReturnReviewControlled\(record\) && isOrdinaryProductionOverlay\(field\.key\)/,
  'RMA/Rework suppression is preserved for ordinary production overlay fields');
assert.doesNotMatch(tableSource, /renderDocumentLinkCell|documentLinks|getDocumentState/,
  'desktop renderer no longer contains the browser document-link branch');
assert.doesNotMatch(operationsMarkup,
  /operationsCenterDocumentType|connectOperationsCenterDocumentFolder|operationsCenterDocumentStatus/,
  'legacy document selector, connection button, and folder status are removed');
assert.match(operationsMarkup, /id="operationsCenterSaveButton"/,
  'Operations Overlay Save remains available');
assert.match(operationsMarkup, /id="operationsCenterSaveStatus"[^>]*>No unsaved changes\./,
  'Operations Overlay save feedback remains available');
assert.doesNotMatch(operationsMarkup, /Daily operational workspace built from governed canonical Sales Orders/,
  'desktop workspace subtitle is removed');
assert.match(operationsMarkup,
  /class="operations-center-toolbar"[\s\S]*refreshOperationsCenterCanonicalData\(\)[\s\S]*id="operationsCenterSourceStatus"[\s\S]*id="operationsCenterSaveButton"[\s\S]*id="operationsCenterSaveStatus"[\s\S]*class="operations-center-search-row"[\s\S]*id="operationsCenterSearch"[\s\S]*id="operationsCenterStatus"/,
  'search and count occupy the lower row while source/save feedback remains grouped with its action');
assert.match(tableSource, /status\.textContent = records\.length \+ ' records shown';/,
  'operator-facing record count is derived from the displayed records');
assert.doesNotMatch(tableSource, /requiring action shown from|Overlay records:/,
  'diagnostic canonical and overlay counts are absent from the normal toolbar');
assert.match(tableSource, /function filter\(\) \{\s*renderStatus\(\);/,
  'search and filter changes continue to refresh the displayed record count');
assert.match(operationsStyles, /\.operations-center-search-row \{[\s\S]*margin-bottom: 8px;/,
  'search row uses compact desktop spacing');
assert.match(operationsStyles,
  /\.operations-center-panel:has\(> \.operations-center-mobile-view:not\(\[hidden\]\)\) \.operations-center-search-row/,
  'desktop search row remains hidden when the dedicated Mobile View is active');
assert.doesNotMatch(operationsModule,
  /populateOperationsCenterDocumentTypes|connectOperationsCenterDocumentFolder|openOperationsCenterDocumentLink/,
  'legacy document selector and open handlers are removed');
assert.doesNotMatch(applicationHost, /operations-document-links\.js/,
  'the removed browser document-link script is no longer loaded');
assert.doesNotMatch(kittingWorkspace, /OperationsCenter\?\.documentLinks|getDocumentState\("kit(?:Short|Complete)"/,
  'Kitting no longer couples its read model to the removed browser folder index');

console.log('Operations Center manager-first table contracts: PASS');

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
  'SRC/modules/shipment-staging/shipment-operational-projection.js',
  'SRC/modules/operations-center/operations-center-fields.js',
  'SRC/modules/operations-center/operations-center-state.js',
  'SRC/modules/operations-center/operations-center-view-model.js'
].forEach(file => vm.runInContext(read(file), context, { filename: file }));

const oc = context.window.OperationsCenter;
function row(line, dueDate, qtyOpen = '5', overrides = {}) {
  return {
    masterRecordKey: '001148|0012006|' + line,
    erpQuantityOpen: Number(qtyOpen),
    vpro5: {
      customerNumber: '001148', customer: 'HUGHEY & PHILLIPS', customerPo: 'HP00194880',
      salesOrder: '0012006', sequenceLine: line, workOrder: '0115511', qtyOpen,
      partNumber: '277-3261', description: 'ASSY 1 POWER SUPPLY', dueDate
    },
    workOrderRelationship: { status: 'EXACT_LINE_UNIQUE', actionableWorkOrderNumber: '0115511', candidates: [] },
    ...overrides
  };
}
const rows = [
  row('190', '12/01/26'),
  row('150', '10/01/26'),
  row('110', '07/08/26'),
  row('170', '11/02/26'),
  row('130', '09/01/26')
];
oc.state.canonicalLoaded = true;
oc.state.canonicalRows = rows;
let groups = oc.viewModel.getWorkOrderGroups(rows);
assert.equal(groups.length, 1, 'WO 115511 collapses to one work-order group');
let group = groups[0];
assert.equal(group.workOrderNumber, '0115511');
assert.equal(group.lineCount, 5, 'WO 115511 has five active lines');
assert.equal(group.groupedOpenQuantity, '25', 'WO 115511 grouped positive operational open quantity is 25');
assert.equal(oc.viewModel.getOfficialField(group.primaryRecord, 'salesOrder'), '0012006');
assert.equal(oc.viewModel.getOfficialField(group.primaryRecord, 'sequenceLine'), '110',
  'default representative line is earliest due, then SO, then line');
assert.equal(JSON.stringify(group.records.map(record => oc.viewModel.getOfficialField(record, 'sequenceLine'))),
  JSON.stringify(['110', '130', '150', '170', '190']), 'line mode sorts by due date, SO, line');

oc.stateActions.setVerifiedStatusRecords([], [{
  workOrderNumber: '115511', statusText: 'In assembly, batch moving together',
  recordedBy: 'Miguel', recordedAtUtc: '2026-08-21T16:00:00'
}]);
for (const record of rows) {
  const status = oc.viewModel.getVerifiedStatusPresentation(record);
  assert.equal(status.statusText, 'In assembly, batch moving together');
  assert.equal(status.inherited, true, 'line inherits the WO-level status by default');
}
group = oc.viewModel.getWorkOrderGroups(rows)[0];
assert.equal(group.statusPresentation.statusText, 'In assembly, batch moving together');
assert.equal(group.mixed, false);
assert.equal(group.overrideCount, 0);

oc.stateActions.setVerifiedStatusRecords([{ masterRecordKey: '001148|0012006|150',
  statusText: 'Line 150 held for customer review', recordedBy: 'Miguel', recordedAtUtc: '2026-08-21T16:05:00' }], [{
  workOrderNumber: '0115511', statusText: 'In assembly, batch moving together', recordedBy: 'Miguel', recordedAtUtc: '2026-08-21T16:00:00'
}]);
assert.equal(oc.viewModel.getVerifiedStatusPresentation(rows.find(record => record.masterRecordKey.endsWith('|150'))).inherited, false,
  'line override is explicit for the selected SO line');
assert.equal(oc.viewModel.getVerifiedStatusPresentation(rows.find(record => record.masterRecordKey.endsWith('|130'))).inherited, true,
  'sibling line still inherits WO default');
group = oc.viewModel.getWorkOrderGroups(rows)[0];
assert.equal(group.overrideCount, 1, 'one explicit line override is counted');
assert.equal(group.mixed, true, 'group becomes MIXED when effective line states differ');
assert.equal(group.statusPresentation.statusText, 'MIXED');

oc.stateActions.setVerifiedStatusRecords([], [{
  workOrderNumber: '0115511', statusText: 'In assembly, batch moving together', recordedBy: 'Miguel', recordedAtUtc: '2026-08-21T16:00:00'
}]);
group = oc.viewModel.getWorkOrderGroups(rows)[0];
assert.equal(group.overrideCount, 0, 'clearing/superseding the override returns lines to inherited behavior in the effective model');
assert.equal(group.mixed, false);

const duplicateRows = rows.concat([{ ...rows[0] }]);
assert.equal(oc.viewModel.getWorkOrderGroups(duplicateRows)[0].groupedOpenQuantity, '25',
  'duplicate relationship/source rows do not double-count quantity');
const rmaRows = [
  row('100', '07/08/26', '6', { masterRecordKey: '001037|0012009|100' }),
  row('105', '07/09/26', '-6', { masterRecordKey: '001037|0012009|105' })
];
rmaRows.forEach(record => { record.vpro5.workOrder = '0115999'; });
const rmaGroup = oc.viewModel.getWorkOrderGroups(rmaRows)[0];
assert.equal(rmaGroup.groupedOpenQuantity, '6', 'RMA +6/-6 does not net to a misleading grouped Qty 0');
assert.equal(rmaGroup.hasQuantityException, true, 'negative/credit line is surfaced as a quantity exception');

const operationsModule = read('SRC/modules/operations-center/operations-center.js');
const apiClient = read('SRC/api/dle-api-client.js');
const server = read('Tools/LiveSnapshotRefresh/ControlHost/OperationsCenterVerifiedStatusCenter.cs');
const migration = read('Tools/OperationsCenter/Database/002_AddWorkOrderVerifiedStatusEvent.sql');
const styles = read('SRC/modules/operations-center/operations-center.css');
assert.ok(operationsModule.includes("WO ' + escapeOptionText(group.workOrderNumber.replace"), 'mobile card presents compact WO identity first');
assert.ok(operationsModule.includes("'<span>Qty ' + escapeOptionText(group.groupedOpenQuantity)"), 'mobile card shows grouped quantity');
assert.match(operationsModule, /openOperationsCenterLineVerifiedStatusLogger/, 'mobile detail exposes individual line override mode');
assert.match(styles, /operations-center-mobile-line/, 'line override controls have compact mobile styling');
assert.ok(apiClient.includes("work-orders/verified-statuses/latest"), 'API client can load WO-level default statuses');
assert.match(apiClient, /appendOperationsCenterWorkOrderVerifiedStatus/, 'API client can append WO-level status events');
assert.ok(server.includes('.RequireAuthorization(policy)'), 'WO endpoints remain under governed authorization');
assert.ok(server.includes('TrustedDevelopmentIdentity.RequireActorName'), 'WO append records authenticated actor identity');
assert.ok(server.includes('OperationsCenterWorkOrderVerifiedStatusEvent'), 'server uses a distinct append-only WO event model');
assert.ok(migration.includes('UQ_OperationsCenterWorkOrderVerifiedStatusEvent_Correlation'), 'WO event migration keeps idempotent correlation constraint');
assert.ok(migration.includes('WorkOrderNumber nvarchar(7) NOT NULL'), 'WO event migration keys defaults by normalized work order');

console.log('Operations Center work-order verified status grouping contracts: PASS');

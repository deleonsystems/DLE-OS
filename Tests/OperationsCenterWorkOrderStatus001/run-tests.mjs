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
  'SRC/modules/operations-center/operations-center-view-model.js',
  'SRC/modules/operations-center/operations-verified-status-service.js'
].forEach(file => vm.runInContext(read(file), context, { filename: file }));

const oc = context.window.OperationsCenter;
function row(line, dueDate, qtyOpen = '5', overrides = {}) {
  const record = {
    masterRecordKey: '001148|0012006|' + line,
    erpQuantityOpen: Number(qtyOpen),
    vpro5: {
      customerNumber: '001148', customer: 'HUGHEY & PHILLIPS', customerPo: 'HP00194880',
      salesOrder: '0012006', sequenceLine: line, workOrder: '', qtyOpen,
      partNumber: '277-3261', description: 'ASSY 1 POWER SUPPLY', dueDate
    },
    workOrderRelationship: {
      status: 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE', actionableWorkOrderNumber: '', candidateCount: 1,
      candidates: [{ workOrderNumber: '0115511', itemNumber: '277-3261' }]
    },
    workOrderApprovalReview: {
      currentApproval: { approvedWorkOrderNumber: '0115511' },
      operationalRelationship: null
    }
  };
  return {
    ...record,
    ...overrides,
    vpro5: { ...record.vpro5, ...(overrides.vpro5 || {}) },
    workOrderRelationship: overrides.workOrderRelationship || record.workOrderRelationship,
    workOrderApprovalReview: overrides.workOrderApprovalReview || record.workOrderApprovalReview
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
assert.equal(oc.viewModel.resolveGovernedWorkOrderNumber(rows[0]), '0115511',
  'governed approval supplies the WO when direct canonical workOrder is blank');
assert.equal(oc.verifiedStatusService.buildEvidenceSnapshot(rows[0]).workOrder, '0115511',
  'Verified Status evidence uses the same governed WO identity');

const precedenceRecord = row('200', '12/02/26', '1', {
  vpro5: { workOrder: '0115001' },
  workOrderRelationship: {
    status: 'EXACT_LINE_UNIQUE', actionableWorkOrderNumber: '0115002', candidates: []
  },
  workOrderApprovalReview: {
    currentApproval: { approvedWorkOrderNumber: '0115003' },
    operationalRelationship: { activeWorkOrderNumber: '0115004' }
  }
});
assert.equal(oc.viewModel.resolveGovernedWorkOrderNumber(precedenceRecord), '0115004',
  'active operational WO takes precedence');
precedenceRecord.workOrderApprovalReview.operationalRelationship.activeWorkOrderNumber = '';
assert.equal(oc.viewModel.resolveGovernedWorkOrderNumber(precedenceRecord), '0115003',
  'governed approval takes precedence over exact and direct WO values');
precedenceRecord.workOrderApprovalReview.currentApproval.approvedWorkOrderNumber = '';
assert.equal(oc.viewModel.resolveGovernedWorkOrderNumber(precedenceRecord), '0115002',
  'exact actionable relationship takes precedence over direct canonical WO');
precedenceRecord.workOrderRelationship.status = 'UNRESOLVED';
assert.equal(oc.viewModel.resolveGovernedWorkOrderNumber(precedenceRecord), '0115001',
  'direct canonical WO remains the final governed fallback');
const unresolvedRecord = row('210', '12/03/26', '1', {
  vpro5: { workOrder: '' },
  workOrderApprovalReview: { currentApproval: null, operationalRelationship: null },
  workOrderRelationship: {
    status: 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE', actionableWorkOrderNumber: '', candidateCount: 1,
    candidates: [{ workOrderNumber: '0115998', itemNumber: '277-3261' }]
  }
});
assert.equal(oc.viewModel.resolveGovernedWorkOrderNumber(unresolvedRecord), '',
  'an unapproved candidate is not guessed as the governed WO');

const masonUnresolved = {
  masterRecordKey: '549250|0012032|040',
  erpQuantityOpen: 2,
  vpro5: {
    customerNumber: '549250', customer: 'MASON ELECTRIC CO.', customerPo: 'N/A',
    salesOrder: '0012032', sequenceLine: '040', workOrder: '', qtyOpen: '2',
    partNumber: '799-057-2', description: 'CCA, RH, PROGRAMMED', dueDate: '02/04/26'
  },
  workOrderRelationship: {
    status: 'UNRESOLVED', actionableWorkOrderNumber: '', resolutionBasis: 'NO_SUPPORTED_RELATIONSHIP',
    candidateCount: 0, candidates: []
  },
  workOrderApprovalReview: { currentApproval: null, operationalRelationship: null },
  materialStatus: null
};
oc.stateActions.setVerifiedStatusRecords([{
  masterRecordKey: masonUnresolved.masterRecordKey,
  statusText: 'Ready to ship - qty 2 - in shipping', recordedBy: 'Miguel', recordedAtUtc: '2026-08-21T15:53:02.380'
}], []);
let unresolvedGroups = oc.viewModel.getWorkOrderGroups([masonUnresolved]);
assert.equal(unresolvedGroups.length, 1, 'an active line without a governed WO remains in the mobile model');
let unresolvedGroup = unresolvedGroups[0];
assert.equal(unresolvedGroup.type, 'UNRESOLVED_LINE');
assert.equal(unresolvedGroup.key, 'UNRESOLVED|549250|0012032|040', 'unresolved identity is stable per SO line');
assert.equal(unresolvedGroup.workOrderNumber, '', 'unresolved card does not manufacture a Work Order');
assert.equal(unresolvedGroup.groupedOpenQuantity, '2', 'unresolved card preserves the line operational Qty Open');
assert.equal(unresolvedGroup.statusPresentation.statusText, 'Ready to ship - qty 2 - in shipping',
  'unresolved card retains its line-level Last Verified Status');
unresolvedGroups = oc.viewModel.getWorkOrderGroups([masonUnresolved], { searchTerms: ['799-057-2'] });
assert.equal(unresolvedGroups.length, 1, 'searching 799-057-2 returns the unresolved Mason line');
assert.equal(oc.viewModel.getWorkOrderGroups([masonUnresolved, { ...masonUnresolved }]).length, 1,
  'duplicate source rows do not create duplicate unresolved cards');

let workOrderAppendCalls = 0;
let lineAppendCalls = 0;
context.window.DleApiClient = {
  createRequestCorrelationId: () => '00000000-0000-4000-8000-000000000001',
  appendOperationsCenterWorkOrderVerifiedStatus: async () => { workOrderAppendCalls += 1; },
  appendOperationsCenterVerifiedStatus: async (masterRecordKey, request) => {
    lineAppendCalls += 1;
    assert.equal(masterRecordKey, masonUnresolved.masterRecordKey);
    assert.equal(request.workOrderNumber, '', 'unresolved line append carries no guessed Work Order');
    return { record: { masterRecordKey, statusText: request.statusText, recordedBy: 'Miguel' } };
  }
};
await assert.rejects(oc.verifiedStatusService.appendForWorkOrderGroup(unresolvedGroup, 'Not allowed'),
  /governed Work Order is required/, 'unresolved card cannot invoke the WO-level append path');
assert.equal(workOrderAppendCalls, 0, 'rejected unresolved WO save makes no WO-level API call');
await oc.verifiedStatusService.appendForRecord(masonUnresolved, 'Line status remains available');
assert.equal(lineAppendCalls, 1, 'unresolved card retains the existing line-level append path');

const resolvedMason = {
  ...masonUnresolved,
  workOrderApprovalReview: {
    currentApproval: { approvedWorkOrderNumber: '0115997' }, operationalRelationship: null
  }
};
const resolvedMasonGroup = oc.viewModel.getWorkOrderGroups([resolvedMason])[0];
assert.equal(resolvedMasonGroup.type, 'WORK_ORDER_GROUP', 'governed WO resolution moves the same row into a WO group');
assert.equal(resolvedMasonGroup.key, 'WO|0115997');
assert.equal(resolvedMasonGroup.records[0].masterRecordKey, masonUnresolved.masterRecordKey,
  'resolution changes grouping without migrating or duplicating the source line');

let searchedGroups = oc.viewModel.getWorkOrderGroups(rows, { searchTerms: ['277-3261'] });
assert.equal(searchedGroups.length, 1, 'searching WO 115511 item returns its governed group');
assert.equal(searchedGroups[0].lineCount, 5, 'item search retains all five active group lines');
assert.equal(searchedGroups[0].groupedOpenQuantity, '25', 'item search retains complete grouped quantity');
assert.equal(oc.viewModel.getOfficialField(searchedGroups[0].primaryRecord, 'sequenceLine'), '110',
  'item search retains the true earliest-due representative line');

const childSearchRows = rows.map(record => ({ ...record, vpro5: { ...record.vpro5 } }));
childSearchRows.find(record => record.masterRecordKey.endsWith('|190')).vpro5.partNumber = 'UNIQUE-CHILD-ITEM';
childSearchRows.find(record => record.masterRecordKey.endsWith('|190')).vpro5.description = 'UNIQUE CHILD DESCRIPTION';
searchedGroups = oc.viewModel.getWorkOrderGroups(childSearchRows, { searchTerms: ['UNIQUE-CHILD-ITEM'] });
assert.equal(searchedGroups.length, 1, 'non-representative child item returns the WO group');
assert.equal(searchedGroups[0].lineCount, 5, 'non-primary child search retains every sibling line');
assert.equal(searchedGroups[0].groupedOpenQuantity, '25', 'non-primary child search retains full group quantity');
assert.equal(oc.viewModel.getOfficialField(searchedGroups[0].primaryRecord, 'sequenceLine'), '110',
  'non-primary child search does not replace the true representative line');
assert.equal(oc.viewModel.getOperationsCenterView({ records: childSearchRows,
  searchTerms: ['UNIQUE-CHILD-ITEM'] }).records.length, 1,
  'desktop row-level search behavior remains unchanged');

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
assert.match(operationsModule, /resolveGovernedWorkOrderNumber\(record\)/,
  'mobile line identity uses the shared governed WO resolver');
assert.match(operationsModule, /openOperationsCenterLineVerifiedStatusLogger/, 'mobile detail exposes individual line override mode');
assert.match(operationsModule, /Awaiting WO Assignment/, 'mobile unresolved cards are clearly labeled');
assert.match(operationsModule, /Log Line Status/, 'mobile unresolved detail keeps deliberate line-level status logging');
assert.match(operationsModule, /group\.type === 'UNRESOLVED_LINE' \? null : group/,
  'unresolved primary action cannot open the WO-level status logger');
assert.match(styles, /operations-center-mobile-line/, 'line override controls have compact mobile styling');
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="operations-center"\] > main\s*\{[^}]*padding-inline:\s*max\(10px,/s,
  'mobile Operations Center uses a single safe viewport edge instead of stacked shell padding');
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="operations-center"\] \.operations-center-panel\s*\{[^}]*border:\s*0;[^}]*padding:\s*0;[^}]*box-shadow:\s*none;/s,
  'mobile Operations Center flattens the decorative workspace frame');
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="operations-center"\] \.operations-center-mobile-view\s*\{[^}]*width:\s*100%;[^}]*border:\s*0;[^}]*padding:\s*0;/s,
  'mobile results use the full safe workspace width without an inner frame');
assert.match(styles, /\.operations-center-mobile-search-row\s*\{[^}]*position:\s*sticky;[^}]*width:\s*100%;/s,
  'mobile search remains a full-width sticky workflow control');
assert.match(styles, /\.operations-center-mobile-card\s*\{[^}]*width:\s*100%;[^}]*box-sizing:\s*border-box;/s,
  'mobile selector cards fit their available width without horizontal overflow');
assert.ok(apiClient.includes("work-orders/verified-statuses/latest"), 'API client can load WO-level default statuses');
assert.match(apiClient, /appendOperationsCenterWorkOrderVerifiedStatus/, 'API client can append WO-level status events');
assert.ok(server.includes('.RequireAuthorization(policy)'), 'WO endpoints remain under governed authorization');
assert.ok(server.includes('TrustedDevelopmentIdentity.RequireActorName'), 'WO append records authenticated actor identity');
assert.ok(server.includes('OperationsCenterWorkOrderVerifiedStatusEvent'), 'server uses a distinct append-only WO event model');
assert.ok(migration.includes('UQ_OperationsCenterWorkOrderVerifiedStatusEvent_Correlation'), 'WO event migration keeps idempotent correlation constraint');
assert.ok(migration.includes('WorkOrderNumber nvarchar(7) NOT NULL'), 'WO event migration keys defaults by normalized work order');

console.log('Operations Center work-order verified status grouping contracts: PASS');

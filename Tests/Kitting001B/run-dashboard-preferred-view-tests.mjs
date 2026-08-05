import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dashboardSource = fs.readFileSync(
  path.join(root, 'SRC', 'modules', 'work-order-dashboard', 'work-order-dashboard.js'), 'utf8');
const kittingSource = fs.readFileSync(
  path.join(root, 'SRC', 'workspaces', 'kitting', 'kitting-workspace.js'), 'utf8');
const salesOrderSource = fs.readFileSync(
  path.join(root, 'SRC', 'modules', 'sales-order-dashboard', 'sales-order-dashboard.js'), 'utf8');

const navigations = [];
const workspaceSelections = [];
const context = {
  window: {
    OperationsCenter: {},
    DleWorkspaceShell: {
      setWorkspaceView(value) { workspaceSelections.push(value); }
    }
  },
  document: {
    getElementById() { return null; },
    querySelectorAll() { return []; }
  },
  fetch: async () => ({ ok: false }),
  go(value) { navigations.push(value); },
  structuredClone: value => JSON.parse(JSON.stringify(value)),
  console
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(dashboardSource, context);
const dashboard = context.window.WorkOrderDashboardModule;

const canonicalWorkOrder = {
  workOrderNumber: '0115619',
  customerNumber: '001082',
  salesOrderNumber: '0012097',
  salesOrderLineNumber: '010',
  itemNumber: 'B11283-17',
  schProdQuantity: '10',
  workOrderStatus: 'O'
};
const governedHandoff = preferredDashboardView => ({
  canonicalWorkOrder: { ...canonicalWorkOrder },
  workOrderNumber: '0115619',
  canonicalSalesOrderNumber: '0012097',
  canonicalAnchorLine: '010',
  originSalesOrderNumber: '0012097',
  originSalesOrderLine: '010',
  governingSource: 'EXACT',
  sourceWorkspaceId: 'kitting',
  returnWorkspaceId: 'kitting',
  preferredDashboardView,
  originRow: { masterRecordKey: '001082|0012097|010', official: { workOrder: '0115619' } },
  relatedRows: []
});

const kittingHandoff = governedHandoff('kitting');
dashboard.setSelectedWorkOrder(kittingHandoff);
assert.equal(dashboard.getCurrentView(), 'kitting');
assert.equal(dashboard.getSelectedHandoff().workOrderNumber, '0115619');
assert.equal(dashboard.getSelectedHandoff().canonicalSalesOrderNumber, '0012097');
assert.equal(dashboard.getSelectedHandoff().canonicalAnchorLine, '010');
assert.equal(dashboard.getSelectedHandoff().originSalesOrderLine, '010');
assert.equal(dashboard.getSelectedHandoff().governingSource, 'EXACT');

dashboard.setView('production');
assert.equal(dashboard.getCurrentView(), 'production', 'manual view switching must remain available');
assert.equal(dashboard.getSelectedHandoff().workOrderNumber, '0115619');

dashboard.setSelectedWorkOrder(governedHandoff('kitting'));
assert.equal(dashboard.getCurrentView(), 'kitting', 'a new Kitting handoff must reset the selected view');

const salesHandoff = governedHandoff('standard');
salesHandoff.sourceWorkspaceId = 'sales-order-dashboard';
salesHandoff.returnWorkspaceId = 'sales-order-dashboard';
dashboard.setSelectedWorkOrder(salesHandoff);
assert.equal(dashboard.getCurrentView(), 'standard');
assert.equal(dashboard.getSelectedHandoff().workOrderNumber, '0115619');

const missingPreference = governedHandoff(undefined);
delete missingPreference.preferredDashboardView;
dashboard.setSelectedWorkOrder(missingPreference);
assert.equal(dashboard.getCurrentView(), 'standard');

dashboard.setSelectedWorkOrder(governedHandoff('unsupported-view'));
assert.equal(dashboard.getCurrentView(), 'standard');

dashboard.setSelectedWorkOrder(kittingHandoff);
assert.equal(dashboard.returnToKitting(), true);
assert.deepEqual(navigations, ['home']);
assert.deepEqual(workspaceSelections, ['kitting']);

assert.deepEqual(Array.from(dashboard.supportedViews), ['standard', 'kitting', 'production']);
assert.match(kittingSource, /preferredDashboardView:\s*"kitting"/);
assert.match(salesOrderSource, /preferredDashboardView:\s*'standard'/);
assert.match(kittingSource, /if \(!row\?\.actionable \|\| !row\.workOrderNumber \|\| !row\.canonicalWorkOrder\) return false/);

console.log('KITTING-001B preferred Dashboard view contract: PASS');

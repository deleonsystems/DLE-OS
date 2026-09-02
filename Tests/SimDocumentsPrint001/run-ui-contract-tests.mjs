import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const labelPath = path.join(root, 'SRC', 'modules', 'work-order-dashboard', 'kitting-kit-id-label.js');
const dashboardPath = path.join(root, 'SRC', 'modules', 'work-order-dashboard', 'work-order-dashboard.js');
const simShellPath = path.join(root, 'Tools', 'SimRuntime', 'DleOs.SimHost', 'SimShellRenderer.cs');
const source = fs.readFileSync(labelPath, 'utf8');
const dashboard = fs.readFileSync(dashboardPath, 'utf8');
const simShell = fs.readFileSync(simShellPath, 'utf8');
const window = {};
vm.runInNewContext(source, { window });

const handoff = {
  workOrderNumber: '9700001', itemNumber: 'SIM-ACTUATOR-A', workOrderQuantity: 10,
  originCustomerName: 'SIM Aeronautics Lab', originCustomerPurchaseOrderNumber: 'SIM-PO-ALPHA',
  originSalesOrderNumber: '9800001',
  canonicalWorkOrder: {
    workOrderNumber: '9700001', itemNumber: 'SIM-ACTUATOR-A', drawingRevision: 'A',
    bomRevision: 'A', schProdQuantity: 10, workOrderOpenedDateIso: '2026-01-06'
  }
};
const model = window.KittingKitIdLabel.createModel(handoff);
assert.deepEqual(
  { customer: model.customer, po: model.customerPurchaseOrder, so: model.salesOrder,
    wo: model.workOrder, assembly: model.assembly, revision: model.revision, quantity: model.orderQuantity },
  { customer: 'SIM Aeronautics Lab', po: 'SIM-PO-ALPHA', so: '9800001',
    wo: '9700001', assembly: 'SIM-ACTUATOR-A', revision: 'A', quantity: '10' }
);
assert.equal(model.qrAssignment, 'UNASSIGNED');
const html = window.KittingKitIdLabel.printDocument(model);
assert.match(html, /@page\{size:4in 4in;margin:0\}/);
assert.match(html, /width:4in;height:4in/);
assert.match(html, /overflow:hidden/);
assert.match(html, /border:1\.5pt solid #000/);
assert.match(html, /font-size:9\.5pt/);
assert.match(html, /SIM Aeronautics Lab/);
assert.match(html, /SIM-PO-ALPHA/);
assert.match(html, /9700001/);
assert.match(html, /SIM-ACTUATOR-A/);
assert.match(html, /QR code unassigned/);
assert.doesNotMatch(html, /https?:\/\/|file:\/\/|\\\\/i);
assert.equal((html.match(/window\.print\(\)/g) || []).length, 1);
assert.match(html, /onclick="window\.print\(\)"/);
const longHtml = window.KittingKitIdLabel.printDocument(window.KittingKitIdLabel.createModel({
  ...handoff,
  itemNumber: 'SIM-ACTUATOR-ASSEMBLY-LONG-VALUE-001',
  originCustomerName: 'SIM Aeronautics Laboratory - Long Synthetic Customer',
  canonicalWorkOrder: { ...handoff.canonicalWorkOrder, drawingRevision: 'SIM-REV-LONG' }
}));
assert.match(longHtml, /SIM-ACTUATOR-ASSEMBLY-LONG-VALUE-001/);
assert.match(longHtml, /SIM Aeronautics Laboratory - Long Synthetic Customer/);
assert.match(longHtml, /SIM-REV-LONG/);
assert.match(longHtml, /overflow-wrap:anywhere/);
assert.match(dashboard, /isSimKitIdLabelAvailable/);
assert.match(dashboard, /labelAvailable/);
assert.doesNotMatch(dashboard, /sim-label\.js|sim-traveler\.js|sim-document-viewer\.js/);
assert.doesNotMatch(simShell, /body\[data-sim-runtime="true"\]\s+\.kitting-label-menu/);
assert.match(simShell, /SRC\/modules\/work-order-dashboard\/kitting-kit-id-label\.js/);

console.log('SIM Kit ID shared print-preview contracts: PASS');

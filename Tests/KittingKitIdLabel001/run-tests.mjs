import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('SRC/modules/work-order-dashboard/kitting-kit-id-label.js');
const dashboard = read('SRC/modules/work-order-dashboard/work-order-dashboard.js');

const context = vm.createContext({ window: {}, Object, Number, String });
vm.runInContext(source, context);
const labels = context.window.KittingKitIdLabel;
const model = labels.createModel({
  workOrderNumber: '0115621',
  originCustomerName: 'AERO FLUID PRODUCTS',
  originCustomerPurchaseOrderNumber: 'PO-1004',
  originSalesOrderNumber: 'SO-2201',
  itemNumber: 'H24589',
  workOrderQuantity: 10,
  canonicalWorkOrder: {
    drawingRevision: 'J',
    orderDate: '2026-08-27'
  }
});

assert.equal(labels.LABEL_WIDTH_IN, 4);
assert.equal(labels.LABEL_HEIGHT_IN, 4);
assert.equal(model.customer, 'AERO FLUID PRODUCTS');
assert.equal(model.date, '08/27/2026');
assert.equal(model.customerPurchaseOrder, 'PO-1004');
assert.equal(model.salesOrder, 'SO-2201');
assert.equal(model.workOrder, '0115621');
assert.equal(model.assembly, 'H24589');
assert.equal(model.revision, 'J');
assert.equal(model.orderQuantity, '10');
for (const value of ['boxNumber', 'boxCount', 'releaseNumber', 'releaseQuantity', 'releaseDueDate']) {
  assert.equal(model[value], '', `${value} remains blank without authoritative release data`);
}
assert.equal(model.qrAssignment, 'UNASSIGNED');

const documentHtml = labels.printDocument(model);
for (const value of ['QF-8.5.2.1 REV B', 'KIT ID', 'BOX ', 'Customer', 'Date', 'P/O', 'S/O', 'W/O',
  'Assy-P/N', 'Rev', 'Order Qty', 'RELEASE/SHIP DETAILS', 'Rel. #', 'Rel. Qty', 'Rel Due Date',
  'SCAN FOR KIT INFORMATION', 'Use DLE-OS to view kit details, status, and history.',
  'DLE', 'DE LEON ENTERPRISES', 'DLE-OS', 'UNASSIGNED']) {
  assert.ok(documentHtml.includes(value), `Kit ID document includes ${value}`);
}
assert.doesNotMatch(documentHtml, /1st Assy Details|2nd Assy Details|Employee #/i);
assert.match(documentHtml, /@page\{size:4in 4in;margin:0\}/);
assert.match(documentHtml, /\.kit-id-sheet\{width:4in;height:4in/);
assert.match(documentHtml, /grid-template-rows:\.52in 1\.38in \.58in minmax\(0,1fr\) \.38in/);
assert.match(documentHtml, /\.kit-id-open-area\{[^}]*display:grid;grid-template-columns:\.86in 1fr/);
assert.match(documentHtml, /\.kit-id-qr-reserved\{[^}]*width:\.78in;height:\.78in/);
const fixedRowHeightIn = .52 + 1.38 + .58 + .38;
const openAreaHeightIn = labels.LABEL_HEIGHT_IN - fixedRowHeightIn;
assert.equal(fixedRowHeightIn, 2.86);
assert.ok(openAreaHeightIn >= .9, 'square reflow leaves a practical QR/instruction band');
assert.ok(.78 + (.07 * 2) <= openAreaHeightIn, 'QR reserve and vertical padding fit without clipping');
assert.match(documentHtml, /\.kit-id-label\{[^}]*border:1\.5pt solid #000[^}]*overflow:hidden/);
assert.match(documentHtml, /\.kit-id-job-fields\{[^}]*grid-template-rows:\.38in \.38in \.62in/);
assert.match(documentHtml, /<div class="kit-id-assembly-group"><div class="kit-id-field assembly">/);
assert.match(documentHtml, /kit-id-field revision[^>]*><span>Rev<\/span><strong>J<\/strong>/);
assert.match(documentHtml, /kit-id-field order-quantity[^>]*><span>Order Qty<\/span><strong>10<\/strong>/);
assert.match(documentHtml, /\.kit-id-assembly-group\{[^}]*grid-template-columns:2fr \.65fr 1\.15fr/);
assert.match(documentHtml, /\.kit-id-assembly-group \.kit-id-field\{border-bottom:0\}/);
assert.match(documentHtml, /\.kit-id-assembly-group \.order-quantity\{border-right:0\}/);
assert.doesNotMatch(documentHtml, /\.kit-id-assembly-group[^}]*grid-template-rows/);
assert.match(documentHtml, /@media print\{[^}]*html,body\{background:#fff\}\.print-toolbar\{display:none!important\}/);
assert.doesNotMatch(documentHtml, /https?:\/\/|dle-os:\/\//i);

assert.match(dashboard, /printWorkOrderDashboardKittingKitIdLabel\(\)\">Kit ID<\/button>/);
assert.match(dashboard, /disabled><span>Master Kit ID<\/span><small>Coming Soon<\/small>/);
assert.match(dashboard, /script\.src = 'SRC\/modules\/work-order-dashboard\/kitting-kit-id-label\.js'/);
assert.match(dashboard, /labels\.createModel\(selectedWorkOrder\)/);
assert.match(dashboard, /labels\.printDocument\(model\)/);
assert.match(dashboard, /window\.printWorkOrderDashboardKittingKitIdLabel = printKittingKitIdLabel/);

console.log('Kitting Kit ID model, print layout, placeholder QR, and menu contracts: PASS');

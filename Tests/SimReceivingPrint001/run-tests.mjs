import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const context = vm.createContext({ window: {} });
for (const file of ['SRC/workspaces/purchasing/purchasing-po-document.js', 'SRC/workspaces/receiving/receiving-accepted-material-label.js'])
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const po = context.window.PurchasingPoDocument, label = context.window.ReceivingAcceptedMaterialLabel;
let checks = 0;
const check = (title, work) => { work(); checks++; };
const purchase = (id = 'purchase-1', line = '010') => ({ purchaseId: id, poNumber: 'SIM-PO-0001', poLine: line,
  supplier: 'DLE-SIM-SUPPLIER', partNumber: 'SIM-OPTO-4', vendorPartNumber: 'SIM-OPTO-4',
  description: 'Phototransistor optocoupler, SMD-4', purchasingUom: 'EA', orderedQuantity: 8,
  unitCost: 1.25, currency: 'USD', extendedCost: 10, orderDate: '2026-09-23', requestedDate: '2026-10-07',
  expectedDate: '2026-10-07', buyer: 'SIM Administrator', notes: 'Synthetic first-slice purchase.',
  coverage: [{ workOrderNumber: '0999999', salesOrderNumber: '0099999', salesOrderLineNumber: '010', quantity: 8 }],
  qualityRequirements: { cocRequired: null, materialCertRequired: false, poTraceabilityRequired: false, travelerRequired: true } });
const reviewed = purchase => ({ purchase, requirements: { reviewId: 'review-1', cocRequired: false,
  materialCertRequired: false, poTraceabilityRequired: false, inspectionRequired: true } });
const workspace = { supplier: 'DLE-SIM-SUPPLIER', poNumber: 'SIM-PO-0001', lines: [reviewed(purchase())] };
const material = { receiptLineId: 'SIM-AM-0000001', purchaseId: 'purchase-1', expectedReceiptId: 'expected-1', deliveryId: 'delivery-1',
  supplier: 'DLE-SIM-SUPPLIER', poNumber: 'SIM-PO-0001', poLine: '010', partNumber: 'SIM-OPTO-4',
  description: 'Phototransistor optocoupler, SMD-4', purchasingUom: 'EA', acceptedQuantity: 8, receivedQuantity: 8,
  availableQuantity: 8, holdQuantity: 0, rejectedQuantity: 0, receivedBy: 'SIM Administrator', acceptedBy: 'SIM Administrator',
  receivedAtUtc: '2026-09-24T22:15:00+00:00', acceptedAtUtc: '2026-09-24T22:15:00+00:00',
  stagingLocation: 'SIM / Kitting staging', packingSlipNumber: 'SIM-PS-0001',
  coverage: [{ workOrderNumber: '0999999', quantity: 8 }], version: 2, vproReceiptId: null };
const frozenState = JSON.stringify({ workspace, material });
const poHtml = po.printDocument(workspace), labelHtml = label.printDocument(material);

check('PO uses recorded fields and simple dates', () => {
  for (const value of ['SIM-PO-0001', 'DLE-SIM-SUPPLIER', 'SIM-OPTO-4', '09/23/2026', '10/07/2026', 'USD 1.25', 'USD 10.00', 'WO 0999999', 'SO 0099999 / 010']) assert.ok(poHtml.includes(value), value);
});
check('Internal SIM provenance and browser print, no supplier posting', () => {
  assert.match(poHtml, /SIM \/ DEVELOPMENTAL · INTERNAL COPY/); assert.match(poHtml, /onclick="window.print\(\)"/);
  assert.match(poHtml, /not a supplier release or VPRO accounting receipt/);
});
check('Date-only formatting does not convert timezone', () => {
  assert.equal(po.formatDate('2026-09-22'), '09/22/2026'); assert.equal(po.formatDate('2026-09-22T00:00:00Z'), 'Not recorded');
  assert.equal(label.formatDate('2026-09-22'), '09/22/2026');
});
check('Operational timestamp dates use factory timezone including midnight and DST boundaries', () => {
  assert.equal(label.formatDate('2026-09-25T02:00:00Z'), '09/24/2026');
  assert.equal(label.formatDate('2026-09-25T07:00:00Z'), '09/25/2026');
  assert.equal(label.formatDate('2026-01-25T07:30:00Z'), '01/24/2026');
  assert.equal(label.formatDate('2026-09-24T19:00:00-07:00'), '09/24/2026');
  assert.equal(label.formatDate('2026-09-24T19:00:00'), 'Not recorded');
  assert.equal(label.formatDate('invalid'), 'Not recorded');
});
check('Reviewed requirements visible without erasing original provenance', () => {
  assert.match(poHtml, /Supplier CoC: Not required/); assert.match(poHtml, /recorded Receiving review/);
  assert.match(poHtml, /Production traveler: Required/); assert.equal(workspace.lines[0].purchase.qualityRequirements.cocRequired, null);
});
check('No invented missing dates, addresses or terms', () => {
  const html = po.printDocument({ lines: [{ ...purchase(), requestedDate: null, buyer: null }] });
  assert.match(html, /Not recorded/); assert.match(html, /unrecorded clauses are not supplied/);
  assert.match(html, /Supplier CoC: Not established/);
});
check('All supplier-qualified PO lines appear in line order', () => {
  const html = po.printDocument({ ...workspace, lines: [reviewed(purchase('p3', '030')), reviewed(purchase('p1', '010')), reviewed(purchase('p2', '020'))] });
  assert.equal((html.match(/data-purchase-id=/g) || []).length, 3);
  assert.ok(html.indexOf('data-purchase-id="p1"') < html.indexOf('data-purchase-id="p2"'));
  assert.ok(html.indexOf('data-purchase-id="p2"') < html.indexOf('data-purchase-id="p3"'));
  assert.match(html, /Recorded line total: USD 30.00/);
});
check('Reject mixed supplier, mixed PO, duplicate identities and no lines', () => {
  assert.throws(() => po.printDocument({ lines: [purchase(), { ...purchase('p2'), supplier: 'OTHER' }] }), /supplier-qualified/);
  assert.throws(() => po.printDocument({ lines: [purchase(), { ...purchase('p2'), poNumber: 'OTHER' }] }), /supplier-qualified/);
  assert.throws(() => po.printDocument({ lines: [purchase(), purchase()] }), /distinct/);
  assert.throws(() => po.printDocument({ lines: [] }), /must be loaded/);
});
check('Currency totals do not silently combine currencies', () => {
  const html = po.printDocument({ lines: [purchase(), { ...purchase('p2', '020'), currency: 'EUR' }] });
  assert.match(html, /Recorded line total: USD 10.00 · EUR 10.00/);
});
check('Labels have operational data and stock dimensions', () => {
  for (const value of ['ACCEPTED MATERIAL', 'SIM-OPTO-4', 'DLE-SIM-SUPPLIER', 'SIM-PO-0001 / 010', '0999999', '8 EA',
    'Received by', 'Accepted by', 'SIM Administrator', '09/24/2026', 'SIM / Kitting staging', 'SIM-AM-0000001']) assert.ok(labelHtml.includes(value), value);
  assert.match(labelHtml, /@page\{size:100mm 62mm;margin:0\}/); assert.match(labelHtml, /width:92mm/);
});
check('Barcode encodes actual accepted-material lookup identity, not P/N', () => {
  assert.match(labelHtml, /data-barcode-value="SIM-AM-0000001"/);
  assert.doesNotMatch(labelHtml, /data-barcode-value="SIM-OPTO-4"/);
  assert.equal((labelHtml.match(/<svg /g) || []).length, 1);
});
check('Code128 matches independent ReportLab reference encoding/checksum', () => {
  assert.deepEqual(Array.from(label.code128('SIM-AM-0000001').symbols), [104,51,41,45,13,33,45,13,16,99,0,0,1,24,106]);
  assert.equal(label.code128('SIM-AM-0000001').modules, 187);
  assert.ok(label.SAFE_WIDTH_MM / label.code128('SIM-AM-0000001').modules > 0.4, 'module width is readable at stock size');
});
check('Barcode run reconstruction is exact and includes quiet zones', () => {
  const svg = label.barcodeSvg('SIM-AM-0000001'), encoded = label.code128('SIM-AM-0000001');
  assert.equal(encoded.modules, encoded.runs.reduce((sum, width) => sum + width, 0) + 20);
  assert.match(svg, /<rect x="10"/); assert.match(svg, /shape-rendering="crispEdges"/);
  assert.equal((svg.match(/<rect x=/g) || []).length, Math.ceil(encoded.runs.length / 2));
});
check('Reject unreadable or malformed barcode identities', () => {
  assert.throws(() => label.code128(''), /identity/); assert.throws(() => label.code128('bad\nvalue'), /identity/);
  assert.throws(() => label.code128('x'.repeat(100)), /too long/);
});
check('Unaccepted/Hold-only material cannot print accepted labels', () => {
  assert.throws(() => label.printDocument({ ...material, acceptedQuantity: 0, holdQuantity: 8 }), /positive accepted/);
  assert.throws(() => label.printDocument({ ...material, acceptedAtUtc: null }), /positive accepted/);
  assert.throws(() => label.printDocument({ ...material, acceptedQuantity: 'not a quantity' }), /positive accepted/);
});
check('Stage absence is honest; labels do not stage', () => {
  assert.match(label.printDocument({ ...material, stagingLocation: '' }), /Not staged/);
});
check('Split container labels require recorded reconciled quantities and selection', () => {
  const split = { ...material, containers: [{ containerId: 'C1', quantity: 3 }, { containerId: 'C2', quantity: 5 }] };
  assert.throws(() => label.printDocument(split), /Select a recorded container/);
  const html = label.printDocument(split, 'C1'); assert.match(html, /3 EA/); assert.doesNotMatch(html, /8 EA/);
  assert.match(html, /Container C1/); assert.match(html, /SIM-AM-0000001/);
  assert.throws(() => label.printDocument({ ...split, containers: [{ containerId: 'C1', quantity: 8 }, { containerId: 'C2', quantity: 8 }] }, 'C1'), /reconcile/);
  assert.throws(() => label.printDocument(material, 'unrecorded'), /unrecorded container/);
});
check('Multiple WO coverage is not represented as one arbitrary WO', () => {
  assert.match(label.printDocument({ ...material, coverage: [{ workOrderNumber: '1' }, { workOrderNumber: '2' }] }), /Multiple WOs/);
});
check('Untrusted text is escaped in both documents', () => {
  assert.doesNotMatch(po.printDocument({ lines: [{ ...purchase(), description: '<script>alert(1)</script>' }] }), /<script>/);
  assert.doesNotMatch(label.printDocument({ ...material, stagingLocation: '<img onerror=alert(1)>' }), /<img /);
});
check('Reprint is deterministic and cannot write business state', () => {
  for (let n = 0; n < 3; n++) { assert.equal(po.printDocument(workspace), poHtml); assert.equal(label.printDocument(material), labelHtml); }
  assert.equal(JSON.stringify({ workspace, material }), frozenState);
  assert.doesNotMatch(poHtml + labelHtml, /fetch\(|XMLHttpRequest|localStorage|\/api\/|window\.opener/);
});

if (process.argv.includes('--artifacts')) {
  const output = path.join(root, 'tmp/receiving-print-preview'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'po.html'), poHtml);
  fs.writeFileSync(path.join(output, 'accepted-material-label.html'), labelHtml);
  fs.writeFileSync(path.join(output, 'barcode.svg'), label.barcodeSvg(material.receiptLineId));
}
console.log(`SimReceivingPrint001: ${checks} checks PASS`);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('SRC/workspaces/receiving/receiving-workspace.js');
const registry = read('SRC/shell/workspace-registry.js');
const styles = read('SRC/workspaces/receiving/receiving-workspace.css');
const identity = read('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/DevelopmentIdentityUi.cs');
const calls = [], results = { innerHTML: '' }, detail = { innerHTML: '' };
const mount = {
  innerHTML: '',
  querySelector(selector) { return selector === '[data-receiving-results]' ? results : selector === '[data-receiving-detail]' ? detail : null; }
};
const coverage = (id, wo, date = '2026-10-14') => ({ demandId: id, quantity: 8, workOrderNumber: wo,
  salesOrderNumber: '0099999', salesOrderLineNumber: '010', customer: 'DLE-SIM-CUSTOMER',
  assemblyItemNumber: 'SIM-ASSY-001', revision: 'A', customerDueDate: date });
const line = (id, date, overrides = {}) => ({ expectedReceiptId: id, purchaseId: 'purchase-' + id, planId: 'plan-' + id,
  poNumber: '0000001', poLine: '010', supplier: 'DLE-SIM-SUPPLIER', partNumber: 'SIM-OPTO-4',
  approvedPartNumber: 'SIM-OPTO-4', vendorPartNumber: 'SIM-OPTO-4', description: 'Phototransistor optocoupler, SMD-4',
  purchasingUom: 'EA', orderedQuantity: 8, receivedQuantity: 0, openQuantity: 8, unitCost: 1.25, currency: 'USD', extendedCost: 10,
  orderDate: '2026-09-23', requestedDate: '2026-10-01', expectedDate: date, materialNeedBy: null,
  excessQuantity: 0, excessPurpose: '', notes: 'Explicit scenario expected date',
  status: 'EXPECTED', receiptState: 'AWAITING_RECEIPT', provenance: 'SIMULATED_DEVELOPMENTAL',
  buyer: 'SIM Buyer', createdAtUtc: '2026-09-23T16:00:00Z', qualityRequirements: { poTraceabilityRequired: false,
    originalPoTraceabilityRequired: true, traceabilityAmendmentId: 'reviewed-amendment-1',
    evidenceSource: 'Reviewed Kitting amendment', cocRequired: true, materialCertRequired: false, inspectionRequired: null,
    travelerRequired: true, contractRequirements: { oldBroadTraceabilityFlag: true } },
  coverage: [coverage('demand-' + id, '0999999')], ...overrides });
const rows = [line('later', '2026-10-09', { supplier: 'Zulu supplier', poNumber: '0000003' }),
  line('unknown', null, { supplier: 'Unknown date supplier', poNumber: '0000004' }),
  line('first', '2026-10-01'), line('grouped', '2026-10-05', { supplier: 'Alpha supplier', poNumber: '0000002',
    orderedQuantity: 16, openQuantity: 16, extendedCost: 20,
    coverage: [coverage('demand-A', '1000001'), coverage('demand-B', '1000002', '2026-10-16')] })];
let payload = { environment: 'SIM', canReceive: false, items: rows }, fail = false;
const document = { body: { dataset: { simRuntime: 'true' } }, querySelector: () => mount };
const window = { document, fetch: async (url, options) => {
  calls.push({ url, options });
  return { ok: !fail, json: async () => fail ? { message: 'Read-only queue temporarily unavailable' } : payload };
} };
const context = vm.createContext({ window, document, console });
vm.runInContext(source, context);
const ui = window.DleWorkspaces.receiving;
const ids = result => Array.from(result.rows, row => row.expectedReceiptId);

// Default order is expected date ascending with unknown dates last, retaining one row per PO line.
assert.deepEqual(ids(ui.buildViewModel(rows)), ['first', 'grouped', 'later', 'unknown']);
assert.deepEqual(ids(ui.buildViewModel(rows, {}, 'expectedDate', 'desc')), ['later', 'grouped', 'first', 'unknown']);
assert.equal(ui.buildViewModel(rows).rows.length, 4);
assert.equal(ui.buildViewModel(rows, { workOrder: '1000002' }).rows.length, 1);
assert.equal(ui.buildViewModel(rows, { workOrder: '1000002' }).rows[0].coverage.length, 2);
assert.deepEqual(ids(ui.buildViewModel(rows, { expectedFrom: '2026-10-02', expectedTo: '2026-10-08' })), ['grouped']);
assert.deepEqual(ids(ui.buildViewModel(rows, { supplier: 'alpha' })), ['grouped']);
assert.deepEqual(ids(ui.buildViewModel(rows, { po: '0000003' })), ['later']);
assert.equal(ui.buildViewModel(rows, { part: 'sim-opto-4' }).rows.length, 4);
assert.equal(ui.buildViewModel(rows, { status: 'EXPECTED' }).rows.length, 4);
assert.equal(ui.buildViewModel(rows, { status: 'COMPLETE' }).rows.length, 0);
assert.equal(ui.buildViewModel(rows, { search: '10/14/2026' }).rows.length, 4);
assert.equal(ui.buildViewModel(rows, { search: 'no-match' }).rows.length, 0);
assert.deepEqual(ids(ui.buildViewModel(rows, {}, 'supplier')), ['grouped', 'first', 'unknown', 'later']);
assert.deepEqual(ids(ui.buildViewModel(rows, {}, 'po')), ['first', 'grouped', 'later', 'unknown']);
assert.equal(ui.buildViewModel(rows, {}, 'workOrder').rows[3].expectedReceiptId, 'grouped');
assert.equal(ui.formatDate('2026-10-14'), '10/14/2026');
assert.equal(ui.formatDate('2026-09-22'), '09/22/2026');
assert.equal(ui.formatDate(null), 'Not established');
assert.equal(ui.formatDate('2026-10-14T00:00:00Z'), 'Not established');

await ui.render();
assert.match(mount.innerHTML, /Operational SIM Receiving/);
assert.match(results.innerHTML, /4 of 4 expected PO lines/);
assert.ok(results.innerHTML.indexOf('data-receiving-id="first"') < results.innerHTML.indexOf('data-receiving-id="later"'));
for (const value of ['Expected Date', 'Supplier', 'PO / Line', 'DLE P/N', 'Ordered', 'Received', 'Open', 'WO(s)', 'Customer Due',
  'SIM-OPTO-4', 'Phototransistor optocoupler, SMD-4', '10/14/2026', 'Expected / Awaiting receipt']) assert.ok(results.innerHTML.includes(value), value);
assert.match(results.innerHTML, /<td class="receiving-number">0<\/td>/);
assert.equal((results.innerHTML.match(/data-receiving-id="grouped"/g) || []).length, 1);
for (const field of ['expectedFrom', 'expectedTo', 'workOrder', 'supplier', 'po', 'part', 'status'])
  assert.ok(mount.innerHTML.includes('data-receiving-filter="' + field + '"'), field);
for (const field of ['expectedDate', 'workOrder', 'supplier', 'po', 'part', 'status'])
  assert.ok(results.innerHTML.includes('data-receiving-sort="' + field + '"'), field);

const click = dataset => mount.onclick({ target: { closest: () => ({ dataset }) } });
click({ receivingId: 'first' });
for (const value of ['Demand / job coverage', '0999999', '0099999 / 010', 'DLE-SIM-CUSTOMER', 'SIM-ASSY-001 / A', '10/14/2026',
  'Material / supplier-PO traceability', 'Not required', 'Reviewed Kitting amendment', 'Simulated developmental — no real supplier order',
  'Certificate of Conformance (CoC)', 'Material certification', 'Inspection', 'Traveler / production traceability',
  'reviewed-amendment-1', 'Original frozen PO traceability (history)', 'Expected PO-line identity', 'demand-first',
  'USD 10.00', '09/23/2026', 'Not established']) assert.ok(detail.innerHTML.includes(value), value);
assert.doesNotMatch(detail.innerHTML, /oldBroadTraceabilityFlag/);
assert.match(ui.detailsMarkup(line('missing', null, { receivedQuantity: null })), /<dt>Received<\/dt><dd>Not recorded<\/dd>/);
click({ receivingSort: 'expectedDate' });
assert.match(results.innerHTML, /aria-sort="descending"/);
mount.oninput({ target: { dataset: { receivingFilter: 'workOrder' }, value: '1000002' } });
assert.match(results.innerHTML, /1 of 4 expected PO lines/);
assert.equal((results.innerHTML.match(/data-receiving-id=/g) || []).length, 1);
click({ receivingId: 'grouped' });
assert.match(detail.innerHTML, /1000001/); assert.match(detail.innerHTML, /1000002/);
click({ receivingAction: 'close-detail' }); assert.equal(detail.innerHTML, '');
click({ receivingAction: 'clear-filters' }); assert.match(results.innerHTML, /4 of 4/);

// Escaping covers both identifiers and free-text supplier/description/quality fields.
const hostile = line('x', null, { supplier: '<script>alert(1)</script>', description: '<img src=x onerror=bad()>',
  qualityRequirements: { poTraceabilityRequired: false, specialReceivingNotes: '<script>bad()</script>' } });
assert.doesNotMatch(ui.detailsMarkup(hostile), /<script>|<img/);
assert.match(ui.detailsMarkup(hostile), /&lt;script&gt;/);
// Failed refresh must not present stale rows as fresh incoming inventory.
fail = true; await ui.refresh(); assert.match(results.innerHTML, /role="alert"/); assert.doesNotMatch(results.innerHTML, /data-receiving-id=/);
fail = false; payload = { items: [] }; await ui.refresh(); assert.match(results.innerHTML, /No purchased material is awaiting receipt/);
assert.ok(calls.length >= 3);
assert.ok(calls.every(call => call.url === '/api/sim/receiving/expected' && call.options.method === 'GET'));
assert.doesNotMatch(source, /localStorage|sessionStorage/);

// Workspace appears only in SIM and uses its view permission; non-SIM registry remains unchanged.
vm.runInContext(registry, context);
assert.equal(window.DleWorkspaceRegistry.getById('receiving').home.requiredPermission, 'receiving.view');
const simIds = Array.from(window.DleWorkspaceRegistry.all(), item => item.id);
assert.ok(simIds.includes('receiving'));
document.body.dataset.simRuntime = 'false';
assert.equal(window.DleWorkspaceRegistry.getById('receiving'), null);
assert.ok(!window.DleWorkspaceRegistry.all().some(item => item.id === 'receiving'));
const count = calls.length; await ui.render(); assert.equal(calls.length, count);
assert.match(identity, /receiving:'receiving\.view'/);
assert.match(styles, /\.receiving-workspace \.receiving-header\{position:static/);
assert.match(styles, /overflow:auto/);
assert.doesNotMatch(styles, /body\s*\{/);
console.log('PASS Receiving queue UI: PO-line identity, multi-WO coverage, expected-date sorting/nulls, all filters/sorts, date-only display, source details, reviewed traceability, escaping, failed/empty states, read-only queue loading, SIM-only routing.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, 'SRC/workspaces/receiving/receiving-workspace.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'SRC/workspaces/receiving/receiving-workspace.css'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const quality = { cocRequired: false, materialCertRequired: false, poTraceabilityRequired: false, inspectionRequired: false };
const purchase = (id, line, overrides = {}) => ({ purchaseId: id, expectedReceiptId: 'expected-' + id,
  supplier: 'DLE-SIM-SUPPLIER', poNumber: 'SIM-PO-0001', poLine: line, partNumber: 'SIM-OPTO-4', approvedPartNumber: 'SIM-OPTO-4',
  vendorPartNumber: 'SIM-OPTO-4', description: 'Optocoupler', orderedQuantity: 8, receivedQuantity: 0, openQuantity: 8, purchasingUom: 'EA',
  excessQuantity: 0, expectedDate: '2026-10-07', qualityRequirements: { ...quality, travelerRequired: true },
  coverage: [{ demandId: 'demand-' + id, workOrderNumber: '0999999', quantity: 8 }], ...overrides });
const poLine = p => ({ purchase: p, receivedQuantity: p.receivedQuantity, openQuantity: p.openQuantity, requirements: clone(quality) });
const initial = { supplier: 'DLE-SIM-SUPPLIER', poNumber: 'SIM-PO-0001', version: 0, canReceive: true,
  lines: [poLine(purchase('p1', '010')), poLine(purchase('p2', '020'))], deliveries: [], acceptedMaterials: [] };
let po = clone(initial), requestFailure = '', pauseReceipt = null, sequence = 0;
const calls = [], previews = [], targets = Object.fromEntries(['results', 'detail', 'po'].map(key => [key, { innerHTML: '' }]));
const mount = { innerHTML: '', querySelector: selector => targets[/data-receiving-(\w+)/.exec(selector)?.[1]] || null };
const document = { body: { dataset: { simRuntime: 'true' } }, querySelector: () => mount };
const window = { document, crypto: { randomUUID: () => 'request-' + (++sequence) }, confirm: () => true,
  PurchasingPoDocument: { printDocument: value => '<html>PO ' + value.poNumber + '</html>' },
  ReceivingAcceptedMaterialLabel: { printDocument: value => '<html>LABEL ' + value.receiptLineId + '</html>' },
  open: () => { const popup = { html: '', opener: {}, document: { open() {}, write(value) { popup.html = value; }, close() {} }, close() {} }; previews.push(popup); return popup; },
  fetch: async (url, options) => {
    calls.push({ url, options });
    const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : null;
    if (requestFailure && options.method === 'POST' && url.endsWith('/receive')) return { ok: false, json: async () => ({ message: requestFailure }) };
    if (pauseReceipt && url.endsWith('/receive')) await pauseReceipt;
    let result;
    if (url.endsWith('/expected')) result = { items: po.lines.map(line => ({ ...line.purchase, receivedQuantity: line.receivedQuantity, openQuantity: line.openQuantity })) };
    else if (url.includes('/documents?')) result = { documentId: 'document-' + calls.length, document: { name: options.body.name } };
    else if (url.endsWith('/requirements')) {
      for (const reviewed of body.lines) po.lines.find(line => line.purchase.purchaseId === reviewed.purchaseId).requirements = { ...reviewed, reviewId: 'review' };
      po.version++; result = po;
    } else if (url.endsWith('/receive')) {
      po.version++;
      body.lines.forEach(received => {
        const line = po.lines.find(row => row.purchase.purchaseId === received.purchaseId);
        line.receivedQuantity += received.countedQuantity; line.openQuantity -= received.countedQuantity;
        po.acceptedMaterials.push({ ...line.purchase, receiptLineId: 'SIM-AM-' + String(po.acceptedMaterials.length + 1).padStart(7, '0'),
          receivedQuantity: received.countedQuantity, acceptedQuantity: received.acceptedQuantity, holdQuantity: received.holdQuantity, rejectedQuantity: received.rejectedQuantity,
          availableQuantity: 0, version: 1, packingSlipNumber: body.packingSlipNumber, receivedBy: 'SIM Receiver', acceptedBy: 'SIM Receiver',
          receivedAtUtc: '2026-09-25T01:00:00Z', acceptedAtUtc: '2026-09-25T01:00:00Z', stagingLocation: '', stagedAtUtc: null, vproReceiptId: null, checks: received.checks });
      }); result = po;
    } else if (url.endsWith('/stage')) {
      const id = /accepted-material\/([^/]+)/.exec(url)[1], record = po.acceptedMaterials.find(row => row.receiptLineId === id);
      record.version++; record.stagingLocation = body.location; record.stagedAtUtc = '2026-09-25T01:01:00Z'; record.availableQuantity = record.acceptedQuantity; result = record;
    } else result = po;
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => clone(result) };
  } };
vm.runInNewContext(source, { window, document, console, Intl, Date });
const ui = window.DleWorkspaces.receiving;
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = (dataset, value) => mount.oninput({ target: { dataset, value } });
const click = async dataset => { mount.onclick({ target: { closest: () => ({ dataset }) } }); await tick(); };
const field = (key, value, line = '') => input({ receivingField: key, ...(line ? { receivingLine: line } : {}) }, value);
const check = (key, value, line = 'p1') => input({ receivingCheck: key, receivingLine: line }, value);
const coreChecks = ['packingSlip', 'partIdentity', 'uom', 'physicalCount', 'condition', 'damage', 'inspection'];
const fill = (id = 'p1', count = '8') => {
  field('packingSlipNumber', 'SIM-PS-0001'); field('packingSlipDate', '2026-09-24');
  field('packingSlipQuantity', count, id); field('countedQuantity', count, id); field('acceptedQuantity', count, id);
  coreChecks.forEach(key => check(key, 'PASS', id));
};

// A PO workspace contains every line. Physical count and accepted quantity are deliberate entries.
await ui.render(); await ui.openPo('p1');
assert.match(targets.po.innerHTML, /Line 010/); assert.match(targets.po.innerHTML, /Line 020/);
assert.match(targets.po.innerHTML, /Print PO/); assert.match(targets.po.innerHTML, /Receive Now/);
assert.match(targets.po.innerHTML, /data-receiving-field="countedQuantity" data-receiving-line="p1" value=""/);
assert.match(targets.po.innerHTML, /data-receiving-field="acceptedQuantity" data-receiving-line="p1" value=""/);
assert.match(targets.po.innerHTML, /Not Required/); assert.match(targets.po.innerHTML, /Traveler \/ production traceability: Required/);
assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);

const draft = ui.createDraft(initial);
assert.equal(draft.lines.p1.countedQuantity, ''); assert.equal(draft.lines.p1.acceptedQuantity, '');
assert.equal(draft.lines.p1.checks.coc, 'NOT_APPLICABLE'); assert.equal(draft.lines.p1.checks.specialInspection, 'NOT_APPLICABLE');
assert.throws(() => ui.receiveRequest(initial, draft), /packing slip number/);
draft.packingSlipNumber = 'SIM-PS-0001'; draft.packingSlipDate = '2026-09-24';
assert.throws(() => ui.receiveRequest(initial, draft), /Receive Now/);
Object.assign(draft.lines.p1, { countedQuantity: '3', acceptedQuantity: '2', holdQuantity: '1', packingSlipQuantity: '3', discrepancyReason: 'One damaged package' });
coreChecks.forEach(key => draft.lines.p1.checks[key] = 'PASS');
let request = ui.receiveRequest(initial, draft);
assert.equal(request.lines.length, 1); assert.equal(request.lines[0].countedQuantity, 3); assert.equal(request.lines[0].acceptedQuantity, 2);
assert.equal(request.lines[0].coverage, undefined); // Single governed demand safely inferred by server.
draft.lines.p1.acceptedQuantity = '3'; assert.throws(() => ui.receiveRequest(initial, draft), /Counted must equal/);
draft.lines.p1.acceptedQuantity = '2'; draft.lines.p1.checks.inspection = 'FAIL'; assert.throws(() => ui.receiveRequest(initial, draft), /passing Receiving checks/);
draft.lines.p1.checks.inspection = 'PASS'; draft.lines.p1.countedQuantity = '9'; assert.throws(() => ui.receiveRequest(initial, draft), /cannot exceed/);
draft.lines.p1.countedQuantity = '3';
const unknown = clone(initial); unknown.lines[0].requirements.cocRequired = null;
assert.throws(() => ui.receiveRequest(unknown, draft), /Review supplier requirements/);
const required = clone(initial); required.lines[0].requirements.inspectionRequired = true;
assert.throws(() => ui.receiveRequest(required, draft), /Review supplier requirements/);
draft.lines.p1.checks.specialInspection = 'PASS'; draft.lines.p1.evidenceDocuments.push({ documentId: 'inspection-doc' });
assert.deepEqual(Array.from(ui.receiveRequest(required, draft).lines[0].evidenceDocumentIds), ['inspection-doc']);

// Explicit multi-demand disposition is separate from physical counts and survives unchanged.
const grouped = clone(initial); grouped.lines[0].purchase.coverage.push({ demandId: 'demand-other', workOrderNumber: '1000000', quantity: 4 });
const groupedDraft = ui.createDraft(grouped); Object.assign(groupedDraft, { packingSlipNumber: 'SIM-PS-GROUP', packingSlipDate: '2026-09-24' });
Object.assign(groupedDraft.lines.p1, { ...draft.lines.p1, coverage: { 'demand-p1': { quantity: '1', receivedQuantity: '2', holdQuantity: '1', rejectedQuantity: '0' },
  'demand-other': { quantity: '1', receivedQuantity: '1', holdQuantity: '0', rejectedQuantity: '0' } } });
assert.equal(ui.receiveRequest(grouped, groupedDraft).lines[0].coverage.length, 2);

// Partial receipts freeze their requirements while untouched lines remain reviewable.
const partial = clone(initial); partial.lines[0].receivedQuantity = 3; partial.lines[0].openQuantity = 5;
const reviewDraft = ui.createDraft(partial); reviewDraft.reason = 'Explicit applicability';
assert.deepEqual(Array.from(ui.requirementsRequest(partial, reviewDraft).lines, line => line.purchaseId), ['p2']);
assert.equal(ui.queueItems([purchase('partial', '010', { receivedQuantity: 3, openQuantity: 5 })], 'expected').length, 1);
assert.equal(ui.queueItems([purchase('partial', '010', { receivedQuantity: 3, openQuantity: 5 })], 'received').length, 1);

// Upload category, exact file bytes and line ownership survive routing; reading a document is GET-only.
const file = { name: 'packing-slip.pdf', type: 'application/pdf' };
mount.onchange({ target: { dataset: { receivingUpload: '' }, files: [file] } }); await tick();
let upload = calls.find(call => call.url.includes('/documents?'));
assert.equal(upload.options.body, file); assert.equal(upload.options.headers['X-SIM-Document-Upload'], 'true');
assert.match(upload.url, /kind=PACKING_SLIP/); assert.match(targets.po.innerHTML, /\/po\/p1\/documents\/document-/);
const certificate = { name: 'inspection.pdf', type: 'application/pdf' };
mount.onchange({ target: { dataset: { receivingUpload: '', receivingLine: 'p1', receivingKind: 'INSPECTION' }, files: [certificate] } }); await tick();
assert.match(calls.at(-1).url, /kind=INSPECTION/); assert.equal(calls.at(-1).options.body, certificate);

// Failed writes preserve entries; unchanged retries reuse idempotency and expected-version tokens.
fill(); requestFailure = 'The Receiving version is stale. Refresh before receiving.';
await click({ receivingCommand: 'receive' });
assert.match(targets.po.innerHTML, /version is stale/); assert.match(targets.po.innerHTML, /data-receiving-field="countedQuantity" data-receiving-line="p1" value="8"/);
const failed = JSON.parse(calls.findLast(call => call.url.endsWith('/receive')).options.body);
await click({ receivingCommand: 'receive' });
const retry = JSON.parse(calls.findLast(call => call.url.endsWith('/receive')).options.body);
assert.equal(retry.requestId, failed.requestId); assert.equal(retry.expectedVersion, 0);
assert.equal(retry.lines[0].evidenceDocumentIds.length, 1);

// Busy guard prevents duplicate receipt clicks while a request is in flight.
requestFailure = ''; let release;
pauseReceipt = new Promise(resolve => release = resolve);
const beforeReceive = calls.filter(call => call.url.endsWith('/receive')).length;
mount.onclick({ target: { closest: () => ({ dataset: { receivingCommand: 'receive' } }) } });
mount.onclick({ target: { closest: () => ({ dataset: { receivingCommand: 'receive' } }) } });
await tick(); assert.equal(calls.filter(call => call.url.endsWith('/receive')).length, beforeReceive + 1);
release(); await tick(); pauseReceipt = null;
assert.equal(po.acceptedMaterials.length, 1); assert.equal(po.lines[0].receivedQuantity, 8); assert.equal(po.lines[0].openQuantity, 0);
assert.match(targets.po.innerHTML, /SIM-AM-0000001/); assert.match(targets.po.innerHTML, /Not Linked/);
assert.match(targets.po.innerHTML, /09\/24\/2026/); // Timestamp is displayed in the factory timezone.
assert.match(targets.po.innerHTML, /Accepted · Awaiting staging/);
assert.equal(ui.queueItems(po.lines.map(line => ({ ...line.purchase, ...line })), 'expected').length, 1);

// Print uses a real same-origin GET-only preview URL. Reopening cannot create a receipt.
const beforePrint = calls.length, snapshot = JSON.stringify(po);
assert.match(targets.po.innerHTML, /target="_blank" rel="noopener" href="\/SRC\/workspaces\/receiving\/receiving-print-preview.html\?kind=po&amp;id=p1"/);
assert.match(targets.po.innerHTML, /receiving-print-preview.html\?kind=label&amp;id=SIM-AM-0000001/);
ui.poMarkup(); ui.poMarkup();
assert.equal(calls.length, beforePrint); assert.equal(JSON.stringify(po), snapshot); assert.equal(previews.length, 0);

// Explicit staging uses its own material version and is retained in a read-only record.
input({ receivingField: 'stage', receivingMaterial: 'SIM-AM-0000001' }, 'SIM / Kitting staging');
await click({ receivingCommand: 'stage', receivingMaterial: 'SIM-AM-0000001' });
assert.equal(po.acceptedMaterials[0].availableQuantity, 8); assert.equal(po.acceptedMaterials[0].version, 2);
assert.match(targets.po.innerHTML, /Ready for Kitting/); assert.match(targets.po.innerHTML, /SIM \/ Kitting staging/);
assert.doesNotMatch(targets.po.innerHTML, /data-receiving-command="stage" data-receiving-material="SIM-AM-0000001"/);
await click({ receivingCommand: 'close-po' }); await click({ receivingView: 'received' });
assert.match(targets.results.innerHTML, /1 of 1 received PO lines/);

// Reload / repeat delivery offers only the remaining quantities, with no prior count copied in.
po = partial; await ui.openPo('p1');
assert.match(targets.po.innerHTML, /Frozen at receipt/); assert.match(targets.po.innerHTML, /max="5"/);
assert.match(targets.po.innerHTML, /data-receiving-field="countedQuantity" data-receiving-line="p1" value=""/);
po = clone(initial); po.canReceive = false; await ui.openPo('p1');
assert.match(targets.po.innerHTML, /Read-only access/); assert.match(targets.po.innerHTML, /data-receiving-command="receive" disabled/);
const beforeDenied = calls.filter(call => call.options.method === 'POST').length;
await click({ receivingCommand: 'receive' }); assert.equal(calls.filter(call => call.options.method === 'POST').length, beforeDenied);
assert.match(targets.po.innerHTML, /Receiving permission is required/);
assert.doesNotMatch(ui.materialMarkup({ receiptLineId: '<script>bad</script>', partNumber: '<img src=x>', checks: {} }), /<script>|<img/);
assert.match(css, /@media\(max-width:680px\)/); assert.match(css, /minmax\(100px,1fr\)/);
assert.doesNotMatch(source, /[Ââ]/); assert.doesNotMatch(source, /\/kitting\/.*(?:resume|submit)|KIT_COMPLETE|localStorage|sessionStorage/);
console.log('PASS Receiving workflow UI: full PO, explicit counts, partial/multi-demand disposition, required checks, frozen applicability, verified upload routing, stale/idempotent retries, double-click guard, accepted identity, factory dates, stage/reload/history, print/reprint purity, permissions and responsive styling.');

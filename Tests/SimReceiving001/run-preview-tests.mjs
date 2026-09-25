import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('SRC/workspaces/receiving/receiving-print-preview.js');
const page = read('SRC/workspaces/receiving/receiving-print-preview.html');
assert.match(page, /purchasing-po-document.js/); assert.match(page, /receiving-accepted-material-label.js/);
const calls = [], status = { textContent: '', role: '', setAttribute(key, value) { this[key] = value; } };
let html = '', fail = false, contentType = 'application/json';
const savedRecord = { poNumber: 'SIM-PO-0001', receiptLineId: 'SIM-AM-0000001', acceptedQuantity: 8 };
const document = { open() {}, write(value) { html = value; }, close() {}, getElementById: () => status };
const window = { location: { search: '?kind=po&id=purchase-1' },
  PurchasingPoDocument: { printDocument: record => '<html>PO ' + record.poNumber + '</html>' },
  ReceivingAcceptedMaterialLabel: { printDocument: record => '<html>Label ' + record.receiptLineId + '</html>' },
  fetch: async (url, options) => { calls.push({ url, options }); return { ok: !fail, status: fail ? 403 : 200,
    headers: { get: () => contentType }, json: async () => savedRecord }; } };
vm.runInNewContext(source, { window, document, URLSearchParams });
await new Promise(resolve => setImmediate(resolve));
assert.match(html, /PO SIM-PO-0001/); assert.equal(calls[0].url, '/api/sim/receiving/po/purchase-1');
window.location.search = '?kind=label&id=SIM-AM-0000001';
const before = JSON.stringify(savedRecord);
await window.DleReceivingPrintPreview.load(); await window.DleReceivingPrintPreview.load();
assert.match(html, /Label SIM-AM-0000001/); assert.equal(calls.at(-1).url, '/api/sim/receiving/accepted-material/SIM-AM-0000001');
assert.equal(JSON.stringify(savedRecord), before);
assert.ok(calls.every(call => call.options.method === 'GET' && call.options.credentials === 'same-origin' && call.options.cache === 'no-store'));
assert.throws(() => window.DleReceivingPrintPreview.requestFor('?kind=delete&id=x'), /Choose a saved/);
assert.throws(() => window.DleReceivingPrintPreview.requestFor('?kind=po'), /Choose a saved/);
assert.equal(window.DleReceivingPrintPreview.requestFor('?kind=po&id=a%2Fb').endpoint, '/api/sim/receiving/po/a%2Fb');
fail = true; assert.equal(await window.DleReceivingPrintPreview.load(), null); assert.equal(status.role, 'alert'); assert.match(status.textContent, /403/);
fail = false; contentType = 'text/html'; assert.equal(await window.DleReceivingPrintPreview.load(), null); assert.match(status.textContent, /Unlock SIM/);
assert.doesNotMatch(source, /method: '(?:POST|PUT|PATCH|DELETE)'|localStorage|sessionStorage/);
console.log('PASS Receiving real-URL preview: authoritative GET routes, existing pure renderers, repeat-safe loading, session errors, invalid input, no business writes.');

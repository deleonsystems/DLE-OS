import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const shell = read('SRC', 'shell', 'operator-header.css');
const invoice = read('SRC', 'modules', 'invoice-history', 'invoice-history.css');
const workOrder = read('SRC', 'modules', 'work-order-dashboard', 'work-order-dashboard.css');
const label = read('SRC', 'modules', 'work-order-dashboard', 'kitting-kit-id-label.js');
const simShell = read('Tools', 'SimRuntime', 'DleOs.SimHost', 'SimShellRenderer.cs');

assert.match(shell, /grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto/);
assert.match(shell, /@media\s*\(min-width:700px\) and \(max-width:1280px\)/);
assert.match(shell, /\.dle-operator-header\s*\{[\s\S]*?grid-template-areas:/);
assert.match(shell, /body\s*>\s*main[\s\S]*?overflow-x:\s*hidden[\s\S]*?overflow-y:\s*auto/);

assert.match(invoice, /data-workspace-home="invoice-history"\]\s*\{[^}]*width:\s*100%/);
assert.match(invoice, /grid-template-columns:\s*minmax\(0,1fr\)/);
assert.match(invoice, /invoice-history-header[^}]*min-width:\s*0/);
assert.match(invoice, /invoice-history-refresh-evidence small\s*\{[^}]*overflow-wrap:\s*anywhere/);
assert.match(invoice, /@media \(max-width:1050px\)[\s\S]*?invoice-history-header,\.invoice-history-toolbar[^}]*flex-direction:\s*column/);
assert.match(invoice, /invoice-history-table-wrap[^}]*overflow:\s*auto/);
assert.match(invoice, /invoice-history-table[^}]*min-width:\s*1180px/);

assert.match(workOrder, /@media \(max-width: 900px\)/);
assert.match(workOrder, /data-dashboard-view="production"\][^}]*\.work-order-dashboard-module-view-selector\s*\{[^}]*flex-direction:\s*row/);
assert.match(workOrder, /work-order-dashboard-module-document-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);

assert.match(label, /border-bottom:1pt solid #000;overflow:hidden/);
assert.match(label, /text-overflow:ellipsis;white-space:nowrap/);
assert.match(label, /\.kit-id-field\.assembly strong\{/);
assert.match(label, /-webkit-line-clamp:3/);
assert.match(label, /@page\{size:' \+ LABEL_WIDTH_IN \+ 'in ' \+ LABEL_HEIGHT_IN \+ 'in;margin:0\}/);

assert.doesNotMatch(simShell, /sim-desktop\.css|sim-invoice-history\.css|sim-work-order-dashboard\.css/i);
assert.doesNotMatch(simShell, /body\[data-sim-runtime="true"\][^{]*(invoice-history|work-order-dashboard)/i);

console.log('PASS: 21 shared desktop responsive UI contracts.');

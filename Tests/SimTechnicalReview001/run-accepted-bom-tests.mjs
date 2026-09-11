import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const values = partNumber => ({ lineNumber: '1', partNumber, quantity: '3', designators: 'R1', description: 'Accepted description' });
const candidate = (id, part, componentType = 'SUBASSEMBLY') => ({
  id, governingDocumentId: 'saved-source', governingSha256: 'saved-hash', page: 2,
  supportingComparison: 'Saved comparison', rows: [{ values: values(part), extracted: values('original'),
    componentType, confirmed: true, comparison: {}, bounds: [], corrections: [],
    alternates: ['ALT-A', 'ALT-B'].map(partNumber => ({ partNumber, reviewStatus: 'CONFIRMED', history: [] })) }]
});
const fixture = { intakeId: 'VERSION-FIXTURE', assemblies: [], technicalFiles: [],
  technicalReview: { materialsReviewStatus: 'QUALIFIED', candidateBom: candidate('current', 'EDITABLE-CURRENT'),
    bomAcceptances: [1, 2].map(version => ({ version, candidate: candidate('saved-' + version, 'ACCEPTED-' + version),
      reviewedBy: 'Reviewer ' + version, reviewedAtUtc: '2026-09-11T10:00:00Z' })) } };
let persisted = fixture;
const before = JSON.stringify(fixture);
const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: '', dataset: {}, hidden: false, focus() {}, classList: { toggle() {}, remove() {} } });
  return nodes.get(id);
};
const handlers = {};
const mount = node('mount');
mount.addEventListener = (type, handler) => handlers[type] = handler;
const calls = [];
const window = { DleOsCapabilities: { can: () => true }, async fetch(url, options = {}) {
  calls.push({ url, method: options.method || 'GET' });
  if (url.endsWith('.html')) return { ok: true, text: async () => '' };
  return { ok: true, json: async () => url.endsWith('/analysis-jobs/latest') ? { job: null } :
    url === '/api/sim/technical-reviews' ? { items: [] } : { record: structuredClone(persisted), reviewStatusLabel: 'BOM Review Complete' } };
} };
const document = { querySelector: () => mount, getElementById: node, addEventListener() {} };
const sourcePath = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const source = fs.readFileSync(sourcePath || new URL('../../SRC/workspaces/technical-review/technical-review-workspace.js', import.meta.url), 'utf8');
vm.runInNewContext(source, { window, document, setTimeout, clearTimeout, setInterval, clearInterval });
const workspace = window.DleWorkspaces['technical-review'];
const click = async (action, version) => {
  const button = { dataset: { technicalReviewAction: action, acceptedVersion: String(version) } };
  // A nested label has no version attribute of its own: use the actual button.
  handlers.click({ target: { dataset: {}, closest: selector => selector === '[data-technical-review-action]' ? button : null } });
  await new Promise(resolve => setImmediate(resolve));
};
const html = () => node('technicalReviewDetail').innerHTML;
await workspace.render();
await workspace.openReview(fixture.intakeId);
assert.match(html(), /BOM Review Complete/);
for (const version of [1, 2, 1]) {
  await click('accepted-bom', version);
  assert.match(html(), new RegExp('id="acceptedBomTitle"[^>]*>Accepted BOM Version ' + version));
  assert.match(html(), new RegExp('ACCEPTED-' + version));
  assert.doesNotMatch(html(), new RegExp('ACCEPTED-' + (version === 1 ? 2 : 1) + '|EDITABLE-CURRENT'));
  for (const label of ['Line', 'Part Number', 'Alternate Part(s)', 'Qty / Assy', 'Component Type', 'Designators', 'Description', 'Status']) assert.ok(html().includes('>' + label + '</th>'));
  for (const value of ['ALT-A', 'ALT-B', 'Subassembly', 'Reviewer ' + version, '2026-09-11T10:00:00Z', 'Source / History', 'saved-hash']) assert.ok(html().includes(value), value);
  assert.doesNotMatch(html(), /<input|<select|<textarea|Edit \/ Add Details|candidate-confirm|alternate-add|alternate-edit|alternate-remove|complete-bom/);
}
await click('candidate-confirm');
handlers.change({ target: { dataset: { componentRow: '0' }, value: 'OTHER' } });
await click('accepted-back');
assert.match(html(), /Choose how to proceed/);
assert.match(html(), /BOM Review Complete/);
await workspace.render();
await workspace.openReview(fixture.intakeId);
await click('accepted-bom', 2);
assert.match(html(), /ACCEPTED-2/);
await click('accepted-bom', 99);
assert.match(html(), /Accepted BOM unavailable/);
assert.doesNotMatch(html(), /EDITABLE-CURRENT|ACCEPTED-1|ACCEPTED-2/);
assert.equal(JSON.stringify(fixture), before);
assert.ok(calls.every(call => call.method === 'GET'), 'view and back navigation never write');
console.log('PASS: two accepted versions, nested click target, snapshot isolation, columns, alternates, metadata, read-only guards, back, refresh/reopen, missing version.');

// Read the real record without modifying it; regression covers legacy null arrays too.
if (process.argv.includes('--local-record')) {
const dataset = JSON.parse(fs.readFileSync(new URL('../../.sim-state/data/rfq-intakes.json', import.meta.url), 'utf8'));
persisted = dataset.records.find(r => r.intakeId === 'RFQI-SIM-0033');
assert.ok(persisted?.technicalReview.bomAcceptances.some(a => a.version === 1));
assert.equal(persisted.technicalReview.materialsReviewStatus, 'QUALIFIED');
await workspace.openReview(persisted.intakeId);
await click('accepted-bom', 1);
assert.match(html(), /Accepted BOM Version 1/);
assert.match(html(), /SIM Administrator/);
assert.doesNotMatch(html(), /<input|<select|Edit \/ Add Details/);
for (const row of persisted.technicalReview.bomAcceptances[0].candidate.rows) assert.ok(html().includes(row.values.partNumber));
console.log('PASS: persisted RFQI-SIM-0033 Version 1 renders its accepted rows and reviewer without mutation.');
}

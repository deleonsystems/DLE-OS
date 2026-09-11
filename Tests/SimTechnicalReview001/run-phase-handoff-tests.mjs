import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: '', dataset: {}, hidden: false, focus() {}, classList: { toggle() {}, remove() {} } });
  return nodes.get(id);
};
const handlers = {};
const mount = node('mount');
mount.addEventListener = (name, handler) => handlers[name] = handler;
const row = { values: { partNumber: 'SAVED-PART' }, extracted: {}, comparison: {}, corrections: [], alternates: [], componentType: 'OTHER' };
const completed = { intakeId: 'PHASE-FIXTURE', status: 'TECHNICAL_REVIEW_IN_PROGRESS', assemblies: [], technicalFiles: [], technicalReview: {
  materialsReviewStatus: 'QUALIFIED', nextReviewPhase: 'MANUFACTURING_LABOR_REVIEW',
  bomAcceptances: [{ version: 1, reviewedBy: 'Saved reviewer', reviewedAtUtc: '2026-09-11T10:00:00Z', candidate: { id: 'saved', rows: [row] } }]
} };
let record = structuredClone(completed), allowed = true, rejectAssemblyType = false;
const calls = [];
const window = { DleOsCapabilities: { can: () => allowed }, async fetch(url, options = {}) {
  calls.push({ url, ...options });
  if (url.endsWith('.html')) return { ok: true, text: async () => '' };
  if (url.endsWith('/assembly-type')) {
    if (rejectAssemblyType) return { ok: false, status: 409, json: async () => ({ message: 'Gate save rejected' }) };
    assert.equal(JSON.parse(options.body).assemblyType, 'PCB_ASSEMBLY');
    record.technicalReview.assemblyType = 'PCB_ASSEMBLY';
    record.technicalReview.nextReviewPhase = 'MATERIAL_BOM_REVIEW';
    record.technicalReview.materialsReviewStatus = 'IN_PROGRESS';
  }
  if (url.endsWith('/assembly-history')) record.technicalReview.assemblyHistory = { historyFound: false, records: [] };
  if (url.endsWith('/disposition')) {
    const disposition = JSON.parse(options.body).disposition;
    if (disposition === 'START_TECHNICAL_REVIEW') {
      record.status = 'TECHNICAL_REVIEW_IN_PROGRESS';
      record.technicalReview.manufacturingReviewStatus = 'IN_PROGRESS';
    } else {
      assert.equal(disposition, 'NO_LONGER_REQUIRED');
      record.status = 'NO_LONGER_REQUIRED';
    }
  }
  return { ok: true, json: async () => url.endsWith('/analysis-jobs/latest') ? { job: null } :
    url === '/api/sim/technical-reviews' ? { items: [] } : { record: structuredClone(record), reviewStatusLabel: 'In progress' } };
} };
const document = { querySelector: () => mount, getElementById: node, addEventListener() {} };
vm.runInNewContext(fs.readFileSync(new URL('../../SRC/workspaces/technical-review/technical-review-workspace.js', import.meta.url), 'utf8'), { window, document, setTimeout, clearTimeout, setInterval, clearInterval });
const workspace = window.DleWorkspaces['technical-review'];
const click = async (action, version = 1) => {
  const button = { dataset: { technicalReviewAction: action, acceptedVersion: String(version) } };
  handlers.click({ target: { dataset: {}, closest: s => s === '[data-technical-review-action]' ? button : null } });
  await new Promise(resolve => setImmediate(resolve));
};
const html = () => node('technicalReviewDetail').innerHTML;
const expectComplete = () => {
  assert.match(html(), /Material \/ BOM Review<\/h4><p class="technical-review-phase-status">Complete/);
  assert.match(html(), /Manufacturing \/ Labor Review<\/h4><p class="technical-review-phase-status">Next · Not Started/);
  assert.match(html(), /technical-review-phase-acceptances[\s\S]*?data-technical-review-action="accepted-bom"[\s\S]*?<\/div><\/section>/);
  assert.doesNotMatch(html(), /Overall Technical Review remains in progress\./);
  assert.match(html(), /Start Manufacturing \/ Labor Review/);
  assert.match(html(), /No Longer Required/);
  assert.doesNotMatch(html(), /Start Technical Review/);
};
await workspace.render();
await workspace.openReview(record.intakeId);
expectComplete();
const snapshot = JSON.stringify(record);
await click('start'); // Stale UI events must not restart the completed materials phase.
await click('manufacturing');
assert.match(html(), /id="manufacturingReviewTitle"/);
assert.match(html(), /Materials definition qualified/);
assert.match(html(), /not ready for quote/);
assert.doesNotMatch(html(), /Have we built this assembly before|<input|<select/);
await click('review-back');
expectComplete();
await click('accepted-bom');
assert.match(html(), /Accepted BOM Version 1/);
assert.match(html(), /SAVED-PART/);
assert.doesNotMatch(html(), /<input|<select/);
await click('accepted-back');
expectComplete();
await workspace.render();
await workspace.openReview(record.intakeId);
expectComplete();
assert.equal(JSON.stringify(record), snapshot);
assert.ok(calls.every(c => !c.method || c.method === 'GET'), 'phase entry and navigation are read-only');
await click('close');
assert.match(html(), />Delete<\/button>/);
assert.match(html(), />Save<\/button>/);
await click('save-close');
assert.equal(record.status, 'NO_LONGER_REQUIRED');
assert.deepEqual(record.technicalReview, completed.technicalReview);
assert.match(html(), /This review is closed/);

record = { ...structuredClone(completed), technicalReview: {} };
await workspace.openReview(record.intakeId);
assert.match(html(), /Start Technical Review/);
assert.doesNotMatch(html(), /Start Manufacturing \/ Labor Review/);
record.technicalReview = { materialsReviewStatus: 'NEEDS_REVIEW', nextReviewPhase: 'MANUFACTURING_LABOR_REVIEW' };
await workspace.openReview(record.intakeId);
assert.match(html(), /Start Technical Review/);
record.technicalReview = { materialsReviewStatus: 'QUALIFIED' };
await workspace.openReview(record.intakeId);
assert.doesNotMatch(html(), /Start Technical Review|Start Manufacturing \/ Labor Review/);
record = structuredClone(completed); allowed = false;
await workspace.openReview(record.intakeId);
assert.match(html(), /data-technical-review-action="manufacturing" disabled/);
await click('manufacturing');
assert.doesNotMatch(html(), /id="manufacturingReviewTitle"/);
console.log('PASS: persisted phase gating, summary, forward-only handoff, immutable acceptance, back/reopen, legacy/incomplete state, permission gating, unchanged close/save behavior.');

record = { intakeId: 'LABOR-FIRST-FIXTURE', status: 'READY_FOR_RFQ_QUALIFICATION', assemblies: [], technicalFiles: [], technicalReview: {
  reviewPhaseOrder: ['MANUFACTURING_LABOR_REVIEW', 'MATERIAL_BOM_REVIEW'], nextReviewPhase: 'MANUFACTURING_LABOR_REVIEW',
  manufacturingReviewStatus: 'NOT_STARTED', materialsReviewStatus: 'NOT_STARTED'
} };
allowed = true;
await workspace.openReview(record.intakeId);
assert.ok(html().indexOf('Manufacturing / Labor Review') < html().indexOf('Material / BOM Review'));
assert.equal((html().match(/>Not Started<\/p>/g) || []).length, 2);
const callIndex = calls.length;
await click('start');
assert.equal(record.technicalReview.manufacturingReviewStatus, 'IN_PROGRESS');
assert.equal(record.technicalReview.materialsReviewStatus, 'NOT_STARTED');
assert.match(html(), /What type of assembly is this\?/);
assert.match(html(), /value="PCB_ASSEMBLY"/);
assert.doesNotMatch(html(), /Have we built this assembly before|Candidate BOM/);
assert.ok(calls.slice(callIndex).every(c => !/assembly-history|technical-package|candidate-bom|analysis-jobs$/.test(c.url)));
await click('review-back');
assert.match(html(), />In Progress<\/p>/);
await workspace.render();
await workspace.openReview(record.intakeId);
assert.match(html(), />In Progress<\/p>/);
await click('start');
assert.match(html(), /id="laborFirstTitle"/);
const beforeEmpty = calls.length;
await click('save-assembly-type');
assert.match(html(), /Select PCB Assembly to continue/);
assert.equal(calls.length, beforeEmpty);
node('technicalReviewAssemblyType').value = 'PCB_ASSEMBLY';
rejectAssemblyType = true;
await click('save-assembly-type');
assert.match(html(), /Gate save rejected/);
assert.equal(record.technicalReview.assemblyType, undefined);
rejectAssemblyType = false;
await click('save-assembly-type');
assert.equal(record.technicalReview.assemblyType, 'PCB_ASSEMBLY');
assert.match(html(), /Have we built this assembly before/);
assert.doesNotMatch(html(), /What type of assembly is this/);
const gateSaveCount = calls.filter(c => c.url.endsWith('/assembly-type')).length;
await click('review-back');
assert.match(html(), /Assembly type: PCB Assembly/);
assert.equal((html().match(/>Start Technical Review<\/button>/g) || []).length, 1);
await workspace.render();
await workspace.openReview(record.intakeId);
await click('start');
assert.match(html(), /Have we built this assembly before/);
assert.equal(calls.filter(c => c.url.endsWith('/assembly-type')).length, gateSaveCount);
console.log('PASS: single Start action, assembly gate validation/save failure, persisted PCB answer, baseline reuse and refresh/reopen without repeated gate.');

if (process.argv.includes('--local-record')) {
  record = JSON.parse(fs.readFileSync(new URL('../../.sim-state/data/rfq-intakes.json', import.meta.url), 'utf8')).records.find(r => r.intakeId === 'RFQI-SIM-0033');
  allowed = true;
  await workspace.openReview(record.intakeId);
  expectComplete();
  await click('manufacturing');
  assert.match(html(), /id="manufacturingReviewTitle"/);
  console.log('PASS: persisted RFQI-SIM-0033 opens the next-phase handoff. No local data writes.');
}

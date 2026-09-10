import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: '', dataset: {}, hidden: false, focus() {}, classList: { toggle() {}, remove() {} } });
  return nodes.get(id);
};
const mount = node('mount');
const handlers = {};
mount.addEventListener = (event, handler) => { handlers[event] = handler; };
let record = { intakeId: 'FIXTURE', customer: { customerName: 'Synthetic customer' }, assemblies: [{ assemblyNumber: 'PROVIDER-INPUT', revision: 'C', quantity: 3 }], technicalFiles: [{ name: 'current.csv' }, { name: 'alternate.pdf' }], status: 'READY_FOR_RFQ_QUALIFICATION' };
let failLookup = true;
const calls = [];
const window = {
  DleOsCapabilities: { can: () => true },
  async fetch(url, options = {}) {
    calls.push(url);
    if (url.endsWith('.html')) return { ok: true, text: async () => '' };
    if (url.endsWith('/disposition')) record = { ...record, status: 'TECHNICAL_REVIEW_IN_PROGRESS', technicalReview: record.technicalReview || {} };
    if (url.endsWith('/assembly-history')) {
      if (failLookup) throw new Error('History source unavailable');
      record.technicalReview.assemblyHistory = { historyFound: true, revisionsFound: ['C'], mostRecentRevision: 'C', records: [{ revision: 'C', builtAt: '2026-08-01', quantity: 3, recordId: 'PROVIDER-RECORD' }] };
    }
    if (url.endsWith('/assembly-classification')) record.technicalReview.assemblyHistory.assemblyClassification = JSON.parse(options.body).assemblyClassification;
    if (url.endsWith('/technical-package')) { record.technicalReview.technicalPackage = JSON.parse(options.body); record.technicalReview.materialsDefinition = null; }
    if (url.endsWith('/materials-definition')) record.technicalReview.materialsDefinition = { result: 'DIFFERENCES_FOUND', comparisonCompleted: true, currentBom: { assemblyNumber: 'PROVIDER-INPUT', revision: 'C', reference: 'CURRENT-BOM' }, priorBom: { assemblyNumber: 'PROVIDER-INPUT', revision: 'C', reference: 'PRIOR-BOM' }, parentAssemblyMatch: true, revisionMatch: true, currentLineCount: 2, priorLineCount: 2, unchangedParts: [], addedParts: ['ADDED-PART'], removedParts: ['REMOVED-PART'], quantityChanges: [{partNumber:'CHANGED-PART',priorQuantity:1,currentQuantity:2}], subassemblies:[{partNumber:'SUB-PART',quantityPerAssembly:1,technicalReference:null}] };
    if (url.endsWith('/materials-definition')) record.technicalReview.subassemblyCoverage = [{partNumber:'SUB-PART',quantityPerAssembly:1,knownReference:null,customerDocumentIds:[],coverageState:'UNRESOLVED'}];
    if (url.endsWith('/candidate-bom')) {
      const values = {lineNumber:'1',partNumber:'EXTRACTED-PART',quantity:'2',designators:'C1',description:'Source description'};
      record.technicalReview.candidateBom ||= {id:'candidate-id',governingDocumentId:'DOC-001',governingSha256:'hash',page:2,parser:'test parser',supportingComparison:'UNAVAILABLE: supporting comparison',rows:[{extracted:values,values:{...values},comparison:Object.fromEntries(Object.keys(values).map(k=>[k,'UNCERTAIN'])),bounds:[1,2,3,4],confirmed:false,corrections:[]}]};
      if (options.method === 'PUT') {
        assert.equal(options.headers['Content-Type'], 'application/json');
        const request = JSON.parse(options.body);
        assert.equal(request.candidateId,'candidate-id');
        record.technicalReview.candidateBom.rows[0].values = request.values;
        record.technicalReview.candidateBom.rows[0].confirmed = true;
      }
    }
    return { ok: true, json: async () => url === '/api/sim/technical-reviews' ? { items: [] } : { record: structuredClone(record), reviewStatusLabel: 'In progress' } };
  }
};
const document = { querySelector: () => mount, getElementById: node, addEventListener() {} };
vm.runInNewContext(fs.readFileSync(new URL('../../SRC/workspaces/technical-review/technical-review-workspace.js', import.meta.url), 'utf8'), { window, document });
const workspace = window.DleWorkspaces['technical-review'];
const click = async action => {
  handlers.click({ target: { closest: selector => selector === '[data-technical-review-action]' ? { dataset: { technicalReviewAction: action } } : null } });
  await new Promise(resolve => setImmediate(resolve));
};
await workspace.render();
await workspace.openReview('FIXTURE');
assert.match(node('technicalReviewDetail').innerHTML, /Start Technical Review/);
await click('start');
assert.match(node('technicalReviewDetail').innerHTML, /Retry history lookup/);
assert.doesNotMatch(node('technicalReviewDetail').innerHTML, />New Assembly<|<form/);
failLookup = false;
await click('retry-history');
assert.match(node('technicalReviewDetail').innerHTML, /Rev C/);
assert.doesNotMatch(node('technicalReviewDetail').innerHTML, /Rev A|Rev B/);
await click('confirm-history');
assert.equal(record.technicalReview.assemblyHistory.assemblyClassification, 'EXISTING_ASSEMBLY');
assert.match(node('technicalReviewDetail').innerHTML, /Account for the technical package/);
assert.match(node('technicalReviewDetail').innerHTML, /2 unclassified/);
handlers.change({target:{dataset:{packageField:'documentType'},value:'BOM'}});
handlers.change({target:{dataset:{packageField:'applicability'},value:'PARENT_ASSEMBLY'}});
handlers.click({target:{closest:selector=>selector==='[data-package-index]'?{dataset:{packageIndex:'1'}}:null}});
handlers.change({target:{dataset:{packageField:'documentType'},value:'SUBASSEMBLY_BOM'}});
handlers.change({target:{dataset:{packageField:'applicability'},value:'SUBASSEMBLY'}});
handlers.input({target:{dataset:{packageField:'subassemblyPartNumber'},value:'SUB-PART'}});
await click('save-package');
assert.equal(record.technicalReview.technicalPackage.documents[1].subassemblyPartNumber, 'SUB-PART');
assert.match(node('technicalReviewDetail').innerHTML, /Which BOM governs/);
assert.equal(record.technicalReview.technicalPackage.governingBomDocumentId, null);
await click('compare-package');
assert.match(node('technicalReviewDetail').innerHTML, /remains unresolved/);
handlers.change({target:{dataset:{governingId:'DOC-001'}}});
await click('compare-package');
assert.equal(record.technicalReview.technicalPackage.governingBomDocumentId, 'DOC-001');
assert.match(node('technicalReviewDetail').innerHTML, /Material Definition — Differences Found/);
assert.match(node('technicalReviewDetail').innerHTML, /ADDED-PART/);
assert.match(node('technicalReviewDetail').innerHTML, /REMOVED-PART/);
assert.match(node('technicalReviewDetail').innerHTML, /qty 1 → 2/);
await click('coverage');
assert.match(node('technicalReviewDetail').innerHTML, /Missing .* unresolved/);
assert.match(node('technicalReviewDetail').innerHTML, /Manufacturing Definition is not implemented/);
await click('materials');
await click('governing-back');
await click('package-back');
await click('history-back');
assert.match(node('technicalReviewDetail').innerHTML, /Have we built this assembly before/);
await click('materials');
assert.match(node('technicalReviewDetail').innerHTML, /Materials Definition saved/);
await click('candidate');
assert.match(node('technicalReviewDetail').innerHTML, /Candidate BOM — Pilot/);
assert.match(node('technicalReviewDetail').innerHTML, /EXTRACTED-PART/);
assert.match(node('technicalReviewDetail').innerHTML, /Supporting matches: not evaluated/);
for (const [key,value] of Object.entries(record.technicalReview.candidateBom.rows[0].values)) node('candidate-' + key).value = value;
node('candidate-partNumber').value = 'REVIEWER-CORRECTION';
await click('candidate-confirm');
assert.equal(record.technicalReview.candidateBom.rows[0].values.partNumber,'REVIEWER-CORRECTION');
assert.equal(record.technicalReview.candidateBom.rows[0].extracted.partNumber,'EXTRACTED-PART');
assert.match(node('technicalReviewDetail').innerHTML, /1 \/ 1 rows reviewed/);
await click('materials');
await workspace.render();
assert.equal(node('technicalReviewQueueView').hidden, false);
assert.equal(node('technicalReviewDetailView').hidden, true);
assert.ok(calls.every(url => !url.includes('/live/')));
console.log('PASS: guided UI lookup failure/retry, provider-driven revisions, confirmation, SIM routing, and Home re-entry.');

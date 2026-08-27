import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const labelSource = read('SRC/modules/work-order-dashboard/kitting-bag-label.js');
const trialSource = read('SRC/modules/work-order-dashboard/active-kitting-trial.js');
const dashboard = read('SRC/modules/work-order-dashboard/work-order-dashboard.js');
const styles = read('SRC/modules/work-order-dashboard/work-order-dashboard.css');
const shell = read('DLE_Work_Center_v4.0.0.html');
const report = JSON.parse(read(
  'Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/work-order-0115621.json'));

const context = vm.createContext({ window: {}, Object, Date });
vm.runInContext(trialSource, context);
vm.runInContext(labelSource, context);
const trial = context.window.ActiveKittingTrial;
const labels = context.window.KittingBagLabel;
const draft = trial.createDraft(report, 'Miguel De Leon');

const normal = draft.groups.find(group => group.sequence === '005');
const normalModel = labels.createVariants(draft, normal)[0];
assert.equal(normalModel.workOrder, '0115621');
assert.equal(normalModel.customerName, 'MEGGITT SAFETY SYSTEMS',
  'the label projects the governed Released BOM customer display identity');
assert.equal(normalModel.assembly, 'H24589');
assert.equal(normalModel.revision, 'J');
assert.equal(normalModel.sequence, '005');
assert.equal(normalModel.location, '', 'unqualified WO 0115621 Location remains blank');
assert.equal(normalModel.locationAmbiguous, false);
assert.equal(normalModel.partNumber, 'H24590 REV B');
assert.equal(normalModel.description, 'PRINTER CIRCUIT BOARD');
assert.deepEqual(JSON.parse(JSON.stringify(normalModel.materialNotes)), ['PCB BARE BOARD REV B']);
assert.equal(normalModel.requiredEach, 1);
assert.equal(normalModel.findNumber, '1');

const references = draft.groups.find(group => group.sequence === '010');
const referenceModel = labels.createVariants(draft, references)[0];
assert.deepEqual(JSON.parse(JSON.stringify(referenceModel.references.slice(0, 4))), ['C8', 'C9', 'C10', 'C11']);
assert.equal(referenceModel.findNumber, '3');
assert.equal(referenceModel.location, '', 'blank Location is preserved for Seq 010');

normal.primaryPart.location = 'A-12';
const locatedModel = labels.createVariants(draft, normal)[0];
assert.equal(locatedModel.location, 'A-12', 'a governed BOM/material-row Location projects to the label');
normal.primaryPart.inventoryLocation = 'B-09';
const ambiguousLocationModel = labels.createVariants(draft, normal)[0];
assert.equal(ambiguousLocationModel.location, '', 'conflicting location projections fail closed');
assert.equal(ambiguousLocationModel.locationAmbiguous, true);
delete normal.primaryPart.location;
delete normal.primaryPart.inventoryLocation;

trial.applyMethod(draft, references.sequence, trial.METHODS.COMPLETE);
trial.setSelectedPart(draft, references.sequence, 'CDR33BX104AKUS7370');
const relatedModel = labels.createVariants(draft, references)[0];
assert.equal(relatedModel.sequence, '010', 'Related selection retains grouped Bag / WO Seq identity');
assert.equal(relatedModel.partNumber, 'CDR33BX104AKUS');
assert.equal(relatedModel.description, 'CAP,0.1UF,50V,1210');
assert.equal(relatedModel.requiredEach, 12, 'grouped requirement required-each is retained');
assert.deepEqual(JSON.parse(JSON.stringify(relatedModel.materialRows.map(row => ({
  sequence: row.sequence, partNumber: row.partNumber, description: row.description, requiredEach: row.requiredEach
})))), [
  { sequence: '010', partNumber: 'CDR33BX104AKUS', description: 'CAP,0.1UF,50V,1210', requiredEach: 12 },
  { sequence: '011', partNumber: 'CDR33BX104AKUS7370', description: 'CAP CER 0.1UF 50V BX 1210', requiredEach: null }
], 'main and governed Related rows retain source order, source Seq, identity, Description, and grouped Qty semantics');

trial.applyMethod(draft, references.sequence, trial.METHODS.COUNT, 10);
trial.updateAllocation(draft, references.sequence, 'A1', {
  partNumber: 'CDR33BX104AKUS', quantity: 5
});
trial.addAllocation(draft, references.sequence);
trial.updateAllocation(draft, references.sequence, 'A2', {
  partNumber: 'CDR33BX104AKUS7370', quantity: 5
});
const splitModels = labels.createVariants(draft, references);
assert.equal(splitModels.length, 1, 'all allocated alternatives remain one grouped bag-label set');
assert.deepEqual(JSON.parse(JSON.stringify(splitModels[0].materialRows.map(row => row.partNumber))),
  ['CDR33BX104AKUS', 'CDR33BX104AKUS7370']);

const document = labels.printDocument(referenceModel);
assert.match(document, /@page\{size:100mm 62mm;margin:0\}/);
assert.match(document, /height:50\.8mm/);
assert.match(document, /kitting-bag-label-sheet\{width:100mm;height:62mm;display:flex;align-items:center;justify-content:center/,
  'each portable 2 x 4 inch core is vertically centered on its own Brother stock sheet');
assert.equal(labels.BROTHER_SAFE_HORIZONTAL_INSET_MM, 4);
assert.equal(labels.BROTHER_SAFE_WIDTH_MM, 92);
assert.match(document, /\.kitting-bag-label\{width:92mm;height:50\.8mm;border:\.35mm solid #000/,
  'the logical label is centered inside a deterministic four-millimeter safe inset at both die-cut ends');
assert.match(document,
  /<aside class="kitting-bag-label-recovery-rail"><span class="">MEGGITT SAFETY SYSTEMS H24589 REV J<\/span><\/aside>/,
  'governed Customer, Assembly, and Revision appear in the narrow recovery rail');
assert.doesNotMatch(document, /\bASSY\b/,
  'the recovery rail no longer prints the ASSY prefix');
assert.doesNotMatch(document, /<footer|ASSEMBLY \/ REVISION/);
assert.doesNotMatch(document, /BAG\/SEQ|BAG NO/);
assert.doesNotMatch(document, />SEQ 010</);
assert.match(document, /H24589 REV J/);
assert.doesNotMatch(document, /kitting-bag-label-identity/,
  'the large Bag and Assembly identity header is removed without leaving an empty row');
assert.match(document, /<span>SEQ<\/span><span>LOCATION<\/span><span>MATERIAL<\/span><span>QTY<\/span>/,
  'the material section exposes the governed four-column table header');
assert.doesNotMatch(document, /<span>PART NUMBER<\/span><span>DESCRIPTION<\/span>/,
  'Part Number and Description no longer compete as separate columns');
assert.match(document, /kitting-bag-label-location">—<\/strong>/,
  'blank Location retains a stable visible placeholder');
assert.match(document, /<span>FN<\/span><strong>3<\/strong>/);
assert.match(document, /<span>REF\. DES\.<\/span><div class="kitting-bag-label-detail-lines"><strong>C8, C9, C10/);
assert.match(document, /C8, C9, C10/);
assert.match(document, /Print \/ Reprint Bag Label/);
assert.doesNotMatch(document, /ACCEPTED MATERIAL|Receiver|Receipt identity/);
assert.doesNotMatch(document, /WO 0115621|>WO /,
  'Work Order identity is absent from the physical bag-label presentation');
assert.match(document, /kitting-bag-label-component/);
assert.match(document, /kitting-bag-label-placement/);
assert.match(document, /kitting-bag-label-recovery-rail/);
assert.match(document, /grid-template-columns:6mm 1fr/,
  'a narrow fixed recovery rail spans the far-left edge');
assert.match(document, /has-detail\.has-materials \.kitting-bag-label-body\{grid-template-rows:34mm 1fr/,
  'removing the footer returns its height to production content without exceeding the bordered core');
assert.match(document, /grid-template-columns:var\(--fn-seq-width\) 13% 71% 8%/,
  'the combined Material block receives the former Part and Description width');
assert.match(document, /kitting-bag-label-placement\{display:grid;grid-template-columns:var\(--fn-seq-width\) 1fr/,
  'FN and Seq consume the exact same shared grid variable');
assert.match(document, /writing-mode:vertical-rl;transform:rotate\(180deg\)/,
  'the recovery identity is rotated vertically');
assert.match(document, /kitting-bag-label-recovery-rail span\.compact\{font-size:5pt;letter-spacing:0\}/,
  'long governed rail identities receive deterministic compact typography');
assert.match(document, /kitting-bag-label-recovery-rail span\.dense\{font-size:4\.4pt;letter-spacing:0\}/,
  'very long governed rail identities receive deterministic dense typography without truncation');
assert.match(document, /grid-template-rows:4\.5mm 1fr/,
  'the bordered material header and body stay inside their governed outer track');
assert.match(document, /kitting-bag-label-part strong\{[^}]*white-space:nowrap/,
  'the selected normal or Related part remains on one line');
assert.match(document, /kitting-bag-label-part compact/,
  'long governed part numbers receive bounded compact typography');
assert.match(labels.printDocument(relatedModel), /kitting-bag-label-part dense/,
  'longer governed Related selections receive the densest bounded typography');
assert.match(document, /kitting-bag-label-description\{display:-webkit-box;margin-top:\.3mm;padding-left:1\.5ch;font-size:6\.8pt!important;/,
  'descriptions use a dedicated, indented second line beneath Part Number');
assert.match(document, /-webkit-box-orient:vertical;-webkit-line-clamp:2/,
  'extremely long descriptions receive only one controlled fallback line');
assert.match(document, /kitting-bag-label strong\{display:block;font-weight:400/,
  'label values use regular weight rather than blanket bold typography');
assert.doesNotMatch(document, /FIND NUMBER|>FIND<|REFERENCE DESIGNATORS|>REF:/,
  'bottom headings and values do not repeat redundant wording');

const preview = labels.previewMarkup(referenceModel);
const printLayout = labels.layoutStyles('.kitting-bag-label');
const previewLayout = labels.layoutStyles('.kitting-bag-label-preview');
assert.equal(
  labels.layoutStyles('.viewer-root').replaceAll('.viewer-root', '.shared-label'),
  labels.layoutStyles('.print-root').replaceAll('.print-root', '.shared-label'),
  'viewer and print consume the same physical layout declarations'
);
assert.match(preview, /data-kitting-bag-label-layout/);
assert.match(preview, /kitting-bag-label-preview-set/,
  'the viewer renders the deterministic physical-label set rather than one virtual surface');
assert.match(preview, /\.kitting-bag-label-preview-sheet\{width:100mm;height:50\.8mm;display:flex;align-items:center;justify-content:center\}/,
  'the viewer exposes the full physical stock width and centers the calibrated core');
assert.match(preview, /\.kitting-bag-label-preview\{width:92mm;height:50\.8mm;border:\.35mm solid #000/,
  'the viewer uses the same Brother-safe content width and outer border as print');
assert.match(preview, /kitting-bag-label-description/);
const seq005Document = labels.printDocument(normalModel);
assert.match(seq005Document, /H24590 REV B<\/strong><span class="kitting-bag-label-description">PRINTER CIRCUIT BOARD<\/span>/,
  'Seq 005 Part Number precedes its governed Description within one Material cell');
assert.doesNotMatch(seq005Document, /kitting-bag-label-material[^>]*>[\s\S]*PCB BARE BOARD REV B[\s\S]*<\/div><strong class="kitting-bag-label-quantity"/,
  'Seq 005 attached message is absent from the upper Material block');
assert.match(seq005Document, /<span>REF\. DES\.<\/span><div class="kitting-bag-label-detail-lines"><strong>PCB BARE BOARD REV B<\/strong>/,
  'Seq 005 attached message appears in the lower REF. DES. detail area');

const mixedModel = { ...referenceModel, materialNotes: ['INSTALL WITH MARKING UP'] };
mixedModel.pages = labels.paginateModel(mixedModel);
const mixedDocument = labels.printDocument(mixedModel);
assert.match(mixedDocument,
  /kitting-bag-label-detail-lines"><strong>C8, C9, C10[\s\S]*<strong>INSTALL WITH MARKING UP<\/strong>/,
  'true reference designators and associated non-reference messages remain separate retained detail lines');
assert.doesNotMatch(mixedDocument,
  /kitting-bag-label-material[^>]*>[\s\S]*INSTALL WITH MARKING UP[\s\S]*<\/div><strong class="kitting-bag-label-quantity"/,
  'mixed associated messages do not leak into Material');
assert.match(mixedDocument, /kitting-bag-label-detail-lines strong\+strong\{margin-top:\.7mm;padding-top:\.7mm;border-top:\.15mm solid #000\}/,
  'mixed reference and note lines receive a readable visual separator');
assert.match(document, /kitting-bag-label-recovery-rail\{[^}]*border-right:\.25mm solid #000\}/,
  'the recovery rail uses the calibrated lighter thermal-print separator');
assert.match(document, /kitting-bag-label-material-head\{border-bottom:\.2mm solid #000\}/,
  'the internal material grid uses the calibrated lighter stroke');
assert.match(document, /has-detail \.kitting-bag-label-component\{border-bottom:\.3mm solid #000\}/,
  'the section boundary remains readable without the previous heavy boxed appearance');

const longCustomerReport = JSON.parse(JSON.stringify(report));
longCustomerReport.header.customer = 'A GOVERNED CUSTOMER DISPLAY NAME WITH A PREDICTABLY LONG IDENTITY';
const longCustomerDraft = trial.createDraft(longCustomerReport, 'Miguel De Leon');
const longCustomerModel = labels.createVariants(longCustomerDraft,
  longCustomerDraft.groups.find(group => group.sequence === '005'))[0];
const longCustomerDocument = labels.printDocument(longCustomerModel);
assert.match(longCustomerDocument,
  /<span class="dense">A GOVERNED CUSTOMER DISPLAY NAME WITH A PREDICTABLY LONG IDENTITY H24589 REV J<\/span>/,
  'long governed customer identities are retained in full and receive the deterministic dense class');
assert.doesNotMatch(longCustomerDocument, /\.\.\./,
  'the label does not ellipsize the governed customer identity');

references.relatedParts[0].row.location = 'REL-11';
const relatedLocationModel = labels.createModel(draft, references);
assert.equal(relatedLocationModel.materialRows[0].location, '',
  'the main row does not inherit a Related location');
assert.equal(relatedLocationModel.materialRows[1].location, 'REL-11',
  'a Related row uses its own governed location');
delete references.relatedParts[0].row.location;

const overflowGroup = JSON.parse(JSON.stringify(references));
for (const [sequence, partNumber, description] of [
  ['012', 'RELATED-PART-012', 'GOVERNED RELATED DESCRIPTION TWELVE'],
  ['013', 'RELATED-PART-013', 'GOVERNED RELATED DESCRIPTION THIRTEEN'],
  ['014', 'RELATED-PART-014', 'GOVERNED RELATED DESCRIPTION FOURTEEN']
]) overflowGroup.relatedParts.push({ row: { sequence, itemNumber: partNumber, description, unitOfMeasure: 'EA' }, reason: 'Fixture' });
const overflowModel = labels.createModel(draft, overflowGroup);
assert.equal(overflowModel.pages.length, 2, 'five intact material rows require two physical labels');
assert.deepEqual(JSON.parse(JSON.stringify(overflowModel.pages.map(page => page.materialRows.map(row => row.sequence)))),
  [['010', '011', '012'], ['013', '014']],
  'material rows flow in governed order with deterministic physical-label breaks');
assert.deepEqual(JSON.parse(JSON.stringify(overflowModel.pages.map(page => page.showDetail))), [false, true],
  'FN and REF. DES. are reserved for the final physical label only');
const overflowDocument = labels.printDocument(overflowModel);
const overflowPreview = labels.previewMarkup(overflowModel);
assert.equal((overflowDocument.match(/class="kitting-bag-label-sheet"/g) || []).length, 2);
assert.equal((overflowPreview.match(/<article class="kitting-bag-label-preview/g) || []).length, 2);
assert.equal((overflowDocument.match(/MEGGITT SAFETY SYSTEMS H24589 REV J/g) || []).length, 2,
  'the governed rail repeats on every physical label');
for (const sequence of ['010', '011', '012', '013', '014']) {
  assert.equal((overflowDocument.match(new RegExp('data-material-sequence="' + sequence + '"', 'g')) || []).length, 1,
    'material row ' + sequence + ' remains intact on exactly one physical label');
}
assert.equal((overflowDocument.match(/<span>FN<\/span>/g) || []).length, 1);
assert.equal((overflowDocument.match(/<span>REF\. DES\.<\/span>/g) || []).length, 1);
assert.ok(overflowDocument.indexOf('data-material-sequence="014"') < overflowDocument.indexOf('<span>FN</span>'),
  'all remaining material rows precede the final detail block');
assert.doesNotMatch(overflowDocument, /1 of 2|2 of 2|continuation/i);
assert.equal((overflowDocument.match(/Print \/ Reprint Bag Label/g) || []).length, 1,
  'one Print/Reprint action outputs the complete deterministic label set');
const qualificationModel = labels.createOverflowQualificationModel(referenceModel);
assert.equal(labels.MIXED_DETAIL_LINES, 3,
  'the mixed surface derives a conservative three-line detail allowance from its physical height');
assert.equal(labels.CONTINUATION_DETAIL_LINES, 14,
  'a REF-only continuation derives substantially more lines from the full 50.8 mm core height');
assert.equal(qualificationModel.pages.length, 3,
  'the 100-reference fixture uses one material-only, one mixed, and one full-height continuation surface');
assert.deepEqual(JSON.parse(JSON.stringify(qualificationModel.pages.slice(0, 2).map(page =>
  page.materialRows.map(row => row.sequence)))), [['010', '011', '012'], ['013', '014']],
  'the qualification fixture fits three normal blocks before moving complete remaining blocks');
const qualificationDocument = labels.printDocument(qualificationModel);
const qualificationPreview = labels.previewMarkup(qualificationModel);
const qualificationDetailPages = qualificationModel.pages.filter(page => page.showDetail);
assert.equal(qualificationDetailPages.length, 2,
  'approximately 100 reference designators use the mixed surface plus one efficient continuation');
assert.ok(qualificationDetailPages.slice(1).every(page => page.materialRows.length === 0),
  'REF. DES. continuation labels do not repeat the complete material section');
assert.ok(qualificationDetailPages[1].detailLines.join('').length >
  qualificationDetailPages[0].detailLines.join('').length * 2,
  'the full-height continuation consumes substantially more usable detail capacity than the mixed surface');
assert.equal((qualificationDocument.match(/<span>FN<\/span><strong>3<\/strong>/g) || []).length,
  qualificationDetailPages.length, 'FN repeats on every physical label that carries REF. DES. content');
assert.equal((qualificationDocument.match(/MEGGITT SAFETY SYSTEMS H24589 REV J/g) || []).length,
  qualificationModel.pages.length, 'the recovery rail repeats across REF. DES. continuation labels');
for (let index = 1; index <= 100; index += 1) {
  assert.equal((qualificationDocument.match(new RegExp('Q' + index + '(?=,|<)', 'g')) || []).length, 1,
    'reference Q' + index + ' is retained exactly once');
}
assert.equal((qualificationPreview.match(/<article class="kitting-bag-label-preview/g) || []).length,
  qualificationModel.pages.length, 'viewer exposes exactly the same physical surfaces as print');
assert.doesNotMatch(qualificationDocument, /page \d|continued|continuation/i);

const longDescriptionModel = JSON.parse(JSON.stringify(overflowModel));
longDescriptionModel.materialRows[0].description =
  'A GOVERNED DESCRIPTION LONG ENOUGH TO REQUIRE TWO COMPLETE LINES WITHOUT SPLITTING THE MATERIAL BLOCK';
longDescriptionModel.pages = labels.paginateModel(longDescriptionModel);
assert.deepEqual(JSON.parse(JSON.stringify(longDescriptionModel.pages[0].materialRows.map(row => row.sequence))),
  ['010', '011'], 'a long two-line description moves the next complete material block to another label');
assert.match(document, /kitting-bag-label-quantity\{font-size:6\.4pt!important;font-weight:400/,
  'Qty uses compact regular-weight typography inside its material row');

const batchDraftBefore = JSON.stringify(draft);
const averyBatch = labels.createAvery5163Batch(draft);
assert.equal(averyBatch.models.length, 44,
  'WO 0115621 exposes one governed model for each actionable grouped requirement');
assert.equal(averyBatch.surfaces.length, 44,
  'the current WO 0115621 source requires 44 physical 2 x 4 inch surfaces');
assert.equal(averyBatch.sheets.length, 5,
  '44 physical surfaces require five Avery 5163 sheets');
assert.equal(averyBatch.sheets.at(-1).filter(Boolean).length, 4);
assert.equal(averyBatch.sheets.at(-1).filter(slot => slot === null).length, 6,
  'unused final-sheet positions remain blank rather than resizing labels');
assert.deepEqual(JSON.parse(JSON.stringify(averyBatch.surfaces.map(surface => surface.sequence))),
  [...averyBatch.surfaces.map(surface => surface.sequence)].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })),
  'batch surfaces retain deterministic ascending grouped BOM sequence order');
assert.equal(JSON.stringify(draft), batchDraftBefore,
  'building a batch does not mutate Kitting requirements, entries, allocations, or traceability');

const averyDocument = labels.avery5163Document(draft, {
  returnUrl: 'https://dev.dle-os.internal.dlemfg.com/'
});
assert.match(averyDocument, /@page\{size:letter;margin:0\}/);
assert.match(averyDocument, /\.avery-5163-sheet\{position:relative;width:8\.5in;height:11in;padding:0\.5in 0 0 0\.16in;/,
  'Avery sheets use the official US Letter top and side origins');
assert.match(averyDocument, /grid-template-columns:repeat\(2,4in\);grid-template-rows:repeat\(5,2in\);column-gap:\.19in;row-gap:0/,
  'Avery 5163 uses two columns, five rows, 4.19 inch horizontal pitch, and 2 inch vertical pitch');
assert.match(averyDocument, /\.avery-5163-slot\{width:4in;height:2in;[^}]*outline:0\}/,
  'batch preview slots retain exact dimensions without a screen-only perimeter guide');
assert.doesNotMatch(averyDocument, /outline:1px dashed/,
  'batch preview does not substitute a dashed rectangle for the removed label perimeter');
assert.match(averyDocument, /\.kitting-bag-label-avery\{width:101\.6mm;height:50\.8mm/,
  'the shared bag-label design fills each Avery 4 x 2 inch cell without Brother placement calibration');
assert.match(averyDocument, /\.kitting-bag-label-avery\{width:101\.6mm;height:50\.8mm;border:\.35mm solid transparent/,
  'batch labels suppress perimeter ink without changing the border-box geometry');
assert.match(document, /\.kitting-bag-label\{width:92mm;height:50\.8mm;border:\.35mm solid #000/,
  'individual Bag Labels retain the existing solid perimeter border');
assert.match(averyDocument, /\.kitting-bag-label-avery \.kitting-bag-label-recovery-rail\{[^}]*border-right:\.25mm solid #000/,
  'batch labels retain their internal recovery-rail separator');
assert.match(averyDocument, /\.kitting-bag-label-avery\.has-detail \.kitting-bag-label-component\{border-bottom:\.3mm solid #000\}/,
  'batch labels retain their internal component/detail separator');
assert.equal((averyDocument.match(/class="avery-5163-sheet"/g) || []).length, 5);
assert.equal((averyDocument.match(/class="avery-5163-slot(?: blank)?"/g) || []).length, 50);
assert.equal((averyDocument.match(/<article class="kitting-bag-label-avery/g) || []).length, 44);
assert.equal((averyDocument.match(/class="avery-5163-slot blank"/g) || []).length, 6);
assert.match(averyDocument, /class="print-return" href="https:\/\/dev\.dle-os\.internal\.dlemfg\.com\/"/);
assert.match(averyDocument, /&#8592; Back to WO 0115621/,
  'the screen surface identifies the exact Kitting Job destination');
assert.match(averyDocument, /Bag Labels &middot; Batch Print/);
assert.match(averyDocument, /window\.opener\.focus\(\);window\.close\(\);if\(window\.closed\)return false/,
  'an intact opener returns to the exact live workspace before closing the generated view');
assert.match(averyDocument, /@media print\{\.print-toolbar\{display:none!important\}\.avery-5163-slot\{outline:0\}\}/,
  'DLE-OS navigation and screen-only qualification guides do not print');
assert.match(averyDocument, /\.print-return,\.print-actions button\{[^}]*min-height:44px/,
  'return and print actions remain touch-friendly in app-mode use');
assert.match(averyDocument, /Print Avery 5163 Sheets/);
assert.equal(JSON.stringify(draft), batchDraftBefore,
  'rendering the complete Avery document remains read-only');

for (const count of [10, 11, 20, 21]) {
  const boundaryDraft = {
    ...draft,
    groups: Array.from({ length: count }, (_, index) => ({
      ...JSON.parse(JSON.stringify(normal)),
      sequence: String(index + 1).padStart(3, '0'),
      actionable: true,
      primaryPart: {
        ...JSON.parse(JSON.stringify(normal.primaryPart)),
        sequence: String(index + 1).padStart(3, '0')
      }
    }))
  };
  const boundaryBatch = labels.createAvery5163Batch(boundaryDraft);
  assert.equal(boundaryBatch.sheets.length, Math.ceil(count / 10), count + ' labels paginate at the 10-up boundary');
  assert.equal(boundaryBatch.sheets.at(-1).filter(Boolean).length, count % 10 || 10);
}

const continuationGroup = JSON.parse(JSON.stringify(overflowGroup));
continuationGroup.references = Array.from({ length: 100 }, (_, index) => 'Q' + (index + 1));
const followingGroup = JSON.parse(JSON.stringify(normal));
followingGroup.sequence = '999';
followingGroup.primaryPart.sequence = '999';
const adjacencyBatch = labels.createAvery5163Batch({ ...draft, groups: [continuationGroup, followingGroup] });
const continuationSurfaceCount = labels.createModel(draft, continuationGroup).pages.length;
assert.deepEqual(JSON.parse(JSON.stringify(adjacencyBatch.surfaces.map(surface => surface.sequence))),
  [...Array(continuationSurfaceCount).fill(continuationGroup.sequence), '999'],
  'all Related and REF. DES. continuation surfaces remain adjacent before the next bag');

assert.ok(shell.indexOf('kitting-bag-label.js') < shell.indexOf('active-kitting-trial.js'));
assert.match(dashboard, /renderKittingBagLabelArea/);
const printAllStart = dashboard.indexOf('async function printAllKittingBagLabels()');
const printAllEnd = dashboard.indexOf('\n  function acceptedMaterialKey', printAllStart);
const printAllSource = dashboard.slice(printAllStart, printAllEnd);
assert.ok(printAllStart >= 0 && printAllEnd > printAllStart,
  'the governed batch bag-label action remains present');
assert.match(printAllSource,
  /let draft = activeKittingTrialDraft[\s\S]*kittingCaseReview\?\.draft[\s\S]*if \(!draft\) \{[\s\S]*await loadReleasedBomDraft\(\)/,
  'persisted or active Kitting drafts generate labels without depending on the retired Released BOM prototype fixture');
assert.doesNotMatch(printAllSource,
  /const released = await loadReleasedBomDraft\(\);\s*if \(!draft\)/,
  'the batch action does not unconditionally fetch the obsolete Released BOM prototype before using a persisted draft');
assert.match(dashboard, /group\.rowState === 'SUBMITTED' \? 'Print \/ Reprint Bag Label' : 'Print Bag Label'/,
  'the compact action uses explicit print or reprint terminology for the current result state');
assert.match(dashboard, /acceptedMaterialTrialEnabledInKitting = false/,
  'the Receiving-oriented trial is holstered from the Kitting UI');
assert.doesNotMatch(styles, /\.kitting-bag-label-preview\s*\{/,
  'the dashboard stylesheet no longer maintains an independent preview layout');
assert.doesNotMatch(dashboard, /KittingBagLabel\.previewMarkup/,
  'the normal working and submitted result dialogs do not render a bag-label viewer');
assert.doesNotMatch(dashboard, /kitting-bag-label-overflow-qualification|DEV multi-label overflow preview/,
  'the deterministic overflow fixture is no longer embedded in the operator dialog');
assert.match(dashboard, /<div class="kitting-bag-label-print-action" data-kitting-bag-label-sequence=/,
  'the result dialog retains one compact on-demand print action');
assert.match(dashboard, /const preview = window\.open\('', '_blank'\)/);
assert.match(dashboard, /preview\.document\.write\(window\.KittingBagLabel\.printDocument\(model\)\)/,
  'the intentional print action opens the existing governed print-ready document');
assert.match(dashboard, /refreshReleasedBomMessageProjection/,
  'persisted active cases overlay current derived message metadata without rebuilding transaction evidence');
assert.doesNotMatch(styles, /\.kitting-bag-label-panel|\.kitting-bag-label-actions/,
  'the removed automatic viewer no longer reserves panel space at desktop or tablet sizes');
assert.match(styles, /\.kitting-bag-label-print-action button \{ min-height: 40px; margin: 0; \}/,
  'the on-demand print action remains touch-usable without dominating the dialog');
assert.doesNotMatch(dashboard, />Print All Bag Labels<\/button>/,
  'the one-off operator control is removed');
assert.match(dashboard, /<details class="kitting-label-menu" ontoggle="handleKittingJobPrintLabelsToggle\(this\)"><summary>Print Labels/,
  'the case area exposes one compact label menu coordinated with the other primary tools');
const labelMenu = dashboard.slice(dashboard.indexOf('<details class="kitting-label-menu"'),
  dashboard.indexOf('</div></details>', dashboard.indexOf('<details class="kitting-label-menu"')));
assert.ok(labelMenu.indexOf('>Bag Labels</button>') < labelMenu.indexOf('<span>Kit ID</span>'));
assert.ok(labelMenu.indexOf('<span>Kit ID</span>') < labelMenu.indexOf('<span>Master Kit ID</span>'));
assert.match(labelMenu, /printAllWorkOrderDashboardKittingBagLabels\(\)/,
  'Bag Labels reuses the governed batch-print entry point');
assert.match(labelMenu, /<button type="button" role="menuitem" disabled><span>Kit ID<\/span><small>Coming Soon<\/small><\/button>/);
assert.match(labelMenu, /<button type="button" role="menuitem" disabled><span>Master Kit ID<\/span><small>Coming Soon<\/small><\/button>/);
assert.equal((labelMenu.match(/disabled/g) || []).length, 2,
  'only the two future label types are disabled');
assert.match(styles, /\.kitting-label-menu summary \{[^}]*min-height: 44px/s,
  'the Print Labels trigger retains an iPad-friendly touch target');
assert.match(styles, /\.kitting-label-menu-options \{[^}]*min-width: 220px/s,
  'the compact menu remains readable without consuming permanent workspace height');
assert.match(styles, /\.kitting-label-menu-options button \{[^}]*min-height: 44px/s,
  'each label choice retains an iPad-friendly touch target');
assert.match(dashboard, /Read-only printing does not start or modify a Kitting Case\./,
  'the batch action is surfaced before Start Kitting without changing workflow state');
assert.match(dashboard, /KittingBagLabel\.avery5163Document\(draft, \{/);
const batchPrintFunction = dashboard.slice(dashboard.indexOf('async function printAllKittingBagLabels'),
  dashboard.indexOf('function acceptedMaterialKey'));
assert.match(batchPrintFunction, /returnUrl: window\.location\.href/,
  'the generated view has a real same-origin fallback route');
assert.doesNotMatch(batchPrintFunction, /preview\.opener = null/,
  'the batch view retains its trusted same-origin opener for exact-state return');
assert.doesNotMatch(batchPrintFunction,
  /startKittingCase|resumeKittingCase|saveKittingCaseDraft|setActiveKittingPoTraceability/,
  'the batch print path does not start, resume, save, or reconfigure a Kitting Case');

console.log('Kitting Bag Label 001 tests: PASS');

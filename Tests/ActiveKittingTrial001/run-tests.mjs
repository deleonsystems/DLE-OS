import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'SRC/modules/work-order-dashboard/active-kitting-trial.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'SRC/modules/work-order-dashboard/work-order-dashboard.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'SRC/modules/work-order-dashboard/work-order-dashboard.css'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'SRC/modules/work-order-dashboard/work-order-dashboard.html'), 'utf8');
const report = JSON.parse(fs.readFileSync(
  path.join(root, 'Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/work-order-0115621.json'),
  'utf8'
));

const context = vm.createContext({ window: {} });
vm.runInContext(source, context);
const trial = context.window.ActiveKittingTrial;
const plain = value => JSON.parse(JSON.stringify(value));

function traceabilityRow(method, quantity = null) {
  const policyDraft = trial.createDraft(report, 'Miguel De Leon');
  const policyRow = policyDraft.groups.find(group => group.actionable && group.eligibleParts.length > 0);
  trial.applyMethod(policyDraft, policyRow.sequence, method, quantity);
  if (method === trial.METHODS.COUNT) {
    trial.updateAllocation(policyDraft, policyRow.sequence, 'A1', { partNumber: policyRow.eligibleParts[0] });
  } else if (!policyRow.entry.selectedPartNumber) {
    trial.setSelectedPart(policyDraft, policyRow.sequence, policyRow.eligibleParts[0]);
  }
  return { policyDraft, policyRow };
}

assert.ok(trial, 'active Kitting trial model is exported');
const draft = trial.createDraft(report, 'Miguel De Leon');
assert.equal(draft.workOrder, '0115621');
assert.equal(draft.employeeName, 'Miguel De Leon');
assert.equal(draft.persistenceState, 'GOVERNED_5054_DRAFT');
assert.equal(draft.state, 'KITTING_IN_PROGRESS');
assert.equal(draft.groups.length > 0, true);
assert.equal(draft.groups.some(group => group.relatedParts.length > 0), true,
  'Kitting Pick View related-part grouping is preserved');
const relatedGroup = draft.groups.find(group => group.relatedParts.length > 0);
assert.deepEqual(plain(relatedGroup.eligibleParts),
  [relatedGroup.partNumber, ...relatedGroup.relatedParts.map(part => part.row.itemNumber)],
  'eligible material identities contain only the governed main and Related parts');
assert.equal(trial.calculateEntry({ actionable: true, requiredQuantity: 1, eligibleParts: ['PART-1'] },
  trial.METHODS.COUNT, 1, 'Miguel De Leon').allocations[0].evidenceOperator, 'Miguel De Leon',
  'allocation evidence retains the authenticated operator identity');
assert.equal(draft.assemblyInstructions.length, 2,
  'leading released BOM messages remain assembly instructions');
const seq005 = draft.groups.find(group => group.sequence === '005');
assert.equal(seq005.findNumber, 1, 'Seq 005 retains the governed numbered-message Find value');
assert.deepEqual(plain(seq005.references), [],
  'Seq 005 PCB material text is not misclassified as reference designators');
assert.deepEqual(plain(seq005.notes), ['PCB BARE BOARD REV B'],
  'the non-reference remainder of the attached Seq 005 message remains useful material context');
const seq010 = draft.groups.find(group => group.sequence === '010');
assert.deepEqual(plain(seq010.references.slice(0, 4)), ['C8', 'C9', 'C10', 'C11'],
  'true Seq 010 reference designators remain parsed as reference designators');
const persistedBeforeMessageFix = structuredClone(draft);
const persistedSeq005 = persistedBeforeMessageFix.groups.find(group => group.sequence === '005');
const retainedEntry = plain(persistedSeq005.entry);
persistedSeq005.notes = [];
persistedSeq005.references = [];
trial.refreshReleasedBomMessageProjection(persistedBeforeMessageFix, draft);
assert.deepEqual(plain(persistedSeq005.notes), ['PCB BARE BOARD REV B'],
  'an existing persisted case receives the corrected current released-BOM message projection');
assert.deepEqual(plain(persistedSeq005.entry), retainedEntry,
  'source-message projection does not alter persisted Kitting transaction evidence');

for (const method of [trial.METHODS.COMPLETE, trial.METHODS.COMPLETE_MIN_EXTRA]) {
  const { policyDraft, policyRow } = traceabilityRow(method);
  assert.equal(trial.submitGroup(policyDraft, policyRow.sequence, true), null,
    method + ' is blocked without a P.O. in REQUIRED mode');
  trial.setPurchaseOrder(policyDraft, policyRow.sequence, 'PO-REQUIRED');
  assert.equal(trial.submitGroup(policyDraft, policyRow.sequence, true), policyRow,
    method + ' accepts its selected source after P.O. evidence is present');
}
{
  const { policyDraft, policyRow } = traceabilityRow(trial.METHODS.COUNT, 5);
  assert.equal(trial.submitGroup(policyDraft, policyRow.sequence, true), null,
    'a positive Count allocation is blocked without its own P.O.');
  trial.updateAllocation(policyDraft, policyRow.sequence, 'A1', { purchaseOrder: 'PO-A' });
  trial.addAllocation(policyDraft, policyRow.sequence);
  trial.updateAllocation(policyDraft, policyRow.sequence, 'A2', {
    partNumber: policyRow.eligibleParts[0], quantity: 4
  });
  assert.equal(trial.submitGroup(policyDraft, policyRow.sequence, true), null,
    'multiple positive allocations require independent P.O. evidence');
  trial.updateAllocation(policyDraft, policyRow.sequence, 'A2', { purchaseOrder: 'PO-B' });
  assert.equal(trial.submitGroup(policyDraft, policyRow.sequence, true), policyRow,
    'same-part allocations remain independently traceable');
}
{
  const { policyDraft, policyRow } = traceabilityRow(trial.METHODS.COUNT, 0);
  assert.equal(policyRow.entry.shortageQuantity, policyRow.requiredQuantity);
  assert.equal(trial.submitGroup(policyDraft, policyRow.sequence, true), policyRow,
    'a completely short zero-allocation result does not require a P.O.');
}
{
  const { policyDraft, policyRow } = traceabilityRow(trial.METHODS.COMPLETE);
  assert.equal(trial.submitGroup(policyDraft, policyRow.sequence, false), policyRow,
    'OPTIONAL mode permits blank P.O. evidence without per-row disposition');
  assert.equal(policyRow.entry.purchaseOrder, '', 'OPTIONAL mode does not manufacture evidence');
  assert.equal(trial.getSummary(policyDraft, true).traceabilityBlockerCount, 1,
    'switching the policy back to REQUIRED exposes existing missing evidence as a blocker');
}

const dnp = draft.groups.find(group => group.classification === 'DNP');
assert.ok(dnp, 'DNP requirement is represented');
assert.equal(dnp.actionable, false, 'DNP is informational and does not block submission');

const rows = draft.groups.filter(group => group.actionable);
assert.equal(rows.length, 44, 'WO 0115621 retains 44 actionable Kitting requirements');
const [extra, exact, counted, countedShort] = rows.filter(group => group !== relatedGroup);

trial.applyMethod(draft, relatedGroup.sequence, trial.METHODS.COMPLETE);
assert.equal(relatedGroup.entry.selectedPartNumber, null,
  'Complete requires an explicit part selection when a group has Related alternatives');
assert.equal(trial.submitGroup(draft, relatedGroup.sequence), null,
  'a multi-part Complete result cannot submit without its actual part identity');
trial.setSelectedPart(draft, relatedGroup.sequence, relatedGroup.eligibleParts[1]);
assert.equal(relatedGroup.entry.selectedPartNumber, relatedGroup.eligibleParts[1]);
assert.equal(trial.submitGroup(draft, relatedGroup.sequence), relatedGroup);
trial.editGroup(draft, relatedGroup.sequence);
trial.applyMethod(draft, relatedGroup.sequence, trial.METHODS.COUNT, 40);
trial.updateAllocation(draft, relatedGroup.sequence, 'A1', {
  partNumber: relatedGroup.eligibleParts[0], purchaseOrder: 'PO1234'
});
trial.addAllocation(draft, relatedGroup.sequence);
trial.updateAllocation(draft, relatedGroup.sequence, 'A2', {
  partNumber: relatedGroup.eligibleParts[1], quantity: 35, purchaseOrder: 'PO1255'
});
trial.addAllocation(draft, relatedGroup.sequence);
trial.updateAllocation(draft, relatedGroup.sequence, 'A3', {
  partNumber: relatedGroup.eligibleParts[1], quantity: 45, purchaseOrder: 'PO1310'
});
assert.equal(relatedGroup.entry.allocations.length, 3,
  'Count supports multiple evidence allocations and repeated parts with distinct P.O.s');
assert.equal(relatedGroup.entry.pickedQuantity, 120);
assert.equal(relatedGroup.entry.shortageQuantity, 0);
assert.equal(relatedGroup.entry.extraQuantity, 0);
assert.equal(trial.submitGroup(draft, relatedGroup.sequence), relatedGroup);

trial.applyMethod(draft, extra.sequence, trial.METHODS.COMPLETE);
assert.deepEqual(
  { picked: extra.entry.pickedQuantity, short: extra.entry.shortageQuantity, result: extra.entry.result },
  { picked: null, short: 0, result: 'COMPLETE' },
  'Complete does not invent a picked quantity'
);

trial.applyMethod(draft, exact.sequence, trial.METHODS.COMPLETE_MIN_EXTRA);
assert.equal(exact.entry.pickedQuantity, null, 'Min Extra does not imply an exact count');
assert.equal(exact.entry.shortageQuantity, 0);

const required20 = { actionable: true, requiredQuantity: 20 };
assert.equal(trial.normalizeCountInput('025'), 25);
assert.equal(trial.normalizeCountInput('007'), 7);
assert.equal(trial.normalizeCountInput('00'), 0);
assert.equal(trial.normalizeCountInput('00.50'), 0.5, 'decimal quantities retain existing support');
assert.equal(trial.sanitizeCountInput('025'), '025', 'leading zeros remain visible while typing');
assert.equal(trial.sanitizeCountInput('-2'), '', 'negative quantities are rejected');
assert.deepEqual(
  plain((({ pickedQuantity, shortageQuantity, extraQuantity, result }) =>
    ({ pickedQuantity, shortageQuantity, extraQuantity, result }))(
    trial.calculateEntry(required20, trial.METHODS.COUNT, '025'))),
  { pickedQuantity: 25, shortageQuantity: 0, extraQuantity: 5, result: 'COUNTED_EXTRA' },
  'leading zeros normalize before shortage and extra calculations'
);
assert.equal(trial.calculateEntry(required20, trial.METHODS.COUNT, 27).extraQuantity, 7,
  'count above required is complete with informational extra'
);
assert.equal(trial.calculateEntry(required20, trial.METHODS.COUNT, 20).result, 'COUNTED_EXACT',
  'count equal to required is complete exact'
);
assert.equal(trial.calculateEntry(required20, trial.METHODS.COUNT, 12).shortageQuantity, 8,
  'count below required calculates shortage automatically'
);
assert.deepEqual(plain(trial.getSubmittedVisualState(
  trial.calculateEntry(required20, trial.METHODS.COMPLETE))),
{ tone: 'GREEN', icon: 'CHECK', label: 'Complete' });
assert.deepEqual(plain(trial.getSubmittedVisualState(
  trial.calculateEntry(required20, trial.METHODS.COMPLETE_MIN_EXTRA))),
{ tone: 'AMBER', icon: 'CHECK', label: 'Complete - Min Extra' });
assert.equal(trial.getSubmittedVisualState(
  trial.calculateEntry(required20, trial.METHODS.COUNT, 12)).tone, 'RED');
assert.equal(trial.getSubmittedVisualState(
  trial.calculateEntry(required20, trial.METHODS.COUNT, 20)).tone, 'AMBER');
assert.equal(trial.getSubmittedVisualState(
  trial.calculateEntry(required20, trial.METHODS.COUNT, 24)).tone, 'AMBER');
assert.equal(trial.getSubmittedVisualState(
  trial.calculateEntry(required20, trial.METHODS.COUNT, 27)).tone, 'GREEN');

trial.applyMethod(draft, counted.sequence, trial.METHODS.COUNT, counted.requiredQuantity + 7);
trial.updateAllocation(draft, counted.sequence, 'A1', { partNumber: counted.eligibleParts[0] });
assert.equal(counted.entry.extraQuantity, 7);
assert.equal(counted.entry.shortageQuantity, 0);
assert.equal(counted.entry.result, 'COUNTED_EXTRA');
trial.setCount(draft, counted.sequence, Math.max(counted.requiredQuantity - 1, 0));
assert.equal(counted.entry.shortageQuantity, Math.min(1, counted.requiredQuantity),
  'a counted result can be corrected and recalculated');

trial.applyMethod(draft, countedShort.sequence, trial.METHODS.COUNT,
  Math.max(countedShort.requiredQuantity - 8, 0));
trial.updateAllocation(draft, countedShort.sequence, 'A1', { partNumber: countedShort.eligibleParts[0] });
assert.equal(countedShort.entry.shortageQuantity, Math.min(8, countedShort.requiredQuantity));
assert.equal(countedShort.entry.result, countedShort.requiredQuantity > 0 ? 'COUNTED_SHORT' : 'COUNTED_EXACT');

trial.updateAllocation(draft, countedShort.sequence, 'A1', { purchaseOrder: ' PO-TRIAL-115621 ' });
assert.equal(countedShort.entry.allocations[0].purchaseOrder, 'PO-TRIAL-115621');

assert.equal(trial.submitGroup(draft, countedShort.sequence), countedShort,
  'a completed line can be submitted');
assert.equal(countedShort.rowState, 'SUBMITTED');
assert.equal(countedShort.revisionNumber, 1);
const submittedEntry = plain(countedShort.entry);
trial.applyMethod(draft, countedShort.sequence, trial.METHODS.COMPLETE_MIN_EXTRA);
trial.updateAllocation(draft, countedShort.sequence, 'A1', { purchaseOrder: 'SHOULD-NOT-CHANGE' });
assert.deepEqual(plain(countedShort.entry), submittedEntry, 'a submitted line cannot be changed');
assert.equal(countedShort.entry.allocations[0].purchaseOrder, 'PO-TRIAL-115621', 'a submitted P.O. is locked');
assert.equal(trial.editGroup(draft, countedShort.sequence), countedShort, 'Edit deliberately unlocks the line');
assert.deepEqual(plain(countedShort.entry), submittedEntry,
  'Edit preserves the submitted method, parts, quantities, allocations, P.O., and calculated result');
trial.applyMethod(draft, countedShort.sequence, trial.METHODS.COUNT,
  Math.max(countedShort.requiredQuantity - 8, 0));
trial.updateAllocation(draft, countedShort.sequence, 'A1', { partNumber: countedShort.eligibleParts[0] });
assert.equal(trial.submitGroup(draft, countedShort.sequence), countedShort);
assert.equal(countedShort.revisionNumber, 2, 'resubmission advances the local revision');

for (const row of rows) {
  if (!row.entry || row.entry.shortageQuantity === null) {
    trial.applyMethod(draft, row.sequence, trial.METHODS.COMPLETE);
  }
  if (row.entry.method !== trial.METHODS.COUNT && !row.entry.selectedPartNumber) {
    trial.setSelectedPart(draft, row.sequence, row.eligibleParts[0]);
  }
}
assert.equal(trial.getSummary(draft).canSubmit, false,
  'completed selections alone do not unlock whole-work-order submission');
for (const row of rows) {
  if (row.rowState !== 'SUBMITTED') trial.submitGroup(draft, row.sequence);
}
const summary = trial.getSummary(draft);
assert.equal(summary.canSubmit, true, 'submission unlocks only after every actionable row is individually submitted');
assert.equal(summary.resultingDisposition, 'KIT_SHORT', 'any calculated shortage resolves to KIT_SHORT');

for (const row of rows) {
  trial.editGroup(draft, row.sequence);
  trial.applyMethod(draft, row.sequence, trial.METHODS.COMPLETE);
  if (!row.entry.selectedPartNumber) trial.setSelectedPart(draft, row.sequence, row.eligibleParts[0]);
  trial.submitGroup(draft, row.sequence);
}
assert.equal(trial.getSummary(draft).resultingDisposition, 'KIT_COMPLETE',
  'all zero shortages resolve to KIT_COMPLETE');

const correctionDraft = trial.createDraft(report, 'Miguel De Leon');
const correctionRow = correctionDraft.groups.find(group => group.actionable && group.eligibleParts.length > 0);
trial.applyMethod(correctionDraft, correctionRow.sequence, trial.METHODS.COUNT, 25);
trial.updateAllocation(correctionDraft, correctionRow.sequence, 'A1', {
  partNumber: correctionRow.eligibleParts[0]
});
assert.equal(trial.submitGroup(correctionDraft, correctionRow.sequence), correctionRow);
const correctionBeforeEdit = plain(correctionRow.entry);
assert.equal(correctionBeforeEdit.allocations[0].purchaseOrder, '',
  'the P.O. correction scenario begins with a submitted blank P.O.');
assert.equal(trial.editGroup(correctionDraft, correctionRow.sequence), correctionRow);
assert.deepEqual(plain(correctionRow.entry), correctionBeforeEdit,
  'opening Edit retains the existing Count method, quantity, part selection, and blank P.O.');
trial.updateAllocation(correctionDraft, correctionRow.sequence, 'A1', { purchaseOrder: 'PO-CORRECTED-25' });
assert.equal(trial.submitGroup(correctionDraft, correctionRow.sequence), correctionRow);
assert.equal(correctionRow.rowState, 'SUBMITTED', 'the corrected result relocks after Submit');
assert.equal(correctionRow.entry.allocations[0].purchaseOrder, 'PO-CORRECTED-25',
  'the corrected P.O. remains in the submitted result evidence');

for (const method of [trial.METHODS.COMPLETE, trial.METHODS.COMPLETE_MIN_EXTRA]) {
  const methodDraft = trial.createDraft(report, 'Miguel De Leon');
  const methodRow = methodDraft.groups.find(group => group.actionable && group.eligibleParts.length > 0);
  trial.applyMethod(methodDraft, methodRow.sequence, method);
  if (!methodRow.entry.selectedPartNumber) {
    trial.setSelectedPart(methodDraft, methodRow.sequence, methodRow.eligibleParts[0]);
  }
  trial.setPurchaseOrder(methodDraft, methodRow.sequence, 'PO-' + method);
  assert.equal(trial.submitGroup(methodDraft, methodRow.sequence), methodRow);
  const methodBeforeEdit = plain(methodRow.entry);
  assert.equal(trial.editGroup(methodDraft, methodRow.sequence), methodRow);
  assert.deepEqual(plain(methodRow.entry), methodBeforeEdit,
    method + ' retains method, selected part, P.O., and calculations when Edit unlocks it');
}

assert.match(markup, /id="workOrderDashboardReleasedBom"/);
assert.match(markup, />View Released BOM</);
assert.match(markup, /id="workOrderDashboardKitReleasedBom"/);
assert.match(markup, />Kit Released BOM</);
assert.match(dashboard, /openReleasedBomPrototype/);
assert.match(dashboard, /openActiveKittingTrial/);
assert.match(dashboard, /<th>Required<\/th><th>Kitting result<\/th>/,
  'the compact table ends with Required and Kitting Result');
assert.doesNotMatch(dashboard.match(/<table class="active-kitting-trial-table"[\s\S]*?<\/thead>/)?.[0] ?? '',
  /<th>P\.O\.<\/th>|<th>Action<\/th>/,
  'P.O. and row actions are absent from the main table');
assert.match(dashboard, /id="activeKittingResultDialog"/,
  'one compact shared result popup is rendered for the active row');
assert.doesNotMatch(dashboard, /<details class="active-kitting-entry"/,
  'result options do not expand inline inside each table row');
assert.match(dashboard, /button\(methods\.COMPLETE, 'Complete'\)/);
assert.match(dashboard, /button\(methods\.COMPLETE_MIN_EXTRA, 'Min Extra'\)/);
assert.match(dashboard, /button\(methods\.COUNT, 'Count'\)/);
assert.match(dashboard, /renderActiveKittingMaterialCard\(draft, group\)/,
  'the result dialog reuses governed bag-label material projection for its work card');
for (const label of ['Seq', 'Location', 'Part Number', 'Required', 'FN', 'Description', 'REF. DES.']) {
  assert.match(dashboard, new RegExp("item\\('" + label.replace('.', '\\.') + "'|>" + label.replace('.', '\\.') + '<'),
    label + ' is present in the compact material work card');
}
assert.match(dashboard, /model\.references\.join\(', '\)/,
  'true reference designators are preserved in the modal detail area');
assert.match(dashboard, /detailLines\.push\(\.\.\.model\.materialNotes\)/,
  'associated requirement notes share the modal REF. DES. area without changing source semantics');
assert.match(dashboard, /Related options: /,
  'governed Related-part eligibility remains visible without redesigning allocations');
assert.match(dashboard, /submitWorkOrderDashboardKittingRow/);
assert.match(dashboard, /P\.O\. \(' \+/,
  'case-governed P.O. entry lives inside the result transaction dialog');
assert.match(dashboard, /poTraceabilityRequired \? 'Required' : 'Optional'/,
  'the result dialog labels P.O. evidence from the persisted case policy');
assert.match(dashboard, /class="active-kitting-dialog-submit"/,
  'row Submit lives inside the result transaction dialog');
assert.doesNotMatch(dashboard, /data-active-kitting-action/,
  'the main table has no persistent Submit or Edit controls');
assert.match(dashboard, /input type="text" inputmode="decimal" pattern="\[0-9\]\*\[\.\]\?\[0-9\]\*"/,
  'Count uses a decimal keyboard text field so leading zeros and caret placement are controllable');
assert.match(dashboard, /input\.setSelectionRange\?\.\(end, end\)/,
  'initial Count focus places the caret after the default zero without selecting it');
assert.match(dashboard, /method === window\.ActiveKittingTrial\.METHODS\.COUNT \? 'count'/,
  'Count selection requests synchronous focus for the newly revealed quantity input');
assert.match(dashboard, /openActiveKittingResultDialog\(sequence, 'submit'\)/,
  'Enter accepts the Count and returns focus to the separate Submit control');
const completeCountBody = dashboard.match(/function completeActiveKittingCount[\s\S]*?\n  }/)?.[0] ?? '';
assert.doesNotMatch(completeCountBody, /submitActiveKittingRow/,
  'Enter never submits or locks the Kitting row');
assert.match(dashboard, /renderActiveKittingCountPreview\(entry, group\)/,
  'accepted Count interpretation remains visible while the result dialog stays open');
assert.match(dashboard, /<strong>Kitted /,
  'the Count preview displays the normalized authoritative quantity');
assert.match(styles, /active-kitting-count-preview/,
  'the accepted Count interpretation has a compact dialog treatment');
assert.match(styles, /active-kitting-methods[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
  'the three result methods form one compact touch-friendly row');
assert.match(styles, /active-kitting-material-primary/,
  'the compact material identification grid is styled');
assert.match(dashboard, /editWorkOrderDashboardKittingRow/);
const editRowBody = dashboard.match(/function editActiveKittingRow[\s\S]*?\n  }/)?.[0] ?? '';
assert.match(editRowBody, /return openActiveKittingResultDialog\(sequence\);/,
  'Edit transitions directly from submitted detail into the editable result dialog');
assert.doesNotMatch(editRowBody, /data-active-kitting-result/,
  'Edit does not return focus to the compact row trigger or require a second tap');
assert.match(dashboard, /renderSubmittedActiveKittingResult/);
assert.match(dashboard, /id="activeKittingSubmittedDetailDialog"/,
  'submitted symbols open one compact read-only detail dialog');
assert.match(dashboard, /openWorkOrderDashboardKittingDetail/);
assert.match(dashboard, /metric\('Required'/);
assert.match(dashboard, /metric\('Extra'/);
assert.match(dashboard, /metric\('Short'/);
assert.match(dashboard, /class="active-kitting-evidence-table"/);
assert.match(dashboard, /<th>Part<\/th><th>Qty<\/th><th>P\.O\.<\/th>/);
assert.match(dashboard, /class="active-kitting-dialog-summary"/,
  'Required, Total Kitted, Short, and Extra render in the upper detail header');
assert.match(dashboard, /metric\('Short'.*entry\.shortageQuantity > 0 \? 'short' : ''\)/,
  'positive shortage receives a distinct upper-summary treatment');
assert.match(dashboard, /<col class="part"><col class="quantity"><col class="po">/,
  'evidence columns receive explicit responsive widths');
assert.doesNotMatch(dashboard, /allocationTable \+ '<div class="active-kitting-detail-grid">/,
  'summary metrics no longer consume space beneath the evidence table');
assert.match(dashboard, /Main and governed Related parts only/);
assert.match(dashboard, /\+ Add allocation/);
assert.match(dashboard, /const icon = shortage \? '&#35;' : '&#10003;'/,
  'successful counted results use the fulfillment check while shortage remains distinct');
assert.doesNotMatch(dashboard, /active-kitting-po-readonly/,
  'P.O. evidence is removed from the main table');
assert.equal((dashboard.match(/class="active-kitting-row-action edit"/g) || []).length, 1,
  'Edit exists only inside the submitted-detail dialog');
assert.match(dashboard, /data-dle-required-permission="kitting\.disposition"/,
  'detail Edit is structured for existing permission enforcement');
assert.match(dashboard, /state-' \+ tone/);
assert.match(styles, /state-green/);
assert.match(styles, /state-amber/);
assert.match(styles, /state-red/);
assert.match(styles, /active-kitting-state-icon\.counted/);
assert.match(styles, /active-kitting-detail-grid/);
assert.match(styles, /width:\s*min\(760px, calc\(100vw - 40px\)\)/,
  'the Kitting dialog uses a wide viewport-bounded desktop width');
assert.match(styles, /active-kitting-evidence-table[\s\S]*table-layout:\s*fixed/,
  'normal evidence rows fit the available dialog width without intrinsic table overflow');
assert.match(styles, /max-width:\s*calc\(100vw - 32px\)/,
  'iPad landscape retains safe viewport side margins');
assert.match(styles, /min-width:\s*900px/);
assert.match(styles, /td:nth-child\(6\) \{ width: 126px; \}/);
assert.doesNotMatch(dashboard, />Hand Count<|>Partial</,
  'legacy duplicate count choices are absent from the operator menu');
assert.match(styles, /min-height:\s*44px/,
  'the result control retains an iPad-friendly touch target');
assert.doesNotMatch(dashboard, /localStorage|sessionStorage/,
  'the trial does not introduce ad-hoc browser persistence');

console.log(`Active Kitting trial tests passed: ${rows.length} actionable groups, ${draft.groups.length} total groups.`);

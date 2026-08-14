import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const report = JSON.parse(fs.readFileSync(
  'Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/work-order-0115621.json', 'utf8'));
const source = fs.readFileSync('SRC/modules/work-order-dashboard/active-kitting-trial.js', 'utf8');
const context = { window: {}, structuredClone, Date, console };
vm.createContext(context);
vm.runInContext(source, context);
const trial = context.window.ActiveKittingTrial;
const output = 'tmp/pdfs/kitting-submission-layout';
fs.mkdirSync(output, { recursive: true });

function snapshot(type, version, counted, short) {
  const draft = trial.createDraft(report, 'Miguel De Leon');
  for (const group of draft.groups.filter(group => group.actionable)) {
    trial.applyMethod(draft, group.sequence, trial.METHODS.COMPLETE);
    if (group.eligibleParts.length > 1) trial.setSelectedPart(draft, group.sequence, group.partNumber);
    trial.submitGroup(draft, group.sequence);
  }
  const minExtra = draft.groups.filter(group => group.actionable).find(group => group.sequence !== '010');
  if (minExtra) {
    trial.editGroup(draft, minExtra.sequence);
    trial.applyMethod(draft, minExtra.sequence, trial.METHODS.COMPLETE_MIN_EXTRA);
    trial.submitGroup(draft, minExtra.sequence);
  }
  const group = draft.groups.find(item => item.sequence === '010');
  trial.editGroup(draft, '010');
  trial.applyMethod(draft, '010', trial.METHODS.COUNT, 0);
  const evidence = [
    ['A1', 'CDR33BX104AKUS', 25, 'PO-QA-MAIN'],
    ['A2', 'CDR33BX104AKUS7370', 15, 'PO-QA-RELATED']
  ];
  if (counted >= 80) evidence.push(['A3', 'CDR33BX104AKUS', 40, 'PO-QA-RECEIPT-2']);
  if (counted >= 120) evidence.push(['A4', 'CDR33BX104AKUS', 40, 'PO-QA-RECEIPT-3']);
  group.entry = trial.calculateCountRollup(group, evidence.map(([allocationId, partNumber, quantity, purchaseOrder]) =>
    ({ allocationId, partNumber, quantity, purchaseOrder, evidenceOperator: 'Miguel De Leon', evidenceAtUtc: '2026-08-13T01:30:00Z' })));
  group.entry.shortageQuantity = short;
  trial.submitGroup(draft, '010');
  return {
    schemaVersion: 1,
    submissionId: crypto.randomUUID(),
    caseId: crypto.randomUUID(),
    workOrderNumber: '0115621',
    assemblyItemNumber: 'H24589',
    revision: 'J',
    releasedBomIdentity: 'fixture-layout-qualification',
    submissionType: type,
    versionNumber: version,
    submittedBy: 'DLE-OS-HOST\\Miguel',
    submittedAtUtc: `2026-08-13T01:${20 + version}:00Z`,
    draft
  };
}

for (const [name, value] of [
  ['WO0115621_KIT-SHORT_V001_LAYOUT-PREVIEW.json', snapshot('KIT_SHORT', 1, 40, 80)],
  ['WO0115621_KIT-SHORT_V002_LAYOUT-PREVIEW.json', snapshot('KIT_SHORT', 2, 80, 40)],
  ['WO0115621_KIT-COMPLETE_V001_LAYOUT-PREVIEW.json', snapshot('KIT_COMPLETE', 1, 120, 0)]
]) fs.writeFileSync(path.join(output, name), JSON.stringify(value));

console.log(`Kitting PDF snapshot fixtures generated: ${output}`);

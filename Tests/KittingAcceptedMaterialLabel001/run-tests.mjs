import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const labelSource = read('SRC/modules/work-order-dashboard/accepted-material-label.js');
const trialSource = read('SRC/modules/work-order-dashboard/active-kitting-trial.js');
const dashboard = read('SRC/modules/work-order-dashboard/work-order-dashboard.js');
const styles = read('SRC/modules/work-order-dashboard/work-order-dashboard.css');
const shell = read('DLE_Work_Center_v4.0.0.html');
const api = read('SRC/api/dle-api-client.js');
const control = read('Tools/LiveSnapshotRefresh/ControlHost/KittingCaseCenter.cs');
const report = JSON.parse(read(
  'Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/work-order-0115621.json'));

const context = vm.createContext({ window: {}, Object, Date });
vm.runInContext(labelSource, context);
vm.runInContext(trialSource, context);
const label = context.window.AcceptedMaterialLabel;
const trial = context.window.ActiveKittingTrial;

assert.equal(label.normalizePurchaseOrder('0045931'), '45931');
assert.equal(label.sameSource({ partNumber: 'H24590 REV B', purchaseOrderNumber: '0045931' },
  'H24590 REV B', '45931'), true, 'display P.O. and canonical padded P.O. identify the same source');
const resolved = {
  resolutionStatus: 'RESOLVED', resolvedAtUtc: '2026-08-13T00:00:00Z',
  material: { purchaseReceiptLineId: 'a'.repeat(50), partNumber: 'H24590 REV B',
    purchaseOrderNumber: '0045931', purchaseOrderLineNumber: '005', receiverNumber: '0039301',
    receiptDateIso: '2026-03-26T00:00:00', quantityAccepted: 28, unitOfMeasure: 'EA' }
};
assert.deepEqual(JSON.parse(JSON.stringify(label.toPersistedIdentity(resolved))), {
  schemaVersion: 1, identityType: 'CANONICAL_PURCHASE_RECEIPT_LINE',
  purchaseReceiptLineId: 'a'.repeat(50), partNumber: 'H24590 REV B',
  purchaseOrderNumber: '0045931', purchaseOrderLineNumber: '005', receiverNumber: '0039301',
  receiptDateIso: '2026-03-26T00:00:00', quantityAccepted: 28, unitOfMeasure: 'EA',
  resolvedAtUtc: '2026-08-13T00:00:00Z'
});
assert.match(label.printDocument(resolved.material), /ACCEPTED MATERIAL/);
assert.match(label.printDocument(resolved.material), /Receipt identity/);
assert.match(label.printDocument(resolved.material), /Reprinting does not create a receipt or acceptance identity/);

const draft = trial.createDraft(report, 'Miguel De Leon');
const related = draft.groups.find(group => group.actionable && group.eligibleParts.length > 1);
trial.applyMethod(draft, related.sequence, trial.METHODS.COUNT, 20);
trial.updateAllocation(draft, related.sequence, 'A1', {
  partNumber: related.eligibleParts[0], purchaseOrder: '45931'
});
trial.setAcceptedMaterial(draft, related.sequence, 'A1', label.toPersistedIdentity(resolved));
assert.equal(related.entry.allocations[0].acceptedMaterial.purchaseReceiptLineId, 'a'.repeat(50));
trial.addAllocation(draft, related.sequence);
trial.updateAllocation(draft, related.sequence, 'A2', {
  partNumber: related.eligibleParts[1], purchaseOrder: 'DIFFERENT', quantity: 5
});
assert.equal(related.entry.allocations[1].acceptedMaterial, null,
  'distinct allocations do not inherit or collapse another material identity');
trial.updateAllocation(draft, related.sequence, 'A1', { partNumber: related.eligibleParts[1] });
assert.equal(related.entry.allocations[0].acceptedMaterial, null,
  'changing main/Related selection invalidates the prior receipt identity');

assert.ok(shell.indexOf('accepted-material-label.js') < shell.indexOf('active-kitting-trial.js'));
assert.match(api, /resolveAcceptedMaterialLabel\(partNumber, purchaseOrder/);
assert.match(control, /accepted-material-label/);
assert.match(control, /quantityAccepted/);
assert.match(control, /matches\.Count>1/);
assert.match(control, /physicalLabelIdAvailable=false,lotIdentityAvailable=false/);
assert.match(control, /accepted_material_source_mismatch/);
assert.match(control, /ValidateCanonicalAcceptedMaterialAsync/);
assert.match(control, /receiving-history\/"\+/,
  '5054 re-reads the exact canonical receipt identity before persisting it');
assert.match(control, /accepted_material_identity_not_accepted/);
assert.match(dashboard, /renderAcceptedMaterialLabelArea/);
assert.match(dashboard, /Print \/ Reprint Label/);
assert.match(dashboard, /preview\.opener = null/,
  'the generated print document severs its application-window reference after rendering');
assert.match(dashboard, /Receiving \/ Quality owned/);
assert.match(dashboard, /resolveGroupAcceptedMaterialLabels\(group, false\)/,
  'read-only submitted detail resolves labels without altering locked evidence');
assert.match(dashboard, /acceptedMaterialTrialEnabledInKitting = false/,
  'the Receiving-oriented Accepted Material trial is holstered from the Kitting UI');
assert.doesNotMatch(dashboard, /allocationTable \+ acceptedMaterialEvidence/,
  'submitted Kitting detail no longer renders Receiving-oriented Accepted Material labels');
assert.match(styles, /accepted-material-label-card/);
assert.match(styles, /max-width:\s*470px/,
  'the material label stays compact inside the existing result dialog');

console.log('Kitting Accepted Material Label integration trial tests: PASS');

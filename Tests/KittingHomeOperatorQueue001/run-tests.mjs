import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.html', 'utf8');
const script = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.js', 'utf8');
const styles = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.css', 'utf8');

assert.match(html, /data-kitting-lifecycle-tab="NEEDS_KITTING"/);
assert.match(html, /Kit Short \/ Awaiting Parts/);
assert.match(html, /data-kitting-lifecycle-tab="KIT_COMPLETE"/);
assert.doesNotMatch(html, /Resume \/ Needs Parts/);
assert.doesNotMatch(html, />Needs Resolution</);
assert.doesNotMatch(html, />RMA \/ Rework</);
assert.doesNotMatch(html, /kittingReadinessSummary/);
assert.match(html, /Search Work Order, Part, Customer, PO/);
assert.doesNotMatch(html, /kitting-filter-panel|kittingRelationshipFilter|kittingSort|>Filters</);
assert.match(html, /onclick="refreshKittingQueue\(\)"/);
assert.match(html, /↻ Refresh Queue/);
assert.match(script, /queues\.needsKitting/);
assert.match(script, /queues\.kittingInProgress/);
assert.match(script, /queues\.kitShort/);
assert.match(script, /queues\.kitComplete/);
assert.match(script, /\.\.\.\(queues\.needsKitting \|\| \[\]\)/);
assert.match(script, /\.\.\.\(queues\.kittingInProgress \|\| \[\]\)/);
assert.match(script, /"IN PROGRESS"/);
assert.match(script, /"KIT SHORT"/);
assert.match(script, /"KIT COMPLETE"/);
assert.match(script, /"NEW"/);
assert.match(script, /Searching all Kitting lifecycle states/);
assert.match(script, /Search Results/);
assert.match(script, /allKittingSearchRows/);
assert.doesNotMatch(script, /kittingRelationshipFilter|kittingSort/);
assert.match(script, /refreshKittingWorkspace\(\{ forceMaterialStatus: true \}\)/);
assert.match(script, /MaterialStatus\.invalidate\?\.\(workOrderNumbers, \{ notify: false \}\)/);
assert.match(script, /force: options\.force === true/);
assert.match(script, /!searchActive && button\.dataset\.kittingLifecycleTab/);
assert.match(script, /openKittingWorkOrder\(event\)/);
assert.match(script, /kitting-compact-assembly/);
assert.match(script, /kitting-compact-quantity/);
assert.match(script, /kitting-compact-due/);
assert.match(script, /<small>QTY<\/small>/);
assert.match(script, /<small>DUE<\/small>/);
assert.match(script, /function formatQueueDueDate\(value\)/);
assert.match(script, /\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$/);
assert.match(script, /`\$\{match\[2\]\}\/\$\{match\[3\]\}\/\$\{match\[1\]\}`/);
assert.match(script, /const dueDate = formatQueueDueDate\(row\.earliestDueDate\)/);
assert.match(script, /left\.earliestDueDateTime - right\.earliestDueDateTime/);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const formatQueueDueDate = vm.runInNewContext(
  `const cleanText = value => String(value ?? '').trim();\n${extractFunction(script, 'formatQueueDueDate')}\nformatQueueDueDate`,
  { Date }
);
assert.equal(formatQueueDueDate('2026-08-05'), '08/05/2026');
assert.equal(formatQueueDueDate('2026-09-04'), '09/04/2026');
assert.equal(formatQueueDueDate('2025-01-27'), '01/27/2025');
assert.equal(formatQueueDueDate(''), 'N/A');
assert.equal(formatQueueDueDate('not-a-date'), 'not-a-date');
assert.equal(formatQueueDueDate('2026-02-30'), '2026-02-30');

const statusLookups = [];
const resolveEmbeddedStatuses = vm.runInNewContext(
  `async ${extractFunction(script, 'buildEmbeddedMaterialStatuses')}\nbuildEmbeddedMaterialStatuses`,
  {
    normalizeWorkOrderNumber: value => String(value || '').padStart(7, '0'),
    loadMaterialStatuses: async numbers => {
      statusLookups.push([...numbers]);
      return new Map(numbers.map(workOrderNumber => [workOrderNumber, {
        workOrderNumber, machineValue: 'KITTING_IN_PROGRESS', label: 'Kitting In Progress',
        source: 'KITTING_CASE', kittingCase: { state: 'KITTING_IN_PROGRESS', workingVersion: 4 }
      }]));
    }
  }
);
const embeddedComplete = { machineValue: 'KIT_COMPLETE', source: 'KITTING_CASE' };
const resolvedStatuses = await resolveEmbeddedStatuses([
  { materialStatusWorkOrderNumber: '0888888', materialStatus: null },
  { materialStatusWorkOrderNumber: '0777777', materialStatus: embeddedComplete },
  { materialStatusWorkOrderNumber: '0666666', materialStatus: null }
], ['0888888', '0777777']);
assert.deepEqual(statusLookups, [['0888888']], 'only missing actionable material status is looked up');
assert.equal(resolvedStatuses.get('0888888').machineValue, 'KITTING_IN_PROGRESS',
  'a persisted case does not fall back to NEW when the canonical embedded projection is null');
assert.equal(resolvedStatuses.get('0777777'), embeddedComplete, 'nonnull embedded states remain authoritative');
assert.equal(resolvedStatuses.has('0666666'), false, 'unrelated or nonactionable WO is not projected');
await resolveEmbeddedStatuses([{ materialStatusWorkOrderNumber: '0777777', materialStatus: embeddedComplete }], ['0777777']);
assert.equal(statusLookups.length, 1, 'complete embedded statuses avoid unnecessary lookups');

assert.match(styles, /grid-template-columns:minmax\(118px,.7fr\).*minmax\(70px,.4fr\).*minmax\(112px,.55fr\)/);
assert.match(styles, /minmax\(170px,1fr\) 98px 24px/);
assert.match(styles, /\.kitting-compact-state\{[^}]*text-align:center/);
assert.match(styles, /\.kitting-compact-customer\{grid-column:2\/5;grid-row:2\}/);
assert.match(styles, /\.kitting-compact-customer\{grid-column:1\/-1;grid-row:4\}/);
assert.match(styles, /body\[data-workspace-view="kitting"\] main\{margin-top:12px\}/);
assert.match(styles, /\.kitting-workspace-header\{[^}]*min-height:0[^}]*background:transparent/);
assert.match(styles, /\.kitting-search-control\{margin-top:0\}/);
assert.match(styles, /\.kitting-search-control input\{[^}]*margin-top:0/);
assert.match(styles, /\.kitting-refresh\{[^}]*margin-top:0/);
assert.doesNotMatch(styles, /margin-top:-|transform:translateY\(-/);
assert.match(styles, /@media\(min-width:1281px\)/);
assert.match(styles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\)\[data-workspace-view="kitting"\]>main\{padding-inline:clamp\(22px,2vw,32px\)\}/);
assert.match(styles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\)\[data-workspace-view="kitting"\] \.kitting-workspace\{width:100%;max-width:none;margin-inline:0;padding-inline:0\}/);
assert.match(script, /preferredDashboardView: "standard"/);
assert.match(script, /preferredPresentation: "kitting-job"/);
assert.match(script, /KittingJobWorkspace\.open\(handoff\)/);
assert.doesNotMatch(script, /window\.go\("workOrderDashboardModule"\)/);
assert.match(script, /returnWorkspaceId: WORKSPACE_ID/);

console.log('Kitting Home operator queue structure and canonical handoff contracts: PASS');

// Supply enrichment stays separate from queue classification and canonical WO identity.
const supplySummary = { workOrderNumber: '0999999', compactText: 'LPD 10/07/2026 · On Time' };
let failSupply = false;
const loadSupply = vm.runInNewContext(`async ${extractFunction(script, 'loadSupplyProgress')}\nloadSupplyProgress`, {
  window: { DleOsRuntimeConfig: { environment: 'SIMULATION' }, MaterialStatus: {
    getSupplyProgress: async () => { if (failSupply) throw new Error('offline'); return { workOrders: [supplySummary] }; }
  } }
});
const projected = await loadSupply(['0999999', '9700002']);
assert.equal(projected.get('0999999'), supplySummary);
assert.match(projected.get('9700002').compactText, /Supply Unavailable/);
failSupply = true;
assert.match((await loadSupply(['0999999'])).get('0999999').compactText, /Supply Unavailable/);
const modelContext = { window: {} };
vm.runInNewContext(fs.readFileSync('SRC/workspaces/kitting/kitting-read-model.js', 'utf8'), modelContext);
const options = {
  lines: [{ lineKey:'C|SO|010', customerNumber:'C', customerName:'Customer', salesOrderNumber:'SO',
    salesOrderLineNumber:'010', itemNumber:'SIM-ASSY-001', quantityOrdered:10, operationalQuantityOpen:10,
    dueDate:'2026-10-14', relationship:{status:'EXACT_LINE_UNIQUE',actionableWorkOrderNumber:'0999999'} }],
  workOrdersByNumber: {'0999999':{workOrderNumber:'0999999',itemNumber:'SIM-ASSY-001',schProdQuantity:10}},
  materialStatusesByWorkOrder: {'0999999':{machineValue:'KIT_SHORT',label:'Kit Short',source:'KITTING_CASE'}},
  supplyProgressByWorkOrder: {'0999999':supplySummary}
};
const queueModel = modelContext.window.KittingReadModel.buildReadModel(options);
const row = queueModel.queues.kitShort[0];
assert.equal(row.supplyProgress, supplySummary);
assert.equal(queueModel.queues.kitComplete.length, 0);
assert.equal(row.materialStatus, 'KIT_SHORT');
assert.equal(row.earliestDueDate, '2026-10-14');
const renderRow = vm.runInNewContext(`${extractFunction(script, 'renderCompactQueueRow')}\nrenderCompactQueueRow`, {
  renderAcceptedDestinations: () => "", formatQueueDueDate, formatQuantity: String, operatorStatus: () => 'KIT SHORT',
  escapeHtml: value => String(value ?? '').replaceAll('<','&lt;')
});
assert.match(renderRow(row), /KIT SHORT/);
assert.match(renderRow(row), /LPD 10\/07\/2026 · On Time/);
assert.doesNotMatch(renderRow({...row,materialStatus:'KIT_COMPLETE'}), /LPD/);
const ops = fs.readFileSync('SRC/modules/operations-center/operations-center-view-model.js','utf8');
assert.match(ops, /item\?\.supplyProgress\?\.compactText/);
console.log('PASS queue LPD projection, missing/offline fallback, governed identity, rendering and unchanged material classification');
// Read-only action bucket qualification: canonical status is deliberately unchanged.
const origin = {caseId:'case',workingVersion:50,submissionId:'submission',releasedBomIdentity:'release',sourceRowId:'row5',requirementId:'G005',findNumber:'5',releasedSequence:'5'};
const receipt = {receiptLineId:'SIM-AM-0000001',availableQuantity:8,uom:'EA',stagingLocation:'stage'};
const demand = {demandId:'demand5',workOrderNumber:'0999999',sourceRowId:'row5',partNumber:'SIM-OPTO-4',short:8,returnOrigin:origin,acceptedMaterials:[receipt]};
const build = demands => modelContext.window.KittingReadModel.buildReadModel({...options,supplyProgressByWorkOrder:{'0999999':{demands}}});
for (const demands of [[],[{...demand,acceptedMaterials:[]}],[{...demand,unavailableReason:'stale'}],[{...demand,returnOrigin:null}],[{...demand,sourceRowId:'other'}],[{...demand,acceptedMaterials:[{...receipt,availableQuantity:0}]}]]) {
  assert.equal(build(demands).queues.kitShort.length,1);
  assert.equal(build(demands).queues.needsRekit.length,0);
}
for (const demands of [[demand],[{...demand,acceptedMaterials:[{...receipt,availableQuantity:3}]}],[demand,{...demand,demandId:'d9',sourceRowId:'row9',acceptedMaterials:[]}],[{...demand,acceptedMaterials:[{...receipt,availableQuantity:3},{...receipt,receiptLineId:'AM2',availableQuantity:5}]}]]) {
  const m=build(demands);
  assert.equal(m.queues.needsRekit.length,new Set(demands.flatMap(d => d.acceptedMaterials.map(r => r.receiptLineId))).size); assert.equal(m.queues.kitShort.length,1);
  assert.equal(m.readyRows[0].materialStatus,'KIT_SHORT');assert.equal(m.counts.duplicatePrimaryQueueMembership,0);
  assert.equal(m.counts.uniqueGovernedWorkOrders,1);
}
const complete=modelContext.window.KittingReadModel.buildReadModel({...options,materialStatusesByWorkOrder:{'0999999':{machineValue:'KIT_COMPLETE'}},supplyProgressByWorkOrder:{'0999999':{demands:[demand]}}});
assert.equal(complete.queues.needsRekit.length,0);assert.equal(complete.queues.kitComplete.length,1);
assert.ok(html.indexOf('kitting-history-nav')>html.indexOf('</nav>'));
console.log('PASS independent WO and material queues: absent/stale/unassigned, partial, multiple shortages/receipts, completed secondary, canonical status unchanged');
const acceptedRow=build([demand]).readyRows[0];
const destinations=vm.runInNewContext(`${extractFunction(script,'renderAcceptedDestinations')}\nrenderAcceptedDestinations`,{escapeHtml:v=>String(v??'')});
assert.match(destinations(acceptedRow),/data-source-row-id="row5"/);
assert.match(destinations(acceptedRow),/SIM-AM-0000001/);
assert.match(destinations(acceptedRow),/Find 5/);
const handoffs=[];
const navigate=vm.runInNewContext(`${extractFunction(script,'openGovernedWorkOrder')}\nopenGovernedWorkOrder`,{
 workspaceState:{model:{readyRows:[acceptedRow]}},buildGovernedHandoff:r=>({workOrderNumber:r.workOrderNumber}),
 window:{KittingJobWorkspace:{open:h=>{handoffs.push(h);return true;}}},setStatus:()=>{}
});
navigate({currentTarget:{dataset:{kittingQueueKey:acceptedRow.queueKey}}});
navigate({currentTarget:{dataset:{kittingQueueKey:acceptedRow.queueKey,sourceRowId:'row5',acceptedMaterialId:receipt.receiptLineId}}});
assert.equal(handoffs.length,2);assert.equal(handoffs[0].workOrderNumber,handoffs[1].workOrderNumber);
assert.equal(handoffs[0].acceptedMaterialFocus.sourceRowId,handoffs[1].acceptedMaterialFocus.sourceRowId);
assert.equal(handoffs[1].acceptedMaterialFocus.receiptLineId,receipt.receiptLineId);
console.log('PASS WO-first and receipt-first converge on same governed workspace and exact source-row focus');

const twoReceipts=build([{...demand,acceptedMaterials:[receipt,{...receipt,receiptLineId:'AM2',availableQuantity:2}]}]);
assert.equal(twoReceipts.queues.kitShort.length,1);assert.equal(twoReceipts.queues.needsRekit.length,2);
const sharedOptions=structuredClone(options);
sharedOptions.lines.push({...sharedOptions.lines[0],lineKey:'C|SO|020',salesOrderLineNumber:'020',relationship:{status:'EXACT_LINE_UNIQUE',actionableWorkOrderNumber:'0888888'}});
sharedOptions.workOrdersByNumber['0888888']={workOrderNumber:'0888888',itemNumber:'ASSEMBLY2',schProdQuantity:1};
sharedOptions.materialStatusesByWorkOrder['0888888']={machineValue:'KIT_SHORT',label:'Kit Short'};
sharedOptions.supplyProgressByWorkOrder={'0999999':{demands:[{...demand,acceptedMaterials:[{...receipt,availableQuantity:3}]}]},
'0888888':{demands:[{...demand,demandId:'other-demand',workOrderNumber:'0888888',acceptedMaterials:[{...receipt,availableQuantity:5}]}]}};
const sharedModel=modelContext.window.KittingReadModel.buildReadModel(sharedOptions);
assert.equal(sharedModel.queues.kitShort.length,2);assert.equal(sharedModel.queues.needsRekit.length,1);
assert.equal(sharedModel.queues.needsRekit[0].availableQuantity,8);
assert.deepEqual(Array.from(sharedModel.queues.needsRekit[0].destinations,d=>d.availableQuantity).sort(),[3,5]);
assert.equal(sharedModel.counts.uniqueGovernedWorkOrders,2);
const renderMaterial=vm.runInNewContext(`${extractFunction(script,'renderAcceptedMaterialRow')}\nrenderAcceptedMaterialRow`,{escapeHtml:v=>String(v??'')});
assert.match(renderMaterial(sharedModel.queues.needsRekit[0]),/Return to WO 0999999/);
assert.match(renderMaterial(sharedModel.queues.needsRekit[0]),/Find 5 \/ G005/);
console.log('PASS distinct receipt rows; shared receipt retains assigned destinations and quantities; WO counts remain unique');

const disclosure=destinations(acceptedRow);
assert.match(disclosure,/<details class="kitting-material-disclosure"><summary>Accepted Material · 1 Ready/);
assert.doesNotMatch(disclosure,/<details[^>]* open|<summary[^>]*onclick/);
assert.match(disclosure,/Find 5 · SIM-OPTO-4 · Short 8 · 8 Available · SIM-AM-0000001/);
assert.match(disclosure,/>View<\/button>/);
const multiDemand={...demand,demandId:'d9',sourceRowId:'row9',returnOrigin:{...origin,findNumber:'9',sourceRowId:'row9'}};
assert.match(destinations(build([demand,multiDemand]).readyRows[0]),/Accepted Material · 2 Ready/);
const twoOnFind=destinations(twoReceipts.readyRows[0]);
assert.match(twoOnFind,/Accepted Material · 1 Ready/);
assert.equal((twoOnFind.match(/>View<\/button>/g)||[]).length,1);
assert.doesNotMatch(twoOnFind,/SIM-AM-0000001|AM2/);
console.log('PASS native collapsed disclosure, one count per ready requirement, compact multiple receipts, exact-row View');

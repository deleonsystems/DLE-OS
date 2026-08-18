import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const report = fs.readFileSync(
  'Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/index.html', 'utf8');
const dashboard = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.js', 'utf8');
const workspace = fs.readFileSync('SRC/workspaces/kitting/kitting-job-workspace.js', 'utf8');

const toolbar = report.slice(report.indexOf('<div class="toolbar">'), report.indexOf('<main id="report"'));
assert.match(toolbar, /Released BOM · Kitting Pick View/);
assert.match(toolbar, /id="printReleasedBom"/);
assert.match(toolbar, /id="backToKittingJob"[^>]*backToKittingJob\(\)[^>]*>← Back to Kitting Job</);
assert.doesNotMatch(toolbar, /Grouped Operator View|VPro Replica View|Raw Source View|view-toggle/,
  'normal operators receive no Released BOM mode selector');
assert.doesNotMatch(toolbar, /DEVELOPMENT-ONLY REPORT|SOURCE ROWS QUALIFIED|OPERATOR GROUPS/,
  'development qualification chrome does not occupy the operator toolbar');

assert.match(report, /const selectedView = 'pick'/);
assert.match(report, /function renderReport\(\) \{[\s\S]*innerHTML = renderKittingPick\(\)/);
assert.match(report, /document\.body\.dataset\.reportView = 'pick'/);
assert.doesNotMatch(report, /function setReportView/);
assert.doesNotMatch(report, /history\.back\(\)/,
  'return navigation does not depend on browser history');
assert.match(report, /function backToKittingJob\(\)[\s\S]*reportParameters\.get\('return'\)[\s\S]*location\.assign/);
assert.match(report, /@media print \{[\s\S]*body::before, \.toolbar \{ display:none !important; \}/,
  'print output excludes report navigation and toolbar chrome');
assert.match(report, /function renderGrouped/);
assert.match(report, /function renderReplica/);
assert.match(report, /function renderRaw/,
  'legacy diagnostic renderers remain internally available without operator controls');
assert.match(report, /Entry values are not calculated or saved/);
assert.doesNotMatch(report, /\/api\/kitting-cases|saveKittingCase|startKittingCase|resumeKittingCase/,
  'the standalone report has no Kitting operational write path');

const openReleasedBom = dashboard.slice(
  dashboard.indexOf('function openReleasedBomPrototype'),
  dashboard.indexOf('function resetActiveKittingTrial'));
assert.match(openReleasedBom, /getSelectedReleasedBomWorkOrder\(\)/,
  'the report handoff uses the selected qualified Work Order');
assert.match(openReleasedBom, /searchParams\.set\('view', 'pick'\)/);
assert.match(openReleasedBom, /createReleasedBomReturnPath\?\.\(selectedWorkOrder\)/);
assert.doesNotMatch(openReleasedBom, /DleApiClient|startKitting|resumeKitting|saveKitting/,
  'opening the report does not touch governed Kitting state');

assert.match(workspace, /RELEASED_BOM_RETURN_STORAGE_PREFIX/);
assert.match(workspace, /sessionStorage\.setItem[\s\S]*JSON\.stringify\(handoff\)/);
assert.match(workspace, /function restoreReleasedBomReturn/);
assert.match(workspace, /sessionStorage\.removeItem\(storageKey\)/,
  'the same-tab selected-WO return handoff is one-time');
assert.match(workspace, /return handoff \? open\(handoff\) : false/);
assert.match(dashboard, /resetActiveKittingTrial\(\);[\s\S]*restoreReleasedBomReturn\?\.\(\)/,
  'the saved handoff is restored after dashboard state initialization');

const storedHandoffs = new Map();
const fakeLocation = {
  href: 'https://dev.dle-os.internal.dlemfg.com/',
  pathname: '/', search: '', hash: ''
};
let restoredSelection = null;
let restoredScreen = '';
let restoredWorkspace = '';
let cleanedReturnPath = '';
const fakeWindow = {
  location: fakeLocation,
  crypto: { randomUUID: () => 'qualified-return-token' },
  sessionStorage: {
    setItem(key, value) { storedHandoffs.set(key, value); },
    getItem(key) { return storedHandoffs.get(key) ?? null; },
    removeItem(key) { storedHandoffs.delete(key); }
  },
  history: { replaceState(_state, _title, path) { cleanedReturnPath = path; } },
  WorkOrderDashboardModule: { setSelectedWorkOrder(value) { restoredSelection = value; } },
  DleWorkspaceShell: { setWorkspaceView(value) { restoredWorkspace = value; } },
  go(screen) { restoredScreen = screen; },
  addEventListener() {}
};
const fakeDocument = {
  getElementById() { return null; },
  querySelector() { return null; },
  addEventListener() {}
};
vm.runInNewContext(workspace, { window: fakeWindow, document: fakeDocument, URL, Date, Math });
const qualifiedHandoff = { workOrderNumber: '0115621', preferredPresentation: 'kitting-job' };
const returnPath = fakeWindow.KittingJobWorkspace.createReleasedBomReturnPath(qualifiedHandoff);
assert.equal(returnPath, '/?dleKittingReportReturn=qualified-return-token');
fakeLocation.href = 'https://dev.dle-os.internal.dlemfg.com' + returnPath;
fakeLocation.search = '?dleKittingReportReturn=qualified-return-token';
assert.equal(fakeWindow.KittingJobWorkspace.restoreReleasedBomReturn(), true);
assert.equal(restoredSelection.workOrderNumber, '0115621');
assert.equal(restoredSelection.preferredPresentation, 'kitting-job');
assert.equal(restoredScreen, 'kittingJobWorkspace');
assert.equal(restoredWorkspace, 'kitting');
assert.equal(cleanedReturnPath, '/');
assert.equal(storedHandoffs.size, 0,
  'returning consumes the selected-WO browser-memory handoff without retaining stale state');

console.log('Kitting Released BOM single-view and governed return contracts: PASS');

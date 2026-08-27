import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const trialSource = fs.readFileSync('SRC/modules/work-order-dashboard/active-kitting-trial.js', 'utf8');
const dashboard = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.js', 'utf8');
const workspace = fs.readFileSync('SRC/workspaces/kitting/kitting-job-workspace.js', 'utf8');
const reportFixture = JSON.parse(fs.readFileSync(
  'Artifacts/WorkOrderReleasedBom004/WORKORDER-RELEASED-BOM-004/work-order-0115621.json', 'utf8'));

const trialContext = vm.createContext({ window: {}, Object, Date });
vm.runInContext(trialSource, trialContext);
const persistedDraft = trialContext.window.ActiveKittingTrial.createDraft(reportFixture, 'Miguel De Leon');
const report = trialContext.window.ActiveKittingTrial.releasedBomDocument(persistedDraft, {
  returnUrl: '/?dleKittingReportReturn=qualified-return-token'
});

const toolbar = report.slice(report.indexOf('<header class="toolbar">'), report.indexOf('<main>'));
assert.match(toolbar, /Released BOM · Kitting Pick View/);
assert.match(toolbar, /id="printReleasedBom"/);
assert.match(toolbar, /id="backToKittingJob"[^>]*dleKittingReportReturn=qualified-return-token[^>]*>← Back to Kitting Job/);
assert.doesNotMatch(toolbar, /Grouped Operator View|VPro Replica View|Raw Source View|view-toggle/,
  'normal operators receive no Released BOM mode selector');

assert.match(report, /WO 0115621 · H24589 Rev J/);
assert.match(report, /Work Order 0115621 Released BOM material requirements/);
assert.match(report, />H24589</);
assert.match(report, />J</);
assert.match(report, /D55342K07B200ER/,
  'the current governed material groups render from the persisted draft');
assert.match(report, /Governed persisted Kitting material source · read only/);
assert.match(report, /@media print\{\.toolbar\{display:none!important\}/,
  'print output excludes report navigation and toolbar chrome');
assert.doesNotMatch(report, /<input|<textarea|<select|contenteditable|saveKittingCase|startKittingCase|resumeKittingCase/,
  'the current Released BOM document is read only');

const openReleasedBom = dashboard.slice(
  dashboard.indexOf('function openReleasedBomPrototype'),
  dashboard.indexOf('function resetActiveKittingTrial'));
assert.match(openReleasedBom, /activeKittingTrialDraft[\s\S]*kittingCaseReview\?\.draft/,
  'the current governed persisted Kitting draft is the report source');
assert.match(openReleasedBom, /sourceWorkspaceId:[\s\S]*returnWorkspaceId:[\s\S]*preferredPresentation: 'kitting-job'/);
assert.match(openReleasedBom, /createReleasedBomReturnPath\?\.\(handoff\)/);
assert.match(openReleasedBom, /releasedBomDocument\(draft, \{ returnUrl \}\)/);
assert.doesNotMatch(openReleasedBom,
  /releasedBomPrototypePath|releasedBomPrototypeDataPath|location\.assign|loadReleasedBomDraft/,
  'the report open path has no retired static-artifact dependency');
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
const qualifiedHandoff = {
  workOrderNumber: '0115621',
  sourceWorkspaceId: 'kitting',
  returnWorkspaceId: 'kitting',
  preferredPresentation: 'kitting-job'
};
const returnPath = fakeWindow.KittingJobWorkspace.createReleasedBomReturnPath(qualifiedHandoff);
assert.equal(returnPath, '/?dleKittingReportReturn=qualified-return-token');
fakeLocation.href = 'https://dev.dle-os.internal.dlemfg.com' + returnPath;
fakeLocation.search = '?dleKittingReportReturn=qualified-return-token';
assert.equal(fakeWindow.KittingJobWorkspace.restoreReleasedBomReturn(), true);
assert.equal(restoredSelection.workOrderNumber, '0115621');
assert.equal(restoredSelection.sourceWorkspaceId, 'kitting');
assert.equal(restoredSelection.returnWorkspaceId, 'kitting');
assert.equal(restoredSelection.preferredPresentation, 'kitting-job');
assert.equal(restoredScreen, 'kittingJobWorkspace');
assert.equal(restoredWorkspace, 'kitting');
assert.equal(cleanedReturnPath, '/');
assert.equal(storedHandoffs.size, 0,
  'returning consumes the selected-WO browser-memory handoff without retaining stale state');

console.log('Kitting Released BOM persisted-draft viewer and governed return contracts: PASS');

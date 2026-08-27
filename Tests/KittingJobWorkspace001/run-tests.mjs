import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const rootHtml = fs.readFileSync('DLE_Work_Center_v4.0.0.html', 'utf8');
const html = fs.readFileSync('SRC/workspaces/kitting/kitting-job-workspace.html', 'utf8');
const script = fs.readFileSync('SRC/workspaces/kitting/kitting-job-workspace.js', 'utf8');
const dashboard = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.js', 'utf8');
const dashboardHtml = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.html', 'utf8');
const dashboardStyles = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.css', 'utf8');
const home = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.js', 'utf8');

assert.match(rootHtml, /id="kittingJobWorkspace"/);
assert.match(rootHtml, /SRC\/workspaces\/kitting\/kitting-job-workspace\.css/);
assert.match(rootHtml, /SRC\/workspaces\/kitting\/kitting-job-workspace\.js/);
assert.match(rootHtml, /loadKittingJobWorkspace/);
assert.match(rootHtml, /initializeKittingJobWorkspace/);

assert.match(html, /Kitting Job Workspace/);
assert.doesNotMatch(html, /Back to Kitting|kitting-job-back/);
assert.match(html, /id="kittingJobWorkOrder"/);
assert.match(html, /id="kittingJobAssembly"/);
assert.match(html, /id="kittingJobQuantity"/);
assert.match(html, /id="kittingJobDueDate"/);
assert.match(html, /id="kittingJobCustomer"/);
assert.match(html, /id="kittingJobSalesOrder"/);
assert.match(html, /id="kittingJobCustomerPo"/);
assert.match(html, /id="kittingJobMaterialStatus"/);
assert.match(html, /class="kitting-job-state-context"/);
assert.match(html, /id="kittingJobPoTraceability"[^>]*data-policy="NOT_SET"/);
assert.ok(html.indexOf('kitting-job-state-context') < html.indexOf('kitting-job-releases'),
  'compact Kitting state context appears immediately before Scheduled Releases');
assert.doesNotMatch(html, /Governing evidence|kitting-job-evidence|kittingJobCanonicalAnchor|kittingJobRelationship|kittingJobGoverningSource/);
assert.match(html, /<details class="kitting-job-releases">/);
assert.match(html, /id="kittingJobReportsToggle"/);
assert.match(html, /<strong>Reports<\/strong>/);
assert.doesNotMatch(html, /kittingJobCurrentStatus|kitting-job-current-status|Current Kitting Status/);
assert.match(html, /<strong>Submission History<\/strong>/);
assert.match(html, /<strong>Legacy Kitted BOM<\/strong>/);
assert.match(html, /id="kittingJobLegacyKittedBomStatus"/);
assert.match(html, /id="kittingJobSubmissionHistory"/);
assert.match(html, /id="kittingJobDevelopmentReports"[^>]*hidden/);
assert.match(html, /id="kittingJobDevelopmentHistory"/);
assert.match(html, /DEV report diagnostics/);
assert.match(html, /id="kittingJobReports"[^>]*hidden/);
assert.doesNotMatch(html, /History and document evidence/);
assert.doesNotMatch(html, /Standard View|Kitting View|Production View|Production Workspace|Traveler|Assembly Drawing/);

assert.match(script, /setPresentationMode/);
assert.match(script, /mountDedicatedSurface/);
assert.match(script, /toggleReports/);
assert.match(script, /prependById\(actions, 'workOrderDashboardKitReleasedBom'\)/);
assert.doesNotMatch(script, /appendById\(currentStatus, 'workOrderDashboardKittingCaseSummary'\)/);
assert.match(script, /appendById\(releasedBom, 'workOrderDashboardReleasedBom'\)/);
assert.match(script, /canViewDevelopmentReports/);
assert.match(script, /capabilities\?\.isSuperAdmin === true/);
assert.match(script, /environment === 'ISOLATED_DEVELOPMENT'/);
assert.match(script, /development\.hidden = !visible/);
assert.match(script, /function setPrimaryTool/);
assert.match(script, /closeReportsPanel\(\)/);
assert.match(script, /closePrintLabelsPanel\(\)/);
assert.match(script, /if \(tool === 'print-labels'\)[\s\S]*currentMenu\.open = true/);
assert.match(script, /activePrimaryTool === 'kitting' && tool !== 'kitting'/);
assert.doesNotMatch(script, /collapseKittingPanel|collapseActiveKitting/);
assert.match(script, /handlePrintLabelsToggle/);
assert.match(script, /function refreshPrimaryToolPresentation/);
assert.match(script, /activePrimaryTool === 'print-labels' && printMenu/);
assert.match(script, /classList\.toggle\('is-focused-kitting', activePrimaryTool === 'kitting'\)/);
assert.match(script, /--kitting-focused-sticky-top/);
assert.match(script, /body > header\.dle-app-header/);
assert.match(script, /restoreDashboardSurface/);
assert.match(script, /WorkOrderDashboardModule\.setSelectedWorkOrder/);
assert.match(script, /window\.go\('kittingJobWorkspace'\)/);
assert.match(script, /WorkOrderDashboardModule\?\.returnToKitting/);
assert.match(script, /setText\('kittingJobCanonicalAnchor'/);
assert.match(script, /setText\('kittingJobRelationship'/);
assert.match(script, /setText\('kittingJobGoverningSource'/);
assert.match(script, /KITTING_IN_PROGRESS: 'IN PROGRESS'/);
assert.match(script, /value\?\.label \|\| value/);
assert.doesNotMatch(script, /if \(clean\(value\?\.label\)\) return clean\(value\.label\)/);
assert.match(script, /formatKittingJobDueDate\(selection\.originDueDate/);
assert.match(dashboard, /KittingJobWorkspace\?\.setPresentationMode/);
assert.match(dashboard, /KittingJobWorkspace\?\.render/);
assert.match(dashboard, /<summary>Print Labels/);
assert.match(dashboard, /ontoggle="handleKittingJobPrintLabelsToggle\(this\)"/);
assert.match(dashboard, /KittingJobWorkspace\?\.setPrimaryTool\?\.\('kitting', true\)/);
assert.doesNotMatch(dashboard, /collapseActiveKittingTrial|collapseActiveKitting|Collapse Kitting/);
assert.match(dashboard, /KittingJobWorkspace\?\.refreshPrimaryToolPresentation\?\.\(\)/);
assert.match(dashboard, /setText\('activeKittingFocusedIdentity'/);
assert.match(dashboard, /const separator = ' \\u00b7 '/);
assert.match(dashboardHtml, /class="active-kitting-sticky-context"/);
assert.match(dashboardHtml, /id="activeKittingFocusedIdentity"/);
assert.doesNotMatch(dashboardHtml, /active-kitting-collapse|collapseActiveKitting|Collapse Kitting/);
assert.match(dashboardHtml, /id="activeKittingSaveExit"[^>]*saveAndExitWorkOrderDashboardKitting/);
assert.match(dashboard, /renderKittingSubmissionHistory\(false, 'operator'\)/);
assert.match(dashboard, /renderKittingSubmissionHistory\(false, 'development'\)/);
assert.match(dashboard, /setText\('kittingJobLegacyKittedBomStatus', evidenceStatus\)/);
assert.match(dashboard, /setText\('kittingJobMaterialStatus', compactStatusLabel\)/);
assert.match(dashboard, /setText\('kittingJobPoTraceability', compactTraceability\)/);
assert.match(dashboard, /summary\.hidden = dedicatedWorkspace \|\| !available/);
assert.match(dashboard, /summary\.innerHTML = dedicatedWorkspace \? '' : currentStatus \+ printAllAction/);
assert.match(dashboard, /hydratePersistedKittingCaseForReadOnly\(kittingCaseReview\)/);
assert.match(dashboard, /function hydratePersistedKittingCaseForReadOnly\(review\) \{[\s\S]*structuredClone\(review\.draft\)[\s\S]*activeKittingEditable = false[\s\S]*activeKittingTrialState = 'loaded'[\s\S]*activeKittingTrialOpen = true/,
  'an existing governed case hydrates directly from its persisted draft without acquiring a lease');
assert.match(dashboard, /activeKittingTrialOpen && \(activeKittingEditable \|\| kittingCaseReview\?\.isEditing/,
  'the explicit action remains available to resume a read-only case after its lease is absent');
const resumePreflight = dashboard.indexOf('const releasedBom = await loadReleasedBomDraft()');
const resumeWrite = dashboard.indexOf('window.DleApiClient.resumeKittingCase', resumePreflight);
assert.ok(resumePreflight >= 0 && resumeWrite > resumePreflight,
  'the released-BOM edit prerequisite is validated before the write-capable resume request');
assert.match(dashboard, /const kittingEditingTemporarilyAvailable = false/,
  'Kitting editing is explicitly deferred in the stable DEV baseline');
assert.match(dashboard, /kitButton\.disabled = !kittingEditingTemporarilyAvailable/,
  'the write-capable Kitting tile is visibly disabled in the stable DEV baseline');
const stableStart = extractFunction(dashboard, 'startOrResumeActiveKitting');
assert.ok(stableStart.indexOf('if (!kittingEditingTemporarilyAvailable)') <
  stableStart.indexOf('if (activeKittingRecovery)'),
  'the stable-mode guard prevents the top-level Kitting action from reaching reconnect logic');
assert.match(dashboard, />Bag Labels<\/button>/);
assert.doesNotMatch(dashboard, />Print All Bag Labels<\/button>/);
assert.match(home, /preferredDashboardView: "standard"/);
assert.match(home, /preferredPresentation: "kitting-job"/);
assert.match(home, /KittingJobWorkspace\.open\(handoff\)/);
assert.match(script, /preferredPresentation: 'kitting-job'/);

const styles = fs.readFileSync('SRC/workspaces/kitting/kitting-job-workspace.css', 'utf8');
assert.match(styles, /\.kitting-job-workspace \{[^}]*background:var\(--bg\)[^}]*color:var\(--text\)/);
assert.match(styles, /\.kitting-job-context[^}]*background:var\(--panel\)/);
assert.match(styles, /\.kitting-job-status \{[^}]*font:850 10px\/1/);
assert.match(styles, /\.kitting-job-state-context \{[^}]*display:flex[^}]*padding:7px 18px[^}]*border-top:0/);
assert.match(styles, /\.kitting-job-traceability\[data-policy="REQUIRED"\]/);
assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.kitting-job-state-context \{[^}]*flex-wrap:wrap/);
assert.doesNotMatch(styles, /kitting-job-current-status/);
assert.match(styles, /\.kitting-job-action-grid \{[^}]*repeat\(3,minmax\(0,1fr\)\)/);
assert.match(styles, /\.kitting-job-main \{[^}]*padding:0/);
assert.match(styles, /\.kitting-job-report-menu \{[^}]*display:grid/);
assert.match(styles, /\.kitting-job-report-disclosure>summary \{[^}]*min-height:50px/);
assert.match(styles, /\.kitting-job-action-grid>button\.is-active/);
assert.match(styles, /\.kitting-job-workspace\.is-focused-kitting \.active-kitting-sticky-context \{[^}]*position:sticky[^}]*--kitting-focused-sticky-top/);
assert.match(styles, /\.kitting-job-workspace\.is-focused-kitting \.active-kitting-trial-table-wrap \{[^}]*max-height:none[^}]*overflow-y:hidden/);
assert.match(styles, /\.kitting-job-workspace\.is-focused-kitting \.kitting-job-releases[\s\S]*display:none/);
assert.match(styles, /\.kitting-job-workspace\.is-focused-kitting \.kitting-job-state-context[\s\S]*display:none/);
assert.doesNotMatch(styles, /active-kitting-collapse/);
assert.match(dashboardStyles, /\.active-kitting-trial-table-wrap \{[^}]*overflow: auto[^}]*max-height: calc\(100vh - 310px\)/,
  'the regression captures the original nested-scroll source that Focused Mode overrides');
assert.doesNotMatch(styles, /\.kitting-job-report-grid/);
assert.doesNotMatch(styles, /#f3f6f8|background:\s*#fff|\.kitting-job-back|\.kitting-job-evidence/);

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
const startOrResumeActiveKitting = extractFunction(dashboard, 'startOrResumeActiveKitting');
assert.doesNotMatch(startOrResumeActiveKitting, /collapse/i,
  'the Start/Resume/Continue control cannot become a second focused-mode exit');
assert.match(startOrResumeActiveKitting,
  /if \(activeKittingTrialOpen && \(activeKittingEditable \|\| kittingCaseReview\?\.isEditing[\s\S]*setPrimaryTool\?\.\('kitting', true\)[\s\S]*scrollActiveKittingTrialIntoView\(\)[\s\S]*return true/,
  'reinvoking an already-editable, leased, or terminal Kitting surface keeps it focused');
const formatActiveKittingFocusedIdentity = vm.runInNewContext(
  `const formatQuantity = value => String(value);\n${extractFunction(dashboard, 'formatActiveKittingFocusedIdentity')}\nformatActiveKittingFocusedIdentity`
);
assert.equal(formatActiveKittingFocusedIdentity(
  { workOrder: '0115621 (A)' },
  { billNumber: 'H24589', revision: 'J', scheduledProduction: 10 },
  { state: 'KITTING_IN_PROGRESS' },
  { completedCount: 7, actionableCount: 52, shortCount: 0 }
), 'WO 0115621 (A) · H24589 Rev J · QTY 10 · KITTING IN PROGRESS · 7 / 52 complete',
  'the focused identity preserves the Work Order suffix and renders encoding-safe separators');
const retainedDraftBranch = startOrResumeActiveKitting.indexOf(
  "activeKittingTrialState === 'loaded' && activeKittingTrialDraft && kittingCaseReview");
assert.ok(retainedDraftBranch > -1 && retainedDraftBranch < startOrResumeActiveKitting.indexOf('await ensureKittingCase()'),
  'reopening a visually collapsed loaded panel retains the same in-memory draft before any reload/resume path');
const retainedDraftReopen = startOrResumeActiveKitting.slice(
  retainedDraftBranch, startOrResumeActiveKitting.indexOf('await ensureKittingCase()'));
assert.match(retainedDraftReopen,
  /activeKittingTrialOpen = true[\s\S]*renderActiveKittingTrial\(\)[\s\S]*return true/);
assert.doesNotMatch(retainedDraftReopen,
  /DleApiClient|activeKittingTrialDraft\s*=|activeKittingAutosaveTimer|saveAndExit|resumeKittingCase/,
  'reopening the retained panel neither mutates the draft nor touches autosave, lease, or persistence');
const saveAndExitActiveKitting = extractFunction(dashboard, 'saveAndExitActiveKitting');
assert.match(saveAndExitActiveKitting, /persistActiveKittingDraft\(true\)/,
  'Save & Exit retains the governed release path');
const persistActiveKittingDraft = extractFunction(dashboard, 'persistActiveKittingDraft');
assert.match(persistActiveKittingDraft, /saveAndExitKittingCase/);
assert.match(persistActiveKittingDraft, /activeKittingEditable = false/);
assert.match(persistActiveKittingDraft, /activeKittingTrialOpen = false/);
assert.match(persistActiveKittingDraft, /setPrimaryTool\?\.\('kitting', false\)/);
assert.doesNotMatch(persistActiveKittingDraft, /KIT_SHORT|KIT_COMPLETE|submitKitting|lifecycle/,
  'Save & Exit does not assign a lifecycle disposition');
const isCurrentKittingEditor = vm.runInNewContext(
  `const cleanText = value => String(value ?? '').trim();\n${extractFunction(dashboard, 'isCurrentKittingEditor')}\nisCurrentKittingEditor`,
  { window: { DleOsSession: { user: { userName: 'Miguel', displayName: 'Miguel De Leon' } } } }
);
assert.equal(isCurrentKittingEditor({ editingOwner: 'dev.kitting', editingSessionId: 'active-session' }), false,
  'SUPER_ADMIN inspection does not inherit another identity\'s editing lease');
assert.equal(isCurrentKittingEditor({ editingOwner: 'miguel', editingSessionId: 'active-session' }), true,
  'the current owner retains editable behavior');
assert.equal(isCurrentKittingEditor({ editingOwner: 'Miguel De Leon', editingSessionId: 'active-session' }), true,
  'existing display-name actors remain compatible');
const isSameKittingOperator = vm.runInNewContext(
  `const cleanText = value => String(value ?? '').trim();\n${extractFunction(dashboard, 'isSameKittingOperator')}\nisSameKittingOperator`,
  { window: { DleOsSession: { user: { userName: 'Miguel', displayName: 'Miguel De Leon' } } } }
);
assert.equal(isSameKittingOperator('miguel'), true,
  'same-user reconnect recognizes the canonical username when the display name differs');
assert.equal(isSameKittingOperator('Miguel De Leon'), true,
  'same-user reconnect remains compatible with display-name lease owners');
assert.equal(isSameKittingOperator('dev.kitting'), false,
  'same-user reconnect does not treat another operator as the current user');
const formatKittingJobDueDate = vm.runInNewContext(
  `const clean = value => String(value ?? '').trim();\n${extractFunction(script, 'formatKittingJobDueDate')}\nformatKittingJobDueDate`,
  { Date }
);
assert.equal(formatKittingJobDueDate('2026-10-22'), '10/22/2026');
assert.equal(formatKittingJobDueDate(''), 'N/A');
assert.equal(formatKittingJobDueDate('', ''), '');
assert.equal(formatKittingJobDueDate('invalid'), 'invalid');

const canViewDevelopmentReports = vm.runInNewContext(
  `${extractFunction(script, 'canViewDevelopmentReports')}\ncanViewDevelopmentReports`,
  { window: { DleOsRuntimeConfig: { environment: 'ISOLATED_DEVELOPMENT' } } }
);
assert.equal(canViewDevelopmentReports({ isSuperAdmin: true }), true,
  'SUPER_ADMIN can intentionally open DEV report diagnostics in DEV');
assert.equal(canViewDevelopmentReports({ isSuperAdmin: false }), false,
  'normal Kitting operators do not receive DEV report diagnostics');
assert.equal(vm.runInNewContext(
  `${extractFunction(script, 'canViewDevelopmentReports')}\ncanViewDevelopmentReports({ isSuperAdmin: true })`,
  { window: { DleOsRuntimeConfig: { environment: 'LIVE' } } }
), false, 'DEV report diagnostics remain unavailable outside the isolated DEV runtime');

function fakeClassList() {
  const values = new Set();
  return {
    toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); },
    contains(name) { return values.has(name); }
  };
}
function fakeControl(properties = {}) {
  const attributes = new Map();
  return {
    hidden: false,
    open: false,
    classList: fakeClassList(),
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    ...properties
  };
}
const coordinatorStyle = new Map();
const coordinatorWorkspace = fakeControl({
  dataset: {},
  style: { setProperty(name, value) { coordinatorStyle.set(name, value); } }
});
const coordinatorGlobalHeader = { getBoundingClientRect() { return { height: 117 }; } };
const coordinatorKittingButton = fakeControl();
const coordinatorReportsPanel = fakeControl({ hidden: true, scrollIntoView() {} });
const coordinatorReportsButton = fakeControl();
const coordinatorPrintSummary = fakeControl();
const coordinatorPrintMenu = fakeControl({
  querySelector(selector) { return selector === 'summary' ? coordinatorPrintSummary : null; },
  closest(selector) { return selector === '#kittingJobWorkspace' ? coordinatorWorkspace : null; }
});
const coordinatorElements = {
  kittingJobWorkspace: coordinatorWorkspace,
  workOrderDashboardKitReleasedBom: coordinatorKittingButton,
  kittingJobReports: coordinatorReportsPanel,
  kittingJobReportsToggle: coordinatorReportsButton
};
const coordinatorDocument = {
  getElementById(id) { return coordinatorElements[id] || null; },
  querySelector(selector) {
    if (selector === 'body > header.dle-app-header') return coordinatorGlobalHeader;
    return selector.includes('.kitting-label-menu') ? coordinatorPrintMenu : null;
  }
};
const coordinatorWindow = {
  DleOsRuntimeConfig: { environment: 'ISOLATED_DEVELOPMENT' }
};
vm.runInNewContext(script, { window: coordinatorWindow, document: coordinatorDocument });
const coordinator = coordinatorWindow.KittingJobWorkspace;
coordinator.setPrimaryTool('kitting', true);
assert.equal(coordinatorPrintMenu.open, false);
assert.equal(coordinatorKittingButton.classList.contains('is-active'), true);
assert.equal(coordinatorWorkspace.classList.contains('is-focused-kitting'), true,
  'opening Kitting enters the focused presentation mode');
assert.equal(coordinatorStyle.get('--kitting-focused-sticky-top'), '117px',
  'the focused context clears the measured sticky global operator header');
coordinator.toggleReports(true);
assert.equal(coordinatorReportsPanel.hidden, true,
  'Reports cannot displace an active Focused Kitting surface');
assert.equal(coordinatorReportsButton.classList.contains('is-active'), false);
assert.equal(coordinatorWorkspace.classList.contains('is-focused-kitting'), true,
  'attempting to open Reports keeps Kitting focused until Save & Exit');
coordinatorPrintMenu.open = true;
coordinator.handlePrintLabelsToggle(coordinatorPrintMenu);
assert.equal(coordinatorPrintMenu.open, false,
  'Print Labels cannot displace an active Focused Kitting surface');
assert.equal(coordinatorPrintMenu.classList.contains('is-active'), false);
assert.equal(coordinatorWorkspace.dataset.activePrimaryTool, 'kitting');
coordinator.setPrimaryTool('kitting', false);
assert.equal(coordinatorWorkspace.classList.contains('is-focused-kitting'), false,
  'the governed Save & Exit completion can return the workspace to normal mode');
coordinator.toggleReports(true);
assert.equal(coordinatorReportsPanel.hidden, false,
  'Reports remains available after Save & Exit returns to the normal workspace');
assert.equal(coordinatorReportsButton.classList.contains('is-active'), true);
coordinatorPrintMenu.open = true;
coordinator.handlePrintLabelsToggle(coordinatorPrintMenu);
assert.equal(coordinatorReportsPanel.hidden, true, 'opening Print Labels closes Reports in normal mode');
assert.equal(coordinatorPrintMenu.classList.contains('is-active'), true);
coordinatorPrintMenu.open = false;
coordinator.refreshPrimaryToolPresentation();
assert.equal(coordinatorPrintMenu.open, true,
  'an action-row re-render restores the selected Print Labels disclosure without touching Kitting state');
coordinatorPrintMenu.open = false;
coordinator.handlePrintLabelsToggle(coordinatorPrintMenu);
assert.equal(coordinatorWorkspace.dataset.activePrimaryTool, '',
  'pressing the active Print Labels disclosure again returns to no active tool');
coordinator.toggleReports(true);
coordinator.toggleReports(false);
assert.equal(coordinatorReportsPanel.hidden, true);
assert.equal(coordinatorWorkspace.dataset.activePrimaryTool, '',
  'pressing Reports again collapses the active Reports panel');

console.log('Dedicated Kitting Job Workspace routing and presentation contracts: PASS');

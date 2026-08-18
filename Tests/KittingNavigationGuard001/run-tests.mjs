import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = fs.readFileSync('DLE_Work_Center_v4.0.0.html', 'utf8');
const html = fs.readFileSync('SRC/workspaces/kitting/kitting-job-workspace.html', 'utf8');
const styles = fs.readFileSync('SRC/workspaces/kitting/kitting-job-workspace.css', 'utf8');
const guardSource = fs.readFileSync('SRC/workspaces/kitting/kitting-job-workspace.js', 'utf8');
const dashboard = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.js', 'utf8');
const client = fs.readFileSync('SRC/api/dle-api-client.js', 'utf8');
const control = fs.readFileSync('Tools/LiveSnapshotRefresh/ControlHost/KittingCaseCenter.cs', 'utf8');
const session = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/SharedDeviceSessionUi.cs', 'utf8');

for (const choice of ['Save &amp; Exit', 'Leave Without Saving', 'Cancel']) assert.match(html, new RegExp(choice));
assert.match(html, /id="kittingNavigationGuard"[^>]*aria-labelledby="kittingNavigationGuardTitle"/);
assert.match(styles, /\.kitting-navigation-guard::backdrop/);
assert.match(styles, /\.kitting-navigation-guard-actions button \{[^}]*min-height:50px/);
assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.kitting-navigation-guard-actions \{ grid-template-columns:1fr/);

assert.match(root, /function goBack\(\)[\s\S]*DleOsKittingNavigationGuard\?\.request\?\.\(navigate\)[\s\S]*navigate\(\)/);
assert.match(root, /function goHome\(\)[\s\S]*screenHistory = \[\][\s\S]*DleOsKittingNavigationGuard\?\.request\?\.\(navigate\)/);
assert.match(session, /DleOsKittingNavigationGuard\?\.request\?\.\(continueSignOut\)/);
assert.ok(session.indexOf('DleOsKittingNavigationGuard?.request?.(continueSignOut)') < session.indexOf('void continueSignOut()'),
  'Sign Out offers the active-Kitting guard before starting logout cleanup');

assert.match(client, /abandonKittingCase[\s\S]*requestKittingCase\(workOrderNumber, '\/abandon'/);
assert.match(control, /Route \+ "\/abandon"[\s\S]*AbandonEditingAsync/);
const abandonService = control.slice(
  control.indexOf('internal async Task<object> AbandonEditingAsync'),
  control.indexOf('internal async Task<object> SubmitAsync'));
assert.match(abandonService, /IsolationLevel\.Serializable/);
assert.match(abandonService, /RequireEditable\(current,request,actor,now\)/);
assert.match(abandonService, /EditingSessionId=NULL,EditingOwner=NULL/);
assert.match(abandonService, /EditingAcquiredAtUtc=NULL,EditingExpiresAtUtc=NULL/);
assert.match(abandonService, /"EDITING_ABANDONED"/);
assert.match(abandonService, /draftSaved=false/);
assert.doesNotMatch(abandonService, /DraftJson=@Draft|KittingDraftValidator|KIT_SHORT|KIT_COMPLETE|SubmitAsync/,
  'explicit abandon clears only the owned lease and does not save or classify a draft');

assert.match(dashboard, /function isActiveKittingEditing\(\)[\s\S]*activeKittingTrialOpen[\s\S]*ownsKittingLease\(\)[\s\S]*is-focused-kitting/);
assert.match(dashboard, /pauseActiveKittingAutosaveForNavigation[\s\S]*clearTimeout\(activeKittingAutosaveTimer\)/);
assert.match(dashboard, /resumeActiveKittingAutosaveAfterNavigationCancel[\s\S]*scheduleActiveKittingAutosave\(\)/);
assert.match(dashboard, /abandonActiveKittingWithoutSaving[\s\S]*await activeKittingSaveQueue[\s\S]*abandonKittingCase/);
const abandonClient = dashboard.slice(dashboard.indexOf('async function abandonActiveKittingWithoutSaving'),
  dashboard.indexOf('function focusNextActiveKittingResult'));
assert.doesNotMatch(abandonClient, /saveKittingCaseDraft|saveAndExitKittingCase|submitKittingCase|draft:/);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  const opening = source.indexOf('{', start);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const buttons = [
  { dataset: { kittingNavigationChoice: 'save' }, disabled: false, focus() {} },
  { dataset: { kittingNavigationChoice: 'leave' }, disabled: false, focus() {} },
  { dataset: { kittingNavigationChoice: 'cancel' }, disabled: false, focus() {} }
];
const error = { textContent: '', hidden: true };
const dialog = {
  open: false,
  showModal() { this.open = true; },
  close() { this.open = false; },
  querySelector(selector) { return selector.includes('save') ? buttons[0] : null; },
  querySelectorAll() { return buttons; }
};
let active = false;
let pauses = 0;
let resumes = 0;
let saves = 0;
let abandons = 0;
let saveResult = true;
let abandonResult = true;
let saveState = '';
const context = {
  Promise,
  window: {
    WorkOrderDashboardModule: {
      isActiveKittingEditing: () => active,
      pauseActiveKittingAutosaveForNavigation: () => { pauses += 1; },
      resumeActiveKittingAutosaveAfterNavigationCancel: () => { resumes += 1; },
      saveAndExitActiveKitting: async () => { saves += 1; return saveResult; },
      abandonActiveKittingWithoutSaving: async () => { abandons += 1; return abandonResult; },
      getActiveKittingSaveState: () => saveState
    }
  },
  document: { getElementById: id => id === 'kittingNavigationGuard' ? dialog : error }
};
vm.createContext(context);
vm.runInContext(`
  let pendingNavigation=null;
  let navigationResolutionBusy=false;
  ${extractFunction(guardSource, 'requestKittingNavigation')}
  ${extractFunction(guardSource, 'cancelKittingNavigation')}
  async ${extractFunction(guardSource, 'resolveKittingNavigation')}
  ${extractFunction(guardSource, 'setNavigationGuardBusy')}
  ${extractFunction(guardSource, 'setNavigationGuardError')}
  globalThis.guard={requestKittingNavigation,cancelKittingNavigation,resolveKittingNavigation};
`, context);

let navigations = 0;
assert.equal(context.guard.requestKittingNavigation(() => { navigations += 1; }), false,
  'normal and read-only Kitting navigation is not intercepted');
active = true;
assert.equal(context.guard.requestKittingNavigation(() => { navigations += 1; }), true);
assert.equal(dialog.open, true);
assert.equal(pauses, 1);
assert.equal(context.guard.cancelKittingNavigation(), true);
assert.equal(dialog.open, false);
assert.equal(resumes, 1);
assert.equal(navigations, 0, 'Cancel stays in Focused Kitting');

context.guard.requestKittingNavigation(() => { navigations += 1; });
await context.guard.resolveKittingNavigation('save');
assert.equal(saves, 1);
assert.equal(navigations, 1, 'Save & Exit performs the pending navigation once');

saveResult = false;
saveState = 'The Kitting Case changed; reload the latest saved state.';
context.guard.requestKittingNavigation(() => { navigations += 1; });
await context.guard.resolveKittingNavigation('save');
assert.equal(navigations, 1);
assert.equal(dialog.open, true);
assert.equal(error.textContent, saveState);
assert.equal(buttons.every(button => button.disabled === false), true);
context.guard.cancelKittingNavigation();

context.guard.requestKittingNavigation(() => { navigations += 1; });
await context.guard.resolveKittingNavigation('leave');
assert.equal(abandons, 1);
assert.equal(navigations, 2, 'Leave Without Saving releases ownership then navigates once');

abandonResult = false;
saveState = 'Editing could not be released.';
context.guard.requestKittingNavigation(() => { navigations += 1; });
await context.guard.resolveKittingNavigation('leave');
assert.equal(navigations, 2);
assert.equal(dialog.open, true, 'failed lease release keeps the operator in Kitting');
context.guard.cancelKittingNavigation();

console.log('Active Kitting Back, Home, Sign Out, autosave, and lease guard contracts: PASS');

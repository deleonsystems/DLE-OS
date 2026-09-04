import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const registrySource = fs.readFileSync('SRC/shell/workspace-registry.js', 'utf8');
const homeSource = fs.readFileSync('SRC/home/work-area-home.js', 'utf8');
const homeStyles = fs.readFileSync('SRC/home/work-area-home.css', 'utf8');
const shellSource = fs.readFileSync('SRC/shell/workspace-shell.js', 'utf8');
const operationsSource = fs.readFileSync('SRC/modules/operations-center/operations-center.js', 'utf8');
const identityUiSource = fs.readFileSync(
  'Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/DevelopmentIdentityUi.cs', 'utf8');
const syncPermissionSource = fs.readFileSync(
  'Tools/SecurityFoundation/Database/008_AddSyncOperationsPermission.sql', 'utf8');

assert.match(operationsSource, /window\.OperationsCenter\.loadModule = loadOperationsCenterModule/,
  'Operations Center already has a module loader');
assert.match(operationsSource, /window\.OperationsCenter\.initialize = initializeOperationsCenter/,
  'Operations Center already has an initializer');
assert.match(shellSource, /const workspaceController = window\.DleWorkspaces\?\.\[workspace\.id\]/,
  'workspace shell routes workspace ids through existing registered destinations');
assert.match(identityUiSource,
  /workspaceRules=Object\.freeze\(\{'dle-home':null,kitting:'kitting\.view',production:'kitting\.view',purchasing:'kitting\.view','operations-center':'sync\.operations'\}\)/,
  'development capability simulation already gates Operations Center by sync.operations');
assert.match(syncPermissionSource, /PermissionCode = N'sync\.operations'/,
  'sync.operations is an existing governed permission');
assert.match(syncPermissionSource, /WHERE role\.RoleCode = N'SUPER_ADMIN'/,
  'sync.operations is granted to SUPER_ADMIN');

const context = { window: {} };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(registrySource, context);
const workspaces = context.window.DleWorkspaceRegistry.all();
const operations = context.window.DleWorkspaceRegistry.getById('operations-center');
const kitting = context.window.DleWorkspaceRegistry.getById('kitting');

assert.ok(operations, 'Operations Center is registered as a workspace');
assert.equal(operations.home.requiredPermission, 'sync.operations',
  'Operations Center Home tile uses the management-level sync.operations gate');
assert.equal(operations.home.mark, 'OC',
  'Operations Center tile has its own work-area mark');
assert.equal(operations.home.screenId, 'operationsCenter',
  'Operations Center Home tile routes to the existing Operations Center screen');
assert.equal(kitting.home.requiredPermission, 'kitting.view',
  'Kitting tile keeps its existing operator permission gate');
assert.ok(workspaces.findIndex(workspace => workspace.id === 'operations-center') <
  workspaces.findIndex(workspace => workspace.id === 'kitting'),
  'Operations Center is ordered above Kitting in the work-area registry');

const superAdminCapabilities = { can(permission) { return permission === 'sync.operations'; } };
const kittingOperatorCapabilities = { can(permission) { return permission === 'kitting.view'; } };
const noAccessCapabilities = { can() { return false; } };
const homeWorkAreas = capabilities => workspaces.filter(workspace => {
  const assignment = workspace.home;
  return assignment && capabilities.can(assignment.requiredPermission);
}).map(workspace => workspace.id);

assert.equal(homeWorkAreas(superAdminCapabilities).join(','), 'operations-center,invoice-history',
  'Miguel/SUPER_ADMIN-level capability sees Operations Center and Invoice History on Home');
assert.equal(
  workspaces.find(workspace => workspace.id === 'invoice-history')?.home?.description,
  'History \u2022 Price Reference \u2022 Dedicated Sync',
  'Invoice History Home tile presents quote-reference-friendly helper text');
assert.equal(homeWorkAreas(kittingOperatorCapabilities).join(','), 'purchasing,kitting,production',
  'material operators see Purchasing, Kitting, and Production without gaining Operations Center access');
assert.equal(homeWorkAreas(noAccessCapabilities).join(','), '',
  'Home remains fail-closed without assigned work-area permissions');
assert.match(homeSource, /workspace\.home\.mark \|\| workspace\.home\.label\.slice\(0, 2\)/,
  'Home tile renderer uses each work area mark while preserving the shared card pattern');
assert.match(homeSource, /const screenId = workspace\?\.home\?\.screenId \|\| "home"/,
  'Home tile navigation supports existing module screens without duplicating workspaces');
assert.match(homeSource, /window\.setWorkspaceView\(workspaceId\);[\s\S]*window\.go\(screenId, false\)/,
  'Home tile navigation activates the selected work area and then opens its target screen');
assert.match(homeSource, /window\.DleOperatorHeader\?\.isMobileView\?\.\(\)/,
  'Mobile Home consumes the global shell-owned view mode');
assert.match(homeSource,
  /MOBILE_READY_WORKSPACE_IDS = new Set\(\["operations-center", "invoice-history"\]\)/,
  'Operations Center and Invoice History are the explicitly mobile-ready workspaces');
assert.match(homeSource, /Open Mobile View/,
  'Operations Center is presented as an actionable mobile launcher');
assert.match(homeSource, /Mobile View Coming Soon/,
  'non-mobile-ready assigned work areas communicate their state');
assert.match(homeSource, /querySelectorAll\("\[data-mobile-work-area\]"\)/,
  'only mobile-ready launchers receive navigation behavior');
assert.match(homeSource, /document\.addEventListener\("dle:view-mode-change", render\)/,
  'Home rerenders when the global presentation changes');
assert.match(homeStyles, /body\[data-view-mode="mobile"\] \.work-area-home/,
  'Mobile Home styling is gated by global Mobile View');
assert.match(homeStyles, /env\(safe-area-inset-bottom,0\)/,
  'Mobile Home accounts for the device safe area');

console.log('Operations Center Home tile ordering and permission contracts: PASS');

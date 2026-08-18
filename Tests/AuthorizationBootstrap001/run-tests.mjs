import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync('DLE_Work_Center_v4.0.0.html', 'utf8');
const identityUi = fs.readFileSync(
  'Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/DevelopmentIdentityUi.cs', 'utf8');
const server = fs.readFileSync(
  'Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/Program.cs', 'utf8');
const workspaceShell = fs.readFileSync('SRC/shell/workspace-shell.js', 'utf8');

assert.match(identityUi, /data-dle-bootstrap-state="resolving"[\s\S]*display:none!important/,
  'unresolved authorization withholds application children rather than painting privileged chrome');
assert.match(identityUi, /<strong>DLE-OS<\/strong><span>Loading your workspace\.\.\.<\/span>/,
  'bootstrap presentation is intentionally neutral');
assert.match(identityUi, /window\.DleOsAuthorizationReady=new Promise/);
assert.match(identityUi, /window\.DleOsBootstrap\.authorizationReady\(\)/);
assert.match(identityUi, /document\.addEventListener\('DOMContentLoaded',[\s\S]*announceCapabilities/,
  'capabilities are announced again after all late-injected authorized controls exist');
assert.match(server, /CurrentUserResponseFactory\.Create\(currentUser\)\.Body[\s\S]*DevelopmentIdentityUi\.Inject\(html, identityPayload\)/,
  'the already-governed root identity is embedded without a duplicate browser identity lookup');
assert.match(server, /shellIdentityJsonOptions\s*=\s*new JsonSerializerOptions\(JsonSerializerDefaults\.Web\)/,
  'the embedded identity uses the same camel-case JSON contract as api auth me');
assert.match(server, /JsonSerializer\.Serialize\([\s\S]*CurrentUserResponseFactory\.Create\(currentUser\)\.Body,[\s\S]*shellIdentityJsonOptions\)/,
  'the complete normalized identity projection is serialized into the fail-closed shell bootstrap');

const initShell = workspaceShell.slice(
  workspaceShell.indexOf('function initWorkspaceShell'),
  workspaceShell.indexOf('window.DleWorkspaceShell'));
assert.doesNotMatch(initShell, /initWorkspaceShell\(\)[\s\S]*activateWorkspace\(selectedWorkspaceId\)/,
  'registry initialization does not activate a workspace before destination selection');
assert.match(initShell, /function activateInitialWorkspace\(\)[\s\S]*activateWorkspace/);
assert.match(shell, /let selectedWorkspaceView = "dle-home"/);
assert.match(shell, /data-workspace-home="dle-home"[^>]*class=|class="workspace-home active" data-workspace-home="dle-home"/);

const initialize = shell.slice(
  shell.indexOf('async function initializeDleWorkCenter'),
  shell.indexOf('function getDleMasterDataConnectionStatusLabel'));
assert.ok(initialize.indexOf('await window.DleOsAuthorizationReady') < initialize.indexOf('loadSystemCenterModule'),
  'module bootstrap waits for resolved authorization');
assert.ok(initialize.indexOf('initializeWorkOrderDashboardModule()') <
  initialize.indexOf('activateInitialWorkspace()'),
  'default workspace activation occurs after module initialization');
assert.ok(initialize.indexOf('window.DleOsBootstrap.complete()') <
  initialize.indexOf('initializeDleMasterDataAutoLoad()'),
  'non-critical master-data reads no longer block revealing an authorized destination');

console.log('Authorization bootstrap contracts: PASS');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const shell = fs.readFileSync('DLE_Work_Center_v4.0.0.html', 'utf8');
const styles = fs.readFileSync('SRC/shell/operator-header.css', 'utf8');
const script = fs.readFileSync('SRC/shell/operator-header.js', 'utf8');
const workspace = fs.readFileSync('SRC/shell/workspace-shell.js', 'utf8');
const workAreaHome = fs.readFileSync('SRC/home/work-area-home.js', 'utf8');
const homeStyles = fs.readFileSync('SRC/home/work-area-home.css', 'utf8');
const operationsStyles = fs.readFileSync('SRC/modules/operations-center/operations-center.css', 'utf8');
const invoiceStyles = fs.readFileSync('SRC/modules/invoice-history/invoice-history.css', 'utf8');
const kittingStyles = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.css', 'utf8');
const productionStyles = fs.readFileSync('SRC/workspaces/production/production-workspace.css', 'utf8');
const workOrderStyles = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.css', 'utf8');
const sessionUi = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/SharedDeviceSessionUi.cs', 'utf8');
const simShellRenderer = fs.readFileSync('Tools/SimRuntime/DleOs.SimHost/SimShellRenderer.cs', 'utf8');
const runtimeUi = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/RuntimeIdentityUi.cs', 'utf8');
const employeeUi = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/EmployeeDirectoryUi.cs', 'utf8');

assert.match(shell, /class="dle-operator-header"/);
assert.match(shell, /&larr; Back/);
assert.match(shell, /onclick="goHome\(\)"/);
assert.match(shell, /id="dleFactoryClock"/);
assert.match(shell, /class="dle-header-right"[\s\S]*?class="dle-dev-secondary-slot"[\s\S]*?id="dleEnvironmentBadge"[\s\S]*?id="dleDevControlsToggle"[\s\S]*?class="dle-identity-clock-stack"[\s\S]*?id="dleFactoryClock"[\s\S]*?class="top-pills"/);
assert.match(shell, /function goHome\(\)\s*\{[\s\S]*?screenHistory = \[\];[\s\S]*?setWorkspaceView\('dle-home'\);[\s\S]*?go\('home', false\);/);
assert.match(shell, /function goBack\(\)\s*\{[\s\S]*?screenHistory\.pop\(\)[\s\S]*?go\(previousScreen, false\)/);
assert.match(shell, /DLE-OS[\s\S]*id="activeWorkAreaLabel">HOME/);
assert.match(shell, /id="dleEnvironmentBadge"[\s\S]*>DEV<\/span>/);
assert.match(shell, /id="dleDevControlsToggle"[\s\S]*hidden/);
assert.match(shell, /id="dleDevControlsPanel"[\s\S]*hidden/);
assert.doesNotMatch(shell, /id="changeWorkAreaButton"|>Change Work Area<|onclick="changeWorkArea\(\)"/);
assert.doesNotMatch(shell.match(/<div class="dle-operator-header">[\s\S]*?<\/div>\s*<section id="dleDevControlsPanel"/)?.[0] || '', /Workspace View|Employee Directory|Alpha v1\.0\.0/);

for (const route of ['openOrders', 'shipmentStaging', 'shipmentHistory', 'orderDashboard', 'workOrderDashboard',
  'assemblyDashboard', 'documentIntake', 'reportsCommunications', 'workbench', 'systemCenter']) {
  assert.match(shell, new RegExp(`onclick="go\\('${route}'\\)"`));
}
assert.match(shell, /Workspace View/);
assert.match(shell, /DLE-OS Alpha v1\.0\.0/);
assert.match(script, /capabilities\?\.isSuperAdmin === true/);
assert.match(script, /toggle\.hidden = !authorized/);
assert.match(script, /badge\.hidden = authorized/);
assert.match(script, /panel\.hidden = true/);
assert.match(script, /aria-expanded/);
assert.match(script, /America\/Los_Angeles/);
assert.match(script, /weekday: 'long'/);
assert.match(script, /second: '2-digit'/);
assert.match(script, /hour12: true/);
assert.match(script, /window\.setInterval\(render, 1000\)/);
assert.match(script, /const DESKTOP_VIEW_MODE = 'desktop'/);
assert.match(script, /const IPAD_VIEW_MODE = 'ipad'/);
assert.match(script, /const MOBILE_VIEW_MODE = 'mobile'/);
assert.match(script, /const VIEW_MODE_STORAGE_KEY = 'DLE_OS_VIEW_MODE'/);
assert.match(script, /window\.localStorage\?\.getItem\(VIEW_MODE_STORAGE_KEY\)/);
assert.match(script, /window\.localStorage\?\.setItem\(VIEW_MODE_STORAGE_KEY, viewMode\)/);
assert.match(script, /select\.id = 'dleViewModeSelect'/);
assert.match(script, /\[DESKTOP_VIEW_MODE, 'Desktop View'\]/);
assert.match(script, /\[IPAD_VIEW_MODE, 'iPad View'\]/);
assert.match(script, /\[MOBILE_VIEW_MODE, 'Mobile View'\]/);
assert.match(script, /select\.addEventListener\('change', \(\) => setViewMode\(select\.value\)\)/);
assert.match(script, /if \(select\) select\.value = viewMode/);
assert.doesNotMatch(script, /data-dle-view-mode-option|aria-pressed/);
assert.match(script, /document\.body\.dataset\.viewMode = viewMode/);
assert.match(script, /dle:view-mode-change/);
assert.match(script, /window\.OperationsCenter\?\.toggleMobileView/);
assert.match(script, /getElementById\('operationsCenterMobileViewToggle'\)\?\.remove\(\)/);
assert.match(script, /querySelector\('\.operations-center-mobile-search-row > button'\)\?\.remove\(\)/);
assert.match(script, /Mobile View Coming Soon/);
assert.match(script, /viewMode === MOBILE_VIEW_MODE && !homeActive && !operationsCenterActive && !invoiceHistoryActive/);
assert.match(script, /window\.DleWorkAreaHome\?\.render\?\.\(\)/);
assert.match(script, /getViewMode/);
assert.match(script, /setViewMode/);
assert.match(script, /isIpadView/);
assert.match(workspace, /mode\.textContent = isHome \? "HOME" : workspace\.label\.toUpperCase\(\)/);
assert.doesNotMatch(workspace, /changeWorkAreaButton/);
assert.match(workAreaHome, /window\.changeWorkArea = function changeWorkArea\(\)/);
assert.match(workAreaHome, /MOBILE_READY_WORKSPACE_IDS = new Set\(\["operations-center", "invoice-history"\]\)/);
assert.match(workAreaHome, /MOBILE_READY_WORKSPACE_IDS\.has\(workspace\.id\)/);
assert.match(workAreaHome, /data-mobile-work-area=/);

assert.match(styles, /\.dle-operator-header \.logo \{ height:86px/);
assert.match(styles, /\.dle-operator-header \.app-title \{[^}]*display:grid[^}]*grid-template-rows:auto auto[^}]*justify-items:start/);
assert.match(styles, /\.dle-work-area-separator \{ display:none \}/);
assert.match(styles, /#activeWorkAreaLabel \{[^}]*display:block[^}]*justify-self:start/);
assert.match(styles, /min-height:44px/);
assert.match(styles, /@media\(max-width:1280px\)/);
assert.match(styles, /@media\(max-width:760px\)/);
assert.match(styles, /@media \(min-width:700px\) and \(max-width:1280px\)/);
assert.match(styles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\) \.dle-operator-header \{[\s\S]*display: grid;[\s\S]*grid-template-areas:[\s\S]*"logo title right"[\s\S]*"navigation mode mode";[\s\S]*padding: 5px 12px;/);
assert.match(styles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\) \.dle-header-right \{[\s\S]*grid-area: right;[\s\S]*display: grid;[\s\S]*grid-template-areas:[\s\S]*"\. clock"[\s\S]*"environment identity";[\s\S]*align-items: center;[\s\S]*justify-self: end;/);
assert.match(styles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\) \.dle-dev-secondary-slot \{[\s\S]*grid-area: environment;[\s\S]*align-self: center;/);
assert.match(styles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\) \.dle-identity-clock-stack \{ display: contents; \}/);
assert.match(styles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\) \.dle-identity-clock-stack>\.top-pills \{ grid-area: identity; \}/);
assert.match(styles, /@media \(min-width:1100px\) and \(max-width:1280px\)/);
assert.match(styles, /grid-template-areas: "navigation mode logo divider title right";/);
assert.match(styles, /body > main \{ margin-top:28px/);
assert.match(styles, /body > main,[\s\S]*max-width: none;[\s\S]*margin: 0;[\s\S]*calc\(\(100vw - 1120px\) \/ 2 \+ 22px\)/);
assert.match(styles, /body > main,[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;/);
assert.match(styles, /\.dle-factory-clock \{[^}]*white-space:nowrap/);
assert.match(styles, /\.dle-header-right \{[^}]*display:flex/);
assert.match(styles, /\.dle-header-right \{[^}]*align-items:flex-end[^}]*gap:8px/);
assert.match(styles, /\.dle-dev-secondary-slot \{[^}]*flex:0 0 auto/);
assert.match(styles, /\.dle-identity-clock-stack \{[^}]*width:292px;max-width:100%/);
assert.match(styles, /\.dle-identity-clock-stack>.top-pills \{ width:100%/);
assert.match(styles, /\.dle-identity-clock-stack #dle-auth-identity \{ width:100%;max-width:100%[^}]*justify-content:space-between/);
assert.match(styles, /\.dle-view-mode-toggle \{[^}]*width:166px[^}]*height:44px[^}]*min-height:44px[^}]*display:flex[^}]*margin:0/);
assert.match(styles, /\.dle-view-mode-toggle select \{[^}]*min-height:36px[^}]*background:var\(--blue\)/);
assert.match(styles, /body\[data-view-mode="mobile"\][^\n]*data-workspace-view="operations-center"/);
assert.match(styles, /:not\(\[data-workspace-view="invoice-history"\]\)/);
assert.match(styles, /@media\(max-width:420px\)[^\n]*\.dle-view-mode-toggle\{flex-basis:158px;max-width:158px/);
assert.match(styles, /body\[data-view-mode="mobile"\] > header\.dle-app-header/);
assert.match(styles, /grid-template-areas:"brand mode" "navigation identity"/);
assert.match(styles, /body\[data-view-mode="mobile"\] \.dle-view-mode-toggle \{[^}]*width:166px[^}]*height:40px[^}]*min-height:40px/);
assert.match(styles, /body\[data-view-mode="mobile"\] \.dle-view-mode-toggle select \{ min-height:34px;padding:5px 3px \}/);
assert.match(styles, /body\[data-view-mode="mobile"\] \.dle-factory-clock \{ display:none \}/);
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="dle-home"\] #dle-auth-details,[\s\S]*body\[data-view-mode="mobile"\]\[data-workspace-view="dle-home"\] #dle-auth-name \{ display:none \}/);
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="dle-home"\] #dle-auth-identity:not\(:has\(#dle-auth-signout\)\) \{ display:none!important \}/);
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="operations-center"\] #dle-auth-details,[\s\S]*body\[data-view-mode="mobile"\]\[data-workspace-view="operations-center"\] #dle-auth-name \{ display:none \}/);
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="operations-center"\] #dle-auth-identity:not\(:has\(#dle-auth-signout\)\) \{ display:none!important \}/);
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="invoice-history"\] #dle-auth-details,[\s\S]*body\[data-view-mode="mobile"\]\[data-workspace-view="invoice-history"\] #dle-auth-name \{ display:none \}/);
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="invoice-history"\] #dle-auth-identity:not\(:has\(#dle-auth-signout\)\) \{ display:none!important \}/);
assert.doesNotMatch(styles, /body\[data-view-mode="desktop"\][^{]*#dle-auth-details[^}]*display:none/);
assert.doesNotMatch(styles, /body\[data-view-mode="ipad"\][^{]*#dle-auth-details[^}]*display:none/);
assert.match(styles, /body\[data-view-mode="mobile"\] #dle-auth-name \{ overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
assert.match(styles, /@media\(max-width:420px\)[^\n]*grid-template-columns:minmax\(108px,1fr\) minmax\(0,1\.55fr\)/);
assert.match(styles, /env\(safe-area-inset-top,0\)/);
assert.match(styles, /body\[data-view-mode="ipad"\] \.dle-operator-header \{[\s\S]*display: flex;[\s\S]*flex-wrap: nowrap;[\s\S]*align-items: center;/);
assert.match(styles, /body\[data-view-mode="ipad"\] \.dle-header-right \{[\s\S]*display: flex;[\s\S]*align-items: flex-end;/);
assert.doesNotMatch(styles, /body\[data-view-mode="ipad"\] > main \{[\s\S]*max-width: 820px/);
assert.match(homeStyles, /body\[data-view-mode="ipad"\] \.work-area-home-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
assert.doesNotMatch(homeStyles, /body\[data-view-mode="ipad"\][^{]*work-area-home-grid\{[^}]*repeat\(2/);
assert.doesNotMatch(homeStyles, /body\[data-view-mode="ipad"\][^{]*work-area-card\{/);
assert.doesNotMatch(operationsStyles, /data-view-mode="ipad"/);
assert.match(invoiceStyles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\)\[data-workspace-view="invoice-history"\] > main/);
assert.match(kittingStyles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\)\[data-workspace-view="kitting"\]>main/);
assert.match(productionStyles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\)\[data-workspace-view="production"\]>main/);
assert.match(workOrderStyles, /body:is\(\[data-view-mode="desktop"\],\[data-view-mode="ipad"\]\) #workOrderDashboardModule\[data-dashboard-view="production"\] \.work-order-dashboard-module-document-grid/);
assert.doesNotMatch(invoiceStyles, /body\[data-view-mode="ipad"\]/);
assert.doesNotMatch(kittingStyles, /body\[data-view-mode="ipad"\]/);
assert.doesNotMatch(productionStyles, /body\[data-view-mode="ipad"\]/);
assert.doesNotMatch(workOrderStyles, /body\[data-view-mode="ipad"\]/);
assert.match(sessionUi, /gap:8px!important;/);
assert.match(sessionUi, /padding:6px 8px 6px 10px!important/);
assert.match(sessionUi, /min-width:116px/);
assert.match(simShellRenderer, /return DevelopmentIdentityUi\.Inject\(html\);/);
assert.doesNotMatch(simShellRenderer, /SharedDeviceSessionUi\.Inject/);
assert.match(sessionUi, /headerControls=document\.querySelector\('body>header \.top-pills'\)/);
assert.match(sessionUi, /button\.textContent='Sign Out'/);
assert.match(runtimeUi, /getElementById\('dleDevBuildDetails'\)/);
assert.match(employeeUi, /getElementById\('dleDevControlsUtilities'\)/);
assert.match(employeeUi, /(?:e|event)\.detail\?\.isSuperAdmin/);

const elements = new Map(['dleDevControlsToggle', 'dleDevControlsPanel', 'dleEnvironmentBadge', 'dleFactoryClock', 'dleViewModeSelect']
  .map(id => [id, {
    dataset: {}, hidden: id === 'dleDevControlsPanel', textContent: '', dateTime: '', title: '',
    attributes: new Map(),
    addEventListener() {},
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; }
  }]));
const viewStorage = new Map();
const localStorage = {
  getItem(key) { return viewStorage.get(key) ?? null; },
  setItem(key, value) { viewStorage.set(key, String(value)); }
};
const clockContext = {
  window: { setInterval() { return 1; }, DleOsCapabilities: null, localStorage },
  document: { getElementById(id) { return elements.get(id) || null; }, addEventListener() {} },
  Intl, Date, console
};
clockContext.window.window = clockContext.window;
vm.createContext(clockContext);
vm.runInContext(script, clockContext);
const factoryInstant = new Date('2026-08-14T16:52:34.000Z');
const originalTimezone = process.env.TZ;
process.env.TZ = 'UTC';
const renderedFromUtcDevice = clockContext.window.DleOperatorHeader.formatFactoryTime(factoryInstant);
process.env.TZ = 'Asia/Tokyo';
const renderedFromTokyoDevice = clockContext.window.DleOperatorHeader.formatFactoryTime(factoryInstant);
if (originalTimezone === undefined) delete process.env.TZ;
else process.env.TZ = originalTimezone;
assert.equal(renderedFromUtcDevice, 'Friday, 08/14/2026 · 9:52:34 AM');
assert.equal(renderedFromTokyoDevice, renderedFromUtcDevice);
assert.equal(clockContext.window.DleOperatorHeader.getViewMode(), 'desktop');
assert.equal(clockContext.window.DleOperatorHeader.setViewMode('ipad'), 'ipad');
assert.equal(elements.get('dleViewModeSelect').value, 'ipad');
assert.equal(clockContext.window.DleOperatorHeader.isIpadView(), true);
assert.equal(viewStorage.get('DLE_OS_VIEW_MODE'), 'ipad');
assert.equal(clockContext.window.DleOperatorHeader.setViewMode('mobile'), 'mobile');
assert.equal(elements.get('dleViewModeSelect').value, 'mobile');
assert.equal(clockContext.window.DleOperatorHeader.isMobileView(), true);
assert.equal(clockContext.window.DleOperatorHeader.setViewMode('unsupported'), 'desktop');
assert.equal(elements.get('dleViewModeSelect').value, 'desktop');
assert.equal(clockContext.window.DleOperatorHeader.isDesktopView(), true);

viewStorage.set('DLE_OS_VIEW_MODE', 'ipad');
const reloadElements = new Map([['dleViewModeSelect', {
  value: '', dataset: {}, addEventListener() {}, setAttribute() {}
}]]);
const reloadContext = {
  window: { setInterval() { return 1; }, DleOsCapabilities: null, localStorage },
  document: { getElementById(id) { return reloadElements.get(id) || null; }, addEventListener() {} },
  Intl, Date, console
};
reloadContext.window.window = reloadContext.window;
vm.createContext(reloadContext);
vm.runInContext(script, reloadContext);
assert.equal(reloadContext.window.DleOperatorHeader.getViewMode(), 'ipad');

console.log('Operator-first header layout, persisted Desktop/iPad/Mobile selection, and responsive contracts: PASS');

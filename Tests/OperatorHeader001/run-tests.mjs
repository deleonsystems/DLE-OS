import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const shell = fs.readFileSync('DLE_Work_Center_v4.0.0.html', 'utf8');
const styles = fs.readFileSync('SRC/shell/operator-header.css', 'utf8');
const script = fs.readFileSync('SRC/shell/operator-header.js', 'utf8');
const workspace = fs.readFileSync('SRC/shell/workspace-shell.js', 'utf8');
const workAreaHome = fs.readFileSync('SRC/home/work-area-home.js', 'utf8');
const sessionUi = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/SharedDeviceSessionUi.cs', 'utf8');
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
assert.doesNotMatch(script, /localStorage|sessionStorage/);
assert.match(script, /const DESKTOP_VIEW_MODE = 'desktop'/);
assert.match(script, /const MOBILE_VIEW_MODE = 'mobile'/);
assert.match(script, /document\.body\.dataset\.viewMode = viewMode/);
assert.match(script, /dle:view-mode-change/);
assert.match(script, /window\.OperationsCenter\?\.toggleMobileView/);
assert.match(script, /getElementById\('operationsCenterMobileViewToggle'\)\?\.remove\(\)/);
assert.match(script, /querySelector\('\.operations-center-mobile-search-row > button'\)\?\.remove\(\)/);
assert.match(script, /Mobile View Coming Soon/);
assert.match(script, /viewMode === MOBILE_VIEW_MODE && !homeActive && !operationsCenterActive/);
assert.match(script, /window\.DleWorkAreaHome\?\.render\?\.\(\)/);
assert.match(script, /getViewMode/);
assert.match(script, /setViewMode/);
assert.match(workspace, /mode\.textContent = isHome \? "HOME" : workspace\.label\.toUpperCase\(\)/);
assert.doesNotMatch(workspace, /changeWorkAreaButton/);
assert.match(workAreaHome, /window\.changeWorkArea = function changeWorkArea\(\)/);

assert.match(styles, /\.dle-operator-header \.logo \{ height:86px/);
assert.match(styles, /min-height:44px/);
assert.match(styles, /@media\(max-width:1100px\)/);
assert.match(styles, /@media\(max-width:760px\)/);
assert.match(styles, /body > main \{ margin-top:28px/);
assert.match(styles, /\.dle-factory-clock \{[^}]*white-space:nowrap/);
assert.match(styles, /\.dle-header-right \{[^}]*display:flex/);
assert.match(styles, /\.dle-header-right \{[^}]*align-items:flex-end[^}]*gap:8px/);
assert.match(styles, /\.dle-dev-secondary-slot \{[^}]*flex:0 0 auto/);
assert.match(styles, /\.dle-identity-clock-stack \{[^}]*width:292px;max-width:100%/);
assert.match(styles, /\.dle-identity-clock-stack>.top-pills \{ width:100%/);
assert.match(styles, /\.dle-identity-clock-stack #dle-auth-identity \{ width:100%;max-width:100%[^}]*justify-content:space-between/);
assert.match(styles, /\.dle-view-mode-toggle \{[^}]*grid-template-columns:1fr 1fr/);
assert.match(styles, /\.dle-view-mode-toggle button\[aria-pressed="true"\]/);
assert.match(styles, /body\[data-view-mode="mobile"\][^\n]*data-workspace-view="operations-center"/);
assert.match(styles, /@media\(max-width:420px\)[^\n]*\.dle-view-mode-toggle\{flex-basis:204px;max-width:210px\}/);
assert.match(styles, /body\[data-view-mode="mobile"\] > header\.dle-app-header/);
assert.match(styles, /grid-template-areas:"brand mode" "navigation identity"/);
assert.match(styles, /body\[data-view-mode="mobile"\] \.dle-view-mode-toggle \{[^}]*min-height:40px[^}]*box-sizing:border-box[^}]*padding:2px/);
assert.match(styles, /body\[data-view-mode="mobile"\] \.dle-view-mode-toggle button \{ min-height:34px;padding:5px 6px \}/);
assert.match(styles, /body\[data-view-mode="mobile"\] \.dle-factory-clock \{ display:none \}/);
assert.match(styles, /body\[data-view-mode="mobile"\] #dle-auth-name \{ overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
assert.match(styles, /@media\(max-width:420px\)[^\n]*grid-template-columns:minmax\(108px,1fr\) minmax\(0,1\.55fr\)/);
assert.match(styles, /env\(safe-area-inset-top,0\)/);
assert.match(sessionUi, /gap:8px!important;/);
assert.match(sessionUi, /padding:6px 8px 6px 10px!important/);
assert.match(sessionUi, /min-width:116px/);
assert.match(sessionUi, /headerControls=document\.querySelector\('body>header \.top-pills'\)/);
assert.match(sessionUi, /button\.textContent='Sign Out'/);
assert.match(runtimeUi, /getElementById\('dleDevBuildDetails'\)/);
assert.match(employeeUi, /getElementById\('dleDevControlsUtilities'\)/);
assert.match(employeeUi, /(?:e|event)\.detail\?\.isSuperAdmin/);

const elements = new Map(['dleDevControlsToggle', 'dleDevControlsPanel', 'dleEnvironmentBadge', 'dleFactoryClock']
  .map(id => [id, {
    dataset: {}, hidden: id === 'dleDevControlsPanel', textContent: '', dateTime: '', title: '',
    attributes: new Map(),
    addEventListener() {},
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; }
  }]));
const clockContext = {
  window: { setInterval() { return 1; }, DleOsCapabilities: null },
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
assert.equal(clockContext.window.DleOperatorHeader.setViewMode('mobile'), 'mobile');
assert.equal(clockContext.window.DleOperatorHeader.isMobileView(), true);
assert.equal(clockContext.window.DleOperatorHeader.setViewMode('unsupported'), 'desktop');
assert.equal(clockContext.window.DleOperatorHeader.isDesktopView(), true);

console.log('Operator-first header layout, permissions, injection, and responsive contracts: PASS');

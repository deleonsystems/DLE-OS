import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const registry = read("SRC/shell/workspace-registry.js");
const home = read("SRC/home/work-area-home.js");
const source = read("SRC/workspaces/purchasing/purchasing-workspace.js");
const markup = read("SRC/workspaces/purchasing/purchasing-workspace.html");
const styles = read("SRC/workspaces/purchasing/purchasing-workspace.css");
const jobSource = read("SRC/workspaces/purchasing/purchasing-job-workspace.js");
const jobMarkup = read("SRC/workspaces/purchasing/purchasing-job-workspace.html");
const jobStyles = read("SRC/workspaces/purchasing/purchasing-job-workspace.css");
const identityUi = read("Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/DevelopmentIdentityUi.cs");

assert.match(registry, /id: "purchasing"[\s\S]*?label: "Purchasing"[\s\S]*?description: "Shortages \\u2022 POs \\u2022 Due Dates \\u2022 Receiving"[\s\S]*?mark: "PU"[\s\S]*?requiredPermission: "kitting\.view"/);
assert.match(registry, /id: "purchasing"[\s\S]*?modulePath: "SRC\/workspaces\/purchasing\/purchasing-workspace\.js"/);
assert.match(registry, /id: "purchasing"[\s\S]*?stylePath: "SRC\/workspaces\/purchasing\/purchasing-workspace\.css"/);
assert.match(home, /workAreas\.map\(workspace =>[\s\S]*?class="work-area-card"[\s\S]*?workspace\.home\.mark[\s\S]*?workspace\.home\.label\.toUpperCase\(\)[\s\S]*?workspace\.home\.description[\s\S]*?work-area-card-arrow/);
assert.match(home, /function enter\(workspaceId\)[\s\S]*?setWorkspaceView\(workspaceId\)[\s\S]*?window\.go\(screenId, false\)/);
assert.match(identityUi, /purchasing:'kitting\.view'/);

assert.match(markup, /class="production-workspace purchasing-workspace"/);
assert.match(markup, /class="production-workspace-header"[\s\S]*?<h1>Purchasing<\/h1>/);
assert.match(markup, /Select a material shortage, purchase order, or item requiring buyer action\./);
assert.match(markup, /Purchasing queues current/);
assert.match(markup, /placeholder="Search Part, Vendor, PO, Work Order, Customer\.\.\."/);
assert.match(markup, /class="secondary-btn production-refresh">↻ Refresh Queue<\/button>/);
assert.match(styles, /@import url\("\.\.\/production\/production-workspace\.css"\)/);
assert.match(markup, /class="production-lifecycle-tabs purchasing-lifecycle-tabs"/);
assert.match(markup, /class="active" data-purchasing-tab="material-shortages" aria-pressed="true"/);
assert.match(markup, /data-purchasing-tab="vendor-management" aria-pressed="false" disabled/);
assert.match(markup, /data-purchasing-tab="open-needs" aria-pressed="false" disabled/);
assert.doesNotMatch(markup, /data-purchasing-tab="material-shortages"[\s\S]*?<strong[^>]*>\d+<\/strong>/);
assert.match(styles, /\.purchasing-lifecycle-tabs\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
assert.match(styles, /\.purchasing-lifecycle-tabs button:disabled\{[^}]*opacity:\.48[^}]*background:#111827[^}]*color:#64748b/);
assert.match(source, /DleWorkspaces\?\.kitting\?\.loadReadModel/);
assert.match(source, /model\?\.queues\?\.kitShort/);
assert.doesNotMatch(source, /queues\?\.kitComplete|queues\.kitComplete/);
assert.match(source, /class="production-compact-row"/);
assert.match(source, /<small>QTY<\/small>/);
assert.match(source, /<small>DUE<\/small>/);
assert.match(source, /production-compact-customer/);
assert.match(source, /production-compact-state">KIT SHORT/);
assert.match(source, /production-compact-arrow/);
assert.match(source, /JOB_WORKSPACE_MODULE_PATH = "SRC\/workspaces\/purchasing\/purchasing-job-workspace\.js"/);
assert.match(source, /controller\.open\(row\)/);
assert.doesNotMatch(source, /KittingJobWorkspace|kittingJobWorkspace/);
assert.match(source, /setStatus\("Purchasing queues current", "ready"\)/);
assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)|DleApi/i);
assert.match(jobMarkup, /<h1 id="purchasingJobWorkspaceTitle">Purchasing Job Workspace<\/h1>/);
for (const id of ["purchasingJobWorkOrder", "purchasingJobAssembly", "purchasingJobRevision",
  "purchasingJobQuantity", "purchasingJobDueDate", "purchasingJobCustomer", "purchasingJobMaterialStatus"]) {
  assert.match(jobMarkup, new RegExp(`id="${id}"`));
  assert.match(jobSource, new RegExp(`setText\\("${id}"`));
}
const workOrderCardIndex = jobMarkup.indexOf('id="purchasingJobWorkOrder"');
const materialStatusCardIndex = jobMarkup.indexOf('data-purchasing-material-status-card');
const materialShortageSectionIndex = jobMarkup.indexOf('class="purchasing-job-shortage-card"');
assert.ok(workOrderCardIndex >= 0 && materialStatusCardIndex > workOrderCardIndex &&
  materialShortageSectionIndex > materialStatusCardIndex,
  "Material Status card follows the Work Order summary and precedes Material Shortage");
assert.match(jobMarkup, /data-purchasing-material-status-card>[\s\S]*?<small>MATERIAL STATUS<\/small><strong id="purchasingJobMaterialStatusCard">KIT SHORT<\/strong>/);
assert.doesNotMatch(jobMarkup, /<(?:button|a)[^>]*data-purchasing-material-status-card/);
assert.match(jobSource, /setText\("purchasingJobMaterialStatusCard", materialStatus\.toUpperCase\(\)\)/);
assert.doesNotMatch(jobSource, /purchasingJobMaterialStatusCard[^\n]*(?:addEventListener|onclick|fetch)/);
assert.match(jobSource, /setWorkspaceView\?\.\("purchasing"\)/);
assert.match(jobSource, /window\.go\(SCREEN_ID\)/);
assert.match(jobSource, /const SCREEN_ID = "purchasingJobWorkspace"/);
assert.doesNotMatch(jobSource, /KittingJobWorkspace|kittingJobWorkspace|method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
assert.match(jobStyles, /\.purchasing-job-summary\{display:grid/);

const opened = [];
const context = {
  window: {
    DleWorkspaces: {},
    PurchasingJobWorkspace: { open(row) { opened.push(row); return true; } }
  },
  document: {}, console, Map, Object, Number, String
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context);

const purchasing = context.window.DleWorkspaces.purchasing;
const short = {
  queueKey: "WO|1002", actionable: true, workOrderNumber: "1002",
  customerNumber: "C02", customerName: "Beta Systems", assemblyItemNumber: "ASM-200",
  revision: "C", canonicalWorkOrderQuantity: 10, earliestDueDate: "2026-09-01",
  materialStatusLabel: "Kit Short", canonicalWorkOrder: { workOrderNumber: "1002" },
  relatedLines: [{ operationalQuantityOpen: 10, customerPurchaseOrderNumber: "PO-44" }]
};
const complete = { ...short, queueKey: "WO|1001", workOrderNumber: "1001", materialStatusLabel: "Kit Complete" };
const needsKitting = { ...short, queueKey: "WO|1003", workOrderNumber: "1003", materialStatusLabel: "Needs Kitting" };
const model = { queues: { kitShort: [short], kitComplete: [complete], needsKitting: [needsKitting] } };

assert.deepEqual(Array.from(purchasing.buildViewModel(model).materialShortages, row => row.workOrderNumber), ["1002"]);
assert.deepEqual(Array.from(purchasing.buildViewModel(model, "beta").materialShortages, row => row.workOrderNumber), ["1002"]);
assert.deepEqual(Array.from(purchasing.buildViewModel(model, "PO-44").materialShortages, row => row.workOrderNumber), ["1002"]);
assert.equal(purchasing.buildViewModel(model, "not-present").materialShortages.length, 0);
assert.equal(await purchasing.openShortageDetail(short), true);
assert.equal(opened[0].workOrderNumber, "1002");

console.log("Purchasing home tile, permission, navigation, and landing-shell contracts: PASS");

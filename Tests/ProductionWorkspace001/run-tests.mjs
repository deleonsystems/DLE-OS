import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const source = read("SRC/workspaces/production/production-workspace.js");
const markup = read("SRC/workspaces/production/production-workspace.html");
const styles = read("SRC/workspaces/production/production-workspace.css");
const registry = read("SRC/shell/workspace-registry.js");
const shell = read("DLE_Work_Center_v4.0.0.html");
const kitting = read("SRC/workspaces/kitting/kitting-workspace.js");
const dashboard = read("SRC/modules/work-order-dashboard/work-order-dashboard.js");
const dashboardMarkup = read("SRC/modules/work-order-dashboard/work-order-dashboard.html");
const dashboardStyles = read("SRC/modules/work-order-dashboard/work-order-dashboard.css");
const identityUi = read("Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/DevelopmentIdentityUi.cs");

assert.match(registry, /id: "production"[\s\S]*modulePath: "SRC\/workspaces\/production\/production-workspace\.js"/);
assert.match(registry, /id: "production"[\s\S]*stylePath: "SRC\/workspaces\/production\/production-workspace\.css"/);
assert.match(registry, /id: "production"[\s\S]*requiredPermission: "kitting\.view"/);
assert.match(identityUi, /production:'kitting\.view'/);
assert.match(source, /data-workspace-home=\\?"production/);
assert.match(source, /DleWorkspaces\?\.kitting\?\.loadReadModel/);
assert.match(kitting, /loadReadModel: loadGovernedReadModel/);
assert.match(kitting, /if \(workspaceState\.model\) \{[\s\S]*renderWorkspace\(\);[\s\S]*Governed read model current/);
assert.match(source, /preferredDashboardView: "production"/);
assert.match(source, /returnWorkspaceId: WORKSPACE_ID/);
assert.match(source, /window\.go\("workOrderDashboardModule"\)/);
assert.match(dashboardMarkup, /id="workOrderDashboardReturnToProduction"/);
assert.match(dashboard, /function returnToProductionWorkspace\(\)/);
assert.match(dashboard, /setWorkspaceView\?\.\('production'\)/);
assert.match(dashboard, /moduleRoot\.dataset\.dashboardView = currentView/);
assert.match(dashboard, /status\.hidden = currentView === 'production' && governedSelection/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*\.work-order-dashboard-module-panel[^}]*display:\s*grid/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*\.work-order-dashboard-module-view-selector[^}]*width:\s*190px[^}]*height:\s*44px/);
assert.match(dashboardMarkup, /data-production-summary-hidden="true"[^>]*>[\s\S]*?<strong>Canonical Anchor<\/strong>/);
assert.match(dashboardMarkup, /data-production-summary-hidden="true"[^>]*>[\s\S]*?<strong>Governing Source<\/strong>/);
assert.match(dashboardMarkup, /data-production-summary-hidden="true"[^>]*>[\s\S]*?<strong>Status<\/strong>/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*\.work-order-dashboard-module-title p,[\s\S]*?data-production-summary-hidden="true"[^}]*display:\s*none/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*\.work-order-dashboard-module-summary-grid[^}]*minmax\(100px,\s*\.85fr\)[^}]*minmax\(145px,\s*1\.2fr\)/);
assert.match(dashboardStyles, /min-width:\s*901px[^}]*max-width:\s*1280px[\s\S]*?data-dashboard-view="production"[^}]*minmax\(76px,\s*\.85fr\)[^}]*minmax\(108px,\s*1\.2fr\)[^}]*gap:\s*6px/);
assert.match(dashboardStyles, /max-width:\s*900px[\s\S]*?data-dashboard-view="production"[^}]*minmax\(76px,\s*\.85fr\)[^}]*minmax\(108px,\s*1\.2fr\)[^}]*gap:\s*6px/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*\.work-order-dashboard-module-summary-item[^}]*padding:\s*8px 6px/);
assert.match(dashboardMarkup, /work-order-dashboard-standard-only">Opened From<\/strong>/);
assert.match(dashboardMarkup, /work-order-dashboard-production-only">Sales Order<\/strong>/);
assert.match(dashboardMarkup, /work-order-dashboard-production-only">Rev<\/strong>/);
assert.match(dashboardMarkup, /work-order-dashboard-production-only">WO Qty<\/strong>/);
assert.match(dashboardMarkup, /work-order-dashboard-production-only">Due Date<\/strong>/);
assert.match(dashboardStyles, /data-production-summary-field="work-order"[^}]*order:\s*1/);
assert.match(dashboardStyles, /data-production-summary-field="sales-order"[^}]*order:\s*2/);
assert.match(dashboardStyles, /data-production-summary-field="assembly"[^}]*order:\s*3/);
assert.match(dashboardStyles, /data-production-summary-field="revision"[^}]*order:\s*4/);
assert.match(dashboardStyles, /data-production-summary-field="quantity"[^}]*order:\s*5/);
assert.match(dashboardStyles, /data-production-summary-field="due-date"[^}]*order:\s*6/);
assert.match(dashboardStyles, /data-production-summary-field="material-status"[^}]*order:\s*7/);
assert.match(dashboardMarkup, /id="workOrderDashboardProductionSalesOrder"/);
assert.match(dashboard, /workOrderDashboardProductionSalesOrder'[\s\S]*cleanText\(selectedWorkOrder\.originSalesOrderNumber\)/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*\.work-order-dashboard-standard-only[^}]*display:\s*none/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*\.work-order-dashboard-production-only[^}]*display:\s*block/);

for (const field of ["workOrderNumber", "customerName", "assemblyItemNumber", "revision", "canonicalWorkOrderQuantity", "earliestDueDate"]) {
  assert.match(source, new RegExp(field));
}
assert.match(markup, /data-production-queue="KIT_COMPLETE" aria-pressed="true"/);
assert.match(markup, /data-production-queue="KIT_SHORT" aria-pressed="false"/);
assert.match(markup, /Kit Short \/ Awaiting Parts/);
assert.doesNotMatch(markup, /Needs Kitting/);
assert.match(markup, /type="search"/);
assert.doesNotMatch(markup, /<details|<dialog|modal|accordion|dropdown/i);
assert.doesNotMatch(source, /appendKittingDisposition|submitKitting|fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
assert.match(source, /selectedQueue: "KIT_COMPLETE"/);
assert.match(source, /function selectProductionQueue\(queueKey\)/);
assert.match(source, /class="production-compact-row"/);
assert.match(source, /<small>QTY<\/small>/);
assert.match(source, /<small>DUE<\/small>/);
assert.match(source, /production-compact-arrow/);
assert.doesNotMatch(source, /production-job-table|<table|<tr|<td/);
assert.match(styles, /\.production-workspace\{display:grid;gap:10px;max-width:1460px;margin:0 auto;padding:8px 20px 28px/);
assert.match(styles, /\.production-lifecycle-tabs\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px\}/);
assert.match(styles, /\.production-compact-row\{display:grid;grid-template-columns:minmax\(118px,.7fr\).*minmax\(170px,1fr\) 98px 24px/);
assert.match(styles, /\.production-search-control \.sr-only\{position:absolute;width:1px;height:1px/);
assert.match(styles, /@media\(min-width:1281px\)/);
assert.match(styles, /body\[data-view-mode="desktop"\]\[data-workspace-view="production"\]>main\{padding-inline:clamp\(22px,2vw,32px\)\}/);
assert.match(styles, /body\[data-view-mode="desktop"\]\[data-workspace-view="production"\] \.production-workspace\{width:100%;max-width:none;margin-inline:0;padding-inline:0\}/);
assert.doesNotMatch(shell.slice(shell.indexOf('data-workspace-home="production"'),
  shell.indexOf('data-workspace-home="quality"')), /detail|modal|accordion/i);

const navigation = [];
const context = {
  window: {
    DleWorkspaces: {
      kitting: {
        buildGovernedHandoff(row) {
          return {
            canonicalWorkOrder: row.canonicalWorkOrder,
            workOrderNumber: row.workOrderNumber,
            preferredDashboardView: "kitting",
            preferredPresentation: "kitting-job",
            returnWorkspaceId: "kitting"
          };
        }
      }
    },
    WorkOrderDashboardModule: {
      setSelectedWorkOrder(selection) { navigation.push(["selection", selection]); }
    },
    DleWorkspaceShell: {
      setWorkspaceView(id) { navigation.push(["workspace", id]); }
    },
    go(screenId) { navigation.push(["screen", screenId]); }
  },
  document: {},
  console,
  Map,
  Object,
  Number,
  String
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context);

const production = context.window.DleWorkspaces.production;
assert.equal(production.getSelectedQueue(), "KIT_COMPLETE");
assert.equal(production.selectQueue("KIT_SHORT"), true);
assert.equal(production.getSelectedQueue(), "KIT_SHORT");
assert.equal(production.selectQueue("NOT_A_QUEUE"), false);
assert.equal(production.getSelectedQueue(), "KIT_SHORT");
const complete = {
  queueKey: "WO|1001",
  actionable: true,
  workOrderNumber: "1001",
  customerNumber: "C01",
  customerName: "Alpha Aerospace",
  assemblyItemNumber: "ASM-100",
  revision: "B",
  canonicalWorkOrderQuantity: 20,
  earliestDueDate: "2026-09-01",
  canonicalWorkOrder: { workOrderNumber: "1001" },
  relatedLines: [{ operationalQuantityOpen: 20 }]
};
const short = {
  ...complete,
  queueKey: "WO|1002",
  workOrderNumber: "1002",
  customerNumber: "C02",
  customerName: "Beta Systems",
  assemblyItemNumber: "ASM-200",
  revision: "C",
  canonicalWorkOrder: { workOrderNumber: "1002" }
};
const unrelated = { ...complete, queueKey: "WO|1003", workOrderNumber: "1003" };
const model = {
  queues: {
    kitComplete: [complete],
    kitShort: [short],
    needsKitting: [unrelated],
    kittingInProgress: [unrelated],
    rmaRework: [unrelated]
  }
};

const unfiltered = production.buildViewModel(model);
assert.deepEqual(Array.from(unfiltered.kitComplete, row => row.workOrderNumber), ["1001"]);
assert.deepEqual(Array.from(unfiltered.kitShort, row => row.workOrderNumber), ["1002"]);
assert.equal(unfiltered.kitComplete.some(row => row.workOrderNumber === "1003"), false);
assert.equal(unfiltered.kitShort.some(row => row.workOrderNumber === "1003"), false);

assert.deepEqual(Array.from(production.buildViewModel(model, "1001").kitComplete, row => row.workOrderNumber), ["1001"]);
assert.equal(production.buildViewModel(model, "1001").kitShort.length, 0);
assert.deepEqual(Array.from(production.buildViewModel(model, "beta").kitShort, row => row.workOrderNumber), ["1002"]);
assert.deepEqual(Array.from(production.buildViewModel(model, "asm-100").kitComplete, row => row.workOrderNumber), ["1001"]);
assert.deepEqual(Array.from(production.buildViewModel(model, "revision-that-does-not-exist").kitComplete), []);

assert.equal(production.openWorkOrder(complete), true);
assert.equal(navigation[0][0], "selection");
assert.equal(navigation[0][1].workOrderNumber, "1001");
assert.equal(navigation[0][1].preferredDashboardView, "production");
assert.equal(navigation[0][1].preferredPresentation, "dashboard");
assert.equal(navigation[0][1].sourceWorkspaceId, "production");
assert.equal(navigation[0][1].returnWorkspaceId, "production");
assert.deepEqual(navigation.slice(1), [["workspace", "production"], ["screen", "workOrderDashboardModule"]]);
assert.equal(production.openWorkOrder({ ...complete, actionable: false }), false);

console.log("Production Workspace queue, search, navigation, and preservation contracts: PASS");

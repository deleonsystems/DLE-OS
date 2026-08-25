import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const source = read("SRC/modules/invoice-history/invoice-history.js");
const markup = read("SRC/modules/invoice-history/invoice-history.html");
const styles = read("SRC/modules/invoice-history/invoice-history.css");
const registry = read("SRC/shell/workspace-registry.js");
const workspaceShell = read("SRC/shell/workspace-shell.js");
const operations = read("SRC/modules/operations-center/operations-center.js");
const developmentProxy = read("Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/DevelopmentCompatibilityProxy.cs");
const controlHost = read("Tools/LiveSnapshotRefresh/ControlHost/Program.cs");

assert.match(registry, /id: "invoice-history",\s+label: "Invoice History"/);
assert.match(registry, /modulePath: "SRC\/modules\/invoice-history\/invoice-history\.js"/);
assert.match(workspaceShell, /ensureWorkspaceAssets/);
assert.match(workspaceShell, /data-workspace-mount/);
assert.match(source, /'Invoiced Date'/);
assert.doesNotMatch(markup, />\s*Revision\s*</);
for (const field of ["customerName","salesOrderNumber","salesOrderLineNumber","workOrderNumber","itemNumber","itemDescription","quantityShipped","invoiceNumber","invoiceDate","extendedPrice"]) assert.match(source,new RegExp(field));
assert.match(source, /monthly\[date\.getUTCMonth\(\)\] \+= number\(row\.extendedPrice\)/);
assert.match(source, /rowSearchText\(row\)\.includes\(query\)/);
assert.match(source, /getInvoiceHistoryRefreshStatus/);
assert.match(source, /runInvoiceHistoryRefresh/);
assert.match(developmentProxy, /MapOperational\(app, runtime, operational, "\/api\/platform\/refresh\/invoice-history\/v1\/\{\*\*path\}"\)/);
assert.match(developmentProxy, /platform\/refresh\/invoice-history\/v1\/[\s\S]{0,180}return "sync\.operations"/);
assert.match(controlHost, /"\/api\/platform\/refresh\/invoice-history\/v1\/"/);
assert.match(controlHost, /\/api\/platform\/refresh\/invoice-history\/v1\/status[\s\S]{0,300}RequireAuthorization\("SnapshotRefreshOperator"\)/);
assert.match(source, /await loadRows\(\)/);
assert.match(source, /syncStartedHere && !syncCompletionHandled/);
assert.match(source, /catch \(error\) \{ renderSyncError\(error\); syncStartedHere = false; \}/);
assert.doesNotMatch(source, /operations-center\.js|OperationsCenter/);
assert.match(styles, /position: sticky/);
assert.match(styles, /tbody tr:nth-child\(odd\)/);
assert.match(styles, /tbody tr:hover/);
assert.match(styles, /max-width: 1800px/);
assert.match(styles, /@media \(max-width:720px\)/);
assert.ok(operations.includes("refreshOperationsCenterCanonicalData"));

const elements = new Map();
function element(id) { const item={id,textContent:"",innerHTML:"",value:"",disabled:false,className:"",setAttribute(){},addEventListener(){}}; elements.set(id,item); return item; }
for (const id of ["invoiceHistorySearch","invoiceHistoryTable","invoiceHistoryStatus","invoiceHistoryMonthTotal","invoiceHistoryYearTotal","invoiceHistoryMonthlyTotals","invoiceHistorySyncButton","invoiceHistorySyncStatus","invoiceHistoryLastSync"]) element(id);
const rows=[
  {customerNumber:"001",customerName:"Alpha",salesOrderNumber:"100",salesOrderLineNumber:"001",workOrderNumber:"200",itemNumber:"PART-A",invoiceNumber:"300",itemDescription:"Widget",invoiceDate:"2026-08-01",quantityShipped:"2",extendedPrice:"125.50"},
  {customerNumber:"002",customerName:"Beta",salesOrderNumber:"101",salesOrderLineNumber:"002",workOrderNumber:"201",itemNumber:"PART-B",invoiceNumber:"301",itemDescription:"Credit",invoiceDate:"2026-08-02",quantityShipped:"-1",extendedPrice:"-25.50"}
];
let listCalls=0;
const context={window:{DleApiClient:{liveCanonical:{async getCanonicalInvoiceHistory(){listCalls++;return{items:rows,totalPages:1};},async getInvoiceHistoryRefreshStatus(){return{status:"FAILED"};},async runInvoiceHistoryRefresh(){return{status:"RUNNING"};}}},setTimeout,clearTimeout},document:{getElementById:id=>elements.get(id)||null,querySelector:()=>null},console,setTimeout,clearTimeout,Intl,Date};
context.window.window=context.window;
vm.createContext(context);
vm.runInContext(source,context);
const workspace=context.window.InvoiceHistoryWorkspace;
const summary=workspace.test.summarizeRows(rows,new Date("2026-08-24T12:00:00Z"));
assert.equal(summary.currentMonth,100);
assert.equal(summary.year,100);
assert.equal(summary.monthly[7],100);
workspace.state.rows=rows;
elements.get("invoiceHistorySearch").value="credit";
workspace.applySearch();
assert.equal(workspace.state.filteredRows.length,1);
await workspace.reload();
assert.equal(listCalls,1);

const operationsHash = Buffer.from(operations).toString("base64");
assert.equal(Buffer.from(read("SRC/modules/operations-center/operations-center.js")).toString("base64"),operationsHash);
assert.doesNotMatch(read("Tools/LiveSnapshotRefresh/Invoke-LiveSnapshotRefresh.ps1"),/InvoiceHistory|CustomerInvoice/i);

console.log("INVOICE-HISTORY-WORKSPACE-001: PASS");

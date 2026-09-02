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
const operatorHeader = read("SRC/shell/operator-header.js");
const operatorHeaderStyles = read("SRC/shell/operator-header.css");
const workAreaHome = read("SRC/home/work-area-home.js");
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
assert.match(markup, />Reload Invoice History</);
assert.match(markup, />Refresh service status</);
assert.match(markup, /Existing committed Invoice History remains available/);
assert.doesNotMatch(markup, /ControlHost|5054|Start-InvoiceHistoryRefresh|DLE-OS-HOST\\DLE-OS/);
assert.match(source, /Refresh service temporarily unavailable; committed Invoice History remains available/);
assert.match(source, /INVOICE_HISTORY_EXECUTION_DISABLED/);
assert.match(source, /Last successful committed refresh/);
assert.match(markup, /id="invoiceHistoryAllYearFilter"[^>]+data-invoice-history-month="all"[^>]+aria-pressed="false"/);
assert.match(markup, /id="invoiceHistorySelectedPeriodLabel">Selected Month Invoiced/);
assert.match(source, /class="invoice-history-month-button"[^>]+data-invoice-history-month/);
assert.match(source, /aria-pressed/);
assert.match(source, /aria-label="Show /);
assert.match(styles, /invoice-history-month-button:focus-visible/);
assert.match(styles, /invoice-history-month-button\[aria-pressed="true"\]/);
assert.match(developmentProxy, /new Uri\(runtime\.GovernedRefreshApiBaseUrl\)/);
assert.match(developmentProxy, /governedRefresh,[\s\S]{0,120}"\/api\/platform\/refresh\/invoice-history\/v1\/status", \[HttpMethods\.Get\]/);
assert.match(developmentProxy, /governedRefresh,[\s\S]{0,120}"\/api\/platform\/refresh\/invoice-history\/v1\/run", \[HttpMethods\.Post\]/);
assert.doesNotMatch(developmentProxy, /invoice-history\/v1\/\{\*\*path\}/);
assert.match(developmentProxy, /platform\/refresh\/invoice-history\/v1\/[\s\S]{0,180}return "sync\.operations"/);
assert.match(controlHost, /"\/api\/platform\/refresh\/invoice-history\/v1\/"/);
assert.match(controlHost, /\/api\/platform\/refresh\/invoice-history\/v1\/status[\s\S]{0,300}RequireAuthorization\("SnapshotRefreshOperator"\)/);
assert.match(source, /await loadRows\(\)/);
assert.match(source, /syncStartedHere && !syncCompletionHandled/);
assert.match(source, /catch \(error\) \{ isSyncServiceUnavailable\(error\) \? renderManualSyncMode\(\) : renderSyncError\(error\); syncStartedHere = false; \}/);
assert.doesNotMatch(source, /operations-center\.js|OperationsCenter/);
assert.match(styles, /position: sticky/);
assert.match(styles, /tbody tr:nth-child\(odd\)/);
assert.match(styles, /tbody tr:hover/);
assert.match(styles, /max-width: 1800px/);
assert.match(styles, /@media \(max-width:720px\)/);
assert.match(operatorHeader, /const invoiceHistoryActive = workspaceId === 'invoice-history'/);
assert.match(operatorHeader, /!operationsCenterActive && !invoiceHistoryActive/);
assert.match(operatorHeaderStyles, /:not\(\[data-workspace-view="invoice-history"\]\)/);
assert.match(workAreaHome, /new Set\(\["operations-center", "invoice-history"\]\)/);
assert.match(workAreaHome, /MOBILE_READY_WORKSPACE_IDS\.has\(workspace\.id\)/);
assert.match(source, /data-label=/);
assert.match(styles, /body\[data-view-mode="mobile"\]\[data-workspace-view="invoice-history"\] > main/);
assert.match(styles, /safe-area-inset-left/);
assert.match(styles, /invoice-history-toolbar \{ position: sticky/);
assert.match(styles, /invoice-history-search input \{ min-height: 44px; font-size: 16px/);
assert.match(styles, /invoice-history-table-wrap \{ max-height: none; overflow: visible/);
assert.match(styles, /invoice-history-table tr \{ display: grid; grid-template-columns: minmax\(0,1fr\) minmax\(0,1fr\); width: 100%; box-sizing: border-box/);
assert.match(styles, /content: attr\(data-label\)/);
assert.match(styles, /invoice-history-table td:nth-child\(10\) \{ color: #a7f3d0/);
assert.match(source, /data-invoice-history-row-toggle aria-expanded="false"/);
assert.match(source, /function toggleMobileRow\(control\)/);
assert.match(styles, /invoice-history-mobile-row-toggle \{ width: 100%; min-height: 62px; display: grid/);
assert.match(styles, /tr\[data-mobile-expanded="true"\] td \{ display: grid/);
assert.match(styles, /invoice-history-mobile-row-toggle\[aria-expanded="true"\]/);
assert.ok(operations.includes("refreshOperationsCenterCanonicalData"));

const mobileNavigation=[];
const mobileHomeContext={
  window:{
    DleWorkspaceRegistry:{getById(id){return{id,home:{screenId:"home"}};}},
    setWorkspaceView(id){mobileNavigation.push(["workspace",id]);},
    go(screen,pushHistory){mobileNavigation.push(["screen",screen,pushHistory]);},
    scrollTo(value){mobileNavigation.push(["scroll",value.top,value.behavior]);}
  },
  document:{addEventListener(){},createElement(){return{textContent:"",innerHTML:""};}},
  Date,Set,console
};
mobileHomeContext.window.window=mobileHomeContext.window;
vm.createContext(mobileHomeContext);
vm.runInContext(workAreaHome,mobileHomeContext);
mobileHomeContext.window.DleWorkAreaHome.enter("invoice-history");
assert.deepEqual(mobileNavigation,[["workspace","invoice-history"],["screen","home",false],["scroll",0,"auto"]]);

const elements = new Map();
function element(id) { const attributes={}; const item={id,textContent:"",innerHTML:"",value:"",disabled:false,hidden:false,className:"",setAttribute(name,value){attributes[name]=String(value);},getAttribute(name){return attributes[name];},addEventListener(){}}; elements.set(id,item); return item; }
for (const id of ["invoiceHistorySearch","invoiceHistoryTable","invoiceHistoryStatus","invoiceHistoryTableTitle","invoiceHistorySelectedPeriodLabel","invoiceHistoryMonthTotal","invoiceHistoryYearTotal","invoiceHistoryMonthlyTotals","invoiceHistoryAllYearFilter","invoiceHistorySyncButton","invoiceHistoryReloadButton","invoiceHistorySyncStatus","invoiceHistoryLastAttempt","invoiceHistoryLastSync","invoiceHistoryRefreshWindow","invoiceHistoryRefreshChanges","invoiceHistoryRefreshIdentity","invoiceHistoryManualSync"]) element(id);
const rows=[
  {customerNumber:"001",customerName:"Alpha",salesOrderNumber:"100",salesOrderLineNumber:"001",workOrderNumber:"200",itemNumber:"PART-A",invoiceNumber:"300",itemDescription:"January Widget",invoiceDate:"2026-01-15",quantityShipped:"1",extendedPrice:"50.00",activatedAtUtc:"2026-08-24T23:51:11Z",invoiceHistoryImportRunId:"IMPORT-1",sourceExtractionRunId:"REFRESH-1"},
  {customerNumber:"003",customerName:"Meggitt",salesOrderNumber:"102",salesOrderLineNumber:"001",workOrderNumber:"202",itemNumber:"PART-C",invoiceNumber:"302",itemDescription:"July Assembly",invoiceDate:"2026-07-10",quantityShipped:"1",extendedPrice:"75.00",activatedAtUtc:"2026-08-24T23:51:11Z",invoiceHistoryImportRunId:"IMPORT-1",sourceExtractionRunId:"REFRESH-1"},
  {customerNumber:"004",customerName:"Meggitt",salesOrderNumber:"103",salesOrderLineNumber:"001",workOrderNumber:"203",itemNumber:"PART-D",invoiceNumber:"303",itemDescription:"August Widget",invoiceDate:"2026-08-01",quantityShipped:"2",extendedPrice:"125.50",activatedAtUtc:"2026-08-24T23:51:11Z",invoiceHistoryImportRunId:"IMPORT-1",sourceExtractionRunId:"REFRESH-1"},
  {customerNumber:"002",customerName:"Beta",salesOrderNumber:"101",salesOrderLineNumber:"002",workOrderNumber:"201",itemNumber:"PART-B",invoiceNumber:"301",itemDescription:"Credit",invoiceDate:"2026-08-02",quantityShipped:"-1",extendedPrice:"-25.50",activatedAtUtc:"2026-08-24T23:51:11Z",invoiceHistoryImportRunId:"IMPORT-1",sourceExtractionRunId:"REFRESH-1"}
];
let listCalls=0;
let statusCalls=0;
let syncCalls=0;
let openRowControls=[];
let contextualNavigationRequest=null;
let statusBehavior=()=>({status:"SUCCESS",message:"Refresh completed",startedAtUtc:"2026-08-24T23:50:58Z",updatedAtUtc:"2026-08-24T23:51:11Z",windowStart:"2026-07-11",windowEnd:"2026-08-24",refreshRunId:"REFRESH-1",details:{Import:{InvoiceHistoryImportRunId:"IMPORT-1",ExpectedCounts:{LineInsert:3,LineUpdate:4,LineUnchanged:5,LineMissing:6}}}});
const context={window:{DleApiClient:{liveCanonical:{async getCanonicalInvoiceHistory(){listCalls++;return{items:rows,totalPages:1};},async getInvoiceHistoryRefreshStatus(){statusCalls++;return statusBehavior();},async runInvoiceHistoryRefresh(){syncCalls++;return{status:"RUNNING"};}}},DleWorkspaceShell:{navigate(request){contextualNavigationRequest=request;return{id:request.workspaceId};}},setTimeout,clearTimeout},document:{getElementById:id=>elements.get(id)||null,querySelector:()=>null,querySelectorAll:()=>openRowControls},console,setTimeout,clearTimeout,Intl,Date};
context.window.window=context.window;
vm.createContext(context);
vm.runInContext(source,context);
const workspace=context.window.InvoiceHistoryWorkspace;
const summary=workspace.test.summarizeRows(rows,new Date("2026-08-24T12:00:00Z"));
assert.equal(summary.currentMonth,100);
assert.equal(summary.year,225);
assert.equal(summary.monthly[7],100);
assert.equal(workspace.test.defaultSelectedMonth(new Date("2026-08-24T12:00:00Z")),7);
assert.equal(workspace.test.defaultSelectedMonth(new Date("2027-01-01T12:00:00Z")),null);
function mobileToggle(){
  const row={dataset:{mobileExpanded:"false"}};
  const attributes={"aria-expanded":"false"};
  return{row,getAttribute(name){return attributes[name];},setAttribute(name,value){attributes[name]=String(value);},closest(selector){return selector==="tr"?row:null;}};
}
const firstToggle=mobileToggle();
const secondToggle=mobileToggle();
openRowControls=[firstToggle,secondToggle];
assert.equal(workspace.test.toggleMobileRow(firstToggle),true);
assert.equal(firstToggle.getAttribute("aria-expanded"),"true");
assert.equal(firstToggle.row.dataset.mobileExpanded,"true");
assert.equal(workspace.test.toggleMobileRow(secondToggle),true);
assert.equal(firstToggle.getAttribute("aria-expanded"),"false","Opening another row collapses the first");
assert.equal(firstToggle.row.dataset.mobileExpanded,"false");
assert.equal(secondToggle.getAttribute("aria-expanded"),"true");
assert.equal(workspace.test.toggleMobileRow(secondToggle),false);
assert.equal(secondToggle.row.dataset.mobileExpanded,"false");
workspace.state.rows=rows;
workspace.state.selectedMonth=workspace.test.defaultSelectedMonth(new Date("2026-08-24T12:00:00Z"));
elements.get("invoiceHistorySearch").value="";
workspace.applySearch();
assert.equal(workspace.state.selectedMonth,7,"The current month is the default selection");
assert.equal(workspace.state.filteredRows.length,2);
assert.equal(elements.get("invoiceHistoryTableTitle").textContent,"August 2026 Invoice History — 2 lines");

for(let month=0;month<12;month++){
  workspace.selectMonth(month);
  assert.equal(workspace.state.selectedMonth,month);
  assert.equal(workspace.state.filteredRows.length,rows.filter(row=>new Date(row.invoiceDate+"T00:00:00Z").getUTCMonth()===month).length);
}
workspace.selectMonth(6);
assert.equal(workspace.state.filteredRows.length,1);
assert.equal(elements.get("invoiceHistorySelectedPeriodLabel").textContent,"July 2026 Invoiced");
assert.equal(elements.get("invoiceHistoryMonthTotal").textContent,"$75.00");
workspace.selectMonth(7);
assert.equal(workspace.state.filteredRows.length,2,"Selecting August replaces July");
assert.equal(elements.get("invoiceHistoryTableTitle").textContent,"August 2026 Invoice History — 2 lines");
assert.equal(elements.get("invoiceHistoryAllYearFilter").getAttribute("aria-pressed"),"false");
assert.match(elements.get("invoiceHistoryMonthlyTotals").innerHTML,/data-invoice-history-month="7" aria-pressed="true"/);
assert.equal(elements.get("invoiceHistoryMonthTotal").textContent,"$100.00");
assert.equal(elements.get("invoiceHistoryYearTotal").textContent,"$225.00","Selection does not alter signed YTD total");

elements.get("invoiceHistorySearch").value="meggitt";
workspace.applySearch();
assert.equal(workspace.state.filteredRows.length,1,"Month and broad search compose");
assert.equal(elements.get("invoiceHistoryTableTitle").textContent,"August 2026 Invoice History — 1 line");
elements.get("invoiceHistorySearch").value="";
workspace.applySearch();
assert.equal(workspace.state.selectedMonth,7);
assert.equal(workspace.state.filteredRows.length,2,"Clearing search preserves August");

workspace.selectMonth(null);
assert.equal(workspace.state.filteredRows.length,4,"All 2026 restores the full year");
assert.equal(elements.get("invoiceHistoryAllYearFilter").getAttribute("aria-pressed"),"true");
assert.equal(elements.get("invoiceHistorySelectedPeriodLabel").textContent,"All 2026 Invoiced");
assert.equal(elements.get("invoiceHistoryMonthTotal").textContent,"$225.00");

workspace.selectMonth(7);
elements.get("invoiceHistorySearch").value="meggitt";
workspace.applySearch();
workspace.test.navigateToProjection();
assert.equal(JSON.stringify(contextualNavigationRequest),JSON.stringify({workspaceId:"operations-center",viewMode:"mobile",requestedState:{mode:"projection"}}));
assert.equal(workspace.state.selectedMonth,7,"Contextual navigation preserves the selected month");
assert.equal(elements.get("invoiceHistorySearch").value,"meggitt","Contextual navigation preserves search text");
await workspace.reload();
assert.equal(listCalls,1);
assert.equal(statusCalls,1);
assert.equal(syncCalls,0,"Reload must not invoke a refresh");
assert.equal(workspace.state.selectedMonth,7,"Reload preserves the month selection");
assert.equal(elements.get("invoiceHistorySearch").value,"meggitt","Reload preserves search text");
assert.equal(workspace.state.filteredRows.length,1);
assert.equal(elements.get("invoiceHistorySyncButton").hidden,false);
assert.equal(elements.get("invoiceHistoryManualSync").hidden,true);
assert.match(elements.get("invoiceHistoryLastAttempt").textContent,/Successful/);
assert.match(elements.get("invoiceHistoryRefreshWindow").textContent,/2026-07-11 through 2026-08-24/);
assert.match(elements.get("invoiceHistoryRefreshChanges").textContent,/Inserted: 3 · Updated: 4 · Unchanged: 5 · Missing \/ retained: 6/);
assert.match(elements.get("invoiceHistoryRefreshIdentity").textContent,/REFRESH-1.*IMPORT-1/);

statusBehavior=()=>({status:"FAILED",message:"Old attempt failed",startedAtUtc:"2026-08-18T10:00:00Z",refreshRunId:"OLD-FAILED-ATTEMPT"});
await workspace.test.loadSyncStatus();
assert.match(elements.get("invoiceHistoryLastAttempt").textContent,/Failed/);
assert.match(elements.get("invoiceHistoryRefreshIdentity").textContent,/REFRESH-1.*IMPORT-1/);
assert.doesNotMatch(elements.get("invoiceHistoryRefreshIdentity").textContent,/OLD-FAILED-ATTEMPT/);

statusBehavior=()=>{ const error=new Error("downstream unavailable"); error.status=503; throw error; };
await workspace.test.loadSyncStatus();
assert.equal(elements.get("invoiceHistorySyncButton").hidden,true);
assert.equal(elements.get("invoiceHistoryManualSync").hidden,false);
assert.equal(elements.get("invoiceHistorySyncStatus").textContent,"Refresh service temporarily unavailable; committed Invoice History remains available");
assert.match(elements.get("invoiceHistoryLastAttempt").textContent,/unavailable while the governed refresh service is offline/);
assert.match(elements.get("invoiceHistoryLastSync").textContent,/2026/);
assert.match(elements.get("invoiceHistoryRefreshIdentity").textContent,/REFRESH-1.*IMPORT-1/);
assert.equal(elements.get("invoiceHistoryRefreshWindow").hidden,true);
assert.equal(elements.get("invoiceHistoryRefreshChanges").hidden,true);

const operationsHash = Buffer.from(operations).toString("base64");
assert.equal(Buffer.from(read("SRC/modules/operations-center/operations-center.js")).toString("base64"),operationsHash);
assert.doesNotMatch(read("Tools/LiveSnapshotRefresh/Invoke-LiveSnapshotRefresh.ps1"),/InvoiceHistory|CustomerInvoice/i);

console.log("INVOICE-HISTORY-WORKSPACE-001: PASS");

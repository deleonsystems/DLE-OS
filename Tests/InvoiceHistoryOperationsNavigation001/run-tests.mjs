import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = path => fs.readFileSync(path,"utf8");
const shellSource = read("SRC/shell/workspace-shell.js");
const invoiceSource = read("SRC/modules/invoice-history/invoice-history.js");
const invoiceMarkup = read("SRC/modules/invoice-history/invoice-history.html");
const invoiceStyles = read("SRC/modules/invoice-history/invoice-history.css");
const operationsSource = read("SRC/modules/operations-center/operations-center.js");
const operationsMarkup = read("SRC/modules/operations-center/operations-center.html");
const operationsStyles = read("SRC/modules/operations-center/operations-center.css");

assert.match(invoiceMarkup,/data-invoice-history-action="view-projection"[^>]*>View Projection</);
assert.match(invoiceSource,/workspaceId:"operations-center"[\s\S]*viewMode:"mobile"[\s\S]*requestedState:\{ mode:"projection" \}/);
assert.doesNotMatch(invoiceSource,/operations-center\.js|OperationsCenter/);
assert.match(invoiceStyles,/data-workspace-view="invoice-history"[\s\S]*invoice-history-projection-link \{ width: 100%; min-height: 44px; display: block/);

assert.doesNotMatch(operationsMarkup,/operationsCenterMobileProjectionContext|navigateOperationsCenterToInvoiceHistory|>Invoice History</);
assert.match(operationsSource,/requestedState\?\.mode !== 'projection'/);
assert.match(operationsSource,/projection\.setActive\(true\)/);
assert.doesNotMatch(operationsSource,/navigateOperationsCenterToInvoiceHistory|workspaceId:'invoice-history'/);
assert.doesNotMatch(operationsSource,/invoice-history\.js|InvoiceHistoryWorkspace/);
assert.doesNotMatch(operationsStyles,/operations-center-mobile-projection-context/);
assert.match(operationsMarkup,/id="operationsCenterProjectionToggle"[\s\S]*toggleOperationsCenterProjectionMode\(\)/);

assert.match(shellSource,/function navigate\(request, addToHistory = true\)/);
assert.match(shellSource,/new CustomEvent\("dle:workspace-navigation"/);
assert.match(shellSource,/function navigateBack\(\)/);

const definitions={
  "dle-home":{id:"dle-home",label:"Home"},
  "invoice-history":{id:"invoice-history",label:"Invoice History",home:{screenId:"home"}},
  "operations-center":{id:"operations-center",label:"Operations Center",home:{screenId:"operationsCenter"}}
};
const panels=Object.values(definitions).map(workspace=>({dataset:{workspaceHome:workspace.id},classList:{toggle(){}}}));
let activeScreen="home";
let selectedViewMode="desktop";
const dispatched=[];
const listeners={};
const backButton={disabled:true};
class CustomEvent { constructor(type,options={}){this.type=type;this.detail=options.detail;} }
const shellWindow={
  DleWorkspaceRegistry:{defaultWorkspaceId:"dle-home",resolve(value){return definitions[value]||definitions["dle-home"];},getById(value){return definitions[value]||null;}},
  DleOperatorHeader:{setViewMode(mode){selectedViewMode=mode;}},
  DleWorkspaces:{},
  go(screen){activeScreen=screen;},
  updateBackButton(){backButton.disabled=true;}
};
const shellDocument={
  body:{dataset:{}},
  addEventListener(type,handler){listeners[type]=handler;},
  dispatchEvent(event){dispatched.push(event);},
  getElementById(){return null;},
  querySelector(selector){
    if(selector===".screen.active")return{id:activeScreen};
    if(selector===".back-btn")return backButton;
    const match=/^\[data-workspace-home="(.+)"\]$/.exec(selector);
    return match?panels.find(panel=>panel.dataset.workspaceHome===match[1])||null:null;
  },
  querySelectorAll(selector){return selector==="[data-workspace-home]"?panels:[];}
};
shellWindow.window=shellWindow;
vm.runInNewContext(shellSource,{window:shellWindow,document:shellDocument,CustomEvent,Object,Array,Promise,console});
shellWindow.DleWorkspaceShell.init();
shellWindow.DleWorkspaceShell.setWorkspaceView("invoice-history");
shellWindow.DleWorkspaceShell.navigate({workspaceId:"operations-center",viewMode:"mobile",requestedState:{mode:"projection"}});
assert.equal(shellWindow.DleWorkspaceShell.getCurrentWorkspace().id,"operations-center");
assert.equal(activeScreen,"operationsCenter");
assert.equal(selectedViewMode,"mobile");
assert.equal(dispatched.at(-1).type,"dle:workspace-navigation");
assert.equal(dispatched.at(-1).detail.requestedState.mode,"projection");
assert.equal(shellWindow.DleWorkspaceShell.canNavigateBack(),true);
assert.equal(backButton.disabled,false);

shellWindow.DleWorkspaceShell.navigate({workspaceId:"invoice-history",viewMode:"mobile"});
assert.equal(shellWindow.DleWorkspaceShell.getCurrentWorkspace().id,"invoice-history");
assert.equal(activeScreen,"home");
assert.equal(shellWindow.DleWorkspaceShell.navigateBack().id,"operations-center");
assert.equal(activeScreen,"operationsCenter");
assert.equal(shellWindow.DleWorkspaceShell.navigateBack().id,"invoice-history");
assert.equal(activeScreen,"home");

shellWindow.DleWorkspaceShell.navigate({workspaceId:"operations-center",viewMode:"mobile",requestedState:{mode:"projection"}});
let prevented=false;
listeners.click({target:{closest(selector){return selector===".back-btn"?backButton:null;}},preventDefault(){prevented=true;},stopImmediatePropagation(){}});
assert.equal(prevented,true);
assert.equal(shellWindow.DleWorkspaceShell.getCurrentWorkspace().id,"invoice-history");

let projectionActive=false;
let tableRenders=0;
const selectedProjectionJobs={"MASTER-1":true};
const operationsListeners={};
const operationElements={
  operationsCenterMobileView:{hidden:true},
  operationsCenterTable:{hidden:false},
  operationsCenterMobileResults:{innerHTML:""},
  operationsCenterMobileDetail:{hidden:false,innerHTML:""}
};
const operationsWindow={
  OperationsCenter:{
    projection:{state:{selectedByKey:selectedProjectionJobs},isActive(){return projectionActive;},setActive(value){projectionActive=!!value;},toggleActive(){projectionActive=!projectionActive;}},
    table:{renderModule(){tableRenders++;}},
    state:{hideRmaRework:false},
    viewModel:{parseSearchTerms(){return[];},getOperationsCenterView(){return{records:[]};},getWorkOrderGroups(){return[];}}
  },
  setTimeout,clearTimeout
};
operationsWindow.window=operationsWindow;
const operationsDocument={
  getElementById(id){return operationElements[id]||null;},
  addEventListener(type,handler){operationsListeners[type]=handler;},
  querySelector(){return null;}
};
vm.runInNewContext(operationsSource,{window:operationsWindow,document:operationsDocument,console,setTimeout,clearTimeout});
assert.equal(operationsWindow.OperationsCenter.applyWorkspaceNavigation({detail:{workspace:{id:"operations-center"},viewMode:"mobile",requestedState:{mode:"projection"}}}),true);
assert.equal(projectionActive,true);
assert.equal(operationElements.operationsCenterMobileView.hidden,false);
assert.ok(tableRenders>0);
assert.equal(selectedProjectionJobs["MASTER-1"],true,"Projection selections survive mode activation");
assert.equal(operationsWindow.OperationsCenter.applyWorkspaceNavigation({detail:{workspace:{id:"operations-center"},viewMode:"mobile",requestedState:null}}),false);
assert.equal(projectionActive,true,"Normal navigation does not change the existing projection state");

console.log("INVOICE-HISTORY-OPERATIONS-NAVIGATION-001: PASS");

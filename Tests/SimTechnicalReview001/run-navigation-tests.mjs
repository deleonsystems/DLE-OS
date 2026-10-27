import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.js','utf8');
const block=src.slice(src.indexOf('  function canReturnToQueue()'),src.indexOf('  function renderOriginalCustomerRequest('));
const elements=Object.fromEntries(['technicalReviewQueueView','technicalReviewDetailView','technicalReviewLibraryView','technicalReviewQueueTitle','technicalReviewLibraryTitle'].map(id=>[id,{hidden:false,focus(){}}]));
let alerts=[],inputs=[],progress=[],flags={};
const saved={intakeId:'TEST',technicalReview:{candidateBom:{rows:[]}},drawingFolders:[{rootId:'test',relativePath:'assembly/rev'}]};
const c={state:{selected:{record:saved}},drawingFolderBrowser:null,reviewUploads:[],identityChanges:{},analysisPoll:null,analysisClock:null,clearTimeout(){},clearInterval(){},mount:{classList:{remove(){}},querySelectorAll(){return inputs;}},window:{DleOsRuntimeConfig:{environment:'SIM'},alert(m){alerts.push(m);},DleWorkspaceShell:{refreshBackButton(){}}},document:{getElementById(id){return elements[id];}},candidateProgressRows:()=>progress,rowReviewUi:r=>r,pendingReferenceSelection:()=>flags.reference,pendingPackageValues:()=>flags.package,pendingSubmissionEdits:()=>flags.submission,setStatus(){}};
vm.createContext(c);vm.runInContext(block,c);
const before=JSON.stringify(saved);
assert.equal(c.canReturnToQueue(),true);
for(const mutate of [()=>c.state.saving=true,()=>c.drawingFolderBrowser={busy:true},()=>c.drawingFolderBrowser={mode:'change',listing:{}},()=>c.state.scanSheetDirty=true,()=>progress=[{}],()=>c.reviewUploads=[{}],()=>c.identityChanges={x:1},()=>flags.reference=true,()=>flags.package=true,()=>inputs=[{tagName:'INPUT',type:'text',value:'new',defaultValue:'old'}]]){
 c.state={selected:{record:saved}};c.drawingFolderBrowser=null;c.reviewUploads=[];c.identityChanges={};progress=[];flags={};inputs=[];mutate();
 assert.equal(c.returnToQueue(),false);assert.equal(c.state.selected.record,saved);
}
c.state={selected:{record:saved}};c.drawingFolderBrowser=null;inputs=[{tagName:'SELECT',selectedIndex:0,options:[{selected:true,defaultSelected:false}]}];
assert.equal(c.returnToQueue(),true);assert.equal(elements.technicalReviewQueueView.hidden,false);assert.equal(c.state.selected,null);assert.equal(JSON.stringify(saved),before);
c.openAssemblyLibrary();assert.equal(elements.technicalReviewLibraryView.hidden,false);assert.equal(elements.technicalReviewQueueView.hidden,true);assert.equal(c.canReturnToQueue(),true);
assert.equal(c.returnToQueue(),true);assert.equal(elements.technicalReviewLibraryView.hidden,true);
c.window.DleOsRuntimeConfig.environment='DEV';c.openAssemblyLibrary();assert.equal(c.state.assemblyLibrary,false);c.state.selected={record:saved};assert.equal(c.canReturnToQueue(),false);
const shell=fs.readFileSync('SRC/shell/workspace-shell.js','utf8');
const harness=fs.readFileSync('Tests/InvoiceHistoryOperationsNavigation001/run-tests.mjs','utf8');
const start=harness.indexOf('const definitions=');const end=harness.indexOf('let projectionActive=false;');
let setup=harness.slice(start,end).replace('const definitions={','const definitions={"technical-review":{id:"technical-review",label:"Technical Review",home:{screenId:"home"}},');
vm.runInNewContext(setup+`
let local=true,blocked=true,calls=0;
shellWindow.DleOsRuntimeConfig={environment:'SIM'};
shellWindow.DleWorkspaces['technical-review']={canReturnToQueue:()=>local,returnToQueue(){calls++;if(blocked)return false;local=false;return true;}};
shellWindow.DleWorkspaceShell.navigate({workspaceId:'technical-review'});
assert.equal(backButton.disabled,false);
assert.equal(shellWindow.DleWorkspaceShell.navigateBack(),false);
assert.equal(shellWindow.DleWorkspaceShell.getCurrentWorkspace().id,'technical-review');
blocked=false;assert.equal(shellWindow.DleWorkspaceShell.navigateBack(),true);
assert.equal(shellWindow.DleWorkspaceShell.getCurrentWorkspace().id,'technical-review');
assert.equal(calls,2);
assert.equal(shellWindow.DleWorkspaceShell.navigateBack().id,'invoice-history');
`,{shellSource:shell,vm,assert,console});
console.log('PASS: SIM Back routes to queue, pending edits retained, library navigation, default selects, legacy shell history');

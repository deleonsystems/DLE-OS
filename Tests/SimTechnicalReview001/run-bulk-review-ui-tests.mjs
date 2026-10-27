import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const sourcePath=process.argv[2]||new URL('../../SRC/workspaces/technical-review/technical-review-workspace.js',import.meta.url);
const source=fs.readFileSync(sourcePath,'utf8').replace('  window.DleWorkspaces = window.DleWorkspaces || {};',
  `  window.test={state,candidateBulkEnabled,candidateBulkState,candidateBulkPendingIssue,candidateBulkControls,candidateBulkToolbar,manualRow,selectCandidateRows,reviewSelectedCandidateRows,rowReviewUi,candidateBulkRowResult,candidateProgressRows,setUploads(v){reviewUploads=v;},bindForTest(v){mount=v;bindInteractions();},clearCandidateDrafts};\n  window.DleWorkspaces = window.DleWorkspaces || {};`);
let permitted=true,response;
const requests=[];
const document={addEventListener(){},getElementById(){return null;}};
const window={DleOsRuntimeConfig:{environment:'SIM'},DleOsCapabilities:{can:()=>permitted},fetch:async(url,options)=>{
  requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>response};
}};
vm.runInNewContext(source,{window,document,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
const t=window.test;
const row=(i,basis='MANUFACTURER_PN',reviewed=false)=>({index:i,rowId:'row-'+i,componentType:'STANDARD_COTS',identityBasis:basis,
  primaryIdentity:basis==='CUSTOMER_PN'?{basis,partNumber:'PN-'+i,customerBomPartNumber:'PN-'+i}:null,
  values:{lineNumber:String(i+1),partNumber:'PN-'+i,description:i===5?'TWISTED PAIR WIRE - AWG/TBD':'Manual part',quantity:i===5?'30':'1',designators:'REF'},
  reviewState:{token:'token-'+i,reviewed},confirmed:reviewed,comparison:{},alternates:[]});
const envelope={record:{intakeId:'ISOLATED-BULK',status:'TECHNICAL_REVIEW_IN_PROGRESS',technicalReview:{bomAcceptances:[],candidateBom:{id:'candidate',manualDraft:{kind:'DLE_AUTHORED'},rows:[row(0,'CUSTOMER_PN',true),row(1,'CUSTOMER_PN'),row(2),row(3),row(4),row(5)]}}}};
const reset=()=>{t.state.selected=structuredClone(envelope);t.state.candidateBulk=null;t.state.acceptedVersion=null;t.state.saving=false;t.clearCandidateDrafts();t.setUploads([]);};
const bom=()=>t.state.selected.record.technicalReview.candidateBom;
reset();
const before=JSON.stringify(t.state.selected);
assert.match(t.candidateBulkToolbar(bom()),/Select All/);
assert.match(t.manualRow(bom().rows[0],0,false,bom()),/Select BOM row 1/,'accepted row remains selectable');
assert.equal(JSON.stringify(t.state.selected),before,'rendering is read-only');
const selectAll=checked=>t.selectCandidateRows({matches:()=>true,checked});
selectAll(true);assert.equal(t.candidateBulkState(bom()).selected.size,6);
assert.match(t.candidateBulkControls(bom()),/Row 1: Customer P\/N → Manufacturer P\/N; Row 2:/);
assert.match(t.candidateBulkControls(bom()),/1 accepted row will require acceptance again/);
t.selectCandidateRows({matches:()=>false,checked:false,dataset:{candidateSelectRow:'row-4'}});
assert.equal(t.candidateBulkState(bom()).selected.size,5);selectAll(true);

// Pending edits cannot disappear into a bulk operation.
for(const field of ['alternateDraft','approvedPartDraft','identityBasisDraft']){
  t.rowReviewUi(bom().rows[2])[field]={};assert.match(t.candidateBulkPendingIssue(bom()),/Save.*or cancel/);
  await t.reviewSelectedCandidateRows('ACCEPT_SELECTED');assert.equal(requests.length,0);delete t.rowReviewUi(bom().rows[2])[field];
}
t.setUploads([{}]);assert.match(t.candidateBulkPendingIssue(bom()),/file changes/);t.setUploads([]);
t.rowReviewUi(bom().rows[5]).manualValues={...bom().rows[5].values,quantity:'31'};
assert.match(t.candidateBulkPendingIssue(bom()),/Save Progress/);await t.reviewSelectedCandidateRows('USE_ENTERED_MPN');assert.equal(requests.length,0);t.clearCandidateDrafts();

// Result handling retains successful identity rows for the next explicit Accept.
response=structuredClone(t.state.selected);
response.record.technicalReview.candidateBom.rows.forEach(r=>{r.reviewState={reviewed:false,token:'classified-'+r.index};r.confirmed=false;r.identityBasis='MANUFACTURER_PN';});
response.bulkResult={action:'USE_ENTERED_MPN',changedCount:6,results:bom().rows.map(r=>({rowId:r.rowId,rowIndex:r.index,status:'UPDATED',message:'Manufacturer P/N confirmed; Accept separately.'}))};
await t.reviewSelectedCandidateRows('USE_ENTERED_MPN');
assert.deepEqual(requests[0],{url:'/api/sim/technical-reviews/ISOLATED-BULK/candidate-bom',body:{candidateId:'candidate',rowIndex:-1,values:null,bulkReview:{action:'USE_ENTERED_MPN',rows:envelope.record.technicalReview.candidateBom.rows.map(r=>({rowId:r.rowId,expectedToken:r.reviewState.token}))}}});
assert.equal(t.candidateBulkState(bom()).selected.size,6);assert.equal(bom().rows[0].reviewState.reviewed,false);
assert.equal(bom().rows[5].values.description,'TWISTED PAIR WIRE - AWG/TBD');assert.equal(bom().rows[5].values.unit,undefined);

// Mixed acceptance reports exact blockers and leaves those rows selected.
response=structuredClone(t.state.selected);
// Clean caches (type then revert) must not overwrite concurrently updated rows.
t.rowReviewUi(bom().rows[2]).manualValues={...bom().rows[2].values};
t.state.candidateIndex=2;t.state.candidateDraft={...bom().rows[2].values};
response.record.technicalReview.candidateBom.rows[2].values.description='Saved by another reviewer';
response.record.technicalReview.candidateBom.rows[2].reviewState.token='new-server-token';
response.bulkResult={action:'ACCEPT_SELECTED',changedCount:5,results:bom().rows.map(r=>({rowId:r.rowId,rowIndex:r.index,status:r.index===2?'BLOCKED':'ACCEPTED',message:r.index===2?'Resolve the pending alternate individually.':'Row accepted.'}))};
await t.reviewSelectedCandidateRows('ACCEPT_SELECTED');
assert.deepEqual([...t.candidateBulkState(bom()).selected],['row-2']);
assert.equal(t.candidateProgressRows().length,0,'refresh must not turn clean cached values into an overwrite with the new token');
assert.match(t.manualRow(bom().rows[2],2,false,bom()),/Saved by another reviewer/);
assert.match(t.candidateBulkRowResult(bom(),bom().rows[2]),/Resolve the pending alternate individually/);
assert.match(t.state.message,/5 accepted · 0 already accepted · 1 blocked/);
bom().rows[2].reviewState.token='changed';assert.equal(t.candidateBulkRowResult(bom(),bom().rows[2]),'','stale result clears after a row change');
bom().id='replacement';assert.equal(t.candidateBulkState(bom()).selected.size,0,'candidate replacement clears selection');

reset();t.selectCandidateRows({matches:()=>false,checked:true,dataset:{candidateSelectRow:'row-2'}});
t.rowReviewUi(bom().rows[4]).manualValues={...bom().rows[4].values};
response=structuredClone(t.state.selected);response.record.technicalReview.candidateBom.rows[4].values.description='Concurrent unselected edit';
response.record.technicalReview.candidateBom.rows[4].reviewState.token='concurrent-token';
response.bulkResult={action:'ACCEPT_SELECTED',changedCount:0,results:[{rowId:'row-2',rowIndex:2,status:'BLOCKED',message:'Confirm identity first.'}]};
await t.reviewSelectedCandidateRows('ACCEPT_SELECTED');
assert.equal(t.candidateProgressRows().length,0,'unselected clean caches must also refresh without generating edits');
assert.match(t.manualRow(bom().rows[4],4,false,bom()),/Concurrent unselected edit/);

reset();bom().rows[0].identityBasis='ASSEMBLY_PN';selectAll(true);
assert.match(t.candidateBulkControls(bom()),/individual classification review/);
assert.doesNotMatch(t.candidateBulkControls(bom()),/Assembly P\/N → Manufacturer P\/N/);

// Visibility and request guards retain the existing access boundary.
reset();permitted=false;assert.equal(t.candidateBulkToolbar(bom()),'');await t.reviewSelectedCandidateRows('USE_ENTERED_MPN');assert.equal(requests.length,3);permitted=true;
for(const environment of ['DEV','LIVE']){window.DleOsRuntimeConfig.environment=environment;assert.equal(t.candidateBulkToolbar(bom()),'');}
window.DleOsRuntimeConfig.environment='SIM';
t.state.selected.record.technicalReview.bomAcceptances=[{candidate:{id:bom().id}}];assert.equal(t.candidateBulkToolbar(bom()),'');
reset();delete bom().manualDraft;assert.equal(t.candidateBulkToolbar(bom()),'','non-manual worksheet unaffected');
reset();t.state.selected.record.status='READY_FOR_RFQ_WORKING_QUEUE';assert.equal(t.candidateBulkToolbar(bom()),'');

// Browsers can drain input microtasks before firing checkbox change. A generic
// progress refresh must not restore the old checkbox state during that gap.
reset();t.state.step='candidate';
const listeners={},microtasks=[];
window.queueMicrotask=callback=>microtasks.push(callback);
t.bindForTest({addEventListener(type,callback){(listeners[type]||=[]).push(callback);},querySelector(){return null;},querySelectorAll(){return [];}});
const checkbox={dataset:{candidateSelectRow:'row-0'},checked:true,id:'',matches:selector=>selector.includes('data-candidate-select-row'),closest:()=>null};
for(const callback of listeners.input)callback({target:checkbox});
assert.equal(microtasks.length,0,'selection input must survive until change without a premature progress refresh');
for(const callback of listeners.change)callback({target:checkbox});
assert.equal(t.candidateBulkState(bom()).selected.has('row-0'),true);
console.log('PASS: bulk UI selection, classification notice, acceptance reset display, saved-token payload, pending edit guards, partial blockers, stable selection, manual-only access and unchanged row 6 values.');

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let request, fail=false;
const document={addEventListener(){},getElementById(){return null;}};
const window={fetch:async(url,options)=>{
  request=JSON.parse(options.body);
  if(fail)return {ok:false,json:async()=>({message:'This row changed. Reopen it before approving.'})};
  const saved=structuredClone(t.state.selected), row=saved.record.technicalReview.candidateBom.rows[request.rowIndex];
  row.confirmed=true;row.reviewState={reviewed:true,canApprove:false,reasons:[],approvalBlockers:[],token:'new-token'};
  return {ok:true,json:async()=>saved};
}};
const source=fs.readFileSync(new URL('../../SRC/workspaces/technical-review/technical-review-workspace.js',import.meta.url),'utf8')
 .replace('})(window, document);','window.test={state,renderQuickManufacturer,quickApproveManufacturer,candidateStatus}; })(window, document);');
vm.runInNewContext(source,{window,document,setTimeout,clearTimeout,setInterval,clearInterval});
const t=window.test;
function row(){return {reviewState:{reviewed:false,canApprove:true,reasons:['Governing fields need review'],approvalBlockers:[],token:'current-row-token'},confirmed:false};}
function setup(rows){request=null;t.state.selected={record:{intakeId:'SYNTHETIC',status:'TECHNICAL_REVIEW_IN_PROGRESS',technicalReview:{candidateBom:{id:'bom',rows}}}};t.state.candidateIndex=null;t.state.step='candidate';t.state.acceptedVersion=null;}
setup([row()]);
assert.match(t.renderQuickManufacturer(row(),0),/>Approve</);
assert.doesNotMatch(t.renderQuickManufacturer(row(),0),/<select|hidden/);
await t.quickApproveManufacturer(0);
assert.deepEqual(request,{candidateId:'bom',rowIndex:0,wholeRowApproval:{expectedToken:'current-row-token'}});
assert.equal(t.state.candidateIndex,null,'approval does not open details');
const approved=t.state.selected.record.technicalReview.candidateBom.rows[0];
assert.equal(t.candidateStatus(approved),'Reviewed');assert.doesNotMatch(t.renderQuickManufacturer(approved,0),/<button/);
const blocked={...row(),confirmed:true,reviewState:{reviewed:false,canApprove:false,reasons:['Stale identity'],approvalBlockers:['Stale identity <unsafe>'],token:'blocked'}};
assert.equal(t.candidateStatus(blocked),'Uncertain','server completion policy overrides old confirmed flag');
assert.doesNotMatch(t.renderQuickManufacturer(blocked,0),/<button|<unsafe>/);
assert.match(t.renderQuickManufacturer(blocked,0),/Stale identity &lt;unsafe&gt;/);
setup([blocked]);await t.quickApproveManufacturer(0);assert.equal(request,null);
assert.equal(t.renderQuickManufacturer(row(),0,true),'');
setup([row()]);t.state.step='accepted-bom';await t.quickApproveManufacturer(0);assert.equal(request,null);
setup([row()]);t.state.saving=true;await t.quickApproveManufacturer(0);assert.equal(request,null);t.state.saving=false;
fail=true;const original=JSON.stringify(t.state.selected);await t.quickApproveManufacturer(0);
assert.equal(JSON.stringify(t.state.selected),original);assert.match(t.state.message,/row changed/);
assert.match(t.renderQuickManufacturer(row(),0),/>Approve</);
console.log('PASS: whole-row approval request, shared backend completion status, explicit exception reasons, no dropdown, closed details, read-only/saving guards, and failed-write preservation.');

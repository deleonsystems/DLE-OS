import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.js','utf8');
const extract=(name,async=false)=>{const start=source.indexOf('  '+(async?'async ':'')+'function '+name+'(');assert.notEqual(start,-1,name);return source.slice(start,source.indexOf('\n  }',start)+4);};
const record={intakeId:'SYNTHETIC-SUBMIT',customer:{customerName:'Synthetic'},status:'READY_FOR_RFQ_WORKING_QUEUE',technicalReview:{workflow:{outputs:{}}}};
let request,requests=[],fail=false,refresh=0,dirty=false;
const state={saving:false,step:'inventory',selected:{record:{...record,status:'TECHNICAL_REVIEW_IN_PROGRESS'}}};
const context={state,escapeHtml:x=>x,pendingSubmissionEdits:()=>dirty,renderDetail(){},resumeWorkflow(){throw Error('Unexpected resume');},fetchJson:async(url,options)=>{request={url,options};requests.push(request);if(fail)throw Error('Source changed');return {record};},refreshQueueModel:async()=>{refresh++;}};
vm.createContext(context);vm.runInContext('let releaseReadiness=null;function setReadiness(v){releaseReadiness=v;}function readiness(){return releaseReadiness;}'+extract('renderSubmittedReview')+extract('workflowAction',true),context);
for(const readiness of [null,{ready:false,submissionToken:'blocked'}]){context.setReadiness(readiness);await context.workflowAction('COMPLETE');assert.equal(requests.length,0);assert.equal(state.step,'inventory');}
context.setReadiness({ready:true,submissionToken:'saved-review-token'});dirty=true;await context.workflowAction('COMPLETE');assert.equal(requests.length,0,'unsaved edits cannot submit');dirty=false;
await context.workflowAction('COMPLETE');assert.equal(state.step,'submitted');assert.equal(refresh,1);assert.equal(requests[0].url,'/api/sim/technical-reviews/SYNTHETIC-SUBMIT/workflow');assert.equal(requests[0].options.method,'POST');assert.deepEqual(JSON.parse(requests[0].options.body),{action:'COMPLETE',expectedSubmissionToken:'saved-review-token'});assert.equal(request.url,'/api/sim/technical-reviews/SYNTHETIC-SUBMIT');assert.equal(request.options,undefined);
const html=context.renderSubmittedReview(record);assert.match(html,/Technical Review Submitted/);assert.match(html,/data-technical-review-action="submitted-done">Done/);assert.doesNotMatch(html,/View RFQ|Back to Technical Review Queue/);assert.equal((html.match(/<button/g)||[]).length,1);assert.doesNotMatch(html,/READY_FOR_RFQ|Completion History|workflow events|UTC/);
fail=true;state.step='inventory';context.setReadiness({ready:true,submissionToken:'fresh-token'});await context.workflowAction('COMPLETE');assert.equal(state.step,'inventory');assert.equal(state.message,'Source changed');assert.equal(state.messageState,'error');assert.equal(context.readiness(),null,'stale submission automatically invalidates readiness for the next render');
const count=requests.length;await context.workflowAction('COMPLETE');assert.equal(requests.length,count,'failure waits for the automatic fresh readiness check');
assert.match(source,/state.step === 'submitted' \? renderSubmittedReview\(record\) : renderCompletedReview\(record\)/);
console.log('PASS: explicit ready+token submission, missing/blocked/dirty no-POST guards, clean Done confirmation, stale rejection and history renderer preserved.');

// Exercise the full page, where unrelated panels previously leaked into the success screen.
const pageState={saving:false,step:'submitted',selected:{record:structuredClone(record)}};
const host={innerHTML:'',querySelectorAll:()=>[]};
let homes=0,queueReturns=0;
const pageContext={state:pageState,escapeHtml:x=>x,document:{getElementById:()=>host},
  window:{goHome(){homes++;},DleWorkspaceShell:{navigate(){throw Error('Unexpected direct workspace navigation');}}},
  mount:{classList:{toggle(){},remove(){}}},captureCandidatePosition(){},candidateWorkbenchObserver:null,
  renderCompletedReview:()=>'<section>Completion History</section>',
  renderCustomerAmendmentEntry:()=>'<section id="customerIdentityAmendment">Customer / internal part numbers</section>',
  renderOriginalCustomerRequest:()=>'<section>Original Customer Request</section>',
  showQueue(){queueReturns++;},fetchJson(){throw Error('Success navigation must not write data');}};
vm.createContext(pageContext);
vm.runInContext(extract('completedReview')+extract('renderSubmittedReview')+extract('renderDetail'),pageContext);
const savedRecord=JSON.stringify(pageState.selected.record);
pageContext.renderDetail();
assert.match(host.innerHTML,/Technical Review Submitted/);
assert.equal((host.innerHTML.match(/<button/g)||[]).length,1);
assert.match(host.innerHTML,/data-technical-review-action="submitted-done">Done/);
assert.doesNotMatch(host.innerHTML,/customerIdentityAmendment|Customer \/ internal|Original Customer Request|Go to RFQs|data-customer-identity|Completion History/);
assert.equal(homes,0,'submission confirmation never navigates automatically');
const clickStart=source.indexOf('mount.addEventListener("click", event => {');
assert.notEqual(clickStart,-1);
const listener=source.slice(source.indexOf('event => {',clickStart),source.indexOf('\n    });',clickStart)+6);
vm.runInContext('var successClick=('+listener+');',pageContext);
const click=action=>pageContext.successClick({target:{closest:selector=>selector==='[data-technical-review-action]'?{dataset:{technicalReviewAction:action}}:null}});
click('submitted-done');assert.equal(homes,1);assert.equal(queueReturns,0);
assert.equal(JSON.stringify(pageState.selected.record),savedRecord,'Done preserves completed saved data');
pageState.saving=true;click('submitted-done');assert.equal(homes,1,'no navigation while saving');pageState.saving=false;
pageState.step='package';pageContext.renderDetail();
assert.match(host.innerHTML,/Completion History/);assert.match(host.innerHTML,/customerIdentityAmendment/);assert.match(host.innerHTML,/Original Customer Request/);
click('submitted-done');assert.equal(homes,1,'success action applies only to the success screen');
click('back');assert.equal(queueReturns,1,'existing historical Back behavior is unchanged');
console.log('PASS: full success page contains only confirmation + Done; Done uses existing Home action without RFQ navigation or data writes; historical review controls remain available.');


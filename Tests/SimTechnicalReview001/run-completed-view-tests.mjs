import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let source=fs.readFileSync(new URL('../../SRC/workspaces/technical-review/technical-review-workspace.js',import.meta.url),'utf8');
source=source.replace('  window.DleWorkspaces = window.DleWorkspaces || {};','  window.test = {state,completedReview,renderCompletedReview,fetchJson,bind: m=>{mount=m;bindInteractions();}};\n  window.DleWorkspaces = window.DleWorkspaces || {};');
let writes=0, navigation;const handlers={};
const document={addEventListener(){},getElementById(){return null;}};
const window={document,DleWorkspaceShell:{navigate:r=>navigation=r},fetch:async(url,options)=>{if(options?.method && options.method !== 'GET')writes++;return {ok:true,json:async()=>({})};}};
vm.runInNewContext(source,{window,document,setTimeout,clearTimeout,setInterval,clearInterval});
const t=window.test;
const values={lineNumber:'1',partNumber:'SYNTHETIC',quantity:'1',designators:'R1',description:'Test'};
const row={values,extracted:values,comparison:{},alternates:[],corrections:[],confirmed:true};
const candidate={id:'test',rows:[row],page:2,governingDocumentId:'pdf',analysis:{}};
const acceptance={version:1,candidate,reviewedBy:'Synthetic reviewer',reviewedAtUtc:'2026-09-13T00:00:00Z'};
const record={intakeId:'FIXTURE',status:'READY_FOR_RFQ_WORKING_QUEUE',customer:{customerName:'Synthetic'},technicalFiles:[{documentId:'pdf',binaryStatus:'VERIFIED'}],technicalReview:{candidateBom:candidate,bomAcceptances:[acceptance],technicalPackage:{documents:[{documentId:'pdf',name:'drawing.pdf',documentType:'ASSEMBLY_DRAWING',role:'GOVERNING'}],governingBomDocumentId:'pdf'},workflow:{outputs:{reviewer:'Synthetic',atUtc:'2026-09-13T00:00:00Z'},manufacturing:{id:'mfg'},events:[]},materialsReviewStatus:'QUALIFIED'}};
t.state.selected={record};const before=JSON.stringify(record);
for(const step of ['package','history','manufacturing','materials','candidate','completion','accepted-bom']) {
 t.state.step=step;t.state.acceptedVersion=1;t.state.candidateIndex=0;
 const html=t.renderCompletedReview(record);assert.match(html,/Completed Technical Review — Read-only/);assert.match(html,/← Back to RFQ/);assert.doesNotMatch(html,/<input|<select|<textarea|data-technical-review-action="(?:complete-bom|candidate-confirm|flow-|governing-back)/);
 if(step==='candidate'||step==='accepted-bom')assert.match(html,/SYNTHETIC/);
}
assert.equal(JSON.stringify(record),before);
for(const method of ['POST','PUT','DELETE'])await assert.rejects(t.fetchJson('/api/sim/technical-reviews/FIXTURE',{method}),/read-only/);
assert.equal(writes,0);assert.equal(t.completedReview({status:'TECHNICAL_REVIEW_IN_PROGRESS'}),false);
t.bind({addEventListener:(name,fn)=>handlers[name]=fn});
const click=action=>handlers.click({target:{closest:()=>({dataset:{technicalReviewAction:action}})}});
for(const action of ['start','flow-START','delete','save-package','analysis-retry','candidate-confirm'])click(action);
assert.equal(writes,0);click('rfq-back');assert.equal(navigation.workspaceId,'rfqs');assert.equal(navigation.requestedState.intakeId,'FIXTURE');
console.log('PASS: completed sections and BOM evidence render read-only; all write methods and editing actions blocked; record unchanged; return targets same RFQ.');

// Done reuses the allowed completed-review back action without writing business state.
const panels={technicalReviewDetailView:{hidden:false},technicalReviewQueueView:{hidden:true}};
document.getElementById=id=>panels[id]||null;
t.bind({addEventListener:(name,fn)=>handlers[name]=fn,classList:{remove(){}}});
t.state.saving=false;t.state.step='submitted';click('back');
assert.equal(panels.technicalReviewDetailView.hidden,true);assert.equal(panels.technicalReviewQueueView.hidden,false);assert.equal(t.state.selected,null);assert.equal(writes,0);
console.log('PASS: Done/back leaves submitted detail for the existing queue without writes.');

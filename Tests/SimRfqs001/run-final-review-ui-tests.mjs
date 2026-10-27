import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../SRC/workspaces/rfqs/quotation-final-review.js',import.meta.url),'utf8');
const cells=new Map(),root={querySelector(s){if(!cells.has(s))cells.set(s,{textContent:'',disabled:false});return cells.get(s);}},mount={innerHTML:'',querySelector:()=>root};
let writes=0,fail=false,readonly=false,back=false,lastBody,previewBody,previewFail=false;
let view={summary:{intakeId:'TEST',customer:'Synthetic <customer>',assembly:'TEST-PN',revision:'A',quantity:25,materialUnitSale:10,laborUnitSale:20,combinedUnitPrice:30,total:750,quoteTotal:1400,nreTotal:650,nreLines:[{label:'Tooling',amount:650}],materialLongestLeadDays:21,customerSuppliedMaterial:true,technicalPackageAvailable:true,technicalComplete:true,materialsComplete:true,laborComplete:true,materialsVersion:1,laborVersion:2},sourceToken:'source-1',blockers:[],approvals:[],approvalCurrent:false};
const window={scrollTo(){},confirm:()=>true,DleOsCapabilities:{can:()=>!readonly},fetch:async(url,options)=>{if(url.endsWith('/preview/pages')){previewBody=JSON.parse(options.body);return{ok:!previewFail,json:async()=>previewFail?{message:'Source work changed. Reopen Final Review.'}:{pages:['data:image/png;base64,TEST']}};}if(options.method&&url.endsWith('/pdf'))return{ok:true,json:async()=>({url:'/api/sim/rfqs/TEST/final-review/1/pdf',quoteNumber:'SIM-Q-TEST-R01'})};if(options.method){writes++;lastBody=JSON.parse(options.body);if(fail)return{ok:false,json:async()=>({message:'Source work changed. Reopen Final Review.'})};view={...view,approvalCurrent:true,approvals:[{id:'approved',version:1,summary:structuredClone(view.summary),answers:lastBody.answers,approvedBy:'SIM Reviewer',approvedAt:'2026-09-16'}]};}return{ok:true,json:async()=>structuredClone(view)};}};
vm.runInNewContext(source,{window,structuredClone});const api=window.DleQuotationFinalReview;
const reopen=()=>api.open(mount,{intakeId:'TEST'},async()=>{back=true;});const click=action=>root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{action}})}});const answer=(k,value)=>root.oninput({target:{dataset:{answer:k},value}});
await reopen();assert.match(mount.innerHTML,/Quotation Final Review/);assert.match(mount.innerHTML,/Synthetic &lt;customer&gt;/);assert.match(mount.innerHTML,/\$30.00/);assert.match(mount.innerHTML,/\$750.00/);assert.match(mount.innerHTML,/NRE Total/);assert.match(mount.innerHTML,/3 Weeks/);
await click('approve');assert.equal(writes,0);assert.match(root.querySelector('[data-final-blockers]').textContent,/Quoted Delivery/);
for(const[k,v]of Object.entries({delivery:'4 weeks',outsourced:'false',highUnitCost:'false',canMeetDelivery:'true',riskSeverity:'LOW',class:'CLASS_2',itar:'false'}))answer(k,v);
assert.equal(root.querySelector('[data-action="approve"]').disabled,false);answer('riskNotes','Synthetic review notes');assert.equal(root.querySelector('[data-action="approve"]').disabled,false);
fail=true;await click('approve');assert.match(root.querySelector('[role="status"]').textContent,/Source work changed/);assert.match(mount.innerHTML,/4 weeks/);fail=false;await click('approve');assert.equal(lastBody.sourceToken,'source-1');assert.equal(lastBody.expectedApprovalCount,0);assert.equal(lastBody.answers.outsourced,false);assert.equal(lastBody.answers.itar,false);assert.equal('price' in lastBody,false);assert.equal(view.approvals[0].answers.delivery,'4 weeks');assert.match(mount.innerHTML,/SIM Reviewer/);assert.equal(root.querySelector('[data-action="approve"]').disabled,true);
await reopen();assert.match(mount.innerHTML,/Approved v1/);const count=writes;await click('approve');assert.equal(writes,count);await click('back');assert.equal(back,true);
view={...view,approvalCurrent:false,blockers:['Complete Materials.']};await reopen();assert.match(root.querySelector('[data-final-blockers]').textContent,/Complete Materials/);assert.match(mount.innerHTML,/previous approval is retained in history/);readonly=true;await reopen();await click('approve');assert.equal(writes,count);
console.log('PASS: Final Review auto-fill, separate NRE, delivery validation, stale error retains edits, server source token, approval/reopen/history and read-only gates.');

readonly=false;view={...view,approvalCurrent:false,blockers:[],approvals:[]};await reopen();
assert.equal((mount.innerHTML.match(/<textarea/g)||[]).length,1);assert.doesNotMatch(mount.innerHTML,/Technical Package:|Assessment:|Approval History|No approvals yet/);
assert.match(mount.innerHTML,/Quote Line 1/);assert.match(mount.innerHTML,/Quote No: TEST/);assert.doesNotMatch(mount.innerHTML,/Outsourced Process|High Unit Cost|Can Meet Delivery|>Risk<|>Class<|>ITAR</);assert.match(mount.innerHTML,/Total Quote/);assert.match(mount.innerHTML,/Production subtotal/);assert.match(mount.innerHTML,/\$1,400.00/);assert.doesNotMatch(mount.innerHTML,/<details class="final-nre"/);assert.match(mount.innerHTML,/Review Notes \/ Assumptions/);
console.log('PASS: compact summary, one notes editor, quote-line table, visible NRE, removed Quality/Risk controls and no empty history.');

assert.equal(api.leadDisplay(14),'2 Weeks');assert.equal(api.leadDisplay(12),'2 Weeks');assert.equal(api.leadDisplay(3),'3 Days');
assert.equal(api.deliveryDefault({delivery:''},{suggestedLeadDays:28}).delivery,'4 Weeks');
assert.equal(api.deliveryDefault({delivery:'6 Weeks'},{suggestedLeadDays:28}).deliveryValue,6);
assert.equal(api.deliveryDefault({delivery:'After customer release'},{suggestedLeadDays:28}).delivery,'After customer release');
console.log('PASS: lead normalization, conservative rounding, structured defaults and legacy override preservation.');

view={...view,summary:{...view.summary,materialLongestLeadDays:14,manufacturingLead:'2 Weeks',manufacturingLeadDays:14,suggestedLeadDays:28},approvalCurrent:false,blockers:[],approvals:[]};
await reopen();assert.match(mount.innerHTML,/value="4"/);assert.match(mount.innerHTML,/Suggested Lead/);
answer('deliveryValue','6');answer('deliveryUnit','WEEKS');
for(const[k,v]of Object.entries({outsourced:'false',highUnitCost:'false',canMeetDelivery:'true',riskSeverity:'LOW',class:'CLASS_2',itar:'false'}))answer(k,v);
await click('approve');assert.equal(lastBody.answers.deliveryValue,6);assert.equal(lastBody.answers.deliveryUnit,'WEEKS');
await reopen();assert.match(mount.innerHTML,/value="6"/);assert.equal(view.approvals[0].summary.suggestedLeadDays,28);
view={...view,approvalCurrent:false,summary:{...view.summary,suggestedLeadDays:35}};await reopen();assert.match(mount.innerHTML,/value="6"/);assert.equal(root.querySelector('[data-final-blockers]').textContent,'');
console.log('PASS: structured default, explicit override, approval snapshot, reopen and changed-source override protection.');

const supplied={...view.summary,customerSuppliedMaterial:true,customerSuppliedItems:[{index:0,findNo:'1',internalPartNumber:'N4-554'},{index:2,findNo:'3',internalPartNumber:'<PN>'}],riskNotes:'INTERNAL SECRET'};
assert.equal(api.customerQuote,undefined);
view={...view,summary:supplied,approvals:[],approvalCurrent:false};await reopen();assert.match(mount.innerHTML,/Find No. 1 — Internal P\/N N4-554/);
answer('deliveryValue','3');answer('deliveryUnit','WEEKS');const writesBeforePreview=writes;
await click('preview-quote');assert.match(mount.innerHTML,/Quotation preview page 1 of 1/);assert.match(mount.innerHTML,/data:image\/png;base64,TEST/);assert.doesNotMatch(mount.innerHTML,/<iframe|<embed/);assert.match(mount.innerHTML,/PREVIEW ONLY - NOT APPROVED - NOT FOR CUSTOMER USE/);
assert.doesNotMatch(mount.innerHTML,/Approve Quote|Generate Quotation PDF|View PDF|INTERNAL SECRET|Download|Send to Customer/);
let prevented=false;root.onkeydown({ctrlKey:true,key:'p',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(writes,writesBeforePreview);assert.equal(previewBody.sourceToken,view.sourceToken);assert.equal(previewBody.expectedApprovalCount,0);assert.equal(previewBody.answers.deliveryValue,3);assert.equal('price' in previewBody,false);
mount.querySelector('[data-return-review]').onclick();assert.match(mount.innerHTML,/value="3"/);
previewFail=true;await click('preview-quote');assert.match(root.querySelector('[role="status"]').textContent,/Source work changed/);assert.match(mount.innerHTML,/value="3"/);assert.equal(root.querySelector('[data-action="approve"]').disabled,false);previewFail=false;
console.log('PASS: shared PDF preview, no local price model, source token/answers, watermark notice, no final controls, unsaved answers and failure recovery.');

view={...view,approvalCurrent:true,approvals:[{version:1,summary:view.summary,answers:{delivery:'4 Weeks',deliveryValue:4,deliveryUnit:'WEEKS',riskNotes:''},approvedBy:'Reviewer',approvedAt:'2026-09-16'}]};await reopen();assert.match(mount.innerHTML,/Generate Quotation PDF/);await click('generate-pdf');assert.match(mount.innerHTML,/View PDF/);assert.match(mount.innerHTML,/final-review\/1\/pdf/);
view={...view,approvalCurrent:false};await reopen();assert.doesNotMatch(mount.innerHTML,/Generate Quotation PDF/);
console.log('PASS: PDF generation controls require approved review and expose version-specific View PDF.');

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../SRC/workspaces/technical-review/technical-review-workspace.js',import.meta.url),'utf8').replace(
  '  window.DleWorkspaces = window.DleWorkspaces || {};',
  '  window.test={state,renderSourcePartNumber,sourcePartNumberDefault,worksheetIdentity,renderCandidate,confirmSourcePartNumber,rowReviewUi};\n  window.DleWorkspaces = window.DleWorkspaces || {};');
const document={addEventListener(){},getElementById(){return null;}};
const requests=[];let response;
const window={document,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>response};}};
vm.runInNewContext(source,{window,document,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
const t=window.test;
const row={index:0,values:{partNumber:'SIM-R-1K',description:'Resistor',quantity:'2',designators:'R1 R2',lineNumber:'1'},componentType:'STANDARD_COTS',confirmed:false,reviewState:{token:'token',reviewed:false},manufacturerIdentity:{proposals:[],history:[]}};
const envelope={record:{intakeId:'SYN',status:'TECHNICAL_REVIEW_IN_PROGRESS',technicalReview:{candidateBom:{id:'candidate',governingDocumentId:'bom',rows:[row]},technicalPackage:{documents:[{documentId:'bom',partNumberReview:{basis:'MANUFACTURER'}}]}}}};
t.state.selected=envelope;
const original=JSON.stringify(envelope);
assert.match(t.renderSourcePartNumber(row,0,false),/MFG · inherited/);
assert.match(t.renderSourcePartNumber(row,0,false),/Confirm P\/N Identity/);
assert.match(t.renderSourcePartNumber(row,0,false),/Approved P\/N → SIM-R-1K/);
assert.equal(JSON.stringify(envelope),original,'inherited rendering cannot mutate record');
for(const [basis,expected] of [['CUSTOMER_INTERNAL','CUSTOMER'],['MIXED','UNRESOLVED'],['UNKNOWN','UNRESOLVED']]){
 envelope.record.technicalReview.technicalPackage.documents[0].partNumberReview.basis=basis;assert.equal(t.sourcePartNumberDefault(),expected);
}
envelope.record.technicalReview.technicalPackage.documents[0].partNumberReview.basis='MANUFACTURER';
response=structuredClone(envelope);
response.record.technicalReview.candidateBom.rows[0]={...row,sourcePartNumberReview:{current:{basis:'MFG',status:'CONFIRMED'}},manufacturerIdentity:{proposals:[{id:'source',partNumber:'SIM-R-1K'}],history:[{proposalId:'source',decision:'CONFIRMED'}]}};
await t.confirmSourcePartNumber({dataset:{candidateRow:'0'}});
assert.equal(requests.length,1);
assert.deepEqual(JSON.parse(requests[0].options.body),{candidateId:'candidate',rowIndex:0,values:null,sourcePartNumberChange:{basis:'MFG',expectedToken:'token'}});
assert.match(t.renderSourcePartNumber(response.record.technicalReview.candidateBom.rows[0],0,false),/MFG · confirmed/);
assert.match(t.worksheetIdentity(response.record.technicalReview.candidateBom.rows[0],0,false,'STANDARD_COTS'),/SIM-R-1K/);
assert.equal(response.record.technicalReview.candidateBom.rows[0].confirmed,false);
assert.match(t.state.message,/Accept the row separately/);
for(const basis of ['CUSTOMER','ASSEMBLY','MFG']) {
 const example={...row,componentType:'SUBASSEMBLY',sourcePartNumberReview:{current:{basis,status:'CONFIRMED'}},primaryIdentity:{basis:'CUSTOMER_PN',partNumber:'CUSTOMER-ID'},assemblyIdentity:{partNumber:'ASSEMBLY-ID'},manufacturerIdentity:response.record.technicalReview.candidateBom.rows[0].manufacturerIdentity};
 const html=t.worksheetIdentity(example,0,false,'SUBASSEMBLY');
 assert.match(html,new RegExp(basis==='CUSTOMER'?'CUSTOMER-ID':basis==='ASSEMBLY'?'ASSEMBLY-ID':'SIM-R-1K'));
}
const pcb={...row,componentType:'SUBASSEMBLY',confirmed:true,assemblyIdentity:{partNumber:'SIM-PCB-001 REV A'},reviewState:{reviewed:true}};
const pcbBefore=JSON.stringify(pcb);assert.match(t.renderSourcePartNumber(pcb,0,true),/Assembly P\/N approval/);assert.doesNotMatch(t.renderSourcePartNumber(pcb,0,true),/inherited|Confirm P/);assert.equal(JSON.stringify(pcb),pcbBefore);
const manual={...row,manufacturerIdentity:response.record.technicalReview.candidateBom.rows[0].manufacturerIdentity};assert.match(t.renderSourcePartNumber(manual,0,false),/existing identity retained/);
console.log('PASS: source P/N UI defaults, no render writes, exact confirmation command, separate Accept, independent type/basis routes, manual and accepted PCB preservation.');
if(process.argv[2]){
 const live=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));t.state.selected=live;t.state.rowReviewUi={};
 const rows=live.record.technicalReview.candidateBom.rows,target=rows.find(r=>r.values.partNumber==='SIM-R-1K');
 assert.equal(rows.length,12);assert.equal(target.confirmed,false);assert.equal(target.sourcePartNumberReview.current.basis,'MFG');
 assert.match(t.renderSourcePartNumber(target,target.index,false),/MFG · confirmed/);
 const eligible=rows.filter(r=>r!==target&&!r.confirmed);assert.equal(eligible.length,10);
 for(const r of eligible){assert.match(t.renderSourcePartNumber(r,r.index,false),/MFG · inherited/);assert.match(t.renderSourcePartNumber(r,r.index,false),/Confirm P\/N Identity/);assert.equal(r.sourcePartNumberReview,undefined);}
 const board=rows.find(r=>r.values.partNumber==='SIM-PCB-001');assert.equal(board.confirmed,true);assert.equal(board.assemblyIdentity.partNumber,'SIM-PCB-001 REV A');
 const html=t.renderCandidate(live.record);assert.match(html,/MFG · confirmed/);assert.match(html,/Needs Review/);
 console.log('PASS: live response renders confirmed SIM-R-1K, unchanged accepted PCB, and the same inherited confirmation editor on all ten remaining unresolved rows.');
}

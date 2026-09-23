import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const wizard=read('../../SRC/modules/rfq-workspace/intake-wizard.js');
assert.doesNotMatch(wizard,/intakeRequestDocuments|renderRequestDocuments|requestDocumentSubmit|Customer Request Documents/);
const host={innerHTML:''},document={addEventListener(){}};
const record={intakeId:'RFQI-SIM-0042',intakeType:'NEW_QUOTE_REQUEST',customer:{customerName:'Synthetic'},assemblies:[{assemblyNumber:'SIM-ASSY-001',revision:'A',quantity:10}],technicalFiles:[]};
const attachment={document:{documentId:'doc-1',name:'<request>.pdf'},owner:'Intake',type:'CUSTOMER_RFQ_REQUEST',addedBy:'Reviewer'};
const requests=[];let response=record,ok=true,allowed=true;
const window={document,DleOsCapabilities:{can:p=>allowed&&p==='rfq.intake.create'},fetch:async(url,options)=>{requests.push({url,options});return{ok,json:async()=>response};}};
vm.runInNewContext(read('../../SRC/modules/rfq-workspace/customer-request-documents.js'),{window});
await window.DleCustomerRequestDocuments.open(host,record.intakeId);
assert.match(host.innerHTML,/Owned by Intake/);assert.match(host.innerHTML,/SIM-ASSY-001 \/ Rev A/);assert.match(host.innerHTML,/RFQI-SIM-0042/);assert.doesNotMatch(host.innerHTML,/name="intakeId"/);
const file={name:'request.pdf',size:123,lastModified:0};
const submit=()=>host.onsubmit({target:{closest:()=>({elements:{file:{files:[file]}}})},preventDefault(){},stopPropagation(){}});
response={duplicate:false,record:{...record,customerRequestDocuments:[attachment]}};
await submit();assert.match(requests[1].url,/RFQI-SIM-0042\/customer-request-documents/);assert.equal(requests[1].options.body,file);assert.match(host.innerHTML,/&lt;request&gt;/);assert.match(host.innerHTML,/customer-request-documents\/doc-1/);
response={...response,duplicate:true};await submit();assert.match(host.innerHTML,/Already attached/);
allowed=false;response={...record,customerRequestDocuments:[attachment]};await window.DleCustomerRequestDocuments.open(host,record.intakeId);assert.doesNotMatch(host.innerHTML,/<form/);const count=requests.length;await submit();assert.equal(requests.length,count);assert.match(host.innerHTML,/Read-only/);
allowed=true;ok=false;response={message:'Not found'};await window.DleCustomerRequestDocuments.open(host,'missing');assert.doesNotMatch(host.innerHTML,/<form/);assert.match(host.innerHTML,/Not found/);
console.log('PASS: no global wizard panel; selected identity, permission, upload, duplicate, escaping, retrieval and failed-load checks.');
const reviewSource=read('../../SRC/workspaces/technical-review/technical-review-workspace.js').replace('  window.DleWorkspaces = window.DleWorkspaces || {};','  window.requestView=renderOriginalCustomerRequest;window.requestState=state;window.requestInventory=renderInventory;\n  window.DleWorkspaces = window.DleWorkspaces || {};');
vm.runInNewContext(reviewSource,{window,document,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
assert.equal(window.requestView(record),'');
const html=window.requestView({...record,customerRequestDocuments:[attachment]});
assert.match(html,/Original Customer Request/);assert.match(html,/Read-only/);assert.match(html,/&lt;request&gt;/);
assert.doesNotMatch(html,/<input|<select|<button|data-package/);
assert.match(html,/customer-request-documents\/doc-1/);
console.log('PASS: Technical Review request display is escaped, read-only and outside authority controls; old records render normally.');

if(process.argv[2]) {
 const live=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
 ok=true;allowed=true;response=live;
 await window.DleCustomerRequestDocuments.open(host,live.intakeId);
 assert.match(host.innerHTML,/01_SIM-E2E-001_RFQ_A.pdf/);assert.match(host.innerHTML,/bbf3bdc0-797a-47dc-84df-d2d71106f3a6/);
 const html=window.requestView(live);assert.match(html,/Original Customer Request/);assert.match(html,/01_SIM-E2E-001_RFQ_A.pdf/);assert.doesNotMatch(html,/<input|<select|<button/);
 console.log('PASS: actual E2E record displays preserved document in Intake-owned component and read-only Technical Review.');
}

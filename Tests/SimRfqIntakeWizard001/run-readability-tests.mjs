import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../SRC/modules/rfq-workspace/intake-wizard.js', import.meta.url), 'utf8');
const names = ['renderFiles','setTechnicalFiles','technicalFileIdentity','formatBytes','escapeHtml','isPdf','renderReadability','checkReadability','replaceTechnicalFile','removeTechnicalFile','continueFromFiles','submitIntake','snapshot'];
const code = names.map(name => {
  const start = source.search(new RegExp('  (?:async )?function ' + name + '\\('));
  return source.slice(start, ['formatBytes','isPdf','snapshot'].includes(name) ? source.indexOf('\n',start) : source.indexOf('\n  }',start)+4);
}).join('\n');
const requests = [];
let nextCount=0, deleted=0;
const context = {
  state:{technicalFiles:[],submit:{status:'idle'},intakeType:'NEW_QUOTE_REQUEST',assemblies:[],customerRequirements:[]},
  committed:null, root:{querySelector(){return null}}, render(){}, next(){nextCount++}, showInlineError(message){throw Error(message)},
  deleteStagedTechnicalFile:async()=>{deleted++}, document:{dispatchEvent(){}}, CustomEvent:class{},
  window:{fetch:async (url, options)=>{
    requests.push(url);
    if(url.endsWith('/pdf-readability')) return {ok:true,json:async()=>({status:'IMAGE_ONLY',pageCount:5,textPageCount:0,imageOnlyPageCount:5})};
    if(url.includes('/documents?')) return {ok:true,json:async()=>({documentId:'staged',binaryStatus:'VERIFIED',readability:{status:'IMAGE_ONLY'}})};
    return {ok:true,json:async()=>({record:{intakeId:'test',technicalFiles:JSON.parse(options.body).technicalFiles}})};
  }}
};
vm.createContext(context);
vm.runInContext(source.match(/^  const initialDocumentTypes =.*$/m)[0]+'\n'+code,context);
const pdf={name:'scanned.pdf',size:10,type:'application/pdf',lastModified:1};
context.setTechnicalFiles([pdf]); await new Promise(r=>setImmediate(r));
let html=context.renderFiles();
assert.match(html,/Scanned \/ image-only/); assert.match(html,/Technical Review may have difficulty/);
assert.match(html,/data-intake-action="continue">Continue Anyway/); assert.match(html,/Replace File/);
context.continueFromFiles(); assert.equal(nextCount,1);
await context.submitIntake(); assert.equal(context.state.submit.status,'complete');
assert.equal(context.committed.technicalFiles[0].readability.status,'IMAGE_ONLY');
context.state.submit.status='idle';
const previous=context.state.technicalFiles[0];
await context.replaceTechnicalFile(previous,{...pdf,name:'replacement.pdf',lastModified:2});
await new Promise(r=>setImmediate(r));
assert.equal(context.state.technicalFiles.length,1); assert.equal(context.state.technicalFiles[0].name,'replacement.pdf'); assert.equal(deleted,1);
const before=requests.length;
context.setTechnicalFiles([{name:'notes.txt',size:4,type:'text/plain',lastModified:3}]);
assert.equal(requests.length,before); assert.equal(context.state.technicalFiles.length,2);
context.setTechnicalFiles([{...pdf,name:'replacement.pdf',lastModified:2}]); assert.equal(context.state.technicalFiles.length,2);
context.window.fetch=async()=>{throw Error('unavailable')};
context.setTechnicalFiles([{...pdf,name:'unavailable.pdf'}]); await new Promise(r=>setImmediate(r));
assert.match(context.renderFiles(),/Readability check unavailable/);
assert.equal(context.state.technicalFiles[2].readability.status,'UNKNOWN');
context.continueFromFiles(); assert.equal(nextCount,2);
await context.removeTechnicalFile(2); assert.equal(context.state.technicalFiles.length,2);
console.log('PASS: early warning, Continue Anyway and submission, replacement, additive/deduplicated files, non-PDF, removal, unavailable check remains nonblocking.');

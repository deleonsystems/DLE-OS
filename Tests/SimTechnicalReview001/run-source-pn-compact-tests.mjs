import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const path='SRC/workspaces/technical-review/technical-review-workspace';
const source=fs.readFileSync(path+'.js','utf8');
const css=fs.readFileSync(path+'.css','utf8');
const listeners=new Map(),panelListeners=new Map();let active=false,focused=false;
const help={addEventListener(){},removeEventListener(){}};
const panel={style:{},matches:()=>active,showPopover(){active=true},hidePopover(){active=false;panelListeners.get('toggle')?.({newState:'closed'})},
 getBoundingClientRect:()=>({width:248,height:225}),querySelector:s=>s==='select'?{focus(){focused=true}}:help,
 addEventListener:(n,f)=>panelListeners.set(n,f),removeEventListener:n=>panelListeners.delete(n)};
const document={getElementById:()=>panel,addEventListener:(n,f)=>listeners.set('document-'+n,f),removeEventListener:n=>listeners.delete('document-'+n)};
const window={document,innerWidth:1280,innerHeight:800,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
vm.runInNewContext(source.replace('  window.DleWorkspaces = window.DleWorkspaces || {};','  window.test={state,openSourcePartNumber,renderSourcePartNumber};\n  window.DleWorkspaces = window.DleWorkspaces || {};'),{window,document,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
const t=window.test;
for(const width of [1280,900]){
 window.innerWidth=width;
 for(const anchor of [{left:180,top:200,bottom:220},{left:width-70,top:760,bottom:780}]){
  const button={dataset:{sourcePnTarget:'test'},getBoundingClientRect:()=>anchor};
  t.openSourcePartNumber(button);assert(active&&focused);
  const left=parseFloat(panel.style.left),top=parseFloat(panel.style.top);
  assert(left>=8&&left+248<=width-8);assert(top>=8&&top+225<=792);
  assert.equal(listeners.has('resize'),true);assert.equal(listeners.has('document-scroll'),true);
  t.openSourcePartNumber(button);assert.equal(active,false);assert.equal(listeners.has('resize'),false);assert.equal(listeners.has('document-scroll'),false);
 }
}
const row={index:2,values:{partNumber:'SIM-R-10K'},componentType:'STANDARD_COTS',manufacturerIdentity:{proposals:[],history:[]}};
t.state.selected={record:{technicalReview:{candidateBom:{id:'test',governingDocumentId:'bom'},technicalPackage:{documents:[{documentId:'bom',partNumberReview:{basis:'MANUFACTURER'}}]}}}};
const html=t.renderSourcePartNumber(row,2,false);
assert.match(html,/MFG · inherited/);assert.match(html,/popover="auto" role="dialog"/);assert.match(html,/class="source-pn-help"><summary>Why\?/);
assert.doesNotMatch(html,/source-pn-help" open|source-pn-review" open/);
assert.match(html,/Approved P\/N → SIM-R-10K/);
assert.match(t.renderSourcePartNumber({...row,sourcePartNumberReview:{current:{basis:'MFG',status:'CONFIRMED'}}},2,false),/MFG · confirmed/);
assert.doesNotMatch(t.renderSourcePartNumber({...row,componentType:'SUBASSEMBLY'},2,true),/button|popover/);
assert.match(css,/\.source-pn-popover \{ position:fixed;/);assert.match(css,/width:248px/);assert.match(css,/background:#111827/);
assert.doesNotMatch(css,/source-pn-review\[open\]|background: #f5f8fb/);
if(fs.existsSync('output/source-pn-compact/before.js')){
 const before=fs.readFileSync('output/source-pn-compact/before.js','utf8');
 const handler=s=>s.split('  async function confirmSourcePartNumber(button) {')[1].split('  function sourceIdentityConfirmed')[0];
 assert.equal(handler(source),handler(before),'confirmation handler must remain byte-for-byte unchanged');
}
console.log('PASS: compact inherited/confirmed/accepted displays, optional help, fixed dark top-layer panel, 1280/900 positioning and edge flipping, focus, listener cleanup, unchanged confirmation handler. Geometry checks use DOM doubles; browser visual inspection is separate.');

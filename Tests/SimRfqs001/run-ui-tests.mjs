import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../../SRC/workspaces/rfqs/rfqs-workspace.js', import.meta.url), 'utf8');
const registry = fs.readFileSync(new URL('../../SRC/shell/workspace-registry.js', import.meta.url), 'utf8');
const fixture = {intakeId:'RFQI-FIXTURE', customer:{customerName:'Synthetic <RFQs>'}, assemblies:[{assemblyNumber:'TEST',revision:'A',quantity:2}],scope:'MATERIAL_AND_LABOR',status:'READY_TO_WORK',lanes:{materials:{status:'NOT_STARTED'},labor:{status:'NOT_STARTED'}},inputs:{materials:{version:1,candidate:{rows:[{values:{lineNumber:'1',partNumber:'TEST',quantity:'1',description:'Synthetic'},componentType:'STANDARD_COTS',alternates:[{partNumber:'ALT-TEST'}]}]},package:{documents:[]}},manufacturing:{id:'MFG-TEST',governingDocumentId:'DOC-TEST',package:{documents:[{documentId:'DOC-TEST',name:'synthetic.pdf',role:'GOVERNING',documentType:'ASSEMBLY_DRAWING'}]}}}};
let requested = null, rejectWrite = false, status = 'IN_PROGRESS';
const mount = {innerHTML:'',dataset:{workspaceLoaded:'true'},querySelector:()=>({value:status})};
let navigationListener;
const document = {addEventListener:(name,fn)=>{navigationListener=fn;},body:{dataset:{simRuntime:'true'}},querySelector:()=>mount};
const window = {document,DleOsCapabilities:{can:()=>true},DleWorkspaceShell:{navigate:r=>{requested=r;}},fetch:async(url,options)=>{
  if(options.method){requested={url,...JSON.parse(options.body)}; if(rejectWrite)return{ok:false,json:async()=>({message:'Write rejected'})};fixture.lanes[url.endsWith('materials')?'materials':'labor'].status=requested.status;fixture.status='IN_PROGRESS';}
  return{ok:true,json:async()=>options.method?structuredClone(fixture):{items:[structuredClone(fixture)]}};
}};
const context=vm.createContext({window,document}); vm.runInContext(registry,context); vm.runInContext(source,context);
assert.ok(window.DleWorkspaceRegistry.all().some(w=>w.id==='rfqs'));
document.body.dataset.simRuntime='false';assert.equal(window.DleWorkspaceRegistry.getById('rfqs'),null);document.body.dataset.simRuntime='true';
await window.DleWorkspaces.rfqs.render();
assert.match(mount.innerHTML,/Overall RFQ Status/); assert.match(mount.innerHTML,/Synthetic &lt;RFQs&gt;/);
const click=dataset=>mount.onclick({target:{closest:()=>({dataset})}});
await click({rfq:fixture.intakeId});assert.match(mount.innerHTML,/View Technical Review/);assert.match(mount.innerHTML,/Open Materials/);assert.match(mount.innerHTML,/Open Labor/);
let dedicated=false;window.DleMaterialsWorkbench={open:async()=>{dedicated=true;}};await click({open:'materials'});assert.ok(dedicated);assert.doesNotMatch(mount.innerHTML,/Save Materials status/);
await click({open:'labor'});assert.match(mount.innerHTML,/documents\/DOC-TEST/);assert.doesNotMatch(mount.innerHTML,/documents\/undefined/);
await click({save:'labor'});assert.equal(requested.status,'IN_PROGRESS');assert.equal(fixture.lanes.materials.status,'NOT_STARTED');
rejectWrite=true;await click({save:'labor'});assert.match(mount.innerHTML,/Write rejected/);assert.equal(fixture.lanes.labor.status,'IN_PROGRESS');
window.DleWorkspaces['technical-review']={openReview:async id=>{requested=id;}};
await click({action:'source'});assert.equal(requested,fixture.intakeId);
navigationListener({detail:{workspace:{id:'rfqs'},requestedState:{intakeId:fixture.intakeId}}});await window.DleWorkspaces.rfqs.render();assert.match(mount.innerHTML,/View Technical Review/);
console.log('PASS: RFQs SIM-only registry, escaped queue, shared lanes, immutable input views, document references, independent status writes, rejected-write preservation and Technical Review navigation.');

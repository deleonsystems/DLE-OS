const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const root=process.env.DLE_TEST_REPO||path.resolve(__dirname,'../..');
const load=n=>fs.readFileSync(path.join(root,'SRC/workspaces',n),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const wo='0999997',stamp='2026-10-18T03:40:38.8220902+00:00';
const expected={caseId:'case',workingVersion:26,releasedBomIdentity:'bom',state:'KIT_COMPLETE',submissionId:'final'};
const review={workOrderNumber:wo,kittingCase:{...expected,workOrderNumber:wo}};
const snapshot={caseId:'case',workOrderNumber:wo,releasedBomIdentity:'bom',submissionId:'final',submissionType:'KIT_COMPLETE',submittedBy:'Recorded operator',submittedAtUtc:stamp};
const history={workOrderNumber:wo,submissions:[{...snapshot,snapshotJson:JSON.stringify(snapshot)}]};
let passed=0;
function context(fetch){const w={addEventListener(){},DleOsRuntimeConfig:{environment:'SIMULATION'}};const c=vm.createContext({window:w,document:{querySelector:()=>({})},fetch,structuredClone,sessionStorage:{getItem:()=>null,setItem(){}},URL,Response,console});vm.runInContext(load('rfqs/labor-traveler-print.js'),c);return c;}
async function helper(change,success=false){let a=clone(review),b=clone(review),h=clone(history),e=clone(expected),calls=0;const cfg={a,b,h,e};change?.(cfg);const c=context(async url=>({ok:true,json:async()=>url.endsWith('/submissions')?cfg.h:(++calls===1?cfg.a:cfg.b)}));if(success){const x=await c.window.DleLaborTravelerPrint.loadMaterialEvidence(wo,cfg.e);assert.equal(x.completedBy,cfg.a.kittingCase?.state==='KIT_COMPLETE'?'Recorded operator':'');}else await assert.rejects(()=>c.window.DleLaborTravelerPrint.loadMaterialEvidence(wo,cfg.e));passed++;}
(async()=>{
await helper(null,true);
for(const key of ['workOrderNumber','caseId','releasedBomIdentity','workingVersion','state'])await helper(c=>c.a.kittingCase[key]='wrong');
await helper(c=>c.a.workOrderNumber='0000001');await helper(c=>c.b.kittingCase.workingVersion++);
await helper(c=>c.h.workOrderNumber='0000001');await helper(c=>c.h.submissions=[]);
await helper(c=>c.h.submissions[0].snapshotJson='bad');await helper(c=>c.h.submissions[0].submittedBy='Forged');
await helper(c=>c.h.submissions[0].submittedAtUtc='invalid');await helper(c=>{const s=JSON.parse(c.h.submissions[0].snapshotJson);s.releasedBomIdentity='wrong';c.h.submissions[0].snapshotJson=JSON.stringify(s);});const unavailable=context(async()=>({ok:false,status:503}));await assert.rejects(()=>unavailable.window.DleLaborTravelerPrint.loadMaterialEvidence(wo,expected),/503/);passed++;await helper(c=>c.e.submissionId='different');await helper(c=>c.a.kittingCase=null);
await helper(c=>{c.a.kittingCase.state='KIT_SHORT';c.e.state='KIT_SHORT';},true);
await helper(c=>{c.a.kittingCase=null;c.e.caseId=null;},true);
const order={orderEntry:{acceptance:{id:'accepted',packageRevision:2,package:{technicalSource:{baseline:{quote:{intakeId:'quote'},labor:{operations:[]}}}}}}};
const remote={definitionId:'def',quantity:25,version:0,baselineVersion:1,baselineToken:'token',released:true,operations:[]};
const packet={workOrderNumber:wo,context:{assembly:'A',revision:'B',quantity:25},source:{acceptanceId:'accepted',acceptedRevision:2,manufacturingDefinitionId:'def',laborVersion:1,releasedBomIdentity:'bom',qualityRelease:{baselineToken:'token',instructionVersion:0}},kitting:{...expected}};
async function adapter(change,valid){const cfg={packet:clone(packet),history:clone(history)};change?.(cfg);const methods=[];const c=context(async(url,init={})=>{methods.push(init.method||'GET');return {ok:true,status:200,json:async()=>url.endsWith('/instructions/sources')?{baselineToken:'token'}:url.endsWith('/instructions')?remote:url.includes('kitting-cases')?(url.endsWith('/submissions')?cfg.history:review):cfg.packet};});c.window.DleLaborWorkbench={};c.window.DleLaborSlides={connect:o=>{c.captured=o;return {playSequence:async()=>true};}};vm.runInContext(load('kitting/production-instruction-editor.js'),c);await c.window.DleJobInstructions.open({wo,job:{context:packet.context},order,quality:true,readOnly:true,material:{status:'FORGED',completedBy:'FORGED'}});if(valid){assert.equal(c.captured.travelerMaterial().completedBy,'Recorded operator');assert(!c.captured.contextNotice.includes('unavailable'));}else{assert.equal(c.captured.travelerMaterial(),undefined);assert(c.captured.contextNotice.includes('Material completion unavailable'));}assert.equal(c.captured.canEdit(),false);assert(methods.every(m=>m==='GET'));passed++;}
await adapter(null,true);
for(const key of ['acceptanceId','acceptedRevision','manufacturingDefinitionId','laborVersion','releasedBomIdentity'])await adapter(c=>c.packet.source[key]='wrong',false);
await adapter(c=>c.packet.workOrderNumber='0000001',false);await adapter(c=>c.packet.source.qualityRelease.baselineToken='wrong',false);await adapter(c=>c.packet.source.qualityRelease.instructionVersion=99,false);await adapter(c=>c.packet.context.quantity=24,false);await adapter(c=>c.history.submissions=[],false);
console.log('PASS '+passed+' material evidence and shared-adapter cases: exact identity, stale/missing/malformed evidence, short/no-case, ignored caller data, read-only behavior.');
})().catch(e=>{console.error(e);process.exitCode=1;});

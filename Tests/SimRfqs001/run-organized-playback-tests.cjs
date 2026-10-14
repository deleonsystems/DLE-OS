const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{webcrypto}=require('crypto');
let shown;
const source={documentId:'pdf',sha256:'A'.repeat(64),name:'Drawing',definitionId:'D',assembly:'A',revision:'B'};
const window={crypto:webcrypto,fetch:async url=>({ok:true,json:async()=>url.endsWith('/info')?{pageCount:3}:{source}}),DleLaborDrawingNotes:{open:async o=>shown=o}};
for(const f of ['labor-workbench','labor-slides'])vm.runInNewContext(fs.readFileSync('SRC/workspaces/rfqs/'+f+'.js','utf8'),{window,document:{},structuredClone,TextEncoder,Response,clearTimeout});
const uid=()=>webcrypto.randomUUID(),card=(kind,page=1)=>({id:uid(),kind,title:kind+page,body:'',page,...(kind==='DRAWING'?{source}:{}),stages:[{id:uid(),name:'Stage',marks:[{id:uid(),page,kind:'arrow',points:[{x:.2,y:.2},{x:.4,y:.4}]}],photos:[{id:uid(),documentId:'image',sha256:'B'.repeat(64),x:.1,y:.1,width:.2,height:.2}],savedView:{page,x:.5,y:.5,width:1,height:1,rotation:0}}]});
const original=card('DRAWING',2),copy=window.DleLaborSlides.duplicate(original);
assert.notEqual(copy.id,original.id);assert.notEqual(copy.stages[0].id,original.stages[0].id);assert.notEqual(copy.stages[0].marks[0].id,original.stages[0].marks[0].id);assert.notEqual(copy.stages[0].photos[0].id,original.stages[0].photos[0].id);
assert.equal(JSON.stringify(copy.source),JSON.stringify(original.source));copy.stages[0].marks[0].points[0].x=.9;copy.stages[0].photos[0].x=.7;assert.equal(original.stages[0].marks[0].points[0].x,.2);assert.equal(original.stages[0].photos[0].x,.1);
const plan={operations:[{id:'k',name:'Kitting',slidesOrganized:true,slides:[card('START'),card('END')]},{id:'p',name:'SMT',slidesOrganized:true,slides:[card('START'),original,card('NOTE'),card('END')]},{id:'s',parentId:'p',name:'Child',instructions:'Linked notes',slides:[copy]}]};
const controller=window.DleLaborSlides.connect({getPlan:()=>plan,intakeId:'X',canEdit:()=>true,supported:()=>true});
(async()=>{await controller.playSequence(plan.operations,null);const frames=[];for(;;){frames.push({kind:shown.slide.kind,owner:shown.stepId,page:shown.slide.layer.page});if(!shown.hasNext)break;shown.onAdvance(1);await new Promise(setImmediate);}
assert.deepEqual(frames.map(x=>x.kind),['START','DRAWING','NOTE','SUBSTEP','DRAWING','END']);assert(frames.filter(x=>x.kind==='DRAWING').every(x=>x.page===2));assert.equal(frames[4].owner,'s');assert(!frames.some(x=>x.owner==='k'));
console.log('PASS organized playback: no regenerated removed pages, exact order, protected linked notes, child ownership, Materials exclusion, independent IDs/marks/photos with immutable sources');})().catch(e=>{console.error(e);process.exitCode=1;});

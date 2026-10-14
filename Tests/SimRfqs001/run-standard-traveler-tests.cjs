const fs=require('fs'),assert=require('assert/strict'),vm=require('vm'),{webcrypto}=require('crypto');
let shown,changes=0,missing=false;
const source={documentId:'pdf',sha256:'A'.repeat(64),name:'Assembly.pdf',revision:'B',assembly:'Fixture',definitionId:'fixture'};
const window={crypto:webcrypto,fetch:async url=>missing?{ok:false}:{ok:true,json:async()=>url.endsWith('/info')?{pageCount:3}:{source}},DleLaborDrawingNotes:{open:async o=>{shown=o;}},alert:()=>{}};
for(const f of ['labor-workbench','labor-slides'])vm.runInNewContext(fs.readFileSync('SRC/workspaces/rfqs/'+f+'.js','utf8'),{window,document:{},structuredClone,clearTimeout,TextEncoder,Response});
const stage=(page=1)=>({id:webcrypto.randomUUID(),name:'Stage',marks:[],savedView:{page,x:.5,y:.5,width:1,height:1,rotation:0}});
const card=(kind,page=1)=>({id:webcrypto.randomUUID(),kind,title:kind,body:'Preserved authored text',page,stages:[stage(page)]});
const drawing={...card('DRAWING',2),source},start=card('START'),blank=card('BLANK');
let plan={definitionId:'fixture',operations:[{id:'kit',name:'Kitting',slides:[]},{id:'a',name:'SMT',instructions:'Main instructions',slides:[blank,drawing,start]},{id:'n',parentId:'a',name:'Notes only',instructions:'Useful notes',slides:[]},{id:'s',parentId:'a',name:'Slides only',slides:[card('NOTE')]},{id:'e',parentId:'a',name:'Empty',slides:[]},{id:'b',name:'Inspection',slides:[]}]};
const controller=window.DleLaborSlides.connect({intakeId:'fixture',getPlan:()=>plan,canEdit:()=>true,supported:()=>true,onChange:()=>changes++});
const tick=()=>new Promise(setImmediate);
async function move(n){shown.onAdvance(n);await tick();}
(async()=>{
 const before=JSON.stringify(plan);await controller.playSequence(plan.operations,null);
 assert.equal(shown.slide.kind,'START');assert.equal(shown.slide.summary.substeps.length,3);assert.deepEqual(Array.from(shown.slide.summary.substeps,s=>s.linked),[true,true,false]);assert.equal(shown.slide.summary.notes,'Main instructions');
 const sequence=[];for(let i=0;i<13;i++){sequence.push([shown.stepId,shown.slide.kind,shown.slide.layer.page]);if(i<12)await move(1);}
 assert.deepEqual(sequence,[['a','START',1],['a','DRAWING',1],['a','DRAWING',2],['a','DRAWING',3],['a','BLANK',1],['n','SUBSTEP',1],['s','NOTE',1],['a','END',1],['b','START',1],['b','DRAWING',1],['b','DRAWING',2],['b','DRAWING',3],['b','END',1]]);
 assert.equal(shown.slide.summary.sectionLabel,'End of traveler');assert.equal(JSON.stringify(plan),before);assert.equal(changes,0);
 await move(-5);assert.equal(shown.slide.summary.sectionLabel,'Next Step: Inspection');
 await controller.playSequence(plan.operations,null);shown.onJump('n');await tick();assert.equal(shown.slide.summary.notes,'Useful notes');
 await controller.playSequence(plan.operations,null);await move(1);const id=shown.slide.layer.layerId;await shown.onEdit();assert(shown.editable);assert.equal(shown.slide.kind,'DRAWING');
 const layer=structuredClone(shown.slide.layer);layer.marks=[{id:webcrypto.randomUUID(),kind:'line',page:1,points:[{x:.1,y:.1},{x:.8,y:.8}]}];await shown.slide.save(layer);shown.onClose();await tick();assert.equal(shown.slide.layer.marks.length,1);assert.equal(plan.operations[1].slides.length,4);
 for(let repeat=0;repeat<3;repeat++){await controller.playSequence(plan.operations,null);await move(1);assert.equal(shown.slide.layer.layerId,id);assert.equal(shown.slide.layer.marks.length,1);await move(1);assert.equal(shown.slide.layer.layerId,drawing.stages[0].id);assert.equal(shown.slide.layer.marks.length,0);await move(7);assert.equal(shown.stepId,'b');assert.equal(shown.slide.layer.marks.length,0);}
 assert.equal(plan.operations[1].slides.length,4);assert.deepEqual(plan.operations[1].slides.slice(0,3),[blank,drawing,start]);
 plan=structuredClone(plan);await controller.playSequence(plan.operations,null);await move(1);assert.equal(shown.slide.layer.marks.length,1,'saved/reloaded model retains overlay');
 plan.operations=[plan.operations[0],plan.operations.at(-1),...plan.operations.slice(1,-1)];await controller.playSequence(plan.operations,null);await move(4);assert.equal(shown.slide.summary.sectionLabel,'Next Step: SMT');plan.operations=plan.operations.filter(o=>o.id!=='a'&&o.parentId!=='a');await controller.playSequence(plan.operations,null);await move(4);assert.equal(shown.slide.summary.sectionLabel,'End of traveler');
 missing=true;const old=JSON.stringify(plan);await controller.playSequence(plan.operations,null);await move(1);assert.equal(shown.slide.kind,'NOTE');assert.match(shown.slide.caption,/unavailable/);assert.equal(shown.onEdit,null);await move(1);assert.equal(shown.slide.kind,'END');assert.equal(JSON.stringify(plan),old);
 await controller.play(plan.operations[0],null);await move(2);assert.equal(shown.slide.summary.sectionLabel,'End of Materials / Kit');
 console.log('PASS standard traveler: 3 actual pages, reused authored IDs, content order/links, no open-time writes, independent overlays, stable reopen, model save/reload, reorder/delete next labels, final boundary, missing drawing, Materials/Kit isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});

const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const root=process.env.INSPECTION_ROOT||path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,'SRC/workspaces/rfqs',f),'utf8');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{for(const [width,height]of [[1440,1000],[1024,768],[390,844]]){if(process.env.INSPECTION_WIDTH&&width!==+process.env.INSPECTION_WIDTH)continue;
 const page=await browser.newPage({viewport:{width,height},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://links.test/',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));await page.goto('https://links.test/');await page.setContent('<style>'+read('labor-workbench.css')+'</style><body></body>');await page.addScriptTag({content:read('labor-drawing-notes.js')});
 await page.evaluate(()=>{
  const uid=()=>crypto.randomUUID(),view={page:1,x:.5,y:.5,width:1,height:1,rotation:0};window.ops=[{id:uid(),slides:[0,1,2].map(i=>({id:uid(),kind:'BLANK',page:1,title:'Sheet '+i,stages:[{id:uid(),marks:[],savedView:structuredClone(view)}]}))}];window.session=DleInspectionLinks.create(()=>ops,()=> 'DEF');window.writes=0;
  window.openSheet=async index=>{const op=ops[0],card=op.slides[index],stage=card.stages[0];await DleLaborDrawingNotes.open({intakeId:'isolated',stepId:op.id,stepLabel:card.title,editable:true,compactControls:true,slide:{kind:'BLANK',inspectionSymbolsSupported:true,inspectionLinksSupported:true,inspectionAuthoring:session.forStage(op,card,stage),layer:{layerId:stage.id,stepId:op.id,stepIds:[op.id],name:card.title,source:{documentId:'slide-'+card.id,sha256:'',assembly:'FIXTURE',revision:'A',name:card.title},marks:structuredClone(stage.marks),savedView:stage.savedView,revision:1},loadBase:async()=>new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/></svg>',{headers:{'content-type':'image/svg+xml'}}),save:async layer=>{session.forStage(op,card,stage).validate(layer.marks);stage.marks=structuredClone(layer.marks);writes++;}}});};
 });
 const open=async i=>{await page.evaluate(i=>openSheet(i),i);await page.waitForFunction(()=>!!document.querySelector('image')?.getAttribute('href'));};
 const menu=async()=>{await page.locator('[data-compact-tools]').click();await page.locator('[data-inspection-tools]').click();};
 const done=()=>page.locator('[data-tool-done]').click(),save=async()=>{await page.locator('[data-save]').click();await page.waitForFunction(()=>!document.querySelector('[data-save]').disabled||document.querySelector('.labor-drawing-status').textContent.includes('updated'));};
 const back=async()=>{await page.locator('[data-back]').click();await page.locator('.labor-annotation-viewer').waitFor({state:'detached'});};
 const pos=async(x,y)=>page.locator('[data-paper]').evaluate((n,{x,y})=>{const p=n.ownerSVGElement.createSVGPoint();p.x=x*1200;p.y=y*800;const q=p.matrixTransform(n.getScreenCTM());return{x:q.x,y:q.y};},{x,y});
 const tap=async(x,y)=>{const p=await pos(x,y);await page.mouse.click(p.x,p.y);};
 const select=async(x,y)=>{await page.locator('[data-compact-tools]').click();await page.locator('[data-quick-tool="pan"]').click();await tap(x,y);};

 const dragSlider=async(name,fraction)=>{const slider=page.locator('[data-inspection-'+name+']'),b=await slider.boundingBox(),values=await slider.evaluate(n=>({value:+n.value,min:+n.min,max:+n.max}));const position=(values.value-values.min)/(values.max-values.min);if(Math.abs(position-fraction)<.15)fraction=position>.5?.15:.85;const start=b.x+8+(b.width-16)*(values.value-values.min)/(values.max-values.min),end=b.x+8+(b.width-16)*fraction;await page.mouse.move(start,b.y+b.height/2);await page.mouse.down();await page.mouse.move(end,b.y+b.height/2,{steps:12});};
 await open(0);await menu();await done();await tap(.3,.4);await save();
 const id=await page.evaluate(()=>ops[0].slides[0].stages[0].marks[0].id),mark=page.locator('[data-mark-id="'+id+'"]');
 await menu();await page.screenshot({path:path.join(require('os').tmpdir(),'inspection-slider-panel-'+width+'.png')});const before=await mark.boundingBox();await dragSlider('size',.7);const during=await mark.boundingBox();await page.mouse.up();assert(during.width>before.width+20,'selected freshly placed circle must resize during a real slider drag');
 
 await page.mouse.up();await done();await save();await back();
 const center=m=>({x:(m.points[0].x+m.points[1].x)/2,y:(m.points[0].y+m.points[1].y)/2});
 for(const shape of ['circle','triangle','square','diamond'])for(const role of ['unlinked','parent','child']){
  await page.evaluate(({shape,role})=>{
   const op=ops[0];for(const c of op.slides)c.stages[0].marks=[];
   const mark={id:crypto.randomUUID(),page:1,kind:'inspection-'+shape,points:[{x:.4,y:.4},{x:.5,y:.55}],color:'#1255cc',thickness:.002};
   window.legacy={id:crypto.randomUUID(),page:1,kind:'circle',points:[{x:.1,y:.1},{x:.2,y:.2}],color:'#cc1122',thickness:.003};op.slides[0].stages[0].marks=[mark,structuredClone(legacy)];
   if(role!=='unlinked'){const parentIndex=role==='parent'?0:1,childIndex=1-parentIndex,other={...structuredClone(mark),id:crypto.randomUUID()};op.slides[1].stages[0].marks=[other];const parent=parentIndex===0?mark:other,child=parentIndex===0?other:mark;
    parent.kind+='-parent';parent.inspection={role:'parent',groupId:parent.id,expected:1,anchor:session.anchor(op,op.slides[parentIndex],op.slides[parentIndex].stages[0])};child.kind+='-child';child.inspection={role:'child',groupId:parent.id,anchor:session.anchor(op,op.slides[childIndex],op.slides[childIndex].stages[0])};}
   op.slides[0].stages[0].savedView={page:1,x:.5,y:.5,width:role==='child'?.3:1,height:role==='child'?.3:1,rotation:0};session.stop();window.targetId=mark.id;
  },{shape,role});
  await open(0);await select(.45,.475);const target=await page.evaluate(()=>targetId),node=page.locator('[data-mark-id="'+target+'"]');await menu();
  assert.equal(await page.locator('[data-inspection-width]').getAttribute('aria-label'),'Line thickness');assert.equal(await page.locator('[data-inspection-width]').getAttribute('title'),'Line thickness');assert.match(await page.locator('[data-inspection-width]').locator('..').innerText(),/Line thickness/);
  const original=await page.evaluate(()=>structuredClone(ops[0].slides[0].stages[0].marks[0]));
  if(shape==='circle'&&role==='parent'){await done();await page.locator('[data-compact-view]').click();await page.locator('[data-in]').click();await done();await menu();}
  for(const fraction of [.9,.2]){const before=await node.boundingBox();await dragSlider('size',fraction);const during=await node.boundingBox();assert(Math.abs(during.width-before.width)>3,shape+' '+role+' must visibly resize before pointerup');assert.equal(await page.locator('[data-shape-mark="'+target+'"]').count()>0,true,'selection remains while dragging');await page.mouse.up();}
  await done();await save();const resized=await page.evaluate(()=>structuredClone(ops[0].slides[0].stages[0].marks[0]));assert(Math.abs(center(resized).x-center(original).x)<1e-10);assert(Math.abs(center(resized).y-center(original).y)<1e-10);assert.deepEqual(resized.inspection,original.inspection);
  await menu();const oldWidth=+(await node.getAttribute('stroke-width'));await dragSlider('width',.8);assert(Math.abs(+(await node.getAttribute('stroke-width'))-oldWidth)>.01,shape+' '+role+' line thickness visibly changes during pointer drag');await page.mouse.up();await done();await save();
  const thick=await page.evaluate(()=>structuredClone(ops[0].slides[0].stages[0].marks[0]));assert.deepEqual(thick.points,resized.points);assert.deepEqual(thick.inspection,original.inspection);
  await page.locator('[data-undo]').click();await save();assert.deepEqual(await page.evaluate(()=>ops[0].slides[0].stages[0].marks[0]),resized,'one undo restores the entire thickness drag');
  assert.deepEqual(await page.evaluate(()=>ops[0].slides[0].stages[0].marks[1]),await page.evaluate(()=>legacy));await back();await open(0);assert.deepEqual(await page.evaluate(()=>ops[0].slides[0].stages[0].marks[0]),resized);await select(center(resized).x,center(resized).y);await menu();await dragSlider('size',.6);await page.mouse.up();assert(await page.locator('[data-delete-annotation]').isVisible());await done();await save();await back();
 }
 // At a page edge, cap size instead of moving the symbol's center/location.
 await page.evaluate(()=>{const op=ops[0];for(const c of op.slides)c.stages[0].marks=[];op.slides[0].stages[0].savedView={page:1,x:.5,y:.5,width:1,height:1,rotation:0};op.slides[0].stages[0].marks=[{id:crypto.randomUUID(),page:1,kind:'inspection-circle',points:[{x:.01,y:.4},{x:.03,y:.43}],thickness:.002,color:'#1255cc'}];});
 await open(0);await select(.02,.415);await menu();await dragSlider('size',1);await page.mouse.up();await done();await save();const edge=await page.evaluate(()=>ops[0].slides[0].stages[0].marks[0]);assert(Math.abs(center(edge).x-.02)<1e-10);assert(Math.abs(center(edge).y-.415)<1e-10);assert(edge.points[0].x>=-1e-10);await back();
 assert.deepEqual(errors,[]);console.log('PASS pointer sliders',width,': new circle; all four shapes unlinked/parent/child; repeated drag; changed zoom; selection/center/link preservation; undo; save/reopen; edge clamp; legacy; accessible Line thickness');await page.close();
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

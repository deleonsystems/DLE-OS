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
 const center=m=>({x:(m.points[0].x+m.points[1].x)/2,y:(m.points[0].y+m.points[1].y)/2});
 const markData=()=>page.evaluate(()=>structuredClone(ops[0].slides[0].stages[0].marks));
 for(const [si,shape]of ['circle','triangle','square','diamond'].entries())for(const role of ['unlinked','parent','child']){
  const panelOpen=role!=='parent',zoom=role==='parent',cx=panelOpen?.18:.5,cy=panelOpen?.85:.5;
  await page.evaluate(({shape,role,cx,cy,zoom,si})=>{
   const op=ops[0];for(const c of op.slides)c.stages[0].marks=[];session.stop();
   const mark={id:crypto.randomUUID(),page:1,kind:'inspection-'+shape+(si%2?'-filled':''),points:[{x:cx-.035,y:cy-.0525},{x:cx+.035,y:cy+.0525}],color:'#1255cc',thickness:.002};
   window.legacy={id:crypto.randomUUID(),page:1,kind:'circle',points:[{x:.75,y:.15},{x:.85,y:.25}],color:'#cc1122',thickness:.003};op.slides[0].stages[0].marks=[mark,structuredClone(legacy)];
   if(role!=='unlinked'){const parentIndex=role==='parent'?0:1,childIndex=1-parentIndex,other={...structuredClone(mark),id:crypto.randomUUID()};op.slides[1].stages[0].marks=[other];const parent=parentIndex===0?mark:other,child=parentIndex===0?other:mark;
    parent.kind+='-parent';parent.inspection={role:'parent',groupId:parent.id,expected:2,anchor:session.anchor(op,op.slides[parentIndex],op.slides[parentIndex].stages[0])};child.kind+='-child';child.inspection={role:'child',groupId:parent.id,anchor:session.anchor(op,op.slides[childIndex],op.slides[childIndex].stages[0])};}
   op.slides[0].stages[0].savedView={page:1,x:.5,y:.5,width:zoom?.4:1,height:zoom?.4:1,rotation:0};window.targetId=mark.id;window.original=structuredClone(mark);
  },{shape,role,cx,cy,zoom,si});
  await open(0);await menu();if(!panelOpen)await done();
  const target=await page.evaluate(()=>targetId),node=page.locator('[data-mark-id="'+target+'"]'),at=await pos(cx,cy);
  await page.mouse.move(at.x,at.y);assert.equal(await page.locator('[data-shape-mark="'+target+'"]').count(),0,'hover alone does not select or alter marks');
  if(role==='child')await page.touchscreen.tap(at.x,at.y);else await page.mouse.click(at.x,at.y);
  assert.equal(await page.locator('[data-compact-tools]').innerText(),'Select',shape+' '+role+': existing hit leaves placement mode');
  assert(await page.locator('[data-shape-mark="'+target+'"]').count()>0,'existing symbol selected');
  assert.equal(await page.locator('[data-mark-id]').count(),2,'selection must not create a duplicate');
  for(let i=0;i<3;i++)await page.mouse.click(at.x,at.y);
  assert.equal(await page.locator('[data-mark-id]').count(),2,'repeated hits must not create marks');
  assert(await page.locator('[data-undo]').isDisabled(),'selection and no-op handle taps must not create undo entries');
  await menu();assert.equal(await page.locator('[data-inspection-parent]').isDisabled(),role==='child');
  const before=await node.boundingBox();await dragSlider('size',.65);const during=await node.boundingBox();assert(Math.abs(during.width-before.width)>2,'selected symbol resizes during native drag');await page.mouse.up();await done();await save();
  const resized=(await markData())[0],original=await page.evaluate(()=>original);assert.deepEqual(resized.inspection,original.inspection);assert(Math.abs(center(resized).x-cx)<1e-10);assert(Math.abs(center(resized).y-cy)<1e-10);
  await page.locator('[data-undo]').click();await save();assert.deepEqual((await markData())[0],original,'undo size restores original');
  // Selection via active tool also permits move, with links and history preserved.
  await menu();await done();const start=await pos(cx,cy),end=await pos(cx+.025,cy-.025);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();await save();
  const moved=(await markData())[0];assert.deepEqual(moved.inspection,original.inspection);assert(Math.abs(center(moved).x-cx)>.001);await page.locator('[data-undo]').click();await save();assert.deepEqual((await markData())[0],original);
  assert.deepEqual((await markData())[1],await page.evaluate(()=>legacy));await back();await open(0);await menu();await done();await tap(cx,cy);assert.equal(await page.locator('[data-mark-id]').count(),2);assert.equal(await page.locator('[data-compact-tools]').innerText(),'Select');
  await page.locator('[data-delete-annotation]').click();assert.equal(await page.locator('[data-mark-id]').count(),role==='parent'?2:1,'direct selection preserves parent deletion guard');
  if(role!=='parent'){await save();await page.locator('[data-undo]').click();await save();assert.deepEqual((await markData())[0],original,'undo restores directly selected symbol and links');}await back();
 }
 // Empty-paper dismissal remains inert; a subsequent deliberate click creates one symbol.
 await page.evaluate(()=>{for(const c of ops[0].slides)c.stages[0].marks=[];ops[0].slides[0].stages[0].savedView={page:1,x:.5,y:.5,width:1,height:1,rotation:0};session.stop();});
 await open(0);await menu();await tap(.18,.85);assert.equal(await page.locator('[data-mark-id]').count(),0);await tap(.18,.85);assert.equal(await page.locator('[data-mark-id]').count(),1);await save();
 const fresh=await page.evaluate(()=>ops[0].slides[0].stages[0].marks[0]),freshCenter=center(fresh);await tap(freshCenter.x,freshCenter.y);assert.equal(await page.locator('[data-compact-tools]').innerText(),'Select','small selected symbol handles also enter editing');await menu();assert(!await page.locator('[data-inspection-parent]').isDisabled());await page.locator('[data-inspection-parent]').click();await done();await save();
 await back();await open(1);await page.locator('[data-inspection-place]').click();await tap(.35,.5);await save();assert.equal(await page.evaluate(()=>ops[0].slides[1].stages[0].marks.length),1);assert.equal(await page.evaluate(()=>ops[0].slides[1].stages[0].marks[0].inspection.groupId),fresh.id);assert.match(await page.locator('[data-inspection-count]').innerText(),/1\/2 placed/);
 await page.locator('[data-inspection-place]').click();await page.locator('[data-inspection-place]').click();await tap(.65,.5);assert.equal(await page.locator('[data-mark-id]').count(),1,'cancel child placement does not create anything');
 await page.locator('[data-inspection-place]').click();await tap(.65,.5);await save();assert.match(await page.locator('[data-inspection-count]').innerText(),/2\/2 placed/);assert(await page.locator('[data-inspection-place]').isDisabled());await back();
 assert.deepEqual(errors,[]);console.log('PASS direct inspection selection',width,': four shapes/open-filled/parent-child; mouse and touch; open tray; repeated hits/no extra undo; zoom; slider; move/undo; save/reopen; legacy; empty dismissal; explicit child placement/cancel/count');await page.close();
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

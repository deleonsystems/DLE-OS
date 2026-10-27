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
 const getMarks=()=>page.evaluate(()=>structuredClone(ops[0].slides[0].stages[0].marks));
 const transform=()=>page.locator('[data-paper]').evaluate(n=>{const m=n.getScreenCTM();return [m.a,m.b,m.c,m.d,m.e,m.f];});
 const cdp=await page.context().newCDPSession(page);
 await page.evaluate(()=>{window.pointerKinds=[];document.addEventListener('pointerdown',e=>pointerKinds.push(e.pointerType),true);});
 async function drag(start,dx,dy,type='mouse',during=()=>{},cancel=false){
  if(type==='touch'){
   const point=(x,y)=>({x,y,id:1,radiusX:5,radiusY:5,force:1});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(start.x,start.y)]});
   for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(start.x+dx*i/8,start.y+dy*i/8)]});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await during();await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  }else{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+dx,start.y+dy,{steps:8});await during();await page.mouse.up();}
 }
 const moveAssert=async(node,dx,dy,type)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const before=await node.boundingBox(),matrix=await transform();await drag({x:before.x+before.width/2,y:before.y+before.height/2},dx,dy,type,async()=>{const now=await node.boundingBox();assert(Math.abs(now.width-before.width)<.1,'selected drag must move, not resize width');assert(Math.abs(now.height-before.height)<.1,'selected drag must move, not resize height');assert(Math.abs(now.x-before.x-dx)<1.2,'symbol follows horizontal pointer movement');assert(Math.abs(now.y-before.y-dy)<1.2,'symbol follows vertical pointer movement');assert.deepEqual(await transform(),matrix,'moving a symbol must not pan or zoom paper during drag');});};
 await open(0);const baseMatrix=await transform(),baseScale=Math.hypot(baseMatrix[0],baseMatrix[1]);await back();
 for(const [si,shape]of ['circle','triangle','square','diamond'].entries())for(const filled of [false,true])for(const [ri,role]of ['unlinked','parent','child'].entries()){
  const pixels=[8,16,36][(si+ri+Number(filled))%3],panelOpen=role!=='parent',zoom=role==='parent'?.4:role==='child'?.65:1;
  const vx=role==='child'?.35:role==='parent'?.43:.5,vy=role==='child'?.6:role==='parent'?.51:.5,cx=panelOpen?vx-.32*zoom:vx,cy=panelOpen?vy+.35*zoom:vy;
  await page.evaluate(({shape,filled,role,pixels,baseScale,zoom,vx,vy,cx,cy})=>{
   const op=ops[0];for(const c of op.slides)c.stages[0].marks=[];session.stop();const side=pixels*zoom/baseScale;
   const mark={id:crypto.randomUUID(),page:1,kind:'inspection-'+shape+(filled?'-filled':''),points:[{x:cx-side/2400,y:cy-side/1600},{x:cx+side/2400,y:cy+side/1600}],color:'#1255cc',thickness:.002};
   window.legacy={id:crypto.randomUUID(),page:1,kind:'circle',points:[{x:.75,y:.15},{x:.85,y:.25}],color:'#cc1122',thickness:.003};op.slides[0].stages[0].marks=[mark,structuredClone(legacy)];
   if(role!=='unlinked'){const parentIndex=role==='parent'?0:1,childIndex=1-parentIndex,other={...structuredClone(mark),id:crypto.randomUUID()};op.slides[1].stages[0].marks=[other];const parent=parentIndex===0?mark:other,child=parentIndex===0?other:mark;
    parent.kind+='-parent';parent.inspection={role:'parent',groupId:parent.id,expected:2,anchor:session.anchor(op,op.slides[parentIndex],op.slides[parentIndex].stages[0])};child.kind+='-child';child.inspection={role:'child',groupId:parent.id,anchor:session.anchor(op,op.slides[childIndex],op.slides[childIndex].stages[0])};session.use(parent.id);}
   op.slides[0].stages[0].savedView={page:1,x:vx,y:vy,width:zoom,height:zoom,rotation:0};window.targetId=mark.id;window.original=structuredClone(mark);
  },{shape,filled,role,pixels,baseScale,zoom,vx,vy,cx,cy});
  await open(0);const target=await page.evaluate(()=>targetId),node=page.locator('[data-mark-id="'+target+'"]'),original=await page.evaluate(()=>original);
  if(filled)await select(cx,cy);else{await menu();await done();await tap(cx,cy);}
  assert(await page.locator('[data-shape-mark="'+target+'"]').count()>0,'select before drag');if(panelOpen)await menu();
  await moveAssert(node,18,-12,filled?'touch':'mouse');assert.equal(await page.locator('[data-mark-id]').count(),2,'no duplicate created');assert.equal(await page.locator('[data-compact-tools]').innerText(),'Select');await save();
  const moved=(await getMarks())[0];assert.deepEqual({...moved,points:original.points},original,'only points change');
  for(let i=0;i<2;i++){assert(Math.abs((moved.points[i].x-original.points[i].x)-(moved.points[0].x-original.points[0].x))<1e-10);assert(Math.abs((moved.points[i].y-original.points[i].y)-(moved.points[0].y-original.points[0].y))<1e-10);}
  if(role!=='unlinked')assert.match(await page.locator('[data-inspection-count]').innerText(),/1\/2 placed/);
  await moveAssert(node,-11,9,filled?'mouse':'touch');await save();await page.locator('[data-undo]').click();await save();assert.deepEqual((await getMarks())[0],moved,'one undo restores preceding move');
  await back();await open(0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const restored=await node.boundingBox(),expectedStart=await pos(center(moved).x,center(moved).y);assert(Math.abs(restored.x+restored.width/2-expectedStart.x)<.1);assert(Math.abs(restored.y+restored.height/2-expectedStart.y)<.1);
  await menu();await done();await tap(center(moved).x,center(moved).y);await moveAssert(node,8,-5,'mouse');await save();assert.deepEqual((await getMarks())[0].inspection,original.inspection);assert.deepEqual((await getMarks())[1],await page.evaluate(()=>legacy));await back();
 }
 // Both overlapping endpoint targets must resize the intended corner, with the opposite anchored.
 await page.evaluate(()=>{session.stop();for(const c of ops[0].slides)c.stages[0].marks=[];ops[0].slides[0].stages[0].savedView={page:1,x:.5,y:.5,width:1,height:1,rotation:0};});
 await open(0);await menu();await dragSlider('size',0);await page.mouse.up();await done();await tap(.25,.55);await save();
 let small=(await getMarks())[0],smallId=small.id,smallNode=page.locator('[data-mark-id="'+smallId+'"]');assert.notEqual(await page.locator('[data-compact-tools]').innerText(),'Select','fresh symbol retains shape tool before movement');await moveAssert(smallNode,17,-9,'mouse');await save();small=(await getMarks())[0];
 for(const index of [0,1]){const corner=await pos(small.points[index].x,small.points[index].y);await drag(corner,index===0?-24:24,index===0?-24:24,'mouse');await save();const resized=(await getMarks())[0];assert.deepEqual(resized.points[1-index],small.points[1-index],'opposite corner anchored');assert.notDeepEqual(resized.points[index],small.points[index],'nearest corner resized');await page.locator('[data-undo]').click();await save();assert.deepEqual((await getMarks())[0],small);await tap(center(small).x,center(small).y);}
 // Space-pan and a native two-finger pinch still navigate, then body drag still moves.
 const panStart=await pos(center(small).x,center(small).y),beforePan=await transform();await page.keyboard.down('Space');await drag(panStart,14,-8,'mouse');await page.keyboard.up('Space');assert.notDeepEqual(await transform(),beforePan);assert(await page.locator('[data-save]').isDisabled(),'space-pan does not edit the symbol');
 await moveAssert(smallNode,8,-5,'touch');await save();small=(await getMarks())[0];
 const pinchAt=await pos(center(small).x,center(small).y),beforePinch=await transform(),finger=(id,x)=>({id,x,y:pinchAt.y,radiusX:5,radiusY:5,force:1});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger(1,pinchAt.x),finger(2,pinchAt.x+60)]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger(1,pinchAt.x-10),finger(2,pinchAt.x+70)]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.notDeepEqual(await transform(),beforePinch);assert(await page.locator('[data-save]').isDisabled(),'pinch does not edit the symbol');await moveAssert(smallNode,8,-5,'mouse');await save();small=(await getMarks())[0];
 // A cancelled native touch drag must restore the selected symbol and its history.
 const beforeCancel=await smallNode.boundingBox();await drag({x:beforeCancel.x+beforeCancel.width/2,y:beforeCancel.y+beforeCancel.height/2},15,-8,'touch',()=>{},true);assert.deepEqual(await smallNode.boundingBox(),beforeCancel);
 await back();assert.deepEqual(errors,[]);const kinds=await page.evaluate(()=>pointerKinds);assert(kinds.includes('mouse')&&kinds.includes('touch'),'real browser mouse and touch pointer paths observed');console.log('PASS selected inspection movement',width,': four shapes/open-filled/unlinked-parent-child; 8/16/36px; selected-then-drag mouse and native touch; open/closed tray; Select/shape tool; zoom/pan transforms; repeated move; counts/IDs/size preserved; undo; save/reopen; both resize endpoints; touch cancel; legacy');await page.close();
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

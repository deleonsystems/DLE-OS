const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS?path.join(process.env.NODE_REPL_NODE_MODULE_DIRS,'playwright'):'playwright');
const root=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,'SRC/workspaces/rfqs',f),'utf8');
const output=process.env.INSPECTION_TEST_OUTPUT||path.join(require('os').tmpdir(),'dle-inspection-symbol-tests');fs.mkdirSync(output,{recursive:true});
(async()=>{for(const engine of (process.env.INSPECTION_ENGINES||'edge').split(',')){const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));try{
for(const [label,width,height,compact]of [['desktop',1440,1000,false],['tablet',1024,768,true],['phone',390,844,true]]){
 const page=await browser.newPage({viewport:{width,height},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://inspection.test/',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('https://inspection.test/');
 await page.setContent('<style>'+read('labor-workbench.css')+'</style><body data-view-mode="desktop"></body>');
 await page.evaluate(()=>{
  const source={documentId:'synthetic',sha256:'A'.repeat(64),assembly:'FIXTURE',revision:'A'},savedView={page:1,x:.5,y:.5,width:1,height:1,rotation:0};
  window.legacy=['circle','box','polygon','marker'].map((kind,i)=>({id:crypto.randomUUID(),page:1,kind,points:kind==='polygon'?[{x:.1,y:.1},{x:.2,y:.1},{x:.15,y:.2}]:[{x:.1+i*.2,y:.1},{x:.2+i*.2,y:.2}],text:'',color:'#c72116',thickness:.003}));
  window.layer={layerId:'fixture',stepId:'p',stepIds:['p'],name:'Fixture',source,marks:structuredClone(legacy),savedView,revision:1};window.support=true;window.writes=[];
  window.base=()=>new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/></svg>',{headers:{'content-type':'image/svg+xml'}});
  window.fetch=async(url,opt={})=>{if(url.includes('/pages/'))return base();if(opt.method==='PUT'){const b=JSON.parse(opt.body);writes.push(b);layer={...layer,marks:structuredClone(b.marks||layer.marks),savedView:b.savedView||layer.savedView,revision:layer.revision+1};return {ok:true,json:async()=>structuredClone(layer)};}return {ok:true,json:async()=>({contractVersion:2,inspectionSymbolsSupported:support,basicShapes:true,textTransforms:true,zoomSizedShapes:true,canEdit:true,canSaveView:true,laborRevision:1,source,layers:[{layer:structuredClone(layer)}]})};};
 });
 await page.addScriptTag({content:read('labor-drawing-notes.js')});
 const open=async()=>{await page.evaluate(compact=>DleLaborDrawingNotes.open({intakeId:'fixture',stepId:'p',stepLabel:'Fixture',editable:true,compactControls:compact,...(compact?{slide:{kind:'IMAGE',inspectionSymbolsSupported:support,layer:structuredClone(layer),loadBase:async()=>base(),save:async v=>{writes.push(v);layer=structuredClone(v);}}}:{})}),compact);await page.waitForFunction(()=>!!document.querySelector('image')?.getAttribute('href'));};
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const menu=async()=>{if(compact)await page.locator('[data-compact-tools]').click();await page.locator('[data-inspection-tools]').click();};
 const save=async()=>{await page.locator('[data-save]').click();await settle();};
 const point=async(x,y)=>page.locator('[data-paper]').evaluate((n,p)=>{const svg=n.ownerSVGElement,pt=svg.createSVGPoint();pt.x=p.x*1200;pt.y=p.y*800;const q=pt.matrixTransform(n.getScreenCTM());return{x:q.x,y:q.y};},{x,y});
 const drag=async(a,b,type='mouse')=>{if(type==='mouse'){await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:3});await page.mouse.up();}else await page.evaluate(({a,b})=>{const c=document.querySelector('.labor-annotation-canvas'),old=c.setPointerCapture;c.setPointerCapture=()=>{};for(const [type,p]of [['pointerdown',a],['pointermove',b],['pointerup',b]])c.dispatchEvent(new PointerEvent(type,{pointerId:7,pointerType:'touch',button:0,clientX:p.x,clientY:p.y,bubbles:true,cancelable:true}));c.setPointerCapture=old;},{a,b});};
 await open();await settle();
 assert.equal(await page.locator('[data-marks] ellipse').first().getAttribute('fill'),'none');assert.equal(await page.locator('[data-marks] rect').first().getAttribute('fill'),'none');
 for(const [i,shape]of ['circle','triangle','square','diamond'].entries())for(const filled of [false,true]){
  await menu();await page.locator('[data-inspection-shape="'+shape+'"]').click();await page.locator('[data-inspection-fill="'+(filled?'filled':'open')+'"]').click();await page.locator('[data-inspection-color]').fill('#1255cc');
  const size=await page.locator('[data-inspection-shape="'+shape+'"]').boundingBox();assert(size.height>=44&&size.width>=44);
  await page.locator('[data-tool-done]').click();const x=.12+i*.2,y=filled?.65:.4;await drag(await point(x,y),await point(x+.07,y+.12),compact?'touch':'mouse');await save();
  const m=await page.evaluate(()=>layer.marks.at(-1));assert.equal(m.kind,'inspection-'+shape+(filled?'-filled':''));assert.equal(m.color,'#1255cc');assert(Math.abs((m.points[1].x-m.points[0].x)*1200-(m.points[1].y-m.points[0].y)*800)<.01);
  assert.equal(await page.locator('[data-mark-id="'+m.id+'"]').getAttribute('fill'),filled?'#1255cc':'none');
 }
 assert.deepEqual(await page.evaluate(()=>layer.marks.slice(0,4)),await page.evaluate(()=>legacy),'legacy objects unchanged');
 // Repeated select taps must not create a new symbol or change its geometry.
 if(compact)await page.locator('[data-compact-tools]').click();await page.locator('[data-quick-tool="pan"]').click();if(!compact)await page.locator('[data-tool-done]').click();
 const selected=await page.evaluate(()=>structuredClone(layer.marks.at(-1))),center=await point((selected.points[0].x+selected.points[1].x)/2,(selected.points[0].y+selected.points[1].y)/2);
 for(let n=0;n<4;n++)await page.mouse.click(center.x,center.y);assert.equal(await page.locator('[data-marks]>[data-mark-id]').count(),12);assert(await page.locator('[data-delete-annotation]').isVisible());
 await drag(center,{x:center.x-20,y:center.y-10});await save();assert.notDeepEqual(await page.evaluate(()=>layer.marks.at(-1).points),selected.points);await page.locator('[data-undo]').click();await save();assert.deepEqual(await page.evaluate(()=>layer.marks.at(-1)),selected);
 await page.mouse.click(center.x,center.y);await page.locator('[data-delete-annotation]').click();assert.equal(await page.locator('[data-marks]>[data-mark-id]').count(),11);await page.locator('[data-undo]').click();if(await page.locator('[data-save]').isEnabled())await save();
 const before=await page.evaluate(()=>structuredClone(layer.marks));await page.locator('[data-back]').click();await page.locator('.labor-annotation-viewer').waitFor({state:'detached'});await open();assert.deepEqual(await page.evaluate(()=>layer.marks),before);assert.equal(await page.locator('[data-marks]>[data-mark-id]').count(),12);
 await menu();await page.screenshot({path:path.join(output,'inspection-'+engine+'-'+label+'.png')});await page.locator('[data-tool-done]').click();await page.locator('[data-back]').click();await page.locator('.labor-annotation-viewer').waitFor({state:'detached'});
 await page.evaluate(()=>support=false);await open();await menu();assert(await page.locator('[data-inspection-shape="circle"]').isDisabled());assert.match(await page.locator('[data-inspection-note]').textContent(),/activation/);assert.deepEqual(errors,[]);
 console.log('PASS',engine,label,'8 styles; color; 44px controls; legacy preservation; select/move/delete/undo; save/reopen; old-runtime guard');await page.close();
}
}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;});

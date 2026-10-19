const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=process.env.DLE_TEST_REPO||path.resolve(__dirname,'../..'),out=process.env.DLE_TEST_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'dle-highlighter-'));
(async()=>{const browser=await chromium.launch({channel:'msedge'});try{
 for(const [width,height] of [[1440,1000],[768,1024],[1024,768]]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://width.test/',r=>r.fulfill({contentType:'text/html',body:'<html><body data-view-mode="ipad"><main><input value="untouched worksheet"></main></body></html>'}));await page.goto('https://width.test/');
  await page.addStyleTag({content:fs.readFileSync(path.join(repo,'SRC/workspaces/rfqs/labor-workbench.css'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(repo,'SRC/workspaces/rfqs/labor-drawing-notes.js'),'utf8')});
  await page.evaluate(()=>{
   const source={documentId:'fixture',sha256:'A'.repeat(64),assembly:'Fixture',revision:'A',name:'Synthetic drawing'};
   window.saved={layerId:'layer',stepId:'op',stepIds:['op'],source,name:'Fixture',page:1,marks:[{id:'legacy',page:1,kind:'marker',points:[{x:.1,y:.1},{x:.2,y:.1}],thickness:.018,color:'#ffe000',text:''}],photos:[],savedView:{page:1,x:.5,y:.5,width:1,height:1,rotation:0},note:'',revision:1};
   window.saves=0;window.openFixture=()=>DleLaborDrawingNotes.open({intakeId:'fixture',stepId:'op',stepLabel:'Synthetic width check',editable:true,compactControls:true,canSaveView:true,slide:{kind:'NOTE',caption:'Width fixture',layer:structuredClone(saved),photosSupported:false,loadBase:()=>Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/></svg>',{headers:{'content-type':'image/svg+xml'}})),save:async layer=>{saved=structuredClone(layer);saves++;}}});
  });
  const open=async()=>{await page.evaluate(()=>openFixture());await page.waitForFunction(()=>document.querySelector('.labor-drawing-status')?.textContent==='Ready');};await open();
  const dock=page.locator('.labor-compact-dock');await dock.waitFor();
  const choose=async value=>{await page.locator('[data-compact-tools]').click();await page.locator('[data-quick-tool="'+value+'"]').click();};
  const tray=page.locator('[aria-label="Tool settings"]');
  assert(await tray.isHidden());assert((await page.locator('.labor-annotation-canvas').boundingBox()).height>height*.8,'drawing fills most of screen');
  await choose('marker');assert(await tray.isHidden(),'selecting Highlighter does not expand colors');
  await page.locator('[data-compact-color]').tap();assert(await tray.isVisible());assert.equal(await page.locator('[data-highlighter-color]').count(),21);
  assert.equal(await page.locator('.labor-highlighter-palette th,.labor-highlighter-palette caption').count(),0);
  assert(await tray.locator('.labor-tray-heading').isHidden());assert(await tray.locator('[data-thickness]').isHidden(),'color-only popup excludes width slider');
  const squares=await page.locator('[data-highlighter-color]').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,label:n.getAttribute('aria-label'),title:n.title};}));
  assert(squares.every(r=>r.w>=44&&r.h>=44&&Math.abs(r.w-r.h)<1&&r.label&&r.title&&r.x>=0&&r.y>=0&&r.x+r.w<=width&&r.y+r.h<=height),'square targets with accessible names fit viewport');
  await page.screenshot({path:path.join(out,'simple-palette-'+width+'.png')});
  await page.locator('[data-highlighter-color]').first().focus();await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('[data-highlighter-color]').nth(7).evaluate(n=>n===document.activeElement),true);await page.keyboard.press('Enter');assert(await tray.isVisible());await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-color]').inputValue(),await page.locator('[data-highlighter-color]').nth(7).getAttribute('data-highlighter-color'));
  await page.locator('[data-compact-color]').click();
  for(let i=0;i<21;i++){if(i)await page.locator('[data-compact-color]').tap();await page.locator('[data-highlighter-color]').nth(i).tap();assert(await tray.isVisible(),'color selection keeps opacity available');await page.keyboard.press('Escape');assert(await tray.isHidden());}
  await page.locator('[data-compact-color]').click();await page.keyboard.press('Escape');assert(await tray.isHidden());assert.equal(await dock.count(),1,'Escape dismisses settings, not editor');
  await page.locator('[data-compact-width]').click();const slider=page.locator('[data-thickness]');const b=await slider.boundingBox();
  await page.mouse.move(b.x+b.width*.3,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*.7,b.y+b.height/2,{steps:5});assert(await tray.isVisible(),'slider remains open while dragging');await page.mouse.up();assert(await tray.isVisible());
  await slider.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');assert.equal(Number(await slider.inputValue()),.0021);
  await slider.evaluate(e=>{e.value='.019';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});assert.match(await page.locator('[data-thickness-value]').innerText(),/\d+\.\d px/);await page.locator('[data-tool-done]').click();assert(await tray.isHidden());
  // Move only by the dedicated handle; drag to each extreme and clamp.
  const handle=page.locator('[data-compact-move]');let h=await handle.boundingBox();
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(-100,-100,{steps:5});await page.mouse.up();let d=await dock.boundingBox();assert(d.x>=0&&d.y>=0);
  h=await handle.boundingBox();const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:h.x+10,y:h.y+10}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width+200,y:height+200}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();d=await dock.boundingBox();assert(d.x+d.width<=width+1&&d.y+d.height<=height+1);
  await handle.focus();await page.keyboard.press('Home');d=await dock.boundingBox();assert(d.y<150);
  await page.setViewportSize({width:height,height:width});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));d=await dock.boundingBox();assert(d.x>=0&&d.x+d.width<=height+1&&d.y+d.height<=width+1);await page.setViewportSize({width,height});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  // Outside contact dismisses without making a mark; next contact draws.
  await page.locator('[data-compact-width]').click();let canvas=await page.locator('.labor-annotation-canvas').boundingBox();const point={x:canvas.x+canvas.width*.5,y:canvas.y+canvas.height*.7};
  await page.mouse.click(point.x,point.y);assert(await tray.isHidden());assert.equal(await page.locator('[data-marks] path').count(),1);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+60,point.y+20,{steps:5});await page.mouse.up();assert.equal(await page.locator('[data-marks] path').count(),2);assert.match(await page.locator('.labor-drawing-status').innerText(),/Unsaved/);
  await page.screenshot({path:path.join(out,'compact-'+width+'.png')});
  await page.locator('[data-save]').click();await page.waitForFunction(()=>saves===1);const saved=await page.evaluate(()=>window.saved);assert.equal(saved.marks[1].thickness,.019);assert.equal(saved.marks[0].thickness,.018);assert.equal(saved.marks[1].kind,'marker');
  await choose('pan');point.x=canvas.x+canvas.width*.8;point.y=canvas.y+canvas.height*.3;const matrix=await page.locator('[data-paper]').getAttribute('transform');await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+60,point.y+20,{steps:4});await page.mouse.up();assert.notEqual(await page.locator('[data-paper]').getAttribute('transform'),matrix,'pan still works');
  const pinch=await page.context().newCDPSession(page);const beforePinch=await page.locator('[data-paper]').getAttribute('transform');
  await pinch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:point.x-40,y:point.y},{id:2,x:point.x+40,y:point.y}]});
  await pinch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:point.x-80,y:point.y},{id:2,x:point.x+80,y:point.y}]});await pinch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pinch.detach();assert.notEqual(await page.locator('[data-paper]').getAttribute('transform'),beforePinch,'pinch remains on canvas');
  await page.locator('[data-compact-view]').click();await page.locator('[data-in]').click();await page.locator('[data-tool-done]').click();
  await page.locator('[data-back]').click();await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});await open();await dock.waitFor();assert.deepEqual(await page.evaluate(()=>saved.marks),saved.marks);
  for(const node of await page.locator('[data-marks] path').all())assert.equal(await node.getAttribute('opacity'),'.28');
  await page.getByRole('button',{name:'Show operation and draft details'}).click();assert(await page.locator('.labor-compact-info').isVisible());await page.keyboard.press('Escape');
  await choose('text');const textPoint=await page.locator('.labor-annotation-canvas').boundingBox();await page.mouse.click(textPoint.x+textPoint.width*.5,textPoint.y+textPoint.height*.5);await page.locator('[data-inline-text]').fill('Compact text fixture');await page.locator('[data-inline-text]').press('Control+Enter');assert.equal(await page.locator('[data-marks] text').count(),1);
  assert.equal(await page.locator('main input').inputValue(),'untouched worksheet');assert.deepEqual(errors,[]);await page.close();console.log('PASS compact header, palette dismissal, width drag, keyboard/touch toolbar movement and clamping, orientation, drawing/pan, saved compatibility '+width+'x'+height);
 }
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

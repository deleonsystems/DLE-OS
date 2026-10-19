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
   window.saves=0;window.openFixture=()=>DleLaborDrawingNotes.open({intakeId:'fixture',stepId:'op',stepLabel:'Synthetic width check',editable:true,canSaveView:true,slide:{kind:'NOTE',caption:'Width fixture',layer:structuredClone(saved),photosSupported:false,loadBase:()=>Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/></svg>',{headers:{'content-type':'image/svg+xml'}})),save:async layer=>{saved=structuredClone(layer);saves++;}}});
  });
  const open=async()=>{await page.evaluate(()=>openFixture());await page.waitForFunction(()=>document.querySelector('.labor-drawing-status')?.textContent==='Ready');};await open();
  const tool=page.locator('[data-quick-tool="marker"]'),slider=page.locator('[data-thickness]');await tool.tap();assert.equal(await tool.innerText(),'Highlighter');assert.equal(await page.locator('[data-tray-title]').innerText(),'Highlighter');assert.equal(await page.locator('option[value="marker"]').innerText(),'Highlighter');
  assert.equal(await slider.getAttribute('type'),'range');assert.equal(await slider.getAttribute('min'),'.002');assert.equal(await slider.getAttribute('max'),'.04');
  await slider.focus();await page.keyboard.press('Home');assert.equal(Number(await slider.inputValue()),.002);await page.keyboard.press('ArrowRight');assert.equal(Number(await slider.inputValue()),.0021);await page.keyboard.press('End');assert.equal(Number(await slider.inputValue()),.04);
  const box=await slider.boundingBox();await page.mouse.move(box.x+box.width*.8,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height/2,{steps:6});await page.mouse.up();const mouseValue=Number(await slider.inputValue());assert(mouseValue>.002&&mouseValue<.04);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.3,y:box.y+box.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.7,y:box.y+box.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert(Number(await slider.inputValue())>mouseValue);await cdp.detach();
  await slider.evaluate(e=>{e.value='.019';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  const expected=await page.evaluate(()=>{const m=document.querySelector('[data-paper]').transform.baseVal.consolidate().matrix;return (.019*1200*Math.hypot(m.a,m.b)).toFixed(1)+' px';});assert.equal(await page.locator('[data-thickness-value]').innerText(),expected);assert.match(await slider.getAttribute('aria-valuetext'),/pixels at current zoom/);
  await page.screenshot({path:path.join(out,'highlighter-'+width+'.png')});
  const tray=await page.locator('.labor-tool-tray:visible').boundingBox();assert(tray.x>=0&&tray.x+tray.width<=width&&tray.y>=0&&tray.y+tray.height<=height);
  await page.locator('[data-tool-done]').tap();await page.locator('[data-in]').click();await tool.tap();assert.equal(Number(await slider.inputValue()),.019);assert.notEqual(await page.locator('[data-thickness-value]').innerText(),expected,'zoom updates pixels without altering normalized width');await page.locator('[data-tool-done]').tap();
  const canvas=await page.locator('.labor-annotation-canvas').boundingBox();await page.mouse.move(canvas.x+canvas.width*.4,canvas.y+canvas.height*.4);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.6,canvas.y+canvas.height*.5,{steps:8});await page.mouse.up();
  await page.locator('[data-save]').click();await page.waitForFunction(()=>saves===1);const saved=await page.evaluate(()=>window.saved);assert.equal(saved.marks.length,2);assert.equal(saved.marks[0].thickness,.018);assert.equal(saved.marks[1].thickness,.019);assert.equal(saved.marks[1].kind,'marker');
  const savedPath=path.join(out,'saved-widths-'+width+'.json');fs.writeFileSync(savedPath,JSON.stringify(saved));
  await page.locator('[data-back]').click();await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});await page.evaluate(value=>{window.saved=value;},JSON.parse(fs.readFileSync(savedPath,'utf8')));await open();
  assert.deepEqual(await page.evaluate(()=>saved.marks),saved.marks);for(const n of await page.locator('[data-marks] path').all())assert.equal(await n.getAttribute('opacity'),'.28');
  assert.equal(await page.locator('main input').inputValue(),'untouched worksheet');assert.deepEqual(errors,[]);await page.close();console.log('PASS labels, mouse/touch/keyboard slider, live pixels, zoom, saved/reopened widths, legacy marker opacity and layout '+width+'x'+height);
 }
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

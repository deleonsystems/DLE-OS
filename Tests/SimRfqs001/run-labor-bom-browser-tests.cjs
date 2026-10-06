const fs=require('fs'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const out='tmp/labor-bom-return',origin='https://sim-miguel.dle-os.internal.dlemfg.com:5177';
const stores=['rfq-intakes.json','rfq-lanes.json','dle-os-sim.db'],before=stores.map(n=>fs.readFileSync('.sim-state/data/'+n));
(async()=>{for(const engine of ['webkit','edge']){const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));try{
 for(const saved of [true,false]){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  if(saved)await page.addInitScript(()=>localStorage.setItem('DLE_OS_VIEW_MODE','mobile'));
  await page.goto(origin);if(await page.locator('#sim_access').count()){await page.locator('#sim_access').fill(process.env.DLE_OS_SIM_PERMANENT_ACCESS_CODE);await Promise.all([page.waitForURL(u=>!u.pathname.includes('sim-access')),page.getByRole('button',{name:'Open local SIM'}).click()]);}
  await page.waitForFunction(()=>!!window.DleWorkspaceShell);await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort());
  if(!saved)await page.locator('#dleViewModeSelect').selectOption('mobile');
  await page.locator('[data-mobile-work-area="rfqs"]').click();await page.locator('[data-rfq="RFQI-SIM-0036"]').click();await page.locator('[data-open="labor"]').click();
  await page.locator('.labor-grid').waitFor();
  const drawing=page.getByRole('link',{name:'Open Drawing',exact:true});
  const originalHref=await drawing.getAttribute('href');assert.match(originalHref,/\/documents\//);assert.equal(await drawing.getAttribute('target'),'_blank');
  await page.evaluate(()=>window.originalLaborRoot=document.querySelector('.labor-workbench'));
  const totals=await page.locator('.labor-summary').innerText();
  const bom=page.getByRole('link',{name:'View BOM',exact:true});
  assert.equal(await bom.getAttribute('target'),'_blank');
  for(const [width,height] of [[390,844],[844,390]]){
   await page.setViewportSize({width,height});await bom.scrollIntoViewIfNeeded();
   const scroll=await page.locator('body>main').evaluate(e=>e.scrollTop);
   await bom.click();const dialog=page.locator('.labor-bom-viewer');await dialog.waitFor();
   await page.waitForFunction(()=>document.querySelector('.labor-bom-viewer #bom-total')?.textContent==='161');
   assert.equal(await dialog.locator('tbody tr').count(),55);
   assert.match(await dialog.locator('.labor-bom-content').innerText(),/Accepted BOM v1/);
   assert.equal(context.pages().length,1);
   const bounds=await dialog.boundingBox();assert(bounds.width<=width+1&&bounds.height<=height+1);
   await dialog.locator('tbody tr').nth(0).click();await dialog.locator('tbody tr').nth(1).click();
   assert.match(await dialog.locator('#bom-selection').innerText(),/Selected: 2 lines/);
   await dialog.locator('tbody tr').nth(0).click();assert.match(await dialog.locator('#bom-selection').innerText(),/Selected: 1 lines/);
   await dialog.locator('#bom-clear').click();assert.match(await dialog.locator('#bom-selection').innerText(),/Selected: 0 lines/);
   await dialog.locator('.labor-bom-table-wrap').evaluate(e=>e.scrollLeft=400);assert(await dialog.locator('.labor-bom-table-wrap').evaluate(e=>e.scrollLeft>0));
   await dialog.locator('.labor-bom-table-wrap').evaluate(e=>e.scrollLeft=0);
   if(engine==='webkit'&&saved&&width===390)await page.screenshot({path:out+'/bom-with-back.png',fullPage:true});
   if(width===390)await page.locator('[data-drawing-back]').click();else await page.keyboard.press('Escape');
   await dialog.waitFor({state:'detached'});assert(await page.evaluate(()=>originalLaborRoot===document.querySelector('.labor-workbench')));
   assert.equal(await page.locator('.labor-summary').innerText(),totals);
   assert(Math.abs(await page.locator('body>main').evaluate(e=>e.scrollTop)-scroll)<2);
   await drawing.click();await page.waitForFunction(()=>{const i=document.querySelector('.labor-drawing-viewer img');return i&&!i.hidden&&i.complete&&i.naturalWidth>0;});
   await page.locator('[data-drawing-back]').click();await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});
  }
  await page.setViewportSize({width:390,height:844});
  const pattern='**/api/sim/rfqs/RFQI-SIM-0036/bom-reference';
  await page.route(pattern,r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await bom.click();await page.locator('[data-bom-retry]:not([hidden])').waitFor();
  await page.unroute(pattern);await page.locator('[data-bom-retry]').click();await page.waitForFunction(()=>document.querySelector('.labor-bom-viewer #bom-total')?.textContent==='161');
  await page.locator('[data-drawing-back]').click();await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});
  let release,started=false;const pending=new Promise(resolve=>release=resolve);
  await page.route(pattern,async r=>{started=true;await pending;await r.abort().catch(()=>{});});
  await bom.click();await page.locator('.labor-bom-viewer').waitFor();await page.locator('[data-drawing-back]').click();await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});release();await page.unroute(pattern);
  assert.equal(await page.locator('.labor-bom-viewer').count(),0);
  assert.match(await page.locator('.labor-status').innerText(),/COMPLETE/);
  if(engine==='webkit'&&saved){await page.locator('body>main').evaluate(e=>e.scrollTop=0);await page.screenshot({path:out+'/returned-labor.png',fullPage:true});}
  assert.deepEqual(errors,[]);console.log('PASS',engine,saved?'saved':'selected','BOM 55 lines/161 components, selection, drawing interchange, portrait/landscape, Back/Cancel, retry/loading exit, unchanged worksheet');await context.close();
 }
}finally{await browser.close();}}stores.forEach((n,i)=>assert(fs.readFileSync('.sim-state/data/'+n).equals(before[i]),n+' changed'));})().catch(e=>{console.error(e.stack);process.exitCode=1});

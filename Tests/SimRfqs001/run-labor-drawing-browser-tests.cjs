const fs=require('fs'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const out='tmp/labor-drawing-return',origin='https://sim-miguel.dle-os.internal.dlemfg.com:5177';
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
  for(const [width,height] of [[390,844],[844,390]]){
   await page.setViewportSize({width,height});await drawing.click();
   const dialog=page.locator('.labor-drawing-viewer');await dialog.waitFor();
   await page.waitForFunction(()=>{const i=document.querySelector('.labor-drawing-viewer img');return i&&!i.hidden&&i.complete&&i.naturalWidth>0;});
   assert.equal(context.pages().length,1);assert.equal(await page.getByRole('button',{name:'Back to Labor worksheet'}).innerText(),'Back');
   const bounds=await dialog.boundingBox();assert(bounds.width<=width+1&&bounds.height<=height+1);
   await page.locator('[data-drawing-next]').click();await page.waitForFunction(()=>document.querySelector('[data-drawing-page]').textContent==='Page 2');
   await page.waitForFunction(()=>document.querySelector('.labor-drawing-viewer img').complete&&document.querySelector('.labor-drawing-viewer img').naturalWidth>0);
   await page.locator('[data-drawing-zoom]').selectOption('200');assert(await page.locator('.labor-drawing-pages').evaluate(e=>e.scrollWidth>e.clientWidth));
   await page.locator('[data-drawing-zoom]').selectOption('100');
   if(engine==='webkit'&&saved&&width===390)await page.screenshot({path:out+'/drawing-with-back.png',fullPage:true});
   if(width===390)await page.locator('[data-drawing-back]').click();else await page.keyboard.press('Escape');
   await dialog.waitFor({state:'detached'});
   assert(await page.evaluate(()=>originalLaborRoot===document.querySelector('.labor-workbench')));
   assert.equal(await page.locator('.labor-summary').innerText(),totals);
   assert.match(await page.locator('.labor-status').innerText(),/COMPLETE/);
  }
  await page.setViewportSize({width:390,height:844});
  await page.route('**/documents/*/pages/1',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await drawing.click();await page.locator('[data-drawing-retry]:not([hidden])').waitFor();await page.locator('[data-drawing-back]').click();
  await page.unroute('**/documents/*/pages/1');
  if(engine==='webkit'&&saved){await page.locator('body>main').evaluate(e=>e.scrollTop=0);await page.screenshot({path:out+'/returned-labor.png',fullPage:true});}
  assert.deepEqual(errors,[]);console.log('PASS',engine,saved?'saved':'selected','portrait/landscape, 2 pages, zoom, Back/Cancel, repeated open, failed-preview exit, unchanged worksheet');await context.close();
 }
}finally{await browser.close();}}stores.forEach((n,i)=>assert(fs.readFileSync('.sim-state/data/'+n).equals(before[i]),n+' changed'));})().catch(e=>{console.error(e.message);process.exitCode=1});

const fs=require('fs'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const out='tmp/labor-mobile',origin='https://sim-miguel.dle-os.internal.dlemfg.com:5177';
const stores=['rfq-intakes.json','rfq-lanes.json','dle-os-sim.db'],before=stores.map(n=>fs.readFileSync('.sim-state/data/'+n));
(async()=>{
 for(const engine of ['webkit','edge']){
  const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));
  try{for(const width of [375,390,430])for(const saved of [true,false]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[],writes=[];
   page.on('pageerror',e=>errors.push(e.message));
   if(saved)await page.addInitScript(()=>localStorage.setItem('DLE_OS_VIEW_MODE','mobile'));
   await page.goto(origin);
   if(await page.locator('#sim_access').count()){await page.locator('#sim_access').fill(process.env.DLE_OS_SIM_PERMANENT_ACCESS_CODE);await Promise.all([page.waitForURL(u=>!u.pathname.includes('sim-access')),page.getByRole('button',{name:'Open local SIM'}).click()]);}
   await page.waitForFunction(()=>!!window.DleWorkspaceShell);
   await page.route('**/api/**',r=>{if(r.request().method()==='GET')return r.continue();writes.push(r.request().url());return r.abort();});
   if(!saved)await page.locator('#dleViewModeSelect').selectOption('mobile');
   await page.locator('[data-mobile-work-area="rfqs"]').click();await page.locator('[data-rfq="RFQI-SIM-0036"]').click();
   await page.locator('[data-open="labor"]').click();await page.locator('.labor-grid tbody tr').first().waitFor();
   const root=page.locator('.labor-workbench');
   assert.match(await root.locator('.labor-context').innerText(),/B11283-17.*Rev B.*25/);
   assert.match(await root.locator('[role="status"]').innerText(),/COMPLETE/);
   const metrics=await page.evaluate(()=>{const m=document.querySelector('body>main'),r=m.getBoundingClientRect(),f=document.querySelector('body>footer').getBoundingClientRect();return{height:r.height,overlap:f.top<r.bottom-1,overflow:m.scrollWidth>m.clientWidth+1,footer:f.height};});
   assert(metrics.height>300&&!metrics.overlap&&!metrics.overflow&&metrics.footer<60,JSON.stringify(metrics));
   assert.equal(await page.locator('[data-rfqs-mobile-boundary]').count(),0);
   assert((await root.locator('[data-action="back"]').boundingBox()).height>=44);
   const totals=await root.locator('.labor-summary').innerText();assert.match(totals,/381\.37/);
   if(engine==='webkit'&&width===390&&saved){await page.locator('body>main').evaluate(e=>e.scrollTop=0);await page.screenshot({path:out+'/mobile-labor.png',fullPage:true});}
   await root.locator('a[href="#laborMobileTotals"]').click();
   assert(await root.locator('.labor-summary').isVisible());
   if(engine==='webkit'&&width===390&&saved)await page.screenshot({path:out+'/mobile-totals.png',fullPage:true});
   await root.locator('[data-action="supplemental"]').click();await page.locator('.labor-supplemental').waitFor();
   assert.equal(await page.locator('body>main').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
   await page.locator('[data-action="traveler"]').click();
   await page.locator('[data-action="all-notes"]').click();await page.locator('.labor-notes-panel').waitFor();
   const panel=await page.locator('.labor-notes-panel').boundingBox();assert(panel.x>=0&&panel.x+panel.width<=width+1);
   await page.keyboard.press('Escape');
   await page.locator('.labor-workbench [data-action="back"]').click();await page.locator('[data-workspace-mount="rfqs"][aria-busy="false"] [data-open="labor"]').waitFor();
   assert.match(await page.locator('.rfqs-context').innerText(),/RFQI-SIM-0036/);
   for(const target of ['materials','final-review'])assert(await page.locator('[data-open="'+target+'"]').isDisabled());
   assert.match(await page.locator('#rfqsMobileScope').innerText(),/overview and Labor/);
   assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(url=>!url.endsWith('/verified-statuses/latest')),[]);
   console.log('PASS',engine,width,saved?'saved':'selected','0036 Labor, cards/totals, notes, supplemental, return; no writes');await context.close();
  }}finally{await browser.close();}
 }
 stores.forEach((n,i)=>assert(fs.readFileSync('.sim-state/data/'+n).equals(before[i]),n+' changed'));
})().catch(e=>{console.error(e.message);process.exitCode=1});

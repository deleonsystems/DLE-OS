const fs=require('fs'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const out='tmp/labor-compact',phase=process.argv[2]||'after',origin='https://sim-miguel.dle-os.internal.dlemfg.com:5177';
(async()=>{for(const engine of ['webkit','edge']){const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));try{
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.addInitScript(()=>localStorage.setItem('DLE_OS_VIEW_MODE','mobile'));
 await page.goto(origin);if(await page.locator('#sim_access').count()){await page.locator('#sim_access').fill(process.env.DLE_OS_SIM_PERMANENT_ACCESS_CODE);await Promise.all([page.waitForURL(u=>!u.pathname.includes('sim-access')),page.getByRole('button',{name:'Open local SIM'}).click()]);}
 await page.waitForFunction(()=>!!window.DleWorkspaceShell);await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort());
 await page.locator('[data-mobile-work-area="rfqs"]').click();await page.locator('[data-rfq="RFQI-SIM-0036"]').click();await page.locator('[data-open="labor"]').click();await page.locator('.labor-grid').waitFor();
 const totals=await page.locator('.labor-summary').innerText();assert.match(totals,/381\.37/);
 await page.locator('a[href="#laborMobileOperations"]').click();await page.screenshot({path:`${out}/${phase}-${engine}-mobile.png`});
 if(phase==='after'){
  const sub=page.locator('[data-action="mobile-subs"]').filter({hasText:'(2)'}).first();
  assert.equal(await page.locator('.labor-child:visible').count(),0);await sub.click();assert.equal(await sub.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('.labor-child:visible').count(),2);
  await sub.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/after-${engine}-expanded.png`});
  for(const reference of ['View BOM','Open Drawing']){await page.getByRole('link',{name:reference,exact:true}).click();await page.locator('.labor-drawing-viewer').waitFor();await page.locator('[data-drawing-back]').click();await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});assert.equal(await sub.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('.labor-child:visible').count(),2);}
  await sub.click();assert.equal(await page.locator('.labor-child:visible').count(),0);
 }
 for(const width of [390,844]){await page.setViewportSize({width,height:width===390?844:390});assert.equal(await page.locator('body>main').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);}
 await page.locator('#dleViewModeSelect').selectOption('desktop');
 for(const width of [1440,650]){await page.setViewportSize({width,height:1000});await page.locator('body>main').evaluate(e=>e.scrollTop=0);await page.mouse.move(0,0);await page.locator('.labor-grid').screenshot({path:`${out}/${phase}-${engine}-desktop-${width}.png`});
 const picker=page.locator('.labor-operation-trigger').first();await picker.click();assert(await page.locator('.labor-picker:popover-open').isVisible());await page.keyboard.press('Escape');
 const toggle=page.locator('.labor-disclosure').first();if(await toggle.count()){const initial=await toggle.getAttribute('aria-expanded');await toggle.click();assert.notEqual(await page.locator('.labor-disclosure').first().getAttribute('aria-expanded'),initial);await page.locator('.labor-disclosure').first().click();}
 }
 assert.equal(await page.locator('.labor-summary').innerText(),totals);console.log('PASS',phase,engine,'live mobile capture, desktop wide/narrow captures and picker/disclosure interactions; same totals');
}finally{await browser.close();}}})().catch(e=>{console.error(e.stack);process.exitCode=1});

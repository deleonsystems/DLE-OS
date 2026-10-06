// Live SIM presentation checks only. Business API writes are blocked after shell boot.
const fs=require('fs'), assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const out='tmp/rfqs-mobile', origin='https://sim-miguel.dle-os.internal.dlemfg.com:5177';
const stores=['rfq-intakes.json','rfq-lanes.json','dle-os-sim.db'];
const before=stores.map(n=>fs.readFileSync('.sim-state/data/'+n));
async function login(page){
 await page.goto(origin);
 if(await page.locator('#sim_access').count()){
  await page.locator('#sim_access').fill(process.env.DLE_OS_SIM_PERMANENT_ACCESS_CODE);
  await Promise.all([page.waitForURL(u=>!u.pathname.includes('sim-access')),page.getByRole('button',{name:'Open local SIM'}).click()]);
 }
 await page.waitForFunction(()=>!!window.DleWorkspaceShell);
 await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort());
}
async function layout(page,label){
 const result=await page.evaluate(()=>{
  const main=document.querySelector('body>main'), m=main.getBoundingClientRect(), f=document.querySelector('body>footer').getBoundingClientRect();
  return {mainHeight:m.height,footerHeight:f.height,overlap:f.top<m.bottom-1,overflow:main.scrollWidth>main.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1};
 });
 assert(result.mainHeight>300,label+' collapsed '+JSON.stringify(result));
 assert(result.footerHeight<60&&!result.overlap,label+' footer overlap');
 assert(!result.overflow,label+' horizontal overflow');
}
(async()=>{
 assert(process.env.DLE_OS_SIM_PERMANENT_ACCESS_CODE,'Existing SIM credential required');
 for(const engine of (process.env.RFQ_TEST_ENGINE?[process.env.RFQ_TEST_ENGINE]:['webkit','edge'])){
  const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));
  try{
   for(const width of (process.env.RFQ_DESKTOP_ONLY?[]:process.env.RFQ_TEST_WIDTH?[Number(process.env.RFQ_TEST_WIDTH)]:[375,390,430])) for(const saved of (process.env.RFQ_TEST_WIDTH?[true]:[true,false])){
    const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(saved)await page.addInitScript(()=>localStorage.setItem('DLE_OS_VIEW_MODE','mobile'));
    await login(page);
    if(!saved)await page.locator('#dleViewModeSelect').selectOption('mobile');
    await page.locator('[data-mobile-work-area="rfqs"]').click();
    await page.locator('[data-rfq="RFQI-SIM-0036"]').waitFor();
    const label=engine+'-'+width+'-'+(saved?'saved':'selected');
    await layout(page,label+' queue');
    assert((await page.locator('[data-rfq="RFQI-SIM-0036"]').boundingBox()).height>=44);
    assert(await page.locator('body>main').evaluate(e=>e.scrollHeight>e.clientHeight));
    if(engine==='webkit'&&width===390&&saved)await page.screenshot({path:out+'/mobile-queue.png',fullPage:true});
    await page.locator('[data-rfq="RFQI-SIM-0036"]').click();
    await page.locator('#rfqsMobileScope').waitFor();
    for(const target of ['materials','final-review'])assert(await page.locator('[data-open="'+target+'"]').isDisabled());
    assert.match(await page.locator('.rfqs-approval-note').innerText(),/Historical approval retained/);
    assert.equal(await page.locator('[data-commercial="SUBMIT"]').count(),0);
    await layout(page,label+' overview');
    if(engine==='webkit'&&width===390&&saved){await page.locator('body>main').evaluate(e=>e.scrollTop=0);await page.screenshot({path:out+'/mobile-overview.png',fullPage:true});}
    await page.locator('summary').filter({hasText:'Approval history'}).click();
    assert.match(await page.locator('.rfq-commercial-detail').innerText(),/Version 1/);
    if(engine==='webkit'&&width===390&&saved)await page.screenshot({path:out+'/mobile-history.png',fullPage:true});
    await page.locator('[data-open="intake-documents"]').click();
    await page.locator('.intake-owned-documents').waitFor();
    await layout(page,label+' documents');
    await page.locator('[data-action="source"]').click();
    await page.locator('#technicalReviewDetailView:not([hidden])').waitFor();
    await layout(page,label+' Technical Review');
    await page.locator('.back-btn').click();
    await page.locator('[data-workspace-mount="rfqs"][aria-busy="false"] #rfqsMobileScope').waitFor();
    assert.match(await page.locator('.rfqs-context').innerText(),/RFQI-SIM-0036/);
    await page.locator('[data-action="queue"]').click();
    await page.locator('[data-bucket="HISTORY"]').click();
    assert.equal(await page.locator('[data-bucket="HISTORY"]').getAttribute('aria-pressed'),'true');
    await page.locator('.home-btn').click();
    await page.locator('[data-mobile-work-area="rfqs"]').waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS',label,'Home, scroll/cards, history, downstream boundary, documents, source/back, Home return');
    await context.close();
   }
   if(engine==='edge'){
    const page=await browser.newPage({viewport:{width:1440,height:1100}});await login(page);
    await page.locator('[data-work-area="rfqs"]').click();
    await page.locator('[data-rfq="RFQI-SIM-0036"]').click();
    await page.locator('[data-open="final-review"]').waitFor();
    await page.locator('.rfqs-overview').screenshot({path:out+'/desktop-after-overview.png'});
    for(const [target,selector] of [['materials','.materials-workbench'],['final-review','.quotation-final-review']]){
     await page.locator('[data-open="'+target+'"]').click();
     await page.locator(selector).waitFor();
     await page.locator('#dleViewModeSelect').selectOption('mobile');
     await page.locator('[data-rfqs-mobile-boundary]').waitFor();
     assert.equal(await page.locator(selector).isVisible(),false);
     await page.getByRole('button',{name:'Return to Desktop View',exact:true}).click();
     await page.locator(selector).waitFor();
     await page.locator(selector+(target==='materials'?' [data-material-action="back"]':' [data-action="back"]')).click();
     await page.locator('[data-open="'+target+'"]').waitFor();
     assert.match(await page.locator('.rfqs-context').innerText(),/RFQI-SIM-0036/);
    }
    console.log('PASS desktop Materials/Labor/Final Review entry, mobile boundary and preserved return paths');
    await page.close();
   }
  }finally{await browser.close();}
 }
 stores.forEach((n,i)=>assert(fs.readFileSync('.sim-state/data/'+n).equals(before[i]),n+' changed'));
})().catch(e=>{console.error(e.message);process.exitCode=1});

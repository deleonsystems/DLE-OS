// Actual application shell/CSS, isolated API fixture. No live SIM or physical printing.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const root=process.cwd(),out='tmp/shipping-presentation';
const snapshot=JSON.parse(fs.readFileSync(process.argv[2]||'tmp/shipping-handoff/live-before-restart.json','utf8').replace(/^\uFEFF/,''));
const shell=fs.readFileSync('DLE_Work_Center_v4.0.0.html','latin1').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
let checks=0;const check=(x,m)=>{assert.ok(x,m);checks++;};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  let before=true,queue={rows:[snapshot]},fail=false,gets=0;const writes=[];
  const page=await browser.newPage({viewport:{width:1910,height:1080}});
  await page.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(r.method()!=='GET')writes.push(r.method()+' '+u.pathname);
   if(u.pathname.startsWith('/api/')){gets++;return route.fulfill(fail?{status:503,json:{message:'Queue unavailable'}}:{json:u.pathname.endsWith('/queue')?queue:snapshot});}
   if(u.pathname==='/')return route.fulfill({body:shell,contentType:'text/html'});
   if(u.hostname!=='shipping-review.test')return route.abort();
   let file=path.resolve('.'+decodeURIComponent(u.pathname));assert(file.startsWith(root+path.sep));
   if(before&&/shipping-handoff\.(js|css)$/.test(file))file=path.resolve(out,'baseline',path.basename(file));
   if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'image/jpeg'});
  });
  async function load(){
   await page.goto('http://shipping-review.test/');
   await page.evaluate(()=>{
    document.body.dataset.workspaceView='shipping';document.body.dataset.viewMode='desktop';document.body.dataset.simRuntime='true';
    document.querySelectorAll('.workspace-home').forEach(n=>n.classList.toggle('active',n.dataset.workspaceHome==='shipping'));
    window.DleOsRuntimeConfig={environment:'SIMULATION'};window.DleOsCapabilities={can:p=>['shipments.view','shipments.stage'].includes(p)};
    document.querySelector('#dleEnvironmentBadge').textContent='SIM';
    document.querySelector('#activeWorkAreaLabel').textContent='SHIPPING';
    document.querySelector('#dleFactoryClock').textContent='Isolated UI review - fixture data';
   });
   await page.addScriptTag({url:'/SRC/modules/shipping/shipping-handoff.js'});
   await page.addScriptTag({url:'/SRC/modules/shipping/shipping-print.js'});
   await require('./shell-fixture.cjs')(page);
   await page.evaluate(()=>ShippingHandoff.renderShipping(document.querySelector('[data-workspace-mount="shipping"]')));
   await page.evaluate(()=>document.fonts.ready);
  }
  await load();await page.screenshot({path:out+'/shipping-before-desktop.png',fullPage:true});
  before=false;await load();
  const jobs=page.locator('.shipping-job'), search=page.locator('[data-shipping-search-input]');
  check(await jobs.count()===1,'one original authorization row');
  check(await jobs.first().getAttribute('data-handoff-id')===snapshot.authorizations[0].id,'original action identity');
  for(const text of ['WO 0999999','SIM-ASSY-001','Rev A','10 EA','10/14/2026','DLE-SIM-CUSTOMER','Released - SIM review required','Review required'])check((await jobs.innerText()).includes(text),'row '+text);
  check(await page.locator('.shipping-queue h1').innerText()==='Shipping','simple title');
  check(await page.locator('.shipping-queue table').count()===0,'no primary dense table');
  check(await page.locator('.shipping-secondary details[open]').count()===0,'secondary sections collapsed');
  check((await page.locator('.shipping-sim').innerText()).includes('Developmental'),'developmental cue retained');
  const box=await page.locator('.shipping-queue').boundingBox();check(box.width>1800&&box.x<40,'full-width desktop gutters');
  await page.screenshot({path:out+'/shipping-after-desktop.png',fullPage:true});
  for(const term of ['0999999','WO0999999','0099999','SO0099999','dle-sim-customer','sim-assy-001','  SIM-ASSY  ']){
   await search.fill(term);check(await page.locator('.shipping-job:visible').count()===1,'search '+term);
  }
  await search.fill('no-such-job');check(await page.locator('.shipping-job:visible').count()===0,'no-match hides job');
  check(await page.locator('[data-shipping-empty]').innerText()==='No jobs match your search.','plain no-result message');
  const beforeRefresh=gets;await page.locator('[data-handoff-refresh]').click();await search.waitFor();
  check(gets===beforeRefresh+1,'refresh refetches durable queue');check(await search.inputValue()==='no-such-job','refresh retains filter');
  check(await page.locator('.shipping-job:visible').count()===0,'refresh applies filter');
  await search.fill('');check(await page.locator('.shipping-job:visible').count()===1,'clear restores queue');
  for(let i=0;i<2;i++){
   await search.fill('SIM-ASSY-001');
   const historyBeforeJob=await page.evaluate(()=>history.length);
   await jobs.first().focus();await page.keyboard.press('Enter');await page.locator('[data-print-kind="request"]').waitFor();
   const detail=await page.locator('#shippingJobWorkspace').innerText();
   for(const t of ['WILL_CALL','ground','Customer CoC','Serial list','Test results','missing / not established','130 Packaging','Not Started','SIM departure is unavailable'])check(detail.toLowerCase().includes(t.toLowerCase()),'detail '+t);
   check(await page.locator('[data-print-kind]').count()===2,'both preview actions retained');
   check(await page.locator('#shippingJobWorkspace form').count()===0,'Shipping role has no release form');
   check(await page.locator('#shippingJobWorkspace').evaluate(n=>n.classList.contains('active')),'full page active');
   check(await page.locator('#shippingHandoffDialog').count()===0,'no Shipping detail modal');
   if(i===0){
    for(const text of ['WO 0999999','SIM-ASSY-001','Rev A','10 EA','DLE-SIM-CUSTOMER','0099999 / 010','SIM-E2E-001-PO','Ship-to: Not established','Actual ship date is not established'])check(detail.includes(text),'job identity/unknown '+text);
    const audit=page.locator('.shipping-job-support').last();
    check(!await audit.getAttribute('open'),'provenance initially collapsed');await audit.locator('summary').click();
    for(const text of [snapshot.authorizations[0].id,'RELEASED','SIM Administrator',snapshot.authorizations[0].createdAt,'SIMULATED_DEVELOPMENTAL','NOT_STARTED'])check((await audit.innerText()).toUpperCase().includes(text.toUpperCase()),'provenance '+text);
    await page.screenshot({path:'tmp/shipping-job/job-provenance.png',fullPage:true});await audit.locator('summary').click();
    for(const [width,name] of [[1910,'desktop'],[900,'tablet'],[390,'narrow']]){
     await page.setViewportSize({width,height:1080});
     await page.evaluate(()=>document.querySelector('main').scrollTo(0,0));
     check(await page.locator('[data-shipping-job-heading]').evaluate(n=>n.getBoundingClientRect().top>=document.querySelector('body>header').getBoundingClientRect().bottom),'job header unobscured '+width);
     check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'job no overflow '+width);
     for(const selector of ['.shipping-print-cards','.shipping-job-documents','.shipping-job-issues'])check(await page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;}),'job contains '+selector+' '+width);
     await page.screenshot({path:`tmp/shipping-job/job-${name}.png`,fullPage:true});
     const fullHeight=await page.evaluate(()=>document.querySelector('main').scrollHeight+document.querySelector('body>header').offsetHeight+70);
     await page.setViewportSize({width,height:fullHeight});await page.evaluate(()=>document.querySelector('main').scrollTo(0,0));
     await page.screenshot({path:`tmp/shipping-job/job-${name}-full.png`,fullPage:true});
    }
    await page.setViewportSize({width:1910,height:1080});
    check(await page.evaluate(()=>history.length)===historyBeforeJob,'job uses shared in-app history, no browser route');
    await page.goBack();await page.goForward();
    check(page.url()==='http://shipping-review.test/','native Back/Forward returns to application document');
    // Shared shell has no job URL route: document navigation cannot restore a selected job.
    await load();await search.fill('SIM-ASSY-001');await jobs.first().click();await page.locator('[data-print-kind="request"]').waitFor();
   }
   await page.locator(i===0?'[data-shipping-back]':'.back-btn').click();
   await search.waitFor();check(await search.inputValue()==='SIM-ASSY-001','Back preserves search');
   check(await page.locator('.shipping-job:focus').count()===1,'Back restores selected job focus');
  }
  await search.fill('');
  for(const width of [1100,900,760,620,390]){
   await page.setViewportSize({width,height:1000});
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow '+width);
   const result=await jobs.first().evaluate(n=>{const r=n.getBoundingClientRect();return [...n.children].every(c=>{const b=c.getBoundingClientRect();return b.x>=r.x&&b.right<=r.right+1&&b.bottom<=r.bottom+1;});});
   check(result,'row content contained '+width);
   check(await page.locator('.shipping-job-status').evaluate(n=>{const [a,b]=n.children;return b.getBoundingClientRect().top>=a.getBoundingClientRect().bottom;}),'attention cue below status '+width);
   if(width===390)await page.screenshot({path:out+'/shipping-after-narrow.png',fullPage:true});
  }
  fail=true;await jobs.first().click();await page.locator('#shippingJobWorkspace [role="alert"]').waitFor();
  check(await page.locator('#shippingJobWorkspace [data-print-kind]').count()===0,'failed detail never shows stale print actions');
  fail=false;await page.locator('[data-shipping-back]').click();await jobs.waitFor();
  await jobs.first().click();await page.locator('[data-print-kind="request"]').waitFor();
  check((await page.locator('[data-shipping-job-heading]').innerText()).includes('0999999'),'detail recovers with original identity');
  await page.locator('[data-shipping-back]').click();await jobs.waitFor();
  queue={rows:[{...snapshot,authorizations:[{...snapshot.authorizations[0],state:'HELD'},{...snapshot.authorizations[0],id:'fixture-revoked',state:'REVOKED'}]}]};
  await page.evaluate(()=>ShippingHandoff.renderShipping(document.querySelector('[data-workspace-mount="shipping"]')));
  check(await jobs.count()===1,'held retained and revoked excluded');check((await jobs.innerText()).includes('On hold / source review'),'truthful held status');
  await page.getByText('Authorization History',{exact:true}).click();check(await page.locator('[data-handoff-id="fixture-revoked"]').count()===1,'history access retained');
  queue={rows:[{...snapshot,sourceCurrent:false}]};await page.locator('[data-handoff-refresh]').click();await jobs.waitFor();
  check((await jobs.innerText()).includes('On hold / source review'),'stale source stays held');
  queue={rows:[]};await page.locator('[data-handoff-refresh]').click();await search.waitFor();
  check(await jobs.count()===0,'empty queue');check(await page.locator('[data-shipping-empty]').innerText()==='No jobs are ready for Shipping.','empty business wording');
  fail=true;await page.locator('[data-handoff-refresh]').click();await page.getByRole('alert').filter({hasText:'Queue unavailable'}).waitFor();
  check(await jobs.count()===0,'failure has no stale rows');
  fail=false;queue={rows:[snapshot]};await page.getByRole('button',{name:'Retry',exact:true}).click();await jobs.waitFor();check(await jobs.count()===1,'retry restores original queue');
  await page.reload();await load();check(await jobs.count()===1,'reload has no duplicate');check(writes.length===0,'zero business writes');
  const result={verdict:'PASS',checks,environment:'isolated API fixture with actual application shell and styles',gets,writes,authorization:snapshot.authorizations[0].id,quantity:snapshot.authorizations[0].quantity};
  fs.writeFileSync(out+'/presentation-results.json',JSON.stringify(result,null,2));console.log(result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});


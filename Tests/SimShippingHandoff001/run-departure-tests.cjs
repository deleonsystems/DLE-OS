// Isolated browser with actual shell/styles and snapshots produced by disposable backend tests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const out='tmp/shipping-departure',read=n=>JSON.parse(fs.readFileSync(`${out}/${n}-fixture.json`,'utf8'));
const active=read('active'),completed=read('shipped');
const source=fs.readFileSync('DLE_Work_Center_v4.0.0.html','latin1');
const shell=source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const forms=source.slice(source.indexOf('function buildDigitalRequestToShipForm('),source.indexOf('function validateShipmentPreparation(',source.indexOf('function buildDigitalRequestToShipForm(')));
let checks=0;const check=(ok,message)=>{assert.ok(ok,message);checks++;};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  let snapshot=structuredClone(active),canStage=true,sim=true,loseResponse=false;const writes=[];let commands=new Set();
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  await page.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.pathname.startsWith('/api/')){
    if(r.method()==='POST'){
     const request=r.postDataJSON();writes.push({url:u.pathname,request});
     assert(u.pathname.endsWith('/'+active.authorizations[0].id+'/sim-departure'));
     commands.add(request.requestId);snapshot=structuredClone(completed);
     if(loseResponse){loseResponse=false;return route.abort();}
     return route.fulfill({json:snapshot});
    }
    return route.fulfill({json:u.pathname.endsWith('/queue')?{rows:[snapshot]}:{...snapshot,canConfirmSimDeparture:canStage&&snapshot.canConfirmSimDeparture}});
   }
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:shell});
   if(u.hostname!=='shipping-departure.test')return route.abort();
   const file=path.resolve('.'+decodeURIComponent(u.pathname));assert(file.startsWith(process.cwd()+path.sep));
   if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/jpeg'});
  });
  async function load(){
   await page.goto('https://shipping-departure.test/');
   await page.evaluate(({canStage,sim})=>{
    document.body.dataset.viewMode='desktop';document.body.dataset.simRuntime='true';
    window.DleOsRuntimeConfig={environment:sim?'SIMULATION':'ISOLATED_DEVELOPMENT'};
    window.DleOsCapabilities={can:p=>p==='shipments.view'||(canStage&&p==='shipments.stage')};
    document.querySelector('#dleEnvironmentBadge').textContent='SIM';document.querySelector('#dleFactoryClock').textContent='Isolated fixture - no live departure';
   },{canStage,sim});
   await page.addScriptTag({content:`function escapeHtml(s){const n=document.createElement('span');n.textContent=String(s??'');return n.innerHTML;}${forms}`});
   await page.addScriptTag({url:'/SRC/modules/shipping/shipping-handoff.js'});await page.addScriptTag({url:'/SRC/modules/shipping/shipping-print.js'});
   await require('./shell-fixture.cjs')(page);
   if(sim)await page.evaluate(()=>ShippingHandoff.renderShipping(document.querySelector('[data-workspace-mount="shipping"]')));
  }
  const jobs=page.locator('.shipping-job:visible'),confirm=page.locator('[data-sim-departure]');
  async function open(){await jobs.first().click();await page.locator('[data-print-kind="request"]').waitFor();}
  async function previewBoth(){
   const before=writes.length;
   for(const kind of ['request','packing'])for(let i=0;i<2;i++){
    await page.locator(`[data-print-kind="${kind}"]`).click();const frame=page.frames().find(x=>x!==page.mainFrame());await frame.waitForSelector('.sim-notice');
    const text=await frame.locator('body').innerText();check(text.includes('SIM PREVIEW')&&text.includes('0999999'),'print same job '+kind);
    if(snapshot.authorizations[0].departure)check(text.includes('SIM departure recorded')&&text.includes('NOT_STARTED'),'print truthful SIM departure '+kind);
    if(kind==='packing')check(!/COUNTRY OF ORIGIN|SN:|SERIAL NUMBER/.test(text)&&text.includes('DEVELOPMENTAL SIM PLACEHOLDER'),'packing approved omissions retained');
    await frame.evaluate(()=>{window.printCalls=0;window.print=()=>window.printCalls++;});
    await page.locator('[data-preview-print]').click();check(await frame.evaluate(()=>window.printCalls)===1,'print invocation '+kind);
    await page.locator('[data-preview-close]').click();
   }
   check(writes.length===before,'print cancel reprint zero writes');
  }
  await load();await open();check(await confirm.count()===1,'single eligible confirmation');
  await previewBoth();
  for(const [width,name] of [[1500,'desktop'],[900,'tablet'],[390,'narrow']]){
   await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.querySelector('main').scrollTo(0,0));
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow '+name);
   const height=await page.evaluate(()=>document.querySelector('main').scrollHeight+document.querySelector('body>header').offsetHeight+70);
   await page.setViewportSize({width,height});await page.screenshot({path:`${out}/departure-${name}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1500,height:1000});
  loseResponse=true;await confirm.click();await page.locator('[data-departure-message]').filter({hasText:'Retry uses the same request'}).waitFor();
  await confirm.evaluate(b=>{b.click();b.click();});await page.getByText('SIM departure recorded · Awaiting invoice',{exact:true}).waitFor();
  check(writes.length===2&&commands.size===1,'response-loss retry and double-click share one command');
  check(await confirm.count()===0,'completed job cannot be confirmed again');
  const detail=await page.locator('#shippingJobWorkspace').innerText();
  for(const text of ['WILL_CALL','Ground transport, prepaid and included','Artifact missing / not established','NOT_STARTED','130 Packaging','Not Started',completed.authorizations[0].departure.actor,completed.authorizations[0].departure.recordedAt])check(detail.includes(text),'completed evidence '+text);
  await previewBoth();
  await page.evaluate(()=>document.querySelector('main').scrollTo(0,0));
  const height=await page.evaluate(()=>document.querySelector('main').scrollHeight+200);await page.setViewportSize({width:1500,height});
  await page.screenshot({path:out+'/departure-completed.png',fullPage:true});
  await page.locator('[data-shipping-back]').click();await jobs.waitFor();
  check(await page.locator('[data-shipping-tab-select="shipped"]').getAttribute('aria-pressed')==='true','success selects completed tab');
  check((await page.locator('[data-shipping-tab-select="active"]').innerText()).includes('(0)')&&(await page.locator('[data-shipping-tab-select="shipped"]').innerText()).includes('(1)'),'exact tab count transition');
  await page.locator('[data-shipping-tab-select="active"]').click();check(await jobs.count()===0,'departed job removed from active');
  await page.locator('[data-shipping-tab-select="shipped"]').click();await page.locator('[data-shipping-search-input]').fill('no match');check(await jobs.count()===0,'completed filter');
  await page.locator('[data-shipping-search-input]').fill('0999999');check(await jobs.count()===1,'same job searchable');
  await load();await page.locator('[data-shipping-tab-select="shipped"]').click();await open();
  check(await confirm.count()===0&&writes.length===2,'reload and reopening never undo or mutate');
  await page.evaluate(()=>{const n=document.createElement('div');n.id='operationsCenterTable';n.innerHTML='<div data-handoff-summary="0999999"></div>';document.body.append(n);return ShippingHandoff.hydrateOperations(n);});
  check((await page.locator('[data-handoff-summary]').innerText()).includes('Shipped / Awaiting Invoice - SIM 10'),'same Operations job projects departure');
  // Read-only and non-SIM clients cannot expose a departure control.
  snapshot=structuredClone(active);canStage=false;await load();await open();check(await confirm.count()===0,'view-only permission has no action');
  sim=false;await load();await page.evaluate(()=>ShippingHandoff.open('0999999','detail'));check(await confirm.count()===0,'non-SIM has no action');
  check(writes.length===2,'no writes in reload/read-only/non-SIM flows');
  const result={verdict:'PASS',checks,commands:commands.size,postAttempts:writes.length,environment:'isolated headless API fixture; actual backend snapshots; no native printing or live mutation'};
  fs.writeFileSync(out+'/browser-results.json',JSON.stringify(result,null,2));console.log(result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});


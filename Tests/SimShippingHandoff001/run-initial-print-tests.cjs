// Browser qualification on an isolated read-only API fixture; never connects to the live host.
const fs=require('node:fs'), assert=require('node:assert/strict'), path=require('node:path');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const out='tmp/shipping-initial';
const snapshot=JSON.parse(fs.readFileSync(process.argv[2]||'tmp/shipping-handoff/live-before-restart.json','utf8').replace(/^\uFEFF/,''));
const source=fs.readFileSync('DLE_Work_Center_v4.0.0.html','latin1');
const functions=source.slice(source.indexOf('function buildDigitalRequestToShipForm('),source.indexOf('function validateShipmentPreparation(',source.indexOf('function buildDigitalRequestToShipForm(')));
const scripts=['SRC/shell/workspace-registry.js','SRC/home/work-area-home.js','SRC/modules/shipping/shipping-handoff.js','SRC/modules/shipping/shipping-print.js'];
const fixture=`<!doctype html><html><body data-sim-runtime="true"><div id="dleWorkAreaHome"></div><div id="queue"></div><script>
window.DleOsRuntimeConfig={environment:'SIMULATION'};window.DleOsSession={user:{displayName:'Shipping Operator'}};
window.permissions=['shipments.view','shipments.stage'];window.DleOsCapabilities={can:p=>permissions.includes(p)};
window.setWorkspaceView=id=>{window.entered=id;if(id==='shipping')ShippingHandoff.renderShipping(document.querySelector('#queue'));};window.go=()=>{};
function escapeHtml(s){const e=document.createElement('span');e.textContent=String(s??'');return e.innerHTML;}
${functions}</script>${scripts.map(p=>`<script src="/${p}"></script>`).join('')}<link rel="stylesheet" href="/SRC/modules/shipping/shipping-handoff.css"></body></html>`;
(async()=>{
 let browser;
 try {
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1300,height:1000}});let gets=0;const mutations=[];
 await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(req.method()!=='GET')mutations.push(req.method()+' '+u.pathname);
   if(u.pathname.startsWith('/api/')) {gets++;return route.fulfill({json:u.pathname.endsWith('/queue')?{rows:[snapshot]}:snapshot});}
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fixture});
   const file=path.resolve('.'+u.pathname);assert(file.startsWith(process.cwd()+path.sep));
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/jpeg'});
 });
 await page.goto('http://shipping-test/');await require('./shell-fixture.cjs')(page);await page.evaluate(()=>DleWorkAreaHome.render());
 assert.equal(await page.locator('[data-work-area="shipping"]').count(),1);
 assert.equal(await page.locator('[data-work-area="operations-center"]').count(),0);
 await page.locator('[data-work-area="shipping"]').click();
 await page.locator('[data-handoff-mode="detail"]').first().waitFor();
 assert.equal(await page.locator('#queue .shipping-job').count(),1);
 await page.evaluate(()=>ShippingHandoff.renderShipping(document.querySelector('#queue')));
 assert.equal(await page.locator('#queue .shipping-job').count(),1);
 await page.locator('[data-handoff-mode="detail"]').first().click();
 await page.locator('[data-print-kind="request"]').waitFor();
 assert.match(await page.locator('#shippingJobWorkspace').innerText(),/130 Packaging/);
 assert.equal(await page.locator('#shippingJobWorkspace form').count(),0);
 await page.screenshot({path:out+'/job-detail.png'});
 const serialized=JSON.stringify(snapshot);
 for(const kind of ['request','packing']) {
   for(let repeat=0;repeat<2;repeat++) {
     await page.locator(`[data-print-kind="${kind}"]`).click();
     const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForSelector('.sim-notice');
     const text=await frame.locator('body').innerText();
     for(const value of ['SIM PREVIEW','0099999','0999999','SIM-ASSY-001','DLE-SIM-CUSTOMER','10'])assert(text.includes(value),value);
     if(kind==='packing') {assert(!/COUNTRY OF ORIGIN|SN:|SERIAL NUMBER|MASON|0012046|300021707/.test(text));assert(text.includes('DEVELOPMENTAL SIM PLACEHOLDER'));assert(text.includes('WILL_CALL'));assert(/ground/i.test(text));}
     else {assert(text.includes('QF-7.5.5.1'));assert.equal(await frame.locator('tbody tr').first().locator('td').nth(2).innerText(),'A');}
     await frame.evaluate(()=>{window.printCalls=0;window.print=()=>{window.printCalls++;window.dispatchEvent(new Event('afterprint'));};});
     await page.locator('[data-preview-print]').click();await page.locator('[data-preview-print]').click();
     assert.equal(await frame.evaluate(()=>window.printCalls),2);
     if(!repeat){
       const html=await frame.content();fs.writeFileSync(out+'/'+kind+'.html',html);
       const printPage=await browser.newPage();await printPage.route('**/*',r=>r.fulfill({body:fs.readFileSync('ASSETS/LOGOS/DLE_Logo.JPG'),contentType:'image/jpeg'}));
       await printPage.setContent(html);await printPage.pdf({path:out+'/'+kind+'.pdf',preferCSSPageSize:true,printBackground:true});await printPage.close();
     }
     await page.locator('[data-preview-close]').click();await page.locator('#shippingPrintPreview').waitFor({state:'detached'});assert.equal(await page.locator('#shippingPrintPreview').count(),0);
   }
 }
 assert.equal(JSON.stringify(snapshot),serialized);assert.deepEqual(mutations,[]);
 await page.locator('[data-shipping-back]').click();
 await page.evaluate(()=>{permissions=[];DleWorkAreaHome.render();});assert.equal(await page.locator('[data-work-area="shipping"]').count(),0);
 await page.evaluate(()=>{permissions=['shipments.view'];document.body.dataset.viewMode='mobile';DleWorkAreaHome.render();});
 assert.equal(await page.locator('[data-mobile-work-area="shipping"]').count(),0);
 assert((await page.locator('#dleWorkAreaHome').innerText()).includes('Mobile View Coming Soon'));
 await page.reload();await page.evaluate(()=>ShippingHandoff.renderShipping(document.querySelector('#queue')));assert.equal(await page.locator('#queue .shipping-job').count(),1);
 const result={verdict:'PASS',environment:'isolated browser / preserved scenario fixture',gets,mutations,authorization:snapshot.authorizations[0].id,quantity:snapshot.authorizations[0].quantity,checks:'Home allowed/denied; independent Shipping; mobile unavailable; durable reload; context; both previews, repeat, cancel; print invocation; no writes; synthetic values; no COO/SN in packing'};
 fs.writeFileSync(out+'/browser-results.json',JSON.stringify(result,null,2));console.log(result);
 }finally{await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});


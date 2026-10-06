const fs=require('fs'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const source=fs.readFileSync('SRC/workspaces/rfqs/labor-workbench.js','utf8');
const css=fs.readFileSync('SRC/workspaces/rfqs/rfqs-workspace.css','utf8')+fs.readFileSync('SRC/workspaces/rfqs/labor-workbench.css','utf8');
(async()=>{for(const engine of ['webkit','edge']){const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));try{
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',r=>r.abort());await page.route('https://labor-fixture.test/',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('https://labor-fixture.test/');
 await page.setContent('<style>body{margin:0}'+css+'</style><body data-sim-runtime="true" data-view-mode="mobile"><main id="mount"></main></body>');
 await page.evaluate(()=>{
  window.posts=[];window.fail=false;window.readonly=false;
  window.saved={rfq:{customer:{customerName:'Isolated Labor Fixture'},assemblies:[{assemblyNumber:'TEST',revision:'A',quantity:25}],lanes:{labor:{status:'IN_PROGRESS'}},inputs:{manufacturing:{governingDocumentId:'DOC',package:{documents:[{documentId:'DOC'}]}}}},plan:{calculationVersion:'LABOR_BATCH_ALLOCATION_V6',revision:0,definitionId:'FIXTURE',quantity:25,template:'Synthetic',operations:[{id:'a',name:'Kitting',operationQuantity:null,runSeconds:null,instructions:''}],rate:75,markup:25,versions:[]}};
  window.DleOsCapabilities={can:()=>!readonly};
  window.fetch=async(url,options={})=>{
   if(url.endsWith('/bom-reference'))return new Response('<h1>Accepted BOM - read-only reference</h1><p>Isolated Accepted BOM v1</p><strong id="bom-total"></strong><table><thead><tr><th>Find</th><th>Qty</th></tr></thead><tbody><tr data-quantity="0.1"><td>1</td><td>0.1</td></tr><tr data-quantity="0.2"><td>2</td><td>0.2</td></tr></tbody></table><script>window.untrustedExecuted=true</script>',{headers:{'content-type':'text/html'}});
   if(url.includes('/pages/'))return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});
   if(options.method){const body=JSON.parse(options.body);posts.push(body);if(fail)return{ok:false,json:async()=>({message:'Fixture failed save'})};saved.plan={...saved.plan,...body,revision:saved.plan.revision+1};}
   return{ok:true,json:async()=>structuredClone(saved)};
  };
 });
 await page.addScriptTag({content:fs.readFileSync('SRC/workspaces/rfqs/bom-reference.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync('SRC/workspaces/rfqs/labor-drawing-viewer.js','utf8')});
 await page.addScriptTag({content:source});const open=()=>page.evaluate(()=>DleLaborWorkbench.open(document.querySelector('#mount'),{intakeId:'FIXTURE'},async()=>{}));await open();
 const qty=page.locator('[data-field="operationQuantity"]'),run=page.locator('[data-field="runSeconds"]');
 await qty.fill('55');await run.fill('30');assert.equal(await page.locator('[data-total="unit"]').innerText(),'$42.97');
 assert((await qty.boundingBox()).height>=44);
 await page.locator('[data-plan="rate"]').focus();await page.locator('[data-plan="rate"]').fill('75.5');assert.equal(await page.locator('[data-total="unit"]').innerText(),'$43.26');
 await run.fill('-1');await page.locator('[data-action="save"]').dispatchEvent('click');assert.equal(await page.evaluate(()=>posts.length),0);
 await run.fill('30');await page.locator('[data-action="mobile-notes"]').click();await page.locator('[data-field="instructions"]').fill('Long instruction '.repeat(100));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(()=>window.originalLaborRoot=document.querySelector('.labor-workbench'));
 for(const reference of ['Open Drawing','View BOM'])for(const cancel of [false,true]){
  await page.getByRole('link',{name:reference,exact:true}).click();await page.locator('.labor-drawing-viewer').waitFor();
  if(reference==='View BOM'){await page.waitForFunction(()=>document.querySelector('.labor-bom-viewer #bom-total')?.textContent==='0.3');assert.equal(await page.evaluate(()=>!!window.untrustedExecuted),false);}
  if(cancel)await page.keyboard.press('Escape');else await page.locator('[data-drawing-back]').click();
  await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});
  assert(await page.evaluate(()=>originalLaborRoot===document.querySelector('.labor-workbench')));
  assert.equal(await page.locator('[data-field="instructions"]').inputValue(),'Long instruction '.repeat(100));
  assert.equal(await page.locator('[data-field="operationQuantity"]').inputValue(),'55');
  assert.equal(await page.locator('[data-total="unit"]').innerText(),'$43.26');
  assert.equal(await page.evaluate(()=>posts.length),0);
 }

 await page.evaluate(()=>window.fail=true);await page.locator('[data-action="save"]').click();await page.waitForFunction(()=>document.querySelector('[role="status"]').textContent.includes('Fixture failed save'));
 assert.equal(await page.locator('[data-field="operationQuantity"]').inputValue(),'55');
 await page.evaluate(()=>window.fail=false);await page.locator('[data-action="save"]').click();await page.waitForFunction(()=>saved.plan.revision===1);
 assert.equal(await page.evaluate(()=>posts.at(-1).complete),false);
 await open();assert.equal(await page.locator('[data-total="unit"]').innerText(),'$43.26');
 await page.evaluate(()=>window.readonly=true);await open();assert(await page.locator('[data-action="save"]').isDisabled());assert(await page.locator('[data-action="complete"]').isDisabled());assert(await page.locator('[data-plan="rate"]').isDisabled());
 await page.evaluate(()=>{window.readonly=false;saved.plan.operations=[
  {id:'p',name:'Kitting',operationQuantity:999,runSeconds:999,instructions:'Existing instruction',notes:[{id:'n',text:'Existing step note',purpose:'PRODUCTION'}]},
  {id:'c',parentId:'p',name:'Count',operationQuantity:55,runSeconds:180,timeBasis:'BATCH',instructions:''},
  {id:'q',name:'Inspection',operationQuantity:null,runSeconds:null,instructions:''},
  {id:'d',parentId:'q',name:'Inspect',operationQuantity:2,runSeconds:12,instructions:''}
 ];});await open();
 const sub=id=>page.locator('[data-action="mobile-subs"][data-id="'+id+'"]');
 const row=id=>page.locator('[data-mobile-row="'+id+'"]');
 for(const width of [375,390,430,844]){
  await page.setViewportSize({width,height:width===844?390:844});
  assert(!(await row('c').isVisible())&&!(await row('d').isVisible()));assert.match(await sub('p').innerText(),/\(1\)/);
  assert.match(await page.locator('[data-action="mobile-notes"][data-id="p"]').innerText(),/instructions.*\(1\)/);
  await sub('p').focus();await page.keyboard.press('Enter');assert(await row('c').isVisible());assert(!(await row('d').isVisible()));assert(await sub('p').evaluate(e=>document.activeElement===e));
  assert.equal(await page.locator('[data-operation-total="p"]').innerText(),'396 sec');
  const cq=page.locator('[data-field="operationQuantity"][data-id="c"]'),cr=page.locator('[data-field="runSeconds"][data-id="c"]');
  const qb=await cq.boundingBox(),rb=await cr.boundingBox();assert(Math.abs(qb.y-rb.y)<2&&qb.height>=44&&rb.height>=44&&qb.x<rb.x);
  await cr.fill('180.5');assert.equal(await page.locator('[data-operation-total="p"]').innerText(),'397.1 sec');await cr.fill('180');
  await page.locator('[data-action="mobile-notes"][data-id="p"]').click();await page.locator('[data-field="instructions"][data-id="p"]').fill('Unsaved expanded instructions');
  for(const reference of ['View BOM','Open Drawing']){await page.getByRole('link',{name:reference,exact:true}).click();await page.locator('.labor-drawing-viewer').waitFor();await page.locator('[data-drawing-back]').click();await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});assert(await row('c').isVisible());assert.equal(await page.locator('[data-field="instructions"][data-id="p"]').inputValue(),'Unsaved expanded instructions');}
  await sub('q').click();assert(await row('d').isVisible());await sub('p').click();assert(!(await row('c').isVisible()));assert(await row('d').isVisible());await sub('q').click();
  await page.locator('[data-action="mobile-notes"][data-id="p"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 // Switching modes preserves independent disclosure choices, without saving anything.
 await page.evaluate(()=>document.body.dataset.viewMode='desktop');assert(await row('c').isVisible());assert(await row('d').isVisible());
 await page.locator('.labor-disclosure[data-id="p"]').click();assert(!(await row('c').isVisible()));
 await page.evaluate(()=>document.body.dataset.viewMode='mobile');await sub('p').click();assert(await row('c').isVisible());
 await page.evaluate(()=>document.body.dataset.viewMode='desktop');assert(!(await row('c').isVisible()));
 await page.evaluate(()=>document.body.dataset.viewMode='mobile');assert(await row('c').isVisible());
 await open();assert(!(await row('c').isVisible()));assert(!(await row('d').isVisible()));
 await page.evaluate(()=>window.readonly=true);await open();await sub('p').click();assert(await row('c').isVisible());assert(await page.locator('[data-field="runSeconds"][data-id="c"]').isDisabled());
 console.log('PASS',engine,'mobile editing/validation/failed save, read-only guards, four widths, fresh collapsed children, independent groups, keyboard focus, child counts, Batch decimals, expanded BOM/drawing return, isolated desktop disclosure state');
}finally{await browser.close();}}})().catch(e=>{console.error(e.message);process.exitCode=1});

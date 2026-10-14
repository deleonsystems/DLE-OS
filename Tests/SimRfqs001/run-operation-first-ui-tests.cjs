const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=process.env.LABOR_REPO||process.cwd(),source=process.env.LABOR_EDIT_SOURCE||path.join(repo,'SRC/workspaces/rfqs');
(async()=>{for(const [engine,width,height] of [['edge',1440,1000],['edge',1024,768],['webkit',1024,768]]){
 const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
 try{
  const page=await browser.newPage({viewport:{width,height},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url()==='https://text.test/'?r.fulfill({contentType:'text/html',body:'<body data-sim-runtime="true" data-view-mode="desktop"><main id="mount"></main></body>'}):r.abort());
  await page.goto('https://text.test/');
  await page.addStyleTag({path:path.join(repo,'SRC/workspaces/rfqs/rfqs-workspace.css')});
  await page.addStyleTag({path:path.join(source,'labor-workbench.css')});await page.addScriptTag({path:path.join(source,'labor-workbench.js')});
  await page.evaluate(()=>{
   const op=(id,name,parentId)=>({id,name,parentId,responsibleRole:parentId?null:(id==='p2'?'Kitting operator':'SMT Operator'),operationQuantity:2,runSeconds:30,instructions:'Keep '+id,notes:[{id:'note-'+id,purpose:'PRODUCTION',text:'Keep note'}],slides:[{id:'slide-'+id,kind:'BLANK',title:'Keep slide',stages:[]}]});
   window.saved={rfq:{customer:{customerName:'Isolated text fixture'},assemblies:[{assemblyNumber:'TEXT-TEST',revision:'A',quantity:25}],lanes:{labor:{status:'IN_PROGRESS'}},inputs:{manufacturing:{package:{documents:[]}}}},roleContractVersion:1,plan:{revision:1,quantity:25,rate:75,markup:10,charges:[],versions:[],operations:[op('p1','Preparation'),op('p2','Assembly'),op('c21','First','p2'),op('c22','Second','p2'),op('target','Target text','p2'),op('p3','Inspection'),op('source','Source operation text','p3')]}};
   window.initial=structuredClone(saved);window.posts=[];window.readonly=false;window.DleOsCapabilities={can:()=>!readonly};
   window.fetch=async(url,opt={})=>{if(url.endsWith('/drawing-notes'))return{ok:true,json:async()=>({contractVersion:2,layers:[]})};if(opt.method){const b=JSON.parse(opt.body);posts.push(b);saved.plan={...saved.plan,...b,revision:saved.plan.revision+1};}return{ok:true,json:async()=>structuredClone(saved)};};
  });
  const open=()=>page.evaluate(()=>DleLaborWorkbench.open(document.querySelector('#mount'),{intakeId:'TEXT-DISPOSABLE'},async()=>{}));await open();
  const input=id=>page.locator('[data-field="name"][data-id="'+id+'"]');
  if(process.env.LABOR_BASELINE){
   assert.equal(await input('target').count(),0);await page.locator('[data-action="pick"][data-id="target"]').click();await page.locator('[data-action="manual"][data-id="target"]').click();assert.equal(await input('target').evaluate(e=>e===document.activeElement),false);console.log('REPRODUCED: no direct text field; Manual Entry focuses detached old root');return;
  }
  assert.equal(await page.locator('[data-mobile-row="target"] [data-label="Seq"]').textContent(),'20.3');assert.equal(await page.locator('[data-mobile-row="source"] [data-label="Seq"]').textContent(),'30.1');
  const totals=await page.locator('[data-total="unit"]').textContent();
  for(let n=0;n<3;n++){
   await input('target').click();await input('target').press('ControlOrMeta+A');await input('target').pressSequentially('Manual typing '+n,{delay:15});assert.equal(await input('target').inputValue(),'Manual typing '+n);assert(await input('target').evaluate(e=>e===document.activeElement));
   await input('source').click();await input('source').press('ControlOrMeta+A');await input('source').press('ControlOrMeta+C');await input('target').click();await input('target').press('ControlOrMeta+A');await input('target').press('ControlOrMeta+V');assert.equal(await input('target').inputValue(),'Source operation text');await input('target').press(n===0?'Enter':'Tab');assert.equal(await input('target').inputValue(),'Source operation text');
  }
  await input('target').focus();await input('target').evaluate(e=>{window.sameInput=e;e.setSelectionRange(7,16);});await page.keyboard.type('replacement');assert.equal(await input('target').inputValue(),'Source replacement text');assert(await input('target').evaluate(e=>e===window.sameInput&&e.selectionStart===18));await input('target').press('Escape');assert.equal(await input('target').inputValue(),'Source operation text');
  await page.locator('[data-action="pick"][data-id="target"]').click();await page.locator('[data-action="manual"][data-id="target"]').click();assert(await input('target').evaluate(e=>e===document.activeElement));
  assert(await input('target').evaluate(e=>{const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});return e.dispatchEvent(ev);}),'native context menu is not intercepted');
  await input('target').press('End');await input('target').pressSequentially(' saved');await page.locator('h1').click();assert.equal(await input('target').inputValue(),'Source operation text saved');
  await page.locator('[data-action="supplemental"]').click();await page.locator('[data-action="traveler"]').click();assert.equal(await input('target').inputValue(),'Source operation text saved');
  await page.locator('[data-action="save"]').click();assert.equal(await page.evaluate(()=>posts.length),1);await open();assert.equal(await input('target').inputValue(),'Source operation text saved');
  await page.evaluate(()=>{const expected=structuredClone(initial.plan.operations);expected.find(o=>o.id==='target').name='Source operation text saved';if(JSON.stringify(saved.plan.operations)!==JSON.stringify(expected))throw Error('Unrelated operation data changed');});assert.equal(await page.locator('[data-total="unit"]').textContent(),totals);
  const persisted=await page.evaluate(()=>structuredClone(saved));await page.reload();
  await page.addStyleTag({path:path.join(repo,'SRC/workspaces/rfqs/rfqs-workspace.css')});await page.addStyleTag({path:path.join(source,'labor-workbench.css')});await page.addScriptTag({path:path.join(source,'labor-workbench.js')});
  await page.evaluate(saved=>{window.saved=saved;window.readonly=false;window.DleOsCapabilities={can:()=>!readonly};window.fetch=async url=>({ok:true,json:async()=>url.endsWith('/drawing-notes')?{contractVersion:2,layers:[]}:structuredClone(saved)});},persisted);await open();assert.equal(await input('target').inputValue(),'Source operation text saved');assert.equal(await input('source').inputValue(),'Source operation text');
  await page.locator('.labor-grid-scroll').evaluate(e=>e.scrollTop=0);
  fs.mkdirSync(process.env.LABOR_TEST_OUTPUT||'tmp/operation-text',{recursive:true});await page.screenshot({path:path.join(process.env.LABOR_TEST_OUTPUT||'tmp/operation-text',engine+'-'+width+'.png'),fullPage:true});
  await page.evaluate(()=>{window.fetch=async(url,opt={})=>{if(url.endsWith('/drawing-notes'))return{ok:true,json:async()=>({contractVersion:2,layers:[]})};if(opt.method){const b=JSON.parse(opt.body);saved.plan={...saved.plan,...b,revision:saved.plan.revision+1};}return{ok:true,json:async()=>structuredClone(saved)};};});
  assert.equal(await page.locator('[data-role-id]').count(),0);
  const section=async id=>page.locator('[data-mobile-row="'+id+'"]').evaluate(el=>{while(el=el.previousElementSibling){if(el.dataset.laborSection)return el.dataset.laborSection;}return null;});
  await input('p2').fill('SMT');await input('p2').press('Tab');assert.equal(await section('p2'),'Production');
  await page.locator('[data-action="pick"][data-id="target"]').click();
  assert(await page.getByRole('button',{name:'SMT Machine Placement',exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'Pull Components',exact:true}).count(),0);
  await page.getByRole('button',{name:'SMT Machine Placement',exact:true}).click();assert.equal(await input('target').inputValue(),'SMT Machine Placement');
  await input('p2').focus();await input('p2').fill('Kitting');await input('p2').press('Escape');assert.equal(await input('p2').inputValue(),'SMT');
  await input('p2').fill('Kitting');await input('p2').press('Tab');assert.equal(await section('p2'),'Materials/Kit');assert.equal(await section('target'),'Materials/Kit');
  await page.locator('[data-action="pick"][data-id="target"]').click();assert(await page.getByRole('button',{name:'Pull Components',exact:true}).isVisible());assert(await page.getByRole('button',{name:'Cleaning',exact:true}).isVisible());await page.getByRole('button',{name:/Manual Entry/}).click();
  await input('p2').fill('Custom bench');await input('p2').press('Tab');assert.equal(await section('p2'),'Production');
  await page.locator('[data-action="pick"][data-id="target"]').click();assert(await page.getByRole('button',{name:'SMT Hand Placement',exact:true}).isVisible());assert(await page.getByRole('button',{name:'Quality Inspection',exact:true}).isVisible());await page.getByRole('button',{name:'Cleaning',exact:true}).click();assert.equal(await input('target').inputValue(),'Cleaning');
  await page.locator('[data-action="save"]').click();await open();assert.equal(await input('p2').inputValue(),'Custom bench');assert.equal(await input('target').inputValue(),'Cleaning');
  assert.equal(await page.evaluate(()=>saved.plan.operations.find(o=>o.id==='p2').responsibleRole),'Kitting operator');
  console.log('PASS category typing, role/category conflict, dynamic substep choices, Materials/Kit move, custom fallback, Cleaning, no role controls, preserved role on save/reopen',engine,width);
  await page.evaluate(()=>readonly=true);await open();assert(await input('target').isDisabled());assert.deepEqual(errors,[]);
  console.log('PASS',engine,width,'typing, native keyboard copy/paste 30.1 to 20.3, selection/cursor identity, Enter/Tab/blur/Escape, manual focus, contextmenu not intercepted, reopen/save, unchanged unrelated fields/totals, readonly');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});

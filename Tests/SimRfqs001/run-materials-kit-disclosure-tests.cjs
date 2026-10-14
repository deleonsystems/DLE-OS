const fs=require('fs'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
(async()=>{for(const [engine,width,height] of [['edge',1440,1000],['webkit',1024,768],['webkit',390,844]]){
 if(process.env.MATERIALS_KIT_WIDTH&&Number(process.env.MATERIALS_KIT_WIDTH)!==width)continue;
 const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
 try{
  const page=await browser.newPage({viewport:{width,height},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('blob:')?r.continue():r.request().url()==='https://disclosure.test/'?r.fulfill({contentType:'text/html',body:'<body data-sim-runtime="true" data-view-mode="'+(width<700?'mobile':'desktop')+'"><main id="mount"></main></body>'}):r.abort());
  await page.goto('https://disclosure.test/');
  for(const name of ['rfqs-workspace.css','labor-workbench.css'])await page.addStyleTag({path:'SRC/workspaces/rfqs/'+name});
  for(const name of ['labor-workbench.js','labor-slides.js','labor-drawing-notes.js'])await page.addScriptTag({path:'SRC/workspaces/rfqs/'+name});
  await page.evaluate(()=>{
   const stage=()=>({id:crypto.randomUUID(),name:'Stage',marks:[],savedView:{page:1,x:.5,y:.5,width:1,height:1,rotation:0}});
   const card=(kind,title)=>({id:crypto.randomUUID(),kind,title,body:'',page:1,stages:[stage()]});
   window.saved={rfq:{customer:{customerName:'Isolated disclosure fixture'},assemblies:[{assemblyNumber:'TEST',revision:'A',quantity:25}],lanes:{labor:{status:'IN_PROGRESS'}},inputs:{manufacturing:{governingDocumentId:'DOC',package:{documents:[{documentId:'DOC'}]}}}},roleContractVersion:1,slideContractVersion:1,plan:{revision:1,definitionId:'FIXTURE',calculationVersion:'LABOR_BATCH_ALLOCATION_V6',quantity:25,rate:75,markup:15,charges:[],versions:[],operations:[
    {id:'kit',name:'Kitting',responsibleRole:'Kitting operator',instructions:'Original kit instruction',slides:[card('START','Start operation')]},
    {id:'count',parentId:'kit',name:'Count components',operationQuantity:1,runSeconds:12,responsibleRole:null,instructions:''},
    {id:'build',name:'SMT',responsibleRole:'SMT Operator',operationQuantity:1,runSeconds:20,instructions:'Build instruction',slides:[card('START','Build start'),card('NOTE','First production instruction')]}
   ]}};window.posts=[];window.readonly=false;
   window.DleOsCapabilities={can:()=>!readonly};
   window.fetch=async(url,options={})=>{
    if(url.endsWith('/drawing-notes'))return {ok:true,json:async()=>({contractVersion:2,layers:[]})};
    if(options.method){const body=JSON.parse(options.body);posts.push(body);saved.plan={...saved.plan,...body,revision:saved.plan.revision+1};}
    return {ok:true,json:async()=>structuredClone(saved)};
   };
  });
  const open=id=>page.evaluate(id=>DleLaborWorkbench.open(document.querySelector('#mount'),{intakeId:id||'DISCLOSURE'},async()=>{}),id);
  await open();const toggle=page.getByRole('button',{name:'Materials/Kit',exact:true});
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert((await toggle.boundingBox()).height>=44);
  if(width<700){await page.locator('[data-action="mobile-subs"][data-id="kit"]').click();await page.locator('[data-action="mobile-notes"][data-id="kit"]').click();}
  const input=page.locator('[data-id="kit"][data-field="instructions"]');await input.fill('Unsaved kit instruction');
  await page.locator('[data-id="count"][data-field="runSeconds"]').fill('18');
  const panel=page.locator('[data-slide-operation="kit"]');await page.locator('[data-action="options"][data-id="kit"]').click();await page.locator('[data-options="kit"] [data-action="view-slides"]').click();await panel.locator('[data-slide-menu]').click();await page.locator('[data-command=details]').click();await panel.locator('[data-card-field="title"]').fill('Unsaved Start title');
  await page.evaluate(()=>window.editedNode=document.querySelector('[data-id="kit"][data-field="instructions"]'));
  const total=await page.locator('[data-total="unit"]').textContent();
  for(let i=0;i<3;i++){
   if(i===2)await toggle.tap();else await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('[data-mobile-row="kit"]').isVisible(),false);assert.equal(await page.locator('[data-slide-row="kit"]').isVisible(),false);assert.equal(await page.locator('[data-mobile-row="count"]').isVisible(),false);assert(await page.locator('[data-mobile-row="build"]').isVisible());
   await toggle.focus();await page.keyboard.press(i%2?'Enter':'Space');assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await input.inputValue(),'Unsaved kit instruction');assert.equal(await panel.locator('[data-card-field="title"]').inputValue(),'Unsaved Start title');assert.equal(await page.locator('[data-total="unit"]').textContent(),total);assert(await page.evaluate(()=>editedNode===document.querySelector('[data-id="kit"][data-field="instructions"]')));
  }
  await toggle.click();await page.screenshot({path:'tmp/slides/materials-kit-collapsed-'+engine+'-'+width+'.png'});
  await page.locator('[data-action="slides-preview"]').click();await page.locator('.labor-slide-playback').waitFor();assert((await page.locator('.labor-drawing-heading strong').textContent()).startsWith('20 SMT'));assert((await page.locator('.labor-slide-playback output').textContent()).startsWith('1 / 2'));await page.locator('.labor-slide-playback button').last().click();await page.waitForFunction(()=>document.querySelector('.labor-slide-caption')?.textContent==='First production instruction');await page.locator('[data-back]').click();await page.locator('.labor-annotation-viewer').waitFor({state:'detached'});assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await page.locator('[data-action="supplemental"]').click();await page.locator('[data-action="traveler"]').click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await input.inputValue(),'Unsaved kit instruction');assert.equal(await page.evaluate(()=>posts.length),0,'disclosure/navigation/playback never saves');
  await page.locator('[data-action="save"]').click();await page.waitForFunction(()=>posts.length===1);await open();assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();assert.equal(await input.inputValue(),'Unsaved kit instruction');assert.equal(await page.locator('[data-total="unit"]').textContent(),total);
  await toggle.click();await page.addScriptTag({path:'SRC/workspaces/rfqs/labor-workbench.js'});await open();assert.equal(await toggle.getAttribute('aria-expanded'),'false','local preference survives module reload');
  await open('OTHER-JOB');assert.equal(await toggle.getAttribute('aria-expanded'),'true','new jobs default expanded');await open();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await page.evaluate(()=>{readonly=true;});await open();await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true','readonly jobs retain display control');
  await page.evaluate(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('storage unavailable');},configurable:true}));await toggle.click();await open();assert.equal(await toggle.getAttribute('aria-expanded'),'false','in-memory fallback preserves choice');
  assert.equal(await page.evaluate(()=>posts.length),1);assert.deepEqual(errors,[]);console.log('PASS '+engine+' '+width+': compact accessible disclosure, repeated keyboard/touch-target toggles, unsaved fields/slides, totals, production playback, navigation/reopen/local preference, per-job defaults, readonly/storage fallback');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});

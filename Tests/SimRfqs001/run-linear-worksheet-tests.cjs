const fs=require('fs'),assert=require('assert/strict'),path=require('path');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
(async()=>{for(const [engine,width,height] of [['edge',1440,1000],['edge',1024,768],['webkit',1024,768]]){
const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
try{
 console.log('START',engine,width);const page=await browser.newPage({viewport:{width,height},hasTouch:true}),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 await page.route('**/*',r=>r.request().url()==='https://linear.test/'?r.fulfill({contentType:'text/html',body:'<body data-sim-runtime="true" data-view-mode="desktop"><main id="mount"></main></body>'}):r.abort());
 await page.goto('https://linear.test/');
 for(const name of ['rfqs-workspace.css','labor-workbench.css'])await page.addStyleTag({path:'SRC/workspaces/rfqs/'+name});
 for(const name of ['labor-workbench.js','labor-slides.js','labor-drawing-notes.js'])await page.addScriptTag({path:'SRC/workspaces/rfqs/'+name});
 await page.evaluate(()=>{
  const card=(id,kind)=>({id,kind,title:kind==='BLANK'?'Intentional blank':'Operator instruction',body:kind==='NOTE'?'Preserved note':'',page:1,stages:[{id:id+'-stage',name:'Stage',marks:[],savedView:{page:1,x:.5,y:.5,width:1,height:1,rotation:0}}]});
  window.saved={rfq:{customer:{customerName:'Disposable worksheet fixture'},assemblies:[{assemblyNumber:'TEST',revision:'A',quantity:25}],lanes:{labor:{status:'IN_PROGRESS'}},inputs:{manufacturing:{governingDocumentId:'DOC',package:{documents:[{documentId:'DOC'}]}}}},roleContractVersion:1,slideContractVersion:3,plan:{revision:1,definitionId:'FIXTURE',calculationVersion:'LABOR_BATCH_ALLOCATION_V6',quantity:25,rate:75,markup:15,charges:[],versions:[],operations:[
   {id:'kit',name:'Kitting',responsibleRole:'Kitting operator',operationQuantity:1,runSeconds:10,instructions:'Kit'},
   {id:'build',name:'SMT',responsibleRole:'SMT Operator',operationQuantity:1,runSeconds:20,instructions:'Build',slides:[card('blank','BLANK'),card('note','NOTE')]},
   {id:'child',parentId:'build',name:'Substep',responsibleRole:null,operationQuantity:2,runSeconds:30,instructions:'Preserve instructions',notes:[{id:'n1',text:'Preserved annotation',purpose:'PRODUCTION'}]},
   {id:'conflict',parentId:'build',name:'Legacy inspection',responsibleRole:'Quality Inspector',operationQuantity:1,runSeconds:5,instructions:'Legacy role remains'},
   {id:'pack',name:'Packaging',responsibleRole:'Packaging',operationQuantity:1,runSeconds:12,instructions:'Pack'}
  ]}};window.initial=structuredClone(saved.plan);window.posts=[];window.readonly=false;window.DleOsCapabilities={can:()=>!readonly};
  window.fetch=async(url,options={})=>{if(url.endsWith('/drawing-notes'))return {ok:true,json:async()=>({contractVersion:2,layers:[]})};if(options.method){const body=JSON.parse(options.body);posts.push(body);saved.plan={...saved.plan,...body,revision:saved.plan.revision+1};}return {ok:true,json:async()=>structuredClone(saved)};};
 });
 const open=()=>page.evaluate(()=>DleLaborWorkbench.open(document.querySelector('#mount'),{intakeId:'LINEAR-DISPOSABLE'},async()=>{document.querySelector('#mount').innerHTML='Returned';}));console.log('loaded');await open();console.log('opened');
 const menu=id=>page.locator('[data-options="'+id+'"]'),trigger=id=>page.locator('[data-action="options"][data-id="'+id+'"]');
 async function action(id,name){await trigger(id).tap();await menu(id).locator('[data-action="'+name+'"]').click();}
 assert.deepEqual(await page.locator('.labor-grid thead th').allTextContents(),['Seq','Operation','Qty','Run / Unit (sec)','Notes','Total time','Options']);
 assert.equal(await page.locator('.labor-slide-row:visible').count(),0);assert.equal(await page.locator('[data-role-id]').count(),0);
 assert.equal(await page.locator('[data-mobile-row="child"] select').count(),0);assert.equal(await page.locator('.labor-role-conflicts').count(),0);
 assert.equal(await page.locator('[data-operation-total="child"]').textContent(),'60 sec / unit');
 for(const id of ['kit','build','pack'])assert.equal(await page.locator('[data-mobile-row="'+id+'"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(226, 237, 244)');
 for(const id of ['child','conflict'])assert.equal(await page.locator('[data-mobile-row="'+id+'"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 console.log('layout and standalone/main/child shading checked');for(let i=0;i<3;i++){
  await trigger('child').tap();assert(await menu('child').isVisible());const box=await menu('child').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height);
  await trigger('child').tap();assert(!await menu('child').isVisible());await trigger('child').tap();await page.keyboard.press('Escape');assert(!await menu('child').isVisible());assert(await trigger('child').evaluate(e=>e===document.activeElement));
 }
 await trigger('child').tap();await page.locator('h1').tap();assert(!await menu('child').isVisible());
 await trigger('child').tap();await page.locator('[data-plan="rate"]').focus();assert(!await menu('child').isVisible());
 await trigger('child').tap();await page.evaluate(()=>window.dispatchEvent(new Event('resize')));assert(!await menu('child').isVisible());
 await page.evaluate(()=>{document.querySelector('.labor-grid-scroll').style.maxHeight='220px';document.querySelector('.labor-grid-scroll').style.flex='none';});
 await trigger('child').tap();await page.evaluate(()=>document.querySelector('.labor-grid-scroll').scrollTop=0);await page.waitForTimeout(100);assert(!await menu('child').isVisible(),'scrolling the anchor dismisses the menu');
 await page.evaluate(()=>{document.querySelector('.labor-grid-scroll').style.maxHeight='';document.querySelector('.labor-grid-scroll').style.flex='';});
 await trigger('child').tap();await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'drawing-notes');await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'basis');await page.keyboard.press('Escape');
 console.log('menus checked');await action('build','view-slides');assert(await page.locator('[data-slide-row="build"]').isVisible());assert.equal(await page.locator('[data-slide-card]').count(),2);
 await page.locator('[data-slide-card="blank"] [data-slide-title]').click();await page.locator('.labor-annotation-viewer').waitFor();await page.locator('[data-back]').click();await page.locator('.labor-annotation-viewer').waitFor({state:'detached'});
 await page.locator('[data-action="close-slides"][data-id="build"]').click();assert.equal(await page.locator('.labor-slide-row:visible').count(),0);
 await trigger('child').tap();await menu('child').locator('[data-basis="BATCH"]').click();assert.equal(await page.locator('[data-operation-total="child"]').textContent(),'2.4 sec / unit*');assert.equal(await page.locator('[data-id="child"][data-field="runSeconds"]').getAttribute('aria-label'),'Run seconds per batch item child');assert.equal(await page.locator('[data-id="child"][data-field="runSeconds"]').inputValue(),'30');
 await trigger('build').tap();assert(await menu('build').locator('[data-basis="BATCH"]').isDisabled());await page.keyboard.press('Escape');
 await action('child','down');assert.deepEqual(await page.locator('[data-mobile-row]').evaluateAll(es=>es.map(e=>e.dataset.mobileRow)),['kit','build','conflict','child','pack']);await action('child','up');
 await action('build','remove');assert(await page.locator('[data-action="cancel-remove"]').isVisible());await page.locator('[data-action="cancel-remove"]').click();assert.equal(await page.locator('[data-mobile-row]').count(),5);
 const before=await page.locator('[data-total="unit"]').textContent();await page.locator('[data-action="toggle-materials-kit"]').click();assert(!await page.locator('[data-mobile-row="kit"]').isVisible());assert.equal(await page.locator('[data-total="unit"]').textContent(),before);
 assert.equal(await page.locator('[data-role-id]').count(),0);
 await page.locator('[data-action="save"]').click();assert.equal(await page.evaluate(()=>posts.length),1);
 await page.evaluate(()=>{const p=posts[0];for(const id of ['build','conflict']){const a=initial.operations.find(o=>o.id===id),b=p.operations.find(o=>o.id===id);if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Changed protected operation '+id);}if(p.operations.find(o=>o.id==='child').responsibleRole!==null)throw Error('Changed inherited role');});
 await page.screenshot({path:'tmp/slides/linear-worksheet-'+engine+'-'+width+'.png',fullPage:true});
 await trigger('child').tap();await page.screenshot({path:'tmp/slides/linear-menu-'+engine+'-'+width+'.png',fullPage:true});await page.keyboard.press('Escape');
 await page.evaluate(()=>readonly=true);await open();await action('build','view-slides');assert(await page.locator('[data-slide-row="build"]').isVisible());assert.equal(await page.locator('[data-role-id]').count(),0);
 await page.locator('[data-action="close-slides"][data-id="build"]').click();await trigger('child').tap();await page.evaluate(()=>document.querySelector('#mount').innerHTML='Navigated away');await page.waitForTimeout(50);await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('PASS '+engine+' '+width+': seven columns, hidden slides, preserved legacy roles, batch allocation, repeated touch/menu dismissal, scroll/navigation cleanup, keyboard, slide editor return, movement, delete guard, Materials/Kit totals, unchanged slide IDs and content, save and readonly');
}catch(e){console.error(e);throw e;}finally{console.log('closing',engine);await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});

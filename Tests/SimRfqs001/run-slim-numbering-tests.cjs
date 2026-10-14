const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=process.env.LABOR_REPO||process.cwd(),source=process.env.LABOR_EDIT_SOURCE||path.join(repo,'SRC/workspaces/rfqs');
(async()=>{for(const [engine,width,height] of [['edge',1440,1000],['edge',1024,768],['webkit',1024,768],['webkit',390,844]]){if(process.env.TEST_WIDTH&&width!==Number(process.env.TEST_WIDTH))continue;
 const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
 try{
  const page=await browser.newPage({viewport:{width,height},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url()==='https://text.test/'?r.fulfill({contentType:'text/html',body:'<body data-sim-runtime="true" data-view-mode="'+(width<600?'mobile':'desktop')+'"><main id="mount"></main></body>'}):r.abort());
  await page.goto('https://text.test/');
  await page.addStyleTag({path:path.join(repo,'SRC/workspaces/rfqs/rfqs-workspace.css')});
  await page.addStyleTag({path:path.join(source,'labor-workbench.css')});await page.addScriptTag({path:path.join(source,'labor-workbench.js')});
  await page.evaluate(()=>{
   const op=(id,name,parentId)=>({id,name,parentId,responsibleRole:parentId?null:'SMT Operator',operationQuantity:2,runSeconds:30,instructions:'Keep '+id,notes:[{id:'note-'+id,purpose:'PRODUCTION',text:'Keep note'}],slides:[{id:'slide-'+id,kind:'BLANK',title:'Keep slide',stages:[]}]});
   window.saved={rfq:{customer:{customerName:'Isolated text fixture'},assemblies:[{assemblyNumber:'TEXT-TEST',revision:'A',quantity:25}],lanes:{labor:{status:'IN_PROGRESS'}},inputs:{manufacturing:{package:{documents:[]}}}},roleContractVersion:1,plan:{revision:1,quantity:25,rate:75,markup:10,charges:[],versions:[],operations:[op('p1','Preparation'),op('p2','Assembly'),op('c21','First','p2'),op('c22','Second','p2'),op('target','Target text','p2'),op('p3','Inspection'),op('source','Source operation text','p3')]}};
   window.initial=structuredClone(saved);window.posts=[];window.readonly=false;window.DleOsCapabilities={can:()=>!readonly};
   window.fetch=async(url,opt={})=>{if(url.endsWith('/drawing-notes'))return{ok:true,json:async()=>({contractVersion:2,layers:[]})};if(opt.method){const b=JSON.parse(opt.body);posts.push(b);saved.plan={...saved.plan,...b,revision:saved.plan.revision+1};}return{ok:true,json:async()=>structuredClone(saved)};};
  });
  const open=()=>page.evaluate(()=>DleLaborWorkbench.open(document.querySelector('#mount'),{intakeId:'TEXT-DISPOSABLE'},async()=>{}));await open();
  const input=id=>page.locator('[data-field="name"][data-id="'+id+'"]');
  if(process.env.LABOR_BASELINE){
   assert.equal(await input('target').count(),0);await page.locator('[data-action="pick"][data-id="target"]').click();await page.locator('[data-action="manual"][data-id="target"]').click();assert.equal(await input('target').evaluate(e=>e===document.activeElement),false);console.log('REPRODUCED: no direct text field; Manual Entry focuses detached old root');return;
  }

  assert.equal(await page.locator('.labor-add-sub').count(),0);
  const row=id=>page.locator('[data-mobile-row="'+id+'"]'),seq=id=>row(id).locator('[data-label="Seq"]');
  if(width<600){await row('p2').locator('[data-action="options"]').tap();await row('p2').locator('[data-action="mobile-subs"]').tap();await page.keyboard.press('Escape');}
  if(width>=600)for(const id of ['p2','target'])assert((await row(id).boundingBox()).height<=51,'compact row '+id);
  assert.equal(await seq('target').innerText(),'2.3');assert.equal(await seq('source').innerText(),'3.1');
  await row('p2').locator('[data-action="options"]').tap();const add=page.getByRole('button',{name:'Add Sub-operation p2',exact:true});await add.waitFor();assert((await add.boundingBox()).height>=44);await add.tap();
  const id=await page.locator('[data-field="name"]').evaluateAll(es=>es.find(e=>e.value==='').dataset.id);await input(id).fill('New step');await input(id).press('Tab');assert.equal(await seq(id).innerText(),'2.4');
  await row(id).locator('[data-action="options"]').click();await page.getByRole('button',{name:'Move Up '+id,exact:true}).click();assert.equal(await seq(id).innerText(),'2.3');assert.equal(await seq('target').innerText(),'2.4');
  await page.getByRole('button',{name:'Save Labor',exact:true}).click();await open();assert.equal(await seq(id).innerText(),'2.3');assert.equal(await input(id).inputValue(),'New step');
  const persisted=await page.evaluate(()=>saved.plan.operations);assert.equal(persisted.find(o=>o.id===id).parentId,'p2');assert(persisted.every(o=>!('seq' in o)&&!('legacySeq' in o)&&!('mainOrdinal' in o)));
  await input('p1').fill('Kitting');await input('p1').press('Tab');assert.equal(await seq('p2').innerText(),'1');assert.equal(await seq(id).innerText(),'1.3');await page.locator('[data-action="toggle-materials-kit"]').click();assert.equal(await seq('p2').innerText(),'1');
  await page.screenshot({path:'tmp/organizer/slim-rows-'+engine+'-'+width+'.png'});assert.deepEqual(errors,[]);console.log('PASS '+engine+' '+width+': slim parent/child rows, accessible touch add, child reorder, save/reopen, immutable IDs, display refresh after category edit and stable Materials toggle');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});

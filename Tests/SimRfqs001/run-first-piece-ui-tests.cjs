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
   const op=(id,name,parentId)=>({id,name,parentId,responsibleRole:parentId?null:'SMT Operator',operationQuantity:2,runSeconds:30,instructions:'Keep '+id,notes:[{id:'note-'+id,purpose:'PRODUCTION',text:'Keep note'}],slides:[{id:'slide-'+id,kind:'BLANK',title:'Keep slide',stages:[]}]});
   window.saved={rfq:{customer:{customerName:'Isolated text fixture'},assemblies:[{assemblyNumber:'TEXT-TEST',revision:'A',quantity:25}],lanes:{labor:{status:'IN_PROGRESS'}},inputs:{manufacturing:{package:{documents:[]}}}},roleContractVersion:1,slideContractVersion:7,plan:{revision:1,quantity:25,rate:75,markup:10,charges:[],versions:[],operations:[op('p1','Preparation'),op('p2','Assembly'),op('c21','First','p2'),op('c22','Second','p2'),op('target','Target text','p2'),op('p3','Inspection'),op('source','Source operation text','p3')]}};
   saved.plan.operations.find(o=>o.id==='p1').timeBasis='BATCH';saved.plan.operations.find(o=>o.id==='c21').timeBasis='BATCH';window.initial=structuredClone(saved);window.posts=[];window.readonly=false;window.DleOsCapabilities={can:()=>!readonly};
   window.fetch=async(url,opt={})=>{if(url.endsWith('/drawing-notes'))return{ok:true,json:async()=>({contractVersion:2,layers:[]})};if(opt.method){const b=JSON.parse(opt.body);posts.push(b);saved.plan={...saved.plan,...b,revision:saved.plan.revision+1};}return{ok:true,json:async()=>structuredClone(saved)};};
  });
  const open=()=>page.evaluate(()=>DleLaborWorkbench.open(document.querySelector('#mount'),{intakeId:'TEXT-DISPOSABLE'},async()=>{}));await open();
  const input=id=>page.locator('[data-field="name"][data-id="'+id+'"]');
  if(process.env.LABOR_BASELINE){
   assert.equal(await input('target').count(),0);await page.locator('[data-action="pick"][data-id="target"]').click();await page.locator('[data-action="manual"][data-id="target"]').click();assert.equal(await input('target').evaluate(e=>e===document.activeElement),false);console.log('REPRODUCED: no direct text field; Manual Entry focuses detached old root');return;
  }

  const opts=async()=>{await page.locator('[data-action="options"][data-id="p2"]').click();};
  await opts();let toggle=page.locator('[data-action="first-piece-toggle"][data-id="p2"]');assert.equal(await toggle.getAttribute('aria-checked'),'false');await toggle.click();await opts();assert.equal(await toggle.getAttribute('aria-checked'),'true');await page.locator('[data-first-piece="inspectionOperationId"]').selectOption('p1');await page.locator('[data-first-piece="setup"][data-step="c21"]').check();assert.equal(await page.locator('[data-first-piece="captureSerial"]').isChecked(),false);await page.locator('[data-first-piece="captureSerial"]').check();assert(await page.locator('.labor-first-piece-settings').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'settings must fit without horizontal clipping');await page.screenshot({path:'tmp/organizer/first-piece-options-'+engine+'-'+width+'.png'});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Save Labor',exact:true}).click();await open();assert(await page.evaluate(()=>saved.plan.operations.find(o=>o.id==='p2').firstPiece.captureSerial));assert.equal(await page.evaluate(()=>saved.plan.operations.length),7);const count=await page.evaluate(()=>saved.plan.operations.flatMap(o=>o.slides).length);
  for(let i=0;i<2;i++){await opts();await toggle.click();await opts();await toggle.click();}await page.getByRole('button',{name:'Save Labor',exact:true}).click();assert.equal(await page.evaluate(()=>saved.plan.operations.length),7);assert.equal(await page.evaluate(()=>saved.plan.operations.flatMap(o=>o.slides).length),count);assert(await page.evaluate(()=>saved.plan.operations.find(o=>o.id==='p2').firstPiece.enabled));assert.deepEqual(errors,[]);console.log('PASS '+engine+' '+width+': default off, main-only toggle, inspection link, one-time setup and optional serial, save/reopen and repeated toggles without duplicated instructions');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});

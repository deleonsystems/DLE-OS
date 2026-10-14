const fs=require('fs'),assert=require('assert/strict');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
(async()=>{for(const [engine,width,height] of [['edge',1440,1000],['webkit',1024,768]]){
 const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));try{
 const page=await browser.newPage({viewport:{width,height},hasTouch:true}),errors=[],writes=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const png=fs.readFileSync('tmp/labor-drawing-notes/synthetic.png');
 await page.route('**/*',r=>{const url=r.request().url();if(url.startsWith('blob:'))return r.continue();if(r.request().method()!=='GET')writes.push(url);if(url==='https://traveler.test/')return r.fulfill({contentType:'text/html',body:'<body><main class="labor-workbench"><button id="play">Play</button><details data-slide-operation="a"></details></main></body>'});if(url.endsWith('/info'))return r.fulfill({json:{pageCount:2}});if(url.endsWith('/drawing-notes'))return r.fulfill({json:{source:{documentId:'pdf',sha256:'A'.repeat(64),definitionId:'fixture',name:'Assembly.pdf',revision:'B'}}});if(url.includes('/pages/'))return r.fulfill({contentType:'image/png',body:png});return r.fulfill({status:404});});
 await page.goto('https://traveler.test/');await page.addStyleTag({path:'SRC/workspaces/rfqs/labor-workbench.css'});for(const f of ['labor-workbench','labor-drawing-notes','labor-slides'])await page.addScriptTag({path:'SRC/workspaces/rfqs/'+f+'.js'});
 await page.evaluate(()=>{const card={id:crypto.randomUUID(),kind:'NOTE',title:'Authored child',body:'Preserved instructions',page:1,stages:[{id:crypto.randomUUID(),name:'Stage',marks:[],savedView:{page:1,x:.5,y:.5,width:1,height:1,rotation:0}}]};window.traveler={assembly:'B11283-17',revision:'B'};window.plan={quantity:25,definitionId:'fixture',operations:[{id:'kit',name:'Kitting',slides:[]},{id:'a',name:'SMT',instructions:'Check polarity before loading.',notes:[{purpose:'INTERNAL_RFQ',text:'PRIVATE'}],slides:[]},{id:'n',parentId:'a',name:'Notes only',instructions:'Check pin one.',slides:[]},{id:'s',parentId:'a',name:'Slides only',slides:[card]},{id:'e',parentId:'a',name:'Empty',slides:[]},{id:'b',name:'Inspection',slides:[]}]};window.dirty=false;window.controller=DleLaborSlides.connect({intakeId:'fixture',travelerMetadata:()=>traveler,getPlan:()=>plan,canEdit:()=>true,supported:()=>true,isDirty:()=>dirty,onChange:()=>dirty=true,saveLabor:async()=>{localStorage.setItem('saved-plan',JSON.stringify(plan));plan=JSON.parse(localStorage.getItem('saved-plan'));dirty=false;}});controller.mount(document.querySelector('main'));window.before=JSON.stringify(plan);});
 const base=page.locator('[data-protected-base]'),viewer=page.locator('.labor-annotation-viewer'),progress=page.locator('.labor-slide-playback output');
 async function ready(){await page.waitForFunction(()=>{const s=document.querySelector('.labor-annotation-viewer [role=status]');return s&&!s.textContent.startsWith('Loading');});}
 async function move(name){const old=await progress.textContent();await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(old=>document.querySelector('.labor-slide-playback output')?.textContent!==old,old);await ready();}
 async function close(){await page.locator('[data-back]').click();await viewer.waitFor({state:'detached'});}
 async function open(){await page.evaluate(()=>controller.playSequence(plan.operations,null));await ready();}
 async function edit(){await page.locator('[data-edit-current-slide]').click();await page.getByRole('button',{name:'Return to slideshow',exact:true}).waitFor();await ready();}

 async function fields(expected){assert.deepEqual(await base.locator('[data-traveler-field] strong').allTextContents(),expected);assert.equal(await base.locator('.labor-instruction-marker').count(),0);assert.equal(await base.locator('.labor-instruction-brand').count(),0);}
 async function parity(){const clean=s=>s.replace(/ style=""/g,'');const html=clean(await base.innerHTML());await edit();assert.equal(clean(await base.innerHTML()),html);await page.locator('[data-back]').click();await progress.waitFor();await ready();}
 await open();await fields(['B11283-17','B','25','QUOTE']);
 assert.equal(await base.locator('.labor-operation-title').textContent(),'20 SMT');
 assert(await base.locator('.labor-instruction-header').evaluate(e=>e.offsetHeight)<100);
 assert(await base.evaluate(e=>e.textContent.indexOf('Check polarity')<e.textContent.indexOf('Substeps')));
 await page.screenshot({path:'tmp/slides/boundary-start-'+engine+'.png'});await parity();
 for(let i=0;i<5;i++)await move('Next');
 assert.equal(await base.locator('[data-page-kind=END]').count(),1);await fields(['B11283-17','B','25','QUOTE']);
 assert.equal(await base.locator('.labor-next-label').textContent(),'Next Step:');assert.equal(await base.locator('.labor-next-operation').textContent(),'Inspection');
 assert.equal(await base.locator('.labor-instruction-body').evaluate(e=>getComputedStyle(e).borderBottomWidth),'0px');
 await page.screenshot({path:'tmp/slides/boundary-end-'+engine+'.png'});await parity();await close();
 assert.equal(await page.evaluate(()=>JSON.stringify(plan)===before),true);
 await page.evaluate(()=>{plan.quantity=43;traveler={assembly:'NEW-ASSEMBLY',revision:'C'};});await open();await fields(['NEW-ASSEMBLY','C','43','QUOTE']);await close();
 await page.evaluate(()=>{traveler={};delete plan.quantity;});await open();await fields(['\u2014','\u2014','\u2014','QUOTE']);await close();
 await page.evaluate(()=>{traveler={assembly:'ASSEMBLY'.repeat(18),revision:'LONG-REVISION'.repeat(4)};plan.quantity=0;});await open();
 await fields(['ASSEMBLY'.repeat(18),'LONG-REVISION'.repeat(4),'0','QUOTE']);
 assert(await base.locator('[data-traveler-field]').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)));
 assert(await base.evaluate(e=>e.querySelector('section').scrollWidth<=1200));
 await page.screenshot({path:'tmp/slides/boundary-long-'+engine+'.png'});await close();
 await page.evaluate(()=>{traveler={assembly:'HISTORICAL',revision:'D'};plan.quantity=99;const old=JSON.parse(JSON.stringify(plan.operations));plan.versions=[{operations:old,quantity:7}];controller.playSequence(old,null);});await ready();await fields(['HISTORICAL','D','7','QUOTE']);await close();
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log('PASS '+engine+' '+width+': compact Start/End metadata, no badges/bottom line, notes order, editor parity, fresh/current/historical quantity, missing/long identifiers, no mutations or network writes');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});

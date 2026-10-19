const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=path.resolve(process.env.DLE_TEST_REPO||path.resolve(__dirname,'../..'));const baseline=process.env.DLE_CHROME_BASELINE;
const fixture=process.env.DLE_PACKET_FIXTURE_DIR;if(!fixture)throw Error('Set DLE_PACKET_FIXTURE_DIR to the isolated backend fixture.');
const out=process.env.DLE_TEST_OUTPUT||fixture,read=n=>JSON.parse(fs.readFileSync(path.join(fixture,n),'utf8'));
(async()=>{const browser=await chromium.launch({channel:'msedge'});try{
 for(const [width,height,mode] of [[1440,1000,'desktop'],[768,1024,'ipad'],[1024,768,'ipad']]){
  const page=await browser.newPage({hasTouch:true,viewport:{width,height}});page.setDefaultTimeout(20000);const errors=[],writes=[],metrics=[];let failSave=false,holdSave=null;
  page.on('pageerror',e=>errors.push(e.message));let released={...read('initial.json'),packetContractVersion:1,travelerRevision:1},draft=null,version=0;
  const qc=released.operations.find(o=>o.id==='op-3');qc.slidesOrganized=true;
  const note=n=>({id:'jump-note-'+n,kind:'NOTE',title:'Jump note '+n,body:'Packet note '+n,page:1,stages:[{id:'jump-stage-'+n,name:'Stage 1',marks:[{id:'released-mark-'+n,page:1,kind:'freehand',color:'#1373e8',thickness:.01,points:[{x:.2,y:.4},{x:.7,y:.4}]}],savedView:{page:1,x:.5,y:.5,width:1,height:1,rotation:0}}]});
  qc.slides=Array.from({length:10},(_,n)=>note(n+1));
  const parent=released.instructionPacketId||'initial-release';
  const packet={...read('production.json')};packet.kitting={caseId:'thumb-fixture',state:'IN_PROGRESS',workingVersion:1};const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJawAAAAASUVORK5CYII=','base64');const imageHash=require('crypto').createHash('sha256').update(png).digest('hex').toUpperCase();qc.slides.unshift({...note(50),id:'image-card',kind:'IMAGE',title:'Image preview',imageDocumentId:'fixture-image',imageSha256:imageHash});const order=read('order.json');
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),name=url.pathname;if(url.origin!=='https://packet.test')throw Error('Unexpected external request '+url.origin);
   const json=v=>route.fulfill({contentType:'application/json',body:JSON.stringify(v)});
   if(name==='/')return route.fulfill({contentType:'text/html',body:'<html><head><meta charset="utf-8"></head><body style="background:#101827;color:white"><button id="open">Open QC slides</button></body></html>'});
   if(name.endsWith('/instructions/draft')){
    if(req.method()==='PUT'){if(failSave)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Fixture conflict: saved draft changed. Reopen after reviewing local changes.'})});if(holdSave)await holdSave;const b=req.postDataJSON();assert.equal(b.expectedVersion,version);writes.push(['save',b]);draft=structuredClone(b.operations);version++;return json({version,draftVersion:version,travelerRevision:released.travelerRevision});}
    return json({...released,operations:draft||released.operations,canEdit:true,editingDraft:true,draftVersion:version,parentJobId:parent,parentMainId:null,mainPacket:{customer:'Abbott',assembly:'B11165-32',revision:'A',compatible:true},hasSavedDraft:!!draft});
   }
   if(name.endsWith('/instructions/release-changes')){const b=req.postDataJSON();writes.push(['release',b]);assert.equal(b.expectedVersion,version);assert(b.reason);released={...released,operations:structuredClone(draft),travelerRevision:released.travelerRevision+1};draft=null;return json({id:'fixture-release',jobRevision:released.travelerRevision});}
   if(name.endsWith('/instructions'))return json(released);
   if(name.endsWith('/instructions/sources'))return json(read('sources.json'));
   if(name.includes('/instructions/pages/'))return name.endsWith('/info')?json({pageCount:10}):route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJawAAAAASUVORK5CYII=','base64')});
   if(name==='/api/production/v1/work-orders/0999997')return json(packet);
   if(name.startsWith('/api/kitting-cases/'))return json({workOrderNumber:'0999997',kittingCase:{...packet.kitting,workOrderNumber:'0999997',releasedBomIdentity:packet.source.releasedBomIdentity,draft:null}});if(name.endsWith('/visuals/fixture-image'))return route.fulfill({contentType:'image/png',body:png});
   if(name.startsWith('/api/'))throw Error('Unexpected API '+name);
   const file=path.resolve(repo,'.'+name);assert(file.startsWith(repo+path.sep));
   if(!fs.existsSync(file))return route.fulfill({status:404,body:'Missing fixture asset'});
   return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.JPG')?'image/jpeg':'application/octet-stream',body:fs.readFileSync(baseline&&['production-instruction-editor.js','production-instruction-editor.css','labor-drawing-notes.js','labor-slides.js'].includes(path.basename(file))?path.join(baseline,path.basename(file)):file)});
  });
  await page.goto('https://packet.test/');
  await page.addStyleTag({content:'*{box-sizing:border-box}button,input,select,textarea{font:inherit}dialog{color:#e2e8f0}'});
  await page.evaluate(({mode,order,packet})=>{document.body.dataset.viewMode=mode;window.DleOsRuntimeConfig={environment:'SIMULATION'};window.config={wo:'0999997',quality:true,readOnly:true,packetEdit:true,startAtTraveler:true,startGroup:'Quality-Inspection',order,job:{context:packet.context},trigger:document.getElementById('open'),backLabel:'Back to jobs'};}, {mode,order,packet});
  await page.evaluate(()=>{config.onViewerMount=(dialog,heading)=>{const info=document.createElement('div');info.className='qi-viewer-context';info.innerHTML='<strong>WO 0999997 · B11165-32 · Rev A</strong><span class="qi-complete">✓ Kit Complete</span><span class="qi-inspection">Not Yet Submitted</span>';heading.after(info);};});
  await page.addStyleTag({url:'/SRC/workspaces/quality-inspection/quality-inspection-workspace.css'});
  await page.addScriptTag({url:'/SRC/workspaces/kitting/production-instruction-editor.js'});
  const ready=async()=>{await page.locator('.labor-slide-playback output,.job-viewer-more').first().waitFor();if(!baseline)await page.locator('.job-compact-viewer').waitFor();await page.waitForTimeout(100);};
  const more=async()=>{if(!baseline){await ready();await page.locator('.job-viewer-more>summary').tap();}};
  const snapshot=async state=>{await ready();const m=await page.evaluate(()=>{const d=document.querySelector('dialog.job-instruction-viewer[open]'),s=d.querySelector('.labor-drawing-stage').getBoundingClientRect();return {top:s.top,height:s.height,viewport:innerHeight};});metrics.push({state,...m});await page.screenshot({path:path.join(out,`${baseline?'before':'after'}-${state}-${width}.png`)});};

  await page.evaluate(()=>{void DleJobInstructions.open(config).catch(e=>{window.openError=e.message;});});
  await page.locator('[data-packet-save]').waitFor();assert.equal(writes.length,0,'opening does not save');
  const trigger=()=>page.locator('[data-slide-jump-trigger]');await trigger().waitFor();await trigger().tap();
  const bom=page.locator('[data-slide-choice]').filter({hasText:'BOM reference'}).first();await bom.scrollIntoViewIfNeeded();await bom.locator('iframe').waitFor();assert((await bom.locator('iframe').getAttribute('srcdoc')).includes('<table'));
  const image=page.locator('[data-slide-choice]').filter({hasText:'Image preview'});await image.scrollIntoViewIfNeeded();await image.locator('iframe').waitFor();const imageHtml=await image.locator('iframe').getAttribute('srcdoc');assert(imageHtml.includes('data:image/png'));assert(imageHtml.includes('released-mark-50'));
  await page.keyboard.press('Escape');await page.locator('[data-operation-tab]').filter({hasText:'SMT-Top'}).tap();await trigger().waitFor();await trigger().tap();
  const drawing=page.locator('[data-slide-choice]').filter({hasText:'Assembly drawing'}).first();await drawing.scrollIntoViewIfNeeded();await drawing.locator('iframe').waitFor();assert((await drawing.locator('iframe').getAttribute('srcdoc')).includes('data:image/png'));
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Back to jobs',exact:true}).tap();
  await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});
  // A single playback position stays selectable without invoking navigation or creating records.
  await page.evaluate(async()=>{window.selected=0;const layer={source:{documentId:'single',sha256:'A'.repeat(64)},layerId:'single',stepId:'single',page:1,marks:[],savedView:{page:1,x:.5,y:.5,width:1,height:1,rotation:0}};await DleLaborDrawingNotes.open({intakeId:'single',stepId:'single',stepLabel:'Single',editable:false,progress:'Slide 1 / 1 | Stage 1 / 1',onAdvance:()=>selected++,hasPrevious:false,hasNext:false,onSelectSlide:()=>selected++,slideChoices:[{id:'single',title:'Single',current:true,preview:()=>Promise.reject(Error('Missing thumbnail fixture'))}],onReady:d=>d.classList.add('job-compact-viewer'),slide:{kind:'NOTE',layer,loadBase:()=>new Response('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',{headers:{'content-type':'image/svg+xml'}})}});});
  await trigger().waitFor();await trigger().tap();await page.locator('[data-jump-status]').filter({hasText:'Preview unavailable'}).waitFor();assert.equal(await page.locator('[data-slide-choice]').count(),1);await page.locator('[data-slide-choice]').tap();assert(await page.locator('.job-slide-jump-popup').isHidden());assert.equal(await page.evaluate(()=>selected),0);assert(await page.locator('[data-slide-next]').isDisabled());
  await page.locator('[data-back]').tap();
  await page.locator('.labor-drawing-viewer').waitFor({state:'detached'});
  const empty=await page.evaluate(async()=>{const controller=DleLaborSlides.connect({intakeId:'empty',drawingContext:async()=>({source:null,layers:[]}),getPlan:()=>({quantity:1,operations:[]}),onChange:()=>{},canEdit:()=>false,supported:()=>true,slideJump:true});return controller.playSequence([],null,null,{startAtTraveler:true});});assert.equal(empty,false);assert.equal(await page.locator('[data-slide-jump-trigger]').count(),0);
  assert.equal(writes.length,0);assert.deepEqual(errors,[]);await page.close();console.log('PASS actual BOM/drawing/image overlays, single and empty navigation '+width);
 }
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

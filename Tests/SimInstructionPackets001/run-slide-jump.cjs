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
  qc.slides=Array.from({length:10},(_,n)=>note(n+1));const second=structuredClone(qc.slides[0].stages[0]);second.id='replacement-stage';second.marks[0].id='stage-two-mark';second.marks[0].color='#db3425';qc.slides[0].stages.push(second);
  const parent=released.instructionPacketId||'initial-release';
  const packet={...read('production.json')};const order=read('order.json');
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
   if(name.startsWith('/api/kitting-cases/'))return json({workOrderNumber:'0999997',kittingCase:null,submissions:[]});
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
  await page.locator('[data-slide-jump-trigger]').waitFor();
  const trigger=()=>page.locator('[data-slide-jump-trigger]'),items=()=>page.locator('[data-slide-choice]');
  const position=async()=>Number((await trigger().innerText()).match(/Slide (\d+)/)[1]);
  const openJump=async()=>{await trigger().tap();await page.locator('.job-slide-jump-popup:not([hidden])').waitFor();};
  await page.evaluate(()=>{const original=DleLaborLetterPages;window.previewStats={active:0,max:0,calls:0};window.DleLaborLetterPages={...original,compose:async o=>{previewStats.active++;previewStats.calls++;previewStats.max=Math.max(previewStats.max,previewStats.active);try{return await original.compose(o);}finally{previewStats.active--;}}};});
  await openJump();const count=await items().count();assert(count>10);assert.equal(await position(),1);
  assert.equal(await page.locator('[data-slide-choice][aria-selected=true]').evaluate(n=>n===document.activeElement),true);
  await page.waitForFunction(()=>document.querySelector('[data-jump-preview] iframe')?.srcdoc.includes('DRAFT'));
  const stageTwo=items().filter({hasText:'Jump note 1 · Stage 2'});await stageTwo.scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('[data-slide-choice]')].find(n=>n.textContent.includes('Jump note 1 · Stage 2'))?.querySelector('iframe')?.srcdoc.includes('stage-two-mark'));
  const stats=await page.evaluate(()=>previewStats);assert(stats.calls<count);assert(stats.max<=2);assert(await page.locator('[data-jump-preview] iframe').count()<=6);
  const popup=await page.locator('.job-slide-jump-popup').boundingBox();assert(popup.x>=0&&popup.y>=0&&popup.x+popup.width<=width&&popup.y+popup.height<=height);
  await page.screenshot({path:path.join(out,'jump-'+width+'.png')});
  await page.keyboard.press('Escape');assert(await page.locator('.job-slide-jump-popup').isHidden());assert(await trigger().evaluate(n=>n===document.activeElement));
  await openJump();await page.locator('.job-viewer-identity').tap();assert(await page.locator('.job-slide-jump-popup').isHidden());
  await openJump();const middle=Math.floor(count/2);await items().nth(middle).tap();await trigger().waitFor();assert.equal(await position(),middle+1);
  await page.locator('[data-slide-next]').tap();await trigger().waitFor();assert.equal(await position(),middle+2);
  await openJump();await page.keyboard.press('End');await page.keyboard.press('Enter');await trigger().waitFor();assert.equal(await position(),count);
  await page.locator('[data-slide-next]').tap();await trigger().waitFor();assert.equal(await position(),1);
  await openJump();await items().nth(1).tap();await trigger().waitFor();await openJump();await page.keyboard.press('Home');await page.keyboard.press('Enter');await trigger().waitFor();assert.equal(await position(),1);
  await openJump();const qcIds=await items().evaluateAll(ns=>ns.map(n=>n.dataset.slideChoice));await page.keyboard.press('Escape');
  await page.locator('[data-operation-tab]').filter({hasText:'SMT-Top'}).tap();await trigger().waitFor();await openJump();const smtIds=await items().evaluateAll(ns=>ns.map(n=>n.dataset.slideChoice));assert(smtIds.every(id=>!qcIds.includes(id)));await page.keyboard.press('Escape');
  // Model an already-saved reordered draft in the isolated server fixture, including a draft-only overlay.
  draft=structuredClone(released.operations);version=1;const reordered=draft.find(o=>o.id==='op-3');reordered.slides.reverse();reordered.slides[0].stages[0].marks.push({id:'draft-only-overlay',page:1,kind:'marker',color:'#ffc100',opacity:.4,thickness:.02,points:[{x:.2,y:.6},{x:.8,y:.6}]});
  await page.getByRole('button',{name:'Back to jobs',exact:true}).tap();await page.evaluate(()=>{void DleJobInstructions.open(config);});await trigger().waitFor();await openJump();
  const titles=await items().locator('strong').allTextContents();assert(titles.findIndex(t=>t.includes('Jump note 10'))<titles.findIndex(t=>t.includes('Jump note 1 '))||titles.findIndex(t=>t.endsWith('Jump note 1'))>titles.findIndex(t=>t.includes('Jump note 10')));
  const note10=items().filter({hasText:'Jump note 10'});await note10.scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('[data-slide-choice]')].find(n=>n.textContent.includes('Jump note 10'))?.querySelector('iframe')?.srcdoc.includes('draft-only-overlay'));
  assert((await note10.locator('iframe').getAttribute('srcdoc')).includes('opacity="0.4"'));await page.keyboard.press('Escape');
  await page.locator('.job-viewer-more>summary').tap();await page.locator('[data-packet-approved]').tap();await trigger().waitFor();await openJump();
  await page.waitForFunction(()=>document.querySelector('[data-jump-preview] iframe')?.srcdoc.includes('Released work-order'));
  const releasedNote=items().filter({hasText:'Jump note 10'});await releasedNote.scrollIntoViewIfNeeded();await releasedNote.locator('iframe').waitFor();assert(!(await releasedNote.locator('iframe').getAttribute('srcdoc')).includes('draft-only-overlay'));
  assert.equal(writes.length,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'jump-results-'+width+'.json'),JSON.stringify({count,stats,reordered:true,overlayIsolation:true,firstMiddleLast:true,writes:0},null,2));
  await page.close();console.log('PASS jump, arrows, menus, lazy preview, draft/released identity '+width);
 }
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

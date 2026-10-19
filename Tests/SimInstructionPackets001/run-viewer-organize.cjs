const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=path.resolve(process.env.DLE_TEST_REPO||path.resolve(__dirname,'../..'));const baseline=process.env.DLE_CHROME_BASELINE;
const fixture=process.env.DLE_PACKET_FIXTURE_DIR;if(!fixture)throw Error('Set DLE_PACKET_FIXTURE_DIR to the isolated backend fixture.');
const out=process.env.DLE_TEST_OUTPUT||fixture,read=n=>JSON.parse(fs.readFileSync(path.join(fixture,n),'utf8'));
(async()=>{const browser=await chromium.launch({channel:'msedge'});try{
 for(const [width,height,mode] of [[1440,1000,'desktop'],[768,1024,'ipad'],[1024,768,'ipad']]){
  const page=await browser.newPage({hasTouch:true,viewport:{width,height}});page.setDefaultTimeout(20000);const errors=[],writes=[],metrics=[];let failSave=false,holdSave=null;
  page.on('pageerror',e=>errors.push(e.message));let released={...read('initial.json'),packetContractVersion:1,travelerRevision:1},draft=null,version=0;
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

  await ready();assert.equal(await page.locator('.job-compact-viewer [data-organize-slides]').count(),0);
  assert(await page.locator('[data-edit-current-slide]').isVisible());
  await page.screenshot({path:path.join(out,`header-${width}.png`)});
  await page.locator('[data-edit-current-slide]').tap();await page.locator('[data-compact-tools]').tap();
  assert.equal(await page.getByRole('button',{name:'Organize Slides',exact:true}).count(),1);
  await page.screenshot({path:path.join(out,`edit-tools-${width}.png`)});
  await page.getByRole('button',{name:'Organize Slides',exact:true}).tap();await page.locator('[data-org-insert]').waitFor();
  await page.locator('[data-org-return]').tap();await page.locator('.labor-compact-editor').waitFor();
  await page.getByRole('button',{name:'Return to slideshow',exact:true}).tap();await ready();
  assert.equal(await page.locator('.job-compact-viewer [data-organize-slides]').count(),0);
  assert.equal(writes.length,0);assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}x${height}: header absent, Edit > Tools > Organize, return, no writes`);
 }
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

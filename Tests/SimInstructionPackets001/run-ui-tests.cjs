const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=process.env.DLE_TEST_REPO||path.resolve(__dirname,'../..');
const fixture=process.env.DLE_PACKET_FIXTURE_DIR;if(!fixture)throw Error('Set DLE_PACKET_FIXTURE_DIR to the isolated backend fixture.');
const out=process.env.DLE_TEST_OUTPUT||fixture,read=n=>JSON.parse(fs.readFileSync(path.join(fixture,n),'utf8'));
(async()=>{const browser=await chromium.launch({channel:'msedge'});try{
 for(const [width,height,mode] of [[1440,1000,'desktop'],[768,1024,'ipad'],[1024,768,'ipad']]){
  const page=await browser.newPage({hasTouch:true,viewport:{width,height}});page.setDefaultTimeout(20000);const errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));let released={...read('initial.json'),packetContractVersion:1,travelerRevision:1},draft=null,version=0;
  const parent=released.instructionPacketId||'initial-release';
  const packet={...read('production.json')};const order=read('order.json');
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),name=url.pathname;if(url.origin!=='https://packet.test')throw Error('Unexpected external request '+url.origin);
   const json=v=>route.fulfill({contentType:'application/json',body:JSON.stringify(v)});
   if(name==='/')return route.fulfill({contentType:'text/html',body:'<html><head><meta charset="utf-8"></head><body style="background:#101827;color:white"><button id="open">Open QC slides</button></body></html>'});
   if(name.endsWith('/instructions/draft')){
    if(req.method()==='PUT'){const b=req.postDataJSON();assert.equal(b.expectedVersion,version);writes.push(['save',b]);draft=structuredClone(b.operations);version++;return json({version,draftVersion:version,travelerRevision:released.travelerRevision});}
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
   return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.JPG')?'image/jpeg':'application/octet-stream',body:fs.readFileSync(file)});
  });
  await page.goto('https://packet.test/');
  await page.addStyleTag({content:'*{box-sizing:border-box}button,input,select,textarea{font:inherit}dialog{color:#e2e8f0}'});
  await page.evaluate(({mode,order,packet})=>{document.body.dataset.viewMode=mode;window.DleOsRuntimeConfig={environment:'SIMULATION'};window.config={wo:'0999997',quality:true,readOnly:true,packetEdit:true,startAtTraveler:true,startGroup:'Quality-Inspection',order,job:{context:packet.context},trigger:document.getElementById('open'),backLabel:'Back to jobs'};}, {mode,order,packet});
  await page.addScriptTag({url:'/SRC/workspaces/kitting/production-instruction-editor.js'});
  await page.evaluate(()=>{void DleJobInstructions.open(config).catch(e=>{window.openError=e.message;});});
  await page.locator('[data-packet-save]').waitFor();assert.equal(writes.length,0,'opening does not save');
  await page.locator('[data-edit-current-slide]').tap();await page.locator('[data-compact-tools]').tap();
  await page.getByRole('button',{name:'Organize Slides',exact:true}).tap();await page.locator('[data-org-insert]').waitFor();
  await page.locator('[data-org-card]').first().tap();await page.locator('[data-org-insert]').tap();
  await page.locator('[data-kind]').selectOption('NOTE');await page.locator('[data-create]').tap();await page.locator('[data-org-save]').tap();
  await page.locator('.labor-compact-editor,.job-compact-viewer').first().waitFor();
  if(await page.locator('.labor-compact-editor').count())await page.getByRole('button',{name:'Return to slideshow',exact:true}).tap();
  await page.locator('[data-packet-release]').waitFor();assert.equal(version,1);assert.equal(released.travelerRevision,1,'save does not release');
  assert(draft.some(o=>o.slides?.some(s=>s.kind==='NOTE')),'organizer note persisted');
  // Reopen the saved fixture note explicitly; Edit/Organize correctly returns to its original slide.
  const noteOwner=draft.find(o=>o.slides?.some(s=>s.kind==='NOTE')),note=noteOwner.slides.find(s=>s.kind==='NOTE');
  await page.getByRole('button',{name:'Back to jobs',exact:true}).tap();
  await page.evaluate(({opId,cardId,stageId})=>{for(const key of Object.keys(sessionStorage))if(key.startsWith('dle-os:job-slides:'))sessionStorage.setItem(key,JSON.stringify({opId,cardId,stageId}));void DleJobInstructions.open({...config,startAtTraveler:false,startGroup:null}).catch(e=>window.openError=e.message);},{opId:noteOwner.id,cardId:note.id,stageId:note.stages[0].id});
  await page.locator('[data-edit-current-slide]').waitFor();
  await page.locator('[data-edit-current-slide]').tap();await page.locator('dialog[open] [data-save]').waitFor();
  assert.equal(await page.locator('[data-packet-release]').count(),0,'unapplied slide edits cannot be released');
  await page.screenshot({path:path.join(out,'packet-edit-'+width+'.png'),fullPage:true});
  // Cancel the slide editor through its existing Back control. No extra save/release.
  await page.getByRole('button',{name:'Return to slideshow',exact:true}).tap();await page.locator('[data-packet-release]').waitFor();
  assert.equal(version,1);
  await page.locator('[data-edit-current-slide]').tap();
  await page.locator('[data-compact-tools]').tap();
  await page.getByRole('button',{name:'Pen',exact:true}).tap();
  await page.waitForFunction(()=>document.querySelector('.labor-drawing-status')?.textContent==='Ready');
  const bounds=await page.locator('svg [data-paper] image').boundingBox(),clip=await page.locator('.labor-annotation-canvas').boundingBox();
  const left=Math.max(clip.x,bounds.x),top=Math.max(clip.y,bounds.y);
  const canvas={x:left,y:top,width:Math.min(width-100,clip.x+clip.width,bounds.x+bounds.width)-left,height:Math.min(height-30,clip.y+clip.height,bounds.y+bounds.height)-top};
  // The first canvas contact dismisses the open pen settings tray by design.
  await page.mouse.click(canvas.x+canvas.width*.3,canvas.y+canvas.height*.4);
  await page.mouse.move(canvas.x+canvas.width*.3,canvas.y+canvas.height*.4);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.6,canvas.y+canvas.height*.6,{steps:8});await page.mouse.up();
  await page.getByRole('button',{name:'Save',exact:true}).tap();
  await page.locator('[data-packet-save]').waitFor();assert(await page.locator('[data-packet-release]').isEnabled());
  await page.waitForFunction(()=>document.querySelector('[data-packet-state]')?.textContent.includes('Saved draft 2'));
  assert.equal(version,2);assert(draft.some(o=>o.slides?.some(s=>s.stages?.some(t=>t.marks?.length))),'applied marks are saved');
  await page.locator('[data-packet-release]').tap();
  assert.equal(await page.locator('[data-scope]').inputValue(),'WO_ONLY');
  await page.locator('[data-scope]').selectOption('MAIN_ONLY');assert.match(await page.locator('[data-scope-description]').innerText(),/remain unchanged/);
  await page.locator('[data-scope]').selectOption('BOTH');assert.match(await page.locator('[data-scope-description]').innerText(),/together/);
  await page.locator('.job-packet-release [data-cancel]').tap();assert.equal(writes.filter(x=>x[0]==='release').length,0);
  await page.locator('.job-viewer-more>summary').tap();await page.locator('[data-packet-approved]').tap();await page.locator('dialog.job-instruction-viewer[open]').waitFor();
  assert.equal(await page.locator('[data-packet-save]').count(),0);assert.match(await page.locator('dialog[open]').innerText(),/Traveler Rev 1/);
  await page.getByRole('button',{name:'Back to jobs',exact:true}).tap();
  await page.evaluate(()=>{void DleJobInstructions.open(config).catch(e=>{window.openError=e.message;});});await page.locator('[data-packet-release]').waitFor();
  assert.match(await page.locator('[data-packet-state]').innerText(),/Saved draft 2/);
  await page.locator('[data-packet-release]').tap();await page.locator('[data-reason]').fill('Fixture explicit release');
  await page.screenshot({path:path.join(out,'packet-release-'+width+'.png'),fullPage:true});
  await page.locator('[data-confirm]').tap();await page.waitForFunction(()=>!document.querySelector('.job-packet-release'));
  await page.waitForFunction(()=>[...document.querySelectorAll('dialog[open]')].some(d=>d.textContent.includes('Traveler Rev 2'))).catch(async e=>{console.log('DEBUG',await page.locator('body').innerText(),errors,writes.map(x=>x[0]),released.travelerRevision);throw e;});
  assert.equal(released.travelerRevision,2);assert.equal(writes.filter(x=>x[0]==='release').length,1);
  for(let i=0;i<3;i++){assert.match(await page.locator('dialog.job-instruction-viewer[open]').innerText(),/Traveler Rev 2/);await page.locator('[data-slide-next]').tap();}
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'packet-ui-'+width+'.json'),JSON.stringify({mode,width,version,releasedRevision:released.travelerRevision,saves:writes.filter(x=>x[0]==='save').length,releases:1,errors},null,2));
  await page.close();console.log('PASS packet editor/save/cancel/reopen/release/all-slide revision '+mode+' '+width);
 }
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

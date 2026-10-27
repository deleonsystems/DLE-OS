const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=process.env.DLE_TEST_REPO,stage=process.env.DLE_STAGED_REPO,fixture=process.env.DLE_PACKET_FIXTURE_DIR,out=process.env.DLE_TEST_OUTPUT;
if(!repo||!stage||!fixture||!out)throw Error('Set DLE_TEST_REPO, DLE_STAGED_REPO, DLE_PACKET_FIXTURE_DIR and DLE_TEST_OUTPUT to isolated paths.');
fs.mkdirSync(out,{recursive:true});const read=n=>JSON.parse(fs.readFileSync(path.join(fixture,n),'utf8'));
let png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJawAAAAASUVORK5CYII=','base64');
(async()=>{const browser=await chromium.launch({channel:'msedge'});try{
 for(const [width,height] of [[1440,1000],[768,1024],[1024,768]]){
  const page=await browser.newPage({hasTouch:true,viewport:{width,height}});png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=480;c.height=180;const x=c.getContext('2d');x.fillStyle='#dde8ef';x.fillRect(0,0,480,180);x.fillStyle='#173b56';x.fillRect(40,50,130,80);x.fillStyle='#c78d20';for(let i=0;i<5;i++)x.fillRect(170,58+i*14,90,6);x.fillStyle='#173b56';x.font='20px sans-serif';x.fillText('Isolated connector image',200,155);return c.toDataURL().split(',')[1];}),'base64');page.setDefaultTimeout(20000);const errors=[],writes=[];let role='production',entries=[],draft=null,version=18;
  const released={...read('initial.json'),productionAdditionsVersion:2},order=read('order.json'),packet=read('production.json');const parent=released.instructionPacketId;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),n=u.pathname;if(u.origin!=='https://addition.test')throw Error('Unexpected network '+u.origin);
   const json=(v,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
   if(n==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#101827;color:white"><button id="open">Open</button></body></html>'});
   if(n.endsWith('/additions')){
    return json({canAdd:role==='production',canReview:role==='quality',parentJobId:parent,sourceRevision:released.travelerRevision,draftVersion:version,entries});
   }
   if(n.endsWith('/additions/visuals')){assert.equal(role,'production');writes.push(['upload']);return json({documentId:'photo-fixture',sha256:require('crypto').createHash('sha256').update(png).digest('hex').toUpperCase(),name:'fixture.png'});}
   if(n.includes('/additions/')&&n.endsWith('/slide')){assert.equal(role,'production');const b=req.postDataJSON();writes.push(['save',b]);const id=n.split('/').at(-2);let e=entries.find(e=>e.addition.id===id);if(e&&e.addition.editRequestId===b.requestId)return json(e.addition);assert.equal(b.expectedVersion,e?.addition.version||0);const addition={id,version:b.expectedVersion+1,operationId:b.operationId,parentJobId:b.parentJobId,author:'Production Team',status:'PENDING',slide:b.slide,editRequestId:b.requestId};if(e)e.addition=addition;else entries.push({addition,publications:[],stale:false,canEdit:true});if(writes.filter(w=>w[0]==='save').length===1)return route.fulfill({contentType:'application/json',body:'{'});return json(addition);}
   if(n.includes('/additions/')&&n.endsWith('/review')){assert.equal(role,'quality');const b=req.postDataJSON();writes.push(['review',b]);const a=entries.find(e=>e.addition.id===n.split('/').at(-2)).addition;a.status=b.decision==='ACCEPT'?'ACCEPTED':'RETURNED';a.version++;a.note=b.note;entries.find(e=>e.addition.id===a.id).canEdit=b.decision!=='ACCEPT';a.reviewer='Quality Reviewer';a.reviewedAt='2026-10-19T10:01:00Z';
    if(b.decision==='ACCEPT'){assert.equal(b.expectedDraftVersion,version);draft??=structuredClone(released.operations);const op=draft.find(o=>o.id===a.operationId);op.slides??=[];op.slides.splice(op.slidesOrganized?op.slides.length-1:op.slides.length,0,a.slide);version++;}return json(a);
   }
   if(n.endsWith('/instructions/draft')){assert.equal(req.method(),'GET');return json({...released,operations:draft||released.operations,canEdit:true,editingDraft:true,draftVersion:version,parentJobId:parent,parentMainId:null,mainPacket:{compatible:true},hasSavedDraft:!!draft});}
   if(n.endsWith('/instructions'))return json(released);
   if(n.endsWith('/instructions/sources'))return json(read('sources.json'));
   if(n.includes('/instructions/visuals/'))return route.fulfill({contentType:'image/png',body:png});
   if(n.includes('/instructions/pages/'))return n.endsWith('/info')?json({pageCount:10}):route.fulfill({contentType:'image/png',body:png});
   if(n==='/api/production/v1/work-orders/0999997')return json(packet);
   if(n.startsWith('/api/kitting-cases/'))return json({workOrderNumber:'0999997',kittingCase:null,submissions:[]});
   if(n.startsWith('/api/'))throw Error('Unexpected API/write '+n);
   const rel=n.slice(1),file=[path.join(stage,rel),path.join(repo,rel)].find(f=>fs.existsSync(f));
   if(!file)return route.fulfill({status:404,body:'Missing fixture asset'});
   return route.fulfill({contentType:n.endsWith('.js')?'text/javascript':n.endsWith('.css')?'text/css':n.toLowerCase().endsWith('.jpg')?'image/jpeg':'application/octet-stream',body:fs.readFileSync(file)});
  });
  await page.goto('https://addition.test/');await page.addStyleTag({content:'*{box-sizing:border-box}button,input,select,textarea{font:inherit}dialog{color:#e2e8f0}'});
  await page.evaluate(({order,packet})=>{window.DleOsRuntimeConfig={environment:'SIMULATION'};window.config={wo:'0999997',productionView:true,readOnly:true,startSmt:true,order,job:{context:packet.context},trigger:document.getElementById('open'),backLabel:'Back to jobs'};},{order,packet});
  await page.addScriptTag({url:'/SRC/workspaces/kitting/production-instruction-editor.js'});
  await page.evaluate(()=>{void DleJobInstructions.open(config).catch(e=>{window.openError=e.message;});});
  await page.locator('[data-add-pending-slide]').waitFor();assert.equal(await page.locator('[data-edit-current-slide],[data-packet-release],[data-organize-slides]').count(),0);
  await page.click('[data-add-pending-slide]');await page.locator('[data-compact-tools]').waitFor();assert.equal(await page.locator('.production-additions').count(),0);await page.getByText('Needs Quality Review/Approval',{exact:true}).waitFor();
  await page.locator('[data-photo-file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(()=>document.querySelectorAll('svg image').length>0);
  await page.click('[data-compact-tools]');await page.getByRole('button',{name:'Text',exact:true}).click();
  const canvas=page.locator('.labor-annotation-canvas');const box=await canvas.boundingBox();await page.mouse.click(box.x+box.width*.35,box.y+box.height*.45);await page.mouse.click(box.x+box.width*.35,box.y+box.height*.45);
  await page.locator('[data-inline-text]').fill('Inspect connector');await page.locator('[data-inline-text]').press('Enter');
  await page.click('[data-compact-tools]');await page.getByRole('button',{name:'Pen',exact:true}).click();await page.mouse.click(box.x+box.width*.2,box.y+box.height*.65);await page.mouse.move(box.x+box.width*.2,box.y+box.height*.65);await page.mouse.down();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.7,{steps:12});await page.mouse.up();
  await page.click('[data-save]');await page.locator('.labor-drawing-status').filter({hasText:/The response could not be confirmed/}).waitFor();await page.click('[data-save]');await page.locator('.labor-drawing-status').filter({hasText:/Draft saved/}).waitFor();
  assert.equal(entries.length,1);assert.equal(entries[0].addition.slide.stages[0].photos.length,1);assert(entries[0].addition.slide.stages[0].marks.some(m=>m.text==='Inspect connector'));assert.equal(writes.filter(w=>w[0]==='save')[0][1].requestId,writes.filter(w=>w[0]==='save')[1][1].requestId);assert.equal(draft,null);assert(entries[0].addition.slide.stages[0].marks.some(m=>m.kind==='freehand'));
  await page.screenshot({path:path.join(out,'editor-'+width+'.png')});
  await page.click('[data-back]');await page.locator('[data-add-pending-slide]').waitFor();
  async function pending(){await page.click('[data-slide-jump-trigger]');await page.locator('[data-slide-choice]').filter({hasText:'Needs Quality Review/Approval'}).click();await page.getByText('Needs Quality Review/Approval',{exact:true}).waitFor();}
  await pending();await page.click('[data-edit-current-slide]');await page.locator('[data-compact-tools]').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('svg image')].some(x=>x.getAttribute('href')?.startsWith('blob:')));assert.equal(await page.getByText(/Image source mismatch/).count(),0);await page.click('[data-back]');await page.locator('[data-add-pending-slide]').waitFor();await page.click('[data-back]');
  role='quality';draft=structuredClone(released.operations);draft.find(o=>o.id==='op-2').instructions='Independent QC change';
  async function openQuality(){await page.evaluate(()=>{config={...config,productionView:false,quality:true,packetEdit:true,startSmt:true,startGroup:null};void DleJobInstructions.open(config);});await page.locator('[data-slide-jump-trigger]').waitFor();await pending();}
  await openQuality();assert.equal(await page.locator('[data-edit-current-slide]').count(),0);page.once('dialog',d=>d.accept('Show the connector more clearly.'));await page.click('[data-return-pending]');await page.getByText(/Returned by Quality . needs revision/).waitFor();await page.click('[data-back]');
  role='production';await page.evaluate(()=>{config={...config,productionView:true,quality:false,packetEdit:false,startSmt:true};void DleJobInstructions.open(config);});await page.locator('[data-add-pending-slide]').waitFor();await page.click('[data-slide-jump-trigger]');await page.locator('[data-slide-choice]').filter({hasText:'Needs Quality Review/Approval'}).click();await page.click('[data-edit-current-slide]');await page.locator('[data-compact-tools]').waitFor();
  await page.locator('[data-photo-file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>document.querySelectorAll('svg image').length>=2);await page.click('[data-save]');await page.locator('.labor-drawing-status').filter({hasText:/Draft saved/}).waitFor();await page.click('[data-back]');await page.locator('[data-add-pending-slide]').waitFor();await page.click('[data-back]');
  role='quality';await openQuality();await page.click('[data-accept-pending]');await page.getByText(/Quality reviewed . awaiting release/).waitFor();assert.equal(draft.find(o=>o.id==='op-2').instructions,'Independent QC change');assert(draft.find(o=>o.id===entries[0].addition.operationId).slides.some(c=>c.id===entries[0].addition.slide.id));await page.screenshot({path:path.join(out,'reviewed-'+width+'.png')});
  await page.click('[data-packet-release]');assert.equal(await page.locator('[data-scope]').inputValue(),'WO_ONLY');await page.click('[data-cancel]');
  assert.equal(errors.length,0,errors.join('\n'));assert(writes.every(w=>['save','upload','review'].includes(w[0])));console.log('PASS '+width+'x'+height+' same native editor, photo/text, retry, reopen, own-pending edit, released protection, return/revise/accept, no release');await page.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});

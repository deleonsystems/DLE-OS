const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=process.env.DLE_TEST_REPO||path.resolve(__dirname,'../..'),out=process.env.DLE_TEST_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'dle-opacity-'));
fs.mkdirSync(out,{recursive:true});
(async()=>{const b=await chromium.launch({channel:'msedge'});try{
 for(const [width,height,supported] of [[1440,1000,true],[768,1024,true],[1024,768,true],[1440,1000,false]]){
  const p=await b.newPage({viewport:{width,height},hasTouch:true}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('https://opacity.test/',r=>r.fulfill({contentType:'text/html',body:'<body><main><input value="untouched work"></main></body>'}));await p.goto('https://opacity.test/');
  await p.addStyleTag({content:fs.readFileSync(repo+'/SRC/workspaces/rfqs/labor-workbench.css','utf8')});
  for(const file of ['labor-drawing-notes.js','labor-letter-pages.js','labor-slides.js'])await p.addScriptTag({content:fs.readFileSync(repo+'/SRC/workspaces/rfqs/'+file,'utf8')});
  await p.evaluate(({supported})=>{
   window.sourceSvg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/><text x="180" y="170" font-size="24">Legacy / explicit / new Highlighter</text><path d="M180 190 H800 M180 240 H800 M180 440 H800" stroke="#555"/></svg>';
   const source={documentId:'fixture',sha256:'A'.repeat(64),assembly:'Fixture',revision:'A',name:'Synthetic drawing'};
   const mark=(id,y,alpha)=>({id,page:1,kind:'marker',color:'#ffc100',thickness:.025,points:[{x:.15,y},{x:.65,y}],...(alpha!=null?{opacity:alpha}:{})});
   window.saved={layerId:'layer',stepId:'op',stepIds:['op'],source,page:1,name:'Opacity fixture',marks:[mark('legacy',.22),mark('explicit',.28,.65),mark('zero',.34,0)],photos:[],savedView:{page:1,x:.5,y:.5,width:1,height:1,rotation:0},note:'',revision:1};
   window.original=JSON.stringify(saved.marks);window.saveCount=0;
   window.loadBase=async()=>new Response(sourceSvg,{headers:{'content-type':'image/svg+xml'}});
   window.openFixture=(editable=true)=>DleLaborDrawingNotes.open({intakeId:'fixture',stepId:'op',stepLabel:'Opacity persistence',editable,compactControls:true,slide:{markerOpacitySupported:supported,kind:'NOTE',caption:'Mixed legacy/new',layer:structuredClone(saved),loadBase,save:async v=>{window.saved=structuredClone(v);saveCount++;}}});
   return openFixture();
  },{supported});await p.waitForFunction(()=>document.querySelector('.labor-drawing-status')?.textContent==='Ready');
  await p.locator('[data-compact-tools]').click();await p.locator('[data-quick-tool="marker"]').click();await p.locator('[data-compact-color]').click();await p.locator('[data-highlighter-color="#ffc100"]').click();
  const alpha=p.locator('[data-highlight-opacity]');
  assert.equal(await alpha.inputValue(),supported?'50':'28');
  if(supported){
   assert.equal(await alpha.getAttribute('min'),'10');assert.equal(await alpha.getAttribute('max'),'100');
   const bounds=await alpha.boundingBox();await p.mouse.move(bounds.x+bounds.width*.25,bounds.y+bounds.height/2);await p.mouse.down();await p.mouse.move(bounds.x+bounds.width*.55,bounds.y+bounds.height/2,{steps:5});await p.mouse.up();const mouse=Number(await alpha.inputValue());assert(mouse>10&&mouse<100);
   const cdp=await p.context().newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+bounds.width*.55,y:bounds.y+bounds.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bounds.x+bounds.width*.8,y:bounds.y+bounds.height/2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();assert(Number(await alpha.inputValue())>mouse);
   await alpha.focus();await p.keyboard.press('End');assert.equal(await alpha.inputValue(),'100');await p.keyboard.press('Home');assert.equal(await alpha.inputValue(),'10');for(let i=0;i<30;i++)await p.keyboard.press('ArrowRight');assert.equal(await alpha.inputValue(),'40');assert.equal(await p.locator('[data-highlight-percent]').innerText(),'40%');
  }else assert(await alpha.isDisabled());
  assert.equal(await p.evaluate(()=>saveCount),0);assert.equal(await p.evaluate(()=>JSON.stringify(saved.marks)),await p.evaluate(()=>original));
  await p.screenshot({path:path.join(out,`opacity-picker-${width}-${supported}.png`)});
  await p.keyboard.press('Escape');
  assert(await p.locator('[aria-label="Tool settings"]').isHidden());
  await p.locator('[data-compact-color]').click();const outside=await p.locator('.labor-annotation-canvas').boundingBox();await p.mouse.click(outside.x+outside.width*.2,outside.y+outside.height*.7);
  assert(await p.locator('[aria-label="Tool settings"]').isHidden());assert.equal(await p.locator('[data-marks] path').count(),3,'outside dismissal does not add a mark');
  const box=await p.locator('.labor-annotation-canvas').boundingBox();await p.mouse.move(box.x+box.width*.4,box.y+box.height*.55);await p.mouse.down();await p.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{steps:5});await p.mouse.up();
  const current=await p.locator('[data-marks] path').evaluateAll(ns=>ns.map(n=>({opacity:Number(n.getAttribute('opacity')),color:n.getAttribute('stroke')})));
  assert.deepEqual(current.map(m=>m.opacity),[.28,.65,0,supported?.4:.28]);assert.equal(current[3].color,'#ffc100');
  await p.locator('[data-save]').click();await p.waitForFunction(()=>saveCount===1);const saved=await p.evaluate(()=>window.saved);
  assert.equal(JSON.stringify(saved.marks.slice(0,3)),await p.evaluate(()=>original));assert.equal(saved.marks[3].opacity,supported?.4:undefined);
  await p.locator('[data-back]').click();await p.locator('.labor-drawing-viewer').waitFor({state:'detached'});
  await p.evaluate(()=>{saved=JSON.parse(JSON.stringify(saved));return openFixture();});await p.waitForFunction(()=>document.querySelectorAll('[data-marks] path').length===4);
  assert.deepEqual(await p.locator('[data-marks] path').evaluateAll(ns=>ns.map(n=>Number(n.getAttribute('opacity')))),[.28,.65,0,supported?.4:.28]);
  await p.screenshot({path:path.join(out,`opacity-editor-${width}-${supported}.png`)});
  const composed=await p.evaluate(async()=>{
   const before=JSON.stringify(saved.marks);const result=await DleLaborLetterPages.compose({kind:'DRAWING',layer:saved,loadBase,caption:'Opacity print fixture'});
   const holder=document.createElement('div');holder.innerHTML=result.html;const alphas=[...holder.querySelectorAll('[data-mark-id]')].map(n=>Number(n.getAttribute('opacity')));
   const copy=DleLaborSlides.duplicate({id:'card',stages:[{id:'stage',marks:saved.marks}]});
   return {alphas,html:DleLaborLetterPages.document(result),unmodified:before===JSON.stringify(saved.marks),copies:copy.stages[0].marks.map(m=>({...m,id:''})),originals:saved.marks.map(m=>({...m,id:''}))};
  });assert.deepEqual(composed.alphas,[.28,.65,0,supported?.4:.28]);assert(composed.unmodified);assert.deepEqual(composed.copies,composed.originals);
  if(width===1440&&supported)fs.writeFileSync(path.join(out,'opacity-print.html'),composed.html);
  const bad=await p.evaluate(()=>[undefined,null,'0.5',-1,2,NaN,Infinity].map(opacity=>{const group=document.createElementNS('http://www.w3.org/2000/svg','g');const mark={...saved.marks[0],opacity};const {node}=DleLaborDrawingNotes.appendMark(group,mark,{width:1200,height:800});return Number(node.getAttribute('opacity'));}));assert(bad.every(v=>v===.28));
  assert.equal(await p.locator('main input').inputValue(),'untouched work');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,`opacity-saved-${width}-${supported}.json`),JSON.stringify(saved,null,2));
  await p.close();console.log(`PASS ${width}x${height} capability=${supported}: preview, saved .40/new or .28/old-runtime, legacy .28/explicit .65/zero preserved, reopen, print composition, clone, malformed render fallback`);
 }
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});

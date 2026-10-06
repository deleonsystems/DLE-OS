const fs=require('fs'),assert=require('assert/strict'),{chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const png=fs.readFileSync('tmp/labor-drawing-notes/synthetic.png').toString('base64'),out='tmp/basic-shapes';
(async()=>{for(const engine of ['edge','webkit']){const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));try{const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://rail.test/',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));await page.goto('https://rail.test/');await page.setContent('<style>'+fs.readFileSync('SRC/workspaces/rfqs/labor-workbench.css','utf8')+'</style><body data-view-mode="desktop"><main><input value="Keep worksheet"></main></body>');
await page.evaluate(png=>{window.writes=[];window.canTextTransforms=true;const source={documentId:'D',sha256:'A'.repeat(64),assembly:'RAIL FIXTURE',revision:'A'},view={page:1,x:.5,y:.5,width:1,height:1,rotation:0};window.layers=['Assembly guide','Quality guide'].map((name,i)=>({layerId:'L'+i,stepId:'p',stepIds:['p'],name,source,marks:[],note:'',savedView:view,revision:1}));window.fetch=async(url,opt={})=>{if(url.includes('/pages/'))return new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});if(opt.method==='PUT'){const b=JSON.parse(opt.body);writes.push(b);const l=layers.find(l=>l.layerId===b.layerId);if(b.action==='marks')Object.assign(l,{marks:b.marks,name:b.name,note:b.note,stepIds:b.stepIds});else l.savedView=b.savedView;l.revision++;return{ok:true,json:async()=>structuredClone(l)};}return{ok:true,json:async()=>({contractVersion:2,textTransforms:canTextTransforms,zoomSizedShapes:true,basicShapes:window.shapeSupport!==false,laborRevision:9,source,canEdit:true,canSaveView:true,targets:[{id:'p',name:'Fixture'}],layers:layers.map(layer=>({layer:structuredClone(layer)}))})};};},png);
await page.addScriptTag({content:fs.readFileSync('SRC/workspaces/rfqs/labor-drawing-notes.js','utf8')});
const open=async()=>{await page.evaluate(()=>DleLaborDrawingNotes.open({intakeId:'F',stepId:'p',stepLabel:'Fixture',editable:true}));await page.waitForFunction(()=>!!document.querySelector('image')?.getAttribute('href'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};

const choose=async kind=>{await page.locator('[data-shapes]').click();await page.locator('[data-shape="'+kind+'"]').click();};
const pointer=async(events,type='touch')=>page.evaluate(({events,type})=>{const c=document.querySelector('.labor-annotation-canvas');const capture=c.setPointerCapture;c.setPointerCapture=()=>{};for(const [t,id,x,y]of events)c.dispatchEvent(new PointerEvent(t,{pointerId:id,pointerType:type,button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));c.setPointerCapture=capture;},{events,type});
const stroke=async()=>{const r=await page.locator('.labor-annotation-canvas').boundingBox();await pointer([['pointerdown',1,r.x+r.width*.4,r.y+r.height*.4],['pointermove',1,r.x+r.width*.6,r.y+r.height*.55],['pointerup',1,r.x+r.width*.6,r.y+r.height*.55]]);};
const state=()=>page.evaluate(()=>structuredClone(layers[0]));

for(const [label,width,height]of [['desktop',1440,1000],['tablet',1024,768],['phone',390,844]]){
 await page.setViewportSize({width,height});
 for(const level of [0,3,6]){
  await page.evaluate(()=>layers[0].marks=[]);await open();
  for(let i=0;i<level;i++)await page.locator('.labor-annotation-canvas').press('+');
  await choose('arrow');await stroke();await page.locator('[data-save]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-save]').disabled);
  const metrics=()=>page.locator('[data-marks]>[data-mark-id]').first().evaluate(n=>({stroke:+n.getAttribute('stroke-width')*Math.hypot(n.getCTM().a,n.getCTM().b),box:n.getBoundingClientRect().toJSON()}));
  const first=await metrics();assert(Math.abs(first.stroke-2)<.1,'two pixel initial stroke '+label+level);
  const saved=await state();await page.locator('.labor-annotation-canvas').press('+');assert((await metrics()).stroke>first.stroke*1.4,'placed marks scale with drawing');await page.locator('.labor-annotation-canvas').press('-');
  await choose('callout');await page.locator('[data-text]').fill('Check fit');await page.locator('[data-tool-done]').click();await page.locator('[data-save]').click();await page.waitForFunction(()=>!document.querySelector('[data-save]').disabled);
  const size=await page.locator('[data-marks] text').evaluate(n=>+n.getAttribute('font-size')*Math.hypot(n.getCTM().a,n.getCTM().b));assert(Math.abs(size-22)<.2,'22px initial callout '+label+level);
  const handle=page.locator('[data-shape-handle]').last(),h=await handle.boundingBox();assert(Math.abs(h.width-44)<.2,'44px resize target');
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+10,h.y+h.height/2+8);await page.mouse.up();await page.locator('[data-undo]').click();
  await page.locator('[data-save]').click();await page.waitForFunction(()=>!document.querySelector('[data-save]').disabled);const persisted=await state();assert.deepEqual(persisted.marks[0],saved.marks[0]);
  await page.screenshot({path:'tmp/shape-zoom/'+engine+'-'+label+'-'+level+'.png'});
  await page.locator('[data-back]').click();await page.locator('.labor-annotation-viewer').waitFor({state:'detached'});await open();assert.deepEqual((await state()).marks,persisted.marks,'save reopen retains source geometry');await page.locator('[data-back]').click();await page.locator('.labor-annotation-viewer').waitFor({state:'detached'});
 }
}
assert.deepEqual(errors,[]);console.log('PASS',engine,'screen-relative defaults across three zoom levels and layouts; anchored zoom; resize targets/undo; save reopen');
}finally{await browser.close();}}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

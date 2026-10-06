const fs=require('fs'),assert=require('assert/strict'),cp=require('child_process');
const {chromium,webkit}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const fixture=JSON.parse(fs.readFileSync('tmp/labor-drawing-notes/bridge-fixture.json'));
const dll=process.env.SIM_DRAWING_TEST_DLL||'tmp/labor-drawing-notes/test-build/SimLaborDrawingNotes001.dll';
const call=input=>JSON.parse(cp.execFileSync('dotnet',[dll,fixture.root,'--bridge'],{input:JSON.stringify({id:fixture.id,...input}),encoding:'utf8',windowsHide:true}));
(async()=>{for(const engine of ['webkit','edge']){const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.route('https://drawing-e2e.test/',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('https://drawing-e2e.test/');
 let puts=0;await page.exposeFunction('bridge',input=>{if(input.action==='save')puts++;return call(input);});
 await page.setContent('<style>'+fs.readFileSync('SRC/workspaces/rfqs/labor-workbench.css','utf8')+'</style><body data-view-mode="desktop"><main><input value="unsaved worksheet value"></main></body>');
 await page.evaluate(()=>{window.fetch=async(url,options={})=>{let input={action:'read'};if(options.method==='PUT')input={action:'save',step:url.split('/').at(-1),request:JSON.parse(options.body)};else if(url.includes('/pages/')){const pieces=url.split('/');input={action:'page',documentId:pieces.at(-3),sha256:pieces.at(-2),page:Number(pieces.at(-1))};}const result=await bridge(input);if(result.image)return new Response(Uint8Array.from(atob(result.image),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});return{ok:!result.error,json:async()=>result};};});
 await page.addScriptTag({content:fs.readFileSync('SRC/workspaces/rfqs/labor-drawing-notes.js','utf8')});
 const open=async()=>{await page.evaluate(f=>DleLaborDrawingNotes.open({intakeId:f.id,stepId:f.step,stepLabel:'Isolated persisted operation',editable:true}),fixture);await page.waitForFunction(()=>!!document.querySelector('image')?.getAttribute('href'));};
 const back=async()=>{await page.locator('[data-back]').click();await page.locator('.labor-annotation-viewer').waitFor({state:'detached'});};
 await open();await page.locator('[data-layer-note]').fill('Persisted from '+engine+' desktop');await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('[role="status"]').textContent.startsWith('Drawing Notes saved'));
 await page.locator('[data-in]').click();await page.locator('[data-rotate]').click();await page.locator('[data-save-view]').click();await page.waitForFunction(()=>document.querySelector('[role="status"]').textContent.startsWith('Author view saved'));
 const saved=call({action:'read'}).layers.find(x=>x.layer.stepId===fixture.step).layer;const savedPuts=puts;
 await page.locator('[data-out]').click();await page.locator('[data-rotate]').click();await back();
 for(let n=0;n<3;n++){await open();assert.equal(await page.locator('[data-layer-note]').inputValue(),'Persisted from '+engine+' desktop');assert(await page.evaluate(expected=>{const r=document.querySelector('.labor-annotation-canvas').getBoundingClientRect(),g=document.querySelector('[data-paper]'),i=g.querySelector('image'),m=g.transform.baseVal.consolidate().matrix,p=DleLaborDrawingNotes.point(m,{width:Number(i.getAttribute('width')),height:Number(i.getAttribute('height'))},r.width/2,r.height/2);return Math.abs(p.x-expected.x)<.00001&&Math.abs(p.y-expected.y)<.00001;},saved.savedView));await back();}
 assert.equal(puts,savedPuts);assert.equal(await page.locator('main input').inputValue(),'unsaved worksheet value');assert.deepEqual(call({action:'read'}).layers.find(x=>x.layer.stepId===fixture.step).layer.savedView,saved.savedView);
 console.log('PASS',engine,'desktop editor -> real server store -> disk -> new store/browser reopen; saved camera restored; casual navigation never wrote; worksheet retained');
}finally{await browser.close();}}})().catch(e=>{console.error(e.stack);process.exitCode=1});

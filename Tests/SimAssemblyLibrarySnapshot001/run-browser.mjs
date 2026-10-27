import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const items=Array.from({length:1290},(_,i)=>({sourceKeyRaw:`01PART-${i}   `,sourceRecordHash:'A'.repeat(64),contractVersion:'V1.2',billNumber:`PART-${i}   `,drawingNumber:i<493?'   ':`DRAW-${i}`,drawingRevision:'V*  ',bomRevision:'X ',bomRevisionDate:'3A213A',normalizedKeyCollision:false}));
items[0]={...items[0],billNumber:' D1002189-12   ',sourceKeyRaw:'01 D1002189-12        ',normalizedKeyCollision:true};items[1]={...items[1],billNumber:'D1002189-12    ',sourceKeyRaw:'01D1002189-12         ',normalizedKeyCollision:true};items[2].drawingNumber='<img src=x onerror=alert(1)>';
const snapshot={items,preliminary:true,totalHeaders:1290,blankDrawingCount:493,runId:'LIVEMIRROR001-20260729T232139Z-7CAB3382',sourceSha256:'B'.repeat(64)};
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<style>'+read('SRC/workspaces/assembly-library/assembly-library-workspace.css')+'</style><main data-workspace-mount="assembly-library"></main>');
 await page.evaluate(data=>{window.fixture=data;window.requests=[];window.allowed=true;window.httpStatus=200;window.DleOsRuntimeConfig={environment:'SIM'};window.DleOsCapabilities={can:p=>window.allowed&&p==='assembly_library.view'};window.changeWorkArea=()=>window.wentHome=true;window.fetch=async(url,opts)=>{window.requests.push({url,opts});return {ok:window.httpStatus===200,status:window.httpStatus,json:async()=>window.fixture};};},snapshot);
 await page.addScriptTag({content:read('SRC/workspaces/assembly-library/assembly-library-workspace.js')});
 const render=()=>page.evaluate(()=>window.DleWorkspaces['assembly-library'].render());await render();
 assert.equal(await page.locator('tbody tr').count(),50);assert.match(await page.locator('[role=status]').innerText(),/1,290 of 1,290/);
 await page.getByRole('button',{name:'Next',exact:true}).click();assert.match(await page.locator('.library-pager').innerText(),/Page 2 of 26/);
 await page.locator('#assemblyLibrarySearch').fill('D1002189-12');assert.equal(await page.locator('tbody tr').count(),2);assert.equal(await page.locator('.library-key-flag').count(),2);
 const keys=await page.locator('tbody tr').evaluateAll(rows=>rows.map(r=>r.dataset.sourceKey));assert.notEqual(keys[0],keys[1]);assert.equal(keys[0],'01 D1002189-12        ');
 await page.locator('tbody summary').first().click();assert.match(await page.locator('tbody').innerText(),/BOM revision date \(raw hex\): 3A213A/);
 await render();assert.equal(await page.locator('#assemblyLibrarySearch').inputValue(),'D1002189-12','reopen retains search');assert.equal(await page.evaluate(()=>window.requests.length),1);
 await page.locator('#assemblyLibrarySearch').fill('<img');assert.equal(await page.locator('tbody img').count(),0);assert.match(await page.locator('tbody').innerText(),/<img/);
 await page.locator('#assemblyLibrarySearch').fill('none-exists');assert.match(await page.locator('tbody').innerText(),/No matching headers/);
 await page.locator('#assemblyLibrarySearch').fill('');await page.getByLabel('Without drawing number',{exact:true}).check();assert.match(await page.locator('[role=status]').innerText(),/492 of 1,290/);
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no page overflow '+width);await page.locator('#assemblyLibrarySearch').focus();assert.equal(await page.locator('#assemblyLibrarySearch').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');}
 await page.getByRole('button',{name:'Back to Home'}).click();assert.equal(await page.evaluate(()=>window.wentHome),true);
 await page.evaluate(()=>window.allowed=false);await render();assert.match(await page.locator('main').innerText(),/unavailable/);assert.equal(await page.locator('tbody').count(),0);
 await page.evaluate(()=>{window.allowed=true;window.httpStatus=404;});await render();assert.match(await page.locator('main').innerText(),/awaits SIM activation/);
 await page.evaluate(()=>window.httpStatus=403);await page.getByRole('button',{name:'Retry'}).click();await page.getByText('Your current persona cannot browse this Library.').waitFor();
 await page.evaluate(()=>window.httpStatus=200);await page.getByRole('button',{name:'Retry'}).click();await page.locator('tbody').waitFor();
 await page.evaluate(()=>window.DleOsRuntimeConfig.environment='DEV');await render();assert.match(await page.locator('main').innerText(),/unavailable/);
 assert.ok(await page.evaluate(()=>window.requests.every(r=>r.url==='/api/sim/assembly-library/preliminary'&&!r.opts.method)),'read only GET');assert.deepEqual(errors,[]);
 const endpoint=read('Tools/SimRuntime/DleOs.SimHost/SimAssemblyLibraryEndpoints.cs');assert.ok(endpoint.indexOf('DeniedTechnicalReview')<endpoint.indexOf('SimAssemblyLibrarySnapshot.Read'));assert.match(endpoint,/assembly_library.view/);
 console.log('PASS: search, pagination, blank filter, exact raw keys, source details, XSS-safe text, reopen state, permission/environment guards, activation error/retry, GET only, responsive 1440/768/390, keyboard focus.');
}finally{await browser.close();}

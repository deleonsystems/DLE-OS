import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const styles=[...read('DLE_Work_Center_v4.0.0.html').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const items=Array.from({length:120},(_,i)=>({sourceKeyRaw:`01PART-${i}  `,billNumber:`PART-${i} `,drawingNumber:' ',drawingRevision:'V* ',bomRevision:'V-RED ',bomRevisionDate:'3A213A',sourceRecordHash:'A'.repeat(64),contractVersion:'V1.2',normalizedKeyCollision:false}));
items[0]={...items[0],sourceKeyRaw:'01 D1002189-12        ',billNumber:' D1002189-12 ',normalizedKeyCollision:true};items[1]={...items[1],sourceKeyRaw:'01D1002189-12         ',billNumber:'D1002189-12 ',normalizedKeyCollision:true};
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<style>'+styles+'</style><style>'+read('SRC/workspaces/assembly-library/assembly-library-workspace.css')+'</style><main data-workspace-mount="assembly-library"></main>');
 await page.evaluate(items=>{window.calls=[];window.DleLibraryBom={mount:async()=>{}};window.DleOsRuntimeConfig={environment:'SIM'};window.DleOsCapabilities={can:()=>true};window.fetch=async(url,options)=>{window.calls.push({url,options});return{ok:true,json:async()=>({items,preliminary:true,totalHeaders:120,blankDrawingCount:120,runId:'fixture-run',sourceSha256:'B'.repeat(64)})};};},items);
 await page.addScriptTag({content:read('SRC/workspaces/assembly-library/assembly-library-workspace.js')});await page.evaluate(()=>window.DleWorkspaces['assembly-library'].render());
 await page.locator('#assemblyLibrarySearch').fill('PART');await page.getByLabel('Without drawing number',{exact:true}).check();await page.getByRole('button',{name:'Next',exact:true}).click();
 const selectedKey=await page.locator('tbody tr').first().getAttribute('data-source-key');
 await page.locator('.library-assembly-open').first().focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('#assemblyRecordWorkspace').getAttribute('data-source-key'),selectedKey);
 assert.equal(await page.locator('#assemblyLibrarySearch').isVisible(),false);
 assert.equal(await page.locator('.library-identity dd').nth(0).innerText(),'Not provided');
 assert.equal(await page.locator('.library-identity dd').nth(1).innerText(),'V*');assert.equal(await page.locator('.library-identity dd').nth(2).innerText(),'V-RED');
 assert.equal(await page.locator('#assemblyRecordWorkspace button').count(),2,'Back and Open Materials actions only');
 assert.deepEqual(await page.locator('.library-assembly-section h3').allTextContents(),['Materials','Production / Drawings / Prints','Notes / Images']);
 await page.getByText('Source details',{exact:true}).click();assert.match(await page.locator('#assemblyRecordWorkspace').innerText(),/3A213A/);
 await page.evaluate(()=>window.DleWorkspaces['assembly-library'].render());assert.equal(await page.locator('#assemblyRecordWorkspace').getAttribute('data-source-key'),selectedKey);
 await page.getByRole('button',{name:'Back to Assembly Library',exact:true}).click();
 assert.equal(await page.locator('#assemblyLibrarySearch').inputValue(),'PART');assert.equal(await page.getByLabel('Without drawing number',{exact:true}).isChecked(),true);assert.match(await page.locator('.library-pager').innerText(),/Page 2 of 3/);
 assert.equal(await page.locator('.library-assembly-open').first().evaluate(e=>e===document.activeElement),true);
 await page.locator('#assemblyLibrarySearch').fill('D1002189-12');
 for(const index of [0,1]){const key=await page.locator('tbody tr').nth(index).getAttribute('data-source-key');await page.locator('.library-assembly-open').nth(index).click();assert.equal(await page.locator('#assemblyRecordWorkspace').getAttribute('data-source-key'),key);assert.equal(await page.locator('#libraryAssemblyTitle').textContent(),index?'D1002189-12':' D1002189-12');await page.getByRole('button',{name:'Back to Assembly Library'}).click();}
 await page.locator('.library-assembly-open').first().click();
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);}
 assert.equal(await page.evaluate(()=>window.calls.length),1,'no writes or extra reads on open');assert.deepEqual(errors,[]);
 console.log('PASS exact selected raw identity and collision keys; separate/absent revisions; keyboard open/back/focus; search/filter/page preserved; shell reopen; honest sections; responsive; one GET and no mutations.');
}finally{await browser.close();}

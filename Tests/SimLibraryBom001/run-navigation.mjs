import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>fs.readFileSync(root+p,'utf8');
const child=spawn('dotnet',[process.env.DLE_LIBRARY_TEST_DLL,'--serve',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const url=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',b=>{text+=b;const m=text.match(/FIXTURE_URL=(http:\/\/127\.0\.0\.1:\d+)/);if(m)resolve(m[1]);});child.once('exit',c=>reject(Error('fixture exit '+c)));});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(url);await page.waitForFunction(()=>window.DleLibraryBom);
 await page.setContent('<style>'+read('SRC/workspaces/assembly-library/assembly-library-workspace.css')+'</style><main data-workspace-mount="assembly-library"></main>');
 await page.addScriptTag({content:read('SRC/workspaces/assembly-library/library-bom.js')});
 const key='01PART                ';
 await page.route('**/api/sim/assembly-library/preliminary',route=>route.fulfill({json:{items:[{sourceKeyRaw:key,billNumber:'PART ',drawingRevision:'A',bomRevision:'A',drawingNumber:'',bomRevisionDate:'ABCD'}],preliminary:true,totalHeaders:1,blankDrawingCount:1,runId:'fixture'}}));
 await page.evaluate(()=>{window.DleOsRuntimeConfig={environment:'SIM'};window.DleOsCapabilities={can:()=>true};});
 await page.addScriptTag({content:read('SRC/workspaces/assembly-library/assembly-library-workspace.js')});await page.evaluate(()=>window.DleWorkspaces['assembly-library'].render());
 await page.locator('#assemblyLibrarySearch').fill('PART');await page.locator('.library-assembly-open').click();
 await page.getByRole('button',{name:'Open Materials / BOM',exact:true}).click();
 const editor=page.locator('#libraryBomWorkspace');await editor.getByRole('button',{name:'Enter manually',exact:true}).click();await editor.getByRole('button',{name:'Add row',exact:true}).click();await editor.getByLabel('Find',{exact:true}).fill('18.1');
 assert.equal(await editor.getAttribute('data-source-key'),key);
 await page.getByRole('button',{name:'Back to Assembly',exact:true}).click();assert.equal(await editor.isVisible(),false);
 await page.getByRole('button',{name:'Open Materials / BOM',exact:true}).click();assert.equal(await editor.getByLabel('Find',{exact:true}).inputValue(),'18.1');
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);}
 await page.getByRole('button',{name:'Back to Assembly',exact:true}).click();
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Back to Assembly Library',exact:true}).click();assert.equal(await page.locator('#assemblyRecordWorkspace').isVisible(),true);
 await page.getByRole('button',{name:'Open Materials / BOM',exact:true}).click();assert.equal(await editor.getByLabel('Find',{exact:true}).inputValue(),'18.1');await page.getByRole('button',{name:'Back to Assembly',exact:true}).click();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Back to Assembly Library',exact:true}).click();assert.equal(await page.locator('#assemblyLibrarySearch').inputValue(),'PART');assert.equal(await editor.count(),0);
 console.log('PASS dedicated Materials navigation, exact identity, unsaved edit retention, cancel/confirm leave, responsive widths, restored list search.');
}finally{await browser.close();await fetch(url+'/fixture-stop',{method:'POST'});await new Promise(resolve=>child.once('exit',resolve));}

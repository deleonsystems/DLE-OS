import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const template=read('SRC/workspaces/technical-review/technical-review-workspace.html');
assert.ok(!template.includes('data-technical-review-action="assembly-library"'),'old home button removed');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<style>'+read('SRC/home/work-area-home.css')+'</style><main id="home"><div id="dleWorkAreaHome" class="work-area-home"></div><div data-workspace-home="assembly-library"><div data-workspace-mount="assembly-library"></div></div></main>');
 await page.evaluate(template=>{
  document.body.dataset.simRuntime='true';document.body.dataset.viewMode='desktop';
  window.DleOsRuntimeConfig={environment:'SIM',rfqIntakeMode:'SIM_PHASE1'};
  window.DleOsSession={user:{displayName:'Fixture Admin',accountStatus:'ACTIVE'},roles:['ADMIN']};
  window.DleOsCapabilities={isSuperAdmin:true,can:()=>true};
  window.DleOperatorHeader={getViewMode:()=>document.body.dataset.viewMode};
  window.nav=[];window.go=(screen)=>window.nav.push({screen});window.setWorkspaceView=id=>window.nav.push({workspace:id});
  window.requests=[];window.fetch=async(url,options)=>{window.requests.push({url,options});if(url!=='/api/sim/assembly-library/preliminary')throw Error('Unexpected fetch');return{ok:true,json:async()=>({preliminary:true,items:[],totalHeaders:0,blankDrawingCount:0,runId:"fixture",sourceSha256:"fixture"})};};
 },template);
 for(const file of ['SRC/shell/workspace-registry.js','SRC/home/work-area-home.js','SRC/workspaces/assembly-library/assembly-library-workspace.js'])await page.addScriptTag({content:read(file)});
 await page.addScriptTag({content:read('SRC/shell/workspace-shell.js')});await page.evaluate(()=>{window.DleWorkspaceShell.init();const previous=window.setWorkspaceView;window.setWorkspaceView=id=>{previous(id);return window.DleWorkspaceShell.setWorkspaceView(id);};});
 for(const [mode,width] of [['desktop',1440],['desktop',1000],['ipad',1024],['ipad',768]]){
  await page.setViewportSize({width,height:1000});await page.evaluate(mode=>{document.body.dataset.viewMode=mode;window.DleWorkAreaHome.render();},mode);
  const tr=await page.locator('[data-work-area="technical-review"]').boundingBox(),lib=await page.locator('[data-work-area="assembly-library"]').boundingBox();
  assert.ok(lib.x>tr.x+tr.width-1,'Library to right of Technical Review '+mode);assert.ok(Math.abs((lib.y+lib.height/2)-(tr.y+tr.height/2))<1,'aligned centers '+mode);
  assert.equal(lib.width,128);assert.equal(lib.height,128);assert.ok(lib.width<tr.width,'compact square');
  await page.waitForFunction(()=>!!document.querySelector('.home-flow-edge.reference'));
  const edge=await page.locator('.home-flow-edge.reference').boundingBox();assert.ok(edge.x>=tr.x+tr.width-1&&edge.x+edge.width<=lib.x+1,'connector stays in gap');const label=page.locator('.home-library-link-label');assert.equal(await label.textContent(),'Mgd by Tech Rvw');const lb=await label.boundingBox();assert.ok(lb.x>=tr.x+tr.width&&lb.x+lb.width<=lib.x,'label fits connector gap');
  assert.ok(!await page.locator('[data-work-area="assembly-library"]').innerText().then(t=>t.includes('Managed by')));
  await page.locator('[data-work-area="assembly-library"]').focus();assert.equal(await page.locator('[data-work-area="assembly-library"]').evaluate(e=>getComputedStyle(e).outlineStyle),'solid','keyboard focus visible');
  assert.ok(await page.locator('[data-work-area="assembly-library"]').evaluate(e=>e.scrollWidth<=e.clientWidth&&e.scrollHeight<=e.clientHeight),'no clipped tile content');
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.body.dataset.viewMode='mobile';window.DleWorkAreaHome.render();});
 const mobile=page.locator('button[data-mobile-work-area="assembly-library"]');const box=await mobile.boundingBox();assert.equal(box.width,128);assert.equal(box.height,128);await mobile.focus();assert.ok(await mobile.evaluate(e=>e===document.activeElement));
 assert.ok(await mobile.evaluate(e=>getComputedStyle(e,'::before').borderLeftStyle==='dashed'),'mobile connection retained');assert.ok(await mobile.evaluate(e=>e.scrollWidth<=e.clientWidth&&e.scrollHeight<=e.clientHeight),'mobile text fits');
 await page.keyboard.press('Enter');assert.ok(await page.evaluate(()=>window.nav.some(n=>n.workspace==='assembly-library')),'mobile keyboard launch');
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.body.dataset.viewMode='desktop';window.DleWorkAreaHome.render();});
 await page.locator('[data-work-area="assembly-library"]').click();assert.ok(await page.evaluate(()=>window.nav.some(n=>n.workspace==='assembly-library')));
 await page.evaluate(()=>window.DleWorkspaces['assembly-library'].render());assert.equal(await page.evaluate(()=>window.DleWorkspaceShell.getCurrentWorkspace().id),'assembly-library');
 assert.match(await page.locator('#assemblyLibraryView').innerText(),/Preliminary snapshot/);
 await page.locator('#assemblyLibraryView').evaluate(e=>e.dataset.fixtureState='retained');await page.evaluate(()=>window.DleWorkspaces['assembly-library'].render());
 assert.equal(await page.locator('#assemblyLibraryView').getAttribute('data-fixture-state'),'retained','existing destination DOM/state reused');
 assert.equal(await page.evaluate(()=>window.requests.length),1,'one snapshot GET; no business writes');
 await page.getByRole('button',{name:'Back to Home',exact:true}).click();assert.ok(await page.evaluate(()=>window.nav.some(n=>n.workspace==='dle-home')));
 await page.evaluate(()=>{window.DleOsCapabilities.can=()=>false;window.DleWorkAreaHome.render();});assert.equal(await page.locator('[data-work-area="assembly-library"]').count(),0,'permission filtering preserved');
 await page.evaluate(()=>window.DleWorkspaces['assembly-library'].render());assert.match(await page.locator('[data-workspace-mount="assembly-library"]').innerText(),/unavailable/);
 await page.evaluate(()=>{document.body.dataset.simRuntime='false';window.DleOsRuntimeConfig.environment='DEV';window.DleOsCapabilities.can=()=>true;window.DleWorkAreaHome.render();});assert.equal(await page.locator('[data-work-area="assembly-library"]').count(),0,'non-SIM unchanged');
 assert.equal(await page.evaluate(()=>window.DleWorkspaceRegistry.getById('assembly-library')),null);
 assert.deepEqual(errors,[]);
 console.log('PASS compact 128px desktop/tablet/mobile tile, gap-only subtle connector, compact chosen label, keyboard launch/focus, content fits, existing navigation/permissions/state and no business writes');
} finally {await browser.close();}

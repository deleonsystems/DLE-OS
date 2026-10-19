const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const {read,out,repo}=require('./fixture-support.cjs');
const js=read('work-area-home.js'),css=read('work-area-home.css');
const before=require('child_process').execFileSync('git',['-c','safe.directory='+repo.replace(/\\/g,'/'),'show','81cbfddfa42a95323e54a8af505b0b7ff825fb9b:SRC/home/work-area-home.js'],{cwd:repo,encoding:'utf8'});
const registry=read('workspace-registry.js');
let browser,page,passed=[];
async function setup({role='SUPER_ADMIN',superAdmin=true,mode='desktop',sim=true,active=true,permissions=null,source=js}={}){
 await page.goto('about:blank');
 await page.setContent('<style>*{box-sizing:border-box}body{margin:0;background:#0b1220;font-family:Arial;color:white}'+css+'</style><body><main id="dleWorkAreaHome" class="work-area-home"></main></body>');
 await page.evaluate(({role,superAdmin,mode,sim,active,permissions})=>{
  document.body.dataset.simRuntime=String(sim);document.body.dataset.viewMode=mode;
  window.DleOsRuntimeConfig={rfqIntakeMode:'SIM_PHASE1'};
  window.DleOsSession={user:{displayName:'SIM Administrator',accountStatus:active?'ACTIVE':'DISABLED'},roles:[role]};
  window.DleOsCapabilities={isSuperAdmin:superAdmin,can:p=>permissions===null||permissions.includes(p)};
  window.DleOperatorHeader={getViewMode:()=>document.body.dataset.viewMode,isMobileView:()=>document.body.dataset.viewMode==='mobile'};
  window.calls=[];window.setWorkspaceView=id=>calls.push(['workspace',id]);window.go=(id,arg)=>calls.push(['screen',id,arg]);
 },{role,superAdmin,mode,sim,active,permissions});
 await page.addScriptTag({content:registry});await page.addScriptTag({content:source});await page.evaluate(()=>DleWorkAreaHome.render());
}
(async()=>{browser=await chromium.launch({channel:'msedge'});page=await browser.newPage({hasTouch:true,viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [role,superAdmin,expected] of [['SUPER_ADMIN',true,true],['ADMIN',false,true],['SIM_OPERATIONS_MANAGER',false,false],['NOT_ADMIN',false,false]]){
  await setup({role,superAdmin});assert.equal(await page.locator('.home-flow-map').count(),expected?1:0);passed.push('scope '+role);
 }
 for(const mode of ['mobile'])for(const role of ['ADMIN','SUPER_ADMIN']){await setup({role,mode});assert.equal(await page.locator('.home-flow-map').count(),0);const after=await page.locator('#dleWorkAreaHome').innerHTML();await setup({role,mode,source:before});assert.equal(await page.locator('#dleWorkAreaHome').innerHTML(),after);passed.push(mode+' unchanged '+role);}
 for(const options of [{sim:false},{active:false},{role:'SIM_KITTING_OPERATOR',superAdmin:false,permissions:['kitting.view']},{role:'SIM_NO_ACCESS',superAdmin:false,permissions:[]}]){
  await setup(options);assert.equal(await page.locator('.home-flow-map').count(),0);const after=await page.locator('#dleWorkAreaHome').innerHTML();await setup({...options,source:before});assert.equal(await page.locator('#dleWorkAreaHome').innerHTML(),after);passed.push('unchanged '+JSON.stringify(options));
 }
 await setup();const ids=await page.locator('[data-work-area]').evaluateAll(es=>es.map(e=>e.dataset.workArea));assert.equal(ids.length,13);assert.equal(new Set(ids).size,13);
 assert.equal(await page.locator('[data-work-area]').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);passed.push('two-column card layout');
 for(const id of ids){await page.locator('[data-work-area="'+id+'"]').click();const calls=await page.evaluate(()=>calls.splice(0));assert.deepEqual(calls,[['workspace',id],['screen',id==='operations-center'?'operationsCenter':'home',false]]);passed.push('route '+id);}
 await page.locator('[data-work-area]').first().focus();for(const id of ids){assert.equal(await page.evaluate(()=>document.activeElement.dataset.workArea),id);await page.keyboard.press('Tab');}passed.push('keyboard tab order');
 await page.locator('[data-work-area="quality"]').focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');assert.equal((await page.evaluate(()=>calls.splice(0))).length,4);assert.notEqual(await page.locator('[data-work-area="quality"]').evaluate(e=>getComputedStyle(e).outlineStyle),'none');passed.push('native Enter / Space and visible focus');
 await page.waitForTimeout(50);assert.equal(await page.locator('.home-flow-edge').count(),11);assert.equal(await page.locator('svg').getAttribute('aria-hidden'),'true');assert.equal(await page.locator('svg').evaluate(e=>getComputedStyle(e).pointerEvents),'none');passed.push('decorative connectors');
 assert.equal(await page.locator('[data-from="production"][data-to="quality-inspection"]').count(),1);assert.equal(await page.locator('[data-from="quality-inspection"][data-to="shipping"]').count(),1);assert.equal(await page.locator('[data-from="production"][data-to="shipping"]').count(),0);passed.push('Production through QC Inspection to Shipping');
 for(const width of [1920,1440,1280,1024,999,768,640,480]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(60);
  const bad=await page.locator('[data-work-area]').evaluateAll(es=>es.filter(e=>e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1).map(e=>e.dataset.workArea));assert.deepEqual(bad,[],width+' clipping');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,width+' page overflow');
  if(width>=1000){const hit=await page.locator('[data-work-area]').evaluateAll(es=>es.every(e=>{const b=e.getBoundingClientRect();e.scrollIntoView();const c=e.getBoundingClientRect();return e.contains(document.elementFromPoint(c.x+c.width/2,c.y+c.height/2));}));assert.equal(hit,true);}
  if([1440,1024,640].includes(width)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'home-fixture-'+width+'.png'),fullPage:true});}passed.push('resize '+width);
 }
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.body.style.zoom='2');await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('[data-work-area]').count(),13);passed.push('200% CSS zoom');
 await setup({role:'ADMIN',superAdmin:false,permissions:['technical_review.view','kitting.view']});await page.waitForTimeout(40);assert.equal(await page.locator('[data-work-area="quality"]').count(),0);assert.equal(await page.locator('[data-from="order-entry"],[data-to="quality"],[data-from="quality"],[data-to="receiving"]').count(),0);passed.push('restricted Admin removes unavailable endpoints without bypass');
 await page.evaluate(()=>{document.body.dataset.viewMode='ipad';document.dispatchEvent(new Event('dle:view-mode-change'));});assert.equal(await page.locator('.uses-admin-flow').count(),1);await page.evaluate(()=>{document.body.dataset.viewMode='desktop';document.dispatchEvent(new Event('dle:view-mode-change'));});assert.equal(await page.locator('.home-flow-map').count(),1);passed.push('presentation switching cleans up map');

 for(const [role,superAdmin] of [['ADMIN',false],['SUPER_ADMIN',true]]){
  await setup({role,superAdmin,mode:'ipad'});
  assert.equal(await page.locator('.home-flow-map').count(),1);
  assert.equal(await page.locator('.home-flow-materials').count(),1);
  assert.equal(await page.locator('.home-flow-production').count(),1);
  for(const [width,height] of [[768,1024],[820,1180],[834,1194],[1024,768],[1180,820],[1194,834],[1366,1024]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(60);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'tablet overflow '+width);
   assert.equal(await page.locator('.home-flow-lines').isVisible(),true);
   assert.equal(await page.locator('.home-flow-edge').count(),11);
   const geometry=await page.evaluate(()=>{
    const cards=[...document.querySelectorAll('.home-flow-map [data-work-area]')];
    const bad=cards.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44||e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1||parseFloat(getComputedStyle(e.querySelector('strong')).fontSize)<18;}).map(e=>e.dataset.workArea);
    const collisions=[];const svg=document.querySelector('.home-flow-lines'),matrix=svg.getScreenCTM();
    for(const edge of document.querySelectorAll('.home-flow-edge'))for(let i=1;i<50;i++){
     const p=edge.getPointAtLength(edge.getTotalLength()*i/50),q=new DOMPoint(p.x,p.y).matrixTransform(matrix);
     for(const card of cards){if([edge.dataset.from,edge.dataset.to].includes(card.dataset.workArea))continue;const b=card.getBoundingClientRect();if(q.x>b.left+1&&q.x<b.right-1&&q.y>b.top+1&&q.y<b.bottom-1)collisions.push(card.dataset.workArea);}
    }
    return {bad,collisions};
   });
   assert.deepEqual(geometry,{bad:[],collisions:[]},'tablet card/connector geometry '+width);
   if(role==='ADMIN'&&[768,1024].includes(width)){
    for(const id of ids){assert.equal(await page.evaluate(id=>!!DleWorkspaceRegistry.getById(id),id),true,'real tablet route '+id);await page.locator('[data-work-area="'+id+'"]').tap();assert.deepEqual(await page.evaluate(()=>calls.splice(0)),[['workspace',id],['screen',id==='operations-center'?'operationsCenter':'home',false]]);}
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'home-ipad-'+width+'.png'),fullPage:true});
   }
   passed.push(role+' tablet '+width+'x'+height);
  }
 }
 await page.setViewportSize({width:768,height:1024});await setup({mode:'ipad'});
 await page.evaluate(()=>{document.body.dataset.workspaceView='dle-home';document.body.style.cssText='display:grid;grid-template-columns:1100px';const home=document.querySelector('#dleWorkAreaHome'),shell=document.createElement('main');home.before(shell);shell.append(home);});
 await page.waitForTimeout(60);
 assert.equal(await page.locator('.home-flow-map [data-work-area]').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().right<=innerWidth)),true,'oversized app grid cannot clip tablet home');passed.push('tablet outer-shell width containment');
 for(const options of [{role:'SIM_KITTING_OPERATOR',superAdmin:false},{role:'NOT_ADMIN',superAdmin:false},{active:false},{sim:false}]){
  await setup({...options,mode:'ipad'});const current=await page.locator('#dleWorkAreaHome').innerHTML();assert.equal(await page.locator('.home-flow-map').count(),0);
  await setup({...options,mode:'ipad',source:before});assert.equal(await page.locator('#dleWorkAreaHome').innerHTML(),current);passed.push('tablet unchanged '+JSON.stringify(options));
 }
 await setup({role:'ADMIN',superAdmin:false,mode:'ipad',permissions:['kitting.view']});
 assert.equal(await page.locator('[data-work-area="quality"],[data-work-area="quality-inspection"]').count(),0);
 assert.equal(await page.locator('.home-flow-edge').count(),2);assert.equal(await page.locator('[data-to="quality"],[data-to="quality-inspection"],[data-from="quality-inspection"],[data-to="receiving"],[data-to="shipping" ]').count(),0);passed.push('tablet permission filters');
 await page.evaluate(()=>{document.body.dataset.viewMode='mobile';document.dispatchEvent(new Event('dle:view-mode-change'));});assert.equal(await page.locator('.home-flow-map').count(),0);passed.push('tablet to phone cleans up map');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'home-results.json'),JSON.stringify({passed,errors},null,2));console.log('PASS '+passed.length+' browser checks.');await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});

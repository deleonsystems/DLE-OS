const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const source=fs.readFileSync('SRC/workspaces/rfqs/rfqs-workspace.js','utf8');
const css=fs.readFileSync('SRC/workspaces/rfqs/rfqs-workspace.css','utf8');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const width of [375,430]){
  const page=await browser.newPage({viewport:{width,height:844}});await page.route('**/*',r=>r.abort());
  await page.setContent('<style>:root{--text:#e2e8f0;--muted:#94a3b8;--border:#334155;--panel:#111827;--panel-2:#172033}body{margin:0;background:#060d15}body>main{width:100%;box-sizing:border-box}'+css+'</style><body data-sim-runtime="true" data-workspace-view="rfqs" data-view-mode="mobile"><main><div data-workspace-mount="rfqs"></div></main></body>');
  await page.evaluate(()=>{
   window.crypto.randomUUID ||= () => 'isolated-request-id';
   window.posts=[];window.opened=[];window.authorized=true;window.approvalCurrent=false;
   window.row={intakeId:'MOBILE-RFQ-FIXTURE',customer:{customerName:'LongCustomer'.repeat(25)},assemblies:[{assemblyNumber:'LongAssembly'.repeat(25),revision:'A',quantity:25}],intakeStatus:'READY_FOR_RFQ_WORKING_QUEUE',scope:'MATERIAL_AND_LABOR',bucket:'ACTIVE',workbenchEligible:true,status:'Ready for Quote Assembly',quoteNumber:'HistoricalQuote'.repeat(20),quoteTotal:123.45,approvals:[],commercial:{status:'OPEN',revision:4,history:[],orderLinks:[]},lanes:{materials:{status:'COMPLETE'},labor:{status:'COMPLETE'}},inputs:{materials:{version:1,candidate:{rows:[]}}}};
   window.DleOsCapabilities={can:()=>window.authorized};
   window.DleOperatorHeader={setViewMode:mode=>{document.body.dataset.viewMode=mode;document.dispatchEvent(new Event('dle:view-mode-change'));}};
   window.DleMaterialsWorkbench={open:()=>opened.push('materials')};window.DleLaborWorkbench={open:()=>opened.push('labor')};window.DleQuotationFinalReview={open:()=>opened.push('final-review')};
   window.fetch=async(url,options={})=>{
    if(options.method==='POST'){posts.push(JSON.parse(options.body));row.commercial.status='SUBMITTED';row.status='Submitted';return{ok:true,json:async()=>({})};}
    if(url.endsWith('/final-review'))return{ok:true,json:async()=>({approvalCurrent,approvals:[{id:'approved-version-1',version:1,approvedAt:'2026-09-22',summary:{quoteTotal:123.45}}]})};
    return{ok:true,json:async()=>({items:[structuredClone(row)]})};
   };
  });
  await page.addScriptTag({content:source});await page.evaluate(()=>DleWorkspaces.rfqs.render());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('[data-rfq]').click();await page.locator('#rfqsMobileScope').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.match(await page.locator('.rfqs-approval-note').innerText(),/Historical approval/);
  assert.equal(await page.locator('[data-commercial="SUBMIT"]').count(),0);
  for(const target of ['materials','final-review']){
   assert(await page.locator('[data-open="'+target+'"]').isDisabled());
   await page.locator('[data-open="'+target+'"]').dispatchEvent('click');
  }
  assert.deepEqual(await page.evaluate(()=>opened),[]);
  assert.equal(await page.locator('[data-open="labor"]').isDisabled(),false);
  await page.locator('[data-open="labor"]').click();assert.deepEqual(await page.evaluate(()=>opened),['labor']);
  await page.evaluate(()=>{window.approvalCurrent=true;window.authorized=false;return DleWorkspaces.rfqs.refresh();});
  assert(await page.locator('[data-commercial="SUBMIT"]').isDisabled());
  await page.locator('[data-commercial="SUBMIT"]').dispatchEvent('click');assert.equal(await page.evaluate(()=>posts.length),0);
  await page.evaluate(()=>{window.authorized=true;return DleWorkspaces.rfqs.refresh();});
  await page.locator('[data-commercial="SUBMIT"]').click();
  await page.waitForFunction(()=>posts.length===1&&row.status==='Submitted');
  const post=await page.evaluate(()=>posts[0]);assert.equal(post.approvalId,'approved-version-1');assert.equal(post.approvalVersion,1);assert.equal(post.expectedRevision,4);
  await page.evaluate(()=>DleOperatorHeader.setViewMode('desktop'));
  for(const target of ['materials','final-review'])assert.equal(await page.locator('[data-open="'+target+'"]').isDisabled(),false);
  console.log('PASS',width,'long fields, historical/current approval, permission gate, exact mocked submission, desktop-only guards');await page.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

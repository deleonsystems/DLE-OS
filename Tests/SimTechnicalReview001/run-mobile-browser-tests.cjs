const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const out='tmp/technical-review-mobile';
const raw=fs.readFileSync('.sim-state/data/rfq-intakes.json');
const record=JSON.parse(raw.toString().replace(/^\uFEFF/,'')).records.find(r=>r.intakeId==='RFQI-SIM-0035');
record.intakeId='MOBILE-ISOLATED-FIXTURE';record.customer.customerName='Mobile review fixture';record.status='TECHNICAL_REVIEW_IN_PROGRESS';record.technicalReview.workflow=null;record.technicalReview.bomAcceptances=[];
const shell=fs.readFileSync('DLE_Work_Center_v4.0.0.html','utf8');const css=[...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n')+fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.css','utf8');
const source=fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.js','utf8').replace('  window.DleWorkspaces =','  window.mobileTest={state,renderDetail,renderCandidate,watchCandidateWorkbench,setMount:m=>{mount=m;bindInteractions();}};\n  window.DleWorkspaces =');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const gatePage=await browser.newPage({viewport:{width:390,height:844}});
await gatePage.setContent('<style>'+fs.readFileSync('SRC/shell/operator-header.css','utf8')+'</style><body data-sim-runtime="true" data-workspace-view="dle-home"><header class="dle-app-header"><div class="dle-operator-header"><nav class="dle-operator-nav"></nav><button id="dleDevControlsToggle"></button><div id="dleDevControlsPanel"></div><span id="dleEnvironmentBadge"></span></div></header><main><div id="home"><div id="dleWorkAreaHome"></div></div></main></body>');
await gatePage.evaluate(()=>{window.DleOsRuntimeConfig={rfqIntakeMode:'SIM_PHASE1'};window.DleOsSession={user:{displayName:'Fixture'}};window.DleOsCapabilities={can:p=>p==='technical_review.view'};window.setWorkspaceView=id=>{document.body.dataset.workspaceView=id;document.dispatchEvent(new CustomEvent('dle:workspace-change'));};window.go=()=>{};});
for(const f of ['SRC/shell/workspace-registry.js','SRC/home/work-area-home.js','SRC/shell/operator-header.js'])await gatePage.addScriptTag({content:fs.readFileSync(f,'utf8')});
await gatePage.evaluate(()=>{DleOperatorHeader.setViewMode('mobile');DleWorkAreaHome.render();});
assert.equal(await gatePage.locator('[data-mobile-work-area="technical-review"]').count(),1);
assert.equal(await gatePage.locator('[data-mobile-work-area="rfqs"]').count(),1);
await gatePage.locator('[data-mobile-work-area="technical-review"]').click();assert(await gatePage.locator('#dleMobileViewFallback').evaluate(e=>e.hidden));assert.notEqual(await gatePage.locator('#home').evaluate(e=>getComputedStyle(e).display),'none');
await gatePage.evaluate(()=>setWorkspaceView('rfqs'));assert(await gatePage.locator('#dleMobileViewFallback').evaluate(e=>e.hidden));
await gatePage.evaluate(()=>{document.body.dataset.simRuntime='false';setWorkspaceView('rfqs');});assert.equal(await gatePage.locator('#dleMobileViewFallback').evaluate(e=>e.hidden),false);
await gatePage.evaluate(()=>{document.body.dataset.simRuntime='false';setWorkspaceView('technical-review');});assert.equal(await gatePage.locator('#dleMobileViewFallback').evaluate(e=>e.hidden),false);assert.equal(await gatePage.locator('#home').evaluate(e=>getComputedStyle(e).display),'none');
await gatePage.evaluate(()=>{document.body.dataset.simRuntime='true';DleOsCapabilities={can:()=>false};setWorkspaceView('dle-home');DleWorkAreaHome.render();});assert.equal(await gatePage.locator('[data-mobile-work-area="technical-review"]').count(),0);assert.equal(await gatePage.locator('[data-mobile-work-area="rfqs"]').count(),0);
await gatePage.close();console.log('PASS SIM-only Home and shell gate; other workspaces unchanged; unauthorized Home entry absent');
for(const width of [375,390,430,1440]){
 const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width<500});await page.route('**/*',r=>r.abort());const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<style>'+css+'</style><body data-sim-runtime="true" data-workspace-view="technical-review" data-view-mode="mobile"><main><div id="home"><div data-workspace-mount="technical-review">'+fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.html','utf8')+'</div></div></main></body>');
 await page.evaluate(record=>{window.fixture=record;window.mockPosts=[];window.DleOsCapabilities={can:()=>true};window.fetch=async(url,options={})=>{if(options.method==='POST'&&url.endsWith('/documents')){const file=options.body.get('file'),metadata=JSON.parse(options.body.get('metadata'));window.mockPosts.push({name:file.name,text:await file.text(),metadata});const doc={documentId:'fixture-added',name:file.name,documentType:'BOM',role:'SUPPORTING',applicability:'PARENT_ASSEMBLY',identityReview:{type:metadata.type,decision:'CONFIRMED'}};window.fixture.technicalFiles.push({documentId:doc.documentId,name:file.name});window.fixture.technicalReview.technicalPackage.documents.push(doc);return{ok:true,json:async()=>({record:window.fixture,reviewStatusLabel:'In Progress'})};}if(!options.method||options.method==='GET')return{ok:true,json:async()=>({record:window.fixture,reviewStatusLabel:'In Progress'})};throw Error('Unexpected fixture request '+url);};},structuredClone(record));
 await page.addScriptTag({content:source});await page.evaluate(()=>{const t=window.mobileTest;t.setMount(document.querySelector('[data-workspace-mount]'));t.state.selected={record:window.fixture,reviewStatusLabel:'In Progress'};t.state.guided=true;t.state.step='inventory';document.querySelector('#technicalReviewQueueView').hidden=true;document.querySelector('#technicalReviewDetailView').hidden=false;t.renderDetail();});
 await page.locator('[data-technical-review-action="add-document"]').click();await page.locator('#reviewDocumentFiles').setInputFiles({name:'phone-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic mobile upload only')});assert.equal(await page.evaluate(()=>mockPosts.length),0);
 await page.locator('[data-technical-review-action="upload-documents"]').click();assert.match(await page.locator('#technicalReviewDetail').innerText(),/Select a document type for every file/);assert.equal(await page.evaluate(()=>mockPosts.length),0);
 await page.locator('[data-upload-field="type"]').selectOption('BOM_ONLY');await page.locator('[data-upload-field="note"]').fill('Fixture from native file input');
 await page.screenshot({path:out+'/mobile-upload-fixture-'+width+'.png',fullPage:true});
 if(width<500){assert.equal(await page.locator('#reviewDocumentFiles').evaluate(e=>getComputedStyle(e).opacity),'1');assert((await page.locator('[data-upload-field="type"]').boundingBox()).height>=44);}
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'package/upload page overflow '+width);
 await page.locator('[data-technical-review-action="upload-documents"]').click();await page.waitForFunction(()=>mockPosts.length===1&&!mobileTest.state.saving);assert.equal(await page.evaluate(()=>mockPosts[0].text),'Synthetic mobile upload only');assert.equal(await page.evaluate(()=>mockPosts[0].metadata.note),'Fixture from native file input');assert.match(await page.locator('#technicalReviewDetail').innerText(),/1 technical document saved/);
 await page.evaluate(()=>{const t=mobileTest;t.state.step='candidate';t.state.candidateIndex=null;t.state.rowReviewUi={};t.renderDetail();});
 const scroll=page.locator('.candidate-table-scroll');await scroll.waitFor();if(width<500){assert(await scroll.evaluate(e=>e.scrollWidth>e.clientWidth));await scroll.evaluate(e=>e.scrollLeft=250);assert(await scroll.evaluate(e=>e.scrollLeft>0));await scroll.evaluate(e=>e.scrollLeft=0);}
 assert.equal(await page.locator('.technical-review-status-pill').innerText(),'In Progress');
 await page.screenshot({path:out+'/mobile-bom-fixture-'+width+'.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'BOM page overflow '+width);
 await page.locator('[data-technical-review-action="candidate-row-edit"]').first().click();
 await page.locator('[data-worksheet-row="0"] .candidate-options>summary').click();await page.locator('[data-worksheet-row="0"] .candidate-section-selector[data-panel="edit"]').click();
 const editor=page.locator('#candidate-lineNumber');await editor.fill('1');assert.equal(await editor.inputValue(),'1');
 if(width<500){await page.locator('.candidate-table-scroll').evaluate(e=>e.scrollLeft=0);const bounds=await page.locator('.candidate-row-inspector').boundingBox();assert(bounds.width<width);}
 await page.screenshot({path:out+'/mobile-edit-fixture-'+width+'.png',fullPage:true});
 await page.locator('[data-technical-review-action="candidate-panel-close"]').click();
 await page.getByRole('button',{name:'Back to Technical Package Review',exact:false}).click();await page.locator('[data-technical-review-action="candidate-leave-discard"]').click();await page.waitForFunction(()=>mobileTest.state.step!=='candidate');assert.equal(await page.evaluate(()=>mockPosts.length),1);
 assert.deepEqual(errors,[]);console.log('PASS',width,'native file input, no auto-upload, required classification, mock save, contained BOM scroll');await page.close();
}
assert(fs.readFileSync('.sim-state/data/rfq-intakes.json').equals(raw));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

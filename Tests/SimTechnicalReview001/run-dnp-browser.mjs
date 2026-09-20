// Real store behind the browser; all writes are confined to a temporary copy.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const repository=process.cwd(), before=fs.readFileSync('.sim-state/data/rfq-intakes.json');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dle-customer-browser-'));
const data=JSON.parse(before.toString().replace(/^\uFEFF/,''));
const fixture=process.argv[3];assert(fixture,'Provide the DNP_FIXTURE directory');
const record=JSON.parse(fs.readFileSync(path.join(fixture,'before.json'),'utf8'));
record.status='TECHNICAL_REVIEW_IN_PROGRESS';record.technicalReview.workflow=null;record.technicalReview.bomAcceptances=[];
fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/rfq-intakes.json'),JSON.stringify({schema:data.schema,records:[record]}));
fs.cpSync(path.join(repository,'.sim-state/intake-documents',record.requestCorrelationId),path.join(root,'intake-documents',record.requestCorrelationId),{recursive:true});
const dll=process.argv[2]||path.join(os.tmpdir(),'dle-dnp-build/SimScannedBomReview001.dll');
const api=(action,request)=>{const r=spawnSync('dotnet',[dll,repository,'--identity-browser',root],{input:JSON.stringify({intakeId:record.intakeId,action,request}),encoding:'utf8',maxBuffer:32*1024*1024});assert(!r.error,r.error?.message);assert(r.stdout,r.stderr);return {status:r.status===0?200:409,body:JSON.parse(r.stdout)};};
const source=fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.js','utf8').replace('  window.DleWorkspaces =','  window.identityTest={state,renderCandidate,renderDetail,renderAcceptedBom,bindInteractions,watchCandidateWorkbench,candidateProgressRows,candidateCompletionKey,setMount:x=>mount=x};\n  window.DleWorkspaces =');
const shell=fs.readFileSync('DLE_Work_Center_v4.0.0.html','utf8');
const styles=[...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')+fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.css','utf8');
const html=`<!doctype html><style>${styles}</style><main><div id="home"><div data-workspace-mount="technical-review" class="technical-review-guided"><div class="technical-review-workspace"><div id="technicalReviewDetail"></div></div></div></div></main>`;
const server=http.createServer(async(req,res)=>{if(!req.url.startsWith('/api/')){res.end(html);return;}let body='';for await(const chunk of req)body+=chunk;const response=api(req.url.endsWith('/bom-completion-readiness')?'readiness':req.method==='PUT'?'review':'read',body?JSON.parse(body):undefined);res.writeHead(response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(response.body));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:source});
 await page.evaluate(envelope=>{const t=window.identityTest;t.setMount(document.querySelector('[data-workspace-mount]'));t.bindInteractions();t.state.selected=envelope;t.state.step='candidate';t.state.candidateIndex=null;t.state.guided=true;t.renderDetail();},api('read').body);

 const toggle=page.getByRole('checkbox',{name:'Show DNPs',exact:true});
 assert.equal(await toggle.isChecked(),false);
 const visibleLines=()=>page.locator('tr[data-worksheet-row]:visible .candidate-line').allTextContents();
 const snapshot=()=>page.evaluate(()=>{const t=window.identityTest;return {model:JSON.stringify(t.state.selected.record),drafts:JSON.stringify(t.state.rowReviewUi),progress:t.candidateProgressRows(),key:t.candidateCompletionKey(),status:document.querySelector('[data-candidate-progress-status]')?.textContent,complete:document.querySelector('[data-technical-review-action=complete-bom]')?.disabled,statuses:[...document.querySelectorAll('.candidate-status')].map(x=>x.textContent)};});
 let writes=0;page.on('request',r=>{if(['PUT','POST','DELETE'].includes(r.method()))writes++;});
 // Current saved Candidates have no DNPs. Verify presentation is unchanged for both.
 for(const id of ['RFQI-SIM-0041','RFQI-SIM-0035']){
  const saved=structuredClone(data.records.find(r=>r.intakeId===id));assert(saved);
  saved.status='TECHNICAL_REVIEW_IN_PROGRESS';saved.technicalReview.workflow=null;saved.technicalReview.bomAcceptances=[];
  await page.evaluate(record=>{const t=window.identityTest;t.state.selected={record};t.state.rowReviewUi={};t.state.candidateIndex=null;t.renderDetail();},saved);
  const lines=await visibleLines(),beforeToggle=await snapshot(),writesBefore=writes;
  await toggle.check();assert.deepEqual(await visibleLines(),lines);await toggle.uncheck();
  assert.deepEqual(await snapshot(),beforeToggle);assert.equal(writes,writesBefore);
  console.log('PASS saved Candidate',id,'toggle does not change rows, drafts, status, readiness, or save state');
 }
 // Temporary presentation fixture: original numerical order, mixed DNP statuses.
 const display=structuredClone(record);const displayRows=display.technicalReview.candidateBom.rows;const examples=displayRows.splice(displayRows.length-2,2);displayRows.splice(displayRows.findIndex(r=>r.values.lineNumber==='5')+1,0,...examples);
 for(const row of display.technicalReview.candidateBom.rows.filter(r=>r.rowId?.startsWith('dnp-fixture-'))){row.componentType='DNP';row.values.description='DO NOT POPULATE';row.reviewState={reviewed:row.values.lineNumber==='6',reasons:[],blockers:[],token:'fixture'};}
 await page.evaluate(record=>{const t=window.identityTest;t.state.selected={record};t.state.rowReviewUi={};t.state.candidateIndex=null;t.renderDetail();},display);
 assert.equal(await toggle.isChecked(),false);assert.deepEqual((await visibleLines()).slice(0,7),['1','2','3','4','5','8','9']);
 const unchanged=await snapshot(),writesBefore=writes;
 await toggle.check();assert.deepEqual((await visibleLines()).slice(0,9),['1','2','3','4','5','6','7','8','9']);
 assert.equal(await page.locator('tr[data-candidate-dnp] .candidate-status').first().innerText(),'Accepted');
 assert.equal(await page.locator('tr[data-candidate-dnp] .candidate-status').last().innerText(),'Needs Review');
 await toggle.uncheck();assert.deepEqual(await snapshot(),unchanged);assert.equal(writes,writesBefore);
 await toggle.check();
 await page.screenshot({path:path.join(root,'show-dnps.png')});
 console.log('PASS DNP toggle: default off, numbering gaps, ordered restore, both statuses retained, no writes or readiness change');
 await page.evaluate(envelope=>{const t=window.identityTest;t.state.selected=envelope;t.state.rowReviewUi={};t.state.candidateIndex=null;t.renderDetail();},api('read').body);

 for(const [find,refdes] of [['6','Q2'],['7','Q3']]){
  const index=record.technicalReview.candidateBom.rows.findIndex(r=>r.rowId==='dnp-fixture-'+find),row=page.locator(`tr[data-worksheet-row="${index}"]`);
  const type=row.locator('[data-worksheet-field=componentType]');
  assert.deepEqual(await type.locator('option').allTextContents(),['Standard / COTS','Subassembly','DNP / Do Not Populate','Other','Reference Only']);
  await type.selectOption('DNP');assert.equal(await row.locator('[data-approved-part]').innerText(),'DNP');assert.equal(await row.locator('[data-candidate-description]').innerText(),'DO NOT POPULATE');assert.equal(await row.locator('[data-candidate-designators]').innerText(),refdes);
  await page.getByRole('button',{name:'Save Progress',exact:true}).click();await page.waitForFunction(()=>!window.identityTest.state.saving);
  assert.match(await row.locator('.candidate-row-controls').innerText(),/Needs Review/);
  await row.locator('[data-technical-review-action=worksheet-accept]').click();await page.waitForFunction(()=>!window.identityTest.state.saving);assert.match(await row.locator('.candidate-row-controls').innerText(),/Accepted/);
  await page.evaluate(async()=>{const t=window.identityTest;t.state.selected=await (await fetch('/api/sim/technical-reviews/RFQI-SIM-0041')).json();t.state.rowReviewUi={};t.renderDetail();});assert.equal(await row.locator('[data-approved-part]').innerText(),'DNP');assert.equal(await row.locator('[data-candidate-designators]').innerText(),refdes);
  await row.locator('.candidate-options > summary').click();await row.getByRole('button',{name:'Source / Evidence',exact:true}).click();assert.match(await page.locator('.candidate-source-evidence').innerText(),/NOT USED/);
  await page.locator('.candidate-inspector-heading').getByRole('button',{name:'Close'}).click();
  await row.getByRole('button',{name:'Edit',exact:true}).click();await type.selectOption('STANDARD_COTS');assert.notEqual(await row.locator('[data-approved-part]').innerText(),'DNP');await row.locator('[data-technical-review-action=worksheet-accept]').click();await page.waitForFunction(()=>!window.identityTest.state.saving);assert.match(await page.locator('.technical-review-message').innerText(),/positive line number|part number|identity/);
  await type.selectOption('DNP');await row.locator('[data-technical-review-action=worksheet-accept]').click();await page.waitForFunction(()=>!window.identityTest.state.saving);assert.match(await row.locator('.candidate-row-controls').innerText(),/Accepted/);
  console.log('PASS browser Find',find,refdes,'Type / normalized Description / Save Progress / Accept / reopen / source preserved / reverse gate');
 }
 const accepted=JSON.parse(fs.readFileSync(path.join(fixture,'accepted.json'),'utf8'));await page.evaluate(record=>{const t=window.identityTest;t.state.selected={record};t.state.acceptedVersion=record.technicalReview.bomAcceptances.at(-1).version;document.getElementById('technicalReviewDetail').innerHTML=t.renderAcceptedBom(record);},accepted);
 for(const refdes of ['Q2','Q3']){const r=page.locator('tbody tr').filter({has:page.locator('td',{hasText:new RegExp('^'+refdes+'$')})}).filter({has:page.locator('td',{hasText:'DNP / Do Not Populate'})});assert.match(await r.innerText(),/DNP \/ Do Not Populate/);assert.match(await r.innerText(),/DO NOT POPULATE/);assert.equal(await r.locator('td').nth(2).innerText(),'DNP');}
 await page.screenshot({path:path.join(root,'accepted-dnp.png')});assert.deepEqual(errors,[]);assert(fs.readFileSync('.sim-state/data/rfq-intakes.json').equals(before));console.log('PASS Accepted BOM DNP rendering; normal dataset unchanged. '+root);

}finally{await browser?.close();server.close();}

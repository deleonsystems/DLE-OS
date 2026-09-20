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
const record=data.records.find(r=>r.intakeId==='RFQI-SIM-0041');
record.status='TECHNICAL_REVIEW_IN_PROGRESS';record.technicalReview.workflow=null;record.technicalReview.bomAcceptances=[];
// Make the unresolved customer-identity precondition independent of saved user progress.
for(const unresolved of record.technicalReview.candidateBom.rows.filter(r=>['H4-150','H4-116','H2-224','F2-134','N4-243'].includes(r.values.partNumber))){delete unresolved.primaryIdentity;delete unresolved.workingState;delete unresolved.assemblyIdentity;unresolved.componentType='STANDARD_COTS';unresolved.confirmed=false;}
fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/rfq-intakes.json'),JSON.stringify({schema:data.schema,records:[record]}));
fs.cpSync(path.join(repository,'.sim-state/intake-documents',record.requestCorrelationId),path.join(root,'intake-documents',record.requestCorrelationId),{recursive:true});
const dll=process.argv[2]||path.join(os.tmpdir(),'dle-identity-basis-build/SimScannedBomReview001.dll');
const api=(action,request)=>{const r=spawnSync('dotnet',[dll,repository,'--identity-browser',root],{input:JSON.stringify({intakeId:record.intakeId,action,request}),encoding:'utf8',maxBuffer:32*1024*1024});assert(!r.error,r.error?.message);assert(r.stdout,r.stderr);return {status:r.status===0?200:409,body:JSON.parse(r.stdout)};};
const source=fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.js','utf8').replace('  window.DleWorkspaces =','  window.identityTest={state,renderCandidate,renderDetail,renderAcceptedBom,bindInteractions,watchCandidateWorkbench,setMount:x=>mount=x};\n  window.DleWorkspaces =');
const shell=fs.readFileSync('DLE_Work_Center_v4.0.0.html','utf8');
const styles=[...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')+fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.css','utf8');
const html=`<!doctype html><style>${styles}</style><main><div id="home"><div data-workspace-mount="technical-review" class="technical-review-guided"><div class="technical-review-workspace"><div id="technicalReviewDetail"></div></div></div></div></main>`;
const server=http.createServer(async(req,res)=>{if(!req.url.startsWith('/api/')){res.end(html);return;}let body='';for await(const chunk of req)body+=chunk;const response=api(req.url.endsWith('/bom-completion-readiness')?'readiness':req.method==='PUT'?'review':'read',body?JSON.parse(body):undefined);res.writeHead(response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(response.body));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:source});
 await page.evaluate(envelope=>{const t=window.identityTest;t.setMount(document.querySelector('[data-workspace-mount]'));t.bindInteractions();t.state.selected=envelope;t.state.step='candidate';t.state.candidateIndex=null;t.state.guided=true;t.renderDetail();},api('read').body);
 const index=record.technicalReview.candidateBom.rows.findIndex(r=>r.values.partNumber==='H4-150');
 const row=page.locator(`[data-worksheet-row="${index}"]`),manager=page.locator('.approved-part-manager');
 const open=async i=>{const r=page.locator(`[data-worksheet-row="${i}"]`);await r.locator('.candidate-options > summary').click();await r.getByRole('button',{name:'Approved P/Ns',exact:true}).click();};
 for(const pn of ['H4-116','H2-224','F2-134','N4-243']){const i=record.technicalReview.candidateBom.rows.findIndex(r=>r.values.partNumber===pn);await open(i);assert.match(await manager.innerText(),/No manufacturer P\/N is available/);assert(await manager.getByRole('button',{name:'Use Customer P/N',exact:true}).isVisible());}
 await open(index);await manager.getByRole('button',{name:'Use Customer P/N',exact:true}).click();assert.equal(await manager.getByRole('textbox',{name:'Customer approved P/N'}).inputValue(),'H4-150');assert.equal(await manager.getByRole('textbox').count(),1);
 await manager.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!window.identityTest.state.saving);assert.equal(await row.locator('[data-approved-part]').innerText(),'H4-150');assert.match(await row.locator('.candidate-row-controls').innerText(),/Needs Review/);
 await row.locator('[data-technical-review-action=worksheet-accept]').click();await page.waitForFunction(()=>!window.identityTest.state.saving);assert.match(await row.locator('.candidate-row-controls').innerText(),/Accepted/);
 await open(index);assert.match(await manager.innerText(),/Customer P\/N/);
 await page.evaluate(async()=>{const t=window.identityTest;t.state.selected=await (await fetch('/api/sim/technical-reviews/RFQI-SIM-0041')).json();t.state.rowReviewUi={};t.renderDetail();});assert.equal(await row.locator('[data-approved-part]').innerText(),'H4-150');assert.match(await manager.innerText(),/Customer P\/N/);
 await manager.getByRole('button',{name:'Edit Customer P/N'}).click();await manager.getByRole('textbox').fill('H4-150-REVIEW');await page.getByRole('button',{name:'Save Progress',exact:true}).click();await page.waitForFunction(()=>!window.identityTest.state.saving);assert.equal(await row.locator('[data-approved-part]').innerText(),'H4-150-REVIEW');assert.match(await row.locator('.candidate-row-controls').innerText(),/Needs Review/);
 await open(index);await manager.locator('summary').click();await manager.getByRole('button',{name:'Use Manufacturer P/N'}).click();assert.match(await row.locator('[data-approved-part]').innerText(),/H4-150-REVIEW/);await manager.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!window.identityTest.state.saving);assert.equal(await row.locator('[data-approved-part]').innerText(),'Not resolved');
 await manager.getByRole('button',{name:'Use Customer P/N',exact:true}).click();await manager.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!window.identityTest.state.saving);await row.locator('[data-technical-review-action=worksheet-accept]').click();await page.waitForFunction(()=>!window.identityTest.state.saving);
 await open(index);await page.screenshot({path:path.join(root,'customer-identity.png')});
 const saved=api('read').body.record;const actual=saved.technicalReview.candidateBom.rows[index];assert.equal(actual.identityBasis,'CUSTOMER_PN');assert.equal(actual.manufacturerIdentity.proposals.length,0);assert.equal(actual.reviewState.reviewed,true);assert.deepEqual(actual.alternates,record.technicalReview.candidateBom.rows[index].alternates);
 for(const pn of ['H4-116','H2-224','F2-134','N4-243'])assert.equal(saved.technicalReview.candidateBom.rows.find(r=>r.values.partNumber===pn).primaryIdentity,undefined);
 // Render an actual backend-created accepted snapshot when supplied.
 if(process.argv[3]){const accepted=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));await page.evaluate(record=>{const t=window.identityTest;t.state.selected={record};t.state.acceptedVersion=record.technicalReview.bomAcceptances.at(-1).version;document.getElementById('technicalReviewDetail').innerHTML=t.renderAcceptedBom(record);},accepted);const acceptedRow=page.locator('tbody tr').filter({has:page.locator('td.candidate-part',{hasText:'H4-150'})});assert.equal(await acceptedRow.locator('td').nth(2).innerText(),'H4-150');await acceptedRow.locator('summary').first().click();assert.match(await acceptedRow.innerText(),/Approved P\/N Basis: Customer P\/N/);}
 assert.deepEqual(errors,[]);assert(fs.readFileSync('.sim-state/data/rfq-intakes.json').equals(before));console.log('PASS real-store browser: four unresolved examples, H4-150 Save/Accept/reopen, Save Progress, explicit basis change, Accepted BOM display; normal data untouched. '+root);
}finally{await browser?.close();server.close();}

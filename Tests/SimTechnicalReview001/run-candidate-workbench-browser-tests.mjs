// Browser qualification uses saved scenarios in memory only; no SIM HTTP requests or writes.
// NODE_PATH must resolve playwright. Optional DLE_TEST_BROWSER_CHANNEL (default msedge).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=process.cwd(), dataPath=path.join(root,'.sim-state/data/rfq-intakes.json');
const before=fs.readFileSync(dataPath), data=JSON.parse(before.toString().replace(/^\uFEFF/,''));
const inlineRequests=[];
const out=fs.mkdtempSync(path.join(os.tmpdir(),'dle-candidate-workbench-'));
const source=fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.js','utf8').replace('  window.DleWorkspaces =',`  window.workbenchTest={state,candidateProgressRows,reopenCandidate,renderCandidate,renderDetail,renderAcceptedBom,watchCandidateWorkbench,bindInteractions,candidateColumnWidth,setMount:x=>mount=x};\n  window.DleWorkspaces =`);
const shell=fs.readFileSync('DLE_Work_Center_v4.0.0.html','utf8');
const styles=[...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n')+'\n'+fs.readFileSync('SRC/workspaces/technical-review/technical-review-workspace.css','utf8');
const html=`<!doctype html><meta charset="utf-8"><style>${styles}</style><header class="dle-app-header" style="height:56px">DLE-OS / SIM isolated qualification</header><main><div id="home"><div data-workspace-mount="technical-review" class="technical-review-guided"><div class="technical-review-workspace"><div id="technicalReviewDetail"></div></div></div></div></main>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({channel:process.env.DLE_TEST_BROWSER_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}}); const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&!r.url().endsWith('/bom-completion-readiness'))writes.push(r.url())});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:source});
 await page.evaluate(()=>{window.workbenchTest.setMount(document.querySelector('[data-workspace-mount]'));window.workbenchTest.bindInteractions();});
 for(const [id,count] of [['RFQI-SIM-0035',55],['RFQI-SIM-0041',82]]) {
  const record=data.records.find(r=>r.intakeId===id);assert.equal(record.technicalReview.candidateBom.rows.length,count);
  await page.evaluate(record=>{const t=window.workbenchTest;t.state.selected={record};t.state.step='candidate';t.state.guided=true;t.state.rowReviewUi={};t.state.candidateIndex=null;t.state.candidateDraft=null;t.state.candidateInlineRow=null;t.state.inlineDescriptionDirty=false;t.state.candidateLeaveIntent=null;t.state.rowOption=null;t.state.message='';document.getElementById('technicalReviewDetail').innerHTML=t.renderCandidate(record);t.watchCandidateWorkbench();},record);
  for(const sub of record.technicalReview.candidateBom.rows.filter(r=>r.componentType==='SUBASSEMBLY')){const cell=page.locator('[data-candidate-copy="'+sub.index+'"]');assert.equal(await cell.locator('select').count(),0);assert.match(await cell.innerText(),new RegExp(sub.assemblyIdentity?.partNumber||(sub.alternates||[]).find(a=>a.origin==='MANUAL'&&!a.removedAtUtc)?.partNumber));}
  const saved=await page.evaluate(()=>JSON.stringify(window.workbenchTest.state.selected.record));
  const affected=[];
  for(const candidateRow of record.technicalReview.candidateBom.rows) {
   if(candidateRow.componentType==='SUBASSEMBLY')continue;
   if(candidateRow.primaryIdentity?.basis==='CUSTOMER_PN'){assert.equal(await page.locator('[data-candidate-copy="'+candidateRow.index+'"] [data-approved-part]').innerText(),candidateRow.primaryIdentity.partNumber);continue;}
   const identity=candidateRow.manufacturerIdentity,decision=proposal=>[...(identity?.history||[])].reverse().find(h=>h.proposalId===proposal.id)?.decision||'PROPOSED';
   const cell=page.locator('[data-candidate-copy="'+candidateRow.index+'"]');
   const locked=await cell.locator('..').evaluate(el=>el.classList.contains('candidate-row-locked'));
   const raw=(identity?.proposals||[]).filter(p=>p.partNumber?.trim()&&decision(p)!=='REJECTED');
   const current=raw.filter(p=>locked?decision(p)==='CONFIRMED':['CONFIRMED','PROPOSED'].includes(decision(p)));
   const keys=[...new Set(current.map(p=>JSON.stringify([p.partNumber.trim(),(p.manufacturerName||'').trim()])))];
   if(raw.length!==keys.length)affected.push(candidateRow.values.lineNumber);
   assert.equal(await cell.locator('summary small').count(),keys.length>1?1:0);
   if(keys.length>1)assert.equal(await cell.locator('summary small').innerText(),'+'+(keys.length-1));
   assert.equal(await cell.locator('.candidate-identity-controls').isVisible(),false,'identity details hidden on initial reload');
   const collapsed=await cell.innerText();assert.doesNotMatch(collapsed,/Approved|NOT_SELECTED| — /);
   assert.equal(collapsed.trim(),(await cell.locator('summary').innerText()).trim());
   await cell.locator('summary').click();
   const shown=locked?await cell.locator('.candidate-identity-controls > div').allTextContents():await cell.locator('select option').evaluateAll(options=>options.filter(o=>o.value&&o.value!=='MANUAL').map(o=>o.textContent));
   assert.equal(shown.length,keys.length);assert.equal(new Set(shown).size,shown.length);assert(shown.every(t=>!t.includes('NOT_SELECTED')));
   await cell.locator('summary').click();
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(window.workbenchTest.state.selected.record)),saved,'display normalization never changes stored business state');
  if(id==='RFQI-SIM-0041') {
   for(const line of ['1','4','9','13','17','18','19']) {
    const r=record.technicalReview.candidateBom.rows.find(r=>r.values.lineNumber===line);
    const cell=page.locator('[data-candidate-copy="'+r.index+'"]');
    assert.equal(await cell.locator('[data-approved-part]').count(),1);assert.equal(await cell.locator('summary small').count(),0);
   }
   console.log('PASS all 82 Candidate rows normalized; cited 1/4/9/13/17/18/19 clean; affected raw rows:',affected.join(','));
  } else console.log('PASS all 55 rows normalized; distinct current multiple manufacturers preserved; historical-only choices omitted from grid:',affected.join(','));

  const approvedCells=page.locator('[data-candidate-copy]');
  const visibleText=await approvedCells.allInnerTexts();
  assert(visibleText.every(t=>!t.includes('Review candidate')&&!t.includes(' — ')),'normal cell has no maker or redundant action');
  const multiIndex=record.technicalReview.candidateBom.rows.findIndex(r=>(r.manufacturerIdentity?.proposals||[]).filter(p=>p.partNumber).length>1&&r.componentType!=='SUBASSEMBLY');
  assert(multiIndex>=0);
  const multiCell=page.locator('[data-candidate-copy]').filter({has:page.locator('summary small')}).first();
  assert.match(await multiCell.innerText(),/\+\d+/);
  await multiCell.locator('summary').click();
  assert(await multiCell.locator('.candidate-identity-controls').isVisible(),'indicator opens manufacturer context');
  assert.match(await multiCell.innerText(),/ — /);
  await multiCell.locator('summary').click();

  for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]) {
   await page.setViewportSize(viewport);await page.evaluate(()=>window.workbenchTest.watchCandidateWorkbench());
   const fit=await page.locator('.candidate-table-scroll').evaluate(el=>({height:el.clientHeight,bottom:document.querySelector('.candidate-workbench').getBoundingClientRect().bottom,viewport:innerHeight}));
   assert(fit.height>=300&&fit.bottom<=fit.viewport,JSON.stringify(fit));
  }
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.workbenchTest.watchCandidateWorkbench());

  const grid=page.locator('.candidate-table-scroll');
  const metrics=await grid.evaluate(el=>({height:el.clientHeight,vertical:el.scrollHeight>el.clientHeight,horizontal:el.scrollWidth>el.clientWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth}));
  assert(metrics.height>=350&&metrics.vertical&&metrics.horizontal&&!metrics.pageOverflow,JSON.stringify(metrics));
  await grid.evaluate(el=>{el.scrollTop=800;el.scrollLeft=200});
  const pinned=await page.evaluate(()=>{const g=document.querySelector('.candidate-table-scroll').getBoundingClientRect();const h=document.querySelector('[data-candidate-heading=line]').getBoundingClientRect();const status=document.querySelector('[data-candidate-heading=status]').getBoundingClientRect();return {header:Math.abs(h.top-g.top)<3,line:Math.abs(h.left-g.left)<3,status:status.left-g.left};});
  assert(pinned.header&&pinned.line&&pinned.status>=56,JSON.stringify(pinned));
  await grid.evaluate(el=>{el.scrollTop=0;el.scrollLeft=0});
  const handle=page.locator('[data-candidate-resize=description]');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
  await page.mouse.move(box.x+4,box.y+10);await page.mouse.down();await page.mouse.move(box.x+184,box.y+10,{steps:8});await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.workbenchTest.candidateColumnWidth('description')),480);
  const des=page.locator('[data-candidate-resize=designators]');await des.focus();await page.keyboard.press('Shift+ArrowRight');assert.equal(await page.evaluate(()=>window.workbenchTest.candidateColumnWidth('designators')),212);
  await page.getByRole('button',{name:'Reset Widths',exact:true}).click();assert.equal(await page.evaluate(()=>window.workbenchTest.candidateColumnWidth('description')),300);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.workbenchTest.state.selected.record)),saved,'layout must not mutate business data');assert.deepEqual(writes,[],'layout performs no writes');
  if(id==='RFQI-SIM-0035') {assert.equal(await page.locator('[data-technical-review-action=worksheet-accept]').count(),0);assert.equal(await page.locator('.candidate-row-controls button').count(),0);}
  await grid.evaluate(el=>{el.scrollTop=600;el.scrollLeft=0});await page.screenshot({path:path.join(out,id+'.png')});
  console.log('PASS',id,count,'rows',JSON.stringify(metrics),'sticky header/controls, drag/key resize, reset, unchanged record');
  // Exercise editable presentation in an isolated copy; persisted completed scenario remains immutable.
  await page.evaluate(()=>{const t=window.workbenchTest,r=t.state.selected.record;r.status='TECHNICAL_REVIEW_IN_PROGRESS';r.technicalReview.workflow=null;r.technicalReview.bomAcceptances=[];t.renderDetail();});
  const rowIndex=id==='RFQI-SIM-0035'?20:30;
  if(id==='RFQI-SIM-0041')await page.evaluate(index=>{const t=window.workbenchTest;t.state.selected.record.technicalReview.candidateBom.rows[index].reviewState.reviewed=true;t.renderDetail();},rowIndex);
  const row=page.locator(`tr[data-worksheet-row="${rowIndex}"]`);await row.locator('.candidate-row-controls button').scrollIntoViewIfNeeded();
  const y=(await row.boundingBox()).y;
  await row.locator('.candidate-row-controls button').click();
  assert(Math.abs((await row.boundingBox()).y-y)<3,'Edit preserves row position');
  assert.equal(await page.locator('.candidate-detail-row').count(),0,'direct Edit unlocks without Details');
  // Mock the existing save response, asserting the request's existing acceptance shape.
  await page.evaluate(()=>{window.testSaveRequests=[];window.fetch=async(url,options)=>{if(url.endsWith('/bom-completion-readiness'))return {ok:true,json:async()=>({ready:false})};window.testSaveRequests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>structuredClone(window.workbenchTest.state.selected)}};});
  const editY=(await row.boundingBox()).y;await row.locator('.candidate-row-controls button').click();
  await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert(Math.abs((await row.boundingBox()).y-editY)<3,'Accept preserves row position');
  const request=await page.evaluate(()=>window.testSaveRequests);assert.equal(request.length,1);assert.equal(request[0].body.rowIndex,rowIndex);assert(request[0].body.worksheetAcceptance);assert.deepEqual(request[0].body.values,Object.fromEntries(['lineNumber','partNumber','quantity','designators','description'].map(k=>[k,record.technicalReview.candidateBom.rows[rowIndex].values[k]])));assert.equal(request[0].body.candidateId,record.technicalReview.candidateBom.id);assert.equal(await page.locator('.candidate-detail-row').count(),0);
  console.log('PASS',id,'isolated Edit/Accept position, existing save request, compact details');
  // Requested Line 1 workflow: actual clipboard keys, inline draft, existing acceptance payload.
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  const first=page.locator('tr[data-worksheet-row="0"]'),desc=first.locator('[data-candidate-description]');
  if(await first.locator('.candidate-row-controls button').innerText()==='Edit') {
   await desc.dblclick();assert.equal(await desc.locator('input').count(),0,'accepted row locked');
   await first.locator('.candidate-row-controls button').click();
  }
  await first.locator('[data-candidate-copy]').click({position:{x:4,y:4}});await page.keyboard.press('Control+c');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  const proposals=record.technicalReview.candidateBom.rows[0].manufacturerIdentity.proposals;
  assert(proposals.some(p=>p.partNumber===copied)||(record.technicalReview.candidateBom.rows[0].componentType==='SUBASSEMBLY'&&await first.locator('[data-candidate-copy] input').inputValue()===copied),'clipboard is P/N only: '+copied);
  const original=record.technicalReview.candidateBom.rows[0].values.description;
  await desc.dblclick();let input=desc.locator('input');await input.fill('Cancel this edit');await input.press('Escape');assert.equal(await desc.innerText(),original);
  await desc.focus();await page.keyboard.press('F2');input=desc.locator('input');
  const replacement='Qualified inline description for '+id;
  await page.evaluate(value=>navigator.clipboard.writeText(value),replacement);await input.press('Control+v');assert.equal(await input.inputValue(),replacement);
  await input.press('ArrowLeft');assert.equal(await input.evaluate(el=>el.selectionStart),replacement.length-1);
  await input.press('Enter');assert.equal(await page.locator('.candidate-detail-row').count(),0);assert.match(await desc.innerText(),/Unsaved/);
  await page.evaluate(()=>{window.fetch=async()=>({ok:false,json:async()=>({message:'Test save rejected'})});});
  await first.locator('.candidate-row-controls button').click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert.match(await desc.innerText(),/Unsaved/);assert.match(await page.locator('.technical-review-message').innerText(),/Test save rejected/);
  await page.evaluate(()=>{window.testSaveRequests=[];window.fetch=async(url,options)=>{if(url.endsWith('/bom-completion-readiness'))return {ok:true,json:async()=>({ready:false})};const body=JSON.parse(options.body);window.testSaveRequests.push({url,body});const t=window.workbenchTest,row=t.state.selected.record.technicalReview.candidateBom.rows[body.rowIndex];Object.assign(row.values,body.values);row.reviewState.reviewed=true;return {ok:true,json:async()=>structuredClone(t.state.selected)}};});
  await first.locator('.candidate-row-controls button').click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  const inline=await page.evaluate(()=>window.testSaveRequests);assert.equal(inline.length,1);assert.equal(inline[0].body.values.description,replacement);
  inlineRequests.push({intakeId:id,request:inline[0].body});
  assert.equal(await desc.innerText(),replacement);assert.equal(await desc.getAttribute('data-description-locked'),'true');assert.equal(await page.locator('.candidate-detail-row').count(),0);
  await desc.dblclick();assert.equal(await desc.locator('input').count(),0);
  if(process.env.DLE_INLINE_REPLAY_RESULTS) {
   const records=JSON.parse(fs.readFileSync(process.env.DLE_INLINE_REPLAY_RESULTS,'utf8'));
   await page.evaluate(record=>{const t=window.workbenchTest;t.state.selected={record};t.renderDetail();},records.find(r=>r.intakeId===id));
   assert.equal(await desc.innerText(),replacement);assert.equal(await desc.getAttribute('data-description-locked'),'true');
   assert.doesNotMatch(await first.locator('[data-candidate-copy]').innerText(),/Not resolved/);
   console.log('PASS',id,'real persisted store result reopened in browser');
  }
  await page.screenshot({path:path.join(out,id+'-inline.png')});
  console.log('PASS',id,'Line 1 P/N Ctrl+C, paste, arrows, Escape, Enter, Accept payload, compact locked row');
  // Browser-only preferred display: selection survives collapse, acceptance, and a full page reload.
  const choiceRow=page.locator('[data-candidate-copy]').filter({has:page.locator('summary small')}).first().locator('..');
  const choiceIndex=Number(await choiceRow.getAttribute('data-worksheet-row'));
  if(await choiceRow.locator('.candidate-row-controls button').innerText()==='Edit')await choiceRow.locator('.candidate-row-controls button').click();
  const choiceCell=choiceRow.locator('[data-candidate-copy]');await choiceCell.locator('summary').click();
  const select=choiceCell.locator('select');
  const options=await select.locator('option').evaluateAll(nodes=>nodes.filter(n=>n.value&&n.value!=='MANUAL').map(n=>({id:n.value,text:n.textContent})));
  assert(options.length>1);assert(options.some(p=>p.text.includes(' — ')));
  const beforeChoice=await page.evaluate(()=>JSON.stringify(window.workbenchTest.state.selected.record));
  const selectedOption=options.at(-1);await select.selectOption(selectedOption.id);
  assert.equal(await choiceCell.locator('details').getAttribute('open'),null);
  const displayed=await choiceCell.locator('[data-approved-part]').innerText();
  assert.equal(displayed,selectedOption.text.split(' — ')[0]);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.workbenchTest.state.selected.record)),beforeChoice,'display preference leaves Candidate data unchanged');
  await choiceCell.click({position:{x:4,y:4}});await page.keyboard.press('Control+c');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),displayed);
  await page.evaluate(()=>{window.testSaveRequests=[];window.fetch=async(url,options)=>{if(url.endsWith('/bom-completion-readiness'))return {ok:true,json:async()=>({ready:false})};const body=JSON.parse(options.body);window.testSaveRequests.push(body);const t=window.workbenchTest,r=t.state.selected.record.technicalReview.candidateBom.rows[body.rowIndex];r.reviewState.reviewed=true;r.manufacturerIdentity.history.push(...r.manufacturerIdentity.proposals.filter(p=>!(r.manufacturerIdentity.history||[]).some(h=>h.proposalId===p.id&&h.decision==='REJECTED')).map(p=>({proposalId:p.id,decision:'CONFIRMED'})));return {ok:true,json:async()=>structuredClone(t.state.selected)}};});
  await choiceRow.locator('.candidate-row-controls button').click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  const choiceRequest=await page.evaluate(()=>window.testSaveRequests[0]);assert.equal(choiceRequest.worksheetAcceptance.proposalId,null,'existing all-identity acceptance semantics unchanged');
  const reopen=await page.evaluate(()=>structuredClone(window.workbenchTest.state.selected.record));
  await page.reload();await page.addScriptTag({content:source});
  await page.evaluate(record=>{const t=window.workbenchTest;t.setMount(document.querySelector('[data-workspace-mount]'));t.bindInteractions();t.state.selected={record};t.state.guided=true;t.state.step='candidate';t.renderDetail();},reopen);
  assert.equal(await page.locator('tr[data-worksheet-row="'+choiceIndex+'"] [data-approved-part]').innerText(),displayed);
  console.log('PASS',id,'all choices reachable, selected P/N collapse/copy/reload, browser-only preference, unchanged acceptance payload');
  // Save/leave/resume runs against an isolated in-memory server; real store coverage is in --progress.
  await page.evaluate(()=>{
    const t=window.workbenchTest;t.state.rowReviewUi={};t.state.candidateIndex=null;t.state.candidateDraft=null;
    window.progressSaved=structuredClone(t.state.selected);window.progressRequests=[];
    window.fetch=async(url,options)=>{if(url.endsWith('/bom-completion-readiness'))return {ok:true,json:async()=>({ready:false})};
      if(!options?.method)return {ok:true,json:async()=>structuredClone(window.progressSaved)};
      const body=JSON.parse(options.body);window.progressRequests.push(body);
      if(window.failProgress)return {ok:false,json:async()=>({message:'Save failed for qualification'})};
      const copy=structuredClone(window.progressSaved),bom=copy.record.technicalReview.candidateBom;
      for(const edit of body.progressRows){const row=bom.rows[edit.rowIndex];row.values={...row.values,...edit.values};row.reviewState.reviewed=false;row.workingState={valuesChanged:true,assemblyPartNumber:edit.assemblyPartNumber,manualPartNumber:edit.manualPartNumber,manufacturerName:edit.manufacturerName};}
      bom.progress={savedBy:'SIM Administrator',savedAtUtc:new Date().toISOString()};window.progressSaved=copy;
      return {ok:true,json:async()=>structuredClone(copy)};
    };t.renderDetail();
  });
  assert.equal(await page.evaluate(()=>window.workbenchTest.candidateProgressRows().length),0);
  await page.getByRole('button',{name:'Reset Widths',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.workbenchTest.candidateProgressRows().length),0);
  if(await first.locator('.candidate-row-controls button').innerText()==='Edit')await first.locator('.candidate-row-controls button').click();
  await desc.dblclick();await desc.locator('input').fill('Saved working description');await page.keyboard.press('Enter');
  assert.match(await page.locator('[data-candidate-progress-status]').innerText(),/Unsaved/);
  const back=()=>page.locator('[data-technical-review-action=governing-back]').first();
  await back().click();
  for(const name of ['Save & Leave','Leave Without Saving','Cancel'])assert(await page.getByRole('button',{name,exact:true}).isVisible());
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.match(await desc.innerText(),/Saved working description/);
  await page.evaluate(()=>window.failProgress=true);
  await page.getByRole('button',{name:'Save Progress',exact:true}).click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert.match(await desc.innerText(),/Saved working description/);assert.match(await page.locator('[data-candidate-progress-status]').innerText(),/Unsaved/);
  await page.evaluate(()=>window.failProgress=false);
  await back().click();await page.getByRole('button',{name:'Save & Leave',exact:true}).click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert.equal(await page.evaluate(()=>window.workbenchTest.state.step),'governing');
  await page.evaluate(()=>window.workbenchTest.reopenCandidate());
  assert.match(await desc.innerText(),/Saved working description/);assert.equal(await desc.getAttribute('data-description-locked'),'false');
  assert.match(await page.locator('[data-candidate-progress-status]').innerText(),/Saved by SIM Administrator/);
  assert.equal(await page.evaluate(()=>window.workbenchTest.candidateProgressRows().length),0);
  await desc.dblclick();await desc.locator('input').fill('Discard this edit');await page.keyboard.press('Enter');
  await back().click();await page.getByRole('button',{name:'Leave Without Saving',exact:true}).click();
  await page.evaluate(()=>window.workbenchTest.reopenCandidate());assert.match(await desc.innerText(),/Saved working description/);
  const progress=await page.evaluate(()=>window.progressRequests.at(-1));assert.equal(progress.rowIndex,-1);assert.equal(progress.progressRows[0].values.description,'Saved working description');assert(!progress.worksheetAcceptance);
  await page.screenshot({path:path.join(out,id+'-progress.png')});
  console.log('PASS',id,'Save Progress, failed save retains edits, dirty state, all three exit choices, latest saved reopen without rebuild');
  const refdes=first.locator('[data-candidate-designators]'),complete=page.locator('[data-technical-review-action=complete-bom]');
  assert(await complete.isDisabled());
  assert.equal(await complete.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(71, 85, 105)');
  await refdes.dblclick();await refdes.locator('input').fill('Cancel refdes');await page.keyboard.press('Escape');assert.doesNotMatch(await refdes.innerText(),/Cancel refdes/);
  await refdes.focus();await page.keyboard.press('F2');await refdes.locator('input').fill('R101, R102');
  await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'R101, R102');
  await refdes.locator('input').fill('');await page.keyboard.press('Control+v');assert.equal(await refdes.locator('input').inputValue(),'R101, R102');
  await page.keyboard.press('Enter');assert.match(await refdes.innerText(),/R101, R102/);
  assert.equal(await page.locator('.candidate-detail-row').count(),0);
  await page.getByRole('button',{name:'Save Progress',exact:true}).click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  await back().click();await page.evaluate(()=>window.workbenchTest.reopenCandidate());assert.equal(await refdes.innerText(),'R101, R102');assert.equal(await refdes.getAttribute('data-description-locked'),'false');
  await page.evaluate(()=>{
    window.fetch=async (url,options)=>{
      const t=window.workbenchTest,body=JSON.parse(options.body);
      if(url.endsWith('/bom-completion-readiness')){window.readinessCalls=(window.readinessCalls||0)+1;return {ok:true,json:async()=>({ready:!window.blockReadiness,message:'Server completion gate'})};}
      const row=t.state.selected.record.technicalReview.candidateBom.rows[body.rowIndex];row.values={...row.values,...body.values};row.reviewState.reviewed=true;row.reviewState.token+='-accepted';row.workingState=null;
      return {ok:true,json:async()=>structuredClone(t.state.selected)};
    };
  });
  await first.locator('.candidate-row-controls button').click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert.equal(await refdes.innerText(),'R101, R102');assert.equal(await refdes.getAttribute('data-description-locked'),'true');
  await refdes.dblclick();assert.equal(await refdes.locator('input').count(),0);
  await first.locator('.candidate-row-controls button').click();await refdes.focus();await page.keyboard.press('F2');assert.equal(await refdes.locator('input').count(),1);await page.keyboard.press('Escape');
  // The final unresolved row exercises the live transition; server can still veto a fully reviewed grid.
  await page.evaluate(()=>{const t=window.workbenchTest;t.state.rowReviewUi={};t.state.candidateDraft=null;t.state.inlineDescriptionDirty=false;t.state.completionReadiness=null;
    const rows=t.state.selected.record.technicalReview.candidateBom.rows;rows.forEach((r,i)=>{r.reviewState.reviewed=i!==0;r.workingState=null});t.renderDetail();});
  assert(await complete.isDisabled());
  await first.locator('.candidate-row-controls button').click();await page.waitForFunction(()=>!document.querySelector('[data-technical-review-action=complete-bom]').disabled);
  assert.equal(await complete.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(37, 99, 235)');
  assert((await page.evaluate(()=>window.readinessCalls))>0);
  await first.locator('.candidate-row-controls button').click();assert(await complete.isDisabled());
  await page.evaluate(()=>{window.blockReadiness=true;window.workbenchTest.state.completionReadiness=null;});
  await first.locator('.candidate-row-controls button').click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);assert(await complete.isDisabled());
  await page.screenshot({path:path.join(out,id+'-refdes-readiness.png')});
  console.log('PASS',id,'Ref Des double-click/F2/Enter/Escape/native clipboard, save/reopen, Accept/Edit locking; final-row readiness, immediate Edit disable, server veto');
  // Manager qualification starts again from the saved scenario in browser memory only.
  const managedIndex=record.technicalReview.candidateBom.rows.findIndex(r=>r.values.lineNumber===(id==='RFQI-SIM-0041'?'53':'5'));
  await page.evaluate(record=>{
   const t=window.workbenchTest;t.state.selected={record:structuredClone(record)};
   const r=t.state.selected.record;r.status='TECHNICAL_REVIEW_IN_PROGRESS';r.technicalReview.workflow=null;r.technicalReview.bomAcceptances=[];
   t.state.step='candidate';t.state.candidateIndex=null;t.state.candidateDraft=null;t.state.candidateInlineRow=null;t.state.inlineDescriptionDirty=false;t.state.rowReviewUi={};t.state.completionReadiness=null;
   window.managerSaved=structuredClone(t.state.selected);window.managerRequests=[];
   window.fetch=async(url,options)=>{
    if(url.endsWith('/bom-completion-readiness'))return {ok:true,json:async()=>({ready:false})};
    if(!options?.method)return {ok:true,json:async()=>structuredClone(window.managerSaved)};
    const body=JSON.parse(options.body);window.managerRequests.push(body);
    if(window.failManager)return {ok:false,json:async()=>({message:'Manager save failed for qualification'})};
    const copy=structuredClone(window.managerSaved),row=copy.record.technicalReview.candidateBom.rows[body.rowIndex];
    if(body.approvedPartChange){
     const change=body.approvedPartChange,m=row.manufacturerIdentity;
     let part=m.proposals.find(p=>p.id===change.id);
     if(part){part.partNumber=change.partNumber;part.manufacturerName=change.manufacturerName;}
     else{part={...structuredClone(m.proposals[0]),id:'added-manager',partNumber:change.partNumber,manufacturerName:change.manufacturerName};m.proposals.push(part);}
     m.history=m.history.filter(h=>h.proposalId!==part.id);m.history.push({proposalId:part.id,decision:'CONFIRMED'});row.reviewState.reviewed=false;row.workingState={valuesChanged:false};
    }else if(body.worksheetAcceptance){row.reviewState.reviewed=true;row.workingState=null;}
    row.reviewState.token+='-saved';window.managerSaved=copy;return {ok:true,json:async()=>structuredClone(copy)};
   };t.renderDetail();
  },record);
  const managed=page.locator('tr[data-worksheet-row="'+managedIndex+'"]');
  await managed.locator('.candidate-options > summary').click();
  await managed.getByRole('button',{name:'Approved P/Ns',exact:true}).click();
  const manager=page.locator('.approved-part-manager'),initialList=await manager.locator('tbody tr').count();
  assert(initialList>=1);if(id==='RFQI-SIM-0041'){assert.equal(initialList,1);assert.match(await manager.innerText(),/CF14JT5K[I1]0|CF14JT5KIO/);}
  const unchanged=await manager.locator('tbody tr').allTextContents();
  await manager.getByRole('button',{name:'Edit',exact:true}).first().click();
  const corrected=(await manager.getByRole('textbox',{name:'Approved P/N',exact:true}).inputValue())+'-REVIEW';
  const manufacturer=await manager.getByRole('textbox',{name:'Approved P/N manufacturer',exact:true}).inputValue();
  if(id==='RFQI-SIM-0041')assert.equal(manufacturer,'STACKPOLE');
  await manager.getByRole('textbox',{name:'Approved P/N',exact:true}).fill(corrected);
  assert.match(await page.locator('[data-candidate-progress-status]').innerText(),/Unsaved/);
  assert.equal(await page.evaluate(i=>window.workbenchTest.candidateProgressRows().find(r=>r.rowIndex===i).approvedPartChange.partNumber,managedIndex),corrected,'Save Progress includes pending manager edits');
  await page.evaluate(()=>window.failManager=true);await manager.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert.equal(await manager.getByRole('textbox',{name:'Approved P/N',exact:true}).inputValue(),corrected);
  await page.evaluate(()=>window.failManager=false);await manager.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert.equal(await managed.locator('[data-approved-part]').innerText(),corrected);assert.match(await managed.locator('.candidate-row-controls').innerText(),/Needs Review/);
  assert.equal(await manager.locator('tbody tr').count(),initialList);assert.deepEqual((await manager.locator('tbody tr').allTextContents()).slice(1),unchanged.slice(1));
  await managed.locator('.candidate-row-controls button').click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert.equal(await managed.locator('.candidate-row-controls button').innerText(),'Edit');
  await managed.locator('.candidate-options > summary').click();await managed.getByRole('button',{name:'Approved P/Ns',exact:true}).click();
  await manager.getByRole('button',{name:'Add Approved P/N',exact:true}).click();
  await manager.getByRole('textbox',{name:'Approved P/N',exact:true}).fill('ADDED-APPROVED-PN');
  await manager.getByRole('textbox',{name:'Approved P/N manufacturer',exact:true}).fill('Added manufacturer');
  await manager.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!window.workbenchTest.state.saving);
  assert.equal(await managed.locator('[data-approved-part]').innerText(),corrected);assert.equal(await managed.locator('summary small').first().innerText(),'+'+initialList);
  assert.match(await managed.locator('.candidate-row-controls').innerText(),/Needs Review/);
  const managerRequest=await page.evaluate(()=>window.managerRequests.find(r=>r.approvedPartChange)?.approvedPartChange);assert.equal(managerRequest.manufacturerName,manufacturer);
  await page.evaluate(()=>window.workbenchTest.reopenCandidate());
  assert.equal(await managed.locator('[data-approved-part]').innerText(),corrected);
  await managed.locator('.candidate-options > summary').click();await managed.getByRole('button',{name:'Approved P/Ns',exact:true}).click();
  assert.equal(await manager.locator('tbody tr').count(),initialList+1);
  await manager.scrollIntoViewIfNeeded();assert((await manager.boundingBox()).x>=(await page.locator('.candidate-table-scroll').boundingBox()).x,'manager stays visible when grid is horizontally scrolled');await page.screenshot({path:path.join(out,id+'-approved-pn-manager.png')});
  await managed.locator('.candidate-options > summary').click();await managed.locator('.candidate-advanced summary').click();await managed.getByRole('button',{name:'Technical Alternates',exact:true}).click();
  assert.equal(await page.locator('.candidate-alternates').count(),1);assert.equal(await page.locator('.approved-part-manager').count(),0);
  console.log('PASS',id,'Approved P/N manager edit/save/Accept/add/reopen, manufacturer retained, failed save retains draft, Save Progress integration, +N and separate technical alternates');
  const openPanel=async name=>{await managed.locator('.candidate-options > summary').click();await managed.getByRole('button',{name,exact:true}).click();};
  await openPanel('BOM Fields');
  const inspector=page.locator('.candidate-row-inspector');
  assert.deepEqual(await inspector.locator('input').evaluateAll(nodes=>nodes.map(n=>n.id)),['candidate-lineNumber','candidate-partNumber','candidate-quantity']);
  assert.equal(await inspector.locator('select').count(),0);
  await inspector.locator('#candidate-quantity').fill('123');
  await openPanel('Source / Evidence');
  assert.equal(await inspector.locator('.row-technical-files').count(),0);
  assert.equal(await inspector.locator('.candidate-technical-details').getAttribute('open'),null);
  assert.equal(await inspector.getByRole('link',{name:/View source/}).count()>0,true);
  await openPanel('Technical Files');
  await inspector.getByRole('button',{name:'Add File',exact:true}).click();
  assert.equal(await inspector.locator('input[type=file]').count(),1);
  await inspector.getByRole('button',{name:'Cancel',exact:true}).click();
  await openPanel('BOM Fields');assert.equal(await inspector.locator('#candidate-quantity').inputValue(),'123');
  await inspector.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('.candidate-row-inspector').count(),0);
  await openPanel('BOM Fields');assert.equal(await inspector.locator('#candidate-quantity').inputValue(),'123');
  const fields=await inspector.locator('.candidate-edit-grid input').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width})));assert(fields.every(f=>Math.abs(f.y-fields[0].y)<2));assert(fields[1].width>200);
  await page.screenshot({path:path.join(out,id+'-options-pass1.png')});
  await openPanel('Approved P/Ns');await inspector.getByRole('button',{name:'Add Approved P/N',exact:true}).click();
  await inspector.getByRole('textbox',{name:'Approved P/N',exact:true}).fill('UNSAVED-PANEL-DRAFT');
  await openPanel('Source / Evidence');await openPanel('Approved P/Ns');
  assert.equal(await inspector.getByRole('textbox',{name:'Approved P/N',exact:true}).inputValue(),'UNSAVED-PANEL-DRAFT');
  await inspector.getByRole('button',{name:'Cancel',exact:true}).click();
  await managed.locator('.candidate-options > summary').click();assert.equal(await managed.getByRole('button',{name:'Technical Alternates',exact:true}).isVisible(),false);
  await managed.locator('.candidate-advanced summary').click();await managed.getByRole('button',{name:'Technical Alternates',exact:true}).click();
  await inspector.locator('#alternateChoice').selectOption('ADD');await inspector.locator('#compactAlternateNumber').fill('UNSAVED-ALTERNATE');
  await openPanel('Source / Evidence');await managed.locator('.candidate-options > summary').click();await managed.locator('.candidate-advanced summary').click();await managed.getByRole('button',{name:'Technical Alternates',exact:true}).click();
  assert.equal(await inspector.locator('#compactAlternateNumber').inputValue(),'UNSAVED-ALTERNATE');
  assert.equal(await page.locator('.candidate-row-inspector').count(),1);
  console.log('PASS',id,'Pass 1 menu, three BOM fields, evidence disclosure, file picker, Close/reopen and BOM/approved/alternate draft preservation');






 }
 assert.deepEqual(errors,[]);assert(fs.readFileSync(dataPath).equals(before),'saved SIM bytes unchanged');
 fs.writeFileSync(path.join(out,'inline-requests.json'),JSON.stringify(inlineRequests));
 console.log('Screenshots and backend replay requests:',out);
} finally {await browser?.close();server.close();}

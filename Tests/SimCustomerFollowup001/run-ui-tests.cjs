const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=path.resolve(process.argv[2]),fixture=path.resolve(process.argv[3]);
const source=fs.readFileSync(path.join(repo,'SRC/workspaces/purchasing/purchasing-buyer-workspace.js'),'utf8');
const css=fs.readFileSync(path.join(repo,'SRC/workspaces/purchasing/purchasing-buyer-workspace.css'),'utf8');
const base='https://purchasing-fixture.test';
(async()=>{const browser=await chromium.launch({channel:'msedge'}),results=[];try{for(const width of [1440,1024,390]){
 const model=JSON.parse(fs.readFileSync(path.join(fixture,'buyer-before.json')));
 const target=model.demands.find(d=>d.customerSupply?.customerPartNumber==='E8X001'&&d.workOrderNumber==='0999997');assert(target);
 const second=structuredClone(target);Object.assign(second,{demandId:'fixture-other',customer:'Other Customer',customerNumber:'Other',customerPoNumber:'PO-OTHER',salesOrderNumber:'SO-OTHER',workOrderNumber:'WO-OTHER',shortQuantity:7});second.customerSupply.customerPartNumber='CUSTOMER-OTHER';model.demands.push(second);
 const history=[],posts=[],requests=[],original=JSON.stringify({plans:model.plans,purchases:model.purchases});
 const c=await browser.newContext({viewport:{width,height:1000},hasTouch:width<1100});
 await c.addInitScript(()=>{window.copied=[];window.clipboardFails=false;Object.defineProperty(navigator,'clipboard',{value:{write:async items=>{if(window.clipboardFails)throw Error("Denied");window.copied.push(await(await items[0].getType("text/plain")).text());},writeText:async text=>{if(window.clipboardFails)throw Error('Denied');window.copied.push(text);}},configurable:true});});
 await c.route('**/*',async r=>{const q=r.request(),url=new URL(q.url());requests.push(q.method()+' '+url.pathname);
  if(url.origin!==base)throw Error('Unexpected external access '+url.origin);
  if(url.pathname==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;background:#0b1723;font-family:Arial}*{box-sizing:border-box}.production-lifecycle-tabs{display:grid}.sr-only{position:absolute;clip:rect(0,0,0,0)}</style></head><body><main id="buyer"></main></body></html>'});
  if(q.method()==='GET'&&url.pathname==='/api/sim/purchasing')return r.fulfill({json:model});
  if(q.method()==='GET'&&url.pathname==='/api/sim/purchasing/history')return r.fulfill({json:history});
  if(q.method()==='POST'&&url.pathname.endsWith('/customer-contact')){
   const body=q.postDataJSON();posts.push(body);const d=model.demands.find(d=>url.pathname.includes(d.demandId));
   if(body.expectedVersion!==d.version)return r.fulfill({status:409,json:{message:'Another buyer changed this record.'}});
   assert.equal(body.expectedSubmissionId,d.currentSubmissionId||d.submissionId);assert.equal(body.expectedSourceFingerprint,d.sourceFingerprint);assert.equal(body.expectedShortQuantity,d.remainingShortQuantity??d.shortQuantity);
   d.version++;d.customerContact={submissionId:d.currentSubmissionId||d.submissionId,sourceFingerprint:d.sourceFingerprint,shortQuantity:d.remainingShortQuantity??d.shortQuantity,actor:'Fixture Buyer',actorId:'fixture',atUtc:'2026-10-18T02:00:00Z',expectedDate:body.expectedDate};history.push({eventType:'CUSTOMER_CONTACTED',entityId:d.demandId,actor:'Fixture Buyer',atUtc:d.customerContact.atUtc,priorState:d.state,newState:d.state,expectedVersion:body.expectedVersion,resultingVersion:d.version});return r.fulfill({json:d});
  }
  throw Error('Unexpected request '+q.method()+' '+url.pathname);
 });
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 async function load(){await p.goto(base);await p.addStyleTag({content:css});await p.addScriptTag({content:source});await p.evaluate(()=>SimPurchasingWorkspace.render(document.getElementById('buyer')));}
 await load();
 await p.locator(`[data-buyer-action="copy-email"][data-id="${target.demandId}"]`).click();await p.waitForFunction(()=>copied.length===1);
 const text=await p.evaluate(()=>copied[0]);for(const expected of ['Customer PO: SIM-PO-0045-20261017-C72EE3','Assembly: B11165-32','\tE8X001\t','\t50\tEA','\tUOM',`${target.customerSupply.findNumber}\t`,target.description])assert(text.includes(expected),expected);assert(!text.includes('B82801C565A100'));assert.equal(posts.length,0);
 await p.locator(`[data-copy-id="${target.demandId}"]`).check();await p.locator('[data-copy-id="fixture-other"]').check();await p.locator('[data-buyer-action="copy-selected"]').click();await p.waitForFunction(()=>copied.length===2);const multi=await p.evaluate(()=>copied[1]);assert(multi.includes('\r\n\r\nCustomer: Other Customer; Customer PO: PO-OTHER'));assert(multi.includes('\t7\tEA'));
 // Current server quantities win over the already-rendered row during copy.
 target.remainingShortQuantity=49;await p.locator(`[data-buyer-action="copy-email"][data-id="${target.demandId}"]`).click();await p.waitForFunction(()=>copied.length===3);assert((await p.evaluate(()=>copied[2])).includes('\t49\tEA'));target.remainingShortQuantity=null;
 await p.evaluate(()=>window.clipboardFails=true);await p.locator('[data-buyer-action="copy-selected"]').click();await p.locator('#buyerCopyDialog[open]').waitFor();assert((await p.locator('#buyerCopyDialog textarea').inputValue()).includes('CUSTOMER-OTHER'));await p.screenshot({path:path.join(__dirname,`fallback-${width}.png`),fullPage:true});await p.locator('[data-buyer-action="copy-close"]').click();assert.equal(posts.length,0);
 await p.locator(`[data-buyer-action="customer-emailed"][data-id="${target.demandId}"]`).click();await p.locator('#buyerContactForm button').filter({hasText:'Record Another Email'}).waitFor();assert.equal(posts.length,1);assert.equal(posts[0].expectedDate,'');assert.equal(await p.locator('[data-buyer-stage="purchased"]').getAttribute('aria-pressed'),'true');assert.equal(await p.locator('[data-customer-tracking]').count(),1);assert.equal(target.state,'INCOMING');
 const projection=await p.evaluate(()=>{const m=SimPurchasingWorkspace.getModel(),v=SimPurchasingWorkspace.buildViewModel(m);return {counts:v.counts,shortages:v.shortages.map(x=>x.demandId),tracked:v.purchased.filter(x=>x.customerFollowup).map(x=>x.demandId)};});
 assert(!projection.shortages.includes(target.demandId));assert(projection.shortages.includes(second.demandId));assert.deepEqual(projection.tracked,[target.demandId]);assert.equal(projection.counts.purchased,model.purchases.length+1);
 const contract=await p.evaluate(id=>{const w=SimPurchasingWorkspace,m=w.getModel(),d=m.demands.find(x=>x.demandId===id);const variants=[{sourceCurrent:false},{remainingShortQuantity:49},{currentSubmissionId:'new-submission'},{sourceFingerprint:'new-source'},{customerContact:null}];const returned=variants.map(v=>{const copy=structuredClone(m);Object.assign(copy.demands.find(x=>x.demandId===id),v);const view=w.buildViewModel(copy);return view.shortages.some(x=>x.demandId===id)&&!view.purchased.some(x=>x.demandId===id);});const resolved=structuredClone(m);Object.assign(resolved.demands.find(x=>x.demandId===id),{state:'RESOLVED',remainingShortQuantity:0});const v=w.buildViewModel(resolved);return {returned,resolved:!v.shortages.some(x=>x.demandId===id)&&!v.purchased.some(x=>x.demandId===id),emailedSearch:w.buildViewModel(m,'Emailed').purchased.some(x=>x.demandId===id),actorSearch:w.buildViewModel(m,'Fixture Buyer').purchased.some(x=>x.demandId===id),purchaseStatuses:['Ordered / Awaiting Receipt','Partially Received','Received / Complete'].map((expected,i)=>w.purchaseStatus({receivedQuantity:i?5:0,openQuantity:i===2?0:5})===expected)};},target.demandId);
 assert(contract.returned.every(Boolean));assert(contract.resolved);assert(contract.emailedSearch);assert(contract.actorSearch);assert(contract.purchaseStatuses.every(Boolean));
 const purchaseRow=p.locator('[aria-label="Purchase order tracking"]');assert((await purchaseRow.innerText()).includes(model.purchases[0].poNumber));assert(!(await p.locator('[aria-label="Customer-supplied tracking"] thead').innerText()).includes('Unit Cost'));
 await p.screenshot({path:path.join(__dirname,'tracking-'+width+'.png'),fullPage:true});
 await purchaseRow.locator('[data-buyer-action="purchase"]').first().click();assert((await p.locator('#buyerDetails').innerText()).includes(model.purchases[0].poNumber));
 await p.locator(`[data-customer-tracking="${target.demandId}"] [data-buyer-action="demand"]`).click();


 await p.locator('#buyerContactForm input').fill('2026-10-23');await p.locator('#buyerContactForm button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#buyerDetails').textContent.includes('Expected 10/23/2026'));assert.equal(posts.length,2);
 await load();await p.locator('[data-buyer-stage="purchased"]').click();await p.locator(`[data-buyer-action="demand"][data-id="${target.demandId}"]`).click();assert.equal(await p.locator('#buyerContactForm input').inputValue(),'2026-10-23');assert((await p.locator('#buyerDetails').innerText()).includes('Fixture Buyer'));
 await p.locator('#buyerContactForm input').fill('2026-10-24');target.version++;await p.locator('#buyerContactForm button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('.buyer-status').textContent.includes('Another buyer'));assert.equal(await p.locator('#buyerContactForm input').inputValue(),'2026-10-24');assert.equal(target.customerContact.expectedDate,'2026-10-23');
 await p.screenshot({path:path.join(__dirname,`buyer-${width}.png`),fullPage:true});
 assert.equal(JSON.stringify({plans:model.plans,purchases:model.purchases}),original);assert.equal(errors.length,0,errors.join('\n'));
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page-level horizontal overflow');
 model.canManage=false;await load();await p.locator('[data-buyer-stage="purchased"]').click();await p.locator(`[data-buyer-action="demand"][data-id="${target.demandId}"]`).click();assert(await p.locator('#buyerContactForm button').isDisabled());
 model.customerFollowupSupported=false;await load();assert.equal(await p.locator('[data-buyer-action="copy-email"]').count(),0);assert.equal(await p.locator('[data-copy-id]').count(),0);
 results.push({width,directAcknowledgmentMoves:true,changedShortagesReturn:true,countsAndSearch:true,purchaseHistoryPreserved:true,singleCopy:true,exactCustomerIdentity:true,multiCustomerGroups:true,freshQuantity:true,clipboardFallback:true,copyDoesNotContact:true,contactReloadAndOptionalDate:true,staleConflictPreservesInput:true,readOnlyGuard:true,oldBackendHidden:true,noExternalRequests:true,realMutations:0,pageErrors:errors});await c.close();console.log('PASS UI',width);
}fs.writeFileSync(path.join(__dirname,'ui-results.json'),JSON.stringify(results,null,2));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

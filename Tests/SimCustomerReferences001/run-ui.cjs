const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process');
const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const work=path.resolve(process.argv[2]);
const root=path.join(work,'fixture-ui'),base='http://127.0.0.1:5194';
const host=spawn('C:/Program Files/dotnet/dotnet.exe',[path.join(work,'test-build/DleOs.SimHost.dll')],{cwd:root,env:{...process.env,DLE_OS_SIM_PORT:'5194'},windowsHide:true});
let log='';host.stdout.on('data',x=>log+=x);host.stderr.on('data',x=>log+=x);
let browser;
(async()=>{
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/sim/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 const all=await (await fetch(base+'/api/platform/live/v1/customer-directory/search?pageSize=50')).json();
 assert.equal(all.totalItems,37);assert.equal(all.referenceCount,35);
 assert.equal(all.items.filter(x=>x.synthetic).length,2);
 assert.equal((await fetch(base+'/api/platform/live/v1/customer-directory/search?pageSize=51')).status,400);
 const alias=await (await fetch(base+'/api/platform/live/v1/customer-directory/search?q=Shared%20test%20alias&pageSize=50')).json();assert.equal(alias.totalItems,35);
 browser=await chromium.launch({channel:'msedge',headless:true});
 let results=[];
 for(const [width,height] of [[1440,1000],[768,1024],[1024,768]]){
  const ctx=await browser.newContext({viewport:{width,height},hasTouch:width<1200});
  const page=await ctx.newPage();
  await page.route(base+'/test-reference-ui',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/SRC/modules/rfq-workspace/rfq-workspace.css"><div id="test"></div><script>
window.DleOsSession={user:{displayName:'Fixture Operator'}};
window.DleApiClient={searchCanonicalCustomers:async(q,o)=>{const r=await fetch('/api/platform/live/v1/customer-directory/search?'+new URLSearchParams({q,...o}));if(!r.ok)throw Error('search');return r.json();}};
</script><script src="/SRC/modules/rfq-workspace/intake-wizard.js"></script><script>DleIntakeWizard.mount(document.getElementById('test'));</script>`}));
  await page.goto(base+'/test-reference-ui');
  await page.locator('[data-intake-value="NEW_QUOTE_REQUEST"]').click();
  assert.equal(await page.locator('[data-intake-customer]').count(),0);
  await page.getByRole('button',{name:'Open customer list',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.locator('[data-directory-customer]').first().waitFor();
  assert.equal(await dialog.locator('[data-directory-customer]').count(),25);
  assert.doesNotMatch(await dialog.innerText(),/Choose|Captured|Invoice History|SIM fixture/);
  await dialog.getByRole('button',{name:'Next',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-directory-count]').textContent.includes('Page 2'));
  await dialog.getByRole('button',{name:'Previous',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-directory-count]').textContent.includes('Page 1'));
  await page.screenshot({path:path.join(work,`directory-${width}.png`),fullPage:true});
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-open-customers')),true);
  await page.getByRole('button',{name:'Open customer list',exact:true}).click();
  await dialog.locator('[data-directory-search]').fill('000030');
  await page.waitForFunction(()=>document.querySelectorAll('[data-directory-customer]').length===1);
  await dialog.locator('[data-directory-search]').press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('[data-intake-form="assembly-count"]').waitFor();
  await page.locator('[data-intake-edit="1"]').click();
  await page.getByRole('button',{name:'Open customer list',exact:true}).click();
  await dialog.locator('[data-directory-search]').fill('000030');
  await page.waitForFunction(()=>document.querySelectorAll('[data-directory-customer]').length===1);
  assert.equal(await dialog.locator('[data-directory-customer]').getAttribute('aria-pressed'),'true');
  await dialog.getByRole('button',{name:'Close customer list'}).click();
  await page.locator('[data-intake-customer-search]').fill('000001');
  await page.waitForFunction(()=>document.querySelectorAll('[data-intake-customer]').length===1);
  assert.equal((await page.locator('[data-intake-customer]').innerText()).replace(/\s+/g,' ').trim(),'000001 Fixture Customer 01');
  await page.screenshot({path:path.join(work,`picker-${width}.png`),fullPage:true});
  await page.locator('[data-intake-customer-search]').press('ArrowDown');
  await page.keyboard.press('Enter');
  for(const [field,value] of [['assembly-count','1'],['assembly-number','TEST-ONLY'],['revision','A'],['quantity','2']]){
   const form=page.locator(`[data-intake-form="${field}"]`);await form.locator('input').fill(value);await form.locator('button').click();
  }
  await page.locator('[data-intake-value="CABLE_AND_HARNESS_ASSEMBLY"]').click();
  await page.locator('[data-intake-value="LABOR_ONLY"]').click();
  await page.locator('[data-intake-value="no"]').click();
  await page.locator('[data-intake-value="PRICE_AND_LEAD_TIME"]').click();
  await page.locator('[data-intake-action="submit"]').click();
  await page.waitForFunction(()=>!!DleIntakeWizard.getCommittedIntake());
  const saved=await page.evaluate(()=>DleIntakeWizard.getCommittedIntake());
  const rec=saved.record||saved;
  const reopened=await (await fetch(base+'/api/sim/rfq-intakes/'+rec.intakeId)).json();
  const customer=(reopened.record||reopened).customer;
  assert.equal(customer.customerId,'dle-customer:000001');assert.equal(customer.customerNumber,'000001');
  assert.equal(customer.sourcePackageId,'fixture-ui');assert.match(customer.referenceVersion,/^[A-F0-9]{64}$/);
  results.push({width,height,paging:true,modalSearch:true,dismiss:true,keyboardSelection:true,selectedState:true,numberNameOnly:true,saveReopen:true,provenance:true});
  await ctx.close();
 }
 fs.writeFileSync(path.join(work,'ui-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({api:true,results}));
})().catch(e=>{console.error(e);console.error(log.slice(-2500));process.exitCode=1;}).finally(async()=>{await browser?.close();host.kill();});

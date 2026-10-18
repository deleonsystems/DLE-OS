const fs=require('fs'),path=require('path'),assert=require('assert/strict');const {chromium}=require(process.env.NODE_REPL_NODE_MODULE_DIRS+'/playwright');
const repo=process.env.DLE_TEST_REPO||path.resolve(__dirname,'../..');const source=fs.readFileSync(path.join(repo,'SRC/workspaces/rfqs/labor-traveler-print.js'),'utf8');
const cases=[
['2026-10-18T03:40:38.8220902+00:00','10-17-26'],
['2026-10-18T06:59:59Z','10-17-26'],['2026-10-18T07:00:00Z','10-18-26'],
['2026-01-18T07:59:59Z','01-17-26'],['2026-01-18T08:00:00Z','01-18-26'],
['2026-03-08T09:59:59Z','03-08-26'],['2026-03-08T10:00:00Z','03-08-26'],
['2026-11-01T08:59:59Z','11-01-26'],['2026-11-01T09:00:00Z','11-01-26'],
['2026-10-17T20:40:38-07:00','10-17-26'],['2026-10-18','10-18-26'],['2024-02-29','02-29-24'],['2026-02-30','2026-02-30'],[null,''],['',''],['invalid','invalid']];
(async()=>{const b=await chromium.launch({channel:'msedge'});try{for(const timezoneId of ['America/Los_Angeles','UTC','Asia/Tokyo']){const c=await b.newContext({timezoneId});const p=await c.newPage();await p.evaluate(()=>{window.DleOsRuntimeConfig={environment:'SIMULATION'};});await p.addScriptTag({content:source});for(const [input,expected] of cases)assert.equal(await p.evaluate(v=>DleLaborTravelerPrint.formatDate(v),input),expected,timezoneId+' '+input);await p.evaluate(()=>{window.DleOperatorHeader={factoryTimeZone:'America/Los_Angeles'};});assert.equal(await p.evaluate(()=>DleLaborTravelerPrint.formatDate('2026-10-18T03:40:38Z')),'10-17-26');await c.close();}console.log('PASS: 51 traveler date checks across Pacific, UTC and Tokyo browsers; midnight, DST, literal dates, invalid/missing values.');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

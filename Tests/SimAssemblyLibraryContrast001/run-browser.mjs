import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const shell=read('DLE_Work_Center_v4.0.0.html');
const shellStyles=[...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.setContent('<style>'+shellStyles+'</style><style>'+read('SRC/workspaces/assembly-library/assembly-library-workspace.css')+'</style><main data-workspace-mount="assembly-library"></main>');
 await page.evaluate(()=>{window.DleOsRuntimeConfig={environment:'SIM'};window.DleOsCapabilities={can:()=>true};window.fetch=async()=>({ok:true,json:async()=>({preliminary:true,totalHeaders:1,blankDrawingCount:0,runId:'fixture',sourceSha256:'A'.repeat(64),items:[{sourceKeyRaw:'01 PART ',billNumber:' PART ',drawingNumber:'DRAW-1',drawingRevision:'V*',bomRevision:'V',bomRevisionDate:'3A213A',sourceRecordHash:'B'.repeat(64),contractVersion:'V1.2',normalizedKeyCollision:true}]})});});
 await page.addScriptTag({content:read('SRC/workspaces/assembly-library/assembly-library-workspace.js')});await page.evaluate(()=>window.DleWorkspaces['assembly-library'].render());
 await page.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
 for(const mode of ['list','assembly']) {
 if(mode==='assembly') await page.locator('.library-assembly-open').first().click();
 for(const scheme of ['dark','light']) {
  await page.emulateMedia({colorScheme:scheme});
  const results=await page.evaluate(()=>{
   const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
   const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
   const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
   const background=e=>{for(let n=e;n;n=n.parentElement){const c=rgb(getComputedStyle(n).backgroundColor);if(c.length===3||c[3]===1)return c;}throw Error('No solid backdrop');};
   const nodes=[...document.querySelectorAll('.assembly-library-view h2,.assembly-library-view h3,.assembly-library-view dt,.assembly-library-view dd,.assembly-library-view p,.assembly-library-view label,.assembly-library-view th,.assembly-library-view td,.assembly-library-view summary,.assembly-library-view button,.library-pager span,.library-key-flag,.assembly-library-view input[type=search]')];
   const result=nodes.map(e=>({text:e.textContent.slice(0,35)||'search input',ratio:contrast(rgb(getComputedStyle(e).color),background(e))}));
   const input=document.querySelector('input[type=search]');result.push({text:'placeholder',ratio:contrast(rgb(getComputedStyle(input,'::placeholder').color),background(input))});
   for(const e of document.querySelectorAll('button,input[type=search]'))if(parseFloat(getComputedStyle(e).borderTopWidth)>0)result.push({text:'control border',minimum:3,ratio:contrast(rgb(getComputedStyle(e).borderTopColor),background(e))});
   return result;
  });
  for(const r of results)assert.ok(r.ratio>=(r.minimum||4.5),scheme+' '+r.text+' '+r.ratio);
  console.log(scheme+' minimum normal text contrast '+Math.min(...results.filter(r=>!r.minimum).map(r=>r.ratio)).toFixed(2)+':1');
 }
 }
 await page.getByRole('button',{name:'Back to Assembly Library'}).click();
 await page.locator('input[type=search]').focus();assert.equal(await page.locator('input[type=search]').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.equal(await page.locator('table').evaluate(e=>getComputedStyle(e).fontSize),'13px');
 console.log('PASS actual shell styles, headings/rows/labels/details/input/placeholder/pagination, control borders, both color preferences, focus, compact font and mobile overflow.');
} finally {await browser.close();}

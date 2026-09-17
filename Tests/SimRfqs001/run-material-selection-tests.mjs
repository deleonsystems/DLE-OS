import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../SRC/workspaces/rfqs/materials-workbench.js',import.meta.url),'utf8');
const start=source.indexOf('function materialTableSelection('),end=source.indexOf('  let sourcingView=',start);
let copied,timer;const status={textContent:""};const document={activeElement:null};
const window={setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;},getComputedStyle:e=>({display:e.hidden?'none':'table-cell'}),navigator:{clipboard:{writeText:async text=>{copied=text;}}}};
const create=vm.runInNewContext('('+source.slice(start,end).trim()+')',{window,document});
function cell(text,span=1,special={}){const classes=new Set();return {textContent:text,colSpan:span,hidden:false,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},setAttribute(){},removeAttribute(){},focus(){document.activeElement=this;},querySelector:s=>special[s]||null,querySelectorAll:s=>s.startsWith('input')?(special.inputs||[]):[],cloneNode(){return {textContent:text,querySelectorAll:()=>[]};},closest(s){return s==='td'?this:null;},selected:()=>classes.has('material-cell-selected')};}
const rows=[{cells:[cell('1'),cell('PART-A'),cell('ignored',1,{inputs:[{tagName:'INPUT',value:'2.00'}]}),cell('menu',1,{'.material-vendor-trigger':{textContent:'Mouser'}})]},{cells:[cell('↳ 1.1'),cell('',2,{inputs:[{tagName:'SELECT',selectedOptions:[{textContent:'Tariff / Duty'}]},{tagName:'SELECT',selectedOptions:[{textContent:'Include in Unit Price'}]}]}),cell('Sell label',1,{'[data-charge-sell]':{textContent:'$20.00'}})]},{cells:[cell('2'),cell('PART-B'),cell('3.00'),cell('Stock')]}];
const root={querySelectorAll:()=>rows,querySelector:()=>status};const selection=create(root);
const click=(r,c,mods={})=>selection.click({target:rows[r].cells[c],preventDefault(){},...mods});
const key=(target,mods={})=>selection.key({target,key:'c',ctrlKey:true,preventDefault(){},...mods});
click(0,1);key(rows[0].cells[1]);assert.equal(copied,'PART-A');
click(0,2);key(rows[0].cells[2]);assert.equal(copied,'2.00');
click(0,1);click(2,2,{shiftKey:true});key(rows[2].cells[2]);assert.equal(copied,'PART-A\t2.00\nTariff / Duty | Include in Unit Price\t\nPART-B\t3.00');
click(0,1);click(0,3,{ctrlKey:true});key(rows[0].cells[3]);assert.equal(copied,'PART-A\t\tMouser');click(0,3,{ctrlKey:true});assert.equal(selection.text(),'PART-A');key(rows[0].cells[3]);assert.equal(copied,'PART-A','Ctrl+C still copies remaining cells after toggling focused cell off');
click(0,0);assert.equal(selection.text(),'1\tPART-A\t2.00\tMouser');click(2,0,{shiftKey:true});assert.equal(selection.text(),'1\tPART-A\t2.00\tMouser\n↳ 1.1\tTariff / Duty | Include in Unit Price\t\t$20.00\n2\tPART-B\t3.00\tStock');
click(1,0,{ctrlKey:true});assert.equal(rows[1].cells[0].selected(),false);
const input={closest:s=>s==='td'?rows[0].cells[2]:{},value:'2.00'};assert.equal(selection.click({target:input}),false);document.activeElement=input;assert.equal(key(input),false);
const button={closest:s=>s==='td'?rows[0].cells[0]:{}};assert.equal(selection.click({target:button}),false,'fee chevron and explicit copy buttons are untouched');
selection.clear();rows[0].cells[1].hidden=true;click(0,0);assert.equal(selection.text(),'1\t2.00\tMouser','hidden Sourcing columns excluded');
key(rows[0].cells[0],{key:'Escape',ctrlKey:false});assert.equal(selection.text(),'');
click(0,2);let nativeCopy=null;let prevented=false;
selection.copy({clipboardData:{setData:(type,text)=>{assert.equal(type,'text/plain');nativeCopy=text;}},preventDefault(){prevented=true;}});assert.equal(nativeCopy,'2.00');assert.equal(prevented,true);
document.activeElement=input;prevented=false;selection.copy({clipboardData:{setData(){throw new Error('Native editor copy intercepted');}},preventDefault(){prevented=true;}});assert.equal(prevented,false);
console.log('PASS: table-local single/range/toggle/row TSV selection, merged fee cells, display values, native editor/control exclusion, hidden columns and Escape.');


rows[0].cells[1].hidden=false;
const dragClasses=new Set();let capture=null,hit=null;
root.classList={add:v=>dragClasses.add(v),remove:v=>dragClasses.delete(v)};
root.setPointerCapture=id=>{capture=id;};root.hasPointerCapture=id=>capture===id;root.releasePointerCapture=()=>{capture=null;};
document.elementFromPoint=()=>hit;
const pointer=(target,extra={})=>({target,pointerId:1,button:0,preventDefault(){},...extra});
function dragRange(from,to){selection.clear();selection.down(pointer(from));assert.ok(dragClasses.has('material-grid-dragging'));hit=to;selection.move(pointer(from));selection.up(pointer(from));assert.equal(capture,null);assert.equal(dragClasses.size,0);selection.click({target:from,preventDefault(){}});}
dragRange(rows[0].cells[1],rows[0].cells[3]);assert.equal(selection.text(),'PART-A\t2.00\tMouser');
dragRange(rows[0].cells[3],rows[2].cells[3]);assert.equal(selection.text(),'Mouser\n$20.00\nStock');
dragRange(rows[0].cells[1],rows[2].cells[3]);assert.equal(selection.text(),'PART-A\t2.00\tMouser\nTariff / Duty | Include in Unit Price\t\t$20.00\nPART-B\t3.00\tStock');key(rows[2].cells[3]);assert.equal(copied,selection.text());
selection.down(pointer(input));assert.equal(capture,null);assert.equal(dragClasses.size,0,'input text drag never enters grid selection');
selection.down(pointer(button));assert.equal(capture,null,'button drag remains native');
selection.down(pointer(rows[0].cells[1]));selection.cancel(pointer(rows[0].cells[1]));assert.equal(capture,null);assert.equal(dragClasses.size,0);
console.log('PASS: horizontal, vertical and rectangular pointer drag/TSV, trailing click suppression, pointer cancellation and native control exclusion.');

selection.clear();click(0,1);key(rows[0].cells[1]);await Promise.resolve();
assert.equal(status.textContent,'Copied');timer();assert.equal(status.textContent,'');
click(0,1);click(2,3,{shiftKey:true});key(rows[2].cells[3]);await Promise.resolve();
assert.equal(status.textContent,'Copied 8 cells');timer();
const before=selection.text();selection.click({target:input});assert.equal(selection.text(),before,'control click preserves range');
document.activeElement=input;key(input);assert.equal(status.textContent,'','native copy has no grid feedback');
selection.copy({clipboardData:{setData(){throw Error('native input intercepted');}},preventDefault(){}});assert.equal(status.textContent,'');
key(input,{key:'Escape',ctrlKey:false});assert.equal(selection.text(),'','Escape clears even while an editor owns focus');
click(0,1);selection.click({target:{closest:()=>null}});assert.equal(selection.text(),'','workspace background clears');
click(2,3,{shiftKey:true});assert.equal(selection.text(),'Stock','background clear resets range anchor');
selection.copy({clipboardData:{setData(){}},preventDefault(){}});assert.equal(status.textContent,'Copied','native grid copy event confirms');
console.log('PASS: successful copy feedback/count/expiry, native copy exclusion, control preservation, background and Escape clear/reset.');

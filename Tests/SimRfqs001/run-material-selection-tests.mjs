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

// Arrow movement is presentation-only, retains the column across merged fee cells,
// and scrolls only the clipped distance beneath the sticky header/Find column.
const scroll={scrollLeft:0,scrollTop:0,clientLeft:1,clientTop:1,clientWidth:300,clientHeight:180,getBoundingClientRect:()=>({left:0,top:0}),querySelector:s=>({getBoundingClientRect:()=>s==='thead'?{height:25}:{width:50}})};
root.querySelector=s=>s==='.material-grid-scroll'?scroll:status;
for(const row of rows)for(const c of row.cells)c.getBoundingClientRect=()=>({left:100,right:180,top:60,bottom:90});
const arrow=(name,mods={})=>{let prevented=false;const handled=key(document.activeElement,{key:name,ctrlKey:false,preventDefault(){prevented=true;},...mods});return {handled,prevented};};
click(0,2);arrow('ArrowDown');assert.equal(document.activeElement,rows[1].cells[1]);arrow('ArrowDown');assert.equal(document.activeElement,rows[2].cells[2],'column survives merged fee row');arrow('ArrowUp');arrow('ArrowUp');assert.equal(document.activeElement,rows[0].cells[2]);
arrow('ArrowLeft');assert.equal(document.activeElement,rows[0].cells[1]);arrow('ArrowRight');assert.equal(document.activeElement,rows[0].cells[2]);assert.equal(scroll.scrollTop,0);assert.equal(scroll.scrollLeft,0);
rows[1].hidden=true;arrow('ArrowDown');assert.equal(document.activeElement,rows[2].cells[2],'collapsed rows skipped');rows[1].hidden=false;
rows[0].cells[1].hidden=true;click(0,0);arrow('ArrowRight');assert.equal(document.activeElement,rows[0].cells[2]);rows[0].cells[1].hidden=false;
click(0,0);assert.deepEqual(arrow('ArrowLeft'),{handled:true,prevented:true});assert.deepEqual(arrow('ArrowUp'),{handled:true,prevented:true});arrow('ArrowRight');assert.equal(selection.text(),'PART-A','arrow selection is one cell even beside Find column');arrow('ArrowRight',{shiftKey:true});assert.equal(selection.text(),'PART-A\t2.00');
rows[2].cells[2].getBoundingClientRect=()=>({left:100,right:180,top:170,bottom:200});click(1,1);arrow('ArrowDown'); // merged cell keeps its leftmost column
click(2,1);arrow('ArrowRight');assert.equal(scroll.scrollTop,19);
rows[2].cells[3].getBoundingClientRect=()=>({left:290,right:360,top:60,bottom:90});arrow('ArrowRight');assert.equal(scroll.scrollLeft,59);
rows[2].cells[2].getBoundingClientRect=()=>({left:40,right:100,top:15,bottom:45});arrow('ArrowLeft');assert.equal(scroll.scrollLeft,48);assert.equal(scroll.scrollTop,8,'sticky header accounted for');
document.activeElement=input;assert.deepEqual(arrow('ArrowDown'),{handled:false,prevented:false});click(0,1);assert.deepEqual(arrow('ArrowDown',{altKey:true}),{handled:false,prevented:false});assert.deepEqual(arrow('ArrowDown',{isComposing:true}),{handled:false,prevented:false});
console.log('PASS: four arrows, boundaries, Shift range, merged/hidden fee rows, hidden columns, minimal two-axis scroll, sticky occlusion and native editor/modifier/IME boundaries.');

click(0,1);arrow('Enter');assert.equal(document.activeElement,rows[0].cells[2]);arrow('Enter');assert.equal(document.activeElement,rows[0].cells[3]);arrow('Enter');assert.equal(document.activeElement,rows[1].cells[1],'wrap skips fee sequence');arrow('Enter');assert.equal(document.activeElement,rows[1].cells[2]);arrow('Enter');assert.equal(document.activeElement,rows[2].cells[1],'wrap skips Find number');arrow('Enter',{shiftKey:true});assert.equal(document.activeElement,rows[1].cells[2]);
rows[1].hidden=true;click(0,3);arrow('Enter');assert.equal(document.activeElement,rows[2].cells[1]);rows[1].hidden=false;
rows[0].cells[2].hidden=true;click(0,1);arrow('Enter');assert.equal(document.activeElement,rows[0].cells[3]);rows[0].cells[2].hidden=false;
let reported=0;const editor={matches:()=>true,closest:s=>s==='td'?rows[0].cells[2]:{},checkValidity:()=>false,reportValidity(){reported++;}};
document.activeElement=editor;arrow('Enter');assert.equal(document.activeElement,editor);assert.equal(reported,1,'invalid edit cannot advance');editor.checkValidity=()=>true;arrow('Enter');assert.equal(document.activeElement,rows[0].cells[3],'valid input advances through existing focus/blur path');
for(const native of [{matches:()=>false,closest:()=>({})},{matches:()=>false,closest:()=>({}),tagName:'SELECT'}]){document.activeElement=native;assert.deepEqual(arrow('Enter'),{handled:false,prevented:false});}
click(2,3);arrow('Enter');assert.equal(document.activeElement,rows[2].cells[3],'last row does not wrap to first');click(0,1);arrow('Enter',{shiftKey:true});assert.equal(document.activeElement,rows[0].cells[1]);
console.log('PASS: Enter/Shift+Enter across cells and row boundaries; skips Find, hidden columns and collapsed fees; valid input advances, invalid input stays, native menus retained.');

let commits=0;
const editingCell=rows[0].cells[2];
const field={type:'number',value:'3.45',dataset:{field:'unitPrice'},disabled:false,readOnly:false,hidden:false,classList:{add(){},remove(){}},closest:s=>s==='td'?editingCell:['[popover]','.material-lead'].includes(s)?null:{},focus(){document.activeElement=this;},setSelectionRange(a,b){this.caret=[a,b];},setCustomValidity(v){this.error=v;},checkValidity(){return !this.error;},reportValidity(){},matches(){return true;}};
const priorQuery=editingCell.querySelectorAll;editingCell.querySelectorAll=s=>s.startsWith('input')?[field]:[];
const editing=create(root,()=>commits++);
const selectEdit=()=>editing.click({target:field,preventDefault(){}});
const editKey=(key,mods={})=>editing.key({target:document.activeElement,key,preventDefault(){},...mods});
selectEdit();assert.equal(document.activeElement,editingCell,'single click selects instead of caret');editKey('4');assert.equal(field.value,'4');assert.equal(editing.draft(field),true);field.value='425';editKey('Escape');assert.equal(field.value,'3.45');assert.equal(commits,0);assert.equal(document.activeElement,editingCell);
editKey('4');editKey('ArrowRight');assert.equal(commits,1);assert.equal(document.activeElement,rows[0].cells[3]);
selectEdit();editing.doubleClick({target:field,preventDefault(){}});assert.equal(field.value,'4');assert.equal(editKey('ArrowLeft'),false,'in-place arrows remain native');field.value='4.25';editKey('Enter');assert.equal(commits,2);
selectEdit();editKey('-');assert.equal(field.type,'text');editKey('Enter');assert.equal(document.activeElement,field);assert.equal(commits,2);assert.equal(editing.finish(true),false);editKey('Escape');assert.equal(field.value,'4.25');assert.equal(field.type,'number');assert.equal(commits,2);
selectEdit();editKey('9');assert.equal(editing.finish(true),true);assert.equal(commits,3);assert.equal(field.value,'9');
selectEdit();assert.equal(editKey('c',{ctrlKey:true}),true);assert.equal(editing.draft(field),false);editingCell.querySelectorAll=priorQuery;
console.log('PASS: selected input, replacement draft, exact clean Escape, in-place caret, valid arrow/Enter commits, invalid focus retention and single business commit.');

for(const [raw,mode,value,label] of [['s','STOCK',null,'Stock'],['ST','STOCK',null,'Stock'],['stock','STOCK',null,'Stock'],['1d','DAYS',1,'1 Day'],['10D','DAYS',10,'10 Days'],['1w','WEEKS',1,'1 Week'],['3w','WEEKS',3,'3 Weeks']])assert.deepEqual(JSON.parse(JSON.stringify(selection.parseLead(raw))),{mode,value,label});
for(const raw of ['10','0d','-1w','1.5d','3m','sto','36501w','nonsense',''])assert.equal(selection.parseLead(raw),null);
console.log('PASS: exact case-insensitive Stock/Days/Weeks vocabulary, singular/plural preview and incomplete/invalid/range rejection; no Months.');
// Enter traverses visible fee children at the parent's fee boundary, then resumes sourcing.
for(const [i,r] of rows.entries()){
 r.classList={contains:name=>name==='material-charge-row'&&i===1};
 for(const c of r.cells)c.parentElement=r;
 r.querySelector=selector=>i===0&&selector==='[data-material-action="add-charge"]'?{closest:()=>r.cells[2]}:null;
}
function feeMock(c,key){const f={tagName:'INPUT',type:'text',dataset:{charge:'test',chargeField:key},classList:{add(){},remove(){}},closest:()=>c,focus(){document.activeElement=this;}};const prior=c.querySelectorAll;c.querySelectorAll=q=>q==='[data-charge-field]'?[f]:prior(q);return f;}
feeMock(rows[1].cells[1],'description');feeMock(rows[1].cells[2],'rawCost');
rows[0].cells[2].getBoundingClientRect=()=>({left:100,right:180,top:60,bottom:90});
click(0,2);arrow('Enter');assert.equal(document.activeElement,rows[1].cells[1]);arrow('Enter');assert.equal(document.activeElement,rows[1].cells[2]);arrow('Enter');assert.equal(document.activeElement,rows[0].cells[3],'last fee returns to parent vendor');
arrow('Enter',{shiftKey:true});assert.equal(document.activeElement,rows[1].cells[2]);arrow('Enter');arrow('Enter');assert.equal(document.activeElement,rows[2].cells[1]);
const secondFee={cells:[cell('1.2'),cell('Second fee'),cell('Second sell')],classList:{contains:n=>n==='material-charge-row'}};
for(const c of secondFee.cells){c.parentElement=secondFee;c.getBoundingClientRect=()=>({left:100,right:180,top:60,bottom:90});}
feeMock(secondFee.cells[1],'description');feeMock(secondFee.cells[2],'rawCost');
rows.splice(2,0,secondFee);
click(1,2);arrow('Enter');assert.equal(document.activeElement,secondFee.cells[1]);arrow('Enter');arrow('Enter');assert.equal(document.activeElement,rows[0].cells[3]);arrow('Enter',{shiftKey:true});assert.equal(document.activeElement,secondFee.cells[2]);
secondFee.hidden=true;rows[1].hidden=true;click(0,2);arrow('Enter');assert.equal(document.activeElement,rows[0].cells[3],'collapsed children skipped');
secondFee.hidden=false;rows[1].hidden=false;rows[0].cells[2].hidden=true;click(0,1);arrow('Enter');assert.equal(document.activeElement,rows[1].cells[1],'hidden fee boundary retains logical group order');
console.log('PASS: one/multiple fees return to parent sourcing, reverse sequence, collapsed children and hidden insertion column.');

// Multiple logical controls in a shared fee TD retain a distinct selection.
const shared=rows[1].cells[1], highlighted=new Set();
const logicalFields=['category','description','treatment','markup','customMarkupPercent'].map(k=>({tagName:'INPUT',type:'text',dataset:{chargeField:k},classList:{add:()=>highlighted.add(k),remove:()=>highlighted.delete(k)},closest:()=>shared}));
shared.querySelectorAll=q=>q==='[data-charge-field]'?logicalFields:[];
const logicalSelection=create(root,()=>{throw Error('Navigation must not commit');});
const logicalKey=(key,shiftKey=false)=>logicalSelection.key({target:document.activeElement,key,shiftKey,preventDefault(){}});
logicalSelection.click({target:shared,preventDefault(){}});
assert.deepEqual([...highlighted],['category']);
logicalKey('Enter');assert.deepEqual([...highlighted],['description']);
logicalKey('Enter');assert.deepEqual([...highlighted],['treatment']);
logicalKey('Enter',true);assert.deepEqual([...highlighted],['description']);
logicalKey('Escape');assert.deepEqual([...highlighted],['description']);assert.ok(shared.selected());
logicalFields[2].disabled=true;logicalFields[3].hidden=true;logicalFields[4].readOnly=true;
logicalKey('Enter');assert.equal(document.activeElement,rows[1].cells[2],'skip disabled, hidden and read-only controls');
logicalKey('Enter',true);assert.deepEqual([...highlighted],['description']);
logicalSelection.clear();assert.equal(highlighted.size,0);
console.log('PASS: distinct shared-TD logical positions, reverse, persistent Escape selection, disabled/hidden/read-only skips and zero navigation commits.');

// Space dispatches one existing primary action only from the selected grid cell.
const actionCell=rows[0].cells[3],oldActionQuery=actionCell.querySelector;
let activations=0;const action={click(){activations++;}};
actionCell.querySelector=q=>q.startsWith('summary:not(')?action:oldActionQuery(q);
logicalSelection.click({target:actionCell,preventDefault(){}});
logicalKey(' ');assert.equal(activations,1);assert.ok(actionCell.selected());
logicalKey(' ',true);assert.equal(activations,2);
const nativeButton={closest:()=>({}),matches:()=>false};document.activeElement=nativeButton;
assert.equal(logicalKey(' '),false);assert.equal(activations,2,'native Space is not duplicated');
actionCell.querySelector=oldActionQuery;
console.log('PASS: Space activates selected primary action once, keeps selection and leaves native controls untouched.');

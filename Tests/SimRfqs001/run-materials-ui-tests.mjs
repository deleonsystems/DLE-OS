import {randomUUID} from 'node:crypto';import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../SRC/workspaces/rfqs/materials-workbench.js',import.meta.url),'utf8');
const row={index:0,vendor:'',unitPrice:null,orderQuantity:null,leadDays:null,notes:'',customerSupplied:false};
const rfq={intakeId:'SYNTHETIC',customer:{customerName:'Synthetic'},assemblies:[{assemblyNumber:'TEST',revision:'A',quantity:5}],lanes:{materials:{status:'NOT_STARTED'}},inputs:{materials:{version:1,candidate:{rows:[{index:0,values:{partNumber:'TEST',quantity:'3',designators:'R1',description:'Fixture'},componentType:'STANDARD_COTS',alternates:[{partNumber:'ALT',reviewStatus:'CONFIRMED',origin:'MANUAL',history:[]},{partNumber:'ALT-2',reviewStatus:'UNCONFIRMED',sourceContext:'Synthetic evidence'},{partNumber:'REMOVED',removedAtUtc:'2026-01-01'}]}]}}}};
rfq.inputs.materials.candidate.rows[0].manufacturerIdentity={proposals:[{id:'a',partNumber:'MFG-A'},{id:'b',partNumber:'MFG-B'},{id:'c',partNumber:'PENDING'},{id:'d',partNumber:'REJECTED'}],history:[{proposalId:'a',decision:'CONFIRMED'},{proposalId:'b',decision:'CONFIRMED'},{proposalId:'d',decision:'REJECTED'}]};
let copied;
let saved={rfq,plan:{revision:0,rows:[row],versions:[]},rows:[{quote:row,requiredQuantity:10,extendedCost:null,issues:['Vendor required']}],linesQuoted:0,totalCost:0,longestLeadDays:null},fail=false,writes=0,back=false;
const cells=new Map();const root={focus(){},querySelector:selector=>{if(!cells.has(selector))cells.set(selector,{textContent:'',closest(){return null;},focus(){this.focused=true;}});return cells.get(selector);}};const mount={innerHTML:'',querySelector:()=>root};
const window={crypto:{randomUUID},navigator:{clipboard:{writeText:async v=>{copied=v;}}},DleOsCapabilities:{can:()=>true},confirm:()=>true,fetch:async(url,options)=>{
 if(options.method){writes++;if(fail)return{ok:false,json:async()=>({message:'Test rejected write'})};const body=JSON.parse(options.body);saved.plan={...saved.plan,revision:saved.plan.revision+1,rows:body.rows,markupPercent:body.markupPercent};saved.rfq.lanes.materials.status='IN_PROGRESS';}
 return{ok:true,json:async()=>structuredClone(saved)};
}};
let dismissChooser;let openChoosers=[];
vm.runInNewContext(source,{window,document:{addEventListener:(type,handler,capture)=>{assert.equal(type,'click');assert.equal(capture,true);dismissChooser=handler;},querySelectorAll:()=>openChoosers}});
await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{back=true;});
assert.match(mount.innerHTML,/Material Quotation/);assert.match(mount.innerHTML,/Required Qty/);assert.doesNotMatch(mount.innerHTML,/Open Labor/);
root.oninput({target:{dataset:{row:'0',field:'vendor'},type:'text',value:'Synthetic Vendor'}});
const click=action=>root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:action,index:'0'}})}});
assert.doesNotMatch(mount.innerHTML,/data-material-action="details"|material-detail-row/);assert.match(mount.innerHTML,/title="Required Qty:/);
assert.deepEqual([...mount.innerHTML.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map(m=>m[1].replace('<small class="material-fee-legend">+ fee</small>','')),['Find #','Customer / BOM P/N','MFG / Approved P/N','Description','Ref Des','Qty / Unit','UoM','Unit Cost','Ext Cost','Order Qty','Total Cost','Vendor','Vendor P/N','Lead Time','Status / Options']);
const choose=value=>root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'confirmed-mfg',index:'0',choice:value.split(':')[1]}})}});
assert.match(mount.innerHTML,/Not resolved/);
assert.match(mount.innerHTML,/MFG-A <small>Approved/);assert.doesNotMatch(mount.innerHTML,/<option[^>]*>(PENDING|REJECTED|ALT)/);
choose('confirmed:1');assert.doesNotMatch(mount.innerHTML,/data-material-action="copy-mfg"/);assert.match(mount.innerHTML,/MFG-B/);
await click('manual-mfg');assert.match(mount.innerHTML,/Manual MFG \/ Approved P\/N/);
assert.equal(rfq.inputs.materials.candidate.rows[0].values.partNumber,'TEST');
for(const [field,value] of [['mfgPartNumber','MFG-TEST'],['vendorPartNumber','VENDOR-TEST'],['uom','FT']])root.oninput({target:{dataset:{row:'0',field},type:'text',value}});
const price=value=>root.oninput({target:{dataset:{row:'0',field:'unitPrice'},type:'number',value,setCustomValidity(){}}});
const ext=()=>cells.get('[data-assembly-cost="0"]').textContent;
price('2.00');assert.equal(ext(),'$6.00');
price('2.015');assert.equal(ext(),'$6.05');
price('');assert.equal(ext(),'');
price('malformed');assert.equal(ext(),'');const beforeWrites=writes;await click('save');assert.equal(writes,beforeWrites);
price('-2');assert.equal(ext(),'');await click('complete');assert.equal(writes,beforeWrites);
price('2.00');assert.equal(ext(),'$6.00');
assert.doesNotMatch(mount.innerHTML,/<input[^>]+data-field="quantity"/);
const order=value=>root.oninput({target:{dataset:{row:'0',field:'orderQuantity'},type:'number',value,setCustomValidity(){}}});
const total=()=>cells.get('[data-total-cost="0"]').textContent;
order('100');assert.equal(total(),'$200.00');assert.equal(ext(),'$6.00');
order('50');assert.equal(total(),'$100.00');assert.equal(ext(),'$6.00');
price('2.015');assert.equal(total(),'$100.75');assert.equal(ext(),'$6.05');
order('3');assert.equal(total(),'$6.05');
order('');assert.equal(total(),'');assert.equal(ext(),'$6.05');
order('-1');await click('save');assert.equal(writes,beforeWrites);assert.equal(total(),'');
price('2.00');await click('save');assert.equal(writes,beforeWrites,'valid price must not clear invalid order quantity');
order('malformed');await click('complete');assert.equal(writes,beforeWrites);
order('0');await click('save');assert.equal(writes,beforeWrites);
order('100');price('');assert.equal(total(),'');assert.equal(ext(),'');
price('2.00');assert.equal(total(),'$200.00');
assert.doesNotMatch(mount.innerHTML,/<input[^>]+data-field="totalCost"/);
fail=true;await click('save');assert.match(mount.innerHTML,/Synthetic Vendor/);assert.match(mount.innerHTML,/Test rejected write/);
fail=false;await click('save');assert.equal(saved.plan.rows[0].vendor,'Synthetic Vendor');assert.equal(saved.plan.rows[0].mfgPartNumber,'MFG-TEST');assert.equal(saved.plan.rows[0].vendorPartNumber,'VENDOR-TEST');assert.equal(saved.plan.rows[0].uom,'FT');await click('back');assert.ok(back);
await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/Synthetic Vendor/);assert.equal(writes,2);assert.ok(mount.innerHTML.includes('data-assembly-cost="0">$6.00</td>'));
assert.ok(mount.innerHTML.includes('data-total-cost="0">$200.00</span>'));
saved.rfq.inputs.materials.candidate.rows[0].values.quantity='4';await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.ok(mount.innerHTML.includes('data-assembly-cost="0">$8.00</td>'));
choose('confirmed:1');await click('save');assert.equal(saved.plan.rows[0].mfgPartNumber,'MFG-B');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/✓ MFG-B/);assert.equal(saved.rfq.inputs.materials.candidate.rows[0].values.partNumber,'TEST');
console.log('PASS: dedicated Materials UI, accepted source details, save/reopen, failed-write draft preservation, Back to RFQ, and no Labor form.');

saved.rfq.inputs.materials.candidate.rows[0].manufacturerIdentity.proposals=saved.rfq.inputs.materials.candidate.rows[0].manufacturerIdentity.proposals.slice(0,1);await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.doesNotMatch(mount.innerHTML,/data-mfg-selection/);assert.doesNotMatch(mount.innerHTML,/data-material-action="copy-mfg"/);assert.match(mount.innerHTML,/MFG-B/);

assert.doesNotMatch(mount.innerHTML,/material-mfg-icon/);assert.doesNotMatch(mount.innerHTML,/>Copy<|>Manual…</);await click('manual-mfg');root.oninput({target:{dataset:{row:'0',field:'mfgPartNumber'},type:'text',value:'MFG-A'}});await click('done-mfg');assert.match(mount.innerHTML,/Not Approved · Quote Only/);await click('save');assert.equal(saved.plan.rows[0].mfgPartNumberSource,'MANUAL_QUOTE_ONLY');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/Not Approved · Quote Only/);

let sourcingClass=false;root.classList={toggle:(name,on)=>{assert.equal(name,'materials-sourcing');sourcingClass=on;}};
for(const selector of ['[data-material-action="full-view"]','[data-material-action="sourcing-view"]'])root.querySelector(selector).setAttribute=function(k,v){this[k]=v;};
const unchangedHtml=mount.innerHTML,unchangedWrites=writes;
root.oninput({target:{dataset:{row:'0',field:'vendor'},type:'text',value:'UNSAVED SOURCING VENDOR'}});
await click('sourcing-view');assert.equal(sourcingClass,true);assert.match(mount.innerHTML,/data-status-heading>Status \/ Options/);assert.equal(mount.innerHTML,unchangedHtml,'toggle does not reconstruct inputs');assert.equal(writes,unchangedWrites);
await click('full-view');assert.equal(sourcingClass,false);assert.match(mount.innerHTML,/data-status-heading>Status \/ Options/);await click('save');assert.equal(saved.plan.rows[0].vendor,'UNSAVED SOURCING VENDOR');assert.equal(saved.plan.rows[0].mfgPartNumberSource,'MANUAL_QUOTE_ONLY');
await click('sourcing-view');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/materials-workbench materials-sourcing/);assert.match(mount.innerHTML,/data-material-action="sourcing-view" aria-pressed="true"/);
console.log('PASS: Full/Sourcing toggle retains live inputs, quotation edits and P/N source without auto-save; page-session reopen preference retained.');

const leadValue={value:'',hidden:false,setCustomValidity(v){this.validation=v;}};
const leadMode={value:'STOCK'},leadLabel={},leadSummary={};
const leadContainer={querySelector:s=>s==='select'?leadMode:s==='input'?leadValue:s==='summary'?leadSummary:leadLabel};
function lead(mode,value){leadMode.value=mode;leadValue.value=value;root.oninput({target:{dataset:{row:'0',field:'leadTimeValue'},closest:()=>leadContainer}});}
lead('STOCK','');assert.equal(leadSummary.textContent,'Stock');assert.equal(leadValue.hidden,true);
lead('DAYS','5');assert.equal(leadSummary.textContent,'5 Days');
lead('WEEKS','6');assert.equal(leadSummary.textContent,'6 Weeks');
await click('full-view');await click('sourcing-view');await click('save');assert.equal(saved.plan.rows[0].leadTimeMode,'WEEKS');assert.equal(saved.plan.rows[0].leadTimeValue,6);assert.equal(saved.plan.rows[0].uom,'FT');
await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/<summary>6 Weeks<\/summary>/);
const leadWrites=writes;for(const invalid of ['','0','-1','1.5','abc','36501']){lead('DAYS',invalid);await click('save');assert.equal(writes,leadWrites);}
lead('STOCK','');await click('save');assert.equal(saved.plan.rows[0].leadTimeValue,null);
console.log('PASS: structured lead controls, abbreviated display, validation, view toggle and save/reopen persistence.');

leadMode.dataset={row:'0'};leadMode.focus=()=>{};leadContainer.contains=()=>false;leadContainer.open=false;
const openLead=async()=>{await root.onclick({stopPropagation(){},preventDefault(){},target:{closest:s=>s==='td'?{querySelector:()=>leadContainer}:s==='summary'?{}:null}});leadContainer.open=true;};
await openLead();lead('WEEKS','6');root.onkeydown({target:{closest:()=>leadContainer},key:'Enter',preventDefault(){}});assert.equal(leadContainer.open,false);
await openLead();lead('DAYS','-1');root.onkeydown({target:{closest:()=>leadContainer},key:'Escape',preventDefault(){}});assert.match(leadContainer.outerHTML,/<summary>6 Weeks<\/summary>/);await click('save');assert.equal(saved.plan.rows[0].leadTimeValue,6);assert.equal(saved.plan.rows[0].leadTimeMode,'WEEKS');
await openLead();lead('DAYS','5');root.onfocusout({target:{closest:()=>leadContainer},relatedTarget:null});assert.equal(leadContainer.open,false);await click('save');assert.equal(saved.plan.rows[0].leadTimeValue,5);
console.log('PASS: lead Enter/blur close and Escape restores latest working value without automatic save.');

await openLead();lead('','6');assert.equal(leadContainer.open,false);assert.equal(leadSummary.textContent,'—');await click('save');assert.equal(saved.plan.rows[0].leadTimeMode,null);assert.equal(saved.plan.rows[0].leadTimeValue,null);assert.equal(saved.plan.rows[0].leadDays,null);await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/type="text" inputmode="numeric"/);console.log('PASS: blank clears all lead fields and persists; spinner-free numeric text entry.');

const vendor=choice=>root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'vendor-choice',index:'0',vendor:choice}})}});
await vendor('Digi-Key');await click('save');assert.equal(saved.plan.rows[0].vendorSource,'SIM_LIST');
await vendor('customer');await click('save');assert.equal(saved.plan.rows[0].customerSupplied,true);assert.equal(saved.plan.rows[0].vendor,'');
const newVendorPanel={querySelector:()=>({value:'Synthetic New Vendor'})};await root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'vendor-use',index:'0'},closest:()=>newVendorPanel})}});root.oninput({target:{dataset:{row:'0',field:'notes'},type:'text',value:'Synthetic note'}});assert.match(mount.innerHTML,/Not Approved · Quote Only/);await click('save');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.equal(saved.plan.rows[0].notes,'Synthetic note');assert.equal(saved.plan.rows[0].vendorSource,'MANUAL_QUOTE_ONLY');assert.equal(saved.plan.rows[0].customerSupplied,false);
const options=['digi-key','mouser','arrow','avnet'].map(name=>({dataset:{vendorOption:name},classList:{toggle(name,active){this.active=active;},contains(){return !!this.active;}}}));
const search={dataset:{vendorSearch:''},value:'DIG'},vendorPanel={querySelector:()=>search,querySelectorAll:selector=>selector==='[data-vendor-option]'?options:[]};search.closest=()=>vendorPanel;
const searchWrites=writes;root.oninput({target:search});assert.equal(options[0].hidden,false);assert.equal(options[1].hidden,true);assert.equal(options[0].classList.active,true);
search.value='a';root.oninput({target:search});assert.equal(options[2].hidden,false);assert.equal(options[3].hidden,false);assert.equal(options[0].hidden,true);
search.value='zzz';root.oninput({target:search});assert.ok(options.every(o=>o.hidden));assert.equal(writes,searchWrites);
vendorPanel.dataset={vendorPanel:'0'};for(const option of options)option.scrollIntoView=()=>{};
search.matches=selector=>selector==='[data-vendor-search]';
search.value='a';root.oninput({target:search});
const vendorKey=key=>root.onkeydown({target:search,key,preventDefault(){}});
vendorKey('ArrowDown');assert.equal(options[3].classList.active,true);
vendorKey('ArrowUp');assert.equal(options[2].classList.active,true);
search.value='no-match';root.oninput({target:search});vendorKey('Enter');assert.equal(writes,searchWrites);assert.ok(options.every(o=>!o.classList.active));
console.log('PASS: case-insensitive prefix filtering, best-match highlight, Up/Down navigation and invalid Enter without writes.');
console.log('PASS: SIM vendor search, customer supply, manual quote-only vendor and shared Notes save/reopen.');

const notesBeforeWrites=writes;
await click('evidence-add-note');assert.match(mount.innerHTML,/Sourcing \/ Purchasing/);assert.match(mount.innerHTML,/Synthetic note/);
root.querySelector('[data-evidence-text]').value='Internal sourcing fixture';root.querySelector('[data-evidence-purpose]').value='SOURCING_PURCHASING';
await click('evidence-note-apply');assert.equal(writes,notesBeforeWrites);assert.match(mount.innerHTML,/Internal sourcing fixture/);
await click('save');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});await click('evidence-view-notes');assert.match(mount.innerHTML,/Internal sourcing fixture/);
assert.equal(saved.plan.rows[0].evidence.notes[0].purpose,'SOURCING_PURCHASING');await click('evidence-close');
console.log('PASS: Options notes stay in working state until Save and survive reopen.');


saved.rfq.assemblies[0].quantity=25;await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});price('15');order('100');const markup=value=>root.oninput({target:{dataset:{markup:''},value,setCustomValidity(){}}});markup('25');assert.equal(root.querySelector('[data-live-total]').textContent,'$1,500.00');assert.equal(root.querySelector('[data-live-sale]').textContent,'$75.00');const mw=writes;markup('-1');await click('save');assert.equal(writes,mw);markup('25.5');assert.equal(root.querySelector('[data-live-sale]').textContent,'$75.30');await click('save');assert.equal(saved.plan.markupPercent,25.5);await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/75.30/);console.log('PASS: live exact markup example, decimal markup, invalid save blocking and persistence.');

saved.rows[0].requiredQuantity=75;saved.plan.rows[0].orderQuantityMode='AUTO';saved.plan.rows[0].orderQuantity=null;await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/data-field="orderQuantity"[^>]*value="75"/);order('100');await click('sourcing-view');await click('full-view');await click('save');assert.equal(saved.plan.rows[0].orderQuantityMode,'MANUAL');assert.equal(saved.plan.rows[0].orderQuantity,100);order('50');assert.equal(root.querySelector('[data-order-warning="0"]').textContent,'Below required qty · Minimum 75');console.log('PASS: automatic required qty, manual override tracking, view/save preservation and live minimum warning.');

await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});price('5');order('100');markup('40');
await click('add-charge');await click('add-charge');await click('add-charge');await click('save');
const ids=saved.plan.rows[0].charges.map(c=>c.id);
const edit=(id,field,value)=>root.oninput({target:{dataset:{charge:id,chargeField:field},value,setCustomValidity(){}}});
for(const [i,treatment,cost] of [[0,'BLEND','100'],[1,'SEPARATE','50'],[2,'NRE','250']]){edit(ids[i],'description','Synthetic '+i);edit(ids[i],'rawCost',cost);edit(ids[i],'treatment',treatment);}
assert.equal(root.querySelector('[data-live-sale]').textContent,'$33.60');assert.equal(root.querySelector('[data-live-separate]').textContent,'$70.00');assert.equal(root.querySelector('[data-live-nre]').textContent,'$350.00');assert.equal(root.querySelector('[data-live-basis]').textContent,'$600.00');
edit(ids[0],'markupTreatment','CUSTOM');edit(ids[0],'customMarkupPercent','12.5');assert.equal(root.querySelector('[data-live-sale]').textContent,'$32.50');
edit(ids[0],'markupTreatment','NONE');assert.equal(root.querySelector('[data-live-sale]').textContent,'$32.00');
edit(ids[0],'markupTreatment','MATERIAL');edit(ids[0],'rawCost','-1');const badWrites=writes;await click('save');assert.equal(writes,badWrites);edit(ids[0],'rawCost','100');await click('save');
assert.deepEqual(saved.plan.rows[0].charges.map(c=>c.id),ids);await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/3 charges/);assert.match(mount.innerHTML,/material-charge-row/);assert.match(mount.innerHTML,/33.60/);
await root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'remove-charge',index:'0',chargeId:ids[1]}})}});await click('save');assert.equal(saved.plan.rows[0].charges.length,2);assert.equal(saved.plan.rows[0].charges[1].id,ids[2]);
console.log('PASS: supplemental children add/edit/remove, all treatments, markup modes, exact example, invalid save blocking and stable save/reopen IDs.');

// Buyer-facing defaults apply only to new charges until pricing is explicitly chosen.
await click('add-charge');
const newId=[...mount.innerHTML.matchAll(/data-charge="([^"]+)"/g)].map(m=>m[1]).at(-1);
const change=(field,value)=>{const target={dataset:{charge:newId,chargeField:field},value,setCustomValidity(){}};root.oninput({target});root.onchange({target});};
assert.match(mount.innerHTML,/title="Add supplemental fee"[^>]*>\+<\/button>/);
assert.doesNotMatch(mount.innerHTML,/Description charge 3/);
for(const [category,expected] of [['SETUP','NRE'],['TOOLING','NRE'],['FREIGHT','BLEND'],['COD','BLEND'],['TARIFF','BLEND'],['OTHER','BLEND']]){change('category',category);await click('save');assert.equal(saved.plan.rows[0].charges.at(-1).treatment,expected);}
assert.match(mount.innerHTML,/Description charge 3/);
edit(newId,'description','Expedite fee');change('treatment','SEPARATE');change('category','SETUP');await click('save');assert.equal(saved.plan.rows[0].charges.at(-1).treatment,'SEPARATE');assert.equal(saved.plan.rows[0].charges.at(-1).description,'Vendor NRE / Setup');
change('markupTreatment','CUSTOM');assert.match(mount.innerHTML,/Custom Markup % charge 3/);change('markupTreatment','MATERIAL');assert.doesNotMatch(mount.innerHTML,/Custom Markup % charge 3/);markup('38');assert.equal(root.querySelector('[data-charge="'+newId+'"][data-charge-field="markupTreatment"] option[value="MATERIAL"]').textContent,'Std 38%');
await click('save');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});change('category','TARIFF');await click('save');assert.equal(saved.plan.rows[0].charges.at(-1).treatment,'SEPARATE');assert.equal(saved.plan.rows[0].charges[0].description,'Synthetic 0');
console.log('PASS: buyer labels, conditional fields, six category defaults, explicit overrides, dynamic Standard markup and legacy saved descriptions preserved.');

const persistedBeforeToggle=JSON.stringify(saved.plan),toggleWrites=writes;
await click('toggle-fees');assert.doesNotMatch(mount.innerHTML,/material-charge-row/);assert.match(mount.innerHTML,/3 charges/);assert.match(mount.innerHTML,/aria-expanded="false">▸/);assert.equal(writes,toggleWrites);
await click('sourcing-view');assert.doesNotMatch(mount.innerHTML,/material-charge-row/);await click('full-view');assert.doesNotMatch(mount.innerHTML,/material-charge-row/);assert.equal(JSON.stringify(saved.plan),persistedBeforeToggle);
await click('toggle-fees');assert.match(mount.innerHTML,/material-charge-row/);assert.match(mount.innerHTML,/Vendor NRE|Tariff/);
await click('toggle-fees');await click('add-charge');assert.match(mount.innerHTML,/material-charge-row/);assert.match(mount.innerHTML,/4 charges/);assert.match(mount.innerHTML,/aria-expanded="true">▾/);assert.match(source,/feeFocus=\{id,key:'category'\};draw\(\);return;/);assert.equal(writes,toggleWrites);
console.log('PASS: fee collapse removes child rows without writes, survives view toggle, retains counts and values, and add expands/focuses Category.');

edit(newId,'rawCost','200');assert.equal(root.querySelector('[data-charge-ext="'+newId+'"]').textContent,'$200.00');edit(newId,'rawCost','');assert.equal(root.querySelector('[data-charge-ext="'+newId+'"]').textContent,'');
assert.match(mount.innerHTML,/data-charge-field="quantity" value="1"/);assert.match(mount.innerHTML,/material-fee-uom">EA<\/td>/);
console.log('PASS: fixed fee Qty/EA and live quantity-one Ext Cost, including blank clearing.');

edit(newId,'rawCost','20');edit(newId,'quantity','3');assert.equal(root.querySelector('[data-charge-ext="'+newId+'"]').textContent,'$60.00');await click('save');assert.equal(saved.plan.rows[0].charges.find(c=>c.id===newId).quantity,'3');const qtyWrites=writes;edit(newId,'quantity','0');await click('save');assert.equal(writes,qtyWrites);edit(newId,'quantity','');await click('save');assert.equal(writes,qtyWrites);edit(newId,'quantity','1');
console.log('PASS: editable fee quantity multiplies cost, persists, and blocks zero/blank.');

markup('38');
for(const [qty,cost,mode,rate,ext,sell] of [['1','200','MATERIAL',null,'$200.00','$276.00'],['3','200','MATERIAL',null,'$600.00','$828.00'],['2','100','CUSTOM','10','$200.00','$220.00'],['5','20','NONE',null,'$100.00','$100.00']]){edit(newId,'quantity',qty);edit(newId,'rawCost',cost);edit(newId,'markupTreatment',mode);if(rate)edit(newId,'customMarkupPercent',rate);assert.equal(root.querySelector('[data-charge-ext="'+newId+'"]').textContent,ext);assert.equal(root.querySelector('[data-charge-sell="'+newId+'"]').textContent,sell);}
edit(newId,'quantity','');assert.equal(root.querySelector('[data-charge-ext="'+newId+'"]').textContent,'');assert.equal(root.querySelector('[data-charge-sell="'+newId+'"]').textContent,'\u2014');edit(newId,'quantity','5');
console.log('PASS: requested Qty/Cost/Ext/Sell examples A-D and blank Qty clears calculations instead of reverting to 1.');

// Chooser disclosure changes are presentation-only, including outside the workspace.
const writesBeforeChooser=writes;
const targetA={},targetB={},outside={};
const menuA={open:true,contains:t=>t===targetA};
const menuB={open:true,contains:t=>t===targetB};
openChoosers=[menuA,menuB];dismissChooser({target:targetB});
assert.equal(menuA.open,false);assert.equal(menuB.open,true);
dismissChooser({target:outside});assert.equal(menuB.open,false);
let focusReturned=false,prevented=false,stopped=false;
const chooserCell={colSpan:1,classList:{add(){},remove(){}},querySelector:()=>null,querySelectorAll:()=>[],closest:s=>s==='td'?chooserCell:null,setAttribute(){},removeAttribute(){},focus(){focusReturned=true;}};
window.getComputedStyle=()=>({display:'table-cell'});
root.querySelectorAll=()=>[{cells:[chooserCell]}];
menuA.open=true;menuA.closest=()=>chooserCell;menuA.querySelectorAll=()=>[];
cells.set('.material-mfg-menu[open]',menuA);
for(const count of [2,3]){let selected=-1,chosen=-1;menuA.querySelectorAll=()=>Array.from({length:count},(_,i)=>({focus(){selected=i;},click(){chosen=i;}}));
 root.onkeydown({target:targetA,key:'ArrowDown',preventDefault(){}});assert.equal(selected,0,'single/multi P/N keyboard options');
 root.onkeydown({target:targetA,key:'Enter',preventDefault(){}});assert.equal(chosen,0);
}
root.onkeydown({target:targetA,key:'Escape',preventDefault:()=>{prevented=true;},stopPropagation:()=>{stopped=true;}});
assert.equal(menuA.open,false);assert.ok(focusReturned&&prevented&&stopped);
delete root.querySelectorAll;
assert.equal(writes,writesBeforeChooser);
assert.match(source,/material-mfg-count/);assert.match(source,/material-mfg-chevron/);
console.log('PASS: exclusive chooser dismissal, outside click, Escape focus return and no persistence writes.');

cells.delete('.material-mfg-menu[open]');
await root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'sourcing-issue',index:'0',sourcingValue:'UNABLE_TO_SOURCE'}})}});
assert.equal(saved.plan.rows[0].sourcingStatus,'UNABLE_TO_SOURCE');assert.match(mount.innerHTML,/sourcing-reopen/);
const priceBeforeReopen=saved.plan.rows[0].unitPrice;
await click('sourcing-reopen');assert.equal(saved.plan.rows[0].sourcingStatus,'OPEN');assert.equal(saved.plan.rows[0].unitPrice,priceBeforeReopen);
await root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'sourcing-issue',index:'0',sourcingValue:'NEEDS_ALTERNATE'}})}});
assert.equal(saved.plan.rows[0].sourcingStatus,'NEEDS_ALTERNATE');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/Needs Alternate/);
console.log('PASS: sourcing exception save/reopen and explicit Reopen retain prices and row values.');

fail=true;await click('sourcing-reopen');assert.match(mount.innerHTML,/data-sourcing-state="NEEDS_ALTERNATE"/);assert.match(mount.innerHTML,/Test rejected write/);fail=false;
console.log('PASS: failed sourcing transition retains prior lock/status and reports the write failure.');

// Completing the fields never persists or locks until the explicit Complete action.
const autoTasks=[];window.setTimeout=fn=>{autoTasks.push(fn);};root.isConnected=true;
saved.plan.rows[0]={...saved.plan.rows[0],sourcingStatus:'OPEN',customerSupplied:false,vendor:'Digi-Key',vendorSource:'SIM_LIST',unitPrice:null,orderQuantity:75,leadTimeMode:'STOCK',leadTimeValue:null,leadDays:null,mfgPartNumber:'MFG-A',mfgPartNumberSource:'CONFIRMED_ACCEPTED_BOM',vendorPartNumber:''};
await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});
const autoPrice=value=>({dataset:{row:'0',field:'unitPrice'},type:'number',value,setCustomValidity(){}});
let finalField=autoPrice('2');const beforeAuto=writes;root.oninput({target:finalField});assert.equal(writes,beforeAuto);
await root.onchange({target:finalField});assert.equal(autoTasks.length,0);assert.equal(saved.plan.rows[0].sourcingStatus,'OPEN');await root.onchange({target:{dataset:{materialComplete:'0'},checked:true}});assert.equal(saved.plan.rows[0].sourcingStatus,'SOURCED');assert.equal(saved.plan.rows[0].vendorPartNumber,'');assert.match(mount.innerHTML,/material-complete-checkbox[^>]*checked/);assert.doesNotMatch(mount.innerHTML,/>Edit</);
await click('sourcing-reopen');assert.equal(saved.plan.rows[0].sourcingStatus,'OPEN');assert.equal(autoTasks.length,0);
finalField=autoPrice('');root.oninput({target:finalField});await root.onchange({target:finalField});assert.equal(autoTasks.length,0);assert.match(mount.innerHTML,/data-sourcing-state="OPEN"/);
finalField=autoPrice('2.5');root.oninput({target:finalField});await root.onchange({target:finalField});assert.equal(autoTasks.length,0);await root.onchange({target:{dataset:{materialComplete:'0'},checked:true}});assert.equal(saved.plan.rows[0].sourcingStatus,'SOURCED');assert.equal(saved.plan.rows[0].unitPrice,2.5);
console.log('PASS: final-field commit stays editable with Vendor P/N blank; explicit Complete saves/locks; Edit and corrections never auto-lock.');

await root.onchange({target:{dataset:{materialComplete:'0'},checked:false}});assert.equal(saved.plan.rows[0].sourcingStatus,'OPEN');
finalField=autoPrice('');root.oninput({target:finalField});const rejected={dataset:{materialComplete:'0'},checked:true};const priorWrites=writes;await root.onchange({target:rejected});assert.equal(rejected.checked,false);assert.equal(writes,priorWrites);assert.match(root.querySelector('.materials-message').textContent,/Unit Cost/);
console.log('PASS: checkbox unchecks to edit; incomplete checking stays unchecked with specific feedback and no write.');

price('12');order('250');
await root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'sourcing-issue',index:'0',sourcingValue:'CUSTOMER_SUPPLIED'}})}});
assert.equal(saved.plan.rows[0].sourcingStatus,'CUSTOMER_SUPPLIED');assert.equal(saved.plan.rows[0].customerSupplied,true);assert.equal(saved.plan.rows[0].unitPrice,null);assert.match(mount.innerHTML,/Customer Supplied/);assert.equal(saved.plan.rows[0].orderQuantity,saved.rows[0].requiredQuantity);assert.equal(saved.plan.rows[0].orderQuantityMode,'AUTO');
await click('sourcing-reopen');assert.equal(saved.plan.rows[0].customerSupplied,false);assert.equal(saved.plan.rows[0].unitPrice,null);assert.equal(saved.plan.rows[0].sourcingStatus,'OPEN');
console.log('PASS: Customer Supplied issue persists existing supply flag, preserves blank cost, and clears back to normal sourcing.');

// Completing a parent collapses fees only after a successful save, with no extra writes.
saved.plan.rows[0]={...saved.plan.rows[0],sourcingStatus:'OPEN',customerSupplied:false,vendor:'Digi-Key',unitPrice:2,leadTimeMode:'STOCK',leadTimeValue:null,charges:[{id:'inspect-a',category:'OTHER',description:'Synthetic A',quantity:1,rawCost:2,treatment:'BLEND',markupTreatment:'NONE',notes:''},{id:'inspect-b',category:'OTHER',description:'Synthetic B',quantity:1,rawCost:3,treatment:'BLEND',markupTreatment:'NONE',notes:''}]};
await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});
const feesBefore=JSON.stringify(saved.plan.rows[0].charges),beforeComplete=writes;
fail=true;await root.onchange({target:{dataset:{materialComplete:'0'},checked:true}});assert.match(mount.innerHTML,/material-charge-row/);fail=false;
await root.onchange({target:{dataset:{materialComplete:'0'},checked:true}});assert.equal(writes,beforeComplete+2);assert.doesNotMatch(mount.innerHTML,/class="material-charge-row"/);
const afterComplete=writes;await click('toggle-fees');assert.equal(writes,afterComplete);assert.match(mount.innerHTML,/class="material-charge-row" data-sourcing-state="SOURCED"/);assert.match(mount.innerHTML,/data-charge="inspect-a" data-charge-field="rawCost"[^>]*disabled/);assert.match(mount.innerHTML,/data-material-action="remove-charge"[^>]*disabled/);
await click('toggle-fees');await root.onchange({target:{dataset:{materialComplete:'0'},checked:false}});assert.doesNotMatch(mount.innerHTML,/class="material-charge-row"/);
await click('toggle-fees');assert.match(mount.innerHTML,/class="material-charge-row" data-sourcing-state="OPEN"/);assert.doesNotMatch(mount.innerHTML,/data-charge="inspect-a" data-charge-field="rawCost"[^>]*disabled/);assert.equal(JSON.stringify(saved.plan.rows[0].charges),feesBefore);
console.log('PASS: successful completion collapses fees once; failure retains expansion; read-only inspection, collapsed reopening and fee data preservation.');

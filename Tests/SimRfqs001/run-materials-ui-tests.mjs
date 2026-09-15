import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../SRC/workspaces/rfqs/materials-workbench.js',import.meta.url),'utf8');
const row={index:0,vendor:'',unitPrice:null,orderQuantity:null,leadDays:null,notes:'',customerSupplied:false};
const rfq={intakeId:'SYNTHETIC',customer:{customerName:'Synthetic'},assemblies:[{assemblyNumber:'TEST',revision:'A',quantity:5}],lanes:{materials:{status:'NOT_STARTED'}},inputs:{materials:{version:1,candidate:{rows:[{index:0,values:{partNumber:'TEST',quantity:'3',designators:'R1',description:'Fixture'},componentType:'STANDARD_COTS',alternates:[{partNumber:'ALT',reviewStatus:'CONFIRMED',origin:'MANUAL',history:[]},{partNumber:'ALT-2',reviewStatus:'UNCONFIRMED',sourceContext:'Synthetic evidence'},{partNumber:'REMOVED',removedAtUtc:'2026-01-01'}]}]}}}};
rfq.inputs.materials.candidate.rows[0].manufacturerIdentity={proposals:[{id:'a',partNumber:'MFG-A'},{id:'b',partNumber:'MFG-B'},{id:'c',partNumber:'PENDING'},{id:'d',partNumber:'REJECTED'}],history:[{proposalId:'a',decision:'CONFIRMED'},{proposalId:'b',decision:'CONFIRMED'},{proposalId:'d',decision:'REJECTED'}]};
let copied;
let saved={rfq,plan:{revision:0,rows:[row],versions:[]},rows:[{quote:row,requiredQuantity:10,extendedCost:null,issues:['Vendor required']}],linesQuoted:0,totalCost:0,longestLeadDays:null},fail=false,writes=0,back=false;
const cells=new Map();const root={querySelector:selector=>{if(!cells.has(selector))cells.set(selector,{textContent:''});return cells.get(selector);}};const mount={innerHTML:'',querySelector:()=>root};
const window={navigator:{clipboard:{writeText:async v=>{copied=v;}}},DleOsCapabilities:{can:()=>true},confirm:()=>true,fetch:async(url,options)=>{
 if(options.method){writes++;if(fail)return{ok:false,json:async()=>({message:'Test rejected write'})};const body=JSON.parse(options.body);saved.plan={...saved.plan,revision:saved.plan.revision+1,rows:body.rows,markupPercent:body.markupPercent};saved.rfq.lanes.materials.status='IN_PROGRESS';}
 return{ok:true,json:async()=>structuredClone(saved)};
}};
vm.runInNewContext(source,{window,document:{}});
await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{back=true;});
assert.match(mount.innerHTML,/Material Quotation/);assert.match(mount.innerHTML,/Required Qty/);assert.doesNotMatch(mount.innerHTML,/Open Labor/);
root.oninput({target:{dataset:{row:'0',field:'vendor'},type:'text',value:'Synthetic Vendor'}});
const click=action=>root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:action,index:'0'}})}});
await click('details');assert.match(mount.innerHTML,/ALT/);assert.match(mount.innerHTML,/Component Type/);
assert.deepEqual([...mount.innerHTML.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map(m=>m[1]),['Find #','Customer / BOM P/N','MFG / Approved P/N','Description','Ref Des','Qty / Unit','UoM','Unit Cost','Ext Cost','Order Qty','Total Cost','Vendor','Vendor P/N','Lead Time','Notes']);
const choose=value=>root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'confirmed-mfg',index:'0',choice:value.split(':')[1]}})}});
assert.match(mount.innerHTML,/Not resolved/);
assert.match(mount.innerHTML,/MFG-A <small>Approved/);assert.doesNotMatch(mount.innerHTML,/<option[^>]*>(PENDING|REJECTED|ALT)/);
choose('confirmed:1');await click('copy-mfg');assert.equal(copied,'MFG-B');
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
assert.ok(mount.innerHTML.includes('data-total-cost="0">$200.00</td>'));
saved.rfq.inputs.materials.candidate.rows[0].values.quantity='4';await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.ok(mount.innerHTML.includes('data-assembly-cost="0">$8.00</td>'));
choose('confirmed:1');await click('save');assert.equal(saved.plan.rows[0].mfgPartNumber,'MFG-B');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/✓ MFG-B/);assert.equal(saved.rfq.inputs.materials.candidate.rows[0].values.partNumber,'TEST');
console.log('PASS: dedicated Materials UI, accepted source details, save/reopen, failed-write draft preservation, Back to RFQ, and no Labor form.');

saved.rfq.inputs.materials.candidate.rows[0].manufacturerIdentity.proposals=saved.rfq.inputs.materials.candidate.rows[0].manufacturerIdentity.proposals.slice(0,1);await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.doesNotMatch(mount.innerHTML,/data-mfg-selection/);await click('copy-mfg');assert.equal(copied,'MFG-B');

assert.match(mount.innerHTML,/<rect[^>]*rx="2"/);assert.doesNotMatch(mount.innerHTML,/>Copy<|>Manual…</);await click('manual-mfg');root.oninput({target:{dataset:{row:'0',field:'mfgPartNumber'},type:'text',value:'MFG-A'}});await click('done-mfg');assert.match(mount.innerHTML,/Not Approved · Quote Only/);await click('save');assert.equal(saved.plan.rows[0].mfgPartNumberSource,'MANUAL_QUOTE_ONLY');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/Not Approved · Quote Only/);

let sourcingClass=false;root.classList={toggle:(name,on)=>{assert.equal(name,'materials-sourcing');sourcingClass=on;}};
for(const selector of ['[data-material-action="full-view"]','[data-material-action="sourcing-view"]'])root.querySelector(selector).setAttribute=function(k,v){this[k]=v;};
const unchangedHtml=mount.innerHTML,unchangedWrites=writes;
root.oninput({target:{dataset:{row:'0',field:'vendor'},type:'text',value:'UNSAVED SOURCING VENDOR'}});
await click('sourcing-view');assert.equal(sourcingClass,true);assert.equal(root.querySelector('[data-status-heading]').textContent,'Notes');assert.equal(mount.innerHTML,unchangedHtml,'toggle does not reconstruct inputs');assert.equal(writes,unchangedWrites);
await click('full-view');assert.equal(sourcingClass,false);assert.equal(root.querySelector('[data-status-heading]').textContent,'Notes');await click('save');assert.equal(saved.plan.rows[0].vendor,'UNSAVED SOURCING VENDOR');assert.equal(saved.plan.rows[0].mfgPartNumberSource,'MANUAL_QUOTE_ONLY');
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
const openLead=async()=>{await root.onclick({stopPropagation(){},preventDefault(){},target:{closest:s=>s==='td'?{querySelector:()=>leadContainer}:null}});leadContainer.open=true;};
await openLead();lead('WEEKS','6');root.onkeydown({target:{closest:()=>leadContainer},key:'Enter',preventDefault(){}});assert.equal(leadContainer.open,false);
await openLead();lead('DAYS','-1');root.onkeydown({target:{closest:()=>leadContainer},key:'Escape',preventDefault(){}});assert.match(leadContainer.outerHTML,/<summary>6 Weeks<\/summary>/);await click('save');assert.equal(saved.plan.rows[0].leadTimeValue,6);assert.equal(saved.plan.rows[0].leadTimeMode,'WEEKS');
await openLead();lead('DAYS','5');root.onfocusout({target:{closest:()=>leadContainer},relatedTarget:null});assert.equal(leadContainer.open,false);await click('save');assert.equal(saved.plan.rows[0].leadTimeValue,5);
console.log('PASS: lead Enter/blur close and Escape restores latest working value without automatic save.');

await openLead();lead('','6');assert.equal(leadContainer.open,false);assert.equal(leadSummary.textContent,'—');await click('save');assert.equal(saved.plan.rows[0].leadTimeMode,null);assert.equal(saved.plan.rows[0].leadTimeValue,null);assert.equal(saved.plan.rows[0].leadDays,null);await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/type="text" inputmode="numeric"/);console.log('PASS: blank clears all lead fields and persists; spinner-free numeric text entry.');

const vendor=choice=>root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'vendor-choice',index:'0',vendor:choice}})}});
await vendor('Digi-Key');await click('save');assert.equal(saved.plan.rows[0].vendorSource,'SIM_LIST');
await vendor('customer');await click('save');assert.equal(saved.plan.rows[0].customerSupplied,true);assert.equal(saved.plan.rows[0].vendor,'');
const newVendorPanel={querySelector:()=>({value:'Synthetic New Vendor'})};await root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'vendor-use',index:'0'},closest:()=>newVendorPanel})}});root.oninput({target:{dataset:{row:'0',field:'notes'},type:'text',value:'Synthetic note'}});assert.match(mount.innerHTML,/Not Approved · Quote Only/);await click('save');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.equal(saved.plan.rows[0].notes,'Synthetic note');assert.equal(saved.plan.rows[0].vendorSource,'MANUAL_QUOTE_ONLY');assert.equal(saved.plan.rows[0].customerSupplied,false);
const options=[{dataset:{vendorOption:'digi-key'}},{dataset:{vendorOption:'mouser'}}];root.oninput({target:{dataset:{vendorSearch:''},value:'dig',closest:()=>({querySelectorAll:()=>options})}});assert.equal(options[0].hidden,false);assert.equal(options[1].hidden,true);
console.log('PASS: SIM vendor search, customer supply, manual quote-only vendor and shared Notes save/reopen.');

const notesBeforeWrites=writes;const notePanel={querySelector:()=>({value:'Popover working note'})};await root.onclick({stopPropagation(){},target:{closest:()=>({dataset:{materialAction:'note-apply',index:'0'},closest:()=>notePanel})}});assert.equal(writes,notesBeforeWrites);assert.match(mount.innerHTML,/Popover working note/);await click('full-view');await click('save');assert.equal(saved.plan.rows[0].notes,'Popover working note');await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/Popover working note/);console.log('PASS: note Apply changes working state only; shared Full View Notes persist through Save/reopen.');


saved.rfq.assemblies[0].quantity=25;await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});price('15');order('100');const markup=value=>root.oninput({target:{dataset:{markup:''},value,setCustomValidity(){}}});markup('25');assert.equal(root.querySelector('[data-live-total]').textContent,'$1,500.00');assert.equal(root.querySelector('[data-live-sale]').textContent,'$75.00');const mw=writes;markup('-1');await click('save');assert.equal(writes,mw);markup('25.5');assert.equal(root.querySelector('[data-live-sale]').textContent,'$75.30');await click('save');assert.equal(saved.plan.markupPercent,25.5);await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/75.30/);console.log('PASS: live exact markup example, decimal markup, invalid save blocking and persistence.');

saved.rows[0].requiredQuantity=75;saved.plan.rows[0].orderQuantityMode='AUTO';saved.plan.rows[0].orderQuantity=null;await window.DleMaterialsWorkbench.open(mount,rfq,async()=>{});assert.match(mount.innerHTML,/data-field="orderQuantity"[^>]*value="75"/);order('100');await click('sourcing-view');await click('full-view');await click('save');assert.equal(saved.plan.rows[0].orderQuantityMode,'MANUAL');assert.equal(saved.plan.rows[0].orderQuantity,100);order('50');assert.equal(root.querySelector('[data-order-warning="0"]').textContent,'Below required qty · Minimum 75');console.log('PASS: automatic required qty, manual override tracking, view/save preservation and live minimum warning.');

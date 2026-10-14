const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const window={};for(const f of ['labor-workbench','labor-traveler-print'])vm.runInNewContext(fs.readFileSync('SRC/workspaces/rfqs/'+f+'.js','utf8'),{window,document:{}});
const api=window.DleLaborTravelerPrint;
for(const text of ['', 'x'.repeat(8000), '\n'.repeat(500), 'x'.repeat(499)+'😀'+'\n'.repeat(30)+'fin', 'Text with spaces '.repeat(400)]){const pieces=api.chunks(text);assert.equal(pieces.join(''),text);assert(pieces.every(p=>p.length<=501));assert(!pieces.some(p=>/[\uD800-\uDBFF]$/.test(p)));}
const plan={quantity:25,operations:[{id:'k',name:'Kitting',instructions:'OMIT KIT'},{id:'a',name:'Assembly <fixture>',instructions:'MAINSTART '+('a\n'.repeat(1000))+' MAINEND',operationQuantity:99},{id:'b',parentId:'a',name:'First substep',instructions:'Retained',operationQuantity:0,timeBasis:'BATCH',notes:[{purpose:'PRODUCTION',text:'Visible'},{purpose:'INTERNAL_RFQ',text:'SECRET'},{purpose:'PRODUCTION',text:'REMOVED',removed:true}]}]};
const before=JSON.stringify(plan),def=api.build(plan,{assemblies:[{assemblyNumber:'TEST',revision:'A'}],customer:{customerName:'Sample'}});
assert(def.html.includes('OMIT KIT'));assert(!def.html.includes('SECRET'));assert(!def.html.includes('REMOVED'));assert(def.html.includes('Visible'));assert(def.html.includes('Assembly &lt;fixture&gt;'));assert(!def.html.includes('Labor Qty'));assert(!def.html.includes('<td class="quote-qty">'));assert(def.html.includes('quote-keep-pair'));assert.equal(JSON.stringify(plan),before);assert.equal(api.build({operations:[]},{}).html.includes('No production operations'),true);
console.log('PASS note chunk boundaries/newlines/Unicode, blank vs zero, escaping/private notes, source immutability, Materials/Kit inclusion and empty draft');
const kitPlan={operations:[{id:'kit',name:'Kitting',instructions:'KIT MAIN NOTE'},{id:'kit-child',parentId:'kit',name:'Count components',instructions:'KIT CHILD NOTE',notes:[{purpose:'PRODUCTION',text:'KIT PUBLIC NOTE'},{purpose:'INTERNAL_RFQ',text:'KIT PRIVATE NOTE'}]},{id:'kit-two',name:'Kitting'},{id:'prod',name:'Assembly'}]};
const kitHtml=api.build(kitPlan,{}).html;
for(const id of ['kit','kit-child','kit-two','prod'])assert.equal(kitHtml.split('data-operation="'+id+'"').length-1,1);
for(const note of ['KIT MAIN NOTE','KIT CHILD NOTE','KIT PUBLIC NOTE'])assert.equal(kitHtml.split(note).length-1,1);
assert(!kitHtml.includes('KIT PRIVATE NOTE'));
assert(kitHtml.indexOf('KIT CHILD NOTE')<kitHtml.indexOf('quote-production'));
console.log('PASS multiple Materials roots and child rows appear once, with public notes in Materials');

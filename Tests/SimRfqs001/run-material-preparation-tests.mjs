import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context={window:{}};
vm.runInNewContext(fs.readFileSync('SRC/workspaces/rfqs/labor-workbench.js','utf8'),context);
const api=context.window.DleLaborWorkbench;
const operations=[
 {id:'inspect',name:'Inspection',responsibleRole:'Quality Inspector',operationQuantity:1,runSeconds:9},
 {id:'op-1',name:'Kitting',operationQuantity:8,runSeconds:10},
 {id:'kit-child',parentId:'op-1',name:'Count',responsibleRole:'Quality Inspector',operationQuantity:2,runSeconds:3,timeBasis:'BATCH'},
 {id:'buy',name:'Purchasing',responsibleRole:'Purchasing',operationQuantity:1,runSeconds:7},
 {id:'partial',name:'Kitting inspection',responsibleRole:'Kitting supervisor',operationQuantity:1,runSeconds:4},
 {id:'production-child',parentId:'inspect',name:'Kitting',responsibleRole:'Kitting operator',operationQuantity:1,runSeconds:5},
 {id:'new-uuid',name:'Custom kit preparation',responsibleRole:'Kitting operator',operationQuantity:1,runSeconds:2}
];
const plan={operations,quantity:25,rate:75,markup:25,charges:[]};
const before=JSON.stringify(plan),totals=JSON.stringify(api.calculate(plan));
assert.deepEqual([...api.materialPreparationIds(operations)],['op-1','kit-child']);
const rows=Array.from(api.groupedRows(operations));
assert.deepEqual(rows.map(r=>r.o.id),['op-1','kit-child','inspect','production-child','buy','partial','new-uuid']);
assert.deepEqual(rows.map(r=>r.seq),['M1','M1.1','1','1.1','2','3','4']);
assert.deepEqual(rows.filter(r=>r.section).map(r=>r.section),['Materials/Kit','Production']);
assert.equal(JSON.stringify(plan),before);
assert.equal(JSON.stringify(api.calculate(plan)),totals);
assert.notEqual(JSON.stringify(api.calculate({...plan,operations:operations.filter(o=>!api.materialPreparationIds(operations).has(o.id))})),totals,'Materials time remains costed');
const reopened=JSON.parse(before);
assert.deepEqual([...api.materialPreparationIds(reopened.operations)],['op-1','kit-child']);
assert.equal(JSON.stringify(api.calculate(reopened)),totals);
assert.equal(api.groupedRows([]).length,0);
assert.equal(api.groupedRows([{id:'new',name:'Kitting'}])[0].section,'Materials/Kit');
assert.equal(api.groupedRows([{id:'new',name:'Assembly'}])[0].section,'Production');
assert.equal(api.materialPreparationIds([{id:'op-1',name:'Inspection'}]).size,0,'Generic row ID is not a semantic Kitting key');
console.log('PASS: exact Kitting scope, stable parent-ID inheritance, new and serialized jobs, original numbering/order/identity, unchanged costing, empty sections');

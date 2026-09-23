import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(file,'utf8');
const table={innerHTML:''};
const context=vm.createContext({
  console,structuredClone,
  escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  document:{getElementById:id=>id==='operationsCenterTable'?table:null},
  window:{OperationsCenter:{},shipmentStagingState:{records:[]}}
});
for(const file of ['operations-center-fields.js','operations-center-state.js','operations-center-data-service.js','operations-center-view-model.js','operations-center-table.js'])
  vm.runInContext(read('SRC/modules/operations-center/'+file),context,{filename:file});
const oc=context.window.OperationsCenter;
let checks=0;
function equal(actual,expected,description){assert.equal(actual,expected,description);checks++;}
function includes(value,text){assert.ok(value.includes(text),text);checks++;}

const source={salesOrderLineId:'990901:0099999:010',customerNumber:'990901',customerName:'DLE-SIM-CUSTOMER',customerPurchaseOrderNumber:'SIM-E2E-001-PO',salesOrderNumber:'0099999',lineNumber:'010',itemNumber:'SIM-ASSY-001',description:'Synthetic assembly',quantityOrdered:10,erpQuantityOpen:10,unitPrice:70.64,extendedPrice:706.4,orderDate:'2026-09-23',customerPoDate:'2026-09-22',customerDueDate:'2026-10-14',estimatedShipDate:''};
const before=JSON.stringify(source);
const row=oc.dataService.normalizeRow(source);
const value=key=>oc.viewModel.getOfficialField(row,key);
equal(value('orderDate'),'09/23/2026','ERP order date stays independent');
equal(value('poDate'),'09/22/2026','PO date comes from accepted commercial context');
equal(value('customerDueDate'),'10/14/2026','Customer due date is visible');
equal(value('dueDate'),'Not set','Missing estimated ship date does not inherit customer due date');
equal(row.orderDate,'2026-09-23','ERP date stays ISO date-only in row');
equal(row.customerPoDate,'2026-09-22','PO date stays ISO date-only in row');
equal(row.customerDueDate,'2026-10-14','Customer due date stays ISO date-only in row');
equal(row.estimatedShipDate,'','Existing unknown estimated-ship representation stays empty');
equal(JSON.stringify(source),before,'Display never modifies API facts');
for(const [key,label] of [['orderDate','ERP Order Date'],['poDate','PO Date'],['customerDueDate','Customer Due Date'],['dueDate','Estimated Ship Date']])
  equal(oc.officialColumns.find(c=>c.key===key).label,label,'Unambiguous column label');

const planned=oc.dataService.normalizeRow({...source,estimatedShipDate:'2026-10-12'});
equal(oc.viewModel.getOfficialField(planned,'dueDate'),'10/12/2026','Explicit ERP planning date displayed separately');
equal(oc.viewModel.getOfficialField(planned,'customerDueDate'),'10/14/2026','Planning date does not replace customer due date');
const missing=oc.dataService.normalizeRow({...source,customerPoDate:undefined,customerDueDate:undefined});
equal(oc.viewModel.getOfficialField(missing,'poDate'),'Not set','Legacy records do not invent PO date');
equal(oc.viewModel.getOfficialField(missing,'customerDueDate'),'Not set','Legacy records do not invent due date');
equal(oc.viewModel.getOfficialField(missing,'orderDate'),'09/23/2026','Legacy ERP order date stays supported');
equal(oc.viewModel.getOfficialField({vpro5:{dueDate:'08/29/26'}},'dueDate'),'08/29/26','Legacy compatibility fallback is retained when raw canonical date is absent');
for(const input of ['2026-03-08','2026-11-01','2027-01-01']){
  const item=oc.dataService.normalizeRow({...source,customerPoDate:input});
  equal(oc.viewModel.getOfficialField(item,'poDate'),input.slice(5,7)+'/'+input.slice(8,10)+'/'+input.slice(0,4),'Date-only display has no daylight-saving or midnight shift');
}

oc.state.canonicalLoaded=true;oc.state.operationalEnrichmentAvailable=true;oc.state.canonicalRows=[row];
oc.table.renderTable();
for(const text of ['ERP Order Date','PO Date','Customer Due Date','Estimated Ship Date','09/23/2026','09/22/2026','10/14/2026','Not set'])includes(table.innerHTML,text);
equal(oc.viewModel.getOperationsCenterView({records:[row],searchTerms:['10/14/2026']}).records.length,1,'Customer due date is searchable');
equal(oc.viewModel.getOperationsCenterView({records:[row],searchTerms:['09/22/2026']}).records.length,1,'Customer PO date is searchable');
const earlierShip=oc.dataService.normalizeRow({...source,estimatedShipDate:'2026-10-10',customerDueDate:'2026-10-20'});
const laterShip=oc.dataService.normalizeRow({...source,lineNumber:'020',salesOrderLineId:'990901:0099999:020',estimatedShipDate:'2026-10-12',customerDueDate:'2026-10-14'});
equal(oc.viewModel.compareOperationsLines(earlierShip,laterShip)<0,true,'Existing queue ordering still uses estimated ship date');
const mobile=read('SRC/modules/operations-center/operations-center.js');
for(const label of ['PO Date','ERP Order Date','Customer Due Date','Estimated Ship Date'])includes(mobile,"mobileFact('"+label+"'");
equal(/mobileFact\('(?:Due|Next Due)'/.test(mobile),false,'Mobile date labels do not conflate requested due and estimated ship dates');
console.log('PASS '+checks+' Operations date display/mapping checks (read-only fixtures).');

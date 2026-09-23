import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const original=JSON.parse(fs.readFileSync(process.argv[2]||'tmp/order-entry/queue-detail-live.json','utf8').replace(/^\uFEFF/,''));
const source=fs.readFileSync('SRC/workspaces/order-entry/order-entry-workspace.js','utf8');
const initialTime=Date.parse('2026-09-23T20:00:00Z');
let count=0;
function check(actual,expected,message){assert.equal(actual,expected,message);count++;}
function contains(html,text){assert.ok(html.includes(text),text);count++;}
function buttonDisabled(html,action){return new RegExp('data-action="'+action+'"[^>]*\\bdisabled').test(html);}

async function harness({enabled=true,permission=true,status='READY_FOR_OPERATIONS_SYNC',recognition='Awaiting'}={}){
  const detail=structuredClone(original);detail.orderEntry.bridge.state.status=status;
  const state={detail,enabled,permission,recognition,now:initialTime,calls:[],receipt:null,prepareStatus:'PASS',importError:null,afterImportRecognition:'Recognized in SIM Operations'};
  const packet={packetId:'test-packet',schemaVersion:1,contentHash:'test-content-hash',environment:'SIM',erpSource:'SIM-VPRO5',importType:'SIMULATED_DEVELOPMENTAL',source:{acceptedRevision:7,bridgeRevision:detail.orderEntry.bridge.revision},orderLine:{salesOrderNumber:'0099999',lineNumber:'010',quantityOrdered:10,erpQuantityOpen:10,openingShippedQuantity:0,customerDueDate:'2026-10-14',estimatedShipDate:null,orderDate:'2026-09-23',simulatedFacts:['ERP order date uses accepted order date, not PO date.']},workOrder:{workOrderNumber:'0999999',scheduledQuantity:10,openedDate:'2026-09-23',workOrderType:'NORMAL',workOrderStatus:'OPEN'}};
  state.packet=packet;
  const mount={innerHTML:'',querySelector:()=>({value:'',checked:false})};state.mount=mount;
  const window={DleOsCapabilities:{can:p=>p!=='order_entry.sim_import'||state.permission},crypto:{randomUUID:()=> 'mock-request'},fetch:async(path,options)=>{
    state.calls.push({path,options});let data;
    if(path==='/api/sim/order-entry')data={items:[{intakeId:detail.intakeId,accepted:true,customer:'DLE-SIM-CUSTOMER',poNumber:'SIM-E2E-001-PO',assembly:'SIM-ASSY-001',revision:'A',quantity:10,status,customerDueDate:'2026-10-14'}]};
    else if(path.endsWith('/operations-handoff'))data={enabled:state.enabled,canImport:state.permission,recognition:state.recognition,receipt:state.receipt};
    else if(path.endsWith('/operations-packet'))data={packet:structuredClone(packet),validation:{status:state.prepareStatus,errors:state.prepareStatus==='PASS'?[]:['Identity collision'],warnings:['Test <script>warning</script>'],records:[{recordType:'Sales Order line',identity:'990901:0099999:010',action:'CREATE'}],relationship:'EXACT_LINE_UNIQUE'},validationToken:'signed-packet-token',expiresAt:new Date(state.now+60000).toISOString()};
    else if(path.endsWith('/operations-import')){
      if(state.importError)return {ok:false,json:async()=>({message:state.importError})};
      state.recognition=state.afterImportRecognition;state.receipt={receiptId:'receipt-1',packet:structuredClone(packet)};
      if(state.recognition==='Recognized in SIM Operations')state.detail.orderEntry.bridge.revision++;
      data={receipt:state.receipt,recognition:state.recognition,message:state.recognition};
    }else data=structuredClone(state.detail);
    return {ok:true,json:async()=>data};
  }};
  vm.runInNewContext(source,{window,Date:{parse:Date.parse,now:()=>state.now},document:{body:{dataset:{simRuntime:'true'}},querySelector:()=>mount}});
  state.click=async(action)=>mount.onclick({target:{closest:()=>({dataset:{action}})}});
  state.refresh=()=>window.DleWorkspaces['order-entry'].refresh();
  await window.DleWorkspaces['order-entry'].render();
  await mount.onclick({target:{closest:()=>({dataset:{id:detail.intakeId}})}});
  return state;
}

const flow=await harness();
contains(flow.mount.innerHTML,'Operations Handoff');contains(flow.mount.innerHTML,'DEVELOPMENT ONLY');contains(flow.mount.innerHTML,'SIMULATED VPRO 5 DATA');
check(flow.calls.some(c=>c.options.method),false,'Opening detail must only read');
check(buttonDisabled(flow.mount.innerHTML,'prepare-operations'),false);
check(flow.mount.innerHTML.includes('data-action="import-operations"'),false);
await flow.click('prepare-operations');
const prepareCall=flow.calls.find(c=>c.path.endsWith('/operations-packet'));
check(JSON.parse(prepareCall.options.body).expectedBridgeRevision,original.orderEntry.bridge.revision);
contains(flow.mount.innerHTML,'990901:0099999:010');contains(flow.mount.innerHTML,'EXACT_LINE_UNIQUE');contains(flow.mount.innerHTML,'10/14/2026');
contains(flow.mount.innerHTML,'Estimated ship date</dt><dd>Not set');contains(flow.mount.innerHTML,'ERP order date</dt><dd>09/23/2026');
contains(flow.mount.innerHTML,'&lt;script&gt;warning&lt;/script&gt;');check(flow.mount.innerHTML.includes('<script>warning</script>'),false);
check(buttonDisabled(flow.mount.innerHTML,'import-operations'),false);
check(flow.calls.filter(c=>c.path.endsWith('/operations-import')).length,0,'Prepare cannot import');
await flow.click('import-operations');
const imported=JSON.parse(flow.calls.find(c=>c.path.endsWith('/operations-import')).options.body);
assert.deepEqual(imported,{packet:flow.packet,validationToken:'signed-packet-token'});count++;
contains(flow.mount.innerHTML,'Recognized in SIM Operations');contains(flow.mount.innerHTML,'SIM import receipt');
check(flow.mount.innerHTML.includes('Awaiting simulated Operations recognition'),false);
check(buttonDisabled(flow.mount.innerHTML,'prepare-operations'),true);
check(flow.detail.orderEntry.bridge.state.status,'READY_FOR_OPERATIONS_SYNC','Recognition must not release the bridge');

const unauthorized=await harness({permission:false});
check(buttonDisabled(unauthorized.mount.innerHTML,'prepare-operations'),true);await unauthorized.click('prepare-operations');
check(unauthorized.calls.some(c=>c.options.method),false,'Forged UI click cannot prepare without permission');
const disabled=await harness({enabled:false});contains(disabled.mount.innerHTML,'adapter is disabled');
await disabled.click('prepare-operations');check(disabled.calls.some(c=>c.options.method),false);
const incomplete=await harness({status:'IN_PROGRESS'});check(buttonDisabled(incomplete.mount.innerHTML,'prepare-operations'),true);
await incomplete.click('prepare-operations');check(incomplete.calls.some(c=>c.options.method),false);

const blocked=await harness();blocked.prepareStatus='BLOCKED';await blocked.click('prepare-operations');
contains(blocked.mount.innerHTML,'Identity collision');check(buttonDisabled(blocked.mount.innerHTML,'import-operations'),true);
await blocked.click('import-operations');check(blocked.calls.some(c=>c.path.endsWith('/operations-import')),false);

const expired=await harness();await expired.click('prepare-operations');expired.now+=60001;await expired.click('import-operations');
contains(expired.mount.innerHTML,'Validation expired');check(expired.calls.some(c=>c.path.endsWith('/operations-import')),false);
const stale=await harness();await stale.click('prepare-operations');stale.detail.orderEntry.bridge.revision++;await stale.refresh();
check(stale.mount.innerHTML.includes('Prepared packet'),false,'Refresh discards packet when bridge revision changes');

const retry=await harness();await retry.click('prepare-operations');retry.importError='Bridge changed; prepare again.';await retry.click('import-operations');
contains(retry.mount.innerHTML,'Bridge changed; prepare again.');retry.importError=null;await retry.click('import-operations');
const retries=retry.calls.filter(c=>c.path.endsWith('/operations-import'));check(retries.length,2);
check(retries[0].options.body,retries[1].options.body,'Uncertain import retry must reuse exact packet and token');
check(retry.calls.some(c=>/sync\/operations|kitting|inventory|purchasing/i.test(c.path)),false);
const pending=await harness();pending.afterImportRecognition='Imported — bridge acknowledgment pending';await pending.click('prepare-operations');await pending.click('import-operations');
contains(pending.mount.innerHTML,'Imported — bridge acknowledgment pending');contains(pending.mount.innerHTML,'without duplicating Operations records');
pending.now+=60001;await pending.click('prepare-operations');pending.afterImportRecognition='Recognized in SIM Operations';await pending.click('import-operations');
const recovered=pending.calls.filter(c=>c.path.endsWith('/operations-import'));check(recovered.length,2);
check(JSON.parse(recovered[0].options.body).packet.packetId,JSON.parse(recovered[1].options.body).packet.packetId);
contains(pending.mount.innerHTML,'Recognized in SIM Operations');
console.log('PASS '+count+' Operations Handoff UI checks (isolated mock API requests only).');

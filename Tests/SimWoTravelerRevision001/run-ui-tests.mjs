import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'tmp/wo-traveler-revisions/' + name + '.json'), 'utf8').replace(/^\uFEFF/, ''));
const baseline = fixture('baseline'), created = fixture('draft-created'), saved = fixture('draft-saved'), approved = fixture('approved-v2');
let checks = 0, model = structuredClone(baseline), calls = [], failNext = false, discard = false;
const check = (pass, label) => { assert.ok(pass, label); checks++; };
class Node {
  constructor() { this.innerHTML = ''; this.textContent = ''; this.hidden = false; this.value = ''; this.disabled = false; this.dataset = {}; this.events = {}; this.classList = { toggle() {} }; }
  addEventListener(name, fn) { this.events[name] = fn; } setAttribute() {} querySelector(selector) { return nodes.get(selector) || null; } querySelectorAll() { return []; }
}
const mount = new Node(), nodes = new Map();
for (const id of ['productionWorkspaceSearch','productionWorkspaceRefresh','productionWorkspaceStatus','productionSelectedJobs','productionKitCompleteCount','productionKitShortCount','productionSelectedQueueTitle','productionSelectedQueueDescription','productionManagement','productionDetailMessage','woRevisionReviewed']) nodes.set('#' + id, new Node());
nodes.set('[data-workspace-mount="production"]', mount); nodes.set('[data-production-queue-view]', new Node());
const document = { querySelector: s => nodes.get(s), querySelectorAll: () => [], getElementById: id => nodes.get('#' + id) };
const row = { workOrderNumber: '0999999', actionable: true, queueKey: 'WO|0999999', relatedLines: [], canonicalWorkOrder: { workOrderNumber: '0999999' } };
const response = (data, status=200) => ({ ok: status===200, status, headers: { get: ()=>'application/json' }, json: async()=>structuredClone(data), text: async()=>'<div></div>' });
const fetch = async(url, options={}) => {
  const body = options.body ? JSON.parse(options.body) : undefined, method=options.method || 'GET'; calls.push({ url, body, method });
  if (url.endsWith('.html')) return response({});
  if (url.includes('/revisions/')) return response(baseline.effectiveRevision);
  if (method === 'GET') return response(model);
  if (failNext) { failNext=false; return response({ message:'Stale WO draft' },409); }
  if (url.endsWith('/edit')) { check(body.effectiveRevisionId===model.effectiveRevision.id, 'Edit sends effective baseline identity'); model=structuredClone(created); }
  if (url.endsWith('/draft')) { check(!('operations' in body) && body.orderedOperationIds.length===12, 'Save sends IDs only, never replacement content'); check(body.reason==='Shop-flow review', 'Save carries deliberate reason'); check(body.orderedOperationIds[0]===saved.woRevisionDraft.operations.find(o=>o.sequence===20).id, 'Move command carries changed stable-ID order'); model=structuredClone(saved); }
  if (url.endsWith('/approve')) { check(body.warningsReviewed && body.revisionId===saved.woRevisionDraft.id && body.expectedWorkingVersion===saved.woRevisionWorkingVersion, 'Approval targets reviewed draft version and warnings'); model=structuredClone(approved); }
  return response(model);
};
const window = { crypto:{randomUUID:()=> 'de02d540-80d9-4629-a9ab-f1c7903a86d9'}, fetch, confirm:()=>discard, DleWorkspaces:{ kitting:{ loadReadModel:async()=>({ queues:{kitComplete:[row],kitShort:[]} }) } }, DleWorkspaceNavigation:{ navigateToWorkspace(){} }, addEventListener(){} };
vm.runInNewContext(fs.readFileSync(path.join(root,'SRC/workspaces/production/production-workspace.js'),'utf8'),{window,document,fetch,console,Map,Set,Date,JSON,URL,encodeURIComponent});
const app=window.DleWorkspaces.production;
const html=()=>nodes.get('#productionManagement').innerHTML;
const action=async(name, dataset={})=>mount.events.click({target:{closest:s=>s==='[data-production-action]'?{dataset:{productionAction:name,...dataset}}:null}});
const panel=async(name)=>mount.events.click({target:{closest:s=>s==='[data-production-panel]'?{dataset:{productionPanel:name}}:null}});
await app.render();await app.openWorkOrder(row);
check(!html().includes('data-revision-grip='),'drag handles absent from frozen read-only route');
check(html().includes('Edit Traveler')&&html().includes('Effective Traveler v1')&&html().includes('As Quoted'),'live-style v1 header and Edit available');
check(!html().includes('Review / Revise Definition'),'bound WO does not expose source-definition editing');
check(calls.every(c=>c.method==='GET'),'opening management has no write');
check(html().includes('production-labor-worksheet')&&html().includes('production-sheet-head-readonly'),'read-only Traveler uses the shared worksheet header');
await action('edit-wo');
check(html().includes('Editing WO 0999999 only.'),'persistent WO-only banner');
check(html().includes('production-worksheet-scroll')&&html().includes('production-sheet-head'),'edit mode keeps the same bounded worksheet header');
check(html().includes('Draft Traveler v2')&&html().includes('Quote and Labor source remain unchanged.'),'explicit draft and source separation');
check(!html().includes('data-production-action="move-up"')&&!html().includes('data-production-action="move-down"'),'no visible arrow controls in edit rows');
check(!html().includes('name="shopInstructions"')&&!html().includes('name="sequence"'),'reorder-only editor has no technical or numeric sequence edits');
check(html().includes('Source seq 20')&&html().includes('20 · PCB Preparation'),'source sequence retained in collapsed source details');
check((html().match(/data-revision-grip=/g)||[]).length===12,'one visible grip per editable group');
check(!html().includes('production-reorder-menu')&&html().includes('Keyboard: focus the grip'),'redundant menu removed; keyboard instructions retained');
check(html().includes('data-wo-operation=')&&html().includes('<details')&&html().includes('/visuals/'),'expandable whole-operation details and existing visual links retained');

check(html().includes('production-sheet-columns')&&html().includes('Instructions / Notes')&&html().includes('production-sticky-actions'),'compact worksheet and sticky draft actions');
check(html().includes('aria-label="Unassigned"')&&html().includes('production-sheet-estimate'),'quiet work center and read-only estimate');
check(html().includes('Add Clarification')&&html().includes('Add Traveler Substep')&&html().includes('Add Traveler Visual'),'controlled authoring menu exposed');
const callsBeforeNote=calls.length;
await action('add-clarification',{operationId:created.woRevisionDraft.operations.find(o=>o.sequence===20).id});
check(html().includes('data-clarification-id=')&&html().includes('New draft clarification'),'plus opens contextual multiline clarification editor');
mount.events.input({target:{dataset:{clarificationId:'de02d540-80d9-4629-a9ab-f1c7903a86d9'},value:'Check polarity.',closest:()=>null}});
await action('remove-clarification',{clarificationId:'de02d540-80d9-4629-a9ab-f1c7903a86d9'});
check(!html().includes('New draft clarification')&&calls.length===callsBeforeNote,'local add/edit/remove never writes effective state');
// Drive the real delegated pointer/key handlers against deterministic layout rectangles.
// No live draft or browser endpoint is used by this test.
const initialIds=created.woRevisionDraft.operations.filter(o=>o.enabled&&o.classification==='PRODUCTION').sort((a,b)=>a.sequence-b.sequence).map(o=>o.id);
const renderedIds=()=>[...html().matchAll(/data-revision-row="([^"]+)"/g)].map(m=>m[1]);
const attachedBefore=JSON.stringify(model.woRevisionDraft.operations);
const callsBeforeDrag=calls.length;
let activeHandles=[], focusId='', cancelledFrames=0, dragWidth=1200;
document.querySelectorAll=selector=>selector==='[data-revision-grip]'?activeHandles:[];
window.innerHeight=800;window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{cancelledFrames++;};
const classes=()=>{const values=new Set();return{add:(...v)=>v.forEach(x=>values.add(x)),remove:(...v)=>v.forEach(x=>values.delete(x)),has:v=>values.has(v)};};
function dragDom() {
  const rows=renderedIds().map((id,i)=>({dataset:{revisionRow:id},classList:classes(),getBoundingClientRect:()=>({left:0,right:dragWidth,top:100+i*50,bottom:150+i*50,height:50})}));
  const list={classList:classes(),parentElement:null,querySelectorAll:()=>rows,getBoundingClientRect:()=>({left:0,right:dragWidth,top:100,bottom:100+rows.length*50})};
  activeHandles=rows.map(row=>({dataset:{revisionGrip:row.dataset.revisionRow},captured:false,attrs:{},closest:s=>s==='[data-revision-row]'?row:s==='.production-reorder-list'?list:null,
    focus(){focusId=this.dataset.revisionGrip;},setPointerCapture(){this.captured=true;},hasPointerCapture(){return this.captured;},releasePointerCapture(){this.captured=false;},setAttribute(k,v){this.attrs[k]=v;}}));
  return{rows,list,handle:id=>activeHandles.find(h=>h.dataset.revisionGrip===id)};
}
function pointer(handle,x,y,extra={}) {return{button:0,isPrimary:true,pointerId:7,clientX:x,clientY:y,preventDefault(){this.prevented=true;},target:{closest:s=>s==='[data-revision-grip]'?handle:null},...extra};}
function drag(from,to,after=false,ending='pointerup',type='mouse') {
  const dom=dragDom(),handle=dom.handle(from),source=dom.rows.find(r=>r.dataset.revisionRow===from),target=dom.rows.find(r=>r.dataset.revisionRow===to);
  mount.events.pointerdown(pointer(handle,15,source.getBoundingClientRect().top+20,{pointerType:type}));
  const y=target.getBoundingClientRect().top+(after?40:10),event=pointer(handle,15,y,{pointerType:type});
  mount.events.pointermove(event);
  check(source.classList.has('is-dragging')&&handle.attrs['aria-pressed']==='true','drag highlights complete source row');
  check(target.classList.has(after?'drop-after':'drop-before'),'clear before/after insertion marker');
  if(ending==='Escape')mount.events.keydown({...event,key:'Escape'});else mount.events[ending](event);
  check(!source.classList.has('is-dragging')&&!handle.captured&&!target.classList.has('drop-before')&&!target.classList.has('drop-after'),'drag cleanup releases capture and markers');
}
for(const width of [1280,768,375]) {
  dragWidth=width;drag(initialIds.at(-1),initialIds[0],false,'pointerup',width<800?'touch':'mouse');
  check(renderedIds()[0]===initialIds.at(-1),'top insertion at viewport width '+width);
  drag(initialIds.at(-1),initialIds.at(-2),true);
  check(JSON.stringify(renderedIds())===JSON.stringify(initialIds),'restore order after top insertion');
}
drag(initialIds[0],initialIds[5],true);check(renderedIds()[5]===initialIds[0],'middle insertion');
drag(initialIds[0],initialIds[1]);check(JSON.stringify(renderedIds())===JSON.stringify(initialIds),'middle move restored');
drag(initialIds[0],initialIds.at(-1),true);check(renderedIds().at(-1)===initialIds[0],'bottom insertion');
drag(initialIds[0],initialIds[1]);
for(const end of ['Escape','pointercancel','lostpointercapture']) {drag(initialIds[0],initialIds[3],true,end);check(JSON.stringify(renderedIds())===JSON.stringify(initialIds),end+' leaves order unchanged');}
let dom=dragDom(),handle=dom.handle(initialIds[0]);
mount.events.pointerdown(pointer(handle,15,120));mount.events.pointerup(pointer(handle,15,122));
check(JSON.stringify(renderedIds())===JSON.stringify(initialIds),'click/slight movement does not reorder');
const bodyEvent=pointer(null,200,120);mount.events.pointerdown(bodyEvent);check(!bodyEvent.prevented,'row body/summary click not hijacked');
dom=dragDom();handle=dom.handle(initialIds[0]);
mount.events.pointerdown(pointer(handle,15,120));mount.events.pointermove(pointer(handle,15,300));mount.events.pointerup(pointer(handle,dragWidth+50,300));
check(JSON.stringify(renderedIds())===JSON.stringify(initialIds),'drop outside route cancels without changing order');
const secondary=pointer(handle,15,120,{button:2});mount.events.pointerdown(secondary);check(!secondary.prevented,'secondary click does not begin drag');
dom=dragDom();handle=dom.handle(initialIds[0]);
mount.events.keydown({...pointer(handle,15,120),key:'End'});check(renderedIds().at(-1)===initialIds[0]&&focusId===initialIds[0],'keyboard End moves to bottom and retains focus');
dom=dragDom();handle=dom.handle(initialIds[0]);mount.events.keydown({...pointer(handle,15,670),key:'Home'});
check(JSON.stringify(renderedIds())===JSON.stringify(initialIds),'keyboard Home moves to top');
dom=dragDom();handle=dom.handle(initialIds[0]);mount.events.keydown({...pointer(handle,15,120),key:'ArrowDown'});
check(renderedIds()[1]===initialIds[0],'focused grip ArrowDown fallback');
dom=dragDom();handle=dom.handle(initialIds[0]);mount.events.keydown({...pointer(handle,15,170),key:'ArrowUp'});
check(JSON.stringify(renderedIds())===JSON.stringify(initialIds),'focused grip ArrowUp fallback');
check(JSON.stringify(model.woRevisionDraft.operations)===attachedBefore,'pointer/keyboard reorder does not recreate or mutate operation snapshots');
check(calls.length===callsBeforeDrag&&model.effectiveRevision.version===1,'drag and keyboard never call API or change effective v1');
check(cancelledFrames>0,'animation auto-scroll always cancelled after drag');
const expanded={dataset:{woOperation:initialIds[0]},open:true};
const management=nodes.get('#productionManagement');
management.querySelectorAll=selector=>selector==='details[data-wo-operation][open]'||selector==='details[data-wo-operation]'?[expanded]:[];
await action('move-down',{operationId:initialIds[0]});check(expanded.open,'expanded operation stays expanded after reorder render');
await action('move-up',{operationId:initialIds[0]});
const css=fs.readFileSync(path.join(root,'SRC/workspaces/production/production-workspace.css'),'utf8');
check(css.includes('touch-action:none')&&css.includes('@media(pointer:coarse),(max-width:800px)')&&css.includes('min-width:44px'),'coarse/tablet/narrow 44px grip; pointer scrolling isolated to handle');
check(css.includes('grid-template-columns:36px minmax(0,1fr)')&&css.includes('grid-template-columns:48px minmax(0,1fr)')&&!css.includes('production-reorder-menu'),'desktop and narrow gutters fit only the grip without obsolete menu styling');
check(css.includes('cursor:grab')&&css.includes('cursor:grabbing')&&css.includes('.drop-before:before')&&css.includes('.drop-after:after'),'grab/grabbing and insertion styling');
await action('move-up',{operationId:created.woRevisionDraft.operations.find(o=>o.sequence===30).id});
check(html().includes('20 · SMT Setup')&&html().includes('30 · PCB Preparation'),'move changes draft sequence only');
check(model.firstOperation.name==='PCB Preparation','effective first operation unchanged before save/approval');
await action('save-wo');check(html().includes('Enter a change reason'),'missing reason blocked before API');
mount.events.input({target:{id:'woRevisionReason',value:'Shop-flow review',closest:()=>null}});
const beforeCalls=calls.length;await action('close-wo');check(calls.length===beforeCalls&&html().includes('Editing WO'),'unsaved exit respects reviewer choice');
failNext=true;await action('save-wo');check(html().includes('Stale WO draft')&&html().includes('Shop-flow review')&&html().includes('20 · SMT Setup'),'stale save retains local order/reason');
await action('save-wo');
check(html().includes('Previous Effective v1')&&html().includes('As-Quoted Baseline v1'),'saved draft presents two baseline comparisons');
check(html().includes('Operation reordered')&&html().includes('Order changed.'),'review shows changed operations without noisy unchanged rows');
check(html().includes('REVIEW WARNING')&&html().includes('I reviewed both comparisons'),'sequence warnings and deliberate review gate');
await action('approve-wo');check(model.effectiveRevision.version===1,'unchecked review cannot approve');
nodes.get('#woRevisionReviewed').checked=true;await action('approve-wo');
check(html().includes('Effective Traveler v2')&&html().includes('WO-Specific Revision'),'approved v2 header');
check(html().includes('20 — SMT Setup')&&/class="production-start" disabled/.test(html()),'effective first op changes while Start stays disabled');
await panel('history');check(html().includes('Traveler v1 · As Quoted · Superseded')&&html().includes('Traveler v2 · WO-Specific Revision · Effective'),'history distinguishes immutable prior and effective revisions');
await action('inspect-revision',{revisionId:baseline.effectiveRevision.id});check(html().includes('Historical snapshot / Read-only')&&html().includes('Source seq 20'),'prior revision content accessible');
const readOnly=structuredClone(approved);readOnly.canManage=false;readOnly.canEditTraveler=false;
check(!app.renderWoRevisionControls(readOnly).includes('data-production-action="edit-wo"'),'read-only viewer no edit control');
const execution=structuredClone(baseline);execution.canEditTraveler=false;execution.executionStarted=true;
check(!app.renderWoRevisionControls(execution).includes('Edit Traveler'),'execution evidence hides pre-start Edit');
const parent=created.woRevisionDraft.operations.find(o=>o.sequence===20), child={...parent,id:'child',sourceOperationId:'child-source',sourceParentId:parent.sourceOperationId,sequence:20.01,sourceSequence:20.01};
const grouped=[...created.woRevisionDraft.operations,child], ids=app.revisionGroups(grouped).flat().map(o=>o.id);
const moved=app.moveRevisionGroup(grouped,ids,parent.id,1);check(moved.indexOf(child.id)===moved.indexOf(parent.id)+1,'UI moves child group together');
const inserted=app.insertRevisionGroup(grouped,ids,parent.id,initialIds.at(-1),true);check(inserted.indexOf(child.id)===inserted.indexOf(parent.id)+1&&inserted.at(-1)===child.id,'drag insertion moves intact parent/child group');
check(JSON.stringify(app.insertRevisionGroup(grouped,ids,parent.id,'foreign',true))===JSON.stringify(ids),'unknown drop target is a no-op');
check(!calls.some(c=>/start|complete|kitting|labor|quote/.test(c.url)&&c.method!=='GET'),'UI creates no execution or upstream writes');
await panel('traveler');
const authored=fixture('clarification-approved');
const authoredHtml=app.renderManagementHtml(authored);
check(authoredHtml.includes('Production clarifications · WO only')&&authoredHtml.includes('Confirm D1 and D2 polarity'),'approved clarification appears under its operation');
check(!authoredHtml.includes('data-clarification-id='),'effective clarification is read-only');
check(app.renderRevisionDiff(authored.effectiveRevision).includes('Clarification Added'),'review renders typed content diff');
const onlyContent=structuredClone(authored.effectiveRevision);
onlyContent.differences.forEach(d=>d.operations.forEach(o=>o.changed=false));
check(!app.renderRevisionDiff(onlyContent).includes('production-diff-table'),'clarification-only comparison omits route-change table');
const escaped=structuredClone(authored.operations.find(o=>o.clarifications.length));
escaped.clarifications[0].text='<img src=x onerror=alert(1)>';
check(!app.renderOperationDetails(escaped).includes('<img src=x')&&app.renderOperationDetails(escaped).includes('&lt;img'),'clarification content is escaped in read-only display');
console.log(`PASS ${checks} WO Traveler revision UI checks (isolated API fixtures)`);

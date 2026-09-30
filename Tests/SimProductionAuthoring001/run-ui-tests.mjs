import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'tmp/wo-traveler-revisions/' + name + '.json'), 'utf8').replace(/^\uFEFF/, ''));
const baseline = fixture('baseline'), created = fixture('draft-created'), saved = fixture('draft-saved'), approved = fixture('approved-v2');
let checks = 0, model = {...structuredClone(baseline),canAddTeamInput:true,canManageTeamInput:true,teamInputs:[]}, calls = [], failNext = false, discard = false;
const check = (pass, label) => { assert.ok(pass, label); checks++; };
class Node {
  constructor() { this.innerHTML = ''; this.textContent = ''; this.hidden = false; this.value = ''; this.disabled = false; this.dataset = {}; this.events = {}; this.classList = { toggle() {} }; }
  addEventListener(name, fn) { this.events[name] = fn; } setAttribute() {} querySelector(selector) { return nodes.get(selector) || null; } querySelectorAll() { return []; }
}
const mount = new Node(), nodes = new Map();
for (const id of ['productionWorkspaceSearch','productionWorkspaceRefresh','productionWorkspaceStatus','productionSelectedJobs','productionKitCompleteCount','productionKitShortCount','productionSelectedQueueTitle','productionSelectedQueueDescription','productionManagement','productionDetailMessage','woRevisionReviewed','productionImageStatus']) nodes.set('#' + id, new Node());
nodes.set('[data-workspace-mount="production"]', mount); nodes.set('[data-production-queue-view]', new Node());
const document = { querySelector: s => nodes.get(s), querySelectorAll: () => [], getElementById: id => nodes.get('#' + id) };
const row = { workOrderNumber: '0999999', actionable: true, queueKey: 'WO|0999999', relatedLines: [], canonicalWorkOrder: { workOrderNumber: '0999999' } };
const response = (data, status=200) => ({ ok: status===200, status, headers: { get: ()=>'application/json' }, json: async()=>structuredClone(data), text: async()=>'<div></div>' });
const fetch = async(url, options={}) => {
  const body = typeof options.body==='string' ? JSON.parse(options.body) : options.body, method=options.method || 'GET'; calls.push({ url, body, method });
  if(url.endsWith('/production-visuals')) return response({id:'asset-1',name:'image.png'});
  if (url.endsWith('.html')) return response({});
  if (url.includes('/revisions/')) return response(baseline.effectiveRevision);
  if (method === 'GET') return response(model);
  if (failNext) { failNext=false; return response({ message:'Stale WO draft' },409); }
  if (url.endsWith('/edit')) { check(body.effectiveRevisionId===model.effectiveRevision.id, 'Edit sends effective baseline identity'); model={...structuredClone(created),canAddTeamInput:true,canManageTeamInput:true,teamInputs:model.teamInputs}; }
  if (url.endsWith('/team-input')) { model.teamInputs=[{...body,version:body.expectedVersion+1,kind:'NOTE',author:'Test team member',createdAt:'2026-09-27T12:00:00Z',canCorrect:true,history:[]}]; }
  if(url.endsWith('/draft')) { model.woRevisionDraft.clarifications=body.clarifications;model.woRevisionDraft.substeps=body.substeps;model.woRevisionDraft.visuals=body.visuals; }
  return response(model);
};
let nextId=0;
const window = { crypto:{randomUUID:()=> 'id-'+(++nextId)}, fetch, confirm:()=>discard, DleWorkspaces:{ kitting:{ loadReadModel:async()=>({ queues:{kitComplete:[row],kitShort:[]} }) } }, DleWorkspaceNavigation:{ navigateToWorkspace(){} }, addEventListener(){} };
vm.runInNewContext(fs.readFileSync(path.join(root,'SRC/workspaces/production/production-workspace.js'),'utf8'),{window,document,fetch,console,Map,Set,Date,JSON,URL,encodeURIComponent});
const app=window.DleWorkspaces.production;
const html=()=>nodes.get('#productionManagement').innerHTML;
const action=async(name, dataset={})=>mount.events.click({target:{closest:s=>s==='[data-production-action]'?{dataset:{productionAction:name,...dataset}}:null}});
const panel=async(name)=>mount.events.click({target:{closest:s=>s==='[data-production-panel]'?{dataset:{productionPanel:name}}:null}});

await app.render();await app.openWorkOrder(row);
const op=baseline.effectiveRevision.operations.find(o=>o.enabled&&o.classification==='PRODUCTION');
const input=(field,value)=>mount.events.input({target:{dataset:{inputField:field},value,closest:()=>null}});
check(html().includes('Add Production Note')&&html().includes('Add Team Visual'),'normal menu includes Team Input');
check(!html().includes('Add Traveler Substep'),'normal mode does not expose draft authoring');
await action('add-team-note',{operationId:op.id});input('text','A team observation');
check(html().includes('Save Team Input')&&!calls.some(c=>c.url.endsWith('/edit')),'Team editor requires no edit lease');
await action('save-input');check(calls.at(-1).url.endsWith('/team-input')&&calls.at(-1).body.text==='A team observation','Team note uses independent command');
check(html().includes('not controlled instructions')&&html().includes('A team observation'),'Team evidence distinct from instructions');
const noteId=model.teamInputs[0].id;
await action('correct-team-input',{operationId:op.id,contentId:noteId});input('reason','Correction');input('text','Corrected');await action('save-input');
check(calls.at(-1).body.expectedVersion===1&&calls.at(-1).body.reason==='Correction','correction targets reviewed version and reason');
await action('add-team-visual',{operationId:op.id});check(html().includes('accept="image/png,image/jpeg"'),'upload restricts supported image formats');
mount.events.change({target:{id:'productionImageFile',files:[{name:'image.png',type:'image/png'}]}});input('text','Caption');await action('save-input');
const upload=calls.find(c=>c.url.endsWith('/production-visuals'));check(upload?.method==='POST','Team image uses WO-owned visual endpoint');
await action('add-team-visual',{operationId:op.id});let pasted=false;mount.events.paste({target:{closest:()=>true},clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>({name:'pasted.png',type:'image/png'})}]},preventDefault(){pasted=true;}});check(pasted&&nodes.get('#productionImageStatus').textContent.includes('ready to upload'),'clipboard image accepted by contextual editor');await action('cancel-input');
await action('promote-team-input',{operationId:op.id,contentId:noteId});
check(html().includes('Add Traveler Substep')&&html().includes('Add Traveler Visual')&&!html().includes('Add Production Note'),'controlled menu switches in edit mode');
check(html().includes('Corrected')&&html().includes('Enter a reason'),'promotion is a local draft copy pending reason/save/review');
const writes=calls.filter(c=>c.method!=='GET').length;
await action('add-substep',{operationId:op.id});await action('add-substep',{operationId:op.id});
let stepIds=[...html().matchAll(/data-substep-id="([^"]+)"/g)].map(m=>m[1]);
check(stepIds.length===2,'two stable local substeps');
mount.events.input({target:{dataset:{substepId:stepIds[0]},value:'First step',closest:()=>null}});mount.events.input({target:{dataset:{substepId:stepIds[1]},value:'Second step',closest:()=>null}});
await action('substep-up',{operationId:op.id,contentId:stepIds[1]});check(html().indexOf('Second step')<html().indexOf('First step'),'accessible substep reorder changes same-parent order');
await action('remove-substep',{operationId:op.id,contentId:stepIds[0]});check(!html().includes('First step'),'remove substep updates local draft');
check(calls.filter(c=>c.method!=='GET').length===writes,'local substep edits do not write live state');
await action('add-controlled-visual',{operationId:op.id});check(html().includes('Attach to draft'),'controlled image requires draft save/approval');await action('cancel-input');
// History does not mix current Team evidence into immutable snapshots.
discard=true;await action('close-wo');await panel('history');check(!html().includes('Add Production Note')&&!html().includes('Correct / withdraw'),'history has no live Team authoring actions');
model={...structuredClone(baseline),canManage:false,canEditTraveler:false,canAddTeamInput:true,canManageTeamInput:false,teamInputs:[]};await panel('traveler');await action('refresh-detail');
check(html().includes('Add Production Note')&&!html().includes('Edit Traveler'),'team-only user can author evidence without management');
await action('add-team-note',{operationId:op.id});check(!html().includes('Management only'),'team-only user cannot choose restricted audience');await action('cancel-input');
model.canAddTeamInput=false;await action('refresh-detail');check(!html().includes('Add Production Note'),'reader has no authoring menu');
check(!calls.some(c=>/start|approve/.test(c.url)),'no execution or automatic approval calls');
console.log('PASS '+checks+' two-lane UI checks');

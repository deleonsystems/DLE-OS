(function(window,document){
 'use strict';
 const pending=new Map();
 async function load(name,global){if(window[global])return;if(!pending.has(name))pending.set(name,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/incoming/SRC/'+name;s.onload=resolve;s.onerror=()=>{pending.delete(name);s.remove();reject(Error('BOM renderer unavailable. Retry.'));};document.head.append(s);}));await pending.get(name);}
 async function ready(){await Promise.all([load('shared/bom-report.js','DleBomReport'),load('workspaces/rfqs/bom-process.js','DleBomProcess'),load('workspaces/rfqs/labor-bom-slides-v3.js','DleLaborBomSlidesV3')]);}
 async function read(url,identity){
  await ready();const legacy=await window.DleLaborBomSlidesV3.read(url,identity),response=await window.DleIntegration.request(url.replace(/\/bom-reference$/,'/labor'),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Quote identity unavailable.');const view=await response.json();
  if(view.plan.definitionId!==identity.definitionId||view.rfq.assemblies[0].assemblyNumber!==identity.assembly||view.rfq.assemblies[0].revision!==identity.revision)throw Error('BOM and Labor identity changed. Reopen Labor.');
  const quantity=view.plan.quantity,process=await window.DleBomProcess.read(url);
  if(process.sourceHash!==legacy.source.sha256||process.rows.length!==legacy.rows.length)throw Error('The BOM changed. Reopen it before editing or printing.');
  return compose(legacy,view.rfq,quantity,process);
 }
 async function fromFrozen(snapshot,identity){
  await ready();const data=await compose(await window.DleLaborBomSlidesV3.fromHtml(snapshot.html,identity),snapshot.rfq,snapshot.quantity,snapshot.process);
  data.sourceRowIds=snapshot.rfq?.inputs?.materials?.candidate?.rows?.map(r=>r.rowId);return data;
 }
 async function compose(legacy,rfq,quantity,process){
  const sourceFor=async version=>({...legacy.source,documentId:version,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(version+'\n'+legacy.source.sha256+'\n'+quantity)))].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()});
  const v4={...legacy,source:await sourceFor('bom-reference-v4')};
  return {...legacy,legacy,v4,rfq,quantity,process,source:await sourceFor('bom-reference-v5')};
 }
 async function loadSavedDraft(wo,expected){
  if(!expected)throw Error('Verified work-order material source is unavailable. Reopen this job.');
  const base='/api/kitting-cases/v1/work-orders/'+encodeURIComponent(wo);
  const read=async suffix=>{const r=await window.DleIntegration.request(base+suffix,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Saved Kitting evidence unavailable ('+r.status+').');return r.json();};
  const review=await read(''),kit=review.kittingCase;
  const matches=k=>k&&k.caseId===expected.caseId&&k.workOrderNumber===wo&&k.releasedBomIdentity===expected.releasedBomIdentity&&k.workingVersion===expected.workingVersion&&k.state===expected.state;
  if(review.workOrderNumber!==wo||!matches(kit))throw Error('Saved Kitting source/version does not match this work order. Reopen to refresh.');
  if(kit.state!=='KIT_COMPLETE')return kit.draft;
  const history=await read('/submissions'),sub=history.submissions?.find(s=>s.submissionId===expected.submissionId&&s.caseId===kit.caseId&&s.submissionType==='KIT_COMPLETE');
  if(history.workOrderNumber!==wo||!sub)throw Error('Final Kitting submission is unavailable.');
  let snapshot;try{snapshot=JSON.parse(sub.snapshotJson);}catch{throw Error('Final Kitting evidence is unreadable.');}
  if(snapshot.workOrderNumber!==wo||snapshot.caseId!==kit.caseId||snapshot.releasedBomIdentity!==kit.releasedBomIdentity||snapshot.submissionId!==sub.submissionId||snapshot.submissionType!=='KIT_COMPLETE'||!sub.submittedBy||snapshot.submittedBy!==sub.submittedBy||snapshot.submittedAtUtc!==sub.submittedAtUtc||!Number.isFinite(Date.parse(sub.submittedAtUtc)))throw Error('Final Kitting evidence identity mismatch.');
  const after=await read('');if(after.workOrderNumber!==wo||!matches(after.kittingCase))throw Error('Kitting changed while loading this BOM. Reopen to refresh.');
  return snapshot.draft;
 }
 // Frozen source-row IDs identify evidence; older references retain their immutable process-key join.
 async function refresh(data){
  if(!data?.loadWorkOrderDraft)return;
  const request=(data.resultReadVersion||0)+1;data.resultReadVersion=request;
  data.savedDraft=null;
  const draft=await data.loadWorkOrderDraft();
  if(request!==data.resultReadVersion)throw Error('A newer BOM result read is in progress. Reopen this slide.');
  if(!draft)return;
  const assembly=data.rfq?.assemblies?.[0],header=draft.header||{};
  if(String(draft.workOrder)!==String(data.workOrder)||header.billNumber!==assembly?.assemblyNumber||header.revision!==assembly?.revision||Number(header.scheduledProduction)!==Number(data.quantity))throw Error('Saved Kitting BOM identity changed. Reopen this work order.');
  if(data.sourceRowIds){
   const expected=new Set(data.sourceRowIds),ids=new Set();
   if(expected.size!==data.rows.length||data.sourceRowIds.length!==data.rows.length||expected.has(undefined)||expected.has(''))throw Error('Accepted BOM source-row identities are unavailable or ambiguous.');
   for(const g of draft.groups||[]){if(!g.sourceRowId||ids.has(g.sourceRowId)||!expected.has(g.sourceRowId))throw Error('Saved Kitting source row does not match the accepted BOM.');ids.add(g.sourceRowId);}
   if(ids.size!==expected.size)throw Error('Saved Kitting evidence is missing accepted BOM rows.');
   data.savedDraft=draft;return;
  }
  const keys=new Set(),ids=new Set(),expected=new Set(data.process.rows.map(r=>r.key));
  if(expected.size!==data.rows.length||expected.has(undefined)||expected.has(''))throw Error('Accepted BOM line keys are unavailable or ambiguous.');
  for(const g of draft.groups||[]){if(!g.sourceRowId||ids.has(g.sourceRowId)||!g.process?.key||keys.has(g.process.key)||!expected.has(g.process.key))throw Error('Saved Kitting line identity is unavailable or ambiguous.');keys.add(g.process.key);ids.add(g.sourceRowId);}
  if(keys.size!==expected.size)throw Error('Saved Kitting BOM lines do not match the accepted source.');
  data.savedDraft=draft;
 }
 function displayDraft(data,indices){
  const draft=window.DleBomReport.quoteDraft(indices.map(i=>data.rows[i]),data.rfq,data.quantity);
  const saved=new Map((data.savedDraft?.groups||[]).map(g=>[data.sourceRowIds?g.sourceRowId:g.process.key,g]));
  draft.groups=draft.groups.map((g,i)=>{const index=indices[i],process=data.process?.rows[index],match=saved.get(data.sourceRowIds?data.sourceRowIds[index]:process?.key);
   return match?{...structuredClone(match),process:match.process||process,entry:match.rowState==='SUBMITTED'?structuredClone(match.entry):null}:{...g,sequence:String(index+1),requiredQuantity:data.workOrder?window.DleBomReport.multiply(g.requiredEach,data.quantity):undefined,process};
  });
  if(data.workOrder){draft.workOrder=data.workOrder;draft.header={...draft.header,...data.savedDraft?.header,workOrder:data.workOrder};}
  return draft;
 }
 function navigation(data){return data.workOrder?{context:'RELEASED',releasedWorksheet:true}:{};}
 function matches(data,source){const ref=source?.documentId==='bom-reference-v3'?data?.legacy:source?.documentId==='bom-reference-v4'?data?.v4:data;return !!ref&&ref.source.documentId===source?.documentId&&ref.source.sha256===source?.sha256;}
 function quoteSvg(data,page,source=data.source,compact=false){if(!matches(data,source))throw Error('BOM source changed. Existing overlays are preserved.');if(source.documentId==='bom-reference-v3')return window.DleLaborBomSlidesV3.svg(data.legacy,page);
  const fragments=data.pages[page-1];if(!fragments)throw Error('BOM page unavailable.');const rows=fragments.map(r=>r.cells.map(c=>c.join(''))),draft=window.DleBomReport.quoteDraft(rows,data.rfq,data.quantity);draft.groups.forEach((g,i)=>{g.requiredEach=data.rows[fragments[i].row-1][5];if(compact){const value=data.process?.rows[fragments[i].row-1];g.process=fragments[i].continued&&value?{...value,notes:''}:value;}g.sequence=String(fragments[i].row)+(fragments[i].continued?' (cont.)':'');});return window.DleBomReport.svg(draft,page,data.pages.length,source.documentId==='bom-reference-v5',compact);
 }
 function svg(data,page,source=data.source,compact=false){if(!data.workOrder)return quoteSvg(data,page,source,compact);if(!matches(data,source))throw Error('BOM source changed. Existing overlays are preserved.');
  const fragments=data.pages[page-1];if(!fragments)throw Error('BOM page unavailable.');const draft=displayDraft(data,fragments.map(r=>r.row-1));
  return window.DleBomReport.svg(draft,page,data.pages.length,source.documentId==='bom-reference-v5',compact,navigation(data));
 }
 // All operations derive their display from the same freshly read saved case.
 function flowSvg(data,pages=data.pages.map((_,i)=>i+1)){
  const indices=[...new Set(pages.flatMap(page=>(data.pages[page-1]||[]).map(r=>r.row-1)))];
  return window.DleBomReport.svg(displayDraft(data,indices),null,null,true,true,navigation(data));
 }
 async function quoteDocument(url,compact=false){const response=await window.DleIntegration.request(url.replace(/\/bom-reference$/,'/labor'),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Quote identity unavailable.');const v=await response.json(),a=v.rfq.assemblies[0];const data=await read(url,{definitionId:v.plan.definitionId,assembly:a.assemblyNumber,revision:a.revision});if(compact){
   await load('workspaces/rfqs/labor-letter-pages.js','DleLaborLetterPages');
   const forms=window.DleLaborLetterPages,context='QUOTE | '+a.assemblyNumber+' | Rev '+a.revision+' | Qty '+data.quantity;
   const result=await forms.compose({kind:'BOM',layer:{page:1,marks:[],photos:[]},caption:'',context,loadBase:async()=>new Response(flowSvg(data),{headers:{'Content-Type':'image/svg+xml'}})});
   return forms.document(result);
  }
  return window.DleBomReport.document(window.DleBomReport.quoteDraft(data.rows,data.rfq,data.quantity),{context:'QUOTE',returnUrl:'/',fairLabels:true});}
 window.DleLaborBomSlides=Object.freeze({read,fromFrozen,loadSavedDraft,refresh,displayDraft,svg,flowSvg,matches,ready,quoteDocument,paginate:rows=>window.DleLaborBomSlidesV3.paginate(rows)});
})(window,document);

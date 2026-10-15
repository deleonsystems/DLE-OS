(function(window,document){
 'use strict';
 const pending=new Map();
 async function load(name,global){if(window[global])return;if(!pending.has(name))pending.set(name,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/SRC/'+name;s.onload=resolve;s.onerror=()=>{pending.delete(name);s.remove();reject(Error('BOM renderer unavailable. Retry.'));};document.head.append(s);}));await pending.get(name);}
 async function ready(){await Promise.all([load('shared/bom-report.js','DleBomReport'),load('workspaces/rfqs/bom-process.js','DleBomProcess'),load('workspaces/rfqs/labor-bom-slides-v3.js','DleLaborBomSlidesV3')]);}
 async function read(url,identity){
  await ready();const legacy=await window.DleLaborBomSlidesV3.read(url,identity),response=await fetch(url.replace(/\/bom-reference$/,'/labor'),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Quote identity unavailable.');const view=await response.json();
  if(view.plan.definitionId!==identity.definitionId||view.rfq.assemblies[0].assemblyNumber!==identity.assembly||view.rfq.assemblies[0].revision!==identity.revision)throw Error('BOM and Labor identity changed. Reopen Labor.');
  const quantity=view.plan.quantity,process=await window.DleBomProcess.read(url);
  if(process.sourceHash!==legacy.source.sha256||process.rows.length!==legacy.rows.length)throw Error('The BOM changed. Reopen it before editing or printing.');
  return compose(legacy,view.rfq,quantity,process);
 }
 async function fromFrozen(snapshot,identity){
  await ready();return compose(await window.DleLaborBomSlidesV3.fromHtml(snapshot.html,identity),snapshot.rfq,snapshot.quantity,snapshot.process);
 }
 async function compose(legacy,rfq,quantity,process){
  const sourceFor=async version=>({...legacy.source,documentId:version,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(version+'\n'+legacy.source.sha256+'\n'+quantity)))].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()});
  const v4={...legacy,source:await sourceFor('bom-reference-v4')};
  return {...legacy,legacy,v4,rfq,quantity,process,source:await sourceFor('bom-reference-v5')};
 }
 function matches(data,source){const ref=source?.documentId==='bom-reference-v3'?data?.legacy:source?.documentId==='bom-reference-v4'?data?.v4:data;return !!ref&&ref.source.documentId===source?.documentId&&ref.source.sha256===source?.sha256;}
 function svg(data,page,source=data.source,compact=false){if(!matches(data,source))throw Error('BOM source changed. Existing overlays are preserved.');if(source.documentId==='bom-reference-v3')return window.DleLaborBomSlidesV3.svg(data.legacy,page);
  const fragments=data.pages[page-1];if(!fragments)throw Error('BOM page unavailable.');const rows=fragments.map(r=>r.cells.map(c=>c.join(''))),draft=window.DleBomReport.quoteDraft(rows,data.rfq,data.quantity);draft.groups.forEach((g,i)=>{g.requiredEach=data.rows[fragments[i].row-1][5];if(compact){const value=data.process?.rows[fragments[i].row-1];g.process=fragments[i].continued&&value?{...value,notes:''}:value;}g.sequence=String(fragments[i].row)+(fragments[i].continued?' (cont.)':'');});return window.DleBomReport.svg(draft,page,data.pages.length,source.documentId==='bom-reference-v5',compact);
 }
 // Reflow current unannotated employee pages together; stored source pages remain immutable.
 function flowSvg(data,pages=data.pages.map((_,i)=>i+1)){
  const indices=[...new Set(pages.flatMap(page=>(data.pages[page-1]||[]).map(r=>r.row-1)))];
  const draft=window.DleBomReport.quoteDraft(indices.map(i=>data.rows[i]),data.rfq,data.quantity);
  draft.groups.forEach((g,i)=>{g.sequence=String(indices[i]+1);g.process=data.process?.rows[indices[i]];});
  return window.DleBomReport.svg(draft,null,null,true,true);
 }
 async function quoteDocument(url,compact=false){const response=await fetch(url.replace(/\/bom-reference$/,'/labor'),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Quote identity unavailable.');const v=await response.json(),a=v.rfq.assemblies[0];const data=await read(url,{definitionId:v.plan.definitionId,assembly:a.assemblyNumber,revision:a.revision});if(compact){
   await load('workspaces/rfqs/labor-letter-pages.js','DleLaborLetterPages');
   const forms=window.DleLaborLetterPages,context='QUOTE | '+a.assemblyNumber+' | Rev '+a.revision+' | Qty '+data.quantity;
   const result=await forms.compose({kind:'BOM',layer:{page:1,marks:[],photos:[]},caption:'',context,loadBase:async()=>new Response(flowSvg(data),{headers:{'Content-Type':'image/svg+xml'}})});
   return forms.document(result);
  }
  return window.DleBomReport.document(window.DleBomReport.quoteDraft(data.rows,data.rfq,data.quantity),{context:'QUOTE',returnUrl:'/',fairLabels:true});}
 window.DleLaborBomSlides=Object.freeze({read,fromFrozen,svg,flowSvg,matches,ready,quoteDocument,paginate:rows=>window.DleLaborBomSlidesV3.paginate(rows)});
})(window,document);

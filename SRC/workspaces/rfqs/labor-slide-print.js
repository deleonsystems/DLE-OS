(function(window,document){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function open({trigger,label,dirty=false,prepare,engine}){
  engine=engine||(typeof DlePrintEngine==='undefined'?window.DlePrintEngine:DlePrintEngine);
  document.getElementById('laborOperationPrint')?.close();
  const d=document.createElement('dialog');d.id='laborOperationPrint';d.setAttribute('aria-label','Print this operation');d.style.cssText='width:min(1180px,96vw);max-width:96vw;height:94vh;padding:12px;box-sizing:border-box;border:1px solid #789;background:#eef2f5;color:#172d3d;font:14px/1.4 Arial,sans-serif;display:flex;flex-direction:column;gap:8px';
  d.innerHTML='<header style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><strong style="margin-right:auto">Print: '+esc(label)+'</strong><button type="button" data-print disabled>Print / Save PDF</button><button type="button" data-close>Back to slideshow</button></header><p style="margin:0">'+esc(label)+' only. '+(dirty?'Includes unsaved Labor draft changes. ':'')+'Portrait forms and landscape drawings. Drawings use saved opening views. Letter paper; 100% scale; headers and footers off. Pages already include a half-inch printer margin. For mixed orientations, save a PDF and print with automatic page rotation.</p><div data-choices hidden><label>Print <select data-mode aria-label="Print selection"><option value="all">Whole operation</option><option value="current">Current slide</option><option value="selected">Selected slides / pages</option><option value="range">Slide range</option></select></label> <span data-range hidden><label>From slide <input data-from type="number" min="1" value="1" style="width:60px"></label> <label>to <input data-to type="number" min="1" value="1" style="width:60px"></label></span><details><summary>Choose slides and individual printable pages</summary><div data-list style="max-height:180px;overflow:auto"></div></details><small>Slide numbers are positions in this operation. Printed page numbers count only the selected sheets.</small></div><p role="status" style="margin:0">Preparing slides...</p><iframe title="Operation slides print preview" style="width:100%;flex:1;min-height:0;border:1px solid #a5b6c6;background:white"></iframe>';
  const style=document.createElement('style');style.textContent=`#laborOperationPrint header{background:transparent!important;color:#172d3d!important;padding:0!important;min-height:0!important}#laborOperationPrint strong,#laborOperationPrint label,#laborOperationPrint small,#laborOperationPrint summary{color:#172d3d!important}#laborOperationPrint label{display:inline-flex!important;align-items:center;gap:6px;margin:0!important;font:14px Arial!important}#laborOperationPrint select{display:inline-block!important;width:auto!important;min-width:0!important;max-width:100%;padding:6px;background:white!important;color:#172d3d!important;border:1px solid #789;border-radius:4px;font:14px Arial}#laborOperationPrint input[type=checkbox]{display:inline-block!important;width:18px!important;height:18px!important;min-height:0!important;margin:4px!important;padding:0!important;flex:none}#laborOperationPrint input[type=number]{display:inline-block!important;background:white!important;color:#172d3d!important;padding:4px;min-height:24px;font:14px Arial}#laborOperationPrint [data-list]>div{display:flex;flex-wrap:wrap;align-items:center;gap:4px;border-bottom:1px solid #d2dbe2}#laborOperationPrint details{margin:6px 0}#laborOperationPrint summary{cursor:pointer}#laborOperationPrint small{display:block;margin-top:5px}`;d.prepend(style);
  for(const b of d.querySelectorAll('button'))b.style.cssText='min-height:44px;padding:6px 12px;font:14px Arial,sans-serif';
  const abort=new AbortController(),status=d.querySelector('[role=status]'),button=d.querySelector('[data-print]'),frame=d.querySelector('iframe'),mode=d.querySelector('[data-mode]');let closed=false,definition,renderVersion=0;
  d.querySelector('[data-close]').onclick=()=>d.close();
  d.addEventListener('close',()=>{closed=true;abort.abort();d.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});},{once:true});
  button.onclick=async()=>{if(!definition||closed)return;button.disabled=true;try{await engine.print(definition);}catch(error){status.textContent='Print could not open: '+error.message;}finally{if(!closed)button.disabled=false;}};
  document.body.append(d);d.showModal();
  try{
   if(!engine?.buildPrintDocument||!engine?.print)throw Error('Preserve your edits, then refresh SIM to load the shared print preview.');
   const source=await prepare();if(closed)return;const forms=await window.DleLaborDrawingNotes.letterPages(),pages=[],slides=[],selected=new Set();
   if(!source.frames.length)throw Error('This operation has no slides.');
   for(const [index,f]of source.frames.entries()){
    if(closed)return;if(f.unavailable)throw Error('Slide '+(index+1)+': '+(f.card.body||'Source unavailable.'));
    status.textContent='Preparing slide '+(index+1)+' of '+source.frames.length+'...';
    const options=f=>({kind:f.card.kind,summary:source.summary(f),loadBase:signal=>source.loadBase(f,signal),loadPhoto:source.loadPhoto,layer:{...f.stage,page:f.card.page},caption:source.caption(f),context:source.traveler?[source.traveler.workOrder||'QUOTE',source.traveler.assembly,source.traveler.revision?'Rev '+source.traveler.revision:'','Qty '+source.traveler.quantity].filter(Boolean).join(' · '):'',signal:abort.signal});
    const result=f.bomFrames&&!source.continuousBom?.(f)?await forms.composeMany(f.bomFrames.map(options)):await forms.compose(options(f));
    const holder=document.createElement('div');holder.innerHTML=result.html;const ids=[];
    for(const node of holder.querySelectorAll('.letter-page')){ids.push(pages.length);selected.add(pages.length);pages.push(node);}
    slides.push({ids,title:f.card.kind==='START'?'Traveler page':f.bomFrames?'BOM reference':f.card.title||f.card.kind});
   }
   if(closed)return;
   const list=d.querySelector('[data-list]');list.innerHTML=slides.map((s,i)=>'<div style="padding:4px"><label><input type="checkbox" data-slide="'+i+'" checked> Slide '+(i+1)+': '+esc(s.title)+' ('+s.ids.length+' printable '+(s.ids.length===1?'page':'pages')+')</label><span style="display:inline-flex;flex-wrap:wrap;gap:8px;margin-left:16px">'+s.ids.map((id,j)=>'<label><input type="checkbox" data-page="'+id+'" checked> Page '+(j+1)+' of '+s.ids.length+'</label>').join('')+'</span></div>').join('');
   d.querySelector('[data-choices]').hidden=false;d.querySelector('[data-from]').max=slides.length;d.querySelector('[data-to]').max=slides.length;d.querySelector('[data-to]').value=slides.length;
   function render(){
    const version=++renderVersion;button.disabled=true;definition=null;const chosen=pages.filter((_,i)=>selected.has(i));
    for(const c of list.querySelectorAll('[data-page]'))c.checked=selected.has(Number(c.dataset.page));
    for(const c of list.querySelectorAll('[data-slide]')){const ids=slides[Number(c.dataset.slide)].ids;c.checked=ids.every(id=>selected.has(id));c.indeterminate=!c.checked&&ids.some(id=>selected.has(id));}
    if(!chosen.length){status.textContent='Choose at least one printable page.';frame.srcdoc='<!doctype html><p>No pages selected.</p>';return;}
    const html=chosen.map((original,i)=>{const node=original.cloneNode(true);node.dataset.printedPage=i+1;node.querySelector(':scope > svg')?.setAttribute('aria-label','Printed page '+(i+1)+' of '+chosen.length);const footer=node.querySelector('.letter-footer');if(footer)for(const n of footer.childNodes)if(n.nodeType===3)n.textContent=n.textContent.replace(/Page \d+ of \d+/,'Page '+(i+1)+' of '+chosen.length);return node.outerHTML;}).join('');
    const orientation=chosen.every(node=>node.classList.contains('portrait'))?'portrait':'landscape';
    const next=engine.normalizePrintDefinition({documentName:'Operation slides - '+label,paperSize:'letter',orientation,margins:'.5in',html,css:forms.printCss?.(orientation)||forms.css});
    frame.onload=async()=>{if(closed||version!==renderVersion)return;try{await frame.contentDocument.fonts.ready;await Promise.all([...frame.contentDocument.images].map(i=>i.decode()));if(closed||version!==renderVersion)return;definition=next;status.textContent=chosen.length+' printed pages selected from '+slides.length+' slideshow positions. Preview only; nothing has been printed.';button.disabled=false;}catch(error){status.textContent='Preview unavailable: '+error.message;}};
    frame.srcdoc=engine.buildPrintDocument(next);
   }
   function applyMode(){
    d.querySelector('[data-range]').hidden=mode.value!=='range';
    if(mode.value==='selected'){render();return;}
    selected.clear();let from=0,to=slides.length-1;
    if(mode.value==='current')from=to=Math.max(0,Math.min(slides.length-1,source.currentIndex||0));
    if(mode.value==='range'){const a=Number(d.querySelector('[data-from]').value),b=Number(d.querySelector('[data-to]').value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>slides.length){render();status.textContent='Enter a slide range from 1 to '+slides.length+'.';return;}from=a-1;to=b-1;}
    for(let i=from;i<=to;i++)for(const id of slides[i].ids)selected.add(id);render();
   }
   mode.onchange=applyMode;d.querySelector('[data-from]').oninput=applyMode;d.querySelector('[data-to]').oninput=applyMode;
   list.onchange=e=>{const c=e.target;if(!c.matches('input'))return;const ids=c.hasAttribute('data-slide')?slides[Number(c.dataset.slide)].ids:[Number(c.dataset.page)];for(const id of ids)if(c.checked)selected.add(id);else selected.delete(id);mode.value='selected';d.querySelector('[data-range]').hidden=true;render();};
   render();
  }catch(error){if(!closed){definition=null;status.textContent='Preview unavailable: '+error.message+' Nothing has been printed.';button.disabled=true;}}
 }
 window.DleLaborSlidePrint=Object.freeze({open});
})(window,document);

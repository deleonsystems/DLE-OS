(function(window,document){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ns='http://www.w3.org/2000/svg';
 const styleProperties=['display','list-style-type','list-style-position','color','background-color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-transform','text-decoration','text-align','white-space','overflow-wrap','word-break','box-sizing','grid-template-columns','column-gap','row-gap','min-width','min-height','margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','border-top','border-right','border-bottom','border-left'];
 function freezeStyles(node){const all=[node,...node.querySelectorAll('*')];for(const el of all){const style=getComputedStyle(el);for(const key of styleProperties)el.style.setProperty(key,style.getPropertyValue(key));}}
 function dataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Could not read a slide asset.'));r.readAsDataURL(blob);});}
 async function picture(blob){if(!blob.type.startsWith('image/'))throw Error('Slide image unavailable.');const url=await dataUrl(blob),probe=new Image();probe.src=url;await probe.decode();return{url,width:probe.naturalWidth,height:probe.naturalHeight};}
 const css=`
 @page{size:letter landscape;margin:.3in}
 html,body{margin:0;background:white;color:#172d3d;font-family:Arial,sans-serif;print-color-adjust:exact;-webkit-print-color-adjust:exact}
 .slide-print-page{box-sizing:border-box;height:7.85in;width:10.4in;display:flex;flex-direction:column;break-after:page;page-break-after:always;margin:0;overflow:hidden}
 .slide-print-page:last-child{break-after:auto;page-break-after:auto}
 .slide-print-caption{flex:none;font:12px/1.25 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;border-bottom:1px solid #a5b5c1;padding:3px 0 7px;margin:0 0 5px}
 .slide-print-caption strong{display:block;font-size:13px;margin-bottom:3px}
 .slide-print-footer{flex:none;margin-top:7px;padding-top:6px;border-top:1px solid #a5b5c1;font:11px/1.3 Arial,sans-serif;color:#243746;overflow-wrap:anywhere}.slide-print-footer strong{font-weight:600}.slide-print-footer span{display:block;margin-top:2px}
 .slide-print-art{display:block;width:100%;flex:1 1 auto;min-height:0;overflow:hidden}
 @media screen{html,body{background:#dce3e8}.slide-print-page{margin:12px auto;padding:10px;background:white;box-shadow:0 1px 5px #789;width:min(10.4in,calc(100vw - 24px));height:min(7.85in,calc((100vw - 24px)*.7548077))}}
 `;
 async function open({trigger,label,dirty=false,prepare,engine}){
  engine=engine||(typeof DlePrintEngine==='undefined'?window.DlePrintEngine:DlePrintEngine);
  document.getElementById('laborOperationPrint')?.close();
  const d=document.createElement('dialog');d.id='laborOperationPrint';d.setAttribute('aria-label','Print this operation');d.style.cssText='width:min(1180px,96vw);max-width:96vw;height:94vh;padding:12px;box-sizing:border-box;border:1px solid #789;background:#eef2f5;color:#172d3d;font:14px/1.4 Arial,sans-serif;display:flex;flex-direction:column;gap:8px';
  d.innerHTML='<header style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><strong style="margin-right:auto">Print this operation: '+esc(label)+'</strong><button type="button" data-print disabled>Print / Save PDF</button><button type="button" data-close>Back to slideshow</button></header><p data-scope style="margin:0">'+esc(label)+' only. Each stage prints separately; long reading pages continue. '+(dirty?'Includes unsaved Labor draft changes. ':'')+'Uses saved opening views.</p><p role="status" style="margin:0">Preparing slides...</p><iframe title="Operation slides print preview" style="width:100%;flex:1;min-height:0;border:1px solid #a5b6c6;background:white"></iframe>';
  for(const b of d.querySelectorAll('button'))b.style.cssText='min-height:44px;padding:6px 12px;font:14px Arial,sans-serif';
  const abort=new AbortController(),holder=document.createElement('div');holder.style.cssText='position:fixed;left:-20000px;top:0;width:1200px;visibility:hidden;pointer-events:none';document.body.append(holder);
  const status=d.querySelector('[role=status]'),button=d.querySelector('[data-print]'),frame=d.querySelector('iframe');let closed=false,definition;
  d.querySelector('[data-close]').onclick=()=>d.close();
  d.addEventListener('close',()=>{closed=true;abort.abort();holder.remove();d.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});},{once:true});
  button.onclick=async()=>{if(!definition||closed)return;button.disabled=true;try{await engine.print(definition);}catch(error){status.textContent='Print could not open: '+error.message;}finally{if(!closed)button.disabled=false;}};
  document.body.append(d);d.showModal();
  try{
   if(!engine?.buildPrintDocument||!engine?.print)throw Error('Preserve your edits, then refresh SIM to load the shared print preview.');
   const source=await prepare();if(closed)return;const pages=[];
   if(!source.frames.length)throw Error('This operation has no slides.');
   for(const [index,f]of source.frames.entries()){
    if(closed)return;if(f.unavailable)throw Error('Page '+(index+1)+': '+(f.card.body||'Source unavailable or changed. Reopen the slideshow to retry.'));
    status.textContent='Preparing page '+(index+1)+' of '+source.frames.length+'...';
    const svg=document.createElementNS(ns,'svg');svg.classList.add('slide-print-art');svg.setAttribute('viewBox','0 0 1200 800');svg.setAttribute('width','1200');svg.setAttribute('height','800');svg.setAttribute('role','img');svg.setAttribute('aria-label',f.card.title+' / '+f.stage.name);svg.dataset.cardId=f.card.id;svg.dataset.stageId=f.stage.id;const group=document.createElementNS(ns,'g');svg.append(group);holder.replaceChildren(svg);let paper;
    const summary=source.summary(f);
    if(summary){paper=window.DleLaborDrawingNotes.appendStartBase(group,summary);freezeStyles(group.querySelector('[data-protected-base] > *'));}
    else{const response=await source.loadBase(f,abort.signal);if(!response.ok)throw Error('Page '+(index+1)+': source image unavailable.');const pic=await picture(await response.blob());paper={width:pic.width,height:pic.height};const img=document.createElementNS(ns,'image');for(const[k,v]of Object.entries({href:pic.url,width:paper.width,height:paper.height}))img.setAttribute(k,v);group.append(img);}
    for(const photo of f.stage.photos||[]){const pic=await picture(await source.loadPhoto(photo,abort.signal));const img=document.createElementNS(ns,'image');for(const[k,v]of Object.entries({href:pic.url,x:photo.x*paper.width,y:photo.y*paper.height,width:photo.width*paper.width,height:photo.height*paper.height,transform:'rotate('+(photo.rotation||0)+' '+(photo.x+photo.width/2)*paper.width+' '+(photo.y+photo.height/2)*paper.height+')',preserveAspectRatio:'xMidYMid meet'}))img.setAttribute(k,v);group.append(img);}
    for(const mark of f.stage.marks.filter(m=>m.page===f.card.page))window.DleLaborDrawingNotes.appendMark(group,mark,paper);
    const saved=f.stage.savedView,fullReading=summary&&paper.height>800&&saved.width===1&&saved.height===1&&saved.rotation===0;
    const ranges=[];
    if(fullReading){
     // Break between text lines at the original reading size; never shrink a long note to fit.
     const rects=[],top=svg.getBoundingClientRect().top,walker=document.createTreeWalker(group,NodeFilter.SHOW_TEXT);let node;
     while(node=walker.nextNode()){if(!node.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(node);for(const box of r.getClientRects())rects.push({top:box.top-top,bottom:box.bottom-top});}
     for(let start=0;start<paper.height;){let end=Math.min(start+800,paper.height),changed=true;while(changed){changed=false;for(const r of rects)if(r.top<end&&r.bottom>end){end=Math.floor(r.top-2);changed=true;}}if(end<=start)throw Error('Reading page could not be paginated safely.');ranges.push({start,end});start=end;}
    }else ranges.push(null);
    for(const [part,range]of ranges.entries()){
     const pageSvg=svg.cloneNode(true),content=pageSvg.firstElementChild;
     if(range){content.setAttribute('transform','translate(0 '+(-range.start)+')');const id='reading-clip-'+index+'-'+part,defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),rect=document.createElementNS(ns,'rect');clip.id=id;rect.setAttribute('width','1200');rect.setAttribute('height',String(range.end-range.start));clip.append(rect);defs.append(clip);const wrapper=document.createElementNS(ns,'g');wrapper.setAttribute('clip-path','url(#'+id+')');wrapper.append(content);pageSvg.append(defs,wrapper);}
     else{const m=window.DleLaborDrawingNotes.transform(saved,paper,{width:1200,height:800});content.setAttribute('transform',`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);}
     pageSvg.dataset.savedView=JSON.stringify(saved);pages.push({svg:pageSvg.outerHTML,f,part});
    }
   }
   if(closed)return;holder.replaceChildren();
   definition=engine.normalizePrintDefinition({documentName:'Operation slides - '+label,paperSize:'letter',orientation:'landscape',margins:'.3in',html:pages.map((p,i)=>{const meta=source.traveler||{},context=[meta.workOrder||'QUOTE',meta.assembly?'Assembly '+meta.assembly:'',meta.revision?'Rev '+meta.revision:'',label,'Page '+(i+1)+' of '+pages.length].filter(Boolean).join(' | ');return '<section class="slide-print-page"><header class="slide-print-caption"><strong>'+esc(label)+' | Page '+(i+1)+' of '+pages.length+' | Slide '+(p.f.ci+1)+' / Stage '+(p.f.si+1)+(p.part?' (continued)':'')+'</strong>'+esc(source.caption(p.f))+'</header>'+p.svg+'<footer class="slide-print-footer"><strong>UNCONTROLLED WHEN PRINTED &#8212; Verify current revision in DLE-OS</strong><span>'+esc(context)+'</span></footer></section>';}).join(''),css});
   frame.onload=async()=>{if(closed)return;try{await frame.contentDocument.fonts.ready;await Promise.all([...frame.contentDocument.images].map(i=>i.decode()));if(closed)return;const tooLong=[...frame.contentDocument.querySelectorAll('.slide-print-page')].some(p=>p.querySelector('.slide-print-caption').getBoundingClientRect().height>p.getBoundingClientRect().height-100);if(tooLong)throw Error('Slide text is too long for one printed page. Shorten the slide text before printing.');status.textContent=pages.length+' pages ready for '+label+'. Preview only; nothing has been printed.';button.disabled=false;}catch(error){definition=null;status.textContent='Preview unavailable: '+error.message;}};
   frame.srcdoc=engine.buildPrintDocument(definition);
  }catch(error){if(!closed){definition=null;status.textContent='Preview unavailable: '+error.message+' Nothing has been printed.';button.disabled=true;}}
 }
 window.DleLaborSlidePrint=Object.freeze({open});
})(window,document);

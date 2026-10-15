(function(window,document){
 'use strict';
 const ns='http://www.w3.org/2000/svg',WIDTH=1056,HEIGHT=816,MARGIN=48,BODY=624,TOP=112,CONTENT=960;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const layout=kind=>['START','BOM'].includes(kind)?{WIDTH:816,HEIGHT:1056,CONTENT:720,TOP:48,BODY:930,orientation:'portrait'}:{WIDTH,HEIGHT,CONTENT,TOP,BODY,orientation:'landscape'};
 const native=kind=>['START','END','BOM'].includes(kind);
 // One physical half-inch safety boundary. Print crops the sheet coordinates to
 // this same content box; it must not scale an already composed full sheet again.
 const css=`@page{size:letter landscape;margin:.5in}@page portraitSheet{size:letter portrait;margin:.5in}@page landscapeSheet{size:letter landscape;margin:.5in}html,body{margin:0;background:#e6e9ec;color:#172d3d;font:14px Arial,sans-serif;print-color-adjust:exact;-webkit-print-color-adjust:exact}.letter-page{box-sizing:border-box;width:var(--w);height:var(--h);break-after:page;page-break-after:always;background:white;margin:12px auto;border:1px solid #ccd2d6}.letter-page.portrait{page:portraitSheet;--w:816px;--h:1056px;--ratio:816/1056}.letter-page.landscape{page:landscapeSheet;--w:1056px;--h:816px;--ratio:1056/816}.letter-page:last-child{break-after:auto;page-break-after:auto}.letter-page>svg{display:block;width:100%;height:100%}.letter-header{font:13px/1.3 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;height:100%}.letter-footer{font:9px/1.2 Arial,sans-serif;color:#52616b}.letter-caption{font:16px/1.4 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}@media screen{.letter-page{width:min(var(--w),calc(100% - 24px));height:auto;aspect-ratio:var(--ratio)}}@media print{.letter-page .process-type{background:#fff!important;color:#000!important}html,body{background:white}.letter-page{border:0;margin:0;width:calc(var(--w) - 96px);height:calc(var(--h) - 96px);overflow:hidden}.letter-page>svg{width:var(--w);height:var(--h);max-width:none;transform:translate(-48px,-48px);transform-origin:0 0}}`;
 const printCss=orientation=>css.replace('@page{size:letter landscape;', '@page{size:letter '+(orientation==='portrait'?'portrait':'landscape')+';');
 function element(doc,name,attrs={}){const n=doc.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
 const dataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Slide asset could not be read.'));r.readAsDataURL(blob);});
 async function picture(blob){const url=await dataUrl(blob),p=new Image();p.src=url;await p.decode();return{url,width:p.naturalWidth,height:p.naturalHeight};}
 // Snapshot HTML styles in its isolated source document, never against the application theme.
 async function freeze(root){
  const d=root.ownerDocument,rules=[];
  function collect(list){for(const rule of list){if(rule.selectorText){const selectors=rule.selectorText.split(/,(?![^()]*\))/).map(s=>s.trim()).filter(s=>{if(['html','body',':root','*'].includes(s))return true;try{return !!root.querySelector(s);}catch{return false;}});if(selectors.length)rules.push([selectors,rule.style.cssText]);}else if(rule.cssRules&&rule.conditionText&&d.defaultView.matchMedia(rule.conditionText).matches)collect(rule.cssRules);}}
  for(const sheet of d.styleSheets)collect(sheet.cssRules);
  const signature=JSON.stringify(rules),scope='letter-source-'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  root.setAttribute('class',scope);root.querySelectorAll('style').forEach(n=>n.remove());
  const style=element(d,'style');style.textContent=rules.map(([selectors,body])=>selectors.map(s=>'.'+scope+(['html','body',':root'].includes(s)?'':' '+s)).join(',')+'{'+body+'}').join('');root.prepend(style);
 }

 function measure(root,svg){const d=root.ownerDocument,origin=svg.getBoundingClientRect().top,box=n=>{const r=n.getBoundingClientRect();return{top:r.top-origin,bottom:r.bottom-origin};};
  const lines=[],walker=d.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(!node.textContent.trim()||node.parentElement?.closest('style,script'))continue;const range=d.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.height)lines.push({top:r.top-origin,bottom:r.bottom-origin});}
  const rows=[...root.querySelectorAll('tbody tr')].map(box),headers=[...root.querySelectorAll('thead')].map(n=>({...box(n),tableBottom:box(n.closest('table')).bottom}));return{lines,rows,headers};
 }
 function paginate(height,scale,geometry,BODY){const pages=[];let start=0;
  while(start<height){const header=geometry.headers.find(h=>start>=h.bottom-.1&&start<h.tableBottom-.1),repeat=header?header.bottom-header.top:0,capacity=BODY/scale-repeat;let end=Math.min(height,start+capacity);
   if(end<height){const row=geometry.rows.find(r=>r.top<end&&r.bottom>end);if(row&&row.top>start+.5&&row.bottom-row.top<=capacity)end=row.top;
    for(let i=0;i<geometry.lines.length+1;i++){const crossing=geometry.lines.filter(r=>r.top<end-.01&&r.bottom>end+.01);if(!crossing.length)break;end=Math.min(...crossing.map(r=>r.top));}
   }
   if(end<=start+.1)throw Error('A form line is taller than a Letter page. Its source is unchanged.');pages.push({start,end,header:header?{start:header.top,end:header.bottom}:null});start=end;
  }return pages;
 }
 async function prepare({kind,summary,loadBase,loadPhoto,layer={},signal}){
  const pageLayout=layout(kind),{CONTENT,BODY}=pageLayout;
  const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-20000px;top:0;width:1200px;height:1100px;visibility:hidden';document.body.append(frame);
  try{const d=frame.contentDocument;d.open();d.write('<!doctype html><html><head><base href="'+esc(document.baseURI)+'"><style>html,body{margin:0;background:white;font:16px Arial,sans-serif}svg{display:block}</style></head><body></body></html>');d.close();
   // End/legacy source geometry must match the existing editor, including its CSS.
   for(const sheet of document.styleSheets){try{if(sheet.href?.includes('labor-workbench.css')){const s=d.createElement('style');s.textContent=[...sheet.cssRules].map(r=>r.cssText).join('\n');d.head.append(s);}}catch{}}
   const svg=element(d,'svg',{width:1200,height:1100}),base=element(d,'g'),overlay=element(d,'g');svg.append(base,overlay);d.body.append(svg);let paper;
   if(summary){paper=window.DleLaborDrawingNotes.appendStartBase(base,summary);}
   else{const response=await loadBase(signal);if(!response.ok)throw Error('The exact source page could not be loaded.');const blob=await response.blob();
    if(kind==='BOM'&&blob.type.includes('svg')){const parsed=new DOMParser().parseFromString(await blob.text(),'image/svg+xml');if(parsed.querySelector('parsererror'))throw Error('BOM source could not be read.');const s=parsed.documentElement;paper={width:Number(s.getAttribute('width')),height:Number(s.getAttribute('height'))};for(const child of [...s.childNodes])base.append(d.importNode(child,true));}
    else{const p=await picture(blob);paper={width:p.width,height:p.height};base.append(element(d,'image',{href:p.url,width:paper.width,height:paper.height,preserveAspectRatio:'xMidYMid meet'}));}
   }
   if(!(paper.width>0&&paper.height>0))throw Error('Invalid source page size.');svg.setAttribute('width',paper.width);svg.setAttribute('height',paper.height);frame.style.width=paper.width+'px';await d.fonts.ready;
   for(const img of base.querySelectorAll('img')){img.src=new URL(img.getAttribute('src'),document.baseURI).href;await img.decode();}
   const geometry=measure(base,svg);await freeze(base);
   for(const photo of layer.photos||[]){const p=await picture(await loadPhoto(photo,signal));overlay.append(element(d,'image',{href:p.url,x:photo.x*paper.width,y:photo.y*paper.height,width:photo.width*paper.width,height:photo.height*paper.height,transform:'rotate('+(photo.rotation||0)+' '+(photo.x+photo.width/2)*paper.width+' '+(photo.y+photo.height/2)*paper.height+')',preserveAspectRatio:'xMidYMid meet'}));}
   for(const mark of layer.marks||[])if(mark.page===(layer.page??layer.savedView?.page??1))window.DleLaborDrawingNotes.appendMark(overlay,mark,paper);
   const scale=Math.min(1,CONTENT/paper.width);let paginationHeight=paper.height;
   // Empty bottom padding on a BOM is not another form page. Keep the original paper size for every overlay coordinate.
   if(kind==='BOM'&&base.querySelector('.material-table')){const ink=overlay.getBBox(),padding=1+Math.max(0,...(layer.marks||[]).map(m=>Math.max(paper.width,paper.height)*(m.thickness??.003)/2)),overlayBottom=overlay.children.length?ink.y+ink.height+padding:0;paginationHeight=Math.min(paper.height,Math.max(1,overlayBottom,...geometry.lines.map(r=>r.bottom),...geometry.rows.map(r=>r.bottom)));}
   const ranges=native(kind)?paginate(paginationHeight,scale,geometry,BODY):[null];return{layout:pageLayout,paper,base:base.outerHTML,overlay:overlay.innerHTML,ranges,scale,savedView:layer.savedView||{x:.5,y:.5,width:1,height:1,rotation:0}};
  }finally{frame.remove();}
 }
 function art(source,range){const {paper,scale,base,overlay}=source,{WIDTH,CONTENT,TOP,BODY}=source.layout;
  if(!range){const m=window.DleLaborDrawingNotes.transform(source.savedView,paper,{width:CONTENT,height:BODY});return '<svg x="48" y="112" width="960" height="624" viewBox="0 0 960 624"><g transform="matrix('+[m.a,m.b,m.c,m.d,m.e,m.f].join(' ')+')">'+base+overlay+'</g></svg>';}
  const headerHeight=range.header?(range.header.end-range.header.start)*scale:0;
  const fragment=(start,end,y,content)=>'<svg x="'+((WIDTH-paper.width*scale)/2)+'" y="'+y+'" width="'+(paper.width*scale)+'" height="'+((end-start)*scale)+'" viewBox="0 '+start+' '+paper.width+' '+(end-start)+'" overflow="hidden">'+content+'</svg>';
  return (range.header?fragment(range.header.start,range.header.end,TOP,base):'')+fragment(range.start,range.end,TOP+headerHeight,base+overlay);
 }
 function sheet(content,caption,index,total,attrs='',context='',pageLayout=layout('DRAWING')){const {WIDTH,HEIGHT,CONTENT,orientation}=pageLayout,portrait=orientation==='portrait',x=(WIDTH-CONTENT)/2;
  return '<section class="letter-page '+orientation+'" '+attrs+'><svg xmlns="'+ns+'" width="'+WIDTH+'" height="'+HEIGHT+'" viewBox="0 0 '+WIDTH+' '+HEIGHT+'" role="img" aria-label="Letter page '+index+' of '+total+'">'+(!portrait?'<foreignObject x="48" y="48" width="960" height="56"><div xmlns="http://www.w3.org/1999/xhtml" class="letter-header">'+esc(caption)+'</div></foreignObject>':'')+content+'<foreignObject x="'+x+'" y="'+(portrait?992:752)+'" width="'+CONTENT+'" height="12"><div xmlns="http://www.w3.org/1999/xhtml" class="letter-footer">UNCONTROLLED WHEN PRINTED · '+(context?esc(context)+' · ':'')+'Page '+index+' of '+total+'</div></foreignObject></svg></section>';
 }
 async function compose(options){const source=await prepare(options),{WIDTH,CONTENT,TOP,BODY,orientation}=source.layout,caption=options.caption||'',parts=[];
  // Exceptionally long captions get their own readable pages rather than overflowing a fixed header.
  const probe=document.createElement('div');probe.style.cssText='position:fixed;left:-20000px;width:'+CONTENT+'px;font:13px/1.3 Arial;white-space:pre-wrap;overflow-wrap:anywhere';probe.textContent=caption;document.body.append(probe);const long=orientation==='portrait'?!!caption:probe.getBoundingClientRect().height>54;probe.remove();
  if(long){const chunks=[],test=document.createElement('div');test.style.cssText='position:fixed;left:-20000px;width:'+CONTENT+'px;font:16px/1.4 Arial;white-space:pre-wrap;overflow-wrap:anywhere';document.body.append(test);let rest=caption;while(rest){let low=1,high=rest.length,best=0;while(low<=high){const mid=Math.floor((low+high)/2);test.textContent=rest.slice(0,mid);if(test.scrollHeight<=BODY){best=mid;low=mid+1;}else high=mid-1;}if(!best)throw Error('Slide text could not be paginated.');if(best<rest.length){const word=rest.lastIndexOf(' ',best);if(word>best-100)best=word+1;if(/[\uD800-\uDBFF]/.test(rest[best-1]))best--;}chunks.push(rest.slice(0,best));rest=rest.slice(best);}test.remove();for(const text of chunks)parts.push('<foreignObject x="'+((WIDTH-CONTENT)/2)+'" y="'+TOP+'" width="'+CONTENT+'" height="'+BODY+'"><div xmlns="http://www.w3.org/1999/xhtml" class="letter-caption">'+esc(text)+'</div></foreignObject>');}
  for(const range of source.ranges)parts.push(art(source,range));
  const title=long?'Slide text continued on preceding pages':caption,html=parts.map((p,i)=>sheet(p,title,i+1,parts.length,'data-source-width="'+source.paper.width+'" data-source-height="'+source.paper.height+'" data-part="'+i+'"',options.context||'',source.layout)).join('');return{html,css:printCss(orientation),source,pages:parts.length,paperSize:'letter',orientation,margins:'.5in'};
 }
 async function composeMany(options){
  const results=[];for(const part of options)results.push(await compose(part));
  const holder=document.createElement('div');holder.innerHTML=results.map(r=>r.html).join('');const pages=[...holder.querySelectorAll('.letter-page')];
  let offset=0;for(const [i,result] of results.entries()){for(let n=0;n<result.pages;n++){const page=pages[offset++];page.dataset.sourcePage=String(options[i].layer?.page??i+1);page.dataset.sourcePart=String(n);}}
  pages.forEach((page,i)=>{page.querySelector(':scope > svg').setAttribute('aria-label','Letter page '+(i+1)+' of '+pages.length);const footer=page.querySelector('.letter-footer');if(footer)for(const node of footer.childNodes)if(node.nodeType===3)node.textContent=node.textContent.replace(/Page \d+ of \d+/,'Page '+(i+1)+' of '+pages.length);});
  return {html:holder.innerHTML,css:printCss(results[0]?.orientation),pages:pages.length,sources:results.map(r=>r.source),paperSize:'letter',orientation:results[0]?.orientation||'portrait',margins:'.5in'};
 }
 function documentHtml(result){return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+(result.css||css)+'</style></head><body>'+result.html+'</body></html>';}
 window.DleLaborLetterPages=Object.freeze({native,prepare,compose,composeMany,document:documentHtml,css,printCss,width:WIDTH,height:HEIGHT});
})(window,document);

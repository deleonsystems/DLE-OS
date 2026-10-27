(function(window,document){
  'use strict';
  function open(link){
    if(document.querySelector('.labor-drawing-viewer'))return;
    const url=new URL(link.href,window.location.href);
    if(url.origin!==window.location.origin||!/^\/api\/sim\/rfq-intakes\/[^/]+\/documents\/[^/]+$/.test(url.pathname))return;
    const main=document.querySelector('body > main');
    const scroll={top:main?.scrollTop||0,left:main?.scrollLeft||0};
    const dialog=document.createElement('dialog');dialog.className='labor-drawing-viewer';dialog.setAttribute('aria-label','Labor drawing');
    dialog.innerHTML='<div class="labor-drawing-heading"><button type="button" data-drawing-back aria-label="Back to Labor worksheet">Back</button><strong>Drawing</strong><span data-drawing-page>Page 1</span></div><div class="labor-drawing-controls"><button type="button" data-drawing-prev>Previous page</button><button type="button" data-drawing-next>Next page</button><label>Zoom <select data-drawing-zoom><option value="100">Fit width</option><option value="150">150%</option><option value="200">200%</option><option value="300">300%</option></select></label><button type="button" data-drawing-retry hidden>Retry</button></div><p class="labor-drawing-status" role="status"></p><div class="labor-drawing-pages" tabindex="0" aria-label="Drawing page; drag to pan, pinch to zoom"><img alt="Drawing page 1" hidden></div>';
    const image=dialog.querySelector('img'),status=dialog.querySelector('[role="status"]'),prev=dialog.querySelector('[data-drawing-prev]'),next=dialog.querySelector('[data-drawing-next]'),retry=dialog.querySelector('[data-drawing-retry]');
    let page=1,requested=1,objectUrl=null,controller=null,closed=false,busy=false;
    const viewport=dialog.querySelector('.labor-drawing-pages'),zoomSelect=dialog.querySelector('[data-drawing-zoom]'),pointers=new Map();let zoom=1,gesture=null;
    image.draggable=false;
    function pair(){const [a,b]=[...pointers.values()];return a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)}:null;}
    function applyZoom(value,anchor,destination=anchor,sourcePoint=null){
      const oldWidth=image.getBoundingClientRect().width;if(!oldWidth)return;
      const x=sourcePoint?.x??(viewport.scrollLeft+anchor.x)/oldWidth,y=sourcePoint?.y??(viewport.scrollTop+anchor.y)/oldWidth;
      zoom=Math.max(1,Math.min(6,value));image.style.width=(zoom*100)+'%';const width=image.getBoundingClientRect().width;
      viewport.scrollLeft=x*width-destination.x;viewport.scrollTop=y*width-destination.y;
      let custom=zoomSelect.querySelector('[data-custom-zoom]');if(!custom){custom=document.createElement('option');custom.dataset.customZoom='';zoomSelect.append(custom);}custom.value='custom';custom.textContent=Math.round(zoom*100)+'%';zoomSelect.value='custom';
    }
    function local(p){const r=viewport.getBoundingClientRect();return{x:p.x-r.left,y:p.y-r.top};}
    function startGesture(){const p=pair();if(!p)return [...pointers.values()][0]||null;const a=local(p),w=image.getBoundingClientRect().width;return{...p,startZoom:zoom,sourcePoint:{x:(viewport.scrollLeft+a.x)/w,y:(viewport.scrollTop+a.y)/w}};}
    viewport.onpointerdown=e=>{if(busy||image.hidden||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});viewport.setPointerCapture(e.pointerId);gesture=startGesture();};
    viewport.onpointermove=e=>{if(!pointers.has(e.pointerId)||!gesture)return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const next=pair();if(next&&gesture.distance){applyZoom(gesture.startZoom*next.distance/gesture.distance,local(gesture),local(next),gesture.sourcePoint);}else if(!next){viewport.scrollLeft+=gesture.x-e.clientX;viewport.scrollTop+=gesture.y-e.clientY;gesture={x:e.clientX,y:e.clientY};}};
    function finishPointer(e){pointers.delete(e.pointerId);gesture=startGesture();}
    viewport.onpointerup=finishPointer;viewport.onpointercancel=finishPointer;viewport.onlostpointercapture=finishPointer;

    function controls(){prev.disabled=busy||image.hidden||page<=1;next.disabled=busy||image.hidden||page>=200;}
    async function load(number){
      if(busy||closed)return;
      pointers.clear();gesture=null;requested=number;busy=true;retry.hidden=true;status.textContent='Loading page '+number+'…';controls();controller=new AbortController();
      try{
        const response=await window.DleIntegration.request(url.pathname+'/pages/'+number,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Page unavailable');
        const blob=await response.blob();if(closed)return;
        const nextUrl=URL.createObjectURL(blob),probe=new Image();probe.src=nextUrl;
        try{await probe.decode();}catch(error){URL.revokeObjectURL(nextUrl);throw error;}
        if(closed){URL.revokeObjectURL(nextUrl);return;}
        if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=nextUrl;
        image.src=objectUrl;image.hidden=false;image.alt='Drawing page '+number;page=number;
        dialog.querySelector('[data-drawing-page]').textContent='Page '+page;
        dialog.querySelector('.labor-drawing-pages').scrollTo(0,0);status.textContent='Page '+page+'. Use Back to return to your unchanged worksheet.';
      }catch(error){if(!closed&&error.name!=='AbortError'){status.textContent='Page '+number+' could not be displayed.'+(image.hidden?'':' Page '+page+' is still shown.')+' Retry, choose another page, or use Back.';retry.hidden=false;}}
      finally{busy=false;if(!closed)controls();}
    }
    dialog.querySelector('[data-drawing-back]').onclick=()=>dialog.close();
    prev.onclick=()=>load(page-1);next.onclick=()=>load(page+1);retry.onclick=()=>load(requested);
    zoomSelect.onchange=event=>{if(event.target.value!=='custom')applyZoom(Number(event.target.value)/100,{x:viewport.clientWidth/2,y:viewport.clientHeight/2});};
    dialog.addEventListener('close',()=>{
      closed=true;controller?.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);dialog.remove();
      if(main){main.scrollTop=scroll.top;main.scrollLeft=scroll.left;}
      if(link.isConnected)link.focus({preventScroll:true});
    },{once:true});
    document.body.appendChild(dialog);dialog.showModal();void load(1);
  }
  let bomHelperLoading;
  async function ensureBomHelper(){
    if(window.DleBomReference)return;
    bomHelperLoading ||= new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='/incoming/SRC/workspaces/rfqs/bom-reference.js';
      script.onload=resolve;script.onerror=()=>{bomHelperLoading=null;script.remove();reject(new Error('BOM reference controls unavailable'));};
      document.head.appendChild(script);
    });
    await bomHelperLoading;
  }
  function openBom(link){
    if(document.querySelector('.labor-drawing-viewer'))return;
    const url=new URL(link.href,window.location.href);
    if(url.origin!==window.location.origin||!/^\/api\/sim\/rfqs\/[^/]+\/bom-reference$/.test(url.pathname))return;
    const main=document.querySelector('body > main'),scroll={top:main?.scrollTop||0,left:main?.scrollLeft||0};
    const dialog=document.createElement('dialog');dialog.className='labor-drawing-viewer labor-bom-viewer';dialog.setAttribute('aria-label','Accepted BOM read-only reference');
    dialog.innerHTML='<div class="labor-drawing-heading"><button type="button" data-drawing-back aria-label="Back to Labor worksheet">Back</button><strong>Quotation BOM</strong><button type="button" data-bom-edit hidden>Edit</button><button type="button" data-bom-print disabled>Print</button><button type="button" data-bom-retry hidden>Retry</button></div><p role="status" class="labor-drawing-status">Loading accepted BOM…</p><div class="labor-bom-content" tabindex="0" aria-label="Accepted BOM; scroll to inspect"></div><div class="labor-bom-analysis" hidden><span id="bom-selection" role="status" aria-live="polite"></span><button id="bom-clear" type="button">Clear selection</button></div>';
    const status=dialog.querySelector('.labor-drawing-status'),content=dialog.querySelector('.labor-bom-content'),retry=dialog.querySelector('[data-bom-retry]');
    let controller=null,closed=false,busy=false;
    const textNode=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
    async function load(){
      if(busy||closed)return;busy=true;retry.hidden=true;controller=new AbortController();status.textContent='Loading accepted BOM…';
      try{
        const response=await window.DleIntegration.request(url.pathname,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!response.ok||!response.headers.get('content-type')?.startsWith('text/html'))throw new Error('BOM unavailable');
        const source=new DOMParser().parseFromString(await response.text(),'text/html');
        const sourceTable=source.querySelector('table'),sourceRows=sourceTable?.querySelectorAll('tbody tr[data-quantity]');
        if(!sourceTable||!sourceRows||!source.querySelector('#bom-total'))throw new Error('Invalid BOM reference');
        await ensureBomHelper();if(closed)return;
        const html=await window.DleBomReference.report(url.pathname,true);if(closed)return;
        const process=await window.DleBomProcess.read(url.pathname);if(closed)return;const edit=dialog.querySelector('[data-bom-edit]');edit.hidden=!process.canEdit;edit.onclick=async()=>{if(await window.DleBomProcess.open(url.pathname,edit))await load();};
        const frame=document.createElement('iframe');frame.title='Quotation BOM';frame.style.cssText='width:100%;height:100%;min-height:65vh;border:0;background:white';
        frame.onload=()=>{if(!closed){const print=dialog.querySelector('[data-bom-print]');print.disabled=false;print.onclick=()=>{frame.contentWindow.focus();frame.contentWindow.print();};}};frame.srcdoc=html;content.replaceChildren(frame);
        dialog.querySelector('.labor-bom-analysis').hidden=true;
        status.textContent='Read-only reference. Use Back to return to your unchanged worksheet.';
      }catch(error){if(!closed&&error.name!=='AbortError'){status.textContent='Accepted BOM could not be displayed. Retry or use Back; your worksheet is unchanged.';retry.hidden=false;}}
      finally{busy=false;}
    }
    retry.onclick=load;dialog.querySelector('[data-drawing-back]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{closed=true;controller?.abort();dialog.remove();if(main){main.scrollTop=scroll.top;main.scrollLeft=scroll.left;}if(link.isConnected)link.focus({preventScroll:true});},{once:true});
    document.body.appendChild(dialog);dialog.showModal();void load();
  }
  window.DleLaborDrawingViewer=Object.freeze({open,openBom});
})(window,document);

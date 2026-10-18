(function(window,document){
 'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value));
 const defaults=()=>({page:1,x:.5,y:.5,width:1,height:1,rotation:0});
 const included=(layer,step)=>(layer.stepIds||[layer.stepId]).includes(step);
 const key=layer=>layer.layerId||layer.stepId+'|'+layer.source.sha256;
 const shapeKinds=['line','arrow','box','circle','callout','polygon','cloud','polyline'];
 const textKind=k=>k==='text'||k==='callout';
 const newShape=k=>['line','circle','callout','polygon','cloud','polyline'].includes(k);
 const clamp=v=>Math.max(0,Math.min(1,v));
 function appendMark(group,mark,paper){
    const ns='http://www.w3.org/2000/svg';
    const stroke=Math.max(paper.width,paper.height)*(mark.thickness??.003),color=mark.color||'#c72116';
    const pts=mark.points.map(p=>({x:p.x*paper.width,y:p.y*paper.height})),a=pts[0],b=pts.at(-1);let node;
    let textNode=null;
    if(textKind(mark.kind)){node=document.createElementNS(ns,'text');node.setAttribute('x',a.x);node.setAttribute('y',a.y);node.setAttribute('font-size',paper.width*(mark.fontSize??.024));node.setAttribute('transform','rotate('+(mark.textRotation??0)+' '+a.x+' '+a.y+')');node.setAttribute('fill',color);node.setAttribute('paint-order','stroke');node.setAttribute('stroke','white');node.setAttribute('stroke-width',stroke*.5);node.textContent=mark.text;textNode=node;
     if(mark.kind==='callout'){const group=document.createElementNS(ns,'g'),leader=document.createElementNS(ns,'path');const angle=Math.atan2(b.y-a.y,b.x-a.x),len=stroke*6;leader.setAttribute('d',`M${a.x} ${a.y} L${b.x} ${b.y} M${b.x-len*Math.cos(angle-.5)} ${b.y-len*Math.sin(angle-.5)} L${b.x} ${b.y} L${b.x-len*Math.cos(angle+.5)} ${b.y-len*Math.sin(angle+.5)}`);leader.setAttribute('fill','none');leader.setAttribute('stroke',color);leader.setAttribute('stroke-width',stroke);group.append(leader,node);node=group;textNode.dataset.markId=mark.id;}
    }
    else if(mark.kind==='circle'){node=document.createElementNS(ns,'ellipse');for(const[k,v]of Object.entries({cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,rx:Math.abs(b.x-a.x)/2,ry:Math.abs(b.y-a.y)/2,fill:'none',stroke:color,'stroke-width':stroke}))node.setAttribute(k,v);}
    else if(mark.kind==='box'||mark.kind==='highlight'){node=document.createElementNS(ns,'rect');for(const [k,v]of Object.entries({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y),fill:mark.kind==='highlight'?(mark.color||'#ffd400'):'none',opacity:mark.kind==='highlight'?'.35':'1',stroke:mark.kind==='highlight'?'none':color,'stroke-width':stroke}))node.setAttribute(k,v);}
    else{node=document.createElementNS(ns,'path');let path=pts.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ');if(mark.kind==='polygon')path+=' Z';if(mark.kind==='cloud')path=cloudPath(a,b);if(mark.kind==='arrow'){const angle=Math.atan2(b.y-a.y,b.x-a.x),len=stroke*7;path+=` M${b.x-len*Math.cos(angle-.5)} ${b.y-len*Math.sin(angle-.5)} L${b.x} ${b.y} L${b.x-len*Math.cos(angle+.5)} ${b.y-len*Math.sin(angle+.5)}`;}for(const[k,v]of Object.entries({d:path,fill:'none',stroke:color,opacity:mark.kind==='marker'?'.28':'1','stroke-width':stroke,'stroke-linecap':'round','stroke-linejoin':'round'}))node.setAttribute(k,v);}
    node.dataset.markId=mark.id;group.append(node);
    if(mark.kind==='callout'){const bounds=textNode.getBBox(),padding=mark.compactCallout?paper.width*(mark.fontSize??.024)*.25:5,frame=document.createElementNS(ns,'rect');for(const[k,v]of Object.entries({x:bounds.x-padding,y:bounds.y-padding,width:bounds.width+2*padding,height:bounds.height+2*padding,fill:'#fff',stroke:color,'stroke-width':stroke,transform:textNode.getAttribute('transform')}))frame.setAttribute(k,v);node.insertBefore(frame,textNode);}
    return {node,textNode};
 }
  function cloudPath(a,b){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y),r=Math.min(w,h)/10;if(!r)return `M${x} ${y}`;const corners=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h},{x,y}];let d=`M${x} ${y}`;for(let side=0;side<4;side++){const p=corners[side],q=corners[side+1],dx=q.x-p.x,dy=q.y-p.y,n=Math.max(2,Math.min(24,Math.round(Math.hypot(dx,dy)/(r*2))));for(let i=1;i<=n;i++){const ex=p.x+dx*i/n,ey=p.y+dy*i/n,cx=p.x+dx*(i-.5)/n+dy/Math.hypot(dx,dy)*r,cy=p.y+dy*(i-.5)/n-dx/Math.hypot(dx,dy)*r;d+=` Q${cx} ${cy} ${ex} ${ey}`;}}return d+' Z';}
 // Worksheet content is protected paper, never an annotation layer.
 // Authoring and playback use this same composition and coordinate system.
 function startBase(summary){
  const kind=summary.kind||'START',end=kind==='END';
  const node=document.createElement('section');node.className='labor-start-summary';node.dataset.pageKind=kind;node.setAttribute('aria-label','Operation summary');node.setAttribute('contenteditable','false');
  const text=(tag,value,parent=node,cls='')=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;parent.append(el);return el;};
  const header=document.createElement('header');header.className='labor-instruction-header';node.append(header);
  if(kind==='SUBSTEP'){
   const brand=document.createElement('div');brand.className='labor-instruction-brand';header.append(brand);text('strong','DLE-OS',brand);text('span','WORK INSTRUCTIONS',brand);
   text('div','SUBSTEP',header,'labor-instruction-marker');text('h1',summary.sectionLabel||summary.label||'Operation',header,'labor-start-role');text('p',summary.label,header,'labor-start-operation');
  }else{
   const metadata=summary.traveler||{},fields=document.createElement('div');fields.className='labor-traveler-fields';header.append(fields);
   for(const [label,key]of [['Assembly','assembly'],['Rev','revision'],['Qty','quantity'],['Work Order','workOrder']]){const field=document.createElement('div');field.dataset.travelerField=key;fields.append(field);text('span',label,field);const value=metadata[key];text('strong',value==null||String(value).trim()===''?(key==='workOrder'?'QUOTE':'—'):String(value),field);}
  }
  const body=document.createElement('div');body.className='labor-instruction-body';node.append(body);
  if(end){
   text('p',summary.label||'Operation',body,'labor-current-operation');
   text('p',summary.nextOperation?'Next Step:':'End of sequence',body,'labor-next-label');
   text('h1',summary.nextOperation||summary.sectionLabel,body,'labor-next-operation');
   if(summary.nextOperation&&summary.nextNotes?.trim())text('p',summary.nextNotes,body,'labor-next-notes');
  }else{
   if(kind!=='SUBSTEP')text('h1',summary.label||summary.sectionLabel||'Operation',body,'labor-operation-title');
   // Notes always precede substeps in this shared protected composition.
   if(summary.notes){const notes=document.createElement('section');notes.className='labor-start-instruction';body.append(notes);text('h2',kind==='SUBSTEP'?'Instructions':'Main note',notes);text('p',summary.notes,notes,'labor-start-notes');}
   if(summary.substeps.length){text('h2','Substeps',body);const list=document.createElement('ol');body.append(list);for(const row of summary.substeps){const item=document.createElement('li');list.append(item);const heading=text('h3','',item);if(row.linked&&row.id){const link=text('button',row.label,heading);link.type='button';link.dataset.stepJump=row.id;}else heading.textContent=row.label;}}
  }
  return node;
 }
 function appendStartBase(group,summary){
  const base=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');base.dataset.protectedBase='';base.setAttribute('width','1200');base.setAttribute('height','800');
  if(summary.travelerPlan&&!summary.kind){base.setAttribute('width','800');group.append(base);const definition=window.DleLaborTravelerPrint.build(summary.travelerPlan,summary.travelerRfq,window.DleLaborWorkbench,{focusType:summary.travelerFocus,material:summary.travelerMaterial,job:summary.travelerJob});const content=window.DleLaborTravelerPrint.mount(base,definition);const paper={width:800,height:Math.max(800,Math.ceil(content.scrollHeight))};base.setAttribute('height',paper.height);return paper;}
  const content=startBase(summary);base.append(content);group.append(base);
  const paper={width:1200,height:Math.max(800,Math.ceil(content.scrollHeight))};base.setAttribute('height',paper.height);return paper;
 }
 // Shared two-touch geometry for text anchors and image centers, in unrotated paper coordinates.
 function gesturePoint(point,from,to,paper){const ratio=to.distance/from.distance,angle=(to.angle-from.angle)*Math.PI/180,dx=(point.x-from.x)*paper.width,dy=(point.y-from.y)*paper.height;return{x:to.x+ratio*(dx*Math.cos(angle)-dy*Math.sin(angle))/paper.width,y:to.y+ratio*(dx*Math.sin(angle)+dy*Math.cos(angle))/paper.height};}
 function constrainImage(value,paper){
  const image={...value},cx=image.x+image.width/2,cy=image.y+image.height/2;image.rotation=(((image.rotation||0)+540)%360)-180;
  const angle=image.rotation*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  const rx=(c*image.width+s*image.height*paper.height/paper.width)/2,ry=(s*image.width*paper.width/paper.height+c*image.height)/2;
  const fit=Math.min(1,1/image.width,1/image.height,.5/rx,.5/ry);image.width*=fit;image.height*=fit;
  const bx=Math.max(image.width/2,rx*fit),by=Math.max(image.height/2,ry*fit);
  image.x=Math.max(bx,Math.min(1-bx,cx))-image.width/2;image.y=Math.max(by,Math.min(1-by,cy))-image.height/2;return image;
 }
 function focusNativeEditor(input){input.focus();input.select();}
 // One invertible affine transform for both rendering and pointer coordinates.
 function transform(camera,paper,viewport){
  const angle=camera.rotation*Math.PI/180,c=Math.round(Math.cos(angle)),s=Math.round(Math.sin(angle));
  const w=camera.width*paper.width,h=camera.height*paper.height;
  const scale=Math.min(viewport.width/(Math.abs(c)*w+Math.abs(s)*h),viewport.height/(Math.abs(s)*w+Math.abs(c)*h));
  const a=c*scale,b=s*scale,cc=-s*scale,d=c*scale;
  return {a,b,c:cc,d,e:viewport.width/2-a*camera.x*paper.width-cc*camera.y*paper.height,f:viewport.height/2-b*camera.x*paper.width-d*camera.y*paper.height};
 }
 function point(matrix,paper,x,y){const det=matrix.a*matrix.d-matrix.b*matrix.c,dx=x-matrix.e,dy=y-matrix.f;return{x:(matrix.d*dx-matrix.c*dy)/det/paper.width,y:(matrix.a*dy-matrix.b*dx)/det/paper.height};}

 // Temporary, opt-in SIM diagnostic. Values, labels, URLs and event data are never recorded.
 function installKeyboardDiagnostic(dialog,sidebar,hidePanel){
  const launch=document.createElement('button'),box=document.createElement('section');
  launch.type='button';launch.textContent='Keyboard diagnostic (SIM)';launch.dataset.keyboardDiagnostic='';
  box.className='labor-keyboard-diagnostic';box.hidden=true;
  box.innerHTML='<strong>Keyboard diagnostic (SIM)</strong><p>One 20-second capture, stored only in this open viewer. Records focus, input-node presence, event types and viewport sizes. No text values or network transmission.</p><p>Start, open Layers again, double-tap a name, then tap inside its input. Do not type or save. Wait 20 seconds, then reopen this diagnostic for the result.</p><button type="button" data-diagnostic-start>Start one capture</button><button type="button" data-diagnostic-stop hidden>Stop capture</button><button type="button" data-diagnostic-clear>Clear and close</button><p data-diagnostic-status aria-live="polite">Off</p><pre data-diagnostic-summary hidden></pre><textarea data-diagnostic-result readonly rows="10" aria-label="Keyboard diagnostic result" hidden></textarea><button type="button" data-diagnostic-copy hidden>Copy result</button>';
  sidebar.append(launch,box);
  const q=s=>box.querySelector(s),output=q('[data-diagnostic-result]'),status=q('[data-diagnostic-status]');
  let events=[],running=false,started=0,timer=null,listeners=null,observer=null,nodes=new WeakMap(),ordinal=0,watched=null,lastNodes='';
  const category=node=>node?.matches?.('[data-rename]')?'rename':node?.matches?.('[data-text]')?'drawing-text':node?.matches?.('[data-layer-id]')?'layer-row':node?.matches?.('input,textarea,select')?'other-input':node?.closest?.('.labor-keyboard-diagnostic,[data-keyboard-diagnostic]')?'diagnostic':node?.closest?.('button')?'button':node===document.body?'body':node===document?'document':node?.matches?.('dialog')?'dialog':node?.matches?.('.labor-annotation-canvas')?'canvas':node?.matches?.('.labor-layer-sidebar')?'layers-panel':node?.matches?.('.labor-tool-tray')?'text-tray':node?.matches?.('summary')?'summary':node?.matches?.('svg')?'drawing-svg':node?'other':'none';
  const id=node=>{if(!node)return null;if(!nodes.has(node))nodes.set(node,++ordinal);return nodes.get(node);};
  function snapshot(){const rename=dialog.querySelector('[data-rename]'),text=dialog.querySelector('[data-text]');if(rename)watched=rename;return{active:category(document.activeElement),rename:id(rename),renameFocused:!!rename&&document.activeElement===rename,lastRenameConnected:watched?watched.isConnected:null,text:id(text),textFocused:document.activeElement===text};}
  function viewport(){const v=window.visualViewport;return{width:Math.round(window.innerWidth),height:Math.round(window.innerHeight),visualWidth:v?Math.round(v.width):null,visualHeight:v?Math.round(v.height):null,offsetTop:v?Math.round(v.offsetTop):null,scale:v?Math.round(v.scale*100)/100:null};}
  let environment=null;
  function record(type,extra={}){if(!running)return;events.push({ms:Math.round(performance.now()-started),type,...extra,...snapshot()});if(events.length>=160)stop('event limit');}
  function stop(reason){if(!running)return;running=false;clearTimeout(timer);listeners.abort();observer.disconnect();events.push({ms:Math.round(performance.now()-started),type:'capture-end',reason,...snapshot(),viewport:viewport()});output.value=JSON.stringify({schema:2,context:environment,events},null,2);output.hidden=false;const summary=q('[data-diagnostic-summary]');summary.hidden=false;summary.textContent='Standalone: '+environment.standalone+' / display: '+environment.displayStandalone+'\nRename nodes: '+[...new Set(events.map(e=>e.rename).filter(Boolean))].join(', ')+'\nRename focusouts: '+events.filter(e=>e.type==='focusout'&&e.target==='rename').length+'\nRemoval observed: '+events.some(e=>e.lastRenameConnected===false)+'\nViewport events: '+events.filter(e=>e.type==='viewport').length+'\nLast events (ms / event / active):\n'+events.slice(-10).map(e=>e.ms+' '+e.type+' / '+e.active).join('\n');q('[data-diagnostic-copy]').hidden=false;q('[data-diagnostic-stop]').hidden=true;q('[data-diagnostic-start]').disabled=false;status.textContent='Capture finished ('+events.length+' records). Nothing sent or saved. Open result below.';launch.textContent='Keyboard diagnostic (result ready)';}
  function clear(){if(running)stop('cleared');events=[];output.value='';q('[data-diagnostic-summary]').textContent='';q('[data-diagnostic-summary]').hidden=true;environment=null;watched=null;nodes=new WeakMap();box.hidden=true;output.hidden=true;q('[data-diagnostic-copy]').hidden=true;status.textContent='Off';launch.textContent='Keyboard diagnostic (SIM)';}
  launch.onclick=()=>{box.hidden=!box.hidden;};
  q('[data-diagnostic-clear]').onclick=clear;
  q('[data-diagnostic-stop]').onclick=()=>stop('manual');
  q('[data-diagnostic-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(output.value);status.textContent='Copied. Nothing sent.';}catch{output.focus();output.select();status.textContent='Select and copy the result, or take a screenshot.';}};
  q('[data-diagnostic-start]').onclick=()=>{
   if(running)return;events=[];nodes=new WeakMap();ordinal=0;watched=null;lastNodes='';q('[data-diagnostic-summary]').hidden=true;q('[data-diagnostic-summary]').textContent='';output.value='';output.hidden=true;q('[data-diagnostic-copy]').hidden=true;
   hidePanel();box.hidden=true;started=performance.now();running=true;listeners=new AbortController();
   environment={standalone:window.navigator.standalone===true,displayStandalone:window.matchMedia('(display-mode: standalone)').matches,viewport:viewport()};
   const capture=e=>{if(category(e.target)==='diagnostic')return;if(e.type==='selectionchange'&&!dialog.contains(document.activeElement))return;const extra={target:category(e.target),trusted:e.isTrusted};if(e.type==='focusin'||e.type==='focusout')extra.related=category(e.relatedTarget);if(['touch','pen','mouse'].includes(e.pointerType))extra.pointer=e.pointerType;record(e.type,extra);};
   for(const type of ['pointerdown','pointerup','click','dblclick','focusin','focusout','beforeinput','input'])dialog.addEventListener(type,capture,{capture:true,passive:true,signal:listeners.signal});
   document.addEventListener('selectionchange',capture,{passive:true,signal:listeners.signal});
   for(const target of [window,window.visualViewport].filter(Boolean))target.addEventListener('resize',()=>record('viewport',{viewport:viewport()}),{passive:true,signal:listeners.signal});
   observer=new MutationObserver(()=>{const value=snapshot(),signature=JSON.stringify([value.rename,value.lastRenameConnected,value.text]);if(signature!==lastNodes){lastNodes=signature;record('input-nodes');}});observer.observe(dialog,{childList:true,subtree:true});
   record('capture-start',{viewport:viewport()});timer=setTimeout(()=>stop('20 seconds'),20000);status.textContent='Capturing for 20 seconds. Return here afterward.';q('[data-diagnostic-start]').disabled=true;q('[data-diagnostic-stop]').hidden=false;launch.textContent='Keyboard diagnostic (capturing)';
  };
  let switchingToOrganizer=false;
  dialog.addEventListener('close',e=>{if(e.target===dialog)clear();});
 }
 let letterLoading;
 async function letterPages(){if(!window.DleLaborLetterPages){letterLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/SRC/workspaces/rfqs/labor-letter-pages.js';script.onload=resolve;script.onerror=()=>{letterLoading=null;script.remove();reject(Error('Letter forms unavailable. Retry.'));};document.head.append(script);});await letterLoading;}return window.DleLaborLetterPages;}
 async function open(options){
  if(document.querySelector('.labor-drawing-viewer'))return;
  const {intakeId,stepId,stepLabel,editable,draft,onDraft,onSaved,trigger}=options;
  const slide=options.slide;
  const nativeForm=!editable&&(!!slide?.mount||['START','END','BOM'].includes(slide?.kind));
  const base='/api/sim/rfqs/'+encodeURIComponent(intakeId)+'/labor/drawing-notes',pageBase=options.pageBase||base+'/pages';
  const main=document.querySelector('body > main'),scroll={top:main?.scrollTop||0,left:main?.scrollLeft||0};
  const dialog=document.createElement('dialog');dialog.className='labor-drawing-viewer labor-annotation-viewer drawing-first story-tools';dialog.dataset.viewMode=document.body.dataset.viewMode||'desktop';dialog.setAttribute('aria-label','Drawing Notes for '+stepLabel);
  dialog.innerHTML='<header class="labor-drawing-heading"><button type="button" data-back>Back</button><strong>Drawing Notes</strong></header><p class="labor-annotation-identity"></p><select aria-label="Drawing note source" data-source hidden></select><p role="status" class="labor-drawing-status">Loading Drawing Notes.</p><div class="labor-annotation-controls"><button data-prev>Previous</button><span data-page></span><button data-next>Next</button><button data-out aria-label="Zoom out">−</button><button data-in aria-label="Zoom in">+</button><button data-rotate>Rotate</button><button data-reset>Reset view</button><button data-save-view>Save view</button><button data-retry hidden>Retry page</button></div><div class="labor-annotation-tools"><label>Tool <select data-tool aria-label="Drawing tool"><option value="pan">Pan</option><option value="line">Line</option><option value="arrow">Arrow</option><option value="box">Rectangle</option><option value="circle">Circle</option><option value="callout">Text callout</option><option value="polygon">Polygon</option><option value="cloud">Cloud</option><option value="polyline">Connected lines</option><option value="highlight">Highlight</option><option value="freehand">Pen / Freehand</option><option value="marker">Translucent marker</option><option value="eraser">Stroke eraser</option><option value="text">Text</option></select></label><input data-text aria-label="Drawing note text" maxlength="500" placeholder="Text to place" hidden><label>Color <input type="color" data-color aria-label="Ink color" value="#c72116"></label><label>Thickness <select data-thickness aria-label="Ink thickness"><option value=".002">Fine</option><option value=".006" selected>Medium</option><option value=".018">Broad</option><option value=".04">Wide</option></select></label><button data-undo>Undo</button><button data-save>Save notes</button><button data-discard>Discard changes</button></div><label class="labor-annotation-note">Step drawing note<textarea data-layer-note aria-label="Step drawing note" maxlength="4000" rows="4" placeholder="Explain what this step needs from the drawing"></textarea></label><div class="labor-annotation-canvas" tabindex="0" aria-label="Drawing canvas; use Pan to move, arrow keys to pan"><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Customer drawing with quotation overlays"><g data-paper><image x="0" y="0"/><g data-photos></g><g data-marks></g></g></svg></div><small>Quotation reference only. Original drawing unchanged. Save view sets the author’s opening area; casual navigation is never saved.</small>';
  const find=s=>dialog.querySelector(s),status=find('[role="status"]'),canvas=find('.labor-annotation-canvas'),svg=find('svg'),paperGroup=find('[data-paper]'),image=find('image'),marksGroup=find('[data-marks]'),photoGroup=find('[data-photos]'),tool=find('[data-tool]');
  const roomyDocument=['DRAWING','IMAGE'].includes(slide?.kind);
  let letterOutline=null,letterClip=null;
  if(slide&&!editable&&!nativeForm){const ns='http://www.w3.org/2000/svg',defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),wrap=document.createElementNS(ns,'g');clip.id='labor-letter-boundary';clip.setAttribute('clipPathUnits','userSpaceOnUse');letterClip=document.createElementNS(ns,'rect');clip.append(letterClip);defs.append(clip);letterOutline=document.createElementNS(ns,'rect');letterOutline.setAttribute('fill',roomyDocument?'none':'white');letterOutline.setAttribute('stroke',roomyDocument?'#aeb8c2':'#a5b5c1');letterOutline.setAttribute('stroke-width',roomyDocument?'.6':'1');svg.insertBefore(defs,paperGroup);svg.insertBefore(letterOutline,paperGroup);svg.insertBefore(wrap,paperGroup);wrap.setAttribute('clip-path','url(#labor-letter-boundary)');wrap.append(paperGroup);}
  let photos=[],selectedPhoto=null,photoTray=null,photoRetry=null;const photoAssets=new Map();
  let compatibilityReadOnly=false;
  let canSaveView=false,context=null,source=null,layer=null,marks=[],camera=defaults(),paper={width:1,height:1},matrix=null,closed=false,loaded=false,busy=false,dirty=false,objectUrl=null,controller=null,gesture=null,readOnly=true;
  let swipeViewWidth=1;
  let fitMode=null,spacePan=false,qualityTimer=null,qualityController=null,rasterPixels=0,qualityFailed=false;
  let retainedDraft=draft,activeId=null,undo=[],hidden=new Set(),pointers=new Map();
  const openingLayerKey=()=>JSON.stringify(['dle-drawing-opening-layer-v1',intakeId,stepId,context?.source?.sha256,options.version??'draft']);
  const pageCounts=new Map();let pageCount=null;
  const layerPage=l=>l.page??([...new Set((l.marks||[]).map(m=>m.page))].length>1?null:l.marks?.[0]?.page??l.savedView?.page??1);
  const onPage=l=>!context?.singlePageLayers||layerPage(l)==null||layerPage(l)===camera.page;
  const histories=new Map();let pendingNavigation=null;
  const layersPanel=document.createElement('details');layersPanel.className='labor-layer-panel';layersPanel.open=true;
  layersPanel.innerHTML='<summary>Drawing layers</summary><div data-layer-list></div><button data-new-layer>New layer</button><input type="hidden" data-layer-name><details class="labor-layer-sharing"><summary>Also show this layer in...</summary><p>Shared guidance in this active draft. Sharing does not grant editing permission.</p><div data-targets></div><button data-remove-layer>Remove layer from all steps</button></details>';
  dialog.insertBefore(layersPanel,find('.labor-annotation-tools'));
  const heading=find('.labor-drawing-heading'),tools=find('.labor-annotation-tools'),navigation=find('.labor-annotation-controls');
  const sidebar=document.createElement('aside');sidebar.className='labor-layer-sidebar';sidebar.hidden=true;sidebar.setAttribute('aria-label','Layers and notes');sidebar.id='drawingLayerPanel';
  const drawerClose=document.createElement('button');drawerClose.textContent='Close panel';drawerClose.dataset.panelClose='';sidebar.append(drawerClose,layersPanel);
  const metadata=document.createElement('div');metadata.hidden=true;metadata.append(find('.labor-annotation-note'),find('.labor-annotation-identity'),find('[data-source]'),find('small'));
  const stage=document.createElement('div');stage.className='labor-drawing-stage';stage.append(canvas,sidebar);
  const toolbar=document.createElement('div');toolbar.className='labor-drawing-toolbar';toolbar.append(tools,navigation);
  const panels=document.createElement('div');panels.className='labor-drawing-panel-buttons';panels.innerHTML='<button type="button" data-layers-toggle aria-controls="drawingLayerPanel" aria-expanded="false">Layers</button>';
  const saveButton=tools.querySelector('[data-save]'),discardButton=tools.querySelector('[data-discard]');heading.append(panels,saveButton);saveButton.textContent='Save Marks';saveButton.title='Save marks, layer name, note, and sharing';discardButton.textContent='Discard';sidebar.append(discardButton);
  const fitButtons=document.createElement('span');fitButtons.className='labor-fit-controls';fitButtons.innerHTML='<button data-fit-page>Fit Page</button><button data-fit-width>Fit Width</button>';navigation.insertBefore(fitButtons,navigation.querySelector('[data-rotate]'));
  const zoomLabel=document.createElement('output');zoomLabel.dataset.zoom='';zoomLabel.setAttribute('aria-label','Drawing zoom');navigation.insertBefore(zoomLabel,navigation.querySelector('[data-out]'));
  navigation.querySelector('[data-prev]').textContent='Previous';navigation.querySelector('[data-next]').textContent='Next';navigation.querySelector('[data-reset]').textContent='Saved view';
  dialog.replaceChildren(heading,toolbar,status,stage,metadata);
  const quickTools=document.createElement('div');quickTools.className='labor-quick-tools';quickTools.setAttribute('role','group');quickTools.setAttribute('aria-label','Drawing tools');
  for(const [value,label]of [[ 'pan',slide?'Select':'View / Pan'],['freehand','Pen'],['marker','Marker'],['text','Text'],['eraser','Eraser']]){const b=document.createElement('button');b.type='button';b.dataset.quickTool=value;b.textContent=label;b.onclick=()=>{closeTray();tool.value=value;toolContext();if(value!=='pan'||!slide)openTray(value==='pan'?'view':'tool');};quickTools.append(b);}
  const extraTools=document.createElement('details');extraTools.className='labor-extra-tools';extraTools.innerHTML='<summary>More tools</summary>';tools.prepend(quickTools);const toolLabel=tool.closest('label');toolLabel.before(extraTools);extraTools.append(toolLabel);
  const activeBar=document.createElement('div');activeBar.className='labor-active-layer';activeBar.innerHTML='<span data-active-layer></span><button data-unhide hidden>Show layer</button>';toolbar.after(activeBar);
  const pageBar=document.createElement('div');pageBar.className='labor-page-bar';pageBar.innerHTML='<label>Page <select data-page-select aria-label="Drawing page"></select></label><span data-page-count></span>';pageBar.prepend(find('[data-prev]'));pageBar.append(find('[data-next]'),find('[data-retry]'));activeBar.after(pageBar);
  const guard=document.createElement('dialog');guard.className='labor-unsaved-dialog';guard.setAttribute('aria-label','Unsaved marks');guard.innerHTML='<strong>Unsaved marks</strong><p>Save this layer before continuing?</p><p data-guard-status aria-live="polite"></p><div><button data-guard-save>Save Marks</button><button data-guard-discard>Discard</button><button data-guard-keep>Keep editing</button></div>';dialog.append(guard);
  function cancelNavigation(){pendingNavigation=null;guard.close();}
  guard.addEventListener('cancel',e=>{e.preventDefault();e.stopPropagation();cancelNavigation();});
  find('[data-guard-keep]').onclick=cancelNavigation;
  find('[data-guard-save]').onclick=async()=>{if(await save('marks')){const next=pendingNavigation;cancelNavigation();next?.();}else find('[data-guard-status]').textContent=status.textContent;};
  find('[data-guard-discard]').onclick=()=>{discard();const next=pendingNavigation;cancelNavigation();next?.();};
  function navigate(next){if(busy)return;cancelShapeDraft();if(!dirty){next();return;}pendingNavigation=next;find('[data-guard-status]').textContent='';find('[data-guard-save]').disabled=readOnly;guard.showModal();find('[data-guard-keep]').focus();}
  find('[data-unhide]').onclick=()=>{if(layer)hidden.delete(key(layer));layerList();render();controls();};
  find('[data-save-view]').textContent='Save View';find('[data-save-view]').title='Save opening page, zoom, position, and rotation only';
  // Photo references use the existing immutable Labor visual journal. Only geometry lives on the stage.
  async function loadPhoto(photo){
   if(photoAssets.has(photo.documentId))return;
   const asset={};photoAssets.set(photo.documentId,asset);
   try{const blob=await slide.loadPhoto(photo,abort.signal),url=URL.createObjectURL(blob),probe=new Image();probe.src=url;try{await probe.decode();}catch{URL.revokeObjectURL(url);throw Error('Image cannot be decoded: '+photo.name);}if(closed){URL.revokeObjectURL(url);return;}asset.url=url;render();if(photos.every(p=>photoAssets.get(p.documentId)?.url))message(dirty?'Unsaved changes':readOnly?'Read-only quotation reference.':'Ready');}
   catch(e){if(!closed&&e.name!=='AbortError'){asset.error=e.message;message(e.message);if(!photoRetry){photoRetry=document.createElement('button');photoRetry.type='button';photoRetry.textContent='Retry images';photoRetry.dataset.retryPhotos='';photoRetry.onclick=retryPhotos;status.after(photoRetry);}photoRetry.hidden=false;render();}}
  }
  function retryPhotos(){for(const [key,asset]of photoAssets)if(asset.error)photoAssets.delete(key);if(photoRetry)photoRetry.hidden=true;render();}
  function renderPhotos(){
   photoGroup.replaceChildren();if(!slide||layer&&hidden.has(key(layer)))return;
   const ns='http://www.w3.org/2000/svg';
   for(const photo of photos){const asset=photoAssets.get(photo.documentId);if(!asset){void loadPhoto(photo);}
    const group=document.createElementNS(ns,'g');group.dataset.photoId=photo.id;group.setAttribute('transform','rotate('+(photo.rotation||0)+' '+(photo.x+photo.width/2)*paper.width+' '+(photo.y+photo.height/2)*paper.height+')');
    const node=document.createElementNS(ns,asset?.url?'image':'rect');for(const[k,v]of Object.entries({x:photo.x*paper.width,y:photo.y*paper.height,width:photo.width*paper.width,height:photo.height*paper.height}))node.setAttribute(k,v);
    if(asset?.url){node.setAttribute('href',asset.url);node.setAttribute('preserveAspectRatio','xMidYMid meet');}else{node.setAttribute('fill','#e4e9ed');node.setAttribute('stroke','#9a452b');const label=document.createElementNS(ns,'text');label.setAttribute('x',photo.x*paper.width+8);label.setAttribute('y',photo.y*paper.height+24);label.setAttribute('font-size','20');label.textContent=asset?.error?'Image unavailable':'Loading image';group.append(label);}
    group.prepend(node);photoGroup.append(group);
    if(selectedPhoto===photo.id&&!readOnly&&['photo','pan'].includes(tool.value)){
     const outline=document.createElementNS(ns,'rect');for(const[k,v]of Object.entries({x:photo.x*paper.width,y:photo.y*paper.height,width:photo.width*paper.width,height:photo.height*paper.height,fill:'none',stroke:'#147ace','stroke-width':2/screenScale()}))outline.setAttribute(k,v);group.append(outline);
     const handle=document.createElementNS(ns,'circle');for(const[k,v]of Object.entries({cx:(photo.x+photo.width)*paper.width,cy:(photo.y+photo.height)*paper.height,r:14/screenScale(),fill:'#147ace',stroke:'#fff','stroke-width':2/screenScale()}))handle.setAttribute(k,v);handle.dataset.photoResize=photo.id;group.append(handle);
    }
   }
  }
  function photoControls(){if(!photoTray)return;const select=photoTray.querySelector('select');select.replaceChildren(new Option('Choose an image',''),...photos.map(p=>new Option(p.name,p.id)));select.value=selectedPhoto||'';const selected=photos.find(p=>p.id===selectedPhoto);photoTray.querySelector('[data-image-context]').hidden=!selected;photoTray.querySelector('[data-photo-retry]').hidden=!photos.some(p=>photoAssets.get(p.documentId)?.error);for(const el of photoTray.querySelectorAll('input,button,select'))el.disabled=busy||readOnly||!slide.photosSupported;photoTray.querySelector('[data-photo-done]').disabled=busy;photoTray.querySelector('[data-photo-remove]').disabled=busy||!selected;const size=photoTray.querySelector('[data-photo-size]');size.disabled=busy||!selected;size.value=selected?String(selected.width):'.4';}
  if(slide&&editable){
   tool.append(new Option('Image','photo'));const button=document.createElement('button');button.type='button';button.textContent='Image';button.dataset.photoTool='';quickTools.append(button);
   photoTray=document.createElement('section');photoTray.className='labor-tool-tray labor-photo-tray';photoTray.hidden=true;photoTray.setAttribute('aria-label','Image overlays');
   photoTray.innerHTML='<div class="labor-tray-heading"><strong>Image</strong><button data-photo-done>Done</button></div><div class="labor-image-actions"><button data-image-camera>Take Picture</button><button data-image-library>Photo Library</button></div><input data-photo-file type="file" accept="image/*" hidden><input data-photo-camera type="file" accept="image/*" capture="environment" hidden><small>PNG / JPEG · up to 8 MB</small><details data-image-context hidden><summary>Selected image</summary><label>Image<select data-photo-select></select></label><label>Size<input data-photo-size type="range" min=".03" max=".95" step=".01"></label><button data-photo-remove>Remove image</button></details><button data-photo-retry hidden>Retry images</button><p data-photo-message aria-live="polite"></p>';
   stage.append(photoTray);const q=s=>photoTray.querySelector(s);button.onclick=()=>{closeTray();tool.value='photo';toolContext();photoTray.hidden=false;photoControls();q('[data-photo-message]').textContent=slide.photosSupported?(slide.imageTransformsSupported?'':'Drag and corner resize are available. Pinch and twist require the updated SIM runtime.'):'Image overlays require the updated SIM runtime. Existing slide edits remain available.';};
   q('[data-image-camera]').onclick=()=>q('[data-photo-camera]').click();q('[data-image-library]').onclick=()=>q('[data-photo-file]').click();
   q('[data-photo-done]').onclick=()=>{photoTray.hidden=true;render();};q('[data-photo-select]').onchange=e=>{selectedPhoto=e.target.value;photoControls();render();};
   q('[data-photo-remove]').onclick=()=>{if(readOnly||busy||!slide.photosSupported)return;remember();photos=photos.filter(p=>p.id!==selectedPhoto);selectedPhoto=null;changed();photoControls();};
   q('[data-photo-size]').onpointerdown=()=>{if(!readOnly&&!busy)remember();};q('[data-photo-size]').onkeydown=()=>{if(!readOnly&&!busy)remember();};q('[data-photo-size]').oninput=e=>{if(readOnly||busy)return;const p=photos.find(p=>p.id===selectedPhoto);if(!p)return;const ratio=p.height/p.width,w=Math.max(.001,Number(e.target.value)),h=w*ratio;Object.assign(p,constrainImage({...p,x:p.x+p.width/2-w/2,y:p.y+p.height/2-h/2,width:w,height:h},paper));changed();};
   q('[data-photo-retry]').onclick=retryPhotos;
   for(const input of photoTray.querySelectorAll('input[type=file]'))input.onchange=async()=>{
    const file=input.files?.[0];input.value='';if(!file||readOnly||busy||!slide.photosSupported)return;
    let probeUrl=null;busy=true;controls();photoControls();q('[data-photo-message]').textContent='Adding photo…';
    try{if(photos.length>=20)throw Error('Use up to 20 image overlays per stage.');if(!['image/png','image/jpeg'].includes(file.type)||!file.size||file.size>8*1024*1024)throw Error('Choose PNG or JPEG up to 8 MB. Export HEIC photos as JPEG first.');
     probeUrl=URL.createObjectURL(file);const probe=new Image();probe.src=probeUrl;try{await probe.decode();}catch{throw Error('This image cannot be decoded. Choose a valid PNG or JPEG.');}if(!probe.naturalWidth||!probe.naturalHeight||probe.naturalWidth*probe.naturalHeight>50000000)throw Error('Choose an image no larger than 50 megapixels.');
     const result=await slide.uploadPhoto(file);if(closed)return;const ratio=probe.naturalHeight/probe.naturalWidth*paper.width/paper.height,w=Math.min(.45,.6/ratio),h=w*ratio;
     remember();const p={id:window.crypto.randomUUID(),documentId:result.documentId,sha256:result.sha256,name:(result.name||file.name).slice(0,200),x:(1-w)/2,y:(1-h)/2,width:w,height:h};photos.push(p);selectedPhoto=p.id;photoAssets.set(p.documentId,{url:probeUrl});probeUrl=null;photoTray.hidden=true;changed();q('[data-photo-message]').textContent='Image added.';
    }catch(e){q('[data-photo-message]').textContent=e.message;message(e.message);}finally{if(probeUrl)URL.revokeObjectURL(probeUrl);busy=false;controls();photoControls();}
   };
  }
  function activeLayer(){const invisible=layer&&hidden.has(key(layer));find('[data-active-layer]').textContent=(readOnly?'Viewing: ':'Editing: ')+(find('[data-layer-name]').value||'Untitled layer')+(invisible?' (hidden)':'');find('[data-unhide]').hidden=!invisible;updateActiveLabel();for(const b of quickTools.querySelectorAll('[data-quick-tool]')){b.setAttribute('aria-pressed',String(tool.value===b.dataset.quickTool));b.disabled=b.dataset.quickTool==='pan'?(busy||!context):(busy||!loaded||readOnly||invisible);}}

  let selectedTextId=null,pendingNewText=false,selectedShapeId=null,shapeDraft=null;
  let explicitTextSize=null,explicitThickness=false,chosenShapeThickness=null;
  const screenScale=()=>Math.hypot(matrix.a,matrix.b);
  const minimumTextSize=()=>context?.zoomSizedShapes ? .00001 : .008;
  function insertionThickness(){const chosen=shapeKinds.includes(tool.value)&&chosenShapeThickness!=null?chosenShapeThickness:Number(find('[data-thickness]').value);return shapeKinds.includes(tool.value)&&!explicitThickness?Math.max(context?.zoomSizedShapes ? .00001 : .001,2/(screenScale()*Math.max(paper.width,paper.height))):chosen;}
  find('[data-thickness]').addEventListener('change',()=>{explicitThickness=true;chosenShapeThickness=Number(find('[data-thickness]').value);});
  let trayMode=null,keyboardView=null,textAnchor=null,editingTextId=null,textEditRemembered=false,pendingText=null;
  const tray=document.createElement('section');tray.className='labor-tool-tray';tray.hidden=true;tray.setAttribute('aria-label','Tool settings');tray.innerHTML='<div class="labor-tray-heading"><strong data-tray-title>Settings</strong><button data-tool-done type="button">Done</button></div><p data-tool-hint></p>';
  const textPreview=document.createElement('div');textPreview.className='labor-text-preview';textPreview.hidden=true;textPreview.setAttribute('aria-hidden','true');canvas.append(textPreview);let textInput=find('[data-text]');textInput.type='text';textInput.inputMode='text';textInput.enterKeyHint='done';textInput.autocomplete='off';
  function bindTextInput(){textInput.oninput=()=>{if(!editingTextId)pendingNewText=true;textPreview.textContent=textInput.value||'Text';const mark=marks.find(m=>m.id===editingTextId);if(mark&&!readOnly){if(!textEditRemembered){remember();textEditRemembered=true;}mark.text=textInput.value;changed();}};
  textInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();acceptText();}};}bindTextInput();
  const transformControls=document.createElement('div');transformControls.dataset.textTransformControls='';transformControls.innerHTML='<label>Size<input data-text-size type="range" min="0.008" max="0.2" step="0.002" value="0.024"></label><label>Rotation<input data-text-angle type="number" min="-180" max="180" step="5" value="0"></label>';tools.append(transformControls);
  for(const field of transformControls.querySelectorAll('input'))field.oninput=()=>{if(field.matches('[data-text-size]'))explicitTextSize=Number(field.value);const mark=marks.find(m=>m.id===editingTextId);if(!context?.textTransforms||!mark||readOnly||busy)return;if(!textEditRemembered){remember();textEditRemembered=true;}mark.fontSize=Number(find('[data-text-size]').value);mark.textRotation=Math.max(-180,Math.min(180,Number(find('[data-text-angle]').value)||0));changed();};
  function acceptText(){if(textKind(tool.value)&&trayMode==='tool'&&!readOnly&&textInput.value.trim()&&!editingTextId&&pendingNewText&&marks.length<200&&!(layer&&hidden.has(key(layer)))){remember();const m={id:window.crypto.randomUUID(),page:camera.page,kind:tool.value,points:[clone(textAnchor||{x:camera.x,y:camera.y})],text:textInput.value.trim(),color:find('[data-color]').value,thickness:insertionThickness()};if(context?.textTransforms){m.fontSize=Number(find('[data-text-size]').value);m.textRotation=Math.max(-180,Math.min(180,Number(find('[data-text-angle]').value)||0));}if(m.kind==='callout'){if(context?.zoomSizedShapes)m.compactCallout=true;m.points.push({x:clamp(m.points[0].x-80/(screenScale()*paper.width)),y:clamp(m.points[0].y+55/(screenScale()*paper.height))});selectedShapeId=m.id;}marks.push(m);selectedTextId=m.id;pendingNewText=false;changed();}else if(editingTextId)selectedTextId=editingTextId;closeTray();render();}

  const trayHeading=tray.firstElementChild;stage.append(quickTools,tray);tray.append(tools,navigation);toolbar.remove();activeBar.append(find('[data-undo]'));
  const shapes=document.createElement('button');shapes.type='button';shapes.textContent='Shapes';shapes.dataset.shapes='';shapes.onclick=()=>{closeTray();if(!shapeKinds.includes(tool.value))tool.value='box';toolContext();openTray('shapes');};quickTools.append(shapes);
  const shapeMenu=document.createElement('div');shapeMenu.className='labor-shape-menu';
  for(const [kind,label]of [['line','Line'],['arrow','Arrow'],['box','Rectangle'],['circle','Circle'],['callout','Text callout'],['polygon','Polygon'],['cloud','Cloud'],['polyline','Connected lines']]){const b=document.createElement('button');b.type='button';b.dataset.shape=kind;b.textContent=label;b.onclick=()=>{if(newShape(kind)&&!context?.basicShapes){message('New shapes await SIM activation.');return;}closeTray();tool.value=kind;toolContext();if(kind==='callout')openTray('tool');else message(['polygon','polyline'].includes(kind)?'Tap points, then Finish. Cancel leaves no new mark.':'Drag to size. View / Pan: drag blue handles to resize.');};shapeMenu.append(b);}tray.append(shapeMenu);extraTools.hidden=true;
  const shapeActions=document.createElement('div');shapeActions.className='labor-shape-actions';shapeActions.hidden=true;shapeActions.innerHTML='<span>Tap points</span><button type="button" data-shape-finish>Finish</button><button type="button" data-shape-cancel>Cancel</button>';stage.append(shapeActions);
  const strokeTools=document.createElement('section');strokeTools.className='labor-shape-stroke';strokeTools.hidden=true;strokeTools.setAttribute('aria-label','Selected shape thickness');strokeTools.innerHTML='<span>Thickness</span><button type="button" data-stroke-less aria-label="Thinner shape stroke">-</button><output data-stroke-value></output><button type="button" data-stroke-more aria-label="Thicker shape stroke">+</button>';stage.append(strokeTools);
  function strokeSelection(){return marks.find(m=>m.id===selectedShapeId&&m.page===camera.page&&shapeKinds.includes(m.kind));}
  function strokeControls(){const m=strokeSelection();strokeTools.hidden=!m||readOnly||!loaded||!!shapeDraft||!!(layer&&hidden.has(key(layer)));if(!m)return;const width=m.thickness??.003,min=context?.zoomSizedShapes ? .00001 : .001;find('[data-stroke-value]').textContent=(width*Math.max(paper.width,paper.height)*screenScale()).toFixed(1)+' px';find('[data-stroke-value]').title='Width at this zoom; saved with the drawing';find('[data-stroke-less]').disabled=busy||width<=min;find('[data-stroke-more]').disabled=busy||width>=.08;}
  function adjustStroke(factor){const m=strokeSelection();if(!m||readOnly||busy||!loaded||shapeDraft||(layer&&hidden.has(key(layer))))return;const next=Math.max(context?.zoomSizedShapes ? .00001 : .001,Math.min(.08,(m.thickness??.003)*factor));if(next===(m.thickness??.003))return;remember();m.thickness=next;chosenShapeThickness=next;explicitThickness=true;changed();}
  find('[data-stroke-less]').onclick=()=>adjustStroke(1/1.5);find('[data-stroke-more]').onclick=()=>adjustStroke(1.5);
  find('[data-shape-finish]').onclick=()=>finishShapeDraft();find('[data-shape-cancel]').onclick=()=>cancelShapeDraft();
  function addVertex(p){
    if(!shapeDraft){if(marks.length>=200)return;const before=currentState();remember();const m={id:window.crypto.randomUUID(),page:camera.page,kind:tool.value,points:[],text:'',color:find('[data-color]').value,thickness:insertionThickness()};shapeDraft={id:m.id,before,dirty};marks.push(m);}const m=marks.find(m=>m.id===shapeDraft.id);if(m.points.length<256)m.points.push(p);shapeActions.hidden=false;render();controls();}
  function finishShapeDraft(){if(!shapeDraft)return;const m=marks.find(m=>m.id===shapeDraft.id),minimum=m.kind==='polygon'?3:2;if(m.points.length<minimum){message('Add at least '+minimum+' points.');return;}selectedShapeId=m.id;shapeDraft=null;shapeActions.hidden=true;changed();}
  function cancelShapeDraft(){if(!shapeDraft)return;const d=shapeDraft;shapeDraft=null;restore(d.before);undo.pop();dirty=d.dirty;shapeActions.hidden=true;render();controls();message(dirty?'Unsaved changes':'Shape cancelled');}
  // The rail owns tool choice; the sheet owns only the selected tool's settings.
  function closeTray(){
   if(photoTray)photoTray.hidden=true;
   cancelShapeDraft();
   const focused=tray.contains(document.activeElement);if(focused)document.activeElement.blur();tray.hidden=true;trayMode=null;editingTextId=null;textEditRemembered=false;
   if(keyboardView){camera=clone(keyboardView.camera);fitMode=keyboardView.fitMode;keyboardView=null;render();}
   tray.style.bottom='';delete tray.dataset.keyboardCompact;tray.style.maxHeight='';if(focused)canvas.focus({preventScroll:true});
  }
  function openTray(mode,editMark=null){
   panel(false,false);trayMode=mode;tray.hidden=false;tools.hidden=mode==='view';navigation.hidden=slide?false:mode!=='view';extraTools.hidden=true;shapeMenu.hidden=mode!=='shapes';tools.hidden=mode==='view'||mode==='shapes';for(const b of shapeMenu.querySelectorAll('button'))b.disabled=readOnly||busy||!loaded||(newShape(b.dataset.shape)&&!context?.basicShapes);
   find('[data-tray-title]').textContent=mode==='view'?'View':mode==='shapes'?'Shapes':tool.options[tool.selectedIndex].textContent;
   find('[data-tool-hint]').textContent=textKind(tool.value)&&mode==='tool'?'Done adds text to the draft. Drag to move; pinch and twist to resize and rotate.':tool.value==='eraser'&&mode!=='view'?'Erase a whole stroke on the selected layer.':'';
   if(mode==='shapes')find('[data-tool-hint]').textContent=context?.basicShapes?'Choose a shape.':'Additional shapes await SIM activation.';
   if(textKind(tool.value)&&mode==='tool'){textAnchor=editMark?clone(editMark.points[0]):{x:camera.x,y:camera.y};keyboardView={camera:clone(camera),fitMode,viewportHeight:window.innerHeight};editingTextId=editMark?.id||null;textEditRemembered=false;find('[data-text-size]').min=minimumTextSize();find('[data-text-size]').step='any';if(!editMark)find('[data-text-size]').value=explicitTextSize??Math.max(minimumTextSize(),Math.min(.2,22/(screenScale()*paper.width)));if(editMark){pendingNewText=false;textInput.value=editMark.text;find('[data-text-size]').value=editMark.fontSize??.024;find('[data-text-angle]').value=editMark.textRotation??0;}transformControls.hidden=!context?.textTransforms;if(!context?.textTransforms)find('[data-tool-hint]').textContent='Done adds text. Drag to move. Resize/rotate awaits SIM activation.';
    // Match inline rename: fresh native editor, then synchronous focus/select in the initiating gesture.
    const fresh=textInput.cloneNode(false);fresh.value=textInput.value;fresh.hidden=false;textInput.replaceWith(fresh);textInput=fresh;bindTextInput();
    keyboardLayout();focusNativeEditor(textInput);}
  }
  function keyboardLayout(){
   if(!keyboardView||tray.hidden)return;const vv=window.visualViewport,bottom=vv?Math.max(0,window.innerHeight-vv.height-vv.offsetTop):0;tray.style.bottom=(bottom+12)+'px';tray.dataset.keyboardCompact=String((vv?.height||window.innerHeight)<keyboardView.viewportHeight*.85);tray.style.maxHeight=tray.dataset.keyboardCompact==='true'?Math.max(120,(vv?.height||window.innerHeight)-canvas.getBoundingClientRect().top-80)+'px':'';
   camera=clone(keyboardView.camera);fitMode=null;render();const r=canvas.getBoundingClientRect(),top=Math.max(r.top,vv?.offsetTop||0),end=Math.min(r.bottom,tray.getBoundingClientRect().top-16);
   if(end>top+30&&matrix){const target={x:Math.min(r.width-90,r.width/2),y:(top+end)/2-r.top},q=point(matrix,paper,target.x,target.y);camera.x=camera.x+textAnchor.x-q.x;camera.y=camera.y+textAnchor.y-q.y;render();}
  }
  find('[data-tool-done]').onclick=acceptText;
  window.visualViewport?.addEventListener('resize',keyboardLayout);window.visualViewport?.addEventListener('scroll',keyboardLayout);
  // A tap used to dismiss settings must never become the first point of a stroke.
  const dismissPointers=new Set();canvas.addEventListener('pointerdown',e=>{if(!tray.hidden){dismissPointers.add(e.pointerId);canvas.setPointerCapture(e.pointerId);closeTray();e.preventDefault();e.stopImmediatePropagation();}},true);
  for(const type of ['pointermove','pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(dismissPointers.has(e.pointerId)){if(type!=='pointermove')dismissPointers.delete(e.pointerId);e.preventDefault();e.stopImmediatePropagation();}},true);
  function panel(open,restoreFocus=true){if(open)closeTray();sidebar.hidden=!open;for(const b of panels.querySelectorAll('button'))b.setAttribute('aria-expanded',String(open));if(open){drawerClose.focus();}else if(restoreFocus)find('[data-layers-toggle]').focus();}
  find('[data-layers-toggle]').onclick=()=>panel(sidebar.hidden);drawerClose.onclick=()=>panel(false);
  function toolContext(){transformControls.hidden=!textKind(tool.value)||!context?.textTransforms;activeLayer();find('[data-text]').hidden=!textKind(tool.value);for(const input of [find('[data-color]'),find('[data-thickness]')])input.closest('label').hidden=tool.value==='pan'||tool.value==='eraser';}
  function currentState(){return{marks:clone(marks),...(slide?{photos:clone(photos)}:{}),note:find('[data-layer-note]').value,name:find('[data-layer-name]').value,stepIds:[...find('[data-targets]').querySelectorAll('input:checked')].map(x=>x.value)};}
  function restore(value){marks=clone(value.marks);photos=clone(value.photos||[]);find('[data-layer-note]').value=value.note||'';find('[data-layer-name]').value=value.name||'';for(const input of find('[data-targets]').querySelectorAll('input'))input.checked=value.stepIds.includes(input.value);}
  function remember(){undo.push(currentState());if(undo.length>100)undo.shift();}
  function changed(){dirty=true;render();controls();message('Unsaved changes');}
  function entries(){return context?.layers.filter(x=>included(x.layer,stepId))||[];}
  function layerList(){
   const list=find('[data-layer-list]');list.replaceChildren();
   const rows=stackEntries().filter(x=>onPage(x.layer)).map(x=>({entry:x,selected:layer===x.layer}));if(!layer)rows.unshift({entry:null,selected:true});
   for(const {entry,selected}of rows){
    const row=document.createElement('div'),eye=document.createElement('button'),button=document.createElement('button'),item=entry?.layer,name=selected?(find('[data-layer-name]').value||'Untitled layer'):(item.name||'Drawing notes'),visible=!item||!hidden.has(key(item));
    row.className='labor-layer-row';row.dataset.selected=String(selected);row.dataset.stackId=item?key(item):activeId;
    eye.type='button';eye.className='labor-layer-eye';eye.dataset.layerEye=item?key(item):activeId;eye.setAttribute('aria-label',(visible?'Hide ':'Show ')+name);eye.setAttribute('aria-pressed',String(visible));eye.innerHTML='<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'+(visible?'':'<path d="m3 3 18 18"/>')+'</svg>';eye.disabled=!item;
    eye.onclick=()=>{if(visible)hidden.add(key(item));else hidden.delete(key(item));layerList();render();controls();};
    button.textContent=name+(entry?.reviewRequired?' - Review required':'')+(!item?' - New':'');button.type='button';button.dataset.layerId=item?key(item):activeId;button.setAttribute('aria-pressed',String(selected));
    button.title='Double-tap or double-click to rename';
    button.onclick=()=>{const id=button.dataset.layerId,now=Date.now(),repeat=lastLayerTap.id===id&&now-lastLayerTap.time<450;lastLayerTap={id,time:now};if(selected){if(repeat)renameLayer(button);return;}navigate(()=>choose(entries().indexOf(entry),camera.page));};
    button.ondblclick=e=>{e.preventDefault();if(selected)renameLayer(button);};
    button.onkeydown=e=>{if(e.key==='F2'&&selected){e.preventDefault();renameLayer(button);}};row.append(eye,button);if(item)row.append(orderGrip(key(item),name));list.append(row);
   }activeLayer();visibleLayers();
  }

  // Stack order is a device-local viewing preference scoped to this step, source and version.
  // Never reorder context.layers: shared layers and other consumers retain their own order.
  const orderCache=new Map(),orderUndo=[];
  const orderKey=()=>JSON.stringify(['dle-drawing-stack-v1',intakeId,stepId,source?.documentId,source?.sha256,options.version??'draft',...(camera.page===1?[]:[camera.page])]);
  function stackEntries(){const id=orderKey();if(!orderCache.has(id)){let saved=[];try{const value=JSON.parse(localStorage.getItem(id)||'[]');if(Array.isArray(value)&&value.every(v=>typeof v==='string'))saved=value;}catch{}orderCache.set(id,saved);}
   const saved=orderCache.get(id),items=entries().filter(x=>onPage(x.layer)).slice().reverse();return items.sort((a,b)=>{const ai=saved.indexOf(key(a.layer)),bi=saved.indexOf(key(b.layer));return (ai<0?-1:ai)-(bi<0?-1:bi);});}
  function persistOrder(ids){orderCache.set(orderKey(),ids);try{localStorage.setItem(orderKey(),JSON.stringify(ids));return true;}catch{message('Layer order is temporary: this browser could not save the view preference.');return false;}}
  function moveLayer(id,target){if(busy||!loaded)return;const ids=stackEntries().map(x=>key(x.layer)),from=ids.indexOf(id);target=Math.max(0,Math.min(ids.length-1,target));if(from<0||from===target)return;orderUndo.push({key:orderKey(),ids:ids.slice()});ids.splice(target,0,ids.splice(from,1)[0]);const saved=persistOrder(ids);layerList();render();orderUndoButton.hidden=false;if(saved)message('Layer order saved on this device.');find('[data-stack-grip="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});}
  const orderNote=document.createElement('small');orderNote.className='labor-stack-hint';orderNote.textContent='Top row is on top. Order is saved for this step on this device.';find('[data-layer-list]').before(orderNote);
  const orderUndoButton=document.createElement('button');orderUndoButton.type='button';orderUndoButton.dataset.undoOrder='';orderUndoButton.textContent='Undo order';orderUndoButton.hidden=true;find('[data-layer-list]').after(orderUndoButton);
  orderUndoButton.onclick=()=>{if(busy)return;const index=orderUndo.findLastIndex(x=>x.key===orderKey());if(index<0)return;const previous=orderUndo.splice(index,1)[0];persistOrder(previous.ids);layerList();render();orderUndoButton.hidden=!orderUndo.some(x=>x.key===orderKey());};
  function orderGrip(id,name){const grip=document.createElement('button');grip.type='button';grip.dataset.stackGrip=id;grip.className='labor-stack-grip';grip.textContent='\u283f';grip.setAttribute('aria-label','Reorder '+name);grip.title='Drag to reorder. Arrow Up / Down moves one row; Ctrl+Z undoes order.';let drag=null;
   grip.onkeydown=e=>{if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();const ids=stackEntries().map(x=>key(x.layer)),at=ids.indexOf(id);moveLayer(id,e.key==='Home'?0:e.key==='End'?ids.length-1:at+(e.key==='ArrowUp'?-1:1));}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();orderUndoButton.click();}};
   grip.onpointerdown=e=>{if(e.button!==0||busy||!loaded)return;e.preventDefault();e.stopPropagation();drag={id:e.pointerId,y:e.clientY,target:stackEntries().findIndex(x=>key(x.layer)===id)};grip.setPointerCapture(e.pointerId);grip.closest('.labor-layer-row').dataset.dragging='true';};
   grip.onpointermove=e=>{if(drag?.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();const rows=[...find('[data-layer-list]').children].filter(r=>r.querySelector('[data-stack-grip]'));let target=rows.findIndex(r=>e.clientY<r.getBoundingClientRect().bottom);if(target<0)target=rows.length-1;drag.target=target;for(const [i,row]of rows.entries())row.dataset.dropTarget=String(i===target);const r=sidebar.getBoundingClientRect();if(e.clientY<r.top+50)sidebar.scrollTop-=16;else if(e.clientY>r.bottom-50)sidebar.scrollTop+=16;};
   const finish=e=>{if(drag?.id!==e.pointerId)return;const d=drag;drag=null;for(const row of find('[data-layer-list]').children){delete row.dataset.dragging;delete row.dataset.dropTarget;}if(e.type==='pointerup'&&Math.abs(e.clientY-d.y)>5)moveLayer(id,d.target);};grip.onpointerup=grip.onpointercancel=grip.onlostpointercapture=finish;return grip;
  }
  const visibleSummary=document.createElement('span');visibleSummary.className='labor-visible-summary';visibleSummary.setAttribute('aria-label','Visible drawing layers');activeBar.prepend(visibleSummary);
  function visibleLayers(){const names=stackEntries().filter(x=>onPage(x.layer)&&!hidden.has(key(x.layer))&&JSON.stringify(x.layer.source)===JSON.stringify(source)).map(x=>(x.layer===layer?find('[data-layer-name]').value:x.layer.name)||'Drawing notes');if(!layer&&context)names.unshift(find('[data-layer-name]').value||'Drawing notes');visibleSummary.textContent=names.length?'Visible ('+names.length+'): '+names.join(', '):'No visible layers';visibleSummary.title=names.join(', ');visibleSummary.setAttribute('aria-label',visibleSummary.textContent);}

  const activeLabel=document.createElement('section');activeLabel.className='labor-active-label';activeLabel.setAttribute('aria-label','Active drawing layer');activeLabel.innerHTML='<button type="button" data-active-label-title aria-label="Move active layer label" title="Drag to move; arrow keys also move this label"></button><div data-active-label-usage tabindex="0"></div>';stage.append(activeLabel);
  let labelPosition={x:0,y:0},labelDrag=null;
  function positionActiveLabel(){const w=Math.max(0,stage.clientWidth-activeLabel.offsetWidth-96),h=Math.max(0,stage.clientHeight-activeLabel.offsetHeight-16);activeLabel.style.left=(8+labelPosition.x*w)+'px';activeLabel.style.top=(8+labelPosition.y*h)+'px';}
  function updateActiveLabel(){if(!context)return;const title=find('[data-layer-name]').value||'Untitled layer',invisible=layer&&hidden.has(key(layer)),state=[invisible?'hidden':'',readOnly?'read-only':''].filter(Boolean).join(', ');
   find('[data-active-label-title]').textContent=title+(state?' ('+state+')':'');find('[data-active-label-title]').setAttribute('aria-label',title+(state?' ('+state+')':'')+'. Move active layer label');
   const members=[...find('[data-targets]').querySelectorAll('input:checked')].map(n=>n.value),labels=members.map(id=>options.targetLabels?.find(t=>t.id===id)?.label||context.targets?.find(t=>t.id===id)?.name||(id===stepId?stepLabel:'Unavailable step'));
   const usage=find('[data-active-label-usage]');usage.textContent='Used in: '+(labels.length?labels.join('; '):'None');usage.title=usage.textContent;positionActiveLabel();
  }
  const labelHandle=find('[data-active-label-title]');
  labelHandle.onpointerdown=e=>{if(labelDrag||e.button!==0)return;e.preventDefault();e.stopPropagation();labelDrag={id:e.pointerId,x:e.clientX,y:e.clientY,position:{...labelPosition}};labelHandle.setPointerCapture(e.pointerId);};
  labelHandle.onpointermove=e=>{if(labelDrag?.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();const w=Math.max(1,stage.clientWidth-activeLabel.offsetWidth-96),h=Math.max(1,stage.clientHeight-activeLabel.offsetHeight-16);labelPosition={x:clamp(labelDrag.position.x+(e.clientX-labelDrag.x)/w),y:clamp(labelDrag.position.y+(e.clientY-labelDrag.y)/h)};positionActiveLabel();};
  const finishLabelMove=e=>{if(labelDrag?.id!==e.pointerId)return;if(e.type==='pointercancel')labelPosition=labelDrag.position;labelDrag=null;positionActiveLabel();};labelHandle.onpointerup=labelHandle.onpointercancel=labelHandle.onlostpointercapture=finishLabelMove;
  labelHandle.onkeydown=e=>{const d={ArrowLeft:[-.05,0],ArrowRight:[.05,0],ArrowUp:[0,-.05],ArrowDown:[0,.05]}[e.key];if(d){e.preventDefault();e.stopPropagation();labelPosition={x:clamp(labelPosition.x+d[0]),y:clamp(labelPosition.y+d[1])};positionActiveLabel();}};

  function targets(members){const list=find('[data-targets]');list.replaceChildren();for(const target of context.targets||[{id:stepId,name:stepLabel}]){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=target.id;check.checked=members.includes(target.id);check.disabled=readOnly;check.onchange=()=>{const next=check.checked;check.checked=!next;remember();check.checked=next;changed();};label.append(check,document.createTextNode((options.targetLabels?.find(x=>x.id===target.id)?.label||target.name+(target.parentId?' / '+(context.targets.find(x=>x.id===target.parentId)?.name||'Sub-operation'):''))));list.append(label);}}
  let lastLayerTap={id:null,time:0};
  function renameLayer(button){
   if(readOnly||busy||!loaded||!button.isConnected||find('[data-rename]'))return;
   const input=document.createElement('input'),accept=document.createElement('button'),cancel=document.createElement('button'),editor=document.createElement('div');
   editor.className='labor-layer-rename';input.dataset.rename='';input.maxLength=100;input.value=find('[data-layer-name]').value;input.setAttribute('aria-label','Rename layer');
   accept.textContent='Done';cancel.textContent='Cancel';accept.type=cancel.type='button';editor.append(input,accept,cancel);button.replaceWith(editor);
   let finished=false;
   const finish=(apply,blur=false)=>{if(finished)return;const value=input.value.trim();if(apply&&!value){input.setCustomValidity('Enter a layer name');input.reportValidity();input.focus();return;}finished=true;
    if(apply&&value!==find('[data-layer-name]').value){remember();find('[data-layer-name]').value=value;changed();}if(blur){setTimeout(()=>{if(!closed)layerList();},0);}else{layerList();find('[data-layer-list] [aria-pressed="true"][data-layer-id]')?.focus();}};
   input.oninput=()=>{input.setCustomValidity('');};input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(true);}if(e.key==='Escape'){e.preventDefault();finish(false);}};
   accept.onclick=()=>finish(true);cancel.onclick=()=>finish(false);
   // Accept an unfinished nonempty name before navigation/save so the existing dirty guard owns it.
   editor.addEventListener('focusout',()=>{queueMicrotask(()=>{if(!editor.contains(document.activeElement)){if(input.value.trim())finish(true,true);else finish(false,true);}});});
   focusNativeEditor(input);
  }
  find('[data-new-layer]').onclick=()=>navigate(()=>{retainedDraft=null;choose(-1,camera.page);panel(true);});
  find('[data-remove-layer]').onclick=()=>{if(readOnly)return;remember();for(const input of find('[data-targets]').querySelectorAll('input'))input.checked=false;changed();message('Removal from every step is pending. Save notes to apply, or Undo / Discard to cancel.');};
  const canvasMessage=document.createElement('div');canvasMessage.className='labor-canvas-message';canvasMessage.setAttribute('aria-hidden','true');canvasMessage.textContent='Loading Drawing Notes.';canvas.append(canvasMessage);
  if(window.DleOsRuntimeConfig?.environment==='SIMULATION'&&document.body.dataset.simRuntime==='true')installKeyboardDiagnostic(dialog,sidebar,()=>panel(false));
  const abort=new AbortController();find('[data-layer-note]').onfocus=()=>{if(!readOnly)remember();};find('[data-layer-note]').oninput=()=>{if(!readOnly){dirty=true;message('Unsaved Drawing Notes.');controls();}};
  function message(text){status.dataset.routine=String(text==='Read-only quotation reference.'||text==='Ready'||text==='Work instructions');status.textContent=text;canvasMessage.hidden=loaded;canvasMessage.textContent=text;}
  function controls(){
   activeLayer();strokeControls();
   find('[data-discard]').disabled=busy||!dirty;find('[data-page]').textContent='Page '+camera.page;
   for(const key of ['save','save-view','undo'])find('[data-'+key+']').disabled=(key==='save-view'?!canSaveView:readOnly)||busy||!loaded||(key==='undo'&&!undo.length);
   if(find('[data-photo-tool]')){find('[data-photo-tool]').hidden=readOnly;find('[data-photo-tool]').disabled=busy||!loaded||readOnly;}
   find('[data-layer-note]').disabled=busy||!context;tool.disabled=readOnly||busy||!loaded;find('[data-text]').disabled=readOnly||busy||!loaded;
   for(const el of dialog.querySelectorAll('[data-layer-name],[data-color],[data-thickness],[data-text-size],[data-text-angle],[data-new-layer],[data-remove-layer],[data-targets] input'))el.disabled=readOnly||busy||!loaded;
   if(shapeDraft){find('[data-save]').disabled=true;find('[data-save-view]').disabled=true;}find('[data-back]').disabled=busy;find('[data-source]').disabled=busy;
   for(const key of ['prev','next','in','out','rotate','reset'])find('[data-'+key+']').disabled=busy||!context;
   find('[data-prev]').disabled=busy||!context?.singlePageLayers||camera.page<=1;find('[data-next]').disabled=busy||!context?.singlePageLayers||!pageCount||camera.page>=pageCount;const select=find('[data-page-select]');if(select.options.length!==(pageCount||1)){select.replaceChildren(...Array.from({length:pageCount||1},(_,i)=>new Option(String(pageCount?i+1:camera.page),String(pageCount?i+1:camera.page))));}select.value=String(camera.page);select.disabled=busy||!pageCount||!context?.singlePageLayers;find('[data-page-count]').textContent=pageCount?'of '+pageCount:context?.singlePageLayers?'Page count unavailable':'Page navigation awaits SIM activation';
  }
  function render(){
   if(nativeForm)return;
   if(!loaded){marksGroup.replaceChildren();photoGroup.replaceChildren();return;}
   const box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;
   if(fitMode==='width'){const sideways=camera.rotation%180!==0,w=sideways?paper.height:paper.width,h=sideways?paper.width:paper.height,k=Math.min(1,box.height*w/(box.width*h));camera.width=camera.height=Math.max(.01,k);if(slide?.summary){swipeViewWidth=camera.width;if(camera.rotation===0)camera.y=camera.height/2;}}
   if(fitMode==='page')camera.width=camera.height=1;
   if(letterOutline&&roomyDocument){const inset=8,area={x:inset,y:inset,width:Math.max(1,box.width-2*inset),height:Math.max(1,box.height-2*inset)};for(const node of [letterOutline,letterClip])for(const [k,v]of Object.entries(area))node.setAttribute(k,v);matrix=transform(camera,paper,area);matrix.e+=inset;matrix.f+=inset;}else if(letterOutline){const scale=Math.min(box.width/1056,box.height/816),x=(box.width-1056*scale)/2,y=(box.height-816*scale)/2;for(const[k,v]of Object.entries({x,y,width:1056*scale,height:816*scale}))letterOutline.setAttribute(k,v);for(const[k,v]of Object.entries({x:x+48*scale,y:y+112*scale,width:960*scale,height:624*scale}))letterClip.setAttribute(k,v);matrix=transform(camera,paper,{width:960*scale,height:624*scale});matrix.e+=x+48*scale;matrix.f+=y+112*scale;}else matrix=transform(camera,paper,box);paperGroup.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
   find('[data-zoom]').textContent=Math.round(100/camera.width)+'%';
   textPreview.hidden=!keyboardView;if(keyboardView&&textAnchor){textPreview.textContent=find('[data-text]').value||'Text';textPreview.style.left=(matrix.a*textAnchor.x*paper.width+matrix.c*textAnchor.y*paper.height+matrix.e)+'px';textPreview.style.top=(matrix.b*textAnchor.x*paper.width+matrix.d*textAnchor.y*paper.height+matrix.f)+'px';}
   image.setAttribute('width',paper.width);image.setAttribute('height',paper.height);renderPhotos();marksGroup.replaceChildren();
   const ns='http://www.w3.org/2000/svg';
   const visible=stackEntries().slice().reverse().filter(x=>onPage(x.layer)&&!hidden.has(key(x.layer))&&JSON.stringify(x.layer.source)===JSON.stringify(source)).flatMap(x=>x.layer===layer?marks:x.layer.marks);
   if(!layer)visible.push(...marks);
   for(const mark of visible.filter(m=>m.page===camera.page)){
    const {node,textNode}=appendMark(marksGroup,mark,paper);
    if(mark.id===selectedShapeId&&shapeKinds.includes(mark.kind)&&!readOnly&&!shapeDraft&&!(layer&&hidden.has(key(layer)))){mark.points.forEach((p,index)=>{if(mark.kind==='callout'&&index===0)return;const h=document.createElementNS(ns,'circle');h.dataset.shapeHandle=String(index);h.dataset.shapeMark=mark.id;h.setAttribute('cx',p.x*paper.width);h.setAttribute('cy',p.y*paper.height);h.setAttribute('r',7/Math.hypot(matrix.a,matrix.b));h.setAttribute('fill','#fff');h.setAttribute('stroke','#147ace');h.setAttribute('stroke-width',2/Math.hypot(matrix.a,matrix.b));h.dataset.textSelection='';const hit=h.cloneNode();hit.setAttribute('r',22/screenScale());hit.setAttribute('fill','transparent');hit.setAttribute('stroke','none');hit.style.pointerEvents='all';h.removeAttribute('data-shape-handle');h.style.pointerEvents='none';marksGroup.append(hit,h);});}

    if(textKind(mark.kind)&&mark.id===selectedTextId&&!readOnly){const b=textNode.getBBox(),outline=document.createElementNS(ns,'rect');for(const[k,v]of Object.entries({x:b.x-4,y:b.y-4,width:b.width+8,height:b.height+8,fill:'none',stroke:'#147ace','stroke-width':1/Math.hypot(matrix.a,matrix.b),'stroke-dasharray':'4 3',transform:textNode.getAttribute('transform'),'pointer-events':'none'}))outline.setAttribute(k,v);outline.dataset.textSelection='';marksGroup.append(outline);}

   }
  }


  function shapeAt(e){const p=local(e),x=p.x*paper.width,y=p.y*paper.height,pad=10/Math.hypot(matrix.a,matrix.b);return [...marks].reverse().find(m=>{if(m.page!==camera.page||!shapeKinds.includes(m.kind)||m.kind==='callout')return false;const n=[...marksGroup.children].find(n=>n.dataset.markId===m.id);if(!n)return false;const b=n.getBBox();return x>=b.x-pad&&x<=b.x+b.width+pad&&y>=b.y-pad&&y<=b.y+b.height+pad;});}
  function stash(){retainedDraft=dirty&&source?{source:clone(source),...currentState(),layerId:activeId,baseRevision:layer?.revision||0}:null;onDraft?.(retainedDraft);}
  function scheduleQuality(){clearTimeout(qualityTimer);if(!loaded||closed||qualityFailed||!(context?.renderMaxDimension>2200))return;
   const max=Math.min(4096,context.renderMaxDimension),wanted=Math.min(max,Math.ceil(Math.max(paper.width,paper.height)*Math.hypot(matrix.a,matrix.b)*Math.min(2,window.devicePixelRatio||1)/512)*512);
   if(wanted<=rasterPixels*1.2)return;qualityTimer=setTimeout(()=>upgrade(wanted),250);
  }
  async function upgrade(pixels){
   if(slide && slide.kind!=='DRAWING')return;
   qualityController?.abort();const request=new AbortController();qualityController=request;const sourceKey=JSON.stringify(source),pageNumber=camera.page;
   try{const response=await window.fetch(pageBase+'/'+encodeURIComponent(source.documentId)+'/'+encodeURIComponent(source.sha256)+'/'+pageNumber+'?pixels='+pixels,{credentials:'same-origin',cache:'no-store',signal:request.signal});if(!response.ok)throw new Error();
    const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error();const url=URL.createObjectURL(blob),probe=new Image();probe.src=url;try{await probe.decode();}catch(e){URL.revokeObjectURL(url);throw e;}
    if(closed||request!==qualityController||pageNumber!==camera.page||sourceKey!==JSON.stringify(source)){URL.revokeObjectURL(url);return;}
    // Keep the original paper coordinate system even when source raster dimensions increase.
    const previous=objectUrl;objectUrl=url;image.setAttribute('href',url);rasterPixels=Math.max(probe.naturalWidth,probe.naturalHeight);if(previous)URL.revokeObjectURL(previous);if(status.textContent.includes('Sharper preview unavailable'))message(dirty?'Unsaved changes':readOnly?'Read-only quotation reference.':'Ready');
   }catch(e){if(!closed&&e.name!=='AbortError'&&request===qualityController){qualityFailed=true;find('[data-retry]').hidden=false;message((dirty?'Unsaved changes. ':'')+'Sharper preview unavailable; current page retained. Retry.');}}
  }
  async function page(){
   clearTimeout(qualityTimer);qualityController?.abort();qualityController=null;qualityFailed=false;controller?.abort();controller=new AbortController();const current=controller;loaded=false;marksGroup.replaceChildren();image.removeAttribute('href');find('[data-retry]').hidden=true;controls();message('Loading page '+camera.page+'.');
   try{if(slide?.mount){canvas.style.display='none';navigation.hidden=true;toolbar.hidden=true;const content=document.createElement('div');content.className='job-instruction-content';content.style.cssText='position:absolute;inset:0 48px;overflow:auto;background:white;touch-action:pan-y';stage.append(content);const restore=slide.mount(content);if(restore)dialog.addEventListener('close',restore,{once:true});loaded=true;message('');return;}if(nativeForm){
     const forms=await letterPages();const result=slide.parts?await forms.composeMany(slide.parts.map(p=>({...p,signal:current.signal}))):await forms.compose({kind:slide.kind,summary:slide.summary,loadBase:slide.loadBase,loadPhoto:slide.loadPhoto,layer:slide.layer,caption:slide.pageCaption??slide.caption,context:slide.context,signal:current.signal});
     if(closed||current!==controller)return;
     canvas.style.display='none';navigation.hidden=true;toolbar.hidden=true;
     let frame=stage.querySelector('.labor-native-form');if(!frame){frame=document.createElement('iframe');frame.className='labor-native-form';frame.title='Letter form pages';frame.style.cssText='display:block;position:absolute;inset:0 48px;width:calc(100% - 96px);height:100%;border:0;background:#dce3e8;touch-action:pan-y';stage.append(frame);}
     frame.onload=()=>{const doc=frame.contentDocument;let start=null;doc.addEventListener('touchstart',e=>{start=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;},{passive:true});doc.addEventListener('touchmove',e=>{if(e.touches.length!==1)start=null;},{passive:true});doc.addEventListener('touchcancel',()=>{start=null;},{passive:true});doc.addEventListener('touchend',e=>{const first=start;start=null;if(!first||e.touches.length||!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-first.x,dy=e.changedTouches[0].clientY-first.y;if(Math.abs(dx)>80&&Math.abs(dx)>Math.abs(dy)*1.8)dialog.querySelector(dx<0?'[data-slide-next]':'[data-slide-previous]')?.click();},{passive:true});};
     frame.srcdoc=forms.document(result);loaded=true;message(result.pages+' '+result.orientation+' Letter '+(result.pages===1?'page':'pages')+' · Scroll to read');return;
    }
    if(slide?.summary){
     paperGroup.querySelector('[data-protected-base]')?.remove();
     paper=appendStartBase(paperGroup,slide.summary);paperGroup.append(photoGroup,marksGroup);
     loaded=true;if(paper.height>1000&&camera.width===1&&camera.height===1&&camera.rotation===0){fitMode='width';render();camera.y=camera.height/2;}render();swipeViewWidth=camera.width;message(readOnly?'Work instructions':'Annotate work instructions. Edit notes in Labor.');return;
    }
    if(context.singlePageLayers&&!slide&&!pageCounts.has(JSON.stringify(source))){const info=await window.fetch(pageBase+'/'+encodeURIComponent(source.documentId)+'/'+encodeURIComponent(source.sha256)+'/info',{credentials:'same-origin',cache:'no-store',signal:current.signal});if(!info.ok)throw new Error('Page count unavailable. Retry.');const meta=await info.json();if(!Number.isInteger(meta.pageCount)||meta.pageCount<1)throw new Error('Invalid page count. Retry.');if(current!==controller)return;pageCounts.set(JSON.stringify(source),meta.pageCount);pageCount=meta.pageCount;controls();}const response=slide?.loadBase ? await slide.loadBase(current.signal) : await window.fetch(pageBase+'/'+encodeURIComponent(source.documentId)+'/'+encodeURIComponent(source.sha256)+'/'+camera.page,{credentials:'same-origin',cache:'no-store',signal:current.signal});
    if(!response.ok)throw new Error('The exact source page could not be displayed. Retry or use Back.');
    const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error('Drawing page unavailable.');
    const url=URL.createObjectURL(blob),probe=new Image();probe.src=url;try{await probe.decode();}catch(e){URL.revokeObjectURL(url);throw e;}
    if(closed||current!==controller){URL.revokeObjectURL(url);return;}if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=url;paper={width:probe.naturalWidth,height:probe.naturalHeight};rasterPixels=Math.max(paper.width,paper.height);image.setAttribute('href',url);loaded=true;if(slide?.kind==='BOM'&&paper.height>1000&&camera.width===1&&camera.height===1&&camera.rotation===0){fitMode='width';render();camera.y=camera.height/2;}render();swipeViewWidth=camera.width;scheduleQuality();
    message(layer&&layerPage(layer)==null?'Legacy layer spans pages; read-only. A reviewed split is required.':compatibilityReadOnly?'Read-only preview - editing awaits SIM activation.':retainedDraft&&dirty&&readOnly?'Saved notes changed; retained edits require review. Discard to reload the saved layer.':readOnly?'Read-only quotation reference.' : dirty?'Unsaved changes':'Ready');
   }catch(e){if(!closed&&e.name!=='AbortError'&&current===controller){message(e.message);find('[data-retry]').hidden=false;}}
   finally{if(!closed&&current===controller)controls();}
  }
  function choose(index,pageNumber=null){selectedShapeId=null;selectedTextId=null;selectedTextId=null;
   closeTray();
   if(activeId)histories.set(activeId,undo);
   const entry=index===-1?null:entries()[index];layer=entry?.layer||null;activeId=layer?layer.layerId||null:retainedDraft?.layerId||window.crypto.randomUUID();source=layer?.source||context.source;undo=histories.get(activeId)||[];
   marks=clone(layer?.marks||[]);photos=clone(layer?.photos||[]);selectedPhoto=null;find('[data-layer-note]').value=layer?.note||'';camera=clone(layer?.savedView||defaults());if(pageNumber!=null)camera.page=pageNumber;else if(context.singlePageLayers&&layer&&layerPage(layer)!=null)camera.page=layerPage(layer);pageCount=pageCounts.get(JSON.stringify(source))??null;fitMode=null;dirty=false;
   readOnly=!editable||!context.canEdit||!!entry?.reviewRequired||(!!layer&&layerPage(layer)==null);canSaveView=options.version==null&&options.canSaveView!==false&&(context.canSaveView??context.canEdit)&&!entry?.reviewRequired&&!!layer&&layerPage(layer)!=null;
   find('[data-layer-name]').value=layer?.name||'Drawing notes';targets(layer?.stepIds||[layer?.stepId||stepId]);
   const draftSourceStale=retainedDraft&&(retainedDraft.layerId??null)===activeId&&JSON.stringify(retainedDraft.source)!==JSON.stringify(source);
   if(draftSourceStale){source=clone(retainedDraft.source);readOnly=true;canSaveView=false;}
   if(retainedDraft&&(retainedDraft.layerId??null)===activeId){
    restore({...retainedDraft,name:retainedDraft.name||'Drawing notes',stepIds:retainedDraft.stepIds||[stepId]});dirty=true;if(retainedDraft.baseRevision!==(layer?.revision||0)){readOnly=true;canSaveView=false;}
   }
   find('[data-layer-note]').readOnly=readOnly;tool.value='pan';toolContext();
   heading.querySelector('strong').textContent=source.assembly+' Rev '+source.revision;
   find('.labor-annotation-identity').textContent=stepLabel+' · '+source.assembly+' Rev '+source.revision+' · '+source.name+' · Source '+source.documentId+' / '+source.sha256.slice(0,12)+(entry?.reviewRequired||draftSourceStale?' · REVIEW REQUIRED: source revision changed':'')+(readOnly?' · Read-only':'');
   layerList();void page();
  }
  async function save(action){
   if((action==='view'?!canSaveView:readOnly)||busy||!loaded)return;if(action==='marks'&&marks.some(m=>newShape(m.kind))&&!context.basicShapes){message('New shapes require SIM activation before saving.');return false;}if(shapeDraft){message('Finish or cancel the shape first.');return false;}if(action==='marks'&&!context.textTransforms&&marks.some(m=>m.fontSize!=null||m.textRotation!=null)){message('Text transforms require SIM activation before saving. Your draft is retained.');return false;}busy=true;controls();message('Saving '+(action==='view'?'author view':'Drawing Notes')+'.');
   try{if(slide){const value={...clone(layer),marks:action==='marks'?clone(marks):clone(layer.marks),photos:action==='marks'?clone(photos):clone(layer.photos||[]),savedView:action==='view'?clone(keyboardView?.camera||camera):clone(layer.savedView),revision:layer.revision+1};await slide.save(value);layer=value;context.layers[0].layer=value;if(action==='marks')dirty=false;stash();render();message('Slide draft updated. Save Labor to preserve it.');return true;}const response=await window.fetch(base+'/'+encodeURIComponent(stepId),{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:layer?.revision||0,expectedLaborRevision:context.laborRevision,source,action,page:camera.page,layerId:activeId,name:find('[data-layer-name]').value,stepIds:currentState().stepIds,marks:action==='marks'?marks:null,note:action==='marks'?find('[data-layer-note]').value:null,savedView:action==='view'?(keyboardView?.camera||camera):null})});
    let body;try{body=await response.json();}catch{throw new Error('Save could not be confirmed. Your edits remain here.');}if(!response.ok)throw new Error(body.message||'Save failed. Your edits remain here.');
    layer=body;canSaveView=options.version==null&&options.canSaveView!==false&&(context.canSaveView??context.canEdit);const prior=context.layers.find(x=>key(x.layer)===key(body)&&JSON.stringify(x.layer.source)===JSON.stringify(source));if(prior)prior.layer=body;else context.layers.push({layer:body,reviewRequired:false});if(action==='marks'){marks=clone(body.marks);dirty=false;}if(action==='view'){try{localStorage.setItem(openingLayerKey(),key(body));}catch{}}stash();onSaved?.(body);layerList();render();if(!included(body,stepId)){retainedDraft=null;choose(entries().length?0:-1);return;}message(action==='view'?'Opening view saved.':'Marks saved.');return true;
   }catch(e){message(e.message);return false;}finally{busy=false;controls();}
  }
  function leave(){if(!readOnly&&trayMode==='tool'&&textKind(tool.value))acceptText();navigate(()=>{stash();if(options.onExit)dialog.addEventListener('close',options.onExit,{once:true});dialog.close();});}
  dialog.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.matches('input,textarea,select')&&!guard.open){e.preventDefault();find('[data-undo]').click();return;}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(shapeDraft){cancelShapeDraft();return;}if(guard.open){cancelNavigation();return;}if(!tray.hidden||(photoTray&&!photoTray.hidden))closeTray();else if(!sidebar.hidden)panel(false);else leave();}});
  find('[data-back]').onclick=leave;dialog.addEventListener('cancel',e=>{e.preventDefault();if(!tray.hidden||(photoTray&&!photoTray.hidden))closeTray();else if(!sidebar.hidden)panel(false);else leave();});
  find('[data-save]').onclick=async()=>{if(!readOnly&&trayMode==='tool'&&textKind(tool.value))acceptText();if(await save('marks')&&options.returnOnApply)dialog.close();};find('[data-save-view]').onclick=()=>save('view');
  find('[data-reset]').onclick=()=>{fitMode=null;camera=clone(layer?.savedView||defaults());void page();};
  function switchPage(number){controls();if(busy||!context?.singlePageLayers||!pageCount||number<1||number>pageCount||number===camera.page)return;if(shapeDraft||keyboardView){message('Finish or close the current tool before changing pages.');return;}navigate(()=>{if(gesture?.before){restore(gesture.before);undo.pop();}gesture=null;pointers.clear();retainedDraft=null;const index=layer&&layerPage(layer)==null?entries().findIndex(x=>x.layer===layer):entries().findIndex(x=>layerPage(x.layer)===number&&JSON.stringify(x.layer.source)===JSON.stringify(source));choose(index,number);});}
  find('[data-page-select]').onchange=e=>switchPage(Number(e.target.value));find('[data-prev]').onclick=()=>switchPage(camera.page-1);find('[data-next]').onclick=()=>switchPage(camera.page+1);find('[data-retry]').onclick=()=>{if(loaded&&qualityFailed){qualityFailed=false;find('[data-retry]').hidden=true;scheduleQuality();}else void page();};
  function zoom(factor,anchor=null,destination=null){
   if(!loaded||busy||!matrix)return;fitMode=null;const box=canvas.getBoundingClientRect(),a=anchor||{x:box.width/2,y:box.height/2},p=point(matrix,paper,a.x,a.y);
   camera.width=Math.max(.01,Math.min(1,camera.width/factor));camera.height=Math.max(.01,Math.min(1,camera.height/factor));
   const next=transform(camera,paper,box),b=destination||a,q=point(next,paper,b.x,b.y);camera.x=clamp(camera.x+p.x-q.x);camera.y=clamp(camera.y+p.y-q.y);render();scheduleQuality();
  }
  function fit(mode){if(!loaded)return;fitMode=mode;camera.x=camera.y=.5;render();scheduleQuality();}
  find('[data-fit-page]').onclick=()=>fit('page');find('[data-fit-width]').onclick=()=>fit('width');
  find('[data-in]').onclick=()=>zoom(1.5);find('[data-out]').onclick=()=>zoom(1/1.5);find('[data-rotate]').onclick=()=>{camera.rotation=(camera.rotation+90)%360;render();scheduleQuality();};
  canvas.addEventListener('wheel',e=>{if(!loaded||busy)return;e.preventDefault();const r=canvas.getBoundingClientRect();zoom(Math.exp(-Math.max(-300,Math.min(300,e.deltaY))*.003),{x:e.clientX-r.left,y:e.clientY-r.top});},{passive:false});
  tool.onchange=()=>{closeTray();toolContext();openTray('shapes');};
  function discard(){cancelShapeDraft();selectedShapeId=null;restore({marks:layer?.marks||[],photos:layer?.photos||[],note:layer?.note||'',name:layer?.name||'Drawing notes',stepIds:layer?.stepIds||[stepId]});dirty=false;retainedDraft=null;stash();render();layerList();controls();message('Unsaved changes discarded.');}
  find('[data-discard]').onclick=discard;
  find('[data-undo]').onclick=()=>{if(readOnly||busy)return;if(shapeDraft){cancelShapeDraft();return;}if(!undo.length)return;restore(undo.pop());changed();layerList();};
  function local(event){const r=canvas.getBoundingClientRect();return point(matrix,paper,event.clientX-r.left,event.clientY-r.top);}
  function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
  function erase(p){const x=p.x*paper.width,y=p.y*paper.height;marks=marks.filter(m=>{if(m.page!==camera.page)return true;const node=[...marksGroup.children].find(n=>n.dataset.markId===m.id);if(!node)return true;const tolerance=Math.max(paper.width,paper.height)*((m.thickness||.003)/2+.012),geometry=node.matches('path,rect,ellipse')?[node]:[...node.querySelectorAll('path,rect')];if(m.kind==='text'){const b=node.getBBox();return !(x>=b.x&&x<=b.x+b.width&&y>=b.y&&y<=b.y+b.height);}return !geometry.some(n=>{const length=n.getTotalLength();for(let i=0,count=Math.min(512,Math.max(2,Math.ceil(length/Math.max(1,tolerance))));i<=count;i++){const q=n.getPointAtLength(length*i/count);if(Math.hypot(x-q.x,y-q.y)<=tolerance)return true;}return false;});});}
  function pinch(){const [a,b]=[...pointers.values()].filter(x=>x.type==='touch');if(!a||!b)return null;return{distance:Math.hypot(a.x-b.x,a.y-b.y),x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
  function textAt(e){if(readOnly||layer&&hidden.has(key(layer)))return null;const p=local(e),x=p.x*paper.width,y=p.y*paper.height,pad=10/Math.hypot(matrix.a,matrix.b);return [...marksGroup.querySelectorAll('text[data-mark-id]')].reverse().find(n=>{const m=marks.find(m=>m.id===n.dataset.markId);if(!m)return false;const r=n.getBBox(),a=m.points[0],cx=a.x*paper.width,cy=a.y*paper.height,t=-(m.textRotation||0)*Math.PI/180,dx=x-cx,dy=y-cy,px=cx+dx*Math.cos(t)-dy*Math.sin(t),py=cy+dx*Math.sin(t)+dy*Math.cos(t);return px>=r.x-pad&&px<=r.x+r.width+pad&&py>=r.y-pad&&py<=r.y+r.height+pad;})?.dataset.markId;}
  function photoAt(event){const p=local(event);return [...photos].reverse().find(image=>{const angle=-(image.rotation||0)*Math.PI/180,dx=(p.x-image.x-image.width/2)*paper.width,dy=(p.y-image.y-image.height/2)*paper.height;return Math.abs(dx*Math.cos(angle)-dy*Math.sin(angle))<=image.width*paper.width/2&&Math.abs(dx*Math.sin(angle)+dy*Math.cos(angle))<=image.height*paper.height/2;});}
  function touchPair(){const [a,b]=[...pointers.values()].filter(p=>p.type==='touch').map(p=>local({clientX:p.x,clientY:p.y}));if(!a||!b)return null;const dx=(b.x-a.x)*paper.width,dy=(b.y-a.y)*paper.height;return{x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(dx,dy),angle:Math.atan2(dy,dx)*180/Math.PI};}
  function beginTextChange(){if(!gesture.before){gesture.before=currentState();remember();}gesture.moved=true;}

  canvas.addEventListener('click',()=>{const id=pendingText;pendingText=null;const mark=marks.find(m=>m.id===id);if(mark&&!readOnly){closeTray();selectedTextId=id;selectedShapeId=mark.kind==='callout'?id:null;tool.value=mark.kind;toolContext();openTray('tool',mark);}});
  canvas.onpointerdown=e=>{if(e.target.closest?.('[data-step-jump]'))return;pendingText=null;
   if(!loaded||busy||e.button!==0)return;
   if(gesture?.pointerType==='pen'&&e.pointerType!=='pen')return;
   // Contact size is not a reliable palm signal. Touch navigates only; active pen owns ink.
   if(e.pointerType==='touch'&&pointers.size>=2)return;if(e.pointerType==='pen'){if(gesture?.before){restore(gesture.before);undo.pop();render();}pointers.clear();gesture=null;}
   pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});canvas.setPointerCapture(e.pointerId);
   const p=local(e),pair=pinch();
   const handle=e.target.closest?.('[data-shape-handle]');if(!pair&&handle&&(tool.value==='pan'||shapeKinds.includes(tool.value))&&!readOnly&&!(layer&&hidden.has(key(layer)))){const m=marks.find(m=>m.id===handle.dataset.shapeMark);if(m){gesture={kind:'shapehandle',mark:m,index:Number(handle.dataset.shapeHandle),before:currentState(),pointerId:e.pointerId,pointerType:e.pointerType};remember();return;}}
   if(pair&&['photomove','photoresize'].includes(gesture?.kind)){
    if(!slide.imageTransformsSupported){restore(gesture.before);undo.pop();gesture={kind:'blocked'};render();message('Image pinch and twist require the updated SIM runtime.');return;}
    gesture.kind='phototransform';gesture.base=clone(gesture.photo);gesture.pair=touchPair();return;
   }
   if(pair&&gesture?.before&&['shapemove','shapehandle','mark','photomove','photoresize'].includes(gesture.kind)){restore(gesture.before);undo.pop();render();}
if(pair){if(gesture?.kind==='textselect'||gesture?.kind==='textmove'){if(!context.textTransforms){message('Text resize/rotate awaits SIM activation.');gesture={kind:'blocked'};return;}const m=marks.find(m=>m.id===gesture.textId);gesture.kind='texttransform';gesture.base=clone(m);gesture.pair=touchPair();gesture.moved=true;return;}gesture={kind:'pinch',pair};return;}const textId=['text','callout','pan'].includes(tool.value)?textAt(e):null;if(textId){selectedTextId=textId;gesture={kind:'textselect',textId,point:p,base:clone(marks.find(m=>m.id===textId)),startX:e.clientX,startY:e.clientY,pointerId:e.pointerId,pointerType:e.pointerType};return;}
   if(['photo','pan'].includes(tool.value)&&slide?.photosSupported&&!readOnly&&!spacePan&&!(layer&&hidden.has(key(layer)))){const photo=e.target.closest?.('[data-photo-resize]')?photos.find(p=>p.id===e.target.closest('[data-photo-id]')?.dataset.photoId):photoAt(e);selectedPhoto=photo?.id||null;if(photo){selectedTextId=null;selectedShapeId=null;gesture={kind:e.target.closest?.('[data-photo-resize]')?'photoresize':'photomove',photo,base:clone(photo),point:p,before:currentState(),pointerId:e.pointerId,pointerType:e.pointerType};remember();render();return;}render();}
   if(tool.value==='pan'&&!readOnly&&!(layer&&hidden.has(key(layer)))){const m=shapeAt(e);if(m){selectedShapeId=m.id;selectedTextId=null;gesture={kind:'shapemove',mark:m,base:clone(m),point:p,before:currentState(),pointerId:e.pointerId,pointerType:e.pointerType};remember();render();return;}selectedShapeId=null;}
   if(newShape(tool.value)&&!context.basicShapes){gesture={kind:'blocked'};message('New shapes await SIM activation.');return;}
   if(['polygon','polyline'].includes(tool.value)&&!spacePan&&!readOnly&&!(layer&&hidden.has(key(layer)))&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1){gesture={kind:'vertices',point:p,startX:e.clientX,startY:e.clientY,pointerId:e.pointerId,pointerType:e.pointerType};return;}
   if(tool.value==='pan'||tool.value==='photo'||textKind(tool.value)||spacePan||readOnly||(e.pointerType==='touch'&&!shapeKinds.includes(tool.value))){gesture={kind:'pan',point:p,pointerId:e.pointerId,pointerType:e.pointerType};return;}
   if(layer&&hidden.has(key(layer))){message('Selected layer is hidden. Show layer to mark.');return;}
   if(gesture||p.x<0||p.x>1||p.y<0||p.y>1||(marks.length>=200&&tool.value!=='eraser'))return;
   if(textKind(tool.value)&&!find('[data-text]').value.trim()){message('Enter text, then tap its location on the drawing.');return;}
   const before=currentState();remember();
   if(tool.value==='eraser'){erase(p);gesture={kind:'erase',before,pointerId:e.pointerId,pointerType:e.pointerType};render();return;}
   const m={id:window.crypto.randomUUID(),page:camera.page,kind:tool.value,points:[p],text:textKind(tool.value)?find('[data-text]').value.trim():'',color:find('[data-color]').value,thickness:insertionThickness()};
   if(m.kind!=='text')m.points.push(p);marks.push(m);if(shapeKinds.includes(m.kind))selectedShapeId=m.id;gesture={kind:'mark',mark:m,before,pointerId:e.pointerId,pointerType:e.pointerType};render();
  };
  canvas.onpointermove=e=>{
   if(!gesture||!loaded||!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
   if(gesture.kind==='blocked')return;if(gesture.kind==='vertices'){if(Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)>8)gesture.moved=true;return;}
   if(gesture.kind==='texttransform'){const q=touchPair(),m=marks.find(m=>m.id===gesture.textId);if(!q||!m||!gesture.pair.distance)return;beginTextChange();const base=gesture.base,pair=gesture.pair,ratio=q.distance/pair.distance,angle=q.angle-pair.angle,anchor=gesturePoint(base.points[0],pair,q,paper);m.points[0]={x:clamp(anchor.x),y:clamp(anchor.y)};m.fontSize=Math.max(minimumTextSize(),Math.min(.2,(base.fontSize??.024)*ratio));m.textRotation=(((base.textRotation||0)+angle+540)%360)-180;render();return;}
   if(gesture.kind==='phototransform'){const q=touchPair(),b=gesture.base;if(!q||!gesture.pair.distance)return;const ratio=Math.max(.001/Math.min(b.width,b.height),q.distance/gesture.pair.distance),center=gesturePoint({x:b.x+b.width/2,y:b.y+b.height/2},gesture.pair,q,paper),w=b.width*ratio,h=b.height*ratio;Object.assign(gesture.photo,constrainImage({...b,x:center.x-w/2,y:center.y-h/2,width:w,height:h,rotation:(b.rotation||0)+q.angle-gesture.pair.angle},paper));gesture.moved=true;render();return;}
   if(gesture.kind==='pinch'){const pair=pinch();if(pair&&gesture.pair.distance>0){const r=canvas.getBoundingClientRect();zoom(pair.distance/gesture.pair.distance,{x:gesture.pair.x-r.left,y:gesture.pair.y-r.top},{x:pair.x-r.left,y:pair.y-r.top});gesture.pair=pair;}return;}
   if(gesture.pointerId!==e.pointerId)return;const p=local(e);
   if(gesture.kind==='photomove'){const b=gesture.base;Object.assign(gesture.photo,constrainImage({...b,x:b.x+p.x-gesture.point.x,y:b.y+p.y-gesture.point.y},paper));render();return;}
   if(gesture.kind==='photoresize'){const b=gesture.base,t=(b.rotation||0)*Math.PI/180,c=Math.cos(t),s=Math.sin(t),cx=(b.x+b.width/2)*paper.width,cy=(b.y+b.height/2)*paper.height,ax=cx-c*b.width*paper.width/2+s*b.height*paper.height/2,ay=cy-s*b.width*paper.width/2-c*b.height*paper.height/2,dx=p.x*paper.width-ax,dy=p.y*paper.height-ay,w=Math.max(.001,(dx*c+dy*s)/paper.width),h=w*b.height/b.width;Object.assign(gesture.photo,constrainImage({...b,x:(ax+c*w*paper.width/2-s*h*paper.height/2)/paper.width-w/2,y:(ay+s*w*paper.width/2+c*h*paper.height/2)/paper.height-h/2,width:w,height:h},paper));render();return;}
   if(gesture.kind==='shapehandle'){gesture.mark.points[gesture.index]={x:clamp(p.x),y:clamp(p.y)};render();return;}
   if(gesture.kind==='shapemove'){const pts=gesture.base.points,dx=Math.max(-Math.min(...pts.map(p=>p.x)),Math.min(1-Math.max(...pts.map(p=>p.x)),p.x-gesture.point.x)),dy=Math.max(-Math.min(...pts.map(p=>p.y)),Math.min(1-Math.max(...pts.map(p=>p.y)),p.y-gesture.point.y));gesture.mark.points=pts.map(p=>({x:p.x+dx,y:p.y+dy}));render();return;}
if(gesture.kind==='textselect'){if(Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)<8)return;gesture.kind='textmove';}if(gesture.kind==='textmove'){beginTextChange();const m=marks.find(m=>m.id===gesture.textId);m.points[0]={x:clamp(gesture.base.points[0].x+p.x-gesture.point.x),y:clamp(gesture.base.points[0].y+p.y-gesture.point.y)};render();return;}
   if(gesture.kind==='pan'){fitMode=null;camera.x=clamp(camera.x+gesture.point.x-p.x);camera.y=clamp(camera.y+gesture.point.y-p.y);render();return;}
   if(gesture.kind==='erase'){erase(p);render();return;}
   const m=gesture.mark,v={x:clamp(p.x),y:clamp(p.y)};if(m.kind==='text')return;
   if(m.kind==='freehand'||m.kind==='marker'){if(m.points.length>=256)m.points=m.points.filter((_,i)=>i%2===0);m.points.push(v);}else m.points[1]=v;render();
  };
  function finish(e,cancel){if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);if(!['pinch','texttransform','phototransform','blocked'].includes(gesture?.kind)&&gesture?.pointerId!==e.pointerId)return;
   if(!cancel){if(gesture?.kind==='textselect'&&!gesture.moved)pendingText=gesture.textId;else if(gesture?.mark?.kind==='text')pendingText=gesture.mark.id;}
   if(!cancel&&gesture?.kind==='vertices'&&!gesture.moved)addVertex(gesture.point);const wasText=['textselect','textmove','texttransform','phototransform','blocked'].includes(gesture?.kind);if(wasText&&gesture?.moved)pendingText=null;
   if(gesture?.before){if(cancel){restore(gesture.before);undo.pop();render();}else if(['shapemove','photomove','photoresize','phototransform'].includes(gesture.kind)&&JSON.stringify(gesture.before)===JSON.stringify(currentState()))undo.pop();else changed();}gesture=null;if(wasText){pointers.clear();controls();return;}const remaining=[...pointers.entries()].find(([,p])=>p.type==='touch');if(remaining){const [id,p]=remaining;gesture={kind:'pan',point:local({clientX:p.x,clientY:p.y}),pointerId:id,pointerType:'touch'};}controls();}
  canvas.onpointerup=e=>finish(e,false);canvas.onpointercancel=e=>finish(e,true);canvas.onlostpointercapture=e=>finish(e,true);
  canvas.onkeyup=e=>{if(e.code==='Space'){spacePan=false;e.preventDefault();}};canvas.onblur=()=>{spacePan=false;};
  canvas.onkeydown=e=>{if(!loaded||busy)return;if(e.code==='Space'){spacePan=true;e.preventDefault();return;}if(e.key==='+'||e.key==='='){zoom(1.5);e.preventDefault();return;}if(e.key==='-'){zoom(1/1.5);e.preventDefault();return;}fitMode=null;const delta=.05;if(e.key==='ArrowLeft')camera.x=clamp(camera.x-delta);else if(e.key==='ArrowRight')camera.x=clamp(camera.x+delta);else if(e.key==='ArrowUp')camera.y=clamp(camera.y-delta);else if(e.key==='ArrowDown')camera.y=clamp(camera.y+delta);else return;e.preventDefault();render();};
  find('[data-source]').onchange=()=>{const next=Number(find('[data-source]').value);navigate(()=>choose(next));};
  const resize=new ResizeObserver(()=>{render();positionActiveLabel();scheduleQuality();});resize.observe(canvas);
  window.addEventListener('beforeunload',e=>{if(dirty&&!closed){e.preventDefault();e.returnValue='';}},{signal:abort.signal});
  let switchingToOrganizer=false;
  dialog.addEventListener('close',e=>{if(e.target!==dialog)return;closed=true;window.visualViewport?.removeEventListener('resize',keyboardLayout);window.visualViewport?.removeEventListener('scroll',keyboardLayout);clearTimeout(qualityTimer);qualityController?.abort();abort.abort();controller?.abort();resize.disconnect();if(objectUrl)URL.revokeObjectURL(objectUrl);for(const asset of photoAssets.values())if(asset.url)URL.revokeObjectURL(asset.url);dialog.remove();if(!switchingToOrganizer)options.onClose?.();if(main){main.scrollTop=scroll.top;main.scrollLeft=scroll.left;}const focus=trigger?.closest('.labor-actions')?.querySelector('[data-action="options"]')||trigger;if(focus?.isConnected)focus.focus({preventScroll:true});});
  document.body.append(dialog);dialog.showModal();controls();if(options.onMount){const restore=options.onMount(dialog,heading);if(restore)dialog.addEventListener('close',restore,{once:true});}
  try{const response=slide?{ok:true,json:async()=>({contractVersion:2,laborRevision:0,source:slide.layer.source,canEdit:editable,canSaveView:editable,singlePageLayers:true,basicShapes:true,textTransforms:true,zoomSizedShapes:true,targets:[{id:stepId,name:stepLabel}],layers:[{layer:clone(slide.layer),reviewRequired:false}]})}:await window.fetch(base+(options.version!=null?'?version='+encodeURIComponent(options.version):''),{credentials:'same-origin',cache:'no-store',signal:abort.signal});if(!response.ok)throw new Error('Drawing Notes are unavailable in this session. Use Back to return to Labor.');context=await response.json();if(![1,2].includes(context.contractVersion))throw new Error('Drawing Notes could not open with this backend version. Use Back; no notes were changed.');compatibilityReadOnly=context.contractVersion===1;if(compatibilityReadOnly){context.canEdit=false;context.canSaveView=false;}if(closed)return;
   const choices=entries(),select=find('[data-source]');select.replaceChildren();choices.forEach((x,i)=>{const o=document.createElement('option');o.value=i;o.textContent=x.layer.source.name+' Rev '+x.layer.source.revision+(x.reviewRequired?' — Review required':' — Current');select.append(o);});
   let index=choices.findIndex(x=>!x.reviewRequired);try{const preferred=localStorage.getItem(openingLayerKey()),at=choices.findIndex(x=>!x.reviewRequired&&key(x.layer)===preferred);if(at>=0)index=at;}catch{}if(retainedDraft?.layerId){const found=choices.findIndex(x=>x.layer.layerId===retainedDraft.layerId);index=found;}if(index<0){const option=document.createElement('option');option.value=-1;option.textContent='Current drawing — new layer';select.append(option);index=-1;}select.hidden=true;select.value=index;choose(index);
   if(slide&&options.onOrganize){const organizeButton=document.createElement('button');organizeButton.type='button';organizeButton.dataset.organizeSlides='';organizeButton.textContent='Organize Slides';heading.append(organizeButton);organizeButton.onclick=()=>{if(shapeDraft){message('Finish or cancel the current shape before organizing slides.');return;}if(!readOnly&&trayMode==='tool'&&textKind(tool.value))acceptText();navigate(()=>{switchingToOrganizer=true;dialog.addEventListener('close',()=>{void options.onOrganize();},{once:true});dialog.close();});};}
   if(options.contextNotice){const notice=document.createElement('p');notice.className='labor-slide-draft-notice';notice.textContent=options.contextNotice;heading.after(notice);}
   if(slide){dialog.classList.add('labor-slide-editor');if(!editable)dialog.classList.add('labor-slide-reading');pageBar.hidden=true;panels.hidden=true;find('[data-back]').textContent=options.backLabel||(options.onAdvance?'Return to authoring':'Back to slides');find('[data-guard-save]').textContent='Apply marks to slide';guard.querySelector('p').textContent='Apply these marks to the Labor draft before continuing? Save Labor preserves the draft.';saveButton.textContent='Apply marks to slide';find('[data-save-view]').textContent='Use this view';find('[data-reset]').textContent='Reset view';heading.querySelector('strong').textContent=stepLabel;
    const caption=document.createElement('p');caption.className='labor-slide-caption';caption.tabIndex=0;caption.setAttribute('aria-label','Slide text');caption.textContent=slide.caption||'';heading.after(caption);if(editable||options.draftNotice){const notice=document.createElement('p');notice.className='labor-slide-draft-notice';notice.textContent=editable?[options.editorContext,'Apply marks to slide updates the Labor draft. Save Labor preserves your changes.'].filter(Boolean).join(' — '):options.draftNotice;caption.after(notice);}
    if(!editable){quickTools.remove();tools.hidden=true;saveButton.hidden=true;find('[data-save-view]').hidden=true;}else{navigation.classList.add('labor-editor-view-controls');navigation.setAttribute('aria-label','Opening view');navigation.hidden=false;status.before(navigation);}
    if(options.onPreviewMaterialsChange){const label=document.createElement('label'),input=document.createElement('input');label.className='labor-preview-materials';input.type='checkbox';input.dataset.includeMaterials='';input.checked=!!options.includeMaterials;label.append(input,document.createTextNode('Include Materials/Kit'));label.title='Preview scope only. A new full preview starts with Materials/Kit excluded.';input.onchange=()=>{const included=input.checked;input.disabled=true;navigate(()=>{switchingToOrganizer=true;dialog.addEventListener('close',()=>{void options.onPreviewMaterialsChange(included);},{once:true});dialog.close();});};heading.append(label);}
    if(options.onEditBom){const editBom=document.createElement('button');editBom.type='button';editBom.dataset.editBom='';editBom.textContent='Edit BOM fields';editBom.onclick=async()=>{if(await options.onEditBom(editBom)){dialog.addEventListener('close',()=>{void options.onReload?.();},{once:true});dialog.close();}};heading.append(editBom);}
    if(options.onPrint){const print=document.createElement('button');print.type='button';print.dataset.printOperation='';print.textContent='Print this operation';print.onclick=()=>options.onPrint(print);heading.append(print);}
    if(options.onAdvance){const nav=document.createElement('nav');nav.className='labor-slide-playback';const prev=document.createElement('button'),next=document.createElement('button'),progress=document.createElement('output');prev.setAttribute('aria-label','Previous');next.setAttribute('aria-label','Next');prev.title='Previous slide';next.title='Next slide';prev.dataset.slidePrevious='';next.dataset.slideNext='';prev.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4L7 12l8 8"/></svg>';next.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l8 8-8 8"/></svg>';prev.className=next.className='labor-slide-side-arrow';progress.textContent=options.progress;prev.disabled=!options.hasPrevious;next.disabled=!options.hasNext;let advancing=false;const advance=delta=>{if(advancing)return;advancing=true;prev.disabled=next.disabled=true;dialog.addEventListener('close',()=>options.onAdvance(delta),{once:true});dialog.close();};prev.onclick=()=>advance(-1);next.onclick=()=>advance(1);const printButton=heading.querySelector('[data-print-operation]');if(printButton)nav.append(printButton);nav.append(progress);if(options.onJump){dialog.addEventListener('click',e=>{const link=e.target.closest?.('[data-step-jump]');if(!link||advancing)return;e.preventDefault();e.stopPropagation();advancing=true;dialog.addEventListener('close',()=>options.onJump(link.dataset.stepJump),{once:true});dialog.close();});}if(options.onEdit){const edit=document.createElement('button');edit.type='button';edit.dataset.editCurrentSlide='';edit.textContent=options.onEditBom?'Annotate':options.editLabel==='Edit source in Labor'?'Edit source':'Edit';edit.setAttribute('aria-label',options.onEditBom?'Annotate BOM slide':options.editLabel||'Edit current slide');edit.onclick=()=>{if(advancing)return;advancing=true;edit.disabled=prev.disabled=next.disabled=true;dialog.addEventListener('close',()=>{void options.onEdit();},{once:true});dialog.close();};nav.append(edit);}stage.append(prev,next);if(options.onSaveDraft){const saveDraft=document.createElement('button');saveDraft.type='button';saveDraft.dataset.saveLabor='';saveDraft.textContent=options.saveLabel||'Save Labor';nav.append(saveDraft);saveDraft.onclick=async()=>{if(advancing)return;advancing=true;for(const b of [...nav.querySelectorAll('button'),prev,next])b.disabled=true;try{await options.onSaveDraft();dialog.addEventListener('close',()=>{void options.onReload();},{once:true});dialog.close();}catch(e){message(e.message);advancing=false;for(const b of nav.querySelectorAll('button'))b.disabled=false;prev.disabled=!options.hasPrevious;next.disabled=!options.hasNext;}};}heading.append(nav);const contextBar=document.createElement('div');contextBar.className='labor-slide-context-bar';heading.after(contextBar);contextBar.append(caption);
     if(options.operationTabs?.length){
      const tabs=document.createElement('nav');tabs.className='labor-operation-tabs';tabs.setAttribute('aria-label','Operator turns');
      let contact=null,dragged=false;tabs.addEventListener('pointerdown',e=>{contact={x:e.clientX,y:e.clientY};dragged=false;},{passive:true});tabs.addEventListener('pointermove',e=>{if(contact&&Math.hypot(e.clientX-contact.x,e.clientY-contact.y)>8)dragged=true;},{passive:true});tabs.addEventListener('pointerup',()=>{contact=null;},{passive:true});tabs.addEventListener('pointercancel',()=>{contact=null;dragged=true;},{passive:true});
      for(const tab of options.operationTabs){const button=document.createElement('button');button.type='button';button.dataset.operationTab=tab.id;button.textContent=tab.label;button.title=tab.description||tab.label;if(tab.active)button.setAttribute('aria-current','step');button.onclick=e=>{if(e.detail&&dragged)return;if(options.onSelectOperation){if(advancing)return;advancing=true;dialog.addEventListener('close',()=>options.onSelectOperation(tab.id),{once:true});dialog.close();}else advance(tab.offset);};tabs.append(button);}
      contextBar.prepend(tabs);const active=tabs.querySelector('[aria-current]');const reveal=()=>{if(!active||!tabs.isConnected)return;const row=tabs.getBoundingClientRect(),item=active.getBoundingClientRect();if(item.left<row.left)tabs.scrollLeft-=row.left-item.left;else if(item.right>row.right)tabs.scrollLeft+=item.right-row.right;};const observer=new ResizeObserver(reveal);observer.observe(tabs);requestAnimationFrame(reveal);dialog.addEventListener('close',()=>observer.disconnect(),{once:true});
     }
     dialog.addEventListener('keydown',e=>{if(nativeForm||e.target.matches('input,textarea,select,.labor-slide-caption'))return;if(e.key==='PageDown'&&!next.disabled){e.preventDefault();next.click();}if(e.key==='PageUp'&&!prev.disabled){e.preventDefault();prev.click();}});
     // Capture on the common playback surface: every slide type, including text and image descendants.
     // Pinches, zoomed panning, controls, and all editor gestures remain owned by their existing handlers.
     let touch=null;
     dialog.addEventListener('touchstart',e=>{touch=!nativeForm&&e.touches.length===1&&e.target.closest?.('.labor-annotation-canvas,.labor-slide-caption')&&tray.hidden&&camera.width>=swipeViewWidth*.99?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;},{passive:true,capture:true});
     dialog.addEventListener('touchmove',e=>{if(e.touches.length!==1)touch=null;},{passive:true,capture:true});
     dialog.addEventListener('touchcancel',()=>{touch=null;},{capture:true});
     dialog.addEventListener('touchend',e=>{if(!touch||e.touches.length)return;const end=e.changedTouches[0],dx=end.clientX-touch.x,dy=end.clientY-touch.y;touch=null;if(Math.abs(dx)<70||Math.abs(dx)<Math.abs(dy)*2)return;if(dx<0&&!next.disabled)next.click();else if(dx>0&&!prev.disabled)prev.click();},{passive:true,capture:true});
    }
   }
  }catch(e){if(!closed&&e.name!=='AbortError'){message(e.message);controls();}}
 }
 window.DleLaborDrawingNotes=Object.freeze({open,transform,point,appendMark,appendStartBase,letterPages});
})(window,document);

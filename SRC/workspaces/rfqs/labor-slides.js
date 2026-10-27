(function(window,document){
 'use strict';
 const clone=v=>structuredClone(v),uid=()=>window.crypto.randomUUID();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const view=page=>({page,x:.5,y:.5,width:1,height:1,rotation:0});
 const stage=(page,name='Stage 1')=>({id:uid(),name,marks:[],savedView:view(page)});
 const duplicate=card=>{if(card.stages.some(s=>s.marks.some(m=>m.inspection)))throw Error('Linked slides cannot be copied. Create unlinked symbols explicitly.');return({...clone(card),id:uid(),stages:card.stages.map(s=>({...clone(s),id:uid(),marks:s.marks.map(m=>({...clone(m),id:uid()})),...(s.photos?{photos:s.photos.map(p=>({...clone(p),id:uid()}))}:{})}))});};
 const flatten=cards=>cards.flatMap((card,ci)=>card.stages.map((stage,si)=>({card,stage,ci,si})));
 let editorLoading,bomLoading,printLoading,travelerLoading,organizerLoading;
 async function editor(){if(!window.DleLaborTravelerPrint){travelerLoading??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='SRC/workspaces/rfqs/labor-traveler-print.js';s.onload=resolve;s.onerror=()=>{travelerLoading=null;s.remove();reject(Error('Traveler renderer unavailable. Retry.'));};document.head.append(s);});await travelerLoading;}if(window.DleLaborDrawingNotes)return;editorLoading??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='SRC/workspaces/rfqs/labor-drawing-notes.js';s.onload=resolve;s.onerror=()=>{editorLoading=null;s.remove();reject(Error('Slide editor unavailable. Retry.'));};document.head.append(s);});await editorLoading;}
 async function organizer(){if(window.DleSlideOrganizer)return;organizerLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/SRC/workspaces/rfqs/slide-organizer.js';script.onload=resolve;script.onerror=()=>{organizerLoading=null;script.remove();reject(Error('Slide organizer unavailable. Retry.'));};document.head.append(script);});await organizerLoading;}
 function connect(options){
  const {intakeId,getPlan,onChange}=options,base='/api/sim/rfqs/'+encodeURIComponent(intakeId)+'/labor',visualBase=options.visualBase||base,drawingBase=options.drawingBase||base+'/drawing-notes/pages';
  const undo=[],panels=new Map(),expanded=new Set(),displayedMains=new WeakMap();let drawing=null;
  let floating=null,hoverTimer=null,leaveTimer=null,restoringFocus=false;
  function closeFloating(restore=false){clearTimeout(hoverTimer);clearTimeout(leaveTimer);if(!floating)return;const old=floating;floating=null;old.abort.abort();old.observer?.disconnect();if(old.url)URL.revokeObjectURL(old.url);for(const url of old.urls||[])URL.revokeObjectURL(url);restoringFocus=true;old.node.remove();old.anchor.removeAttribute('aria-controls');if(old.anchor.hasAttribute('data-slide-menu'))old.anchor.setAttribute('aria-expanded','false');if(restore&&old.anchor.isConnected){restoringFocus=true;try{old.anchor.focus({preventScroll:true});}finally{restoringFocus=false;}}restoringFocus=false;}
  function floatPanel(anchor,label,menu=false){
   closeFloating();const node=document.createElement('section'),abort=new AbortController();node.className=menu?'labor-slide-action-menu':'labor-slide-quick-preview';node.id='slide-popup-'+uid();node.setAttribute('popover','manual');node.setAttribute('role',menu?'menu':'region');node.setAttribute('aria-label',label);document.body.append(node);node.showPopover();anchor.setAttribute('aria-controls',node.id);floating={node,anchor,abort};const current=floating;
   const place=()=>{const r=anchor.getBoundingClientRect(),b=node.getBoundingClientRect();node.style.left=Math.max(8,Math.min(r.left,window.innerWidth-b.width-8))+'px';node.style.top=Math.max(8,Math.min(r.bottom+6,window.innerHeight-b.height-8))+'px';};
   const closeOutside=e=>{if(!node.contains(e.target)&&!anchor.contains(e.target))closeFloating();};
   document.addEventListener('pointerdown',closeOutside,{capture:true,signal:abort.signal});document.addEventListener('focusin',closeOutside,{signal:abort.signal});document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeFloating(true);}},{capture:true,signal:abort.signal});
   // An offscreen trigger can have a queued scroll event before its menu opens.
   const initialPosition=anchor.getBoundingClientRect();window.addEventListener('scroll',e=>{if(node.contains(e.target))return;const position=anchor.getBoundingClientRect();if(position.x!==initialPosition.x||position.y!==initialPosition.y)closeFloating();},{capture:true,signal:abort.signal});window.addEventListener('resize',()=>closeFloating(),{signal:abort.signal});
   current.observer=new MutationObserver(()=>{if(!anchor.isConnected||!anchor.getClientRects().length)closeFloating();});current.observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open','data-materials-kit-hidden']});
   node.addEventListener('pointerenter',()=>clearTimeout(leaveTimer));node.addEventListener('pointerleave',e=>{if(!menu&&e.pointerType==='mouse'&&!anchor.contains(e.relatedTarget))leaveTimer=setTimeout(()=>closeFloating(),180);});return {current,place};
  }
  let bom=null;
  async function bomPages(){if(!options.bomIdentity)return null;try{if(!window.DleLaborBomSlides){bomLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/rfqs/labor-bom-slides.js';script.onload=resolve;script.onerror=()=>{bomLoading=null;script.remove();reject(Error('BOM slides unavailable.'));};document.head.append(script);});await bomLoading;}bom=options.loadBomReference?await options.loadBomReference():await window.DleLaborBomSlides.read(base.replace(/\/labor$/,'')+'/bom-reference',{definitionId:getPlan().definitionId,...options.bomIdentity()});return bom;}catch(e){bom=null;return{error:e.message};}}
  function bomSvg(card,compact=false){if(!bom||!window.DleLaborBomSlides.matches(bom,card.source))throw Error('This saved BOM page uses an earlier source. Reopen the slideshow for the current View BOM. Existing overlays are preserved.');return window.DleLaborBomSlides.svg(bom,card.page,card.source,compact);}
  async function baseResponse(card,op,operations,signal,compact=false){
   if(card.kind==='BOM')return new Response(bomSvg(card,compact),{headers:{'content-type':'image/svg+xml'}});
   if(card.kind==='DRAWING')return window.fetch(drawingBase+'/'+encodeURIComponent(card.source.documentId)+'/'+encodeURIComponent(card.source.sha256)+'/'+card.page,{credentials:'same-origin',cache:'no-store',signal});
   if(card.kind!=='IMAGE')return new Response(baseSvg(card,op,operations),{headers:{'content-type':'image/svg+xml'}});
   const r=await window.fetch(visualBase+'/visuals/'+encodeURIComponent(card.imageDocumentId),{credentials:'same-origin',cache:'no-store',signal});if(!r.ok)throw Error('Missing image asset.');const bytes=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();if(hash!==card.imageSha256)throw Error('Image source mismatch.');return new Response(bytes,{headers:{'content-type':r.headers.get('content-type')}});
  }
  async function quickPreview(op,card,anchor,explicit=false){
   if(floating?.anchor===anchor)return;const {current,place}=floatPanel(anchor,'Preview: '+card.title),{node,abort}=current;
   node.innerHTML='<header><strong>'+esc(card.kind==='START'?'Traveler page':card.title)+'</strong><button type="button" aria-label="Close preview">×</button></header><small>Stage 1 of '+card.stages.length+'</small><div class="labor-slide-preview-image"><svg viewBox="0 0 400 260" role="img" aria-label="First authored stage"></svg></div><p class="labor-slide-preview-text"></p><p data-preview-status role="status">Loading preview…</p>';
   node.querySelector('button').onclick=()=>closeFloating(true);const summary=openingSummary(card,op,ops());node.querySelector('.labor-slide-preview-text').textContent=[summary?[summary.sectionLabel,summary.label,summary.notes,...summary.substeps.map(s=>[s.label,s.notes].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n'):'',card.body].filter(Boolean).join('\n\n');place();if(explicit)node.querySelector('button').focus({preventScroll:true});
   try{await editor();if(floating!==current)return;if(summary){
     const svg=node.querySelector('svg'),group=document.createElementNS('http://www.w3.org/2000/svg','g');svg.append(group);const paper=window.DleLaborDrawingNotes.appendStartBase(group,summary),item=card.stages[0],matrix=window.DleLaborDrawingNotes.transform(item.savedView,paper,{width:400,height:260});group.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);await previewPhotos(group,item,paper,current);if(floating!==current)return;for(const mark of item.marks.filter(m=>m.page===card.page))window.DleLaborDrawingNotes.appendMark(group,mark,paper);node.querySelector('[data-preview-status]').textContent=current.photoError||'';place();return;
    }const response=await baseResponse(card,op,ops(),abort.signal);if(!response.ok)throw Error('Source preview unavailable.');const blob=await response.blob();if(floating!==current)return;current.url=URL.createObjectURL(blob);const probe=new Image();probe.src=current.url;await probe.decode();if(floating!==current)return;
    const svg=node.querySelector('svg'),ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g'),image=document.createElementNS(ns,'image'),paper={width:probe.naturalWidth,height:probe.naturalHeight},item=card.stages[0],matrix=window.DleLaborDrawingNotes.transform(item.savedView,paper,{width:400,height:260});group.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);image.setAttribute('href',current.url);image.setAttribute('width',paper.width);image.setAttribute('height',paper.height);group.append(image);svg.append(group);await previewPhotos(group,item,paper,current);if(floating!==current)return;for(const mark of item.marks.filter(m=>m.page===card.page))window.DleLaborDrawingNotes.appendMark(group,mark,paper);node.querySelector('[data-preview-status]').textContent=current.photoError||'';place();
   }catch(error){if(floating===current)node.querySelector('[data-preview-status]').textContent=error.name==='AbortError'?'':error.message;}
  }
  function actionMenu(op,card,anchor,panel){const index=op.slides.indexOf(card),{current,place}=floatPanel(anchor,'Slide actions',true),node=current.node;anchor.setAttribute('aria-expanded','true');const disabled=editable()?'':'disabled';node.innerHTML='<button role="menuitem" data-command="details">Edit text and stages</button>'+(card.kind==='BOM'||op.slidesOrganized&&['START','END'].includes(card.kind)?[]:[['before','Insert before'],['after','Insert after'],['up','Move up'],['down','Move down'],['copy','Copy to operation'],['delete','Delete slide']]).map(([command,label])=>'<button role="menuitem" data-command="'+command+'" '+(command==='up'&&index===0||command==='down'&&index===op.slides.length-1?'disabled':disabled)+'>'+label+'</button>').join('');
   node.onclick=async e=>{const command=e.target.closest('[data-command]')?.dataset.command;if(!command)return;closeFloating();try{if(command==='details'){const details=anchor.closest('[data-slide-card]').querySelector('details');details.hidden=false;details.open=true;details.querySelector('input').focus();return;}if(!editable())return;if(command==='before'||command==='after')await add(op,op.slides.indexOf(card)+(command==='after'?1:0),panel);if(command==='copy')copy(op,card);if(command==='delete'){if(window.confirm('Delete this slide from this operation? Undo remains available until leaving Labor.'))change(()=>op.slides.splice(op.slides.indexOf(card),1));}if(command==='up'||command==='down'){const from=op.slides.indexOf(card),to=from+(command==='up'?-1:1);if(from>=0&&to>=0&&to<op.slides.length)change(()=>op.slides.splice(to,0,op.slides.splice(from,1)[0]));}if(['up','down','delete'].includes(command))(panel.querySelector('[data-slide-card="'+CSS.escape(card.id)+'"] [data-slide-menu]')||panel.querySelector('[data-add-slide]'))?.focus();}catch(error){warning(panel,error);}};
   node.onkeydown=e=>{const buttons=[...node.querySelectorAll('button:not(:disabled)')],at=buttons.indexOf(document.activeElement);let next;if(e.key==='ArrowDown')next=(at+1)%buttons.length;if(e.key==='ArrowUp')next=(at-1+buttons.length)%buttons.length;if(e.key==='Home')next=0;if(e.key==='End')next=buttons.length-1;if(next!==undefined){e.preventDefault();buttons[next].focus({preventScroll:true});}};place();node.querySelector('button:not(:disabled)').focus({preventScroll:true});
  }
  const editable=()=>options.canEdit()&&options.supported();
  const ops=()=>getPlan().operations;let inspectionSession=null;
  const inspection=()=>inspectionSession??=(window.DleInspectionLinks.create(ops,()=>getPlan().definitionId));
  const validateLinks=(items=ops())=>{if(window.DleInspectionLinks)window.DleInspectionLinks.validate(window.DleInspectionLinks.entries(items,getPlan().definitionId));else if(items.some(o=>o.slides?.some(c=>c.stages.some(s=>s.marks.some(m=>m.inspection)))))throw Error('Open the slide editor before changing linked symbols.');};
  const chronological=operations=>window.DleLaborWorkbench.ordered(operations).map(r=>r.o);
  const instructionScope=operations=>clone(operations.map(o=>window.DleLaborWorkbench.resolvedInstruction(operations,o)));
  const operationLabel=o=>window.DleLaborWorkbench.operationLabel?.(o)??(!o?.parentId&&String(o?.name||'').trim().toLowerCase()==='inspection'?'Quality-Inspection':o?.name||'');
  const workAreaLabel=area=>window.DleLaborWorkbench.workAreaLabel(area);
  const physicalRoot=(o,list)=>window.DleLaborWorkbench.sectionRoot(list,o);
  function typeName(o,list){const root=physicalRoot(o,list),side=window.DleLaborWorkbench.smtSide(root);return side?'SMT-'+side:workAreaLabel(window.DleLaborWorkbench.workArea(root))||root.name?.trim()||'Unnamed operation';}
  function typeGroups(list){const groups=[];for(const root of list.filter(o=>!o.parentId)){const name=typeName(root,list);let g=groups.find(g=>g.name===name);if(!g){g={name,root,roots:[]};groups.push(g);}g.roots.push(root);}return groups;}
  const executionContexts=new WeakMap();
  async function groupedFrames(list,roots,includeExcluded=false){
   const sourceRoots=roots.filter(o=>!o.instructionSourceId),raw=await standardFrames(list,sourceRoots,includeExcluded),seen=new Set(),result=[];
   for(const root of roots.filter(o=>o.instructionSourceId))for(const child of chronological(list).filter(o=>!o.instructionSourceId&&window.DleLaborWorkbench.ancestors(list,o).some(p=>p.id===root.id)))for(const card of unfilteredCards(child))raw.push(...flatten([card]).map(f=>({...f,op:child,generated:!(child.slides||[]).some(c=>c.id===card.id),count:1})));
   const defaultKey=f=>[typeName(f.op,list),f.card.kind,f.card.page,f.card.source?.documentId||'',f.card.source?.sha256||''].join('|');
   const authoredKeys=new Set(raw.filter(f=>!f.generated&&['BOM','DRAWING'].includes(f.card.kind)).map(defaultKey));
   for(const f of raw){if(!includeExcluded&&f.card.kind!=='START'&&(f.op.excludedSlideIds||[]).includes(f.card.id))continue;const c=f.card,k=defaultKey(f),bare=!c.body&&(c.stages||[]).every(t=>!(t.marks||[]).length&&!(t.photos||[]).length&&JSON.stringify(t.savedView)===JSON.stringify(view(c.page)));
    const generatedDefault=f.generated&&['BOM','DRAWING','START','END'].includes(c.kind);
    if(generatedDefault&&authoredKeys.has(k))continue;
    const fingerprint=generatedDefault?k:(!f.op.parentId&&['START','END','BOM'].includes(c.kind)&&bare?k:null);
    const stageKey=(fingerprint||c.id)+'|'+f.si;
    if(seen.has(stageKey))continue;seen.add(stageKey);result.push(f);
   }
   // Preserve distinct operation instructions when a repeated type has one opening page.
   for(const root of sourceRoots){if(sourceRoots.filter(o=>typeName(o,list)===typeName(root,list)).length<2||!operatorNotes(root))continue;
    const card={...substep(root),id:'generated-'+root.id,title:operationLabel(root)+' instructions'};if(!includeExcluded&&(root.excludedSlideIds||[]).includes(card.id))continue;result.push(...flatten([card]).map(f=>({...f,op:root,generated:true,count:1})));
   }
   return typeGroups(list).flatMap(g=>{const all=result.filter(f=>typeName(f.op,list)===g.name);const sorted=[...all.filter(f=>f.card.kind==='START'),...all.filter(f=>!['START','END'].includes(f.card.kind)),...all.filter(f=>f.card.kind==='END')],ids=[...new Set(sorted.map(f=>f.card.id))];return sorted.map(f=>({...f,ci:ids.indexOf(f.card.id),count:ids.length}));});
  }
  // Presentation-only grouping: source cards, page coordinates and exclusions stay intact.
  function bundleBomFrames(frames,list){
   frames=frames.filter(f=>f.card.kind!=='END');
   const out=[];
   for(const f of frames){
    if(f.card.kind!=='BOM'){out.push(f);continue;}
    const group=typeName(f.op,list),members=frames.filter(x=>x.card.kind==='BOM'&&typeName(x.op,list)===group),positions=members.map(x=>frames.indexOf(x));
    const compatible=members.every(x=>!x.unavailable&&x.card.stages.length===1)&&new Set(members.map(x=>x.card.page)).size===members.length&&positions.every((v,i)=>!i||v===positions[i-1]+1);
    // Older interleaved/multi-stage/duplicate-page layouts require explicit review; never reorder or discard them.
    if(!compatible){out.push({...f,bomReview:true});continue;}
    if(f===members[0])out.push({...f,bomFrames:members});
   }
   return out.map(f=>{const group=out.filter(x=>typeName(x.op,list)===typeName(f.op,list)),ids=[...new Set(group.map(x=>x.card.id))];return {...f,ci:ids.indexOf(f.card.id),count:ids.length};});
  }
  const frameMembers=f=>f.reflowFrames||f.drawingFrames||f.bomFrames||[f];
  function bundleDrawingFrames(frames,list){
   const out=[],key=f=>JSON.stringify([f.op.id,typeName(f.op,list),f.card.source]);
   for(const f of frames){
    if(f.drawingFrames||f.card.kind!=='DRAWING'){out.push(f);continue;}
    const members=frames.filter(x=>x.card.kind==='DRAWING'&&key(x)===key(f)),positions=members.map(x=>frames.indexOf(x));
    const compatible=members.length>1&&members.every(x=>x.pristineDrawing&&!x.unavailable)&&positions.every((v,i)=>!i||v===positions[i-1]+1)&&members.every((x,i)=>!i||x.card.page>members[i-1].card.page);
    if(!compatible){out.push(f);continue;}
    if(f===members[0])out.push({...f,drawingFrames:members});
   }
   return out.map(f=>{const group=out.filter(x=>typeName(x.op,list)===typeName(f.op,list)),ids=[...new Set(group.map(x=>x.card.id))];return {...f,ci:ids.indexOf(f.card.id),count:ids.length};});
  }
  function bundleReflowFrames(frames,list){
   const groups=new Map();
   for(const frame of frames){if(!frame.card.reflowStepId)continue;
    const owner=list.find(o=>o.id===frame.card.reflowStepId);if(!owner||owner.id!==frame.op.id)throw Error('Reflow setup owner changed. Reopen Labor.');
    const root=physicalRoot(owner,list);if(!groups.has(root.id))groups.set(root.id,[]);groups.get(root.id).push(frame);
   }
   const remaining=frames.filter(f=>!f.card.reflowStepId),result=[];
   for(const type of typeGroups(list)){
    const items=remaining.filter(f=>typeName(f.op,list)===type.name),composites=[];
    for(const root of type.roots){const selectedParent=executionContexts.get(list)?.get(type.name);if(selectedParent&&root.id!==selectedParent)continue;const members=groups.get(root.id);if(!members?.length)continue;
     const order=chronological(list).map(o=>o.id);members.sort((a,b)=>order.indexOf(a.op.id)-order.indexOf(b.op.id));
     composites.push({...members[0],reflowFrames:members,reflowRootId:root.id});
    }
    const lastDrawing=items.findLastIndex(f=>f.card.kind==='DRAWING');
    const after=lastDrawing>=0?lastDrawing+1:items.findLastIndex(f=>['START','BOM'].includes(f.card.kind))+1;
    items.splice(after,0,...composites);result.push(...items);
   }
   return result;
  }
  const bundleReferenceFrames=(frames,list)=>bundleReflowFrames(bundleDrawingFrames(bundleBomFrames(frames,list),list),list);
  function mountReflowProfiles(frames,list){return container=>{
   container.classList.add('labor-drawing-stack');container.dataset.reflowSetup='';container.tabIndex=0;container.setAttribute('aria-label','Reflow setup');const abort=new AbortController(),urls=new Set();let closed=false;
   const parent=physicalRoot(frames[0].op,list),heading=document.createElement('h2'),peers=list.filter(o=>!o.parentId&&operationLabel(o)===operationLabel(parent));container.dataset.reflowParent=parent.id;heading.textContent=operationLabel(parent)+(peers.length>1?' '+(peers.findIndex(o=>o.id===parent.id)+1):'')+' - Reflow setup';container.append(heading);
   frames.forEach((frame,index)=>{const section=document.createElement('section'),label=document.createElement('h3');section.dataset.reflowStep=frame.card.reflowStepId;label.textContent='Reflow '+(index+1)+' - '+operationLabel(frame.op);section.append(label);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1200 800');svg.style.width='100%';svg.style.height='auto';svg.style.background='white';
    const photos=document.createElementNS('http://www.w3.org/2000/svg','g');svg.append(photos);for(const mark of frame.stage.marks)window.DleLaborDrawingNotes.appendMark(svg,mark,{width:1200,height:800});section.append(svg);container.append(section);
    void(async()=>{for(const photo of frame.stage.photos||[]){try{const blob=await photoBlob(photo,abort.signal);if(closed)return;const url=URL.createObjectURL(blob);urls.add(url);const image=document.createElementNS('http://www.w3.org/2000/svg','image');for(const[k,v]of Object.entries({x:photo.x*1200,y:photo.y*800,width:photo.width*1200,height:photo.height*800,href:url,preserveAspectRatio:'xMidYMid meet',transform:'rotate('+(photo.rotation||0)+' '+(photo.x+photo.width/2)*1200+' '+(photo.y+photo.height/2)*800+')'}))image.setAttribute(k,v);photos.append(image);}catch(error){if(closed)return;const message=document.createElement('p');message.textContent=error.message;section.append(message);}}})();
   });container.focus({preventScroll:true});return()=>{closed=true;abort.abort();for(const url of urls)URL.revokeObjectURL(url);};
  };}
  function ensureReflowSetup(op){
   if(!editable()||options.reflowSupported?.()!==true||!op.parentId||!/^Reflow(?:$|[\s(-])/i.test(op.name||'')||(op.slides||[]).some(c=>c.reflowStepId))return;
   const text=(value,x,y)=>({id:uid(),page:1,kind:'text',points:[{x,y}],text:value,color:'#173d4b',fontSize:.027});
   const marks=[text('Reflow setup',.065,.09)];
   for(const [y,label,values] of [[.25,'Zone',['1','2','3','4','5']],[.35,'Upper C',['-','-','-','-','-']],[.45,'Lower C',['-','-','-','-','-']]]){marks.push(text(label,.065,y));values.forEach((value,i)=>marks.push(text(value,.25+i*.115,y)));}
   marks.push(text('Belt speed: -',.065,.55));
   (op.slides||=[]).push({id:uid(),kind:'NOTE',title:'Reflow setup',body:'',page:1,reflowStepId:op.id,stages:[{...stage(1),marks}]});onChange();
  }
  const drawingTitle=f=>f.card.source?.name||'Drawing';
  function mountDrawingPages(frames,operations){return container=>{
   const abort=new AbortController(),urls=new Set();let closed=false;container.classList.add('labor-drawing-stack');container.dataset.drawingStack='';container.tabIndex=0;container.setAttribute('aria-label',drawingTitle(frames[0]));
   const pages=frames.map(f=>{const page=document.createElement('section'),status=document.createElement('p');page.dataset.drawingPage=String(f.card.page);page.dataset.documentId=f.card.source.documentId;status.setAttribute('role','status');status.textContent='Loading page '+f.card.page+'.';page.append(status);container.append(page);return {f,page,status};});
   void (async()=>{for(const {f,page,status} of pages){if(closed)return;try{const response=await baseResponse(f.card,f.op,operations,abort.signal);if(!response.ok)throw Error('unavailable');const blob=await response.blob();if(closed)return;const url=URL.createObjectURL(blob);urls.add(url);const image=new Image();image.alt=drawingTitle(f)+' - page '+f.card.page;image.src=url;await image.decode();if(closed)return;page.replaceChildren(image);}catch(error){if(closed)return;status.textContent='Page '+f.card.page+' could not be opened. Reopen the drawing to retry.';page.classList.add('is-unavailable');}}})();
   container.focus({preventScroll:true});return()=>{closed=true;abort.abort();for(const url of urls)URL.revokeObjectURL(url);};
  };}
  const compactBom=f=>!f.bomReview&&f.generated&&f.card.kind==='BOM'&&f.card.source?.documentId==='bom-reference-v5'&&!f.card.body&&f.card.stages.every(s=>!s.marks?.length&&!s.photos?.length);
  function chooseBomFrame(frames,select,cancel){
   const d=dialog('Edit BOM annotations','<p>Choose the source rows to annotate. All pages remain together in the slideshow.</p>'+frames.map((f,i)=>{const rows=bom?.pages?.[f.card.page-1];return '<button type="button" data-bom-edit="'+i+'">Source page '+f.card.page+' — '+esc(rows?.length?'Rows '+rows[0].row+'–'+rows.at(-1).row:f.card.title)+'</button>';}).join(''));
   let selected=false;d.addEventListener('close',()=>{if(!selected)cancel();});
   d.addEventListener('click',e=>{const b=e.target.closest('[data-bom-edit]');if(!b)return;selected=true;d.close();void select(frames[Number(b.dataset.bomEdit)]);});
  }
  const effectiveRole=(o,operations)=>o.responsibleRole??window.DleLaborWorkbench.sectionRoot(operations,o).responsibleRole??'';
  const operatorNotes=op=>[op.instructions,...(op.notes||[]).filter(n=>!n.removed&&n.purpose==='PRODUCTION').map(n=>n.text)].filter(t=>typeof t==='string'&&t.trim()).join('\n');
  function sectionFor(op,operations){const root=physicalRoot(op,operations),id=executionContexts.get(operations)?.get(typeName(root,operations));return operations.find(o=>o.id===id)||root;}
  function sectionLabel(op,operations){
   const section=sectionFor(op,operations),name=String(operationLabel(section)).trim()||'Unnamed operation';
   const peers=operations.filter(o=>!o.parentId&&(String(operationLabel(o)).trim()||'Unnamed operation').toLowerCase()===name.toLowerCase());
   return name+(peers.length>1?' '+(peers.findIndex(o=>o.id===section.id)+1):'');
  }
  const travelerScopes=new WeakMap();
  function travelerMetadata(operations){if(travelerScopes.has(operations))return travelerScopes.get(operations);const plan=getPlan(),version=(plan.versions||[]).find(v=>v.operations===operations);return {...options.travelerMetadata?.(),quantity:version?.quantity??plan.quantity,workOrder:options.travelerMetadata?.().workOrder||'QUOTE'};}
  function startSummary(op,operations){
   const section=sectionFor(op,operations),row=o=>({id:o.id,linked:!!operatorNotes(o)||(o.slides||[]).length>0,label:o.parentId?stepLabel(o,operations):identity(o,operations),role:effectiveRole(o,operations)||'Unassigned',notes:[operatorNotes(o),o.id===section.id?[window.DleLaborWorkbench.sectionContext(o,operations,travelerMetadata(operations).quantity),window.DleLaborWorkbench.firstPieceContext(o,operations,travelerMetadata(operations).quantity)].filter(Boolean).join(' | '):''].filter(Boolean).join('\n\n')});
   return {...row(section),travelerPlan:{...getPlan(),quantity:travelerMetadata(operations).quantity,operations},travelerRfq:options.travelerRfq?.()||{assemblies:[{assemblyNumber:travelerMetadata(operations).assembly,revision:travelerMetadata(operations).revision}]},travelerJob:options.travelerJob?.(),travelerMaterial:options.travelerMaterial?.(),travelerFocus:typeName(section,operations),traveler:travelerMetadata(operations),sectionLabel:sectionLabel(section,operations),firstInTurn:op.id===section.id,substeps:chronological(operations).filter(o=>window.DleLaborWorkbench.ancestors(operations,o).some(p=>p.id===section.id)).map(row)};
  }
  function openingSummary(card,op,operations){
   if(card.kind==='END'){
    const material=(options.materialPreparationIds||window.DleLaborWorkbench?.materialPreparationIds)?.(operations)||new Set(),owner=sectionFor(op,operations),lane=material.has(owner.id);
    const mains=(!executionContexts.has(operations)&&displayedMains.get(operations))||operations.filter(o=>!o.parentId&&material.has(o.id)===lane),next=mains[mains.findIndex(o=>o.id===owner.id)+1];
    return {kind:'END',traveler:travelerMetadata(operations),label:identity(owner,operations),sectionLabel:next?'Next Step: '+operationLabel(next):lane?'End of Materials / Kit':'End of traveler',nextOperation:next?operationLabel(next):null,nextNotes:[typeof next?.instructions==='string'?next.instructions:'',[owner.handoff,window.DleLaborWorkbench.firstPieceContext(owner,operations,travelerMetadata(operations).quantity)].filter(Boolean).join(' | ')].filter(Boolean).join('\n\n'),notes:'',substeps:[]};
   }
   if(card.kind==='SUBSTEP')return {kind:'SUBSTEP',label:operatorIdentity(op,operations),sectionLabel:sectionLabel(op,operations),notes:operatorNotes(op),substeps:[]};
   const summary=startSummary(op,operations);return card.kind==='START'||card.kind==='HANDOFF'&&card.id==='empty-'+op.id&&summary.firstInTurn?summary:null;
  }
  const substep=op=>({id:'generated-'+op.id,kind:'SUBSTEP',title:'Substep',body:[op.instructions,...(op.notes||[]).filter(n=>!n.removed&&n.purpose==='PRODUCTION').map(n=>n.text)].filter(Boolean).join('\n'),page:1,stages:[stage(1)]});
  const unfilteredCards=op=>op.parentId&&operatorNotes(op)&&!(op.slides||[]).some(c=>c.kind==='SUBSTEP')?[substep(op),...(op.slides||[])]:op.slides||[];
  const displayRow=(op,operations)=>window.DleLaborWorkbench.displayRows(operations).find(row=>row.o.id===op.id);
  const legacySequence=op=>window.DleLaborWorkbench.ordered(ops()).find(row=>row.o.id===op.id)?.seq||'';
  function identity(op,operations=ops()){return (displayRow(op,operations)?.seq||'?')+' '+operationLabel(op);}
  function stepLabel(op,operations){return 'Step '+(displayRow(op,operations)?.step||1)+': '+op.name;}
  function operatorIdentity(op,operations=ops()){return op.parentId?sectionLabel(op,operations)+' | '+stepLabel(op,operations):identity(op,operations);}

  const presentationCards=op=>unfilteredCards(op).filter(c=>!(op.excludedSlideIds||[]).includes(c.id));
  function remember(){undo.push(ops().map(o=>({id:o.id,slides:clone(o.slides||[]),slidesOrganized:o.slidesOrganized,excludedSlideIds:clone(o.excludedSlideIds)})));if(undo.length>40)undo.shift();}
  function changed(){validateLinks();onChange();}
  function change(fn){if(!editable())return;closeFloating();remember();try{fn();validateLinks();}catch(e){undoChange();throw e;}changed();paintAll();}
  function undoChange(){if(!editable()||!undo.length)return;for(const item of undo.pop()){const op=ops().find(o=>o.id===item.id);if(op){op.slides=item.slides;if(item.slidesOrganized===undefined)delete op.slidesOrganized;else op.slidesOrganized=item.slidesOrganized;if(item.excludedSlideIds===undefined)delete op.excludedSlideIds;else op.excludedSlideIds=clone(item.excludedSlideIds);}}changed();paintAll();}
  async function context(){if(options.drawingContext){drawing=await options.drawingContext();return drawing;}const r=await window.fetch(base+'/drawing-notes',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Drawing source unavailable. Existing slides are unchanged.');drawing=await r.json();return drawing;}
  const warning=(panel,error)=>{const target=panel.querySelector('[data-slide-status]');if(target)target.textContent=error.message||error;};
  function layersFor(op,card){return (drawing?.layers||[]).filter(x=>!x.reviewRequired&&(x.layer.stepIds||[x.layer.stepId]).includes(op.id)&&JSON.stringify(x.layer.source)===JSON.stringify(card.source)&&(x.layer.page??x.layer.savedView?.page)===card.page&&x.layer.marks.every(m=>m.page===card.page));}
  function importStage(layer){return {id:uid(),name:layer.name||'Imported layer',marks:clone(layer.marks).map(m=>({...m,id:uid()})),savedView:{...clone(layer.savedView),page:layer.page??layer.savedView.page}};}
  function dialog(title,html){closeFloating();const d=document.createElement('dialog');d.className='labor-slide-dialog';d.setAttribute('aria-label',title);d.innerHTML='<header><h2>'+esc(title)+'</h2><button type="button" data-cancel>Cancel</button></header>'+html;d.querySelector('[data-cancel]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d;}
  async function add(op,index,panel,commit=change,organizing=false){
   const d=dialog('Add slide','<p>Independent authored content. Existing notes and shared layers stay unchanged.</p><label>Type<select data-kind><option value="DRAWING">Drawing view</option><option value="IMAGE">Image</option><option value="NOTE">Short note</option><option value="BLANK">Blank editable canvas</option><option value="START">Traveler page</option></select></label><div data-source-options></div><p data-error role="status"></p><button data-create>Add slide here</button>');
   if(organizing){d.querySelector('h2').textContent='Insert slide in '+identity(op);}
   if(organizing||op.slidesOrganized)for(const value of ['START','END'])d.querySelector('[data-kind] option[value="'+value+'"]')?.remove();
   const position=document.createElement('label');position.innerHTML='Position<select data-insert-at><option value="0">'+((op.slides||[]).length?'Before slide 1':'First slide')+'</option>'+(op.slides||[]).map((c,i)=>'<option value="'+(i+1)+'">After '+(i+1)+' · '+esc(c.title)+'</option>').join('')+'</select>';d.querySelector('[data-kind]').closest('label').before(position);position.querySelector('select').value=String(index);if(op.slidesOrganized){for(const option of [...position.querySelector('select').options])if(Number(option.value)===0||Number(option.value)===(op.slides||[]).length)option.remove();position.querySelector('select').value=String(Math.max(1,Math.min(index,op.slides.length-1)));}
   if(organizing){position.hidden=true;position.style.display="none";}
   const kind=d.querySelector('[data-kind]'),area=d.querySelector('[data-source-options]'),error=d.querySelector('[data-error]');let serial=0,selectedSource=null;
   async function sources(){const n=++serial;selectedSource=null;area.textContent='Loading source choices...';d.querySelector('[data-create]').disabled=true;error.textContent='';try{
    if(kind.value==='DRAWING'){const c=await context();if(n!==serial||!d.open)return;const r=await window.fetch(drawingBase+'/'+encodeURIComponent(c.source.documentId)+'/'+encodeURIComponent(c.source.sha256)+'/info',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Exact drawing page count unavailable.');const data=await r.json();if(n!==serial||!d.open)return;selectedSource=clone(c.source);area.innerHTML='<p>'+esc(c.source.name)+' | Rev '+esc(c.source.revision)+'</p><label>Drawing page<select data-page>'+Array.from({length:data.pageCount},(_,i)=>'<option>'+(i+1)+'</option>').join('')+'</select></label><div data-import></div>';const imports=()=>{const page=Number(area.querySelector('[data-page]').value),layers=layersFor(op,{source:c.source,page});area.querySelector('[data-import]').innerHTML='<p>Optional: import independent copies of saved layers as ordered stages.</p>'+layers.map((x,i)=>'<label><input type="checkbox" data-import-layer="'+i+'">'+esc(x.layer.name||'Drawing layer')+'</label>').join('');};area.querySelector('[data-page]').onchange=imports;imports();
    }else if(kind.value==='IMAGE'){const visuals=ops().flatMap(o=>(o.visuals||[]).filter(v=>!v.removed));area.innerHTML='<label>Existing image<select data-image><option value="">Choose image</option>'+visuals.map(v=>'<option value="'+esc(v.documentId)+'">'+esc(v.name)+'</option>').join('')+'</select></label><label>Or upload PNG / JPEG<input type="file" data-file accept="image/png,image/jpeg"></label><small>An upload is staged in the existing immutable image journal. Save Labor to preserve its slide.</small>';
    }else area.innerHTML='<p>'+({NOTE:'Add your own operator-facing note.',BLANK:'A blank canvas ready for familiar drawing tools.',START:'Uses the worksheet title, notes and substeps. Annotations remain independent.',END:'Uses the next main operation in worksheet order. Additional authored text stays with this card.'}[kind.value])+'</p>';
    if(n===serial&&d.open)d.querySelector('[data-create]').disabled=false;
   }catch(e){if(n===serial){area.textContent='';error.textContent=e.message;}}}
   kind.onchange=sources;void sources();
   d.querySelector('[data-create]').onclick=async()=>{if(!editable())return;const button=d.querySelector('[data-create]');button.disabled=true;kind.disabled=true;try{
    const type=kind.value,page=type==='DRAWING'?Number(area.querySelector('[data-page]').value):1;
    const card={id:uid(),kind:type,title:{DRAWING:'Drawing view',IMAGE:'Image',NOTE:'Note',BLANK:'Canvas',START:'Traveler page',END:'End operation'}[type],body:'',page,stages:[stage(page)]};
    if(type==='DRAWING'){card.source=selectedSource;const layers=layersFor(op,card),selected=[...area.querySelectorAll('[data-import-layer]:checked')].map(c=>importStage(layers[Number(c.dataset.importLayer)].layer));if(selected.length)card.stages=selected;}
    if(type==='IMAGE'){let image=ops().flatMap(o=>o.visuals||[]).find(v=>v.documentId===area.querySelector('[data-image]').value);const file=area.querySelector('[data-file]').files[0];if(file){if(!['image/png','image/jpeg'].includes(file.type)||file.size===0||file.size>8*1024*1024)throw Error('Choose PNG / JPEG up to 8 MB.');if(options.uploadPhoto){image=await options.uploadPhoto(file);}else{const form=new FormData();form.append('file',file);form.append('metadata',JSON.stringify({expectedRevision:getPlan().revision,definitionId:getPlan().definitionId,rowId:op.id,parentId:op.parentId||null,operation:op.name,sequence:legacySequence(op)}));const r=await window.fetch(base+'/visuals',{method:'POST',credentials:'include',headers:{'X-SIM-Document-Upload':'1'},body:form});image=await r.json();if(!r.ok)throw Error(image.message||'Upload failed.');}}if(!image)throw Error('Choose or upload an image.');card.imageDocumentId=image.documentId;card.imageSha256=image.sha256;}
    commit(()=>{(op.slides??=[]).splice(Number(position.querySelector('select').value),0,card);});d.close();
   }catch(e){error.textContent=e.message;button.disabled=false;}finally{kind.disabled=false;}};
  }
  function copy(op,card){if(card.reflowStepId)throw Error('Duplicate the Reflow step to add another independent pass.');const d=dialog('Copy slide independently','<p>The new slide owns editable marks, stages and text. It keeps the immutable source reference.</p><label>Destination operation<select data-destination>'+ops().filter(o=>!o.instructionSourceId).map(o=>'<option value="'+esc(o.id)+'" '+(o.id!==op.id&&(card.kind!=='SUBSTEP'||!(o.slides||[]).some(c=>c.kind==='SUBSTEP'))?'':'disabled')+'>'+esc(identity(o))+'</option>').join('')+'</select></label><button data-copy>Copy to end of operation</button>');const select=d.querySelector('select');select.value=ops().find(o=>!o.instructionSourceId&&o.id!==op.id&&(card.kind!=='SUBSTEP'||!(o.slides||[]).some(c=>c.kind==='SUBSTEP')))?.id||'';d.querySelector('[data-copy]').onclick=()=>{const target=ops().find(o=>o.id===select.value);if(!target||target.instructionSourceId||target.id===op.id||(card.kind==='SUBSTEP'&&(target.slides||[]).some(c=>c.kind==='SUBSTEP')))return;change(()=>{const list=(target.slides??=[]),end=list.findIndex(c=>c.kind==='END');if(target.slidesOrganized&&['START','END'].includes(card.kind))return;list.splice(target.slidesOrganized&&end>=0?end:list.length,0,duplicate(card));});d.close();};}
  async function addStage(op,card,panel){
   if(card.kind==='DRAWING'){try{await context();}catch(e){warning(panel,e);}}
   const layers=layersFor(op,card),d=dialog('Add replacement stage','<p>Each stage replaces the previous annotation layer on this same base.</p><label>Starting content<select data-stage-source><option value="">Empty layer (base only)</option>'+layers.map((x,i)=>'<option value="'+i+'">Independent copy: '+esc(x.layer.name||'Layer')+'</option>').join('')+'</select></label><button data-stage-add>Add stage</button>');d.querySelector('[data-stage-add]').onclick=()=>{const v=d.querySelector('select').value;change(()=>card.stages.push(v===''?stage(card.page,'Stage '+(card.stages.length+1)):importStage(layers[Number(v)].layer)));d.close();};
  }
  function baseSvg(card,op,operations){
   if(['SUBSTEP','HANDOFF'].includes(card.kind))return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f7f9fa"/><rect x="55" y="80" width="1090" height="2" fill="#a3b6bd"/><text x="55" y="60" font-family="Arial" font-size="22" fill="#536a74">DLE-OS / '+(card.kind==='SUBSTEP'?(op.parentId?'SUBSTEP':'STEP'):'OPERATION CONTEXT')+'</text><text x="55" y="180" font-family="Arial" font-size="28" fill="#12394b">'+esc(operatorIdentity(op,operations).slice(0,80))+'</text></svg>';
   const template=['START','END'].includes(card.kind),label=card.kind==='START'?'TRAVELER PAGE':'END OPERATION';
   return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/>'+(template?'<rect width="1200" height="150" fill="#12394b"/><text x="55" y="60" font-family="Arial" font-size="25" fill="#89d7d1">DLE-OS / SIM AUTHOR PREVIEW</text><text x="55" y="118" font-family="Arial" font-size="38" fill="white">'+label+'</text><rect x="55" y="190" width="7" height="80" fill="#1d8c88"/><text x="80" y="222" font-family="Arial" font-size="24" fill="#12394b">'+esc(operatorIdentity(op,operations).slice(0,80))+'</text><text x="55" y="745" font-family="Arial" font-size="19" fill="#52636b">Authored reference / Navigation does not complete or authorize work</text>':'')+'</svg>';
  }
  async function photoBlob(photo,signal){const response=await window.fetch(visualBase+'/visuals/'+encodeURIComponent(photo.documentId),{credentials:'same-origin',cache:'no-store',signal});if(!response.ok)throw Error('Image unavailable: '+photo.name);const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();if(hash!==photo.sha256)throw Error('Image source mismatch: '+photo.name);return new Blob([bytes],{type:response.headers.get('content-type')});}
  async function previewPhotos(group,item,paper,current){
   for(const photo of item.photos||[]){let url=null;try{const blob=await photoBlob(photo,current.abort.signal);if(floating!==current)return;url=URL.createObjectURL(blob);(current.urls??=[]).push(url);}catch(error){if(floating!==current)return;current.photoError=error.message;}
    const image=document.createElementNS('http://www.w3.org/2000/svg',url?'image':'rect');for(const[k,v]of Object.entries({x:photo.x*paper.width,y:photo.y*paper.height,width:photo.width*paper.width,height:photo.height*paper.height}))image.setAttribute(k,v);if(url){image.setAttribute('href',url);image.setAttribute('preserveAspectRatio','xMidYMid meet');}else image.setAttribute('fill','#e4e9ed');image.setAttribute('transform','rotate('+(photo.rotation||0)+' '+(photo.x+photo.width/2)*paper.width+' '+(photo.y+photo.height/2)*paper.height+')');image.dataset.photoId=photo.id;group.append(image);
   }
  }
  async function uploadPhoto(op,file){
   if(options.uploadPhoto)return options.uploadPhoto(file);
   if(!editable()||!options.photosSupported?.())throw Error('Image overlays require the updated SIM runtime. Existing slide edits remain available.');
   if(!['image/png','image/jpeg'].includes(file.type)||!file.size||file.size>8*1024*1024)throw Error('Choose PNG or JPEG up to 8 MB. Export HEIC photos as JPEG first.');
   const form=new FormData();form.append('file',file);form.append('metadata',JSON.stringify({expectedRevision:getPlan().revision,definitionId:getPlan().definitionId,rowId:op.id,parentId:op.parentId||null,operation:op.name,sequence:legacySequence(op)}));
   const response=await window.fetch(base+'/visuals',{method:'POST',credentials:'include',headers:{'X-SIM-Document-Upload':'1'},body:form});let result;try{result=await response.json();}catch{throw Error('Image upload was not confirmed. Retry with a PNG or JPEG up to 8 MB.');}if(!response.ok)throw Error(result.message||'Image upload failed.');return result;
  }
  async function openStage(op,card,item,readonly,trigger,playOptions={},operations=ops()){
   if(!readonly&&!playOptions.draftNotice){const impact=window.DleLaborWorkbench.instructionImpact(ops(),op);playOptions={...playOptions,draftNotice:[playOptions.draftNotice,impact].filter(Boolean).join(' ')};}
   if(card.kind==='BOM'){if(!bom)await bomPages();try{await window.DleLaborBomSlides.refresh(bom);bomSvg(card);}catch(error){if(!readonly)throw error;card={...card,kind:'NOTE',title:'Saved BOM overlays need review',body:error.message,source:null};item={...item,marks:[],photos:[]};}readonly=readonly||!options.bomSupported?.();}
   closeFloating();
   const meta=travelerMetadata(operations),formContext=[meta.workOrder?'WO '+meta.workOrder:'QUOTE',meta.assembly,meta.revision?'Rev '+meta.revision:'','Qty '+meta.quantity].filter(Boolean).join(' | ');
   await editor();const source=card.source||{documentId:'slide-'+card.id,sha256:card.imageSha256||'',definitionId:getPlan().definitionId,assembly:'DLE-OS SIM',revision:'',name:card.title};
   const loadBase=card.kind==='DRAWING'?null:async signal=>{if(card.kind==='BOM')return baseResponse(card,op,operations,signal);if(card.kind!=='IMAGE')return new Response(baseSvg(card,op,operations),{headers:{'content-type':'image/svg+xml'}});const r=await window.fetch(visualBase+'/visuals/'+encodeURIComponent(card.imageDocumentId),{credentials:'same-origin',cache:'no-store',signal});if(!r.ok)throw Error('Missing image asset. This slide remains in the sequence.');const bytes=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();if(hash!==card.imageSha256)throw Error('Image source mismatch. No substitute was displayed.');return new Response(bytes,{headers:{'content-type':r.headers.get('content-type')}});};
   const organizedFromEditor=()=>organize(trigger,op.id,async()=>{
    const live=ops().find(o=>o.slides?.some(c=>c.id===card.id))||ops().find(o=>o.id===op.id),saved=live?.slides?.find(c=>c.id===card.id);
    if(!live||(live.excludedSlideIds||[]).includes(card.id)||!saved&&(live.slidesOrganized&&card.kind!=='BOM'||op.slides?.some(c=>c.id===card.id))||playOptions.canEditOwner&&!playOptions.canEditOwner(live))return playOptions.onResumePlayback?playOptions.onResumePlayback():playSequence(ops(),trigger);
    const nextCard=saved||card,nextStage=nextCard.stages.find(x=>x.id===item.id)||nextCard.stages[0],source=JSON.stringify(nextCard.source),page=nextCard.page;
    const canWrite=()=>{const current=ops().find(o=>o.id===live.id),currentCard=current?.slides?.find(c=>c.id===nextCard.id);return editable()&&current===live&&(!playOptions.canEditOwner||playOptions.canEditOwner(current))&&(saved?currentCard===nextCard&&currentCard.stages.includes(nextStage):(!currentCard||currentCard===nextCard&&currentCard.stages.includes(nextStage)))&&nextCard.page===page&&JSON.stringify(nextCard.source)===source;};
    await openStage(live,nextCard,nextStage,false,trigger,{...playOptions,canWrite,persistGenerated:saved?null:()=>{const list=(live.slides??=[]),end=list.findIndex(c=>c.kind==='END');if(!list.some(c=>c.id===nextCard.id))list.splice(end>=0?end:list.length,0,nextCard);}});
   },'Return to editor');
   await window.DleLaborDrawingNotes.open({intakeId,pendingEditorDraft:options.isDirty,compactControls:options.compactControls,durableSave:options.durableEditorSave===true,saveLabel:options.saveLabel,contextNotice:options.contextNotice,onMount:(dialog,heading)=>options.onMount?.(dialog,heading,{editing:!readonly}),onReady:(dialog,heading)=>options.onReady?.(dialog,heading,{editing:!readonly}),pageBase:drawingBase,stepId:op.id,stepLabel:operatorIdentity(op,operations),editable:!readonly&&editable(),canSaveView:!readonly&&editable(),trigger,...playOptions,onOrganize:!readonly&&playOptions.onEditorAdvance?playOptions.onOrganize:!readonly&&(operations===ops()||playOptions.onOrganize)?organizedFromEditor:playOptions.onOrganize||(operations===ops()?()=>organize(trigger,op.id,()=>playSequence(ops(),trigger)):null),
    slide:{context:formContext,mount:readonly&&playOptions.reflowFrames?mountReflowProfiles(playOptions.reflowFrames,operations):readonly&&playOptions.drawingFrames?mountDrawingPages(playOptions.drawingFrames,operations):undefined,parts:readonly&&playOptions.bomFrames?(playOptions.bomFrames.every(compactBom)?[playOptions.bomFrames[0]]:playOptions.bomFrames).map(f=>({kind:'BOM',context:formContext,loadBase:signal=>playOptions.bomFrames.every(compactBom)?new Response(window.DleLaborBomSlides.flowSvg(bom,playOptions.bomFrames.map(m=>m.card.page)),{headers:{'content-type':'image/svg+xml'}}):baseResponse(f.card,f.op,operations,signal,compactBom(f)),loadPhoto:photoBlob,layer:{...clone(f.stage),page:f.card.page},caption:f.card.body||''})):null,inspectionAuthoring:!readonly&&options.inspectionLinksSupported?.()===true?inspection().forStage(op,card,item):null,inspectionLinksSupported:options.inspectionLinksSupported?.()===true,inspectionSymbolsSupported:options.inspectionSymbolsSupported?.()===true,markerOpacitySupported:options.markerOpacitySupported?.()===true,photosSupported:!!options.photosSupported?.(),imageTransformsSupported:!!options.imageTransformsSupported?.(),uploadPhoto:file=>uploadPhoto(op,file),loadPhoto:photoBlob,kind:card.kind,pageCaption:['START','BOM'].includes(card.kind)?card.body||'':[operatorIdentity(op,operations),card.title,card.body].filter(Boolean).join(' - '),summary:openingSummary(card,op,operations),caption:card.kind==='START'?'Traveler page':playOptions.drawingFrames?drawingTitle(playOptions.drawingFrames[0]):playOptions.bomFrames?'BOM reference':playOptions.bomReview?'BOM layout needs review — existing pages retained. '+card.title:card.kind==='SUBSTEP'&&card.body===operatorNotes(op)?card.title:card.id==='empty-'+op.id&&openingSummary(card,op,operations)?'Start of section':card.title+(card.body?'\n'+card.body:''),loadBase,layer:{layerId:item.id,stepId:op.id,stepIds:[op.id],source,name:item.name,page:card.page,marks:clone(item.marks),photos:clone(item.photos||[]),savedView:clone(item.savedView),note:'',revision:1},save:async (layer,draftOnly=false)=>{if(readonly||!editable()||(playOptions.canWrite&&!playOptions.canWrite()))throw Error('This slide is no longer editable. Return to Labor and reopen it.');inspection().forStage(op,card,item).validate(layer.marks);if(playOptions.saveDraft){await playOptions.saveDraft(layer);}else{remember();item.marks=clone(layer.marks);if(layer.photos?.length||item.photos)item.photos=clone(layer.photos||[]);item.savedView=clone(layer.savedView);playOptions.persistGenerated?.();changed();}if(options.durableEditorSave&&!draftOnly){playOptions.applyDraft?.();const saved=await options.saveLabor();if(saved===false)throw Error('Draft save was not confirmed. Your edits remain here.');return saved;}}},onClose:()=>{paintAll();playOptions.onClose?.();}});
  }
  // Derived pages never write to Labor on open. Only applying overlays materializes
  // a normal schema-compatible slide, with stable IDs tied to its operation/source.
  async function stableId(key){const bytes=new Uint8Array(await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=[...bytes.slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
  async function standardCard(op,kind,page=1,source=null){const key=['labor-standard-v1',op.id,kind,source?.documentId||'',source?.sha256||'',page].join('|'),id=await stableId(key);return{id,kind,title:kind==='START'?'Traveler page':kind==='END'?'End operation':kind==='BOM'?'BOM reference - page '+page:'Assembly drawing — page '+page,body:'',page,...(source?{source:clone(source)}:{}),stages:[{id:await stableId(key+'|stage'),name:'Stage 1',marks:[],savedView:view(page)}]};}
  async function drawingPages(){
   try{
    const c=await context(),seen=new Set(),sources=[],issues=(c.sourceIssues||[]).map(x=>({documentId:x.documentId||'',name:x.name||'Selected drawing',message:x.message||'PDF slide preview is not available.',blocking:false}));
    // Package sources are the exact approved production drawings, never live files.
    // Legacy responses retain their one governing source.
    const selected=Array.isArray(c.sources)?c.sources:(c.source?[c.source]:[]);
    for(const source of selected){
     const key=(source?.documentId||'')+'|'+(source?.sha256||'');if(seen.has(key))continue;seen.add(key);
     if(!source?.documentId||!source?.sha256){issues.push({name:source?.name||'Selected drawing',message:'The saved drawing reference is unavailable. Reopen the slideshow to retry.',blocking:true});continue;}
     try{
      const r=await window.fetch(drawingBase+'/'+encodeURIComponent(source.documentId)+'/'+encodeURIComponent(source.sha256)+'/info',{credentials:'same-origin',cache:'no-store'});
      if(!r.ok)throw Error('unavailable');const data=await r.json();
      if(!Number.isInteger(data.pageCount)||data.pageCount<1)throw Error('unavailable');
      sources.push({source,count:data.pageCount});
     }catch(error){issues.push({documentId:source.documentId,name:source.name||'Assembly drawing',message:'Drawing pages could not be opened. Existing slides are unchanged. Reopen the slideshow to retry.',blocking:true});}
    }
    if(!sources.length&&!issues.length)issues.push({name:'Assembly drawing',message:'No drawing is available for this slideshow.',blocking:true});
    return {sources,issues};
   }catch(error){return{sources:[],issues:[{name:'Assembly drawing',message:'Drawing source unavailable. Existing slides are unchanged. Reopen the slideshow to retry.',blocking:true}]};}
  }
  async function standardFrames(scope,owners,includeExcluded=false){
   const drawing=await drawingPages(),reference=await bomPages(),frames=[];
   for(const op of owners){
    const authored=op.slides||[],used=new Set(),cards=[];
    const add=(card,owner=op,template=false)=>{if(card.kind==='START'||includeExcluded||!(owner.excludedSlideIds||[]).includes(card.id))cards.push({card,owner,template});if(owner===op)used.add(card.id);};
    add(authored.find(c=>c.kind==='START')||await standardCard(op,'START'),op,true);
    if(reference?.source){for(let page=1;page<=reference.pages.length;page++)add(authored.find(c=>c.kind==='BOM'&&c.page===page&&window.DleLaborBomSlides.matches(reference,c.source))||await standardCard(op,'BOM',page,reference.source),op,true);}
    else if(reference)add({id:'bom-unavailable-'+op.id,kind:'NOTE',title:'BOM reference unavailable',body:reference.error,page:1,stages:[stage(1)]},op,false);
    if(!op.slidesOrganized){
     for(const {source,count} of drawing.sources)for(let page=1;page<=count;page++){
      const saved=authored.find(c=>c.kind==='DRAWING'&&c.page===page&&c.source?.documentId===source.documentId&&c.source?.sha256===source.sha256),card=saved||await standardCard(op,'DRAWING',page,source);
      if(!saved&&drawing.sources.length>1&&source.name)card.title=source.name+' - page '+page;
      add(card,op,true);
     }
    }
    const ending=authored.find(c=>c.kind==='END')||await standardCard(op,'END');
    for(const card of authored)if(!used.has(card.id)&&card!==ending)add(card);
    // Unsupported file previews remain visible without becoming saved slide content.
    for(const [index,issue] of drawing.issues.entries())if(!op.slidesOrganized||!issue.blocking)add({id:'drawing-unavailable-'+op.id+'-'+(issue.documentId||index),kind:'NOTE',title:issue.name+' - preview unavailable',body:issue.message,page:1,drawingLoadRequired:issue.blocking,stages:[stage(1)]},op,false);
    for(const child of chronological(scope).filter(c=>window.DleLaborWorkbench.ancestors(scope,c).some(p=>p.id===op.id)))for(const card of unfilteredCards(child))add(card,child,false);
    add(ending,op,true);
    const pristineDrawings=new Set();
    for(const {card,owner} of cards)if(card.kind==='DRAWING'&&!card.body&&card.stages.length===1){
     const s=card.stages[0];let expected=await standardCard(owner,'DRAWING',card.page,card.source);
     if(card.id!==expected.id)for(const origin of scope.filter(o=>o.id!==owner.id)){const candidate=await standardCard(origin,'DRAWING',card.page,card.source);if(candidate.id===card.id){expected=candidate;break;}}
     if(card.id===expected.id&&s.id===expected.stages[0].id&&s.name==='Stage 1'&&!s.marks?.length&&!s.photos?.length&&JSON.stringify(s.savedView)===JSON.stringify(view(card.page))&&[expected.title,card.source?.name+' - page '+card.page].includes(card.title))pristineDrawings.add(card.id);
    }
    cards.forEach(({card,owner,template},ci)=>card.stages.forEach((item,si)=>frames.push({card,stage:item,op:owner,ci,si,count:cards.length,template,pristineDrawing:pristineDrawings.has(card.id),generated:!(owner.slides||[]).some(c=>c.id===card.id),unavailable:card.id.startsWith('drawing-unavailable-')||card.id.startsWith('bom-unavailable-')||card.kind==='BOM'&&!window.DleLaborBomSlides.matches(reference,card.source)})));
   }return frames;
  }
  async function printOperation(op,trigger,operations=ops(),anchor=null){
   const scope=instructionScope(operations),owner=sectionFor(scope.find(o=>o.id===op.id)||op,scope);
   travelerScopes.set(scope,clone(travelerMetadata(operations)));
   if(!window.DleLaborSlidePrint){printLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/rfqs/labor-slide-print.js';script.onload=resolve;script.onerror=()=>{printLoading=null;script.remove();reject(Error('Print preview unavailable. Retry.'));};document.head.append(script);});try{await printLoading;}catch(error){window.alert(error.message);return;}}
   return window.DleLaborSlidePrint.open({trigger,label:identity(owner,scope),dirty:!!options.isDirty?.(),prepare:async()=>{
    await editor();executionContexts.set(scope,new Map([[typeName(owner,scope),owner.id]]));const roots=scope.filter(o=>!o.parentId&&typeName(o,scope)===typeName(owner,scope));const frames=bundleBomFrames(await groupedFrames(scope,roots),scope),reference=bom;
    return {frames,continuousBom:f=>!!f.bomFrames?.every(compactBom),currentIndex:Math.max(0,frames.findIndex(f=>frameMembers(f).some(m=>anchor&&m.op.id===anchor.opId&&m.card.id===anchor.cardId&&m.stage.id===anchor.stageId))),traveler:travelerMetadata(scope),summary:f=>openingSummary(f.card,f.op,scope),caption:f=>['START','BOM'].includes(f.card.kind)?f.card.body||'':[operatorIdentity(f.op,scope),f.card.title,f.card.body].filter(Boolean).join(' — '),loadBase:(f,signal)=>f.card.kind==='BOM'?new Response(f.bomFrames?.every(compactBom)?window.DleLaborBomSlides.flowSvg(reference,f.bomFrames.map(m=>m.card.page)):window.DleLaborBomSlides.svg(reference,f.card.page,f.card.source,compactBom(f)),{headers:{'content-type':'image/svg+xml'}}):baseResponse(f.card,f.op,scope,signal),loadPhoto:photoBlob};
   }});
  }
  async function playback(frames,scope,trigger,allowEdit,wholeSequence,role=null,session={}){
   frames=bundleReferenceFrames(frames,scope);
   const prefixGroup=wholeSequence?options.prefixGroup:null;
   if(prefixGroup)frames=frames.filter(f=>typeName(f.op,scope)!==prefixGroup||!['START','BOM'].includes(f.card.kind));
   if(!frames.length){if(allowEdit)return organize(trigger,session.operationId||session.anchor?.opId,undefined,'Return to Labor');window.alert('This operation has no slideshow pages.');return;}
   if(session.startAtTraveler){const first=frames.find(f=>f.card.kind==='START');if(!first)return false;session={...session,anchor:{opId:first.op.id,cardId:first.card.id,stageId:first.stage.id}};}
   let entryNotice='';
   if(session.startSmt){
    const root=chronological(scope).find(o=>!o.parentId&&/^SMT(?:\b|[-_])/i.test(o.name||''));
    const matching=root?frames.filter(f=>physicalRoot(f.op,scope).id===root.id):[];
    const first=matching.find(f=>f.card.kind==='START')||matching[0]||frames.find(f=>f.card.kind==='START')||frames[0];
    if(first)session={...session,anchor:{opId:first.op.id,cardId:first.card.id,stageId:first.stage.id}};
    if(!matching.length)entryNotice='No SMT section is available. Showing the first released section.';
   }
   if(session.startGroup){
    // This entry preference never filters the other groups or changes saved instructions.
    const root=chronological(scope).find(o=>!o.parentId&&typeName(o,scope)===session.startGroup);
    const matching=root?frames.filter(f=>physicalRoot(f.op,scope).id===root.id):[];
    const first=matching.find(f=>f.card.kind==='START')||matching[0];
    if(first)session={...session,anchor:{opId:first.op.id,cardId:first.card.id,stageId:first.stage.id}};
    else entryNotice='No '+session.startGroup+' slides are available. Showing the read-only job traveler.';
   }
   const anchor=session.anchor;const prefix=wholeSequence?(options.prefixSlides||[]):[];let prefixIndex=Number.isInteger(anchor?.prefixIndex)&&anchor.prefixIndex>=0&&anchor.prefixIndex<prefix.length?anchor.prefixIndex:anchor?-1:(prefix.length?0:-1);
   let index=anchor?frames.findIndex(f=>frameMembers(f).some(m=>(!anchor.opId||m.op.id===anchor.opId)&&m.card.id===anchor.cardId&&m.stage.id===anchor.stageId)):-1;
   if(index<0&&anchor)index=frames.findIndex(f=>(!anchor.opId||f.op.id===anchor.opId)&&f.card.id===anchor.cardId);
   if(index<0&&anchor)for(const nearby of anchor.neighbors||[]){index=frames.findIndex(f=>frameMembers(f).some(m=>m.op.id===nearby.opId&&m.card.id===nearby.cardId));if(index>=0)break;}
   if(index<0&&anchor?.group)index=frames.findIndex(f=>typeName(f.op,scope)===anchor.group);
   if(index<0&&anchor)index=frames.findIndex(f=>f.op.id===anchor.opId);
   if(index<0)index=0;
   const position=()=>{const f=frames[index],group=typeName(f.op,scope),neighbors=[...frames.slice(index+1),...frames.slice(0,index).reverse()].filter(n=>typeName(n.op,scope)===group).map(n=>({opId:n.op.id,cardId:n.card.id}));return {opId:f.op.id,cardId:f.card.id,stageId:f.stage.id,group,neighbors};};
   const reopen=(selected=null,includeMaterials=!!session.includeMaterials,editOnOpen=false)=>{const at=position(),next=selected?{...selected,stageId:selected.cardId===at.cardId?at.stageId:selected.stageId}:at,source=allowEdit?ops():scope;
    if(wholeSequence)return playSequence(source,trigger,role,{includeMaterials,anchor:next,editOnOpen});
    const owner=source.find(o=>o.id===session.operationId);if(owner)return play(owner,trigger,source,next,editOnOpen);
   };
   const organizeHere=()=>organize(trigger,window.DleLaborWorkbench.instructionOwner(ops(),frames[index].op).id,selected=>reopen(selected));
   const current=(member=null)=>{const f=member||frames[index],execution=ops().find(o=>o.id===f.op.id),op=execution?window.DleLaborWorkbench.instructionOwner(ops(),execution):null,card=op?.slides?.find(c=>c.id===f.card.id),item=card?.stages.find(s=>s.id===f.stage.id);return {f,op,execution,card,item};};
   const permitted=op=>allowEdit&&editable()&&op&&(role===null||effectiveRole(op,ops())===role);
   const refresh=()=>{if(!allowEdit)return;const {f,op,execution,card,item}=current();if(!op)return;if(card&&item){f.op=clone(window.DleLaborWorkbench.resolvedInstruction(ops(),execution));f.card=clone(card);f.stage=clone(item);}else if(f.generated){f.op=clone(window.DleLaborWorkbench.resolvedInstruction(ops(),execution));if(f.card.kind==='SUBSTEP')f.card={...f.card,body:substep(op).body};}if(allowEdit){scope=instructionScope(ops());if(session.operationId){const context=scope.find(o=>o.id===session.operationId);if(context)executionContexts.set(scope,new Map([[typeName(context,scope),physicalRoot(context,scope).id]]));}}};
   async function editSequence(first){
    // The reader may bundle BOM pages; editing always retains each source page/stage.
    const group=typeName(first.op,scope),sequence=frames.filter(f=>!f.pending&&typeName(f.op,scope)===group).flatMap(frameMembers);
    const key=f=>[f.op.id,f.card.id,f.stage.id].join('|'),states=new Map();let ink=null;
    async function openAt(at){
     const selected=sequence[at],target=current(selected);
     if(!permitted(target.op)||selected.unavailable||!target.card&&!selected.template)throw Error('This slide requires its source editor or is not editable. Return to the slideshow to review it.');
     const generated=!target.card,card=target.card||clone(selected.card),item=target.item||card.stages.find(s=>s.id===selected.stage.id),source=JSON.stringify(card.source),page=card.page;
     if(!item)throw Error('The selected stage is no longer available.');
     const canWrite=()=>{const live=current(selected);return permitted(live.op)&&live.op===target.op&&(generated?(!live.card||live.card===card&&live.item===item):live.card===card&&live.item===item)&&card.page===page&&JSON.stringify(card.source)===source;};
     let moving=false;
     await openStage(target.op,card,item,false,trigger,{onOrganize:()=>organize(trigger,target.op.id,selected=>reopen(selected,!!session.includeMaterials,true),'Return to editor'),onResumePlayback:()=>reopen(),draftNotice:window.DleLaborWorkbench.instructionImpact(ops(),target.execution),returnOnApply:true,backLabel:'Return to slideshow',pendingEditorDraft:()=>!!options.isDirty?.(),editorState:states.get(key(selected)),editorInk:ink,
      editorContext:'Slide '+(at+1)+' / '+sequence.length,progress:'Slide '+(at+1)+' / '+sequence.length+(card.kind==='BOM'?' | BOM page '+page:'')+(card.stages.length>1?' | Stage '+(selected.si+1):''),hasPrevious:at>0,hasNext:at<sequence.length-1,onAdvance:()=>{},
      canWrite,canEditOwner:permitted,persistGenerated:generated?()=>{const list=(target.op.slides??=[]),end=list.findIndex(c=>c.kind==='END');if(!list.some(c=>c.id===card.id))list.splice(end>=0?end:list.length,0,card);}:null,
      onEditorAdvance:async(delta,snapshot,apply)=>{
       const next=at+delta;if(next<0||next>=sequence.length)throw Error('End of this operation.');if(!canWrite())throw Error('This slide is no longer editable.');
       const f=sequence[next],live=current(f);if(f.unavailable||!permitted(live.op)||!live.card&&!f.template)throw Error('Cannot edit '+f.card.title+': '+(f.unavailable?f.card.body:'this slide requires its source editor or edit permission. Return to the slideshow to review it.'));
       const nextCard=live.card||f.card;if(nextCard.page!==f.card.page||JSON.stringify(nextCard.source)!==JSON.stringify(f.card.source))throw Error('The next source identity changed. Return to the slideshow and review it.');if(nextCard.kind==='BOM'&&!options.bomSupported?.())throw Error('BOM annotation is not supported in this session.');
       // Check the exact next source before leaving the current editor.
       const response=await baseResponse(nextCard,live.op,scope);if(!response.ok)throw Error('The next source page is unavailable.');
       if(snapshot.dirty)await apply();states.set(key(selected),snapshot);ink=snapshot.ink;moving=true;
       const ownerIndex=frames.findIndex(x=>frameMembers(x).some(m=>key(m)===key(f)));if(ownerIndex>=0)index=ownerIndex;
       return ()=>openAt(next).catch(error=>{window.alert(error.message+' Draft edits are retained.');refresh();return show();});
      },onClose:()=>{if(!moving){refresh();void show();}}},scope);
    }
    return openAt(sequence.findIndex(f=>key(f)===key(first))).catch(error=>{window.alert(error.message+' Draft edits are retained.');return show();});
   }

   const prefixFrames=()=>frames.map((f,i)=>typeName(f.op,scope)===prefixGroup?i:-1).filter(i=>i>=0);
   const prefixTabs=()=>prefixGroup&&prefix.length?[{id:'job-prefix-0',label:prefixGroup,active:prefixIndex>=0||typeName(frames[index].op,scope)===prefixGroup}]:prefix.map((p,i)=>({id:'job-prefix-'+i,label:p.label,active:prefixIndex===i}));
   function jumpChoices(indices,withPrefix=false){
    if(!options.slideJump)return undefined;
    const sourceScope=scope;
    const choices=indices.map(i=>{const frame=clone(frames[i]),card=frame.card;
     const title=(frame.pending?'Needs Quality Review/Approval � ':'')+(card.kind==='START'?'Traveler page':card.kind==='BOM'?'BOM reference':card.title||card.kind)+(card.stages.length>1?' · Stage '+(frame.si+1):'');
     const summary=openingSummary(card,frame.op,sourceScope),meta=travelerMetadata(sourceScope);
     return {id:String(i),title,current:prefixIndex<0&&i===index,preview:async signal=>{
      if(frame.unavailable)throw Error('Preview unavailable: '+(card.body||'source needs review'));
      const forms=await window.DleLaborDrawingNotes.letterPages();
      const parts=frame.bomFrames?.every(compactBom)?[frame.bomFrames[0]]:frameMembers(frame);
      const configs=parts.map(f=>({kind:f.card.kind,summary,context:[meta.workOrder||'QUOTE',meta.assembly,meta.revision].filter(Boolean).join(' · '),caption:['START','BOM'].includes(f.card.kind)?f.card.body||'':[operatorIdentity(f.op,sourceScope),f.card.title,f.card.body].filter(Boolean).join(' - '),layer:{...f.stage,page:f.card.page},signal,loadPhoto:photoBlob,loadBase:()=>f.card.kind==='BOM'&&frame.bomFrames?.every(compactBom)?new Response(window.DleLaborBomSlides.flowSvg(bom,frame.bomFrames.map(m=>m.card.page)),{headers:{'content-type':'image/svg+xml'}}):baseResponse(f.card,f.op,sourceScope,signal,compactBom(f))}));
      return configs.length>1?forms.composeMany(configs):forms.compose(configs[0]);
     }};
    });
    return withPrefix?[...prefix.map((p,i)=>({id:'prefix-'+i,title:p.label,current:prefixIndex===i,preview:p.preview||(()=>Promise.reject(Error('Live form preview unavailable')))})),...choices]:choices;
   }
   const selectJump=id=>{if(id.startsWith('prefix-'))prefixIndex=Number(id.slice(7));else{prefixIndex=-1;index=Number(id);}void show();};
   const prefixSelect=id=>{if(id.startsWith('job-prefix-')){prefixIndex=Number(id.slice(11));void show();return true;}prefixIndex=-1;return false;};
   const show=()=>{if(allowEdit)for(const bundled of frames.filter(f=>f.drawingFrames))for(const member of bundled.drawingFrames){const live=current(member);if(live.card&&JSON.stringify(live.card)!==JSON.stringify(member.card)||!member.generated&&!live.card)return reopen({opId:member.op.id,cardId:member.card.id,stageId:member.stage.id});}options.onPosition?.(prefixIndex>=0?{prefixIndex}:position());if(prefixIndex>=0){const p=prefix[prefixIndex],groups=typeGroups(scope);return editor().then(()=>window.DleLaborDrawingNotes.open({intakeId,stepId:'job-prefix-'+prefixIndex,stepLabel:p.label,editable:false,trigger,backLabel:options.backLabel||'Back to workspace',contextNotice:options.contextNotice,onMount:options.onMount,onReady:options.onReady,saveLabel:options.saveLabel,onExit:options.onExit,
     operationTabs:[...prefixTabs(),...groups.filter(g=>g.name!==prefixGroup&&frames.some(f=>typeName(f.op,scope)===g.name)).map(g=>({id:g.root.id,label:g.name}))],
     onSelectOperation:id=>{if(prefixSelect(id))return;const group=groups.find(g=>g.root.id===id);index=Math.max(0,frames.findIndex(f=>typeName(f.op,scope)===group?.name));void show();},
     onAdvance:delta=>{const associated=prefixFrames(),total=prefix.length+associated.length,next=(prefixIndex+delta+total)%total;if(next<prefix.length)prefixIndex=next;else{index=associated[next-prefix.length];prefixIndex=-1;}void show();},hasPrevious:prefix.length+prefixFrames().length>1,hasNext:prefix.length+prefixFrames().length>1,progress:(prefixIndex+1)+' / '+(prefix.length+prefixFrames().length),
     slideChoices:jumpChoices(prefixFrames(),true),onSelectSlide:selectJump,onOrganize:allowEdit?()=>organize(trigger,ops()[0].id,()=>show()):null,onSaveDraft:allowEdit&&options.isDirty?.()?options.saveLabor:null,onReload:show,
     slide:{kind:'JOB',mount:p.mount,layer:{source:{name:p.label,assembly:options.travelerMetadata?.().assembly||'',revision:'',sha256:'',documentId:'job'},marks:[],savedView:view(1),stepId:'job',layerId:'job',page:1},caption:p.label}}));}refresh();for(const f of frames[index].reflowFrames||[]){const live=current(f);if(live.card&&live.item){f.card=clone(live.card);f.stage=clone(live.item);}}for(const f of frames[index].bomFrames||[]){const live=current(f);if(live.card&&live.item){f.card=clone(live.card);f.stage=clone(live.item);f.generated=false;}} const seen=new Set();displayedMains.set(scope,frames.map(f=>sectionFor(scope.find(o=>o.id===f.op.id)||f.op,scope)).filter(o=>!seen.has(o.id)&&seen.add(o.id)));const {f,op,card,item}=current(),canEdit=permitted(op),authored=card&&item;
    const edit=f.pending?(options.onEditPending?.(f.card.id)||null):canEdit&&!f.unavailable&&(f.card.kind!=='BOM'||options.bomSupported?.())&&(authored||f.template||f.generated&&options.editSource)?async(member=null)=>{
     if(f.bomFrames&&!member)return chooseBomFrame(f.bomFrames,edit,show);
     const selected=member||f,target=current(selected);if(!permitted(target.op))return show();
     if(!target.card&&!target.f.template)return options.editSource(target.execution.id,()=>{refresh();return show();},trigger);
     return editSequence(selected);

    }:null;
    const turns=[];
    frames.forEach((frame,start)=>{const actual=sectionFor(scope.find(o=>o.id===frame.op.id)||frame.op,scope),owner=session.operationId?actual:typeGroups(scope).find(g=>g.name===typeName(actual,scope)).root,last=turns.at(-1);if(last&&last.id===owner.id){last.end=start;return;}const label=session.operationId?sectionLabel(owner,scope):typeName(owner,scope);turns.push({id:owner.id,start,end:start,label,description:label});});
    const operationTabs=[...prefixTabs(),...turns.filter(turn=>turn.label!==prefixGroup).map(turn=>({...turn,active:index>=turn.start&&index<=turn.end,offset:turn.start-index}))];
    const activeTurn=turns.find(t=>index>=t.start&&index<=t.end),groupSize=activeTurn.end-activeTurn.start+1;
    const groupedPrefix=prefix.length>0&&activeTurn.label===prefixGroup,associated=groupedPrefix?prefixFrames():[],groupPosition=groupedPrefix?prefix.length+associated.indexOf(index)+1:index-activeTurn.start+1,totalSize=groupedPrefix?prefix.length+associated.length:groupSize;
    const progress='Slide '+groupPosition+' / '+totalSize+' | Stage '+(f.si+1)+' / '+f.card.stages.length;
    return openStage(f.op,f.card,f.stage,true,trigger,{contextNotice:[options.contextNotice,entryNotice].filter(Boolean).join(" | "),onExit:options.onExit,backLabel:options.backLabel||(options.onExit?'Back to workspace':undefined),drawingFrames:f.drawingFrames,reflowFrames:f.reflowFrames,bomFrames:f.bomFrames,bomReview:f.bomReview,onEditBom:allowEdit&&f.card.kind==='BOM'&&bom?.process?.canEdit?async button=>{const saved=await window.DleBomProcess.open(base.replace(/\/labor$/,'')+'/bom-reference',button);if(saved)await bomPages();return saved;}:null,onPrint:f.pending?null:button=>printOperation(f.op,button,scope,position()),onOrganize:allowEdit&&!f.pending?organizeHere:null,includeMaterials:!!session.includeMaterials,onPreviewMaterialsChange:wholeSequence&&!prefixGroup&&role===null&&allowEdit?value=>reopen(null,value):null,progress,slideChoices:jumpChoices(groupedPrefix?associated:Array.from({length:groupSize},(_,i)=>activeTurn.start+i),groupedPrefix),onSelectSlide:selectJump,operationTabs,hasPrevious:totalSize>1,hasNext:totalSize>1,onSelectOperation:id=>{if(prefixSelect(id))return;const target=turns.find(t=>t.id===id);if(target){index=target.start;void show();}},onAdvance:delta=>{if(groupedPrefix){const next=((groupPosition-1+delta)%totalSize+totalSize)%totalSize;if(next<prefix.length)prefixIndex=next;else index=associated[next-prefix.length];}else index=activeTurn.start+((index-activeTurn.start+delta)%groupSize+groupSize)%groupSize;void show();},onJump:id=>{const at=frames.findIndex(frame=>frame.op.id===id&&!frame.unavailable);if(at>=0){index=at;void show();}},onEdit:edit,onSaveDraft:!f.pending&&allowEdit&&editable()&&options.isDirty?.()&&options.saveLabor?async()=>{if(!editable())throw Error('Labor is no longer editable.');await options.saveLabor();refresh();}:null,onReload:show,editLabel:f.generated&&!f.template?'Edit instructions':'Edit current slide',draftNotice:[allowEdit&&options.isDirty?.()?(options.saveLabel?'Unsaved changes. '+options.saveLabel+' to preserve changes.':'Unsaved Labor draft. Save Labor to preserve changes.') :'',[window.DleLaborWorkbench.sectionContext(sectionFor(f.op,scope),scope,travelerMetadata(scope).quantity),window.DleLaborWorkbench.firstPieceContext(sectionFor(f.op,scope),scope,travelerMetadata(scope).quantity,true)].filter(Boolean).join(' | ')].filter(Boolean).join(' ')},scope);
   };if(session.editOnOpen){const f=frameMembers(frames[index]).find(f=>f.card.id===anchor?.cardId)||frameMembers(frames[index])[0],target=current(f);if(permitted(target.op)&&!f.unavailable&&(target.card||f.template))return editSequence(f);}await show();
  }
  async function play(op,trigger,operations=ops(),anchor=null,editOnOpen=false){
   const allowEdit=operations===ops()&&operations.includes(op),scope=instructionScope(operations),owner=scope.find(o=>o.id===op.id)||clone(op),cards=clone(presentationCards(owner));
   travelerScopes.set(scope,travelerMetadata(operations));executionContexts.set(scope,new Map([[typeName(owner,scope),physicalRoot(owner,scope).id]]));
   const frames=op.parentId?flatten(cards).map(f=>({...f,op:owner,count:cards.length,generated:!(op.slides||[]).some(c=>c.id===f.card.id)})):await groupedFrames(scope,scope.filter(o=>!o.parentId&&typeName(o,scope)===typeName(owner,scope)));if(frames.length)await playback(frames,scope,trigger,allowEdit,false,null,{operationId:op.id,anchor,editOnOpen});else if(allowEdit)await organize(trigger,op.id,undefined,'Return to Labor');else window.alert('This operation has no slideshow pages.');
  }
  async function playSequence(operations,trigger,role=null,session={}){
   const allowEdit=operations===ops(),scope=instructionScope(operations),materials=(options.materialPreparationIds||window.DleLaborWorkbench?.materialPreparationIds)?.(scope)||new Set();
   travelerScopes.set(scope,travelerMetadata(operations));
   // Optional role preview retains its explicit other-role handoffs.
   let frames=role===null?await groupedFrames(scope,scope.filter(op=>!op.parentId&&(session.includeMaterials||!materials.has(op.id)))):chronological(scope).filter(op=>!materials.has(op.id)).flatMap(op=>{
    const match=effectiveRole(op,scope)===role,own=presentationCards(op),cards=match?(own.length?own:[{id:'empty-'+op.id,kind:'HANDOFF',title:'Operation context',body:'No authored slides for this operation.',page:1,stages:[stage(1)]}]):[{id:'handoff-'+op.id,kind:'HANDOFF',title:'Handoff context',body:'Other-role context. Select this role to preview its authored instructions.',page:1,stages:[stage(1)]}];
    return flatten(cards).map(f=>({...f,op,count:cards.length,generated:match&&!(op.slides||[]).some(c=>c.id===f.card.id)}));
   });
   if(role!==null&&options.bomIdentity){
    const prior=frames,enriched=[];
    for(const main of scope.filter(o=>!o.parentId&&!materials.has(o.id))){
     if(effectiveRole(main,scope)!==role){enriched.push(...prior.filter(f=>f.op.id===main.id||f.op.parentId===main.id));continue;}
     const seen=new Set();
     for(const f of await standardFrames(scope,[main])){
      if(f.op.parentId&&effectiveRole(f.op,scope)!==role){if(!seen.has(f.op.id)){enriched.push(...prior.filter(p=>p.op.id===f.op.id));seen.add(f.op.id);}}
      else enriched.push(f);
     }
    }
    frames=enriched;
   }
   // Pending cards are view-only frames; they never enter the editable plan or controlled print scope.
   for(const pending of options.pendingSlides?.()||[]){
    const op=scope.find(o=>o.id===pending.operationId);if(!op)continue;
    let at=frames.findLastIndex(f=>f.op.id===op.id);if(at<0)at=frames.findLastIndex(f=>typeName(f.op,scope)===typeName(op,scope));
    frames.splice(at+1,0,...pending.slide.stages.map((stage,si)=>({op,card:clone(pending.slide),stage:clone(stage),ci:0,si,count:1,pending:true,generated:false})));
   }
   if(!frames.length){if(session.startAtTraveler)return false;if(allowEdit)await organize(trigger,scope.find(o=>!o.parentId&&!materials.has(o.id))?.id,undefined,'Return to Labor');else window.alert('No slideshow pages to preview.');return;}return await playback(frames,scope,trigger,allowEdit,true,role,session);
  }
  // Organization is a draft transaction. Only slide arrays, layout flags and exclusions are applied.
  // Generated drawing pages become independent presentation instances on first edit.
  async function organize(trigger,initialOwner,resume,returnLabel="Continue to slideshow"){
   closeFloating();await organizer();initialOwner=window.DleLaborWorkbench.instructionOwner(ops(),ops().find(o=>o.id===initialOwner)||{}).id;let baseline=clone(ops()),draft=clone(baseline),history=[],clipboard=null,selected=null,selectedOwner=initialOwner,entries=[],allEntries=[],storageEntries=[],generation=0,closed=false,rendering=false,saving=false,includeMaterials=false,discarded=false;
   const exclusions=!!options.exclusionsSupported?.(),fullLayout=!!options.layoutSupported?.(),urls=new Set(),abort=new AbortController(),collapsed=new Set();
   const state=items=>items.map(o=>({id:o.id,slides:clone(o.slides||[]),slidesOrganized:o.slidesOrganized,excludedSlideIds:clone(o.excludedSlideIds)}));
   const signature=items=>JSON.stringify(state(items));
   const d=window.DleSlideOrganizer.create({dialogFactory:dialog,returnLabel,saveLabel:options.saveLabel||'Save Labor'});let movement=null;
   options.onOrganizerReady?.(d,d.querySelector('header'));
   d.classList.add('labor-organizer');const q=s=>d.querySelector(s),error=message=>q('[data-org-error]').textContent=message||'';
   if(options.saveLabel)q('[data-org-save]').textContent=options.saveLabel+' & continue';q('[data-org-return]').textContent=returnLabel;q('[data-cancel]').textContent='Cancel / return';d.querySelector('header').append(q('.labor-organizer-top-actions'));
   q('[data-runtime-note]').textContent=(!exclusions?'Default page removal and restore await SIM host activation. ':'')+(fullLayout?'Apply keeps changes in the Labor draft. Save Labor preserves the entire draft.':'Drawing-page moves await SIM host activation. Note, image, and canvas slides can be arranged now.');
   const lane=o=>((options.materialPreparationIds||window.DleLaborWorkbench?.materialPreparationIds)?.(draft)||new Set()).has(o.id)?'Materials / Kit':'Production';
   const groupFor=o=>typeGroups(draft).find(g=>g.name===typeName(o,draft));const groupOwner=id=>groupFor(draft.find(o=>o.id===id))?.root.id;const ownerLabel=o=>typeName(o,draft);q('[data-org-materials]').onchange=e=>{includeMaterials=e.target.checked;void render();};
   const chosen=()=>entries.find(e=>e.card.id===selected);
   const protectedCard=e=>!e||e.unavailable||['START','END','SUBSTEP','BOM'].includes(e.card.kind)||!!e?.card.reflowStepId;
   const removable=e=>editable()&&e&&e.card.kind!=='START'&&!e.unavailable&&(exclusions||movable(e));
   // Suppress generated stand-ins too, so deleting a grouped reference cannot reveal
   // the same default from another operation in that group. Authored copies stay independent.
   const removalMembers=e=>{const members=frameMembers(e);return [...members,...storageEntries.filter(f=>f.generated&&['BOM','DRAWING'].includes(f.card.kind)&&members.some(m=>typeName(f.op,draft)===typeName(m.op,draft)&&f.card.kind===m.card.kind&&f.card.page===m.card.page&&f.card.source?.documentId===m.card.source?.documentId&&f.card.source?.sha256===m.card.source?.sha256))];};
   const defaultPage=e=>e&&(e.generated||['START','END','SUBSTEP','BOM','DRAWING'].includes(e.card.kind));
   const movable=e=>editable()&&!protectedCard(e)&&(fullLayout||!e.generated&&e.card.kind!=='DRAWING');
   function restore(snapshot){for(const item of snapshot){const o=draft.find(x=>x.id===item.id);if(o){o.slides=clone(item.slides);if(item.slidesOrganized===undefined)delete o.slidesOrganized;else o.slidesOrganized=item.slidesOrganized;if(item.excludedSlideIds===undefined)delete o.excludedSlideIds;else o.excludedSlideIds=clone(item.excludedSlideIds);}}}
   function mutate(fn){if(!editable())throw Error('Labor is no longer editable.');const previous=state(draft);try{fn();validateLinks(draft);if(draft.some(o=>(o.slides||[]).length>80)||draft.reduce((n,o)=>n+(o.slides||[]).length,0)>500)throw Error('Slide limit reached: 80 per owner and 500 per estimate.');}catch(e){restore(previous);throw e;}history.push(previous);if(history.length>40)history.shift();error('');void render();}
   function ensure(o){if(o.parentId||o.slidesOrganized||!fullLayout)return;
    const owned=storageEntries.filter(e=>e.op.id===o.id&&!e.unavailable),boundaries=owned.filter(e=>['START','END'].includes(e.card.kind));
    if(boundaries.filter(e=>e.card.kind==='START').length!==1||boundaries.filter(e=>e.card.kind==='END').length!==1)throw Error('This operation has multiple boundary slides. Keep its existing layout and review those boundaries first.');
    if(entries.some(e=>e.op.id===o.id&&e.card.drawingLoadRequired))throw Error('Open all selected drawings before changing this operation layout. Existing slides are unchanged.');
    o.slides=owned.filter(e=>e.card.kind!=='BOM'||!e.generated).map(e=>clone(e.card));o.slidesOrganized=true;
   }
   function insertionIndex(o,after){const bundle=entries.find(e=>e.op.id===o.id&&e.card.id===after)?.drawingFrames;if(bundle)after=bundle.at(-1).card.id;const list=o.slides||[],end=list.findIndex(c=>c.kind==='END');if(!after)return end<0?list.length:end;if(entries.some(e=>e.op.id===o.id&&e.card.id===after&&e.card.kind==='BOM')){let at=list.findIndex(c=>c.kind==='START')+1;while(list[at]?.kind==='BOM')at++;return at;}const index=list.findIndex(c=>c.id===after);if(index<0){if(entries.some(e=>e.op.id===o.id&&e.card.id===after&&e.generated))return 0;throw Error('That placement changed. Select a current slide.');}return list[index].kind==='END'?index:index+1;}
   function controls(){const e=chosen(),can=movable(e),dirty=signature(draft)!==signature(baseline);if(e)selectedOwner=e.op.id;if(!draft.some(o=>o.id===selectedOwner)||!includeMaterials&&typeName(draft.find(o=>o.id===selectedOwner),draft)==='Kitting')selectedOwner=draft.find(o=>!o.parentId&&(includeMaterials||typeName(o,draft)!=='Kitting'))?.id;
    q('[data-org-copy]').disabled=!can;q('[data-org-delete]').disabled=!removable(e);q('[data-org-restore]').disabled=!exclusions||!editable()||!selectedOwner;q('[data-org-paste]').disabled=!clipboard||!selectedOwner||!editable();q('[data-org-insert]').disabled=!selectedOwner||!editable();q('[data-org-apply]').hidden=!dirty;q('[data-org-apply]').disabled=!editable();q('[data-org-save]').hidden=!options.saveLabor;q('[data-org-save]').disabled=!editable()||(!dirty&&!options.isDirty?.());q('[data-org-undo]').disabled=!editable()||(!history.length&&!undo.length);
    if(!movement?.dragging)q('[data-org-selection]').textContent=e?ownerLabel(e.op)+' | '+e.card.title+(collapsed.has(groupOwner(e.op.id))||hiddenByParent(e.op)?' | Selected slide is hidden; expand its operation.':'')+(protectedCard(e)?' | Reference page: fixed ownership; use Delete to remove from this slideshow.':!movable(e)?' | Arrangement awaits host activation':''):selectedOwner?ownerLabel(draft.find(o=>o.id===selectedOwner))+' | Select a slide or insert here.':'No sections.';
    for(const node of d.querySelectorAll('[data-org-card]')){node.setAttribute('aria-pressed',String(node.dataset.orgCard===selected));const entry=entries.find(e=>e.card.id===node.dataset.orgCard);node.dataset.movable=String(movable(entry));node.title=protectedCard(entry)?'Reference page: fixed ownership; use Delete to remove from this slideshow. Double-click or Enter to open.':movable(entry)?'Select, then drag to move. Drop on a card edge or between cards. Double-click or Enter to open.':'Arrangement unavailable. Double-click or Enter to open.';}
    for(const node of d.querySelectorAll('[data-org-section]'))node.setAttribute('aria-pressed',String(node.dataset.orgSection===selectedOwner&&!e));
   }
   function hiddenByParent(){return false;}
   function syncCollapsed(){for(const section of d.querySelectorAll('[data-owner-section]')){const id=section.dataset.ownerSection,folded=collapsed.has(id),toggle=section.querySelector('[data-org-collapse]');section.querySelector('[data-org-body]').hidden=folded;section.querySelector('.labor-organizer-collapsed-target').hidden=!folded;toggle.setAttribute('aria-expanded',String(!folded));toggle.querySelector('span').textContent=folded?'▸':'▾';}}

   async function thumbnail(e,node,token){try{await editor();if(closed||token!==generation)return;const svg=node.querySelector('svg'),ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g'),summary=openingSummary(e.card,e.op,draft),item=e.card.stages[0];let paper;
    if(summary)paper=window.DleLaborDrawingNotes.appendStartBase(group,summary);
    else {const r=await baseResponse(e.card,e.op,draft,abort.signal,compactBom(e));if(!r.ok)throw Error('Preview unavailable');const url=URL.createObjectURL(await r.blob());urls.add(url);const img=new Image();img.src=url;await img.decode();paper={width:img.naturalWidth,height:img.naturalHeight};const image=document.createElementNS(ns,'image');image.setAttribute('href',url);image.setAttribute('width',paper.width);image.setAttribute('height',paper.height);group.append(image);}
    if(closed||token!==generation)return;const matrix=window.DleLaborDrawingNotes.transform(item.savedView,paper,{width:400,height:260});group.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
    for(const photo of item.photos||[]){const blob=await photoBlob(photo,abort.signal);if(closed||token!==generation)return;const url=URL.createObjectURL(blob);urls.add(url);const image=document.createElementNS(ns,'image');for(const [k,v]of Object.entries({href:url,x:photo.x*paper.width,y:photo.y*paper.height,width:photo.width*paper.width,height:photo.height*paper.height,transform:'rotate('+(photo.rotation||0)+' '+(photo.x+photo.width/2)*paper.width+' '+(photo.y+photo.height/2)*paper.height+')',preserveAspectRatio:'xMidYMid meet'}))image.setAttribute(k,v);group.append(image);}
    for(const mark of item.marks.filter(m=>m.page===e.card.page))window.DleLaborDrawingNotes.appendMark(group,mark,paper);svg.replaceChildren(group);node.querySelector('[data-thumb-status]').textContent='';
   }catch(err){if(!closed&&token===generation)node.querySelector('[data-thumb-status]').textContent=err.message;}}
   async function render(){rendering=true;for(const b of d.querySelectorAll('.labor-organizer-tools button,[data-org-apply],[data-org-save],[data-org-place],[data-org-insert-end]'))b.disabled=true;const token=++generation;for(const url of urls)URL.revokeObjectURL(url);urls.clear();const visibleGroups=typeGroups(draft).filter(g=>includeMaterials||typeName(g.root,draft)!=='Kitting');const storageFrames=await standardFrames(draft,visibleGroups.flatMap(g=>g.roots).filter(o=>!o.instructionSourceId),true);const storageIds=new Set();storageEntries=storageFrames.filter(f=>!storageIds.has(f.card.id)&&storageIds.add(f.card.id));const frames=await groupedFrames(draft,visibleGroups.flatMap(g=>g.roots),true);if(closed||token!==generation)return;const seen=new Set();allEntries=frames.filter(f=>!seen.has(f.card.id)&&seen.add(f.card.id));entries=bundleReferenceFrames(allEntries.filter(e=>e.card.kind==='START'||!(e.op.excludedSlideIds||[]).includes(e.card.id)),draft);
    q('.labor-organizer-groups').innerHTML=visibleGroups.map(g=>{const o=g.root,rows=entries.filter(e=>typeName(e.op,draft)===g.name);return '<section id="organizer-section-'+esc(o.id)+'" data-owner-section="'+esc(o.id)+'" class="labor-organizer-owner '+(o.parentId?'is-child':'')+'"><h3><button type="button" class="labor-organizer-chevron" data-org-collapse="'+esc(o.id)+'" aria-controls="organizer-body-'+esc(o.id)+'" aria-expanded="true" aria-label="Collapse '+esc(ownerLabel(o))+'"><span aria-hidden="true">&#9662;</span></button><button data-org-section="'+esc(o.id)+'">'+esc(ownerLabel(o))+'</button><small>'+rows.length+' slide'+(rows.length===1?'':'s')+'</small><button type="button" class="labor-organizer-collapsed-target" data-org-section="'+esc(o.id)+'" title="Move to this operation'+(rows.some(e=>e.card.kind==='END')?', before its End page':' at the end')+'. Sub-operation ownership is unchanged." hidden>Drop at end'+(rows.some(e=>e.card.kind==='END')?' (before End)':'')+'</button></h3><div data-org-body id="organizer-body-'+esc(o.id)+'"><div class="labor-organizer-grid">'+rows.map((e,i)=>window.DleSlideOrganizer.tile({id:e.card.id,title:e.card.kind==='START'?'Traveler page':e.bomFrames?'BOM reference':e.drawingFrames?drawingTitle(e):e.card.title,ariaLabel:e.card.kind==='START'?'Traveler page':e.drawingFrames?drawingTitle(e):e.card.title,kindLabel:e.bomFrames?e.bomFrames.length+' source pages':e.bomReview?'BOM layout needs review':e.card.kind.toLowerCase(),stageCount:e.card.stages.length,defaultPage:defaultPage(e),protected:protectedCard(e),snippet:e.card.kind==='SUBSTEP'?operatorNotes(e.op):e.card.body},i)).join('')+'</div>'+(!rows.length?'<button class="labor-organizer-empty" data-org-section="'+esc(o.id)+'">Empty section - select or drop a slide here</button>':'')+'</div></section>';}).join('');
    if(!entries.some(e=>e.card.id===selected))selected=null;syncCollapsed();rendering=false;controls();const nodes=[...d.querySelectorAll('[data-org-card]')];async function worker(){while(nodes.length&&!closed&&token===generation){const node=nodes.shift();await thumbnail(entries.find(e=>e.card.id===node.dataset.orgCard),node,token);}}for(let n=0;n<4;n++)void worker();
   }

   function apply(){if(!editable())throw Error('Labor is no longer editable.');if(signature(ops())!==signature(baseline))throw Error('Slides changed while this organizer was open. Cancel and reopen to avoid replacing newer edits.');const changedIds=new Set(draft.filter(o=>JSON.stringify(state([o]))!==JSON.stringify(state([baseline.find(x=>x.id===o.id)]))).map(o=>o.id));if(!changedIds.size)return;remember();for(const o of draft.filter(o=>changedIds.has(o.id))){const live=ops().find(x=>x.id===o.id);live.slides=clone(o.slides||[]);if(o.slidesOrganized===undefined)delete live.slidesOrganized;else live.slidesOrganized=o.slidesOrganized;if(o.excludedSlideIds===undefined)delete live.excludedSlideIds;else live.excludedSlideIds=clone(o.excludedSlideIds);}changed();paintAll();baseline=clone(ops());history=[];}
   function leave(){if(saving)return;if(signature(draft)!==signature(baseline)){const guard=dialog('Unapplied slide arrangement','<p>Apply the arrangement to the Labor draft, or discard only these organizer changes?</p><button data-apply>Apply and return</button><button data-discard>Discard arrangement</button>');guard.querySelector('[data-apply]').onclick=()=>{try{apply();guard.close();d.close();}catch(e){error(e.message);guard.close();}};guard.querySelector('[data-discard]').onclick=()=>{discarded=true;guard.close();d.close();};}else d.close();}
   let viewing=false;
   const scroller=q('.labor-organizer-groups'),cancelDrag=()=>movement?.cancel();
   function placement(o,anchor,side){if(!anchor)return insertionIndex(o,null);const entry=entries.find(e=>e.card.id===anchor);if(!entry||entry.op.id!==o.id)throw Error('Drop location changed.');if(entry.drawingFrames)anchor=(side==='after'?entry.drawingFrames.at(-1):entry.drawingFrames[0]).card.id;if(['START','END','BOM'].includes(entry.card.kind))return insertionIndex(o,anchor);const i=(o.slides||[]).findIndex(c=>c.id===anchor);return i<0?insertionIndex(o,anchor):i+(side==='after'?1:0);}
   function moveCard(sourceId,target){const origin=entries.find(e=>e.card.id===sourceId),owner=draft.find(o=>o.id===target?.owner);if(!movable(origin)||!owner)throw Error('This slide cannot be moved here.');if(target.anchor===sourceId)return;
    mutate(()=>{ensure(origin.op);ensure(owner);const ids=new Set(frameMembers(origin).map(f=>f.card.id)),cards=origin.op.slides.filter(c=>ids.has(c.id));if(cards.length!==ids.size)throw Error('Source slide changed.');origin.op.slides=origin.op.slides.filter(c=>!ids.has(c.id));(owner.slides??=[]).splice(placement(owner,target.anchor,target.side),0,...cards);selected=cards[0].id;selectedOwner=owner.id;});
   }
   function validTarget(target){if(!target?.anchor)return target;const e=entries.find(e=>e.card.id===target.anchor);if(!e)return null;if(e.card.kind==='END')return {...target,side:'before'};if(['START','BOM'].includes(e.card.kind)){const bom=entries.filter(x=>x.op.id===target.owner&&x.card.kind==='BOM').at(-1);return {...target,anchor:bom?.card.id||target.anchor,side:'after'};}return target;}
   movement=window.DleSlideOrganizer.attachMovement(d,{
    getEntries:()=>entries.map(e=>({id:e.card.id,owner:e.op.id,title:e.card.title,movable:movable(e)})),
    getSelected:()=>selected,setSelected:id=>{selected=id;},move:moveCard,open:openSelected,controls,error,
    isBusy:()=>closed||rendering||saving||viewing,normalizeTarget:validTarget,
    ownerGroup:groupOwner,ownerLabel:id=>ownerLabel(draft.find(o=>o.id===id)),isCollapsed:id=>collapsed.has(id)
   });
   async function openSelected(id){if(viewing||rendering||saving)return;const entry=entries.find(e=>e.card.id===id);if(!entry)return;cancelDrag();selected=id;selectedOwner=entry.op.id;controls();viewing=true;const top=scroller.scrollTop;
    try{let frames=bundleReferenceFrames(await groupedFrames(draft,groupFor(entry.op).roots),draft);let at=frames.findIndex(f=>f.card.id===id);if(at<0)throw Error('Slide unavailable.');
     const show=()=>{let changing=false;const f=frames[at],owner=draft.find(o=>o.id===f.op.id),card=owner.slides?.find(c=>c.id===f.card.id)||f.card,item=card.stages.find(s=>s.id===f.stage.id)||card.stages[0];const finish=()=>{viewing=false;void render().then(()=>{scroller.scrollTop=top;d.querySelector('[data-org-card="'+CSS.escape(selected)+'"]')?.focus({preventScroll:true});});};
      const canEdit=editable()&&!f.unavailable&&!['SUBSTEP','HANDOFF'].includes(card.kind)&&(card.kind!=='BOM'||options.bomSupported?.())&&(!f.generated||fullLayout||!['DRAWING'].includes(card.kind));
      const edit=(member=null)=>{changing=true;if(f.bomFrames&&!member)return chooseBomFrame(f.bomFrames,edit,show);const selected=member||f,owner=draft.find(o=>o.id===selected.op.id),card=owner.slides?.find(c=>c.id===selected.card.id)||selected.card,item=card.stages.find(s=>s.id===selected.stage.id)||card.stages[0];return openStage(owner,card,item,false,trigger,{backLabel:'Return to slide',returnOnApply:true,canWrite:()=>!closed&&editable(),applyDraft:apply,saveDraft:layer=>{mutate(()=>{const list=(owner.slides??=[]);let live=list.find(c=>c.id===card.id);if(!live){live=clone(card);list.splice(insertionIndex(owner,null),0,live);}const stage=live.stages.find(s=>s.id===item.id);stage.marks=clone(layer.marks);stage.photos=clone(layer.photos||[]);stage.savedView=clone(layer.savedView);});},onClose:async()=>{const anchor=selected.card.id;frames=bundleReferenceFrames(await groupedFrames(draft,groupFor(owner).roots),draft);at=Math.max(0,frames.findIndex(f=>frameMembers(f).some(m=>m.card.id===anchor)));void show();}},draft);};
      return openStage(owner,card,item,true,trigger,{drawingFrames:f.drawingFrames,bomFrames:f.bomFrames?.map(m=>{const owner=draft.find(o=>o.id===m.op.id),card=owner.slides?.find(c=>c.id===m.card.id)||m.card;return {...m,card,generated:!owner.slides?.some(c=>c.id===m.card.id),stage:card.stages.find(s=>s.id===m.stage.id)||m.stage};}),bomReview:f.bomReview,backLabel:'Back to organizer',progress:'Slide '+(at+1)+' / '+frames.length+' | Stage '+(f.si+1),hasPrevious:frames.length>1,hasNext:frames.length>1,onAdvance:delta=>{changing=true;at=((at+delta)%frames.length+frames.length)%frames.length;void show();},onEdit:canEdit?edit:null,onClose:()=>setTimeout(()=>{if(!changing)finish();},0)},draft);
     };await show();
    }catch(e){viewing=false;error(e.message);}
   }
   q('[data-cancel]').onclick=leave;q('[data-org-return]').onclick=leave;d.addEventListener('cancel',e=>{e.preventDefault();if(movement.active)cancelDrag();else leave();});
   d.addEventListener('click',async ev=>{const b=ev.target.closest('[data-org-card]')||ev.target.closest('button');if(!b||rendering||saving||viewing||movement.suppressClick)return;try{
    if(b.dataset.orgCard){selected=b.dataset.orgCard;controls();return;}
    if(b.hasAttribute('data-org-collapse')){const id=b.dataset.orgCollapse;cancelDrag();movement.resetTap();collapsed.has(id)?collapsed.delete(id):collapsed.add(id);syncCollapsed();controls();return;}
    if(b.dataset.orgSection){selected=null;selectedOwner=b.dataset.orgSection;controls();return;}
    if(b.hasAttribute('data-org-undo')){if(history.length){restore(history.pop());void render();}else if(undo.length&&signature(draft)===signature(baseline)){undoChange();baseline=clone(ops());draft=clone(baseline);void render();}return;}
    if(b.hasAttribute('data-org-apply')){apply();d.close();return;}
    if(b.hasAttribute('data-org-save')){apply();saving=true;for(const button of d.querySelectorAll('button'))button.disabled=true;try{const saved=await options.saveLabor();if(saved===false)throw Error('Labor was not saved. Retry Save Labor before continuing.');d.close();}catch(err){error('Arrangement is in the Labor draft. '+err.message);}finally{saving=false;for(const button of d.querySelectorAll('button'))button.disabled=false;controls();}return;}
    const e=chosen(),target=e?.op||draft.find(o=>o.id===selectedOwner),after=e?.card.id||null;
    if(b.hasAttribute('data-org-copy')&&movable(e)){clipboard=frameMembers(e).map(f=>duplicate(f.card));controls();error('');return;}
    if(b.hasAttribute('data-org-paste')&&clipboard&&target){mutate(()=>{ensure(target);const cards=clipboard.map(duplicate);(target.slides??=[]).splice(insertionIndex(target,after),0,...cards);selected=cards[0].id;selectedOwner=target.id;});return;}
    if(b.hasAttribute('data-org-insert')&&target){const prior=state(draft);try{ensure(target);await add(target,insertionIndex(target,after),d,fn=>{restore(prior);mutate(()=>{ensure(target);const ids=new Set((target.slides||[]).map(c=>c.id));fn();selected=(target.slides||[]).find(c=>!ids.has(c.id))?.id||selected;selectedOwner=target.id;});},true);}catch(err){restore(prior);throw err;}finally{restore(prior);}return;}
    if(b.hasAttribute('data-org-restore')&&target&&exclusions){
     rendering=true;q('[data-org-insert]').disabled=true;b.disabled=true;const missing=[];try{if(!target.parentId&&target.slidesOrganized){const drawing=await drawingPages();if(!drawing.sources.length||drawing.issues.some(issue=>issue.blocking))throw Error('Open the selected drawings before restoring default pages. Existing slides are unchanged.');for(const {source,count} of drawing.sources)for(let page=1;page<=count;page++)if(!(target.slides||[]).some(c=>c.kind==='DRAWING'&&c.page===page&&c.source?.documentId===source.documentId&&c.source?.sha256===source.sha256))missing.push(await standardCard(target,'DRAWING',page,source));}}finally{rendering=false;controls();}
     mutate(()=>{delete target.excludedSlideIds;for(const member of storageEntries.filter(e=>(e.card.kind==='BOM'||e.generated&&e.card.kind==='DRAWING')&&typeName(e.op,draft)===typeName(target,draft))){const owner=draft.find(o=>o.id===member.op.id);if(owner.excludedSlideIds)owner.excludedSlideIds=owner.excludedSlideIds.filter(id=>id!==member.card.id);}for(const card of missing){const restored=draft.some(o=>(o.slides||[]).some(c=>c.id===card.id))?duplicate(card):card;(target.slides??=[]).splice(insertionIndex(target,null),0,restored);}selected=null;selectedOwner=target.id;});return;
    }
    if(b.hasAttribute('data-org-delete')&&removable(e)){
     if(exclusions&&defaultPage(e)){
      const confirm=dialog('Remove page from this operation?', '<p>Remove <strong>'+esc(e.bomFrames?'BOM reference (all included source pages)':e.drawingFrames?drawingTitle(e):e.card.title)+'</strong> from '+esc(ownerLabel(e.op))+' only?</p><p>Source documents, Labor notes and saved overlays are kept. Use Undo or Restore default pages to bring this page back.</p><button data-confirm-remove>Remove page</button>');
      confirm.querySelector('[data-confirm-remove]').onclick=()=>{confirm.close();mutate(()=>{for(const member of removalMembers(e)){const owner=draft.find(o=>o.id===member.op.id);const ids=(owner.excludedSlideIds??=[]);if(!ids.includes(member.card.id))ids.push(member.card.id);}selected=null;selectedOwner=e.op.id;});};return;
     }
     mutate(()=>{ensure(e.op);const ids=new Set(frameMembers(e).map(f=>f.card.id)),at=e.op.slides.findIndex(c=>ids.has(c.id));if(at<0||e.op.slides.filter(c=>ids.has(c.id)).length!==ids.size)throw Error('Select a current slide.');e.op.slides=e.op.slides.filter(c=>!ids.has(c.id));selected=e.op.slides[Math.min(at,e.op.slides.length-1)]?.id||null;selectedOwner=e.op.id;});
    }
   }catch(err){error(err.message);}});
   d.addEventListener('close',()=>{closed=true;cancelDrag();generation++;abort.abort();for(const url of urls)URL.revokeObjectURL(url);const e=discarded?null:chosen();resume?.(e?{opId:e.op.id,cardId:e.card.id,stageId:e.card.stages[0]?.id}:null);},{once:true});await render();
  }

  function paintAll(){closeFloating();for(const [id,panel]of panels){if(!panel.isConnected){panels.delete(id);continue;}const op=ops().find(o=>o.id===id);if(op)paint(panel,op);}}
  function paint(panel,op,occurrence=op){if(op.instructionSourceId){paint(panel,window.DleLaborWorkbench.instructionOwner(ops(),op),occurrence);return;}const cards=(op.slides||[]).filter(c=>!(op.excludedSlideIds||[]).includes(c.id)),disabled=editable()?'':'disabled';
   panel.innerHTML='<summary>Slides ('+cards.length+')</summary><p class="labor-edit-impact">'+esc(window.DleLaborWorkbench.instructionImpact(ops(),occurrence))+'</p>'+(!options.supported()?'<p role="status">Slideshow authoring awaits SIM activation. Existing Labor features remain available.</p>':'')+'<div class="labor-slide-controls"><button type="button" data-play '+(op.parentId&&!cards.length&&!operatorNotes(op)?'disabled':'')+'>Play slides</button><button type="button" data-undo-slides '+(undo.length?disabled:'disabled')+'>Undo</button><button type="button" data-add-slide="'+cards.length+'" '+disabled+'>+ Add slide</button></div>'+(op.parentId&&operatorNotes(op)&&!cards.some(c=>c.kind==='SUBSTEP')?'<div class="labor-slide-generated">Substep page: '+esc(identity(op))+'<p>Generated from this step’s notes.</p><button type="button" data-customize-substep '+disabled+'>Customize substep page</button></div>':'')+'<div class="labor-slide-cards">'+cards.map((c,i)=>cardMarkup(c,i,disabled)).join('')+'</div><p data-slide-status role="status"></p>';
   panel.open=expanded.has(occurrence.id);panel.ontoggle=()=>{if(panel.open)expanded.add(occurrence.id);else{expanded.delete(occurrence.id);closeFloating();}};
   panel.onpointerover=e=>{const title=e.target.closest('[data-slide-title]');if(!title||title.contains(e.relatedTarget)||e.pointerType!=='mouse')return;clearTimeout(leaveTimer);clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{if(title.isConnected&&title.getClientRects().length)void quickPreview(op,cards.find(c=>c.id===title.closest('[data-slide-card]').dataset.slideCard),title);},250);};
   panel.onpointerout=e=>{const title=e.target.closest('[data-slide-title]');if(!title||title.contains(e.relatedTarget))return;clearTimeout(hoverTimer);if(floating?.node.contains(e.relatedTarget))return;leaveTimer=setTimeout(()=>closeFloating(),180);};
   panel.onclick=async e=>{const b=e.target.closest('button');if(!b)return;e.stopPropagation();const card=cards.find(c=>c.id===b.closest('[data-slide-card]')?.dataset.slideCard);try{
    if(b.hasAttribute('data-preview-slide')){await quickPreview(op,card,b,true);return;}
    if(b.hasAttribute('data-slide-menu')){if(floating?.anchor===b)closeFloating(true);else actionMenu(op,card,b,panel);return;}
    if(b.hasAttribute('data-play')){await play(occurrence,b);return;}
    if(b.hasAttribute('data-edit-stage')){await openStage(op,card,card.stages.find(s=>s.id===b.dataset.editStage),!editable(),b,{draftNotice:window.DleLaborWorkbench.instructionImpact(ops(),occurrence)});return;}
    if(!editable())return;
    if(b.hasAttribute('data-customize-substep')){change(()=>{const card=substep(op);card.id=uid();(op.slides??=[]).unshift(card);});return;}
    if(b.hasAttribute('data-add-slide')){await add(op,Number(b.dataset.addSlide),panel);return;}
    if(b.hasAttribute('data-undo-slides')){undoChange();return;}
    if(b.hasAttribute('data-add-stage')){await addStage(op,card,panel);return;}
    const item=card?.stages.find(s=>s.id===b.closest('[data-stage-row]')?.dataset.stageRow);
    if(item&&b.hasAttribute('data-delete-stage')){if(card.stages.length>1&&window.confirm('Delete this replacement stage?'))change(()=>card.stages.splice(card.stages.indexOf(item),1));return;}
    if(item&&b.hasAttribute('data-move-stage')){const from=card.stages.indexOf(item),to=from+Number(b.dataset.moveStage);if(to>=0&&to<card.stages.length)change(()=>card.stages.splice(to,0,card.stages.splice(from,1)[0]));}
   }catch(error){warning(panel,error);}};
   if(panel._slideFocusIn)panel.removeEventListener('focusin',panel._slideFocusIn);panel._slideFocusIn=e=>{if(!restoringFocus&&e.target.matches('[data-slide-title]')){const title=e.target;requestAnimationFrame(()=>{if(title.isConnected&&document.activeElement===title&&title.matches(':focus-visible'))void quickPreview(op,cards.find(c=>c.id===title.closest('[data-slide-card]').dataset.slideCard),title);});}if(editable()&&e.target.matches('[data-card-field],[data-stage-name]'))remember();};panel.addEventListener('focusin',panel._slideFocusIn);
   for(const details of panel.querySelectorAll('[data-slide-card] > details'))details.ontoggle=()=>{if(!details.open)details.hidden=true;};
   panel.oninput=e=>{if(!editable())return;closeFloating();const card=cards.find(c=>c.id===e.target.closest('[data-slide-card]')?.dataset.slideCard);if(!card)return;if(card.kind==='BOM'&&e.target.dataset.cardField)return;if(e.target.dataset.cardField)card[e.target.dataset.cardField]=e.target.value;else if(e.target.hasAttribute('data-stage-name'))card.stages.find(s=>s.id===e.target.closest('[data-stage-row]').dataset.stageRow).name=e.target.value;const title=e.target.closest('[data-slide-card]').querySelector('[data-slide-title] strong');if(title)title.textContent=card.kind==='START'?'Traveler page':card.title;changed();};
  }
  function cardMarkup(card,index,disabled){const first=card.stages[0];
   return '<article data-slide-card="'+esc(card.id)+'" class="labor-slide-card labor-slide-compact"><div class="labor-slide-rowbar"><button type="button" data-slide-title class="labor-slide-title" data-edit-stage="'+esc(first.id)+'" title="Open slide editor"><span>'+(index+1)+'</span><strong>'+esc(card.kind==='START'?'Traveler page':card.title)+'</strong><small>'+esc(card.kind.toLowerCase())+' · '+card.stages.length+'</small></button><button type="button" data-preview-slide aria-label="Preview slide '+(index+1)+'">Preview</button><button type="button" data-slide-menu aria-label="Actions for slide '+(index+1)+'" aria-haspopup="menu" aria-expanded="false">⋯</button></div><details hidden><summary>Edit text and stages</summary><label>Title<input data-card-field="title" maxlength="100" value="'+esc(card.kind==='START'?'Traveler page':card.title)+'" '+(['BOM','START'].includes(card.kind)?'disabled':disabled)+'></label><label>Operator-facing text<textarea data-card-field="body" maxlength="4000" '+(card.kind==='BOM'?'disabled':disabled)+'>'+esc(card.body)+'</textarea></label><ol>'+card.stages.map((s,i)=>'<li data-stage-row="'+esc(s.id)+'"><input aria-label="Stage name" data-stage-name maxlength="100" value="'+esc(s.name)+'" '+disabled+'><button type="button" data-edit-stage="'+esc(s.id)+'">Open stage '+(i+1)+'</button><button type="button" aria-label="Move stage up" data-move-stage="-1" '+(i?disabled:'disabled')+'>Up</button><button type="button" aria-label="Move stage down" data-move-stage="1" '+(i<card.stages.length-1?disabled:'disabled')+'>Down</button><button type="button" data-delete-stage '+(card.stages.length>1?disabled:'disabled')+'>Delete stage</button></li>').join('')+'</ol><button type="button" data-add-stage '+(card.reflowStepId?'disabled':disabled)+'>+ Replacement stage</button></details></article>';
  }
  function mount(root){closeFloating();panels.clear();for(const node of root.querySelectorAll('[data-slide-operation]')){const op=ops().find(o=>o.id===node.dataset.slideOperation);if(op){panels.set(op.id,node);paint(node,op);}}}
  async function editSingle(op,card,item,trigger,callbacks={}){
   if(!editable()||!ops().includes(op)||!op.slides?.includes(card)||!card.stages.includes(item))throw Error('This pending slide is no longer editable.');
   return openStage(op,card,item,false,trigger,{...callbacks,onOrganize:null,canWrite:()=>editable()&&ops().includes(op)&&op.slides?.includes(card)&&card.stages.includes(item)},[...ops()]);
  }
  return {ensureReflowSetup,printOperation,mount,play,playSequence,organize,editSingle,refresh:id=>{const op=ops().find(o=>o.id===id),panel=panels.get(id);if(op&&panel)paint(panel,op);}};
 }
 window.DleLaborSlides=Object.freeze({connect,duplicate,flatten});
})(window,document);

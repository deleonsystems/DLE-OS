(function(window,document){
 'use strict';
 const api='/api/sim/assembly-library/revision-name',sessions=new Set();
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const button=(label,fn)=>{const n=el('button',label);n.type='button';n.onclick=fn;return n;};
 const css=el('style');css.textContent=`.library-revision-name{color-scheme:dark;color:#f1f5f9;font:13px/1.45 system-ui,sans-serif;margin:8px 0;min-width:0}.library-revision-name .revision-source{color:#cbd5e1;margin:4px 0;overflow-wrap:anywhere}.library-revision-name .revision-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.library-revision-name .revision-value{font-weight:650;overflow-wrap:anywhere}.library-revision-name button{background:#1e293b;color:#f1f5f9;border:1px solid #94a3b8;border-radius:5px;padding:4px 9px;min-height:34px;font:inherit;cursor:pointer}.library-revision-name button:disabled{opacity:.65;cursor:default}.library-revision-name input{color:#f1f5f9;background:#111c30;border:1px solid #94a3b8;border-radius:5px;font:inherit;padding:6px;min-width:130px;max-width:100%;width:240px;box-sizing:border-box}.library-revision-name label{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.library-revision-name :focus-visible{outline:2px solid #93c5fd;outline-offset:3px}.library-revision-name p{margin:4px 0}.library-revision-name .revision-feedback{color:#fcd34d;overflow-wrap:anywhere}.library-revision-name .revision-feedback:empty{display:none}.library-revision-name small{color:#cbd5e1}@media(max-width:550px){.library-revision-name input{width:100%}.library-revision-name label{width:100%}}`;document.head.append(css);
 async function request(key,body){
  const response=await fetch(api+(body?'':'?'+new URLSearchParams({key})),{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(response.status===404)throw Error('Revision names await SIM activation.');
  let data;try{data=await response.json();}catch{throw Error('The saved revision name could not be checked.');}
  if(!response.ok)throw Error(data.message||'Revision name unavailable.');return data;
 }
 function attach(host,key,options={}){
  host.classList.add('library-revision-name');host.setAttribute('aria-label','Revision name');
  const state={host,dirty:false,busy:false,feedback:null};sessions.add(state);
  let data,generation=0;
  const meaningful=v=>String(v??'').trimEnd()||'Not provided';
  function validate(view){if(view?.record?.sourceKeyRaw!==key||view.record.drawingRevision!==view.context?.drawingRevision||view.record.bomRevision!==view.context?.bomRevision||!view.source||!view.token)throw Error('Assembly revisions changed. Reopen these records to check.');const expected=options.expectedSource;if(expected&&['assemblyNumber','drawingRevision','bomRevision'].some(k=>String(expected[k]??'').trimEnd()!==String(view.source[k]??'').trimEnd()))throw Error('Source revisions changed. Reopen Assembly Records to check.');return view;}
  function source(){
   const s=data.source,c=data.context;
   if(options.showSource!==false){const p=el('p',(s.kind==='VPRO5'?'VPRO5 source: ':'Library source: ')+meaningful(s.assemblyNumber)+' \u00b7 Drawing '+meaningful(s.drawingRevision)+' \u00b7 BOM '+meaningful(s.bomRevision));p.className='revision-source';host.append(p);}
   if(c.drawingRevision!==String(s.drawingRevision??'').trimEnd()||c.bomRevision!==String(s.bomRevision??'').trimEnd()){const p=el('p','Library record: Drawing '+meaningful(c.drawingRevision)+' \u00b7 BOM '+meaningful(c.bomRevision));p.className='revision-source';host.append(p);}
  }
  function feedback(){const p=el('p');p.className='revision-feedback';p.setAttribute('role','status');state.feedback=p;host.append(p);return p;}
  function draw(focus=false){
   state.dirty=false;host.replaceChildren();source();if(host.isConnected)options.onView?.(data);
   const line=el('div');line.className='revision-line';const value=el('span',data.record.displayName||'Not established');value.className='revision-value';line.append(el('span','DLE-OS revision:'),value);host.append(line);
   if(data.canEdit){const edit=button(data.record.displayName?'Edit':'Set name',editName);edit.setAttribute('aria-label',data.record.displayName?'Edit DLE-OS revision name':'Set DLE-OS revision name');line.append(edit);if(focus)edit.focus({preventScroll:true});}
   const message=feedback();if(data.sourceChanged)message.textContent='The source changed since this name was saved. Check that the DLE-OS revision still applies.';
  }
  function editName(){
   if(state.busy||!data.canEdit)return;
   host.replaceChildren();source();const line=el('div');line.className='revision-line';const input=el('input');input.type='text';input.maxLength=120;input.value=data.record.displayName||options.suggestion||'';input.autocomplete='off';
   const label=el('label','DLE-OS revision');label.append(input);line.append(label);
   state.dirty=input.value!==(data.record.displayName||'');input.oninput=()=>{state.dirty=input.value!==(data.record.displayName||'');};
   const cancel=button('Cancel',()=>{if(!state.busy)void refresh(true);});
   const save=button('Save',async()=>{
    if(state.busy)return;
    if(!input.value.trim()){message.textContent='Enter a revision name.';input.focus({preventScroll:true});return;}
    state.busy=true;save.disabled=cancel.disabled=input.disabled=true;message.textContent='Saving revision name.';
    try{const next=validate(await request(key,{key,token:data.token,drawingRevision:data.context.drawingRevision,bomRevision:data.context.bomRevision,displayName:input.value}));data=next;state.dirty=false;state.busy=false;draw(true);state.feedback.textContent='Revision name saved.';host.dispatchEvent(new Event('dle-library-revision-name-saved'));}
    catch(e){state.busy=false;if(host.isConnected)options.onView?.(null);input.disabled=cancel.disabled=false;message.textContent='Save could not be confirmed. '+e.message+' Your text is retained. Cancel and reopen to check the saved name before retrying.';input.focus({preventScroll:true});}
   });line.append(save,cancel);host.append(line);
   if(!data.record.displayName&&options.suggestion)host.append(el('small','Suggested from the incoming request; save to establish this name.'));
   const message=feedback();if(data.sourceChanged)message.textContent='The source changed since this name was saved. Check the source before saving.';
   input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save.click();}else if(e.key==='Escape'){e.preventDefault();cancel.click();}};input.focus({preventScroll:true});
  }
  async function refresh(focus=false){
   if(state.busy)return;if(state.dirty&&!focus)return;
   state.dirty=false;const attempt=++generation;if(host.isConnected)options.onView?.(null);host.replaceChildren(el('p','Checking revision name.'));
   try{const view=validate(await request(key));if(attempt!==generation||!host.isConnected)return;data=view;draw(focus);}
   catch(e){if(attempt!==generation||!host.isConnected)return;host.replaceChildren();const message=feedback();message.textContent=e.message;host.append(button('Retry',()=>void refresh()));}
  }
  void refresh();return {refresh};
 }
 document.addEventListener('click',e=>{for(const state of sessions){if(!state.host.isConnected){sessions.delete(state);continue;}if((state.busy||state.dirty)&&!state.host.contains(e.target)&&e.target.closest?.('button,a,select')){e.preventDefault();e.stopImmediatePropagation();if(state.feedback)state.feedback.textContent='Save or cancel the revision name before leaving.';return;}}},true);
 window.addEventListener('beforeunload',e=>{if([...sessions].some(s=>s.host.isConnected&&(s.busy||s.dirty))){e.preventDefault();e.returnValue='';}});
 window.DleLibraryRevisionName=Object.freeze({attach});
})(window,document);

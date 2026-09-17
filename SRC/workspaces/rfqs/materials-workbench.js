(function(window,document){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const columns=['Find #','Customer / BOM P/N','MFG / Approved P/N','Description','Ref Des','Qty / Unit','UoM','Unit Cost','Ext Cost','Order Qty','Total Cost','Vendor','Vendor P/N','Lead Time','Options'];
  // Decimal coefficients avoid binary floating-point multiplication and match
  // the server's positive-value MidpointRounding.AwayFromZero cent rounding.
  function decimalCostPreview(quantity,price,excluded,maxQuantity=1000000){
    if(price===null||price===undefined||price==='')return '';
    function decimal(value){
      const match=String(value).trim().replace(/^\./,'0.').match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
      if(!match)return null;
      let coefficient=BigInt(match[1]+(match[2]||'')),scale=(match[2]||'').length-Number(match[3]||0);
      if(scale<0){coefficient*=10n**BigInt(-scale);scale=0;}
      return {coefficient,scale};
    }
    const q=decimal(quantity),p=decimal(price);
    if(!q||!p||q.coefficient===0n||q.coefficient>BigInt(maxQuantity)*10n**BigInt(q.scale))return '';
    const denominator=10n**BigInt(q.scale+p.scale);
    const numerator=excluded?0n:q.coefficient*p.coefficient*100n;
    const cents=numerator/denominator+(numerator%denominator*2n>=denominator?1n:0n);
    return '$'+(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(cents%100n).toString().padStart(2,'0');
  }
  const chargeDecimal=v=>{const m=String(v??'').trim().replace(/^\./,'0.').match(/^(\d+)(?:\.(\d{0,28}))?$/);return m?BigInt(m[1])*10n**28n+BigInt((m[2]||'').padEnd(28,'0')):null;};
  const roundPositive=(n,d)=>n/d+(n%d*2n>=d?1n:0n);
  const chargeMoney=c=>c==null?'—':'$'+(c/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(c%100n).toString().padStart(2,'0');
  function chargeSell(c,markup){const raw=chargeDecimal(c.rawCost),qty=chargeDecimal(c.quantity??1),rate=chargeDecimal(c.markupTreatment==='MATERIAL'?markup:c.markupTreatment==='CUSTOM'?c.customMarkupPercent:0);return raw==null||qty==null||rate==null?null:roundPositive(raw*qty*((100n*10n**28n)+rate),(10n**84n));}
  // Browser-local, per-user presentation only; never part of a quotation payload.
  function materialColumnWidths(root,onLayout=()=>{}){
    const table=root.querySelector('.material-grid'),cols=[...(root.querySelectorAll?.('.material-grid col')||[])],headers=[...(root.querySelectorAll?.('.material-grid th')||[])];
    if(!cols.length)return {view(){},reset(){}};
    const user=window.DleOsSession?.user?.userName;
    const legacyKey=user?'DLE_OS_MATERIAL_SOURCE_WIDTHS_V1:'+encodeURIComponent(user):null;
    const key=user?'DLE_OS_MATERIAL_SOURCE_LAYOUT_V2:'+encodeURIComponent(user):null;
    const minimum=[50,100,140,140,80,75,65,85,85,85,95,120,100,145,100];
    let widths=null,active=false,gesture=null,hidden=new Set();
    const validWidths=value=>Array.isArray(value)&&value.length===cols.length&&value.every((w,i)=>Number.isFinite(w)&&w>=minimum[i]&&w<=2000);
    try{const saved=JSON.parse(key?window.localStorage.getItem(key):'null');const prior=JSON.parse(legacyKey?window.localStorage.getItem(legacyKey):'null');
      if(validWidths(saved?.widths))widths=saved.widths;else if(!saved&&validWidths(prior))widths=prior;
      if(Array.isArray(saved?.hidden))hidden=new Set(saved.hidden.filter(i=>Number.isInteger(i)&&i>0&&i<cols.length));
    }catch{}
    const rowCells=[...(root.querySelectorAll?.('.material-grid tbody tr')||[])].map(row=>{let start=0;return [...row.cells].map(cell=>{const span=cell.colSpan||1,entry={cell,start,span};start+=span;return entry;});});
    function persist(){try{if(key){if(widths||hidden.size)window.localStorage.setItem(key,JSON.stringify({widths,hidden:[...hidden]}));else window.localStorage.removeItem(key);window.localStorage.removeItem(legacyKey);}}catch{}}
    function apply(){
      cols.forEach(c=>{c.style.width='';c.hidden=false;});headers.forEach(h=>{h.hidden=false;});table.style.width='';table.style.minWidth='';
      rowCells.flat().forEach(({cell,span})=>{cell.hidden=false;cell.colSpan=span;});
      const effective=widths||headers.map(h=>h.getBoundingClientRect().width);
      if(active&&(widths||hidden.size)){
        cols.forEach((c,i)=>{c.style.width=effective[i]+'px';c.hidden=hidden.has(i);headers[i].hidden=hidden.has(i);});
        rowCells.forEach(row=>row.forEach(({cell,start,span})=>{let visible=0;for(let i=start;i<start+span;i++)if(!hidden.has(i))visible++;cell.hidden=visible===0;cell.colSpan=Math.max(1,visible);}));
        table.style.width=effective.reduce((sum,w,i)=>sum+(hidden.has(i)?0:w),0)+'px';table.style.minWidth='0';
      }
      checks.forEach((check,i)=>{check.checked=!hidden.has(i);});
    }
    function changeVisibility(i,visible){if(!active||i===0)return;onLayout();if(!widths)widths=headers.map(h=>h.getBoundingClientRect().width);if(visible)hidden.delete(i);else hidden.add(i);apply();persist();}
    function view(on){active=on;apply();root.querySelector('[data-material-action="reset-layout"]').hidden=!on;menu.hidden=!on;if(!on)menu.open=false;handles.forEach(h=>{h.hidden=!on;});hideButtons.forEach(h=>{h.hidden=!on;});}
    const menu=document.createElement('details');menu.className='material-columns-menu';const summary=document.createElement('summary');summary.textContent='Columns';menu.appendChild(summary);
    const checklist=document.createElement('div');checklist.className='material-columns-checklist';menu.appendChild(checklist);
    const checks=columns.map((name,i)=>{const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.disabled=i===0;check.setAttribute('aria-label',name+' column');check.oninput=event=>event.stopPropagation();check.onchange=event=>{event.stopPropagation();changeVisibility(i,check.checked);};label.appendChild(check);const text=document.createElement('span');text.textContent=name;label.appendChild(text);checklist.appendChild(label);return check;});
    root.querySelector('.material-toolbar').appendChild(menu);
    menu.onkeydown=event=>{if(event.key==='Escape'){menu.open=false;summary.focus();}};
    const hideButtons=headers.slice(1).map((header,j)=>{const i=j+1,button=document.createElement('button');button.type='button';button.className='material-column-hide';button.textContent='−';button.title='Hide column';button.setAttribute('aria-label','Hide column: '+columns[i]);button.onclick=event=>{event.preventDefault();event.stopPropagation();changeVisibility(i,false);};header.appendChild(button);return button;});
    function currentWidths(){return headers.map((h,i)=>hidden.has(i)?widths[i]:h.getBoundingClientRect().width);}
    function finish(cancel){if(!gesture)return;const g=gesture;gesture=null;if(cancel){widths=g.before;apply();}else persist();root.classList.remove('material-column-resizing');if(g.handle.hasPointerCapture(g.id))g.handle.releasePointerCapture(g.id);}
    const handles=headers.map((header,i)=>{
      const handle=document.createElement('button');handle.type='button';handle.className='material-column-resize';handle.setAttribute('aria-label','Resize '+columns[i]+' column');handle.title='Drag to resize column';
      handle.onpointerdown=event=>{if(!active||event.button!==0)return;event.preventDefault();event.stopPropagation();const initial=currentWidths();gesture={id:event.pointerId,x:event.clientX,initial,before:widths?.slice()||null,handle};root.classList.add('material-column-resizing');handle.setPointerCapture(event.pointerId);};
      handle.onpointermove=event=>{if(!gesture||gesture.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();widths=gesture.initial.slice();widths[i]=Math.max(minimum[i],Math.min(2000,gesture.initial[i]+event.clientX-gesture.x));apply();};
      handle.onpointerup=event=>{event.stopPropagation();finish(false);};handle.onpointercancel=()=>finish(true);handle.onlostpointercapture=()=>finish(true);handle.onclick=event=>{event.preventDefault();event.stopPropagation();};
      handle.onkeydown=event=>{if(event.key==='Escape'){finish(true);return;}if(!active||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();widths=currentWidths();widths[i]=Math.max(minimum[i],Math.min(2000,widths[i]+(event.key==='ArrowRight'?10:-10)));apply();persist();};
      header.appendChild(handle);return handle;
    });
    return {view,reset(){onLayout();widths=null;hidden.clear();persist();apply();menu.open=false;}};
  }
  // Presentation-only selection. Never writes quote state or intercepts editor copy.
  function materialTableSelection(root){
    const selected=new Set();let anchor=null,focused=null,drag=null,ignoreClick=false,feedbackTimer=null;
    const control='input,select,textarea,button,a,summary,label,[contenteditable]:not([contenteditable="false"]),[role="button"]';
    const cells=()=>{
      const result=[];
      for(const [r,row] of [...(root.querySelectorAll?.('.material-grid-row,.material-charge-row')||[])].entries()){
        let c=0;for(const cell of row.cells){if(window.getComputedStyle(cell).display==='none')continue;const span=cell.colSpan||1;result.push({cell,r,c,end:c+span-1});c+=span;}
      }return result;
    };
    function clear(){for(const cell of selected){cell.classList.remove('material-cell-selected');cell.removeAttribute('aria-selected');}selected.clear();anchor=null;focused=null;}
    function feedback(count){
      const status=root.querySelector('[data-material-copy-status]');if(!status)return;
      window.clearTimeout(feedbackTimer);status.textContent=count===1?'Copied':'Copied '+count+' cells';
      feedbackTimer=window.setTimeout(()=>{status.textContent='';},1600);
    }
    function value(cell){
      const first=selector=>cell.querySelector(selector);
      if(first('.material-mfg-value'))return first('.material-mfg-value').textContent.trim();
      if(first('.material-vendor-trigger'))return first('.material-vendor-trigger').textContent.trim();
      if(first('.material-lead summary'))return first('.material-lead summary').textContent.trim();
      if(first('[data-total-cost]'))return first('[data-total-cost]').textContent.trim();
      if(first('[data-charge-sell]'))return first('[data-charge-sell]').textContent.trim();
      if(first('.material-evidence-options'))return ''; // Options/counts are not business values.
      const inputs=[...cell.querySelectorAll('input:not([type="hidden"]),select')].filter(e=>!e.hidden);
      if(inputs.length)return inputs.map(e=>e.tagName==='SELECT'?e.selectedOptions[0]?.textContent||'':e.value).join(' | ');
      const copy=cell.cloneNode(true);for(const e of copy.querySelectorAll('button,small,[popover]'))e.remove();return copy.textContent.trim();
    }
    function text(){const grid=cells(),active=grid.filter(x=>selected.has(x.cell));if(!active.length)return '';
      const top=Math.min(...active.map(x=>x.r)),bottom=Math.max(...active.map(x=>x.r)),left=Math.min(...active.map(x=>x.c)),right=Math.max(...active.map(x=>x.end));
      const rows=[];for(let r=top;r<=bottom;r++){const columns=[];for(let c=left;c<=right;c++){const x=active.find(x=>x.r===r&&x.c===c);columns.push(x?value(x.cell).replace(/[\t\r\n]+/g,' '):'');}rows.push(columns.join('\t'));}return rows.join('\n');
    }
    function click(event){
      if(ignoreClick){ignoreClick=false;return true;}
      if(event.target.closest(control))return false;
      const cell=event.target.closest('td'),grid=cells(),hit=grid.find(x=>x.cell===cell);if(!hit){clear();return false;}
      event.preventDefault();
      const rowMode=!event.dragRange&&hit.c===0,toggle=event.ctrlKey||event.metaKey,from=grid.find(x=>x.cell===anchor)||hit;
      let targets;
      if(event.shiftKey){const lo=Math.min(from.r,hit.r),hi=Math.max(from.r,hit.r),left=Math.min(from.c,hit.c),right=Math.max(from.end,hit.end);targets=grid.filter(x=>x.r>=lo&&x.r<=hi&&(rowMode||x.end>=left&&x.c<=right));}
      else targets=rowMode?grid.filter(x=>x.r===hit.r):[hit];
      const remove=toggle&&targets.every(x=>selected.has(x.cell));
      if(!toggle){for(const x of selected){x.classList.remove('material-cell-selected');x.removeAttribute('aria-selected');}selected.clear();}
      for(const x of targets){if(remove){selected.delete(x.cell);x.cell.classList.remove('material-cell-selected');x.cell.removeAttribute('aria-selected');}else{selected.add(x.cell);x.cell.classList.add('material-cell-selected');x.cell.setAttribute('aria-selected','true');}}
      if(!event.shiftKey)anchor=cell;focused=cell;cell.tabIndex=-1;cell.focus({preventScroll:true});return true;
    }
    function endDrag(){const previous=drag;drag=null;root.classList.remove('material-grid-dragging');if(previous&&root.hasPointerCapture?.(previous.id))root.releasePointerCapture(previous.id);}
    function down(event){
      ignoreClick=false;
      if(event.button!==0||event.isPrimary===false||event.target.closest(control))return;
      const cell=event.target.closest('td');if(!cells().some(x=>x.cell===cell))return;
      event.preventDefault(); // Only background gestures suppress native selection.
      drag={id:event.pointerId,start:cell,last:cell,moved:false,shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey};
      root.classList.add('material-grid-dragging');root.setPointerCapture(event.pointerId);
    }
    function move(event){
      if(!drag||event.pointerId!==drag.id)return;
      event.preventDefault();const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest('td');
      if(!cells().some(x=>x.cell===cell)||cell===drag.last)return;
      drag.last=cell;drag.moved=true;anchor=drag.start;
      click({target:cell,shiftKey:true,dragRange:true,preventDefault(){}});
    }
    function up(event){
      if(!drag||event.pointerId!==drag.id)return;
      move(event);const finished=drag;
      if(!finished.moved)click({target:finished.start,shiftKey:finished.shiftKey,ctrlKey:finished.ctrlKey,metaKey:finished.metaKey,preventDefault(){}});
      endDrag();ignoreClick=true; // The browser's trailing click must not collapse the range.
    }
    function cancel(event){if(drag&&event.pointerId===drag.id)endDrag();}
    function key(event){
      if(event.key==='Escape'&&selected.size){clear();if(event.target.closest(control))return false;event.preventDefault();return true;}
      if(event.target.closest(control)||!selected.size||event.target!==focused||document.activeElement!==event.target)return false;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'){
        event.preventDefault();const count=selected.size;window.navigator.clipboard.writeText(text()).then(()=>feedback(count)).catch(()=>{root.querySelector('.materials-message').textContent='Clipboard unavailable. Allow clipboard access and try again.';});return true;
      }return false;
    }
    function copy(event){const active=document.activeElement;if(!selected.size||active!==focused||active.closest(control)||!event.clipboardData)return;event.clipboardData.setData('text/plain',text());event.preventDefault();feedback(selected.size);}
    return {click,key,copy,clear,text,down,move,up,cancel};
  }
  let sourcingView=false; // Page-session preference; quotation state is shared between views.
  async function open(mount,rfq,back){
    let view,dirty=false,busy=false,message='',evidencePanel=null;
    const expanded=new Set();
    const collapsedFees=new Set();
    const newCharges=new Set(), pricingOverrides=new Set();
    const chargeCategories=[['TARIFF','Tariff / Duty'],['FREIGHT','Freight / Handling'],['COD','COD / Processing'],['SETUP','Vendor NRE / Setup'],['TOOLING','Tooling'],['OTHER','Other']];
    const manualRows=new Set();
    const simVendors=['Digi-Key','Mouser','Newark','Arrow','Avnet'];
    const invalidInputs=new Set();
    const leadBefore=new Map();
    const readOnly=window.DleOsCapabilities?.can?.('technical_review.disposition')!==true;
    const url='/api/sim/rfqs/'+encodeURIComponent(rfq.intakeId)+'/materials';
    async function fetchView(options){const response=await window.fetch(url,{credentials:'include',cache:'no-store',...options});const body=await response.json();if(!response.ok)throw new Error(body.message||'Material Quotation Workspace unavailable');return body;}
    view=await fetchView();
    function input(row,key,label,type='text'){
      const html='<input aria-label="'+label+' for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="'+key+'" type="'+type+'" '+(type==='number'?'min="0" step="'+(key==='leadDays'?'1':'any')+'"':'')+' value="'+esc(key==='unitPrice'&&row[key]!=null?Number(row[key]).toFixed(2):row[key])+'" '+(invalidInputs.has(row.index+':'+key)?'aria-invalid="true" ':'')+(busy||readOnly?'disabled':'')+'>';
      return key==='unitPrice'?'<span class="material-money-input"><span>$</span>'+html+'</span>':html;
    }
    function orderWarning(row,calculated){return !row.customerSupplied&&calculated.required!==false&&row.orderQuantity!=null&&calculated.requiredQuantity!=null&&Number(row.orderQuantity)<calculated.requiredQuantity?'Below required qty · Minimum '+calculated.requiredQuantity:'';}
    function liveSummary(){
      let cents=0n,longest=null;
      for(const row of view.plan.rows){const calculated=view.rows.find(r=>r.quote.index===row.index);if(calculated.required===false||row.customerSupplied)continue;
        const cost=decimalCostPreview(row.orderQuantity,row.unitPrice,false,1000000000);if(cost)cents+=BigInt(cost.replace(/[^0-9]/g,''));
        const mode=row.leadTimeMode||(row.leadDays===0?'STOCK':row.leadDays>0?'DAYS':null),value=row.leadTimeMode?row.leadTimeValue:row.leadDays;
        if(mode&&(mode==='STOCK'||value>0)){const days=mode==='STOCK'?0:value*(mode==='WEEKS'?7:1);if(!longest||days>longest.days)longest={days,label:mode==='STOCK'?'Stock':value+(mode==='WEEKS'?' Weeks':' Days')};}
      }
      const currency=c=>'$'+(c/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(c%100n).toString().padStart(2,'0');
      let sale='—';const mark=String(view.plan.markupPercent??0),match=mark.match(/^(\d+)(?:\.(\d*))?$/);
      if(match&&!invalidInputs.has('markup')){const scale=10n**BigInt((match[2]||'').length),rate=BigInt(match[1]+(match[2]||'')),den=100n*scale*BigInt(view.rfq.assemblies[0].quantity),num=cents*(100n*scale+rate);sale=currency(num/den+(num%den*2n>=den?1n:0n));}
      let blendRaw=0n,blendSell=0n,separate=0n,nre=0n;
      for(const row of view.plan.rows)for(const c of row.charges||[]){const sell=chargeSell(c,view.plan.markupPercent??0);if(c.treatment==='BLEND'){blendRaw+=(chargeDecimal(c.rawCost)||0n)*(chargeDecimal(c.quantity??1)||0n)/10n**28n;blendSell+=sell||0n;}else if(c.treatment==='SEPARATE')separate+=sell||0n;else if(c.treatment==='NRE')nre+=sell||0n;}
      const rate=chargeDecimal(view.plan.markupPercent??0);if(rate!=null&&!invalidInputs.has('markup'))sale=chargeMoney(roundPositive(cents*((100n*10n**28n)+rate)+blendSell*(100n*10n**28n),(100n*10n**28n)*BigInt(view.rfq.assemblies[0].quantity)));
      return {total:currency(cents),sale,lead:longest?.label||'—',blended:chargeMoney(roundPositive(blendRaw,10n**26n)),basis:chargeMoney(cents+roundPositive(blendRaw,10n**26n)),separate:chargeMoney(separate),nre:chargeMoney(nre)};
    }
    function updateSummary(root){const values=liveSummary();for(const key of ['total','sale','lead','blended','basis','separate','nre']){const target=root.querySelector('[data-live-'+key+']');if(target)target.textContent=values[key];}for(const row of view.plan.rows)for(const c of row.charges||[]){const target=root.querySelector('[data-charge-sell="'+c.id+'"]');if(target)target.textContent=chargeMoney(chargeSell(c,view.plan.markupPercent??0));const ext=root.querySelector('[data-charge-ext="'+c.id+'"]');if(ext)ext.textContent=decimalCostPreview(c.quantity??1,c.rawCost,false);const standard=root.querySelector('[data-charge="'+c.id+'"][data-charge-field="markupTreatment"] option[value="MATERIAL"]');if(standard)standard.textContent='Std '+(view.plan.markupPercent??0)+'%';}}
    function vendorControl(row){
      const value=row.customerSupplied?'Customer Supplied':row.vendor||'—';
      return '<button class="material-vendor-trigger" data-material-action="vendor-open" data-index="'+row.index+'" '+(readOnly||busy?'disabled':'')+'>'+esc(value)+'</button><small data-vendor-status="'+row.index+'">'+(!row.customerSupplied&&row.vendor&&row.vendorSource!=='SIM_LIST'?'Not Approved · Quote Only':'')+'</small><div class="material-vendor" popover="auto" data-vendor-panel="'+row.index+'">'+vendorList(row)+'</div>';
    }
    function vendorList(row){
      return '<input aria-label="Search SIM vendors for line '+(row.index+1)+'" data-vendor-search placeholder="Search vendors…"><small>SIM list only</small>'+[['','—'],['customer','Customer Supplied'],['manual','New Vendor…'],...simVendors.map(v=>[v,v])].map(([v,l])=>'<button data-material-action="vendor-choice" data-index="'+row.index+'" data-vendor="'+esc(v)+'" '+(simVendors.includes(v)?'data-vendor-option="'+esc(v.toLowerCase())+'"':'')+'>'+esc(l)+'</button>').join('');
    }
    function positionVendor(panel,button){
      const r=button.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight;
      panel.style.left=Math.max(8,Math.min(r.right-width,window.innerWidth-width-8))+'px';
      panel.style.top=Math.max(8,r.bottom+height+8<=window.innerHeight?r.bottom+3:r.top-height-3)+'px';
    }
    function uomControl(row){
      const value=row.uom||'EA',disabled=busy||readOnly?'disabled':'';
      return (value!=='EA'&&value!=='FT'?'<small>Saved: '+esc(value)+'</small>':'')+'<select aria-label="UoM for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="uom" '+disabled+'>'+(value!=='EA'&&value!=='FT'?'<option disabled hidden selected>'+esc(value)+'</option>':'')+['EA','FT'].map(v=>'<option '+(v===value?'selected':'')+'>'+v+'</option>').join('')+'</select>';
    }
    function leadControl(row){
      const mode=row.leadTimeMode||(row.leadDays===0?'STOCK':row.leadDays>0?'DAYS':''),value=row.leadTimeMode?row.leadTimeValue:row.leadDays;
      return '<details class="material-lead"><summary>'+esc(mode==='STOCK'?'Stock':mode&&value?value+(mode==='DAYS'?' Days':' Weeks'):'—')+'</summary><div><select aria-label="Lead Time mode for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="leadTimeMode" '+(busy||readOnly?'disabled':'')+'><option value="" '+(!mode?'selected':'')+'>—</option>'+[['STOCK','Stock'],['DAYS','Days'],['WEEKS','Weeks']].map(([v,l])=>'<option value="'+v+'" '+(v===mode?'selected':'')+'>'+l+'</option>').join('')+'</select><input aria-label="Lead Time value for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="leadTimeValue" type="text" inputmode="numeric" pattern="[0-9]+" value="'+esc(mode==='STOCK'?'':value)+'" '+(mode==='DAYS'||mode==='WEEKS'?'':'hidden ')+(busy||readOnly?'disabled':'')+'><small data-lead-label="'+row.index+'">'+esc(mode==='STOCK'?'Stock':mode&&value?value+(mode==='DAYS'?' Days':' Weeks'):'')+'</small></div></details>';
    }
    function closeLead(editor,cancel=false){
      const index=Number(editor.querySelector('select').dataset.row),row=view.plan.rows.find(r=>r.index===index);
      if(cancel||invalidInputs.has(index+':leadTime')){
        const before=leadBefore.get(index);if(before)Object.assign(row,before);
        invalidInputs.delete(index+':leadTime');
        editor.outerHTML=leadControl(row);
      }else editor.open=false;
      leadBefore.delete(index);
    }
    function confirmedParts(source){
      const identity=source.manufacturerIdentity;
      return [...new Set((identity?.proposals||[]).filter(p=>(identity.history||[]).filter(h=>h.proposalId===p.id).at(-1)?.decision==='CONFIRMED'&&p.partNumber?.trim()).map(p=>p.partNumber))];
    }
    function manufacturerSelect(row,source){
      const parts=confirmedParts(source),disabled=busy||readOnly?'disabled':'';
      const approved=row.mfgPartNumberSource==='CONFIRMED_ACCEPTED_BOM';
      return '<div class="material-mfg"><span class="material-mfg-value" data-mfg-value="'+row.index+'">'+esc(row.mfgPartNumber||'Not resolved')+'</span>'+(!readOnly?'<details class="material-mfg-menu"><summary title="Choose quotation P/N" aria-label="Choose quotation P/N for line '+(row.index+1)+'">▾</summary><div>'+parts.map((part,i)=>'<button data-material-action="confirmed-mfg" data-index="'+row.index+'" data-choice="'+i+'" '+disabled+'>'+ (approved&&part===row.mfgPartNumber?'✓ ':'')+esc(part)+' <small>Approved</small></button>').join('')+'<button data-material-action="manual-mfg" data-index="'+row.index+'" '+disabled+'>Manual Entry…</button></div></details>':'')+'</div><small class="material-mfg-status" data-mfg-status="'+row.index+'">'+(row.mfgPartNumber&&!approved?'Not Approved · Quote Only':'')+'</small>'+(manualRows.has(row.index)?'<div class="material-mfg-entry">'+input(row,'mfgPartNumber','Manual MFG / Approved P/N')+'<button data-material-action="done-mfg" data-index="'+row.index+'">Done</button></div>':'');
    }
    function alternateDetails(source){
      return '<details><summary>Available alternates and provenance</summary>'+((source.alternates||[]).map(a=>'<p><strong>'+esc(a.partNumber)+'</strong> · '+esc(a.removedAtUtc?'Removed':a.reviewStatus||'Review status not recorded')+' · '+esc(a.origin||'Origin not recorded')+'</p><p>'+esc(a.uncertainty||'')+'</p><pre>'+esc(JSON.stringify({sourceEvidence:a.sourceEvidence,sourceContext:a.sourceContext,supportingEvidence:a.supportingEvidence,approvalEvidence:a.approvalEvidence,history:a.history},null,2))+'</pre>').join('')||'<p>No structured alternates recorded.</p>')+'</details>';
    }
    function chargeRows(row,find){return (row.charges||[]).map((c,i)=>{
      const disabled=busy||readOnly?'disabled':'';
      const select=(key,label,options)=>'<label>'+label+'<select aria-label="'+label+' charge '+(i+1)+' line '+(row.index+1)+'" data-charge="'+c.id+'" data-charge-field="'+key+'" '+disabled+'>'+options.map(([v,l])=>'<option value="'+v+'" '+(c[key]===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>';
      const field=(key,label,numeric=false)=>'<label>'+label+'<input placeholder="'+label+'" title="'+label+'" aria-label="'+label+' charge '+(i+1)+' line '+(row.index+1)+'" data-charge="'+c.id+'" data-charge-field="'+key+'" value="'+esc(key==='quantity'?(c.quantity??1):c[key])+'" '+(numeric?'inputmode="decimal" ':'maxlength="'+(key==='notes'?2000:200)+'" ')+disabled+'></label>';
      return '<tr class="material-charge-row"><td class="material-fee-sequence" title="Charge sequence only; not a BOM Find number">↳ '+esc(find)+'.'+(i+1)+'</td><td colspan="'+4+'" class="material-fee-category"><div class="material-charge-fields">'+select('category','Category',chargeCategories)+(c.category==='OTHER'?field('description','Description'):'')+select('treatment','Customer Pricing',[['BLEND','Include in Unit Price'],['SEPARATE','Show Separately'],['NRE','Show as NRE']])+select('markupTreatment','Markup',[['MATERIAL','Std '+esc(view.plan.markupPercent??0)+'%'],['CUSTOM','Custom'],['NONE','None']])+(c.markupTreatment==='CUSTOM'?field('customMarkupPercent','Custom Markup %',true):'')+'</div></td><td class="material-number material-fee-qty"><div class="material-charge-fields">'+field('quantity','Fee Qty',true)+'</div></td><td class="material-fee-uom">EA</td><td class="material-fee-cost"><div class="material-charge-fields">'+field('rawCost','Cost',true)+'</div></td><td class="material-number material-fee-ext" data-charge-ext="'+c.id+'">'+decimalCostPreview(c.quantity??1,c.rawCost,false)+'</td><td></td><td class="material-number material-fee-sell">Sell <b data-charge-sell="'+c.id+'">'+chargeMoney(chargeSell(c,view.plan.markupPercent??0))+'</b></td><td colspan="4" class="material-fee-notes"><div class="material-charge-fields">'+evidenceOptions(row,c)+'<button data-material-action="remove-charge" data-index="'+row.index+'" data-charge-id="'+c.id+'" '+disabled+' aria-label="Remove charge '+(i+1)+' line '+(row.index+1)+'">×</button></div></td></tr>';
    }).join('');}
    function editCharge(t,root){if(t.dataset.chargeField===undefined)return false;const c=view.plan.rows.flatMap(r=>r.charges||[]).find(c=>c.id===t.dataset.charge);if(!c)return true;const key=t.dataset.chargeField,numeric=['rawCost','customMarkupPercent','quantity'].includes(key),amount=chargeDecimal(t.value),valid=!numeric||(t.value===''&&key!=='quantity')||(amount!=null&&/^(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/.test(t.value)&&amount<=(key==='rawCost'?1000000000n:key==='quantity'?1000000n:10000n)*10n**28n&&(key!=='quantity'||amount>0n));const id=c.id+':'+key;valid?invalidInputs.delete(id):invalidInputs.add(id);t.setCustomValidity(valid?'':'Enter a nonnegative decimal with at most six decimal places.');const previous=c[key];c[key]=numeric?(t.value===''?(key==='quantity'?'':null):t.value.replace(/^\./,'0.')):t.value;if(key==='treatment')pricingOverrides.add(c.id);if(key==='category'&&previous!==c.category){c.description=c.category==='OTHER'?'':chargeCategories.find(([v])=>v===c.category)[1];if(newCharges.has(c.id)&&!pricingOverrides.has(c.id))c.treatment=['SETUP','TOOLING'].includes(c.category)?'NRE':'BLEND';}if(key==='markupTreatment'&&c.markupTreatment!=='CUSTOM'){c.customMarkupPercent=null;invalidInputs.delete(c.id+':customMarkupPercent');}dirty=true;root.querySelector('.materials-message').textContent=valid?'Unsaved supplemental charge.':'Correct invalid charge amount.';updateSummary(root);return true;}
    function rowHtml(row,source){
      if(row.orderQuantityMode==='AUTO'){const result=view.rows.find(r=>r.quote.index===row.index);row.orderQuantity=row.customerSupplied||result.required===false?null:result.requiredQuantity;}
      const s=source.candidate.rows.find(s=>s.index===row.index),c=view.rows.find(r=>r.quote.index===row.index);
      const status=c.issues.length?'Needs attention':c.required===false?'Reference only':row.customerSupplied?'Customer supplied':'Quoted';
      const cell=(v,cls='')=>'<td class="'+cls+'" title="'+esc(v)+'">'+esc(v)+'</td>';
      let html='<tr class="material-grid-row">'+'<td class="material-find">'+(row.charges?.length?'<button class="material-fee-toggle" data-material-action="toggle-fees" data-index="'+row.index+'" aria-label="'+(collapsedFees.has(row.index)?'Expand':'Collapse')+' supplemental fees for line '+(row.index+1)+'" aria-expanded="'+!collapsedFees.has(row.index)+'">'+(collapsedFees.has(row.index)?'▸':'▾')+'</button>':'')+esc(s.values.lineNumber??row.index+1)+'</td>'+cell(s.values.partNumber,'material-customer-part')+'<td>'+manufacturerSelect(row,s)+'</td>'+cell(s.values.description,'material-description')+cell(s.values.designators)+cell(s.values.quantity,'material-number')+'<td>'+uomControl(row)+'</td><td>'+input(row,'unitPrice','Unit Cost','number')+'</td>'+'<td class="material-number" data-assembly-cost="'+row.index+'">'+decimalCostPreview(s.values.quantity,row.unitPrice,c.required===false||row.customerSupplied)+'</td>'+'<td>'+input(row,'orderQuantity','Order Qty','number')+'<small class="material-order-warning" data-order-warning="'+row.index+'">'+orderWarning(row,c)+'</small></td>'+'<td class="material-number material-total-with-charge"><span data-total-cost="'+row.index+'">'+decimalCostPreview(row.orderQuantity,row.unitPrice,c.required===false||row.customerSupplied,1000000000)+'</span>'+'<button class="material-add-charge" data-material-action="add-charge" data-index="'+row.index+'" aria-label="Add supplemental fee" title="Add supplemental fee" '+(busy||readOnly?'disabled':'')+'>+</button>'+(row.charges?.length?'<small>'+row.charges.length+(row.charges.length===1?' charge':' charges')+'</small>':'')+'</td>'+'<td>'+vendorControl(row)+'</td><td>'+input(row,'vendorPartNumber','Vendor P/N')+'</td><td>'+leadControl(row)+'</td><td class="material-notes-cell">'+evidenceOptions(row)+'<button class="material-row-toggle" data-material-action="details" data-index="'+row.index+'" aria-expanded="'+expanded.has(row.index)+'" aria-label="Details for line '+(row.index+1)+'" title="'+esc(c.issues.join('; ')||status)+'">'+(expanded.has(row.index)?'Hide details':'Details')+'</button></td></tr>';
      if(expanded.has(row.index))html+='<tr class="material-detail-row"><td colspan="15"><div><section><strong>Accepted BOM v'+source.version+' · Find '+esc(s.values.lineNumber??row.index+1)+'</strong><p>Required Qty: '+esc(c.requiredQuantity??'Review Qty / Unit')+' · Component Type: '+esc(s.componentType||'STANDARD_COTS')+'</p><p>Alternates: '+((s.alternates||[]).filter(a=>!a.removedAtUtc).map(a=>esc(a.partNumber)).join(', ')||'—')+'</p><p>Candidate: '+esc(source.candidate.id)+'</p>'+alternateDetails(s)+'<p>Selection sets a quotation basis, not alternate approval. Customer / BOM P/N is unchanged.</p></section><section><label>Customer supplied <input aria-label="Customer supplied for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="customerSupplied" type="checkbox" '+(row.customerSupplied?'checked':'')+' '+(readOnly||busy?'disabled':'')+'></label><p>'+esc(c.issues.join('; ')||status)+'</p></section></div></td></tr>';
      return html+(collapsedFees.has(row.index)?'':chargeRows(row,s.values.lineNumber??row.index+1));
    }
    const evidenceCategories=[['VENDOR_QUOTE','Vendor Quote'],['DATASHEET','Datasheet'],['SPECIFICATION','Specification'],['SUPPORTING_DOCUMENT','Supporting Document'],['OTHER','Other']];
    const evidenceOwner=(row,fee)=>view.plan.candidateId+':'+view.plan.bomVersion+':'+row.index+':'+(fee?.id||'parent');
    function evidenceTarget(){const row=view.plan.rows.find(r=>r.index===evidencePanel?.index);return row&&(evidencePanel.feeId?row.charges?.find(c=>c.id===evidencePanel.feeId):row);}
    function evidenceOptions(row,fee){
      const target=fee||row,e=target.evidence,notes=(e?.notes?.length||0)+(target.notes?1:0),files=(e?.attachments||[]).filter(a=>!a.removed).length;
      const attrs=' data-index="'+row.index+'" data-fee-id="'+esc(fee?.id||'')+'"',id='material-options-'+row.index+'-'+(fee?.id||'parent');
      return '<span class="material-evidence-options"><small>'+(notes?notes+'n ':'')+(files?files+'a':'')+'</small><button data-material-action="evidence-options"'+attrs+' aria-label="Options for line '+(row.index+1)+(fee?' fee '+esc(fee.description):'')+'" aria-haspopup="menu" title="Notes, visuals and files">⋯</button><div class="material-options-menu" popover="auto" id="'+id+'" role="menu">'+[['add-note','Add Note'],['view-notes','View Notes'],['add-visual','Add Visual'],['view-visuals','View Visuals'],['add-file','Add File'],['view-files','View Files']].map(([action,label])=>'<button role="menuitem" data-material-action="evidence-'+action+'"'+attrs+' '+(readOnly&&action.startsWith('add')?'disabled':'')+'>'+label+'</button>').join('')+'</div></span>';
    }
    function renderEvidencePanel(){
      if(!evidencePanel)return '';
      const target=evidenceTarget();if(!target){evidencePanel=null;return '';}
      const e=target.evidence||{notes:[],attachments:[]},kind=evidencePanel.kind,disabled=busy||readOnly?'disabled':'';
      const title=kind==='NOTE'?'Notes':kind==='VISUAL'?'Visuals':'Files';
      let body='';
      if(kind==='NOTE'){
        body=(target.notes?'<article><small>Existing Material note</small><p>'+esc(target.notes)+'</p></article>':'')+e.notes.map(n=>'<article><small>'+esc(n.purpose==='SOURCING_PURCHASING'?'Sourcing / Purchasing':'Internal Quote')+' · '+esc(n.author||'Pending save')+' · '+esc(n.createdAt||'')+'</small><p>'+esc(n.text)+'</p></article>').join('');
        if(!e.notes.length&&!target.notes)body='<p>No notes yet.</p>';
        if(evidencePanel.add&&!readOnly)body+='<label>Purpose<select data-evidence-purpose><option value="SOURCING_PURCHASING">Sourcing / Purchasing</option><option value="INTERNAL_QUOTE">Internal Quote</option></select></label><label>Note<textarea data-evidence-text maxlength="2000" aria-label="Material note" '+disabled+'></textarea></label><button data-material-action="evidence-note-apply" '+disabled+'>Add Note</button>';
      }else{
        const attachments=e.attachments.filter(a=>a.kind===kind&&!a.removed);
        body=attachments.length?attachments.map(a=>{const href=url+'/attachments/'+encodeURIComponent(a.documentId);return '<article class="material-evidence-attachment">'+(kind==='VISUAL'?'<a href="'+href+'" target="_blank" rel="noopener"><img src="'+href+'" alt="'+esc(a.name)+'"></a>':'')+'<div><a href="'+href+'" target="_blank" rel="noopener">View '+esc(a.name)+'</a><small>'+esc(a.category.replaceAll('_',' '))+' · '+esc(a.addedBy)+' · '+esc(a.addedAt)+'</small><small title="SHA-256 '+esc(a.sha256)+'">Verified · '+esc(a.size)+' bytes</small></div>'+(!readOnly?'<button data-material-action="evidence-remove" data-document-id="'+esc(a.documentId)+'" '+disabled+'>Remove</button>':'')+'</article>';}).join(''):'<p>No '+title.toLowerCase()+' yet.</p>';
        if(evidencePanel.add&&!readOnly)body+=(kind==='FILE'?'<label>File type<select data-evidence-category>'+evidenceCategories.map(([v,t])=>'<option value="'+v+'">'+t+'</option>').join('')+'</select></label>':'<p>Paste a screenshot here or choose PNG / JPEG (up to 8 MB).</p>')+'<label>Choose '+(kind==='VISUAL'?'visuals':'files')+'<input type="file" data-evidence-upload multiple accept="'+(kind==='VISUAL'?'image/png,image/jpeg':'.pdf,.xls,.xlsx,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg')+'" '+disabled+'></label>';
      }
      return '<aside class="material-evidence-panel" tabindex="-1" aria-label="Material '+title+'"><div class="material-evidence-heading"><h2>'+title+' · Line '+(evidencePanel.index+1)+(evidencePanel.feeId?' · '+esc(target.description):'')+'</h2><button data-material-action="evidence-close" '+(busy?'disabled':'')+'>Close</button></div><p class="material-evidence-boundary">Internal sourcing / quotation evidence. Save Materials to persist references. Not included in customer quotations.</p>'+body+'</aside>';
    }
    async function uploadEvidence(files){
      if(busy||readOnly||!evidencePanel||evidencePanel.kind==='NOTE')return;
      const selection={...evidencePanel},target=evidenceTarget();if(!target)return;
      const category=mount.querySelector('[data-evidence-category]')?.value||'OTHER';
      busy=true;message='Verifying evidence upload…';draw();
      try{for(const file of files){const form=new window.FormData();form.append('file',file,file.name||'pasted-visual.png');form.append('metadata',JSON.stringify({expectedRevision:view.plan.revision,candidateId:view.plan.candidateId,bomVersion:view.plan.bomVersion,index:selection.index,feeId:selection.feeId||null,kind:selection.kind,category}));
          const response=await window.fetch(url+'/attachments',{method:'POST',credentials:'same-origin',headers:{'X-SIM-Document-Upload':'1'},body:form});const data=await response.json();if(!response.ok)throw new Error(data.message||'Upload failed.');
          (target.evidence??={notes:[],attachments:[]}).attachments.push(data);dirty=true;
        }message='Evidence verified. Save Materials to persist references.';
      }catch(e){message=e.message;}finally{busy=false;draw();}
    }
    async function evidenceAction(action,button,root){
      if(!action.startsWith('evidence-'))return false;
      if(action==='evidence-options'){const panel=root.querySelector('#material-options-'+button.dataset.index+'-'+(button.dataset.feeId||'parent'));panel.showPopover();positionVendor(panel,button);return true;}
      if(action==='evidence-close'){evidencePanel=null;draw();return true;}
      if(action==='evidence-note-apply'&&!readOnly){const text=root.querySelector('[data-evidence-text]').value.trim(),purpose=root.querySelector('[data-evidence-purpose]').value;if(!text){root.querySelector('[data-evidence-text]').focus();return true;}
        const row=view.plan.rows.find(r=>r.index===evidencePanel.index),target=evidenceTarget();(target.evidence??={notes:[],attachments:[]}).notes.push({id:window.crypto.randomUUID(),owner:evidenceOwner(row,evidencePanel.feeId?target:null),purpose,text});dirty=true;message='Unsaved note. Save Materials to persist.';draw();return true;}
      if(action==='evidence-remove'&&!readOnly){const a=evidenceTarget()?.evidence?.attachments.find(a=>a.documentId===button.dataset.documentId);if(a){a.removed=true;dirty=true;message='Attachment removed from working view. Save Materials to persist; completed versions retain their references.';draw();}return true;}
      const kind=action.endsWith('note')||action.endsWith('notes')?'NOTE':action.endsWith('visual')||action.endsWith('visuals')?'VISUAL':'FILE';
      evidencePanel={index:Number(button.dataset.index),feeId:button.dataset.feeId||null,kind,add:action.includes('-add-')&&!readOnly};draw();mount.querySelector('.material-evidence-panel')?.focus();return true;
    }
    function draw(){
      const previousGrid=mount.querySelector('.material-grid-scroll'),left=previousGrid?.scrollLeft||0,top=previousGrid?.scrollTop||0;
      const source=view.rfq.inputs.materials,a=view.rfq.assemblies[0];
      mount.innerHTML='<section class="rfqs-workspace materials-workbench'+(sourcingView?' materials-sourcing':'')+'"><div class="material-toolbar"><button data-material-action="back">← Back to RFQ</button><h1>Material Quotation<span class="material-copy-status" data-material-copy-status role="status" aria-live="polite"></span></h1><div class="material-view-toggle" role="group" aria-label="Materials view"><button data-material-action="full-view" aria-pressed="'+!sourcingView+'">Full View</button><button data-material-action="sourcing-view" aria-pressed="'+sourcingView+'">Sourcing View</button></div><button data-material-action="reset-layout" hidden>Reset Layout</button><button data-material-action="save" '+(busy||readOnly?'disabled':'')+'>Save Materials</button><button data-material-action="complete" '+(busy||readOnly?'disabled':'')+'>Complete Materials Quote</button></div><p class="material-context">'+esc(view.rfq.customer.customerName)+' · '+esc(a.assemblyNumber)+' · Rev '+esc(a.revision)+' · Qty Quoted '+a.quantity+'</p><p class="materials-message" role="status">'+esc(message||'Quote totals update live. Save Materials before leaving.')+'</p><div class="material-grid-scroll"><table class="material-grid"><colgroup>'+columns.map((_,i)=>'<col class="material-col-'+i+'">').join('')+'</colgroup><thead><tr>'+columns.map((h,i)=>'<th scope="col"'+(i===14?' data-status-heading':'')+'>'+ (h)+(i===10?'<small class="material-fee-legend">+ fee</small>':'')+'</th>').join('')+'</tr></thead><tbody>'+view.plan.rows.map(r=>rowHtml(r,source)).join('')+'</tbody></table></div><div class="material-commercial-footer"><span>BOM Material Cost <b data-live-total>'+liveSummary().total+'</b></span><label>Markup <input aria-label="Markup percent" data-markup type="text" inputmode="decimal" value="'+esc(view.plan.markupPercent??0)+'" '+(readOnly||busy?'disabled':'')+'> %</label><span>Material Unit Sale Price <b data-live-sale>'+liveSummary().sale+'</b></span><span>Blended Supplemental Cost <b data-live-blended>'+liveSummary().blended+'</b></span><span>Recurring Material Cost Basis <b data-live-basis>'+liveSummary().basis+'</b></span><span>Separate Flow-Down Charges <b data-live-separate>'+liveSummary().separate+'</b></span><span>Material NRE / One-Time <b data-live-nre>'+liveSummary().nre+'</b></span><span>Longest Lead <b data-live-lead>'+liveSummary().lead+'</b></span></div><div class="material-footer"><small>'+(view.plan.revision?'Saved by '+esc(view.plan.updatedBy)+' · '+esc(view.plan.atUtc):'No saved quotation work yet.')+'</small><details><summary>Quantity / cost basis · USD</summary><p>Qty / Unit is the accepted BOM quantity per assembly. Required Qty = Qty / Unit × RFQ quantity (shown in row details). Ext Cost = Qty / Unit × Unit Cost. Total Cost = Order Qty × Unit Cost. Costs round to cents per line. Customer-supplied and reference-only lines contribute zero.</p><p>Lead Time preserves Stock, Days or Weeks. Longest lead compares calendar days. UoM defaults to EA; no unit conversion is performed. Pricing quantities must use the BOM unit.</p></details><details><summary>Completed versions ('+view.plan.versions.length+')</summary>'+view.plan.versions.map(v=>'<p>v'+v.version+' · $'+money(v.totalCost)+' · '+esc(v.updatedBy)+' · '+esc(v.atUtc)+'</p>').join('')+'</details></div>'+renderEvidencePanel()+'</section>';
      const root=mount.querySelector('.materials-workbench');
      const evidenceDrawer=root.querySelector('.material-evidence-panel');if(evidencePanel&&evidenceDrawer?.style)evidenceDrawer.style.top=Math.max(80,(document.querySelector('.dle-app-header')?.getBoundingClientRect().bottom||0)+8)+'px';
      const grid=root.querySelector('.material-grid-scroll');if(grid){grid.scrollLeft=left;grid.scrollTop=top;grid.onscroll=()=>{for(const panel of root.querySelectorAll('.material-vendor:popover-open,.material-note-panel:popover-open,.material-options-menu:popover-open'))panel.hidePopover();};}
      root.onfocusin=event=>{const t=event.target;if(t.dataset?.field==='unitPrice'){const row=view.plan.rows.find(r=>r.index===Number(t.dataset.row));t.value=row.unitPrice??'';}};
      root.onfocusout=event=>{const t=event.target;if(t.dataset?.field==='unitPrice'&&!invalidInputs.has(t.dataset.row+':unitPrice')&&t.value!=='')t.value=Number(t.value).toFixed(2);const editor=event.target.closest?.('.material-lead');if(editor&&!editor.contains(event.relatedTarget))closeLead(editor);updateSummary(root);};
      root.addEventListener?.('focusin',root.onfocusin);root.addEventListener?.('focusout',root.onfocusout);
      const tableSelection=materialTableSelection(root);
      const columnWidths=materialColumnWidths(root,()=>tableSelection.clear());columnWidths.view(sourcingView);
      root.oncopy=event=>tableSelection.copy(event);
      root.onpointerdown=event=>tableSelection.down(event);root.onpointermove=event=>tableSelection.move(event);root.onpointerup=event=>tableSelection.up(event);root.onpointercancel=event=>tableSelection.cancel(event);root.onlostpointercapture=event=>tableSelection.cancel(event);
      root.onkeydown=event=>{if(tableSelection.key(event))return;const editor=event.target.closest?.('.material-lead');if(!editor)return;if(event.key==='Escape'){event.preventDefault();closeLead(editor,true);updateSummary(root);}else if(event.key==='Enter'){event.preventDefault();if(!invalidInputs.has(Number(editor.querySelector('select').dataset.row)+':leadTime'))closeLead(editor);else editor.querySelector('input').reportValidity();}};
      root.onpaste=event=>{if(evidencePanel?.kind==='VISUAL'&&!busy&&!readOnly&&event.target.closest?.('.material-evidence-panel')){const files=[...(event.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();uploadEvidence(files);}}};
      root.onchange=event=>{
        if(event.target.dataset.evidenceUpload!==undefined){uploadEvidence([...event.target.files]);return;}
        const t=event.target;if(t.dataset.chargeField!==undefined){if(!readOnly){editCharge(t,root);if(['markupTreatment','category'].includes(t.dataset.chargeField))draw();}return;}if(t.dataset.mfgSelection===undefined||readOnly)return;
        const index=Number(t.dataset.mfgSelection),row=view.plan.rows.find(r=>r.index===index),source=view.rfq.inputs.materials.candidate.rows.find(r=>r.index===index);
        if(t.value==='manual'){manualRows.add(index);expanded.add(index);draw();return;}
        if(t.value==='saved')return;
        manualRows.delete(index);
        const alternatives=confirmedParts(source);
        if(t.value==='')row.mfgPartNumber=null;
        else {const alternative=alternatives[Number(t.value.split(':')[1])];if(!alternative)return;row.mfgPartNumber=alternative;row.mfgPartNumberSource='CONFIRMED_ACCEPTED_BOM';}
        dirty=true;message='Unsaved quotation-basis selection. Customer / BOM P/N is unchanged.';draw();
      };
      root.oninput=event=>{
        const t=event.target;if(readOnly)return;if(editCharge(t,root))return;if(t.dataset.markup!==undefined){const valid=/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t.value)&&Number(t.value)<=10000;valid?invalidInputs.delete('markup'):invalidInputs.add('markup');t.setCustomValidity(valid?'':'Enter a markup from 0 to 10000 percent.');if(valid)view.plan.markupPercent=t.value.startsWith('.')?'0'+t.value:t.value;dirty=true;root.querySelector('.materials-message').textContent=valid?'Unsaved markup.':'Correct markup before saving.';updateSummary(root);return;}if(t.dataset.newVendor!==undefined){t.setCustomValidity('');return;}if(t.dataset.vendorSearch!==undefined){for(const option of t.closest('.material-vendor').querySelectorAll('[data-vendor-option]'))option.hidden=!option.dataset.vendorOption.includes(t.value.trim().toLowerCase());return;}if(!t.dataset.field)return;
        const row=view.plan.rows.find(r=>r.index===Number(t.dataset.row));
        if(t.dataset.field==='leadTimeMode'||t.dataset.field==='leadTimeValue'){
          const container=t.closest('.material-lead'),modeInput=container.querySelector('select'),valueInput=container.querySelector('input');
          row.leadTimeMode=modeInput.value||null;row.leadDays=null;
          if(!row.leadTimeMode||row.leadTimeMode==='STOCK')valueInput.value='';
          valueInput.hidden=row.leadTimeMode==='STOCK'||!row.leadTimeMode;
          const invalid=!!row.leadTimeMode&&row.leadTimeMode!=='STOCK'&&(!/^[0-9]+$/.test(valueInput.value)||Number(valueInput.value)<=0||Number(valueInput.value)>36500||valueInput.validity?.badInput);
          row.leadTimeValue=!row.leadTimeMode||row.leadTimeMode==='STOCK'?null:invalid?null:Number(valueInput.value);
          const key=row.index+':leadTime';invalid?invalidInputs.add(key):invalidInputs.delete(key);
          valueInput.setCustomValidity(invalid?'Enter a positive whole number up to 36500.':'');
          container.querySelector('summary').textContent=container.querySelector('small').textContent=!row.leadTimeMode?'—':row.leadTimeMode==='STOCK'?'Stock':invalid?'':row.leadTimeValue+(row.leadTimeMode==='DAYS'?' Days':' Weeks');
          dirty=true;root.querySelector('.materials-message').textContent=invalid?'Enter a positive whole-number lead time.':'Unsaved changes.';if(!row.leadTimeMode||row.leadTimeMode==='STOCK'){container.open=false;leadBefore.delete(row.index);}updateSummary(root);return;
        }
        let invalid=false;
        if(t.dataset?.field==='unitPrice'||t.dataset.field==='orderQuantity'){
          invalid=t.validity?.badInput||(t.value!==''&&(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t.value)||!Number.isFinite(Number(t.value))||Number(t.value)>1000000000||(t.dataset.field==='orderQuantity'&&Number(t.value)<=0)));
          const key=row.index+':'+t.dataset.field;
          invalid?invalidInputs.add(key):invalidInputs.delete(key);
          t.setCustomValidity?.(invalid?'Enter a valid decimal: Unit Price must be nonnegative and Order Qty positive, up to 1,000,000,000.':'');
        }
        row[t.dataset.field]=invalid?null:t.type==='checkbox'?t.checked:t.type==='number'?(t.value===''?null:Number(t.value)):t.value;
        const source=view.rfq.inputs.materials.candidate.rows.find(s=>s.index===row.index),computed=view.rows.find(r=>r.quote.index===row.index);
        if(t.dataset.field==='orderQuantity')row.orderQuantityMode='MANUAL';
        if(t.dataset.field==='customerSupplied'&&row.orderQuantityMode==='AUTO'){row.orderQuantity=row.customerSupplied||computed.required===false?null:computed.requiredQuantity;const qty=root.querySelector('[data-row="'+row.index+'"][data-field="orderQuantity"]');if(qty)qty.value=row.orderQuantity??'';}
        const warning=root.querySelector('[data-order-warning="'+row.index+'"]');if(warning)warning.textContent=orderWarning(row,computed);
        const excluded=computed.required===false||row.customerSupplied;
        root.querySelector('[data-assembly-cost="'+row.index+'"]').textContent=decimalCostPreview(source.values.quantity,row.unitPrice,excluded);
        root.querySelector('[data-total-cost="'+row.index+'"]').textContent=decimalCostPreview(row.orderQuantity,row.unitPrice,excluded,1000000000);
        if(t.dataset.field==='mfgPartNumber'){row.mfgPartNumberSource='MANUAL_QUOTE_ONLY';const status=root.querySelector('[data-mfg-status="'+row.index+'"]');if(status)status.textContent=row.mfgPartNumber?'Not Approved · Quote Only':'';const label=root.querySelector('[data-mfg-value="'+row.index+'"]');if(label)label.textContent=row.mfgPartNumber||'Not resolved';}
        if(t.dataset.field==='vendor'){row.vendorSource='MANUAL_QUOTE_ONLY';row.customerSupplied=false;const status=root.querySelector('[data-vendor-status="'+row.index+'"]');if(status)status.textContent=row.vendor?'Not Approved · Quote Only':'';}
        if(t.dataset.field==='notes'){const icon=root.querySelector('[data-material-action="note-open"][data-index="'+row.index+'"]');if(icon){icon.textContent=row.notes?'▣':'+';icon.setAttribute?.('aria-label',(row.notes?'Edit':'Add')+' note for line '+(row.index+1));icon.title=row.notes?'Edit note':'Add note';}}
        for(const peer of root.querySelectorAll?.('[data-row="'+row.index+'"][data-field="'+t.dataset.field+'"]')||[])if(peer!==t)peer.value=t.value;
        dirty=true;message=invalidInputs.size?'Correct invalid price, quantity, lead time or markup before saving.':'Unsaved changes. Quote totals update live; save to validate and persist.';root.querySelector('.materials-message').textContent=message;updateSummary(root);
      };
      root.onclick=async event=>{event.stopPropagation();if(tableSelection.click(event))return;const cell=event.target.closest?.('td'),opening=cell?.querySelector?.('.material-lead');if(opening&&!opening.open&&event.target.closest?.('summary')){event.preventDefault();const index=Number(opening.querySelector('select').dataset.row),row=view.plan.rows.find(r=>r.index===index);leadBefore.set(index,{leadTimeMode:row.leadTimeMode,leadTimeValue:row.leadTimeValue,leadDays:row.leadDays});opening.open=true;opening.querySelector('select').focus();}for(const editor of root.querySelectorAll?.('.material-lead[open]')||[]){if(!editor.contains(event.target))closeLead(editor);}const button=event.target.closest('button'),action=button?.dataset.materialAction;if(!action||busy)return;
        if(action.startsWith('evidence-')){await evidenceAction(action,button,root);return;}
        if(action==='reset-layout'){columnWidths.reset();return;}
        if(action==='full-view'||action==='sourcing-view'){tableSelection.clear();for(const panel of root.querySelectorAll?.('.material-vendor:popover-open')||[])panel.hidePopover();sourcingView=action==='sourcing-view';root.classList.toggle('materials-sourcing',sourcingView);columnWidths.view(sourcingView);root.querySelector('[data-material-action="full-view"]').setAttribute('aria-pressed',String(!sourcingView));root.querySelector('[data-material-action="sourcing-view"]').setAttribute('aria-pressed',String(sourcingView));return;}
        if(action==='toggle-fees'){const index=Number(button.dataset.index);collapsedFees.has(index)?collapsedFees.delete(index):collapsedFees.add(index);draw();return;}
        if(action==='add-charge'&&!readOnly){const row=view.plan.rows.find(r=>r.index===Number(button.dataset.index));const id=window.crypto.randomUUID();newCharges.add(id);(row.charges??=[]).push({id,description:'Tariff / Duty',category:'TARIFF',quantity:1,rawCost:null,treatment:'BLEND',markupTreatment:'MATERIAL',customMarkupPercent:null,notes:''});collapsedFees.delete(row.index);dirty=true;draw();mount.querySelector('.materials-workbench').querySelector('[data-charge="'+id+'"][data-charge-field="category"]')?.focus();return;}
        if(action==='remove-charge'&&!readOnly){const row=view.plan.rows.find(r=>r.index===Number(button.dataset.index));row.charges=row.charges.filter(c=>c.id!==button.dataset.chargeId);for(const key of [...invalidInputs])if(key.startsWith(button.dataset.chargeId+':'))invalidInputs.delete(key);dirty=true;draw();return;}
        if(action==='vendor-open'&&!readOnly){const row=view.plan.rows.find(r=>r.index===Number(button.dataset.index)),panel=root.querySelector('[data-vendor-panel="'+row.index+'"]');panel.innerHTML=vendorList(row);panel.showPopover();positionVendor(panel,button);panel.querySelector('input').focus();return;}
        if(action==='vendor-cancel'){button.closest('.material-vendor').hidePopover();return;}
        if(action==='vendor-choice'&&!readOnly){const index=Number(button.dataset.index),row=view.plan.rows.find(r=>r.index===index),choice=button.dataset.vendor;if(choice==='manual'){const panel=button.closest('.material-vendor');panel.innerHTML='<label>Vendor name<input maxlength="200" aria-label="New Vendor for line '+(index+1)+'" data-new-vendor></label><button data-material-action="vendor-use" data-index="'+index+'">Use for Quote</button><button data-material-action="vendor-cancel">Cancel</button>';positionVendor(panel,root.querySelector('[data-material-action="vendor-open"][data-index="'+index+'"]'));panel.querySelector('input').focus();return;}row.customerSupplied=choice==='customer';row.vendor=row.customerSupplied?'':choice;row.vendorSource=simVendors.includes(choice)?'SIM_LIST':null;dirty=true;message='Unsaved vendor selection.';draw();return;}
        if(action==='vendor-use'&&!readOnly){const panel=button.closest('.material-vendor'),field=panel.querySelector('[data-new-vendor]'),name=field.value.trim();if(!name){field.setCustomValidity('Enter a vendor name.');field.reportValidity();return;}const row=view.plan.rows.find(r=>r.index===Number(button.dataset.index));row.vendor=name;row.vendorSource='MANUAL_QUOTE_ONLY';row.customerSupplied=false;dirty=true;message='Unsaved quote-only vendor.';draw();return;}
        if(action==='confirmed-mfg'&&!readOnly){const i=Number(button.dataset.index),row=view.plan.rows.find(r=>r.index===i),part=confirmedParts(view.rfq.inputs.materials.candidate.rows.find(r=>r.index===i))[Number(button.dataset.choice)];if(!part)return;row.mfgPartNumber=part;row.mfgPartNumberSource='CONFIRMED_ACCEPTED_BOM';manualRows.delete(i);dirty=true;draw();return;}
        if(action==='done-mfg'){manualRows.delete(Number(button.dataset.index));draw();return;}
        if(action==='manual-mfg'&&!readOnly){const i=Number(button.dataset.index);manualRows.add(i);draw();return;}
        if(action==='details'){const i=Number(button.dataset.index);expanded.has(i)?expanded.delete(i):expanded.add(i);draw();return;}
        if(action==='back'){if(dirty&&!window.confirm('Leave without saving these quotation edits?'))return;await back();return;}
        if((action==='save'||action==='complete')&&!readOnly){if(invalidInputs.size){message='Correct invalid price, quantity or lead time values before saving.';root.querySelector('.materials-message').textContent=message;return;}const completedBefore=view.plan.versions.length;busy=true;message='Saving…';draw();try{view=await fetchView({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({chargeContractVersion:2,evidenceContractVersion:1,expectedRevision:view.plan.revision,rows:view.plan.rows,markupPercent:Number(view.plan.markupPercent??0),complete:action==='complete'})});dirty=false;message=action==='complete'?(view.plan.versions.length===completedBefore?'Materials quotation complete. Content unchanged; existing completed version retained.':'Materials quotation complete. A durable version was saved.'):'Material quotation saved.';}catch(e){message=e.message;}finally{busy=false;draw();}}
      };
    }
    draw();
  }
  window.DleMaterialsWorkbench=Object.freeze({open});
})(window,document);

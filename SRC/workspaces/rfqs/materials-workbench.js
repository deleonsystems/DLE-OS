(function(window,document){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const columns=['Find #','Customer / BOM P/N','MFG / Approved P/N','Description','Ref Des','Qty / Unit','UoM','Unit Cost','Ext Cost','Order Qty','Total Cost','Vendor','Vendor P/N','Lead Time','Notes'];
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
  let sourcingView=false; // Page-session preference; quotation state is shared between views.
  async function open(mount,rfq,back){
    let view,dirty=false,busy=false,message='';
    const expanded=new Set();
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
      return {total:currency(cents),sale,lead:longest?.label||'—'};
    }
    function updateSummary(root){const values=liveSummary();for(const key of ['total','sale','lead']){const target=root.querySelector('[data-live-'+key+']');if(target)target.textContent=values[key];}}
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
      const icon='<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
      return '<div class="material-mfg"><span class="material-mfg-value" data-mfg-value="'+row.index+'">'+esc(row.mfgPartNumber||'Not resolved')+'</span>'+(row.mfgPartNumber?'<button class="material-mfg-icon" title="Copy" data-material-action="copy-mfg" data-index="'+row.index+'" aria-label="Copy MFG P/N for line '+(row.index+1)+'">'+icon+'</button>':'')+(!readOnly?'<details class="material-mfg-menu"><summary title="Choose quotation P/N" aria-label="Choose quotation P/N for line '+(row.index+1)+'">▾</summary><div>'+parts.map((part,i)=>'<button data-material-action="confirmed-mfg" data-index="'+row.index+'" data-choice="'+i+'" '+disabled+'>'+ (approved&&part===row.mfgPartNumber?'✓ ':'')+esc(part)+' <small>Approved</small></button>').join('')+'<button data-material-action="manual-mfg" data-index="'+row.index+'" '+disabled+'>Manual Entry…</button></div></details>':'')+'</div><small class="material-mfg-status" data-mfg-status="'+row.index+'">'+(row.mfgPartNumber&&!approved?'Not Approved · Quote Only':'')+'</small>'+(manualRows.has(row.index)?'<div class="material-mfg-entry">'+input(row,'mfgPartNumber','Manual MFG / Approved P/N')+'<button data-material-action="done-mfg" data-index="'+row.index+'">Done</button></div>':'');
    }
    function alternateDetails(source){
      return '<details><summary>Available alternates and provenance</summary>'+((source.alternates||[]).map(a=>'<p><strong>'+esc(a.partNumber)+'</strong> · '+esc(a.removedAtUtc?'Removed':a.reviewStatus||'Review status not recorded')+' · '+esc(a.origin||'Origin not recorded')+'</p><p>'+esc(a.uncertainty||'')+'</p><pre>'+esc(JSON.stringify({sourceEvidence:a.sourceEvidence,sourceContext:a.sourceContext,supportingEvidence:a.supportingEvidence,approvalEvidence:a.approvalEvidence,history:a.history},null,2))+'</pre>').join('')||'<p>No structured alternates recorded.</p>')+'</details>';
    }
    function rowHtml(row,source){
      if(row.orderQuantityMode==='AUTO'){const result=view.rows.find(r=>r.quote.index===row.index);row.orderQuantity=row.customerSupplied||result.required===false?null:result.requiredQuantity;}
      const s=source.candidate.rows.find(s=>s.index===row.index),c=view.rows.find(r=>r.quote.index===row.index);
      const status=c.issues.length?'Needs attention':c.required===false?'Reference only':row.customerSupplied?'Customer supplied':'Quoted';
      const cell=(v,cls='')=>'<td class="'+cls+'" title="'+esc(v)+'">'+esc(v)+'</td>';
      let html='<tr class="material-grid-row">'+cell(s.values.lineNumber??row.index+1,'material-find')+cell(s.values.partNumber,'material-customer-part')+'<td>'+manufacturerSelect(row,s)+'</td>'+cell(s.values.description,'material-description')+cell(s.values.designators)+cell(s.values.quantity,'material-number')+'<td>'+uomControl(row)+'</td><td>'+input(row,'unitPrice','Unit Cost','number')+'</td>'+'<td class="material-number" data-assembly-cost="'+row.index+'">'+decimalCostPreview(s.values.quantity,row.unitPrice,c.required===false||row.customerSupplied)+'</td>'+'<td>'+input(row,'orderQuantity','Order Qty','number')+'<small class="material-order-warning" data-order-warning="'+row.index+'">'+orderWarning(row,c)+'</small></td>'+'<td class="material-number" data-total-cost="'+row.index+'">'+decimalCostPreview(row.orderQuantity,row.unitPrice,c.required===false||row.customerSupplied,1000000000)+'</td>'+'<td>'+vendorControl(row)+'</td><td>'+input(row,'vendorPartNumber','Vendor P/N')+'</td><td>'+leadControl(row)+'</td><td class="material-notes-cell"><button class="material-note-icon" data-material-action="note-open" data-index="'+row.index+'" aria-label="'+(row.notes?'Edit':'Add')+' note for line '+(row.index+1)+'" title="'+(row.notes?'Edit note':'Add note')+'">'+(row.notes?'▣':'+')+'</button><div class="material-note-panel" popover="auto" data-note-panel="'+row.index+'"></div>'+input(row,'notes','Notes')+'<button class="material-row-toggle" data-material-action="details" data-index="'+row.index+'" aria-expanded="'+expanded.has(row.index)+'" aria-label="Details for line '+(row.index+1)+'" title="'+esc(c.issues.join('; ')||status)+'">'+(expanded.has(row.index)?'Hide details':'Details')+'</button></td></tr>';
      if(expanded.has(row.index))html+='<tr class="material-detail-row"><td colspan="15"><div><section><strong>Accepted BOM v'+source.version+' · Find '+esc(s.values.lineNumber??row.index+1)+'</strong><p>Required Qty: '+esc(c.requiredQuantity??'Review Qty / Unit')+' · Component Type: '+esc(s.componentType||'STANDARD_COTS')+'</p><p>Alternates: '+((s.alternates||[]).filter(a=>!a.removedAtUtc).map(a=>esc(a.partNumber)).join(', ')||'—')+'</p><p>Candidate: '+esc(source.candidate.id)+'</p>'+alternateDetails(s)+'<p>Selection sets a quotation basis, not alternate approval. Customer / BOM P/N is unchanged.</p></section><section><label>Customer supplied <input aria-label="Customer supplied for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="customerSupplied" type="checkbox" '+(row.customerSupplied?'checked':'')+' '+(readOnly||busy?'disabled':'')+'></label><p>'+esc(c.issues.join('; ')||status)+'</p></section><label>Notes<textarea aria-label="Notes for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="notes" '+(readOnly||busy?'disabled':'')+'>'+esc(row.notes)+'</textarea></label></div></td></tr>';
      return html;
    }
    function draw(){
      const previousGrid=mount.querySelector('.material-grid-scroll'),left=previousGrid?.scrollLeft||0,top=previousGrid?.scrollTop||0;
      const source=view.rfq.inputs.materials,a=view.rfq.assemblies[0];
      mount.innerHTML='<section class="rfqs-workspace materials-workbench'+(sourcingView?' materials-sourcing':'')+'"><div class="material-toolbar"><button data-material-action="back">← Back to RFQ</button><h1>Material Quotation</h1><div class="material-view-toggle" role="group" aria-label="Materials view"><button data-material-action="full-view" aria-pressed="'+!sourcingView+'">Full View</button><button data-material-action="sourcing-view" aria-pressed="'+sourcingView+'">Sourcing View</button></div><button data-material-action="save" '+(busy||readOnly?'disabled':'')+'>Save Materials</button><button data-material-action="complete" '+(busy||readOnly?'disabled':'')+'>Complete Materials Quote</button></div><p class="material-context">'+esc(view.rfq.customer.customerName)+' · '+esc(a.assemblyNumber)+' · Rev '+esc(a.revision)+' · Qty Quoted '+a.quantity+'</p><p class="materials-message" role="status">'+esc(message||'Quote totals update live. Save Materials before leaving.')+'</p><div class="material-grid-scroll"><table class="material-grid"><colgroup>'+columns.map((_,i)=>'<col class="material-col-'+i+'">').join('')+'</colgroup><thead><tr>'+columns.map((h,i)=>'<th scope="col"'+(i===14?' data-status-heading':'')+'>'+ (h)+'</th>').join('')+'</tr></thead><tbody>'+view.plan.rows.map(r=>rowHtml(r,source)).join('')+'</tbody></table></div><div class="material-commercial-footer"><span>Total Material Cost <b data-live-total>'+liveSummary().total+'</b></span><label>Markup <input aria-label="Markup percent" data-markup type="text" inputmode="decimal" value="'+esc(view.plan.markupPercent??0)+'" '+(readOnly||busy?'disabled':'')+'> %</label><span>Material Unit Sale Price <b data-live-sale>'+liveSummary().sale+'</b></span><span>Longest Lead <b data-live-lead>'+liveSummary().lead+'</b></span></div><div class="material-footer"><small>'+(view.plan.revision?'Saved by '+esc(view.plan.updatedBy)+' · '+esc(view.plan.atUtc):'No saved quotation work yet.')+'</small><details><summary>Quantity / cost basis · USD</summary><p>Qty / Unit is the accepted BOM quantity per assembly. Required Qty = Qty / Unit × RFQ quantity (shown in row details). Ext Cost = Qty / Unit × Unit Cost. Total Cost = Order Qty × Unit Cost. Costs round to cents per line. Customer-supplied and reference-only lines contribute zero.</p><p>Lead Time preserves Stock, Days or Weeks. Longest lead compares calendar days. UoM defaults to EA; no unit conversion is performed. Pricing quantities must use the BOM unit.</p></details><details><summary>Completed versions ('+view.plan.versions.length+')</summary>'+view.plan.versions.map(v=>'<p>v'+v.version+' · $'+money(v.totalCost)+' · '+esc(v.updatedBy)+' · '+esc(v.atUtc)+'</p>').join('')+'</details></div></section>';
      const root=mount.querySelector('.materials-workbench');
      const grid=root.querySelector('.material-grid-scroll');if(grid){grid.scrollLeft=left;grid.scrollTop=top;grid.onscroll=()=>{for(const panel of root.querySelectorAll('.material-vendor:popover-open,.material-note-panel:popover-open'))panel.hidePopover();};}
      root.onfocusin=event=>{const t=event.target;if(t.dataset?.field==='unitPrice'){const row=view.plan.rows.find(r=>r.index===Number(t.dataset.row));t.value=row.unitPrice??'';}};
      root.onfocusout=event=>{const t=event.target;if(t.dataset?.field==='unitPrice'&&!invalidInputs.has(t.dataset.row+':unitPrice')&&t.value!=='')t.value=Number(t.value).toFixed(2);const editor=event.target.closest?.('.material-lead');if(editor&&!editor.contains(event.relatedTarget))closeLead(editor);updateSummary(root);};
      root.addEventListener?.('focusin',root.onfocusin);root.addEventListener?.('focusout',root.onfocusout);
      root.onkeydown=event=>{const editor=event.target.closest?.('.material-lead');if(!editor)return;if(event.key==='Escape'){event.preventDefault();closeLead(editor,true);updateSummary(root);}else if(event.key==='Enter'){event.preventDefault();if(!invalidInputs.has(Number(editor.querySelector('select').dataset.row)+':leadTime'))closeLead(editor);else editor.querySelector('input').reportValidity();}};
      root.onchange=event=>{
        const t=event.target;if(t.dataset.mfgSelection===undefined||readOnly)return;
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
        const t=event.target;if(readOnly)return;if(t.dataset.markup!==undefined){const valid=/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t.value)&&Number(t.value)<=10000;valid?invalidInputs.delete('markup'):invalidInputs.add('markup');t.setCustomValidity(valid?'':'Enter a markup from 0 to 10000 percent.');if(valid)view.plan.markupPercent=t.value.startsWith('.')?'0'+t.value:t.value;dirty=true;root.querySelector('.materials-message').textContent=valid?'Unsaved markup.':'Correct markup before saving.';updateSummary(root);return;}if(t.dataset.newVendor!==undefined){t.setCustomValidity('');return;}if(t.dataset.vendorSearch!==undefined){for(const option of t.closest('.material-vendor').querySelectorAll('[data-vendor-option]'))option.hidden=!option.dataset.vendorOption.includes(t.value.trim().toLowerCase());return;}if(!t.dataset.field)return;
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
        if(t.dataset.field==='mfgPartNumber'){row.mfgPartNumberSource='MANUAL_QUOTE_ONLY';const status=root.querySelector('[data-mfg-status="'+row.index+'"]');if(status)status.textContent=row.mfgPartNumber?'Not Approved · Quote Only':'';const label=root.querySelector('[data-mfg-value="'+row.index+'"]');if(label)label.textContent=row.mfgPartNumber||'Not resolved';const copy=root.querySelector('[data-material-action="copy-mfg"][data-index="'+row.index+'"]');if(copy)copy.disabled=!row.mfgPartNumber;}
        if(t.dataset.field==='vendor'){row.vendorSource='MANUAL_QUOTE_ONLY';row.customerSupplied=false;const status=root.querySelector('[data-vendor-status="'+row.index+'"]');if(status)status.textContent=row.vendor?'Not Approved · Quote Only':'';}
        if(t.dataset.field==='notes'){const icon=root.querySelector('[data-material-action="note-open"][data-index="'+row.index+'"]');if(icon){icon.textContent=row.notes?'▣':'+';icon.setAttribute?.('aria-label',(row.notes?'Edit':'Add')+' note for line '+(row.index+1));icon.title=row.notes?'Edit note':'Add note';}}
        for(const peer of root.querySelectorAll?.('[data-row="'+row.index+'"][data-field="'+t.dataset.field+'"]')||[])if(peer!==t)peer.value=t.value;
        dirty=true;message=invalidInputs.size?'Correct invalid price, quantity, lead time or markup before saving.':'Unsaved changes. Quote totals update live; save to validate and persist.';root.querySelector('.materials-message').textContent=message;updateSummary(root);
      };
      root.onclick=async event=>{event.stopPropagation();const cell=event.target.closest?.('td'),opening=cell?.querySelector?.('.material-lead');if(opening&&!opening.open&&!event.target.closest?.('select,input')){event.preventDefault();const index=Number(opening.querySelector('select').dataset.row),row=view.plan.rows.find(r=>r.index===index);leadBefore.set(index,{leadTimeMode:row.leadTimeMode,leadTimeValue:row.leadTimeValue,leadDays:row.leadDays});opening.open=true;opening.querySelector('select').focus();}for(const editor of root.querySelectorAll?.('.material-lead[open]')||[]){if(!editor.contains(event.target))closeLead(editor);}const button=event.target.closest('button'),action=button?.dataset.materialAction;if(!action||busy)return;
        if(action==='full-view'||action==='sourcing-view'){for(const panel of root.querySelectorAll?.('.material-vendor:popover-open')||[])panel.hidePopover();sourcingView=action==='sourcing-view';root.classList.toggle('materials-sourcing',sourcingView);root.querySelector('[data-material-action="full-view"]').setAttribute('aria-pressed',String(!sourcingView));root.querySelector('[data-material-action="sourcing-view"]').setAttribute('aria-pressed',String(sourcingView));root.querySelector('[data-status-heading]').textContent='Notes';return;}
        if(action==='note-open'){const row=view.plan.rows.find(r=>r.index===Number(button.dataset.index)),panel=root.querySelector('[data-note-panel="'+row.index+'"]');panel.innerHTML='<label>Note<textarea aria-label="Note draft for line '+(row.index+1)+'" maxlength="4000" '+(readOnly?'readonly':'')+'>'+esc(row.notes)+'</textarea></label>'+(!readOnly?'<button data-material-action="note-apply" data-index="'+row.index+'">Apply</button>':'')+'<button data-material-action="note-cancel">Cancel</button>';panel.showPopover();positionVendor(panel,button);panel.querySelector('textarea').focus();return;}
        if(action==='note-cancel'){button.closest('.material-note-panel').hidePopover();return;}
        if(action==='note-apply'&&!readOnly){const row=view.plan.rows.find(r=>r.index===Number(button.dataset.index));row.notes=button.closest('.material-note-panel').querySelector('textarea').value;dirty=true;message='Unsaved note. Save Materials to persist.';draw();return;}
        if(action==='vendor-open'&&!readOnly){const row=view.plan.rows.find(r=>r.index===Number(button.dataset.index)),panel=root.querySelector('[data-vendor-panel="'+row.index+'"]');panel.innerHTML=vendorList(row);panel.showPopover();positionVendor(panel,button);panel.querySelector('input').focus();return;}
        if(action==='vendor-cancel'){button.closest('.material-vendor').hidePopover();return;}
        if(action==='vendor-choice'&&!readOnly){const index=Number(button.dataset.index),row=view.plan.rows.find(r=>r.index===index),choice=button.dataset.vendor;if(choice==='manual'){const panel=button.closest('.material-vendor');panel.innerHTML='<label>Vendor name<input maxlength="200" aria-label="New Vendor for line '+(index+1)+'" data-new-vendor></label><button data-material-action="vendor-use" data-index="'+index+'">Use for Quote</button><button data-material-action="vendor-cancel">Cancel</button>';positionVendor(panel,root.querySelector('[data-material-action="vendor-open"][data-index="'+index+'"]'));panel.querySelector('input').focus();return;}row.customerSupplied=choice==='customer';row.vendor=row.customerSupplied?'':choice;row.vendorSource=simVendors.includes(choice)?'SIM_LIST':null;dirty=true;message='Unsaved vendor selection.';draw();return;}
        if(action==='vendor-use'&&!readOnly){const panel=button.closest('.material-vendor'),field=panel.querySelector('[data-new-vendor]'),name=field.value.trim();if(!name){field.setCustomValidity('Enter a vendor name.');field.reportValidity();return;}const row=view.plan.rows.find(r=>r.index===Number(button.dataset.index));row.vendor=name;row.vendorSource='MANUAL_QUOTE_ONLY';row.customerSupplied=false;dirty=true;message='Unsaved quote-only vendor.';draw();return;}
        if(action==='copy-mfg'){const value=view.plan.rows.find(r=>r.index===Number(button.dataset.index))?.mfgPartNumber;if(!value)return;try{await window.navigator.clipboard.writeText(value);message='Part number copied.';}catch{message='Clipboard unavailable. Select and copy the displayed part number.';}root.querySelector('.materials-message').textContent=message;return;}
        if(action==='confirmed-mfg'&&!readOnly){const i=Number(button.dataset.index),row=view.plan.rows.find(r=>r.index===i),part=confirmedParts(view.rfq.inputs.materials.candidate.rows.find(r=>r.index===i))[Number(button.dataset.choice)];if(!part)return;row.mfgPartNumber=part;row.mfgPartNumberSource='CONFIRMED_ACCEPTED_BOM';manualRows.delete(i);dirty=true;draw();return;}
        if(action==='done-mfg'){manualRows.delete(Number(button.dataset.index));draw();return;}
        if(action==='manual-mfg'&&!readOnly){const i=Number(button.dataset.index);manualRows.add(i);draw();return;}
        if(action==='details'){const i=Number(button.dataset.index);expanded.has(i)?expanded.delete(i):expanded.add(i);draw();return;}
        if(action==='back'){if(dirty&&!window.confirm('Leave without saving these quotation edits?'))return;await back();return;}
        if((action==='save'||action==='complete')&&!readOnly){if(invalidInputs.size){message='Correct invalid price, quantity or lead time values before saving.';root.querySelector('.materials-message').textContent=message;return;}busy=true;message='Saving…';draw();try{view=await fetchView({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:view.plan.revision,rows:view.plan.rows,markupPercent:Number(view.plan.markupPercent??0),complete:action==='complete'})});dirty=false;message=action==='complete'?'Materials quotation complete. A durable version was saved.':'Material quotation saved.';}catch(e){message=e.message;}finally{busy=false;draw();}}
      };
    }
    draw();
  }
  window.DleMaterialsWorkbench=Object.freeze({open});
})(window,document);

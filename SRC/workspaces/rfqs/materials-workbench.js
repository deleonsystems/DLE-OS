(function(window,document){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const columns=['Find #','Customer / BOM P/N','MFG / Approved P/N','Description','Ref Des','Qty / Unit','UoM','Unit Cost','Ext Cost','Order Qty','Total Cost','Vendor','Vendor P/N','Lead Time','Status / Notes'];
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
  async function open(mount,rfq,back){
    let view,dirty=false,busy=false,message='';
    const expanded=new Set();
    const manualRows=new Set();
    const invalidInputs=new Set();
    const readOnly=window.DleOsCapabilities?.can?.('technical_review.disposition')!==true;
    const url='/api/sim/rfqs/'+encodeURIComponent(rfq.intakeId)+'/materials';
    async function fetchView(options){const response=await window.fetch(url,{credentials:'include',cache:'no-store',...options});const body=await response.json();if(!response.ok)throw new Error(body.message||'Material Quotation Workspace unavailable');return body;}
    view=await fetchView();
    function input(row,key,label,type='text'){
      return '<input aria-label="'+label+' for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="'+key+'" type="'+type+'" '+(type==='number'?'min="0" step="'+(key==='leadDays'?'1':'any')+'"':'')+' value="'+esc(row[key])+'" '+(invalidInputs.has(row.index+':'+key)?'aria-invalid="true" ':'')+(busy||readOnly?'disabled':'')+'>';
    }
    function manufacturerSelect(row,source){
      const alternatives=(source.alternates||[]).filter(a=>!a.removedAtUtc&&a.partNumber?.trim());
      const match=alternatives.findIndex(a=>a.partNumber===row.mfgPartNumber);
      const selected=manualRows.has(row.index)?'manual':match>=0?'alternate:'+match:row.mfgPartNumber?'saved':'';
      const option=(value,label)=>'<option value="'+value+'" '+(value===selected?'selected':'')+'>'+esc(label)+'</option>';
      return '<select aria-label="MFG / Approved P/N for line '+(row.index+1)+'" data-mfg-selection="'+row.index+'" '+(busy||readOnly?'disabled':'')+'>'+option('','Not resolved')+alternatives.map((a,i)=>option('alternate:'+i,a.partNumber+' — listed alternate')).join('')+(row.mfgPartNumber&&match<0?option('saved',row.mfgPartNumber+' — saved manual entry'):'')+option('manual',manualRows.has(row.index)&&row.mfgPartNumber?row.mfgPartNumber+' — manual entry (edit)':'Enter a different P/N…')+'</select>';
    }
    function alternateDetails(source){
      return '<details><summary>Available alternates and provenance</summary>'+((source.alternates||[]).map(a=>'<p><strong>'+esc(a.partNumber)+'</strong> · '+esc(a.removedAtUtc?'Removed':a.reviewStatus||'Review status not recorded')+' · '+esc(a.origin||'Origin not recorded')+'</p><p>'+esc(a.uncertainty||'')+'</p><pre>'+esc(JSON.stringify({sourceEvidence:a.sourceEvidence,sourceContext:a.sourceContext,supportingEvidence:a.supportingEvidence,approvalEvidence:a.approvalEvidence,history:a.history},null,2))+'</pre>').join('')||'<p>No structured alternates recorded.</p>')+'</details>';
    }
    function rowHtml(row,source){
      const s=source.candidate.rows.find(s=>s.index===row.index),c=view.rows.find(r=>r.quote.index===row.index);
      const status=c.issues.length?'Needs attention':c.required===false?'Reference only':row.customerSupplied?'Customer supplied':'Quoted';
      const cell=(v,cls='')=>'<td class="'+cls+'" title="'+esc(v)+'">'+esc(v)+'</td>';
      let html='<tr class="material-grid-row">'+cell(s.values.lineNumber??row.index+1,'material-find')+cell(s.values.partNumber,'material-customer-part')+'<td>'+manufacturerSelect(row,s)+'</td>'+cell(s.values.description,'material-description')+cell(s.values.designators)+cell(s.values.quantity,'material-number')+'<td>'+input(row,'uom','UoM')+'</td><td>'+input(row,'unitPrice','Unit Cost','number')+'</td>'+'<td class="material-number" data-assembly-cost="'+row.index+'">'+decimalCostPreview(s.values.quantity,row.unitPrice,c.required===false||row.customerSupplied)+'</td>'+'<td>'+input(row,'orderQuantity','Order Qty','number')+'</td>'+'<td class="material-number" data-total-cost="'+row.index+'">'+decimalCostPreview(row.orderQuantity,row.unitPrice,c.required===false||row.customerSupplied,1000000000)+'</td>'+'<td>'+input(row,'vendor','Vendor')+'</td><td>'+input(row,'vendorPartNumber','Vendor P/N')+'</td><td>'+input(row,'leadDays','Lead Time (days)','number')+'</td><td><button class="material-row-toggle" data-material-action="details" data-index="'+row.index+'" aria-expanded="'+expanded.has(row.index)+'" aria-label="Details for line '+(row.index+1)+'" title="'+esc(c.issues.join('; ')||status)+'">'+status+(row.notes?' •':'')+' '+(expanded.has(row.index)?'▾':'▸')+'</button></td></tr>';
      if(expanded.has(row.index))html+='<tr class="material-detail-row"><td colspan="15"><div><section><strong>Accepted BOM v'+source.version+' · Find '+esc(s.values.lineNumber??row.index+1)+'</strong><p>Required Qty: '+esc(c.requiredQuantity??'Review Qty / Unit')+' · Component Type: '+esc(s.componentType||'STANDARD_COTS')+'</p><p>Alternates: '+((s.alternates||[]).filter(a=>!a.removedAtUtc).map(a=>esc(a.partNumber)).join(', ')||'—')+'</p><p>Candidate: '+esc(source.candidate.id)+'</p>'+alternateDetails(s)+'<label>Manual quotation-basis P/N '+input(row,'mfgPartNumber','Manual MFG / Approved P/N')+'</label><p>Selection sets a quotation basis, not alternate approval. Customer / BOM P/N is unchanged.</p></section><section><label>Customer supplied <input aria-label="Customer supplied for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="customerSupplied" type="checkbox" '+(row.customerSupplied?'checked':'')+' '+(readOnly||busy?'disabled':'')+'></label><p>'+esc(c.issues.join('; ')||status)+'</p></section><label>Notes<textarea aria-label="Notes for line '+(row.index+1)+'" data-row="'+row.index+'" data-field="notes" '+(readOnly||busy?'disabled':'')+'>'+esc(row.notes)+'</textarea></label></div></td></tr>';
      return html;
    }
    function draw(){
      const previousGrid=mount.querySelector('.material-grid-scroll'),left=previousGrid?.scrollLeft||0,top=previousGrid?.scrollTop||0;
      const source=view.rfq.inputs.materials,a=view.rfq.assemblies[0];
      mount.innerHTML='<section class="rfqs-workspace materials-workbench"><div class="material-toolbar"><button data-material-action="back">← Back to RFQ</button><h1>Material Quotation Workspace</h1><button data-material-action="save" '+(busy||readOnly?'disabled':'')+'>Save Materials</button><button data-material-action="complete" '+(busy||readOnly?'disabled':'')+'>Complete Materials Quote</button></div><p class="material-context">'+esc(view.rfq.customer.customerName)+' · '+esc(a.assemblyNumber)+' · Rev '+esc(a.revision)+' · RFQ Qty '+a.quantity+' · '+esc(rfq.intakeId)+' · BOM v'+source.version+' · '+esc(view.rfq.lanes.materials.status.replaceAll('_',' '))+'</p><div class="materials-summary"><span>BOM lines <b>'+view.rows.length+'</b></span><span>Quoted <b>'+view.linesQuoted+'</b></span><span>Needs attention <b>'+view.rows.filter(r=>r.issues.length>0).length+'</b></span><span>Material cost <b>$'+money(view.totalCost)+'</b></span><span>Longest lead <b>'+(view.longestLeadDays??'—')+' days</b></span></div><p class="materials-message" role="status">'+esc(message||'Totals and status reflect saved values. Save before leaving.')+'</p><div class="material-grid-scroll"><table class="material-grid"><colgroup>'+columns.map((_,i)=>'<col class="material-col-'+i+'">').join('')+'</colgroup><thead><tr>'+columns.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+view.plan.rows.map(r=>rowHtml(r,source)).join('')+'</tbody></table></div><div class="material-footer"><small>'+(view.plan.revision?'Saved by '+esc(view.plan.updatedBy)+' · '+esc(view.plan.atUtc):'No saved quotation work yet.')+'</small><details><summary>Quantity / cost basis · USD</summary><p>Qty / Unit is the accepted BOM quantity per assembly. Required Qty = Qty / Unit × RFQ quantity (shown in row details). Ext Cost = Qty / Unit × Unit Cost. Total Cost = Order Qty × Unit Cost. Costs round to cents per line. Customer-supplied and reference-only lines contribute zero.</p><p>Lead Time is in calendar days. UoM is optional and starts blank; no unit conversion is performed. Pricing quantities must use the BOM unit.</p></details><details><summary>Completed versions ('+view.plan.versions.length+')</summary>'+view.plan.versions.map(v=>'<p>v'+v.version+' · $'+money(v.totalCost)+' · '+esc(v.updatedBy)+' · '+esc(v.atUtc)+'</p>').join('')+'</details></div></section>';
      const root=mount.querySelector('.materials-workbench');
      const grid=root.querySelector('.material-grid-scroll');if(grid){grid.scrollLeft=left;grid.scrollTop=top;}
      root.onchange=event=>{
        const t=event.target;if(t.dataset.mfgSelection===undefined||readOnly)return;
        const index=Number(t.dataset.mfgSelection),row=view.plan.rows.find(r=>r.index===index),source=view.rfq.inputs.materials.candidate.rows.find(r=>r.index===index);
        if(t.value==='manual'){manualRows.add(index);expanded.add(index);draw();return;}
        if(t.value==='saved')return;
        manualRows.delete(index);
        const alternatives=(source.alternates||[]).filter(a=>!a.removedAtUtc&&a.partNumber?.trim());
        if(t.value==='')row.mfgPartNumber=null;
        else {const alternative=alternatives[Number(t.value.split(':')[1])];if(!alternative)return;row.mfgPartNumber=alternative.partNumber;}
        dirty=true;message='Unsaved quotation-basis selection. Customer / BOM P/N is unchanged.';draw();
      };
      root.oninput=event=>{
        const t=event.target;if(!t.dataset.field||readOnly)return;
        const row=view.plan.rows.find(r=>r.index===Number(t.dataset.row));
        let invalid=false;
        if(t.dataset.field==='unitPrice'||t.dataset.field==='orderQuantity'){
          invalid=t.validity?.badInput||(t.value!==''&&(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t.value)||!Number.isFinite(Number(t.value))||Number(t.value)>1000000000||(t.dataset.field==='orderQuantity'&&Number(t.value)<=0)));
          const key=row.index+':'+t.dataset.field;
          invalid?invalidInputs.add(key):invalidInputs.delete(key);
          t.setCustomValidity?.(invalid?'Enter a valid decimal: Unit Price must be nonnegative and Order Qty positive, up to 1,000,000,000.':'');
        }
        row[t.dataset.field]=invalid?null:t.type==='checkbox'?t.checked:t.type==='number'?(t.value===''?null:Number(t.value)):t.value;
        const source=view.rfq.inputs.materials.candidate.rows.find(s=>s.index===row.index),computed=view.rows.find(r=>r.quote.index===row.index);
        const excluded=computed.required===false||row.customerSupplied;
        root.querySelector('[data-assembly-cost="'+row.index+'"]').textContent=decimalCostPreview(source.values.quantity,row.unitPrice,excluded);
        root.querySelector('[data-total-cost="'+row.index+'"]').textContent=decimalCostPreview(row.orderQuantity,row.unitPrice,excluded,1000000000);
        dirty=true;message=invalidInputs.size?'Correct invalid Unit Price / Order Qty values before saving.':'Unsaved changes. Row costs are live previews; save to update the summary and validation.';root.querySelector('.materials-message').textContent=message;
      };
      root.onclick=async event=>{event.stopPropagation();const button=event.target.closest('button'),action=button?.dataset.materialAction;if(!action||busy)return;
        if(action==='details'){const i=Number(button.dataset.index);expanded.has(i)?expanded.delete(i):expanded.add(i);draw();return;}
        if(action==='back'){if(dirty&&!window.confirm('Leave without saving these quotation edits?'))return;await back();return;}
        if((action==='save'||action==='complete')&&!readOnly){if(invalidInputs.size){message='Correct invalid Unit Price / Order Qty values before saving.';root.querySelector('.materials-message').textContent=message;return;}busy=true;message='Saving…';draw();try{view=await fetchView({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:view.plan.revision,rows:view.plan.rows,complete:action==='complete'})});dirty=false;message=action==='complete'?'Materials quotation complete. A durable version was saved.':'Material quotation saved.';}catch(e){message=e.message;}finally{busy=false;draw();}}
      };
    }
    draw();
  }
  window.DleMaterialsWorkbench=Object.freeze({open});
})(window,document);

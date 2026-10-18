(function(window){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'Unavailable':Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const blank=()=>({delivery:'',outsourced:null,highUnitCost:null,canMeetDelivery:null,riskSeverity:'',riskNotes:'',class:'',itar:null,newContractRequirements:''});
  const leadDisplay=days=>days==null?'Not available':days===0?'Stock':days<7?days+' '+(days===1?'Day':'Days'):Math.ceil(days/7)+' '+(Math.ceil(days/7)===1?'Week':'Weeks');
  function deliveryDefault(a,s){
    a=structuredClone(a);
    if(a.deliveryValue!=null)return a;
    const parsed=/^(\d+)\s+(days?|weeks?)$/i.exec(a.delivery.trim());
    if(parsed){a.deliveryValue=Number(parsed[1]);a.deliveryUnit=/week/i.test(parsed[2])?'WEEKS':'DAYS';}
    else if(!a.delivery.trim()&&s.suggestedLeadDays!=null){a.deliveryValue=s.suggestedLeadDays<7?s.suggestedLeadDays:Math.ceil(s.suggestedLeadDays/7);a.deliveryUnit=s.suggestedLeadDays<7?'DAYS':'WEEKS';a.delivery=a.deliveryValue+' '+(a.deliveryUnit==='DAYS'?'Days':'Weeks');}
    return a;
  }
  function suppliedList(s){return (s.customerSuppliedItems||[]).map(r=>'<li>Find No. '+esc(r.findNo)+' — Internal P/N '+esc(r.internalPartNumber)+'</li>').join('');}
  function materialExtras(s){const t=s.materialSupplemental;return t?.charges?.some(c=>c.treatment!=='BLEND')?'<section><strong>Separate Material Charges / Material NRE</strong>'+t.charges.filter(c=>c.treatment!=='BLEND').map(c=>'<p>'+esc(c.description)+' · '+(c.treatment==='NRE'?'Material NRE':'Separate Charge')+' · '+money(c.sellAmount)+'</p>').join('')+'</section>':'';}
  function quickTurnError(q){
    if(!q)return '';
    const flat=q.mode==='FLAT',text=String(q.value??'');
    return !['LABOR_PERCENT','ORDER_PERCENT','FLAT'].includes(q.mode)||!new RegExp('^(?:\\d+(?:\\.\\d{0,'+(flat?2:6)+'})?|\\.\\d{1,'+(flat?2:6)+'})$').test(text)||Number(text)>(flat?1000000000:10000)?'Enter a nonnegative quick-turn '+(flat?'amount in dollars and cents.':'percentage (up to six decimals).'):'';
  }
  function quickTurnCalc(s,q){
    const cents=v=>{const parts=String(v??0).split('.');return BigInt(parts[0])*100n+BigInt((parts[1]||'').padEnd(2,'0').slice(0,2));};
    const dollars=c=>(c/100n)+'.'+String(c%100n).padStart(2,'0');
    const subtotal=s.total==null?null:cents(s.total)+cents(s.nreTotal)+cents(s.materialSupplemental?.separateCharges)+cents(s.materialSupplemental?.materialNre);
    if(subtotal==null)return {error:'Complete pricing to calculate the quick-turn charge.'};
    if(!q)return {total:dollars(subtotal),amount:'0.00'};
    const error=quickTurnError(q);if(error)return {error};
    if(q.mode==='LABOR_PERCENT'&&s.laborUnitSale==null)return {error:'Complete Labor pricing to calculate the quick-turn charge.'};
    const basis=q.mode==='LABOR_PERCENT'?cents(s.laborUnitSale)*BigInt(s.quantity):subtotal;
    const parts=String(q.value).split('.'),scale=10n**BigInt((parts[1]||'').length),rate=BigInt((parts[0]||'0')+(parts[1]||'')),den=100n*scale;
    const amount=q.mode==='FLAT'?cents(q.value):(basis*rate+den/2n)/den;
    return {basis:dollars(basis),amount:dollars(amount),total:dollars(subtotal+amount)};
  }
  function blockers(a){
    const b=[];if((a.deliveryUnit!=null&&(!/^\d+$/.test(String(a.deliveryValue??''))||Number(a.deliveryValue)>36500||!['DAYS','WEEKS'].includes(a.deliveryUnit)))||!a.delivery.trim())b.push('Enter Quoted Delivery / Lead Time.');
    if(quickTurnError(a.quickTurn))b.push(quickTurnError(a.quickTurn));
    return b;
  }
  async function open(mount,rfq,back){
    const url='/api/sim/rfqs/'+encodeURIComponent(rfq.intakeId)+'/final-review';
    async function request(path='',options={}){const r=await window.fetch(url+path,{credentials:'include',cache:'no-store',...options}),body=await r.json();if(!r.ok)throw new Error(body.message||'Final Review unavailable.');return body;}
    let view=await request(),answers=deliveryDefault(view.approvalCurrent?view.approvals.at(-1).answers:{...blank(),...(view.approvals.length?{delivery:view.approvals.at(-1).answers.delivery,deliveryValue:view.approvals.at(-1).answers.deliveryValue,deliveryUnit:view.approvals.at(-1).answers.deliveryUnit}:{})},view.summary),busy=false,message='',dirty=false,pdfUrl='';
    let commercial=null,commercialError='',pendingSubmit=null;
    async function loadCommercial(){
      try{const r=await window.fetch('/api/sim/rfqs/commercial',{credentials:'include',cache:'no-store'});const body=await r.json();if(!r.ok)throw new Error(body.message||'Submission status unavailable.');commercial=body.items.find(item=>item.intakeId===rfq.intakeId);if(!commercial)throw new Error('Submission status unavailable.');commercialError='';}
      catch(e){commercial=null;commercialError=e.message;}
    }
    await loadCommercial();
    function submission(){
      const latest=view.approvals.at(-1),c=commercial?.commercial;
      const allowed=view.approvalCurrent&&latest&&c&&latest.id!==c.approvalId&&['OPEN','SUBMITTED','EXPIRED'].includes(c.status);
      return '<section class="final-submission" aria-label="Quote submission"><div><strong>'+esc(commercial?.status||'Submission status unavailable')+'</strong><p>'+(!view.approvalCurrent?'Approve the current quote before marking it submitted.':allowed?'Ready to record submission.':c?.approvalId===latest?.id?'This approved quote has already been submitted.':'Submission is unavailable for this commercial status.')+'</p>'+(commercialError?'<p role="alert">'+esc(commercialError)+'</p><button data-action="reload-status">Retry submission status</button>':'')+(readOnly?'<p>Your current role cannot approve or mark quotes submitted.</p>':'')+'</div>'+(allowed?'<button data-action="submit" '+(readOnly||busy?'disabled':'')+'>Mark Approved Quote Submitted</button>':'')+'<small>Mark Submitted records internal status and 30-day validity. It does not email the customer.</small></section>';
    }
    const readOnly=window.DleOsCapabilities?.can?.('technical_review.disposition')!==true;
    function requestAnswers(){return {...answers,...(answers.deliveryValue!=null?{deliveryValue:Number(answers.deliveryValue)}:{}),quickTurn:answers.quickTurn?{mode:answers.quickTurn.mode,value:answers.quickTurn.value==null||answers.quickTurn.value===''?null:Number(answers.quickTurn.value)}:null};}
    function quickTurnFields(disabled){const q=answers.quickTurn;return '<section class="final-quick-turn"><label class="quick-turn-enable"><input type="checkbox" data-quick-enable '+(q?'checked ':'')+disabled+'> Quick-Turn Charge</label>'+(q?'<div class="quick-turn-fields"><label>Apply to<select aria-label="Quick-Turn basis" data-quick-mode '+disabled+'>'+[['LABOR_PERCENT','Labor %'],['ORDER_PERCENT','Whole-order %'],['FLAT','Flat dollars / order']].map(([v,l])=>'<option value="'+v+'" '+(q.mode===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label><label>'+(q.mode==='FLAT'?'Amount ($)':'Percentage (%)')+'<input aria-label="Quick-Turn value" data-quick-value inputmode="decimal" value="'+esc(q.value??'')+'" '+disabled+'></label><span data-quick-result aria-live="polite"></span></div><small>No additional markup. Use Quoted Delivery above for the agreed turnaround.</small>':'')+'</section>';}
    function updateQuickTurn(root){const c=quickTurnCalc(view.summary,answers.quickTurn),result=root.querySelector('[data-quick-result]');if(result&&answers.quickTurn)result.textContent=c.error||((answers.quickTurn.mode==='FLAT'?'Once per order':(answers.quickTurn.mode==='LABOR_PERCENT'?'Labor sale × quantity: ':'Full subtotal: ')+money(c.basis))+' · Added '+money(c.amount));const total=root.querySelector('[data-quote-total]');if(total)total.textContent=c.error&&answers.quickTurn?'Unavailable':money(c.total);}
    function update(){const root=mount.querySelector('.quotation-final-review');const errors=[...view.blockers,...blockers(answers)];root.querySelector('[data-final-blockers]').textContent=view.approvalCurrent?'':errors.join(' ');root.querySelector('[data-action="approve"]').disabled=busy||readOnly||view.approvalCurrent||errors.length>0;root.querySelector('[role="status"]').textContent=message;updateQuickTurn(root);}
    function price(s,delivery){return '<div class="final-price-scroll"><table><thead><tr>'+['Qty','Part Number','Rev','Description','Labor','Materials','Unit Price','Total','Delivery'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody><tr><td>'+s.quantity+'</td><td>'+esc(s.assembly)+'</td><td>'+esc(s.revision)+'</td><td>'+esc(s.description||'Not provided')+'</td>'+[s.laborUnitSale,s.materialUnitSale,s.combinedUnitPrice,s.total].map(v=>'<td>'+money(v)+'</td>').join('')+'<td '+(delivery===undefined?'data-quoted-delivery':'')+'>'+esc(delivery??answers.delivery??'—')+'</td></tr></tbody></table></div>';}
    function draw(){const s=view.summary,disabled=busy||readOnly||view.approvalCurrent?'disabled':'',yn=[['true','Yes'],['false','No']];
      const latest=view.approvals.at(-1);
      const summary='<div class="final-price-scroll"><table class="final-line-table"><thead><tr>'+['Qty','Assembly No.','Rev','Description','Materials / Unit','Labor / Unit','Unit Price'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody><tr><td>'+s.quantity+'</td><td>'+esc(s.assembly)+'</td><td>'+esc(s.revision)+'</td><td class="line-description">'+esc(s.description||'Not provided')+'</td>'+[s.materialUnitSale,s.laborUnitSale,s.combinedUnitPrice].map(v=>'<td>'+money(v)+'</td>').join('')+'</tr></tbody></table></div>';
      const history=view.approvals.length?'<details class="final-history"><summary>'+(view.approvals.length>1?'View History ('+view.approvals.length+')':'Approval details')+'</summary>'+view.approvals.map(a=>'<details><summary>Approved v'+a.version+' · '+esc(a.approvedBy)+' · '+esc(a.approvedAt)+'</summary><p>Materials v'+a.summary.materialsVersion+' · Labor v'+a.summary.laborVersion+' · NRE '+money(a.summary.nreTotal)+'</p>'+price(a.summary,a.answers.delivery)+'<p>Material Lead: '+leadDisplay(a.summary.materialLongestLeadDays)+' · Manufacturing Lead: '+esc(a.summary.manufacturingLead||'Not available')+' · Suggested Lead: '+leadDisplay(a.summary.suggestedLeadDays)+'</p><dl>'+Object.entries(a.answers).filter(([k])=>!['outsourced','highUnitCost','canMeetDelivery','riskSeverity','class','itar','quickTurn'].includes(k)).map(([k,v])=>'<dt>'+esc(({outsourced:'Outsourced Process',highUnitCost:'High Unit Cost',canMeetDelivery:'Can Meet Delivery',riskSeverity:'Risk',riskNotes:'Review Notes / Assumptions',class:'Class',itar:'ITAR',delivery:'Delivery',deliveryValue:'Delivery value',deliveryUnit:'Delivery unit',newContractRequirements:'New Contract Requirements'})[k])+'</dt><dd>'+esc(typeof v==='boolean'?(v?'Yes':'No'):v||'—')+'</dd>').join('')+'</dl></details>').join('')+'</details>':'';
      mount.innerHTML='<section class="rfqs-workspace quotation-final-review"><header><button data-action="back">← Back to RFQ</button><h1>Quotation Final Review</h1></header><p role="status"></p><p data-final-blockers aria-live="polite"></p><div class="final-context"><strong>Customer: '+esc(s.customer)+'</strong><span>Quote No: '+esc(commercial?.quoteNumber||s.intakeId)+'</span></div><section class="final-quote-line" data-assembly="'+esc(s.assembly)+'"><h2>Quote Line 1</h2>'+summary+'<div class="final-delivery"><span>Material Lead<b>'+leadDisplay(s.materialLongestLeadDays)+'</b></span><span>Manufacturing Lead<b>'+esc(s.manufacturingLead||'Not available')+'</b></span><span>Suggested Lead<b>'+leadDisplay(s.suggestedLeadDays)+'</b></span><label>Quoted Delivery<div class="final-delivery-controls"><input aria-label="Quoted Delivery value" inputmode="numeric" data-answer="deliveryValue" value="'+esc(answers.deliveryValue??'')+'" '+disabled+'><select aria-label="Quoted Delivery unit" data-answer="deliveryUnit" '+disabled+'><option value="DAYS" '+(answers.deliveryUnit==='DAYS'?'selected':'')+'>Days</option><option value="WEEKS" '+(answers.deliveryUnit!=='DAYS'?'selected':'')+'>Weeks</option></select></div>'+(answers.deliveryValue==null&&answers.delivery?'<small>Preserved delivery: '+esc(answers.delivery)+'</small>':'')+'</label></div><div class="final-supplied">Customer Supplied Material: <strong>'+(s.customerSuppliedMaterial==null?'Not available':s.customerSuppliedMaterial?'Yes':'No')+'</strong>'+((s.customerSuppliedItems||[]).length?'<ul class="final-supplied-items">'+suppliedList(s)+'</ul>':'')+'</div><div class="final-line-nre"><h3>NRE Lines</h3>'+(s.nreLines.length?'<table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>'+s.nreLines.map(c=>'<tr><td>'+esc(c.label)+'</td><td>'+money(c.amount)+'</td></tr>').join('')+'</tbody></table>':'<p>No NRE charges</p>')+'<p>NRE Total: <strong>'+money(s.nreTotal)+'</strong> <small>one-time</small></p></div></section>'+materialExtras(s)+quickTurnFields(disabled)+'<div class="final-quote-total"><span>Production subtotal (Unit Price × Qty): '+money(s.total)+'</span><span>NRE: '+money(s.nreTotal)+'</span><strong>Total Quote: <span data-quote-total>'+money(s.quoteTotal)+'</span></strong></div><label class="final-notes">Review Notes / Assumptions <small>Optional</small><textarea aria-label="Review Notes / Assumptions" data-answer="riskNotes" rows="2" maxlength="2000" '+disabled+'>'+esc(answers.riskNotes)+'</textarea></label><div class="final-approval">'+(view.approvalCurrent?'<span>Approved by '+esc(latest.approvedBy)+' · '+esc(new Date(latest.approvedAt).toLocaleDateString())+'</span>':latest?'<span>Source work changed; previous approval is retained in history.</span>':'')+''+(view.approvalCurrent?'<button data-action="generate-pdf" '+(readOnly||busy?'disabled':'')+'>Generate Quotation PDF</button>':'')+(pdfUrl?'<a href="'+esc(pdfUrl)+'" target="_blank" rel="noopener">View PDF</a>':'')+'<button data-action="preview-quote">Preview Customer Quote</button><button data-action="approve" '+(view.approvalCurrent?'hidden':'')+'>Approve Quote</button></div>'+submission()+history+'</section>';
      const root=mount.querySelector('.quotation-final-review');
      root.oninput=e=>{if(readOnly||busy||view.approvalCurrent)return;
        if(e.target.matches?.('[data-quick-enable]')){answers.quickTurn=e.target.checked?{mode:'LABOR_PERCENT',value:30}:null;dirty=true;draw();return;}
        if(e.target.matches?.('[data-quick-mode]')){const mode=e.target.value;answers.quickTurn={mode,value:mode==='FLAT'?null:30};dirty=true;draw();return;}
        if(e.target.matches?.('[data-quick-value]')){answers.quickTurn.value=e.target.value;dirty=true;update();return;}
        const k=e.target.dataset.answer;if(!k)return;const v=e.target.value;if(k==='deliveryValue'||k==='deliveryUnit'){answers[k]=v;answers.deliveryUnit??='WEEKS';answers.delivery=answers.deliveryValue==null||answers.deliveryValue===''?'':answers.deliveryValue+' '+(answers.deliveryUnit==='DAYS'?'Days':'Weeks');}else answers[k]=['outsourced','highUnitCost','canMeetDelivery','itar'].includes(k)?v===''?null:v==='true':v;dirty=true;message='Unsaved review answers. Approve Quote to preserve this internal review.';update();};
      root.onchange=root.oninput;
      root.onclick=async e=>{e.stopPropagation();const action=e.target.closest('button')?.dataset.action;if(busy)return;
      if(action==='reload-status'){busy=true;draw();await loadCommercial();busy=false;draw();return;}
      if(action==='submit'){
        const latest=view.approvals.at(-1),c=commercial?.commercial;
        if(readOnly||!view.approvalCurrent||!latest||!c||latest.id===c.approvalId||!['OPEN','SUBMITTED','EXPIRED'].includes(c.status))return;
        const payload={expectedRevision:c.revision,action:'SUBMIT',approvalId:latest.id,approvalVersion:latest.version,reason:'Explicit commercial submission; no customer communication sent.'};
        const key=JSON.stringify(payload);if(pendingSubmit?.key!==key)pendingSubmit={key,request:{...payload,requestId:window.crypto.randomUUID()}};
        busy=true;message='Recording submission…';draw();
        try{const r=await window.fetch('/api/sim/rfqs/'+encodeURIComponent(rfq.intakeId)+'/commercial',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(pendingSubmit.request)});const body=await r.json();if(!r.ok)throw new Error(body.message||'Submission could not be recorded.');commercial=body;pendingSubmit=null;message='Quote marked Submitted. No customer email was sent.';}
        catch(e){message=e.message;try{view=await request();await loadCommercial();}catch(_){} }
        finally{busy=false;draw();}return;
      }
      if(action==='generate-pdf'&&view.approvalCurrent&&!readOnly){busy=true;message='Generating quotation PDF…';draw();try{const pdf=await request('/'+view.approvals.at(-1).version+'/pdf',{method:'POST'});pdfUrl=pdf.url;message='Quotation PDF ready: '+pdf.quoteNumber;}catch(e){message=e.message;}finally{busy=false;draw();}return;}if(action==='preview-quote'){
        if(blockers(answers).length){message=blockers(answers).join(' ');update();return;}
        busy=true;message='Rendering customer quotation preview...';draw();
        try{
          const preview=await request('/preview/pages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceToken:view.sourceToken,expectedApprovalCount:view.approvals.length,answers:requestAnswers()})});
          mount.innerHTML='<section class="rfqs-workspace quotation-final-review quotation-preview"><button data-return-review>Back to Final Review</button><p class="quotation-preview-warning">PREVIEW ONLY - NOT APPROVED - NOT FOR CUSTOMER USE</p><div class="quotation-preview-pages" role="region" aria-label="Customer quotation preview pages">'+preview.pages.map((page,index)=>'<img class="quotation-preview-page" src="'+esc(page)+'" alt="Quotation preview page '+(index+1)+' of '+preview.pages.length+' - not approved">').join('')+'</div></section>';
          mount.querySelector('.quotation-preview').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p')e.preventDefault();};
          mount.querySelector('[data-return-review]').onclick=()=>{message='';draw();};
        }catch(e){busy=false;message=e.message;draw();}finally{busy=false;}
        return;
      }if(action==='back'){if(!dirty||window.confirm('Leave without approving these review answers?'))await back();return;}if(action!=='approve'||readOnly||view.approvalCurrent||view.blockers.length||blockers(answers).length)return;busy=true;message='Saving approval…';draw();try{view=await request('/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceToken:view.sourceToken,expectedApprovalCount:view.approvals.length,answers:requestAnswers()})});answers=structuredClone(view.approvals.at(-1).answers);dirty=false;await loadCommercial();message='Quote approved. You can now mark it submitted below.';}catch(e){message=e.message;}finally{busy=false;draw();}};update();
    }
    draw();
    for(let node=mount;node;node=node.parentElement)node.scrollTop=0;
    window.scrollTo(0,0);
  }
  window.DleQuotationFinalReview=Object.freeze({open,blockers,leadDisplay,deliveryDefault,suppliedList,quickTurnCalc,quickTurnError});
})(window);


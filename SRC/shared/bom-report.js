(function(window){'use strict';const clean=value=>String(value??'').trim();


  // Presentation identity is distinct from the approved pick identities and saved selection.
  function partIdentity(group) {
    const primary=clean(group.sourcePartNumber)||clean(group.partNumber)||clean(group.primaryPart?.itemNumber);
    const candidates=[...(clean(group.sourcePartNumber)?[group.partNumber||group.primaryPart?.itemNumber]:[]),
      ...(group.relatedParts||[]).map(part=>part?.row?.itemNumber)];
    const related=[...new Set(candidates.flatMap(value=>clean(value).split(/\s+\/\s+|[\r\n]+/).map(clean)).filter(value=>value&&value!==primary))];
    return {primary,related};
  }
  function partNumbers(group) {
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const identity=partIdentity(group);
    return '<strong class="part-number">'+escape(identity.primary)+'</strong>'+identity.related.map(number=>'<small class="part-number">'+escape(number)+'</small>').join('');
  }

  // Match only the immutable note generated from this row's retained C/S metadata.
  // Operator process notes are never filtered, even when they use similar wording.
  function customerSupplyNote(group) {
    const s=group.customerSupply;
    if(!s||!['findNumber','customerPartNumber','approvedPartNumber','requiredEach','requiredQuantity','uom','quoteNumber','poNumber'].every(k=>s[k]!==undefined&&s[k]!==null)||!Array.isArray(s.poDocumentNames))return null;
    return 'C/S (Customer supplied); Find '+s.findNumber+'; Customer P/N '+s.customerPartNumber+'; Approved P/N '+s.approvedPartNumber+'; '+s.requiredEach+' '+s.uom+'/assembly; minimum '+s.requiredQuantity+' '+s.uom+'; quote '+s.quoteNumber+'; PO '+s.poNumber+' ('+s.poDocumentNames.join(', ')+'). Supply responsibility only; receipt and kitting remain separate.';
  }
  function operatorNotes(group) {
    const generated=customerSupplyNote(group);
    return (group.notes||[]).filter(note=>generated===null||note!==generated);
  }

  const processLabel=p=>p?.componentType==='WIRE'?'Wire':p?.componentType==='MANUAL'?p.customLabel:p?.componentType==='SUB_ASSY'?'Sub-Assy':p?.componentType&&p.componentType!=='UNKNOWN'?p.componentType:'\u2014';

  function documentHtml(draft, navigation = {}) {

    const quote=navigation.context==='QUOTE',employee=!!navigation.releasedWorksheet||(quote&&!!navigation.compact);

    const header = draft?.header || {};

    const groups = Array.isArray(draft?.groups) ? draft.groups : [];

    if (!quote&&(!clean(draft?.workOrder || header.workOrder) || !groups.length)) return '';

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({

      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'

    })[character]);

    const quantity = value => {

      if(quote)return clean(value)||'Unavailable';

      if(value==null||clean(value)==='')return '-';
      const number = Number(value);

      return window.KittingQuantity?.format(value) ??

        (Number.isFinite(number) ? String(number) : clean(value) || '\u2014');

    };

    const workOrder = quote?'QUOTE':clean(draft.workOrder || header.workOrder);

    const returnValue = clean(navigation.returnUrl);

    const returnUrl = returnValue.startsWith('/') && !returnValue.startsWith('//') ? returnValue : '/';

    const field = (label, value) => '<div><span>' + escapeHtml(label) + '</span><strong>' +

      escapeHtml(clean(value) || '\u2014') + '</strong></div>';

    const instructions = (draft.assemblyInstructions || []).map(instruction => '<li><strong>SEQ ' +

      escapeHtml(instruction.sequence) + '</strong><span>' + escapeHtml(instruction.materialMessage) + '</span></li>').join('');

    const rows = [...groups].sort((left, right) => clean(left.sequence).localeCompare(

      clean(right.sequence), undefined, { numeric: true })).map(group => {

      const identity = partIdentity(group);
      const related = clean(group.sourcePartNumber) ? identity.related : (group.relatedParts || []).map(part => clean(part?.row?.itemNumber)).filter(Boolean);

      const references = (group.references || []).map(clean).filter(Boolean);

      const notes = (group.notes || []).map(clean).filter(Boolean).map(n=>navigation.fairLabels?n.replace(/^Component type:/,'FAIR Component Type:'):n);

      if(employee)return '<tr data-process-key="'+escapeHtml(group.process?.key||'')+'" data-sequence="'+escapeHtml(group.sequence)+'"><td>'+escapeHtml(group.sequence)+'</td><td>'+escapeHtml(group.findNumber??'—')+'</td><td class="part-numbers">'+partNumbers(group)+'</td><td>'+escapeHtml(group.description||group?.primaryPart?.description||'NOT ON FILE')+(!quote&&(group.supplyDisposition?.responsibility ? group.supplyDisposition.responsibility==='CUSTOMER_SUPPLIED' : group.customerSupply)?'<small>C/S — Customer supplied</small>':'')+(references.length?'<small>Refs: '+escapeHtml(references.join(', '))+'</small>':'')+'</td><td class="number"><span class="required-inline">'+escapeHtml(quantity(group.requiredEach))+(clean(group.unitOfMeasure)?' '+escapeHtml(group.unitOfMeasure):'')+'/ea · '+'<strong class="required-total">'+escapeHtml(quote?multiply(group.requiredEach,header.scheduledProduction):quantity(group.requiredQuantity))+'</strong>'+(clean(group.unitOfMeasure)?' '+escapeHtml(group.unitOfMeasure):'')+'</span></td><td class="pending-kitting">'+(quote?'-':compactKittingResult(group))+'</td><td class="pending-po">'+escapeHtml(quote?'-':purchaseOrderLabels(group))+'</td><td class="process-type" data-process-type="'+escapeHtml(group.process?.componentType||'UNKNOWN')+'">'+escapeHtml(processLabel(group.process))+'</td><td class="process-notes">'+escapeHtml(quote?(group.process?.notes||''):[...operatorNotes(group),group.process?.notes||''].filter(Boolean).join('\n'))+'</td></tr>';

      return '<tr '+(quote?'tabindex="0" aria-selected="false" data-quantity="'+escapeHtml(group.requiredEach)+'" ':'')+'data-sequence="' + escapeHtml(group.sequence) + '"><td><strong>' +

        escapeHtml(group.sequence) + '</strong></td><td>' + escapeHtml(group.findNumber ?? '\u2014') +

        '</td><td><strong>' + escapeHtml(identity.primary) + '</strong>' +

        (related.length ? '<small>'+(quote?'Confirmed MFG: ':'Related: ') + escapeHtml(related.join(', ')) + '</small>' : '') +

        '</td><td>' + escapeHtml(group.description || group?.primaryPart?.description || 'NOT ON FILE') +

        (references.length ? (navigation.compact?' · ':'')+'<small>Refs: ' + escapeHtml(references.join(', ')) + '</small>' : '') +

        (notes.length ? (navigation.compact?' · ':'')+'<small>Note: ' + escapeHtml(notes.join(' \u00b7 ')) + '</small>' : '') +

        '</td><td class="number"><span>' + escapeHtml(quantity(group.requiredEach)) + ' / assy</span>'+(navigation.compact?' / ':'')+'<strong>' +

        escapeHtml(quote?multiply(group.requiredEach,header.scheduledProduction):quantity(group.requiredQuantity)) + ' ' + escapeHtml(group.unitOfMeasure) + '</strong></td></tr>';

    }).join('');

    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +

      '<title>'+ (quote?'Quote ':'WO ') + escapeHtml(workOrder) + (quote?' - BOM':' \u2014 Released BOM')+'</title><style>' +

      ':root{color-scheme:light;--ink:#15202a;--muted:#52616b;--rule:#81909a;--paper:#fff;--desk:#d4d9dd}' +

      '*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--desk);color:var(--ink)}' +

      'body{font:13px Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:12px;' +

      'min-height:56px;padding:8px max(14px,calc((100% - 1180px)/2));background:#17232c;color:#eef5f8;border-bottom:2px solid #0b1116}' +

      '.toolbar strong{font-size:14px}.toolbar span{color:#b9c8d1}.toolbar a,.toolbar button{min-height:40px;padding:8px 12px;border:1px solid #cbd7dd;' +

      'border-radius:6px;background:#f7fafb;color:#14202a;font-weight:700;text-decoration:none;cursor:pointer}.toolbar-actions{display:flex;gap:8px;margin-left:auto}' +

      'main{width:min(1180px,calc(100% - 24px));margin:16px auto 30px;padding:24px 28px 32px;background:var(--paper);box-shadow:0 2px 14px #0003}' +

      'h1{margin:0 0 5px;font-size:22px}.subtitle{margin:0 0 18px;color:var(--muted)}.identity{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 18px;' +

      'padding:12px 0;border-block:2px solid var(--ink)}.identity div{min-width:0}.identity span,.material-table small{display:block;color:var(--muted);font-size:11px}' +

      '.identity strong{display:block;margin-top:2px;overflow-wrap:anywhere}.instructions{margin:14px 0;padding:10px 12px;border:1px solid var(--rule);background:#f4f7f8}' +

      '.instructions h2{margin:0 0 6px;font-size:13px}.instructions ul{display:grid;gap:4px;margin:0;padding:0;list-style:none}.instructions li{display:flex;gap:10px}' +

      '.material-table{width:100%;border-collapse:collapse;table-layout:fixed}.material-table col.seq{width:58px}.material-table col.find{width:54px}' +

      '.material-table col.part{width:220px}.material-table col.required{width:128px}.material-table th,.material-table td{padding:7px 6px;border-bottom:1px solid #aeb8be;' +

      'vertical-align:top;text-align:left}.material-table th{position:sticky;top:56px;background:#eef3f5;border-bottom:2px solid var(--ink);font-size:11px;text-transform:uppercase}' +

      '.material-table td.number,.material-table th.number{text-align:right}.material-table td.number strong{display:block;margin-top:2px}' +

      '@media(max-width:820px){main{width:calc(100% - 12px);margin:6px auto;padding:16px 12px}.identity{grid-template-columns:repeat(2,minmax(0,1fr))}.material-table col.part{width:160px}}' +

      '@media print{.toolbar{display:none!important}.quote-analysis{display:none!important}body{background:#fff}main{width:100%;margin:0;padding:0;box-shadow:none}.material-table th{position:static}}' +

      '.material-table td{overflow-wrap:anywhere}.material-table tr[aria-selected=true]{background:#cce5f5}.quote-analysis{margin:12px 0}.quote-analysis button{min-height:40px}.material-table tr{break-inside:avoid}.material-table thead{display:table-header-group}'+(quote?'.toolbar a{display:none}':'')+(navigation.portrait?'@page{size:letter portrait}body{background:white}main{width:720px;margin:0;padding:16px;box-shadow:none}.toolbar{display:none}.material-table th{position:static}.material-table col.seq{width:40px}.material-table col.find{width:42px}.material-table col.part{width:170px}.material-table col.required{width:100px}':navigation.page?'@page{size:landscape}body{background:white}main{width:1200px;margin:0;padding:24px;box-shadow:none}.toolbar{display:none}.material-table th{position:static}':'')+

      (navigation.compact?'body{font:12px/1.1 Arial,Helvetica,sans-serif;background:white}main{width:792px;margin:0;padding:8px;box-shadow:none}h1{font-size:16px;margin:0 0 2px}.subtitle{font-size:10px;margin:0 0 4px}.identity{grid-template-columns:repeat(4,minmax(0,1fr));gap:2px 10px;padding:4px 0}.identity div{display:flex;gap:5px;align-items:baseline}.identity span{font-size:10px}.identity strong{font-size:11px;margin:0}.material-table col.seq{width:30px}.material-table col.find{width:30px}.material-table col.part{width:160px}.material-table col.required{width:88px}.material-table th,.material-table td{padding:1px 4px}.material-table th{font-size:10px;position:static}.material-table small{font-size:11px;line-height:1.1}.material-table td:nth-child(4) small{display:inline}.material-table td.number strong{margin:0;display:inline}main>p:last-child{font-size:10px;margin:4px 0 0}.toolbar{display:none}':'')+

      (employee?'body{font-size:11px}.material-table{font:11px/1.1 Arial,Helvetica,sans-serif}.material-table small{font-size:10px}.material-table col.seq{width:26px}.material-table col.find{width:28px}.material-table col.part{width:148px}.material-table col.required{width:91px}.material-table col.result{width:50px}.material-table col.po{width:30px}.material-table col.process{width:64px}.material-table col.notes{width:115px}.material-table .part-number{display:block;white-space:nowrap;overflow-wrap:normal;word-break:normal}.process-notes{white-space:pre-wrap}.process-type{background:#fff;color:#172d3d}.process-type[data-process-type=SMT]{background:#dceefb}.process-type[data-process-type=TH]{background:#fff3c4}@media print{.process-type{background:#fff!important;color:#000!important}}.material-table th{font-size:9px}.material-table td{padding:2px 3px}.material-table td:nth-child(4) small{display:block}.material-table td.number{font-size:11px;line-height:1.1;vertical-align:top}.required-inline{font:inherit;font-weight:400}.material-table td.number .required-total{display:inline;font-size:inherit;font-weight:700;line-height:inherit;margin:0}.pending-kitting,.pending-po{text-align:center!important;color:#52616b;white-space:pre-wrap;overflow-wrap:anywhere}.material-table th{overflow-wrap:normal}':'')+

      (employee&&!quote?'.material-table col.result{width:50px}.material-table col.po{width:45px}.material-table col.notes{width:100px}':'')+
      '</style></head><body data-shared-bom="'+(quote?'quote':'released')+'"><header class="toolbar"><strong>'+(quote?'Quotation BOM':'Released BOM \u00b7 Kitting Pick View')+'</strong><span id="reportIdentity">'+(quote?'Quote ':'WO ') +

      escapeHtml(workOrder) + ' \u00b7 ' + escapeHtml(header.billNumber) + ' Rev ' + escapeHtml(header.revision) +

      '</span><div class="toolbar-actions"><a id="backToKittingJob" href="' + escapeHtml(returnUrl) +

      '" onclick="if(window.opener&&!window.opener.closed){window.opener.focus();window.close();if(window.closed)return false}">\u2190 Back to Kitting Job</a>' +

      '<button id="printReleasedBom" type="button" onclick="window.print()">'+(quote?'Print Quote BOM':'Print Released BOM')+'</button></div></header><main>' +

      '<h1>'+(quote?'QUOTATION BILL OF MATERIALS':'WORK ORDER RELEASED BOM')+'</h1><p class="subtitle">'+(quote?'Quote only - not released, picked or issued. Qty / Assy is accepted BOM usage; Quote total = usage x quote quantity.':'Governed released Kitting requirements \u00b7 read only')+'</p><section class="identity">' +

      field(quote?'Context':'Work Order', workOrder) + field('Assembly', header.billNumber) + field('Revision', header.revision) +

      field(quote?'Quote Quantity':'Build Quantity', quantity(header.scheduledProduction) + ' ' + clean(header.unitOfMeasure)) +

      field('Customer', header.customer) + field('Sales Order', header.salesOrder) + field('SO Line', header.salesOrderLine) +

      field('Customer P.O.', header.customerPurchaseOrder) + '</section>' +

      (!quote&&draft.reportSource?'<p class="source-metadata" style="font-size:10px;overflow-wrap:anywhere">'+escapeHtml(draft.reportSource)+'</p>':'') +

      (!quote&&navigation.releasedWorksheet&&groups.some(group=>!group.process)?'<p class="source-metadata" style="font-size:10px">Production Component Type was not captured for '+groups.filter(group=>!group.process).length+' rows (shown as a dash). FAIR classification remains separate.</p>':'') +
      (instructions ? '<section class="instructions"><h2>Assembly Instructions</h2><ul>' + instructions + '</ul></section>' : '') +

      '<table class="material-table" aria-label="Work Order ' + escapeHtml(workOrder) + ' Released BOM material requirements"><colgroup>' +

      '<col class="seq"><col class="find"><col class="part"><col><col class="required">'+(employee?'<col class="result"><col class="po"><col class="process"><col class="notes">':'')+'</colgroup><thead><tr><th>'+(employee?'WO Seq':quote?'Row':'WO Seq')+'</th><th>Find</th>' +

      '<th>'+(employee?'Part / Related':quote?'Part / Confirmed MFG':'Part / Related Part')+'</th><th>Description / References</th><th class="number">'+(employee?'Required':quote?'Qty / Assy / Quote total':'Required')+'</th>'+(employee?'<th>Kitting Result</th><th>P.O.</th><th>Component Type</th><th>Notes</th>':'')+'</tr></thead><tbody>' + rows +

      '</tbody></table>'+(quote&&!navigation.page&&!navigation.compact?'<div class="quote-analysis">BOM Lines: '+groups.length+' | Total components / assy: <strong id="bom-total"></strong><p id="bom-selection" role="status" aria-live="polite"></p><button id="bom-clear">Clear selection</button></div>':'')+(navigation.page?'<p>'+(quote?'Quote BOM':'Work Order BOM')+' - Page '+navigation.page+' of '+navigation.pages+(quote?' | Not released, picked or issued.':' | Saved Kitting results.')+'</p>':'')+'</main></body></html>';

  }



 function multiply(value,quantity){

  const a=String(value??'').trim(),b=String(quantity??'').trim();if(!/^\d+(?:\.\d+)?$/.test(a)||!/^\d+$/.test(b))return 'Unavailable';

  const [whole,frac='']=a.split('.'),n=(BigInt(whole+frac)*BigInt(b)).toString().padStart(frac.length+1,'0');return frac.length?(n.slice(0,-frac.length)+'.'+n.slice(-frac.length)).replace(/\.?0+$/,''):n;

 }

 function quoteDraft(rows,rfq,quantity){const assembly=rfq?.assemblies?.[0]||{};return {workOrder:'QUOTE',header:{billNumber:assembly.assemblyNumber||'',revision:assembly.revision||'',scheduledProduction:quantity,unitOfMeasure:'',customer:rfq?.customer?.customerName||''},groups:rows.map((r,i)=>({sequence:String(i+1),findNumber:r[0],partNumber:r[1],relatedParts:r[2]?[{row:{itemNumber:r[2]}}]:[],description:r[3],references:r[4]?[r[4]]:[],notes:r[6]?['Component type: '+r[6]]:[],requiredEach:r[5],unitOfMeasure:''}))};}

 function svg(draft,page,pages,portrait=false,compact=false,navigation={}){

  const width=compact?792:portrait?720:1200,html=documentHtml(draft,{context:'QUOTE',...navigation,page,pages,portrait:portrait&&!compact,compact}),frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-20000px;top:0;width:'+width+'px;height:1px;visibility:hidden';document.body.append(frame);const d=frame.contentDocument;d.open();d.write(html);d.close();

  const main=d.querySelector('main'),height=Math.max(700,Math.ceil(main.getBoundingClientRect().height));const style=d.querySelector('style').textContent;const outer=document.createElement('div');outer.setAttribute('xmlns','http://www.w3.org/1999/xhtml');outer.style.font=d.defaultView.getComputedStyle(d.body).font;outer.style.color=d.defaultView.getComputedStyle(d.body).color;outer.innerHTML='<style>'+style+'</style>'+main.outerHTML;const markup=new XMLSerializer().serializeToString(outer),ranges=[],top=main.getBoundingClientRect().top,rowBoxes=[...main.querySelectorAll('tbody tr')].map(n=>({top:n.getBoundingClientRect().top-top,bottom:n.getBoundingClientRect().bottom-top}));const textBoxes=[],walker=d.createTreeWalker(main,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(!node.textContent.trim())continue;const range=d.createRange();range.selectNodeContents(node);for(const box of range.getClientRects())textBoxes.push({top:box.top-top,bottom:box.bottom-top});}for(let start=0;start<height;){let end=Math.min(start+800,height);const crossing=rowBoxes.find(b=>b.top<end&&b.bottom>end);if(crossing&&crossing.top>start)end=crossing.top; let crossingText;while(crossingText=textBoxes.find(b=>b.top<end&&b.bottom>end)){end=Math.floor(crossingText.top);}if(end<=start)throw Error('BOM print range unavailable');ranges.push({start,end});start=end;}frame.remove();return '<svg data-print-ranges="'+JSON.stringify(ranges).replace(/"/g,'&quot;')+'" xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><foreignObject width="'+width+'" height="'+height+'">'+markup+'</foreignObject></svg>';

 }



 function kittingResult(group){

  const e=group.entry;if(!e)return '-';

  const labels={COMPLETE:'Complete',COMPLETE_MIN_EXTRA:'Complete with minimal extra',COUNTED_EXACT:'Counted — exact',COUNTED_SHORT:'Counted — short',COUNTED_EXTRA:'Counted — extra'};
  const result=[labels[e.result]||labels[e.method]||e.result||e.method||'Recorded'];
  if(e.pickedQuantity!=null)result.push('Picked '+e.pickedQuantity);
  if(e.customerInstalledQuantity>0)result.push('Customer installs '+e.customerInstalledQuantity+' (not kitted)');
  if(e.shortageQuantity>0)result.push('Short '+e.shortageQuantity);
  if(e.extraQuantity>0)result.push('Extra '+e.extraQuantity);
  for(const a of e.allocations||[])result.push(['Used: '+a.partNumber,a.sourceType==='CUSTOMER_INSTALLED'?'Customer installs '+a.customerInstalledQuantity+'; on hand '+a.quantity:a.quantity!=null?'Qty '+a.quantity:''].filter(Boolean).join(' '));
  if(e.selectedPartNumber)result.push('Used: '+e.selectedPartNumber);
  return result.join('\n');

 }

 function allocationSource(a){return clean(a.purchaseOrder)||({CUSTOMER_SUPPLIED:'C/S',CUSTOMER_INSTALLED:'C/I'}[a.sourceType])||'Not recorded';}
 function purchaseOrderLabels(group){const e=group.entry;if(!e)return '-';return e.allocations?.length?[...new Set(e.allocations.map(allocationSource))].join('\n'):clean(e.purchaseOrder)||'-';}
 function compactKittingResult(group){
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const e=group.entry;if(!e)return '-';
  const complete=['COMPLETE','COMPLETE_MIN_EXTRA','COUNTED_EXACT','COUNTED_EXTRA'].includes(e.result)&&!(e.shortageQuantity>0);
  const label=complete?'Complete':e.shortageQuantity>0||e.result==='COUNTED_SHORT'?'Short':'Incomplete';
  const detail=kittingResult(group)+'\nSources:\n'+purchaseOrders(group)+(e.pickedQuantity==null?'\nNo numeric count recorded.':'');
  return '<details class="bom-count-detail" style="position:relative;white-space:normal"><summary title="'+escapeHtml(detail)+'" aria-label="'+escapeHtml(label+'. Show saved count and source details')+'" style="list-style:none;cursor:pointer;min-height:22px;line-height:22px">'+(complete?'&#10003;':escapeHtml(label))+'</summary><div class="bom-count-popup" style="position:absolute;right:0;top:100%;width:250px;z-index:20;white-space:pre-wrap;text-align:left;background:white;color:#172d3d;border:1px solid #64748b;padding:8px;box-shadow:0 2px 6px #64748b;font:12px/1.4 Arial">'+escapeHtml(detail)+'</div></details>';
 }
 function purchaseOrders(group){
  const e=group.entry;if(!e)return '-';
  const source=allocationSource;
  if(e.allocations?.length)return e.allocations.map(a=>source(a)+(a.quantity!=null?' — '+String(a.quantity)+(clean(group.unitOfMeasure)?' '+clean(group.unitOfMeasure):''):'')+(a.sourceType==='CUSTOMER_INSTALLED'&&a.customerInstalledQuantity!=null?' on hand; customer installs '+String(a.customerInstalledQuantity):'')).join('\n');
  return clean(e.purchaseOrder)||'-';
 }

 let letterReady;

 async function releasedDocument(draft,navigation={}){

  if(!window.DleLaborLetterPages){

   if(!letterReady)letterReady=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/SRC/workspaces/rfqs/labor-letter-pages.js';script.onload=resolve;script.onerror=()=>{letterReady=null;script.remove();reject(Error('BOM page renderer unavailable. Please retry.'));};document.head.append(script);});

   await letterReady;

  }

  const forms=window.DleLaborLetterPages,header=draft.header||{};

  const result=await forms.compose({kind:'BOM',layer:{page:1,marks:[],photos:[]},caption:'',context:'WO '+draft.workOrder+' | '+header.billNumber+' | Rev '+header.revision+' | Qty '+header.scheduledProduction,

   loadBase:async()=>new Response(svg(draft,null,null,true,true,{context:'RELEASED',releasedWorksheet:true}),{headers:{'Content-Type':'image/svg+xml'}})});

  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const back=clean(navigation.returnUrl),returnUrl=back.startsWith('/')&&!back.startsWith('//')?back:'/';

  return forms.document(result).replace('<head>','<head><title>WO '+escape(draft.workOrder)+' - Released BOM</title><style>.released-bom-toolbar{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#17232c;color:white;gap:12px}.released-bom-toolbar a,.released-bom-toolbar button{background:white;color:#17232c;padding:8px;border:1px solid #aaa;border-radius:4px;font:14px Arial;text-decoration:none}@media print{.released-bom-toolbar{display:none!important}}</style>').replace('<body>','<body><nav class="released-bom-toolbar"><a id="backToKittingJob" href="'+escape(returnUrl)+'" onclick="if(window.opener&&!window.opener.closed){window.opener.focus();window.close();if(window.closed)return false}">Back to Kitting Job</a><span>Released BOM · Read only · '+result.pages+' pages</span><button id="printReleasedBom" onclick="window.print()">Print Released BOM</button></nav>');

 }

 window.DleBomReport=Object.freeze({customerSupplyNote,operatorNotes,partIdentity,partNumbers,processLabel,kittingResult,compactKittingResult,purchaseOrders,purchaseOrderLabels,document:documentHtml,quoteDraft,multiply,svg,releasedDocument,version:'bom-reference-v4'});



})(window);
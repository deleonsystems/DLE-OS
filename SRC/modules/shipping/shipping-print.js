(function (window, document) {
  'use strict';
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Document projections only. No shipment commands or document-fulfillment writes.
  function render(v,a,kind) {
    const c=a.context;
    const identity=`SO ${c.salesOrderNumber} / ${c.lineNumber} - WO ${v.workOrderNumber}`;
    const departure=a.departure;
    const notice=`SIM PREVIEW - ${identity} - ${a.quantity} ${c.uom}; authorization ${a.state}. ${v.sourceCurrent?'Source current':'SOURCE REVIEW REQUIRED'}. ${departure?`SIM departure recorded ${departure.recordedAt} by ${departure.actor}; awaiting invoice. Not evidence of real dispatch.`:'Not shipped.'} Production ${v.productionExecution}. Documents not fulfilled by printing.`;
    let html, css='';
    if(kind==='request') {
      const preparation={lines:[{customerNumber:c.customerNumber,customer:c.customer,salesOrder:c.salesOrderNumber,partNumber:c.assembly,shipQuantity:a.quantity}]};
      const form=document.createElement('div');
      form.innerHTML=window.buildDigitalRequestToShipForm(preparation,[c.customerNumber],[c.salesOrderNumber]);
      form.querySelector('tbody tr').children[2].textContent=c.revision;
      html=`<p class="sim-notice">${esc(notice)}</p>`+form.innerHTML;
      css=window.buildRequestToShipPrintCss();
    } else if(kind==='packing') {
      const shipTo=typeof c.shipTo==='string'&&c.shipTo.trim()?c.shipTo:'Not established';
      html=`<section class="packing"><header><div><strong>DeLeon Enterprises</strong><br>11934 Allegheny St.<br>Sun Valley, CA 91352<br>(818) 252-6690 &nbsp; Fax: (818) 252-6694</div><div><b>SIM PREVIEW</b><h1>PACKING SLIP</h1><div>Order # ${esc(c.salesOrderNumber)}</div><div>Preview date ${esc(new Date().toLocaleDateString())}</div></div></header>
        <div class="addresses"><div><h2>Customer</h2><p>${esc(c.customerNumber)}<br>${esc(c.customer)}</p></div><div><h2>Ship To</h2><p>${esc(shipTo)}</p></div></div>
        <table class="strip"><thead><tr>${['Cust P.O.#','Terms','Salesperson','Ship Via','Ship Date','PC'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody><tr><td>${esc(c.customerPo)}</td><td>Not established</td><td>Not established</td><td>Review required</td><td>${departure?'SIM only - see record':'Not dispatched'}</td><td>Not set</td></tr></tbody></table>
        <table class="items"><thead><tr>${['Line','Order','Ship*','B/O','Item Number & Description','Whse'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody><tr><td>${esc(c.lineNumber)}</td><td>Not established</td><td>${esc(a.quantity)} ${esc(c.uom)}</td><td>Not established</td><td>${esc(c.assembly)}<br>REV ${esc(c.revision)}<br>WO ${esc(v.workOrderNumber)}</td><td>Not set</td></tr></tbody></table>
        <p class="sim-notice">${esc(notice)}<br>*Ship column is preview quantity only. Customer due: ${esc(window.ShippingHandoff.date(c.customerDueDate))}.</p>
        <p class="sim-notice">Shipping method: REVIEW REQUIRED. ${esc(c.shippingMethod.questionnaire)} / ${esc([...new Set((c.shippingMethod.poEvidence||[]).map(x=>x.value))].join('; '))}</p>
        <footer><div class="certificate"><strong>Certificate of Compliance - DEVELOPMENTAL SIM PLACEHOLDER</strong><p>Reserved area only. No certification is made. Final wording awaits business approval.</p></div><strong>Customer Copy - SIM PREVIEW</strong></footer></section>`;
      css=`.packing{min-height:9.8in;display:flex;flex-direction:column;border:1px solid #333}.packing header{display:flex;justify-content:space-between;text-align:center;padding:10px;gap:20px}.packing h1{font-size:25px;margin:8px 0}.packing h2{font-size:13px;margin:0;padding:6px;background:#d2d2d2}.addresses{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #333}.addresses>div{border-right:1px solid #333;min-height:105px}.addresses p{padding:8px;white-space:pre-wrap}.packing table{width:100%;border-collapse:collapse;table-layout:fixed}.packing th{background:#d2d2d2;font-weight:normal;font-style:italic}.packing td,.packing th{padding:8px 5px;border:1px solid #777;vertical-align:top;overflow-wrap:anywhere}.items th:nth-child(5){width:35%}.packing footer{margin-top:auto;text-align:center;padding:8px}.certificate{text-align:left;border-top:1px solid #888;font-size:10px;padding:10px 0}.packing .sim-notice{margin:12px;font-size:10px}`;
    } else throw new Error('Unknown preview');
    return `<!doctype html><html><head><meta charset="utf-8"><base href="${esc(document.baseURI)}"><title>${esc(kind==='request'?'Request to Ship - SIM PREVIEW':'Packing Slip - SIM PREVIEW')}</title><style>@page{size:letter portrait;margin:.4in}*{box-sizing:border-box}body{margin:0;color:#111;background:white;font:12px Arial,sans-serif;overflow-wrap:anywhere;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sim-notice{border:1px solid #777;padding:8px;font-weight:bold}${css}</style></head><body>${html}</body></html>`;
  }
  function preview(v,a,kind) {
    document.getElementById('shippingPrintPreview')?.remove();
    const dialog=document.createElement('dialog');dialog.id='shippingPrintPreview';dialog.className='handoff handoff-dialog';
    dialog.innerHTML='<div class="handoff-heading"><h2>SIM print preview</h2><button type="button" data-preview-close>Cancel / Close</button></div><p>Preview, print, cancel and reprint do not change any business state or fulfill documents.</p><button type="button" data-preview-print>Print / Reprint</button><iframe title="SIM document preview" style="width:100%;height:65vh;background:white;border:0;margin-top:12px"></iframe>';
    const frame=dialog.querySelector('iframe');frame.srcdoc=render(v,a,kind);
    dialog.querySelector('[data-preview-close]').onclick=()=>dialog.close();
    const button=dialog.querySelector('[data-preview-print]');button.disabled=true;
    frame.onload=()=>{button.disabled=false;};
    button.onclick=()=>{frame.contentWindow.focus();frame.contentWindow.print();};
    document.body.append(dialog);dialog.showModal();
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  }
  function attach(dialog,v,a,{cards=false}={}) {
    if(!a || !window.ShippingHandoff.isSim() || !window.DleOsCapabilities?.can('shipments.view'))return;
    const prints=document.createElement('div');prints.className=cards?'kitting-job-action-grid shipping-print-cards':'handoff-inline';
    prints.innerHTML=cards
      ? '<button type="button" data-print-kind="request"><strong>Request to Ship</strong><span>Preview / Print &middot; QF-7.5.5.1 Rev. A</span></button><button type="button" data-print-kind="packing"><strong>SIM Packing Slip</strong><span>SIM preview available &middot; Preview / Print</span></button>'
      : '<button type="button" data-print-kind="request">Preview / Print Request to Ship</button><button type="button" data-print-kind="packing">Preview / Print SIM Packing Slip</button>';
    prints.addEventListener('click',event=>{const b=event.target.closest('[data-print-kind]');if(b)preview(v,a,b.dataset.printKind);});dialog.append(prints);
  }
  window.ShippingPrint=Object.freeze({render,attach});
})(window,document);

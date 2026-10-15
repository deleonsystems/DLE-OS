(function (window, document) {
  'use strict';
  const dashboard = window.SalesOrderDashboard;
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = x => /^\d{4}-\d{2}-\d{2}/.test(x || '') ? String(x).slice(0,10) : (x || 'Not set');
  const text = x => x === null || x === undefined || x === '' ? 'Not recorded' : String(x);
  let currentOrder = null, generation = 0;
  let evidence = {loading:true, invoices:[], shipping:[], documents:[], errors:{}};
  const identity = row => ({customerNumber:String(row?.official?.customerNumber || '').trim(),salesOrderNumber:String(row?.official?.salesOrder || '').trim(),lineNumber:String(row?.official?.sequenceLine || '').trim()});
  const sameOrder = (a,b) => String(a?.customerNumber) === b.customerNumber && String(a?.salesOrderNumber) === b.salesOrderNumber;
  const rows = () => dashboard.getActiveRelatedRows();
  function mount() {
    const panel = document.querySelector('#salesOrderDashboard .sales-order-dashboard-panel');
    if (!panel || panel.dataset.folder) return;
    panel.dataset.folder = 'true'; panel.classList.add('so-folder');
    panel.innerHTML = `<div class="so-folder-heading"><div><small>SALES ORDER</small><h2 id="salesOrderSummarySalesOrder"></h2><p><span id="salesOrderSummaryCustomer"></span> · PO <span id="salesOrderSummaryCustomerPo"></span></p></div><button type="button" onclick="go('operationsCenter')">Back to Operations Center</button></div>
      <section class="so-folder-section" aria-labelledby="soFolderJobsTitle"><div class="so-folder-section-heading"><h3 id="soFolderJobsTitle">Jobs</h3><div><span id="soFolderSelection"></span> <button type="button" id="salesOrderDashboardCreateRequestToShipButton" onclick="openRequestToShipDialog()" disabled>Ship</button></div></div><p class="so-folder-hint" id="soFolderShipHint">Select a line to open its shipping workflow.</p><div class="so-folder-scroll"><table class="so-folder-jobs"><thead><tr><th>Select</th><th>Line / Assembly</th><th>Work order</th><th>Quantities</th><th>Customer due</th><th>Status</th></tr></thead><tbody id="salesOrderDashboardWorkOrderRows"></tbody></table></div></section>
      <div class="so-folder-bottom"><section class="so-folder-section" aria-labelledby="soFolderDocumentsTitle"><h3 id="soFolderDocumentsTitle">Documents</h3><div id="soFolderDocuments"></div></section><section class="so-folder-section" aria-labelledby="soFolderHistoryTitle"><div class="so-folder-section-heading"><h3 id="soFolderHistoryTitle">History</h3><button type="button" id="soFolderReload">Refresh evidence</button></div><div id="soFolderHistory"></div></section></div>
      <details class="so-folder-admin"><summary>Administrative tools</summary><p>Relationship and RMA / Rework review for this order.</p><div id="soFolderAdmin"></div><div id="salesOrderDashboardRmaCases"></div></details>`;
    panel.querySelector('#soFolderReload').addEventListener('click',()=>load(dashboard.getState().selectedOrder));
  }
  async function get(path) {
    const response = await fetch(path,{credentials:'same-origin',cache:'no-store'});
    if (!response.ok) throw new Error('Source unavailable ('+response.status+')');
    if (!(response.headers.get('content-type') || '').includes('json')) throw new Error('Source unavailable');
    return response.json();
  }
  async function invoices(id) {
    const query = new URLSearchParams({customerNumber:id.customerNumber,salesOrderNumber:id.salesOrderNumber,page:'1',pageSize:'200'});
    const first = await get('/api/platform/live/v1/invoice-history?'+query);
    if (!Array.isArray(first.items) || !Number.isInteger(first.totalPages) || first.totalPages > 1000) throw new Error('Invalid history response');
    const all = first.items.slice();
    for(let page=2;page<=first.totalPages;page++) {query.set('page',page);const next=await get('/api/platform/live/v1/invoice-history?'+query);if(!Array.isArray(next.items))throw new Error('Incomplete history');all.push(...next.items);}
    if (all.length !== first.totalItems || all.some(row=>!sameOrder(row,id))) throw new Error('History identity/count mismatch');
    return all;
  }
  async function documents(order,id) {
    const list = await get('/api/sim/order-entry');
    if(!Array.isArray(list.items))throw new Error('Document index unavailable');
    const candidates = list.items.filter(item=>item.accepted && item.poNumber === order.official.customerPo);
    const result=[];
    for(const item of candidates) {
      const detail = await get('/api/sim/order-entry/'+encodeURIComponent(item.intakeId));
      const ids=detail.orderEntry?.bridge?.state?.identifiers;
      if(String(detail.customer?.customerNumber)!==id.customerNumber || String(ids?.salesOrder)!==id.salesOrderNumber)continue;
      // Use only links returned for the accepted package, never construct a guessed document URL.
      for(const doc of detail.review?.poDocuments || []) {
        const url=new URL(doc.url,location.origin);
        if(url.origin===location.origin && url.pathname.startsWith('/api/sim/new-orders/') && !result.some(x=>x.url===url.href))result.push({...doc,url:url.href});
      }
    }
    return result;
  }
  async function shipping(id, sourceRows) {
    const workOrders=[...new Set(sourceRows.map(r=>dashboard.getWorkOrderPresentation(r)).filter(p=>p.actionable).map(p=>p.primary))];
    const outcomes=await Promise.all(workOrders.map(async wo=>{
      try {const value=await get('/api/shipping-handoff/v1/work-orders/'+encodeURIComponent(wo));if(!sameOrder(value.context,id))throw new Error('Different order');return {wo,value};}
      catch(error){return {wo,error:error.message};}
    }));
    return outcomes;
  }
  async function load(order) {
    if(!order)return;
    const id=identity(order), token=++generation;
    currentOrder=order;evidence={loading:true,invoices:[],shipping:[],documents:[],errors:{}};
    render();
    if(!id.customerNumber || !id.salesOrderNumber){evidence.loading=false;evidence.errors.identity=true;render();return;}
    const results=await Promise.allSettled([invoices(id),documents(order,id),shipping(id,rows().slice()),get('/api/shipments/history')]);
    if(token!==generation)return;
    ['invoices','documents','shipping','shipments'].forEach((key,i)=>{
      if(results[i].status==='fulfilled')evidence[key]=results[i].value;else evidence.errors[key]=true;
    });
    evidence.loading=false;render();
  }
  function render() {
    const state=dashboard.getState(),order=state.selectedOrder;
    if(!document.querySelector('.so-folder') || !order)return;
    if(currentOrder!==order){void load(order);return;}
    const sourceRows=rows();
    const selected=state.selectedWorkOrders;
    document.getElementById('soFolderSelection').textContent=selected.length?selected.length+' selected':'';
    const ship=document.getElementById('salesOrderDashboardCreateRequestToShipButton');
    ship.textContent='Ship';
    const hint=selected.length>1?'Select one line at a time for the current shipping workflow.':selected.length===0?'Select a line to open its shipping workflow.':ship.disabled?'This line is not eligible for the shipping workflow. Review its status and relationship.':'Open the existing shipping workflow. Its permissions and release checks still apply.';
    ship.title=hint;document.getElementById('soFolderShipHint').textContent=hint;
    document.getElementById('salesOrderDashboardWorkOrderRows').innerHTML=sourceRows.map((row,index)=>job(row,index,selected.includes(row))).join('') || '<tr><td colspan="6">No order lines in the current source.</td></tr>';
    document.getElementById('soFolderAdmin').innerHTML=sourceRows.map((row,index)=>'<button type="button" data-related-row-index="'+index+'" onclick="openSalesOrderLineReview(event)" '+(window.OperationsCenter?.state?.operationalEnrichmentAvailable===false?'disabled':'')+'>Review line '+esc(identity(row).lineNumber)+'</button>').join(' ');
    renderDocuments();renderHistory();
  }
  function job(row,index,selected) {
    const o=row.official||{},m=row.masterRecord||{},id=identity(row),p=dashboard.getWorkOrderPresentation(row),projection=dashboard.getShipmentProjection(row);
    const inv=evidence.invoices.filter(x=>String(x.salesOrderLineNumber)===id.lineNumber);
    const departures=(evidence.shipping||[]).flatMap(x=>x.value?.authorizations||[]).filter(a=>a.state==='SIM_SHIPPED_AWAITING_INVOICE' && sameOrder(a.context,id) && String(a.context.lineNumber)===id.lineNumber);
    const status=[m.materialStatus?.label || o.materialStatus || (p.actionable?'Material status unavailable':'Relationship review required')];
    if(projection.stagedQuantity>0)status.push(text(projection.stagedQuantity)+' staged · awaiting invoice evidence');
    if(departures.length)status.push('SIM departure recorded · awaiting invoice');
    if(inv.length)status.push('Invoice records available');
    const wo=p.actionable?'<button type="button" class="sales-order-dashboard-work-order-link" data-related-row-index="'+index+'" onclick="openSalesOrderDashboardWorkOrder(event)">'+esc(p.primary)+'</button>':esc(p.primary);
    return '<tr><td><input type="checkbox" aria-label="Select line '+esc(id.lineNumber)+'" data-related-row-index="'+index+'" onchange="selectSalesOrderDashboardWorkOrder(event)" '+(selected?'checked':'')+'></td><td><small>Line '+esc(id.lineNumber)+'</small><strong>'+esc(o.partNumber)+'</strong><span>Rev '+esc(m.drawingRevision || m.bomRevision || 'not recorded')+'</span></td><td>'+wo+'<small>'+esc(p.secondary)+'</small></td><td><span>Ordered '+esc(text(o.quantityOrdered ?? m.quantityOrdered))+'</span><span>Remaining '+esc(text(o.opQtyOpen ?? projection.operationalRemainingQuantity))+'</span></td><td>'+esc(text(o.customerDueDate))+'<small>Est. ship '+esc(text(o.dueDate))+'</small></td><td>'+status.map(s=>'<span class="so-folder-badge">'+esc(s)+'</span>').join('')+'</td></tr>';
  }
  function renderDocuments() {
    const node=document.getElementById('soFolderDocuments');
    if(evidence.loading){node.textContent='Loading order documents…';return;}
    node.innerHTML='<h4>Customer PO</h4>'+(evidence.errors.documents || evidence.errors.identity?'<p>PO documents unavailable from the current source.</p>':evidence.documents.length?evidence.documents.map(d=>'<p><a target="_blank" rel="noopener noreferrer" href="'+esc(d.url)+'" '+(/\.pdf$/i.test(d.name)?'data-po-preview':'')+'>'+esc(d.name)+'</a><small> '+(/\.pdf$/i.test(d.name)?'PDF · opens in a new tab':'Download · browser preview may not be available')+'</small></p>').join(''):'<p>No retained PO is linked to this order.</p>')+'<h4>Packing &amp; shipping</h4><p>Final packing slips and shipping-document archive are not available in this view.</p><div data-folder-previews></div>';
    node.querySelectorAll('[data-po-preview]').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      void openPoPreview(link.href, node);
    }));
    const previews=node.querySelector('[data-folder-previews]'),id=identity(currentOrder);
    for(const item of evidence.shipping)for(const a of item.value?.authorizations || []){
      if(!sameOrder(a.context,id))continue;
      const card=document.createElement('details');card.innerHTML='<summary>SIM previews · line '+esc(a.context.lineNumber)+' · '+esc(a.quantity)+' '+esc(a.context.uom)+' · '+esc(a.state)+'</summary><p>Preview only; not a final shipment document.</p>';
      window.ShippingPrint?.attach(card,item.value,a,{cards:true});previews.append(card);
    }
  }
  async function openPoPreview(url, node) {
    // Same authenticated fetch/blob preview pattern as the New Order PDF viewer.
    // The retained-file endpoint deliberately sends attachment headers; the verified
    // PDF bytes get a browser-local URL so the native viewer can display them inline.
    const popup = window.open('about:blank', '_blank');
    const report = message => {
      let status = node.querySelector('[data-po-preview-status]');
      if (!status) { status=document.createElement('p'); status.dataset.poPreviewStatus=''; status.setAttribute('role','status'); node.append(status); }
      status.textContent=message;
    };
    if (!popup) { report('Allow pop-ups to open the customer PO in a new tab.'); return; }
    popup.opener = null;
    try {
      const response = await fetch(url, {credentials:'same-origin', cache:'no-store'});
      if (!response.ok) throw new Error('Customer PO unavailable ('+response.status+').');
      const blob = await response.blob();
      if (blob.type.split(';')[0].toLowerCase() !== 'application/pdf' ||
          !(await blob.slice(0,1024).text()).includes('%PDF-'))
        throw new Error('This file cannot be previewed as a PDF. Use its download link.');
      if (popup.closed) return;
      const previewUrl = URL.createObjectURL(blob);
      popup.location.replace(previewUrl);
      // Keep the URL valid for native viewer print/download, even during a long review.
      const cleanup = window.setInterval(() => {
        if (popup.closed) { URL.revokeObjectURL(previewUrl); window.clearInterval(cleanup); }
      }, 2000);
      report('Customer PO opened in a new tab. Use the PDF viewer to print or download.');
    } catch (error) {
      popup.close(); report(error.message || 'Customer PO preview unavailable.');
      const download=document.createElement('a'); download.href=url; download.target='_blank'; download.rel='noopener noreferrer'; download.textContent=' Download retained file';
      node.querySelector('[data-po-preview-status]').append(download);
    }
  }
  function table(headers,data) {return '<div class="so-folder-scroll"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+data.map(row=>'<tr>'+row.map(x=>'<td>'+esc(text(x))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  function renderHistory() {
    const node=document.getElementById('soFolderHistory');
    if(evidence.loading){node.textContent='Loading order history…';return;}
    const id=identity(currentOrder);
    const inv=evidence.errors.invoices || evidence.errors.identity?'<p>Invoice history unavailable. This does not mean there are no invoices.</p>':evidence.invoices.length?table(['Invoice / line','SO line','Invoiced','Qty shipped'],evidence.invoices.map(r=>[r.invoiceNumber+' / '+r.invoiceLineNumber,r.salesOrderLineNumber,date(r.invoiceDate),r.quantityShipped])):'<p>No invoice records for this customer / sales order.</p>';
    const historyRows=Array.isArray(evidence.shipments?.records)?evidence.shipments.records:null;
    let shipment=historyRows?table(['Shipment','SO line','Recorded','Qty'],historyRows.filter(r=>String(r.customerNumber)===id.customerNumber && String(r.salesOrder)===id.salesOrderNumber).map(r=>[r.shipmentId,r.salesOrderLine,date(r.shipmentDateTime),r.quantityShipped])):'<p>Shipment history source unavailable in SIM. A complete dispatch history cannot be shown.</p>';
    if(historyRows && !historyRows.some(r=>String(r.customerNumber)===id.customerNumber && String(r.salesOrder)===id.salesOrderNumber))shipment='<p>No shipment records for this customer / sales order in the available source.</p>';
    const departures=evidence.shipping.flatMap(x=>x.value?.authorizations||[]).filter(a=>a.state==='SIM_SHIPPED_AWAITING_INVOICE' && sameOrder(a.context,id));
    if(departures.length)shipment+='<h4>SIM departures · awaiting invoice</h4>'+table(['Reference','SO line','Recorded','Qty'],departures.map(a=>[a.id,a.context.lineNumber,date(a.departure?.recordedAt),a.quantity]));
    if(evidence.shipping.some(x=>x.error))shipment+='<p class="so-folder-hint">SIM shipping details are unavailable for some jobs; an approved bound traveler may be required.</p>';
    node.innerHTML='<h4>Invoices</h4>'+inv+'<h4>Shipments</h4>'+shipment;
  }
  window.SalesOrderFolder={mount,render};
})(window, document);


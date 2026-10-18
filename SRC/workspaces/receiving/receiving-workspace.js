(function registerReceivingWorkspace(window, document) {
  'use strict';

  const ENDPOINT = '/api/sim/receiving/expected';
  const state = {
    items: [], planning: null, selectedId: null, busy: false, error: '', request: 0,
    view: 'expected', po: null, poId: null, draft: null, dirty: false, message: '', document: null, idempotency: new Map(),
    sort: 'expectedDate', direction: 'asc',
    filters: { search: '', expectedFrom: '', expectedTo: '', workOrder: '', supplier: '', po: '', part: '', status: '' }
  };
  let mount;
  const text = value => String(value ?? '').trim();
  const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list = value => Array.isArray(value) ? value : [];
  const unique = values => Array.from(new Set(values.map(text).filter(Boolean)));
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value))
    ? value.slice(5, 7) + '/' + value.slice(8, 10) + '/' + value.slice(0, 4) : 'Not established';
  const numeric = value => value !== null && value !== undefined && text(value) !== '' && Number.isFinite(Number(value));
  const quantity = value => numeric(value) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 8 }) : 'Not recorded';
  const coverage = item => list(item.coverage);
  const workOrders = item => unique(coverage(item).map(row => row.workOrderNumber));
  const dueDates = item => unique(coverage(item).map(row => row.customerDueDate)).sort();
  const status = item => Number(item.openQuantity) === 0 && Number(item.receivedQuantity) > 0 ? 'Received / Disposition recorded'
    : Number(item.receivedQuantity) > 0 ? 'Partially received' : item.status === 'EXPECTED' && item.receiptState === 'AWAITING_RECEIPT'
    ? 'Expected / Awaiting receipt' : text(item.receiptState || item.status) || 'Not established';
  const money = (value, currency) => numeric(value)
    ? text(currency) + ' ' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : 'Not recorded';
  const includes = (value, search) => text(value).toLocaleLowerCase().includes(text(search).toLocaleLowerCase());

  function sortValue(item, key) {
    if (key === 'workOrder') return workOrders(item).join(' ');
    if (key === 'po') return text(item.poNumber) + ' / ' + text(item.poLine);
    if (key === 'part') return item.partNumber;
    if (key === 'status') return status(item);
    return item[key];
  }

  // Sorting and filtering operate on PO lines, never expand coverage into duplicate receipts.
  function buildViewModel(items, filters = {}, sort = 'expectedDate', direction = 'asc') {
    const rows = list(items).filter(item => {
      const jobs = coverage(item);
      const searchable = [item.supplier, item.poNumber, item.poLine, item.partNumber, item.approvedPartNumber,
        item.vendorPartNumber, item.description, item.expectedDate, date(item.expectedDate), status(item),
        ...jobs.flatMap(job => [job.workOrderNumber, job.salesOrderNumber, job.salesOrderLineNumber,
          job.customer, job.assemblyItemNumber, job.revision, job.customerDueDate, date(job.customerDueDate)])].join(' ');
      return includes(searchable, filters.search) && includes(workOrders(item).join(' '), filters.workOrder)
        && includes(item.supplier, filters.supplier) && includes(text(item.poNumber) + ' / ' + text(item.poLine), filters.po)
        && includes([item.partNumber, item.approvedPartNumber, item.vendorPartNumber].join(' '), filters.part)
        && (!filters.status || item.status === filters.status)
        && (!filters.expectedFrom || (item.expectedDate && item.expectedDate >= filters.expectedFrom))
        && (!filters.expectedTo || (item.expectedDate && item.expectedDate <= filters.expectedTo));
    });
    rows.sort((a, b) => {
      const av = text(sortValue(a, sort)), bv = text(sortValue(b, sort));
      // Unknown expected dates stay last in both directions.
      if (!av || !bv) return av ? -1 : bv ? 1 : text(a.expectedReceiptId).localeCompare(text(b.expectedReceiptId));
      const result = av.localeCompare(bv, 'en-US', { numeric: sort !== 'expectedDate', sensitivity: 'base' });
      return (direction === 'desc' ? -result : result) || text(a.expectedReceiptId).localeCompare(text(b.expectedReceiptId));
    });
    return { rows, total: list(items).length };
  }

  function filterInput(name, label, type = 'search') {
    return '<label>' + label + '<input type="' + type + '" data-receiving-filter="' + name + '" value="' +
      esc(state.filters[name]) + '"' + (type === 'date' ? ' aria-label="' + label + ' (MM/DD/YYYY)"' : '') + '></label>';
  }

  const cs = { rows: [], selected: null, draft: {}, docs: [] };
  const csPath = id => '/customer/' + encodeURIComponent(id);
  function csMarkup() {

    if (state.busy) return '<p role="status">Loading customer receipts.</p>';
    const item = cs.selected;
    const header = '<h2>Customer-supplied material</h2><p>Receipt acknowledgment by customer, job and part. Record only material received; acceptance and staging do not complete the kit.</p>';
    if (!item) return header + (state.error?'<p role="alert">'+esc(state.error)+'</p>':'') + cs.rows.filter(x => includes([x.demand.customer,x.demand.workOrderNumber,x.demand.partNumber].join(' '),state.filters.search)).map(x =>
      '<section class="receiving-detail"><strong>' + esc(x.demand.customer) + ' · WO ' + esc(x.demand.workOrderNumber) + ' · ' + esc(x.demand.partNumber) + '</strong><p>' +
      quantity(x.receivedQuantity) + ' received · ' + quantity(x.openQuantity) + ' awaiting receipt (' + esc(x.demand.uom) + ')</p><button type="button" data-cs-open="' + esc(x.demand.demandId) + '">Open receipt acknowledgment</button></section>').join('');
    const d=item.demand, v=cs.draft, disabled=state.busy||!item.canReceive?' disabled':'';
    const input=(key,label,type='text')=>'<label>'+esc(label)+'<input data-cs-field="'+key+'" type="'+type+'" value="'+esc(v[key]||'')+'"'+(type==='number'?' min="0" step="any"':'')+disabled+'></label>';
    const select=(key,label,values)=>'<label>'+esc(label)+'<select data-cs-field="'+key+'"'+disabled+'>'+options(values,v[key]||'')+'</select></label>';
    const policies=[['cocRequired','CoC'],['materialCertRequired','Material certificate'],['traceabilityRequired','Material traceability'],['inspectionRequired','Additional inspection']];
    const checks=[['packingSlip','Receipt acknowledgment matches delivery'],['partIdentity','Part identity matches'],...checkLabels.slice(2),['coc','CoC verified'],['materialCert','Material certificate verified'],['traceability','Traceability verified'],['specialInspection','Additional inspection passed']];
    return header + '<section class="receiving-detail receiving-po"><button type="button" data-cs-close>Back to customer material</button><h3>'+esc(d.customer)+' · WO '+esc(d.workOrderNumber)+' · '+esc(d.partNumber)+'</h3><p>'+quantity(item.openQuantity)+' '+esc(d.uom)+' awaiting receipt</p>'+
      (state.error?'<p role="alert">'+esc(state.error)+'</p>':'')+
      (state.message?'<p role="status">'+esc(state.message)+'</p>':'')+
      (item.openQuantity>0?'<div class="receiving-form-grid">'+input('acknowledgmentNumber','Acknowledgment reference')+input('receivedDate','Received date','date')+input('countedQuantity','Received count','number')+input('acceptedQuantity','Accepted','number')+input('holdQuantity','Hold','number')+input('rejectedQuantity','Rejected','number')+input('observedPartNumber','Observed part number')+input('notes','Receipt notes')+'</div><p>Received = Accepted + Hold + Rejected.</p><details open><summary>Acceptance requirements and evidence</summary><p>Required evidence remains required. Review any unknown applicability explicitly.</p><div class="receiving-form-grid">'+policies.map(([key,label])=>select(key,label,[['','Review applicability'],['true','Required'],['false','Not required']])).join('')+input('requirementsReason','Applicability reason')+'</div><div class="receiving-checks">'+checks.map(([key,label])=>select('check_'+key,label,[['','Select result'],['PASS','Pass'],['FAIL','Fail'],['NOT_APPLICABLE','Not applicable']])).join('')+'</div><div class="receiving-form-grid">'+[['PACKING_SLIP','Acknowledgment attachment'],['COC','CoC'],['MATERIAL_CERT','Material certificate'],['TRACEABILITY','Traceability'],['INSPECTION','Inspection']].map(([kind,label])=>'<label>'+label+'<input type="file" data-cs-upload="'+kind+'" accept="application/pdf,image/*"'+disabled+'></label>').join('')+'</div>'+cs.docs.map(retainedDocumentLink).join(' ')+'</details><button type="button" data-cs-receive'+disabled+'>Record customer receipt acknowledgment</button>':'')+
      '<h3>Received material</h3>'+item.materials.map(m=>'<section class="receiving-material"><strong>'+esc(m.receiptLineId)+'</strong><p>Received '+quantity(m.receivedQuantity)+' · Accepted '+quantity(m.acceptedQuantity)+' · Hold '+quantity(m.holdQuantity)+' · Rejected '+quantity(m.rejectedQuantity)+' · Applied '+quantity(m.appliedQuantity)+' · Available '+quantity(m.availableQuantity)+'</p><p>Acknowledgment '+esc(m.packingSlipNumber)+'</p>'+m.evidenceDocuments.map(retainedDocumentLink).join(' ')+(m.stagedAtUtc?'<p>Staged: '+esc(m.stagingLocation)+'</p>':m.acceptedQuantity>0?'<label>Staging location<input data-cs-field="stage_'+esc(m.receiptLineId)+'" value="'+esc(v['stage_'+m.receiptLineId]||'')+'"'+disabled+'></label><button type="button" data-cs-stage="'+esc(m.receiptLineId)+'"'+disabled+'>Record staging</button>':'')+'</section>').join('')+'</section>';
  }
  async function csLoad(id) {
    state.busy=true;state.error='';draw();
    try { cs.rows=await api('/customer');cs.selected=id?await api(csPath(id)):null;
      const q=cs.selected?.materials[0]?.requirements||cs.selected?.demand.qualityRequirements||{};
      cs.draft={holdQuantity:'0',rejectedQuantity:'0',...Object.fromEntries(['cocRequired','materialCertRequired','inspectionRequired'].map(k=>[k,typeof q[k]==='boolean'?String(q[k]):''])),traceabilityRequired:typeof q.poTraceabilityRequired==='boolean'?String(q.poTraceabilityRequired):''};
      cs.docs=cs.selected?.documents||[];state.dirty=false;
    }catch(e){state.error=e.message;}finally{state.busy=false;draw();}
  }
  async function csCommand(kind,id,file) {
    if(!cs.selected?.canReceive||state.busy)return;
    state.busy=true;state.error='';state.message='';
    const item=cs.selected,d=item.demand,v=cs.draft;
    try {
      if(kind==='upload') {
        const doc=await api(csPath(d.demandId)+'/documents?kind='+encodeURIComponent(id)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'X-SIM-Document-Upload':'1','Content-Type':file.type||'application/octet-stream'},body:file});cs.docs.push(doc);
      }else if(kind==='stage') {
        const m=item.materials.find(m=>m.receiptLineId===id);
        const updated=await post('/accepted-material/'+encodeURIComponent(id)+'/stage',{expectedVersion:m.version,location:v['stage_'+id]||''});
        cs.selected.materials=item.materials.map(x=>x.receiptLineId===id?updated:x);state.message='Staged. Kitting must still apply the material.';
      }else {
        const body={expectedVersion:item.version,expectedDemandVersion:d.version,expectedSubmissionId:d.submissionId,expectedSourceFingerprint:d.sourceFingerprint,
          acknowledgmentNumber:v.acknowledgmentNumber||'',receivedDate:v.receivedDate||'',observedPartNumber:v.observedPartNumber||'',notes:v.notes||'',requirementsReason:v.requirementsReason||'',
          checks:Object.fromEntries(Object.entries(v).filter(([k])=>k.startsWith('check_')).map(([k,value])=>[k.slice(6),value])),evidenceDocumentIds:cs.docs.map(x=>x.documentId)};
        for(const k of ['countedQuantity','acceptedQuantity','holdQuantity','rejectedQuantity'])body[k]=amount(v[k],k);
        for(const k of ['cocRequired','materialCertRequired','traceabilityRequired','inspectionRequired']){if(!['true','false'].includes(v[k]))throw Error('Review every acceptance requirement.');body[k]=v[k]==='true';}
        cs.selected=await post(csPath(d.demandId)+'/receive',body);cs.draft={...v,acknowledgmentNumber:'',countedQuantity:'',acceptedQuantity:'',holdQuantity:'0',rejectedQuantity:'0'};state.dirty=false;state.message='Receipt acknowledged. Accepted material must still be staged and allocated by Kitting.';
      }
    }catch(e){state.error=e.message;}finally{state.busy=false;draw();}
  }

  function chrome() {
    return '<section class="receiving-workspace" aria-label="Receiving"><header class="receiving-header"><div><h1>Receiving</h1>' +
      '<p>Expected supply · Receiving · Accepted material</p></div><button type="button" data-receiving-action="refresh"' +
      (state.busy ? ' disabled' : '') + '>Refresh</button></header>' +
      '<p class="receiving-notice">Operational SIM Receiving. Accepted material remains separate from Kitting completion and VPRO accounting receipts.</p>' +
      '<nav class="receiving-views" aria-label="Receiving views">' + [['expected', 'Expected / Awaiting Receipt'], ['received', 'Received / History'], ['customer','Customer-supplied']].map(([key, label]) => '<button type="button" data-receiving-view="' + key + '" aria-pressed="' + (state.view === key) + '">' + label + ' · ' + (key==='customer'?cs.rows.length:queueItems(state.items, key).length) + '</button>').join('') + '</nav>' +
      '<div class="receiving-toolbar">' + filterInput('search', 'Search material') +
      '<details class="receiving-filters"><summary>Filter by date, job or supplier</summary><div>' +
      filterInput('expectedFrom', 'Expected from', 'date') + filterInput('expectedTo', 'Expected through', 'date') +
      filterInput('workOrder', 'WO') + filterInput('supplier', 'Supplier') + filterInput('po', 'PO / Line') + filterInput('part', 'Part number') +
      '<label>Status<select data-receiving-filter="status"><option value="">All PO lines</option>' +
      [['EXPECTED', 'Expected / Awaiting receipt'], ['PARTIALLY_RECEIVED', 'Partially received'], ['RECEIVED', 'Received']].map(([value, label]) =>
        '<option value="' + value + '"' + (state.filters.status === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
      '<button type="button" data-receiving-action="clear-filters">Clear filters</button></div></details></div>' +
      '<div data-receiving-results></div><div data-receiving-detail></div><div data-receiving-po></div></section>';
  }

  function column(label, key) {
    if (!key) return '<th scope="col">' + label + '</th>';
    const active = state.sort === key;
    return '<th scope="col" aria-sort="' + (active ? state.direction === 'asc' ? 'ascending' : 'descending' : 'none') +
      '"><button type="button" data-receiving-sort="' + key + '" aria-label="Sort by ' + label + '">' + label +
      (active ? state.direction === 'asc' ? ' ↑' : ' ↓' : '') + '</button></th>';
  }

  function resultsMarkup() {
    if (state.view==='customer') return csMarkup();
    if (state.error) return '<p role="alert" class="receiving-error">' + esc(state.error) + '</p>';
    if (state.busy) return '<p class="receiving-empty" role="status">Loading expected material…</p>';
    const model = buildViewModel(queueItems(state.items, state.view), state.filters, state.sort, state.direction);
    const summary = '<p class="receiving-count" role="status">' + model.rows.length + ' of ' + model.total + (state.view === 'expected' ? ' expected PO lines</p>' : ' received PO lines</p>');
    if (!model.rows.length) return summary + '<p class="receiving-empty">' + (model.total
      ? 'No PO lines match these filters.' : state.view === 'expected' ? 'No purchased material is awaiting receipt.' : 'No received material has been recorded.') + '</p>';
    return summary + '<div class="receiving-table-scroll" tabindex="0" aria-label="Expected material table"><table><thead><tr>' +
      column('Expected Date', 'expectedDate') + column('Supplier', 'supplier') + column('PO / Line', 'po') + column('DLE P/N', 'part') +
      column('Description') + column('Ordered') + column('Received') + column('Open') + column('UOM') + column('WO(s)', 'workOrder') +
      column('Customer Due') + column('Status', 'status') + column('Details') + '</tr></thead><tbody>' + model.rows.map(item => {
        const dates = dueDates(item), jobs = workOrders(item);
        return '<tr><td>' + esc(date(item.expectedDate)) + '</td><td>' + esc(item.supplier) + '</td><td><strong>' + esc(item.poNumber) +
          '</strong><small>Line ' + esc(item.poLine) + '</small></td><td><strong>' + esc(item.partNumber) + '</strong></td><td>' + esc(item.description) +
          '</td><td class="receiving-number">' + quantity(item.orderedQuantity) + '</td><td class="receiving-number">' + quantity(item.receivedQuantity) +
          '</td><td class="receiving-number"><strong>' + quantity(item.openQuantity) + '</strong></td><td>' + esc(item.purchasingUom) +
          '</td><td>' + jobs.map(esc).join('<br>') + '</td><td>' + (dates.length ? dates.map(value => esc(date(value))).join('<br>') : 'Not established') +
          '</td><td><span class="receiving-status">' + esc(status(item)) + '</span></td><td><button type="button" data-receiving-id="' +
          esc(item.expectedReceiptId) + '" aria-label="View PO ' + esc(item.poNumber) + ' line ' + esc(item.poLine) + '">View</button> ' +
          '<button type="button" data-receiving-open-po="' + esc(item.purchaseId) + '">' + (Number(item.openQuantity) > 0 ? 'Receive PO' : 'Open PO') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  const factList = entries => '<dl class="receiving-facts">' + entries.map(([label, value]) => '<div><dt>' + esc(label) +
    '</dt><dd>' + esc(value || 'Not established') + '</dd></div>').join('') + '</dl>';
  const requirement = value => value === true || value === 'REQUIRED' ? 'Required'
    : value === false || value === 'NOT_REQUIRED' ? 'Not required' : text(value) || 'Not established';
  const requirementSource = value => ({
    SUBMITTED_KITTING_REVIEWED_POLICY: 'Reviewed policy from submitted Kitting',
    SUBMITTED_KITTING_WITH_REVIEWED_AMENDMENT: 'Submitted Kitting with reviewed traceability amendment'
  }[value] || value);

  function detailsMarkup(item) {
    if (!item) return '';
    const q = item.qualityRequirements || {}, jobs = coverage(item);
    const extra = item.excessQuantity;
    // Only explicitly reviewed fields govern the visible policy. The original broad
    // contract evidence remains audit context, not an alternative material policy.
    const quality = [['Material / supplier-PO traceability', requirement(q.poTraceabilityRequired)],
      ['Certificate of Conformance (CoC)', requirement(q.cocRequired)], ['Material certification', requirement(q.materialCertRequired)],
      ['Inspection', requirement(q.inspectionRequired)], ['Traveler / production traceability', requirement(q.travelerRequired)],
      ['Special receiving notes', q.specialReceivingNotes], ['Reviewed requirement source', requirementSource(q.evidenceSource)]];
    return '<section class="receiving-detail" aria-label="Expected PO line details"><div class="receiving-detail-title"><h2>PO ' +
      esc(item.poNumber) + ' / ' + esc(item.poLine) + '</h2><button type="button" data-receiving-action="close-detail">Close details</button></div>' +
      '<div class="receiving-actions"><button type="button" data-receiving-open-po="' + esc(item.purchaseId) + '">' + (Number(item.openQuantity) > 0 ? 'Receive PO' : 'Open PO / Accepted Material') + '</button></div>' +
      '<p><span class="receiving-status">' + esc(status(item)) + '</span> <strong>' + esc(item.partNumber) + '</strong> · ' + esc(item.description) + '</p>' +
      factList([['Supplier', item.supplier], ['MFG / Approved P/N', item.approvedPartNumber], ['Vendor P/N', item.vendorPartNumber],
        ['Ordered', quantity(item.orderedQuantity) + ' ' + text(item.purchasingUom)], ['Received', quantity(item.receivedQuantity)],
        ['Open', quantity(item.openQuantity)], ['Unit cost / ' + text(item.purchasingUom), money(item.unitCost, item.currency)],
        ['Extended cost', money(item.extendedCost, item.currency)], ['PO / Order date', date(item.orderDate)],
        ['Supplier requested date', date(item.requestedDate)], ['Supplier promised / expected date', date(item.expectedDate)],
        ['Material need-by', (state.planning?.workOrders || []).flatMap(w => w.demands || []).filter(d => jobs.some(j => j.demandId === d.demandId)).map(d => 'WO ' + d.workOrderNumber + ': ' + date(d.schedule?.materialNeedBy)).join(' · ') || 'Not established'], ['Acknowledgment / Confirmation', item.confirmation], ['Buyer', item.buyer],
        ['Excess / stock quantity', quantity(extra)], ['Excess purpose', item.excessPurpose], ['Purchase notes', item.notes]]) +
      '<h3>Demand / job coverage</h3><div class="receiving-table-scroll"><table><thead><tr><th>WO</th><th>SO / Line</th><th>Customer</th>' +
      '<th>Assembly / Rev</th><th>Customer Due</th><th>Coverage</th></tr></thead><tbody>' + jobs.map(job => '<tr><td>' + esc(job.workOrderNumber) +
        '</td><td>' + esc(job.salesOrderNumber) + ' / ' + esc(job.salesOrderLineNumber) + '</td><td>' + esc(job.customer) +
        '</td><td>' + esc(job.assemblyItemNumber) + ' / ' + esc(job.revision) + '</td><td>' + esc(date(job.customerDueDate)) +
        '</td><td>' + quantity(job.quantity) + ' ' + esc(item.purchasingUom) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<h3>Original Purchasing requirement context</h3><p class="receiving-notice">Open Receive PO for effective Receiving applicability and its reviewed history.</p>' + factList(quality) +
      '<details class="receiving-evidence"><summary>Purchase provenance and source references</summary>' +
      factList([['Provenance', item.provenance === 'SIMULATED_DEVELOPMENTAL' ? 'Simulated developmental — no real supplier order' : item.provenance],
        ['Expected PO-line identity', item.expectedReceiptId], ['Purchase identity', item.purchaseId], ['Buying plan', item.planId],
        ['Recorded at', item.createdAtUtc], ['Source shortage demand(s)', jobs.map(job => job.demandId).join(', ')],
        ['Original frozen PO traceability (history)', requirement(q.originalPoTraceabilityRequired)],
        ['Reviewed traceability amendment', q.traceabilityAmendmentId]]) + '</details>' +
      '<p class="receiving-notice">Receiving and acceptance do not resolve a Kitting shortage. Kitting must apply the material separately.</p></section>';
  }

  function drawResults() {
    const results = mount?.querySelector('[data-receiving-results]');
    if (results) results.innerHTML = resultsMarkup();
    const detail = mount?.querySelector('[data-receiving-detail]');
    if (detail) detail.innerHTML = state.error || state.busy || state.poId ? '' : detailsMarkup(state.items.find(item => item.expectedReceiptId === state.selectedId));
    const po = mount?.querySelector('[data-receiving-po]');
    if (po) po.innerHTML = state.poId ? poMarkup() : '';
  }

  function draw() { if (mount) { mount.innerHTML = chrome(); drawResults(); } }

  async function refresh() {
    const request = ++state.request;
    state.busy = true; state.error = ''; draw();
    try {
      const response = await window.fetch(ENDPOINT, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Expected material could not be loaded.');
      if (request !== state.request) return;
      let planning = null;
      try { planning = await window.MaterialStatus?.getSupplyProgress(); } catch (_) { /* Expected receipt remains available. */ }
      if (request !== state.request) return;
      state.planning = planning;
      state.items = list(result.items);
      if (!state.items.some(item => item.expectedReceiptId === state.selectedId)) state.selectedId = null;
    } catch (error) {
      if (request !== state.request) return;
      state.error = error.message || 'Expected material could not be loaded.';
    } finally {
      if (request === state.request) { state.busy = false; draw(); }
    }
  }

  async function render() {
    if (document.body?.dataset?.simRuntime !== 'true') return;
    mount = document.querySelector('[data-workspace-mount="receiving"]');
    if (!mount) return;
    mount.onclick = event => {
      const button = event.target?.closest?.('button');
      if (!button || state.busy) return;
      if (button.dataset.csOpen) { if(mayDiscard())void csLoad(button.dataset.csOpen);return; }
      if (button.dataset.csClose !== undefined) { if(mayDiscard())void csLoad();return; }
      if (button.dataset.csReceive !== undefined) { void csCommand('receive');return; }
      if (button.dataset.csStage) { void csCommand('stage',button.dataset.csStage);return; }
      if (button.dataset.receivingOpenPo) { void openPo(button.dataset.receivingOpenPo); return; }
      if (button.dataset.receivingView) { if (!mayDiscard()) return; state.view = button.dataset.receivingView; state.po = null; state.poId = null; state.draft = null; state.dirty = false; state.selectedId = null; if(state.view==='customer'){void csLoad();return;} draw(); return; }
      if (button.dataset.receivingCommand) { void runCommand(button.dataset.receivingCommand, button.dataset.receivingMaterial); return; }
      const action = button.dataset.receivingAction, sort = button.dataset.receivingSort;
      if (action === 'refresh') { if (!mayDiscard()) return; if(state.view==='customer'){void csLoad(cs.selected?.demand.demandId);return;} if (state.poId) void openPo(state.poId, true); else void refresh(); return; }
      if (action === 'clear-filters') { Object.keys(state.filters).forEach(key => state.filters[key] = ''); draw(); return; }
      if (action === 'close-detail') state.selectedId = null;
      if (button.dataset.receivingId) state.selectedId = button.dataset.receivingId;
      if (sort) { state.direction = state.sort === sort && state.direction === 'asc' ? 'desc' : 'asc'; state.sort = sort; }
      drawResults();
    };
    mount.oninput = event => {
      if(event.target?.dataset?.csField){cs.draft[event.target.dataset.csField]=event.target.value;state.dirty=true;return;}
      if (updateDraft(event.target)) return;
      const key = event.target?.dataset?.receivingFilter;
      if (!Object.prototype.hasOwnProperty.call(state.filters, key)) return;
      state.filters[key] = event.target.value; drawResults();
    };
    mount.onchange = event => { if(event.target?.dataset?.csUpload){const f=event.target.files?.[0];if(f)void csCommand('upload',event.target.dataset.csUpload,f);return;} if (event.target?.dataset?.receivingUpload !== undefined) { void uploadDocument(event.target.files?.[0], event.target.dataset); return; } mount.oninput(event); };
    await refresh();
  }

  const API = '/api/sim/receiving';
  const checkLabels = [['packingSlip', 'Packing slip present / matched'], ['partIdentity', 'Part identity matches PO'],
    ['uom', 'UOM matches'], ['physicalCount', 'Physical count recorded'], ['condition', 'Packaging / condition acceptable'],
    ['damage', 'No visible damage / discrepancy recorded'], ['inspection', 'Quick receiving inspection']];
  const qualityLabels = [['cocRequired', 'Supplier CoC', 'coc'], ['materialCertRequired', 'Material certificates', 'materialCert'],
    ['poTraceabilityRequired', 'Material / supplier-PO traceability', 'traceability'], ['inspectionRequired', 'Additional inspection', 'specialInspection']];
  const poLines = po => list(po?.lines);
  const purchaseOf = line => line.purchase || line;
  const lineQuality = line => line.requirements || purchaseOf(line).qualityRequirements || {};
  const openQuantity = line => line.openQuantity ?? purchaseOf(line).openQuantity;
  const commandDisabled = () => state.busy || state.po?.canReceive !== true ? ' disabled' : '';
  const localDate = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US',
    { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : 'Not established';
  const newId = () => window.crypto.randomUUID();

  function queueItems(items, view = 'expected') {
    return list(items).filter(item => view === 'received' ? Number(item.receivedQuantity) > 0 : Number(item.openQuantity) > 0);
  }

  // Loading the review form never infers physical counts or writes Receiving facts.
  function createDraft(po) {
    const draft = { packingSlipNumber: '', packingSlipDate: '', carrier: '', trackingNumber: '', notes: '', documentId: '',
      reason: '', lines: {}, requirements: {}, stage: {} };
    poLines(po).forEach(line => {
      const p = purchaseOf(line), quality = lineQuality(line), id = p.purchaseId;
      draft.lines[id] = { packingSlipQuantity: '', countedQuantity: '', acceptedQuantity: '', holdQuantity: '0', rejectedQuantity: '0',
        observedPartNumber: '', discrepancyReason: '', evidenceDocuments: [], checks: Object.fromEntries(checkLabels.map(([key]) => [key, ''])),
        coverage: Object.fromEntries(coverage(p).map(job => [job.demandId, { quantity: '', receivedQuantity: '', holdQuantity: '0', rejectedQuantity: '0' }])) };
      draft.requirements[id] = Object.fromEntries(qualityLabels.map(([key]) => [key, typeof quality[key] === 'boolean' ? String(quality[key]) : '']));
      qualityLabels.forEach(([key, , check]) => { if (check) draft.lines[id].checks[check] = quality[key] === false ? 'NOT_APPLICABLE' : ''; });
    });
    return draft;
  }

  function mayDiscard() { return !state.dirty || window.confirm('Discard the unsaved Receiving entries? Recorded receipts and accepted material are preserved.'); }
  async function api(path, options = {}) {
    const response = await window.fetch(API + path, { credentials: 'same-origin', cache: 'no-store', ...options });
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType && !contentType.includes('json')) throw new Error('Receiving session is unavailable. Unlock SIM and refresh.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || 'Receiving request failed (' + response.status + ').');
    return result;
  }
  function idempotentRequest(path, body) {
    const fingerprint = path + ':' + JSON.stringify(body);
    if (!state.idempotency.has(fingerprint)) state.idempotency.set(fingerprint, newId());
    return { ...body, requestId: state.idempotency.get(fingerprint) };
  }
  async function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(idempotentRequest(path, body)) });
  }
  async function openPo(purchaseId, force = false) {
    if (!force && !mayDiscard()) return;
    state.busy = true; state.message = 'Loading PO Receiving…'; state.error = ''; state.poId = purchaseId; draw();
    try {
      state.po = await api('/po/' + encodeURIComponent(purchaseId));
      state.draft = createDraft(state.po); state.document = null; state.dirty = false; state.message = '';
    } catch (error) { state.po = null; state.message = ''; state.error = error.message; }
    finally { state.busy = false; draw(); }
  }
  const field = (key, label, value = '', type = 'text', attributes = '', lineId = '') => '<label>' + esc(label) +
    '<input type="' + type + '" data-receiving-field="' + esc(key) + '"' + (lineId ? ' data-receiving-line="' + esc(lineId) + '"' : '') +
    ' value="' + esc(value) + '"' + (type === 'number' ? ' min="0" step="any" inputmode="decimal"' : '') +
    (type === 'date' ? ' aria-label="' + esc(label) + ' (MM/DD/YYYY)"' : '') + attributes + commandDisabled() + '></label>';
  const options = (values, selected) => values.map(([value, label]) => '<option value="' + esc(value) + '"' +
    (selected === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('');

  function requirementsMarkup() {
    const unknown = poLines(state.po).some(line => qualityLabels.some(([key]) => typeof lineQuality(line)[key] !== 'boolean'));
    return '<details class="receiving-requirements"' + (unknown ? ' open' : '') + '><summary>Reviewed Receiving requirements' +
      (unknown ? ' · Applicability review needed' : '') + '</summary><p class="receiving-notice">Review supplier requirements explicitly. Finished-assembly CoC and production Traveler requirements remain separate. Changes create an audited review; the original purchase is preserved.</p>' +
      poLines(state.po).map(line => {
        const p = purchaseOf(line), q = lineQuality(line), draft = state.draft.requirements[p.purchaseId];
        return '<section class="receiving-policy"><h4>Line ' + esc(p.poLine) + ' · ' + esc(p.partNumber) + '</h4><div class="receiving-form-grid">' +
          qualityLabels.map(([key, label]) => Number(line.receivedQuantity ?? p.receivedQuantity) > 0
            ? '<div class="receiving-policy-badge"><span>' + label + '</span><strong>' + esc(requirement(q[key])) + ' · Frozen at receipt</strong></div>'
            : '<label>' + label + '<select data-receiving-requirement="' + key + '" data-receiving-line="' + esc(p.purchaseId) + '"' + commandDisabled() + '>' +
            options([['', 'Not established — review'], ['true', 'Required'], ['false', 'Not Required']], draft[key]) + '</select></label>').join('') + '</div>' +
          '<p class="receiving-notice">Traveler / production traceability: ' + esc(requirement(p.qualityRequirements?.travelerRequired)) + ' (unchanged)' +
          (q.reviewId ? ' · Reviewed applicability recorded' : '') + '</p></section>';
      }).join('') + field('reason', 'Reason for applicability review', state.draft.reason) +
      '<button type="button" data-receiving-command="review-requirements"' + commandDisabled() + '>Record Requirements Review</button></details>';
  }
  function checklistMarkup(line, draft) {
    const p = purchaseOf(line), quality = lineQuality(line);
    const check = (key, label) => '<label>' + esc(label) + '<select data-receiving-check="' + key + '" data-receiving-line="' + esc(p.purchaseId) + '"' + commandDisabled() + '>' +
      options([['', 'Select result'], ['PASS', 'Pass'], ['FAIL', 'Fail'], ...(key !== 'physicalCount' ? [['NOT_APPLICABLE', 'Not applicable']] : [])], draft.checks[key]) + '</select></label>';
    const documentKind = { coc: 'COC', materialCert: 'MATERIAL_CERT', traceability: 'TRACEABILITY', specialInspection: 'INSPECTION' };
    return '<div class="receiving-checks">' + checkLabels.map(([key, label]) => check(key, label)).join('') +
      qualityLabels.filter(([, , key]) => key).map(([policy, label, key]) => quality[policy] === false
        ? '<div class="receiving-policy-badge"><span>' + label + '</span><strong>Not Required</strong></div>'
        : quality[policy] === true ? check(key, label + ' evidence verified') + evidenceUpload(p.purchaseId, documentKind[key], label)
        : '<div class="receiving-policy-badge"><span>' + label + '</span><strong>Applicability review needed</strong></div>').join('') +
      '</div>' +
      list(draft.evidenceDocuments).map(doc => '<a class="receiving-document-link" target="_blank" rel="noopener" href="' + esc(doc.url) + '">' + esc(doc.fileName) + '</a>').join(' ');
  }
  function evidenceUpload(purchaseId, kind, label) {
    return '<label>' + esc(label) + ' document<input type="file" data-receiving-upload data-receiving-line="' + esc(purchaseId) +
      '" data-receiving-kind="' + kind + '" accept="application/pdf,image/*"' + commandDisabled() + '></label>';
  }
  function retainedDocumentLink(doc) {
    if (!doc?.documentId || !doc.purchaseId) return '';
    const url = API + (doc.customerDemandId?csPath(doc.customerDemandId):'/po/' + encodeURIComponent(doc.purchaseId)) + '/documents/' + encodeURIComponent(doc.documentId);
    return '<a class="receiving-document-link" target="_blank" rel="noopener" href="' + esc(url) + '">View ' +
      esc(doc.document?.name || 'Receiving evidence') + '</a>';
  }
  function printLink(kind, id, label) {
    const url = '/SRC/workspaces/receiving/receiving-print-preview.html?kind=' + kind + '&id=' + encodeURIComponent(id);
    return '<a class="receiving-print-link" target="_blank" rel="noopener" href="' + esc(url) + '">' + label + '</a>';
  }
  function coverageMarkup(p, draft) {
    if (coverage(p).length === 1 && Number(p.excessQuantity || 0) === 0) return '<p class="receiving-notice">Accepted quantity is assigned to WO ' +
      esc(coverage(p)[0].workOrderNumber) + ' through its existing shortage demand. Kitting allocation is unchanged.</p>';
    return '<details open><summary>Assign counted and accepted material to demand</summary><p class="receiving-notice">Review each allocation explicitly. Unassigned accepted material is not available to a job.</p>' +
      '<div class="receiving-coverage-grid">' + coverage(p).map(job => '<section><strong>WO ' + esc(job.workOrderNumber) + ' · Coverage ' + quantity(job.quantity) + '</strong>' +
        '<div class="receiving-form-grid">' + [['receivedQuantity', 'Counted for job'], ['quantity', 'Accepted for job'], ['holdQuantity', 'Hold for job'], ['rejectedQuantity', 'Rejected for job']].map(([key, label]) =>
          '<label>' + label + '<input type="number" min="0" step="any" inputmode="decimal" data-receiving-coverage="' + esc(job.demandId) + '" data-receiving-field="' + key +
          '" data-receiving-line="' + esc(p.purchaseId) + '" value="' + esc(draft.coverage[job.demandId][key]) + '"' + commandDisabled() + '></label>').join('') + '</div></section>').join('') + '</div></details>';
  }
  function receivingLineMarkup(line) {
    const p = purchaseOf(line), draft = state.draft.lines[p.purchaseId], open = Number(openQuantity(line));
    return '<section class="receiving-line" aria-label="Receiving PO line ' + esc(p.poLine) + '"><h3>Line ' + esc(p.poLine) + ' · ' + esc(p.partNumber) + '</h3><p>' + esc(p.description) + '</p>' +
      factList([['Expected MFG / vendor P/N', p.vendorPartNumber || p.approvedPartNumber], ['Ordered', quantity(p.orderedQuantity) + ' ' + text(p.purchasingUom)],
        ['Previously received', quantity(line.receivedQuantity ?? p.receivedQuantity)], ['Open to receive', quantity(open) + ' ' + text(p.purchasingUom)],
        ['Supplier ETA', date(p.expectedDate)], ['WO coverage', workOrders(p).join(', ')]]) +
      (open <= 0 ? '<p class="receiving-notice">Fully received. Prior evidence remains available below.</p>' :
        '<div class="receiving-form-grid receiving-quantities">' +
        field('packingSlipQuantity', 'Packing-slip quantity', draft.packingSlipQuantity, 'number', '', p.purchaseId) +
        field('countedQuantity', 'Receive Now — physical count (' + text(p.purchasingUom) + ')', draft.countedQuantity, 'number', ' max="' + esc(open) + '"', p.purchaseId) +
        field('acceptedQuantity', 'Accepted', draft.acceptedQuantity, 'number', '', p.purchaseId) +
        field('holdQuantity', 'Hold', draft.holdQuantity, 'number', '', p.purchaseId) +
        field('rejectedQuantity', 'Rejected', draft.rejectedQuantity, 'number', '', p.purchaseId) + '</div>' +
        '<p class="receiving-notice">Counted = Accepted + Hold + Rejected. Leave Receive Now blank for lines not in this delivery.</p>' +
        '<div class="receiving-form-grid">' + field('observedPartNumber', 'Observed supplier / MFG P/N (if needed)', draft.observedPartNumber, 'text', '', p.purchaseId) +
        field('discrepancyReason', 'Discrepancy / hold / rejection reason', draft.discrepancyReason, 'text', '', p.purchaseId) + '</div>' +
        '<h4>Receiving inspection</h4>' + checklistMarkup(line, draft) + coverageMarkup(p, draft)) + '</section>';
  }
  function materialMarkup(material) {
    const id = material.receiptLineId, stage = state.draft?.stage?.[id] ?? '';
    const jobs = unique(list(material.coverage).map(c => c.workOrderNumber));
    const outcomes = list(state.planning?.workOrders).filter(w => jobs.includes(w.workOrderNumber) && w.materialStatus)
      .map(w => w.workOrderNumber + ' · ' + (window.MaterialStatus?.LABELS?.[w.materialStatus] || w.materialStatus.replaceAll('_', ' ')));
    return '<section class="receiving-material" aria-label="Accepted material ' + esc(material.partNumber) + '"><div class="receiving-detail-title"><h3>' +
      esc(material.partNumber) + ' · PO ' + esc(material.poNumber) + ' / ' + esc(material.poLine) + '</h3><span class="receiving-status">' +
      (Number(material.availableQuantity) > 0 ? (Number(material.appliedQuantity) > 0 ? 'Partially Applied · Ready for Kitting' : 'Ready for Kitting') :
        Number(material.appliedQuantity) > 0 && Number(material.appliedQuantity) >= Number(material.acceptedQuantity) ? 'Applied to Kit' :
        Number(material.acceptedQuantity) > 0 ? (material.stagedAtUtc ? 'Accepted · No available balance' : 'Accepted · Awaiting staging') : 'Disposition recorded') + '</span></div>' +
      factList([['Received', quantity(material.receivedQuantity)], ['Accepted', quantity(material.acceptedQuantity)], ['Hold', quantity(material.holdQuantity)],
        ['Rejected', quantity(material.rejectedQuantity)], ['Applied to Kit', quantity(material.appliedQuantity || 0)], ['Available for Kitting', quantity(material.availableQuantity) + ' ' + text(material.purchasingUom)],
        ...(outcomes.length ? [['WO Material Status', outcomes.join('; ')]] : []),
        ['Packing slip', material.packingSlipNumber], ['Received by', material.receivedBy], ['Accepted by', material.acceptedBy],
        ['Received date', localDate(material.receivedAtUtc)], ['Accepted date', localDate(material.acceptedAtUtc)],
        ['Staging location', material.stagingLocation || 'Not staged'], ['VPRO receipt', material.vproReceiptId || 'Not Linked']]) +
      '<p class="receiving-reference">Receipt: ' + esc(id) + '</p>' +
      (Number(material.acceptedQuantity) > 0 ? '<div class="receiving-actions">' + printLink('label', id, 'Print Accepted Material Label') + '</div>' +
        (!material.stagedAtUtc ? '<div class="receiving-stage">' + field('stage', 'Staging location', stage, 'text', ' data-receiving-material="' + esc(id) + '"') +
        '<button type="button" data-receiving-command="stage" data-receiving-material="' + esc(id) + '"' + commandDisabled() + '>Record Staging</button></div>' : '') : '') +
      '<details><summary>Receiving evidence / audit</summary>' + factList([['Purchase identity', material.purchaseId], ['Expected receipt', material.expectedReceiptId],
        ['Delivery', material.deliveryId], ['Working version', String(material.version)], ['WO coverage', unique(list(material.coverage).map(c => c.workOrderNumber)).join(', ')]]) +
      '<dl class="receiving-facts">' + Object.entries(material.checks || {}).map(([key, value]) => '<div><dt>' + esc(key) + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '</dl>' +
      list(material.evidenceDocuments).map(retainedDocumentLink).join(' ') + '</details></section>';
  }
  function poMarkup() {
    if (!state.po) return state.error ? '<p role="alert" class="receiving-error">' + esc(state.error) + '</p>' : '<p role="status">Loading PO Receiving…</p>';
    if (!state.draft) return '';
    const hasOpen = poLines(state.po).some(line => Number(openQuantity(line)) > 0), materials = list(state.po.acceptedMaterials);
    return '<section class="receiving-detail receiving-po" aria-label="Receive PO"><div class="receiving-detail-title"><div><h2>Receive PO ' + esc(state.po.poNumber) + '</h2><p>' + esc(state.po.supplier) + '</p></div>' +
      '<div class="receiving-actions">' + printLink('po', state.poId, 'Print PO') + '<button type="button" data-receiving-command="close-po">Close PO</button></div></div>' +
      (state.message ? '<p role="status" class="receiving-message">' + esc(state.message) + '</p>' : '') +
      (state.error ? '<p role="alert" class="receiving-error">' + esc(state.error) + '</p>' : '') +
      '<p class="receiving-notice">Receiving version ' + esc(state.po.version) + ' · Operational acceptance only. No VPRO receipt is posted. Printing never creates or changes material.</p>' +
      (state.po.canReceive !== true ? '<p class="receiving-notice">Read-only access. Receiving permission is required to record a delivery or disposition.</p>' : '') +
      (hasOpen ? requirementsMarkup() + '<h3>Delivery / packing slip</h3><div class="receiving-form-grid">' +
        field('packingSlipNumber', 'Packing slip number', state.draft.packingSlipNumber, 'text', ' required') +
        field('packingSlipDate', 'Packing slip date', state.draft.packingSlipDate, 'date', ' required') +
        field('carrier', 'Carrier (optional)', state.draft.carrier) + field('trackingNumber', 'Tracking number (optional)', state.draft.trackingNumber) +
        field('notes', 'Package notes (optional)', state.draft.notes) + '</div>' +
        '<div class="receiving-document"><label>Packing slip attachment (optional)<input type="file" data-receiving-upload accept="application/pdf,image/*"' + commandDisabled() + '></label>' +
        (state.document ? '<a class="receiving-document-link" target="_blank" rel="noopener" href="' + esc(state.document.url) + '">View ' + esc(state.document.fileName) + '</a>' : '<span class="receiving-notice">The verified file is retained as Receiving evidence.</span>') + '</div>' : '') +
      poLines(state.po).map(receivingLineMarkup).join('') +
      (hasOpen ? '<div class="receiving-submit"><p class="receiving-notice">Record only what arrived. Accepted quantities become available after staging; the kit remains short until Kitting applies them.</p>' +
        '<button class="receiving-primary" type="button" data-receiving-command="receive"' + commandDisabled() + '>Record Receipt &amp; Disposition</button></div>' : '') +
      '<h3>Received / accepted material</h3>' + (materials.length ? materials.map(materialMarkup).join('') : '<p class="receiving-notice">No operational material record has been created for this PO.</p>') +
      '<details><summary>Delivery history</summary>' + list(state.po.deliveries).map(delivery => factList([['Packing slip', delivery.packingSlipNumber],
        ['Packing slip date', date(delivery.packingSlipDate)], ['Received by', delivery.receivedBy], ['Received date', localDate(delivery.receivedAtUtc)], ['Notes', delivery.notes]]) +
        retainedDocumentLink(delivery.packingSlipDocument)).join('') + '</details></section>';
  }
  function updateDraft(target) {
    if (!state.draft || !target?.dataset) return false;
    const data = target.dataset, value = target.value;
    if (data.receivingRequirement) state.draft.requirements[data.receivingLine][data.receivingRequirement] = value;
    else if (data.receivingCheck) state.draft.lines[data.receivingLine].checks[data.receivingCheck] = value;
    else if (data.receivingCoverage) state.draft.lines[data.receivingLine].coverage[data.receivingCoverage][data.receivingField] = value;
    else if (data.receivingField === 'stage') state.draft.stage[data.receivingMaterial] = value;
    else if (data.receivingField && data.receivingLine) state.draft.lines[data.receivingLine][data.receivingField] = value;
    else if (data.receivingField) state.draft[data.receivingField] = value;
    else return false;
    state.dirty = true; return true;
  }
  function amount(value, label, blankZero = false) {
    if (blankZero && text(value) === '') return 0;
    if (!numeric(value) || Number(value) < 0) throw new Error(label + ' must be an explicit non-negative quantity.');
    return Number(value);
  }
  function receiveRequest(po, draft) {
    if (!text(draft.packingSlipNumber)) throw new Error('Enter the packing slip number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.packingSlipDate)) throw new Error('Enter the packing slip date.');
    const lines = poLines(po).filter(line => text(draft.lines[purchaseOf(line).purchaseId].countedQuantity) !== '').map(line => {
      const p = purchaseOf(line), values = draft.lines[p.purchaseId], quality = lineQuality(line);
      const counted = amount(values.countedQuantity, 'Receive Now'), accepted = amount(values.acceptedQuantity, 'Accepted'),
        hold = amount(values.holdQuantity, 'Hold'), rejected = amount(values.rejectedQuantity, 'Rejected');
      if (counted <= 0 || counted > Number(openQuantity(line))) throw new Error('Line ' + p.poLine + ': Receive Now must be positive and cannot exceed open quantity.');
      if (Math.abs(counted - accepted - hold - rejected) > 0.0000001) throw new Error('Line ' + p.poLine + ': Counted must equal Accepted + Hold + Rejected.');
      if (accepted > 0 && checkLabels.some(([key]) => values.checks[key] !== 'PASS')) throw new Error('Line ' + p.poLine + ': Acceptance requires passing Receiving checks.');
      if (accepted > 0 && qualityLabels.some(([key, , check]) => check && (typeof quality[key] !== 'boolean' || quality[key] && values.checks[check] !== 'PASS')))
        throw new Error('Line ' + p.poLine + ': Review supplier requirements and verify required evidence before accepting material.');
      if ((hold > 0 || rejected > 0) && !text(values.discrepancyReason)) throw new Error('Line ' + p.poLine + ': Record the hold / rejection reason.');
      const request = { purchaseId: p.purchaseId, packingSlipQuantity: amount(values.packingSlipQuantity, 'Packing-slip quantity'), countedQuantity: counted,
        acceptedQuantity: accepted, holdQuantity: hold, rejectedQuantity: rejected, observedPartNumber: text(values.observedPartNumber),
        discrepancyReason: text(values.discrepancyReason), checks: { ...values.checks }, evidenceDocumentIds: list(values.evidenceDocuments).map(doc => doc.documentId) };
      if (coverage(p).length !== 1 || Number(p.excessQuantity || 0) > 0) request.coverage = coverage(p).map(job => ({ demandId: job.demandId,
        ...Object.fromEntries(['quantity', 'receivedQuantity', 'holdQuantity', 'rejectedQuantity'].map(key => [key, amount(values.coverage[job.demandId][key], 'Demand allocation', true)])) }));
      return request;
    });
    if (!lines.length) throw new Error('Enter Receive Now for at least one PO line.');
    return { expectedVersion: po.version, packingSlipNumber: text(draft.packingSlipNumber), packingSlipDate: draft.packingSlipDate,
      carrier: text(draft.carrier), trackingNumber: text(draft.trackingNumber), notes: text(draft.notes), documentId: draft.documentId || null, lines };
  }
  function requirementsRequest(po, draft) {
    if (!text(draft.reason)) throw new Error('Record the reason for the Receiving applicability review.');
    const lines = poLines(po).filter(line => Number(line.receivedQuantity ?? purchaseOf(line).receivedQuantity) === 0).map(line => {
      const id = purchaseOf(line).purchaseId, values = draft.requirements[id];
      if (qualityLabels.some(([key]) => !['true', 'false'].includes(values[key]))) throw new Error('Choose Required or Not Required for each supplier requirement.');
      return { purchaseId: id, ...Object.fromEntries(qualityLabels.map(([key]) => [key, values[key] === 'true'])) };
    });
    if (!lines.length) throw new Error('Requirements are frozen for received lines. A controlled amendment is required for later changes.');
    return { expectedVersion: po.version, reason: text(draft.reason), lines };
  }
  async function runCommand(command, materialId) {
    if (command === 'close-po') { if (!mayDiscard()) return; state.po = null; state.poId = null; state.draft = null; state.dirty = false; state.error = ''; draw(); return; }
    if (state.busy || !state.po) return;
    state.busy = true; state.error = ''; state.message = '';
    try {
      if (command === 'review-requirements') {
        if (state.po.canReceive !== true) throw new Error('Receiving permission is required.');
        state.po = await post('/po/' + encodeURIComponent(state.poId) + '/requirements', requirementsRequest(state.po, state.draft));
        poLines(state.po).forEach(line => qualityLabels.forEach(([key, , check]) => {
          if (check && lineQuality(line)[key] === false) state.draft.lines[purchaseOf(line).purchaseId].checks[check] = 'NOT_APPLICABLE';
        }));
        state.message = 'Requirements review recorded. Original purchase and production requirements are unchanged.';
      } else if (command === 'receive') {
        if (state.po.canReceive !== true) throw new Error('Receiving permission is required.');
        state.po = await post('/po/' + encodeURIComponent(state.poId) + '/receive', receiveRequest(state.po, state.draft));
        state.draft = createDraft(state.po); state.document = null; state.dirty = false;
        state.message = 'Receipt and disposition recorded. Print the accepted label and record staging. Kitting remains unchanged.';
        const queue = await api('/expected'); state.items = list(queue.items);
      } else if (command === 'stage') {
        if (state.po.canReceive !== true) throw new Error('Receiving permission is required.');
        const material = list(state.po.acceptedMaterials).find(row => row.receiptLineId === materialId), location = text(state.draft.stage[materialId]);
        if (!material || !location) throw new Error('Enter the staging location.');
        const updated = await post('/accepted-material/' + encodeURIComponent(materialId) + '/stage', { expectedVersion: material.version, location });
        state.po.acceptedMaterials = list(state.po.acceptedMaterials).map(row => row.receiptLineId === materialId ? updated : row);
        state.draft.stage[materialId] = '';
        state.dirty = ['packingSlipNumber', 'packingSlipDate', 'carrier', 'trackingNumber', 'notes', 'documentId'].some(key => text(state.draft[key])) ||
          Object.values(state.draft.lines).some(line => text(line.countedQuantity) || text(line.packingSlipQuantity) || text(line.acceptedQuantity)) ||
          Object.values(state.draft.stage).some(value => text(value));
        state.message = 'Staging recorded. Accepted material is available; Kitting must still apply it.';
      }
    } catch (error) { state.error = error.message || 'Receiving action failed. Review the saved state before retrying.'; }
    finally { state.busy = false; draw(); }
  }
  async function uploadDocument(file, data = {}) {
    if (!file || state.busy || !state.po || state.po.canReceive !== true) return;
    state.busy = true; state.error = ''; draw();
    try {
      const kind = data.receivingKind || 'PACKING_SLIP', owner = data.receivingLine || state.poId;
      const path = '/po/' + encodeURIComponent(owner) + '/documents';
      const result = await api(path + '?kind=' + encodeURIComponent(kind) + '&name=' + encodeURIComponent(file.name),
        { method: 'POST', headers: { 'X-SIM-Document-Upload': 'true', 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const doc = { documentId: result.documentId, fileName: result.document?.name || file.name, url: API + path + '/' + encodeURIComponent(result.documentId) };
      if (data.receivingLine) state.draft.lines[data.receivingLine].evidenceDocuments.push(doc);
      else { state.draft.documentId = result.documentId; state.document = doc; }
      state.dirty = true; state.message = 'Packing slip uploaded and verified. Record the receipt to associate this evidence with the delivery.';
    } catch (error) { state.error = error.message || 'Packing slip could not be uploaded.'; }
    finally { state.busy = false; draw(); }
  }

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces.receiving = Object.freeze({ render, refresh, buildViewModel, detailsMarkup, formatDate: date, queueItems, createDraft, receiveRequest, requirementsRequest, poMarkup, materialMarkup, openPo });
})(window, document);

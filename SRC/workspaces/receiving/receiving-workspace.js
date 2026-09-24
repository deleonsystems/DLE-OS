(function registerReceivingWorkspace(window, document) {
  'use strict';

  const ENDPOINT = '/api/sim/receiving/expected';
  const state = {
    items: [], planning: null, selectedId: null, busy: false, error: '', request: 0,
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
  const status = item => item.status === 'EXPECTED' && item.receiptState === 'AWAITING_RECEIPT'
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

  function chrome() {
    return '<section class="receiving-workspace" aria-label="Receiving"><header class="receiving-header"><div><h1>Receiving</h1>' +
      '<p>Incoming material · synthetic expected PO lines</p></div><button type="button" data-receiving-action="refresh"' +
      (state.busy ? ' disabled' : '') + '>Refresh</button></header>' +
      '<p class="receiving-notice">Read-only incoming queue. Material has not been received; job shortages remain open.</p>' +
      '<div class="receiving-toolbar">' + filterInput('search', 'Search expected material') +
      '<details class="receiving-filters"><summary>Filter by date, job or supplier</summary><div>' +
      filterInput('expectedFrom', 'Expected from', 'date') + filterInput('expectedTo', 'Expected through', 'date') +
      filterInput('workOrder', 'WO') + filterInput('supplier', 'Supplier') + filterInput('po', 'PO / Line') + filterInput('part', 'Part number') +
      '<label>Status<select data-receiving-filter="status"><option value="">All expected lines</option><option value="EXPECTED"' +
      (state.filters.status === 'EXPECTED' ? ' selected' : '') + '>Expected / Awaiting receipt</option></select></label>' +
      '<button type="button" data-receiving-action="clear-filters">Clear filters</button></div></details></div>' +
      '<div data-receiving-results></div><div data-receiving-detail></div></section>';
  }

  function column(label, key) {
    if (!key) return '<th scope="col">' + label + '</th>';
    const active = state.sort === key;
    return '<th scope="col" aria-sort="' + (active ? state.direction === 'asc' ? 'ascending' : 'descending' : 'none') +
      '"><button type="button" data-receiving-sort="' + key + '" aria-label="Sort by ' + label + '">' + label +
      (active ? state.direction === 'asc' ? ' ↑' : ' ↓' : '') + '</button></th>';
  }

  function resultsMarkup() {
    if (state.error) return '<p role="alert" class="receiving-error">' + esc(state.error) + '</p>';
    if (state.busy) return '<p class="receiving-empty" role="status">Loading expected material…</p>';
    const model = buildViewModel(state.items, state.filters, state.sort, state.direction);
    const summary = '<p class="receiving-count" role="status">' + model.rows.length + ' of ' + model.total + ' expected PO lines</p>';
    if (!model.rows.length) return summary + '<p class="receiving-empty">' + (model.total
      ? 'No expected PO lines match these filters.' : 'No purchased material is awaiting receipt.') + '</p>';
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
          esc(item.expectedReceiptId) + '" aria-label="View PO ' + esc(item.poNumber) + ' line ' + esc(item.poLine) + '">View</button></td></tr>';
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
      '<h3>Reviewed receiving requirements</h3>' + factList(quality) +
      '<details class="receiving-evidence"><summary>Purchase provenance and source references</summary>' +
      factList([['Provenance', item.provenance === 'SIMULATED_DEVELOPMENTAL' ? 'Simulated developmental — no real supplier order' : item.provenance],
        ['Expected PO-line identity', item.expectedReceiptId], ['Purchase identity', item.purchaseId], ['Buying plan', item.planId],
        ['Recorded at', item.createdAtUtc], ['Source shortage demand(s)', jobs.map(job => job.demandId).join(', ')],
        ['Original frozen PO traceability (history)', requirement(q.originalPoTraceabilityRequired)],
        ['Reviewed traceability amendment', q.traceabilityAmendmentId]]) + '</details>' +
      '<p class="receiving-notice">Expected supply does not constitute a receipt or satisfy a Kitting shortage.</p></section>';
  }

  function drawResults() {
    const results = mount?.querySelector('[data-receiving-results]');
    if (results) results.innerHTML = resultsMarkup();
    const detail = mount?.querySelector('[data-receiving-detail]');
    if (detail) detail.innerHTML = state.error || state.busy ? '' : detailsMarkup(state.items.find(item => item.expectedReceiptId === state.selectedId));
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
      const action = button.dataset.receivingAction, sort = button.dataset.receivingSort;
      if (action === 'refresh') { void refresh(); return; }
      if (action === 'clear-filters') { Object.keys(state.filters).forEach(key => state.filters[key] = ''); draw(); return; }
      if (action === 'close-detail') state.selectedId = null;
      if (button.dataset.receivingId) state.selectedId = button.dataset.receivingId;
      if (sort) { state.direction = state.sort === sort && state.direction === 'asc' ? 'desc' : 'asc'; state.sort = sort; }
      drawResults();
    };
    mount.oninput = event => {
      const key = event.target?.dataset?.receivingFilter;
      if (!Object.prototype.hasOwnProperty.call(state.filters, key)) return;
      state.filters[key] = event.target.value; drawResults();
    };
    mount.onchange = mount.oninput;
    await refresh();
  }

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces.receiving = Object.freeze({ render, refresh, buildViewModel, detailsMarkup, formatDate: date });
})(window, document);

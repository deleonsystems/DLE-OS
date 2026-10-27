(function registerPurchasingPoDocument(window) {
  'use strict';

  // Read-only document projection of the Purchasing record, shared by Receiving.
  // This renderer never saves a PO or posts receipt/accounting state.
  const text = value => String(value ?? '').trim();
  const esc = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const list = value => Array.isArray(value) ? value : [];
  const unique = values => [...new Set(values.map(text).filter(Boolean))];
  const qty = value => value !== null && value !== undefined && text(value) !== '' && Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 8 }) : 'Not recorded';
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value))
    ? value.slice(5, 7) + '/' + value.slice(8, 10) + '/' + value.slice(0, 4) : 'Not recorded';
  const money = (value, currency) => value !== null && value !== undefined && text(value) !== '' && Number.isFinite(Number(value))
    ? [text(currency), Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })].filter(Boolean).join(' ')
    : 'Not recorded';
  const requirement = value => value === true || value === 'REQUIRED' ? 'Required'
    : value === false || value === 'NOT_REQUIRED' ? 'Not required' : 'Not established';

  function createModel(workspace) {
    const lines = list(workspace?.lines).map(line => line.purchase
      ? { ...line.purchase, reviewedReceivingRequirements: line.requirements } : line);
    if (!lines.length) throw new Error('The authoritative PO lines must be loaded before printing.');
    const supplier = text(workspace.supplier || lines[0].supplier);
    const poNumber = text(workspace.poNumber || lines[0].poNumber);
    if (!supplier || !poNumber || lines.some(line => text(line.supplier) !== supplier || text(line.poNumber) !== poNumber))
      throw new Error('Print PO requires exactly one supplier-qualified Purchasing PO.');
    if (lines.some(line => !text(line.purchaseId)) || new Set(lines.map(line => line.purchaseId)).size !== lines.length)
      throw new Error('Print PO requires distinct authoritative purchase-line identities.');
    return { supplier, poNumber, lines: [...lines].sort((a, b) => text(a.poLine).localeCompare(text(b.poLine), 'en-US', { numeric: true })) };
  }

  function printDocument(workspace) {
    const model = createModel(workspace);
    const field = (label, value) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(value || 'Not recorded') + '</dd></div>';
    const dates = key => unique(model.lines.map(line => date(line[key]))).join(' / ');
    const requirementNotes = model.lines.map(line => {
      const originalQuality = line.qualityRequirements || {};
      const quality = line.reviewedReceivingRequirements?.reviewId
        ? { ...originalQuality, ...line.reviewedReceivingRequirements } : originalQuality;
      const jobs = list(line.coverage).map(job => 'WO ' + text(job.workOrderNumber) + ' · SO ' +
        [job.salesOrderNumber, job.salesOrderLineNumber].filter(Boolean).join(' / ') + ' · Qty ' + qty(job.quantity));
      return '<section class="line-notes"><h3>Line ' + esc(line.poLine) + ' · Requirements / job context</h3><p>' +
        esc('Supplier CoC: ' + requirement(quality.cocRequired) + ' · Material certs: ' + requirement(quality.materialCertRequired) +
          ' · Material traceability: ' + requirement(quality.poTraceabilityRequired)) + '</p>' +
        (line.reviewedReceivingRequirements?.reviewId ? '<p>Document requirements reflect the recorded Receiving review; original Purchasing history is retained.</p>' : '') +
        (quality.travelerRequired === true ? '<p>Production traveler: Required (separate production requirement)</p>' : '') +
        (jobs.length ? '<p>' + jobs.map(esc).join('<br>') + '</p>' : '') +
        (text(line.notes) ? '<p class="preserve">' + esc(line.notes) + '</p>' : '') +
        (text(quality.specialReceivingNotes) ? '<p class="preserve">' + esc(quality.specialReceivingNotes) + '</p>' : '') + '</section>';
    }).join('');
    const currencyTotals = new Map();
    for (const line of model.lines) {
      const amount = Number(line.extendedCost), currency = text(line.currency);
      if (currency && line.extendedCost !== null && line.extendedCost !== undefined && Number.isFinite(amount))
        currencyTotals.set(currency, (currencyTotals.get(currency) || 0) + amount);
    }
    return '<!doctype html><html><head><meta charset="utf-8"><title>Internal SIM PO ' + esc(model.poNumber) + '</title><style>' +
      '@page{size:letter;margin:.4in}*{box-sizing:border-box}body{margin:0;font:10pt Arial,Helvetica,sans-serif;color:#101820;background:#fff}' +
      '.toolbar{padding:12px;background:#0b1c2b;color:#edf5fa;display:flex;gap:16px;align-items:center}.toolbar button{padding:8px 15px;background:#154333;color:#fff;border:1px solid #84cdb4;border-radius:5px;font-weight:bold}' +
      '.document{max-width:7.7in;margin:20px auto}.masthead{display:flex;justify-content:space-between;gap:15px;border-bottom:3px solid #172b40;padding-bottom:10px}' +
      'h1{font-size:21pt;margin:0 0 5px}h2{font-size:14pt;margin:0}h3{font-size:10pt;margin:0 0 5px}.sim{font-weight:bold;letter-spacing:.5px;font-size:8pt}' +
      'dl{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #52616d;margin:15px 0}dl div{padding:7px 9px;border-bottom:1px solid #adb7be}' +
      'dt{font-size:8pt;color:#44505a;margin-bottom:3px}dd{margin:0;font-weight:bold;overflow-wrap:anywhere}' +
      'table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8pt}th,td{padding:6px 5px;border:1px solid #52616d;vertical-align:top;overflow-wrap:anywhere}th{background:#edf0f2;text-align:left}' +
      'td small{display:block;margin-top:3px;font-size:7pt}.num{text-align:right}.line{width:6%}.part{width:32%}.quantity{width:10%}.uom{width:7%}.cost{width:14%}.eta{width:17%}' +
      'thead{display:table-header-group}tr,.line-notes{break-inside:avoid}.totals{text-align:right;padding:10px 0;font-weight:bold}.line-notes{border:1px solid #adb7be;padding:9px;margin:8px 0}' +
      'p{margin:5px 0;font-size:9pt}.preserve{white-space:pre-wrap}.footer{margin-top:14px;border-top:1px solid #52616d;padding-top:8px;font-size:8pt;color:#35424d}' +
      '@media print{.toolbar{display:none}.document{margin:0;max-width:none}th{print-color-adjust:exact}}</style></head><body>' +
      '<nav class="toolbar"><strong>Internal SIM PO · Read-only print preview</strong><button type="button" onclick="window.print()">Print PO</button></nav>' +
      '<main class="document"><header class="masthead"><div><h2>DE LEON ENTERPRISES</h2><p class="sim">SIM / DEVELOPMENTAL · INTERNAL COPY</p></div>' +
      '<div><h1>PURCHASE ORDER</h1><h2>' + esc(model.poNumber) + '</h2></div></header><dl>' + field('Supplier', model.supplier) +
      field('Buyer', unique(model.lines.map(line => line.buyer)).join(' / ')) + field('Order date', dates('orderDate')) +
      field('Requested date', dates('requestedDate')) + field('Supplier expected date', dates('expectedDate')) + field('Currency', unique(model.lines.map(line => line.currency)).join(' / ')) +
      '</dl><table><thead><tr><th class="line">Line</th><th class="part">DLE P/N / Description</th><th class="quantity num">Ordered</th><th class="uom">UOM</th>' +
      '<th class="cost num">Unit cost</th><th class="cost num">Extended</th><th class="eta">Expected</th></tr></thead><tbody>' +
      model.lines.map(line => '<tr data-purchase-id="' + esc(line.purchaseId) + '"><td>' + esc(line.poLine) + '</td><td><strong>' + esc(line.partNumber) +
        '</strong><small>' + esc(line.description) + '</small><small>MFG / vendor P/N: ' + esc(line.vendorPartNumber || 'Not recorded') + '</small></td><td class="num">' +
        esc(qty(line.orderedQuantity)) + '</td><td>' + esc(line.purchasingUom) + '</td><td class="num">' + esc(money(line.unitCost, line.currency)) +
        '</td><td class="num">' + esc(money(line.extendedCost, line.currency)) + '</td><td>' + esc(date(line.expectedDate)) + '</td></tr>').join('') +
      '</tbody></table><div class="totals">Recorded line total: ' + [...currencyTotals].map(([currency, total]) => esc(money(total, currency))).join(' · ') +
      '</div>' + requirementNotes + '<footer class="footer">Purchasing-owned record. Internal SIM reference; not a supplier release or VPRO accounting receipt. ' +
      'Supplier address, payment terms and unrecorded clauses are not supplied by this record. Printing or reprinting changes no business state.</footer></main></body></html>';
  }

  window.PurchasingPoDocument = Object.freeze({ createModel, printDocument, formatDate: date });
})(window);

(function registerKittingKitIdLabel(window) {
  'use strict';

  const LABEL_WIDTH_IN = 4;
  const LABEL_HEIGHT_IN = 4;

  function createModel(handoff = {}) {
    const canonical = handoff.canonicalWorkOrder || {};
    return Object.freeze({
      form: 'QF-8.5.2.1 REV B',
      customer: clean(handoff.originCustomerName || canonical.customerName || handoff.official?.customer),
      date: firstDate(canonical.orderDate, canonical.createdDate, canonical.workOrderDate),
      customerPurchaseOrder: clean(handoff.originCustomerPurchaseOrderNumber ||
        canonical.customerPurchaseOrderNumber || handoff.official?.customerPo),
      salesOrder: clean(handoff.originSalesOrderNumber || handoff.canonicalSalesOrderNumber ||
        canonical.salesOrderNumber || handoff.official?.salesOrder),
      workOrder: clean(handoff.workOrderNumber || canonical.workOrderNumber || handoff.official?.workOrder),
      assembly: clean(handoff.itemNumber || canonical.itemNumber || handoff.official?.partNumber),
      revision: clean(canonical.drawingRevision || canonical.bomRevision || canonical.revision ||
        canonical.revisionLevel || handoff.revision),
      orderQuantity: formatQuantity(handoff.workOrderQuantity ?? canonical.schProdQuantity ??
        handoff.official?.quantity),
      boxNumber: '', boxCount: '', releaseNumber: '', releaseQuantity: '', releaseDueDate: '',
      qrAssignment: 'UNASSIGNED'
    });
  }

  function labelMarkup(model) {
    return '<article class="kit-id-label" aria-label="Kit ID label">' +
      '<header class="kit-id-heading"><span>' + escapeHtml(model.form) + '</span><strong>KIT ID</strong>' +
      '<div>BOX <b>' + field(model.boxNumber) + '</b> OF <b>' + field(model.boxCount) + '</b></div></header>' +
      '<section class="kit-id-job-fields">' +
      row('Customer', model.customer, 'wide') + row('Date', model.date) +
      row('P/O', model.customerPurchaseOrder) + row('S/O', model.salesOrder) + row('W/O', model.workOrder) +
      '<div class="kit-id-assembly-group">' + row('Assy-P/N', model.assembly, 'assembly') +
      row('Rev', model.revision, 'revision') + row('Order Qty', model.orderQuantity, 'order-quantity') +
      '</div></section><section class="kit-id-release"><h2>RELEASE/SHIP DETAILS</h2><div>' +
      row('Rel. #', model.releaseNumber) + row('Rel. Qty', model.releaseQuantity) +
      row('Rel Due Date', model.releaseDueDate) + '</div></section>' +
      '<section class="kit-id-open-area"><div class="kit-id-qr-reserved" role="img" aria-label="QR code unassigned">' +
      '<span>QR</span><strong>' + escapeHtml(model.qrAssignment) + '</strong></div>' +
      '<h2>SCAN FOR KIT INFORMATION</h2><p>Use DLE-OS to view kit details, status, and history.</p></section>' +
      '<footer><div><b>DLE</b><span>DE LEON ENTERPRISES</span></div><strong>DLE-OS</strong></footer></article>';
  }

  function printDocument(model) {
    return '<!doctype html><html><head><meta charset="utf-8"><title>WO ' +
      escapeHtml(model.workOrder || 'Unassigned') + ' Kit ID</title><style>' +
      '@page{size:' + LABEL_WIDTH_IN + 'in ' + LABEL_HEIGHT_IN + 'in;margin:0}' +
      '*{box-sizing:border-box}html,body{margin:0;background:#d7dce1;color:#000;font-family:Arial,Helvetica,sans-serif}' +
      '.kit-id-sheet{width:' + LABEL_WIDTH_IN + 'in;height:' + LABEL_HEIGHT_IN + 'in;margin:12px auto;background:#fff;' +
      'box-shadow:0 2px 14px rgba(0,0,0,.28)}.kit-id-label{width:100%;height:100%;display:grid;' +
      'grid-template-rows:.52in 1.38in .58in minmax(0,1fr) .38in;border:1.5pt solid #000;background:#fff;overflow:hidden}' +
      '.kit-id-heading{display:grid;grid-template-columns:1fr 1.1fr 1fr;align-items:center;border-bottom:1.5pt solid #000;' +
      'padding:.045in .08in;font-size:7.5pt}.kit-id-heading>span{align-self:start;font-weight:700}.kit-id-heading>strong{' +
      'font-size:19pt;text-align:center}.kit-id-heading>div{text-align:right;font-size:9pt}.kit-id-heading b{' +
      'display:inline-block;min-width:.28in;border-bottom:1pt solid #000;font-weight:400}' +
      '.kit-id-job-fields{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:.38in .38in .62in;' +
      'border-bottom:1.5pt solid #000}.kit-id-field{min-width:0;padding:.035in .065in;border-right:1pt solid #000;' +
      'border-bottom:1pt solid #000}' +
      '.kit-id-field.wide{grid-column:span 2}.kit-id-field.wide+*,.kit-id-job-fields>.kit-id-field:nth-child(5){' +
      'border-right:0}.kit-id-assembly-group{grid-column:1 / -1;min-height:0;display:grid;' +
      'grid-template-columns:2fr .65fr 1.15fr}.kit-id-assembly-group .kit-id-field{border-bottom:0}' +
      '.kit-id-assembly-group .order-quantity{border-right:0}' +
      '.kit-id-field span{display:block;font-size:6.5pt;font-weight:700;text-transform:uppercase}' +
      '.kit-id-field strong{display:block;min-height:.16in;margin-top:.015in;font-size:9.5pt;line-height:1.05;' +
      'overflow:hidden;overflow-wrap:anywhere}.kit-id-release{border-bottom:1.5pt solid #000}.kit-id-release h2{' +
      'height:.19in;margin:0;padding:.035in .07in;border-bottom:1pt solid #000;font-size:8pt;text-align:center}' +
      '.kit-id-release>div{display:grid;grid-template-columns:repeat(3,1fr);height:.38in}.kit-id-release .kit-id-field{' +
      'border-bottom:0}.kit-id-release .kit-id-field:last-child{border-right:0}.kit-id-open-area{' +
      'min-height:0;display:grid;grid-template-columns:.86in 1fr;' +
      'grid-template-rows:auto auto;column-gap:.12in;align-content:center;align-items:center;padding:.07in .12in}' +
      '.kit-id-qr-reserved{grid-row:1 / span 2;width:.78in;height:.78in;display:grid;place-content:center;' +
      'border:1.5pt solid #000;text-align:center}' +
      '.kit-id-qr-reserved span{font-size:18pt;font-weight:900;line-height:1}.kit-id-qr-reserved strong{margin-top:.03in;' +
      'font-size:5.5pt;letter-spacing:.08em}.kit-id-open-area h2{align-self:end;margin:0 0 .025in;font-size:8.5pt}' +
      '.kit-id-open-area p{align-self:start;margin:0;font-size:6.5pt;line-height:1.2}.kit-id-label footer{' +
      'display:flex;align-items:center;justify-content:space-between;padding:.035in .09in;' +
      'border-top:1.5pt solid #000}.kit-id-label footer div{display:flex;align-items:center;gap:.07in}.kit-id-label footer div b{' +
      'font-size:16pt;letter-spacing:-.08em}.kit-id-label footer span{font-size:6pt;font-weight:700}.kit-id-label footer>strong{' +
      'font-size:10pt}.print-toolbar{position:sticky;z-index:10;top:0;display:flex;align-items:center;gap:12px;' +
      'min-height:58px;padding:8px 12px;background:#07121f;color:#eef5f8}.print-toolbar strong{flex:1}.print-toolbar button{' +
      'min-height:42px;padding:8px 14px;border:1px solid #71d7a8;border-radius:7px;background:#123b3a;color:#fff;' +
      'font-weight:700;cursor:pointer}@media print{html,body{background:#fff}.print-toolbar{display:none!important}.kit-id-sheet{' +
      'margin:0;box-shadow:none}}' +
      '</style></head><body><header class="print-toolbar"><strong>Kit ID &middot; Print Preview</strong>' +
      '<button type="button" onclick="window.print()">Print Kit ID</button></header><div class="kit-id-sheet">' +
      labelMarkup(model) + '</div></body></html>';
  }

  function row(label, value, className = '') {
    return '<div class="kit-id-field' + (className ? ' ' + className : '') + '"><span>' +
      escapeHtml(label) + '</span><strong>' + field(value) + '</strong></div>';
  }
  function field(value) { return escapeHtml(clean(value)) || '&nbsp;'; }
  function firstDate(...values) {
    const value = values.map(clean).find(Boolean);
    if (!value) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? match[2] + '/' + match[3] + '/' + match[1] : value;
  }
  function formatQuantity(value) {
    if (value === null || value === undefined || value === '') return '';
    const quantity = Number(value);
    return Number.isFinite(quantity) ? (Number.isInteger(quantity) ? String(quantity) :
      String(Number(quantity.toFixed(2)))) : '';
  }
  function clean(value) { return String(value ?? '').trim(); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  window.KittingKitIdLabel = Object.freeze({
    LABEL_WIDTH_IN, LABEL_HEIGHT_IN, createModel, labelMarkup, printDocument
  });
})(window);

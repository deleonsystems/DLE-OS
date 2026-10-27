(function registerAcceptedMaterialLabel(window) {
  'use strict';

  function clean(value) { return String(value ?? '').trim(); }

  function normalizePurchaseOrder(value) {
    const text = clean(value);
    return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text.toUpperCase();
  }

  function sameSource(identity, partNumber, purchaseOrder) {
    return !!identity && clean(identity.partNumber).toUpperCase() === clean(partNumber).toUpperCase() &&
      normalizePurchaseOrder(identity.purchaseOrderNumber) === normalizePurchaseOrder(purchaseOrder);
  }

  function toPersistedIdentity(label) {
    if (!label || label.resolutionStatus !== 'RESOLVED' || !label.material) return null;
    const material = label.material;
    return {
      schemaVersion: 1,
      identityType: 'CANONICAL_PURCHASE_RECEIPT_LINE',
      purchaseReceiptLineId: clean(material.purchaseReceiptLineId),
      partNumber: clean(material.partNumber),
      purchaseOrderNumber: clean(material.purchaseOrderNumber),
      purchaseOrderLineNumber: clean(material.purchaseOrderLineNumber),
      receiverNumber: clean(material.receiverNumber),
      receiptDateIso: clean(material.receiptDateIso),
      quantityAccepted: Number(material.quantityAccepted) || 0,
      unitOfMeasure: clean(material.unitOfMeasure),
      resolvedAtUtc: clean(label.resolvedAtUtc)
    };
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function printDocument(material) {
    const item = (label, value) => '<div><span>' + escapeHtml(label) + '</span><strong>' +
      escapeHtml(value || '\u2014') + '</strong></div>';
    const quantity = [material.quantityAccepted, material.unitOfMeasure].filter(value => clean(value)).join(' ');
    return '<!doctype html><html><head><meta charset="utf-8"><title>Accepted Material ' +
      escapeHtml(material.receiverNumber) + '</title><style>' +
      '@page{size:4in 2.5in;margin:.12in}*{box-sizing:border-box}body{margin:0;font:11px Arial,sans-serif;color:#111}' +
      '.toolbar{margin:0 0 10px;text-align:right}.label{width:3.76in;min-height:2.22in;border:2px solid #111;padding:10px}' +
      'header{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:7px}' +
      'header strong{font-size:16px}header span{font-weight:700}.part{font-size:18px;margin:7px 0}' +
      '.grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px}.grid div{display:flex;flex-direction:column}' +
      '.grid span{font-size:8px;text-transform:uppercase;color:#555}.identity{font:7px Consolas,monospace;margin-top:7px;overflow-wrap:anywhere}' +
      '.note{font-size:8px;margin-top:6px}@media print{.toolbar{display:none}}</style></head><body>' +
      '<div class="toolbar"><button onclick="window.print()">Print</button></div><section class="label">' +
      '<header><strong>DE LEON ENTERPRISES</strong><span>ACCEPTED MATERIAL</span></header>' +
      '<div class="part">' + escapeHtml(material.partNumber) + '</div><div class="grid">' +
      item('Receiver', material.receiverNumber) + item('Received', material.receiptDateIso?.slice(0, 10)) +
      item('P.O. / Line', [material.purchaseOrderNumber, material.purchaseOrderLineNumber].filter(Boolean).join(' / ')) +
      item('Accepted quantity', quantity) + item('Vendor', material.vendorName) +
      item('Warehouse / Location', [material.warehouseId, material.inventoryLocation].filter(Boolean).join(' / ')) +
      '</div><div class="identity">Receipt identity: ' + escapeHtml(material.purchaseReceiptLineId) + '</div>' +
      '<div class="note">DEV trial rendering from the existing canonical Receiving record. Reprinting does not create a receipt or acceptance identity.</div>' +
      '</section></body></html>';
  }

  window.AcceptedMaterialLabel = Object.freeze({
    clean, normalizePurchaseOrder, sameSource, toPersistedIdentity, printDocument
  });
})(window);

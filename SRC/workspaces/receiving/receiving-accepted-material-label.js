(function registerReceivingAcceptedMaterialLabel(window) {
  'use strict';

  // Operational Receiving labels intentionally do not masquerade as canonical VPRO receipts.
  // Existing canonical accepted-material-label.js remains unchanged.
  const WIDTH_MM = 100, HEIGHT_MM = 62, SAFE_WIDTH_MM = 92;
  const text = value => String(value ?? '').trim();
  const esc = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qty = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 8 });
  function date(value) {
    const source = text(value);
    // Contractual date-only facts are literal dates. Operational timestamps use
    // the factory timezone, independent of the printing computer's timezone.
    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source.slice(5, 7) + '/' + source.slice(8, 10) + '/' + source.slice(0, 4);
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(source)) return 'Not recorded';
    const instant = new Date(source);
    return Number.isNaN(instant.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: 'numeric'
    }).format(instant);
  }
  // ISO Code 128 symbol widths, including stop. Alternating black/white runs.
  // Symbol mapping cross-checked against ReportLab's independently maintained Code 128 encoder.
  const PATTERNS = ('212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,' +
    '112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,' +
    '321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,' +
    '231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,' +
    '311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,' +
    '141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,' +
    '121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,' +
    '114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112').split(',');

  function code128(value) {
    const content = text(value);
    if (!content || !/^[\x20-\x7e]+$/.test(content)) throw new Error('A printable accepted-material identity is required for the barcode.');
    const symbols = [104]; // Start B: preserve the exact record identity, including SIM namespace.
    let index = 0, set = 'B';
    while (index < content.length) {
      const digits = /^\d+/.exec(content.slice(index))?.[0].length || 0;
      if (set === 'B') {
        if (digits >= 4 || (digits === 2 && index + digits === content.length)) {
          // Leave an odd leading digit in B, then encode the even remainder in C.
          if (digits % 2) { symbols.push(content.charCodeAt(index++) - 32); continue; }
          symbols.push(99); set = 'C';
        } else { symbols.push(content.charCodeAt(index++) - 32); }
      } else if (digits >= 2) {
        symbols.push(Number(content.slice(index, index + 2))); index += 2;
      } else { symbols.push(100); set = 'B'; }
    }
    symbols.push(symbols.reduce((sum, symbol, i) => sum + symbol * (i || 1), 0) % 103, 106);
    const runs = symbols.flatMap(symbol => [...PATTERNS[symbol]].map(Number));
    const modules = runs.reduce((sum, width) => sum + width, 0) + 20; // 10-module quiet zone each side.
    if (SAFE_WIDTH_MM / modules < 0.25)
      throw new Error('Accepted-material identity is too long for a readable barcode on this stock.');
    return { value: content, symbols, runs, modules };
  }

  function barcodeSvg(value) {
    const barcode = code128(value);
    let x = 10;
    const bars = barcode.runs.map((width, index) => {
      const rect = index % 2 === 0 ? '<rect x="' + x + '" y="0" width="' + width + '" height="34"/>' : '';
      x += width; return rect;
    }).join('');
    return '<svg class="barcode" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Accepted material barcode ' + esc(value) +
      '" data-barcode-value="' + esc(value) + '" viewBox="0 0 ' + barcode.modules + ' 34" preserveAspectRatio="none" ' +
      'shape-rendering="crispEdges"><title>' + esc(value) + '</title><rect width="100%" height="100%" fill="#fff"/>' +
      '<g fill="#000">' + bars + '</g></svg>';
  }

  function createModel(material, selectedContainerId) {
    if (!material || !text(material.receiptLineId) || !Number.isFinite(Number(material.acceptedQuantity)) ||
      Number(material.acceptedQuantity) <= 0 || !material.acceptedAtUtc)
      throw new Error('A governed positive accepted-material record is required to print this label.');
    const containers = Array.isArray(material.containers) ? material.containers : [];
    let containerId = '', containerQuantity = Number(material.acceptedQuantity);
    if (containers.length) {
      if (new Set(containers.map(c => text(c.containerId))).size !== containers.length ||
        containers.some(c => !text(c.containerId) || !Number.isFinite(Number(c.quantity)) || Number(c.quantity) <= 0) ||
        Math.abs(containers.reduce((sum, c) => sum + Number(c.quantity), 0) - containerQuantity) > 0.00000001)
        throw new Error('Recorded container quantities must reconcile to accepted quantity.');
      const selected = containers.find(c => text(c.containerId) === text(selectedContainerId)) || (containers.length === 1 ? containers[0] : null);
      if (!selected) throw new Error('Select a recorded container before printing a split-material label.');
      containerId = text(selected.containerId); containerQuantity = Number(selected.quantity);
    } else if (selectedContainerId) {
      throw new Error('An unrecorded container cannot override the accepted label quantity.');
    }
    // Validate before rendering. Barcode value is also the server's read-only lookup key.
    code128(material.receiptLineId);
    const workOrders = [...new Set((material.coverage || []).map(c => text(c.workOrderNumber)).filter(Boolean))];
    return { ...material, workOrders, containerId, containerQuantity };
  }

  function printDocument(material, selectedContainerId) {
    const model = createModel(material, selectedContainerId);
    const field = (label, value, cls = '') => '<div class="field ' + cls + '"><span>' + esc(label) + '</span><strong>' + esc(value || 'Not recorded') + '</strong></div>';
    return '<!doctype html><html><head><meta charset="utf-8"><title>Accepted Material ' + esc(model.receiptLineId) + '</title><style>' +
      '@page{size:' + WIDTH_MM + 'mm ' + HEIGHT_MM + 'mm;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}' +
      '.sheet{width:100mm;height:62mm;display:flex;align-items:center;justify-content:center}.label{width:92mm;height:56mm;display:flex;flex-direction:column;gap:.65mm}' +
      '.head{display:flex;justify-content:space-between;align-items:center;border-bottom:.4mm solid #000;padding-bottom:1mm;font-size:11pt;font-weight:bold}.head small{font-size:5.5pt}' +
      '.part{font-size:14pt;font-weight:bold;line-height:1.05;overflow-wrap:anywhere}.description{font-size:7pt;line-height:1.05;max-height:6mm;overflow:hidden}' +
      '.facts{display:grid;grid-template-columns:1.15fr 1fr;gap:.6mm 2mm}.field{min-width:0;line-height:1.02}.field span{display:block;font-size:5.3pt;font-weight:normal}' +
      '.field strong{display:block;font-size:7.5pt;overflow-wrap:anywhere}.wide{grid-column:1/-1}.quantity strong{font-size:11pt}.barcode{display:block;width:92mm;height:9mm;flex-shrink:0;margin-top:auto}' +
      '.receipt{text-align:center;font:8pt Consolas,monospace;letter-spacing:.35mm;line-height:1.05}.toolbar{padding:12px;background:#0b1c2b;color:#eff6fa;font-size:12px;max-width:650px}' +
      '.toolbar button{font-weight:bold;padding:8px 14px;background:#154333;color:#fff;border:1px solid #84cdb4;border-radius:5px;margin-right:10px}.toolbar p{margin:6px 0 0}' +
      '@media screen{body{background:#dce2e7}.sheet{background:#fff;margin:16px;box-shadow:0 2px 10px #0003}}@media print{.toolbar{display:none}}</style></head><body>' +
      '<div class="toolbar"><button type="button" onclick="window.print()">Print / Reprint Accepted Material Label</button>100 × 62 mm · Actual size' +
      '<p>One recorded container per label. Reprint replaces a lost or damaged label; it creates no receipt or quantity. Confirm the physical printer and stock manually.</p></div>' +
      '<section class="sheet"><article class="label"><header class="head">ACCEPTED MATERIAL<small>DLE-OS · SIM</small></header><div class="part">' + esc(model.partNumber) +
      '</div><div class="description">' + esc(model.description) + '</div><div class="facts">' + field('Supplier', model.supplier) +
      field('PO / Line', [model.poNumber, model.poLine].filter(Boolean).join(' / ')) +
      field('WO', model.workOrders.length > 1 ? 'Multiple WOs' : model.workOrders[0]) +
      field(model.containerId ? 'Container quantity' : 'Accepted quantity · one container', qty(model.containerQuantity) + ' ' + text(model.purchasingUom), 'quantity') +
      field('Received by · date', text(model.receivedBy) + ' · ' + date(model.receivedAtUtc)) +
      field('Accepted by · date', text(model.acceptedBy) + ' · ' + date(model.acceptedAtUtc)) +
      field('Stage' + (model.containerId ? ' · Container ' + model.containerId : ''), model.stagingLocation || 'Not staged', 'wide') +
      '</div>' + barcodeSvg(model.receiptLineId) + '<div class="receipt">' + esc(model.receiptLineId) + '</div></article></section></body></html>';
  }

  window.ReceivingAcceptedMaterialLabel = Object.freeze({ WIDTH_MM, HEIGHT_MM, SAFE_WIDTH_MM, createModel, printDocument, code128, barcodeSvg, formatDate: date });
})(window);

(function () {
  'use strict';

  const LABEL_WIDTH_MM = 100;
  const LABEL_HEIGHT_MM = 62;
  const CORE_HEIGHT_MM = 50.8;
  const BROTHER_SAFE_HORIZONTAL_INSET_MM = 4;
  const BROTHER_SAFE_WIDTH_MM = LABEL_WIDTH_MM - (BROTHER_SAFE_HORIZONTAL_INSET_MM * 2);
  const AVERY_5163 = Object.freeze({
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    labelWidthIn: 4,
    labelHeightIn: 2,
    topMarginIn: 0.5,
    sideMarginIn: 0.16,
    horizontalPitchIn: 4.19,
    verticalPitchIn: 2,
    columns: 2,
    rows: 5,
    labelsPerSheet: 10
  });
  const MATERIAL_ROWS_PER_LABEL = 3;
  const MIXED_MATERIAL_HEIGHT_MM = 34;
  const DETAIL_SECTION_BORDER_MM = 0.3;
  const DETAIL_HEADING_AND_PADDING_MM = 5.5;
  const DETAIL_LINE_HEIGHT_MM = 3.1;
  const DETAIL_CHARACTERS_PER_LINE = 36;

  function detailLineCapacity(heightMm) {
    return Math.max(1, Math.floor((heightMm - DETAIL_HEADING_AND_PADDING_MM) / DETAIL_LINE_HEIGHT_MM));
  }

  const MIXED_DETAIL_LINES = detailLineCapacity(
    CORE_HEIGHT_MM - MIXED_MATERIAL_HEIGHT_MM - DETAIL_SECTION_BORDER_MM);
  const CONTINUATION_DETAIL_LINES = detailLineCapacity(CORE_HEIGHT_MM);
  const MIXED_DETAIL_CAPACITY = MIXED_DETAIL_LINES * DETAIL_CHARACTERS_PER_LINE;
  const CONTINUATION_DETAIL_CAPACITY = CONTINUATION_DETAIL_LINES * DETAIL_CHARACTERS_PER_LINE;

  function clean(value) {
    return String(value ?? '').trim();
  }

  function escapeHtml(value) {
    return clean(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatQuantity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return clean(value) || '\u2014';
    return number.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  function governedLocation(row) {
    const candidates = [row?.location, row?.inventoryLocation].map(clean).filter(Boolean);
    const distinct = [...new Map(candidates.map(value => [value.toUpperCase(), value])).values()];
    return {
      value: distinct.length === 1 ? distinct[0] : '',
      ambiguous: distinct.length > 1
    };
  }

  function partRow(group, partNumber) {
    const selected = clean(partNumber);
    if (clean(group?.primaryPart?.itemNumber) === selected) return group.primaryPart;
    return group?.relatedParts?.find(part => clean(part?.row?.itemNumber) === selected)?.row || group?.primaryPart || {};
  }

  function materialRow(row, group, primary) {
    const location = governedLocation(row);
    return {
      sequence: clean(row?.sequence || group?.sequence).padStart(3, '0'),
      location: location.value,
      locationAmbiguous: location.ambiguous,
      partNumber: clean(row?.itemNumber || group?.partNumber),
      description: clean(row?.description || group?.description) || 'NOT ON FILE',
      requiredEach: primary ? Number(group?.requiredEach) || 0 : null,
      unitOfMeasure: primary ? clean(group?.unitOfMeasure || row?.unitOfMeasure) : '',
      primary
    };
  }

  function materialRows(group) {
    return [
      materialRow(group?.primaryPart || {}, group, true),
      ...(group?.relatedParts || []).map(related => materialRow(related?.row || {}, group, false))
    ];
  }

  function materialRowUnits(row) {
    return clean(row?.description).length > 54 ? 1.5 : 1;
  }

  function paginateMaterialRows(rows) {
    const pages = [];
    let page = [];
    let units = 0;
    for (const row of rows || []) {
      const rowUnits = materialRowUnits(row);
      if (page.length && (page.length >= MATERIAL_ROWS_PER_LABEL || units + rowUnits > MATERIAL_ROWS_PER_LABEL)) {
        pages.push(page);
        page = [];
        units = 0;
      }
      page.push(row);
      units += rowUnits;
    }
    if (page.length) pages.push(page);
    return pages;
  }

  function detailGroups(model) {
    const groups = [];
    const references = (model.references || []).map(clean).filter(Boolean);
    if (references.length) groups.push({ values: references, separator: ', ' });
    for (const note of model.materialNotes || []) {
      const words = clean(note).split(/\s+/).filter(Boolean);
      if (words.length) groups.push({ values: words, separator: ' ' });
    }
    return groups.length ? groups : [{ values: ['\u2014'], separator: '' }];
  }

  function paginateDetailLines(groups) {
    const pages = [];
    let lines = [];
    let used = 0;
    const capacity = () => pages.length === 0 ? MIXED_DETAIL_CAPACITY : CONTINUATION_DETAIL_CAPACITY;
    const flush = () => {
      if (lines.length) pages.push(lines);
      lines = [];
      used = 0;
    };

    for (const group of groups) {
      const remaining = [...group.values];
      while (remaining.length) {
        const separatorCost = lines.length ? 12 : 0;
        const available = capacity() - used - separatorCost;
        let line = '';
        while (remaining.length) {
          const candidate = line ? line + group.separator + remaining[0] : remaining[0];
          if (line && candidate.length > available) break;
          if (!line && candidate.length > available && lines.length) break;
          line = candidate;
          remaining.shift();
          if (line.length >= available) break;
        }
        if (!line) {
          flush();
          continue;
        }
        lines.push(line);
        used += line.length + separatorCost;
        if (remaining.length) flush();
      }
    }
    flush();
    return pages;
  }

  function paginateModel(model) {
    const materialPages = paginateMaterialRows(model.materialRows || []);
    const details = paginateDetailLines(detailGroups(model));
    const pages = materialPages.map(materialRows => ({ materialRows, showDetail: false, detailLines: [] }));
    if (!pages.length) pages.push({ materialRows: [], showDetail: false, detailLines: [] });
    pages[pages.length - 1].showDetail = true;
    pages[pages.length - 1].detailLines = details.shift() || ['\u2014'];
    for (const lines of details) pages.push({ materialRows: [], showDetail: true, detailLines: lines });
    return pages;
  }

  function createModel(draft, group) {
    if (!draft || !group) return null;
    const header = draft.header || {};
    const rows = materialRows(group);
    const primary = rows[0];
    const model = {
      schemaVersion: 1,
      labelType: 'KITTING_BAG_LABEL',
      stock: 'Brother DK-1202',
      widthMm: LABEL_WIDTH_MM,
      heightMm: LABEL_HEIGHT_MM,
      workOrder: clean(draft.workOrder || header.workOrder),
      customerName: clean(header.customer || header.customerDisplayName || header.customerName || header.customerShortName),
      assembly: clean(header.billNumber || header.drawing),
      revision: clean(header.revision),
      sequence: primary.sequence,
      location: primary.location,
      locationAmbiguous: primary.locationAmbiguous,
      partNumber: primary.partNumber,
      description: primary.description,
      requiredEach: Number(group.requiredEach) || 0,
      unitOfMeasure: clean(group.unitOfMeasure || group?.primaryPart?.unitOfMeasure),
      findNumber: group.findNumber == null ? '' : clean(group.findNumber),
      references: Array.isArray(group.references) ? group.references.map(clean).filter(Boolean) : [],
      materialNotes: Array.isArray(group.notes) ? group.notes.map(clean).filter(Boolean) : [],
      groupedPrimaryPart: clean(group.partNumber),
      materialRows: rows
    };
    model.pages = paginateModel(model);
    return model;
  }

  function createVariants(draft, group) {
    const model = createModel(draft, group);
    return model ? [model] : [];
  }

  function createAvery5163Batch(draft) {
    const groups = (draft?.groups || []).filter(group => group.actionable).sort((left, right) =>
      clean(left.sequence).localeCompare(clean(right.sequence), undefined, { numeric: true }));
    const models = groups.flatMap(group => createVariants(draft, group));
    const surfaces = models.flatMap(model => model.pages.map((page, pageIndex) => ({
      sequence: model.sequence,
      pageIndex,
      model,
      page
    })));
    const sheets = [];
    for (let offset = 0; offset < surfaces.length; offset += AVERY_5163.labelsPerSheet) {
      const slots = surfaces.slice(offset, offset + AVERY_5163.labelsPerSheet);
      while (slots.length < AVERY_5163.labelsPerSheet) slots.push(null);
      sheets.push(slots);
    }
    return { models, surfaces, sheets };
  }

  function createOverflowQualificationModel(model) {
    if (!model) return null;
    const fixture = {
      ...model,
      materialRows: [...model.materialRows.map(row => ({ ...row }))]
    };
    const related = fixture.materialRows[1] || fixture.materialRows[0];
    for (const sequence of ['012', '013', '014']) {
      fixture.materialRows.push({
        ...related,
        sequence,
        location: '',
        locationAmbiguous: false,
        partNumber: 'DEV-OVERFLOW-' + sequence,
        description: 'NON-OPERATIONAL MULTI-LABEL QUALIFICATION ROW',
        requiredEach: null,
        unitOfMeasure: '',
        primary: false
      });
    }
    fixture.references = Array.from({ length: 100 }, (_, index) => 'Q' + (index + 1));
    fixture.pages = paginateModel(fixture);
    return fixture;
  }

  function materialRowMarkup(row) {
    const partLengthClass = row.partNumber.length > 16 ? ' dense' : row.partNumber.length > 12 ? ' compact' : '';
    const quantity = row.primary ? escapeHtml(formatQuantity(row.requiredEach)) + ' ' + escapeHtml(row.unitOfMeasure) : '';
    return '<div class="kitting-bag-label-material-row" data-material-sequence="' + escapeHtml(row.sequence) + '"><strong>' +
      escapeHtml(row.sequence) + '</strong><strong class="kitting-bag-label-location">' +
      escapeHtml(row.location || '\u2014') + '</strong><div class="kitting-bag-label-material kitting-bag-label-part' + partLengthClass + '"><strong>' +
      escapeHtml(row.partNumber) + '</strong><span class="kitting-bag-label-description">' + escapeHtml(row.description) + '</span>' +
      '</div><strong class="kitting-bag-label-quantity">' + quantity + '</strong></div>';
  }

  function labelMarkup(model, page, className = 'kitting-bag-label') {
    const detailMarkup = (page.detailLines?.length ? page.detailLines : ['\u2014'])
      .map(line => '<strong>' + escapeHtml(line) + '</strong>').join('');
    const railText = [model.customerName || '\u2014', model.assembly || '\u2014', 'REV', model.revision || '\u2014'].join(' ');
    const railLengthClass = railText.length > 58 ? 'dense' : railText.length > 40 ? 'compact' : '';
    const hasMaterials = page.materialRows.length > 0;
    return '<article class="' + className + (page.showDetail ? ' has-detail' : ' materials-only') +
      (hasMaterials ? ' has-materials' : ' detail-only') + '">' +
      '<aside class="kitting-bag-label-recovery-rail"><span class="' + railLengthClass + '">' +
      escapeHtml(railText) + '</span></aside><div class="kitting-bag-label-body">' +
      (hasMaterials ? '<section class="kitting-bag-label-component"><div class="kitting-bag-label-material-head"><span>SEQ</span><span>LOCATION</span>' +
      '<span>MATERIAL</span><span>QTY</span></div><div class="kitting-bag-label-material-rows">' +
      page.materialRows.map(materialRowMarkup).join('') + '</div></section>' : '') +
      (page.showDetail ? '<section class="kitting-bag-label-placement"><div><span>FN</span><strong>' +
      escapeHtml(model.findNumber || '\u2014') + '</strong></div><div><span>REF. DES.</span><div class="kitting-bag-label-detail-lines">' +
      detailMarkup + '</div></div></section>' : '') + '</div></article>';
  }

  function layoutStyles(root, widthMm = BROTHER_SAFE_WIDTH_MM) {
    return root + '{width:' + widthMm + 'mm;height:' + CORE_HEIGHT_MM +
      'mm;border:.35mm solid #000;display:grid;grid-template-columns:6mm 1fr;overflow:hidden;' +
      '--fn-seq-width:8%;' +
      'box-sizing:border-box;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}' +
      root + ' *{box-sizing:border-box}' +
      root + ' span{display:block;font-size:5.1pt;font-weight:500;letter-spacing:.18pt}' +
      root + ' strong{display:block;font-weight:400;line-height:1.08}' +
      root + ' .kitting-bag-label-recovery-rail{display:flex;align-items:center;justify-content:center;' +
      'min-width:0;overflow:hidden;border-right:.25mm solid #000}' +
      root + ' .kitting-bag-label-recovery-rail span{font-size:5.5pt;font-weight:400;letter-spacing:.1pt;' +
      'line-height:1;white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg)}' +
      root + ' .kitting-bag-label-recovery-rail span.compact{font-size:5pt;letter-spacing:0}' +
      root + ' .kitting-bag-label-recovery-rail span.dense{font-size:4.4pt;letter-spacing:0}' +
      root + ' .kitting-bag-label-body{display:grid;min-width:0;min-height:0}' +
      root + '.has-detail.has-materials .kitting-bag-label-body{grid-template-rows:' + MIXED_MATERIAL_HEIGHT_MM + 'mm 1fr}' +
      root + '.detail-only .kitting-bag-label-body{grid-template-rows:1fr}' +
      root + '.materials-only .kitting-bag-label-body{grid-template-rows:1fr}' +
      root + ' .kitting-bag-label-component{display:grid;grid-template-rows:4.5mm 1fr}' +
      root + '.has-detail .kitting-bag-label-component{border-bottom:.3mm solid #000}' +
      root + ' .kitting-bag-label-material-head,' + root + ' .kitting-bag-label-material-row{' +
      'display:grid;grid-template-columns:var(--fn-seq-width) 13% 71% 8%;min-width:0}' +
      root + ' .kitting-bag-label-material-head{border-bottom:.2mm solid #000}' +
      root + ' .kitting-bag-label-material-rows{display:grid;grid-auto-rows:minmax(0,1fr);min-height:0}' +
      root + ' .kitting-bag-label-material-head>*,' + root + ' .kitting-bag-label-material-row>*{min-width:0;padding:.55mm .8mm}' +
      root + ' .kitting-bag-label-material-head>*+*,' + root + ' .kitting-bag-label-material-row>*+*{border-left:.2mm solid #000}' +
      root + ' .kitting-bag-label-material-row+.kitting-bag-label-material-row{border-top:.2mm solid #000}' +
      root + ' .kitting-bag-label-material-head span{display:flex;align-items:center;font-size:4.8pt;font-weight:500}' +
      root + ' .kitting-bag-label-material-row>strong{font-size:7.5pt}' +
      root + ' .kitting-bag-label-location{font-size:7pt!important;overflow-wrap:anywhere}' +
      root + ' .kitting-bag-label-material{overflow:hidden}' +
      root + ' .kitting-bag-label-part strong{overflow:hidden;font-size:8.2pt;white-space:nowrap}' +
      root + ' .kitting-bag-label-part.compact strong{font-size:7.8pt}' +
      root + ' .kitting-bag-label-part.dense strong{font-size:7.2pt}' +
      root + ' .kitting-bag-label-description{display:-webkit-box;margin-top:.3mm;padding-left:1.5ch;font-size:6.8pt!important;' +
      'font-weight:400;line-height:1.08!important;overflow:hidden;overflow-wrap:anywhere;-webkit-box-orient:vertical;-webkit-line-clamp:2}' +
      root + ' .kitting-bag-label-quantity{font-size:6.4pt!important;font-weight:400;line-height:1.05;overflow-wrap:anywhere}' +
      root + ' .kitting-bag-label-placement{display:grid;grid-template-columns:var(--fn-seq-width) 1fr;min-height:0}' +
      root + ' .kitting-bag-label-placement>div{min-width:0;padding:1.2mm 1.8mm}' +
      root + ' .kitting-bag-label-placement>div+div{border-left:.25mm solid #000}' +
      root + ' .kitting-bag-label-placement strong{margin-top:.6mm;font-size:8pt;font-weight:400;line-height:1.1;overflow-wrap:anywhere}' +
      root + ' .kitting-bag-label-detail-lines{margin-top:.6mm}' +
      root + ' .kitting-bag-label-detail-lines strong{margin-top:0}' +
      root + ' .kitting-bag-label-detail-lines strong+strong{margin-top:.7mm;padding-top:.7mm;border-top:.15mm solid #000}';
  }

  function previewMarkup(model) {
    return '<style data-kitting-bag-label-layout>.kitting-bag-label-preview-set{display:grid;gap:12px;justify-content:start}' +
      '.kitting-bag-label-preview-sheet{width:' + LABEL_WIDTH_MM + 'mm;height:' + CORE_HEIGHT_MM +
      'mm;display:flex;align-items:center;justify-content:center}' +
      layoutStyles('.kitting-bag-label-preview') + '</style>' +
      '<div class="kitting-bag-label-preview-set">' + model.pages.map(page =>
        '<div class="kitting-bag-label-preview-sheet">' +
        labelMarkup(model, page, 'kitting-bag-label-preview') + '</div>').join('') + '</div>';
  }

  function printDocument(model) {
    const title = [model.assembly, model.revision ? 'REV ' + model.revision : '', 'Bag ' + model.sequence]
      .filter(Boolean).join(' ');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title><style>' +
      '@page{size:' + LABEL_WIDTH_MM + 'mm ' + LABEL_HEIGHT_MM + 'mm;margin:0}' +
      '*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}' +
      '.kitting-bag-label-sheet{width:' + LABEL_WIDTH_MM + 'mm;height:' + LABEL_HEIGHT_MM +
      'mm;display:flex;align-items:center;justify-content:center;break-after:page;page-break-after:always}' +
      '.kitting-bag-label-sheet:last-of-type{break-after:auto;page-break-after:auto}' + layoutStyles('.kitting-bag-label') +
      '.print-actions{position:fixed;right:8px;bottom:8px}@media print{.print-actions{display:none}}' +
      '.print-actions button{min-height:40px;padding:7px 13px;border:2px solid #000;background:#fff;font-weight:700}' +
      '</style></head><body>' + model.pages.map(page => '<div class="kitting-bag-label-sheet">' +
        labelMarkup(model, page) + '</div>').join('') +
      '<div class="print-actions"><button type="button" onclick="window.print()">Print / Reprint Bag Label</button></div>' +
      '</body></html>';
  }

  function avery5163Document(draft) {
    const batch = createAvery5163Batch(draft);
    const labelWidthMm = AVERY_5163.labelWidthIn * 25.4;
    const sheets = batch.sheets.map((slots, sheetIndex) => '<section class="avery-5163-sheet" data-sheet="' +
      (sheetIndex + 1) + '">' + slots.map((surface, slotIndex) => '<div class="avery-5163-slot' +
        (surface ? '' : ' blank') + '" data-slot="' + (slotIndex + 1) + '">' +
        (surface ? labelMarkup(surface.model, surface.page, 'kitting-bag-label-avery') : '') +
        '</div>').join('') + '</section>').join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>WO ' +
      escapeHtml(draft?.workOrder || draft?.header?.workOrder) + ' Bag Labels - Avery 5163</title><style>' +
      '@page{size:letter;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;' +
      'font-family:Arial,Helvetica,sans-serif}.avery-5163-sheet{position:relative;width:8.5in;height:11in;' +
      'padding:' + AVERY_5163.topMarginIn + 'in 0 0 ' + AVERY_5163.sideMarginIn + 'in;display:grid;' +
      'grid-template-columns:repeat(2,4in);grid-template-rows:repeat(5,2in);column-gap:.19in;row-gap:0;' +
      'break-after:page;page-break-after:always}.avery-5163-sheet:last-of-type{break-after:auto;page-break-after:auto}' +
      '.avery-5163-slot{width:4in;height:2in;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
      layoutStyles('.kitting-bag-label-avery', labelWidthMm) +
      '.print-actions{position:fixed;right:8px;bottom:8px}.print-actions button{min-height:40px;padding:7px 13px;' +
      'border:2px solid #000;background:#fff;font-weight:700}@media screen{body{background:#d8dde2}' +
      '.avery-5163-sheet{margin:12px auto;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.25)}' +
      '.avery-5163-slot{outline:1px dashed rgba(40,70,90,.22)}}@media print{.print-actions{display:none}' +
      '.avery-5163-slot{outline:0}}' +
      '</style></head><body>' + sheets +
      '<div class="print-actions"><button type="button" onclick="window.print()">Print Avery 5163 Sheets</button></div>' +
      '</body></html>';
  }

  window.KittingBagLabel = Object.freeze({
    LABEL_WIDTH_MM,
    LABEL_HEIGHT_MM,
    CORE_HEIGHT_MM,
    BROTHER_SAFE_HORIZONTAL_INSET_MM,
    BROTHER_SAFE_WIDTH_MM,
    AVERY_5163,
    MIXED_DETAIL_LINES,
    CONTINUATION_DETAIL_LINES,
    MIXED_DETAIL_CAPACITY,
    CONTINUATION_DETAIL_CAPACITY,
    createModel,
    createVariants,
    createAvery5163Batch,
    createOverflowQualificationModel,
    paginateModel,
    paginateMaterialRows,
    paginateDetailLines,
    labelMarkup,
    layoutStyles,
    previewMarkup,
    printDocument,
    avery5163Document
  });
})();

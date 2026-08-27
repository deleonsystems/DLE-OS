(function () {
  'use strict';

  const METHODS = Object.freeze({
    COMPLETE: 'COMPLETE',
    COMPLETE_MIN_EXTRA: 'COMPLETE_MIN_EXTRA',
    COUNT: 'COUNT'
  });

  function clean(value) {
    return String(value ?? '').trim();
  }

  function normalizeCountInput(value) {
    const text = clean(value);
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function sanitizeCountInput(value) {
    const text = String(value ?? '');
    if (text.includes('-')) return '';
    const raw = text.replace(/[^\d.]/g, '');
    const dot = raw.indexOf('.');
    return dot < 0 ? raw : raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, '');
  }

  function parseFindMessage(rawMessage) {
    const raw = String(rawMessage ?? '');
    const numbered = raw.match(/^\((\d+)\)\s*(.*)$/);
    if (!numbered) return { findNumber: null, references: [], note: '', rawMessage: raw };
    const remainder = numbered[2];
    const referencePattern = remainder.match(/^([A-Za-z]+\d+(?:\s*,\s*(?:[A-Za-z]+\d+|\d+))*)(?:\s+\((.+)\))?$/);
    if (!referencePattern) {
      return { findNumber: Number(numbered[1]), references: [], note: clean(remainder), rawMessage: raw };
    }
    let prefix = '';
    const references = referencePattern[1].split(',').map(token => {
      const value = token.trim();
      const explicit = value.match(/^([A-Za-z]+)(\d+)$/);
      if (explicit) {
        prefix = explicit[1].toUpperCase();
        return prefix + explicit[2];
      }
      return /^\d+$/.test(value) && prefix ? prefix + value : value;
    });
    return {
      findNumber: Number(numbered[1]),
      references,
      note: referencePattern[2] || '',
      rawMessage: raw
    };
  }

  function relatedPartReason(primary, candidate) {
    const primaryCode = clean(primary?.itemNumber).replace(/\s+/g, '').toUpperCase();
    const candidateCode = clean(candidate?.itemNumber).replace(/\s+/g, '').toUpperCase();
    if (Number(candidate?.requiredEach) === 0.0001) return 'Required-each 0.0001 rule';
    if (primaryCode && candidateCode.startsWith(primaryCode) && candidateCode.length > primaryCode.length) {
      return 'Manufacturer suffix pattern';
    }
    return '';
  }

  function buildGroupedModel(rows) {
    const assemblyInstructions = [];
    const groups = [];
    let active = null;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.classification === 'MESSAGE') {
        if (!active) assemblyInstructions.push(row);
        else active.messageRows.push(row);
        continue;
      }
      const reason = active && active.messageRows.length === 0
        ? relatedPartReason(active.primaryPart, row)
        : '';
      if (reason) {
        active.relatedParts.push({ row, reason });
        active.sourceSequences.push(clean(row.sequence));
        continue;
      }
      active = {
        groupId: 'G' + String(groups.length + 1).padStart(3, '0'),
        primaryPart: row,
        relatedParts: [],
        messageRows: [],
        sourceSequences: [clean(row.sequence)]
      };
      groups.push(active);
    }

    groups.forEach(group => {
      const parsedMessages = group.messageRows.map(row => ({ row, parsed: parseFindMessage(row.materialMessage) }));
      const primaryMessage = parsedMessages.find(entry => entry.parsed.findNumber !== null) || null;
      group.findNumber = primaryMessage?.parsed.findNumber ?? null;
      group.references = primaryMessage?.parsed.references ?? [];
      group.notes = parsedMessages.filter(entry => entry !== primaryMessage)
        .map(entry => clean(entry.row.materialMessage)).filter(Boolean);
      if (primaryMessage?.parsed.note) group.notes.push(primaryMessage.parsed.note);
      group.sourceSequences.push(...group.messageRows.map(row => clean(row.sequence)));
      group.sequence = clean(group.primaryPart.sequence);
      group.partNumber = clean(group.primaryPart.itemNumber);
      group.eligibleParts = [group.partNumber, ...group.relatedParts.map(part => clean(part.row.itemNumber))]
        .filter((part, index, values) => part && values.indexOf(part) === index);
      group.description = clean(group.primaryPart.description) || '*** NOT ON FILE ***';
      group.unitOfMeasure = clean(group.primaryPart.unitOfMeasure);
      group.requiredEach = Number(group.primaryPart.requiredEach) || 0;
      group.requiredQuantity = Number(group.primaryPart.totalWorkOrderUnits) || 0;
      group.classification = group.partNumber === 'DO NOT POPULATE'
        ? 'DNP'
        : group.requiredEach < 1 ? 'FRACTIONAL' : 'STANDARD';
      group.actionable = group.classification !== 'DNP' && group.requiredQuantity > 0;
    });
    return { assemblyInstructions, groups };
  }

  function createDraft(report, employeeName) {
    const grouped = buildGroupedModel(report?.rows);
    return {
      schemaVersion: 2,
      persistenceState: 'GOVERNED_5054_DRAFT',
      workOrder: clean(report?.header?.workOrder),
      enteredWorkOrder: clean(report?.header?.enteredAlias),
      employeeName: clean(employeeName) || 'Authenticated DLE-OS employee',
      state: 'KITTING_IN_PROGRESS',
      header: report?.header || {},
      assemblyInstructions: grouped.assemblyInstructions,
      groups: grouped.groups.map(group => ({
        ...group,
        entry: null,
        rowState: 'EDITING',
        revisionNumber: 0
      }))
    };
  }

  function refreshReleasedBomMessageProjection(draft, releasedBomDraft) {
    if (!draft || !releasedBomDraft) return draft;
    const currentGroups = new Map((releasedBomDraft.groups || []).map(group => [clean(group.sequence), group]));
    for (const group of draft.groups || []) {
      const current = currentGroups.get(clean(group.sequence));
      if (!current) continue;
      group.findNumber = current.findNumber;
      group.references = [...(current.references || [])];
      group.notes = [...(current.notes || [])];
    }
    draft.assemblyInstructions = [...(releasedBomDraft.assemblyInstructions || [])];
    return draft;
  }

  function findGroup(draft, sequence) {
    return draft?.groups?.find(group => group.sequence === clean(sequence)) || null;
  }

  function calculateCountRollup(group, allocations) {
    const eligibleParts = Array.isArray(group?.eligibleParts) ? group.eligibleParts : [];
    const normalized = (Array.isArray(allocations) ? allocations : []).map((allocation, index) => ({
      allocationId: clean(allocation?.allocationId) || 'A' + (index + 1),
      partNumber: clean(allocation?.partNumber),
      quantity: normalizeCountInput(allocation?.quantity),
      purchaseOrder: clean(allocation?.purchaseOrder).slice(0, 40),
      acceptedMaterial: allocation?.acceptedMaterial || null,
      evidenceOperator: clean(allocation?.evidenceOperator),
      evidenceAtUtc: clean(allocation?.evidenceAtUtc)
    }));
    const valid = normalized.length > 0 && normalized.every(allocation =>
      (!eligibleParts.length || eligibleParts.includes(allocation.partNumber)) && allocation.quantity !== null);
    const picked = valid ? normalized.reduce((total, allocation) => total + allocation.quantity, 0) : null;
    const shortage = picked === null ? null : Math.max(group.requiredQuantity - picked, 0);
    const extra = picked === null ? null : Math.max(picked - group.requiredQuantity, 0);
    return {
      method: METHODS.COUNT,
      selectedPartNumber: null,
      purchaseOrder: '',
      allocations: normalized,
      pickedQuantity: picked,
      shortageQuantity: shortage,
      extraQuantity: extra,
      result: picked === null ? 'COUNT_REQUIRED'
        : shortage > 0 ? 'COUNTED_SHORT' : extra > 0 ? 'COUNTED_EXTRA' : 'COUNTED_EXACT'
    };
  }

  function calculateEntry(group, method, enteredQuantity, operator = '') {
    if (!group?.actionable || !Object.values(METHODS).includes(method)) return null;
    const required = group.requiredQuantity;
    const defaultPart = group.eligibleParts?.length === 1 ? group.eligibleParts[0] : null;
    if (method === METHODS.COMPLETE) {
      return { method, selectedPartNumber: defaultPart, purchaseOrder: '', allocations: [], pickedQuantity: null,
        evidenceOperator: clean(operator), evidenceAtUtc: new Date().toISOString(),
        shortageQuantity: 0, extraQuantity: null, result: 'COMPLETE' };
    }
    if (method === METHODS.COMPLETE_MIN_EXTRA) {
      return { method, selectedPartNumber: defaultPart, purchaseOrder: '', allocations: [], pickedQuantity: null,
        evidenceOperator: clean(operator), evidenceAtUtc: new Date().toISOString(),
        shortageQuantity: 0, extraQuantity: null, result: 'COMPLETE_MIN_EXTRA' };
    }
    return calculateCountRollup(group, [{ allocationId: 'A1', partNumber: defaultPart || '',
      quantity: enteredQuantity, purchaseOrder: '', evidenceOperator: clean(operator),
      evidenceAtUtc: new Date().toISOString() }]);
  }

  function applyMethod(draft, sequence, method, enteredQuantity = null) {
    const group = findGroup(draft, sequence);
    if (!group || group.rowState === 'SUBMITTED') return null;
    group.entry = calculateEntry(group, method, enteredQuantity, draft?.employeeName);
    return group.entry;
  }

  function setCount(draft, sequence, enteredQuantity) {
    const group = findGroup(draft, sequence);
    if (!group?.entry || group.rowState === 'SUBMITTED' || group.entry.method !== METHODS.COUNT) return null;
    const allocations = group.entry.allocations.map((allocation, index) =>
      index === 0 ? { ...allocation, quantity: enteredQuantity } : allocation);
    group.entry = calculateCountRollup(group, allocations);
    return group.entry;
  }

  function setSelectedPart(draft, sequence, value) {
    const group = findGroup(draft, sequence);
    const partNumber = clean(value);
    if (!group?.entry || group.rowState === 'SUBMITTED' || group.entry.method === METHODS.COUNT ||
        !group.eligibleParts.includes(partNumber)) return null;
    if (group.entry.selectedPartNumber !== partNumber) group.entry.acceptedMaterial = null;
    group.entry.selectedPartNumber = partNumber;
    return group.entry;
  }

  function setPurchaseOrder(draft, sequence, value) {
    const group = findGroup(draft, sequence);
    if (!group?.entry || group.rowState === 'SUBMITTED' || group.entry.method === METHODS.COUNT) return '';
    const next = clean(value).slice(0, 40);
    if (group.entry.purchaseOrder !== next) group.entry.acceptedMaterial = null;
    group.entry.purchaseOrder = next;
    return group.entry.purchaseOrder;
  }

  function addAllocation(draft, sequence) {
    const group = findGroup(draft, sequence);
    if (!group?.entry || group.rowState === 'SUBMITTED' || group.entry.method !== METHODS.COUNT) return null;
    const next = Math.max(0, ...group.entry.allocations.map(allocation => Number(clean(allocation.allocationId).slice(1)) || 0)) + 1;
    group.entry = calculateCountRollup(group, [...group.entry.allocations, {
      allocationId: 'A' + next,
      partNumber: group.eligibleParts.length === 1 ? group.eligibleParts[0] : '',
      quantity: 0,
      purchaseOrder: '',
      evidenceOperator: clean(draft?.employeeName),
      evidenceAtUtc: new Date().toISOString()
    }]);
    return group.entry;
  }

  function updateAllocation(draft, sequence, allocationId, changes) {
    const group = findGroup(draft, sequence);
    if (!group?.entry || group.rowState === 'SUBMITTED' || group.entry.method !== METHODS.COUNT) return null;
    const sourceChanged = Object.hasOwn(changes || {}, 'partNumber') || Object.hasOwn(changes || {}, 'purchaseOrder');
    const allocations = group.entry.allocations.map(allocation => allocation.allocationId === clean(allocationId)
      ? { ...allocation, ...changes, acceptedMaterial: sourceChanged ? null : allocation.acceptedMaterial,
          allocationId: allocation.allocationId,
          evidenceOperator: clean(draft?.employeeName), evidenceAtUtc: new Date().toISOString() }
      : allocation);
    group.entry = calculateCountRollup(group, allocations);
    return group.entry;
  }

  function setAcceptedMaterial(draft, sequence, allocationId, identity) {
    const group = findGroup(draft, sequence);
    if (!group?.entry || group.rowState === 'SUBMITTED') return null;
    if (clean(allocationId)) {
      const allocation = group.entry.allocations?.find(item => item.allocationId === clean(allocationId));
      if (!allocation) return null;
      allocation.acceptedMaterial = identity || null;
      return allocation;
    }
    group.entry.acceptedMaterial = identity || null;
    return group.entry;
  }

  function removeAllocation(draft, sequence, allocationId) {
    const group = findGroup(draft, sequence);
    if (!group?.entry || group.rowState === 'SUBMITTED' || group.entry.method !== METHODS.COUNT ||
        group.entry.allocations.length <= 1) return null;
    group.entry = calculateCountRollup(group,
      group.entry.allocations.filter(allocation => allocation.allocationId !== clean(allocationId)));
    return group.entry;
  }

  function hasRequiredPoTraceability(group) {
    if (!group?.entry) return false;
    if (group.entry.method === METHODS.COUNT) {
      return group.entry.allocations.every(allocation => Number(allocation.quantity) <= 0 || !!clean(allocation.purchaseOrder));
    }
    return !!clean(group.entry.purchaseOrder);
  }

  function isCompleteDispositionEntry(entry) {
    if (!entry) return false;
    return entry.method === METHODS.COMPLETE || entry.method === METHODS.COMPLETE_MIN_EXTRA ||
      (entry.shortageQuantity !== null && Number(entry.shortageQuantity) === 0);
  }

  function getRequiredPoTraceabilityBlockers(draft, poTraceabilityRequired = false, options = {}) {
    if (!poTraceabilityRequired) return [];
    const sequence = clean(options.sequence);
    return (draft?.groups || []).filter(group => {
      if (!group?.actionable || !group.entry) return false;
      if (sequence && group.sequence !== sequence) return false;
      const submitted = group.rowState === 'SUBMITTED';
      const editingComplete = options.includeEditingComplete === true &&
        group.rowState !== 'SUBMITTED' && isCompleteDispositionEntry(group.entry);
      return (submitted || editingComplete) && !hasRequiredPoTraceability(group);
    }).map(group => ({
      sequence: group.sequence,
      method: group.entry?.method || '',
      rowState: group.rowState || '',
      message: 'P.O. is required before this Complete Kitting result can be saved or closed.'
    }));
  }

  function submitGroup(draft, sequence, poTraceabilityRequired = false) {
    const group = findGroup(draft, sequence);
    if (!group?.actionable || group.rowState === 'SUBMITTED' ||
        !group.entry || group.entry.shortageQuantity === null ||
        (group.entry.method !== METHODS.COUNT && !group.eligibleParts.includes(group.entry.selectedPartNumber)) ||
        (group.entry.method === METHODS.COUNT && !group.entry.allocations.every(allocation =>
          group.eligibleParts.includes(allocation.partNumber) && allocation.quantity !== null)) ||
        (poTraceabilityRequired && !hasRequiredPoTraceability(group))) return null;
    group.rowState = 'SUBMITTED';
    group.revisionNumber += 1;
    group.lastSubmittedBy = clean(draft?.employeeName);
    group.lastSubmittedAtUtc = new Date().toISOString();
    return group;
  }

  function editGroup(draft, sequence) {
    const group = findGroup(draft, sequence);
    if (!group?.actionable || group.rowState !== 'SUBMITTED') return null;
    group.rowState = 'EDITING';
    return group;
  }

  function getSubmittedVisualState(entry) {
    if (!entry || entry.shortageQuantity === null) return null;
    if (entry.result === 'COMPLETE') {
      return { tone: 'GREEN', icon: 'CHECK', label: 'Complete' };
    }
    if (entry.result === 'COMPLETE_MIN_EXTRA') {
      return { tone: 'AMBER', icon: 'CHECK', label: 'Complete - Min Extra' };
    }
    if (entry.shortageQuantity > 0) {
      return {
        tone: 'RED', icon: 'WARNING',
        label: 'Counted ' + entry.pickedQuantity + ' - Short ' + entry.shortageQuantity
      };
    }
    return {
      tone: entry.extraQuantity > 5 ? 'GREEN' : 'AMBER',
      icon: 'CHECK',
      label: entry.extraQuantity > 0
        ? 'Counted ' + entry.pickedQuantity + ' - ' + entry.extraQuantity + ' extra'
        : 'Counted ' + entry.pickedQuantity + ' - Complete'
    };
  }

  function getSummary(draft, poTraceabilityRequired = false) {
    const actionable = draft?.groups?.filter(group => group.actionable) || [];
    const submitted = actionable.filter(group => group.rowState === 'SUBMITTED' &&
      group.entry && group.entry.shortageQuantity !== null);
    const shortRows = submitted.filter(group => group.entry.shortageQuantity > 0);
    const traceabilityBlockers = poTraceabilityRequired
      ? submitted.filter(group => !hasRequiredPoTraceability(group)) : [];
    return {
      actionableCount: actionable.length,
      completedCount: submitted.length,
      submittedCount: submitted.length,
      remainingCount: actionable.length - submitted.length,
      shortCount: shortRows.length,
      traceabilityBlockerCount: traceabilityBlockers.length,
      canSubmit: actionable.length > 0 && submitted.length === actionable.length && traceabilityBlockers.length === 0,
      resultingDisposition: submitted.length === actionable.length && traceabilityBlockers.length === 0
        ? (shortRows.length ? 'KIT_SHORT' : 'KIT_COMPLETE')
        : null
    };
  }

  function releasedBomDocument(draft, navigation = {}) {
    const header = draft?.header || {};
    const groups = Array.isArray(draft?.groups) ? draft.groups : [];
    if (!clean(draft?.workOrder || header.workOrder) || !groups.length) return '';
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    const quantity = value => {
      const number = Number(value);
      return Number.isFinite(number)
        ? number.toFixed(4).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, '').replace(/\.$/, '')
        : clean(value) || '\u2014';
    };
    const workOrder = clean(draft.workOrder || header.workOrder);
    const returnValue = clean(navigation.returnUrl);
    const returnUrl = returnValue.startsWith('/') && !returnValue.startsWith('//') ? returnValue : '/';
    const field = (label, value) => '<div><span>' + escapeHtml(label) + '</span><strong>' +
      escapeHtml(clean(value) || '\u2014') + '</strong></div>';
    const instructions = (draft.assemblyInstructions || []).map(instruction => '<li><strong>SEQ ' +
      escapeHtml(instruction.sequence) + '</strong><span>' + escapeHtml(instruction.materialMessage) + '</span></li>').join('');
    const rows = [...groups].sort((left, right) => clean(left.sequence).localeCompare(
      clean(right.sequence), undefined, { numeric: true })).map(group => {
      const related = (group.relatedParts || []).map(part => clean(part?.row?.itemNumber)).filter(Boolean);
      const references = (group.references || []).map(clean).filter(Boolean);
      const notes = (group.notes || []).map(clean).filter(Boolean);
      return '<tr data-sequence="' + escapeHtml(group.sequence) + '"><td><strong>' +
        escapeHtml(group.sequence) + '</strong></td><td>' + escapeHtml(group.findNumber ?? '\u2014') +
        '</td><td><strong>' + escapeHtml(group.partNumber || group?.primaryPart?.itemNumber) + '</strong>' +
        (related.length ? '<small>Related: ' + escapeHtml(related.join(', ')) + '</small>' : '') +
        '</td><td>' + escapeHtml(group.description || group?.primaryPart?.description || 'NOT ON FILE') +
        (references.length ? '<small>Refs: ' + escapeHtml(references.join(', ')) + '</small>' : '') +
        (notes.length ? '<small>Note: ' + escapeHtml(notes.join(' \u00b7 ')) + '</small>' : '') +
        '</td><td class="number"><span>' + escapeHtml(quantity(group.requiredEach)) + ' / assy</span><strong>' +
        escapeHtml(quantity(group.requiredQuantity)) + ' ' + escapeHtml(group.unitOfMeasure) + '</strong></td></tr>';
    }).join('');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>WO ' + escapeHtml(workOrder) + ' \u2014 Released BOM</title><style>' +
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
      '@media print{.toolbar{display:none!important}body{background:#fff}main{width:100%;margin:0;padding:0;box-shadow:none}.material-table th{position:static}}' +
      '</style></head><body><header class="toolbar"><strong>Released BOM \u00b7 Kitting Pick View</strong><span id="reportIdentity">WO ' +
      escapeHtml(workOrder) + ' \u00b7 ' + escapeHtml(header.billNumber) + ' Rev ' + escapeHtml(header.revision) +
      '</span><div class="toolbar-actions"><a id="backToKittingJob" href="' + escapeHtml(returnUrl) +
      '" onclick="if(window.opener&&!window.opener.closed){window.opener.focus();window.close();if(window.closed)return false}">\u2190 Back to Kitting Job</a>' +
      '<button id="printReleasedBom" type="button" onclick="window.print()">Print Released BOM</button></div></header><main>' +
      '<h1>WORK ORDER RELEASED BOM</h1><p class="subtitle">Governed persisted Kitting material source \u00b7 read only</p><section class="identity">' +
      field('Work Order', workOrder) + field('Assembly', header.billNumber) + field('Revision', header.revision) +
      field('Build Quantity', quantity(header.scheduledProduction) + ' ' + clean(header.unitOfMeasure)) +
      field('Customer', header.customer) + field('Sales Order', header.salesOrder) + field('SO Line', header.salesOrderLine) +
      field('Customer P.O.', header.customerPurchaseOrder) + '</section>' +
      (instructions ? '<section class="instructions"><h2>Assembly Instructions</h2><ul>' + instructions + '</ul></section>' : '') +
      '<table class="material-table" aria-label="Work Order ' + escapeHtml(workOrder) + ' Released BOM material requirements"><colgroup>' +
      '<col class="seq"><col class="find"><col class="part"><col><col class="required"></colgroup><thead><tr><th>WO Seq</th><th>Find</th>' +
      '<th>Part / Related Part</th><th>Description / References</th><th class="number">Required</th></tr></thead><tbody>' + rows +
      '</tbody></table></main></body></html>';
  }

  window.ActiveKittingTrial = Object.freeze({
    METHODS,
    normalizeCountInput,
    sanitizeCountInput,
    parseFindMessage,
    buildGroupedModel,
    createDraft,
    refreshReleasedBomMessageProjection,
    calculateEntry,
    calculateCountRollup,
    applyMethod,
    setCount,
    setSelectedPart,
    setPurchaseOrder,
    setAcceptedMaterial,
    addAllocation,
    updateAllocation,
    removeAllocation,
    submitGroup,
    hasRequiredPoTraceability,
    getRequiredPoTraceabilityBlockers,
    editGroup,
    getSubmittedVisualState,
    getSummary,
    releasedBomDocument
  });
})();

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
    getSummary
  });
})();

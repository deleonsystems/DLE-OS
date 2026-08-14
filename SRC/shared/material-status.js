(function registerMaterialStatusProjection(window) {
  'use strict';

  const STATES = Object.freeze({
    NEEDS_KITTING: 'NEEDS_KITTING',
    KITTING_IN_PROGRESS: 'KITTING_IN_PROGRESS',
    KIT_SHORT: 'KIT_SHORT',
    KIT_COMPLETE: 'KIT_COMPLETE'
  });
  const LABELS = Object.freeze({
    NEEDS_KITTING: 'Needs Kitting',
    KITTING_IN_PROGRESS: 'Kitting In Progress',
    KIT_SHORT: 'Kit Short',
    KIT_COMPLETE: 'Kit Complete'
  });
  const CHANGE_EVENT = 'dle:material-status-change';
  const cache = new Map();
  const pending = new Map();

  function normalizeWorkOrderNumber(value) {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) ? text.padStart(7, '0') : '';
  }

  function project(workOrderNumber, kittingCase, eligible = true, legacyMaterialStatus = null,
      hasPersistentKittingHistory = false) {
    const normalized = normalizeWorkOrderNumber(workOrderNumber);
    if (!normalized || !eligible) return null;
    const caseState = String(kittingCase?.state || '').trim().toUpperCase();
    const legacyState = String(legacyMaterialStatus?.machineValue || '').trim().toUpperCase();
    const machineValue = Object.prototype.hasOwnProperty.call(STATES, caseState)
      ? caseState
      : !hasPersistentKittingHistory && [STATES.KIT_SHORT, STATES.KIT_COMPLETE].includes(legacyState)
        ? legacyState
        : STATES.NEEDS_KITTING;
    const source = kittingCase
      ? 'KITTING_CASE'
      : !hasPersistentKittingHistory && machineValue === legacyState
        ? String(legacyMaterialStatus?.source || 'LEGACY_KITTING_EVIDENCE')
        : hasPersistentKittingHistory
          ? 'KITTING_CASE_HISTORY'
          : 'KITTING_ELIGIBILITY';
    return Object.freeze({
      workOrderNumber: normalized,
      machineValue,
      label: LABELS[machineValue],
      source,
      runNumber: Number(kittingCase?.runNumber) || null,
      workingVersion: Number(kittingCase?.workingVersion) || null,
      kittingCase: kittingCase || null,
      legacyEvidence: source.startsWith('LEGACY_') ? legacyMaterialStatus : null,
      hasPersistentKittingHistory: Boolean(kittingCase || hasPersistentKittingHistory)
    });
  }

  async function get(workOrderNumber, options = {}) {
    const normalized = normalizeWorkOrderNumber(workOrderNumber);
    if (!normalized || options.eligible === false) return null;
    if (!options.force && cache.has(normalized)) return cache.get(normalized);
    if (!options.force && pending.has(normalized)) return pending.get(normalized);
    const getter = window.DleApiClient?.getKittingCase;
    if (typeof getter !== 'function') throw new Error('The governed Material Status source is unavailable.');
    const request = getter(normalized, options.signal ? { signal: options.signal } : {})
      .then(response => {
        const value = project(normalized, response?.kittingCase || null, true,
          response?.legacyMaterialStatus || null, response?.hasPersistentKittingHistory === true);
        cache.set(normalized, value);
        return value;
      })
      .finally(() => pending.delete(normalized));
    pending.set(normalized, request);
    return request;
  }

  async function getMany(workOrderNumbers, options = {}) {
    const normalized = Array.from(new Set((workOrderNumbers || [])
      .map(normalizeWorkOrderNumber).filter(Boolean))).sort();
    const results = new Map();
    let index = 0;
    const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 4, normalized.length || 1));
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (index < normalized.length) {
        const workOrderNumber = normalized[index++];
        results.set(workOrderNumber, await get(workOrderNumber, options));
      }
    }));
    return results;
  }

  function publish(workOrderNumber, kittingCase) {
    const normalized = normalizeWorkOrderNumber(workOrderNumber);
    if (!normalized) return null;
    const value = project(normalized, kittingCase || null, true);
    cache.set(normalized, value);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: Object.freeze({ workOrderNumbers: [normalized], materialStatus: value })
    }));
    return value;
  }

  function invalidate(workOrderNumbers, options = {}) {
    const normalized = Array.from(new Set((Array.isArray(workOrderNumbers)
      ? workOrderNumbers : [workOrderNumbers]).map(normalizeWorkOrderNumber).filter(Boolean)));
    normalized.forEach(workOrderNumber => cache.delete(workOrderNumber));
    if (normalized.length && options.notify !== false) window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: Object.freeze({ workOrderNumbers: normalized, materialStatus: null })
    }));
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    const handler = event => listener(event.detail || {});
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }

  window.MaterialStatus = Object.freeze({
    STATES,
    LABELS,
    project,
    get,
    getMany,
    publish,
    invalidate,
    subscribe,
    normalizeWorkOrderNumber
  });
})(window);

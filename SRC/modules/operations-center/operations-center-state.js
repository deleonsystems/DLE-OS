/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER STATE
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const state = {
    canonicalRows: [],
    canonicalLoading: false,
    canonicalLoaded: false,
    canonicalError: '',
    canonicalStale: false,
    canonicalLoadedAt: '',
    canonicalRecordCount: 0,
    canonicalTotalItems: 0,
    canonicalSource: 'DLE_OS_CANONICAL_LIVE',
    canonicalEndpoint: '/api/platform/live/v1/sales-orders',
    canonicalRequestId: 0,
    verifiedStatusByKey: {},
    workOrderVerifiedStatusByNumber: {},
    verifiedStatusLoading: false,
    verifiedStatusError: '',
    hideRmaRework: false
  };

  function beginCanonicalLoad() {
    state.canonicalLoading = true;
    state.canonicalError = '';
    state.canonicalStale = state.canonicalLoaded && state.canonicalRows.length > 0;
    state.canonicalRequestId += 1;
    return state.canonicalRequestId;
  }

  function commitCanonicalLoad(result, requestId) {
    if (requestId !== state.canonicalRequestId) return false;
    state.canonicalRows = Array.isArray(result?.rows) ? result.rows : [];
    state.canonicalLoading = false;
    state.canonicalLoaded = true;
    state.canonicalError = '';
    state.canonicalStale = false;
    state.canonicalLoadedAt = result.loadedAt || new Date().toISOString();
    state.canonicalRecordCount = state.canonicalRows.length;
    state.canonicalTotalItems = Number(result.totalItems ?? state.canonicalRows.length);
    state.canonicalSource = result.source || state.canonicalSource;
    state.canonicalEndpoint = result.endpoint || state.canonicalEndpoint;
    return true;
  }

  function failCanonicalLoad(error, requestId) {
    if (requestId !== state.canonicalRequestId) return false;
    state.canonicalLoading = false;
    state.canonicalError = String(error?.message || error || 'Canonical Sales Orders is unavailable.');
    state.canonicalStale = state.canonicalLoaded && state.canonicalRows.length > 0;
    return true;
  }

  function setVerifiedStatusLoading(value) {
    state.verifiedStatusLoading = !!value;
    if (value) state.verifiedStatusError = '';
  }

  function setVerifiedStatusError(error) {
    state.verifiedStatusLoading = false;
    state.verifiedStatusError = String(error?.message || error || 'Last Verified Status is unavailable.');
  }

  function setVerifiedStatusRecords(records, workOrderRecords = []) {
    state.verifiedStatusByKey = (Array.isArray(records) ? records : []).reduce((map, record) => {
      if (record?.masterRecordKey) map[record.masterRecordKey] = record;
      return map;
    }, {});
    state.workOrderVerifiedStatusByNumber = (Array.isArray(workOrderRecords) ? workOrderRecords : []).reduce((map, record) => {
      const workOrder = normalizeWorkOrderNumber(record?.workOrderNumber);
      if (workOrder) map[workOrder] = record;
      return map;
    }, {});
    state.verifiedStatusLoading = false;
    state.verifiedStatusError = '';
  }

  function upsertVerifiedStatusRecord(record) {
    if (!record?.masterRecordKey) return false;
    state.verifiedStatusByKey = {
      ...state.verifiedStatusByKey,
      [record.masterRecordKey]: record
    };
    state.verifiedStatusError = '';
    return true;
  }

  function upsertWorkOrderVerifiedStatusRecord(record) {
    const workOrder = normalizeWorkOrderNumber(record?.workOrderNumber);
    if (!workOrder) return false;
    state.workOrderVerifiedStatusByNumber = {
      ...state.workOrderVerifiedStatusByNumber,
      [workOrder]: record
    };
    state.verifiedStatusError = '';
    return true;
  }

  function getVerifiedStatusRecord(masterRecordKey) {
    return state.verifiedStatusByKey[String(masterRecordKey || '')] || null;
  }

  function getWorkOrderVerifiedStatusRecord(workOrderNumber) {
    return state.workOrderVerifiedStatusByNumber[normalizeWorkOrderNumber(workOrderNumber)] || null;
  }

  function normalizeWorkOrderNumber(value) {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) ? text.padStart(7, '0') : '';
  }

  function setHideRmaRework(value) {
    state.hideRmaRework = !!value;
    return state.hideRmaRework;
  }

  function toggleHideRmaRework() {
    return setHideRmaRework(!state.hideRmaRework);
  }

  window.OperationsCenter.state = state;
  window.OperationsCenter.stateActions = {
    beginCanonicalLoad,
    commitCanonicalLoad,
    failCanonicalLoad,
    setVerifiedStatusLoading,
    setVerifiedStatusError,
    setVerifiedStatusRecords,
    upsertVerifiedStatusRecord,
    upsertWorkOrderVerifiedStatusRecord,
    getVerifiedStatusRecord,
    getWorkOrderVerifiedStatusRecord,
    setHideRmaRework,
    toggleHideRmaRework
  };

  window.operationsCenterState = state;
})();

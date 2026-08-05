/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER STATE
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const overlaySchema = window.OperationsCenter.overlaySchema;
  const persistedFieldKeys = overlaySchema.persistedFieldKeys || [];

  const state = {
    overlayByKey: {},
    dirtyOverlayByKey: {},
    sourceFile: overlaySchema.dataPath,
    fileHandle: null,
    writable: false,
    loaded: false,
    dirty: false,
    createdAt: '',
    lastUpdated: '',
    persistenceMode: 'Not Loaded',
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
    hideRmaRework: false
  };

  function setOverlayDataset(dataset, options = {}) {
    const normalized = overlaySchema.normalizeDataset(dataset);
    state.overlayByKey = normalized.records.reduce((map, record) => {
      if (record.masterRecordKey) map[record.masterRecordKey] = overlaySchema.stripRecord(record);
      return map;
    }, {});
    state.dirtyOverlayByKey = {};
    state.dirty = false;
    state.createdAt = normalized.createdAt;
    state.lastUpdated = normalized.lastUpdated;
    state.sourceFile = options.sourceFile || state.sourceFile || overlaySchema.dataPath;
    state.persistenceMode = options.persistenceMode || state.persistenceMode;
  }

  function getOverlayRecord(masterRecordKey) {
    return {
      masterRecordKey,
      ...overlaySchema.blankOverlayFields(),
      ...(state.overlayByKey[masterRecordKey] || {}),
      ...(state.dirtyOverlayByKey[masterRecordKey] || {})
    };
  }

  function updateOverlayField(masterRecordKey, field, value) {
    if (!masterRecordKey || !persistedFieldKeys.includes(field)) return false;

    state.dirtyOverlayByKey[masterRecordKey] = {
      ...overlaySchema.blankOverlayFields(),
      ...(state.overlayByKey[masterRecordKey] || {}),
      ...(state.dirtyOverlayByKey[masterRecordKey] || {}),
      masterRecordKey,
      [field]: value || ''
    };
    state.dirty = true;
    return true;
  }

  function buildPendingOverlayByKey() {
    const pendingOverlayByKey = { ...state.overlayByKey };
    Object.entries(state.dirtyOverlayByKey).forEach(([masterRecordKey, record]) => {
      const clean = overlaySchema.stripRecord({
        ...record,
        masterRecordKey,
        updatedAt: new Date().toLocaleString(),
        updatedBy: 'DLE-OS User'
      });

      if (overlaySchema.isRecordEmpty(clean)) {
        delete pendingOverlayByKey[masterRecordKey];
      } else {
        pendingOverlayByKey[masterRecordKey] = clean;
      }
    });
    return pendingOverlayByKey;
  }

  function commitSavedOverlay(overlayByKey, dataset, options = {}) {
    state.overlayByKey = overlayByKey || {};
    state.dirtyOverlayByKey = {};
    state.dirty = false;
    state.createdAt = dataset.createdAt || state.createdAt;
    state.lastUpdated = dataset.lastUpdated || state.lastUpdated;
    state.sourceFile = options.sourceFile || state.sourceFile;
    state.persistenceMode = options.persistenceMode || state.persistenceMode;
    state.writable = !!options.writable || state.writable;
    state.fileHandle = options.fileHandle || state.fileHandle;
  }

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

  function setHideRmaRework(value) {
    state.hideRmaRework = !!value;
    return state.hideRmaRework;
  }

  function toggleHideRmaRework() {
    return setHideRmaRework(!state.hideRmaRework);
  }

  window.OperationsCenter.state = state;
  window.OperationsCenter.stateActions = {
    setOverlayDataset,
    getOverlayRecord,
    updateOverlayField,
    buildPendingOverlayByKey,
    commitSavedOverlay,
    beginCanonicalLoad,
    commitCanonicalLoad,
    failCanonicalLoad,
    setHideRmaRework,
    toggleHideRmaRework
  };

  window.operationsCenterState = state;
})();

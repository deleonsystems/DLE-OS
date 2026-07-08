/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER STATE
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const overlaySchema = window.OperationsCenter.overlaySchema;
  const overlayFields = (window.OperationsCenter.overlayFields || [])
    .filter(field => !field.documentLink);

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
    persistenceMode: 'Not Loaded'
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
    if (!masterRecordKey || !overlayFields.some(item => item.key === field)) return false;

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

  window.OperationsCenter.state = state;
  window.OperationsCenter.stateActions = {
    setOverlayDataset,
    getOverlayRecord,
    updateOverlayField,
    buildPendingOverlayByKey,
    commitSavedOverlay
  };

  window.operationsCenterState = state;
})();

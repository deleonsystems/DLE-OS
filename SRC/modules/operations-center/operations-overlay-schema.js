/* -----------------------------------------------------
   460 - JS: OPERATIONS OVERLAY SCHEMA
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const overlayFields = (window.OperationsCenter.overlayFields || [])
    .filter(field => !field.documentLink);
  const persistedFieldKeys = Array.from(new Set([
    ...overlayFields.map(field => field.key),
    'operationalStatus'
  ]));

  const schema = {
    dataPath: 'DATA/operations-center/operations-overlay.json',
    schemaName: 'DLE_OPERATIONS_OVERLAY_V1',
    version: '1.0',
    storageKey: 'DLE_OS_OPERATIONS_OVERLAY_V1'
  };

  function createEmptyDataset() {
    return {
      schema: schema.schemaName,
      version: schema.version,
      createdAt: '',
      lastUpdated: '',
      recordCount: 0,
      records: []
    };
  }

  function blankOverlayFields() {
    return persistedFieldKeys.reduce((record, field) => {
      record[field] = '';
      return record;
    }, {});
  }

  function stripRecord(record) {
    const clean = { masterRecordKey: String(record?.masterRecordKey || '') };
    persistedFieldKeys.forEach(field => {
      clean[field] = String(record?.[field] ?? '');
    });
    if (record?.updatedAt) clean.updatedAt = String(record.updatedAt);
    if (record?.updatedBy) clean.updatedBy = String(record.updatedBy);
    return clean;
  }

  function normalizeDataset(dataset) {
    const source = dataset && typeof dataset === 'object' ? dataset : {};
    const sourceRecords = Array.isArray(source.records)
      ? source.records
      : source.records && typeof source.records === 'object'
        ? Object.entries(source.records).map(([masterRecordKey, record]) => ({ masterRecordKey, ...(record || {}) }))
        : [];

    return {
      schema: source.schema || schema.schemaName,
      version: source.version || schema.version,
      createdAt: source.createdAt || '',
      lastUpdated: source.lastUpdated || '',
      records: sourceRecords
        .filter(record => record && typeof record === 'object' && record.masterRecordKey)
        .map(stripRecord)
    };
  }

  function isRecordEmpty(record) {
    return persistedFieldKeys.every(field => !String(record?.[field] || '').trim());
  }

  function buildDatasetForWrite(overlayByKey, options = {}) {
    const now = options.now || new Date().toLocaleString();
    const records = Object.values(overlayByKey || {})
      .map(stripRecord)
      .filter(record => !isRecordEmpty(record))
      .sort((a, b) => a.masterRecordKey.localeCompare(b.masterRecordKey));

    return {
      schema: schema.schemaName,
      version: schema.version,
      createdAt: options.createdAt || now,
      lastUpdated: now,
      recordCount: records.length,
      records
    };
  }

  window.OperationsCenter.overlaySchema = {
    ...schema,
    createEmptyDataset,
    blankOverlayFields,
    stripRecord,
    normalizeDataset,
    isRecordEmpty,
    buildDatasetForWrite,
    persistedFieldKeys
  };
})();

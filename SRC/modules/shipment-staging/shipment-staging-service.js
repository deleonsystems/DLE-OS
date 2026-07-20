/* -----------------------------------------------------
   440 - JS: SHIPMENT STAGING SERVICE
----------------------------------------------------- */

/*
  Shipment Staging owns this service as the home for its business-state
  persistence. Phase 2 adds write support for confirmed shipment records
  while keeping persistence isolated to this module.
*/

(function () {
  'use strict';

  const SHIPMENT_STAGING_DATA_PATH = 'DATA/shipment-staging/shipment-staging.json';
  const SHIPMENT_STAGING_SCHEMA = 'DLE_SHIPMENT_STAGING_V1';
  const SHIPMENT_STAGING_VERSION = '1.0';
  const SHIPMENT_STAGING_HANDLE_DB = 'DLE_OS_SHIPMENT_STAGING_HANDLES';
  const SHIPMENT_STAGING_HANDLE_STORE = 'fileHandles';
  const SHIPMENT_STAGING_HANDLE_KEY = 'shipmentStaging';

  let lastShipmentStagingLoadSource = SHIPMENT_STAGING_DATA_PATH;
  let lastShipmentStagingLoadMode = 'Project JSON loaded read-only';

  async function initializeShipmentStagingPersistence() {
    try {
      const connectedDataset = await loadConnectedShipmentStagingDataset();
      const dataset = connectedDataset || await loadShipmentStagingDataset();
      if (!connectedDataset) {
        validateShipmentStagingDataset(dataset);
        applyShipmentStagingDataset(dataset);
      }
      const records = getShipmentStagingDatasetRecords(dataset);
      reportShipmentStagingPersistenceStatus(
        records.length
          ? records.length + ' persisted Shipment Staging record' + (records.length === 1 ? '' : 's') + ' restored.'
          : 'Shipment Staging persistence loaded. No persisted records found.'
      );
    } catch (error) {
      reportShipmentStagingPersistenceError(error);
    }
  }

  async function loadConnectedShipmentStagingDataset() {
    const handle = await readStoredShipmentStagingFileHandle();
    if (!handle) return null;

    try {
      const dataset = await readShipmentStagingDatasetFromHandle(handle);
      const writable = await isShipmentStagingHandleWritable(handle, false);
      applyShipmentStagingDatasetToState(dataset, {
        fileHandle: handle,
        sourceFile: handle.name || 'shipment-staging.json',
        writable,
        mode: writable ? 'Writable connected file' : 'Connected file read-only'
      });
      return dataset;
    } catch (error) {
      console.warn('Stored Shipment Staging file could not be restored; using the configured dataset source.', error);
      return null;
    }
  }

  async function loadShipmentStagingDataset() {
    if (window.DleApiClient?.getJsonWithFallback) {
      const result = await window.DleApiClient.getJsonWithFallback('shipmentStaging', SHIPMENT_STAGING_DATA_PATH, {
        apiPersistenceMode: 'DLE-OS-HOST API read-only',
        fallbackPersistenceMode: 'Project JSON fallback read-only'
      });
      lastShipmentStagingLoadSource = result.source;
      lastShipmentStagingLoadMode = result.persistenceMode;
      return result.data;
    }

    const response = await fetch(SHIPMENT_STAGING_DATA_PATH, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Unable to load Shipment Staging dataset from ' + SHIPMENT_STAGING_DATA_PATH + '. HTTP ' + response.status + '.');
    }
    return response.json();
  }

  function validateShipmentStagingDataset(dataset) {
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
      throw new Error('Shipment Staging dataset is invalid. Expected a JSON object.');
    }
    if (dataset.schema !== SHIPMENT_STAGING_SCHEMA) {
      throw new Error('Shipment Staging dataset schema is invalid. Expected ' + SHIPMENT_STAGING_SCHEMA + '.');
    }
    if (dataset.version && dataset.version !== SHIPMENT_STAGING_VERSION) {
      throw new Error('Shipment Staging dataset version is invalid. Expected ' + SHIPMENT_STAGING_VERSION + '.');
    }
    const records = getShipmentStagingDatasetRecords(dataset);
    if (Object.prototype.hasOwnProperty.call(dataset, 'records') && !Array.isArray(dataset.records)) {
      throw new Error('Shipment Staging dataset is invalid. Expected records to be an array.');
    }
    if (Number(dataset.recordCount || 0) !== records.length) {
      throw new Error('Shipment Staging dataset is invalid. Record count does not match records array length.');
    }
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('Shipment Staging dataset contains an invalid record at index ' + index + '.');
      }
    });
  }

  function applyShipmentStagingDataset(dataset) {
    shipmentStagingState.records = getShipmentStagingDatasetRecords(dataset).map(record => ({ ...record }));
    shipmentStagingState.lastUpdated = dataset.lastUpdated || shipmentStagingState.lastUpdated || '';
    shipmentStagingState.persistence = {
      schema: dataset.schema,
      version: dataset.version || SHIPMENT_STAGING_VERSION,
      createdAt: dataset.createdAt || '',
      sourceFile: lastShipmentStagingLoadSource || SHIPMENT_STAGING_DATA_PATH,
      fileHandle: null,
      writable: false,
      loadedAt: new Date().toLocaleString(),
      mode: lastShipmentStagingLoadMode || 'Read Only'
    };
  }

  function applyShipmentStagingDatasetToState(dataset, options = {}) {
    validateShipmentStagingDataset(dataset);
    applyShipmentStagingDataset(dataset);
    const fileHandle = options.fileHandle || shipmentStagingState.persistence?.fileHandle || null;
    shipmentStagingState.persistence = {
      ...(shipmentStagingState.persistence || {}),
      sourceFile: options.sourceFile || shipmentStagingState.persistence?.sourceFile || SHIPMENT_STAGING_DATA_PATH,
      fileHandle,
      writable: options.writable ?? !!fileHandle,
      savedAt: dataset.lastUpdated || shipmentStagingState.persistence?.savedAt || '',
      lastReason: dataset.lastReason || shipmentStagingState.persistence?.lastReason || '',
      mode: options.mode || shipmentStagingState.persistence?.mode || 'Writable'
    };
  }

  async function readShipmentStagingDatasetFromHandle(handle) {
    if (!handle?.getFile) {
      throw new Error('Shipment Staging writable file handle is not available for verification.');
    }
    let file;
    try {
      file = await handle.getFile();
    } catch (error) {
      throw new Error('Shipment Staging file access was denied. Use Open Writable Staging to reopen the existing shipment-staging.json file, then retry.');
    }
    const text = await file.text();
    if (!text.trim()) {
      throw new Error('Shipment Staging JSON is empty. Restore a valid Shipment Staging baseline before archiving.');
    }
    const dataset = JSON.parse(text);
    validateShipmentStagingDataset(dataset);
    return dataset;
  }

  async function persistShipmentStagingDataset(reason = 'Shipment Staging Update', options = {}) {
    const dataset = buildShipmentStagingDatasetForWrite(reason);
    validateShipmentStagingDataset(dataset);
    const handle = options.fileHandle || await getWritableShipmentStagingFileHandle();
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(dataset, null, 2));
    await writable.close();
    await verifyShipmentStagingFileWrite(handle, dataset);
    if (Array.isArray(options.absentShipmentIds) && options.absentShipmentIds.length) {
      await verifyShipmentStagingShipmentIdsAbsent(handle, options.absentShipmentIds);
    }
    await storeShipmentStagingFileHandle(handle);
    shipmentStagingState.persistence = {
      ...(shipmentStagingState.persistence || {}),
      schema: dataset.schema,
      version: dataset.version,
      createdAt: dataset.createdAt,
      sourceFile: handle.name || 'shipment-staging.json',
      fileHandle: handle,
      writable: true,
      loadedAt: shipmentStagingState.persistence?.loadedAt || '',
      savedAt: dataset.lastUpdated,
      lastReason: reason,
      mode: 'Writable'
    };
    reportShipmentStagingPersistenceStatus('Shipment Staging persisted successfully. ' + dataset.recordCount + ' record' + (dataset.recordCount === 1 ? '' : 's') + ' saved.');
    return dataset;
  }

  async function ensureShipmentStagingWritableFileHandle() {
    const handle = await getWritableShipmentStagingFileHandle();
    await storeShipmentStagingFileHandle(handle);
    shipmentStagingState.persistence = {
      ...(shipmentStagingState.persistence || {}),
      sourceFile: handle.name || 'shipment-staging.json',
      fileHandle: handle,
      writable: true,
      mode: 'Writable'
    };
    return handle;
  }

  async function openShipmentStagingWritableFile() {
    if (!window.showOpenFilePicker) {
      throw new Error('Shipment Staging requires opening the existing JSON file in a browser that supports file handles.');
    }

    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'Shipment Staging JSON',
        accept: { 'application/json': ['.json'] }
      }]
    });

    const dataset = await readShipmentStagingDatasetFromHandle(handle);
    if (!(await isShipmentStagingHandleWritable(handle, true))) {
      throw new Error('Write permission was not granted for the existing Shipment Staging JSON file.');
    }

    applyShipmentStagingDatasetToState(dataset, {
      fileHandle: handle,
      sourceFile: handle.name || 'shipment-staging.json',
      mode: 'Writable'
    });
    await storeShipmentStagingFileHandle(handle);
    if (typeof renderShipmentStagingModule === 'function') renderShipmentStagingModule();
    reportShipmentStagingPersistenceStatus('Shipment Staging opened writable. ' + dataset.recordCount + ' record' + (dataset.recordCount === 1 ? '' : 's') + ' loaded.');
    return dataset;
  }

  function buildShipmentStagingDatasetForWrite(reason) {
    const now = new Date().toLocaleString();
    const records = Array.isArray(shipmentStagingState.records)
      ? shipmentStagingState.records.map(record => ({ ...record }))
      : [];
    return {
      schema: SHIPMENT_STAGING_SCHEMA,
      version: SHIPMENT_STAGING_VERSION,
      createdAt: shipmentStagingState.persistence?.createdAt || now,
      lastUpdated: now,
      lastReason: reason,
      recordCount: records.length,
      records
    };
  }

  function buildShipmentStagingRecordsFromShippingRequest(request, options = {}) {
    if (!request) return [];

    const detailLines = Array.isArray(request.lines) && request.lines.length
      ? request.lines
      : [request];
    const processedDate = options.processedDate instanceof Date
      ? options.processedDate
      : new Date(options.processedTimestamp || Date.now());
    const processedTimestamp = processedDate.toISOString();
    const createdTimestamp = request.createdTimestamp || request.requestDateTime || processedTimestamp;
    const shipmentId = options.shipmentId || request.shipmentId ||
      createShipmentStagingShipmentId(request, detailLines, processedDate);
    const operationalStatus = options.operationalStatus || 'Pending Invoice';

    return detailLines.map((line, index) => {
      const sourceWorkOrder = line?.sourceWorkOrder || {};
      const customerNumber = line?.customerNumber || request.customerNumber || '';
      const customerName = line?.customerName || line?.customer || request.customerName || request.customer || '';
      const salesOrder = line?.salesOrder || request.salesOrder || '';
      const salesOrderLine = line?.salesOrderLine || line?.sequenceLine || request.salesOrderLine || '';
      const assembly = line?.assembly || line?.partNumber || request.assembly || request.partNumber || '';
      const masterRecordKey = line?.masterRecordKey || sourceWorkOrder.masterRecordKey || request.masterRecordKey || '';

      return {
        schema: 'DLE_SHIPMENT_STAGING_RECORD_V1',
        shipmentTransactionId: shipmentId + '-L' + String(index + 1).padStart(3, '0'),
        shipmentId,
        requestId: request.requestId || '',
        masterRecordKey,
        shipmentDateTime: processedTimestamp,
        createdTimestamp,
        processedTimestamp,
        customerNumber,
        customerName,
        salesOrder,
        salesOrderLine,
        workOrder: line?.workOrder || request.workOrder || '',
        itemNumber: assembly,
        assembly,
        description: line?.description || request.description || '',
        quantityShipped: line?.quantityShipped ?? line?.qtyRequested ?? request.quantityShipped ?? request.qtyRequested ?? 0,
        originalOpenQuantity: line?.openQuantity ?? request.openQuantity ?? 0,
        requestedShipWindow: request.requestedShipWindow || '',
        operationalStatus,
        status: options.reconciliationStatus || 'Pending Invoice',
        user: request.processedBy || 'Shipping'
      };
    });
  }

  function createShipmentStagingShipmentId(request, detailLines, processedDate) {
    const firstLine = detailLines[0] || {};
    const customerNumber = sanitizeShipmentStagingIdPart(firstLine.customerNumber || request.customerNumber || 'UNKNOWN');
    const salesOrder = sanitizeShipmentStagingIdPart(firstLine.salesOrder || request.salesOrder || 'UNKNOWN');
    const dateCode = [
      String(processedDate.getFullYear()).slice(-2),
      String(processedDate.getMonth() + 1).padStart(2, '0'),
      String(processedDate.getDate()).padStart(2, '0')
    ].join('');
    const baseId = 'SHP-' + customerNumber + '-' + salesOrder + '-' + dateCode;
    const existingIds = new Set((Array.isArray(shipmentStagingState.records) ? shipmentStagingState.records : [])
      .map(record => String(record?.shipmentId || '').trim())
      .filter(Boolean));
    let sequence = 1;
    let shipmentId = baseId + '-' + String(sequence).padStart(2, '0');

    while (existingIds.has(shipmentId)) {
      sequence += 1;
      shipmentId = baseId + '-' + String(sequence).padStart(2, '0');
    }
    return shipmentId;
  }

  function sanitizeShipmentStagingIdPart(value) {
    return String(value || 'UNKNOWN')
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, '') || 'UNKNOWN';
  }

  function buildShipmentStagingDatasetWithRecords(sourceDataset, records, reason, lastUpdated) {
    const now = lastUpdated || new Date().toLocaleString();
    const nextDataset = {
      schema: SHIPMENT_STAGING_SCHEMA,
      version: sourceDataset?.version || SHIPMENT_STAGING_VERSION,
      createdAt: sourceDataset?.createdAt || now,
      lastUpdated: now,
      lastReason: reason || 'Shipment Staging Update',
      recordCount: Array.isArray(records) ? records.length : 0,
      records: Array.isArray(records) ? records : []
    };
    validateShipmentStagingDataset(nextDataset);
    return nextDataset;
  }

  async function writeShipmentStagingDatasetToHandle(dataset, handle, options = {}) {
    validateShipmentStagingDataset(dataset);
    if (!handle?.createWritable) {
      throw new Error('Shipment Staging writable file handle is not available.');
    }

    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(dataset, null, 2));
    await writable.close();
    await verifyShipmentStagingFileWrite(handle, dataset);

    if (Array.isArray(options.absentShipmentIds) && options.absentShipmentIds.length) {
      await verifyShipmentStagingShipmentIdsAbsent(handle, options.absentShipmentIds);
    }
    await storeShipmentStagingFileHandle(handle);
    return dataset;
  }

  async function getWritableShipmentStagingFileHandle() {
    const currentHandle = shipmentStagingState.persistence?.fileHandle;
    if (currentHandle) {
      if (await isShipmentStagingHandleWritable(currentHandle, true)) {
        await readShipmentStagingDatasetFromHandle(currentHandle);
        return currentHandle;
      }
    }

    const storedHandle = await readStoredShipmentStagingFileHandle();
    if (storedHandle) {
      if (await isShipmentStagingHandleWritable(storedHandle, true)) {
        await readShipmentStagingDatasetFromHandle(storedHandle);
        return storedHandle;
      }
    }

    throw new Error('Shipment Staging must be opened as an existing writable JSON file before operational updates can be saved. Use Open Writable Staging, then retry.');
  }

  async function isShipmentStagingHandleWritable(handle, allowPrompt = false) {
    if (!handle) return false;
    if (!handle.queryPermission) return true;
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;
    if (!allowPrompt || !handle.requestPermission) return false;
    permission = await handle.requestPermission({ mode: 'readwrite' });
    return permission === 'granted';
  }

  async function verifyShipmentStagingFileWrite(handle, expectedDataset) {
    if (!handle?.getFile) return;
    const file = await handle.getFile();
    const text = await file.text();
    const actualDataset = JSON.parse(text);
    validateShipmentStagingDataset(actualDataset);
    const actualCount = getShipmentStagingDatasetRecords(actualDataset).length;
    if (actualCount !== expectedDataset.records.length) {
      throw new Error('Shipment Staging JSON verification failed. Saved record count does not match expected record count.');
    }
  }

  async function verifyShipmentStagingShipmentIdsAbsent(handle, shipmentIds) {
    if (!handle?.getFile) return;
    const ids = new Set((shipmentIds || []).map(value => String(value || '').trim()).filter(Boolean));
    if (!ids.size) return;

    const file = await handle.getFile();
    const text = await file.text();
    const actualDataset = JSON.parse(text);
    validateShipmentStagingDataset(actualDataset);
    const remainingIds = getShipmentStagingDatasetRecords(actualDataset)
      .map(record => String(record.shipmentId || '').trim())
      .filter(shipmentId => ids.has(shipmentId));

    if (remainingIds.length) {
      throw new Error('Shipment Staging JSON verification failed. Archived shipment(s) still exist in staging: ' + Array.from(new Set(remainingIds)).join(', '));
    }
  }

  function getShipmentStagingDatasetRecords(dataset) {
    return Array.isArray(dataset?.records) ? dataset.records : [];
  }

  function createEmptyShipmentStagingDataset() {
    return {
      schema: SHIPMENT_STAGING_SCHEMA,
      version: '1.0',
      createdAt: '',
      lastUpdated: '',
      recordCount: 0,
      records: []
    };
  }

  function createEmptyShipmentStagingRecord() {
    return {
      shipmentTransactionId: '',
      shipmentId: '',
      masterRecordKey: '',
      shipmentDateTime: '',
      customerNumber: '',
      customerName: '',
      salesOrder: '',
      salesOrderLine: '',
      workOrder: '',
      itemNumber: '',
      description: '',
      quantityShipped: 0,
      originalOpenQuantity: 0,
      user: '',
      status: 'Pending Invoice'
    };
  }

  function reportShipmentStagingPersistenceStatus(message) {
    const status = document.getElementById('shipmentStagingStatus');
    if (status) status.textContent = message;
  }

  function reportShipmentStagingPersistenceError(error) {
    console.error('Shipment Staging persistence failed to load.', error);
    shipmentStagingState.records = [];
    shipmentStagingState.persistence = {
      schema: SHIPMENT_STAGING_SCHEMA,
      version: SHIPMENT_STAGING_VERSION,
      sourceFile: SHIPMENT_STAGING_DATA_PATH,
      loadedAt: '',
      mode: 'Load Error',
      error: error?.message || String(error)
    };

    const status = document.getElementById('shipmentStagingStatus');
    if (status) {
      status.textContent = 'Shipment Staging persistence error: ' + (error?.message || error);
    }
  }

  async function storeShipmentStagingFileHandle(handle) {
    if (!handle || !window.indexedDB) return;

    try {
      const db = await openShipmentStagingHandleDatabase();
      await writeShipmentStagingHandleDatabaseValue(db, SHIPMENT_STAGING_HANDLE_KEY, handle);
      db.close();
    } catch (error) {
      console.warn('Unable to store Shipment Staging file handle for future saves.', error);
    }
  }

  async function readStoredShipmentStagingFileHandle() {
    if (!window.indexedDB) return null;

    try {
      const db = await openShipmentStagingHandleDatabase();
      const handle = await readShipmentStagingHandleDatabaseValue(db, SHIPMENT_STAGING_HANDLE_KEY);
      db.close();
      return handle || null;
    } catch (error) {
      console.warn('Unable to read stored Shipment Staging file handle.', error);
      return null;
    }
  }

  function openShipmentStagingHandleDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SHIPMENT_STAGING_HANDLE_DB, 1);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(SHIPMENT_STAGING_HANDLE_STORE)) {
          db.createObjectStore(SHIPMENT_STAGING_HANDLE_STORE);
        }
      };
      request.onsuccess = event => resolve(event.target.result);
      request.onerror = () => reject(request.error);
    });
  }

  function writeShipmentStagingHandleDatabaseValue(db, key, value) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SHIPMENT_STAGING_HANDLE_STORE, 'readwrite');
      const store = transaction.objectStore(SHIPMENT_STAGING_HANDLE_STORE);
      const request = store.put(value, key);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function readShipmentStagingHandleDatabaseValue(db, key) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SHIPMENT_STAGING_HANDLE_STORE, 'readonly');
      const store = transaction.objectStore(SHIPMENT_STAGING_HANDLE_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  window.initializeShipmentStagingPersistence = initializeShipmentStagingPersistence;
  window.persistShipmentStagingDataset = persistShipmentStagingDataset;
  window.ensureShipmentStagingWritableFileHandle = ensureShipmentStagingWritableFileHandle;
  window.openShipmentStagingWritableFile = openShipmentStagingWritableFile;
  window.readShipmentStagingDatasetFromHandle = readShipmentStagingDatasetFromHandle;
  window.buildShipmentStagingDatasetWithRecords = buildShipmentStagingDatasetWithRecords;
  window.buildShipmentStagingRecordsFromShippingRequest = buildShipmentStagingRecordsFromShippingRequest;
  window.writeShipmentStagingDatasetToHandle = writeShipmentStagingDatasetToHandle;
  window.applyShipmentStagingDatasetToState = applyShipmentStagingDatasetToState;
  window.verifyShipmentStagingShipmentIdsAbsent = verifyShipmentStagingShipmentIdsAbsent;
})();




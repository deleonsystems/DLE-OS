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

  async function initializeShipmentStagingPersistence() {
    try {
      const dataset = await loadShipmentStagingDataset();
      validateShipmentStagingDataset(dataset);
      applyShipmentStagingDataset(dataset);
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

  async function loadShipmentStagingDataset() {
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
      sourceFile: SHIPMENT_STAGING_DATA_PATH,
      fileHandle: null,
      writable: false,
      loadedAt: new Date().toLocaleString(),
      mode: 'Read Only'
    };
  }

  async function persistShipmentStagingDataset(reason = 'Shipment Staging Update') {
    const dataset = buildShipmentStagingDatasetForWrite(reason);
    validateShipmentStagingDataset(dataset);
    const handle = await getWritableShipmentStagingFileHandle();
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(dataset, null, 2));
    await writable.close();
    await verifyShipmentStagingFileWrite(handle, dataset);
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

  async function getWritableShipmentStagingFileHandle() {
    const currentHandle = shipmentStagingState.persistence?.fileHandle;
    if (await isShipmentStagingHandleWritable(currentHandle)) return currentHandle;

    const storedHandle = await readStoredShipmentStagingFileHandle();
    if (await isShipmentStagingHandleWritable(storedHandle)) return storedHandle;

    if (!window.showSaveFilePicker) {
      throw new Error('Shipment Staging persistence requires a writable JSON file handle. This browser does not support saving local files.');
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: 'shipment-staging.json',
      types: [{
        description: 'Shipment Staging JSON',
        accept: { 'application/json': ['.json'] }
      }]
    });
    if (!(await isShipmentStagingHandleWritable(handle, true))) {
      throw new Error('Write permission was not granted for Shipment Staging JSON.');
    }
    return handle;
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
})();

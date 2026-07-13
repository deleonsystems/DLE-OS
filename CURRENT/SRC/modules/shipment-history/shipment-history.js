/* -----------------------------------------------------
   450 - JS: SHIPMENT HISTORY MODULE LOADER
----------------------------------------------------- */

(function () {
  'use strict';

  const SHIPMENT_HISTORY_DATA_PATH = 'DATA/shipment-history/shipment-history.json';
  const SHIPMENT_HISTORY_STORAGE_KEY = 'DLE_OS_SHIPMENT_HISTORY_V1';

  const shipmentHistoryState = {
    schema: 'DLE_SHIPMENT_HISTORY_V1',
    createdAt: '',
    lastUpdated: '',
    recordCount: 0,
    records: [],
    sourceFile: SHIPMENT_HISTORY_DATA_PATH,
    fileHandle: null,
    writable: false,
    persistenceMode: 'Not Loaded'
  };

  async function loadShipmentHistoryModule() {
    const placeholder = document.getElementById('shipmentHistory');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/shipment-history/shipment-history.html');
    if (!response.ok) {
      throw new Error('Unable to load Shipment History module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;
  }

  async function initializeShipmentHistory() {
    let loaded = false;

    try {
      const response = await fetch(SHIPMENT_HISTORY_DATA_PATH, { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setShipmentHistoryDataset(data, {
          sourceFile: SHIPMENT_HISTORY_DATA_PATH,
          persistenceMode: 'Project JSON loaded read-only'
        });
        loaded = true;
      }
    } catch (error) {
      loaded = false;
    }

    if (!loaded) {
      const stored = readShipmentHistoryLocalStorageDataset();
      if (stored) {
        setShipmentHistoryDataset(stored, {
          sourceFile: 'Browser storage fallback',
          persistenceMode: 'Browser storage fallback'
        });
        loaded = true;
      }
    }

    if (!loaded) {
      setShipmentHistoryDataset(createEmptyShipmentHistoryDataset(), {
        sourceFile: SHIPMENT_HISTORY_DATA_PATH,
        persistenceMode: 'Initialized empty dataset'
      });
    }

    renderShipmentHistoryModule();
  }

  function createEmptyShipmentHistoryDataset() {
    return {
      schema: 'DLE_SHIPMENT_HISTORY_V1',
      createdAt: '',
      lastUpdated: '',
      recordCount: 0,
      records: []
    };
  }

  function setShipmentHistoryDataset(data, options = {}) {
    const normalized = normalizeShipmentHistoryDataset(data);
    shipmentHistoryState.schema = normalized.schema;
    shipmentHistoryState.createdAt = normalized.createdAt;
    shipmentHistoryState.lastUpdated = normalized.lastUpdated;
    shipmentHistoryState.recordCount = normalized.recordCount;
    shipmentHistoryState.records = normalized.records;
    shipmentHistoryState.sourceFile = options.sourceFile || shipmentHistoryState.sourceFile || SHIPMENT_HISTORY_DATA_PATH;
    shipmentHistoryState.persistenceMode = options.persistenceMode || shipmentHistoryState.persistenceMode;
  }

  function normalizeShipmentHistoryDataset(data) {
    const source = data && typeof data === 'object' ? data : {};
    const records = Array.isArray(source.records)
      ? source.records
      : Array.isArray(data)
        ? data
        : [];

    return {
      schema: source.schema || 'DLE_SHIPMENT_HISTORY_V1',
      createdAt: source.createdAt || '',
      lastUpdated: source.lastUpdated || '',
      recordCount: records.length,
      records
    };
  }

  function validateShipmentHistoryDataset(dataset) {
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
      throw new Error('Shipment History dataset is invalid. Expected a JSON object.');
    }
    if (dataset.schema !== 'DLE_SHIPMENT_HISTORY_V1') {
      throw new Error('Shipment History dataset schema is invalid. Expected DLE_SHIPMENT_HISTORY_V1.');
    }
    if (!Array.isArray(dataset.records)) {
      throw new Error('Shipment History dataset is invalid. Expected records to be an array.');
    }
    if (Number(dataset.recordCount || 0) !== dataset.records.length) {
      throw new Error('Shipment History dataset is invalid. Record count does not match records array length.');
    }
  }

  async function readShipmentHistoryDatasetFromHandle(handle) {
    if (!handle?.getFile) {
      throw new Error('Shipment History writable file handle is not available for verification.');
    }
    const file = await handle.getFile();
    const text = await file.text();
    if (!text.trim()) {
      throw new Error('Shipment History JSON is empty. Restore a valid Shipment History baseline before archiving.');
    }
    const dataset = JSON.parse(text);
    validateShipmentHistoryDataset(dataset);
    return dataset;
  }

  function readShipmentHistoryLocalStorageDataset() {
    try {
      const stored = localStorage.getItem(SHIPMENT_HISTORY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      return null;
    }
  }

  function renderShipmentHistoryModule() {
    renderShipmentHistorySummary();
    renderShipmentHistoryTable();
    filterShipmentHistory();
  }

  function renderShipmentHistorySummary() {
    const records = Array.isArray(shipmentHistoryState.records) ? shipmentHistoryState.records : [];

    const summary = document.getElementById('shipmentHistorySummary');
    if (summary) {
      summary.textContent = [
        records.length + ' archived shipment' + (records.length === 1 ? '' : 's') + '.',
        'Source: ' + (shipmentHistoryState.sourceFile || 'Not available'),
        'Last Updated: ' + (shipmentHistoryState.lastUpdated || 'Not available')
      ].join(' | ');
    }

    const status = document.getElementById('shipmentHistoryStatus');
    if (status) {
      status.textContent = records.length
        ? records.length + ' Shipment History record' + (records.length === 1 ? '' : 's') + ' available. ' + shipmentHistoryState.persistenceMode + '.'
        : 'Shipment History is empty. ' + shipmentHistoryState.persistenceMode + '.';
    }
  }

  function renderShipmentHistoryTable() {
    const table = document.getElementById('shipmentHistoryTable');
    if (!table) return;

    const records = Array.isArray(shipmentHistoryState.records) ? shipmentHistoryState.records : [];
    if (!records.length) {
      table.innerHTML = '<div class="report-empty">No shipment history records have been archived yet.</div>';
      return;
    }

    let html = `
<table class="open-orders-table">
<tr>
    <th>Shipment Date</th>
    <th>Shipment ID</th>
    <th>Customer</th>
    <th>Sales Order</th>
    <th>Line</th>
    <th>Work Order</th>
    <th>Item Number</th>
    <th>Description</th>
    <th>Original Due Date</th>
    <th>Qty Shipped</th>
    <th>Unit Price</th>
    <th>Extended Price</th>
    <th>Status</th>
</tr>
`;

    records.forEach((record, index) => {
      html += `
<tr class="${index % 2 === 0 ? 'rowEven' : 'rowOdd'}">
    <td>${escapeHtml(record.shipmentDateTime || record.dates?.shipmentConfirmationDate || '')}</td>
    <td>${escapeHtml(record.shipmentId || record.identifiers?.shipmentId || '')}</td>
    <td class="nowrap">${escapeHtml(formatShipmentHistoryCustomer(record))}</td>
    <td>${escapeHtml(record.salesOrder || record.order?.salesOrder || '')}</td>
    <td>${escapeHtml(record.salesOrderLine || record.order?.salesOrderLine || '')}</td>
    <td>${escapeHtml(record.workOrder || record.order?.workOrder || '')}</td>
    <td>${escapeHtml(record.itemNumber || record.item?.partNumber || '')}</td>
    <td class="nowrap">${escapeHtml(record.description || record.item?.description || '')}</td>
    <td>${escapeHtml(record.dates?.dueDate || record.originalDueDate || record.dueDate || '')}</td>
    <td>${escapeHtml(String(record.quantityShipped ?? record.order?.quantityShipped ?? ''))}</td>
    <td>${escapeHtml(record.unitPrice || record.financial?.unitPrice || '')}</td>
    <td>${escapeHtml(record.extendedPrice || record.financial?.extendedPrice || '')}</td>
    <td>${escapeHtml(record.status || record.shipment?.shipmentStatus || 'Archived')}</td>
</tr>
`;
    });

    html += '</table>';
    table.innerHTML = html;
  }

  async function archiveShipmentHistoryRecords(records, metadata = {}) {
    if (!Array.isArray(records) || !records.length) return [];

    const archivedAt = metadata.archivedAt || new Date().toLocaleString();
    const archivedRecords = records.map(record => buildShipmentHistoryRecord(record, {
      ...metadata,
      archivedAt
    }));

    const previousRecords = shipmentHistoryState.records.slice();
    const previousLastUpdated = shipmentHistoryState.lastUpdated;
    const previousRecordCount = shipmentHistoryState.recordCount;

    shipmentHistoryState.records.push(...archivedRecords);
    shipmentHistoryState.lastUpdated = archivedAt;
    shipmentHistoryState.createdAt = shipmentHistoryState.createdAt || archivedAt;
    shipmentHistoryState.recordCount = shipmentHistoryState.records.length;

    try {
      await writeShipmentHistoryDataset({
        fileHandle: metadata.fileHandle || null,
        presentShipmentIds: archivedRecords.map(record => record.shipmentId).filter(Boolean)
      });
    } catch (error) {
      shipmentHistoryState.records = previousRecords;
      shipmentHistoryState.lastUpdated = previousLastUpdated;
      shipmentHistoryState.recordCount = previousRecordCount;
      renderShipmentHistoryModule();
      throw error;
    }

    renderShipmentHistoryModule();
    return archivedRecords;
  }

  function buildShipmentHistoryRecordsForArchive(records, metadata = {}) {
    if (!Array.isArray(records) || !records.length) return [];
    const archivedAt = metadata.archivedAt || new Date().toLocaleString();
    return records.map(record => buildShipmentHistoryRecord(record, {
      ...metadata,
      archivedAt
    }));
  }

  function buildShipmentHistoryDatasetWithRecords(sourceDataset, records, lastUpdated) {
    const nextDataset = {
      schema: 'DLE_SHIPMENT_HISTORY_V1',
      createdAt: sourceDataset?.createdAt || lastUpdated || new Date().toLocaleString(),
      lastUpdated: lastUpdated || new Date().toLocaleString(),
      recordCount: Array.isArray(records) ? records.length : 0,
      records: Array.isArray(records) ? records : []
    };
    validateShipmentHistoryDataset(nextDataset);
    return nextDataset;
  }

  async function writeShipmentHistoryDatasetToHandle(dataset, handle, options = {}) {
    validateShipmentHistoryDataset(dataset);
    if (!handle?.createWritable) {
      throw new Error('Shipment History writable file handle is not available.');
    }

    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(dataset, null, 2));
    await writable.close();
    await verifyShipmentHistoryFileWrite(dataset, handle);

    if (Array.isArray(options.presentShipmentIds) && options.presentShipmentIds.length) {
      await verifyShipmentHistoryShipmentIdsPresent(options.presentShipmentIds, handle);
    }
    writeShipmentHistoryLocalStorageDataset(dataset);
    return dataset;
  }

  function applyShipmentHistoryDatasetToState(dataset, options = {}) {
    validateShipmentHistoryDataset(dataset);
    setShipmentHistoryDataset(dataset, {
      sourceFile: options.sourceFile || shipmentHistoryState.sourceFile,
      persistenceMode: options.persistenceMode || 'Project JSON writable file handle'
    });
    shipmentHistoryState.fileHandle = options.fileHandle || shipmentHistoryState.fileHandle;
    shipmentHistoryState.writable = !!shipmentHistoryState.fileHandle;
    renderShipmentHistoryModule();
  }

  async function removeShipmentHistoryRecordsByArchiveKeys(archiveKeys = []) {
    const keys = new Set((archiveKeys || []).map(value => String(value || '').trim()).filter(Boolean));
    if (!keys.size) return { removedRecords: 0 };

    const previousRecords = shipmentHistoryState.records.slice();
    const previousLastUpdated = shipmentHistoryState.lastUpdated;
    const previousRecordCount = shipmentHistoryState.recordCount;
    const nextRecords = previousRecords.filter(record => !keys.has(buildShipmentHistoryArchiveKey(record)));
    const removedRecords = previousRecords.length - nextRecords.length;
    if (!removedRecords) return { removedRecords: 0 };

    shipmentHistoryState.records = nextRecords;
    shipmentHistoryState.recordCount = nextRecords.length;
    shipmentHistoryState.lastUpdated = new Date().toLocaleString();

    try {
      await writeShipmentHistoryDataset();
    } catch (error) {
      shipmentHistoryState.records = previousRecords;
      shipmentHistoryState.lastUpdated = previousLastUpdated;
      shipmentHistoryState.recordCount = previousRecordCount;
      renderShipmentHistoryModule();
      throw error;
    }

    renderShipmentHistoryModule();
    return { removedRecords };
  }

  function buildShipmentHistoryRecord(record, metadata = {}) {
    const masterRecord = record.masterDataSnapshot || {};
    const vpro5 = masterRecord.vpro5 || {};
    const dle = masterRecord.dle || {};
    const archivedAt = metadata.archivedAt || new Date().toLocaleString();
    const shipmentId = record.shipmentId || record.identifiers?.shipmentId || '';
    const masterRecordKey = record.masterRecordKey || buildShipmentHistoryMasterRecordKey(record);

    return {
      schema: 'DLE_SHIPMENT_HISTORY_RECORD_V1',
      shipmentId,
      masterRecordKey,
      shipmentDateTime: record.shipmentDateTime || '',
      customerNumber: record.customerNumber || vpro5.customerNumber || '',
      customerName: record.customerName || vpro5.customer || '',
      customerPo: vpro5.customerPo || '',
      salesOrder: record.salesOrder || vpro5.salesOrder || '',
      salesOrderLine: record.salesOrderLine || vpro5.sequenceLine || '',
      workOrder: record.workOrder || vpro5.workOrder || '',
      workOrderQuantity: vpro5.workOrderQuantity || '',
      quantityShipped: record.quantityShipped ?? vpro5.quantityShipped ?? '',
      originalOpenQuantity: record.originalOpenQuantity ?? vpro5.qtyOpen ?? '',
      quantityOpenAtArchive: vpro5.qtyOpen || '',
      itemNumber: record.itemNumber || vpro5.partNumber || '',
      revision: dle.revision || '',
      description: record.description || vpro5.description || '',
      unitOfMeasure: vpro5.unitOfMeasure || '',
      unitPrice: vpro5.price || '',
      extendedPrice: vpro5.extendedPrice || '',
      currency: vpro5.currency || '',
      status: 'Archived',
      stagingStatus: record.status || '',
      archivedAt,
      approvalTimestamp: metadata.approvalTimestamp || archivedAt,
      archiveReason: metadata.archiveReason || 'Reconciliation Approval',
      identifiers: {
        shipmentId,
        masterRecordKey,
        shipmentTransactionId: record.shipmentTransactionId || shipmentId
      },
      customer: {
        customerNumber: record.customerNumber || vpro5.customerNumber || '',
        customerName: record.customerName || vpro5.customer || '',
        customerPo: vpro5.customerPo || ''
      },
      order: {
        salesOrder: record.salesOrder || vpro5.salesOrder || '',
        salesOrderLine: record.salesOrderLine || vpro5.sequenceLine || '',
        workOrder: record.workOrder || vpro5.workOrder || '',
        workOrderQuantity: vpro5.workOrderQuantity || '',
        quantityShipped: record.quantityShipped ?? vpro5.quantityShipped ?? '',
        originalOpenQuantity: record.originalOpenQuantity ?? '',
        quantityOpenAtArchive: vpro5.qtyOpen || ''
      },
      item: {
        partNumber: record.itemNumber || vpro5.partNumber || '',
        revision: dle.revision || '',
        description: record.description || vpro5.description || '',
        unitOfMeasure: vpro5.unitOfMeasure || ''
      },
      dates: {
        orderDate: vpro5.orderDate || '',
        dueDate: vpro5.dueDate || '',
        shipDate: vpro5.shipDate || '',
        shipmentConfirmationDate: record.shipmentDateTime || '',
        approvalDate: metadata.approvalTimestamp || archivedAt,
        archiveTimestamp: archivedAt
      },
      financial: {
        unitPrice: vpro5.price || '',
        extendedPrice: vpro5.extendedPrice || '',
        currency: vpro5.currency || ''
      },
      shipment: {
        shipmentStatus: 'Archived',
        stagingStatus: record.status || '',
        shipmentNotes: record.shipmentNotes || '',
        trackingNumber: record.trackingNumber || '',
        carrier: record.carrier || ''
      },
      operational: {
        user: record.user || '',
        approvedBy: metadata.approvedBy || '',
        archiveReason: metadata.archiveReason || 'Reconciliation Approval',
        source: 'Reconciliation Approval'
      },
      sourceSnapshots: {
        shipmentStagingRecord: JSON.parse(JSON.stringify(record)),
        masterDataRecord: record.masterDataSnapshot || null
      }
    };
  }

  function buildShipmentHistoryArchiveKey(record) {
    return [
      record.shipmentId || record.identifiers?.shipmentId || '',
      record.masterRecordKey || record.identifiers?.masterRecordKey || '',
      record.archivedAt || record.dates?.archiveTimestamp || ''
    ].map(value => String(value || '').trim()).join('|');
  }

  async function ensureShipmentHistoryWritableFileHandle() {
    if (shipmentHistoryState.fileHandle) {
      await readShipmentHistoryDatasetFromHandle(shipmentHistoryState.fileHandle);
    }
    if (await isShipmentHistoryHandleWritable(shipmentHistoryState.fileHandle, true)) {
      return shipmentHistoryState.fileHandle;
    }

    throw new Error('Shipment History must be opened as an existing writable JSON file before operational updates can be saved. Use Open Writable History, then retry.');
  }

  async function openShipmentHistoryWritableFile() {
    if (!window.showOpenFilePicker) {
      throw new Error('Shipment History requires opening the existing JSON file in a browser that supports file handles.');
    }

    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'Shipment History JSON',
        accept: { 'application/json': ['.json'] }
      }]
    });

    const dataset = await readShipmentHistoryDatasetFromHandle(handle);
    if (!(await isShipmentHistoryHandleWritable(handle, true))) {
      throw new Error('Write permission was not granted for the existing Shipment History JSON file.');
    }

    applyShipmentHistoryDatasetToState(dataset, {
      fileHandle: handle,
      sourceFile: handle.name || 'shipment-history.json',
      persistenceMode: 'Project JSON writable file handle'
    });
    renderShipmentHistoryModule();
    return dataset;
  }

  async function isShipmentHistoryHandleWritable(handle, allowPrompt = false) {
    if (!handle) return false;
    if (!handle.queryPermission) return true;
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;
    if (!allowPrompt || !handle.requestPermission) return false;
    permission = await handle.requestPermission({ mode: 'readwrite' });
    return permission === 'granted';
  }

  async function writeShipmentHistoryDataset(options = {}) {
    const dataset = getShipmentHistoryDatasetForWrite();

    const handle = options.fileHandle || await ensureShipmentHistoryWritableFileHandle();

    if (handle) {
      shipmentHistoryState.fileHandle = handle;
      shipmentHistoryState.writable = true;
      shipmentHistoryState.sourceFile = handle.name || shipmentHistoryState.sourceFile || 'shipment-history.json';
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(dataset, null, 2));
      await writable.close();
      await verifyShipmentHistoryFileWrite(dataset, handle);
      if (Array.isArray(options.presentShipmentIds) && options.presentShipmentIds.length) {
        await verifyShipmentHistoryShipmentIdsPresent(options.presentShipmentIds, handle);
      }
      shipmentHistoryState.persistenceMode = 'Project JSON writable file handle';
      writeShipmentHistoryLocalStorageDataset(dataset);
      return;
    }

    writeShipmentHistoryLocalStorageDataset(dataset);
    verifyShipmentHistoryLocalStorageWrite(dataset);
    shipmentHistoryState.persistenceMode = 'Browser storage fallback';
  }

  async function verifyShipmentHistoryFileWrite(expectedDataset, fileHandle = shipmentHistoryState.fileHandle) {
    if (!fileHandle?.getFile) return;
    const file = await fileHandle.getFile();
    const text = await file.text();
    const actualDataset = JSON.parse(text);
    const actualCount = Array.isArray(actualDataset.records) ? actualDataset.records.length : 0;
    if (actualCount !== expectedDataset.records.length) {
      throw new Error('Shipment History JSON verification failed after write.');
    }
  }

  async function verifyShipmentHistoryShipmentIdsPresent(shipmentIds, fileHandle = shipmentHistoryState.fileHandle) {
    const ids = new Set((shipmentIds || []).map(value => String(value || '').trim()).filter(Boolean));
    if (!ids.size) return;

    const dataset = fileHandle?.getFile
      ? JSON.parse(await (await fileHandle.getFile()).text())
      : readShipmentHistoryLocalStorageDataset();
    const records = Array.isArray(dataset?.records) ? dataset.records : [];
    const foundIds = new Set(records
      .map(record => String(record.shipmentId || record.identifiers?.shipmentId || '').trim())
      .filter(Boolean));
    const missingIds = Array.from(ids).filter(shipmentId => !foundIds.has(shipmentId));

    if (missingIds.length) {
      throw new Error('Shipment History JSON verification failed. Archived shipment(s) were not found in history: ' + missingIds.join(', '));
    }
  }

  function getShipmentHistoryDatasetForWrite() {
    return {
      schema: shipmentHistoryState.schema || 'DLE_SHIPMENT_HISTORY_V1',
      createdAt: shipmentHistoryState.createdAt,
      lastUpdated: shipmentHistoryState.lastUpdated,
      recordCount: shipmentHistoryState.records.length,
      records: shipmentHistoryState.records
    };
  }

  function writeShipmentHistoryLocalStorageDataset(dataset) {
    try {
      localStorage.setItem(SHIPMENT_HISTORY_STORAGE_KEY, JSON.stringify(dataset));
    } catch (error) {
      // Browser storage is a fallback only; file-handle writes remain authoritative when available.
    }
  }

  function verifyShipmentHistoryLocalStorageWrite(expectedDataset) {
    const stored = localStorage.getItem(SHIPMENT_HISTORY_STORAGE_KEY);
    const actualDataset = JSON.parse(stored || '{}');
    const actualCount = Array.isArray(actualDataset.records) ? actualDataset.records.length : 0;
    if (actualCount !== expectedDataset.records.length) {
      throw new Error('Shipment History browser storage verification failed after write.');
    }
  }

  function buildShipmentHistoryMasterRecordKey(record) {
    if (record.masterDataSnapshot && typeof getMasterRecordKeyForRecord === 'function') {
      return getMasterRecordKeyForRecord(record.masterDataSnapshot);
    }
    if (typeof buildMasterRecordKey !== 'function') return '';
    return buildMasterRecordKey(
      record.customerNumber || '',
      record.salesOrder || '',
      record.salesOrderLine || ''
    );
  }

  function formatShipmentHistoryCustomer(record) {
    const customerNumber = normalizeOrderValue(record.customerNumber || record.customer?.customerNumber, '');
    const customerName = normalizeOrderValue(record.customerName || record.customer?.customerName, '');
    if (customerNumber && customerName) return customerNumber + ' - ' + customerName;
    return customerName || customerNumber;
  }

  function filterShipmentHistory() {
    const input = document.getElementById('shipmentHistorySearch');
    const table = document.querySelector('#shipmentHistoryTable table');
    if (!input || !table) return;

    const filters = input.value
      .split(';')
      .map(segment => segment.trim().toUpperCase())
      .filter(Boolean);

    const rows = table.getElementsByTagName('tr');
    for (let i = 1; i < rows.length; i++) {
      const rowText = rows[i].textContent.toUpperCase();
      rows[i].style.display = filters.every(filter => rowText.includes(filter))
        ? ''
        : 'none';
    }
  }

  window.loadShipmentHistoryModule = loadShipmentHistoryModule;
  window.initializeShipmentHistory = initializeShipmentHistory;
  window.renderShipmentHistoryModule = renderShipmentHistoryModule;
  window.renderShipmentHistorySummary = renderShipmentHistorySummary;
  window.renderShipmentHistoryTable = renderShipmentHistoryTable;
  window.filterShipmentHistory = filterShipmentHistory;
  window.archiveShipmentHistoryRecords = archiveShipmentHistoryRecords;
  window.buildShipmentHistoryRecordsForArchive = buildShipmentHistoryRecordsForArchive;
  window.buildShipmentHistoryDatasetWithRecords = buildShipmentHistoryDatasetWithRecords;
  window.readShipmentHistoryDatasetFromHandle = readShipmentHistoryDatasetFromHandle;
  window.writeShipmentHistoryDatasetToHandle = writeShipmentHistoryDatasetToHandle;
  window.applyShipmentHistoryDatasetToState = applyShipmentHistoryDatasetToState;
  window.removeShipmentHistoryRecordsByArchiveKeys = removeShipmentHistoryRecordsByArchiveKeys;
  window.ensureShipmentHistoryWritableFileHandle = ensureShipmentHistoryWritableFileHandle;
  window.openShipmentHistoryWritableFile = openShipmentHistoryWritableFile;
  window.verifyShipmentHistoryShipmentIdsPresent = verifyShipmentHistoryShipmentIdsPresent;
  window.shipmentHistoryState = shipmentHistoryState;
})();

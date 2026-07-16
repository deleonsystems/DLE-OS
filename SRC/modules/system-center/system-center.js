(function () {
  'use strict';

  const SHIPMENT_HISTORY_VIEWER_PATH = 'DATA/shipment-history/shipment-history.json';

  const shipmentHistoryDataViewerState = {
    dataset: null,
    records: [],
    selectedIndex: -1,
    fileHandle: null
  };

  const SHIPMENT_HISTORY_VIEWER_COLUMNS = [
    { label: 'Shipment ID', paths: ['shipmentId', 'identifiers.shipmentId'] },
    { label: 'Master Record Key', paths: ['masterRecordKey', 'identifiers.masterRecordKey'] },
    { label: 'Customer', paths: ['customerName', 'customer.customerName'] },
    { label: 'Sales Order', paths: ['salesOrder', 'order.salesOrder'] },
    { label: 'Line', paths: ['salesOrderLine', 'order.salesOrderLine'] },
    { label: 'Work Order', paths: ['workOrder', 'order.workOrder'] },
    { label: 'Part Number', paths: ['itemNumber', 'partNumber', 'item.partNumber'] },
    { label: 'Description', paths: ['description', 'item.description'] },
    { label: 'Quantity', paths: ['quantityShipped', 'order.quantityShipped'] },
    { label: 'Due Date', paths: ['dates.dueDate', 'dueDate', 'originalDueDate'] },
    { label: 'Ship Date', paths: ['dates.shipDate', 'shipDate', 'shipmentDateTime'] },
    { label: 'Unit Price', paths: ['unitPrice', 'financial.unitPrice'] },
    { label: 'Extended Price', paths: ['extendedPrice', 'financial.extendedPrice'] },
    { label: 'Approval Date', paths: ['approvalTimestamp', 'dates.approvalDate'] },
    { label: 'Archive Timestamp', paths: ['archivedAt', 'dates.archiveTimestamp'] }
  ];

  async function loadSystemCenterModule() {
    const placeholder = document.getElementById('systemCenter');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/system-center/system-center.html');
    if (!response.ok) {
      throw new Error('Unable to load System Center module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;

    if (typeof loadSystemCenterReconciliationWorkspace === 'function') {
      await loadSystemCenterReconciliationWorkspace();
    }

    refreshShipmentHistoryDataViewer();
  }

  async function refreshShipmentHistoryDataViewer() {
    const statusEl = document.getElementById('shipmentHistoryDataViewerStatus');
    const countEl = document.getElementById('shipmentHistoryDataViewerCount');
    const tableEl = document.getElementById('shipmentHistoryDataViewerTable');

    if (!statusEl || !countEl || !tableEl) return;

    statusEl.textContent = 'Loading...';
    shipmentHistoryDataViewerState.selectedIndex = -1;
    updateShipmentHistoryDataViewerSelection();
    tableEl.innerHTML = '<div class="shipment-history-data-viewer-empty">Loading persisted Shipment History records...</div>';

    try {
      syncShipmentHistoryDataViewerHandleFromShipmentHistoryModule();
      if (shipmentHistoryDataViewerState.fileHandle) {
        await loadShipmentHistoryDataViewerFromHandle(shipmentHistoryDataViewerState.fileHandle, {
          status: 'Loaded from connected file'
        });
      } else {
        const result = window.DleApiClient?.getJsonWithFallback
          ? await window.DleApiClient.getJsonWithFallback('shipmentHistory', SHIPMENT_HISTORY_VIEWER_PATH, {
            apiPersistenceMode: 'Loaded from DLE-OS-HOST API',
            fallbackPersistenceMode: 'Loaded from project JSON fallback'
          })
          : null;
        let dataset;
        let statusText;
        if (result) {
          dataset = result.data;
          statusText = recordsStatusText(normalizeShipmentHistoryViewerRecords(dataset), result.persistenceMode);
        } else {
          const response = await fetch(SHIPMENT_HISTORY_VIEWER_PATH, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`Unable to load Shipment History JSON (${response.status}).`);
          }
          dataset = await response.json();
          statusText = recordsStatusText(normalizeShipmentHistoryViewerRecords(dataset), 'Loaded read-only');
        }
        setShipmentHistoryDataViewerDataset(dataset, {
          status: statusText
        });
      }
    } catch (error) {
      shipmentHistoryDataViewerState.dataset = null;
      shipmentHistoryDataViewerState.records = [];
      countEl.textContent = '0';
      statusEl.textContent = 'Load failed';
      tableEl.innerHTML = `<div class="shipment-history-data-viewer-empty">Unable to load persisted Shipment History records. ${escapeShipmentHistoryViewerHtml(error.message || error)}</div>`;
      updateShipmentHistoryDataViewerSelection();
      console.error('Shipment History Data Viewer failed to load persisted JSON.', error);
    }
  }

  async function connectShipmentHistoryDataViewerFile() {
    const statusEl = document.getElementById('shipmentHistoryDataViewerStatus');
    try {
      const handle = await promptForShipmentHistoryDataViewerFileHandle();
      shipmentHistoryDataViewerState.fileHandle = handle;
      await loadShipmentHistoryDataViewerFromHandle(handle, {
        status: 'Connected'
      });
      syncShipmentHistoryModuleHandle(handle);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (statusEl) statusEl.textContent = 'Connect failed';
      console.error('Shipment History Data Viewer file connection failed.', error);
      window.alert(`Shipment History JSON was not connected.\n\n${error.message || error}`);
    }
  }

  async function promptForShipmentHistoryDataViewerFileHandle() {
    if (!window.showOpenFilePicker) {
      throw new Error('This browser does not support opening a writable JSON file handle. Use Microsoft Edge with the File System Access API enabled.');
    }

    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'Shipment History JSON',
        accept: { 'application/json': ['.json'] }
      }]
    });

    const permission = await ensureShipmentHistoryDataViewerWritePermission(handle);
    if (permission !== 'granted') {
      throw new Error('Write permission was not granted for shipment-history.json.');
    }

    return handle;
  }

  async function ensureShipmentHistoryDataViewerWritePermission(handle) {
    if (!handle?.queryPermission || !handle?.requestPermission) return 'granted';

    const options = { mode: 'readwrite' };
    const current = await handle.queryPermission(options);
    if (current === 'granted') return current;
    return handle.requestPermission(options);
  }

  async function loadShipmentHistoryDataViewerFromHandle(handle, options = {}) {
    const file = await handle.getFile();
    const text = await file.text();
    const dataset = text.trim()
      ? JSON.parse(text)
      : { schema: 'DLE_SHIPMENT_HISTORY_V1', createdAt: '', lastUpdated: '', recordCount: 0, records: [] };

    setShipmentHistoryDataViewerDataset(dataset, {
      status: options.status || recordsStatusText(normalizeShipmentHistoryViewerRecords(dataset), 'Loaded from connected file')
    });
  }

  function setShipmentHistoryDataViewerDataset(dataset, options = {}) {
    const countEl = document.getElementById('shipmentHistoryDataViewerCount');
    const statusEl = document.getElementById('shipmentHistoryDataViewerStatus');
    const tableEl = document.getElementById('shipmentHistoryDataViewerTable');
    if (!countEl || !statusEl || !tableEl) return;

    const records = normalizeShipmentHistoryViewerRecords(dataset);
    shipmentHistoryDataViewerState.dataset = dataset;
    shipmentHistoryDataViewerState.records = records;
    if (shipmentHistoryDataViewerState.selectedIndex >= records.length) {
      shipmentHistoryDataViewerState.selectedIndex = -1;
    }
    countEl.textContent = String(records.length);
    statusEl.textContent = options.status || recordsStatusText(records, 'Loaded');
    renderShipmentHistoryDataViewerTable(records, tableEl);
    updateShipmentHistoryDataViewerSelection();
  }

  function recordsStatusText(records, loadedText) {
    return records.length ? loadedText : 'No records';
  }

  function normalizeShipmentHistoryViewerRecords(dataset) {
    if (Array.isArray(dataset)) return dataset;
    if (dataset && Array.isArray(dataset.records)) return dataset.records;
    return [];
  }

  function renderShipmentHistoryDataViewerTable(records, tableEl) {
    if (!records.length) {
      tableEl.innerHTML = '<div class="shipment-history-data-viewer-empty">No persisted Shipment History records found.</div>';
      return;
    }

    const headers = SHIPMENT_HISTORY_VIEWER_COLUMNS
      .map((column) => `<th>${escapeShipmentHistoryViewerHtml(column.label)}</th>`)
      .join('');

    const rows = records
      .map((record, index) => {
        const cells = SHIPMENT_HISTORY_VIEWER_COLUMNS
          .map((column) => `<td>${escapeShipmentHistoryViewerHtml(getShipmentHistoryViewerValue(record, column.paths))}</td>`)
          .join('');
        return `<tr data-shipment-history-viewer-index="${index}" onclick="selectShipmentHistoryDataViewerRecord(${index})">${cells}</tr>`;
      })
      .join('');

    tableEl.innerHTML = `
      <table class="shipment-history-data-viewer-table">
        <thead>
          <tr>${headers}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function selectShipmentHistoryDataViewerRecord(index) {
    const recordIndex = Number(index);
    if (!Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= shipmentHistoryDataViewerState.records.length) {
      shipmentHistoryDataViewerState.selectedIndex = -1;
    } else {
      shipmentHistoryDataViewerState.selectedIndex = recordIndex;
    }

    updateShipmentHistoryDataViewerSelection();
  }

  function updateShipmentHistoryDataViewerSelection() {
    const selectedIndex = shipmentHistoryDataViewerState.selectedIndex;
    const selectedRecord = selectedIndex >= 0 ? shipmentHistoryDataViewerState.records[selectedIndex] : null;
    const selectedEl = document.getElementById('shipmentHistoryDataViewerSelected');
    const deleteButton = document.getElementById('deleteShipmentHistoryDataViewerRecordButton');
    const writeAccessEl = document.getElementById('shipmentHistoryDataViewerWriteAccess');

    document
      .querySelectorAll('[data-shipment-history-viewer-index]')
      .forEach((row) => {
        row.classList.toggle('selected', Number(row.dataset.shipmentHistoryViewerIndex) === selectedIndex);
      });

    if (selectedEl) {
      selectedEl.textContent = selectedRecord
        ? getShipmentHistoryViewerValue(selectedRecord, ['shipmentId', 'identifiers.shipmentId', 'masterRecordKey', 'identifiers.masterRecordKey']) || 'Selected'
        : 'None';
    }

    if (deleteButton) {
      deleteButton.disabled = !selectedRecord;
    }

    if (writeAccessEl) {
      writeAccessEl.textContent = shipmentHistoryDataViewerState.fileHandle
        ? 'Connected'
        : 'Read-only';
    }
  }

  async function deleteSelectedShipmentHistoryDataViewerRecord() {
    let selectedIndex = shipmentHistoryDataViewerState.selectedIndex;
    let selectedRecord = selectedIndex >= 0 ? shipmentHistoryDataViewerState.records[selectedIndex] : null;
    const statusEl = document.getElementById('shipmentHistoryDataViewerStatus');

    if (!selectedRecord) {
      window.alert('Select one Shipment History record before deleting.');
      return;
    }

    try {
      const handle = await getShipmentHistoryDataViewerWritableHandle();
      if (handle) {
        const selectedRecordKey = getShipmentHistoryViewerRecordIdentity(selectedRecord);
        await loadShipmentHistoryDataViewerFromHandle(handle, {
          status: 'Connected'
        });
        selectedIndex = findShipmentHistoryViewerRecordIndex(selectedRecordKey);
        selectedRecord = selectedIndex >= 0 ? shipmentHistoryDataViewerState.records[selectedIndex] : null;
        shipmentHistoryDataViewerState.selectedIndex = selectedIndex;
        updateShipmentHistoryDataViewerSelection();
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (statusEl) statusEl.textContent = 'Delete failed';
      console.error('Shipment History Data Viewer writable handle failed.', error);
      window.alert(`Shipment History delete was not completed.\n\n${error.message || error}`);
      return;
    }

    if (!selectedRecord) {
      window.alert('The selected Shipment History record was not found in the connected JSON file. Refresh the viewer and try again.');
      return;
    }

    const shipmentId = getShipmentHistoryViewerValue(selectedRecord, ['shipmentId', 'identifiers.shipmentId']);
    const masterRecordKey = getShipmentHistoryViewerValue(selectedRecord, ['masterRecordKey', 'identifiers.masterRecordKey']);
    const label = shipmentId || masterRecordKey || `record ${selectedIndex + 1}`;
    const confirmed = window.confirm(`Delete Shipment History record "${label}"?\n\nThis only removes the archived Shipment History record. It does not modify Master Data, Shipment Staging, Reconciliation, or any other operational dataset.`);
    if (!confirmed) return;

    const dataset = shipmentHistoryDataViewerState.dataset || {};
    const remainingRecords = shipmentHistoryDataViewerState.records.filter((record, index) => index !== selectedIndex);
    const updatedDataset = {
      ...dataset,
      schema: dataset.schema || 'DLE_SHIPMENT_HISTORY_V1',
      createdAt: dataset.createdAt || '',
      lastUpdated: new Date().toLocaleString(),
      recordCount: remainingRecords.length,
      records: remainingRecords
    };

    try {
      if (statusEl) statusEl.textContent = 'Deleting...';
      await writeShipmentHistoryDataViewerDataset(updatedDataset);
      shipmentHistoryDataViewerState.dataset = updatedDataset;
      shipmentHistoryDataViewerState.records = remainingRecords;
      shipmentHistoryDataViewerState.selectedIndex = -1;
      if (typeof initializeShipmentHistory === 'function') {
        await initializeShipmentHistory();
      }
      await refreshShipmentHistoryDataViewer();
    } catch (error) {
      if (statusEl) statusEl.textContent = 'Delete failed';
      console.error('Shipment History Data Viewer delete failed.', error);
      window.alert(`Shipment History delete was not completed.\n\n${error.message || error}`);
    }
  }

  async function writeShipmentHistoryDataViewerDataset(dataset) {
    const handle = shipmentHistoryDataViewerState.fileHandle;
    if (!handle) {
      throw new Error('Shipment History JSON is not connected for writing.');
    }

    await writeShipmentHistoryDataViewerFileHandle(handle, dataset);
    syncShipmentHistoryModuleHandle(handle);
  }

  async function writeShipmentHistoryDataViewerFileHandle(handle, dataset) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(dataset, null, 2));
    await writable.close();
    await verifyShipmentHistoryDataViewerWrite(handle, dataset);
  }

  async function verifyShipmentHistoryDataViewerWrite(handle, expectedDataset) {
    if (!handle?.getFile) return;
    const file = await handle.getFile();
    const text = await file.text();
    const actualDataset = JSON.parse(text);
    const actualCount = Array.isArray(actualDataset.records) ? actualDataset.records.length : 0;
    const expectedCount = Array.isArray(expectedDataset.records) ? expectedDataset.records.length : 0;
    if (actualCount !== expectedCount) {
      throw new Error('Shipment History JSON verification failed after delete.');
    }
  }

  async function getShipmentHistoryDataViewerWritableHandle() {
    syncShipmentHistoryDataViewerHandleFromShipmentHistoryModule();
    if (shipmentHistoryDataViewerState.fileHandle) {
      const permission = await ensureShipmentHistoryDataViewerWritePermission(shipmentHistoryDataViewerState.fileHandle);
      if (permission !== 'granted') {
        throw new Error('Write permission was not granted for shipment-history.json.');
      }
      return shipmentHistoryDataViewerState.fileHandle;
    }

    const handle = await promptForShipmentHistoryDataViewerFileHandle();
    shipmentHistoryDataViewerState.fileHandle = handle;
    syncShipmentHistoryModuleHandle(handle);
    return handle;
  }

  function syncShipmentHistoryDataViewerHandleFromShipmentHistoryModule() {
    if (shipmentHistoryDataViewerState.fileHandle) return;
    if (window.shipmentHistoryState?.fileHandle) {
      shipmentHistoryDataViewerState.fileHandle = window.shipmentHistoryState.fileHandle;
    }
  }

  function syncShipmentHistoryModuleHandle(handle) {
    if (!window.shipmentHistoryState || !handle) return;
    window.shipmentHistoryState.fileHandle = handle;
    window.shipmentHistoryState.writable = true;
    window.shipmentHistoryState.sourceFile = handle.name || 'shipment-history.json';
    window.shipmentHistoryState.persistenceMode = 'Project JSON writable file handle';
  }

  function getShipmentHistoryViewerRecordIdentity(record) {
    return [
      getShipmentHistoryViewerValue(record, ['shipmentId', 'identifiers.shipmentId']),
      getShipmentHistoryViewerValue(record, ['masterRecordKey', 'identifiers.masterRecordKey']),
      getShipmentHistoryViewerValue(record, ['salesOrder', 'order.salesOrder']),
      getShipmentHistoryViewerValue(record, ['salesOrderLine', 'order.salesOrderLine']),
      getShipmentHistoryViewerValue(record, ['workOrder', 'order.workOrder'])
    ].join('|');
  }

  function findShipmentHistoryViewerRecordIndex(identity) {
    if (!identity) return -1;
    return shipmentHistoryDataViewerState.records.findIndex((record) => getShipmentHistoryViewerRecordIdentity(record) === identity);
  }

  function getShipmentHistoryViewerValue(record, paths) {
    for (const path of paths) {
      const value = getShipmentHistoryViewerPath(record, path);
      if (value !== undefined && value !== null && value !== '') {
        return String(value);
      }
    }
    return '';
  }

  function getShipmentHistoryViewerPath(record, path) {
    return path.split('.').reduce((current, part) => {
      if (current === undefined || current === null) return undefined;
      return current[part];
    }, record);
  }

  function escapeShipmentHistoryViewerHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.loadSystemCenterModule = loadSystemCenterModule;
  window.connectShipmentHistoryDataViewerFile = connectShipmentHistoryDataViewerFile;
  window.refreshShipmentHistoryDataViewer = refreshShipmentHistoryDataViewer;
  window.selectShipmentHistoryDataViewerRecord = selectShipmentHistoryDataViewerRecord;
  window.deleteSelectedShipmentHistoryDataViewerRecord = deleteSelectedShipmentHistoryDataViewerRecord;
})();

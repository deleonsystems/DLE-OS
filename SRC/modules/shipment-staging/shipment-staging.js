/* -----------------------------------------------------
   440 - JS: SHIPMENT STAGING MODULE LOADER
----------------------------------------------------- */

(function () {
  'use strict';

  let selectedShipmentStagingId = '';

  async function loadShipmentStagingModule() {
    const placeholder = document.getElementById('shipmentStaging');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/shipment-staging/shipment-staging.html');
    if (!response.ok) {
      throw new Error('Unable to load Shipment Staging module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;
  }

  function renderShipmentStagingModule() {
    renderShipmentStagingSummary();
    renderShipmentStagingTable();
    filterShipmentStaging();
  }

  function renderShipmentStagingSummary() {
    const records = Array.isArray(shipmentStagingState.records) ? shipmentStagingState.records : [];
    const pendingCount = records.filter(record => record.status === 'Pending Invoice').length;
    const lastUpdated = shipmentStagingState.lastUpdated ||
      records[records.length - 1]?.shipmentDateTime ||
      'Not available';

    const summary = document.getElementById('shipmentStagingSummary');
    if (summary) {
      summary.textContent =
        'Shipment Count: ' + records.length +
        ' | Pending Invoice: ' + pendingCount +
        ' | Last Updated: ' + lastUpdated;
    }

    const status = document.getElementById('shipmentStagingStatus');
    if (status) {
      status.textContent = shipmentStagingState.persistence?.mode === 'Load Error'
        ? 'Shipment Staging persistence error: ' + (shipmentStagingState.persistence.error || 'Unable to load persisted dataset.')
        : records.length
        ? records.length + ' Shipment Staging record' + (records.length === 1 ? '' : 's') + ' available.'
        : 'Shipment Staging is empty. Confirm shipments to create records.';
    }

    syncSelectedShipmentStagingIdToRecords();
    updateUndoSelectedShipmentButton();
  }

  function renderShipmentStagingTable() {
    const table = document.getElementById('shipmentStagingTable');
    if (!table) return;

    const records = Array.isArray(shipmentStagingState.records) ? shipmentStagingState.records : [];
    if (!records.length) {
      table.innerHTML = '<div class="report-empty">No shipment records have been created yet.</div>';
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
    <th>Qty Shipped</th>
    <th>Status</th>
</tr>
`;

    records.forEach((record, index) => {
      const shipmentId = getShipmentStagingRecordId(record);
      const selectedClass = shipmentId && shipmentId === selectedShipmentStagingId
        ? ' shipment-staging-row-selected'
        : '';
      html += `
<tr class="${index % 2 === 0 ? 'rowEven' : 'rowOdd'} shipment-staging-row${selectedClass}" data-shipment-staging-row="true" data-shipment-id="${escapeHtml(shipmentId)}" onclick="selectShipmentStagingTransaction(event, this.dataset.shipmentId)">
    <td>${escapeHtml(record.shipmentDateTime || record.requestDateTime || '')}</td>
    <td>${escapeHtml(shipmentId)}</td>
    <td class="nowrap">${escapeHtml(formatShipmentStagingCustomer(record))}</td>
    <td>${escapeHtml(record.salesOrder || '')}</td>
    <td>${escapeHtml(record.salesOrderLine || '')}</td>
    <td>${escapeHtml(record.workOrder || '')}</td>
    <td>${escapeHtml(record.itemNumber || record.assembly || '')}</td>
    <td class="nowrap">${escapeHtml(record.description || '')}</td>
    <td>${escapeHtml(String(record.quantityShipped ?? record.qtyRequested ?? ''))}</td>
    <td>${escapeHtml(record.status || 'Pending Invoice')}</td>
</tr>
`;
    });

    html += '</table>';
    table.innerHTML = html;
  }

  function formatShipmentStagingCustomer(record) {
    const customerNumber = normalizeOrderValue(record.customerNumber, '');
    const customerName = normalizeOrderValue(record.customerName || record.customer, '');
    if (customerNumber && customerName) return customerNumber + ' - ' + customerName;
    return customerName || customerNumber;
  }

  function getShipmentStagingRecordId(record) {
    return record?.shipmentId || record?.requestId || '';
  }

  function filterShipmentStaging() {
    const input = document.getElementById('shipmentStagingSearch');
    const table = document.querySelector('#shipmentStagingTable table');
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

  function selectShipmentStagingTransaction(event, shipmentId) {
    if (event) event.stopPropagation();
    selectedShipmentStagingId = shipmentId || '';
    renderShipmentStagingTable();
    updateUndoSelectedShipmentButton();

    const status = document.getElementById('shipmentStagingStatus');
    const selectedRecords = getSelectedShipmentStagingRecords();
    if (status) {
      status.textContent = selectedRecords.length
        ? 'Selected Shipment ID ' + selectedShipmentStagingId + ' (' + selectedRecords.length + ' line' + (selectedRecords.length === 1 ? '' : 's') + ').'
        : 'No Shipment Staging transaction is selected.';
    }
  }

  function syncSelectedShipmentStagingIdToRecords() {
    if (!selectedShipmentStagingId) return;
    const records = Array.isArray(shipmentStagingState.records) ? shipmentStagingState.records : [];
    if (!records.some(record => getShipmentStagingRecordId(record) === selectedShipmentStagingId)) {
      selectedShipmentStagingId = '';
    }
  }

  function getSelectedShipmentStagingRecords() {
    if (!selectedShipmentStagingId) return [];
    const records = Array.isArray(shipmentStagingState.records) ? shipmentStagingState.records : [];
    return records.filter(record => getShipmentStagingRecordId(record) === selectedShipmentStagingId);
  }

  function updateUndoSelectedShipmentButton() {
    const button = document.getElementById('undoSelectedShipmentButton');
    if (!button) return;

    const selectedRecords = getSelectedShipmentStagingRecords();
    const canUndo = selectedRecords.length > 0 &&
      selectedRecords.every(record => record.status === 'Pending Invoice');

    button.disabled = !canUndo;
    button.title = canUndo
      ? 'Undo selected Pending Invoice shipment.'
      : 'Select a shipment where every line is Pending Invoice before undoing.';
  }

  function undoSelectedShipment() {
    const selectedRecords = getSelectedShipmentStagingRecords();
    const status = document.getElementById('shipmentStagingStatus');

    if (!selectedRecords.length) {
      if (status) status.textContent = 'Select a shipment before undoing.';
      return;
    }

    const nonPendingRecord = selectedRecords.find(record => record.status !== 'Pending Invoice');
    if (nonPendingRecord) {
      if (status) {
        status.textContent = 'Undo is not allowed after a shipment has been reconciled.';
      }
      updateUndoSelectedShipmentButton();
      return;
    }

    const shipmentId = selectedShipmentStagingId;
    selectedRecords.forEach(record => {
      const recordKey = record.masterRecordKey || (typeof buildMasterRecordKey === 'function'
        ? buildMasterRecordKey(record.customerNumber, record.salesOrder, record.salesOrderLine)
        : '');
      if (typeof setMasterRecordLifecycleState === 'function') {
        setMasterRecordLifecycleState(recordKey, 'OPEN', {
          reason: 'Shipment Staging Undo',
          shipmentId
        });
      }
    });

    shipmentStagingState.records = shipmentStagingState.records.filter(record =>
      getShipmentStagingRecordId(record) !== shipmentId
    );
    shipmentStagingState.lastUpdated = new Date().toLocaleString();
    selectedShipmentStagingId = '';

    openOrderShipmentPreparation = null;
    syncOpenOrderShipmentSelectionToOperationalView();
    renderShipmentStagingModule();
    refreshOpenOrdersTableView();
    if (typeof renderMasterDataDashboardStatus === 'function') renderMasterDataDashboardStatus();
    if (typeof renderDleMasterDataViewer === 'function') renderDleMasterDataViewer();
    updateOpenOrderShipmentSelectionCount('Selected shipment was undone.');

    if (status) {
      status.textContent = 'Shipment ID ' + shipmentId + ' undone. Open Orders restored from Shipment Staging.';
    }
  }

  window.loadShipmentStagingModule = loadShipmentStagingModule;
  window.renderShipmentStagingModule = renderShipmentStagingModule;
  window.renderShipmentStagingSummary = renderShipmentStagingSummary;
  window.renderShipmentStagingTable = renderShipmentStagingTable;
  window.filterShipmentStaging = filterShipmentStaging;
  window.selectShipmentStagingTransaction = selectShipmentStagingTransaction;
  window.syncSelectedShipmentStagingIdToRecords = syncSelectedShipmentStagingIdToRecords;
  window.getSelectedShipmentStagingRecords = getSelectedShipmentStagingRecords;
  window.updateUndoSelectedShipmentButton = updateUndoSelectedShipmentButton;
  window.undoSelectedShipment = undoSelectedShipment;
})();

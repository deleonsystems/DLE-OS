/* -----------------------------------------------------
   450 - JS: SHIPMENT HISTORY MODULE LOADER
----------------------------------------------------- */

(function () {
  'use strict';

  const shipmentHistoryRecords = [];

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

  function renderShipmentHistoryModule() {
    renderShipmentHistorySummary();
    renderShipmentHistoryTable();
    filterShipmentHistory();
  }

  function renderShipmentHistorySummary() {
    const records = Array.isArray(shipmentHistoryRecords) ? shipmentHistoryRecords : [];

    const summary = document.getElementById('shipmentHistorySummary');
    if (summary) {
      summary.textContent = records.length + ' archived shipment' + (records.length === 1 ? '' : 's') + '.';
    }

    const status = document.getElementById('shipmentHistoryStatus');
    if (status) {
      status.textContent = records.length
        ? records.length + ' Shipment History record' + (records.length === 1 ? '' : 's') + ' available.'
        : 'Shipment History is empty. Completed shipments will appear here after future archive logic is implemented.';
    }
  }

  function renderShipmentHistoryTable() {
    const table = document.getElementById('shipmentHistoryTable');
    if (!table) return;

    const records = Array.isArray(shipmentHistoryRecords) ? shipmentHistoryRecords : [];
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
    <th>Qty Shipped</th>
    <th>Status</th>
</tr>
`;

    records.forEach((record, index) => {
      html += `
<tr class="${index % 2 === 0 ? 'rowEven' : 'rowOdd'}">
    <td>${escapeHtml(record.shipmentDateTime || '')}</td>
    <td>${escapeHtml(record.shipmentId || '')}</td>
    <td class="nowrap">${escapeHtml(record.customer || '')}</td>
    <td>${escapeHtml(record.salesOrder || '')}</td>
    <td>${escapeHtml(record.salesOrderLine || '')}</td>
    <td>${escapeHtml(record.workOrder || '')}</td>
    <td>${escapeHtml(record.itemNumber || '')}</td>
    <td class="nowrap">${escapeHtml(record.description || '')}</td>
    <td>${escapeHtml(String(record.quantityShipped ?? ''))}</td>
    <td>${escapeHtml(record.status || 'Archived')}</td>
</tr>
`;
    });

    html += '</table>';
    table.innerHTML = html;
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
  window.renderShipmentHistoryModule = renderShipmentHistoryModule;
  window.renderShipmentHistorySummary = renderShipmentHistorySummary;
  window.renderShipmentHistoryTable = renderShipmentHistoryTable;
  window.filterShipmentHistory = filterShipmentHistory;
})();

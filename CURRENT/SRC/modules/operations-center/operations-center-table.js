/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER TABLE
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const officialColumns = window.OperationsCenter.officialColumns || [];
  const overlayFields = window.OperationsCenter.overlayFields || [];
  const state = window.OperationsCenter.state;
  const stateActions = window.OperationsCenter.stateActions;
  const viewModel = window.OperationsCenter.viewModel;

  function renderModule() {
    renderStatus();
    renderTable();
    filter();
  }

  function renderStatus() {
    const status = document.getElementById('operationsCenterStatus');
    if (!status) return;

    const records = viewModel.getMasterRecords();
    const overlayCount = Object.keys(state.overlayByKey).length;
    const masterLoaded = !!viewModel.getMasterData();

    status.textContent = masterLoaded
      ? records.length + ' active Master Data record' + (records.length === 1 ? '' : 's') + ' shown. Overlay records: ' + overlayCount + '. Source: ' + state.sourceFile + '.'
      : 'Load Master Data from System Center to view Operations Center. Overlay source: ' + state.sourceFile + '.';
  }

  function renderTable() {
    const container = document.getElementById('operationsCenterTable');
    if (!container) return;

    const records = viewModel.getMasterRecords();
    if (!records.length) {
      container.innerHTML = '<div class="operations-center-empty">Load Master Data from System Center to view Operations Center.</div>';
      return;
    }

    const headers = officialColumns
      .map(column => '<th>' + escapeHtml(column.label) + '</th>')
      .concat(overlayFields.map(field => '<th>' + escapeHtml(field.label) + '</th>'))
      .join('');

    const rows = records.map((record, index) => renderRow(record, index)).join('');
    container.innerHTML = '<table class="operations-center-table"><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderRow(record, index) {
    const masterRecordKey = viewModel.getMasterRecordKey(record);
    const officialCells = officialColumns.map(column => {
      const value = viewModel.getOfficialField(record, column.key);
      const descriptionClass = column.key === 'description' ? ' operations-center-description-cell' : '';
      return '<td class="operations-center-official-cell' + descriptionClass + '">' + escapeHtml(value) + '</td>';
    }).join('');

    const overlay = stateActions.getOverlayRecord(masterRecordKey);
    const overlayCells = overlayFields.map(field => {
      return [
        '<td class="operations-center-overlay-cell">',
        '<div class="operations-center-editable" contenteditable="true" data-master-record-key="',
        escapeHtml(masterRecordKey),
        '" data-overlay-field="',
        escapeHtml(field.key),
        '" oninput="updateOperationsCenterOverlayField(event)">',
        escapeHtml(overlay[field.key] || ''),
        '</div>',
        '</td>'
      ].join('');
    }).join('');

    return '<tr class="' + (index % 2 === 0 ? 'rowEven' : 'rowOdd') + '" data-master-record-key="' + escapeHtml(masterRecordKey) + '">' + officialCells + overlayCells + '</tr>';
  }

  function updateOverlayField(event) {
    const target = event?.target;
    const masterRecordKey = target?.dataset?.masterRecordKey || '';
    const field = target?.dataset?.overlayField || '';
    const updated = stateActions.updateOverlayField(masterRecordKey, field, target?.textContent || '');
    if (updated) updateSaveStatus('Unsaved Operations Overlay changes.', 'dirty');
  }

  function filter() {
    const input = document.getElementById('operationsCenterSearch');
    const table = document.querySelector('#operationsCenterTable table');
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

  function updateSaveStatus(message, stateClass) {
    const status = document.getElementById('operationsCenterSaveStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.remove('dirty', 'saved', 'error');
    if (stateClass) status.classList.add(stateClass);
  }

  window.OperationsCenter.table = {
    renderModule,
    renderStatus,
    renderTable,
    updateOverlayField,
    filter,
    updateSaveStatus
  };
})();

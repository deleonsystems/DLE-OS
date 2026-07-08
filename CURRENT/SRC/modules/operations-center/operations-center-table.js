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
  const documentLinks = window.OperationsCenter.documentLinks;

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

    const documentStatus = document.getElementById('operationsCenterDocumentStatus');
    if (documentStatus && documentLinks?.getStatus) {
      documentStatus.textContent = documentLinks.getStatus('kitShort');
    }
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

    const overlayCells = overlayFields.map(field => {
      if (field.documentLink) return renderDocumentLinkCell(field, record);

      const overlay = stateActions.getOverlayRecord(masterRecordKey);
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

  function renderDocumentLinkCell(field, record) {
    const type = field.documentLink.type;
    const workOrder = viewModel.getOfficialField(record, 'workOrder');
    const documentState = documentLinks?.getDocumentState(type, workOrder) || { exists: false };

    if (!documentState.exists) {
      return [
        '<td class="operations-center-overlay-cell operations-center-document-cell">',
        '<span class="operations-center-document-missing" title="No document found">&mdash;</span>',
        '</td>'
      ].join('');
    }

    return [
      '<td class="operations-center-overlay-cell operations-center-document-cell">',
      '<button type="button" class="operations-center-document-link" title="Open ',
      escapeHtml(field.label),
      ' PDF" data-document-link-type="',
      escapeHtml(type),
      '" data-work-order="',
      escapeHtml(workOrder),
      '" onclick="openOperationsCenterDocumentLink(event)">&#128279;</button>',
      '</td>'
    ].join('');
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

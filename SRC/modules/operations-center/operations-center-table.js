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
  const projection = window.OperationsCenter.projection;

  function renderModule() {
    renderStatus();
    renderProjectionSummary();
    renderTable();
    filter();
  }

  function renderStatus() {
    const status = document.getElementById('operationsCenterStatus');
    if (!status) return;

    const records = getDisplayedRecords();
    const overlayCount = Object.keys(state.overlayByKey).length;
    const masterLoaded = !!viewModel.getMasterData();

    status.textContent = masterLoaded
      ? records.length + ' operational Master Data record' + (records.length === 1 ? '' : 's') + ' requiring action shown. Overlay records: ' + overlayCount + '. Source: ' + state.sourceFile + '.'
      : 'Load Master Data from System Center to view Operations Center. Overlay source: ' + state.sourceFile + '.';

    const documentStatus = document.getElementById('operationsCenterDocumentStatus');
    if (documentStatus && documentLinks?.getStatus) {
      const selector = document.getElementById('operationsCenterDocumentType');
      documentStatus.textContent = documentLinks.getStatus(selector?.value || 'kitShort');
    }
  }

  function renderTable() {
    const container = document.getElementById('operationsCenterTable');
    if (!container) return;

    const records = getDisplayedRecords();
    if (!records.length) {
      container.innerHTML = viewModel.getMasterData()
        ? '<div class="operations-center-empty">No operational work currently requires action.</div>'
        : '<div class="operations-center-empty">Load Master Data from System Center to view Operations Center.</div>';
      return;
    }

    const projectionHeader = projection?.isActive()
      ? '<th class="operations-center-include-header">Include</th>'
      : '';

    const headers = projectionHeader + officialColumns
      .map(column => '<th>' + escapeHtml(column.label) + '</th>')
      .concat(overlayFields.map(field => '<th>' + escapeHtml(field.label) + '</th>'))
      .join('');

    const rows = records.map((record, index) => renderRow(record, index)).join('');
    container.innerHTML = '<table class="operations-center-table"><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderRow(record, index) {
    const masterRecordKey = viewModel.getMasterRecordKey(record);
    const projectionCell = projection?.isActive()
      ? renderProjectionCell(masterRecordKey)
      : '';

    const officialCells = officialColumns.map(column => {
      const value = viewModel.getOfficialField(record, column.key);
      const descriptionClass = column.key === 'description' ? ' operations-center-description-cell' : '';
      if (column.key === 'salesOrder') {
        return [
          '<td class="operations-center-official-cell">',
          '<button type="button" class="operations-center-sales-order-link" data-master-record-key="',
          escapeHtml(masterRecordKey),
          '" onclick="openOperationsCenterSalesOrderDashboard(event)">',
          escapeHtml(value),
          '</button>',
          '</td>'
        ].join('');
      }
      if (column.key === 'operationalStatus') {
        return renderOperationalStatusCell(value);
      }
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

    return '<tr class="' + (index % 2 === 0 ? 'rowEven' : 'rowOdd') + '" data-master-record-key="' + escapeHtml(masterRecordKey) + '">' + projectionCell + officialCells + overlayCells + '</tr>';
  }

  function getDisplayedRecords() {
    return typeof viewModel.getOperationsCenterRecords === 'function'
      ? viewModel.getOperationsCenterRecords()
      : viewModel.getMasterRecords();
  }

  function renderOperationalStatusCell(value) {
    const presentation = viewModel.getOperationalStatusPresentation(value);
    const label = presentation.label || '';
    if (!presentation.isPacking) {
      return '<td class="operations-center-official-cell">' + escapeHtml(label) + '</td>';
    }

    return [
      '<td class="operations-center-official-cell">',
      '<span class="', presentation.className, '">',
      escapeHtml(label),
      '</span>',
      '</td>'
    ].join('');
  }

  function renderProjectionCell(masterRecordKey) {
    const checked = projection?.isSelected(masterRecordKey) ? ' checked' : '';
    return [
      '<td class="operations-center-include-cell">',
      '<input type="checkbox" data-master-record-key="',
      escapeHtml(masterRecordKey),
      '" onchange="updateOperationsCenterProjectionSelection(event)"',
      checked,
      '>',
      '</td>'
    ].join('');
  }

  function renderProjectionSummary() {
    const summary = document.getElementById('operationsCenterProjectionSummary');
    const jobs = document.getElementById('operationsCenterProjectionJobs');
    const revenue = document.getElementById('operationsCenterProjectionRevenue');
    const toggle = document.getElementById('operationsCenterProjectionToggle');
    const active = !!projection?.isActive();

    if (toggle) {
      toggle.classList.toggle('active', active);
      toggle.textContent = active ? 'Projection Mode: On' : 'Projection Mode';
    }

    if (!summary) return;
    summary.hidden = !active;
    if (!active) return;

    const projectionSummary = projection.getSummary(getDisplayedRecords(), viewModel);
    if (jobs) jobs.textContent = String(projectionSummary.selectedJobs);
    if (revenue) revenue.textContent = projection.formatCurrency(projectionSummary.projectedRevenue);
  }

  function updateProjectionSelection(event) {
    const target = event?.target;
    const masterRecordKey = target?.dataset?.masterRecordKey || '';
    projection?.setSelected(masterRecordKey, !!target?.checked);
    renderProjectionSummary();
  }

  function openSalesOrderDashboard(event) {
    const target = event?.currentTarget || event?.target;
    const masterRecordKey = target?.dataset?.masterRecordKey || '';
    const record = getDisplayedRecords().find(item => viewModel.getMasterRecordKey(item) === masterRecordKey);
    if (!record) return;

    const selectedOrder = buildSelectedOrderPayload(record, masterRecordKey);
    if (typeof window.SalesOrderDashboard?.setSelectedOrder === 'function') {
      window.SalesOrderDashboard.setSelectedOrder(selectedOrder);
    }
    if (typeof go === 'function') {
      go('salesOrderDashboard');
    }
  }

  function buildSelectedOrderPayload(record, masterRecordKey) {
    const official = buildOfficialFields(record);
    const overlay = stateActions.getOverlayRecord(masterRecordKey);
    const relatedRows = getRelatedSalesOrderRows(official);

    return {
      masterRecordKey,
      official,
      overlay: { ...overlay },
      relatedRows,
      masterRecord: cloneRecord(record)
    };
  }

  function getRelatedSalesOrderRows(selectedOfficial) {
    const selectedGroupKey = getSalesOrderGroupKey(selectedOfficial);
    if (!selectedGroupKey) return [];

    return viewModel.getMasterRecords()
      .map(record => {
        const key = viewModel.getMasterRecordKey(record);
        const official = buildOfficialFields(record);
        return {
          masterRecordKey: key,
          official,
          overlay: { ...stateActions.getOverlayRecord(key) },
          masterRecord: cloneRecord(record)
        };
      })
      .filter(row => getSalesOrderGroupKey(row.official) === selectedGroupKey);
  }

  function buildOfficialFields(record) {
    const fields = officialColumns.reduce((official, column) => {
      official[column.key] = viewModel.getOfficialField(record, column.key);
      return official;
    }, {});
    fields.customerNumber = viewModel.getOfficialField(record, 'customerNumber');
    return fields;
  }

  function getSalesOrderGroupKey(official) {
    const salesOrder = normalizeSalesOrderGroupValue(official?.salesOrder);
    if (!salesOrder) return '';

    const customerNumber = normalizeSalesOrderGroupValue(official?.customerNumber);
    const customerName = normalizeSalesOrderGroupValue(official?.customer);
    const customerIdentity = customerNumber
      ? 'NUMBER:' + customerNumber
      : 'NAME:' + customerName;
    return customerIdentity + '|SALES_ORDER:' + salesOrder;
  }

  function normalizeSalesOrderGroupValue(value) {
    return String(value ?? '').trim().toUpperCase();
  }

  function cloneRecord(record) {
    try {
      return structuredClone(record);
    } catch (error) {
      return JSON.parse(JSON.stringify(record || {}));
    }
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
    renderProjectionSummary,
    renderTable,
    openSalesOrderDashboard,
    updateProjectionSelection,
    updateOverlayField,
    filter,
    updateSaveStatus
  };

  window.openOperationsCenterSalesOrderDashboard = openSalesOrderDashboard;
})();

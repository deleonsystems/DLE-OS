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
    configureShipmentStagingControls();
    renderShipmentStagingSummary();
    renderShipmentStagingTable();
    filterShipmentStaging();
    window.ShippingWorkspace?.renderShipmentStaging?.();
  }

  function renderShipmentStagingSummary() {
    const records = Array.isArray(shipmentStagingState.records) ? shipmentStagingState.records : [];
    const displayLines = getShipmentStagingDisplayLines(records);
    const shipmentCount = new Set(records.map(getShipmentStagingRecordId).filter(Boolean)).size;
    const pendingCount = displayLines.filter(line =>
      !['ERP_CONFIRMED', 'CANCELLED'].includes(line.status)).length;
    const lastUpdated = shipmentStagingState.lastUpdated ||
      records[records.length - 1]?.shipmentDateTime ||
      'Not available';

    const summary = document.getElementById('shipmentStagingSummary');
    if (summary) {
      summary.textContent =
        'Shipment Count: ' + shipmentCount +
        ' | Detail Lines: ' + displayLines.length +
        ' | Pending Invoice: ' + pendingCount +
        ' | Last Updated: ' + lastUpdated;
    }

    const status = document.getElementById('shipmentStagingStatus');
    if (status) {
      status.textContent = shipmentStagingState.persistence?.mode === 'Load Error'
        ? 'Shipment Staging persistence error: ' + (shipmentStagingState.persistence.error || 'Unable to load persisted dataset.')
        : displayLines.length
        ? displayLines.length + ' Shipment Staging line' + (displayLines.length === 1 ? '' : 's') +
          ' in ' + shipmentCount + ' shipment' + (shipmentCount === 1 ? '' : 's') + ' available.'
        : 'Shipment Staging is empty. Confirm shipments to create records.';
    }

    syncSelectedShipmentStagingIdToRecords();
    updateUndoSelectedShipmentButton();
  }

  function renderShipmentStagingTable() {
    const table = document.getElementById('shipmentStagingTable');
    if (!table) return;

    const records = Array.isArray(shipmentStagingState.records) ? shipmentStagingState.records : [];
    const displayLines = getShipmentStagingDisplayLines(records);
    if (!displayLines.length) {
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
    <th>Sales Order Line</th>
    <th>Work Order</th>
    <th>Item Number</th>
    <th>Description</th>
    <th>Qty Shipped</th>
    <th>Status</th>
    <th>Proposed Invoice</th>
    <th>Evidence</th>
    <th>Action</th>
</tr>
`;

    displayLines.forEach((line, index) => {
      const shipmentId = line.shipmentId;
      const selectedClass = shipmentId && shipmentId === selectedShipmentStagingId
        ? ' shipment-staging-row-selected'
        : '';
      html += `
<tr class="${index % 2 === 0 ? 'rowEven' : 'rowOdd'} shipment-staging-row${selectedClass}" data-shipment-staging-row="true" data-shipment-id="${escapeHtml(shipmentId)}" data-shipment-record-index="${line.recordIndex}" data-shipment-line-index="${line.lineIndex}" onclick="selectShipmentStagingTransaction(event, this.dataset.shipmentId)">
    <td>${escapeHtml(line.shipmentDateTime)}</td>
    <td>${escapeHtml(shipmentId)}</td>
    <td class="nowrap">${escapeHtml(formatShipmentStagingCustomer(line))}</td>
    <td>${escapeHtml(line.salesOrder)}</td>
    <td>${escapeHtml(line.salesOrderLine)}</td>
    <td>${escapeHtml(line.workOrder)}</td>
    <td>${escapeHtml(line.itemNumber)}</td>
    <td class="nowrap">${escapeHtml(line.description)}</td>
    <td>${escapeHtml(String(line.quantityShipped))}</td>
    <td>${escapeHtml(line.operationalStatus || line.status)}</td>
    <td>${escapeHtml(line.proposedInvoiceNumber
      ? line.proposedInvoiceNumber + (line.proposedInvoiceLineNumber ? ' / ' + line.proposedInvoiceLineNumber : '')
      : '—')}</td>
    <td>${escapeHtml(line.evidenceSummary || line.contradictionSummary || 'Awaiting ERP evidence')}</td>
    <td><button type="button" onclick="event.stopPropagation(); selectShipmentStagingTransaction(event, '${escapeHtml(shipmentId)}'); openShipmentStagingReview();">Review</button></td>
</tr>
`;
    });

    html += '</table>';
    table.innerHTML = html;
  }

  function getShipmentStagingDisplayLines(records) {
    return (records || []).flatMap((record, recordIndex) => {
      const detailLines = Array.isArray(record?.lines) && record.lines.length
        ? record.lines
        : [record];

      return detailLines.map((detailLine, lineIndex) => ({
        recordIndex,
        lineIndex,
        shipmentId: getShipmentStagingRecordId(record),
        shipmentDateTime: record?.shipmentDateTime || record?.requestDateTime || '',
        customerNumber: detailLine?.customerNumber || record?.customerNumber || '',
        customerName: detailLine?.customerName || detailLine?.customer ||
          record?.customerName || record?.customer || '',
        salesOrder: detailLine?.salesOrder || record?.salesOrder || '',
        salesOrderLine: detailLine?.salesOrderLine || detailLine?.sequenceLine ||
          record?.salesOrderLine || record?.sequenceLine || '',
        workOrder: detailLine?.workOrder || record?.workOrder || '',
        itemNumber: detailLine?.itemNumber || detailLine?.assembly || detailLine?.partNumber ||
          record?.itemNumber || record?.assembly || record?.partNumber || '',
        description: detailLine?.description || record?.description || '',
        quantityShipped: detailLine?.quantityShipped ?? detailLine?.qtyRequested ??
          record?.quantityShipped ?? record?.qtyRequested ?? '',
        operationalStatus: detailLine?.operationalStatus || record?.operationalStatus || '',
        status: detailLine?.status || record?.status || 'Pending Invoice',
        proposedInvoiceNumber: detailLine?.proposedInvoiceNumber || record?.proposedInvoiceNumber || '',
        proposedInvoiceLineNumber: detailLine?.proposedInvoiceLineNumber || record?.proposedInvoiceLineNumber || '',
        evidenceSummary: detailLine?.evidenceSummary || record?.evidenceSummary || '',
        contradictionSummary: detailLine?.contradictionSummary || record?.contradictionSummary || ''
      }));
    });
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
    updateShipmentStagingReviewButton();

    const status = document.getElementById('shipmentStagingStatus');
    const selectedRecords = getSelectedShipmentStagingRecords();
    const selectedLineCount = getShipmentStagingDisplayLines(selectedRecords).length;
    if (status) {
      status.textContent = selectedRecords.length
        ? 'Selected Shipment ID ' + selectedShipmentStagingId + ' (' + selectedLineCount + ' line' + (selectedLineCount === 1 ? '' : 's') + ').'
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
    const canUndo = !window.usesOperationalShipmentStaging?.() && selectedRecords.length > 0 &&
      selectedRecords.every(record => record.status === 'Pending Invoice');

    button.disabled = !canUndo;
    button.title = canUndo
      ? 'Undo selected Pending Invoice shipment.'
      : 'Select a shipment where every line is Pending Invoice before undoing.';
  }

  function configureShipmentStagingControls() {
    const operational = window.usesOperationalShipmentStaging?.() === true;
    const legacyButton = document.getElementById('shipmentStagingLegacyFileButton');
    if (legacyButton) legacyButton.hidden = operational;
    const reconcileButton = document.getElementById('reconcileShipmentStagingButton');
    if (reconcileButton) reconcileButton.hidden = !operational;
    const reviewButton = document.getElementById('reviewShipmentStagingButton');
    if (reviewButton) reviewButton.hidden = !operational;
    const undoButton = document.getElementById('undoSelectedShipmentButton');
    if (undoButton) undoButton.hidden = operational;
  }

  function updateShipmentStagingReviewButton() {
    const button = document.getElementById('reviewShipmentStagingButton');
    if (!button) return;
    button.disabled = getSelectedShipmentStagingRecords().length !== 1;
  }

  async function refreshShipmentStagingView() {
    const status = document.getElementById('shipmentStagingStatus');
    try {
      if (window.usesOperationalShipmentStaging?.()) {
        if (status) status.textContent = 'Refreshing governed Shipment Staging…';
        await window.refreshOperationalShipmentStaging();
      } else {
        renderShipmentStagingModule();
      }
    } catch (error) {
      if (status) status.textContent = 'Shipment Staging refresh failed: ' + (error?.message || error);
    }
  }

  async function reconcileShipmentStaging() {
    const status = document.getElementById('shipmentStagingStatus');
    const button = document.getElementById('reconcileShipmentStagingButton');
    try {
      if (button) button.disabled = true;
      if (status) status.textContent = 'Comparing pending shipments with canonical ERP invoice evidence…';
      const result = await window.DleApiClient.runShipmentReconciliation({
        requestCorrelationId: window.DleApiClient.createRequestCorrelationId(),
        triggerType: 'MANUAL'
      });
      await window.refreshOperationalShipmentStaging();
      if (status) status.textContent = 'Reconciliation completed for ' + result.shipmentCount +
        ' shipment' + (result.shipmentCount === 1 ? '.' : 's.') + ' No matches were auto-confirmed.';
    } catch (error) {
      if (status) status.textContent = 'Shipment reconciliation failed: ' + (error?.message || error) +
        (error?.requestId ? ' Request ' + error.requestId + '.' : '');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function openShipmentStagingReview() {
    const record = getSelectedShipmentStagingRecords()[0];
    const dialog = document.getElementById('shipmentStagingReviewDialog');
    if (!record || !dialog) return;
    setReviewText('shipmentStagingReviewShipment', record.shipmentId);
    setReviewText('shipmentStagingReviewStatus', record.status);
    setReviewText('shipmentStagingReviewSalesOrder', record.salesOrder + ' / ' + record.salesOrderLine);
    setReviewText('shipmentStagingReviewQuantity', String(record.quantityShipped));
    setReviewText('shipmentStagingReviewInvoice', record.proposedInvoiceNumber
      ? record.proposedInvoiceNumber + ' / ' + (record.proposedInvoiceLineNumber || '—') : 'No proposal');
    setReviewText('shipmentStagingReviewInvoiceFacts', record.proposedInvoiceNumber
      ? String(record.proposedInvoiceQuantity ?? '—') + ' / ' + (record.proposedInvoiceDate || '—') : '—');
    setReviewText('shipmentStagingReviewEvidence', record.evidenceSummary || 'No canonical invoice evidence found.');
    setReviewText('shipmentStagingReviewContradictions', record.contradictionSummary || 'None identified');
    document.getElementById('shipmentStagingDecisionNote').value = '';
    setReviewText('shipmentStagingReviewMessage',
      'Review canonical evidence before making a decision. No match is confirmed automatically.');
    const confirmButton = document.getElementById('confirmShipmentStagingMatchButton');
    if (confirmButton) confirmButton.disabled = !record.proposedMatchId || record.status === 'ERP_CONFIRMED';
    dialog.showModal();
  }

  function closeShipmentStagingReview() {
    document.getElementById('shipmentStagingReviewDialog')?.close();
  }

  async function submitShipmentStagingDecision(action) {
    const record = getSelectedShipmentStagingRecords()[0];
    const message = document.getElementById('shipmentStagingReviewMessage');
    const note = String(document.getElementById('shipmentStagingDecisionNote')?.value || '').trim();
    if (!record?.shipmentStagingId) return;
    if (action !== 'confirm-match' && !note) {
      if (message) message.textContent = 'Enter a decision explanation before this governed action.';
      document.getElementById('shipmentStagingDecisionNote')?.focus();
      return;
    }
    const reasons = {
      'confirm-match': 'OPERATOR_VERIFIED_CANONICAL_INVOICE',
      'reject-match': 'INCORRECT_INVOICE_EVIDENCE',
      'mark-exception': 'ERP_EVIDENCE_CONTRADICTION',
      cancel: 'SHIPMENT_CANCELLED_BY_OPERATOR'
    };
    try {
      if (message) message.textContent = 'Recording governed shipment decision…';
      await window.DleApiClient.submitShipmentMatchDecision(record.shipmentStagingId, action, {
        proposalId: record.proposedMatchId,
        confirmedQuantity: action === 'confirm-match' ? Number(record.quantityShipped) : null,
        reasonCode: reasons[action],
        note: note || null,
        requestCorrelationId: window.DleApiClient.createRequestCorrelationId()
      });
      closeShipmentStagingReview();
      await window.refreshOperationalShipmentStaging();
    } catch (error) {
      if (message) message.textContent = (error?.message || 'The decision could not be recorded.') +
        (error?.requestId ? ' Request ' + error.requestId + '.' : '');
    }
  }

  function setReviewText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value || '—';
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
  window.getShipmentStagingDisplayLines = getShipmentStagingDisplayLines;
  window.filterShipmentStaging = filterShipmentStaging;
  window.selectShipmentStagingTransaction = selectShipmentStagingTransaction;
  window.syncSelectedShipmentStagingIdToRecords = syncSelectedShipmentStagingIdToRecords;
  window.getSelectedShipmentStagingRecords = getSelectedShipmentStagingRecords;
  window.updateUndoSelectedShipmentButton = updateUndoSelectedShipmentButton;
  window.undoSelectedShipment = undoSelectedShipment;
  window.refreshShipmentStagingView = refreshShipmentStagingView;
  window.reconcileShipmentStaging = reconcileShipmentStaging;
  window.openShipmentStagingReview = openShipmentStagingReview;
  window.closeShipmentStagingReview = closeShipmentStagingReview;
  window.submitShipmentStagingDecision = submitShipmentStagingDecision;
})();

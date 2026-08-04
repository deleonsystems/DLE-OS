/* -----------------------------------------------------
   480 - JS: WORK ORDER DASHBOARD MODULE BOOTSTRAP
----------------------------------------------------- */

(function () {
  'use strict';

  window.WorkOrderDashboardModule = window.WorkOrderDashboardModule || {};
  let selectedWorkOrder = null;
  let currentView = 'standard';
  let scheduledReleasesExpanded = false;

  const dashboardViews = {
    standard: ['overview', 'scheduled-releases', 'manufacturing-documents', 'module-placeholder'],
    kitting: ['overview', 'scheduled-releases', 'manufacturing-documents', 'kitting-workspace'],
    production: ['overview', 'manufacturing-documents', 'production-workspace']
  };

  /*
    Work Order Dashboard is the future digital replacement for the
    physical Work Order packet. This phase establishes module ownership,
    contextual navigation, and selected-record data passing only.
  */

  async function loadWorkOrderDashboardModule() {
    const placeholder = document.getElementById('workOrderDashboardModule');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/work-order-dashboard/work-order-dashboard.html');
    if (!response.ok) {
      throw new Error('Unable to load Work Order Dashboard module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;
  }

  function initializeWorkOrderDashboardModule() {
    currentView = 'standard';
    scheduledReleasesExpanded = false;
    renderWorkOrderDashboardModule();
  }

  function setSelectedWorkOrder(handoff) {
    selectedWorkOrder = handoff?.canonicalWorkOrder && handoff?.workOrderNumber
      ? handoff
      : null;
    currentView = 'standard';
    scheduledReleasesExpanded = false;
    renderWorkOrderDashboardModule();
  }

  function setDashboardView(viewName) {
    currentView = dashboardViews[viewName] ? viewName : 'standard';
    renderWorkOrderDashboardModule();
  }

  function renderWorkOrderDashboardModule() {
    const status = document.getElementById('workOrderDashboardModuleStatus');
    if (status) {
      status.textContent = selectedWorkOrder
        ? 'Canonical Work Order ' + selectedWorkOrder.workOrderNumber +
          ' loaded. Current view: ' + getViewLabel(currentView) + '.'
        : 'Select a governed canonical Work Order from Sales Order Dashboard.';
    }
    syncDashboardViewSelector();
    applyDashboardView();
    syncScheduledReleasesCollapseState();
    renderSelectedWorkOrderSummary();
    renderRelatedWorkOrders();
  }

  function syncDashboardViewSelector() {
    const selector = document.getElementById('workOrderDashboardView');
    if (selector) selector.value = currentView;
  }

  function applyDashboardView() {
    const visibleSections = new Set(dashboardViews[currentView] || dashboardViews.standard);
    document.querySelectorAll('[data-work-order-dashboard-section]').forEach(section => {
      const sectionName = section.dataset.workOrderDashboardSection || '';
      section.hidden = !visibleSections.has(sectionName);
    });
  }

  function getViewLabel(viewName) {
    const labels = {
      standard: 'Standard View',
      kitting: 'Kitting View',
      production: 'Production View'
    };
    return labels[viewName] || labels.standard;
  }

  function toggleScheduledReleases() {
    scheduledReleasesExpanded = !scheduledReleasesExpanded;
    syncScheduledReleasesCollapseState();
  }

  function syncScheduledReleasesCollapseState() {
    const body = document.getElementById('workOrderDashboardScheduledReleasesBody');
    const indicator = document.getElementById('workOrderDashboardScheduledReleasesIndicator');
    if (body) body.hidden = !scheduledReleasesExpanded;
    if (indicator) indicator.textContent = scheduledReleasesExpanded ? '▼' : '▶';
  }

  function renderSelectedWorkOrderSummary() {
    const canonical = selectedWorkOrder?.canonicalWorkOrder || {};
    const relatedRows = getRelatedWorkOrderRows();

    setText('workOrderDashboardSummaryWorkOrder', selectedWorkOrder?.workOrderNumber || 'None selected');
    setText('workOrderDashboardSummaryAssembly', cleanCanonicalText(canonical.itemNumber) || 'N/A');
    setText('workOrderDashboardSummaryRevision',
      cleanCanonicalText(canonical.drawingRevision || canonical.bomRevision) || 'Unknown');
    setText('workOrderDashboardSummaryQuantity', selectedWorkOrder
      ? formatQuantity(parseQuantity(canonical.schProdQuantity))
      : '0');
    setText('workOrderDashboardSummaryDueDate', selectedWorkOrder?.originDueDate || getNextDueDate(relatedRows) || 'N/A');
    setText('workOrderDashboardSummaryStatus', cleanCanonicalText(canonical.workOrderStatus) || 'N/A');
    setText('workOrderDashboardCanonicalAnchor', selectedWorkOrder
      ? formatSalesOrderLine(selectedWorkOrder.canonicalSalesOrderNumber, selectedWorkOrder.canonicalAnchorLine)
      : 'N/A');
    setText('workOrderDashboardOpenedFrom', selectedWorkOrder
      ? formatSalesOrderLine(selectedWorkOrder.originSalesOrderNumber, selectedWorkOrder.originSalesOrderLine)
      : 'N/A');
    setText('workOrderDashboardGoverningSource', getGoverningSourceLabel(selectedWorkOrder?.governingSource));
  }

  function renderRelatedWorkOrders() {
    const rows = document.getElementById('workOrderDashboardRelatedRows');
    if (!rows) return;

    const relatedRows = getRelatedWorkOrderRows();
    if (!relatedRows.length) {
      rows.innerHTML = '<tr><td class="work-order-dashboard-module-empty" colspan="6">Select a Work Order from Sales Order Dashboard.</td></tr>';
      return;
    }

    rows.innerHTML = relatedRows.map((row, index) => {
      const official = row.official || {};
      const rowClass = [
        index % 2 === 0 ? 'rowEven' : 'rowOdd',
        isSelectedRelease(row) ? 'selected-release' : ''
      ].filter(Boolean).join(' ');

      return [
        '<tr class="',
        escapeDashboardHtml(rowClass),
        '">',
        '<td>',
        escapeDashboardHtml(official.workOrder || 'Unknown'),
        '</td>',
        '<td>',
        escapeDashboardHtml(official.partNumber || 'N/A'),
        '</td>',
        '<td>',
        escapeDashboardHtml(getRecordRevision(row) || 'Unknown'),
        '</td>',
        '<td>',
        escapeDashboardHtml(official.opQtyOpen || '0'),
        '</td>',
        '<td>',
        escapeDashboardHtml(official.dueDate || 'N/A'),
        '</td>',
        '<td>',
        renderOperationalStatus(official.operationalStatus, 'work-order-dashboard-module-status-pill'),
        '</td>',
        '</tr>'
      ].join('');
    }).join('');
  }

  function getRelatedWorkOrderRows() {
    if (!selectedWorkOrder) return [];

    const workOrder = normalizeWorkOrder(selectedWorkOrder.workOrderNumber);
    if (!workOrder) return [];

    const records = window.OperationsCenter?.viewModel?.getMasterRecords?.();
    const officialColumns = window.OperationsCenter?.officialColumns || [];
    const matches = Array.isArray(records) && records.length && officialColumns.length
      ? records
          .filter(record => normalizeWorkOrder(window.OperationsCenter.viewModel.getOfficialField(record, 'workOrder')) === workOrder)
          .map(record => buildRelatedRow(record, officialColumns))
      : [];
    const origin = buildOriginReleaseRow(selectedWorkOrder);
    const combined = origin ? [origin, ...matches] : matches;
    const seen = new Set();
    return combined.filter(row => {
      const key = String(row.masterRecordKey || '');
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    });
  }

  function buildOriginReleaseRow(handoff) {
    const row = handoff?.originRow;
    if (!row) return null;
    const official = { ...(row.official || {}) };
    official.workOrder = handoff.workOrderNumber;
    return {
      ...row,
      official,
      governedOrigin: true
    };
  }

  function buildRelatedRow(record, officialColumns) {
    const viewModel = window.OperationsCenter.viewModel;
    const masterRecordKey = viewModel.getMasterRecordKey(record);
    const official = officialColumns.reduce((fields, column) => {
      fields[column.key] = viewModel.getOfficialField(record, column.key);
      return fields;
    }, {});
    const overlay = window.OperationsCenter?.stateActions?.getOverlayRecord?.(masterRecordKey) || {};

    return {
      masterRecordKey,
      official,
      overlay: { ...overlay },
      masterRecord: cloneRecord(record)
    };
  }

  function isSelectedRelease(row) {
    return String(row?.masterRecordKey || '') === String(selectedWorkOrder?.originRow?.masterRecordKey || '');
  }

  function cleanCanonicalText(value) {
    return String(value ?? '').trim();
  }

  function formatSalesOrderLine(salesOrder, line) {
    const order = cleanCanonicalText(salesOrder);
    const sequence = cleanCanonicalText(line);
    return order && sequence ? 'SO ' + order + ' · Line ' + sequence : 'N/A';
  }

  function getGoverningSourceLabel(source) {
    if (source === 'APPROVAL') return 'Approved Work Order';
    if (source === 'EXACT') return 'ERP-confirmed exact relationship';
    return 'N/A';
  }

  function sumOpenQuantity(rows) {
    return rows.reduce((total, row) => total + parseQuantity(row?.official?.opQtyOpen), 0);
  }

  function parseQuantity(value) {
    const cleaned = String(value ?? '').replace(/,/g, '').trim();
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatQuantity(value) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function getNextDueDate(rows) {
    const candidates = rows
      .map(row => {
        const value = String(row?.official?.dueDate || '').trim();
        const time = parseDueDateTime(value);
        return { value, time };
      })
      .filter(candidate => candidate.value && Number.isFinite(candidate.time))
      .sort((a, b) => a.time - b.time);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const upcoming = candidates.find(candidate => candidate.time >= startOfToday.getTime());

    return upcoming?.value || candidates[0]?.value || '';
  }

  function parseDueDateTime(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return NaN;

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;

    const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!match) return NaN;

    const month = Number(match[1]) - 1;
    const day = Number(match[2]);
    const yearValue = Number(match[3]);
    const year = yearValue < 100 ? 2000 + yearValue : yearValue;
    const date = new Date(year, month, day);
    return date.getTime();
  }

  function normalizeWorkOrder(value) {
    return String(value ?? '').trim().toUpperCase();
  }

  function getRecordRevision(row) {
    return row?.official?.revision
      || row?.masterRecord?.vpro5?.revision
      || row?.masterRecord?.dle?.revision
      || row?.masterRecord?.revision
      || '';
  }

  function cloneRecord(record) {
    try {
      return structuredClone(record);
    } catch (error) {
      return JSON.parse(JSON.stringify(record || {}));
    }
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setOperationalStatus(id, value) {
    const element = document.getElementById(id);
    if (!element) return;

    const presentation = getOperationalStatusPresentation(value);
    element.textContent = presentation.label || 'N/A';
    element.classList.toggle('dle-operational-status-badge', presentation.isPacking);
    element.classList.toggle('dle-operational-status-packing', presentation.isPacking);
  }

  function renderOperationalStatus(value, baseClass) {
    const presentation = getOperationalStatusPresentation(value);
    const classes = [baseClass, presentation.className].filter(Boolean).join(' ');
    return '<span class="' + classes + '">' + escapeDashboardHtml(presentation.label || 'N/A') + '</span>';
  }

  function getOperationalStatusPresentation(value) {
    if (typeof window.OperationsCenter?.viewModel?.getOperationalStatusPresentation === 'function') {
      return window.OperationsCenter.viewModel.getOperationalStatusPresentation(value);
    }

    const status = String(value ?? '').trim();
    const isPacking = status.toLowerCase() === 'packing';
    return {
      label: isPacking ? '\u{1F7E8} Packing' : status,
      isPacking,
      className: isPacking
        ? 'dle-operational-status-badge dle-operational-status-packing'
        : ''
    };
  }

  function escapeDashboardHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  window.WorkOrderDashboardModule.loadModule = loadWorkOrderDashboardModule;
  window.WorkOrderDashboardModule.initialize = initializeWorkOrderDashboardModule;
  window.WorkOrderDashboardModule.setSelectedWorkOrder = setSelectedWorkOrder;
  window.WorkOrderDashboardModule.getSelectedHandoff = () => selectedWorkOrder;
  window.WorkOrderDashboardModule.setView = setDashboardView;
  window.WorkOrderDashboardModule.toggleScheduledReleases = toggleScheduledReleases;
  window.WorkOrderDashboardModule.render = renderWorkOrderDashboardModule;

  window.loadWorkOrderDashboardModule = loadWorkOrderDashboardModule;
  window.initializeWorkOrderDashboardModule = initializeWorkOrderDashboardModule;
  window.setWorkOrderDashboardModuleSelectedWorkOrder = setSelectedWorkOrder;
  window.setWorkOrderDashboardModuleView = setDashboardView;
  window.toggleWorkOrderDashboardScheduledReleases = toggleScheduledReleases;
  window.renderWorkOrderDashboardModule = renderWorkOrderDashboardModule;
})();

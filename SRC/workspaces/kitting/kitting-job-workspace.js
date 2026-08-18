(function registerKittingJobWorkspace(window, document) {
  'use strict';

  const TEMPLATE_PATH = 'SRC/workspaces/kitting/kitting-job-workspace.html';
  const RELEASED_BOM_RETURN_PARAMETER = 'dleKittingReportReturn';
  const RELEASED_BOM_RETURN_STORAGE_PREFIX = 'dle-os:kitting-released-bom:return:';
  const originalLocations = new Map();
  let activePrimaryTool = null;
  let coordinatingPrimaryTools = false;
  let pendingNavigation = null;
  let navigationResolutionBusy = false;
  const primaryIds = [
    'workOrderDashboardReleasedBom',
    'workOrderDashboardKitReleasedBom',
    'workOrderDashboardKittingCaseSummary',
    'workOrderDashboardKittedBomPlaceholder',
    'workOrderDashboardKittedBomEvidence'
  ];

  async function loadKittingJobWorkspace() {
    const placeholder = document.getElementById('kittingJobWorkspace');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;
    const response = await fetch(TEMPLATE_PATH, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load Kitting Job Workspace.');
    placeholder.outerHTML = await response.text();
  }

  function initializeKittingJobWorkspace() {
    rememberOriginalLocations();
    const workspace = document.getElementById('kittingJobWorkspace');
    if (workspace && workspace.dataset.reportAuthorizationBound !== 'true') {
      workspace.dataset.reportAuthorizationBound = 'true';
      document.addEventListener('dle:capabilities-ready', event => applyReportVisibility(event.detail));
    }
    if (workspace && workspace.dataset.focusedLayoutBound !== 'true') {
      workspace.dataset.focusedLayoutBound = 'true';
      window.addEventListener('resize', updateFocusedModeLayout);
    }
    bindNavigationGuard();
    applyReportVisibility();
  }

  function bindNavigationGuard() {
    const dialog = document.getElementById('kittingNavigationGuard');
    if (!dialog || dialog.dataset.bound === 'true') return;
    dialog.dataset.bound = 'true';
    dialog.querySelectorAll('[data-kitting-navigation-choice]').forEach(button => {
      button.addEventListener('click', () => resolveKittingNavigation(button.dataset.kittingNavigationChoice));
    });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      cancelKittingNavigation();
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) cancelKittingNavigation();
    });
  }

  function requestKittingNavigation(action) {
    if (typeof action !== 'function' ||
        window.WorkOrderDashboardModule?.isActiveKittingEditing?.() !== true) return false;
    if (pendingNavigation) return true;
    const dialog = document.getElementById('kittingNavigationGuard');
    if (!dialog?.showModal) return false;
    pendingNavigation = action;
    window.WorkOrderDashboardModule.pauseActiveKittingAutosaveForNavigation?.();
    setNavigationGuardError('');
    setNavigationGuardBusy(false);
    dialog.showModal();
    dialog.querySelector('[data-kitting-navigation-choice="save"]')?.focus();
    return true;
  }

  function cancelKittingNavigation() {
    if (navigationResolutionBusy || !pendingNavigation) return false;
    pendingNavigation = null;
    window.WorkOrderDashboardModule?.resumeActiveKittingAutosaveAfterNavigationCancel?.();
    const dialog = document.getElementById('kittingNavigationGuard');
    if (dialog?.open) dialog.close();
    return true;
  }

  async function resolveKittingNavigation(choice) {
    if (choice === 'cancel') return cancelKittingNavigation();
    if (navigationResolutionBusy || !pendingNavigation || !['save', 'leave'].includes(choice)) return false;
    navigationResolutionBusy = true;
    setNavigationGuardBusy(true);
    setNavigationGuardError('');
    const module = window.WorkOrderDashboardModule;
    const completed = choice === 'save'
      ? await module?.saveAndExitActiveKitting?.()
      : await module?.abandonActiveKittingWithoutSaving?.();
    if (!completed) {
      navigationResolutionBusy = false;
      setNavigationGuardBusy(false);
      setNavigationGuardError(module?.getActiveKittingSaveState?.() ||
        'Unable to leave Kitting. Stay here and try again.');
      return false;
    }
    const navigate = pendingNavigation;
    pendingNavigation = null;
    const dialog = document.getElementById('kittingNavigationGuard');
    if (dialog?.open) dialog.close();
    navigationResolutionBusy = false;
    setNavigationGuardBusy(false);
    await Promise.resolve().then(navigate);
    return true;
  }

  function setNavigationGuardBusy(busy) {
    const dialog = document.getElementById('kittingNavigationGuard');
    dialog?.querySelectorAll('[data-kitting-navigation-choice]').forEach(button => {
      button.disabled = busy;
    });
  }

  function setNavigationGuardError(message) {
    const error = document.getElementById('kittingNavigationGuardError');
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  }

  function rememberOriginalLocations() {
    [...primaryIds, 'workOrderDashboardActiveKitting'].forEach(remember);
    rememberSection('[data-work-order-dashboard-section="kitting-workspace"]', 'legacyKittingWorkspaceSection');
  }

  function remember(id) {
    const node = document.getElementById(id);
    if (node && !originalLocations.has(id)) {
      originalLocations.set(id, { node, parent: node.parentNode, next: node.nextSibling });
    }
  }

  function rememberSection(selector, key) {
    const node = document.querySelector(selector);
    if (node && !originalLocations.has(key)) {
      originalLocations.set(key, { node, parent: node.parentNode, next: node.nextSibling });
    }
  }

  function setPresentationMode(mode) {
    rememberOriginalLocations();
    if (mode === 'kitting-job') mountDedicatedSurface();
    else restoreDashboardSurface();
  }

  function mountDedicatedSurface() {
    const actions = document.getElementById('kittingJobPrimaryActions');
    const releasedBom = document.getElementById('kittingJobReleasedBomReport');
    const active = document.getElementById('kittingJobActiveCase');
    const documents = document.getElementById('kittingJobDocumentHistory');
    const development = document.getElementById('kittingJobDevelopmentHistory');
    const disposition = document.getElementById('kittingJobDispositionHistory');
    if (!actions || !releasedBom || !active || !documents || !development || !disposition) return;
    prependById(actions, 'workOrderDashboardKitReleasedBom');
    appendById(releasedBom, 'workOrderDashboardReleasedBom');
    primaryIds.slice(3).forEach(id => appendById(documents, id));
    appendById(active, 'workOrderDashboardActiveKitting');
    const legacy = originalLocations.get('legacyKittingWorkspaceSection')?.node;
    if (legacy) disposition.appendChild(legacy);
    applyReportVisibility();
  }

  function canViewDevelopmentReports(capabilities = window.DleOsCapabilities) {
    return window.DleOsRuntimeConfig?.environment === 'ISOLATED_DEVELOPMENT' &&
      capabilities?.isSuperAdmin === true;
  }

  function applyReportVisibility(capabilities = window.DleOsCapabilities) {
    const development = document.getElementById('kittingJobDevelopmentReports');
    if (!development) return false;
    const visible = canViewDevelopmentReports(capabilities);
    development.hidden = !visible;
    if (!visible) development.open = false;
    return visible;
  }

  function closeReportsPanel() {
    const reports = document.getElementById('kittingJobReports');
    const toggle = document.getElementById('kittingJobReportsToggle');
    if (reports) reports.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function closePrintLabelsPanel() {
    const menu = document.querySelector('#kittingJobWorkspace .kitting-job-action-slot .kitting-label-menu');
    if (menu) menu.open = false;
  }

  function updatePrimaryToolPresentation() {
    const workspace = document.getElementById('kittingJobWorkspace');
    const kitting = document.getElementById('workOrderDashboardKitReleasedBom');
    const reports = document.getElementById('kittingJobReportsToggle');
    const printMenu = document.querySelector('#kittingJobWorkspace .kitting-job-action-slot .kitting-label-menu');
    const printSummary = printMenu?.querySelector('summary');
    if (workspace) workspace.dataset.activePrimaryTool = activePrimaryTool || '';
    if (workspace) workspace.classList.toggle('is-focused-kitting', activePrimaryTool === 'kitting');
    [[kitting, 'kitting'], [reports, 'reports'], [printMenu, 'print-labels']].forEach(([control, tool]) => {
      control?.classList.toggle('is-active', activePrimaryTool === tool);
    });
    if (kitting) kitting.setAttribute('aria-pressed', String(activePrimaryTool === 'kitting'));
    if (printSummary) printSummary.setAttribute('aria-expanded', String(activePrimaryTool === 'print-labels'));
    updateFocusedModeLayout();
  }

  function updateFocusedModeLayout() {
    const workspace = document.getElementById('kittingJobWorkspace');
    if (!workspace?.classList.contains('is-focused-kitting')) return false;
    const globalHeader = document.querySelector('body > header.dle-app-header');
    const stickyTop = Math.max(0, Math.ceil(globalHeader?.getBoundingClientRect?.().height || 0));
    workspace.style?.setProperty('--kitting-focused-sticky-top', stickyTop + 'px');
    return true;
  }

  function refreshPrimaryToolPresentation() {
    const printMenu = document.querySelector('#kittingJobWorkspace .kitting-job-action-slot .kitting-label-menu');
    if (activePrimaryTool === 'print-labels' && printMenu) printMenu.open = true;
    updatePrimaryToolPresentation();
    return activePrimaryTool;
  }

  function setPrimaryTool(tool, open = true) {
    if (!['kitting', 'print-labels', 'reports'].includes(tool)) return activePrimaryTool;
    if (open && activePrimaryTool === 'kitting' && tool !== 'kitting') {
      closeReportsPanel();
      closePrintLabelsPanel();
      updatePrimaryToolPresentation();
      return activePrimaryTool;
    }
    if (coordinatingPrimaryTools) {
      if (!open && activePrimaryTool === tool) activePrimaryTool = null;
      return activePrimaryTool;
    }
    coordinatingPrimaryTools = true;
    try {
      if (open) {
        if (tool !== 'reports') closeReportsPanel();
        if (tool !== 'print-labels') closePrintLabelsPanel();
        if (tool === 'print-labels') {
          const currentMenu = document.querySelector('#kittingJobWorkspace .kitting-job-action-slot .kitting-label-menu');
          if (currentMenu) currentMenu.open = true;
        }
        activePrimaryTool = tool;
      } else if (activePrimaryTool === tool) {
        activePrimaryTool = null;
      }
      updatePrimaryToolPresentation();
      return activePrimaryTool;
    } finally {
      coordinatingPrimaryTools = false;
    }
  }

  function handlePrintLabelsToggle(menu) {
    if (!menu?.closest('#kittingJobWorkspace')) return false;
    setPrimaryTool('print-labels', menu.open);
    return menu.open;
  }

  function toggleReports(forceOpen) {
    const reports = document.getElementById('kittingJobReports');
    const toggle = document.getElementById('kittingJobReportsToggle');
    if (!reports || !toggle) return false;
    const open = typeof forceOpen === 'boolean' ? forceOpen : reports.hidden;
    const selectedTool = setPrimaryTool('reports', open);
    const reportsOpen = open && selectedTool === 'reports';
    reports.hidden = !reportsOpen;
    toggle.setAttribute('aria-expanded', String(reportsOpen));
    if (reportsOpen) reports.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return reportsOpen;
  }

  function appendById(parent, id) {
    const node = originalLocations.get(id)?.node || document.getElementById(id);
    if (node) parent.appendChild(node);
  }

  function prependById(parent, id) {
    const node = originalLocations.get(id)?.node || document.getElementById(id);
    if (node) parent.prepend(node);
  }

  function restoreDashboardSurface() {
    Array.from(originalLocations.values()).forEach(location => {
      if (!location.parent?.isConnected || !location.node) return;
      if (location.next?.parentNode === location.parent) location.parent.insertBefore(location.node, location.next);
      else location.parent.appendChild(location.node);
    });
  }

  function open(handoff) {
    if (!handoff || typeof window.WorkOrderDashboardModule?.setSelectedWorkOrder !== 'function' || typeof window.go !== 'function') {
      return false;
    }
    window.DleWorkspaceShell?.setWorkspaceView?.('kitting');
    window.WorkOrderDashboardModule.setSelectedWorkOrder({ ...handoff, preferredPresentation: 'kitting-job' });
    window.go('kittingJobWorkspace');
    activePrimaryTool = null;
    closePrintLabelsPanel();
    toggleReports(false);
    return true;
  }

  function createReleasedBomReturnPath(handoff) {
    const fallback = window.location.pathname + window.location.search + window.location.hash;
    if (!handoff) return fallback;
    const token = window.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    try {
      window.sessionStorage.setItem(RELEASED_BOM_RETURN_STORAGE_PREFIX + token, JSON.stringify(handoff));
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set(RELEASED_BOM_RETURN_PARAMETER, token);
      return returnUrl.pathname + returnUrl.search + returnUrl.hash;
    } catch (_error) {
      return fallback;
    }
  }

  function restoreReleasedBomReturn() {
    const returnUrl = new URL(window.location.href);
    const token = returnUrl.searchParams.get(RELEASED_BOM_RETURN_PARAMETER);
    if (!token) return false;
    returnUrl.searchParams.delete(RELEASED_BOM_RETURN_PARAMETER);
    window.history.replaceState(null, '', returnUrl.pathname + returnUrl.search + returnUrl.hash);
    let handoff = null;
    try {
      const storageKey = RELEASED_BOM_RETURN_STORAGE_PREFIX + token;
      handoff = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null');
      window.sessionStorage.removeItem(storageKey);
    } catch (_error) {
      handoff = null;
    }
    return handoff ? open(handoff) : false;
  }

  function render(payload) {
    const selection = payload?.selection || null;
    if (!selection) return;
    const canonical = selection.canonicalWorkOrder || {};
    setText('kittingJobWorkOrder', clean(selection.workOrderNumber || selection.official?.workOrder) || 'Work Order');
    const item = clean(selection.itemNumber || canonical.itemNumber || selection.official?.partNumber) || 'Assembly not selected';
    const revision = clean(canonical.drawingRevision || canonical.bomRevision || canonical.revision || canonical.revisionLevel || selection.revision);
    setText('kittingJobAssembly', item + (revision ? ' Rev ' + revision : ''));
    setText('kittingJobQuantity', formatQuantity(selection.workOrderQuantity ?? canonical.schProdQuantity ?? selection.originQuantity));
    setText('kittingJobDueDate', formatKittingJobDueDate(selection.originDueDate || selection.official?.dueDate));
    setText('kittingJobCustomer', clean(selection.originCustomerName || selection.official?.customer) || 'N/A');
    setText('kittingJobSalesOrder', formatSalesOrder(selection));
    setText('kittingJobCustomerPo', clean(selection.originCustomerPurchaseOrderNumber || canonical.customerPurchaseOrderNumber || selection.official?.customerPo) || 'N/A');
    setText('kittingJobCanonicalAnchor', formatCanonicalAnchor(selection));
    setText('kittingJobRelationship', clean(selection.relationshipStatus) || 'N/A');
    setText('kittingJobGoverningSource', clean(selection.governingSource) || 'N/A');
    const materialStatus = materialStatusLabel(payload.materialStatus || selection.materialStatusProjection || selection.materialStatus);
    setText('kittingJobMaterialStatus', materialStatus);
    const badge = document.getElementById('kittingJobMaterialStatus');
    if (badge) badge.dataset.status = normalizeStatus(payload.materialStatus || selection.materialStatusProjection || selection.materialStatus);
    renderRelatedRows(payload.relatedRows || selection.relatedRows || []);
  }

  function renderRelatedRows(rows) {
    setText('kittingJobReleaseCount', String(rows.length));
    const body = document.getElementById('kittingJobRelatedRows');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6">No scheduled releases loaded.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(row => {
      const official = row.official || row;
      const master = row.masterRecord || {};
      return '<tr><td>' + escapeHtml(official.workOrder || '') + '</td><td>' + escapeHtml(official.partNumber || '') +
        '</td><td>' + escapeHtml(official.revision || master.vpro5?.revision || master.dle?.revision || master.revision || master.revisionLevel || '') + '</td><td>' +
        escapeHtml(official.opQtyOpen || official.quantityOrdered || '') + '</td><td>' + escapeHtml(formatKittingJobDueDate(official.dueDate, '')) +
        '</td><td>' + escapeHtml(official.operationalStatus || official.status || master.status || master.workOrderStatus || '') + '</td></tr>';
    }).join('');
  }

  function returnToQueue() {
    return window.WorkOrderDashboardModule?.returnToKitting?.() || false;
  }

  function formatSalesOrder(selection) {
    const salesOrder = clean(selection.originSalesOrderNumber || selection.official?.salesOrder);
    const line = clean(selection.originSalesOrderLine || selection.official?.sequenceLine);
    return salesOrder ? salesOrder + (line ? ' / ' + line : '') : 'N/A';
  }

  function formatCanonicalAnchor(selection) {
    const customer = clean(selection.canonicalCustomerNumber);
    const salesOrder = clean(selection.canonicalSalesOrderNumber);
    const line = clean(selection.canonicalAnchorLine);
    return [customer, salesOrder, line].filter(Boolean).join(' / ') || 'N/A';
  }

  function normalizeStatus(value) {
    return clean(value?.machineValue || value?.materialStatus || value?.status || value?.label || value).toUpperCase().replace(/\s+/g, '_');
  }

  function materialStatusLabel(value) {
    const status = normalizeStatus(value);
    return ({ NEEDS_KITTING: 'NEW', KITTING_IN_PROGRESS: 'IN PROGRESS', KIT_SHORT: 'KIT SHORT', KIT_COMPLETE: 'KIT COMPLETE' })[status] || status.replace(/_/g, ' ') || 'NEW';
  }

  function formatKittingJobDueDate(value, fallback = 'N/A') {
    const text = clean(value);
    if (!text) return fallback;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text;
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const isValid = parsed.getUTCFullYear() === Number(match[1]) &&
      parsed.getUTCMonth() === Number(match[2]) - 1 && parsed.getUTCDate() === Number(match[3]);
    return isValid ? `${match[2]}/${match[3]}/${match[1]}` : text;
  }

  function formatQuantity(value) {
    const quantity = Number(value);
    return Number.isFinite(quantity) ? String(quantity) : '0';
  }

  function setText(id, value) {
    const target = document.getElementById(id);
    if (target) target.textContent = value;
  }

  function clean(value) { return String(value ?? '').trim(); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  window.KittingJobWorkspace = Object.freeze({
    open, render, setPresentationMode, returnToQueue, toggleReports,
    applyReportVisibility, canViewDevelopmentReports, setPrimaryTool, handlePrintLabelsToggle,
    refreshPrimaryToolPresentation, updateFocusedModeLayout,
    createReleasedBomReturnPath, restoreReleasedBomReturn
  });
  window.DleOsKittingNavigationGuard = Object.freeze({ request: requestKittingNavigation });
  window.loadKittingJobWorkspace = loadKittingJobWorkspace;
  window.initializeKittingJobWorkspace = initializeKittingJobWorkspace;
  window.returnToKittingJobQueue = returnToQueue;
  window.toggleKittingJobReports = toggleReports;
  window.handleKittingJobPrintLabelsToggle = handlePrintLabelsToggle;
})(window, document);

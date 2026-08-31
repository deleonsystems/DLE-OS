(function registerPurchasingWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "purchasing";
  const TEMPLATE_PATH = "SRC/workspaces/purchasing/purchasing-workspace.html";
  const JOB_WORKSPACE_MODULE_PATH = "SRC/workspaces/purchasing/purchasing-job-workspace.js";
  const state = { loading: false, model: null, rowsByKey: new Map(), loadError: "" };
  let jobWorkspaceModulePromise = null;

  async function renderPurchasingWorkspace() {
    const mount = ensureMount();
    if (!mount) return;
    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Purchasing Workspace</h3><p>Preparing governed material shortages...</p></div>';
      try {
        const response = await fetch(TEMPLATE_PATH, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("Purchasing workspace template returned HTTP " + response.status + ".");
        mount.innerHTML = await response.text();
        mount.dataset.workspaceLoaded = "true";
        bindInteractions(mount);
      } catch (error) {
        mount.dataset.workspaceLoaded = "false";
        mount.innerHTML = '<div class="workspace-dashboard-card" role="alert"><h3>Purchasing Workspace unavailable</h3><p>' +
          escapeHtml(error?.message || "The workspace template could not be loaded.") + '</p></div>';
        return;
      }
    }
    if (state.model) return renderQueue();
    await refreshPurchasingWorkspace();
  }

  function ensureMount() {
    let mount = document.querySelector('[data-workspace-mount="purchasing"]');
    if (mount) return mount;
    const panel = document.querySelector('[data-workspace-home="purchasing"]');
    if (!panel) return null;
    panel.innerHTML = '<div data-workspace-mount="purchasing"></div>';
    return panel.querySelector('[data-workspace-mount="purchasing"]');
  }

  function bindInteractions(mount) {
    if (mount.dataset.purchasingInteractionsBound === "true") return;
    mount.dataset.purchasingInteractionsBound = "true";
    mount.querySelector("#purchasingWorkspaceSearch")?.addEventListener("input", renderQueue);
    mount.querySelector("#purchasingWorkspaceRefresh")?.addEventListener("click", () => {
      void refreshPurchasingWorkspace({ forceMaterialStatus: true });
    });
    mount.addEventListener("click", event => {
      const rowElement = event.target?.closest?.("[data-purchasing-queue-key]");
      if (rowElement) void openShortageDetail(state.rowsByKey.get(rowElement.dataset.purchasingQueueKey));
    });
  }

  async function refreshPurchasingWorkspace(options = {}) {
    if (state.loading) return state.model;
    state.loading = true;
    state.loadError = "";
    setRefreshState(true);
    setStatus("Loading governed material shortages", "");
    try {
      const loader = window.DleWorkspaces?.kitting?.loadReadModel;
      if (typeof loader !== "function") throw new Error("The governed Kitting read model is unavailable.");
      state.model = await loader({ forceMaterialStatus: options.forceMaterialStatus === true });
      if (!state.model?.queues) throw new Error("The governed Kitting read model returned no queues.");
      renderQueue();
      setStatus("Purchasing queues current", "ready");
      return state.model;
    } catch (error) {
      state.model = null;
      state.loadError = error?.message || "Purchasing shortages could not be loaded.";
      renderFailure(state.loadError);
      setStatus("Purchasing data unavailable", "error");
      return null;
    } finally {
      state.loading = false;
      setRefreshState(false);
    }
  }

  function buildViewModel(model, searchTerm = "") {
    return Object.freeze({ materialShortages: Object.freeze(filterRows(model?.queues?.kitShort, searchTerm)) });
  }

  function filterRows(rows, searchTerm) {
    const search = cleanText(searchTerm).toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(row => {
      if (!search) return true;
      return [
        row.workOrderNumber, row.customerNumber, row.customerName, row.assemblyItemNumber, row.revision,
        row.materialStatusLabel, row.canonicalWorkOrder?.customerPurchaseOrderNumber,
        ...(row.relatedLines || []).flatMap(line => [
          line.salesOrderNumber, line.itemNumber, line.customerPurchaseOrderNumber
        ])
      ].join(" ").toLowerCase().includes(search);
    });
  }

  function renderQueue() {
    if (!state.model) return;
    const search = document.getElementById("purchasingWorkspaceSearch")?.value || "";
    const rows = buildViewModel(state.model, search).materialShortages;
    state.rowsByKey = new Map(rows.map(row => [cleanText(row.queueKey), row]));
    renderRows(rows, search ? "No material-shortage jobs match this search." :
      "No work orders are currently Kit Short.");
  }

  function renderRows(rows, emptyMessage) {
    const target = document.getElementById("purchasingSelectedJobs");
    if (!target) return;
    target.innerHTML = rows.length
      ? '<div class="production-compact-list">' + rows.map(renderRow).join("") + '</div>'
      : '<p class="production-queue-empty">' + escapeHtml(emptyMessage) + '</p>';
  }

  function renderRow(row) {
    const customer = [row.customerNumber, row.customerName].filter(Boolean).join(" \u00b7 ") || "N/A";
    const quantity = row.canonicalWorkOrderQuantity === null || row.canonicalWorkOrderQuantity === undefined
      ? "N/A" : formatQuantity(row.canonicalWorkOrderQuantity);
    return [
      '<button type="button" class="production-compact-row" data-purchasing-queue-key="',
      escapeHtml(row.queueKey), '" aria-label="Open shortage detail for Work Order ', escapeHtml(row.workOrderNumber), '">',
      '<span class="production-compact-wo">WO ', escapeHtml(row.workOrderNumber), '</span>',
      '<span class="production-compact-assembly"><strong>', escapeHtml(row.assemblyItemNumber || "N/A"),
      '</strong><small>Rev ', escapeHtml(row.revision || "N/A"), '</small></span>',
      '<span class="production-compact-metric production-compact-quantity"><small>QTY</small><strong>',
      escapeHtml(quantity), '</strong></span>',
      '<span class="production-compact-metric production-compact-due"><small>DUE</small><strong>',
      escapeHtml(formatDueDate(row.earliestDueDate)), '</strong></span>',
      '<span class="production-compact-customer">', escapeHtml(customer), '</span>',
      '<span class="production-compact-state">KIT SHORT</span>',
      '<span class="production-compact-arrow" aria-hidden="true">→</span>',
      '</button>'
    ].join("");
  }

  async function openShortageDetail(row) {
    if (!row?.actionable || !row.workOrderNumber || !row.canonicalWorkOrder) return false;
    const controller = await ensureJobWorkspaceModule();
    if (typeof controller?.open !== "function") return false;
    return controller.open(row);
  }

  async function ensureJobWorkspaceModule() {
    if (window.PurchasingJobWorkspace?.open) return window.PurchasingJobWorkspace;
    if (!jobWorkspaceModulePromise) {
      jobWorkspaceModulePromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = JOB_WORKSPACE_MODULE_PATH;
        script.dataset.purchasingJobWorkspaceModule = "true";
        script.onload = () => resolve(window.PurchasingJobWorkspace);
        script.onerror = () => reject(new Error("Unable to load Purchasing Job Workspace."));
        document.head.appendChild(script);
      }).catch(error => {
        jobWorkspaceModulePromise = null;
        throw error;
      });
    }
    return jobWorkspaceModulePromise;
  }

  function renderFailure(message) {
    const target = document.getElementById("purchasingSelectedJobs");
    if (target) target.innerHTML = '<p class="production-queue-empty">' + escapeHtml(message) + '</p>';
  }

  function setRefreshState(loading) {
    const button = document.getElementById("purchasingWorkspaceRefresh");
    if (!button) return;
    button.disabled = loading;
    button.textContent = loading ? "Refreshing..." : "↻ Refresh Queue";
  }

  function setStatus(message, status) {
    const target = document.getElementById("purchasingWorkspaceStatus");
    if (!target) return;
    target.textContent = message;
    target.dataset.state = status || "";
  }

  function formatQuantity(value) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity)) return "N/A";
    return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(2)));
  }

  function formatDueDate(value) {
    const text = cleanText(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    return match ? `${match[2]}/${match[3]}/${match[1]}` : text || "N/A";
  }

  function cleanText(value) { return String(value ?? "").trim(); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: renderPurchasingWorkspace,
    refresh: refreshPurchasingWorkspace,
    buildViewModel,
    openShortageDetail,
    getModel: () => state.model
  });
})(window, document);

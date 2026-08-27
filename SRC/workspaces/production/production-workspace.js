(function registerProductionWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "production";
  const TEMPLATE_PATH = "SRC/workspaces/production/production-workspace.html";
  const QUEUES = Object.freeze({
    KIT_COMPLETE: Object.freeze({
      rowsKey: "kitComplete",
      title: "Kit Complete",
      description: "Primary Production queue for work orders with complete kits.",
      empty: "No work orders are currently Kit Complete."
    }),
    KIT_SHORT: Object.freeze({
      rowsKey: "kitShort",
      title: "Kit Short / Awaiting Parts",
      description: "Secondary visibility queue for work orders awaiting required material.",
      empty: "No work orders are currently Kit Short."
    })
  });
  const state = {
    loading: false,
    model: null,
    rowsByKey: new Map(),
    loadError: "",
    selectedQueue: "KIT_COMPLETE"
  };

  async function renderProductionWorkspace() {
    const mount = ensureMount();
    if (!mount) return;
    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Production Workspace</h3><p>Preparing governed job queues...</p></div>';
      try {
        const response = await fetch(TEMPLATE_PATH, {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) throw new Error("Production workspace template returned HTTP " + response.status + ".");
        mount.innerHTML = await response.text();
        mount.dataset.workspaceLoaded = "true";
        bindInteractions(mount);
      } catch (error) {
        mount.dataset.workspaceLoaded = "false";
        mount.innerHTML = '<div class="workspace-dashboard-card" role="alert"><h3>Production Workspace unavailable</h3><p>' +
          escapeHtml(error?.message || "The workspace template could not be loaded.") + '</p></div>';
        return;
      }
    }

    if (state.model) {
      renderQueues();
      return;
    }
    await refreshProductionWorkspace();
  }

  function ensureMount() {
    let mount = document.querySelector('[data-workspace-mount="production"]');
    if (mount) return mount;
    const panel = document.querySelector('[data-workspace-home="production"]');
    if (!panel) return null;
    panel.innerHTML = '<div data-workspace-mount="production"></div>';
    return panel.querySelector('[data-workspace-mount="production"]');
  }

  function bindInteractions(mount) {
    if (mount.dataset.productionInteractionsBound === "true") return;
    mount.dataset.productionInteractionsBound = "true";
    mount.querySelector("#productionWorkspaceSearch")?.addEventListener("input", renderQueues);
    mount.querySelector("#productionWorkspaceRefresh")?.addEventListener("click", () => {
      void refreshProductionWorkspace({ forceMaterialStatus: true });
    });
    mount.querySelectorAll("[data-production-queue]").forEach(button => {
      button.addEventListener("click", () => selectProductionQueue(button.dataset.productionQueue));
    });
    mount.addEventListener("click", event => {
      const rowElement = event.target?.closest?.("[data-production-queue-key]");
      if (rowElement) openWorkOrder(state.rowsByKey.get(rowElement.dataset.productionQueueKey));
    });
  }

  async function refreshProductionWorkspace(options = {}) {
    if (state.loading) return state.model;
    state.loading = true;
    state.loadError = "";
    setRefreshState(true);
    setStatus("Loading governed production queues", "");
    try {
      const loader = window.DleWorkspaces?.kitting?.loadReadModel;
      if (typeof loader !== "function") {
        throw new Error("The governed Kitting read model is unavailable.");
      }
      state.model = await loader({ forceMaterialStatus: options.forceMaterialStatus === true });
      if (!state.model?.queues) throw new Error("The governed Kitting read model returned no queues.");
      renderQueues();
      setStatus("Production queues current", "ready");
      return state.model;
    } catch (error) {
      state.model = null;
      state.loadError = error?.message || "Production queues could not be loaded.";
      renderQueueFailure(state.loadError);
      setStatus("Production data unavailable", "error");
      return null;
    } finally {
      state.loading = false;
      setRefreshState(false);
    }
  }

  function buildViewModel(model, searchTerm = "") {
    const queues = model?.queues || {};
    return Object.freeze({
      kitComplete: Object.freeze(filterRows(queues.kitComplete, searchTerm)),
      kitShort: Object.freeze(filterRows(queues.kitShort, searchTerm))
    });
  }

  function filterRows(rows, searchTerm) {
    const search = cleanText(searchTerm).toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(row => {
      if (!search) return true;
      return [
        row.workOrderNumber,
        row.customerNumber,
        row.customerName,
        row.assemblyItemNumber,
        row.revision,
        row.canonicalWorkOrder?.customerPurchaseOrderNumber,
        ...(row.relatedLines || []).flatMap(line => [
          line.salesOrderNumber,
          line.itemNumber,
          line.customerPurchaseOrderNumber
        ])
      ].join(" ").toLowerCase().includes(search);
    });
  }

  function renderQueues() {
    if (!state.model) return;
    const search = document.getElementById("productionWorkspaceSearch")?.value || "";
    const view = buildViewModel(state.model, search);
    state.rowsByKey = new Map([...view.kitComplete, ...view.kitShort]
      .map(row => [cleanText(row.queueKey), row]));
    setText("productionKitCompleteCount", view.kitComplete.length);
    setText("productionKitShortCount", view.kitShort.length);
    renderQueueTabs(search !== "");
    renderSelectedQueue(view, search);
  }

  function selectProductionQueue(queueKey) {
    if (!QUEUES[queueKey]) return false;
    state.selectedQueue = queueKey;
    renderQueues();
    return true;
  }

  function renderQueueTabs(searching) {
    document.querySelectorAll("[data-production-queue]").forEach(button => {
      const selected = button.dataset.productionQueue === state.selectedQueue;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.closest(".production-lifecycle-tabs")?.classList.toggle("searching", searching);
    });
  }

  function renderSelectedQueue(view, search) {
    const config = QUEUES[state.selectedQueue] || QUEUES.KIT_COMPLETE;
    const rows = view[config.rowsKey] || [];
    setText("productionSelectedQueueTitle", config.title);
    setText("productionSelectedQueueDescription", config.description);
    const emptyMessage = search ? `No ${config.title} jobs match this search.` : config.empty;
    renderRows(rows, emptyMessage);
  }

  function renderRows(rows, emptyMessage) {
    const target = document.getElementById("productionSelectedJobs");
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
      '<button type="button" class="production-compact-row" data-production-queue-key="',
      escapeHtml(row.queueKey), '" aria-label="Open Work Order ', escapeHtml(row.workOrderNumber), '">',
      '<span class="production-compact-wo">WO ', escapeHtml(row.workOrderNumber), '</span>',
      '<span class="production-compact-assembly"><strong>', escapeHtml(row.assemblyItemNumber || "N/A"),
      '</strong><small>Rev ', escapeHtml(row.revision || "N/A"), '</small></span>',
      '<span class="production-compact-metric production-compact-quantity"><small>QTY</small><strong>',
      escapeHtml(quantity), '</strong></span>',
      '<span class="production-compact-metric production-compact-due"><small>DUE</small><strong>',
      escapeHtml(formatDueDate(row.earliestDueDate)), '</strong></span>',
      '<span class="production-compact-customer">', escapeHtml(customer), '</span>',
      '<span class="production-compact-state">', escapeHtml(state.selectedQueue === "KIT_COMPLETE" ? "KIT COMPLETE" : "KIT SHORT"), '</span>',
      '<span class="production-compact-arrow" aria-hidden="true">→</span>',
      '</button>'
    ].join("");
  }

  function openWorkOrder(row) {
    if (!row?.actionable || !row.workOrderNumber || !row.canonicalWorkOrder) return false;
    const originLine = (row.relatedLines || []).find(line => Number(line.operationalQuantityOpen) > 0) ||
      row.relatedLines?.[0];
    const buildHandoff = window.DleWorkspaces?.kitting?.buildGovernedHandoff;
    if (!originLine || typeof buildHandoff !== "function" ||
        typeof window.WorkOrderDashboardModule?.setSelectedWorkOrder !== "function" ||
        typeof window.go !== "function") return false;
    const handoff = buildHandoff(row, originLine);
    window.WorkOrderDashboardModule.setSelectedWorkOrder({
      ...handoff,
      preferredDashboardView: "production",
      preferredPresentation: "dashboard",
      sourceWorkspaceId: WORKSPACE_ID,
      returnWorkspaceId: WORKSPACE_ID
    });
    window.DleWorkspaceShell?.setWorkspaceView?.(WORKSPACE_ID);
    window.go("workOrderDashboardModule");
    return true;
  }

  function renderQueueFailure(message) {
    const target = document.getElementById("productionSelectedJobs");
    if (target) target.innerHTML = '<p class="production-queue-empty">' + escapeHtml(message) + '</p>';
    setText("productionKitCompleteCount", 0);
    setText("productionKitShortCount", 0);
  }

  function setRefreshState(loading) {
    const button = document.getElementById("productionWorkspaceRefresh");
    if (!button) return;
    button.disabled = loading;
    button.textContent = loading ? "Refreshing..." : "↻ Refresh Queue";
  }

  function setStatus(message, status) {
    const target = document.getElementById("productionWorkspaceStatus");
    if (!target) return;
    target.textContent = message;
    target.dataset.state = status || "";
  }

  function setText(id, value) {
    const target = document.getElementById(id);
    if (target) target.textContent = String(value ?? "");
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

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: renderProductionWorkspace,
    refresh: refreshProductionWorkspace,
    buildViewModel,
    selectQueue: selectProductionQueue,
    getSelectedQueue: () => state.selectedQueue,
    openWorkOrder,
    getModel: () => state.model
  });
})(window, document);

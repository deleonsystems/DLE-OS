(function registerProductionWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "production";
  const TEMPLATE_PATH = "SRC/workspaces/production/production-workspace.html";
  const API = "/api/production/v1/work-orders/";
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
    selectedQueue: "KIT_COMPLETE",
    packages: new Map(), packageErrors: new Map(), selectedWo: "", package: null,
    panel: "traveler", editing: false, dirty: false, busy: false, detailRequest: 0, message: ""
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
      renderManagement();
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
    mount.addEventListener("click", async event => {
      const action = event.target?.closest?.("[data-production-action]");
      if (action) return handleAction(action.dataset.productionAction, action);
      const panel = event.target?.closest?.("[data-production-panel]");
      if (panel) {
        if (!discardEdits()) return;
        state.editing = false; state.panel = panel.dataset.productionPanel; renderManagement(); return;
      }
      const rowElement = event.target?.closest?.("[data-production-queue-key]");
      if (rowElement) return openWorkOrder(state.rowsByKey.get(rowElement.dataset.productionQueueKey));
    });
    mount.addEventListener("input", event => { if (event.target?.closest?.("#productionDraftForm")) state.dirty = true; });
    mount.addEventListener("submit", async event => {
      if (event.target?.id !== "productionDraftForm") return;
      event.preventDefault();
      return saveDraft(event.target);
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
      // Enrich existing canonical queue rows. Missing governed lineage remains visible and cannot imply readiness.
      state.packages.clear(); state.packageErrors.clear();
      const workOrders = [...new Set([...(state.model.queues.kitComplete || []), ...(state.model.queues.kitShort || [])].map(row => row.workOrderNumber).filter(Boolean))];
      await Promise.all(workOrders.map(async wo => {
        try { state.packages.set(wo, await request(wo)); }
        catch (error) { state.packageErrors.set(wo, error.message); }
      }));
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
    const projection = state.packages.get(row.workOrderNumber);
    const unavailable = state.packageErrors.has(row.workOrderNumber);
    const material = projection?.materialStatus || (state.selectedQueue === "KIT_COMPLETE" ? "KIT_COMPLETE" : "KIT_SHORT");
    const production = projection ? humanStatus(projection.productionStatus) : unavailable ? "Production source review required" :
      material === "KIT_SHORT" ? "Awaiting Parts" : "Traveler review required";
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
      '<span class="production-queue-readiness"><span class="production-compact-state">', escapeHtml(humanStatus(material)), '</span>',
      '<strong>', escapeHtml(production), '</strong><small>', escapeHtml(projection?.boundTraveler ? 'Traveler v' + projection.boundTraveler.definitionVersion + ' · Frozen' : projection?.definition ? 'Traveler · ' + humanStatus(projection.definition.status) : unavailable ? 'Traveler unavailable · source review' : 'Traveler not bound'), '</small>',
      projection?.firstOperation ? '<small>First · ' + escapeHtml(projection.firstOperation.sequence) + ' ' + escapeHtml(projection.firstOperation.name) + '</small>' : '', '</span>',
      '<span class="production-compact-arrow" aria-hidden="true">→</span>',
      '</button>'
    ].join("");
  }

  async function openWorkOrder(row) {
    if (!row?.actionable || !row.workOrderNumber || !row.canonicalWorkOrder) return false;
    if (!discardEdits()) return false;
    state.selectedWo = row.workOrderNumber; state.package = null; state.editing = false; state.panel = "traveler";
    window.DleWorkspaceShell?.setWorkspaceView?.(WORKSPACE_ID);
    await refreshDetail();
    return true;
  }

  const list = value => Array.isArray(value) ? value : [];
  const readableQuantity = value => value === null || value === undefined || value === "" ? "Not recorded" :
    Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 20 }) : "Not recorded";
  const humanStatus = value => ({
    KIT_COMPLETE: "Kit Complete", KIT_SHORT: "Kit Short", NEEDS_KITTING: "Needs Kitting", KITTING_IN_PROGRESS: "Kitting In Progress",
    READY_TO_START_PRODUCTION: "Ready to Start Production", AWAITING_KITTING: "Awaiting Kitting", AWAITING_PARTS: "Awaiting Parts",
    TRAVELER_REVIEW_REQUIRED: "Traveler Review Required", TRAVELER_REQUIRED: "Traveler Required", NOT_STARTED: "Not Started",
    DRAFT: "Draft", APPROVED: "Approved", MATERIALS_PREREQUISITE: "Materials prerequisite", COUNTED_EXACT: "Counted Exact",
    TRAVELER: "Traveler", COC: "Certificate of Conformance", CERTIFICATE_OF_CONFORMANCE: "Certificate of Conformance",
    MATERIAL_CERT: "Material Certificate", TEST_REPORT: "Test Report", SEEDED: "Traveler Draft Created", EDIT_LEASE_ACQUIRED: "Edit Lease Acquired",
    DRAFT_REVISED: "Draft Revised", WO_BOUND: "WO Traveler Frozen",
    COUNTED: "Counted Exact", COMPLETE: "Complete", PRODUCTION: "Production", NOT_READY: "Not Ready"
  }[value] || cleanText(value).replace(/_/g, " ") || "Not established");
  const dateTime = value => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("en-US") : "Not recorded";
  const safeUrl = value => /^\/api\/[A-Za-z0-9/_?%=&.:-]+$/.test(cleanText(value)) ? value : "";
  const link = (url, label, className = "") => safeUrl(url) ? '<a class="production-reference-link ' + className +
    '" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>' : '<span class="production-muted">' + escapeHtml(label) + ' · unavailable</span>';
  const button = (action, label, disabled = false) => '<button type="button" data-production-action="' + action + '"' +
    (disabled ? ' disabled' : '') + '>' + escapeHtml(label) + '</button>';
  const field = (label, value) => '<div class="production-fact"><small>' + escapeHtml(label) + '</small><strong>' + escapeHtml(value || "Not established") + '</strong></div>';
  const apiPath = wo => API + encodeURIComponent(wo);
  function canManage() { return state.package?.canManage === true && state.package?.executionStarted !== true; }

  async function request(wo, suffix = "", body, method = "POST") {
    const options = { credentials: "same-origin", cache: "no-store" };
    if (body !== undefined) Object.assign(options, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const response = await window.fetch(apiPath(wo) + suffix, options);
    const contentType = response.headers?.get?.("content-type") || "";
    if (contentType && !contentType.includes("json")) throw new Error("Production session is unavailable. Unlock SIM and refresh.");
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message || data.error?.message || (typeof data.error === "string" ? data.error : "") ||
        "Production request failed (" + response.status + ").");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function discardEdits() {
    if (state.dirty && !window.confirm?.("Discard unsaved Traveler draft edits?")) return false;
    state.dirty = false; return true;
  }

  async function refreshDetail() {
    if (!state.selectedWo || state.busy || !discardEdits()) return;
    const token = ++state.detailRequest;
    state.message = "Loading Production package…"; renderManagement();
    try {
      const data = await request(state.selectedWo);
      if (token !== state.detailRequest) return;
      state.package = data; state.packages.set(state.selectedWo, data);
      state.message = ""; state.editing = false; renderManagement(); renderQueues();
    } catch (error) { if (token === state.detailRequest) { state.message = error.message; renderManagement(); } }
  }

  function renderManagement() {
    const target = document.getElementById("productionManagement");
    const queue = document.querySelector("[data-production-queue-view]");
    if (queue) queue.hidden = Boolean(state.selectedWo);
    if (!target) return;
    target.hidden = !state.selectedWo;
    if (!state.selectedWo) return;
    target.innerHTML = renderManagementHtml(state.package);
  }

  function renderManagementHtml(data) {
    const top = '<div class="production-detail-top">' + button("back", "← Production queue", state.busy) +
      '<h2>WO ' + escapeHtml(state.selectedWo || data?.workOrderNumber) + ' · Production Management</h2>' +
      button("refresh-detail", "Refresh", state.busy) + '</div>';
    const notice = '<p id="productionDetailMessage" class="production-detail-message" role="status" aria-live="polite">' + escapeHtml(state.message) + '</p>';
    if (!data) return top + notice;
    const context = data.context || {}, bound = data.boundTraveler, def = data.definition;
    const source = data.source || {}, first = data.firstOperation;
    const facts = '<div class="production-context">' + field("Customer", context.customer || context.customerNumber) +
      field("Assembly / Rev", [context.assembly, context.revision].filter(Boolean).join(" / ")) + field("Qty", readableQuantity(context.quantity)) +
      field("Customer Due", formatDueDate(context.customerDueDate)) + field("Material Status", humanStatus(data.materialStatus)) +
      field("Production Status", humanStatus(data.productionStatus)) + field("Traveler", bound ? "Approved / Frozen · v" + bound.definitionVersion :
        def ? humanStatus(def.status) + " · v" + (def.version || def.workingVersion) : "Not established") + '</div>';
    const firstCard = '<section class="production-first-operation" aria-label="First operation">' +
      '<div><small>FIRST OPERATION</small><strong>' + escapeHtml(first ? first.sequence + ' — ' + first.name : "Awaiting approved Traveler") +
      '</strong><span>' + (data.ready ? 'Ready · Not Started' : 'Not Started · Readiness review required') + '</span></div>' +
      '<div><button type="button" class="production-start" disabled aria-describedby="productionExecutionNotice">Start ' +
      escapeHtml(first?.name || "First Operation") + '</button><small id="productionExecutionNotice">Execution controls are not enabled in this foundation slice.</small></div></section>';
    const errors = list(data.validationErrors).length ? '<div class="production-validation" role="note"><strong>Readiness review</strong><ul>' +
      data.validationErrors.map(error => '<li>' + escapeHtml(typeof error === "string" ? error : error.message || error.code) + '</li>').join("") + '</ul></div>' : "";
    const tabs = [["traveler", "Traveler"], ["bom", "DLE-OS BOM"], ["kitting", "Kitting Result"], ["technical", "Technical Definition"],
      ["customer", "Customer Requirements"], ["history", "History"]].map(([id, label]) =>
      '<button type="button" data-production-panel="' + id + '" aria-pressed="' + (state.panel === id) + '">' + label + '</button>').join("");
    let body;
    if (state.panel === "bom") body = renderBom(data);
    else if (state.panel === "kitting") body = renderKitting(data);
    else if (state.panel === "technical") body = renderTechnical(data);
    else if (state.panel === "customer") body = renderCustomer(data);
    else if (state.panel === "history") body = renderHistory(data);
    else body = renderTraveler(data);
    return top + notice + facts + firstCard + errors + '<nav class="production-detail-tabs" aria-label="Production references">' + tabs +
      '</nav><section class="production-detail-body">' + body + '</section><p class="production-source-context">Source quote ' +
      escapeHtml(context.sourceQuote || source.quote?.quoteNumber || source.quote || "Not established") + ' · Frozen Labor v' +
      escapeHtml(source.laborVersion ?? "—") + ' · Current operation: Not Started</p>';
  }

  function estimatingBasis(operation) {
    const basis = operation.estimatingBasis || {};
    const time = basis.runSeconds == null ? "Time not recorded" : readableQuantity(basis.runSeconds) + " sec";
    return (basis.operationQuantity == null ? "" : readableQuantity(basis.operationQuantity) + " × ") + time +
      (basis.timeBasis === "BATCH" ? " / batch" : basis.timeBasis === "PER_UNIT" ? " / assembly" : "") +
      (Number(basis.setupMinutes) > 0 ? " · Setup " + readableQuantity(basis.setupMinutes) + " min" : "");
  }

  function renderOperationDetails(op) {
    const notes = list(op.productionNotes).filter(note => note.purpose === "PRODUCTION" && !note.removed);
    return '<div class="production-operation-details"><section><h4>Source instructions · read-only</h4><p class="production-preserve-lines">' +
      escapeHtml(op.instructions || "No source instructions recorded.") + '</p>' +
      notes.map(note => '<p class="production-source-note production-preserve-lines">' + escapeHtml(note.text) + '</p>').join("") +
      '<p class="production-muted">Controlled technical documents remain authoritative.</p></section>' +
      (op.shopInstructions ? '<section><h4>Traveler / shop instruction</h4><p class="production-preserve-lines">' + escapeHtml(op.shopInstructions) + '</p></section>' : '') +
      (op.managementNotes ? '<section><h4>Management note</h4><p class="production-preserve-lines">' + escapeHtml(op.managementNotes) + '</p></section>' : '') +
      (op.inspectionRequirements ? '<section><h4>Inspection / test review</h4><p class="production-preserve-lines">' + escapeHtml(op.inspectionRequirements) + '</p></section>' : '') +
      '<section class="production-reference-list"><h4>Visual / technical references</h4>' +
      (list(op.visuals).map(visual => link(visual.url, visual.name) + (visual.caption ? '<small>' + escapeHtml(visual.caption) + '</small>' : '')).join("") ||
        '<span class="production-muted">Text-only operation · no visual attached</span>') +
      list(op.technicalReferences).map(reference => link(reference.url, reference.name)).join("") + '</section>' +
      '<small class="production-muted">Source operation ' + escapeHtml(op.sourceOperationId) + ' · Traveler operation ' + escapeHtml(op.id) + '</small></div>';
  }

  function renderRoute(operations) {
    const active = list(operations).filter(op => op.classification !== "MATERIALS_PREREQUISITE" && op.enabled !== false).sort((a, b) => a.sequence - b.sequence);
    return '<div class="production-route" aria-label="Active Production route"><div class="production-route-head" aria-hidden="true">' +
      '<span>Seq / Operation</span><span>Department / Work Center</span><span>Estimated basis</span><span>References / State</span></div>' +
      active.map(op => '<details class="production-operation"><summary><span><small>' + escapeHtml(op.sequence) + '</small><strong>' +
        escapeHtml(op.name) + '</strong></span><span>' + escapeHtml([op.department, op.workCenter].filter(Boolean).join(" / ") || "Not Assigned") +
        '</span><span>' + escapeHtml(estimatingBasis(op)) + '</span><span><small>' +
        (list(op.visuals).length ? list(op.visuals).length + ' visual' + (list(op.visuals).length > 1 ? 's' : '') : 'Text only') +
        (op.inspectionRequirements ? ' · Inspection / Test' : '') + '</small><strong>Not Started</strong></span></summary>' +
        renderOperationDetails(op) + '</details>').join("") + '</div>';
  }

  function renderTraveler(data) {
    const def = data.definition, bound = data.boundTraveler;
    const operations = bound ? bound.operations : list(data.operations);
    const prerequisites = list(operations).filter(op => op.classification === "MATERIALS_PREREQUISITE");
    const management = data.canManage === true && !data.executionStarted;
    const printPath = apiPath(data.workOrderNumber) + "/traveler.pdf";
    let controls = "";
    if (!def && management) controls = '<div class="production-governance"><h3>Review source → Create Traveler draft</h3>' +
      '<p>Retain all source operations. Select any Materials prerequisite to exclude from the active Production route.</p>' +
      '<div class="production-seed-choices">' + list(data.operations).map(op => '<label><input type="checkbox" data-production-prerequisite value="' +
        escapeHtml(op.sourceOperationId) + '"> ' + escapeHtml(op.sequence + ' — ' + op.name) + '</label>').join("") + '</div>' +
      button("seed", "Create Traveler Draft", state.busy) + '</div>';
    if (def && management) controls = '<div class="production-governance"><div class="production-governance-heading"><h3>Traveler Definition · ' +
      escapeHtml(humanStatus(def.status)) + ' · working v' + escapeHtml(def.workingVersion) + '</h3>' +
      (!state.editing ? button("edit", def.status === "APPROVED" ? "Review / Revise Definition" : "Review / Edit Draft", state.busy) : '') +
      (def.status === "DRAFT" && !state.editing ? button("approve", "Approve Traveler Version", state.busy) : '') +
      (def.status === "APPROVED" && !bound ? button("bind", "Bind Approved Traveler to WO", state.busy) : '') +
      '</div><small>Definition ' + escapeHtml(def.id) + (def.approval ? ' · Approved by ' + escapeHtml(def.approval.actor) + ' · ' + escapeHtml(dateTime(def.approval.atUtc)) : '') +
      '</small>' + (bound ? '<p>The WO uses its frozen approved version. Definition revisions do not change this WO Traveler.</p>' : '') +
      (state.editing ? renderEditor(def) : '') + '</div>';
    return '<div class="production-section-heading"><h3>' + (bound ? 'Frozen WO Traveler · ' + escapeHtml(bound.id) : 'Traveler Review') +
      '</h3>' + (def ? link(printPath, "Print Traveler — Non-Controlled Copy") : '') + '</div>' +
      (bound ? '<p class="production-muted">Approved definition v' + escapeHtml(bound.definitionVersion) + ' · Bound by ' + escapeHtml(bound.createdBy) +
        ' · ' + escapeHtml(dateTime(bound.createdAt)) + '</p>' : '<p class="production-muted">A reviewed, approved and frozen Traveler is required before Production can be ready.</p>') +
      '<div class="production-prerequisite"><strong>Materials Released: ' + escapeHtml(humanStatus(data.materialStatus)) + '</strong>' +
      prerequisites.map(op => '<span>' + escapeHtml(op.sequence + ' — ' + op.name) + ' · Materials prerequisite / excluded from active Production</span>').join("") +
      '</div>' + prerequisites.map(op => '<details class="production-prerequisite-reference"><summary>View retained Materials source · ' +
        escapeHtml(op.sequence + ' ' + op.name) + '</summary>' + renderOperationDetails(op) + '</details>').join("") +
      (!def ? '<h3>Frozen Labor source · review operation classification</h3>' : '') + renderRoute(operations) + controls;
  }

  function renderEditor(def) {
    return '<form id="productionDraftForm"><p class="production-muted">Source instructions, production notes and verified references are retained read-only. Edit only Traveler review fields below.</p>' +
      '<label>Reason for revision<textarea name="reason" required maxlength="2000" rows="2"></textarea></label>' +
      list(def.operations).map(op => '<details class="production-editor-operation"><summary>' + escapeHtml(op.sequence + ' — ' + op.name) + '</summary>' +
        '<fieldset data-production-edit-operation="' + escapeHtml(op.id) + '"' + (state.busy ? ' disabled' : '') + '><div class="production-editor-grid">' +
        '<label>Sequence<input name="sequence" type="number" min="0.01" step="0.01" required value="' + escapeHtml(op.sequence) + '"></label>' +
        '<label>Department<input name="department" maxlength="120" value="' + escapeHtml(op.department) + '"></label>' +
        '<label>Work Center<input name="workCenter" maxlength="120" value="' + escapeHtml(op.workCenter) + '"></label>' +
        '</div><label>Traveler / shop instructions<textarea name="shopInstructions" rows="3" maxlength="8000">' + escapeHtml(op.shopInstructions) + '</textarea></label>' +
        '<label>Management notes<textarea name="managementNotes" rows="2" maxlength="4000">' + escapeHtml(op.managementNotes) + '</textarea></label>' +
        '<label>Inspection / test requirements<textarea name="inspectionRequirements" rows="3" maxlength="4000">' + escapeHtml(op.inspectionRequirements) + '</textarea></label>' +
        '<label class="production-checkbox"><input name="enabled" type="checkbox"' + (op.enabled !== false ? ' checked' : '') +
        (op.classification === "MATERIALS_PREREQUISITE" ? ' disabled' : '') + '> Active in Production route</label>' +
        '<label>Exclusion reason<input name="exclusionReason" maxlength="2000" value="' + escapeHtml(op.exclusionReason) + '"></label>' +
        renderOperationDetails(op) + '</fieldset></details>').join("") +
      '<div class="production-editor-actions"><button type="submit"' + (state.busy ? ' disabled' : '') + '>Save Traveler Draft</button>' +
      button("cancel-edit", "Cancel", state.busy) + '<small>Lease expires ' + escapeHtml(dateTime(def.lease?.expiresAt)) + '</small></div></form>';
  }

  function renderBom(data) {
    return '<div class="production-section-heading"><h3>DLE-OS BOM · Read-only</h3>' + link(apiPath(data.workOrderNumber) + "/bom.pdf", "Print BOM — Non-Controlled Copy") +
      '</div><p class="production-muted">Released definition joined to final governed Kitting evidence. Completion dispositions are not numerical counts.</p>' +
      '<div class="production-table-scroll"><table class="production-bom"><thead><tr>' +
      ["Find", "Approved P/N / Description", "Ref Des", "Qty / Assembly", "Required", "UOM", "Final Kitting result", "Evidence"].map(label => '<th scope="col">' + label + '</th>').join("") +
      '</tr></thead><tbody>' + list(data.bom).map(row => '<tr><td>' + escapeHtml(row.find || row.requirementId) +
        '</td><td><strong>' + escapeHtml(row.approvedPartNumber || row.partNumber) + '</strong><span>' + escapeHtml(row.description) +
        '</span>' + (row.dnp ? '<small>DNP</small>' : '') + list(row.eligibleParts).filter(part => part !== row.partNumber).map(part =>
          '<small>Approved related identity: ' + escapeHtml(part) + '</small>').join("") +
        '</td><td>' + escapeHtml(list(row.references).join(", ")) + '</td><td>' + escapeHtml(readableQuantity(row.requiredEach)) +
        '</td><td>' + escapeHtml(readableQuantity(row.requiredQuantity)) + '</td><td>' + escapeHtml(row.uom) +
        '</td><td><strong>' + escapeHtml(humanStatus(row.result)) + '</strong><span>' +
        (row.recordedKittedQuantity == null ? row.result === "COMPLETE" ? 'Complete disposition · no measured count' : 'No measured count recorded' :
          'Recorded: ' + escapeHtml(readableQuantity(row.recordedKittedQuantity))) + '</span><small>Short: ' +
        escapeHtml(readableQuantity(row.shortage)) + '</small></td><td>' + renderMaterialEvidence(row) + '</td></tr>').join("") +
      '</tbody></table></div>';
  }

  function renderMaterialEvidence(row) {
    return (row.originalKittedQuantity != null ? '<span>Original Kitting: ' + escapeHtml(readableQuantity(row.originalKittedQuantity)) + '</span>' : '') +
      (Number(row.acceptedMaterialApplied) > 0 ? '<span>Accepted Material Applied: ' + escapeHtml(readableQuantity(row.acceptedMaterialApplied)) + '</span>' : '') +
      list(row.acceptedMaterials).map(app => '<span>' + escapeHtml(app.materialId) +
        ' · ' + escapeHtml(readableQuantity(app.quantity)) + '</span><small>PO ' + escapeHtml(app.purchaseOrderNumber) + ' / ' +
        escapeHtml(app.purchaseOrderLine) + '</small>').join("") ||
      '<span class="production-muted">Final submission disposition</span>';
  }

  function renderKitting(data) {
    const kit = data.kitting || {};
    return '<div class="production-section-heading"><h3>Final Kitting Result · Read-only</h3>' + link(kit.pdfUrl, "View Kit Complete Submission") +
      '</div><div class="production-context">' + field("Submission", kit.submissionId) + field("Version", String(kit.submissionVersion ?? "Not established")) +
      field("Result", humanStatus(kit.state)) + field("Submitted By", kit.submittedBy) + field("Submitted At", dateTime(kit.submittedAtUtc)) +
      '</div><p>Final allocations and accepted-material applications are shown in the DLE-OS BOM evidence column.</p>' +
      button("show-bom", "View BOM / Final Material Evidence") +
      '<details class="production-audit"><summary>Submission lineage and accepted-material applications</summary><dl>' +
      '<dt>Case</dt><dd>' + escapeHtml(kit.caseId) + '</dd><dt>Frozen released BOM</dt><dd>' + escapeHtml(data.source?.releasedBomIdentity) + '</dd></dl>' +
      list(kit.applications).map(app => '<p>' + escapeHtml(app.receiptLineId || app.acceptedMaterialNumber || app.acceptedMaterialId || app.applicationId) +
        ' · ' + escapeHtml(readableQuantity(app.quantity ?? app.appliedQuantity)) + ' applied</p>').join("") + '</details>' +
      '<h3 class="production-allocation-heading">Retained allocation evidence</h3>' + list(kit.requirements).map(row => {
        const allocations = list(row.entry?.allocations);
        return '<details class="production-audit"><summary>Find ' + escapeHtml(row.sequence) + ' · ' + escapeHtml(row.partNumber) +
          ' · ' + escapeHtml(humanStatus(row.entry?.result)) + '</summary>' +
          (allocations.length ? '<div class="production-table-scroll"><table class="production-bom"><thead><tr><th>Allocation</th><th>Part</th><th>Qty</th>' +
            '<th>Supplier PO</th><th>Accepted Material</th><th>Recorded by</th><th>Recorded at</th></tr></thead><tbody>' +
            allocations.map(allocation => '<tr><td>' + escapeHtml(allocation.allocationId) + '</td><td>' + escapeHtml(allocation.partNumber) +
              '</td><td>' + escapeHtml(readableQuantity(allocation.quantity)) + '</td><td>' + escapeHtml(allocation.purchaseOrder || "Not recorded") +
              '</td><td>' + escapeHtml(allocation.acceptedMaterial?.receiptLineId || "Not recorded") + '</td><td>' +
              escapeHtml(allocation.evidenceOperator || "Not recorded") + '</td><td>' + escapeHtml(dateTime(allocation.evidenceAtUtc)) + '</td></tr>').join("") +
            '</tbody></table></div>' : '<p class="production-muted">' + (row.entry?.result === "COMPLETE" ?
              'Complete disposition · no numerical allocation recorded.' : 'No numerical allocation recorded in this submission.') + '</p>') + '</details>';
      }).join("");
  }

  function renderTechnical(data) {
    return '<h3>Controlled Technical Definition · Read-only</h3><p class="production-muted">Open the existing verified files. These documents remain technical authorities.</p>' +
      '<div class="production-document-list">' + list(data.technicalDocuments).map(doc => '<div><strong>' + escapeHtml(doc.name) +
        '</strong><span>' + escapeHtml(doc.type === "BOM" || /BOM/.test(doc.type) ? "BOM" : /DRAWING/.test(doc.type) ? "Technical Drawing" : humanStatus(doc.type)) +
        '</span>' + link(doc.url, "View") + '</div>').join("") + '</div>';
  }

  function renderCustomer(data) {
    const requirements = data.customerRequirements || {};
    const labels = { travelerRequired: "Traveler required", traceabilityDeliverables: "Traceability / shipment deliverables",
      aerospaceRequirements: "Aerospace requirements", poFlowdowns: "Customer PO flow-down requirements",
      additionalContractQualityRequirements: "Additional contract / quality requirements", specialRequirements: "Special requirements",
      otherCustomerRequirements: "Other customer requirements" };
    const rows = Array.isArray(requirements) ? requirements : Object.entries(labels).map(([key, label]) => ({ label, value: requirements[key] }));
    const humanRequirement = value => typeof value === "boolean" ? value ? "Required" : "Not Required" :
      Array.isArray(value) ? value.map(item => typeof item === "string" ? humanStatus(item) : item.label || item.text || item.answer || "").filter(Boolean).join("; ") || "None recorded" :
      typeof value === "object" && value !== null ? value.text || value.answer || value.label || "See accepted order requirement" : value || "None recorded";
    return '<h3>Accepted Customer Requirements · Read-only</h3><p class="production-muted">Requirements retained in the accepted order package.</p>' +
      '<dl class="production-requirements">' + rows.map(item => '<dt>' + escapeHtml(item.label || item.name || item.key) + '</dt><dd>' +
        escapeHtml(humanRequirement(item.value ?? item.answer ?? item.text)) + '</dd>').join("") + '</dl>';
  }

  function renderHistory(data) {
    return '<h3>Traveler History</h3><p class="production-muted">Append-only definition approval and WO binding history. No Production execution has started.</p>' +
      '<ol class="production-history">' + list(data.history).map(item => '<li><strong>' + escapeHtml(humanStatus(item.type || item.action || item.eventType)) +
        '</strong><span>' + escapeHtml(item.actor || item.reviewedBy || item.actorId) + ' · ' + escapeHtml(dateTime(item.atUtc || item.timestamp)) +
        (item.workingVersion != null ? ' · working v' + escapeHtml(item.workingVersion) : '') +
        '</span>' + (item.reason || item.detail?.reason ? '<p>' + escapeHtml(item.reason || item.detail.reason) + '</p>' : '') + '</li>').join("") + '</ol>';
  }

  async function command(suffix, body, method = "POST", preserveForm = false) {
    if (state.busy || !canManage()) return null;
    state.busy = true; state.message = "";
    const form = document.getElementById("productionDraftForm");
    const previousDisabled = preserveForm ? Array.from(form?.querySelectorAll("button,input,textarea") || []).map(control => [control, control.disabled]) : [];
    if (preserveForm) form?.querySelectorAll("button,input,textarea").forEach(control => { control.disabled = true; });
    else renderManagement();
    try {
      const result = await request(state.selectedWo, suffix, body, method);
      state.package = result; state.packages.set(state.selectedWo, result);
      state.dirty = false; state.message = "Traveler review saved."; return result;
    } catch (error) {
      state.message = error.message + (error.status === 409 ? " Your edits are retained. Refresh and review the latest version before retrying." : "");
      if (preserveForm) {
        const status = document.getElementById("productionDetailMessage");
        if (status) status.textContent = state.message;
      }
      return null;
    } finally {
      state.busy = false;
      previousDisabled.forEach(([control, disabled]) => { control.disabled = disabled; });
    }
  }

  async function handleAction(action) {
    if (state.busy) return;
    if (action === "back") { if (!discardEdits()) return; state.selectedWo = ""; state.editing = false; ++state.detailRequest; renderManagement(); renderQueues(); return; }
    if (action === "refresh-detail") return refreshDetail();
    if (action === "show-bom") { state.panel = "bom"; renderManagement(); return; }
    if (action === "cancel-edit") { if (!discardEdits()) return; state.editing = false; renderManagement(); return; }
    if (!canManage()) return;
    const def = state.package.definition;
    if (action === "seed") {
      const materialsPrerequisiteSourceIds = Array.from(document.querySelectorAll("[data-production-prerequisite]:checked")).map(input => input.value);
      await command("/traveler/seed", { sourceToken: state.package.sourceToken, materialsPrerequisiteSourceIds });
    } else if (action === "edit" || action === "approve") {
      const locked = await command("/traveler/lease", { expectedWorkingVersion: def.workingVersion });
      if (locked && action === "edit") { state.editing = true; state.message = "Editing Traveler Definition. The frozen WO Traveler remains unchanged."; }
      if (locked && action === "approve") await command("/traveler/approve", {
        expectedWorkingVersion: locked.definition.workingVersion, leaseId: locked.definition.lease.id
      });
    } else if (action === "bind") {
      await command("/traveler/bind", { expectedWorkingVersion: def.workingVersion, approvedVersion: def.version });
    }
    renderManagement(); renderQueues();
  }

  async function saveDraft(form) {
    if (!canManage() || !state.editing || !form.reportValidity()) return;
    const def = state.package.definition;
    const value = (parent, name) => cleanText(parent.querySelector('[name="' + name + '"]')?.value);
    const operations = Array.from(form.querySelectorAll("[data-production-edit-operation]")).map(section => {
      const source = def.operations.find(op => op.id === section.dataset.productionEditOperation);
      return { id: source.id, sequence: Number(value(section, "sequence")), department: value(section, "department"),
        workCenter: value(section, "workCenter"), shopInstructions: value(section, "shopInstructions"), managementNotes: value(section, "managementNotes"),
        inspectionRequirements: value(section, "inspectionRequirements"), enabled: source.classification !== "MATERIALS_PREREQUISITE" &&
          section.querySelector('[name="enabled"]')?.checked === true, exclusionReason: value(section, "exclusionReason") };
    });
    const result = await command("/traveler/draft", { expectedWorkingVersion: def.workingVersion, leaseId: def.lease.id,
      reason: value(form, "reason"), operations }, "PUT", true);
    if (result) { state.editing = false; renderManagement(); renderQueues(); }
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
    getModel: () => state.model,
    getPackage: () => state.package,
    renderManagementHtml, renderRoute, renderBom, renderOperationDetails, humanStatus
  });
})(window, document);

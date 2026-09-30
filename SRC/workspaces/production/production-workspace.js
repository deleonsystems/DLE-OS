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
    panel: "traveler", editing: false, dirty: false, busy: false, detailRequest: 0, message: "",
    woEditing: false, revisionReview: false, revisionOrder: [], revisionReason: "", clarifications: [], substeps: [], travelerVisuals: [], operationContent: [], inputPanel: null, inspectedRevision: null, drag: null
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
    mount.addEventListener('pointerdown', beginRevisionDrag);
    mount.addEventListener('pointermove', moveRevisionDrag);
    mount.addEventListener('pointerup', event => finishRevisionDrag(event, true));
    mount.addEventListener('pointercancel', event => finishRevisionDrag(event, false));
    mount.addEventListener('lostpointercapture', event => finishRevisionDrag(event, false));
    mount.addEventListener('keydown', revisionGripKey);
    window.addEventListener?.('blur', cancelRevisionDrag);
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
        state.editing = false; state.woEditing = false; state.panel = panel.dataset.productionPanel; renderManagement(); return;
      }
      const rowElement = event.target?.closest?.("[data-production-queue-key]");
      if (rowElement) return openWorkOrder(state.rowsByKey.get(rowElement.dataset.productionQueueKey));
    });
    mount.addEventListener('change', event => {
      if (event.target?.id === 'productionImageFile' && state.inputPanel) { state.inputPanel.file = event.target.files?.[0] || null; }
    });
    mount.addEventListener('paste', event => {
      if (!state.inputPanel || state.inputPanel.kind !== 'VISUAL' || !event.target?.closest?.('.production-input-panel')) return;
      const file = Array.from(event.clipboardData?.items || []).find(i => i.kind === 'file' && /^image\/(png|jpeg)$/.test(i.type))?.getAsFile();
      if (file) { event.preventDefault(); state.inputPanel.file = file; const status = document.getElementById('productionImageStatus'); if (status) status.textContent = 'Pasted image ready to upload.'; }
    });
    mount.addEventListener("input", event => {
      if (event.target?.closest?.("#productionDraftForm")) state.dirty = true;
      if(event.target?.dataset?.woContentField){const item=state.operationContent.find(n=>n.operationId===event.target.dataset.operationId);if(item){item[event.target.dataset.woContentField]=event.target.value;state.dirty=true;const row=event.target.closest?.('.production-sheet-operation');if(event.target.dataset.woContentField==='instructions'){const preview=row?.querySelector('.production-sheet-preview');if(preview)preview.textContent=event.target.value;const compactPreview=row?.querySelector('[data-instruction-preview]');if(compactPreview)compactPreview.textContent=event.target.value||'No Traveler instruction recorded.';const status=row?.querySelector('[data-source-status]');if(status)status.textContent=event.target.value===event.target.dataset.sourceInstruction?'Same as source':'Modified from source';}}}
      if (event.target?.dataset?.substepId) { const step=state.substeps.find(n=>n.id===event.target.dataset.substepId); if(step){step.text=event.target.value;state.dirty=true;} }
      if (event.target?.dataset?.travelerVisualId) { const visual=state.travelerVisuals.find(n=>n.id===event.target.dataset.travelerVisualId); if(visual){visual.caption=event.target.value;state.dirty=true;} }
      if (event.target?.dataset?.inputField && state.inputPanel) state.inputPanel[event.target.dataset.inputField] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      if (event.target?.dataset?.clarificationId) {
        const note = state.clarifications.find(n => n.id === event.target.dataset.clarificationId);
        if (note) { note.text = event.target.value; state.dirty = true; }
      }
      if (event.target?.id === "woRevisionReason") { state.revisionReason = event.target.value; state.dirty = true; }
      if (state.woEditing && state.dirty) {
        const bar = document.querySelector('.production-sticky-actions');
        const status = bar?.querySelector('small'); if (status) status.textContent = 'Unsaved draft changes';
        const review = bar?.querySelector('[data-production-action="review-wo"]'); if (review) review.disabled = true;
        if (event.target?.dataset?.clarificationId) {
          const preview = event.target.closest('.production-sheet-operation')?.querySelector('.production-sheet-preview');
          if (preview) { preview.textContent = 'WO clarification · ' + event.target.value; preview.title = event.target.value; }
        }
      }
    });
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
    state.selectedWo = row.workOrderNumber; state.package = null; state.editing = false; state.woEditing = false; state.inspectedRevision = null; state.panel = "traveler";
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
    DRAFT_REVISED: "Draft Revised", WO_BOUND: "WO Traveler Frozen", ADDED: "Added", CHANGED: "Changed", REMOVED: "Removed",
    WO_CLARIFICATION_ADDED: "Production Clarification Added", WO_CLARIFICATION_CHANGED: "Production Clarification Changed", WO_CLARIFICATION_REMOVED: "Production Clarification Removed",
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
    if (state.inputPanel && !window.confirm("Discard the open Team Input / visual editor?")) return false;
    state.inputPanel = null;
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
      state.message = ""; state.editing = false; state.woEditing = false; state.inspectedRevision = null; renderManagement(); renderQueues();
    } catch (error) { if (token === state.detailRequest) { state.message = error.message; renderManagement(); } }
  }

  function renderManagement() {
    cancelRevisionDrag();
    const target = document.getElementById("productionManagement");
    const queue = document.querySelector("[data-production-queue-view]");
    if (queue) queue.hidden = Boolean(state.selectedWo);
    if (!target) return;
    target.hidden = !state.selectedWo;
    if (!state.selectedWo) return;
    const expanded = new Set(Array.from(target.querySelectorAll('details[data-wo-operation][open]')).map(el => el.dataset.woOperation));
    const disclosures = new Set(Array.from(target.querySelectorAll('details[data-operation-disclosure][open]')).map(el => el.dataset.operationDisclosure));
    target.innerHTML = renderManagementHtml(state.package);
    target.querySelectorAll('details[data-wo-operation]').forEach(el => { el.open = expanded.has(el.dataset.woOperation); });
    target.querySelectorAll('details[data-operation-disclosure]').forEach(el => { el.open = disclosures.has(el.dataset.operationDisclosure); });
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
      field("Production Status", humanStatus(data.productionStatus)) + field("Traveler", bound ? "Approved / Frozen · v" + (data.effectiveRevision?.version || bound.version) :
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

  function loadAuthoring(draft) {
    state.operationContent=list(draft.operations).filter(o=>o.enabled&&o.classification==='PRODUCTION').map(o=>({operationId:o.id,instructions:o.travelerInstructions??(o.shopInstructions||o.instructions||''),workCenter:o.travelerWorkCenter??o.workCenter??'',department:o.travelerDepartment??o.department??''}));
    state.clarifications = list(draft.clarifications).filter(n=>!n.removed).map(n=>({...n}));
    state.substeps = list(draft.substeps).filter(n=>!n.removed).map(n=>({...n}));
    state.travelerVisuals = list(draft.visuals).filter(n=>!n.removed).map(n=>({...n}));
  }
  function currentTeam(op) { return state.panel === 'traveler' && !state.inspectedRevision ? list(state.package?.teamInputs).filter(n=>n.operationId===op.id) : []; }
  function visualTotal(op, editing) { return list(op.visuals).length + (editing ? state.travelerVisuals.filter(n=>n.operationId===op.id).length : list(op.travelerVisuals).length) + currentTeam(op).filter(n=>n.kind==='VISUAL'&&n.active).length; }
  function opAction(action,label,op,id='') { return '<button type="button" data-production-action="'+action+'" data-operation-id="'+escapeHtml(op.id)+'" data-content-id="'+escapeHtml(id)+'"'+(state.busy?' disabled':'')+'>'+label+'</button>'; }
  function operationMenu(op, editing) {
    if(state.panel!=='traveler'||state.inspectedRevision||(!editing&&(!state.package?.canAddTeamInput||!state.package?.boundTraveler))) return '<span></span>';
    const items=editing ? opAction('add-substep','Add Traveler Substep',op)+opAction('add-clarification','Add Clarification',op)+opAction('add-controlled-visual','Add Traveler Visual',op) : opAction('add-team-note','Add Production Note',op)+opAction('add-team-visual','Add Team Visual',op);
    return '<details class="production-authoring-menu"><summary aria-label="Add content to '+escapeHtml(op.name)+'">+</summary><div>'+items+'</div></details>';
  }
  function imageCard(v) { const url=v.url||apiPath(state.selectedWo)+'/production-visuals/'+encodeURIComponent(v.assetId); return '<a class="production-visual-thumb" href="'+escapeHtml(url)+'" target="_blank" rel="noopener"><img src="'+escapeHtml(url)+'" alt="'+escapeHtml(v.caption||v.text||v.name||'Traveler visual')+'" loading="lazy"></a>'+link(url,'View Original'); }
  function controlledContent(op,editing,part) {
    const steps=(editing?state.substeps.filter(n=>n.operationId===op.id):list(op.substeps)).slice().sort((a,b)=>a.order-b.order);
    const visuals=editing?state.travelerVisuals.filter(n=>n.operationId===op.id):list(op.travelerVisuals);
    return (steps.length&&part==='steps'?'<section><ol class="production-substeps">'+steps.map(n=>'<li>'+(editing?'<textarea rows="2" maxlength="4000" data-substep-id="'+escapeHtml(n.id)+'" aria-label="Substep instruction">'+escapeHtml(n.text)+'</textarea><div>'+opAction('substep-up','<span aria-hidden="true">↑</span><span class="production-sr-only">Move substep up</span>',op,n.id)+opAction('substep-down','<span aria-hidden="true">↓</span><span class="production-sr-only">Move substep down</span>',op,n.id)+opAction('remove-substep','Remove',op,n.id)+'</div>':'<p class="production-preserve-lines">'+escapeHtml(n.text)+'</p>')+'</li>').join('')+'</ol></section>':'')+
      (visuals.length&&part==='visuals'?'<section><div class="production-visual-grid">'+visuals.map(v=>'<article>'+imageCard(v)+(editing?'<label>Caption<textarea rows="2" maxlength="500" data-traveler-visual-id="'+escapeHtml(v.id)+'">'+escapeHtml(v.caption)+'</textarea></label>'+opAction('replace-controlled-visual','Supersede image',op,v.id)+opAction('remove-controlled-visual','Remove',op,v.id):'<p>'+escapeHtml(v.caption)+'</p>')+(v.teamSource?'<small>Promoted from Team Input</small>':'<small>WO-authored visual</small>')+'</article>').join('')+'</div></section>':'');
  }
  function teamContent(op,kind) {
    const entries=currentTeam(op).filter(n=>!kind||n.kind===kind); if(!entries.length) return '';
    return '<section class="production-team-input"><h4>Team Input · not controlled instructions</h4>'+entries.map(n=>'<article class="production-team-entry"><small>'+escapeHtml(n.author)+' · '+escapeHtml(dateTime(n.createdAt))+' · '+(n.audience==='MANAGEMENT_ONLY'?'Management only':'Team visible')+(n.active?'':' · Withdrawn')+'</small>'+(n.kind==='VISUAL'?imageCard(n):'')+'<p class="production-preserve-lines">'+escapeHtml(n.text)+'</p>'+list(n.promotions).map(p=>'<small>Promoted · Traveler v'+escapeHtml(p.version)+' · '+escapeHtml(humanStatus(p.status))+'</small>').join('')+(!state.woEditing&&n.canCorrect?opAction('correct-team-input','Correct / withdraw',op,n.id):'')+(!state.woEditing&&n.active&&state.package?.canEditTraveler?opAction('promote-team-input','Promote to Traveler…',op,n.id):'')+'<details><summary>History · '+n.version+' version'+(n.version===1?'':'s')+'</summary>'+list(n.history).map(h=>'<p>v'+h.version+' · '+escapeHtml(h.updatedBy)+' · '+escapeHtml(dateTime(h.updatedAt))+' · '+escapeHtml(h.reason)+'<br>'+escapeHtml(h.text)+'</p>').join('')+'</details></article>').join('')+'</section>';
  }
  function renderInputPanel() {
    const p=state.inputPanel;if(!p)return '';
    return '<section class="production-input-panel" aria-label="'+escapeHtml(p.title)+'"><h3>'+escapeHtml(p.title)+'</h3><p>'+escapeHtml(p.operationName)+'</p>'+(p.kind==='VISUAL'&&!p.existing?'<label>PNG / JPEG · up to 8 MB<input id="productionImageFile" type="file" accept="image/png,image/jpeg"></label><small id="productionImageStatus" role="status">Or paste an image into this editor. '+escapeHtml(p.file?.name||'')+'</small>':'')+'<label>'+(p.kind==='VISUAL'?'Caption':'Team note')+'<textarea data-input-field="text" rows="3" maxlength="'+(p.kind==='VISUAL'?500:4000)+'">'+escapeHtml(p.text)+'</textarea></label>'+
      (!p.controlled&&state.package?.canManageTeamInput?'<label>Audience<select data-input-field="audience"><option value="TEAM_VISIBLE"'+(p.audience==='TEAM_VISIBLE'?' selected':'')+'>Team visible</option><option value="MANAGEMENT_ONLY"'+(p.audience==='MANAGEMENT_ONLY'?' selected':'')+'>Management only</option></select></label>':'')+
      (p.existing?'<label>Correction reason<textarea data-input-field="reason" maxlength="2000">'+escapeHtml(p.reason)+'</textarea></label><label>Status<select data-input-field="active"><option value="true"'+(p.active?' selected':'')+'>Active</option><option value="false"'+(!p.active?' selected':'')+'>Withdrawn — retain history</option></select></label>':'')+
      '<div>'+button('save-input',p.controlled?'Attach to draft':'Save Team Input',state.busy)+button('cancel-input','Cancel',state.busy)+'</div><small>'+(p.controlled?'This visual becomes controlled only after saving, reviewing, and approving the WO revision.':'Team Input does not change the effective Traveler or Production readiness.')+'</small></section>';
  }
  function showInputPanel() { renderManagement(); const panel=document.querySelector('.production-input-panel');panel?.scrollIntoView?.({block:'center'});panel?.querySelector('textarea')?.focus?.({preventScroll:true}); }
  function openOperationDisclosure(opId, part) {
    const row=Array.from(document.querySelectorAll('details[data-wo-operation]')).find(d=>d.dataset.woOperation===opId);
    if(row){row.open=true;const detail=Array.from(row.querySelectorAll('details[data-operation-disclosure]')).find(d=>d.dataset.operationDisclosure===opId+':'+part);if(detail)detail.open=true;}
  }
  function showOperation(opId, part) { renderManagement(); openOperationDisclosure(opId, part); }
  async function handleAuthoringAction(action,element) {
    const supported=['add-team-note','add-team-visual','correct-team-input','promote-team-input','add-substep','substep-up','substep-down','remove-substep','add-controlled-visual','replace-controlled-visual','remove-controlled-visual','save-input','cancel-input'];
    if(!supported.includes(action))return false;if(state.busy)return true;
    const opId=element.dataset.operationId,id=element.dataset.contentId;
    const op=list((state.woEditing?state.package?.woRevisionDraft:state.package?.effectiveRevision)?.operations).find(o=>o.id===opId);
    const dirty=(part)=>{state.dirty=true;state.revisionReview=false;showOperation(opId,part||(action.includes('substep')?'steps':'visuals'));};
    if(action==='cancel-input'){state.inputPanel=null;renderManagement();return true;}
    if(action==='save-input'){await saveAuthoringInput();return true;}
    if(!op)return true;
    if(action==='promote-team-input'){
      if(!state.package.canEditTraveler)return true;
      const n=currentTeam(op).find(n=>n.id===id&&n.active);if(!n)return true;
      await handleWoRevision('edit-wo',element);if(!state.woEditing)return true;
      const teamSource={id:n.id,version:n.version};
      if(n.kind==='NOTE')state.clarifications.push({id:window.crypto.randomUUID(),operationId:op.id,text:n.text,teamSource});
      else state.travelerVisuals.push({id:window.crypto.randomUUID(),operationId:op.id,assetId:n.id,caption:n.text,name:n.name,url:n.url,teamSource});
      state.message='Team Input copied into the WO draft. Enter a reason, save, review, and approve to make it controlled.';dirty(n.kind==='NOTE'?'notes':'visuals');return true;
    }
    if(action.startsWith('add-team')||action==='correct-team-input'){
      if(!state.package.canAddTeamInput||state.woEditing)return true;
      const n=action==='correct-team-input'?currentTeam(op).find(n=>n.id===id&&n.canCorrect):null;if(action==='correct-team-input'&&!n)return true;
      state.inputPanel={title:n?'Correct Team Input':action==='add-team-note'?'Add Production Note':'Add Team Visual',operationId:op.id,operationName:op.name,kind:n?.kind||(action==='add-team-note'?'NOTE':'VISUAL'),text:n?.text||'',audience:n?.audience||'TEAM_VISIBLE',active:n?.active??true,existing:n,reason:''};showInputPanel();return true;
    }
    if(!state.woEditing||!state.package.canEditTraveler)return true;
    if(action==='add-substep')state.substeps.push({id:window.crypto.randomUUID(),operationId:op.id,order:Math.max(0,...state.substeps.filter(n=>n.operationId===op.id).map(n=>n.order))+1,text:''});
    else if(action==='remove-substep')state.substeps=state.substeps.filter(n=>n.id!==id);
    else if(action==='substep-up'||action==='substep-down'){
      const items=state.substeps.filter(n=>n.operationId===op.id).sort((a,b)=>a.order-b.order),i=items.findIndex(n=>n.id===id),j=i+(action==='substep-up'?-1:1);
      if(i>=0&&j>=0&&j<items.length)[items[i].order,items[j].order]=[items[j].order,items[i].order];
    } else if(action==='remove-controlled-visual')state.travelerVisuals=state.travelerVisuals.filter(n=>n.id!==id);
    else {state.inputPanel={title:action==='replace-controlled-visual'?'Supersede Traveler Visual':'Add Traveler Visual',controlled:true,kind:'VISUAL',operationId:op.id,operationName:op.name,text:'',supersedesId:action==='replace-controlled-visual'?id:null};showInputPanel();return true;}
    dirty();return true;
  }
  async function saveAuthoringInput(){
    const p=state.inputPanel;if(!p)return;state.busy=true;state.message='Saving…';
    try{
      if(p.kind==='NOTE'||p.existing){
        const result=await request(state.selectedWo,'/team-input',{id:p.existing?.id||window.crypto.randomUUID(),expectedVersion:p.existing?.version||0,travelerId:state.package.boundTraveler.id,operationId:p.operationId,text:p.text,audience:p.audience,active:p.active===true||p.active==='true',reason:p.reason||''});
        state.package=result;state.packages.set(state.selectedWo,result);
      }else{
        if(!p.file)throw new Error('Choose or paste a PNG or JPEG image.');
        const draft=state.package.woRevisionDraft,meta={travelerId:state.package.boundTraveler.id,operationId:p.operationId,caption:p.text,audience:p.audience||'MANAGEMENT_ONLY',scope:p.controlled?'DRAFT_VISUAL':'TEAM_INPUT',expectedWorkingVersion:state.package.woRevisionWorkingVersion,revisionId:p.controlled?draft.id:null,leaseId:p.controlled?draft.lease.id:null};
        const response=await window.fetch(apiPath(state.selectedWo)+'/production-visuals',{method:'POST',credentials:'same-origin',headers:{'Content-Type':p.file.type,'X-File-Name':encodeURIComponent(p.file.name||'pasted-image.png'),'X-Production-Visual':encodeURIComponent(JSON.stringify(meta))},body:p.file});
        const asset=await response.json();if(!response.ok)throw new Error(asset.message||asset.error?.message||'Image upload failed.');
        if(p.controlled){state.travelerVisuals=state.travelerVisuals.filter(v=>v.id!==p.supersedesId);state.travelerVisuals.push({id:window.crypto.randomUUID(),operationId:p.operationId,assetId:asset.id,caption:p.text,name:asset.name,supersedesId:p.supersedesId});state.dirty=true;state.revisionReview=false;}
        else{state.package=await request(state.selectedWo);state.packages.set(state.selectedWo,state.package);}
      }
      state.inputPanel=null;state.message=p.controlled?'Visual attached to local draft. Save with a reason, review, and approve.':'Team Input saved. Effective Traveler unchanged.';
    }catch(error){state.message=error.message;}finally{state.busy=false;showOperation(p.operationId,p.kind==='VISUAL'?'visuals':'notes');}
  }

  function clarificationContent(op, editable = false) {
    const notes = editable ? state.clarifications.filter(n => n.operationId === op.id) : list(op.clarifications);
    return notes.length ? '<section class="production-clarifications"><h4>Production clarifications · WO only</h4>' + notes.map(n =>
      '<div class="production-clarification"><small>' + (n.addedInVersion ? 'Added in Traveler v' + escapeHtml(n.addedInVersion) + ' · ' + escapeHtml(dateTime(n.createdAt)) : 'New draft clarification') + '</small>' +
      (editable ? '<label class="production-sr-only" for="clarification-' + escapeHtml(n.id) + '">Production clarification for ' + escapeHtml(op.name) + '</label><textarea id="clarification-' + escapeHtml(n.id) + '" data-clarification-id="' + escapeHtml(n.id) + '" rows="3" maxlength="4000" required' + (state.busy ? ' disabled' : '') + '>' + escapeHtml(n.text) + '</textarea>' +
        '<button type="button" data-production-action="remove-clarification" data-clarification-id="' + escapeHtml(n.id) + '"' + (state.busy ? ' disabled' : '') + '>Remove clarification</button>' :
        '<p class="production-preserve-lines">' + escapeHtml(n.text) + '</p>') + '</div>').join('') + '</section>' : '';
  }

  function operationValues(op,editable=false){return editable?(state.operationContent.find(n=>n.operationId===op.id)||operationValues(op)): {instructions:op.travelerInstructions??(op.shopInstructions||op.instructions||''),workCenter:op.travelerWorkCenter??op.workCenter??'',department:op.travelerDepartment??op.department??''};}
  function renderOperationDetails(op, editable = false) {
    const value=operationValues(op,editable),source=op.sourceInstruction??(op.shopInstructions||op.instructions||'');
    const teamAllowed=!editable&&!state.woEditing&&op.enabled!==false&&op.classification==='PRODUCTION'&&state.panel==='traveler'&&!state.inspectedRevision&&state.package?.canAddTeamInput&&state.package?.boundTraveler;
    const field=(name,label,max,area=false)=>'<label>'+(area?'<span class="production-sr-only">'+label+'</span>':label)+(area?'<textarea rows="4"':'<input type="text"')+' data-wo-content-field="'+name+'" data-operation-id="'+escapeHtml(op.id)+'"'+(name==='instructions'?' data-source-instruction="'+escapeHtml(source)+'"':'')+' maxlength="'+max+'"'+(state.busy?' disabled':'')+(area?'>'+escapeHtml(value[name])+'</textarea>':' value="'+escapeHtml(value[name])+'">')+'</label>';
    const notes=list(op.productionNotes).filter(n=>n.purpose==='PRODUCTION'&&!n.removed);
    const steps=editable?state.substeps.filter(n=>n.operationId===op.id):list(op.substeps);
    const clarifications=editable?state.clarifications.filter(n=>n.operationId===op.id):list(op.clarifications);
    const team=currentTeam(op),teamNotes=team.filter(n=>n.kind==='NOTE'),teamVisuals=team.filter(n=>n.kind==='VISUAL');
    const travelerVisuals=editable?state.travelerVisuals.filter(n=>n.operationId===op.id):list(op.travelerVisuals);
    const disclosure=(part,summary,content)=>'<details class="production-compact-disclosure" data-operation-disclosure="'+escapeHtml(op.id+':'+part)+'"><summary>'+summary+'</summary><div class="production-compact-content">'+content+'</div></details>';
    const row=(heading,content,actions='',extra='')=>'<section class="production-operation-compact-row '+extra+'"><h4>'+heading+'</h4>'+content+(actions?'<div class="production-compact-actions">'+actions+'</div>':'')+'</section>';
    const view='<span class="production-disclosure-hint">'+(editable?'View / Edit':'View')+'</span>';
    const noteSummary=teamNotes.filter(n=>n.active).length+' notes · '+clarifications.length+' clarifications';
    const visualSummary='Source '+list(op.visuals).length+' · Team '+teamVisuals.filter(n=>n.active).length+' · Traveler '+travelerVisuals.length;
    return '<div class="production-operation-details">'+
      row('Traveler Instructions',disclosure('instructions','<span class="production-instruction-preview" data-instruction-preview>'+escapeHtml(value.instructions||'No Traveler instruction recorded.')+'</span><span class="production-disclosure-hint">'+(editable?'Edit / Expand':'More')+'</span>',(editable?field('instructions','Traveler Instructions',8000,true):'<p class="production-preserve-lines">'+escapeHtml(value.instructions||'No Traveler instruction recorded.')+'</p>'))+'<small data-source-status>'+ (value.instructions===source?'Same as source':'Modified from source')+'</small>','','production-traveler-instruction')+
      row('Substeps',steps.length?disclosure('steps',steps.length+' items · '+view,controlledContent(op,editable,'steps')):'<span class="production-compact-empty">None</span>',editable?opAction('add-substep','+ Add Traveler Substep',op):'')+
      row('Production Notes / Clarifications',clarifications.length||teamNotes.length?disclosure('notes',noteSummary+' · '+view,clarificationContent(op,editable)+'<div class="production-team-lane"><h4>Team Notes</h4><small>Operational context · not controlled instructions</small>'+teamContent(op,'NOTE')+'</div>'):'<span class="production-compact-empty">'+noteSummary+'</span>',(editable?opAction('add-clarification','+ Add Clarification',op):'')+(teamAllowed?opAction('add-team-note','+ Add Production Note',op):''))+
      row('Visuals',list(op.visuals).length||teamVisuals.length||travelerVisuals.length?disclosure('visuals',visualSummary+' · '+view,'<div class="production-visual-lanes"><section><h4>Source Visuals · read-only</h4>'+ (list(op.visuals).map(v=>'<article>'+imageCard(v)+'<small>'+escapeHtml(v.caption||v.name)+'</small></article>').join('')||'<small>No source visuals</small>')+'</section><section><h4>Team Visuals</h4><small>Operational evidence</small>'+teamContent(op,'VISUAL')+'</section><section><h4>Traveler Visuals · controlled</h4>'+controlledContent(op,editable,'visuals')+'</section></div>'):'<span class="production-compact-empty">'+visualSummary+'</span>',(teamAllowed?opAction('add-team-visual','+ Add Team Visual',op):'')+(editable?opAction('add-controlled-visual','+ Add Traveler Visual',op):''),'production-reference-list')+
      row('Work Center / Department',editable?'<div class="production-operation-fields">'+field('workCenter','Work Center',120)+field('department','Department',120)+'</div>':'<span>'+escapeHtml([value.workCenter,value.department].filter(Boolean).join(' / ')||'—')+'</span>','','production-compact-workcenter')+
      '<details class="production-compact-more" data-operation-disclosure="'+escapeHtml(op.id+':more')+'"><summary>More <span>Planning · Technical References · Source Information</span></summary><div class="production-compact-content">'+
      '<section><h4>Planning Reference · read-only</h4><p>'+escapeHtml(estimatingBasis(op))+'</p><small>Frozen Labor v'+escapeHtml(state.package?.source?.laborVersion??'—')+'</small></section>'+
      '<section><h4>Technical References · read-only</h4>'+list(op.technicalReferences).map(r=>link(r.url,r.name)).join('')+(op.inspectionRequirements?'<p class="production-preserve-lines">'+escapeHtml(op.inspectionRequirements)+'</p>':'')+'<small>Controlled technical documents remain authoritative.</small></section>'+
      '<details class="production-source-instruction"><summary>Source Instruction · View original source</summary><small>Read-only · Quoted Labor / Technical Source</small><p class="production-preserve-lines">'+escapeHtml(source)+'</p>'+notes.map(n=>'<p class="production-preserve-lines">'+escapeHtml(n.text)+'</p>').join('')+(op.managementNotes?'<p>'+escapeHtml(op.managementNotes)+'</p>':'')+'</details>'+
      '<details class="production-source-information"><summary>Source Information / History</summary><p>Source seq '+escapeHtml(op.sourceSequence??op.sequence)+' · WO seq '+escapeHtml(op.sequence)+'</p><p>Source operation '+escapeHtml(op.sourceOperationId)+' · Traveler operation '+escapeHtml(op.id)+'</p>'+list(op.clarifications).map(n=>'<p>Clarification · '+escapeHtml(n.createdBy)+' · '+escapeHtml(dateTime(n.createdAt))+' · Updated '+escapeHtml(dateTime(n.updatedAt))+'</p>').join('')+'</details></div></details></div>';
  }

  // Shared presentation only: read-only and draft routes use the same worksheet columns.
  function worksheetHead(editable) {
    return '<div class="production-sheet-head'+(editable?'':' production-sheet-head-readonly')+'">'+(editable?'<span>Grip</span>':'')+'<div class="production-sheet-columns"><span>Seq / Operation</span><span>+</span><span>Instructions / Notes</span><span>Visuals</span><span class="production-sheet-workcenter">Work Center</span><span class="production-sheet-estimate">Estimate</span></div></div>';
  }

  function renderRoute(operations) {
    const active=list(operations).filter(op=>op.classification==='PRODUCTION'&&op.enabled!==false).sort((a,b)=>a.sequence-b.sequence);
    return '<div class="production-worksheet-scroll production-route production-view-sheet" aria-label="Active Production route">' + worksheetHead(false) + active.map(op=>{
      const team=currentTeam(op).filter(n=>n.active), count=visualTotal(op,false);
      return '<div class="production-sheet-operation"><details data-wo-operation="'+escapeHtml(op.id)+'"><summary title="Open operation details / editor"><strong>'+escapeHtml(op.sequence+' · '+op.name)+'</strong></summary>'+renderOperationDetails(op)+'</details>'+operationMenu(op,false)+
        '<span class="production-sheet-preview">'+escapeHtml(operationValues(op).instructions||'—')+(team.length?'<small>'+team.length+' team input'+(team.length===1?'':'s')+'</small>':'')+'</span>'+ (count?'<button type="button" class="production-sheet-visuals" data-production-action="view-operation-visuals" data-operation-id="'+escapeHtml(op.id)+'">'+count+' visual'+(count===1?'':'s')+'</button>':'<span class="production-sheet-visuals">—</span>')+
        '<span class="production-sheet-workcenter" aria-label="'+escapeHtml(operationValues(op).workCenter||operationValues(op).department||'Unassigned')+'">'+escapeHtml(operationValues(op).workCenter||operationValues(op).department||'—')+'</span><span class="production-sheet-estimate">'+escapeHtml(estimatingBasis(op))+'</span></div>';
    }).join('')+'</div>';
  }

  function renderTraveler(data) {
    const def = data.definition, bound = data.boundTraveler;
    const operations = data.effectiveRevision?.operations || (bound ? bound.operations : list(data.operations));
    const prerequisites = list(operations).filter(op => op.classification === "MATERIALS_PREREQUISITE");
    const management = data.canManage === true && !data.executionStarted;
    const printPath = apiPath(data.workOrderNumber) + "/traveler.pdf";
    let controls = "";
    if (!def && management) controls = '<div class="production-governance"><h3>Review source → Create Traveler draft</h3>' +
      '<p>Retain all source operations. Select any Materials prerequisite to exclude from the active Production route.</p>' +
      '<div class="production-seed-choices">' + list(data.operations).map(op => '<label><input type="checkbox" data-production-prerequisite value="' +
        escapeHtml(op.sourceOperationId) + '"> ' + escapeHtml(op.sequence + ' — ' + op.name) + '</label>').join("") + '</div>' +
      button("seed", "Create Traveler Draft", state.busy) + '</div>';
    if (def && !bound && management) controls = '<div class="production-governance"><div class="production-governance-heading"><h3>Traveler Definition · ' +
      escapeHtml(humanStatus(def.status)) + ' · working v' + escapeHtml(def.workingVersion) + '</h3>' +
      (!state.editing ? button("edit", def.status === "APPROVED" ? "Review / Revise Definition" : "Review / Edit Draft", state.busy) : '') +
      (def.status === "DRAFT" && !state.editing ? button("approve", "Approve Traveler Version", state.busy) : '') +
      (def.status === "APPROVED" && !bound ? button("bind", "Bind Approved Traveler to WO", state.busy) : '') +
      '</div><small>Definition ' + escapeHtml(def.id) + (def.approval ? ' · Approved by ' + escapeHtml(def.approval.actor) + ' · ' + escapeHtml(dateTime(def.approval.atUtc)) : '') +
      '</small>' + (bound ? '<p>The WO uses its frozen approved version. Definition revisions do not change this WO Traveler.</p>' : '') +
      (state.editing ? renderEditor(def) : '') + '</div>';
    if (bound) controls = renderWoRevisionControls(data);
    return '<section class="production-labor-worksheet"><div class="production-section-heading"><h3>' + (bound ? 'Effective Traveler v' + escapeHtml(data.effectiveRevision?.version || bound.version) + ' · Approved / Frozen' : 'Traveler Review') +
      '</h3>' + (def ? link(printPath, "Print Traveler — Non-Controlled Copy") : '') + '</div>' +
      (bound ? '<p class="production-muted">' + (data.effectiveRevision?.changeBasis === "WO_SPECIFIC" ? 'WO-Specific Revision' : 'As Quoted') +
        (data.effectiveRevision?.previousRevisionId ? ' · Based on v' + escapeHtml(list(data.travelerRevisions).find(r => r.id === data.effectiveRevision.previousRevisionId)?.version || '—') : '') +
        ' · Frozen Labor v' + escapeHtml(data.source?.laborVersion) + ' · ' + escapeHtml(data.context?.sourceQuote) + ' · Approved ' +
        escapeHtml(dateTime(data.effectiveRevision?.approval?.atUtc || bound.approvedAt)) + ' · ' + escapeHtml(data.effectiveRevision?.approval?.actor || '') + '</p>' : '<p class="production-muted">A reviewed, approved and frozen Traveler is required before Production can be ready.</p>') +
      controls + renderInputPanel() +
      '<div class="production-prerequisite"><strong>Materials Released: ' + escapeHtml(humanStatus(data.materialStatus)) + '</strong>' +
      prerequisites.map(op => '<span>' + escapeHtml(op.sequence + ' — ' + op.name) + ' · Materials prerequisite / excluded from active Production</span>').join("") +
      '</div>' + prerequisites.map(op => '<details class="production-prerequisite-reference"><summary>View retained Materials source · ' +
        escapeHtml(op.sequence + ' ' + op.name) + '</summary>' + renderOperationDetails(op) + '</details>').join("") +
      (!def ? '<h3>Frozen Labor source · review operation classification</h3>' : '') + (state.woEditing ? '' : renderRoute(operations)) + '</section>';
  }

  function revisionGroups(operations) {
    const active = list(operations).filter(o => o.enabled && o.classification === 'PRODUCTION').sort((a, b) => a.sequence - b.sequence);
    return active.filter(o => !o.sourceParentId).map(parent => [parent, ...active.filter(o => o.sourceParentId === parent.sourceOperationId).sort((a, b) => a.sourceSequence - b.sourceSequence)]);
  }

  function moveRevisionGroup(operations, orderedIds, id, direction) {
    const groups = revisionGroups(operations).sort((a, b) => orderedIds.indexOf(a[0].id) - orderedIds.indexOf(b[0].id));
    const index = groups.findIndex(group => group[0].id === id), next = index + direction;
    if (index < 0 || next < 0 || next >= groups.length) return orderedIds;
    [groups[index], groups[next]] = [groups[next], groups[index]];
    return groups.flat().map(o => o.id);
  }

  function insertRevisionGroup(operations, orderedIds, id, targetId, after) {
    const groups = revisionGroups(operations).sort((a, b) => orderedIds.indexOf(a[0].id) - orderedIds.indexOf(b[0].id));
    const moving = groups.find(group => group[0].id === id);
    if (!moving || id === targetId || !groups.some(group => group[0].id === targetId)) return orderedIds;
    const remaining = groups.filter(group => group !== moving);
    remaining.splice(remaining.findIndex(group => group[0].id === targetId) + (after ? 1 : 0), 0, moving);
    return remaining.flat().map(op => op.id);
  }

  function applyRevisionOrder(order, id) {
    if (order.join('|') === state.revisionOrder.join('|')) return;
    state.revisionOrder = order; state.dirty = true; state.revisionReview = false;
    renderManagement();
    const handles = document.querySelectorAll('[data-revision-grip]');
    Array.from(handles).find(el => el.dataset.revisionGrip === id)?.focus({ preventScroll: true });
    const status = document.getElementById('woReorderStatus');
    if (status) status.textContent = 'Operation moved. Unsaved draft order; effective Traveler unchanged.';
  }

  function beginRevisionDrag(event) {
    const handle = event.target?.closest?.('[data-revision-grip]');
    if (!handle || event.button !== 0 || event.isPrimary === false || state.drag || state.busy || !state.woEditing || !state.package?.canEditTraveler) return;
    const row = handle.closest('[data-revision-row]'), listElement = handle.closest('.production-reorder-list');
    if (!row || !listElement) return;
    event.preventDefault(); handle.focus({ preventScroll: true });
    state.drag = { id: handle.dataset.revisionGrip, pointerId: event.pointerId, handle, row, listElement,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, target: null, frame: null };
    handle.setPointerCapture(event.pointerId);
  }

  function revisionDropTarget(drag) {
    drag.listElement.querySelectorAll('[data-revision-row]').forEach(row => { row.classList.remove('drop-before', 'drop-after'); });
    drag.target = null;
    const rect = drag.listElement.getBoundingClientRect();
    if (drag.x < rect.left || drag.x > rect.right || drag.y < Math.max(0, rect.top) || drag.y > Math.min(window.innerHeight, rect.bottom)) return;
    const rows = Array.from(drag.listElement.querySelectorAll('[data-revision-row]'));
    const row = rows.find(el => drag.y < el.getBoundingClientRect().bottom) || rows.at(-1);
    if (!row || row.dataset.revisionRow === drag.id) return;
    const bounds = row.getBoundingClientRect(), after = drag.y >= bounds.top + bounds.height / 2;
    drag.target = { id: row.dataset.revisionRow, after };
    row.classList.add(after ? 'drop-after' : 'drop-before');
  }

  function revisionDragScroll() {
    const drag = state.drag;
    if (!drag?.active) return;
    // Scroll the nearest scrollable ancestor, falling back to the document viewport.
    let scroller = drag.listElement.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(window.getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    scroller ||= document.scrollingElement;
    const bounds = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller?.getBoundingClientRect();
    const listBounds = drag.listElement.getBoundingClientRect();
    if (bounds && drag.x >= listBounds.left && drag.x <= listBounds.right) {
      const top = Math.max(0, bounds.top), bottom = Math.min(window.innerHeight, bounds.bottom);
      const amount = drag.y < top + 48 ? -10 : drag.y > bottom - 48 ? 10 : 0;
      if (amount) { scroller.scrollTop += amount; revisionDropTarget(drag); }
    }
    drag.frame = window.requestAnimationFrame(revisionDragScroll);
  }

  function moveRevisionDrag(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = true; drag.row.classList.add('is-dragging'); drag.listElement.classList.add('is-reordering');
      drag.handle.setAttribute('aria-pressed', 'true');
      drag.frame = window.requestAnimationFrame(revisionDragScroll);
    }
    revisionDropTarget(drag);
  }

  function cancelRevisionDrag() {
    const drag = state.drag;
    if (!drag) return;
    state.drag = null;
    if (drag.frame != null) window.cancelAnimationFrame(drag.frame);
    drag.row.classList.remove('is-dragging'); drag.listElement.classList.remove('is-reordering');
    drag.listElement.querySelectorAll('[data-revision-row]').forEach(row => row.classList.remove('drop-before', 'drop-after'));
    drag.handle.setAttribute('aria-pressed', 'false');
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  }

  function finishRevisionDrag(event, commit) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (commit && drag.active) { drag.x = event.clientX; drag.y = event.clientY; revisionDropTarget(drag); }
    const target = commit && drag.active ? drag.target : null;
    cancelRevisionDrag();
    if (target && state.woEditing && !state.busy && state.package?.canEditTraveler) applyRevisionOrder(
      insertRevisionGroup(state.package.woRevisionDraft.operations, state.revisionOrder, drag.id, target.id, target.after), drag.id);
  }

  function revisionGripKey(event) {
    if (event.key === 'Escape' && state.drag) { event.preventDefault(); cancelRevisionDrag(); return; }
    const handle = event.target?.closest?.('[data-revision-grip]');
    if (!handle || state.busy || !state.woEditing || !state.package?.canEditTraveler || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); cancelRevisionDrag();
    const id = handle.dataset.revisionGrip, operations = state.package.woRevisionDraft.operations;
    const groups = revisionGroups(operations).sort((a, b) => state.revisionOrder.indexOf(a[0].id) - state.revisionOrder.indexOf(b[0].id));
    const order = event.key === 'Home' || event.key === 'End'
      ? insertRevisionGroup(operations, state.revisionOrder, id, (event.key === 'Home' ? groups[0] : groups.at(-1))[0].id, event.key === 'End')
      : moveRevisionGroup(operations, state.revisionOrder, id, event.key === 'ArrowUp' ? -1 : 1);
    applyRevisionOrder(order, id);
  }

  function renderWoRevisionControls(data) {
    const draft = data.woRevisionDraft;
    if (!state.woEditing) return '<div class="production-editor-actions">' +
      (data.canEditTraveler ? button('edit-wo', draft ? 'Resume Edit Traveler' : 'Edit Traveler', state.busy) : '') +
      (draft ? '<span>Draft Traveler v' + escapeHtml(draft.version) + ' · Effective v' + escapeHtml(data.effectiveRevision?.version) + ' unchanged</span>' +
        button('review-wo', 'Review Changes', state.busy) : '') + '</div>' + (draft && state.revisionReview ? renderRevisionDiff(draft) : '');
    if (!draft) return '';
    const groups = revisionGroups(draft.operations).sort((a, b) => state.revisionOrder.indexOf(a[0].id) - state.revisionOrder.indexOf(b[0].id));
    const slots = revisionGroups(draft.operations).map(group => Math.trunc(group[0].sequence)).sort((a, b) => a - b);
    return '<section class="production-wo-editor"><div class="production-wo-banner"><strong>Draft Traveler v' + escapeHtml(draft.version) + ' · WO-Specific Revision</strong><span>Editing WO ' + escapeHtml(data.workOrderNumber) + ' only.</span></div>' +
      '<details class="production-source-information"><summary>Revision details</summary><p>Quote and Labor source remain unchanged.</p><p>Based on effective v' + escapeHtml(data.effectiveRevision?.version) + ' · Revised ' + escapeHtml(dateTime(draft.revisedAt)) + ' · ' + escapeHtml(draft.revisedBy) + ' · Lease expires ' + escapeHtml(dateTime(draft.lease?.expiresAt)) + '</p></details>' +
      '<p id="woGripHelp" class="production-sr-only">Keyboard: focus the grip, then use ↑ / ↓ or Home / End. Escape cancels a drag.</p><span id="woReorderStatus" class="production-sr-only" role="status" aria-live="polite"></span>' +
      '<div class="production-worksheet-scroll">' + worksheetHead(true) +
      '<div class="production-reorder-list">' + groups.map((group, i) => '<div class="production-reorder-row" data-revision-row="' + escapeHtml(group[0].id) + '"><div class="production-reorder-controls">' +
        '<button type="button" class="production-drag-grip" data-revision-grip="' + escapeHtml(group[0].id) + '" aria-label="Reorder ' + escapeHtml(group[0].name) + '" aria-describedby="woGripHelp" aria-pressed="false"' + (state.busy ? ' disabled' : '') + '><span aria-hidden="true">⠿</span></button></div><div>' +
        group.map((op, child) => {
          const notes = state.clarifications.filter(n => n.operationId === op.id), visualCount = visualTotal(op,true);
          const preview = operationValues(op,true).instructions || '—';
          return '<div class="production-sheet-operation' + (child ? ' production-sheet-child' : '') + '"><details data-wo-operation="' + escapeHtml(op.id) + '"><summary title="Open operation details / editor"><strong>' + escapeHtml(slots[i] + child / 100) + ' · ' + escapeHtml(op.name) + '</strong></summary>' +
            renderOperationDetails({ ...op, sequence: slots[i] + child / 100 }, true) + '</details>' +
            operationMenu(op,true) +
            '<span class="production-sheet-preview" title="' + escapeHtml(preview) + '">' + (notes.length ? '<small>WO clarification · ' + notes.length + '</small>' : '') + escapeHtml(preview) + '</span>' +
            (visualCount ? '<button type="button" class="production-sheet-visuals" data-production-action="view-operation-visuals" data-operation-id="' + escapeHtml(op.id) + '">' + visualCount + ' visual' + (visualCount === 1 ? '' : 's') + '</button>' : '<span class="production-sheet-visuals">—</span>') +
            '<span class="production-sheet-workcenter"' + (!operationValues(op,true).workCenter && !operationValues(op,true).department ? ' aria-label="Unassigned"' : '') + '>' + escapeHtml(operationValues(op,true).workCenter || operationValues(op,true).department || '—') + '</span><span class="production-sheet-estimate">' + escapeHtml(estimatingBasis(op)) + '</span></div>';
        }).join('') + '</div></div>').join('') + '</div></div>' +
      '<label>Change reason<textarea id="woRevisionReason" maxlength="2000" rows="2" required' + (state.busy ? ' disabled' : '') + '>' + escapeHtml(state.revisionReason) + '</textarea></label>' +
      '<div class="production-editor-actions production-sticky-actions">' + button('save-wo', 'Save Draft', state.busy) + button('review-wo', 'Review Changes', state.busy || state.dirty || !draft.reason) + button('close-wo', 'Close Editor', state.busy) + link(apiPath(data.workOrderNumber) + '/wo-traveler/draft.pdf', 'Print saved draft') + '<small>' + (state.dirty ? 'Unsaved draft changes' : 'Saved draft · Approval required · Effective v' + escapeHtml(data.effectiveRevision?.version) + ' unchanged') + '</small></div>' +
      (state.revisionReview && !state.dirty ? renderRevisionDiff(draft) +
        (draft.reason && draft.differences?.length === 2 ? '<label class="production-checkbox"><input type="checkbox" id="woRevisionReviewed"> I reviewed both comparisons and the sequence / dependency warnings.</label>' +
          ((list(draft.clarifications).some(n => !n.removed) || list(draft.differences).some(d => list(d.clarifications).length || list(d.content).length) || list(draft.substeps).some(n=>!n.removed) || list(draft.visuals).some(n=>!n.removed)) ? '<label class="production-checkbox"><input type="checkbox" id="woTechnicalReviewed"> I reviewed these WO-specific instructions for consistency with controlled technical requirements.</label>' : '') +
          button('approve-wo', 'Approve & Make Effective', state.busy) : '') : '') + '</section>';
  }

  function renderRevisionDiff(revision) {
    return '<section class="production-revision-comparison"><h3>Review Changes · Traveler v' + escapeHtml(revision.version) + '</h3><p>Reason: ' + escapeHtml(revision.reason || (revision.changeBasis === 'AS_QUOTED' ? 'As-quoted frozen baseline' : 'Not saved yet')) +
      '</p><small>' + escapeHtml(revision.revisedBy) + ' · ' + escapeHtml(dateTime(revision.revisedAt)) + '</small>' +
      list(revision.differences).map((diff, i) => '<details' + (i === 0 ? ' open' : '') + '><summary>' + (i === 0 ? 'Previous Effective' : 'As-Quoted Baseline') +
        ' v' + escapeHtml(diff.baselineVersion) + ' → v' + escapeHtml(revision.version) + '</summary><p>' + escapeHtml(diff.summary) + '</p>' + (list(diff.operations).some(op => op.changed) ? '<div class="production-table-scroll"><table class="production-diff-table"><thead><tr>' +
        '<th>Operation</th><th>Source seq</th><th>WO position</th><th>WO seq</th><th>Change</th></tr></thead><tbody>' + list(diff.operations).filter(op => op.changed).map(op => '<tr><td>' + escapeHtml(op.name) +
          '</td><td>' + escapeHtml(op.sourceSequence) + '</td><td>' + escapeHtml(op.previousPosition) + ' → ' + escapeHtml(op.proposedPosition) + '</td><td>' + escapeHtml(op.previousSequence) + ' → ' + escapeHtml(op.proposedSequence) +
          '</td><td>' + (op.changed ? 'Operation reordered' : 'Unchanged') + '</td></tr>').join('') + '</tbody></table></div>' : '') + list(diff.clarifications).map(n => '<section class="production-clarification-diff"><strong>' + escapeHtml(n.name) + ' · Clarification ' + escapeHtml(humanStatus(n.action)) + '</strong>' + (n.before != null ? '<p class="production-preserve-lines">Before: ' + escapeHtml(n.before||'—') + '</p>' : '') + (n.after != null ? '<p class="production-preserve-lines">After: ' + escapeHtml(n.after||'—') + '</p>' : '') + '</section>').join('') + list(diff.content).map(n=>'<section class="production-clarification-diff"><strong>' + escapeHtml(n.name) + ' · ' + escapeHtml(humanStatus(n.kind) + ' · ' + humanStatus(n.action)) + '</strong>' + (n.before != null ? '<p>Before: ' + escapeHtml(n.before||'—') + '</p>' : '') + (n.after != null ? '<p>After: ' + escapeHtml(n.after||'—') + '</p>' : '') + '</section>').join('') + '</details>').join('') +
      (list(revision.warnings).length ? '<div class="production-validation"><strong>REVIEW WARNING · Sequence-sensitive instructions</strong><p>Confirm the proposed order honors these retained requirements. Frozen source requirements remain unchanged.</p>' +
        list(revision.warnings).map(w => '<details><summary>' + escapeHtml(w.name) + '</summary><p class="production-preserve-lines">' + escapeHtml(w.evidence) + '</p></details>').join('') + '</div>' : '') + '</section>';
  }

  async function handleWoRevision(action, element) {
    if (!state.package?.canEditTraveler) return;
    if (action === 'add-clarification' || action === 'remove-clarification') {
      if (!state.woEditing || state.busy) return;
      const op = list(state.package.woRevisionDraft.operations).find(o => o.id === element.dataset.operationId && o.enabled && o.classification === 'PRODUCTION');
      if (action === 'add-clarification' && op) {
        const id = window.crypto.randomUUID(); state.clarifications.push({ id, operationId: op.id, text: '' });
        state.dirty = true; state.revisionReview = false; renderManagement();
        openOperationDisclosure(op.id,'notes');
        const editor = document.getElementById('clarification-' + id); const details = editor?.closest('details'); if (details) details.open = true; editor?.focus();
      } else if (action === 'remove-clarification') {
        state.clarifications = state.clarifications.filter(n => n.id !== element.dataset.clarificationId); state.dirty = true; state.revisionReview = false; renderManagement();
      }
      return;
    }
    if (action === 'edit-wo') {
      if (!discardEdits()) return;
      const result = await command('/wo-traveler/edit', { expectedWorkingVersion: state.package.woRevisionWorkingVersion, effectiveRevisionId: state.package.effectiveRevision.id });
      if (result) { state.woEditing = true; state.revisionReview = false; state.revisionOrder = list(result.woRevisionDraft.operations).filter(o => o.enabled && o.classification === 'PRODUCTION').sort((a, b) => a.sequence - b.sequence).map(o => o.id); state.revisionReason = result.woRevisionDraft.reason; loadAuthoring(result.woRevisionDraft); }
    } else if (action === 'move-up' || action === 'move-down') {
      applyRevisionOrder(moveRevisionGroup(state.package.woRevisionDraft.operations, state.revisionOrder, element.dataset.operationId, action === 'move-up' ? -1 : 1), element.dataset.operationId);
      return;
    } else if (action === 'save-wo') {
      if (state.clarifications.concat(state.substeps).some(n => !n.text.trim())) { state.message = 'Enter clarification text or remove the empty clarification before saving.'; renderManagement(); return; }
      if (!state.revisionReason.trim()) { state.message = 'Enter a change reason before saving the draft.'; renderManagement(); return; }
      const draft = state.package.woRevisionDraft;
      const result = await command('/wo-traveler/draft', { expectedWorkingVersion: state.package.woRevisionWorkingVersion, revisionId: draft.id, leaseId: draft.lease.id,
        reason: state.revisionReason, orderedOperationIds: state.revisionOrder, clarifications: state.clarifications.map(({ id, operationId, text, teamSource }) => ({ id, operationId, text, teamSource })), substeps: state.substeps.map(({id,operationId,order,text})=>({id,operationId,order,text})), operationContent: state.operationContent, visuals: state.travelerVisuals.map(({id,operationId,assetId,caption,teamSource,supersedesId})=>({id,operationId,assetId,caption,teamSource,supersedesId})) }, 'PUT');
      if (result) { loadAuthoring(result.woRevisionDraft); state.revisionReview = true; state.message = 'WO draft saved. The effective Traveler is unchanged.'; }
    } else if (action === 'approve-wo') {
      if (state.dirty || !document.getElementById('woRevisionReviewed')?.checked) { state.message = 'Save changes and review both comparisons and warnings before approval.'; renderManagement(); return; }
      const draft = state.package.woRevisionDraft;
      if ((list(draft.clarifications).some(n => !n.removed) || list(draft.differences).some(d => list(d.clarifications).length || list(d.content).length) || list(draft.substeps).some(n=>!n.removed) || list(draft.visuals).some(n=>!n.removed)) && !document.getElementById('woTechnicalReviewed')?.checked) { state.message = 'Review WO-specific content for consistency with controlled technical requirements before approval.'; renderManagement(); return; }
      const result = await command('/wo-traveler/approve', { expectedWorkingVersion: state.package.woRevisionWorkingVersion, revisionId: draft.id, leaseId: draft.lease.id, warningsReviewed: true, technicalConsistencyReviewed: !!document.getElementById('woTechnicalReviewed')?.checked });
      if (result) { state.woEditing = false; state.revisionReview = false; state.message = 'Traveler v' + result.effectiveRevision.version + ' approved and effective for this WO. Production has not started.'; }
    }
    renderManagement(); renderQueues();
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
    return '<h3>Traveler History</h3><p class="production-muted">Immutable approved revisions and append-only review history.</p>' +
      '<div class="production-revision-history">' + list(data.travelerRevisions).map(r => '<div><strong>Traveler v' + escapeHtml(r.version) +
        ' · ' + (r.changeBasis === "AS_QUOTED" ? 'As Quoted' : 'WO-Specific Revision') + ' · ' + (r.effective ? 'Effective' : 'Superseded') + '</strong><small>' +
        escapeHtml(r.createdBy) + ' · Created ' + escapeHtml(dateTime(r.createdAt)) + ' · Approved ' + escapeHtml(dateTime(r.approval?.atUtc)) + '</small><p>' + escapeHtml(r.reason) +
        '</p><button type="button" data-production-action="inspect-revision" data-revision-id="' + escapeHtml(r.id) + '"' + (state.busy ? ' disabled' : '') + '>View Traveler v' + escapeHtml(r.version) + '</button></div>').join('') + '</div>' +
      (state.inspectedRevision ? '<section class="production-governance"><h3>Traveler v' + escapeHtml(state.inspectedRevision.version) + ' · Historical snapshot / Read-only</h3>' +
        renderRevisionDiff(state.inspectedRevision) + renderRoute(state.inspectedRevision.operations) + '</section>' : '') +
      '<ol class="production-history">' + [...list(data.history), ...list(data.woRevisionHistory)].map(item => '<li><strong>' + escapeHtml(humanStatus(item.type || item.action || item.eventType)) +
        '</strong><span>' + escapeHtml(item.actor || item.reviewedBy || item.actorId) + ' · ' + escapeHtml(dateTime(item.atUtc || item.timestamp)) +
        (item.workingVersion != null ? ' · working v' + escapeHtml(item.workingVersion) : '') +
        '</span>' + (item.action?.startsWith('WO_CLARIFICATION_') ? '<p>' + escapeHtml(item.detail?.name || '') + ' · ' + escapeHtml(item.detail?.after || item.detail?.before || '') + '</p>' : '') + (item.reason || item.detail?.reason ? '<p>' + escapeHtml(item.reason || item.detail.reason) + '</p>' : '') + '</li>').join("") + '</ol>';
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

  async function handleAction(action, element) {
    if (state.busy) return;
    if (action === "back") { if (!discardEdits()) return; state.selectedWo = ""; state.editing = false; state.woEditing = false; state.inspectedRevision = null; ++state.detailRequest; renderManagement(); renderQueues(); return; }
    if (action === "refresh-detail") return refreshDetail();
    if (action === "show-bom") { state.panel = "bom"; renderManagement(); return; }
    if (action === "cancel-edit") { if (!discardEdits()) return; state.editing = false; renderManagement(); return; }
    if (action === "inspect-revision") {
      state.busy = true; try { state.inspectedRevision = await request(state.selectedWo, '/wo-traveler/revisions/' + encodeURIComponent(element.dataset.revisionId)); }
      catch (error) { state.message = error.message; } finally { state.busy = false; renderManagement(); } return;
    }
    if (action === "review-wo") { state.revisionReview = true; renderManagement(); return; }
    if (action === "close-wo") { if (!discardEdits()) return; state.woEditing = false; state.revisionReview = false; renderManagement(); return; }
    if (await handleAuthoringAction(action, element)) return;
    if (action === 'view-operation-visuals') {
      const row = document.querySelector('[data-wo-operation="' + element.dataset.operationId + '"]');
      if (row) { openOperationDisclosure(element.dataset.operationId,'visuals'); row.querySelector('.production-reference-list')?.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    if (!canManage()) return;
    if (["edit-wo", "save-wo", "approve-wo", "move-up", "move-down", "add-clarification", "remove-clarification"].includes(action)) return handleWoRevision(action, element);
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
    renderManagementHtml, renderRoute, renderBom, renderOperationDetails, humanStatus,
    renderRevisionDiff, renderWoRevisionControls, moveRevisionGroup, revisionGroups, insertRevisionGroup
  });
})(window, document);

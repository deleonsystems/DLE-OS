(function registerTechnicalReviewWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "technical-review";
  const TEMPLATE_PATH = "SRC/workspaces/technical-review/technical-review-workspace.html";
  const state = { items: [], selected: null, loading: false, saving: false, error: "", message: "", messageState: "" };
  let mount = null;
  let interactionsBound = false;

  async function renderWorkspace() {
    mount = document.querySelector('[data-workspace-mount="' + WORKSPACE_ID + '"]');
    if (!mount) return;
    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Technical Review</h3><p>Preparing the trained review queue…</p></div>';
      try {
        const response = await window.fetch(TEMPLATE_PATH, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("Technical Review workspace returned HTTP " + response.status + ".");
        mount.innerHTML = await response.text();
        mount.dataset.workspaceLoaded = "true";
        bindInteractions();
      } catch (error) {
        mount.dataset.workspaceLoaded = "false";
        mount.innerHTML = '<div class="technical-review-error" role="alert">' + escapeHtml(error?.message || "Technical Review could not load.") + '</div>';
        return;
      }
    }
    await loadQueue();
  }

  function bindInteractions() {
    if (interactionsBound || !mount) return;
    interactionsBound = true;
    mount.addEventListener("click", event => {
      const action = event.target.closest?.("[data-technical-review-action]")?.dataset.technicalReviewAction;
      if (action === "refresh") void loadQueue();
      if (action === "back") showQueue();
      const row = event.target.closest?.("[data-technical-review-intake]");
      if (row) void openReview(row.dataset.technicalReviewIntake);
    });
    mount.addEventListener("change", event => {
      if (event.target?.name === "materialResponsibility") updateCustomerSupplyVisibility();
    });
    mount.addEventListener("submit", event => {
      if (!event.target.matches?.("[data-technical-review-form]")) return;
      event.preventDefault();
      void saveDisposition(event.target);
    });
  }

  async function loadQueue() {
    if (state.loading) return;
    state.loading = true;
    state.error = "";
    setStatus("Loading review queue…", "");
    const host = document.getElementById("technicalReviewQueue");
    if (host) host.innerHTML = '<div class="technical-review-empty">Loading Technical Review items…</div>';
    try {
      const payload = await fetchJson("/api/sim/technical-reviews");
      state.items = Array.isArray(payload.items) ? payload.items : [];
      renderQueue();
      setStatus("Technical Review queue current", "ready");
    } catch (error) {
      state.items = [];
      state.error = error?.message || "Technical Review queue is unavailable.";
      if (host) host.innerHTML = '<div class="technical-review-error" role="alert">' + escapeHtml(state.error) + '</div>';
      setStatus("Technical Review unavailable", "error");
    } finally {
      state.loading = false;
    }
  }

  function renderQueue() {
    const host = document.getElementById("technicalReviewQueue");
    const count = document.getElementById("technicalReviewQueueCount");
    if (count) count.textContent = String(state.items.length);
    if (!host) return;
    if (!state.items.length) {
      host.innerHTML = '<div class="technical-review-empty">No RFQ Reviews are currently in the Technical Review queue.</div>';
      return;
    }
    host.innerHTML = state.items.map(renderQueueRow).join("");
  }

  function renderQueueRow(item) {
    const assembly = item.assembly || {};
    const qualified = item.status === "READY_FOR_RFQ_WORKING_QUEUE";
    return '<button type="button" class="technical-review-row" data-technical-review-intake="' + escapeHtml(item.intakeId) + '">' +
      queueCell("Review Type", item.reviewTypeLabel || "RFQ Review", true) +
      queueCell("Intake ID", item.intakeId, true) +
      queueCell("Customer", item.customer?.customerName || "—", true) +
      queueCell("Assembly", assembly.assemblyNumber || "—", true) +
      queueCell("Revision", assembly.revision || "—", true) +
      queueCell("Qty", assembly.quantity ?? "—", true) +
      queueCell("Received", formatDateTime(item.createdAtUtc)) +
      queueCell("Technical documents", documentStateLabel(item.documentPreservationState)) +
      '<span class="technical-review-cell"><small>Review status</small><strong class="technical-review-state" data-state="' + (qualified ? "qualified" : "open") + '">' + escapeHtml(item.reviewStatusLabel) + '</strong></span>' +
      '<span class="technical-review-arrow" aria-hidden="true">→</span></button>';
  }

  function queueCell(label, value, strong) {
    return '<span class="technical-review-cell"><small>' + escapeHtml(label) + '</small><' + (strong ? "strong" : "span") + '>' + escapeHtml(value) + '</' + (strong ? "strong" : "span") + '></span>';
  }

  async function openReview(intakeId) {
    setStatus("Opening " + intakeId + "…", "");
    try {
      state.selected = await fetchJson("/api/sim/technical-reviews/" + encodeURIComponent(intakeId));
      state.message = "";
      state.messageState = "";
      renderDetail();
      document.getElementById("technicalReviewQueueView").hidden = true;
      document.getElementById("technicalReviewDetailView").hidden = false;
      setStatus(state.selected.reviewStatusLabel, "ready");
      document.getElementById("technicalReviewDetailTitle")?.focus?.();
    } catch (error) {
      state.error = error?.message || "The RFQ Review could not be opened.";
      setStatus("Unable to open review", "error");
    }
  }

  function showQueue() {
    state.selected = null;
    state.message = "";
    document.getElementById("technicalReviewDetailView").hidden = true;
    document.getElementById("technicalReviewQueueView").hidden = false;
    setStatus("Technical Review queue current", "ready");
  }

  function renderDetail() {
    const host = document.getElementById("technicalReviewDetail");
    const envelope = state.selected || {};
    const record = envelope.record || {};
    const assembly = record.assemblies?.[0] || {};
    const review = record.technicalReview || {};
    const files = Array.isArray(record.technicalFiles) ? record.technicalFiles : [];
    const responsibility = review.materialResponsibility || "FULL_TURNKEY";
    const canDisposition = window.DleOsCapabilities?.can?.("technical_review.disposition") === true;
    if (!host) return;
    host.innerHTML = '<header class="technical-review-detail-header"><div><p class="technical-review-eyebrow">RFQ REVIEW · ' + escapeHtml(record.intakeId) + '</p>' +
      '<h2 id="technicalReviewDetailTitle" tabindex="-1">' + escapeHtml(record.customer?.customerName || "Customer") + ' · ' + escapeHtml(assembly.assemblyNumber || "Assembly") + '</h2>' +
      '<p>Do we have enough correct and current technical information to safely begin quotation?</p></div>' +
      '<span class="technical-review-status-pill">' + escapeHtml(envelope.reviewStatusLabel || "Needs Technical Review") + '</span></header>' +
      '<div class="technical-review-summary-grid">' + summaryCard("Customer", record.customer?.customerName) + summaryCard("Assembly", assembly.assemblyNumber) +
      summaryCard("Revision", assembly.revision) + summaryCard("Quantity", assembly.quantity) + summaryCard("DLE scope", scopeLabel(record.deLeonScope)) +
      summaryCard("Customer requires", requirementLabel(record.customerRequirements)) + '</div>' +
      '<div class="technical-review-limitation"><strong>Document metadata only.</strong> Filenames are preserved for association, but governed binary placement and document viewing are not available in this SIM phase. Confirm document contents at the source before dispositioning the review.</div>' +
      (review.downstreamHandoffState ? '<div class="technical-review-handoff"><strong>Persisted RFQ handoff established</strong><span>' + escapeHtml(review.downstreamHandoffTarget) + ' · ' + escapeHtml(review.downstreamHandoffState) + '. No Materials, Labor, pricing, lead-time, or customer-response work was started.</span></div>' : '') +
      '<form class="technical-review-form" data-technical-review-form>' +
      '<section class="technical-review-card"><h3>1. Confirm assembly identity and type</h3><p>Compare the request and source package before continuing.</p><div class="technical-review-field-grid">' +
      readOnlyField("Requested assembly", assembly.assemblyNumber) + readOnlyField("Requested revision", assembly.revision) +
      '<label class="technical-review-field"><span>Assembly Type</span><select name="assemblyType" required><option value="PCB_ASSEMBLY" selected>PCB Assembly</option></select></label></div></section>' +
      '<section class="technical-review-card"><h3>2. Identify governing technical documents</h3><p>PCB Assembly qualification normally requires an Assembly Drawing and BOM.</p>' +
      '<div class="technical-review-field-grid"><label class="technical-review-field"><span>Assembly Drawing</span><select name="assemblyDrawingFile"><option value="">Not identified</option>' + fileOptions(files, review.assemblyDrawingFile) + '</select></label>' +
      '<label class="technical-review-field"><span>BOM</span><select name="bomFile"><option value="">Not identified</option>' + fileOptions(files, review.bomFile) + '</select></label></div>' +
      '<fieldset class="technical-review-fieldset"><legend>Available customer technical-file metadata</legend><div class="technical-review-files">' + renderFiles(files, review) + '</div></fieldset></section>' +
      '<section class="technical-review-card"><h3>3. Establish material responsibility</h3><p>Preserve the boundary between De Leon and customer-supplied material for the future RFQ workspace.</p>' +
      '<fieldset class="technical-review-fieldset"><legend>Quote responsibility</legend><div class="technical-review-choice-grid">' +
      choice("materialResponsibility", "FULL_TURNKEY", "Full turnkey", responsibility) + choice("materialResponsibility", "CUSTOMER_SUPPLIED", "Customer-supplied material", responsibility) + choice("materialResponsibility", "HYBRID", "Hybrid / partially customer-supplied", responsibility) + '</div></fieldset>' +
      '<label class="technical-review-field technical-review-customer-supply" data-customer-supply ' + (responsibility === "FULL_TURNKEY" ? "hidden" : "") + '><span>Customer-supplied items or responsibility boundary</span><textarea name="customerSuppliedItems" placeholder="Enter one item or responsibility per line">' + escapeHtml((review.customerSuppliedItems || []).join("\n")) + '</textarea></label></section>' +
      '<section class="technical-review-card"><h3>4. Determine sufficiency and disposition</h3><p>Missing required Gerbers must prevent qualification when Gerbers are needed for a full-turnkey PCB package.</p>' +
      '<label class="technical-review-choice"><input type="checkbox" name="gerbersRequired" ' + (review.gerbersRequired ? "checked" : "") + '><span>Gerbers are required for this RFQ scope</span></label>' +
      '<div class="technical-review-field-grid"><label class="technical-review-field"><span>Is the technical package sufficient?</span><select name="technicalPackageSufficient" required>' +
      option("", "Select…", review.technicalPackageSufficient === undefined ? "" : String(review.technicalPackageSufficient)) + option("true", "Yes — sufficient", String(review.technicalPackageSufficient)) + option("false", "No — clarification or documents required", String(review.technicalPackageSufficient)) + '</select></label>' +
      '<label class="technical-review-field"><span>Disposition</span><select name="disposition" required><option value="">Select disposition…</option>' + dispositionOptions(review.disposition) + '</select></label></div>' +
      '<label class="technical-review-field"><span>Reviewer notes</span><textarea name="reviewerNotes" placeholder="Record clarification, missing data, conflicts, or escalation context">' + escapeHtml(review.reviewerNotes || "") + '</textarea></label></section>' +
      '<div class="technical-review-actions"><p class="technical-review-message" data-state="' + escapeHtml(state.messageState) + '" role="status">' + escapeHtml(state.message) + '</p>' +
      '<button type="submit" class="technical-review-primary" ' + (!canDisposition || state.saving ? "disabled" : "") + '>' + (state.saving ? "Saving…" : canDisposition ? "Save Technical Review disposition" : "Disposition permission required") + '</button></div></form>';
    updateCustomerSupplyVisibility();
  }

  function renderFiles(files, review) {
    if (!files.length) return '<div class="technical-review-empty">No customer technical-file metadata was provided.</div>';
    return files.map(file => '<div class="technical-review-file"><span><strong>' + escapeHtml(file.name) + '</strong><small>' + escapeHtml(formatBytes(file.size)) + '</small></span>' +
      fileCheck("gerberFiles", file.name, "Gerber", review.gerberFiles) + fileCheck("subAssemblyDocuments", file.name, "Sub-assembly document", review.subAssemblyDocuments) + '</div>').join("");
  }

  function fileCheck(name, value, label, selected) {
    return '<label class="technical-review-file-choice"><input type="checkbox" name="' + name + '" value="' + escapeHtml(value) + '" ' + ((selected || []).includes(value) ? "checked" : "") + '><span>' + label + '</span></label>';
  }

  function fileOptions(files, selected) {
    return files.map(file => option(file.name, file.name, selected || "")).join("");
  }

  function dispositionOptions(selected) {
    return [
      ["QUALIFIED_READY_FOR_RFQ", "Qualified — Ready for RFQ"],
      ["NEEDS_CUSTOMER_CLARIFICATION", "Needs Customer Clarification"],
      ["MISSING_TECHNICAL_DOCUMENTS", "Missing Technical Documents"],
      ["REVISION_DOCUMENT_CONFLICT", "Revision / Document Conflict"],
      ["BLOCKED_NEEDS_ESCALATION", "Blocked / Needs Escalation"]
    ].map(entry => option(entry[0], entry[1], selected || "")).join("");
  }

  function option(value, label, selected) {
    return '<option value="' + escapeHtml(value) + '" ' + (String(value) === String(selected) ? "selected" : "") + '>' + escapeHtml(label) + '</option>';
  }

  function choice(name, value, label, selected) {
    return '<label class="technical-review-choice"><input type="radio" name="' + name + '" value="' + value + '" ' + (value === selected ? "checked" : "") + ' required><span>' + label + '</span></label>';
  }

  function updateCustomerSupplyVisibility() {
    const selected = mount?.querySelector('[name="materialResponsibility"]:checked')?.value;
    const field = mount?.querySelector("[data-customer-supply]");
    if (field) field.hidden = selected === "FULL_TURNKEY";
  }

  async function saveDisposition(form) {
    if (state.saving || !state.selected?.record?.intakeId) return;
    const payload = buildDispositionPayload(form);
    state.saving = true;
    state.message = "Saving governed Technical Review state…";
    state.messageState = "";
    renderDetail();
    try {
      state.selected = await fetchJson("/api/sim/technical-reviews/" + encodeURIComponent(state.selected.record.intakeId) + "/disposition", {
        method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload)
      });
      state.message = state.selected.record.status === "READY_FOR_RFQ_WORKING_QUEUE"
        ? "Qualified and persisted for the future RFQs working queue."
        : "Technical Review disposition persisted.";
      state.messageState = "success";
      await refreshQueueModel();
      setStatus(state.selected.reviewStatusLabel, "ready");
    } catch (error) {
      state.message = error?.message || "Technical Review disposition could not be saved.";
      state.messageState = "error";
      setStatus("Review requires attention", "error");
    } finally {
      state.saving = false;
      renderDetail();
    }
  }

  function buildDispositionPayload(form) {
    const data = new FormData(form);
    return {
      assemblyType: data.get("assemblyType"),
      assemblyDrawingFile: data.get("assemblyDrawingFile"),
      bomFile: data.get("bomFile"),
      gerbersRequired: data.get("gerbersRequired") === "on",
      gerberFiles: data.getAll("gerberFiles"),
      subAssemblyDocuments: data.getAll("subAssemblyDocuments"),
      materialResponsibility: data.get("materialResponsibility"),
      customerSuppliedItems: String(data.get("customerSuppliedItems") || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean),
      technicalPackageSufficient: data.get("technicalPackageSufficient") === "true",
      disposition: data.get("disposition"),
      reviewerNotes: data.get("reviewerNotes")
    };
  }

  async function refreshQueueModel() {
    try {
      const payload = await fetchJson("/api/sim/technical-reviews");
      state.items = Array.isArray(payload.items) ? payload.items : [];
      renderQueue();
    } catch (_) { /* saved detail remains authoritative for this view */ }
  }

  async function fetchJson(url, options) {
    const response = await window.fetch(url, { credentials: "include", cache: "no-store", ...(options || {}) });
    let body = null;
    try { body = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok) throw new Error(body?.message || "SIM returned HTTP " + response.status + ".");
    return body;
  }

  function setStatus(message, status) {
    const target = document.getElementById("technicalReviewWorkspaceStatus");
    if (!target) return;
    target.textContent = message;
    target.dataset.state = status || "";
  }

  function summaryCard(label, value) { return '<div class="technical-review-summary-card"><small>' + escapeHtml(label) + '</small><strong>' + escapeHtml(value ?? "—") + '</strong></div>'; }
  function readOnlyField(label, value) { return '<div class="technical-review-summary-card"><small>' + escapeHtml(label) + '</small><strong>' + escapeHtml(value ?? "—") + '</strong></div>'; }
  function scopeLabel(value) { return ({ MATERIAL_AND_LABOR: "Material + Labor", MATERIAL_ONLY: "Material only", LABOR_ONLY: "Labor only" })[value] || value || "—"; }
  function requirementLabel(values) { return (values || []).map(value => ({ PRICE: "Price", LEAD_TIME: "Lead Time" })[value] || value).join(" + ") || "—"; }
  function documentStateLabel(value) { return value === "METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED" ? "Metadata preserved · source placement required" : value === "NOT_PROVIDED" ? "Not provided" : value || "Unknown"; }
  function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value || "—" : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" }); }
  function formatBytes(value) { const size = Number(value || 0); return size < 1024 ? size + " B" : size < 1048576 ? (size / 1024).toFixed(1) + " KB" : (size / 1048576).toFixed(1) + " MB"; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }

  document.addEventListener("dle:workspace-navigation", event => {
    if (event.detail?.workspace?.id !== WORKSPACE_ID || !event.detail?.requestedState?.intakeId) return;
    void openReview(event.detail.requestedState.intakeId);
  });
  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({ id: WORKSPACE_ID, render: renderWorkspace, refresh: loadQueue, openReview });
})(window, document);

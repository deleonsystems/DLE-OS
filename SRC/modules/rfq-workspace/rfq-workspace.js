(function registerRfqWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "rfq-quoting";
  const TEMPLATE_PATH = "SRC/modules/rfq-workspace/rfq-workspace.html";
  const RFQ_INTAKE_TYPE = "RFQ / Quote Request";
  const LINE_FIELDS = new Set(["assemblyNumber", "revision", "requestedQuantities", "notes"]);
  const state = createInitialState();
  let mount = null;
  let eventsBound = false;

  function createInitialState(options = {}) {
    const today = new Date();
    const responseDate = new Date(today);
    responseDate.setDate(today.getDate() + 7);

    return {
      intakeType: options.intakeType || "",
      view: options.intakeType ? "edit" : "selection",
      package: {
        customer: "",
        receivedDate: formatDate(today),
        requestedResponseDate: formatDate(responseDate),
        customerReference: "",
        generalNotes: "",
        files: []
      },
      lines: [],
      nextLineId: 1,
      committedRfq: null,
      errors: []
    };
  }

  async function loadRfqWorkspace() {
    mount = document.querySelector('[data-workspace-mount="' + WORKSPACE_ID + '"]');
    if (!mount) return;

    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading RFQ Workspace</h3><p>Preparing Document Intake...</p></div>';
      const response = await fetch(TEMPLATE_PATH);
      if (!response.ok) throw new Error("Unable to load RFQ Workspace.");

      mount.innerHTML = await response.text();
      mount.dataset.workspaceLoaded = "true";
    }

    bindEvents();
    render();
  }

  function bindEvents() {
    if (!mount || eventsBound) return;
    mount.querySelector('[data-rfq-field="intakeType"]')?.addEventListener("change", handleIntakeTypeChange);
    mount.addEventListener("click", handleClick);
    mount.addEventListener("input", handleInput);
    mount.addEventListener("change", handleChange);
    mount.addEventListener("keydown", handleKeydown);
    mount.addEventListener("dragenter", handleDragEnter);
    mount.addEventListener("dragover", handleDragEnter);
    mount.addEventListener("dragleave", handleDragLeave);
    mount.addEventListener("drop", handleDrop);
    eventsBound = true;
  }

  function handleIntakeTypeChange(event) {
    selectIntakeType(event.currentTarget.value);
  }

  function handleClick(event) {
    const dropZone = event.target.closest("[data-rfq-drop-zone]");
    if (dropZone) {
      openFilePicker(dropZone);
      return;
    }

    const actionTarget = event.target.closest("[data-rfq-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.rfqAction;
    const lineId = Number(actionTarget.dataset.rfqLineId);
    const fileIndex = Number(actionTarget.dataset.rfqFileIndex);

    if (action === "change-intake") resetWorkspace("");
    if (action === "start-over") resetWorkspace(RFQ_INTAKE_TYPE);
    if (action === "new-intake") resetWorkspace(RFQ_INTAKE_TYPE);
    if (action === "add-line") addLine();
    if (action === "toggle-line") toggleLine(lineId);
    if (action === "remove-line") removeLine(lineId);
    if (action === "remove-package-file") removePackageFile(fileIndex);
    if (action === "remove-line-file") removeLineFile(lineId, fileIndex);
    if (action === "review") openReview();
    if (action === "back-to-edit") setView("edit");
    if (action === "commit") commitIntake();
  }

  function handleInput(event) {
    const field = event.target.dataset.rfqField;
    if (field && field !== "intakeType" && Object.prototype.hasOwnProperty.call(state.package, field)) {
      state.package[field] = event.target.value;
      clearValidation();
      return;
    }

    const lineField = event.target.dataset.rfqLineField;
    const lineId = Number(event.target.dataset.rfqLineId);
    if (!LINE_FIELDS.has(lineField)) return;
    const line = getLine(lineId);
    if (!line) return;
    line[lineField] = event.target.value;
    clearValidation();
    updateLineSummary(line);
  }

  function handleChange(event) {
    if (event.target.dataset.rfqField === "intakeType") return;

    const inputType = event.target.dataset.rfqFileInput;
    if (!inputType) return;
    const lineId = Number(event.target.dataset.rfqLineId);
    addFiles(inputType, event.target.files, lineId);
    event.target.value = "";
  }

  function handleKeydown(event) {
    const dropZone = event.target.closest("[data-rfq-drop-zone]");
    if (!dropZone || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openFilePicker(dropZone);
  }

  function handleDragEnter(event) {
    const dropZone = event.target.closest("[data-rfq-drop-zone]");
    if (!dropZone) return;
    event.preventDefault();
    dropZone.classList.add("drag-over");
  }

  function handleDragLeave(event) {
    const dropZone = event.target.closest("[data-rfq-drop-zone]");
    if (!dropZone) return;
    event.preventDefault();
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("drag-over");
  }

  function handleDrop(event) {
    const dropZone = event.target.closest("[data-rfq-drop-zone]");
    if (!dropZone) return;
    event.preventDefault();
    dropZone.classList.remove("drag-over");
    addFiles(dropZone.dataset.rfqDropZone, event.dataTransfer?.files, Number(dropZone.dataset.rfqLineId));
  }

  function selectIntakeType(value) {
    resetWorkspace(value === RFQ_INTAKE_TYPE ? RFQ_INTAKE_TYPE : "");
  }

  function resetWorkspace(intakeType) {
    const replacement = createInitialState({ intakeType });
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, replacement);
    render();
  }

  function addLine() {
    const line = {
      id: state.nextLineId++,
      assemblyNumber: "",
      revision: "",
      requestedQuantities: "",
      notes: "",
      files: [],
      collapsed: false
    };
    state.lines.push(line);
    clearValidation();
    renderLines();
    requestAnimationFrame(() => {
      mount?.querySelector('[data-rfq-line-id="' + line.id + '"][data-rfq-line-field="assemblyNumber"]')?.focus();
    });
  }

  function toggleLine(lineId) {
    const line = getLine(lineId);
    if (!line) return;
    line.collapsed = !line.collapsed;
    renderLines();
  }

  function removeLine(lineId) {
    const lineIndex = state.lines.findIndex(line => line.id === lineId);
    if (lineIndex < 0) return;
    state.lines.splice(lineIndex, 1);
    clearValidation();
    renderLines();
  }

  function updateLineSummary(line) {
    const summary = mount?.querySelector('[data-rfq-line-summary="' + line.id + '"]');
    if (!summary) return;
    summary.innerHTML = buildLineSummary(line, state.lines.indexOf(line) + 1);
  }

  function getLine(lineId) {
    return state.lines.find(line => line.id === lineId) || null;
  }

  function openFilePicker(dropZone) {
    const type = dropZone.dataset.rfqDropZone;
    const lineId = dropZone.dataset.rfqLineId;
    const selector = type === "package"
      ? '[data-rfq-file-input="package"]'
      : '[data-rfq-file-input="line"][data-rfq-line-id="' + lineId + '"]';
    mount?.querySelector(selector)?.click();
  }

  function addFiles(type, fileList, lineId) {
    const files = Array.from(fileList || []).map(toFileRecord);
    if (!files.length) return;

    if (type === "package") {
      state.package.files.push(...files);
      renderPackageFiles();
    }

    if (type === "line") {
      const line = getLine(lineId);
      if (!line) return;
      line.files.push(...files);
      renderLines();
    }

    clearValidation();
  }

  function toFileRecord(file) {
    return {
      name: file.name,
      size: file.size || 0,
      type: file.type || "",
      lastModified: file.lastModified || 0,
      file
    };
  }

  function removePackageFile(fileIndex) {
    if (!state.package.files[fileIndex]) return;
    state.package.files.splice(fileIndex, 1);
    clearValidation();
    renderPackageFiles();
  }

  function removeLineFile(lineId, fileIndex) {
    const line = getLine(lineId);
    if (!line?.files[fileIndex]) return;
    line.files.splice(fileIndex, 1);
    clearValidation();
    renderLines();
  }

  function validate() {
    const errors = [];
    if (!state.package.customer.trim()) errors.push({ field: "rfq2Customer", message: "Customer is required." });
    if (!state.package.receivedDate) errors.push({ field: "rfq2ReceivedDate", message: "Received Date is required." });
    if (!state.package.requestedResponseDate) errors.push({ field: "rfq2ResponseDate", message: "Requested Response Date is required." });
    if (state.package.receivedDate && state.package.requestedResponseDate && state.package.requestedResponseDate < state.package.receivedDate) {
      errors.push({ field: "rfq2ResponseDate", message: "Requested Response Date cannot be before Received Date." });
    }
    if (!state.package.files.length) errors.push({ field: "rfq2PackageDropZone", message: "Initial RFQ Email is required." });
    if (!state.lines.length) errors.push({ field: "rfq2LineList", message: "At least one RFQ Line is required." });
    state.lines.forEach((line, index) => {
      if (!line.assemblyNumber.trim()) {
        errors.push({ field: null, lineId: line.id, message: "RFQ Line " + (index + 1) + " requires an Assembly Number." });
      }
    });
    state.errors = errors;
    return errors;
  }

  function openReview() {
    const errors = validate();
    renderValidation();
    if (errors.length) {
      focusFirstError(errors[0]);
      return;
    }
    setView("review");
  }

  function setView(view) {
    state.view = view;
    clearValidation();
    renderView();
    if (view === "review") {
      renderReview();
      document.getElementById("rfq2ReviewTitle")?.focus?.();
    }
  }

  function commitIntake() {
    const errors = validate();
    if (errors.length) {
      state.view = "edit";
      renderView();
      renderValidation();
      focusFirstError(errors[0]);
      return;
    }

    state.committedRfq = buildRfqRecord();
    state.view = "complete";
    renderView();
    renderCompleteSummary();
    document.dispatchEvent(new CustomEvent("dle:rfq-intake-committed", {
      detail: { rfq: getSnapshot() }
    }));
  }

  function buildRfqRecord() {
    return {
      schema: "DLE_RFQ_INTAKE_V1",
      metadata: {
        customer: state.package.customer.trim(),
        receivedDate: state.package.receivedDate,
        requestedResponseDate: state.package.requestedResponseDate,
        customerReference: state.package.customerReference.trim(),
        generalNotes: state.package.generalNotes.trim(),
        rfqLines: state.lines.map((line, index) => ({
          lineNumber: index + 1,
          assemblyNumber: line.assemblyNumber.trim(),
          revision: line.revision.trim(),
          requestedQuantities: line.requestedQuantities.trim(),
          notes: line.notes.trim(),
          documents: line.files.map(file => toDocumentMetadata(file, "RFQ Line " + (index + 1)))
        }))
      },
      documents: {
        initialRfqEmail: state.package.files.map(file => toDocumentMetadata(file, "Initial RFQ Email")),
        allUploadedDocuments: getAllDocumentMetadata()
      },
      status: "Intake Complete - Awaiting RFQ Review",
      createdAt: new Date().toISOString()
    };
  }

  function toDocumentMetadata(fileRecord, source) {
    return {
      fileName: fileRecord.name,
      size: fileRecord.size,
      type: fileRecord.type,
      lastModified: fileRecord.lastModified,
      source
    };
  }

  function getAllDocumentMetadata() {
    const documents = state.package.files.map(file => toDocumentMetadata(file, "Initial RFQ Email"));
    state.lines.forEach((line, index) => {
      const source = "RFQ Line " + (index + 1) + " - " + (line.assemblyNumber || "Assembly TBD");
      line.files.forEach(file => documents.push(toDocumentMetadata(file, source)));
    });
    return documents;
  }

  function render() {
    if (!mount) return;
    syncStaticFields();
    renderView();
    renderPackageFiles();
    renderLines();
    renderValidation();
    if (state.view === "review") renderReview();
    if (state.view === "complete") renderCompleteSummary();
  }

  function syncStaticFields() {
    setValue("rfq2IntakeType", state.intakeType);
    setValue("rfq2Customer", state.package.customer);
    setValue("rfq2ReceivedDate", state.package.receivedDate);
    setValue("rfq2ResponseDate", state.package.requestedResponseDate);
    const customerReference = mount?.querySelector('[data-rfq-field="customerReference"]');
    const generalNotes = mount?.querySelector('[data-rfq-field="generalNotes"]');
    if (customerReference) customerReference.value = state.package.customerReference;
    if (generalNotes) generalNotes.value = state.package.generalNotes;
  }

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
  }

  function renderView() {
    const hasSelection = state.intakeType === RFQ_INTAKE_TYPE;
    setHidden("rfq2Welcome", hasSelection);
    setHidden("rfq2Editor", !hasSelection);
    setHidden("rfq2EditView", !hasSelection || state.view !== "edit");
    setHidden("rfq2ReviewView", state.view !== "review");
    setHidden("rfq2CompleteView", state.view !== "complete");

    const status = document.getElementById("rfq2WorkspaceStatus");
    if (status) {
      status.textContent = state.view === "review"
        ? "Reviewing RFQ Intake"
        : state.view === "complete"
          ? "Document Intake Complete"
          : hasSelection
            ? "RFQ Intake in Progress"
            : "Ready for Document Intake";
    }
  }

  function setHidden(id, hidden) {
    const element = document.getElementById(id);
    if (element) element.hidden = hidden;
  }

  function renderPackageFiles() {
    const target = document.getElementById("rfq2PackageFiles");
    if (target) target.innerHTML = renderFileList(state.package.files, { action: "remove-package-file" });
  }

  function renderLines() {
    const target = document.getElementById("rfq2LineList");
    if (!target) return;
    if (!state.lines.length) {
      target.innerHTML = '<p class="rfq2-line-list-empty">No RFQ Lines added yet. Select Add RFQ Line to begin organizing the assemblies being quoted.</p>';
      return;
    }
    target.innerHTML = state.lines.map(renderLineCard).join("");
  }

  function renderLineCard(line, index) {
    return [
      '<article class="rfq2-line-card', line.collapsed ? ' collapsed' : '', '">',
      '<header class="rfq2-line-header">',
      '<div class="rfq2-line-summary" data-rfq-line-summary="', line.id, '">', buildLineSummary(line, index + 1), '</div>',
      '<div class="rfq2-file-row-actions">',
      '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="toggle-line" data-rfq-line-id="', line.id, '">', line.collapsed ? 'Expand' : 'Collapse', '</button>',
      '<button type="button" class="rfq2-button rfq2-button-secondary rfq2-line-remove" data-rfq-action="remove-line" data-rfq-line-id="', line.id, '">Remove</button>',
      '</div></header>',
      '<div class="rfq2-line-body"><div class="rfq2-line-fields">',
      renderLineField(line, "assemblyNumber", "Assembly Number *", "Example: 13288"),
      renderLineField(line, "revision", "Revision", "Example: Rev B"),
      renderLineField(line, "requestedQuantities", "Requested Quantities", "Example: 10, 25, 50"),
      renderLineField(line, "notes", "Notes", "Assembly-specific notes", true),
      '</div>',
      '<div class="rfq2-file-section"><div><h3>Assembly Documents</h3><p>Drawing, BOM, wire list, specifications, CAD, photos, or other documents for this RFQ Line.</p></div>',
      '<div class="rfq2-drop-zone" data-rfq-drop-zone="line" data-rfq-line-id="', line.id, '" tabindex="0" role="button">',
      '<strong>Drop assembly documents here</strong><span>Attach files that apply only to this RFQ Line.</span></div>',
      '<input class="rfq2-file-input" data-rfq-file-input="line" data-rfq-line-id="', line.id, '" type="file" multiple />',
      '<div class="rfq2-file-list">', renderFileList(line.files, { action: "remove-line-file", lineId: line.id }), '</div>',
      '</div></div></article>'
    ].join("");
  }

  function buildLineSummary(line, lineNumber) {
    const identity = [line.assemblyNumber || "Assembly Number", line.revision].filter(Boolean).join(" · ");
    const quantities = line.requestedQuantities || "Not set";
    return '<strong>RFQ Line ' + lineNumber + ': ' + escapeHtml(identity) + '</strong>' +
      '<span>Requested Quantities: ' + escapeHtml(quantities) + ' · ' + line.files.length + ' document' + (line.files.length === 1 ? '' : 's') + '</span>';
  }

  function renderLineField(line, field, label, placeholder, textarea = false) {
    const attributes = ' data-rfq-line-id="' + line.id + '" data-rfq-line-field="' + field + '" placeholder="' + escapeHtml(placeholder) + '"';
    const control = textarea
      ? '<textarea rows="3"' + attributes + '>' + escapeHtml(line[field]) + '</textarea>'
      : '<input value="' + escapeHtml(line[field]) + '"' + attributes + ' />';
    return '<label class="rfq2-field' + (textarea ? ' rfq2-wide' : '') + '"><span>' + escapeHtml(label) + '</span>' + control + '</label>';
  }

  function renderFileList(files, options) {
    if (!files.length) return '<p class="rfq2-file-list-empty">No documents queued yet.</p>';
    return '<ul>' + files.map((file, index) => [
      '<li><span class="rfq2-file-name" title="', escapeHtml(file.name), '">', escapeHtml(file.name), '</span>',
      '<span class="rfq2-file-meta">', escapeHtml(formatFileSize(file.size)), '</span>',
      '<button type="button" class="rfq2-button rfq2-button-secondary rfq2-file-remove" data-rfq-action="', options.action,
      '" data-rfq-file-index="', index, '"', options.lineId ? ' data-rfq-line-id="' + options.lineId + '"' : '', '>Remove</button></li>'
    ].join("")).join("") + '</ul>';
  }

  function renderValidation() {
    const target = document.getElementById("rfq2Validation");
    if (!target) return;
    target.hidden = !state.errors.length;
    target.innerHTML = state.errors.length
      ? '<strong>Complete the following before reviewing this RFQ:</strong><ul>' + state.errors.map(error => '<li>' + escapeHtml(error.message) + '</li>').join("") + '</ul>'
      : "";
  }

  function clearValidation() {
    if (!state.errors.length) return;
    state.errors = [];
    renderValidation();
  }

  function focusFirstError(error) {
    const lineField = error.lineId
      ? mount?.querySelector('[data-rfq-line-id="' + error.lineId + '"][data-rfq-line-field="assemblyNumber"]')
      : null;
    const target = lineField || (error.field ? document.getElementById(error.field) : null) || document.getElementById("rfq2Validation");
    target?.focus?.();
  }

  function renderReview() {
    const target = document.getElementById("rfq2ReviewContent");
    if (!target) return;
    const packageFiles = state.package.files.map(file => escapeHtml(file.name)).join(", ");
    target.innerHTML = [
      '<section class="rfq2-review-section"><h3>RFQ Package</h3><div class="rfq2-review-grid">',
      reviewItem("Customer", state.package.customer),
      reviewItem("Received Date", state.package.receivedDate),
      reviewItem("Requested Response Date", state.package.requestedResponseDate),
      reviewItem("Customer Reference", state.package.customerReference || "Not provided"),
      reviewItem("General Notes", state.package.generalNotes || "No notes entered", true),
      '</div></section>',
      '<section class="rfq2-review-section"><h3>Initial RFQ Email</h3><p>', packageFiles || 'No email attached.', '</p></section>',
      '<section class="rfq2-review-section"><h3>RFQ Lines</h3><div class="rfq2-review-lines">',
      state.lines.map(renderReviewLine).join(""),
      '</div></section>',
      '<section class="rfq2-review-section"><h3>Phase 1 Commit Result</h3><p>Complete Document Intake and create an in-memory <strong>DLE_RFQ_INTAKE_V1</strong> record ready for the future RFQ Review stage.</p></section>'
    ].join("");
  }

  function renderReviewLine(line, index) {
    return [
      '<article class="rfq2-review-line"><h4>RFQ Line ', index + 1, '</h4><div class="rfq2-review-grid">',
      reviewItem("Assembly", line.assemblyNumber),
      reviewItem("Revision", line.revision || "Not provided"),
      reviewItem("Requested Quantities", line.requestedQuantities || "Not provided"),
      reviewItem("Assembly Documents", line.files.length + " file" + (line.files.length === 1 ? "" : "s")),
      reviewItem("Notes", line.notes || "No notes entered", true),
      '</div></article>'
    ].join("");
  }

  function reviewItem(label, value, wide = false) {
    return '<div class="' + (wide ? 'rfq2-wide' : '') + '"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(value) + '</span></div>';
  }

  function renderCompleteSummary() {
    const target = document.getElementById("rfq2CompleteSummary");
    const rfq = state.committedRfq;
    if (!target || !rfq) return;
    target.innerHTML = [
      completeItem("Customer", rfq.metadata.customer),
      completeItem("RFQ Lines", String(rfq.metadata.rfqLines.length)),
      completeItem("Documents", String(rfq.documents.allUploadedDocuments.length)),
      completeItem("Status", rfq.status),
      completeItem("Schema", rfq.schema),
      completeItem("Committed", new Date(rfq.createdAt).toLocaleString())
    ].join("");
  }

  function completeItem(label, value) {
    return '<div><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(value) + '</span></div>';
  }

  function formatDate(date) {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  }

  function formatFileSize(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));
  }

  function getSnapshot() {
    return state.committedRfq ? JSON.parse(JSON.stringify(state.committedRfq)) : null;
  }

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: loadRfqWorkspace,
    getCommittedIntake: getSnapshot
  });
})(window, document);

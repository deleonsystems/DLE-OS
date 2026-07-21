(function registerRfqWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "rfq-quoting";
  const TEMPLATE_PATH = "SRC/modules/rfq-workspace/rfq-workspace.html";
  const MASTER_DATA_PATH = "DATA/master-data/DLE_MASTER_DATA_2026.06.30.16.38.48.json";
  const INITIALIZATION_STATUS = "RFQ Initialization";
  const COMPLETE_STATUS = "RFQ Initialization Complete - Awaiting RFQ Review";
  let lastDraftIdentitySecond = 0;
  let mount = null;
  let eventsBound = false;
  let committedInitialization = null;

  const referenceCatalog = {
    status: "idle",
    source: "",
    error: "",
    customers: [],
    assemblies: []
  };

  const state = createInitialState();

  function createInitialState(options = {}) {
    const now = new Date();
    const responseDate = new Date(now);
    responseDate.setDate(now.getDate() + 7);
    const identity = options.identity || {};

    return {
      workflow: {
        currentPhase: "rfq-initialization",
        currentView: "edit"
      },
      rfq: {
        draftId: identity.draftId || generateDraftId(now),
        createdDate: identity.createdDate || formatDate(now),
        createdAt: identity.createdAt || now.toISOString(),
        createdBy: identity.createdBy || "DLE-OS User",
        status: INITIALIZATION_STATUS,
        requestedResponseDate: formatDate(responseDate),
        customerReference: "",
        generalNotes: "",
        documents: []
      },
      customer: null,
      rfqLines: [],
      ui: {
        nextLineId: 1,
        customerMode: "search",
        customerSearch: "",
        customerSearchPerformed: false,
        customerResults: [],
        prospectiveDraft: createProspectiveCustomerDraft(),
        lineSearches: {},
        revisionDrafts: {}
      },
      validation: {
        errors: []
      }
    };
  }

  function createProspectiveCustomerDraft() {
    return {
      companyName: "",
      buyerContact: "",
      engineeringContact: "",
      email: "",
      phone: "",
      billingAddress: "",
      shippingAddress: ""
    };
  }

  function generateDraftId(date) {
    const requestedSecond = Math.floor(date.getTime() / 1000) * 1000;
    const identitySecond = Math.max(requestedSecond, lastDraftIdentitySecond + 1000);
    lastDraftIdentitySecond = identitySecond;
    const identityDate = new Date(identitySecond);
    const pad = value => String(value).padStart(2, "0");
    return "RFQD-" + identityDate.getFullYear()
      + pad(identityDate.getMonth() + 1)
      + pad(identityDate.getDate())
      + "-"
      + pad(identityDate.getHours())
      + pad(identityDate.getMinutes())
      + pad(identityDate.getSeconds());
  }

  async function loadRfqWorkspace() {
    mount = document.querySelector('[data-workspace-mount="' + WORKSPACE_ID + '"]');
    if (!mount) return;

    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading RFQ Workspace</h3><p>Preparing RFQ Initialization...</p></div>';
      const response = await fetch(TEMPLATE_PATH);
      if (!response.ok) throw new Error("Unable to load RFQ Workspace.");
      mount.innerHTML = await response.text();
      mount.dataset.workspaceLoaded = "true";
    }

    bindEvents();
    render();
    await loadReferenceCatalog();
  }

  async function loadReferenceCatalog() {
    if (["loading", "ready"].includes(referenceCatalog.status)) return;
    referenceCatalog.status = "loading";
    renderCustomerStep();
    renderAssemblyStep();

    try {
      let data;
      let source;
      if (window.DleApiClient?.getJsonWithFallback) {
        const result = await window.DleApiClient.getJsonWithFallback("masterData", MASTER_DATA_PATH, {
          apiPersistenceMode: "DLE-OS-HOST API read-only",
          fallbackPersistenceMode: "Project JSON fallback read-only"
        });
        data = result.data;
        source = result.source;
      } else {
        const response = await fetch(MASTER_DATA_PATH, { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load DLE Master Data reference catalog.");
        data = await response.json();
        source = MASTER_DATA_PATH;
      }

      const records = Array.isArray(data?.records) ? data.records : [];
      referenceCatalog.customers = buildCustomerCatalog(records);
      referenceCatalog.assemblies = buildAssemblyCatalog(records);
      referenceCatalog.source = source || MASTER_DATA_PATH;
      referenceCatalog.error = "";
      referenceCatalog.status = "ready";
    } catch (error) {
      referenceCatalog.status = "error";
      referenceCatalog.error = error?.message || String(error);
    }

    renderCustomerStep();
    renderAssemblyStep();
    renderRevisionStep();
  }

  function buildCustomerCatalog(records) {
    const customers = new Map();
    records.forEach(record => {
      const vpro5 = record?.vpro5 || {};
      const erpCustomerNumber = String(vpro5.customerNumber || "").trim();
      const companyName = String(vpro5.customer || "").trim();
      if (!companyName) return;
      const key = erpCustomerNumber || companyName.toUpperCase();
      if (!customers.has(key)) {
        customers.set(key, {
          customerId: "ERP-" + key,
          companyName,
          erpStatus: "Established",
          erpCustomerNumber: erpCustomerNumber || null
        });
      }
    });
    return Array.from(customers.values()).sort((left, right) => left.companyName.localeCompare(right.companyName));
  }

  function buildAssemblyCatalog(records) {
    const assemblies = new Map();
    records.forEach(record => {
      const vpro5 = record?.vpro5 || {};
      const assemblyNumber = String(vpro5.partNumber || vpro5.drawingNumber || "").trim();
      if (!assemblyNumber) return;
      const key = assemblyNumber.toUpperCase();
      const revision = String(vpro5.revisionCode || vpro5.drawingRevision || "").trim();
      if (!assemblies.has(key)) {
        assemblies.set(key, {
          assemblyId: "ERP-ASSEMBLY-" + key,
          assemblyNumber,
          description: String(vpro5.description || "").trim(),
          drawingNumber: String(vpro5.drawingNumber || "").trim(),
          source: "DLE Master Data",
          revisions: new Set()
        });
      }
      if (revision) assemblies.get(key).revisions.add(revision);
    });

    return Array.from(assemblies.values())
      .map(assembly => ({ ...assembly, revisions: Array.from(assembly.revisions).sort() }))
      .sort((left, right) => left.assemblyNumber.localeCompare(right.assemblyNumber));
  }

  function bindEvents() {
    if (!mount || eventsBound) return;
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

  function handleClick(event) {
    const dropZone = event.target.closest("[data-rfq-drop-zone]");
    if (dropZone) {
      openFilePicker(dropZone);
      return;
    }

    const actionTarget = event.target.closest("[data-rfq-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.rfqAction;
    const lineId = actionTarget.dataset.rfqLineId || "";

    if (action === "restart-initialization") restartInitialization();
    if (action === "search-customer") searchCustomers();
    if (action === "select-customer") selectExistingCustomer(actionTarget.dataset.rfqCustomerId);
    if (action === "start-prospective-customer") startProspectiveCustomer();
    if (action === "save-prospective-customer") saveProspectiveCustomer();
    if (action === "change-customer") changeCustomer();
    if (action === "add-line") addRfqLine();
    if (action === "remove-line") removeRfqLine(lineId);
    if (action === "search-assembly") searchAssemblies(lineId);
    if (action === "select-assembly") selectExistingAssembly(lineId, actionTarget.dataset.rfqAssemblyId);
    if (action === "start-new-assembly") startNewAssembly(lineId);
    if (action === "save-new-assembly") saveNewAssembly(lineId);
    if (action === "change-assembly") changeAssembly(lineId);
    if (action === "use-existing-revision") useExistingRevision(lineId);
    if (action === "use-new-revision") useNewRevision(lineId);
    if (action === "change-revision") changeRevision(lineId);
    if (action === "remove-package-file") removePackageFile(Number(actionTarget.dataset.rfqFileIndex));
    if (action === "remove-line-file") removeLineFile(lineId, Number(actionTarget.dataset.rfqFileIndex));
    if (action === "review") openReview();
    if (action === "back-to-edit") setView("edit");
    if (action === "commit") commitInitialization();
    if (action === "new-rfq") startNewRfq();
  }

  function handleInput(event) {
    const rfqField = event.target.dataset.rfqRfqField;
    if (rfqField && Object.prototype.hasOwnProperty.call(state.rfq, rfqField)) {
      state.rfq[rfqField] = event.target.value;
      clearValidation();
      return;
    }

    if (event.target.dataset.rfqCustomerSearch !== undefined) {
      state.ui.customerSearch = event.target.value;
      state.ui.customerSearchPerformed = false;
      state.ui.customerResults = [];
      clearValidation();
      return;
    }

    const customerField = event.target.dataset.rfqCustomerDraftField;
    if (customerField && Object.prototype.hasOwnProperty.call(state.ui.prospectiveDraft, customerField)) {
      state.ui.prospectiveDraft[customerField] = event.target.value;
      clearValidation();
      return;
    }

    const lineId = event.target.dataset.rfqLineId || "";
    const line = getLine(lineId);
    const lineField = event.target.dataset.rfqLineField;
    if (line && ["requestedQuantities", "notes"].includes(lineField)) {
      line[lineField] = event.target.value;
      clearValidation();
      return;
    }

    if (event.target.dataset.rfqAssemblySearch !== undefined && line) {
      const search = getLineSearch(lineId);
      search.query = event.target.value;
      search.searchPerformed = false;
      search.results = [];
      clearValidation();
      return;
    }

    const newAssemblyField = event.target.dataset.rfqNewAssemblyField;
    if (newAssemblyField && line) {
      getLineSearch(lineId).newAssembly[newAssemblyField] = event.target.value;
      clearValidation();
      return;
    }

    const revisionDraftField = event.target.dataset.rfqRevisionDraftField;
    if (revisionDraftField && line) {
      getRevisionDraft(lineId)[revisionDraftField] = event.target.value;
      clearValidation();
    }
  }

  function handleChange(event) {
    const inputType = event.target.dataset.rfqFileInput;
    if (!inputType) return;
    addFiles(inputType, event.target.files, event.target.dataset.rfqLineId || "");
    event.target.value = "";
  }

  function handleKeydown(event) {
    if (event.key === "Enter" && event.target.dataset.rfqCustomerSearch !== undefined) {
      event.preventDefault();
      searchCustomers();
      return;
    }
    if (event.key === "Enter" && event.target.dataset.rfqAssemblySearch !== undefined) {
      event.preventDefault();
      searchAssemblies(event.target.dataset.rfqLineId || "");
      return;
    }
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
    addFiles(dropZone.dataset.rfqDropZone, event.dataTransfer?.files, dropZone.dataset.rfqLineId || "");
  }

  function restartInitialization() {
    const identity = {
      draftId: state.rfq.draftId,
      createdDate: state.rfq.createdDate,
      createdAt: state.rfq.createdAt,
      createdBy: state.rfq.createdBy
    };
    replaceState(createInitialState({ identity }));
    committedInitialization = null;
    render();
  }

  function startNewRfq() {
    replaceState(createInitialState());
    committedInitialization = null;
    render();
  }

  function replaceState(replacement) {
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, replacement);
  }

  function searchCustomers() {
    if (referenceCatalog.status !== "ready") {
      setValidationError("Customer reference data is not ready yet.", "#rfq2CustomerContent");
      return;
    }
    const query = state.ui.customerSearch.trim().toLowerCase();
    state.ui.customerSearchPerformed = true;
    state.ui.customerResults = query
      ? referenceCatalog.customers.filter(customer => [customer.companyName, customer.erpCustomerNumber]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query))).slice(0, 10)
      : [];
    clearValidation();
    renderCustomerStep();
  }

  function selectExistingCustomer(customerId) {
    const customer = referenceCatalog.customers.find(item => item.customerId === customerId);
    if (!customer) return;
    state.customer = {
      customerId: customer.customerId,
      resolution: "existing",
      companyName: customer.companyName,
      erpStatus: "Established",
      erpCustomerNumber: customer.erpCustomerNumber,
      buyerContact: "",
      engineeringContact: "",
      email: "",
      phone: "",
      billingAddress: "",
      shippingAddress: ""
    };
    state.ui.customerResults = [];
    clearValidation();
    renderWorkflowSteps();
  }

  function startProspectiveCustomer() {
    state.customer = null;
    state.ui.customerMode = "prospective";
    state.ui.prospectiveDraft = createProspectiveCustomerDraft();
    clearValidation();
    renderCustomerStep();
  }

  function saveProspectiveCustomer() {
    const draft = state.ui.prospectiveDraft;
    if (!draft.companyName.trim()) {
      setValidationError("Company Name is required for a Prospective Customer.", "#rfq2ProspectiveCompany");
      return;
    }
    state.customer = {
      customerId: "PROSPECT-" + state.rfq.draftId,
      resolution: "prospective",
      companyName: draft.companyName.trim(),
      erpStatus: "Prospective",
      erpCustomerNumber: null,
      buyerContact: draft.buyerContact.trim(),
      engineeringContact: draft.engineeringContact.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      billingAddress: draft.billingAddress.trim(),
      shippingAddress: draft.shippingAddress.trim()
    };
    clearValidation();
    renderWorkflowSteps();
  }

  function changeCustomer() {
    state.customer = null;
    state.ui.customerMode = "search";
    state.ui.customerSearch = "";
    state.ui.customerResults = [];
    state.ui.customerSearchPerformed = false;
    clearValidation();
    renderWorkflowSteps();
  }

  function addRfqLine() {
    if (!isCustomerResolved()) return;
    const lineNumber = state.ui.nextLineId++;
    const lineId = state.rfq.draftId + "-L" + String(lineNumber).padStart(2, "0");
    state.rfqLines.push({
      lineId,
      requestedQuantities: "",
      notes: "",
      assembly: null,
      revision: null,
      documents: []
    });
    getLineSearch(lineId);
    getRevisionDraft(lineId);
    clearValidation();
    renderWorkflowSteps();
  }

  function removeRfqLine(lineId) {
    const index = state.rfqLines.findIndex(line => line.lineId === lineId);
    if (index < 0) return;
    state.rfqLines.splice(index, 1);
    delete state.ui.lineSearches[lineId];
    delete state.ui.revisionDrafts[lineId];
    clearValidation();
    renderWorkflowSteps();
  }

  function searchAssemblies(lineId) {
    const line = getLine(lineId);
    if (!line) return;
    if (referenceCatalog.status !== "ready") {
      setValidationError("Assembly reference data is not ready yet.", '[data-rfq-assembly-card="' + lineId + '"]');
      return;
    }
    const search = getLineSearch(lineId);
    const query = search.query.trim().toLowerCase();
    search.searchPerformed = true;
    search.mode = "search";
    search.results = query
      ? referenceCatalog.assemblies.filter(assembly => [assembly.assemblyNumber, assembly.description, assembly.drawingNumber]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query))).slice(0, 10)
      : [];
    clearValidation();
    renderAssemblyStep();
  }

  function selectExistingAssembly(lineId, assemblyId) {
    const line = getLine(lineId);
    const assembly = referenceCatalog.assemblies.find(item => item.assemblyId === assemblyId);
    if (!line || !assembly) return;
    line.assembly = {
      assemblyId: assembly.assemblyId,
      resolution: "existing",
      status: "Existing",
      assemblyNumber: assembly.assemblyNumber,
      description: assembly.description,
      drawingNumber: assembly.drawingNumber,
      availableRevisions: assembly.revisions.slice()
    };
    line.revision = null;
    clearValidation();
    renderWorkflowSteps();
  }

  function startNewAssembly(lineId) {
    const line = getLine(lineId);
    if (!line) return;
    const search = getLineSearch(lineId);
    search.mode = "new";
    search.newAssembly = { assemblyNumber: search.query.trim(), description: "" };
    clearValidation();
    renderAssemblyStep();
  }

  function saveNewAssembly(lineId) {
    const line = getLine(lineId);
    if (!line) return;
    const draft = getLineSearch(lineId).newAssembly;
    if (!draft.assemblyNumber.trim()) {
      setValidationError("Assembly Number is required for a new assembly.", '[data-rfq-new-assembly-field="assemblyNumber"][data-rfq-line-id="' + lineId + '"]');
      return;
    }
    line.assembly = {
      assemblyId: state.rfq.draftId + "-ASM-" + String(state.rfqLines.indexOf(line) + 1).padStart(2, "0"),
      resolution: "new",
      status: "New",
      assemblyNumber: draft.assemblyNumber.trim(),
      description: draft.description.trim(),
      drawingNumber: "",
      availableRevisions: []
    };
    line.revision = null;
    clearValidation();
    renderWorkflowSteps();
  }

  function changeAssembly(lineId) {
    const line = getLine(lineId);
    if (!line) return;
    line.assembly = null;
    line.revision = null;
    state.ui.lineSearches[lineId] = createLineSearch();
    state.ui.revisionDrafts[lineId] = createRevisionDraft();
    clearValidation();
    renderWorkflowSteps();
  }

  function useExistingRevision(lineId) {
    const line = getLine(lineId);
    if (!line?.assembly) return;
    const revision = getRevisionDraft(lineId).existingRevision.trim();
    if (!revision) {
      setValidationError("Select an existing revision for this RFQ Line.", '[data-rfq-revision-card="' + lineId + '"]');
      return;
    }
    line.revision = {
      revisionId: line.assembly.assemblyId + "-REV-" + sanitizeIdPart(revision),
      resolution: "existing",
      revision,
      status: "Active",
      notes: "",
      supersedesRevision: null
    };
    clearValidation();
    renderWorkflowSteps();
  }

  function useNewRevision(lineId) {
    const line = getLine(lineId);
    if (!line?.assembly) return;
    const draft = getRevisionDraft(lineId);
    if (!draft.newRevision.trim()) {
      setValidationError("Revision is required when creating a new revision.", '[data-rfq-revision-draft-field="newRevision"][data-rfq-line-id="' + lineId + '"]');
      return;
    }
    line.revision = {
      revisionId: line.assembly.assemblyId + "-REV-" + sanitizeIdPart(draft.newRevision),
      resolution: "new",
      revision: draft.newRevision.trim(),
      status: "Active",
      notes: draft.notes.trim(),
      supersedesRevision: null
    };
    clearValidation();
    renderWorkflowSteps();
  }

  function changeRevision(lineId) {
    const line = getLine(lineId);
    if (!line) return;
    line.revision = null;
    state.ui.revisionDrafts[lineId] = createRevisionDraft();
    clearValidation();
    renderWorkflowSteps();
  }

  function getLine(lineId) {
    return state.rfqLines.find(line => line.lineId === lineId) || null;
  }

  function createLineSearch() {
    return {
      mode: "search",
      query: "",
      searchPerformed: false,
      results: [],
      newAssembly: { assemblyNumber: "", description: "" }
    };
  }

  function getLineSearch(lineId) {
    state.ui.lineSearches[lineId] = state.ui.lineSearches[lineId] || createLineSearch();
    return state.ui.lineSearches[lineId];
  }

  function createRevisionDraft() {
    return { existingRevision: "", newRevision: "", notes: "" };
  }

  function getRevisionDraft(lineId) {
    state.ui.revisionDrafts[lineId] = state.ui.revisionDrafts[lineId] || createRevisionDraft();
    return state.ui.revisionDrafts[lineId];
  }

  function openFilePicker(dropZone) {
    const type = dropZone.dataset.rfqDropZone;
    const lineId = dropZone.dataset.rfqLineId || "";
    const selector = type === "package"
      ? '[data-rfq-file-input="package"]'
      : '[data-rfq-file-input="line"][data-rfq-line-id="' + lineId + '"]';
    mount?.querySelector(selector)?.click();
  }

  function addFiles(type, fileList, lineId) {
    if (!isDocumentStepUnlocked()) return;
    const files = Array.from(fileList || []).map(toFileRecord);
    if (!files.length) return;
    if (type === "package") state.rfq.documents.push(...files);
    if (type === "line") {
      const line = getLine(lineId);
      if (!line) return;
      line.documents.push(...files);
    }
    clearValidation();
    renderDocumentStep();
    renderStepStates();
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
    if (!state.rfq.documents[fileIndex]) return;
    state.rfq.documents.splice(fileIndex, 1);
    clearValidation();
    renderDocumentStep();
    renderStepStates();
  }

  function removeLineFile(lineId, fileIndex) {
    const line = getLine(lineId);
    if (!line?.documents[fileIndex]) return;
    line.documents.splice(fileIndex, 1);
    clearValidation();
    renderDocumentStep();
  }

  function isCustomerResolved() {
    return Boolean(state.customer?.companyName);
  }

  function areAssembliesResolved() {
    return state.rfqLines.length > 0 && state.rfqLines.every(line => Boolean(line.assembly?.assemblyNumber));
  }

  function areRevisionsResolved() {
    return areAssembliesResolved() && state.rfqLines.every(line => Boolean(line.revision?.revision));
  }

  function isDocumentStepUnlocked() {
    return isCustomerResolved() && areRevisionsResolved();
  }

  function validateInitialization() {
    const errors = [];
    if (!state.rfq.requestedResponseDate) {
      errors.push({ message: "Requested Response Date is required.", selector: "#rfq2ResponseDate" });
    }
    if (state.rfq.requestedResponseDate && state.rfq.requestedResponseDate < state.rfq.createdDate) {
      errors.push({ message: "Requested Response Date cannot be before Created Date.", selector: "#rfq2ResponseDate" });
    }
    if (!isCustomerResolved()) {
      errors.push({ message: "Resolve an existing or Prospective Customer.", selector: "#rfq2CustomerContent" });
    }
    if (!state.rfqLines.length) {
      errors.push({ message: "Add at least one RFQ Line.", selector: "#rfq2AssemblyContent" });
    }
    state.rfqLines.forEach((line, index) => {
      if (!line.assembly?.assemblyNumber) {
        errors.push({ message: "RFQ Line " + (index + 1) + " requires an assembly resolution.", selector: '[data-rfq-assembly-card="' + line.lineId + '"]' });
      }
      if (!line.revision?.revision) {
        errors.push({ message: "RFQ Line " + (index + 1) + " requires one active revision.", selector: '[data-rfq-revision-card="' + line.lineId + '"]' });
      }
    });
    if (!state.rfq.documents.length) {
      errors.push({ message: "Initial RFQ Email is required.", selector: "#rfq2PackageDropZone" });
    }
    state.validation.errors = errors;
    return errors;
  }

  function setValidationError(message, selector) {
    state.validation.errors = [{ message, selector }];
    renderValidation();
    focusFirstError(state.validation.errors[0]);
  }

  function clearValidation() {
    if (!state.validation.errors.length) return;
    state.validation.errors = [];
    renderValidation();
  }

  function openReview() {
    const errors = validateInitialization();
    renderValidation();
    if (errors.length) {
      focusFirstError(errors[0]);
      return;
    }
    setView("review");
  }

  function setView(view) {
    state.workflow.currentView = view;
    clearValidation();
    renderView();
    if (view === "review") {
      renderReview();
      document.getElementById("rfq2ReviewTitle")?.focus?.();
    }
  }

  function commitInitialization() {
    const errors = validateInitialization();
    if (errors.length) {
      state.workflow.currentView = "edit";
      renderView();
      renderValidation();
      focusFirstError(errors[0]);
      return;
    }
    state.rfq.status = COMPLETE_STATUS;
    committedInitialization = buildInitializationRecord();
    state.workflow.currentView = "complete";
    renderView();
    renderCompleteSummary();
    document.dispatchEvent(new CustomEvent("dle:rfq-initialization-committed", {
      detail: { rfq: getSnapshot() }
    }));
  }

  function buildInitializationRecord() {
    const completedAt = new Date().toISOString();
    return {
      schema: "DLE_RFQ_INITIALIZATION_V1",
      workflow: {
        currentPhase: "rfq-initialization",
        phaseStatus: "Complete",
        completedAt
      },
      rfq: {
        draftId: state.rfq.draftId,
        createdDate: state.rfq.createdDate,
        createdAt: state.rfq.createdAt,
        createdBy: state.rfq.createdBy,
        status: COMPLETE_STATUS,
        requestedResponseDate: state.rfq.requestedResponseDate,
        customerReference: state.rfq.customerReference.trim(),
        generalNotes: state.rfq.generalNotes.trim()
      },
      customer: { ...state.customer },
      rfqLines: state.rfqLines.map((line, index) => ({
        lineNumber: index + 1,
        lineId: line.lineId,
        requestedQuantities: line.requestedQuantities.trim(),
        notes: line.notes.trim(),
        assembly: {
          assemblyId: line.assembly.assemblyId,
          resolution: line.assembly.resolution,
          status: line.assembly.status,
          assemblyNumber: line.assembly.assemblyNumber,
          description: line.assembly.description,
          drawingNumber: line.assembly.drawingNumber
        },
        revision: { ...line.revision },
        documents: line.documents.map(file => toDocumentMetadata(file, "RFQ Line " + (index + 1)))
      })),
      documents: {
        initialRfqEmail: state.rfq.documents.map(file => toDocumentMetadata(file, "Initial RFQ Email")),
        allUploadedDocuments: getAllDocumentMetadata()
      }
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
    const documents = state.rfq.documents.map(file => toDocumentMetadata(file, "Initial RFQ Email"));
    state.rfqLines.forEach((line, index) => {
      const source = "RFQ Line " + (index + 1) + " - " + line.assembly.assemblyNumber + " Rev " + line.revision.revision;
      line.documents.forEach(file => documents.push(toDocumentMetadata(file, source)));
    });
    return documents;
  }

  function render() {
    if (!mount) return;
    renderIdentity();
    renderWorkflowSteps();
    renderValidation();
    renderView();
    if (state.workflow.currentView === "review") renderReview();
    if (state.workflow.currentView === "complete") renderCompleteSummary();
  }

  function renderIdentity() {
    setText("rfq2DraftId", state.rfq.draftId);
    setText("rfq2ToolbarDraftId", state.rfq.draftId);
    setText("rfq2CreatedDate", state.rfq.createdDate);
    setText("rfq2CreatedBy", state.rfq.createdBy);
    setText("rfq2CurrentStatus", state.rfq.status);
    setValue("rfq2ResponseDate", state.rfq.requestedResponseDate);
    const reference = mount?.querySelector('[data-rfq-rfq-field="customerReference"]');
    const notes = mount?.querySelector('[data-rfq-rfq-field="generalNotes"]');
    if (reference) reference.value = state.rfq.customerReference;
    if (notes) notes.value = state.rfq.generalNotes;
  }

  function renderWorkflowSteps() {
    renderCustomerStep();
    renderAssemblyStep();
    renderRevisionStep();
    renderDocumentStep();
    renderStepStates();
  }

  function renderCustomerStep() {
    const target = document.getElementById("rfq2CustomerContent");
    if (!target) return;
    if (state.customer) {
      target.innerHTML = [
        '<div class="rfq2-resolution-summary">',
        '<div class="rfq2-resolution-heading"><div><span class="rfq2-resolution-badge">', escapeHtml(state.customer.erpStatus), '</span>',
        '<h3>', escapeHtml(state.customer.companyName), '</h3></div>',
        '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="change-customer">Change Customer</button></div>',
        '<div class="rfq2-detail-grid">',
        detailItem("Customer Name", state.customer.companyName),
        detailItem("ERP Status", state.customer.erpStatus),
        detailItem("ERP Customer Number", state.customer.erpCustomerNumber || "Not assigned"),
        state.customer.resolution === "prospective" ? detailItem("Buyer Contact", state.customer.buyerContact || "Not provided") : "",
        state.customer.resolution === "prospective" ? detailItem("Engineering Contact", state.customer.engineeringContact || "Not provided") : "",
        state.customer.resolution === "prospective" ? detailItem("Email", state.customer.email || "Not provided") : "",
        '</div></div>'
      ].join("");
      return;
    }

    if (state.ui.customerMode === "prospective") {
      const draft = state.ui.prospectiveDraft;
      target.innerHTML = [
        '<div class="rfq2-subpanel"><div class="rfq2-subpanel-heading"><div><h3>New Prospective Customer</h3>',
        '<p>No ERP Customer Number will be assigned.</p></div>',
        '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="change-customer">Back to Search</button></div>',
        '<div class="rfq2-prospective-grid">',
        customerDraftField("companyName", "Company Name *", draft.companyName, "rfq2ProspectiveCompany"),
        customerDraftField("buyerContact", "Buyer Contact", draft.buyerContact),
        customerDraftField("engineeringContact", "Engineering Contact", draft.engineeringContact),
        customerDraftField("email", "Email", draft.email, "", "email"),
        customerDraftField("phone", "Phone", draft.phone, "", "tel"),
        customerDraftField("billingAddress", "Billing Address", draft.billingAddress, "", "textarea", true),
        customerDraftField("shippingAddress", "Shipping Address", draft.shippingAddress, "", "textarea", true),
        '</div><div class="rfq2-primary-actions"><button type="button" class="rfq2-button" data-rfq-action="save-prospective-customer">Use Prospective Customer</button></div></div>'
      ].join("");
      return;
    }

    const catalogMessage = referenceCatalog.status === "ready"
      ? referenceCatalog.customers.length + " established customers available."
      : referenceCatalog.status === "error"
        ? "Reference catalog unavailable. You can still create a Prospective Customer."
        : "Loading established customers...";
    const resultMarkup = state.ui.customerResults.length
      ? '<div class="rfq2-search-results">' + state.ui.customerResults.map(customer => [
        '<button type="button" class="rfq2-search-result" data-rfq-action="select-customer" data-rfq-customer-id="', escapeHtml(customer.customerId), '">',
        '<strong>', escapeHtml(customer.companyName), '</strong>',
        '<span>Established · ERP #', escapeHtml(customer.erpCustomerNumber || "Not available"), '</span></button>'
      ].join("")).join("") + '</div>'
      : state.ui.customerSearchPerformed
        ? '<p class="rfq2-empty-state">No established customers matched this search.</p>'
        : "";

    target.innerHTML = [
      '<div class="rfq2-search-panel"><label class="rfq2-field"><span>Customer Search</span>',
      '<input data-rfq-customer-search placeholder="Search company name or ERP customer number" value="', escapeHtml(state.ui.customerSearch), '" /></label>',
      '<div class="rfq2-search-actions"><button type="button" class="rfq2-button" data-rfq-action="search-customer">Search Customers</button>',
      '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="start-prospective-customer">Create Prospective Customer</button></div>',
      '<p class="rfq2-catalog-note">', escapeHtml(catalogMessage), '</p>', resultMarkup, '</div>'
    ].join("");
  }

  function customerDraftField(field, label, value, id = "", type = "text", wide = false) {
    const idAttribute = id ? ' id="' + id + '"' : "";
    const classes = "rfq2-field" + (wide ? " rfq2-wide" : "");
    const control = type === "textarea"
      ? '<textarea data-rfq-customer-draft-field="' + field + '" rows="3">' + escapeHtml(value) + '</textarea>'
      : '<input' + idAttribute + ' data-rfq-customer-draft-field="' + field + '" type="' + type + '" value="' + escapeHtml(value) + '" />';
    return '<label class="' + classes + '"><span>' + escapeHtml(label) + '</span>' + control + '</label>';
  }

  function renderAssemblyStep() {
    const target = document.getElementById("rfq2AssemblyContent");
    if (!target) return;
    if (!isCustomerResolved()) {
      target.innerHTML = lockedMessage("Resolve the customer before adding RFQ Lines.");
      return;
    }
    const lineMarkup = state.rfqLines.length
      ? '<div class="rfq2-line-list">' + state.rfqLines.map(renderAssemblyCard).join("") + '</div>'
      : '<p class="rfq2-empty-state">No RFQ Lines yet. Add a line for each assembly the customer wants quoted.</p>';
    target.innerHTML = [
      '<div class="rfq2-lines-toolbar"><p>', escapeHtml(referenceCatalog.status === "ready" ? referenceCatalog.assemblies.length + " existing assemblies available for search." : "Assembly reference data is loading."), '</p>',
      '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="add-line">Add RFQ Line</button></div>',
      lineMarkup
    ].join("");
  }

  function renderAssemblyCard(line, index) {
    const search = getLineSearch(line.lineId);
    let resolutionMarkup;
    if (line.assembly) {
      resolutionMarkup = [
        '<div class="rfq2-resolution-summary"><div class="rfq2-resolution-heading"><div><span class="rfq2-resolution-badge">', escapeHtml(line.assembly.status), '</span>',
        '<h4>', escapeHtml(line.assembly.assemblyNumber), '</h4></div>',
        '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="change-assembly" data-rfq-line-id="', escapeHtml(line.lineId), '">Change Assembly</button></div>',
        '<div class="rfq2-detail-grid">', detailItem("Assembly Number", line.assembly.assemblyNumber),
        detailItem("Description", line.assembly.description || "Not provided"),
        detailItem("Drawing Number", line.assembly.drawingNumber || "Not provided"), '</div></div>'
      ].join("");
    } else if (search.mode === "new") {
      resolutionMarkup = [
        '<div class="rfq2-subpanel"><div class="rfq2-subpanel-heading"><div><h4>New Assembly Record</h4><p>This record remains in the RFQ draft only.</p></div>',
        '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="change-assembly" data-rfq-line-id="', escapeHtml(line.lineId), '">Back to Search</button></div>',
        '<div class="rfq2-two-column-grid"><label class="rfq2-field"><span>Assembly Number *</span><input data-rfq-new-assembly-field="assemblyNumber" data-rfq-line-id="', escapeHtml(line.lineId), '" value="', escapeHtml(search.newAssembly.assemblyNumber), '" /></label>',
        '<label class="rfq2-field"><span>Description</span><input data-rfq-new-assembly-field="description" data-rfq-line-id="', escapeHtml(line.lineId), '" value="', escapeHtml(search.newAssembly.description), '" /></label></div>',
        '<div class="rfq2-primary-actions"><button type="button" class="rfq2-button" data-rfq-action="save-new-assembly" data-rfq-line-id="', escapeHtml(line.lineId), '">Use New Assembly</button></div></div>'
      ].join("");
    } else {
      const results = search.results.length
        ? '<div class="rfq2-search-results">' + search.results.map(assembly => [
          '<button type="button" class="rfq2-search-result" data-rfq-action="select-assembly" data-rfq-line-id="', escapeHtml(line.lineId), '" data-rfq-assembly-id="', escapeHtml(assembly.assemblyId), '">',
          '<strong>', escapeHtml(assembly.assemblyNumber), '</strong><span>', escapeHtml(assembly.description || "No description"),
          assembly.revisions.length ? ' · Revisions: ' + escapeHtml(assembly.revisions.join(", ")) : ' · No recorded revisions', '</span></button>'
        ].join("")).join("") + '</div>'
        : search.searchPerformed ? '<p class="rfq2-empty-state">No existing assemblies matched this search.</p>' : "";
      resolutionMarkup = [
        '<div class="rfq2-search-panel"><h4>Existing Assembly?</h4><label class="rfq2-field"><span>Assembly Search</span>',
        '<input data-rfq-assembly-search data-rfq-line-id="', escapeHtml(line.lineId), '" placeholder="Search assembly number, drawing, or description" value="', escapeHtml(search.query), '" /></label>',
        '<div class="rfq2-search-actions"><button type="button" class="rfq2-button" data-rfq-action="search-assembly" data-rfq-line-id="', escapeHtml(line.lineId), '">Search Assemblies</button>',
        '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="start-new-assembly" data-rfq-line-id="', escapeHtml(line.lineId), '">Create New Assembly</button></div>',
        results, '</div>'
      ].join("");
    }

    return [
      '<article class="rfq2-line-card" tabindex="-1" data-rfq-assembly-card="', escapeHtml(line.lineId), '">',
      '<header class="rfq2-line-header"><div><p class="rfq2-eyebrow">RFQ Line ', index + 1, '</p><h3>', escapeHtml(line.lineId), '</h3></div>',
      '<button type="button" class="rfq2-button rfq2-button-secondary rfq2-line-remove" data-rfq-action="remove-line" data-rfq-line-id="', escapeHtml(line.lineId), '">Remove Line</button></header>',
      '<div class="rfq2-line-body"><div class="rfq2-two-column-grid">',
      '<label class="rfq2-field"><span>Requested Quantities</span><input data-rfq-line-field="requestedQuantities" data-rfq-line-id="', escapeHtml(line.lineId), '" placeholder="Example: 10, 25, 50" value="', escapeHtml(line.requestedQuantities), '" /></label>',
      '<label class="rfq2-field"><span>Line Notes</span><input data-rfq-line-field="notes" data-rfq-line-id="', escapeHtml(line.lineId), '" placeholder="Assembly-specific requirements" value="', escapeHtml(line.notes), '" /></label>',
      '</div>', resolutionMarkup, '</div></article>'
    ].join("");
  }

  function renderRevisionStep() {
    const target = document.getElementById("rfq2RevisionContent");
    if (!target) return;
    if (!areAssembliesResolved()) {
      target.innerHTML = lockedMessage(state.rfqLines.length ? "Resolve every RFQ Line assembly before assigning revisions." : "Add and resolve at least one RFQ Line assembly first.");
      return;
    }
    target.innerHTML = '<div class="rfq2-line-list">' + state.rfqLines.map(renderRevisionCard).join("") + '</div>';
  }

  function renderRevisionCard(line, index) {
    if (line.revision) {
      return [
        '<article class="rfq2-resolution-summary" tabindex="-1" data-rfq-revision-card="', escapeHtml(line.lineId), '">',
        '<div class="rfq2-resolution-heading"><div><p class="rfq2-eyebrow">RFQ Line ', index + 1, '</p>',
        '<h3>', escapeHtml(line.assembly.assemblyNumber), ' · Revision ', escapeHtml(line.revision.revision), '</h3></div>',
        '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="change-revision" data-rfq-line-id="', escapeHtml(line.lineId), '">Change Revision</button></div>',
        '<div class="rfq2-detail-grid">', detailItem("Resolution", line.revision.resolution === "existing" ? "Existing Revision" : "New Revision"),
        detailItem("Active Revision", line.revision.revision), detailItem("Status", line.revision.status), '</div></article>'
      ].join("");
    }

    const draft = getRevisionDraft(line.lineId);
    const existingOptions = line.assembly.availableRevisions.map(revision => '<option value="' + escapeHtml(revision) + '"' + (draft.existingRevision === revision ? ' selected' : '') + '>' + escapeHtml(revision) + '</option>').join("");
    const existingMarkup = existingOptions
      ? ['<div class="rfq2-revision-option"><h4>Existing Revision</h4><p>Select a revision already associated with this assembly.</p>',
        '<label class="rfq2-field"><span>Existing Revision</span><select data-rfq-revision-draft-field="existingRevision" data-rfq-line-id="', escapeHtml(line.lineId), '"><option value="">Select revision...</option>', existingOptions, '</select></label>',
        '<button type="button" class="rfq2-button rfq2-button-secondary" data-rfq-action="use-existing-revision" data-rfq-line-id="', escapeHtml(line.lineId), '">Use Existing Revision</button></div>'].join("")
      : '<div class="rfq2-revision-option unavailable"><h4>Existing Revision</h4><p>No existing revisions were found for this assembly.</p></div>';

    return [
      '<article class="rfq2-line-card" tabindex="-1" data-rfq-revision-card="', escapeHtml(line.lineId), '">',
      '<header class="rfq2-line-header"><div><p class="rfq2-eyebrow">RFQ Line ', index + 1, '</p><h3>', escapeHtml(line.assembly.assemblyNumber), '</h3></div></header>',
      '<div class="rfq2-line-body"><div class="rfq2-resolution-options">', existingMarkup,
      '<div class="rfq2-revision-option"><h4>New Revision</h4><p>Create one new active revision for this RFQ Line.</p>',
      '<label class="rfq2-field"><span>New Revision *</span><input data-rfq-revision-draft-field="newRevision" data-rfq-line-id="', escapeHtml(line.lineId), '" placeholder="Example: Rev B" value="', escapeHtml(draft.newRevision), '" /></label>',
      '<label class="rfq2-field"><span>Revision Notes</span><textarea data-rfq-revision-draft-field="notes" data-rfq-line-id="', escapeHtml(line.lineId), '" rows="2">', escapeHtml(draft.notes), '</textarea></label>',
      '<button type="button" class="rfq2-button" data-rfq-action="use-new-revision" data-rfq-line-id="', escapeHtml(line.lineId), '">Use New Revision</button></div>',
      '</div></div></article>'
    ].join("");
  }

  function renderDocumentStep() {
    const target = document.getElementById("rfq2DocumentContent");
    if (!target) return;
    if (!isDocumentStepUnlocked()) {
      target.innerHTML = lockedMessage("Complete Customer, Assembly, and Revision Resolution before uploading documents.");
      return;
    }
    target.innerHTML = [
      '<div class="rfq2-file-section rfq2-file-section-first"><div><h3>Initial RFQ Email *</h3>',
      '<p>The original customer communication is the parent document for this RFQ.</p></div>',
      '<div id="rfq2PackageDropZone" class="rfq2-drop-zone" data-rfq-drop-zone="package" tabindex="0" role="button">',
      '<strong>Drop the original customer email here</strong><span>or select files. No parsing or analysis will be performed.</span><small>.msg, .eml, .pdf, .txt, or .zip</small></div>',
      '<input class="rfq2-file-input" data-rfq-file-input="package" type="file" multiple accept=".msg,.eml,.pdf,.txt,.zip" />',
      '<div class="rfq2-file-list">', renderFileList(state.rfq.documents, { action: "remove-package-file" }), '</div></div>',
      '<div class="rfq2-line-document-list">', state.rfqLines.map((line, index) => renderLineDocuments(line, index)).join(""), '</div>'
    ].join("");
  }

  function renderLineDocuments(line, index) {
    return [
      '<section class="rfq2-line-document-card"><div><p class="rfq2-eyebrow">RFQ Line ', index + 1, '</p><h3>', escapeHtml(line.assembly.assemblyNumber), ' · Revision ', escapeHtml(line.revision.revision), '</h3></div>',
      '<div class="rfq2-drop-zone compact" data-rfq-drop-zone="line" data-rfq-line-id="', escapeHtml(line.lineId), '" tabindex="0" role="button">',
      '<strong>Drop assembly documents here</strong><span>Drawing, BOM, specifications, CAD, photos, or supporting documents.</span></div>',
      '<input class="rfq2-file-input" data-rfq-file-input="line" data-rfq-line-id="', escapeHtml(line.lineId), '" type="file" multiple />',
      '<div class="rfq2-file-list">', renderFileList(line.documents, { action: "remove-line-file", lineId: line.lineId }), '</div></section>'
    ].join("");
  }

  function renderFileList(files, options) {
    if (!files.length) return '<p class="rfq2-file-list-empty">No documents queued yet.</p>';
    return '<ul>' + files.map((file, index) => [
      '<li><span class="rfq2-file-name" title="', escapeHtml(file.name), '">', escapeHtml(file.name), '</span>',
      '<span class="rfq2-file-meta">', escapeHtml(formatFileSize(file.size)), '</span>',
      '<button type="button" class="rfq2-button rfq2-button-secondary rfq2-file-remove" data-rfq-action="', options.action,
      '" data-rfq-file-index="', index, '"', options.lineId ? ' data-rfq-line-id="' + escapeHtml(options.lineId) + '"' : '', '>Remove</button></li>'
    ].join("")).join("") + '</ul>';
  }

  function renderStepStates() {
    setStepState("rfq2CustomerStepState", isCustomerResolved() ? "Resolved" : "Required", isCustomerResolved() ? "complete" : "");
    setStepState("rfq2AssemblyStepState", !isCustomerResolved() ? "Locked" : areAssembliesResolved() ? "Resolved" : "Required", !isCustomerResolved() ? "locked" : areAssembliesResolved() ? "complete" : "");
    setStepState("rfq2RevisionStepState", !areAssembliesResolved() ? "Locked" : areRevisionsResolved() ? "Resolved" : "Required", !areAssembliesResolved() ? "locked" : areRevisionsResolved() ? "complete" : "");
    setStepState("rfq2DocumentStepState", !isDocumentStepUnlocked() ? "Locked" : state.rfq.documents.length ? "Documents Added" : "Required", !isDocumentStepUnlocked() ? "locked" : state.rfq.documents.length ? "complete" : "");
  }

  function setStepState(id, label, className) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = label;
    element.className = "rfq2-step-state" + (className ? " " + className : "");
  }

  function renderValidation() {
    const target = document.getElementById("rfq2Validation");
    if (!target) return;
    target.hidden = !state.validation.errors.length;
    target.innerHTML = state.validation.errors.length
      ? '<strong>Complete the following before reviewing RFQ Initialization:</strong><ul>' + state.validation.errors.map(error => '<li>' + escapeHtml(error.message) + '</li>').join("") + '</ul>'
      : "";
  }

  function focusFirstError(error) {
    const target = error?.selector ? mount?.querySelector(error.selector) : null;
    (target || document.getElementById("rfq2Validation"))?.focus?.();
  }

  function renderView() {
    setHidden("rfq2Editor", state.workflow.currentView !== "edit");
    setHidden("rfq2ReviewView", state.workflow.currentView !== "review");
    setHidden("rfq2CompleteView", state.workflow.currentView !== "complete");
    const status = state.workflow.currentView === "review"
      ? "Reviewing RFQ Initialization"
      : state.workflow.currentView === "complete"
        ? "RFQ Initialization Complete"
        : INITIALIZATION_STATUS;
    setText("rfq2WorkspaceStatus", status);
    setText("rfq2CurrentStatus", state.rfq.status);
  }

  function renderReview() {
    const target = document.getElementById("rfq2ReviewContent");
    if (!target) return;
    target.innerHTML = [
      '<section class="rfq2-review-section"><h3>Draft Identity</h3><div class="rfq2-review-grid">',
      reviewItem("Draft ID", state.rfq.draftId), reviewItem("Created Date", state.rfq.createdDate),
      reviewItem("Created By", state.rfq.createdBy), reviewItem("Status", state.rfq.status),
      reviewItem("Requested Response Date", state.rfq.requestedResponseDate),
      reviewItem("Customer Reference", state.rfq.customerReference || "Not provided"),
      reviewItem("General Notes", state.rfq.generalNotes || "No notes entered", true), '</div></section>',
      '<section class="rfq2-review-section"><h3>Customer Resolution</h3><div class="rfq2-review-grid">',
      reviewItem("Customer Name", state.customer.companyName), reviewItem("ERP Status", state.customer.erpStatus),
      reviewItem("ERP Customer Number", state.customer.erpCustomerNumber || "Not assigned"),
      state.customer.resolution === "prospective" ? reviewItem("Buyer Contact", state.customer.buyerContact || "Not provided") : "",
      state.customer.resolution === "prospective" ? reviewItem("Engineering Contact", state.customer.engineeringContact || "Not provided") : "",
      state.customer.resolution === "prospective" ? reviewItem("Email", state.customer.email || "Not provided") : "", '</div></section>',
      '<section class="rfq2-review-section"><h3>RFQ Lines</h3><div class="rfq2-review-lines">',
      state.rfqLines.map(renderReviewLine).join(""), '</div></section>',
      '<section class="rfq2-review-section"><h3>Document Intake</h3><p><strong>Initial RFQ Email:</strong> ', state.rfq.documents.map(file => escapeHtml(file.name)).join(", "), '</p><p><strong>Total Documents:</strong> ', getAllDocumentMetadata().length, '</p></section>',
      '<section class="rfq2-review-section"><h3>Phase 1 Result</h3><p>Complete RFQ Initialization and create an in-memory <strong>DLE_RFQ_INITIALIZATION_V1</strong> record ready for the future RFQ Review phase.</p></section>'
    ].join("");
  }

  function renderReviewLine(line, index) {
    return [
      '<article class="rfq2-review-line"><h4>RFQ Line ', index + 1, '</h4><div class="rfq2-review-grid">',
      reviewItem("Line ID", line.lineId), reviewItem("Assembly", line.assembly.assemblyNumber),
      reviewItem("Assembly Resolution", line.assembly.status), reviewItem("Active Revision", line.revision.revision),
      reviewItem("Revision Resolution", line.revision.resolution === "existing" ? "Existing Revision" : "New Revision"),
      reviewItem("Requested Quantities", line.requestedQuantities || "Not provided"),
      reviewItem("Assembly Documents", line.documents.length + " file" + (line.documents.length === 1 ? "" : "s")),
      reviewItem("Notes", line.notes || "No notes entered", true), '</div></article>'
    ].join("");
  }

  function renderCompleteSummary() {
    const target = document.getElementById("rfq2CompleteSummary");
    const record = committedInitialization;
    if (!target || !record) return;
    target.innerHTML = [
      completeItem("Draft ID", record.rfq.draftId), completeItem("Customer", record.customer.companyName),
      completeItem("Customer Status", record.customer.erpStatus), completeItem("RFQ Lines", String(record.rfqLines.length)),
      completeItem("Documents", String(record.documents.allUploadedDocuments.length)), completeItem("Status", record.rfq.status)
    ].join("");
  }

  function detailItem(label, value) {
    return '<div><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(value) + '</span></div>';
  }

  function reviewItem(label, value, wide = false) {
    return '<div class="' + (wide ? "rfq2-wide" : "") + '"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(value) + '</span></div>';
  }

  function completeItem(label, value) {
    return '<div><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(value) + '</span></div>';
  }

  function lockedMessage(message) {
    return '<div class="rfq2-locked-message"><span aria-hidden="true">→</span><p>' + escapeHtml(message) + '</p></div>';
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
  }

  function setHidden(id, hidden) {
    const element = document.getElementById(id);
    if (element) element.hidden = hidden;
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

  function sanitizeIdPart(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "UNSPECIFIED";
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
    return committedInitialization ? JSON.parse(JSON.stringify(committedInitialization)) : null;
  }

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: loadRfqWorkspace,
    getCommittedInitialization: getSnapshot,
    getCommittedIntake: getSnapshot
  });
})(window, document);

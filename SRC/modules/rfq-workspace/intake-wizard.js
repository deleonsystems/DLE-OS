(function registerDleIntakeWizard(window, document) {
  "use strict";

  const STEPS = ["intake-type", "customer", "assembly-count", "assembly-number", "revision",
    "quantity", "scope", "technical-files", "file-association", "requirements", "review"];
  let root = null;
  let searchTimer = null;
  let committed = null;
  let state = createState();

  function createState() {
    return {
      currentStep: 0, status: "DRAFT", intakeType: "", customer: null, assemblyCount: 1,
      assemblies: [{ lineNumber: 1, assemblyNumber: "", revision: "", quantity: null }],
      deLeonScope: "", technicalFilesProvided: null, technicalFiles: [], requestCorrelationId: null, customerRequirements: ["PRICE"],
      customerSearch: { query: "", status: "idle", results: [], message: "" },
      submit: { status: "idle", message: "" }
    };
  }

  function mount(element) {
    if (root === element && element.querySelector("[data-intake-wizard]")) {
      render();
      return;
    }
    root = element;
    state = createState();
    committed = null;
    root.innerHTML = '<main class="intake-wizard" data-intake-wizard>' +
      '<header class="intake-wizard-header"><div><p class="intake-kicker">RFQ / QUOTING</p><h1>Intake Wizard</h1></div><span class="intake-sim-badge">SIM</span></header>' +
      '<div class="intake-progress" aria-label="Intake progress"><span id="intakeProgressBar"></span></div>' +
      '<div class="intake-layout"><aside id="intakeAnswers" class="intake-answers" aria-label="Answers so far"></aside>' +
      '<section id="intakeConversation" class="intake-conversation-card" aria-live="polite"></section></div></main>';
    root.addEventListener("click", handleClick);
    root.addEventListener("input", handleInput);
    root.addEventListener("change", handleChange);
    root.addEventListener("dragenter", handleFileDragOver);
    root.addEventListener("dragover", handleFileDragOver);
    root.addEventListener("dragleave", handleFileDragLeave);
    root.addEventListener("drop", handleFileDrop);
    root.addEventListener("submit", handleSubmit);
    render();
  }

  function render() {
    if (!root) return;
    restoreProgressBeforeLayout();
    root.querySelector("#intakeAnswers").innerHTML = renderAnswers();
    root.querySelector("#intakeConversation").innerHTML = renderStep();
    syncProgressPlacement();
    root.querySelector("#intakeProgressBar").style.width = Math.round((Math.min(state.currentStep, 10) / 10) * 100) + "%";
    window.setTimeout(() => root.querySelector("[data-intake-autofocus]")?.focus?.(), 0);
  }

  function restoreProgressBeforeLayout() {
    const progress = root?.querySelector(".intake-progress");
    const layout = root?.querySelector(".intake-layout");
    if (progress && layout && (progress.parentElement !== layout.parentElement || progress.nextElementSibling !== layout)) {
      layout.insertAdjacentElement("beforebegin", progress);
    }
  }

  function syncProgressPlacement() {
    const progress = root?.querySelector(".intake-progress");
    const layout = root?.querySelector(".intake-layout");
    const conversation = root?.querySelector("#intakeConversation");
    if (!progress || !layout || !conversation) return;
    if (document.body?.dataset?.viewMode === "mobile") {
      const stepLabel = conversation.querySelector(".intake-step-label");
      if (stepLabel) stepLabel.insertAdjacentElement("afterend", progress);
      else conversation.prepend(progress);
      return;
    }
    restoreProgressBeforeLayout();
  }

  function firstName() {
    return String(window.DleOsSession?.user?.displayName || "there").trim().split(/\s+/)[0] || "there";
  }

  function renderStep() {
    if (state.status === "COMPLETE") return renderComplete();
    const step = STEPS[state.currentStep];
    if (step === "intake-type") return question("Hi " + escapeHtml(firstName()) + ". What intake are we working on?",
      choice("New Quote Request", "NEW_QUOTE_REQUEST", "intake-type"), "Choose the business event that came into DLE.");
    if (step === "customer") return question("Who did you get it from?",
      '<label class="intake-search"><span class="sr-only">Search customers</span><input data-intake-customer-search data-intake-autofocus autocomplete="off" value="' +
      escapeHtml(state.customerSearch.query) + '" placeholder="Search customer name or number"></label>' + renderCustomerResults(),
      "Select a governed customer identity from the SIM directory.");
    if (step === "assembly-count") return question("How many different assemblies are they asking us to quote?",
      numberInput("assembly-count", state.assemblyCount), "Count distinct assemblies or part numbers here. Piece quantity is captured separately for each assembly.");
    if (step === "assembly-number") return question("What is the assembly number?",
      textInput("assembly-number", state.assemblies[0].assemblyNumber, "B11283-17"), "Capture the requested identity exactly as received.");
    if (step === "revision") return question("What revision are they asking for?",
      textInput("revision", state.assemblies[0].revision, "B"), "Revision is explicit and is never substituted from history.");
    if (step === "quantity") return question("What quantity are they asking us to quote?",
      numberInput("quantity", state.assemblies[0].quantity ?? ""), "Enter the requested quantity for this assembly.");
    if (step === "scope") return question("What is De Leon expected to provide?",
      choice("Material + Labor", "MATERIAL_AND_LABOR", "scope") + choice("Labor Only", "LABOR_ONLY", "scope") +
      choice("Material Only", "MATERIAL_ONLY", "scope"), "This prepares the future workstreams without starting them.");
    if (step === "technical-files") return question("Did the customer send technical files?",
      choice("Yes", "yes", "technical-files") + choice("No", "no", "technical-files"),
      "Technical files include drawings, specifications, and related source documents.");
    if (step === "file-association") return question("Which technical files came with the request?",
      '<label class="intake-file-control" data-intake-drop-zone><input type="file" data-intake-files multiple>' +
      '<span class="intake-file-drop-title">Drop customer technical files here</span><small>or click to browse</small></label>' +
      renderFiles() + '<p class="intake-file-note">When you submit, SIM saves and verifies its own copy of every selected file. Technical Review opens those copies; no original folder or drive is needed afterward. Up to 20 MB per file.</p>' +
      navButtons(true, "Continue"), "Associate the source package with the intake.");
    if (step === "requirements") return question("What does the customer need back?",
      choice("Price + Lead Time", "PRICE_AND_LEAD_TIME", "requirements"),
      "Price is inherent in an RFQ; this confirms lead time is also required.");
    return renderReview();
  }

  function question(title, body, hint) {
    return '<div class="intake-step-label">Question ' + (state.currentStep + 1) + ' of 10</div><h2>' + title +
      '</h2><p class="intake-question-hint">' + hint + '</p><div class="intake-answer-control">' + body + '</div>' +
      (state.currentStep > 0 && STEPS[state.currentStep] !== "file-association" ? navButtons(false) : "");
  }

  function choice(label, value, field) {
    return '<button type="button" class="intake-choice" data-intake-choice="' + field + '" data-intake-value="' + value +
      '"><span>' + escapeHtml(label) + '</span><b aria-hidden="true">→</b></button>';
  }

  function textInput(field, value, placeholder) {
    return '<form data-intake-form="' + field + '"><input data-intake-autofocus data-intake-value-input value="' +
      escapeHtml(value) + '" placeholder="' + escapeHtml(placeholder) + '"><button class="intake-primary">Continue</button></form>';
  }

  function numberInput(field, value) {
    return '<form data-intake-form="' + field + '"><input data-intake-autofocus data-intake-value-input type="number" min="1" step="1" value="' +
      escapeHtml(value) + '"><button class="intake-primary">Continue</button></form>';
  }

  function navButtons(includeContinue, label) {
    return '<div class="intake-nav"><button type="button" data-intake-action="back" class="intake-back">← Back</button>' +
      (includeContinue ? '<button type="button" data-intake-action="continue" class="intake-primary">' + escapeHtml(label) + '</button>' : "") + '</div>';
  }

  function renderCustomerResults() {
    const search = state.customerSearch;
    if (search.status === "loading") return '<p class="intake-search-status">Searching…</p>';
    if (search.status === "error" || search.status === "empty") return '<p class="intake-search-status">' + escapeHtml(search.message) + '</p>';
    return search.results.map(customer => '<button type="button" class="intake-customer-result" data-intake-customer="' +
      escapeHtml(customer.customerNumber) + '"><span><strong>' + escapeHtml(customer.customerName) + '</strong><small>Customer ' +
      escapeHtml(customer.customerNumber) + ' · SIM fixture</small></span><b>Choose</b></button>').join("");
  }

  function renderFiles() {
    if (!state.technicalFiles.length) return '<p class="intake-search-status">No files selected yet.</p>';
    return '<ul class="intake-file-list">' + state.technicalFiles.map((file, index) => '<li><span><strong>' +
      escapeHtml(file.name) + '</strong><small>' + formatBytes(file.size) + '</small></span><button type="button" data-intake-remove-file="' +
      index + '">Remove</button></li>').join("") + '</ul>';
  }

  function renderAnswers() {
    const items = [];
    if (state.intakeType) items.push([0, "Intake", "New Quote Request"]);
    if (state.customer) items.push([1, "Customer", state.customer.customerName]);
    if (state.currentStep > 2) items.push([2, "Assemblies", state.assemblyCount]);
    if (state.assemblies[0].assemblyNumber) items.push([3, "Assembly", state.assemblies[0].assemblyNumber]);
    if (state.assemblies[0].revision) items.push([4, "Revision", state.assemblies[0].revision]);
    if (state.assemblies[0].quantity) items.push([5, "Quantity", state.assemblies[0].quantity]);
    if (state.deLeonScope) items.push([6, "Scope", scopeLabel(state.deLeonScope)]);
    if (state.technicalFilesProvided !== null) items.push([7, "Technical Files", state.technicalFilesProvided ? "Customer provided" : "None"]);
    if (state.customerRequirements.includes("LEAD_TIME")) items.push([9, "Customer Requires", "Price + Lead Time"]);
    if (!items.length) return '<p>Answers will appear here as we go.</p>';
    return '<p class="intake-answers-title">Answers so far</p>' + items.map(item => '<button type="button" data-intake-edit="' +
      item[0] + '"><span>' + escapeHtml(item[1]) + '</span><strong>' + escapeHtml(item[2]) + '</strong></button>').join("");
  }

  function renderReview() {
    const assembly = state.assemblies[0];
    return '<div class="intake-step-label">Final review</div><h2>RFQ Intake</h2>' +
      '<p class="intake-question-hint">Check the request before sending it to Technical Review.</p><dl class="intake-review">' +
      reviewRow("Customer", state.customer?.customerName, 1) + reviewRow("Assembly", assembly.assemblyNumber, 3) +
      reviewRow("Revision", assembly.revision, 4) + reviewRow("Quantity", assembly.quantity, 5) +
      reviewRow("De Leon Scope", scopeLabel(state.deLeonScope), 6) +
      reviewRow("Technical Files", state.technicalFilesProvided ? "Customer provided (" + state.technicalFiles.length + " associated)" : "Not provided", 7) +
      reviewRow("Customer Requires", "Price + Lead Time", 9) + '</dl>' +
      (state.submit.message ? '<p class="intake-submit-error" role="alert">' + escapeHtml(state.submit.message) + '</p>' : "") +
      '<div class="intake-review-actions"><button type="button" data-intake-action="back" class="intake-back">← Back</button>' +
      '<button type="button" data-intake-action="submit" class="intake-primary" ' + (state.submit.status === "saving" ? "disabled" : "") + '>' +
      (state.submit.status === "saving" ? "Sending…" : "Submit for Technical Review") + '</button></div>';
  }

  function reviewRow(label, value, step) {
    return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd><button type="button" data-intake-edit="' + step + '">Edit</button></div>';
  }

  function renderComplete() {
    return '<div class="intake-complete-mark">✓</div><p class="intake-kicker">INTAKE PRESERVED</p><h2>Submitted for Technical Review</h2>' +
      '<p class="intake-question-hint">' + escapeHtml(committed?.intakeId || "RFQ Intake") +
      ' is preserved in SIM structured state and is waiting for a trained reviewer. Review has not started.</p>' +
      (committed?.documentPreservationState === 'BINARIES_VERIFIED_SIM' ? '<p class="intake-question-hint">Your technical files are saved and verified in SIM. Technical Review can reopen these copies without access to the original files or folders.</p>' : '') + '<div class="intake-handoff"><strong>Handoff point</strong><span>Technical Review · RFQ Review</span></div>' +
      '<button type="button" data-intake-action="restart" class="intake-primary">Start another intake</button>';
  }

  function clearAnswerForStep(stepIndex) {
    const step = STEPS[stepIndex];
    if (step === "intake-type") state.intakeType = "";
    if (step === "customer") state.customer = null;
    if (step === "assembly-count") state.assemblyCount = null;
    if (step === "assembly-number") state.assemblies[0].assemblyNumber = "";
    if (step === "revision") state.assemblies[0].revision = "";
    if (step === "quantity") state.assemblies[0].quantity = null;
    if (step === "scope") state.deLeonScope = "";
    if (step === "technical-files") state.technicalFilesProvided = null;
    if (step === "file-association") state.technicalFiles = [];
    if (step === "requirements") state.customerRequirements = ["PRICE"];
  }

  function goBack() {
    const previousStep = Math.max(0, state.currentStep - 1);
    if (STEPS[previousStep] === "file-association" && state.technicalFiles.some(file => file.documentId)) {
      void clearStagedFilesAndGoBack(previousStep);
      return;
    }
    clearAnswerForStep(previousStep);
    state.currentStep = previousStep;
    render();
  }

  async function clearStagedFilesAndGoBack(previousStep) {
    try {
      for (let index = state.technicalFiles.length - 1; index >= 0; index -= 1) {
        await deleteStagedTechnicalFile(state.technicalFiles[index]);
        state.technicalFiles.splice(index, 1);
      }
      state.currentStep = previousStep;
      render();
    } catch (error) {
      render();
      showInlineError(error.message);
    }
  }

  function handleClick(event) {
    if (state.submit.status === "saving") return;
    const selected = event.target.closest("[data-intake-choice]");
    if (selected) return selectChoice(selected.dataset.intakeChoice, selected.dataset.intakeValue);
    const customer = event.target.closest("[data-intake-customer]");
    if (customer) return selectCustomer(customer.dataset.intakeCustomer);
    const edit = event.target.closest("[data-intake-edit]");
    if (edit) { state.currentStep = Number(edit.dataset.intakeEdit); return render(); }
    const remove = event.target.closest("[data-intake-remove-file]");
    if (remove) { void removeTechnicalFile(Number(remove.dataset.intakeRemoveFile)); return; }
    const action = event.target.closest("[data-intake-action]")?.dataset.intakeAction;
    if (action === "back") goBack();
    if (action === "continue") continueFromFiles();
    if (action === "submit") submitIntake();
    if (action === "restart") { state = createState(); committed = null; render(); }
  }

  function handleInput(event) {
    if (!event.target.matches("[data-intake-customer-search]")) return;
    state.customerSearch.query = event.target.value;
    state.customerSearch.status = "loading";
    updateCustomerResults();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(searchCustomers, 250);
  }

  function handleChange(event) {
    if (!event.target.matches("[data-intake-files]")) return;
    setTechnicalFiles(event.target.files);
    event.target.value = "";
  }

  function handleFileDragOver(event) {
    const dropZone = event.target.closest?.("[data-intake-drop-zone]");
    if (!dropZone) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropZone.classList.add("is-dragging");
  }

  function handleFileDragLeave(event) {
    const dropZone = event.target.closest?.("[data-intake-drop-zone]");
    if (!dropZone || dropZone.contains(event.relatedTarget)) return;
    dropZone.classList.remove("is-dragging");
  }

  function handleFileDrop(event) {
    const dropZone = event.target.closest?.("[data-intake-drop-zone]");
    if (!dropZone) return;
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) {
      return showInlineError("No browser files were available from that drop. Save email attachments to this device, then drop them here or click to browse.");
    }
    setTechnicalFiles(files);
  }

  function setTechnicalFiles(files) {
    if (state.submit.status === "saving") return;
    const additions = Array.from(files || []).map(file => ({
      name: file.name, size: file.size, type: file.type || "application/octet-stream", lastModified: file.lastModified, binary: file
    }));
    const knownFiles = new Set(state.technicalFiles.map(technicalFileIdentity));
    state.technicalFiles = [...state.technicalFiles, ...additions.filter(file => {
      const identity = technicalFileIdentity(file);
      if (knownFiles.has(identity)) return false;
      knownFiles.add(identity);
      return true;
    })];
    root.querySelector(".intake-inline-error")?.remove();
    render();
  }

  async function removeTechnicalFile(index) {
    const file = state.technicalFiles[index];
    try {
      await deleteStagedTechnicalFile(file);
      state.technicalFiles.splice(index, 1); render();
    } catch (error) { showInlineError(error.message); }
  }

  async function deleteStagedTechnicalFile(file) {
    if (!file?.documentId) return;
    const response = await window.fetch('/api/sim/intake-drafts/' + encodeURIComponent(state.requestCorrelationId) + '/documents/' + encodeURIComponent(file.documentId), { method: 'DELETE', credentials: 'include' });
    if (!response.ok) throw new Error('SIM could not remove the staged copy. Retry or finish the existing submission.');
  }

  function technicalFileIdentity(file) {
    return [file.name, file.size, file.type, file.lastModified].join("\u0000");
  }

  function handleSubmit(event) {
    const form = event.target.closest("[data-intake-form]");
    if (!form) return;
    event.preventDefault();
    const value = form.querySelector("[data-intake-value-input]").value.trim();
    const field = form.dataset.intakeForm;
    if (field === "assembly-count") {
      const count = Number(value);
      if (!Number.isInteger(count) || count !== 1) return showInlineError("Phase 1 supports one assembly per intake.");
      state.assemblyCount = count;
    }
    if (field === "assembly-number") {
      if (!value) return showInlineError("Enter the assembly number exactly as requested.");
      state.assemblies[0].assemblyNumber = value.toUpperCase();
    }
    if (field === "revision") {
      if (!value) return showInlineError("Enter the requested revision.");
      state.assemblies[0].revision = value.toUpperCase();
    }
    if (field === "quantity") {
      const quantity = Number(value);
      if (!Number.isInteger(quantity) || quantity < 1) return showInlineError("Enter a whole quantity greater than zero.");
      state.assemblies[0].quantity = quantity;
    }
    next();
  }

  function selectChoice(field, value) {
    if (field === "intake-type") state.intakeType = value;
    if (field === "scope") state.deLeonScope = value;
    if (field === "technical-files") {
      state.technicalFilesProvided = value === "yes";
      if (!state.technicalFilesProvided && state.technicalFiles.some(file => file.documentId)) { state.technicalFilesProvided = true; return showInlineError("Remove staged files individually before changing this answer."); }
      if (!state.technicalFilesProvided) state.technicalFiles = [];
    }
    if (field === "requirements") state.customerRequirements = ["PRICE", "LEAD_TIME"];
    next();
  }

  function next() {
    state.currentStep += 1;
    if (STEPS[state.currentStep] === "file-association" && !state.technicalFilesProvided) state.currentStep += 1;
    render();
    if (STEPS[state.currentStep] === "customer") searchCustomers();
  }

  async function searchCustomers() {
    state.customerSearch.status = "loading";
    updateCustomerResults();
    try {
      const response = await window.DleApiClient.searchCanonicalCustomers(state.customerSearch.query, { page: 1, pageSize: 25 });
      state.customerSearch.results = Array.isArray(response.items) ? response.items : [];
      state.customerSearch.status = state.customerSearch.results.length ? "ready" : "empty";
      state.customerSearch.message = state.customerSearch.results.length ? "" : "No matching existing customer found.";
    } catch (error) {
      state.customerSearch.status = "error";
      state.customerSearch.message = "Customer search could not be completed in SIM.";
    }
    updateCustomerResults();
  }

  function updateCustomerResults() {
    if (STEPS[state.currentStep] !== "customer") return;
    root.querySelectorAll(".intake-search-status, .intake-customer-result").forEach(item => item.remove());
    root.querySelector(".intake-answer-control")?.insertAdjacentHTML("beforeend", renderCustomerResults());
  }

  function selectCustomer(customerNumber) {
    const customer = state.customerSearch.results.find(item => item.customerNumber === customerNumber);
    if (!customer) return;
    state.customer = { customerId: customer.customerId, customerNumber: customer.customerNumber,
      customerName: customer.customerName, resolutionSource: "sim-canonical-customer-directory" };
    next();
  }

  function continueFromFiles() {
    if (!state.technicalFiles.length) return showInlineError("Choose at least one customer technical file.");
    next();
  }

  async function submitIntake() {
    state.submit = { status: "saving", message: "" };
    render();
    const requestCorrelationId = state.requestCorrelationId ||= window.crypto?.randomUUID?.() || "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);
    const payload = { intakeType: state.intakeType, customer: state.customer, assemblyCount: state.assemblyCount,
      assemblies: state.assemblies, deLeonScope: state.deLeonScope, technicalFilesProvided: state.technicalFilesProvided,
      technicalFiles: state.technicalFiles.map(({binary, ...metadata}) => metadata), customerRequirements: state.customerRequirements,
      createdBy: window.DleOsSession?.user?.displayName || "SIM User", requestCorrelationId };
    try {
      for (const file of state.technicalFiles) {
        if (file.documentId) continue;
        const upload = await window.fetch('/api/sim/intake-drafts/' + encodeURIComponent(requestCorrelationId) + '/documents?name=' + encodeURIComponent(file.name) + '&lastModified=' + file.lastModified, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream', 'X-SIM-Document-Upload': '1' }, body: file.binary
        });
        const staged = await upload.json();
        if (!upload.ok || staged.binaryStatus !== 'VERIFIED') throw new Error(staged.message || 'SIM could not verify the selected file. Intake was not submitted.');
        Object.assign(file, staged);
      }
      payload.technicalFiles = state.technicalFiles.map(({binary, ...metadata}) => metadata);
      const response = await window.fetch("/api/sim/rfq-intakes", { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || "SIM could not preserve this intake.");
      committed = body.record;
      state.status = "COMPLETE";
      state.submit = { status: "complete", message: "" };
      document.dispatchEvent(new CustomEvent("dle:rfq-intake-handoff", { detail: { intake: snapshot() } }));
    } catch (error) {
      state.submit = { status: "error", message: error?.message || "SIM could not preserve this intake." };
    }
    render();
  }

  function showInlineError(message) {
    root.querySelector(".intake-inline-error")?.remove();
    root.querySelector(".intake-answer-control")?.insertAdjacentHTML("beforeend", '<p class="intake-inline-error" role="alert">' + escapeHtml(message) + '</p>');
  }

  function scopeLabel(value) {
    return { MATERIAL_AND_LABOR: "Material + Labor", LABOR_ONLY: "Labor Only", MATERIAL_ONLY: "Material Only" }[value] || "";
  }

  function formatBytes(bytes) { return bytes < 1024 ? bytes + " B" : (bytes / 1024).toFixed(1) + " KB"; }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }
  function snapshot() { return committed ? JSON.parse(JSON.stringify(committed)) : null; }

  document.addEventListener?.("dle:view-mode-change", syncProgressPlacement);
  window.DleIntakeWizard = Object.freeze({ mount, getCommittedIntake: snapshot });
})(window, document);

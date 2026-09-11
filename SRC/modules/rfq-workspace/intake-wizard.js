(function registerDleIntakeWizard(window, document) {
  "use strict";

  const QUOTE_STEPS = ["intake-type", "customer", "assembly-count", "assembly-number", "revision",
    "quantity", "assembly-type", "scope", "technical-files", "file-association", "requirements", "review"];
  const NEW_ORDER_STEPS = ["intake-type", "customer", "customer-po-number", "customer-po-type", "po-attachment",
    "payment-terms", "payment-terms-note", "address-match", "shipping-note", "shipping-method", "ups-account",
    "order-classification", "delivery-date", "delivery-date-note", "price-match", "price-note", "traceability",
    "traceability-records", "aerospace-requirements", "po-flowdowns", "additional-requirements", "review"];
  let root = null;
  let searchTimer = null;
  let committed = null;
  let state = createState();

  function createState() {
    return {
      currentStep: 0, status: "DRAFT", intakeType: "", customer: null, assemblyCount: 1,
      assemblies: [{ lineNumber: 1, assemblyNumber: "", revision: "", quantity: null }],
      preliminaryAssemblyType: null, deLeonScope: "", technicalFilesProvided: null, technicalFiles: [], requestCorrelationId: null, customerRequirements: ["PRICE"],
      contractReview: {
        customerPoNumber: "", customerPoType: "", paymentTermsMatch: null, paymentTermsActionNote: "",
        billingMatchesShipTo: null, shippingActionNote: "", shippingMethod: "", upsAccountNumber: "",
        orderClassification: "", deliveryDateAchievable: null, deliveryDateActionNote: "",
        priceMatchesQuote: null, priceActionNote: "", traceabilityRequired: null,
        traceabilityDeliverables: [], aerospaceRequirements: [], poFlowdowns: "",
        additionalContractQualityRequirements: "", specialRequirements: "",
        requirementsIdentifiedOnAttachedDocument: false
      },
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
    const progressMaximum = Math.max(1, steps().length - 1);
    root.querySelector("#intakeProgressBar").style.width = Math.round((Math.min(state.currentStep, progressMaximum) / progressMaximum) * 100) + "%";
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
    const step = steps()[state.currentStep];
    if (step === "intake-type") return question("Hi " + escapeHtml(firstName()) + ". What intake are we working on?",
      choice("New Quote Request", "NEW_QUOTE_REQUEST", "intake-type") +
      choice("New Order", "NEW_ORDER", "intake-type"), "Choose the business event that came into DLE.");
    if (step === "customer") return question("Who did you get it from?",
      '<label class="intake-search"><span class="sr-only">Search customers</span><input data-intake-customer-search data-intake-autofocus autocomplete="off" value="' +
      escapeHtml(state.customerSearch.query) + '" placeholder="Search customer name or number"></label>' + renderCustomerResults(),
      "Select a governed customer identity from the SIM directory.");
    if (state.intakeType === "NEW_ORDER") return renderNewOrderStep(step);
    if (step === "assembly-count") return question("How many different assemblies are they asking us to quote?",
      numberInput("assembly-count", state.assemblyCount), "Count distinct assemblies or part numbers here. Piece quantity is captured separately for each assembly.");
    if (step === "assembly-number") return question("What is the assembly number?",
      textInput("assembly-number", state.assemblies[0].assemblyNumber, "B11283-17"), "Capture the requested identity exactly as received.");
    if (step === "revision") return question("What revision are they asking for?",
      textInput("revision", state.assemblies[0].revision, "B"), "Revision is explicit and is never substituted from history.");
    if (step === "quantity") return question("What quantity are they asking us to quote?",
      numberInput("quantity", state.assemblies[0].quantity ?? ""), "Enter the requested quantity for this assembly.");
    if (step === "assembly-type") return question("What type of assembly is this?",
      Object.entries(intakeAssemblyTypes).map(([value, label]) => choice(label, value, "assembly-type")).join("") +
      (state.preliminaryAssemblyType?.type === "OTHER" ? '<form data-intake-form="assembly-type-description"><label>Describe the assembly type<input data-intake-value-input maxlength="200" value="' + escapeHtml(state.preliminaryAssemblyType.otherDescription || "") + '"></label><button class="intake-primary">Continue</button></form>' : ""),
      "Preliminary Intake information only. Technical Review will confirm the assembly type.");
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

  const intakeAssemblyTypes = { PCB_ASSEMBLY: "PCB Assembly", CABLE_AND_HARNESS_ASSEMBLY: "Cable and Harness Assembly", CHASSIS_BOX_BUILD_ASSEMBLY: "Chassis / Box Build Assembly", OTHER: "Other", UNKNOWN: "Unknown / Not Determined" };

  function preliminaryAssemblyLabel() {
    const value = state.preliminaryAssemblyType;
    return (intakeAssemblyTypes[value?.type] || intakeAssemblyTypes.UNKNOWN) + (value?.type === "OTHER" && value.otherDescription ? ": " + value.otherDescription : "");
  }

  function steps() {
    return state.intakeType === "NEW_ORDER" ? NEW_ORDER_STEPS : QUOTE_STEPS;
  }

  function renderNewOrderStep(step) {
    const review = state.contractReview;
    if (step === "customer-po-number") return question("What is the customer PO number?",
      textInput("customer-po-number", review.customerPoNumber, "Customer PO number"),
      "Capture the purchase-order identity exactly as received.");
    if (step === "customer-po-type") return question("How was the order received?",
      choice("Customer PO", "CUSTOMER_PO", "customer-po-type") +
      '<button type="button" class="intake-choice intake-choice-disabled" disabled aria-disabled="true"><span>Verbal PO <small>Planned for a future release</small></span></button>',
      "A customer PO attachment is required for this release.");
    if (step === "po-attachment") return question("Attach the customer PO.",
      '<label class="intake-file-control" data-intake-drop-zone><input type="file" data-intake-files multiple>' +
      '<span class="intake-file-drop-title">Drop the customer PO here</span><small>or click to browse</small></label>' +
      renderFiles() + '<p class="intake-file-note">SIM saves and verifies its own governed copy. At least one customer PO file is required.</p>' +
      navButtons(true, "Continue"), "Customer PO — required");
    if (step === "payment-terms") return question("Do the payment terms match the customer’s current terms?",
      yesNoChoice("payment-terms"), "Compare the customer PO with the current customer terms.");
    if (step === "payment-terms-note") return actionNoteQuestion("Notify A/R Department",
      "payment-terms-note", review.paymentTermsActionNote, "Record the resolution/action note. No notification is sent automatically.");
    if (step === "address-match") return question("Is the billing address the same as the ship-to address?",
      yesNoChoice("address-match"), "Confirm the addresses shown on the customer PO.");
    if (step === "shipping-note") return actionNoteQuestion("Verify and highlight the Ship To address",
      "shipping-note", review.shippingActionNote, "Record the confirmation or action taken.");
    if (step === "shipping-method") return question("What shipping method applies?",
      choice("Will Call", "WILL_CALL", "shipping-method") + choice("DLE Delivery", "DLE_DELIVERY", "shipping-method") +
      choice("UPS Charge", "UPS_CHARGE", "shipping-method") + choice("UPS Collect", "UPS_COLLECT", "shipping-method"),
      "Choose one shipping method.");
    if (step === "ups-account") return question("What UPS account number should be used?",
      textInput("ups-account", review.upsAccountNumber, "UPS account number"), "Required for UPS Collect.");
    if (step === "order-classification") return question("How should this order be classified?",
      choice("Repeat Order", "REPEAT_ORDER", "order-classification") +
      choice("New Assembly", "NEW_ASSEMBLY", "order-classification") +
      choice("New Revision", "NEW_REVISION", "order-classification"),
      "New Assembly: Create new BOM/router and check FAIR requirement. New Revision: Update BOM/router and check FAIR requirement.");
    if (step === "delivery-date") return question("Can we meet the delivery date?", yesNoChoice("delivery-date"),
      "Review the requested delivery date manually.");
    if (step === "delivery-date-note") return actionNoteQuestion("Contact customer to discuss the delivery date",
      "delivery-date-note", review.deliveryDateActionNote, "Record the required customer action. No contact is sent automatically.");
    if (step === "price-match") return question("Does the price match the price quoted?", yesNoChoice("price-match"),
      "Compare the customer PO price with the quote.");
    if (step === "price-note") return actionNoteQuestion("Review the quote and contact the customer",
      "price-note", review.priceActionNote, "Record the required action. No contact is sent automatically.");
    if (step === "traceability") return question("Is traceability required?", yesNoChoice("traceability"),
      "Record the contract requirement without interpreting or approving it.");
    if (step === "traceability-records") return question("Which traceability records or deliverables apply?",
      multiSelectForm("traceability-records", [
        ["TRAVELER", "Traveler"], ["MATERIAL_CERTS", "Material Certs"]
      ], review.traceabilityDeliverables), "Select all that apply, then continue.");
    if (step === "aerospace-requirements") return question("Which common aerospace requirements apply?",
      multiSelectForm("aerospace-requirements", [
        ["CERTIFICATE_OF_CONFORMANCE", "Certificate of Conformance"], ["MATERIAL_CERTS", "Material Certs"],
        ["FAIR", "FAIR"], ["ITAR", "ITAR"], ["DPAS_RATED", "DPAS Rated"]
      ], review.aerospaceRequirements), "Select all that apply. Intake records these requirements but does not interpret or approve them.");
    if (step === "po-flowdowns") return question("What PO flowdowns and quality clauses apply?",
      textAreaInput("po-flowdowns", review.poFlowdowns,
        "PO flowdowns and quality clauses for the packing slip or Certificate of Conformance"),
      "Enter the applicable clauses, or enter None.");
    if (step === "additional-requirements") return question("What additional or special contract requirements apply?",
      additionalRequirementsForm(review), "Record the customer’s contract language without interpreting compliance.");
    return renderNewOrderReview();
  }

  function yesNoChoice(field) {
    return choice("Yes", "yes", field) + choice("No", "no", field);
  }

  function actionNoteQuestion(message, field, value, hint) {
    return question(message, '<p class="intake-triggered-action">' + escapeHtml(message) + '</p>' +
      textAreaInput(field, value, "Required resolution/action note"), hint);
  }

  function textAreaInput(field, value, placeholder) {
    return '<form class="intake-stacked-form" data-intake-form="' + field + '"><textarea data-intake-autofocus data-intake-value-input placeholder="' +
      escapeHtml(placeholder) + '">' + escapeHtml(value) + '</textarea><button class="intake-primary">Continue</button></form>';
  }

  function multiSelectForm(field, options, selected) {
    const selectedValues = new Set(selected || []);
    return '<form class="intake-stacked-form" data-intake-multiselect="' + field + '"><fieldset class="intake-check-list"><legend class="sr-only">Select all that apply</legend>' +
      options.map(([value, label]) => '<label><input type="checkbox" name="selection" value="' + value + '" ' +
        (selectedValues.has(value) ? "checked" : "") + '><span>' + escapeHtml(label) + '</span></label>').join("") +
      '</fieldset><button class="intake-primary">Continue</button></form>';
  }

  function additionalRequirementsForm(review) {
    return '<form class="intake-stacked-form" data-intake-additional-requirements="true">' +
      '<label><span>Additional contract quality requirements</span><textarea name="qualityRequirements">' +
      escapeHtml(review.additionalContractQualityRequirements) + '</textarea></label>' +
      '<label><span>Special requirements</span><textarea name="specialRequirements">' + escapeHtml(review.specialRequirements) + '</textarea></label>' +
      '<label class="intake-confirmation"><input type="checkbox" name="identifiedOnDocument" ' +
      (review.requirementsIdentifiedOnAttachedDocument ? "checked" : "") + '><span>Requirements identified on attached document</span></label>' +
      '<button class="intake-primary">Continue</button></form>';
  }

  function question(title, body, hint) {
    return '<div class="intake-step-label">Question ' + (state.currentStep + 1) + ' of ' + (steps().length - 1) + '</div><h2>' + title +
      '</h2><p class="intake-question-hint">' + hint + '</p><div class="intake-answer-control">' + body + '</div>' +
      (state.currentStep > 0 && !["file-association", "po-attachment"].includes(steps()[state.currentStep]) ? navButtons(false) : "");
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

  const initialDocumentTypes = {DRAWING:'Drawing', DRAWING_AND_BOM:'Drawing + BOM', BOM_ONLY:'BOM Only', UNKNOWN:'Unknown / Not Determined', OTHER:'Other'};
  function renderFiles() {
    if (!state.technicalFiles.length) return '<p class="intake-search-status">No files selected yet.</p>';
    return '<ul class="intake-file-list">' + state.technicalFiles.map((file, index) => '<li><span><strong>' +
      escapeHtml(file.name) + '</strong><small>' + formatBytes(file.size) + '</small><label class="intake-file-identification">Initial identification<select data-intake-identification="' + index + '" aria-label="Initial identification for ' + escapeHtml(file.name) + '">' + Object.entries(initialDocumentTypes).map(([value,label]) => '<option value="' + value + '" ' + (value === (file.initialIdentification?.type || 'UNKNOWN') ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>' + (file.initialIdentification?.type === 'OTHER' ? '<label class="intake-file-identification">Describe this file<input data-intake-identification-description="' + index + '" value="' + escapeHtml(file.initialIdentification.otherDescription || '') + '" maxlength="200"></label>' : '') + '<small>Preliminary — Technical Review will validate.</small></span><button type="button" data-intake-remove-file="' +
      index + '">Remove</button></li>').join("") + '</ul>';
  }

  function renderAnswers() {
    if (state.intakeType === "NEW_ORDER") return renderNewOrderAnswers();
    const items = [];
    if (state.intakeType) items.push([0, "Intake", "New Quote Request"]);
    if (state.customer) items.push([1, "Customer", state.customer.customerName]);
    if (state.currentStep > 2) items.push([2, "Assemblies", state.assemblyCount]);
    if (state.assemblies[0].assemblyNumber) items.push([3, "Assembly", state.assemblies[0].assemblyNumber]);
    if (state.assemblies[0].revision) items.push([4, "Revision", state.assemblies[0].revision]);
    if (state.assemblies[0].quantity) items.push([5, "Quantity", state.assemblies[0].quantity]);
    if (state.preliminaryAssemblyType) items.push([6, "Assembly type (preliminary)", preliminaryAssemblyLabel()]);
    if (state.deLeonScope) items.push([7, "Scope", scopeLabel(state.deLeonScope)]);
    if (state.technicalFilesProvided !== null) items.push([8, "Technical Files", state.technicalFilesProvided ? "Customer provided" : "None"]);
    if (state.customerRequirements.includes("LEAD_TIME")) items.push([10, "Customer Requires", "Price + Lead Time"]);
    if (!items.length) return '<p>Answers will appear here as we go.</p>';
    return '<p class="intake-answers-title">Answers so far</p>' + items.map(item => '<button type="button" data-intake-edit="' +
      item[0] + '"><span>' + escapeHtml(item[1]) + '</span><strong>' + escapeHtml(item[2]) + '</strong></button>').join("");
  }

  function renderNewOrderAnswers() {
    const review = state.contractReview;
    const items = [];
    if (state.intakeType) items.push([0, "Intake", "New Order"]);
    if (state.customer) items.push([1, "Customer", state.customer.customerName]);
    if (review.customerPoNumber) items.push([2, "Customer PO", review.customerPoNumber]);
    if (state.technicalFiles.length) items.push([4, "Customer PO Attachment", state.technicalFiles.length + " file(s)"]);
    if (review.paymentTermsMatch !== null) items.push([5, "Payment Terms Match", yesNoLabel(review.paymentTermsMatch)]);
    if (review.billingMatchesShipTo !== null) items.push([7, "Billing = Ship To", yesNoLabel(review.billingMatchesShipTo)]);
    if (review.shippingMethod) items.push([9, "Shipping", shippingLabel(review.shippingMethod)]);
    if (review.orderClassification) items.push([11, "Classification", classificationLabel(review.orderClassification)]);
    if (review.deliveryDateAchievable !== null) items.push([12, "Delivery Date", yesNoLabel(review.deliveryDateAchievable)]);
    if (review.priceMatchesQuote !== null) items.push([14, "Price Match", yesNoLabel(review.priceMatchesQuote)]);
    if (review.traceabilityRequired !== null) items.push([16, "Traceability", yesNoLabel(review.traceabilityRequired)]);
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
      reviewRow("Assembly type (preliminary)", preliminaryAssemblyLabel(), 6) +
      reviewRow("De Leon Scope", scopeLabel(state.deLeonScope), 7) +
      reviewRow("Technical Files", state.technicalFilesProvided ? "Customer provided (" + state.technicalFiles.length + " associated)" : "Not provided", 8) +
      reviewRow("Customer Requires", "Price + Lead Time", 10) + '</dl>' +
      (state.submit.message ? '<p class="intake-submit-error" role="alert">' + escapeHtml(state.submit.message) + '</p>' : "") +
      '<div class="intake-review-actions"><button type="button" data-intake-action="back" class="intake-back">← Back</button>' +
      '<button type="button" data-intake-action="submit" class="intake-primary" ' + (state.submit.status === "saving" ? "disabled" : "") + '>' +
      (state.submit.status === "saving" ? "Sending…" : "Submit for Technical Review") + '</button></div>';
  }

  function renderNewOrderReview() {
    const review = state.contractReview;
    const actions = triggeredActions();
    return '<div class="intake-step-label">Final review</div><h2>New Order Contract Review</h2>' +
      '<p class="intake-question-hint">Check the completed Contract Review before sending it to Technical Review.</p><dl class="intake-review intake-contract-review">' +
      reviewRow("Customer", state.customer?.customerName, 1) + reviewRow("Customer PO", review.customerPoNumber, 2) +
      reviewRow("Customer PO Attachment", state.technicalFiles.length + " verified file(s)", 4) +
      reviewBooleanRow("Payment terms match", review.paymentTermsMatch, 5) +
      reviewActionRow("Payment terms action", review.paymentTermsActionNote, 6, !review.paymentTermsMatch) +
      reviewBooleanRow("Billing matches Ship To", review.billingMatchesShipTo, 7) +
      reviewActionRow("Shipping action", review.shippingActionNote, 8, !review.billingMatchesShipTo) +
      reviewRow("Shipping method", shippingLabel(review.shippingMethod), 9) +
      (review.shippingMethod === "UPS_COLLECT" ? reviewRow("UPS account", review.upsAccountNumber, 10) : "") +
      reviewRow("Order classification", classificationLabel(review.orderClassification), 11) +
      reviewBooleanRow("Can meet delivery date", review.deliveryDateAchievable, 12) +
      reviewActionRow("Delivery-date action", review.deliveryDateActionNote, 13, !review.deliveryDateAchievable) +
      reviewBooleanRow("Price matches quote", review.priceMatchesQuote, 14) +
      reviewActionRow("Price action", review.priceActionNote, 15, !review.priceMatchesQuote) +
      reviewBooleanRow("Traceability required", review.traceabilityRequired, 16) +
      reviewRow("Traceability records", labelsFor(review.traceabilityDeliverables), 17) +
      reviewRow("Aerospace requirements", labelsFor(review.aerospaceRequirements), 18) +
      reviewRow("PO flowdowns", review.poFlowdowns, 19) +
      reviewRow("Additional quality requirements", review.additionalContractQualityRequirements || "None", 20) +
      reviewRow("Special requirements", review.specialRequirements || "None", 20) +
      reviewRow("Requirements identified on attached document", yesNoLabel(review.requirementsIdentifiedOnAttachedDocument), 20) +
      reviewRow("Reviewed By", window.DleOsSession?.user?.displayName || "SIM User", 20) +
      reviewRow("Review date", new Date().toLocaleDateString(), 20) + '</dl>' +
      (actions.length ? '<section class="intake-triggered-summary"><h3>Triggered actions</h3><ul>' +
        actions.map(action => '<li>' + escapeHtml(action) + '</li>').join("") + '</ul></section>' : "") +
      (state.submit.message ? '<p class="intake-submit-error" role="alert">' + escapeHtml(state.submit.message) + '</p>' : "") +
      '<div class="intake-review-actions"><button type="button" data-intake-action="back" class="intake-back">← Back</button>' +
      '<button type="button" data-intake-action="submit" class="intake-primary" ' + (state.submit.status === "saving" ? "disabled" : "") + '>' +
      (state.submit.status === "saving" ? "Sending…" : "Submit for Technical Review") + '</button></div>';
  }

  function reviewBooleanRow(label, value, step) {
    return reviewRow(label, yesNoLabel(value), step, value === false ? "intake-review-alert" : "");
  }

  function reviewActionRow(label, value, step, visible) {
    return visible ? reviewRow(label, value, step, "intake-review-action") : "";
  }

  function reviewRow(label, value, step, className) {
    return '<div' + (className ? ' class="' + className + '"' : "") + '><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd><button type="button" data-intake-edit="' + step + '">Edit</button></div>';
  }

  function triggeredActions() {
    const review = state.contractReview;
    const actions = [];
    if (review.paymentTermsMatch === false) actions.push("Notify A/R Department — " + review.paymentTermsActionNote);
    if (review.billingMatchesShipTo === false) actions.push("Verify and highlight the Ship To address — " + review.shippingActionNote);
    if (review.orderClassification === "NEW_ASSEMBLY") actions.push("Create new BOM/router and check FAIR requirement");
    if (review.orderClassification === "NEW_REVISION") actions.push("Update BOM/router and check FAIR requirement");
    if (review.deliveryDateAchievable === false) actions.push("Contact customer to discuss the delivery date — " + review.deliveryDateActionNote);
    if (review.priceMatchesQuote === false) actions.push("Review the quote and contact the customer — " + review.priceActionNote);
    return actions;
  }

  function renderComplete() {
    return '<div class="intake-complete-mark">✓</div><p class="intake-kicker">INTAKE PRESERVED</p><h2>Submitted for Technical Review</h2>' +
      '<p class="intake-question-hint">' + escapeHtml(committed?.intakeId || (state.intakeType === "NEW_ORDER" ? "New Order" : "RFQ Intake")) +
      ' is preserved in SIM structured state and is waiting for a trained reviewer. Review has not started.</p>' +
      (committed?.documentPreservationState === 'BINARIES_VERIFIED_SIM' ? '<p class="intake-question-hint">Your technical files are saved and verified in SIM. Technical Review can reopen these copies without access to the original files or folders.</p>' : '') + '<div class="intake-handoff"><strong>Next step</strong><span>Technical Review — RFQ Review</span></div>' +
      '<button type="button" data-intake-action="restart" class="intake-primary">Start another intake</button>';
  }

  function clearAnswerForStep(stepIndex) {
    const step = steps()[stepIndex];
    const review = state.contractReview;
    if (step === "intake-type") state.intakeType = "";
    if (step === "customer") state.customer = null;
    if (step === "assembly-count") state.assemblyCount = null;
    if (step === "assembly-number") state.assemblies[0].assemblyNumber = "";
    if (step === "revision") state.assemblies[0].revision = "";
    if (step === "quantity") state.assemblies[0].quantity = null;
    if (step === "assembly-type") state.preliminaryAssemblyType = null;
    if (step === "scope") state.deLeonScope = "";
    if (step === "technical-files") state.technicalFilesProvided = null;
    if (step === "file-association") state.technicalFiles = [];
    if (step === "requirements") state.customerRequirements = ["PRICE"];
    if (step === "customer-po-number") review.customerPoNumber = "";
    if (step === "customer-po-type") review.customerPoType = "";
    if (step === "po-attachment") state.technicalFiles = [];
    if (step === "payment-terms") review.paymentTermsMatch = null;
    if (step === "payment-terms-note") review.paymentTermsActionNote = "";
    if (step === "address-match") review.billingMatchesShipTo = null;
    if (step === "shipping-note") review.shippingActionNote = "";
    if (step === "shipping-method") review.shippingMethod = "";
    if (step === "ups-account") review.upsAccountNumber = "";
    if (step === "order-classification") review.orderClassification = "";
    if (step === "delivery-date") review.deliveryDateAchievable = null;
    if (step === "delivery-date-note") review.deliveryDateActionNote = "";
    if (step === "price-match") review.priceMatchesQuote = null;
    if (step === "price-note") review.priceActionNote = "";
    if (step === "traceability") review.traceabilityRequired = null;
    if (step === "traceability-records") review.traceabilityDeliverables = [];
    if (step === "aerospace-requirements") review.aerospaceRequirements = [];
    if (step === "po-flowdowns") review.poFlowdowns = "";
    if (step === "additional-requirements") {
      review.additionalContractQualityRequirements = "";
      review.specialRequirements = "";
      review.requirementsIdentifiedOnAttachedDocument = false;
    }
  }

  function goBack() {
    let previousStep = Math.max(0, state.currentStep - 1);
    while (previousStep > 0 && isSkippedNewOrderStep(steps()[previousStep])) previousStep -= 1;
    if (["file-association", "po-attachment"].includes(steps()[previousStep]) && state.technicalFiles.some(file => file.documentId)) {
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
    if (event.target.matches('[data-intake-identification-description]')) {
      const file = state.technicalFiles[Number(event.target.dataset.intakeIdentificationDescription)];
      if (file?.initialIdentification?.type === 'OTHER') file.initialIdentification.otherDescription = event.target.value;
      return;
    }
    if (!event.target.matches("[data-intake-customer-search]")) return;
    state.customerSearch.query = event.target.value;
    state.customerSearch.status = "loading";
    updateCustomerResults();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(searchCustomers, 250);
  }

  function handleChange(event) {
    if (event.target.matches('[data-intake-identification]')) {
      const file = state.technicalFiles[Number(event.target.dataset.intakeIdentification)];
      if (file && initialDocumentTypes[event.target.value]) {
        file.initialIdentification = {type:event.target.value, otherDescription:null};
        render();
      }
      return;
    }
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
    const multiSelect = event.target.closest("[data-intake-multiselect]");
    if (multiSelect?.dataset?.intakeMultiselect) {
      event.preventDefault();
      state.contractReview[multiSelect.dataset.intakeMultiselect === "traceability-records" ? "traceabilityDeliverables" : "aerospaceRequirements"] =
        Array.from(multiSelect.querySelectorAll('input[name="selection"]:checked'), input => input.value);
      next();
      return;
    }
    const additional = event.target.closest("[data-intake-additional-requirements]");
    if (additional?.dataset?.intakeAdditionalRequirements === "true") {
      event.preventDefault();
      state.contractReview.additionalContractQualityRequirements = additional.elements.qualityRequirements.value.trim();
      state.contractReview.specialRequirements = additional.elements.specialRequirements.value.trim();
      state.contractReview.requirementsIdentifiedOnAttachedDocument = additional.elements.identifiedOnDocument.checked;
      next();
      return;
    }
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
    if (field === "assembly-type-description") state.preliminaryAssemblyType.otherDescription = value.slice(0, 200) || null;
    if (field === "quantity") {
      const quantity = Number(value);
      if (!Number.isInteger(quantity) || quantity < 1) return showInlineError("Enter a whole quantity greater than zero.");
      state.assemblies[0].quantity = quantity;
    }
    if (field === "customer-po-number") {
      if (!value) return showInlineError("Enter the customer PO number.");
      state.contractReview.customerPoNumber = value;
    }
    if (["payment-terms-note", "shipping-note", "delivery-date-note", "price-note"].includes(field) && !value)
      return showInlineError("Enter the required resolution/action note.");
    if (field === "payment-terms-note") state.contractReview.paymentTermsActionNote = value;
    if (field === "shipping-note") state.contractReview.shippingActionNote = value;
    if (field === "delivery-date-note") state.contractReview.deliveryDateActionNote = value;
    if (field === "price-note") state.contractReview.priceActionNote = value;
    if (field === "ups-account") {
      if (!value) return showInlineError("Enter the UPS account number for UPS Collect.");
      state.contractReview.upsAccountNumber = value;
    }
    if (field === "po-flowdowns") state.contractReview.poFlowdowns = value;
    next();
  }

  function selectChoice(field, value) {
    if (field === "intake-type") state.intakeType = value;
    if (field === "assembly-type") {
      if (!intakeAssemblyTypes[value]) return;
      state.preliminaryAssemblyType = { type: value, otherDescription: null };
      if (value === "OTHER") { render(); return; }
    }
    if (field === "scope") state.deLeonScope = value;
    if (field === "technical-files") {
      state.technicalFilesProvided = value === "yes";
      if (!state.technicalFilesProvided && state.technicalFiles.some(file => file.documentId)) { state.technicalFilesProvided = true; return showInlineError("Remove staged files individually before changing this answer."); }
      if (!state.technicalFilesProvided) state.technicalFiles = [];
    }
    if (field === "requirements") state.customerRequirements = ["PRICE", "LEAD_TIME"];
    if (field === "customer-po-type") state.contractReview.customerPoType = value;
    if (field === "payment-terms") state.contractReview.paymentTermsMatch = value === "yes";
    if (field === "address-match") state.contractReview.billingMatchesShipTo = value === "yes";
    if (field === "shipping-method") state.contractReview.shippingMethod = value;
    if (field === "order-classification") state.contractReview.orderClassification = value;
    if (field === "delivery-date") state.contractReview.deliveryDateAchievable = value === "yes";
    if (field === "price-match") state.contractReview.priceMatchesQuote = value === "yes";
    if (field === "traceability") state.contractReview.traceabilityRequired = value === "yes";
    next();
  }

  function next() {
    state.currentStep += 1;
    let step = steps()[state.currentStep];
    if (step === "file-association" && !state.technicalFilesProvided) state.currentStep += 1;
    step = steps()[state.currentStep];
    if (state.intakeType === "NEW_ORDER") {
      while (isSkippedNewOrderStep(step)) {
        state.currentStep += 1;
        step = steps()[state.currentStep];
      }
    }
    render();
    if (steps()[state.currentStep] === "customer") searchCustomers();
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
    if (steps()[state.currentStep] !== "customer") return;
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
    if (!state.technicalFiles.length) return showInlineError(state.intakeType === "NEW_ORDER" ?
      "Attach the customer PO before continuing." : "Choose at least one customer technical file.");
    if (state.intakeType === "NEW_ORDER") state.technicalFilesProvided = true;
    next();
  }

  function isSkippedNewOrderStep(step) {
    if (state.intakeType !== "NEW_ORDER") return false;
    const review = state.contractReview;
    return (step === "payment-terms-note" && review.paymentTermsMatch === true) ||
      (step === "shipping-note" && review.billingMatchesShipTo === true) ||
      (step === "ups-account" && review.shippingMethod !== "UPS_COLLECT") ||
      (step === "delivery-date-note" && review.deliveryDateAchievable === true) ||
      (step === "price-note" && review.priceMatchesQuote === true) ||
      (step === "traceability-records" && review.traceabilityRequired === false);
  }

  async function submitIntake() {
    state.submit = { status: "saving", message: "" };
    render();
    const requestCorrelationId = state.requestCorrelationId ||= window.crypto?.randomUUID?.() || "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);
    const isNewOrder = state.intakeType === "NEW_ORDER";
    const payload = { intakeType: state.intakeType, customer: state.customer, assemblyCount: isNewOrder ? 0 : state.assemblyCount,
      assemblies: isNewOrder ? [] : state.assemblies, deLeonScope: isNewOrder ? "" : state.deLeonScope,
      technicalFilesProvided: isNewOrder ? true : state.technicalFilesProvided,
      technicalFiles: state.technicalFiles.map(({binary, ...metadata}) => metadata), customerRequirements: state.customerRequirements,
      createdBy: window.DleOsSession?.user?.displayName || "SIM User", requestCorrelationId,
      contractReview: isNewOrder ? state.contractReview : null,
      preliminaryAssemblyType: isNewOrder ? null : state.preliminaryAssemblyType };
    try {
      for (const file of state.technicalFiles) {
        if (file.documentId) continue;
        const upload = await window.fetch('/api/sim/intake-drafts/' + encodeURIComponent(requestCorrelationId) + '/documents?name=' + encodeURIComponent(file.name) + '&lastModified=' + file.lastModified, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream', 'X-SIM-Document-Upload': '1' }, body: file.binary
        });
        const staged = await upload.json();
        if (!upload.ok || staged.binaryStatus !== 'VERIFIED') throw new Error(staged.message || 'SIM could not verify the selected file. Intake was not submitted.');
        const initialIdentification = file.initialIdentification;
        Object.assign(file, staged, {initialIdentification});
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

  function yesNoLabel(value) { return value === true ? "Yes" : value === false ? "No" : ""; }
  function shippingLabel(value) {
    return { WILL_CALL: "Will Call", DLE_DELIVERY: "DLE Delivery", UPS_CHARGE: "UPS Charge", UPS_COLLECT: "UPS Collect" }[value] || "";
  }
  function classificationLabel(value) {
    return { REPEAT_ORDER: "Repeat Order", NEW_ASSEMBLY: "New Assembly", NEW_REVISION: "New Revision" }[value] || "";
  }
  function labelsFor(values) {
    const labels = {
      TRAVELER: "Traveler", MATERIAL_CERTS: "Material Certs", CERTIFICATE_OF_CONFORMANCE: "Certificate of Conformance",
      FAIR: "FAIR", ITAR: "ITAR", DPAS_RATED: "DPAS Rated"
    };
    return (values || []).map(value => labels[value] || value).join(", ") || "None";
  }

  function formatBytes(bytes) { return bytes < 1024 ? bytes + " B" : (bytes / 1024).toFixed(1) + " KB"; }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }
  function snapshot() { return committed ? JSON.parse(JSON.stringify(committed)) : null; }

  document.addEventListener?.("dle:view-mode-change", syncProgressPlacement);
  window.DleIntakeWizard = Object.freeze({ mount, getCommittedIntake: snapshot });
})(window, document);

(function registerDleIntakeWizard(window, document) {
  "use strict";

  const QUOTE_STEPS = ["intake-type", "customer", "assembly-count", "assembly-number", "revision",
    "quantity", "assembly-type", "scope", "technical-files", "file-association", "requirements", "review"];
  const NEW_ORDER_STEPS = ["intake-type", "customer", "customer-po-number", "customer-po-type", "po-attachment", "previously-quoted", "quote-search", "order-facts", "order-comparison",
    "technical-source", "order-technical-files", "payment-terms", "payment-terms-note", "address-match", "shipping-note", "shipping-method", "ups-account",
    "order-classification", "delivery-date", "delivery-date-note", "traceability",
    "traceability-records", "aerospace-requirements", "additional-requirements", "review"];
  let root = null;
  let searchTimer = null;
  let committed = null;
  let state = createState();

  function createState() {
    return {
      currentStep: 0, status: "DRAFT", intakeType: "", customer: null, assemblyCount: 1,
      assemblies: [{ lineNumber: 1, assemblyNumber: "", revision: "", quantity: null }],
      preliminaryAssemblyType: null, deLeonScope: "", technicalFilesProvided: null, technicalFiles: [], requestCorrelationId: null, customerRequirements: ["PRICE"],
      order: { poDateVerified:false, dueDateDecision:null, dueDateNote:"", contractDates:null, technicalSourceChoice: null, incomingTechnicalDocuments: [], technicalBaseline: null, technicalSource: null, id: null, revision: 0, previouslyQuoted: null, quote: null, baseline: null, comparison: [], bucket: "SUBMITTED", results: [], message: "", pending: null, facts: { poDate: "", lines: [{ assembly: "", revision: "", quantity: null, currency: "", unitPrice: null, extendedValue: null }], requestedDelivery: "", nre: null, separateCharges: null } },
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
    if (state.intakeType === 'NEW_ORDER' && state.status !== 'COMPLETE' && !state.order.entry) root.querySelector('#intakeConversation').insertAdjacentHTML('beforeend', '<div class="intake-order-save"><button type="button" class="intake-back" data-order-action="save">Save draft</button><span role="status">' + escapeHtml(state.order.message) + '</span></div>');
    syncProgressPlacement();
    const stage=state.currentStep<=1?0:state.currentStep<=7?1:state.currentStep===8?2:state.currentStep<24?3:4;
    const progressMaximum = Math.max(1, steps().length - 1);
    root.querySelector("#intakeProgressBar").style.width = (state.intakeType==='NEW_ORDER'?stage*25:Math.round((Math.min(state.currentStep, progressMaximum) / progressMaximum) * 100)) + "%";
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
    if (state.intakeType === 'NEW_ORDER' && state.order.entry && state.currentStep > 0) return renderOrderEntry();
    if (state.intakeType === 'NEW_ORDER' && state.order.duplicate) return question('An order intake is already in progress.',
      '<p>'+escapeHtml(state.order.duplicate.intakeId)+' · '+escapeHtml(state.order.duplicate.orderIntake?.poNumber)+'</p>' +
      (state.order.duplicate.orderIntake?.reviewStatus === 'DRAFT' ? '<button type="button" class="intake-primary" data-order-action="resume-draft" data-id="'+escapeHtml(state.order.duplicate.intakeId)+'">Resume existing draft</button>' : '<p>This intake has already been submitted for Contract Review.</p>') +
      '<button type="button" class="intake-back" data-order-action="different-po">Use a different PO</button>', 'Resume the saved intake or use a different PO for a separate order.');
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
    if (step === 'order-facts') return renderOrderFacts();
    if (step === 'previously-quoted') return question('Was this order quoted?', renderOrderEvidence() +
      '<form data-order-form="quoted"><label class="intake-choice"><input type="radio" name="quoted" value="yes" required '+(state.order.previouslyQuoted===true?'checked':'')+'> Yes, find the prior quote</label>' +
      '<label class="intake-choice"><input type="radio" name="quoted" value="no" required '+(state.order.previouslyQuoted===false?'checked':'')+'> No prior quote</label><button class="intake-primary">Continue</button></form>',
      'Step 2 of 3: Link a prior quote, or continue with the PO alone. Your uploaded PO stays with this order.');
    if (step === 'quote-search') return renderQuoteSearch();
    if (step === 'order-comparison') return question('Compare the customer PO with the quotation', renderOrderComparison() + '<button type="button" class="intake-primary" data-order-action="continue">Continue</button>', 'Actual PO values remain separate. This comparison is not contract acceptance.');
    if (step === 'technical-source') return question('Did the customer provide new or revised technical documents with this order?',
      choice('No — Use the documents from the quoted job', 'QUOTED_DEFINITION', 'technical-source') +
      choice('Yes — Customer provided new or revised documents', 'NEW_DOCUMENTS', 'technical-source') + renderOrderTechnicalSource(),
      'Every order needs an authoritative technical definition. Existing quoted documents do not need to be uploaded again.');
    if (step === 'order-technical-files') return question('Attach the new or revised technical documents.',
      '<label class="intake-file-control"><input type="file" data-order-technical-files multiple><span>Choose incoming technical documents</span></label>' +
      '<ul>' + state.order.incomingTechnicalDocuments.map((d,i) => '<li>' + escapeHtml(d.name) + ' · Incoming order evidence <button type="button" data-order-action="remove-technical" data-index="'+i+'">Remove</button></li>').join('') + '</ul>' +
      '<button type="button" class="intake-primary" data-order-action="technical-continue">Continue</button>',
      'Contract Review must compare these with the quoted definition and identify the necessary Technical Review scope. These files are not accepted technical authorities.');
    if (step === "customer-po-number") return question("What is the customer PO number?",
      textInput("customer-po-number", review.customerPoNumber, "Customer PO number"),
      "Capture the purchase-order identity exactly as received.");
    if (step === "customer-po-type") return question("Do we have a customer PO for this order?",
      choice("Yes — Customer PO", "CUSTOMER_PO", "customer-po-type") +
      '<button type="button" class="intake-choice intake-choice-disabled" disabled aria-disabled="true"><span>No — Verbal / Informal Order <small>Planned for a future release</small></span></button>',
      "Use Verbal / Informal only for approved exceptions when the customer has not provided a formal PO.");
    if (step === "po-attachment") return renderPoAttachment();
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
      "Classification describes order history. Reuse a matched approved technical definition; review differences.");
    if (step === "delivery-date" || step === "delivery-date-note") return renderDeliveryReview();
    if (step === "delivery-date-note") return actionNoteQuestion("Contact customer to discuss the delivery date",
      "delivery-date-note", review.deliveryDateActionNote, "Record the required customer action. No contact is sent automatically.");
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
    if (step === "additional-requirements") return question("Anything else from the customer’s PO that DLE needs to honor?",
      additionalRequirementsForm(review), "Enter any customer requirement not already captured above.");
    return renderNewOrderReview();
  }

  function quotedOrderValues() {
    const b=state.order.baseline,s=b?.approval?.summary;
    if(!s || b.customer?.customerId!==state.customer?.customerId || JSON.stringify(b.reference)!==JSON.stringify(state.order.quote))return null;
    return {assembly:s.assembly,revision:s.revision,quantity:s.quantity,currency:s.currency,unitPrice:s.combinedUnitPrice,extendedValue:s.total,nre:s.nreTotal+(s.materialSupplemental?.materialNre||0),separateCharges:s.materialSupplemental?.separateCharges||0};
  }
  function applyQuotedOrderValues(replace=false) {
    const values=quotedOrderValues();if(!values)return;
    const o=state.order;
    for(const [key,value] of Object.entries(values)){
      const target=['nre','separateCharges'].includes(key)?o.facts:o.facts.lines[0];
      if(value!=null&&(replace||target[key]==null||target[key]===''))target[key]=value;
    }
    o.quotePrefillAttempted=true;o.poFactsConfirmed=false;o.comparison=[];
  }
  function quoteDifferenceText(form) {
    const values=quotedOrderValues();if(!values)return '';
    const labels={assembly:'assembly',revision:'revision',quantity:'quantity',currency:'currency',unitPrice:'unit price',extendedValue:'extended value',nre:'NRE',separateCharges:'separate charges'};
    const different=Object.entries(values).filter(([key,value])=>{
      const actual=form?.elements[key]?.value ?? (['nre','separateCharges'].includes(key)?state.order.facts[key]:state.order.facts.lines[0][key]);
      const numeric=['quantity','unitPrice','extendedValue','nre','separateCharges'].includes(key);
      return actual!=null&&actual!==''&&(numeric && value!=null ? Number(actual)!==Number(value) : String(actual)!==String(value));
    }).map(([key])=>labels[key]);
    return different.length?'Changes from selected quote: '+different.join(', ')+'. Review these differences against the PO.':'Entered quoted fields match the selected quote. PO verification is still required.';
  }

  function selectedQuoteContext() {
    const b=state.order.baseline, q=state.order.quote, s=b?.approval?.summary;
    return q ? '<div class="intake-order-baseline"><strong>Selected quote: '+escapeHtml(q.quoteNumber)+'</strong>'+(s?'<p>'+escapeHtml(s.assembly+' / '+s.revision+' · Qty '+s.quantity+' · '+s.currency+' '+Number(s.combinedUnitPrice).toFixed(2)+' per unit')+'</p>':'')+(s?.description?'<p>Description: '+escapeHtml(s.description)+'</p>':'')+'<p>Quoted lead time: '+escapeHtml(b?.approval?.answers?.delivery||'Not provided')+'. This is not the requested delivery date.</p><small>Quote defaults are not extracted or agreed PO facts. Verify against the attached PO.</small></div>' : '';
  }
  function renderPoAttachment() {
    return question('Add the customer PO',
      '<label class="intake-po-number">Customer PO number<input data-order-po-number value="'+escapeHtml(state.contractReview.customerPoNumber)+'" placeholder="Enter the number shown on the PO"></label>'+
      '<label class="intake-file-control" data-intake-drop-zone><input type="file" data-intake-files multiple><span class="intake-file-drop-title">Drop the customer PO here</span><small>or click to browse</small></label>'+renderFiles()+
      '<p class="intake-file-note">SIM verifies its own copy when read or saved. Selecting a quote next keeps this PO attached.</p>'+navButtons(true,'Continue'),
      'Step 1 of 3: Add the PO. Next, link a prior quote if there is one, then review the order details.');
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
      '<label><span>Other customer requirements</span><textarea name="otherRequirements">' + escapeHtml(otherRequirements(review)) + '</textarea></label>' +
      '<button class="intake-primary">Continue</button></form>' + renderLegacyRequirements(review) + renderOrderEvidence();
  }
  function otherRequirements(r) { return r.otherCustomerRequirements ?? r.specialRequirements ?? ''; }
  function captureOtherRequirements(form) {
    const r=state.contractReview, value=form.elements.otherRequirements.value;
    if (value !== otherRequirements(r)) r.requirementsIdentifiedOnAttachedDocument=false;
    if (r.otherCustomerRequirements != null) r.otherCustomerRequirements=value;
    else r.specialRequirements=value;
  }
  function renderLegacyRequirements(r) {
    const notes=[['Prior PO flowdowns / quality clauses',r.poFlowdowns],['Prior additional contract quality requirements',r.additionalContractQualityRequirements],['Prior special requirements',r.otherCustomerRequirements != null ? r.specialRequirements : '']].filter(([,v])=>v?.trim());
    return notes.length ? '<section><h3>Legacy notes</h3>'+notes.map(([label,value])=>'<p><strong>'+escapeHtml(label)+'</strong></p><p style="white-space:pre-wrap">'+escapeHtml(value)+'</p>').join('')+'</section>' : '';
  }

  function question(title, body, hint) {
    return '<div class="intake-step-label">' + (state.intakeType==='NEW_ORDER' ? 'New Order · '+escapeHtml(orderStepLabel(steps()[state.currentStep])) : 'Question '+(state.currentStep+1)+' of '+(steps().length-1)) + '</div><h2>' + title +
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
    if (state.intakeType === 'NEW_ORDER') return '<ul class="intake-file-list">' + state.technicalFiles.map((file,index) => '<li><span><strong>' + escapeHtml(file.name) + '</strong><small>Customer PO · Owned by Intake</small><small>' + (file.binaryStatus === 'VERIFIED' ? 'Verified copy' : 'Copy verified when saved') + '</small><span data-intake-readability="'+index+'">' + renderReadability(file,index) + '</span></span><button type="button" data-intake-remove-file="'+index+'">Remove</button></li>').join('') + '</ul>';
    return '<ul class="intake-file-list">' + state.technicalFiles.map((file, index) => '<li><span><strong>' +
      escapeHtml(file.name) + '</strong><small>' + formatBytes(file.size) + '</small><label class="intake-file-identification">Initial identification<select data-intake-identification="' + index + '" aria-label="Initial identification for ' + escapeHtml(file.name) + '">' + Object.entries(initialDocumentTypes).map(([value,label]) => '<option value="' + value + '" ' + (value === (file.initialIdentification?.type || 'UNKNOWN') ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>' + (file.initialIdentification?.type === 'OTHER' ? '<label class="intake-file-identification">Describe this file<input data-intake-identification-description="' + index + '" value="' + escapeHtml(file.initialIdentification.otherDescription || '') + '" maxlength="200"></label>' : '') + '<small>Preliminary — Technical Review will validate.</small><span data-intake-readability="' + index + '">' + renderReadability(file, index) + '</span></span><button type="button" data-intake-remove-file="' +
      index + '">Remove</button></li>').join("") + '</ul>';
  }

  function isPdf(file) { return /\.pdf$/i.test(file.name) || file.type === "application/pdf"; }

  function renderReadability(file, index) {
    if (!isPdf(file)) return "";
    if (!file.readability) return '<small role="status">Checking PDF readability…</small>';
    const labels = { TEXT_READABLE: '✓ Text-readable', IMAGE_ONLY: '⚠ Scanned / image-only', MIXED: '⚠ Mixed', UNKNOWN: 'Unable to determine — Readability check unavailable' };
    const status = file.readability.status;
    const warning = status === 'IMAGE_ONLY' ? (state.intakeType === 'NEW_ORDER' ? 'This PO is image-only. Confirm its contents during Contract Review.' : 'This PDF appears to be image-only. Technical Review may have difficulty automatically reading BOM data.') : status === 'MIXED' ? 'Some pages may require image/OCR processing.' : '';
    return '<small role="status">' + escapeHtml(labels[status] || labels.UNKNOWN) + '</small>' +
      (warning ? '<small class="intake-readability-warning">' + warning + '</small><span class="intake-readability-actions"><button type="button" data-intake-action="continue">Continue Anyway</button><label>Replace File<input type="file" accept=".pdf,application/pdf" data-intake-replace-file="' + index + '" aria-label="Replace ' + escapeHtml(file.name) + '"></label></span>' : '');
  }

  async function checkReadability(file) {
    try {
      const response = await window.fetch('/api/sim/pdf-readability', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream', 'X-SIM-Document-Upload': '1' }, body: file.binary });
      if (!response.ok) throw new Error('Check unavailable');
      file.readability = await response.json();
    } catch { file.readability = { status: 'UNKNOWN' }; }
    const index = state.technicalFiles.indexOf(file);
    const label = index >= 0 ? root?.querySelector('[data-intake-readability="' + index + '"]') : null;
    if (label) label.innerHTML = renderReadability(file, index);
  }

  async function replaceTechnicalFile(file, replacement) {
    if (!file || !replacement) return;
    try {
      await deleteStagedTechnicalFile(file);
      const index = state.technicalFiles.indexOf(file);
      if (index < 0) return;
      state.technicalFiles.splice(index, 1);
      setTechnicalFiles([replacement]);
    } catch (error) { showInlineError(error.message); }
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
    const r=state.contractReview;
    const entries=[['intake-type','Intake','New Order'],['customer','Customer',state.customer?.customerName],['customer-po-number','PO',r.customerPoNumber],
      ['order-facts','Order line',state.order.facts.lines[0]?.assembly],['quote-search','Quotation',state.order.quote?.quoteNumber],
      ['payment-terms','Payment terms',yesNoLabel(r.paymentTermsMatch)],['shipping-method','Shipping',shippingLabel(r.shippingMethod)],
      ['order-classification','Classification',classificationLabel(r.orderClassification)],['delivery-date','Due-date review',state.order.dueDateDecision ? dueDateLabel(state.order.dueDateDecision.disposition) : ''],
      ['traceability','Traceability',yesNoLabel(r.traceabilityRequired)]];
    return '<p class="intake-answers-title">Answers so far</p>'+entries.filter(e=>e[2]).map(([step,label,value])=>'<button type="button" data-intake-edit="'+NEW_ORDER_STEPS.indexOf(step)+'"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></button>').join('');
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

  function renderOrderComplete() {
    const record=committed,p=record?.orderIntake,q=p?.questionnaire||{},line=p?.facts?.lines?.[0];
    const submitted=p?.reviewStatus==='READY_FOR_CONTRACT_REVIEW';
    const core=(p?.comparison||[]).filter(c=>!['Delivery','Payment terms','Shipping terms','Scope','Quotation availability'].includes(c.field));
    const comparison=p?.previouslyQuoted===false?'No prior quote':core.length&&core.every(c=>c.result==='MATCH')?'Quoted fields match': 'Differences or missing information require review';
    const due=p?.contractDates?.dueDateReview;
    const rows=[['Customer',record?.customer?.customerName||'Not recorded'],['Customer PO',p?.poNumber||'Not recorded'],
      ['Assembly / revision',line?[line.assembly,line.revision?'Rev '+line.revision:'Revision not recorded'].join(' · '):'Not recorded'],['Quantity',line?.quantity??'Not recorded'],
      ['Reference quote',p?.quote?.reference?.quoteNumber||'None selected'],['PO / quote comparison',comparison],
      ['Delivery review',due?displayOrderDate(due.date)+' · '+dueDateLabel(due.disposition):'Not recorded'],
      ['PO verification',p?.poFactsConfirmed&&q.requirementsIdentifiedOnAttachedDocument?'PO details and requirements confirmed':'Verification not recorded'],
      ['Requirements',[(q.traceabilityRequired===true?'Traceability: '+labelsFor(q.traceabilityDeliverables):q.traceabilityRequired===false?'Traceability not required':'Traceability not recorded'),labelsFor(q.aerospaceRequirements)].filter(x=>x&&x!=='None').join(' · ')]];
    const notes=otherRequirements(q);if(notes)rows.push(['Other requirements',notes]);
    return '<div class="intake-order-complete"><span class="intake-order-complete-check" aria-hidden="true">✓</span><h2>Nice job! Another project moving through our system.</h2><p class="intake-order-complete-status">'+(submitted?'Submitted for contract review · Pending acceptance.':'Order package preserved · See current status before continuing.')+'</p><p>'+escapeHtml(record?.intakeId||'')+'</p><dl>'+rows.map(([label,value])=>'<div><dt>'+escapeHtml(label)+'</dt><dd>'+escapeHtml(value)+'</dd></div>').join('')+'</dl><p class="intake-order-complete-note">Contract acceptance and order release remain separate steps.</p><button type="button" class="intake-primary" data-intake-action="done">Done</button></div>';
  }

  function renderComplete() {
    if (state.intakeType === 'NEW_ORDER') return renderOrderComplete();
    return '<div class="intake-complete-mark">✓</div><p class="intake-kicker">INTAKE PRESERVED</p><h2>Submitted for Technical Review</h2>' +
      '<p class="intake-question-hint">' + escapeHtml(committed?.intakeId || (state.intakeType === "NEW_ORDER" ? "New Order" : "RFQ Intake")) +
      ' is preserved in SIM structured state and is waiting for a trained reviewer. Review has not started.</p>' +
      (committed?.documentPreservationState === 'BINARIES_VERIFIED_SIM' ? '<p class="intake-question-hint">Your technical files are saved and verified in SIM. Technical Review can reopen these copies without access to the original files or folders.</p>' : '') + '<div class="intake-handoff"><strong>Next step</strong><span>Technical Review — RFQ Review</span></div>' +
      '<div class="intake-complete-actions"><button type="button" data-intake-action="done" class="intake-primary">Done</button>' +
      '<button type="button" data-intake-action="restart" class="intake-back">Start Another Intake</button></div>';
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
    // Requirement notes are retained when navigating back; only explicit editing changes them.
  }

  function goBack() {
    if (state.intakeType === 'NEW_ORDER') {
      const step=steps()[state.currentStep],form=root.querySelector('[data-order-form="facts"]');
      if(form) {try{captureOrderFacts(form);}catch(e){showInlineError(e.message);return;}}
      if(step==='quote-search' && state.order.changingQuote && quoteReadyForReview()) { state.order.changingQuote=false; state.order.message=''; render(); return; }
      if(step==='order-facts' || step==='quote-search') {
        const target=step==='order-facts'&&state.order.previouslyQuoted?'quote-search':'previously-quoted';
        state.currentStep=NEW_ORDER_STEPS.indexOf(target);render();return;
      }
      do { state.currentStep = Math.max(0, state.currentStep - 1); } while (state.currentStep > 0 && isSkippedNewOrderStep(steps()[state.currentStep])); render(); return; }
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
    const orderAction = event.target.closest('[data-order-action]');
    if (orderAction) { void orderActionClick(orderAction); return; }
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
    if (action === "done") window.goHome?.();
    if (action === "restart") { state = createState(); committed = null; render(); }
  }

  function handleInput(event) {
    const factForm=event.target.closest?.('[data-order-form="facts"]');
    if(factForm){state.order.poFactsConfirmed=false;const difference=root.querySelector('[data-quote-differences]');if(difference)difference.textContent=quoteDifferenceText(factForm);}

    if(event.target.matches('[data-order-po-number]')) {state.contractReview.customerPoNumber=event.target.value.trim();return;}

    if(event.target.name==='poDate') { state.order.poDateVerified=false; const c=root.querySelector('[name="poDateVerified"]'); if(c) { c.checked=false; c.disabled=!validManualPoDate(event.target.value); } }
    if(event.target.matches('[data-intake-due-date]')) {
      const picker=root.querySelector('[data-intake-due-picker]');
      try { if(picker) picker.value=parseIntakeDueDate(event.target.value) || ''; event.target.setCustomValidity(''); } catch(e) { event.target.setCustomValidity(e.message); }
      state.order.dueDateDecision=null; return;
    }
    if(event.target.name==='customerDueDate') { const c=root.querySelector('[data-due-comparison]'); if(c) c.textContent=quotedDateComparison(state.order.facts.poDate,state.order.baseline?.approval?.answers?.delivery,event.target.value).text; }
    if(['customerDueDate','dueDateNote'].includes(event.target.name)) { state.order.dueDateDecision=null; const c=root.querySelector('[data-due-status]'); if(c) c.textContent='Review required'; }

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
    if(event.target.matches('[data-intake-due-picker]')) {
      const input=root.querySelector('[data-intake-due-date]');
      if(input) { input.value=displayIntakeDueDate(event.target.value); input.setCustomValidity(''); input.focus(); }
      state.order.dueDateDecision=null; state.order.poFactsConfirmed=false; return;
    }
    if(event.target.matches('[data-cs-row], [data-cs-ack]')) {
      const p=state.order.reviewProjection?.customerSupply;
      if(!p) return;
      const ids=Array.from(root.querySelectorAll('[data-cs-row]:checked')).map(e=>e.dataset.csRow);
      state.order.customerSupplyReview={sourceToken:p.sourceToken,poRowIds:ids,acknowledged:event.target.matches('[data-cs-ack]') && event.target.checked,note:root.querySelector('[data-cs-note]')?.value || ''};
      render(); return;
    }
    if(event.target.matches('[data-cs-note]')) {
      const p=state.order.reviewProjection?.customerSupply;
      if(p) {state.order.customerSupplyReview={sourceToken:p.sourceToken,poRowIds:state.order.customerSupplyReview?.poRowIds||[],acknowledged:false,note:event.target.value};render();} return;
    }
    if (event.target.matches('[data-order-requirements-ack]')) { state.contractReview.requirementsIdentifiedOnAttachedDocument=event.target.checked; state.order.focusAcknowledgment=true; render(); return; }
    if (event.target.matches('[data-order-technical-files]')) {
      const files = state.order.incomingTechnicalDocuments;
      for (const file of Array.from(event.target.files || [])) if (!files.some(d => d.name === file.name && d.size === file.size && d.lastModified === file.lastModified)) files.push({name:file.name,size:file.size,type:file.type || 'application/octet-stream',lastModified:file.lastModified,binary:file});
      render(); return;
    }
    if (event.target.matches('[data-intake-replace-file]')) {
      void replaceTechnicalFile(state.technicalFiles[Number(event.target.dataset.intakeReplaceFile)], event.target.files?.[0]);
      return;
    }
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
    if(!files || !files.length)return;
    if (state.intakeType === 'NEW_ORDER') { state.order.poFactsConfirmed = false; state.order.extraction = null; }
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
    for (const file of additions) if (state.technicalFiles.includes(file) && isPdf(file)) void checkReadability(file);
  }

  async function removeTechnicalFile(index) {
    if (state.intakeType === 'NEW_ORDER') { state.order.poFactsConfirmed = false; state.order.extraction = null; }
    const file = state.technicalFiles[index];
    try {
      await deleteStagedTechnicalFile(file);
      state.technicalFiles.splice(index, 1); render();
    } catch (error) { showInlineError(error.message); }
  }

  async function deleteStagedTechnicalFile(file) {
    if (!file?.documentId) return;
    if (state.intakeType === "NEW_ORDER" && state.order.id) return;
    const response = await window.fetch('/api/sim/intake-drafts/' + encodeURIComponent(state.requestCorrelationId) + '/documents/' + encodeURIComponent(file.documentId), { method: 'DELETE', credentials: 'include' });
    if (!response.ok) throw new Error('SIM could not remove the staged copy. Retry or finish the existing submission.');
  }

  function technicalFileIdentity(file) {
    return [file.name, file.size, file.type, file.lastModified].join("\u0000");
  }

  function handleSubmit(event) {
    const orderForm = event.target.closest('[data-order-form]');
    if (orderForm) { event.preventDefault(); void submitOrderForm(orderForm); return; }
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
      captureOtherRequirements(additional);
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
      void resumeOrderByPo(); return;
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

  function setPriorQuoteAnswer(value) {
      if (state.order.previouslyQuoted !== (value === 'yes')) {
        state.order.technicalSourceChoice = null; state.order.technicalBaseline = null; state.order.technicalSource = null;
        state.order.quote = null; state.order.baseline = null; state.order.comparison = []; state.order.poFactsConfirmed = false;
      }
      state.order.previouslyQuoted = value === 'yes';
  }

  function selectChoice(field, value) {
    if (field === 'technical-source') {
      if (value === 'QUOTED_DEFINITION' && (!state.order.technicalBaseline || state.order.baseline?.customer?.customerId !== state.customer?.customerId)) return showInlineError('No verified quoted technical definition is available. Provide technical documents for review.');
      if (value === 'QUOTED_DEFINITION' && state.order.incomingTechnicalDocuments.length) return showInlineError('Remove incoming files from the new-documents step before choosing quoted documents only.');
      state.order.technicalSourceChoice = value; state.order.technicalSource = null; next(); return;
    }
    if (field === 'previously-quoted') {
      setPriorQuoteAnswer(value);
      next(); if (value === 'yes') { if (!quoteReadyForReview()) void searchOrderQuotes(); } else void preparePoFacts(); return;
    }
    if (field === "intake-type") { state.intakeType = value; if (value === 'NEW_ORDER') state.order.entry = 'choice'; }
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
    if (steps()[state.currentStep] === "customer" && !state.order.entry) searchCustomers();
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
    if (steps()[state.currentStep] !== "customer" || state.order.entry) return;
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

  async function continueFromFiles() {
    if (!state.technicalFiles.length) return showInlineError(state.intakeType === "NEW_ORDER" ?
      "Attach the customer PO before continuing." : "Choose at least one customer technical file.");
    if (state.intakeType === "NEW_ORDER") {
      if(!state.contractReview.customerPoNumber)return showInlineError('Enter the customer PO number.');
      state.technicalFilesProvided = true;state.contractReview.customerPoType='CUSTOMER_PO';
      try {
        const result=await orderApi('?' + new URLSearchParams({customerId:state.customer.customerId,po:state.contractReview.customerPoNumber}));
        const duplicate=result.items.find(r=>r.intakeId!==state.order.id);
        if(duplicate){state.order.duplicate=duplicate;render();return;}
      } catch(e){showInlineError(e.message);return;}
      state.currentStep=NEW_ORDER_STEPS.indexOf('previously-quoted');render();return;
    }
    next();
  }

  function isSkippedNewOrderStep(step) {
    if (state.intakeType !== "NEW_ORDER") return false;
    if (step === 'customer-po-number' || step === 'customer-po-type') return true;
    if (step === 'order-technical-files') return state.order.technicalSourceChoice !== 'NEW_DOCUMENTS';
    const review = state.contractReview;
    return (step === "quote-search" && state.order.previouslyQuoted === false) || (step === "payment-terms-note" && review.paymentTermsMatch === true) ||
      (step === "shipping-note" && review.billingMatchesShipTo === true) ||
      (step === "ups-account" && review.shippingMethod !== "UPS_COLLECT") ||
      (step === "delivery-date-note") ||
      (step === "price-note" && review.priceMatchesQuote === true) ||
      (step === "traceability-records" && review.traceabilityRequired === false);
  }

  async function submitIntake() {
    if (state.intakeType === "NEW_ORDER") return saveOrder(true);
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

  function orderInput(name, label, value, type = 'text', extra = '') {
    return '<label>' + escapeHtml(label) + '<input name="' + name + '" type="' + type + '" value="' + escapeHtml(value ?? '') + '" ' + extra + '></label>';
  }
  function savedOrderStep(p) {
    const map = key => key === 'po-flowdowns' ? 'additional-requirements' : key;
    if (p.wizardStepKey) return map(p.wizardStepKey);
    if (p.flowVersion >= 3) return NEW_ORDER_STEPS[p.wizardStep] || 'review';
    const legacy = [...NEW_ORDER_STEPS]; legacy.splice(legacy.indexOf('additional-requirements'),0,'po-flowdowns');
    if (p.flowVersion === 2) return map(legacy[p.wizardStep] || 'review');
    legacy.splice(5,3,'order-facts','previously-quoted','quote-search');
    return map(legacy[p.wizardStep >= 9 ? p.wizardStep + 2 : p.wizardStep] || 'review');
  }
  function orderStepLabel(key) {
    const labels = {'po-attachment':'Attach Customer PO','order-facts':'Enter PO facts','previously-quoted':'Identify prior quote','quote-search':'Select quote','order-comparison':'Compare PO and quote','technical-source':'Choose technical source','order-technical-files':'Attach incoming technical documents','review':'Review before submission'};
    return labels[key] || key.replaceAll('-', ' ');
  }
  function renderOrderEntry() {
    const o = state.order;
    if (o.entry === 'choice') return question('What would you like to do?',
      '<button type="button" class="intake-choice" data-order-action="start-new"><span>Start New Order</span></button>' +
      '<button type="button" class="intake-choice" data-order-action="list-drafts"><span>Resume Order in Progress</span></button>', 'Start a new order or continue a saved draft.');
    return question('Resume Order in Progress', '<p role="status">'+escapeHtml(o.message)+'</p>' +
      (o.drafts || []).map(d => '<article class="intake-order-draft"><strong>'+escapeHtml(d.customer.customerName)+'</strong><dl class="intake-review">' +
        [['Intake',d.intakeId],['Customer PO',d.poNumber],['Quote',d.quoteNumber || 'Not selected'],['Assembly / Rev',[d.assembly,d.revision].filter(Boolean).join(' / ') || 'Not entered'],['Last saved',d.lastSavedAt ? new Date(d.lastSavedAt).toLocaleString() : 'Not recorded'],['Progress',orderStepLabel(savedOrderStep(d)) + (d.poAttached ? ' · PO attached' : '')]].map(([k,v])=>'<div><dt>'+escapeHtml(k)+'</dt><dd>'+escapeHtml(v)+'</dd></div>').join('') +
        '</dl><button type="button" class="intake-primary" data-order-action="resume-draft" data-id="'+escapeHtml(d.intakeId)+'">Resume</button></article>').join('') +
      '<button type="button" class="intake-back" data-order-action="list-drafts">Refresh drafts</button><button type="button" class="intake-back" data-order-action="entry-choice">Back to Start / Resume</button>', 'Saved drafts are stored in SIM. Resuming does not submit the order.');
  }
  async function loadOrderDrafts() {
    const o = state.order; o.entry = 'drafts'; o.drafts = []; o.message = 'Loading saved drafts…'; render();
    const request = {}; o.draftRequest = request;
    try { const result = await orderApi('/drafts'); if (o !== state.order || o.draftRequest !== request || o.entry !== 'drafts') return; o.drafts = result.items; o.message = result.items.length ? 'Choose the order to continue.' : 'No saved New Order drafts.'; }
    catch(e) { if (o !== state.order || o.entry !== 'drafts') return; o.message = e.message; }
    render();
  }
  function parseManualDate(value) {
    if (!value.trim()) return null;
    const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if(!m) throw new Error('Enter dates as MM/DD/YYYY.');
    const month=+m[1],day=+m[2],year=+m[3],leap=year%4===0 && (year%100!==0 || year%400===0);
    if(year<1 || month<1 || month>12 || day<1 || day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1]) throw new Error('Enter a valid calendar date.');
    return m[3]+'-'+m[1]+'-'+m[2];
  }
  function dueDateLabel(value) { return ({ACCEPT:'Accepted due date',CLARIFICATION:'Needs customer clarification',CANNOT_MEET:'Cannot meet — follow-up required'})[value] || 'Review required'; }
  function captureDeliveryReview(form) {
    const o=state.order,date=parseManualDate(form.elements.customerDueDate.value);
    setOrderDueDate(date);
    o.dueDateNote=form.elements.dueDateNote?.value ?? o.dueDateNote ?? '';
    if(o.dueDateDecision && o.dueDateDecision.disposition!=='ACCEPT' && (o.dueDateDecision.note || '')!==o.dueDateNote) o.dueDateDecision=null;
  }
  // Gregorian calendar arithmetic only; no timestamps or timezone conversion.
  function calendarOrdinal(iso) {
    const [y,m,d]=iso.split('-').map(Number), prior=y-1;
    const leap=y%4===0 && (y%100!==0 || y%400===0);
    return 365*prior+Math.floor(prior/4)-Math.floor(prior/100)+Math.floor(prior/400)+[0,31,59,90,120,151,181,212,243,273,304,334][m-1]+(leap && m>2 ? 1:0)+d;
  }
  function quotedDateComparison(po, lead, due) {
    const match=/^(\d+)\s+(Days?|Weeks?)$/i.exec((lead || '').trim());
    const unavailable={reference:'',text:'Quoted lead-time date unavailable.'};
    if(!po || !match) return unavailable;
    try { parseManualDate(displayOrderDate(po)); } catch { return unavailable; }
    const days=+match[1]*(/^week/i.test(match[2])?7:1);
    if(days>36600) return unavailable;
    let [y,m,d]=po.split('-').map(Number);
    for(let n=0;n<days;n++) {
      const leap=y%4===0 && (y%100!==0 || y%400===0);
      if(++d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1]) { d=1; if(++m>12) {m=1;y++;} }
    }
    if(y>9999) return unavailable;
    const reference=String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    let customer;
    try { customer=parseManualDate(due || ''); } catch { return {reference,text:'Enter a valid customer due date to compare.'}; }
    if(!customer) return {reference,text:'Enter a customer due date to compare.'};
    const delta=calendarOrdinal(customer)-calendarOrdinal(reference), count=Math.abs(delta);
    return {reference,text:delta===0 ? 'Matches quoted lead-time date.' : 'Customer due date is '+count+' '+(count===1?'day':'days')+' '+(delta>0?'after':'earlier than')+' the quoted lead-time date.'};
  }
  function renderDeliveryReview() {
    const o=state.order,l=o.facts.lines[0],lead=o.baseline?.approval?.answers?.delivery;
    const comparison=quotedDateComparison(o.facts.poDate,lead,displayOrderDate(l.customerDueDate));
    const mode=o.dueNoteMode;
    const poLinks=state.technicalFiles.filter(d=>d.documentId && o.id).map((d,i)=>'<a class="due-po-link" target="_blank" rel="noopener noreferrer" href="/api/sim/new-orders/'+encodeURIComponent(o.id)+'/documents/'+encodeURIComponent(d.documentId)+'">View Customer PO'+(i?' '+(i+1):'')+'</a>').join('');
    return question('How should this customer due date be handled?',
      '<form class="intake-order-fields due-review" data-order-delivery data-order-form="delivery"><dl class="due-summary">'+
      [['Order',l.assembly+' / '+l.revision+' · Qty '+l.quantity],['PO Date',displayOrderDate(o.facts.poDate)||'Not entered'],['Quoted Lead Time',lead || 'Not quoted'],['Quoted Lead-Time Date',displayOrderDate(comparison.reference)||'Unavailable']].map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+escapeHtml(v)+'</dd></div>').join('')+'</dl>'+
      orderInput('customerDueDate','Customer Due Date (MM/DD/YYYY)',displayOrderDate(l.customerDueDate),'text','placeholder="MM/DD/YYYY"')+
      '<p class="due-comparison" data-due-comparison aria-live="polite">'+escapeHtml(comparison.text)+'</p>'+
      '<small>Reference only: PO Date plus quoted calendar lead time. This is not a delivery promise or proof of production capacity.</small><div>'+poLinks+'</div>'+
      '<p data-due-status>'+escapeHtml(dueDateLabel(o.dueDateDecision?.disposition))+'</p><div class="due-actions">'+
      '<button type="button" class="intake-primary" data-order-action="due-ACCEPT">Accept Due Date</button>'+
      '<button type="button" class="intake-back due-exception" data-order-action="due-select-CLARIFICATION">Needs Customer Clarification</button>'+
      '<button type="button" class="intake-back due-exception" data-order-action="due-select-CANNOT_MEET">Cannot Meet Due Date</button></div>'+
      (mode ? '<div class="due-note"><label>'+ (mode==='CLARIFICATION' ? 'Why does this date need clarification?' : "Why can't we meet this date?")+'<textarea name="dueDateNote" required>'+escapeHtml(o.dueDateNote || '')+'</textarea></label><button type="button" class="intake-back" data-order-action="due-'+mode+'">Confirm '+(mode==='CLARIFICATION'?'Clarification':'Cannot Meet')+'</button></div>' : '')+'</form>',
      'Review the customer requested arrival date against the quoted lead-time reference.');
  }
  // Date-only display: no Date parsing or timezone conversion.
  function displayOrderDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return match ? match[2] + '/' + match[3] + '/' + match[1] : (value || '');
  }
  function displayIntakeDueDate(iso) {
    const full=displayOrderDate(iso);
    return /^20\d{2}-\d{2}-\d{2}$/.test(iso || '') ? full.slice(0,6)+full.slice(8) : full;
  }
  function parseIntakeDueDate(value) {
    const text=(value || '').trim();
    if (!text) return null;
    const short=/^(\d{2}\/\d{2}\/)(\d{2})$/.exec(text);
    try { return parseManualDate(short ? short[1]+'20'+short[2] : text); }
    catch { throw new Error('Enter a valid due date as MM/DD/YY, or choose a date from the calendar.'); }
  }
  function setOrderDueDate(date) {
    const o=state.order, previous=o.facts.lines[0].customerDueDate || null;
    if(previous!==date) o.dueDateDecision=null;
    // Preserve source/legacy delivery text. Mirror the date only when no separate text exists.
    if(!o.facts.requestedDelivery || o.facts.requestedDelivery===previous) o.facts.requestedDelivery=date || '';
    o.facts.lines[0].customerDueDate=date;
  }
  function renderIntakeDueDate() {
    const f=state.order.facts, date=f.lines[0].customerDueDate || '';
    const retained=f.requestedDelivery && f.requestedDelivery!==date;
    return '<div class="intake-po-delivery-group"><label for="intakeDueDate">Due date</label><div class="intake-due-entry">'+
      '<input id="intakeDueDate" name="customerDueDate" data-intake-due-date value="'+escapeHtml(displayIntakeDueDate(date))+'" placeholder="MM/DD/YY" inputmode="numeric" aria-describedby="poDueFormat" required>'+
      '<button type="button" class="intake-back" data-order-action="pick-due-date" aria-label="Choose due date from calendar">Calendar</button>'+
      '<input type="date" class="intake-due-picker" data-intake-due-picker aria-label="Due date calendar" tabindex="-1" value="'+escapeHtml(date)+'"></div>'+
      '<small class="intake-po-help" id="poDueFormat">MM/DD/YY (20YY), or choose from the calendar.</small>'+
      (retained?'<details class="intake-retained-delivery"><summary>Retained delivery text</summary><p>'+escapeHtml(f.requestedDelivery)+'</p><small>This text is preserved. It has not been converted into a due date.</small></details>':'')+'</div>';
  }
  function validManualPoDate(value) {
    try { return !!parseManualDate(value || ''); } catch { return false; }
  }
  function renderOrderFacts() {
    const o=state.order, f=o.facts, l=f.lines[0], e=o.extraction;
    const dateReady=validManualPoDate(displayOrderDate(f.poDate));
    const message=o.extractionMessage || '';
    const readingAttention=/DIFFERS|differs/.test(message) ? message : /Manual entry remains available|could not resolve/i.test(message) ? 'Automatic PO reading is unavailable. Read the attached PO and fill in the fields below; you can continue without automatic reading.' : '';
    const evidence=e ? '<details><summary>PO extraction evidence</summary><ul>'+Object.entries(e.fields).map(([key,v])=>'<li>'+escapeHtml(key+': '+v.value+' — page '+v.page+' — '+v.confidence)+'<small>'+escapeHtml(v.evidence)+'</small></li>').join('')+'</ul></details>' : '';
    const tools='<details class="intake-po-tools"><summary>PO reading and correction tools</summary><div>'+
      '<p>Use these only if you need to reread the file, replace it, or restore the selected quote values.</p>'+
      (message?'<p role="status">'+escapeHtml(message)+'</p>':'')+evidence+
      '<button type="button" class="intake-back" data-order-action="attach-po">Attach / replace customer PO</button>'+
      '<button type="button" class="intake-back" data-order-action="extract-po" '+(!state.technicalFiles.length?'disabled':'')+'>Read PO again</button>'+
      (o.quote?'<button type="button" class="intake-back" data-order-action="use-quoted-values">Use selected quote values</button>':'')+'</div></details>';
    const q=o.baseline?.approval?.summary;
    const quote=o.quote?'<div class="intake-po-quote"><strong>Reference quote: '+escapeHtml(o.quote.quoteNumber)+'</strong>'+
      (q?'<p>'+escapeHtml(q.assembly+' / '+q.revision+' · Qty '+q.quantity+' · '+q.currency+' '+Number(q.combinedUnitPrice).toFixed(2)+' per unit')+'</p>':'')+
      '<small>Quoted lead time: '+escapeHtml(o.baseline?.approval?.answers?.delivery || 'Not provided')+'. Verify the actual PO values below.</small></div>':'';
    return question('Review the order against the PO', quote+renderOrderEvidence()+
      (state.technicalFiles.some(d=>!o.id || !d.documentId)?'<p class="intake-po-help">Save draft to enable View Customer PO here.</p>':'')+
      (o.quote?'<p data-quote-differences>'+escapeHtml(quoteDifferenceText())+'</p>':'')+
      (readingAttention?'<p class="intake-po-help" role="status">'+escapeHtml(readingAttention)+'</p>':'')+
      (!state.technicalFiles.length?'<p>Attach the customer PO using the tools below before continuing.</p>':'')+tools+
      '<form data-order-form="facts" class="intake-order-fields"><div class="intake-po-date-group">'+
      orderInput('poDate','PO Date (MM/DD/YYYY) — required',displayOrderDate(f.poDate),'text','placeholder="MM/DD/YYYY" aria-describedby="poDateHelp" required')+
      '<label class="intake-po-verification"><input type="checkbox" name="poDateVerified" aria-describedby="poDateHelp" required '+(dateReady&&o.poDateVerified?'checked ':'')+(!dateReady?'disabled ':'')+'> I verified the PO Date against the customer PO.</label>'+
      '<small class="intake-po-help" id="poDateHelp">PO date is the issue date printed on the customer purchase order, not the delivery date. Enter it first, then check the box after comparing it with the PO.</small></div>'+
      orderInput('assembly','Assembly / P/N — required',l.assembly,'text','required')+
      orderInput('revision','Revision — required',l.revision,'text','required')+orderInput('quantity','Quantity — required',l.quantity,'number','min="1" step="1" required')+
      orderInput('currency','Currency — required',l.currency,'text','pattern="[A-Z]{3}" maxlength="3" required')+
      orderInput('unitPrice','Unit price — required',l.unitPrice,'number','min="0" step="any" required')+
      orderInput('extendedValue','Extended value — required',l.extendedValue,'number','min="0" step="0.01" required')+
      orderInput('nre','Total NRE (0 if none) — required',f.nre,'number','min="0" step="0.01" required')+
      orderInput('separateCharges','Separate charges (0 if none) — required',f.separateCharges,'number','min="0" step="0.01" required')+
      renderIntakeDueDate()+
      '<button class="intake-primary">Continue</button></form>',
      'Open the customer PO below. Check the prefilled details against it, correct any differences, and fill in the missing information. Every field below is required to continue; Save draft lets you pause before finishing.');
  }
  function quoteReadyForReview() {
    const o=state.order;
    return !!o.quote && o.baseline?.customer?.customerId===state.customer?.customerId && JSON.stringify(o.baseline.reference)===JSON.stringify(o.quote);
  }

  function renderQuoteSearch() {
    const o = state.order;
    if (quoteReadyForReview() && !o.changingQuote) return question('Review the selected quote',
      renderOrderEvidence() + selectedQuoteContext() +
      '<button type="button" class="intake-back" data-order-action="change-quote">Change quote</button>' +
      '<button type="button" class="intake-primary" data-order-action="quote-continue">Continue</button>',
      'Continue to check the order details against your PO. Use Save draft to save this selection.');
    return question('Choose the matching prior quote', renderOrderEvidence() + selectedQuoteContext() + '<div class="intake-order-tabs">' + ['SUBMITTED','HISTORY'].map(b =>
      '<button type="button" class="intake-back" data-order-action="bucket" data-bucket="' + b + '" aria-pressed="' + (o.bucket === b) + '">' + b + '</button>').join('') + '</div>' +
      '<form data-order-form="search">' + orderInput('query','Quote, customer, assembly / P/N or revision',o.query) + '<button class="intake-back">Search</button></form>' +
      '<p role="status">' + escapeHtml(o.message) + '</p>' + o.results.map((q,i) => '<button type="button" class="intake-choice" data-order-action="select" data-index="' + i + '"><span>' +
        escapeHtml(q.reference.quoteNumber + ' · ' + q.customer.customerName) + '<small>' + escapeHtml(q.approval.summary.assembly + ' / ' + q.approval.summary.revision + ' · Qty ' + q.approval.summary.quantity + ' · ' + q.commercialStatus) + '</small></span></button>').join('') +
      '', 'Step 2 of 3: Select the matching quote. Its details will prefill blank order fields for review against your PO.');
  }
  function renderOrderComparison() {
    const o = state.order, b = o.baseline, s = b?.approval.summary;
    const baseline = b ? '<div class="intake-order-baseline"><strong>' + escapeHtml(b.reference.quoteNumber) + '</strong><p>' + escapeHtml(b.customer.customerName + ' · ' + s.assembly + ' / ' + s.revision + ' · Qty ' + s.quantity) +
      '</p><p>' + escapeHtml(s.currency + ' · Unit ' + Number(s.combinedUnitPrice).toFixed(2) + ' · Extended ' + Number(s.total).toFixed(2) + ' · Lead ' + b.approval.answers.delivery) +
      '</p><small>' + escapeHtml('Approval ' + b.reference.approvalId + ' / version ' + b.reference.approvalVersion) + '</small></div>' : '<p>' + (o.previouslyQuoted === false ? 'No prior quote — quotation comparison N/A.' : 'No quotation selected.') + '</p>';
    return baseline + '<div class="intake-order-table"><table><thead><tr><th>Field</th><th>Customer PO</th><th>Quote</th><th>Result</th></tr></thead><tbody>' +
      o.comparison.map(c => '<tr><th>' + escapeHtml(c.field) + '</th><td>' + escapeHtml(c.actual || 'Not supplied') + '</td><td>' + escapeHtml(c.quoted ?? 'Not modeled') + '</td><td>' + escapeHtml(c.result) + (c.note ? '<small>' + escapeHtml(c.note) + '</small>' : '') + '</td></tr>').join('') +
      '</tbody></table></div><button type="button" class="intake-back" data-order-action="refresh">Refresh comparison</button><button type="button" class="intake-back" data-order-action="facts">Edit PO facts</button>' +
      (state.order.existing || []).filter(r=>r.orderIntake?.reviewStatus === 'DRAFT').map(r=>'<p>'+escapeHtml(r.intakeId)+' · '+escapeHtml(r.orderIntake.poNumber)+' <button type="button" class="intake-back" data-order-action="resume-draft" data-id="'+escapeHtml(r.intakeId)+'">Resume existing draft</button></p>').join('');
  }
  function renderOrderEvidence() {
    return '<div class="intake-po-evidence">' + state.technicalFiles.map(d => '<div class="intake-po-evidence-item"><div><small>Customer PO · Owned by Intake</small><span>' + escapeHtml(d.name) + '</span></div>' + (state.order.id && d.documentId ? '<a class="intake-po-view" target="_blank" rel="noopener noreferrer" aria-label="View Customer PO: '+escapeHtml(d.name)+'" href="/api/sim/new-orders/' + encodeURIComponent(state.order.id) + '/documents/' + encodeURIComponent(d.documentId) + '">View Customer PO</a>' : '') + '</div>').join('') + '</div>';
  }
  function renderOrderTechnicalSource() {
    const o = state.order, b = o.technicalBaseline;
    const documents = b?.definition?.manufacturing?.package?.documents || [];
    const documentType = d => d.identityReview?.type === 'BOM_ONLY' || d.documentType === 'BOM' ? 'BOM' :
      d.identityReview?.type === 'DRAWING' || /DRAWING/.test(d.documentType || '') ? 'Technical Drawing' : 'Supporting Document';
    const quoted = b ? '<section class="intake-quoted-documents" aria-label="Quoted technical documents"><h3>Quoted technical documents</h3><p>Using documents from quote ' + escapeHtml(b.quote.quoteNumber) + '</p>' +
      (documents.length ? '<div class="intake-order-table"><table><thead><tr><th>Document</th><th>Type</th><th>Action</th></tr></thead><tbody>' +
        [...documents].sort((a,c)=>(a.name || '').localeCompare(c.name || '')).map(d => '<tr><td>' + escapeHtml(d.name) + '</td><td>' + documentType(d) + '</td><td>' +
          (d.documentId ? '<a target="_blank" rel="noopener noreferrer" aria-label="View '+escapeHtml(d.name)+'" href="/api/sim/rfq-intakes/'+encodeURIComponent(b.quote.intakeId)+'/documents/'+encodeURIComponent(d.documentId)+'">View</a>' : 'Unavailable') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p>No quoted documents listed.</p>') + '</section>' : '<p>No verified quoted technical definition available.</p>';
    return quoted +
      (o.technicalSourceChoice === 'NEW_DOCUMENTS' ? '<p>Technical review required: compare incoming files and identify affected scope. Existing quoted definition is preserved.</p>' : '') +
      '<ul>' + o.incomingTechnicalDocuments.map(d => '<li>' + (o.id && d.documentId ? '<a target="_blank" rel="noopener" href="/api/sim/new-orders/'+encodeURIComponent(o.id)+'/documents/'+encodeURIComponent(d.documentId)+'">'+escapeHtml(d.name)+'</a>' : escapeHtml(d.name)) + '</li>').join('') + '</ul>';
  }
  function contractReviewRequest() {
    const o=state.order;
    return {requestId:state.requestCorrelationId,correlationId:state.requestCorrelationId,intakeId:o.id,expectedRevision:o.revision,
      customer:state.customer,poNumber:state.contractReview.customerPoNumber,facts:o.facts,previouslyQuoted:o.previouslyQuoted,quote:o.quote,
      questionnaire:state.contractReview,documents:state.technicalFiles.map(({binary,...metadata})=>metadata),wizardStep:state.currentStep,submit:false,
      technicalSourceChoice:o.technicalSourceChoice,incomingTechnicalDocuments:o.incomingTechnicalDocuments.map(({binary,...metadata})=>metadata),
      wizardStepKey:'review',flowVersion:3,poFactsConfirmed:o.poFactsConfirmed===true,poDateVerified:o.poDateVerified===true,dueDateDecision:o.dueDateDecision,dueDateNote:o.dueDateNote,customerSupplyReview:o.customerSupplyReview||null};
  }
  async function loadContractReview(request,key) {
    const o=state.order;
    try {
      const projection=await orderApi('/contract-review-preview',request);
      if(state.order!==o || o.reviewKey!==key) return;
      o.reviewProjection=projection;
    } catch(e) { if(state.order!==o || o.reviewKey!==key) return; o.reviewError=e.message; }
    if(steps()[state.currentStep]==='review') {render();if(o.focusAcknowledgment){o.focusAcknowledgment=false;if(document.activeElement===document.body)root.querySelector('[data-order-requirements-ack]')?.focus?.();}}
  }
  async function previewContractReviewPdf() {
    const o=state.order;
    if(!o.reviewProjection || o.reviewKey!==JSON.stringify(contractReviewRequest())) return;
    const popup=window.open('about:blank','_blank');
    if(!popup) { o.reviewPdfError='Allow pop-ups to open the PDF preview.'; render(); return; }
    popup.opener=null;
    try {
      const response=await window.fetch('/api/sim/new-orders/contract-review-preview/pdf',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:o.reviewKey});
      if(!response.ok) { const error=await response.json(); throw new Error(error.message || 'PDF preview failed.'); }
      const url=URL.createObjectURL(await response.blob()); popup.location.href=url;
      window.setTimeout(()=>URL.revokeObjectURL(url),120000);
    } catch(e) { popup.close(); o.reviewPdfError=e.message; render(); }
  }
  function renderCustomerSupply(p) {
    if(!p) return '';
    const o=state.order,r=o.customerSupplyReview,selected=r?.poRowIds||[];
    return '<section class="cr-customer-supply" aria-label="C/S (Customer supplied)"><h3>C/S (Customer supplied)</h3><p>Source: '+escapeHtml(p.lines[0]?.quoteNumber||'No quoted BOM')+'; PO '+escapeHtml(state.contractReview.customerPoNumber||'Not entered')+'.</p><p>Select the lines the PO says the customer will supply. Compare them with the retained quote. Required quantity is the BOM minimum; no extra allowance is included.</p><div style="overflow:auto"><table><thead><tr><th>PO C/S</th><th>Find / customer P/N</th><th>Approved P/N</th><th>Per assembly</th><th>Job minimum</th><th>Quote C/S</th></tr></thead><tbody>'+p.lines.map(l=>'<tr><td><input type="checkbox" data-cs-row="'+escapeHtml(l.sourceRowId)+'" aria-label="PO C/S Find '+escapeHtml(l.findNumber)+'" '+(selected.includes(l.sourceRowId)?'checked':'')+'></td><td>'+escapeHtml(l.findNumber)+' / '+escapeHtml(l.customerPartNumber||'Not specified')+'</td><td>'+escapeHtml(l.approvedPartNumber)+'</td><td>'+escapeHtml(l.requiredEach)+' '+escapeHtml(l.uom)+'</td><td>'+escapeHtml(l.requiredQuantity)+' '+escapeHtml(l.uom)+'</td><td>'+ (l.quotedCustomerSupplied?'Yes':'No')+'</td></tr>').join('')+'</tbody></table></div><label>PO / quote clarification note<textarea data-cs-note maxlength="4000">'+escapeHtml(r?.note||'')+'</textarea></label><label class="cr-ack"><input type="checkbox" data-cs-ack '+(r?.acknowledged&&r.sourceToken===p.sourceToken?'checked':'')+'><span>I reviewed and acknowledge the C/S responsibility against the PO and quote. This does not record receipt, availability or kit completion.</span></label>'+p.issues.map(i=>'<p class="cr-attention">'+escapeHtml(i)+'</p>').join('')+'</section>';
  }
  function renderNewOrderReview() {
    const o=state.order, request=contractReviewRequest(), key=JSON.stringify(request);
    if(o.reviewKey!==key) { o.reviewKey=key; o.reviewProjection=null; o.reviewError=''; o.reviewPdfError=''; void loadContractReview(request,key); }
    const p=o.reviewProjection;
    if(!p) return '<h2>NEW ORDER FINAL REVIEW — DRAFT</h2><p role="status">'+escapeHtml(o.reviewError || 'Preparing review form…')+'</p>'+(o.reviewError ? '<button type="button" class="intake-back" data-order-action="review-retry">Retry preview</button>' : '');
    const fileTable=(files,po=false)=>'<table class="cr-documents"><tbody>'+files.map(f=>'<tr><td>'+escapeHtml(f.name)+'</td><td>'+escapeHtml(f.type)+'</td><td>'+(f.url ? '<a target="_blank" rel="noopener noreferrer" href="'+escapeHtml(f.url)+'" aria-label="View '+escapeHtml(f.name)+'">'+(po?'View Customer PO':'View')+'</a>' : 'Save draft to view')+'</td></tr>').join('')+'</tbody></table>';
    const sections=p.sections.filter(s=>s.title!=='C/S (Customer supplied)').map(s=>'<section><h3>'+escapeHtml(s.title)+'<button type="button" data-intake-edit="'+NEW_ORDER_STEPS.indexOf(s.editStep)+'">Edit</button></h3><dl>'+s.fields.map(f=>'<div><dt>'+escapeHtml(f.label)+'</dt><dd>'+escapeHtml(f.value)+'</dd></div>').join('')+'</dl>'+(s.title==='Order'?fileTable(p.poDocuments,true):'')+(s.title==='Technical Source'?fileTable(p.technicalDocuments):'')+'</section>').join('');
    return '<article class="contract-review-form"><header><strong>De Leon Enterprises</strong><span>DLE-OS Contract Review · Preview</span></header><h2>'+escapeHtml(p.title)+'</h2><p class="cr-status">'+escapeHtml(p.intakeId)+' · Saved package revision '+p.packageRevision+' · Current form preview</p>'+sections+renderCustomerSupply(p.customerSupply)+
      '<section><h3>Attention Items</h3><div class="cr-attention">'+(p.attention.length?'<ul>'+p.attention.map(a=>'<li>'+escapeHtml(a)+'</li>').join('')+'</ul>':'No unresolved review items.')+'</div></section>'+
      '<details class="cr-review-details"><summary>Review details</summary><dl><div><dt>Reviewer</dt><dd>'+escapeHtml(p.reviewer)+'</dd></div><div><dt>Date</dt><dd>'+escapeHtml(p.reviewedDate)+'</dd></div></dl></details>'+
      '<p class="cr-notice">'+escapeHtml(p.notice)+'</p><div class="cr-submit-block"><label class="cr-ack"><input type="checkbox" data-order-requirements-ack aria-describedby="crAckHelp" '+(p.acknowledged?'checked':'')+' '+(state.submit.status==='saving'?'disabled':'')+'><span>I reviewed the customer PO and captured its requirements.</span></label><p id="crAckHelp" class="cr-ack-help">'+(state.submit.status==='saving'?'Saving order…':p.acknowledged?'Ready to submit for Contract Review.':'Check the acknowledgment above to enable Submit for Contract Review.')+'</p><div class="cr-actions"><button type="button" class="intake-back" data-order-action="review-pdf">Preview Contract Review</button><button type="button" class="intake-primary" data-intake-action="submit" '+(state.submit.status==='saving'||!p.acknowledged||(p.customerSupply&&!p.customerSupply.acknowledged)?'disabled':'')+' aria-describedby="crAckHelp" aria-busy="'+(state.submit.status==='saving')+'">Submit for Contract Review</button></div></div><p role="alert">'+escapeHtml(o.reviewPdfError || state.submit.message)+'</p></article>';
  }
  async function orderApi(url, body) {
    const response = await window.fetch('/api/sim/new-orders' + url, { credentials:'include', ...(body ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.message || 'New Order request failed.'); return data;
  }
  async function searchOrderQuotes() {
    const o = state.order, customerId = state.customer?.customerId;
    const bucket = o.bucket, query = o.query || '', changingQuote = o.changingQuote;
    o.message = 'Searching…'; o.results = []; render();
    try {
      const result = await orderApi('/quotes?' + new URLSearchParams({customerId:customerId || '',query,bucket}));
      if (o !== state.order || customerId !== state.customer?.customerId || bucket !== o.bucket || query !== (o.query || '') || changingQuote !== o.changingQuote) return;
      o.results = result.items; o.message = result.items.length ? 'Select the exact quotation revision.' : 'No matching quotations in ' + bucket + '.';
    } catch (e) { o.message = e.message; }
    render();
  }
  async function previewOrder() {
    const o = state.order;
    const payload = { customer:state.customer, facts:o.facts, previouslyQuoted:o.previouslyQuoted, quote:o.quote };
    const token = JSON.stringify(payload); o.previewToken = token;
    try {
      const result = await orderApi('/preview', payload);
      if (o !== state.order || o.previewToken !== token) return;
      const retained = o.technicalSource?.baseline;
      o.baseline = result.baseline; o.technicalBaseline = result.technicalBaseline || (retained && JSON.stringify(retained.quote) === JSON.stringify(result.baseline?.reference) && retained.sourceToken === result.baseline?.approval?.sourceToken ? retained : null); o.comparison = result.comparison; o.message = '';
    } catch(e) { o.comparison = []; o.baseline = null; o.technicalBaseline = null; o.message = e.message; }
    render();
  }
  async function preparePoFacts() {
    if(!state.technicalFiles.length){state.currentStep=NEW_ORDER_STEPS.indexOf('po-attachment');render();showInlineError('Attach the customer PO before reading it.');return;}
    if(state.order.readingPo)return;
    const form=root.querySelector('[data-order-form="facts"]'); if(form){try{captureOrderFacts(form);}catch(e){showInlineError(e.message);return;}}

    const o=state.order, selected=state.technicalFiles.slice(), originalFacts=JSON.stringify(o.facts), token={}; o.extractRequest=token;o.readingPo=true;
    o.extractionMessage='Reading the verified customer PO…'; render();
    try {
      if (!selected.length) throw new Error('Attach the customer PO first. You can also enter details manually.');
      state.requestCorrelationId ||= window.crypto.randomUUID();
      for (const file of selected) {
        if (file.documentId) continue;
        const response=await window.fetch('/api/sim/intake-drafts/'+encodeURIComponent(state.requestCorrelationId)+'/documents?name='+encodeURIComponent(file.name)+'&lastModified='+file.lastModified,
          {method:'POST',credentials:'include',headers:{'Content-Type':'application/octet-stream','X-SIM-Document-Upload':'1'},body:file.binary});
        const data=await response.json(); if (!response.ok || data.binaryStatus!=='VERIFIED') throw new Error(data.message || 'PO verification failed.'); Object.assign(file,data);
      }
      const result=await orderApi('/po-extraction',{correlationId:state.requestCorrelationId,intakeId:o.id,documents:selected.map(({binary,...metadata})=>metadata)});
      if (o!==state.order || o.extractRequest!==token || selected.length!==state.technicalFiles.length || selected.some((f,i)=>f!==state.technicalFiles[i])) return;
      if (!result.facts || !result.fields) throw new Error('PO extraction is unavailable on this server.');
      o.extraction=result;
      if (!o.poFactsConfirmed && originalFacts===JSON.stringify(o.facts)) {
        const fill=(target,suggested)=>{for(const [k,v] of Object.entries(suggested || {})) if (!['lines','poDate','customerDueDate'].includes(k) && (target[k]===null || target[k]===undefined || target[k]==='') && v!==null) target[k]=v;};
        fill(o.facts,result.facts); fill(o.facts.lines[0],result.facts.lines[0]);
      }
      const suggested={...result.facts,...result.facts.lines?.[0]};
      const conflicts=Object.keys(quotedOrderValues()||{}).filter(key=>{
        const actual=['nre','separateCharges'].includes(key)?o.facts[key]:o.facts.lines[0][key];
        return suggested[key]!=null&&suggested[key]!==''&&actual!=null&&actual!==''&&String(suggested[key])!==String(actual);
      });
      const identity=result.fields?.poNumber?.value;
      o.extractionMessage=(result.status==='SUGGESTED' ? 'PO suggestions are ready. Review and correct before confirming. Enter any blank fields manually.' : 'Automatic extraction could not resolve these fields. Enter the PO details manually.') +
        (identity && identity!==state.contractReview.customerPoNumber ? ' PO NUMBER DIFFERS: document says '+identity+'. Check the saved PO number.' : '') +
        (result.fields?.customer ? ' Customer on PO: '+result.fields.customer.value+'. Selected customer: '+state.customer.customerName+'. Confirm that these identify the same customer.' : ' Verify the selected customer against the PO.')+(conflicts.length?' PO reading differs from entered values: '+conflicts.join(', ')+'. Review the extraction evidence; your entries were preserved.':'');
    } catch(e) { o.extractionMessage=e.message+' Manual entry remains available.'; }
    finally {o.readingPo=false;}
    if (o===state.order) render();
  }
  function captureOrderFacts(form) {
    const previous = JSON.stringify(state.order.facts);
    const poDate=parseManualDate(form.elements.poDate.value);
    const dueDate=parseIntakeDueDate(form.elements.customerDueDate.value);
    state.order.poDateVerified=!!poDate && !!form.elements.poDateVerified?.checked;
    setOrderDueDate(dueDate);
    const value = name => form.elements[name].value.trim();
    const number = name => value(name) === '' ? null : Number(value(name));
    state.order.facts = { poDate, requestedDelivery:state.order.facts.requestedDelivery, nre:number('nre'), separateCharges:number('separateCharges'),
      lines:[{...state.order.facts.lines[0],assembly:value('assembly'), revision:value('revision'), quantity:number('quantity'), currency:value('currency'), unitPrice:number('unitPrice'), extendedValue:number('extendedValue')}] };
    state.order.comparison = [];
    if (previous !== JSON.stringify(state.order.facts)) state.order.poFactsConfirmed = false;
  }
  async function submitOrderForm(form) {
    if (form.dataset.orderForm === 'quoted') { selectChoice('previously-quoted',form.elements.quoted.value); return; }
    if (form.dataset.orderForm === 'delivery') return;
    if (form.dataset.orderForm === 'search') { state.order.query = form.elements.query.value.trim(); return searchOrderQuotes(); }
    try { captureOrderFacts(form); } catch(e) { showInlineError(e.message); return; }
    if(!state.technicalFiles.length || !state.contractReview.customerPoNumber){state.currentStep=NEW_ORDER_STEPS.indexOf('po-attachment');render();return showInlineError('Attach the PO and enter its number before confirming details.');}
    if (!state.order.facts.lines[0].customerDueDate) return showInlineError('Enter the due date shown on the PO.');
    if (!state.order.poDateVerified) return showInlineError("Verify the PO Date against the customer PO.");
    state.order.poFactsConfirmed = true;
    state.currentStep = NEW_ORDER_STEPS.indexOf('order-comparison'); await previewOrder();
  }
  function restoreOrder(record) {
    const p = record.orderIntake;
    if (!p || p.reviewStatus !== 'DRAFT') { committed = record; state.status = 'COMPLETE'; render(); return; }
    const o = state.order;
    o.changingQuote = false; o.entry = null; o.duplicate = null; o.existing = []; state.status = 'DRAFT'; state.submit = {status:'idle',message:''}; committed = null;
    Object.assign(o, {id:record.intakeId,revision:p.revision,facts:p.facts,previouslyQuoted:p.previouslyQuoted,quote:p.quote?.reference || null,baseline:p.quote,comparison:p.comparison,pending:null,message:'Reopened ' + record.intakeId});
    state.requestCorrelationId = record.requestCorrelationId; state.customer = record.customer;
    o.customerSupplyReview=p.customerSupplyReview||null;
    state.contractReview = {...createState().contractReview, ...p.questionnaire, customerPoNumber:p.poNumber};
    if ((p.flowVersion ?? 1) < 3 && state.contractReview.specialRequirements?.trim() && state.contractReview.otherCustomerRequirements == null) state.contractReview.otherCustomerRequirements='';
    Object.assign(o, {technicalSource:p.technicalSource || null,technicalSourceChoice:p.technicalSource?.choice || null,technicalBaseline:p.technicalSource?.baseline || null,incomingTechnicalDocuments:(p.technicalSource?.documents || []).map(e=>e.document)});
    o.contractDates=p.contractDates || null; o.dueNoteMode=null;
    o.poDateVerified=!!p.contractDates?.poDateVerification && p.contractDates.poDateVerification.date===p.facts.poDate;
    const dr=p.contractDates?.dueDateReview;
    o.dueDateDecision=dr && dr.date===(p.facts.lines[0]?.customerDueDate || null) ? {disposition:dr.disposition,note:dr.note} : null;
    o.dueDateNote=p.pendingDueDateNote ?? o.dueDateDecision?.note ?? '';
    o.poFactsConfirmed = p.poFactsConfirmed === true; o.extraction = p.poFactReviews?.at(-1)?.extraction || null;
    let stepIndex = NEW_ORDER_STEPS.indexOf(savedOrderStep(p));
    if (stepIndex >= NEW_ORDER_STEPS.indexOf('order-facts') && p.previouslyQuoted === null) stepIndex = NEW_ORDER_STEPS.indexOf('previously-quoted');
    else if (stepIndex > NEW_ORDER_STEPS.indexOf('order-facts') && !o.poFactsConfirmed) stepIndex = NEW_ORDER_STEPS.indexOf('order-facts');
    state.technicalFiles = p.poEvidence.map(e => e.document); state.currentStep = Math.max(0, Math.min(stepIndex,NEW_ORDER_STEPS.length-1)); render();
  }
  async function resumeOrderByPo() {
    try {
      const result = await orderApi('?' + new URLSearchParams({customerId:state.customer.customerId,po:state.contractReview.customerPoNumber}));
      if (result.items.length) { state.order.duplicate = result.items[0]; render(); return; }
      if (state.order.id) { state.order.id = null; state.order.revision = 0; state.requestCorrelationId = null; state.technicalFiles = []; }
      next();
    } catch(e) { showInlineError(e.message); }
  }
  async function orderActionClick(button) {
    const action = button.dataset.orderAction, o = state.order;
    if(action==='open-acceptance') { window.DleWorkspaceShell.navigate({workspaceId:'order-entry'}); return; }
    if(action==='review-pdf') return previewContractReviewPdf();
    if(action==='review-retry') { o.reviewKey=null; render(); return; }
    if (action === 'start-new') { state = createState(); state.intakeType = 'NEW_ORDER'; state.currentStep = NEW_ORDER_STEPS.indexOf('customer'); committed = null; render(); return searchCustomers(); }
    if (action === 'list-drafts') return loadOrderDrafts();
    if (action === 'entry-choice') { o.entry = 'choice'; render(); return; }
    if (action === 'resume-draft') {
      o.message = 'Opening saved draft…'; render();
      try { const result = await orderApi('/drafts/'+encodeURIComponent(button.dataset.id)); if (o !== state.order) return; restoreOrder(result.record); if (o.previouslyQuoted && o.quote) await previewOrder(); }
      catch(e) { o.message = e.message; render(); }
      return;
    }
    if (action === 'different-po') { o.duplicate = null; state.contractReview.customerPoNumber = ''; state.currentStep = NEW_ORDER_STEPS.indexOf('customer-po-number'); render(); return; }
    if (action === 'save') return saveOrder(false);
    if (action?.startsWith('due-select-')) { try { captureDeliveryReview(root.querySelector('[data-order-delivery]')); o.dueNoteMode=action.slice(11); render(); } catch(e) { showInlineError(e.message); } return; }
    if (action?.startsWith('due-')) {
      try {
        captureDeliveryReview(root.querySelector('[data-order-delivery]'));
        const disposition=action.slice(4);
        if(disposition!=='CLARIFICATION' && !o.facts.lines[0].customerDueDate) throw new Error('Enter a valid customer due date.');
        if(disposition!=='ACCEPT' && !o.dueDateNote.trim()) throw new Error('Enter a clarification or follow-up note.');
        o.dueDateDecision={disposition,note:disposition==='ACCEPT' ? null : o.dueDateNote}; o.dueNoteMode=null;
        state.contractReview.deliveryDateAchievable=disposition==='ACCEPT'; state.contractReview.deliveryDateActionNote=o.dueDateDecision.note || ''; next();
      } catch(e) { showInlineError(e.message); } return;
    }
    if(action==='use-quoted-values'){
      const form=root.querySelector('[data-order-form="facts"]');if(form){try{captureOrderFacts(form);}catch(e){showInlineError(e.message);return;}}
      if(!window.confirm('Replace assembly, revision, quantity, currency, price, extended value, NRE and separate charges with the selected quote values? Your PO number, dates, requested delivery and attachments will remain.'))return;
      applyQuotedOrderValues(true);render();return;
    }
    if(action==='attach-po'){
      const form=root.querySelector('[data-order-form="facts"]');if(form){try{captureOrderFacts(form);}catch(e){showInlineError(e.message);return;}}
      state.currentStep=NEW_ORDER_STEPS.indexOf('po-attachment');render();return;
    }
    if(action==='read-attached'||action==='manual-facts'){
      if(!state.contractReview.customerPoNumber)return showInlineError('Enter the customer PO number.');
      if(action==='read-attached'&&!state.technicalFiles.length)return showInlineError('Attach the PO before reading it.');
      state.contractReview.customerPoType='CUSTOMER_PO';state.currentStep=NEW_ORDER_STEPS.indexOf('order-facts');render();
      if(action==='read-attached')await preparePoFacts();return;
    }
    if (action === 'pick-due-date') {
      const picker=root.querySelector('[data-intake-due-picker]');
      if(picker?.showPicker) { try { picker.showPicker(); return; } catch {} }
      if(picker) { picker.classList.remove('intake-due-picker'); picker.focus(); }
      return;
    }
    if (action === 'change-quote') { o.changingQuote=true; render(); return searchOrderQuotes(); }
    if (action === 'quote-continue') {
      if(!quoteReadyForReview())return showInlineError('Select a prior quote before continuing.');
      o.message='';state.currentStep=NEW_ORDER_STEPS.indexOf('order-facts');render();await preparePoFacts();return;
    }
    if (action === 'extract-po') return preparePoFacts();
    if (action === 'quoted-question') { state.currentStep = NEW_ORDER_STEPS.indexOf('previously-quoted'); render(); return; }
    if (action === 'browse') { const po=root.querySelector('[data-intake-form="customer-po-number"] [data-intake-value-input]');if(po)state.contractReview.customerPoNumber=po.value.trim(); o.previouslyQuoted = true; o.bucket = 'SUBMITTED'; state.currentStep = NEW_ORDER_STEPS.indexOf('quote-search'); render(); return searchOrderQuotes(); }
    if (action === 'bucket') { o.bucket = button.dataset.bucket; return searchOrderQuotes(); }
    if (action === 'select') {
      const q = o.results[Number(button.dataset.index)]; if (!q) return;
      if (JSON.stringify(o.quote) !== JSON.stringify(q.reference)) { o.technicalSourceChoice = null; o.technicalSource = null; }
      o.changingQuote = false;
      const firstQuote=!o.quote&&!o.quotePrefillAttempted;
      o.quote = q.reference; o.previouslyQuoted = true; state.contractReview.customerPoType='CUSTOMER_PO'; state.currentStep = NEW_ORDER_STEPS.indexOf('quote-search'); await previewOrder();
      if(firstQuote&&o===state.order){applyQuotedOrderValues();render();}
      const existing = await orderApi('?' + new URLSearchParams({customerId:state.customer.customerId,approvalId:q.reference.approvalId})).catch(() => ({items:[]}));
      o.existing = existing.items;
      if (existing.items.length) { o.message = 'An order intake already uses this quote. Resume it below, or use a different PO for a separate order.'; render(); }
      return;
    }
    if (action === 'facts') { state.currentStep = NEW_ORDER_STEPS.indexOf('order-facts'); render(); return; }
    if (action === 'refresh') return previewOrder();
    if (action === 'remove-technical') { o.incomingTechnicalDocuments.splice(Number(button.dataset.index),1); render(); return; }
    if (action === 'technical-continue') { if (!o.incomingTechnicalDocuments.length) return showInlineError('Attach technical documents before continuing.'); next(); return; }
    if (action === 'continue') { if (!o.poFactsConfirmed) { state.currentStep=NEW_ORDER_STEPS.indexOf('order-facts'); render(); return; } await previewOrder(); next(); }
  }
  async function saveOrder(submit) {
    if (state.submit.status === 'saving') return;
    const o = state.order;
    const quoted = root.querySelector('[data-order-form="quoted"] input:checked');
    if (quoted) setPriorQuoteAnswer(quoted.value);
    const form = root.querySelector('[data-order-form="facts"]'); if (form) { try { captureOrderFacts(form); } catch(e) { showInlineError(e.message); return; } }
    const inputForm = root.querySelector('[data-intake-form]');
    const fieldMap = {'customer-po-number':'customerPoNumber','payment-terms-note':'paymentTermsActionNote','shipping-note':'shippingActionNote','ups-account':'upsAccountNumber','delivery-date-note':'deliveryDateActionNote','po-flowdowns':'poFlowdowns'};
    if (inputForm && fieldMap[inputForm.dataset.intakeForm]) state.contractReview[fieldMap[inputForm.dataset.intakeForm]] = inputForm.querySelector('[data-intake-value-input]').value.trim();
    const extraForm = root.querySelector('[data-intake-additional-requirements]');
    if (extraForm) captureOtherRequirements(extraForm);
    const acknowledgment = root.querySelector('[data-order-requirements-ack]');
    if (acknowledgment) state.contractReview.requirementsIdentifiedOnAttachedDocument=acknowledgment.checked;
    if (submit && !state.contractReview.requirementsIdentifiedOnAttachedDocument) { state.submit={status:'error',message:'Review the customer PO and confirm the acknowledgment before submission.'}; render(); return; }
    const selections = root.querySelector('[data-intake-multiselect]');
    if (selections) state.contractReview[selections.dataset.intakeMultiselect === 'traceability-records' ? 'traceabilityDeliverables' : 'aerospaceRequirements'] = Array.from(selections.querySelectorAll('input[name="selection"]:checked'),input=>input.value);
    if (!state.customer || !state.contractReview.customerPoNumber) { o.message = 'Select the customer and enter a PO number before saving.'; render(); return; }
    state.submit = {status:'saving',message:''}; render();
    try {
      const compatibility = await orderApi('/preview', {customer:state.customer,facts:o.facts,previouslyQuoted:o.previouslyQuoted,quote:o.quote});
      if (compatibility.technicalSourceContractVersion !== 1) throw new Error('The SIM server needs the technical-source update before this version of New Order can save. Your form remains open.');
      if (compatibility.manualDateVersion !== 1) throw new Error('The SIM server needs the manual-date update before saving. Your form remains open.');
      if (compatibility.requirementsUiVersion !== 3) throw new Error('The SIM server needs the consolidated-requirements update before saving. Your form remains open.');
      state.requestCorrelationId ||= window.crypto.randomUUID();
      for (const file of [...state.technicalFiles, ...o.incomingTechnicalDocuments]) {
        if (file.documentId) continue;
        const upload = await window.fetch('/api/sim/intake-drafts/' + encodeURIComponent(state.requestCorrelationId) + '/documents?name=' + encodeURIComponent(file.name) + '&lastModified=' + file.lastModified,
          {method:'POST',credentials:'include',headers:{'Content-Type':'application/octet-stream','X-SIM-Document-Upload':'1'},body:file.binary});
        const data = await upload.json(); if (!upload.ok || data.binaryStatus !== 'VERIFIED') throw new Error(data.message || 'PO upload could not be verified.'); Object.assign(file,data);
      }
      const payload = {correlationId:state.requestCorrelationId,intakeId:o.id,expectedRevision:o.revision,customer:state.customer,poNumber:state.contractReview.customerPoNumber,
        facts:o.facts,previouslyQuoted:o.previouslyQuoted,quote:o.quote,questionnaire:state.contractReview,documents:state.technicalFiles.map(({binary,...metadata})=>metadata),wizardStep:state.currentStep,submit,
        technicalSourceChoice:o.technicalSourceChoice,incomingTechnicalDocuments:o.incomingTechnicalDocuments.map(({binary,...metadata})=>metadata),wizardStepKey:steps()[state.currentStep],flowVersion:3,poFactsConfirmed:o.poFactsConfirmed === true,poDateVerified:o.poDateVerified === true,dueDateDecision:o.dueDateDecision,dueDateNote:o.dueDateNote,customerSupplyReview:o.customerSupplyReview||null};
      const content = JSON.stringify(payload); if (o.pending?.content !== content) o.pending = {content,requestId:window.crypto.randomUUID()};
      const result = await orderApi('', {...payload,requestId:o.pending.requestId}); o.pending = null;
      if (result.resumed) { if (result.record.intakeId === o.id) { restoreOrder(result.record); if (o.previouslyQuoted && o.quote) await previewOrder(); } else o.duplicate = result.record; o.message = 'Existing intake found; no duplicate created.'; }
      else { o.id = result.record.intakeId; o.revision = result.record.orderIntake.revision; o.baseline = result.record.orderIntake.quote; o.comparison = result.record.orderIntake.comparison;
        o.technicalSource = result.record.orderIntake.technicalSource; o.technicalBaseline = o.technicalSource?.baseline || compatibility.technicalBaseline || null;
        o.contractDates=result.record.orderIntake.contractDates;
        o.message = 'Saved ' + o.id + ' · revision ' + o.revision;
        if (submit) { committed = result.record; state.status = 'COMPLETE'; }
      }
      state.submit = {status:'idle',message:''};
    } catch(e) { state.submit = {status:'error',message:e.message}; o.message = e.message; }
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


(function registerTechnicalReviewWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "technical-review";
  const TEMPLATE_PATH = "SRC/workspaces/technical-review/technical-review-workspace.html";
  const state = { items: [], selected: null, loading: false, guided: false, materials: false, step: '', packageDraft: null, documentIndex: 0, closing: false, saving: false, error: "", message: "", messageState: "" };
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
    if (!state.saving) showQueue();
    await loadQueue();
  }

  function bindInteractions() {
    if (interactionsBound || !mount) return;
    interactionsBound = true;
    mount.addEventListener("click", event => {
      const actionButton = event.target.closest?.("[data-technical-review-action]");
      const action = actionButton?.dataset.technicalReviewAction;
      if (state.step === 'accepted-bom' && ['candidate-confirm', 'complete-bom', 'alternate-add', 'alternate-edit', 'alternate-remove'].includes(action)) return;
      if (action === "refresh") void loadQueue();
      if (action === "back" && !state.saving) showQueue();
      if (action === "start" && state.selected?.record?.technicalReview?.materialsReviewStatus !== 'QUALIFIED') void saveEntryDisposition("START_TECHNICAL_REVIEW");
      if (action === 'save-assembly-type') void saveAssemblyType();
      if (action === 'manufacturing' && !state.saving && manufacturingIsNext(state.selected?.record) && window.DleOsCapabilities?.can?.('technical_review.disposition') === true) {
        state.guided = true; state.materials = false; state.step = 'manufacturing';
        state.message = ''; renderDetail();
        document.getElementById('manufacturingReviewTitle')?.focus?.();
      }
      if (action === "close" && !state.saving) {
        state.closing = true;
        state.message = "";
        state.messageState = "";
        renderDetail();
        document.getElementById("technicalReviewClosePrompt")?.focus?.();
      }
      if (action === "save-close" && state.closing) void saveEntryDisposition("NO_LONGER_REQUIRED");
      if (action === "delete" && state.closing) void deleteReview();
      if (action === "package" || action === "package-back") enterPackage();
      if (action === "save-package") void savePackage(false);
      if (action === "compare-package") void savePackage(true);
      if (action === "governing-back") { state.materials = false; state.step = 'governing'; renderDetail(); }
      if (action === "coverage") { state.materials = false; state.step = 'coverage'; renderDetail(); }
      const fileButton = event.target.closest?.('[data-package-index]');
      if (fileButton && !state.saving) { state.documentIndex = Number(fileButton.dataset.packageIndex); renderDetail(); }
      if (action === "materials") void reviewMaterials();
      if (action === "candidate") {
        state.acceptedVersion = null;
        if (state.selected?.record?.technicalReview?.candidateBom) { state.candidateIndex = null; state.step = 'candidate'; state.materials = false; renderDetail(); }
        else void buildCandidate();
      }
      if (action === 'analysis-retry') void buildCandidate();
      if (action === 'candidate-detail' && !state.saving) {
        const index = Number(event.target.closest('[data-candidate-row]').dataset.candidateRow);
        state.candidateDraft = null; state.candidateIndex = state.candidateIndex === index ? null : index; renderDetail();
      }
      if (action === "candidate-from-source") void savePackage(false).then(() => { if (state.messageState !== 'error') return buildCandidate(); });
      if (action === 'complete-bom') void completeBom();
      if (action === 'accepted-bom' && !state.saving) {
        state.acceptedVersion = Number(actionButton.dataset.acceptedVersion);
        state.candidateIndex = null; state.guided = true; state.step = 'accepted-bom';
        renderDetail();
        document.getElementById('acceptedBomTitle')?.focus?.();
      }
      if (action === 'accepted-back' && !state.saving) void openReview(state.selected.record.intakeId);
      if (action === "candidate-confirm") void confirmCandidate();
      if (action === 'alternate-add') void saveAlternate('ADD');
      if (action === 'alternate-edit' || action === 'alternate-remove') void saveAlternate(action === 'alternate-edit' ? 'EDIT' : 'REMOVE', event.target.closest('[data-alternate-id]').dataset.alternateId);
      if (action === "candidate-previous" && !state.saving) { state.candidateDraft = null; state.candidateIndex = Math.max(0, (state.candidateIndex || 0) - 1); renderDetail(); }
      if (action === "candidate-next" && !state.saving) { state.candidateDraft = null; state.candidateIndex = (state.candidateIndex || 0) + 1; renderDetail(); }
      if (action === "history-back" && !state.saving) { state.materials = false; state.step = ""; state.message = ""; state.messageState = ""; renderDetail(); }
      if (action === "retry-history") void updateHistory(false);
      if (action === "confirm-history") void updateHistory(true);
      if (action === "review-back" && !state.saving) { state.guided = false; state.message = ""; renderDetail(); }
      const row = event.target.closest?.("[data-technical-review-intake]");
      if (row) void openReview(row.dataset.technicalReviewIntake);
    });
    mount.addEventListener('input', event => {
      if (!state.saving && event.target.dataset?.packageField === 'subassemblyPartNumber') packageDraft().documents[state.documentIndex || 0].subassemblyPartNumber = event.target.value;
    });
    mount.addEventListener('change', event => {
      if (state.saving || !state.selected || state.step === 'accepted-bom') return;
      if (event.target.dataset?.componentRow !== undefined) { void saveComponentType(event.target); return; }
      const field = event.target.dataset?.packageField;
      const pack = packageDraft();
      if (field) {
        const doc = pack.documents[state.documentIndex || 0]; doc[field] = field === 'embeddedBom' ? event.target.checked : event.target.value;
        if (field === 'documentType' && doc.documentType !== 'ASSEMBLY_DRAWING') doc.embeddedBom = false;
        if (doc.role === 'GOVERNING' && ['BOM', 'SUBASSEMBLY_BOM'].includes(doc.documentType) && doc.applicability === 'PARENT_ASSEMBLY' && pack.governingBomDocumentId !== doc.documentId) { doc.role = 'UNRESOLVED'; state.message = 'Select the governing parent BOM in the next step.'; }
        if (pack.governingBomDocumentId === doc.documentId && (!isBomSource(doc) || doc.applicability !== 'PARENT_ASSEMBLY' || (doc.documentType === 'BOM' && doc.role !== 'GOVERNING'))) { pack.governingBomDocumentId = null; if (doc.documentType === 'BOM' && doc.role === 'GOVERNING') doc.role = 'UNRESOLVED'; }
        renderDetail();
      }
      if (event.target.dataset?.governingId !== undefined) {
        const id = event.target.dataset.governingId || null;
        pack.documents.forEach(doc => { if (doc.documentId === pack.governingBomDocumentId && doc.documentType === 'BOM' && doc.role === 'GOVERNING') doc.role = 'UNRESOLVED'; if (doc.documentId === id && doc.documentType === 'BOM') doc.role = 'GOVERNING'; });
        pack.governingBomDocumentId = id; state.message = ''; renderDetail();
      }
    });

  }

  const documentTypes = { UNKNOWN: 'Unknown / Needs Classification', BOM: 'BOM', ASSEMBLY_DRAWING: 'Assembly Drawing', SUBASSEMBLY_BOM: 'Referenced / Subassembly BOM', ALTERNATE_PART_APPROVAL: 'Alternate-Part Approval', GERBER: 'Gerber', SUPPORTING_DOCUMENT: 'Supporting Document' };
  const documentRoles = { UNRESOLVED: 'Unresolved', GOVERNING: 'Governing', REFERENCED: 'Referenced', SUPPORTING: 'Supporting' };
  const applicability = { PARENT_ASSEMBLY: 'Parent assembly', SUBASSEMBLY: 'Subassembly', SUPPORTING_REFERENCE: 'Supporting / Reference' };
  function isBomSource(doc) { return doc.documentType === 'BOM' || (doc.documentType === 'ASSEMBLY_DRAWING' && doc.embeddedBom === true); }
  function bomSourceLabel(doc) { return doc.documentType === 'ASSEMBLY_DRAWING' ? 'BOM embedded in Assembly Drawing' : 'Standalone BOM'; }
  function packageDraft() {
    return state.packageDraft ||= JSON.parse(JSON.stringify(state.selected.record.technicalReview?.technicalPackage || { documents: (state.selected.record.technicalFiles || []).map((file, i) => ({ documentId: file.documentId || 'DOC-' + String(i + 1).padStart(3, '0'), name: file.name, documentType: 'UNKNOWN', role: 'UNRESOLVED', applicability: 'SUPPORTING_REFERENCE', subassemblyPartNumber: null })), governingBomDocumentId: null }));
  }
  function enterPackage() { state.materials = false; state.step = 'inventory'; state.message = ''; state.messageState = ''; renderDetail(); }
  function progress(current) { return '<div class="technical-review-question-progress">History ✓ → ' + ['Package Inventory', 'BOM Review', 'Subassemblies'].map(label => label === current ? '<strong>' + label + '</strong>' : label).join(' → ') + '</div>'; }
  function packageSelect(label, field, options, value) { return '<label>' + label + '<select aria-label="' + label + '" data-package-field="' + field + '" ' + (state.saving ? 'disabled' : '') + '>' + Object.entries(options).map(([key, text]) => '<option value="' + key + '" ' + (key === value ? 'selected' : '') + '>' + text + '</option>').join('') + '</select></label>'; }
  function renderInventory() {
    const pack = packageDraft(), docs = pack.documents, index = Math.min(state.documentIndex || 0, Math.max(0, docs.length - 1)), doc = docs[index];
    const unknown = docs.filter(d => d.documentType === 'UNKNOWN');
    let content = '<p>' + docs.length + ' received files · ' + unknown.length + ' unclassified · ' + docs.filter(d => d.role === 'UNRESOLVED').length + ' unresolved roles</p>';
    if (unknown.length) content += '<p class="technical-review-inline-note">Unclassified: ' + unknown.map(d => escapeHtml(d.name)).join(' · ') + '</p>';
    if (doc) content += '<nav class="technical-review-package-files" aria-label="Received files">' + docs.map((d, i) => '<button type="button" data-package-index="' + i + '" aria-current="' + (i === index ? 'step' : 'false') + '" ' + (state.saving ? 'disabled' : '') + '>' + (i + 1) + '. ' + escapeHtml(d.name) + (d.documentType === 'UNKNOWN' ? ' · Unclassified' : '') + '</button>').join('') + '</nav><h4>File ' + (index + 1) + ' of ' + docs.length + ' · ' + escapeHtml(doc.name) + '</h4><div class="technical-review-package-fields">' + packageSelect('Document type', 'documentType', documentTypes, doc.documentType) + packageSelect('Document role', 'role', documentRoles, doc.role) + packageSelect('Applies to', 'applicability', applicability, doc.applicability) + (doc.documentType === 'ASSEMBLY_DRAWING' ? '<label class="technical-review-embedded-bom"><span><input type="checkbox" data-package-field="embeddedBom" ' + (doc.embeddedBom ? 'checked' : '') + (state.saving ? ' disabled' : '') + '> BOM embedded in this document</span></label>' : '') + (doc.applicability === 'SUBASSEMBLY' ? '<label>Subassembly part number (leave blank if unresolved)<input data-package-field="subassemblyPartNumber" value="' + escapeHtml(doc.subassemblyPartNumber) + '" maxlength="120"></label>' : '') + '</div>';
    if (doc) {
      const source = state.selected.record.technicalFiles.find(file => file.documentId === doc.documentId);
      content += source?.binaryStatus === 'VERIFIED' ? '<p><a class="technical-review-secondary" target="' + (source.type === 'application/pdf' ? '_blank' : '_self') + '" rel="noopener noreferrer" href="' + ('/api/sim/rfq-intakes/' + encodeURIComponent(state.selected.record.intakeId) + '/documents/' + encodeURIComponent(source.documentId)) + '">View File</a> · Verified SIM copy' + (source.type === 'application/pdf' ? ' · PDF opens in browser · <a href="/api/sim/rfq-intakes/' + encodeURIComponent(state.selected.record.intakeId) + '/documents/' + encodeURIComponent(source.documentId) + '?download=true">Download PDF</a>' : ' · Download original file') + '</p>' : '<p>File content is unavailable for this metadata-only intake.</p>';
    }
    else content += '<p>No technical files were received. A governing BOM cannot be selected yet.</p>';
    return '<section class="technical-review-question">' + progress('Package Inventory') + '<h3>Account for the technical package</h3><p>Classify each file and what it applies to. Roles may remain unresolved. Select the governing parent BOM in the next step.</p>' + content + '<button type="button" class="technical-review-primary" data-technical-review-action="save-package" ' + (state.saving ? 'disabled' : '') + '>Save inventory and continue</button>' + packageMessage() + '<button class="technical-review-back" data-technical-review-action="history-back">← Back to assembly history</button></section>';
  }
  function packageMessage() { return '<p role="status" class="technical-review-message" data-state="' + escapeHtml(state.messageState) + '">' + escapeHtml(state.message) + '</p>'; }
  function renderGoverning() {
    const pack = packageDraft();
    const candidates = pack.documents.filter(d => isBomSource(d) && d.applicability === 'PARENT_ASSEMBLY');
    return '<section class="technical-review-question">' + progress('BOM Review') + '<h3>Which BOM governs the parent assembly for this RFQ?</h3><p>Select explicitly. Other BOMs keep their referenced, supporting or unresolved roles.</p>' + (candidates.length ? candidates.map(d => '<label class="technical-review-bom-option"><input type="radio" name="governingBom" data-governing-id="' + d.documentId + '" ' + (pack.governingBomDocumentId === d.documentId ? 'checked' : '') + '> ' + escapeHtml(d.name) + ' — ' + bomSourceLabel(d) + (pack.governingBomDocumentId === d.documentId ? ' · Governing BOM source' : '') + '</label>').join('') : '<p>No parent BOM is classified yet. Return to the inventory to identify one.</p>') + '<label class="technical-review-bom-option"><input type="radio" name="governingBom" data-governing-id="" ' + (!pack.governingBomDocumentId ? 'checked' : '') + '> Unresolved — no governing BOM selected</label><p>Other package documents: ' + pack.documents.filter(d => !candidates.includes(d)).map(d => escapeHtml(d.name) + ' (' + documentRoles[d.role] + ')').join(' · ') + '</p><button class="technical-review-primary" data-technical-review-action="compare-package" ' + (state.saving ? 'disabled' : '') + '>' + (pack.governingBomDocumentId ? 'Save selection and compare BOM' : 'Save as unresolved') + '</button>' + (pack.governingBomDocumentId ? '<p><button class="technical-review-primary" data-technical-review-action="candidate-from-source" ' + (state.saving ? 'disabled' : '') + '>Save selection and build Candidate BOM</button></p>' : '') + packageMessage() + '<button class="technical-review-back" data-technical-review-action="package-back">← Back to package inventory</button></section>';
  }
  async function savePackage(compare) {
    if (state.saving) return;
    state.saving = true; state.message = ''; state.messageState = ''; renderDetail();
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/technical-package', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(packageDraft()) });
      state.packageDraft = null; state.step = 'governing';
      state.message = compare ? 'Governing BOM remains unresolved. Inventory saved.' : 'Package inventory saved.';
    } catch (error) { state.message = error.message; state.messageState = 'error'; }
    finally { state.saving = false; renderDetail(); }
    if (compare && state.messageState !== 'error' && packageDraft().governingBomDocumentId) await reviewMaterials();
  }
  function renderCoverage(record) {
    const pack = record.technicalReview.technicalPackage;
    const rows = record.technicalReview.subassemblyCoverage || [];
    return '<section class="technical-review-question">' + progress('Subassemblies') + '<h3>Have we accounted for every subassembly?</h3><div class="technical-review-subassemblies">' + rows.map(row => '<div><strong>' + escapeHtml(row.partNumber) + ' · Qty ' + row.quantityPerAssembly + ' per parent</strong><p>Known history/package: ' + escapeHtml(row.knownReference || 'None found') + '</p><p>Current customer documents: ' + (row.customerDocumentIds.length ? row.customerDocumentIds.map(id => { const doc = pack.documents.find(d => d.documentId === id); return escapeHtml(doc?.name || id) + ' (' + escapeHtml(documentRoles[doc?.role] || 'Unresolved') + ')'; }).join(' · ') : 'None classified for this subassembly') + '</p><strong>' + (row.coverageState === 'COVERED' ? 'Covered / reference found' : 'Missing / unresolved — technical reference required') + '</strong></div>').join('') + (rows.length ? '' : '<p>No subassemblies identified in the governing BOM.</p>') + '</div><p>Coverage is saved with the comparison. Document associations are reviewer classifications; contents have not been validated.</p><p class="technical-review-inline-note">Material-side review stops here. Manufacturing Definition is not implemented. The RFQ remains active and is not qualified.</p><button class="technical-review-back" data-technical-review-action="materials">← Back to BOM comparison</button></section>';
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
    state.acceptedVersion = null;
    if (state.saving) return;
    state.guided = false;
    state.materials = false; state.step = ""; state.packageDraft = null; state.documentIndex = 0;
    state.closing = false;
    state.analysisJob = null; state.analysisError = ''; state.candidateIndex = null;
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
      void pollAnalysis(intakeId, false);
    } catch (error) {
      state.error = error?.message || "The RFQ Review could not be opened.";
      setStatus("Unable to open review", "error");
    }
  }

  function showQueue() {
    clearTimeout(analysisPoll); clearInterval(analysisClock);
    state.analysisJob = null; state.analysisError = '';
    state.guided = false;
    mount?.classList.remove("technical-review-guided");
    state.selected = null;
    state.closing = false;
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
    const canDisposition = window.DleOsCapabilities?.can?.("technical_review.disposition") === true;
    if (!host) return;
    mount?.classList.toggle("technical-review-guided", state.guided);
    host.innerHTML = '<div class="technical-review-context"><div><p class="technical-review-eyebrow">RFQ Review · ' + escapeHtml(record.intakeId) + '</p>' +
      '<h2 id="technicalReviewDetailTitle" tabindex="-1">' + escapeHtml(record.customer?.customerName || "Customer") + '</h2>' +
      '<p>' + escapeHtml(assembly.assemblyNumber) + ' · Rev ' + escapeHtml(assembly.revision) + ' · Qty ' + escapeHtml(assembly.quantity) + '</p></div>' +
      '<span class="technical-review-status-pill">' + escapeHtml(envelope.reviewStatusLabel) + '</span></div>' +
      '<div id="technicalReviewAnalysisProgress">' + renderAnalysisProgress() + '</div>' +
      (state.guided ? (state.step === 'labor-first' ? renderLaborFirstEntry(record) : state.step === 'manufacturing' ? renderManufacturingHandoff(record) : state.step === 'accepted-bom' ? renderAcceptedBom(record) : state.step === 'candidate' ? renderCandidate(record) : state.materials ? renderMaterials(record) : state.step === 'inventory' ? renderInventory() : state.step === 'governing' ? renderGoverning() : state.step === 'coverage' ? renderCoverage(record) : renderHistoryQuestion(record, canDisposition)) : renderEntryActions(record, canDisposition));
  }

  function renderHistoryQuestion(record, canDisposition) {
    const history = record.technicalReview?.assemblyHistory;
    const confirmed = !!history?.assemblyClassification;
    const disabled = state.saving || !canDisposition ? "disabled" : "";
    let result = '<p class="technical-review-searching" role="status">Searching SIM assembly history…</p>';
    if (history) {
      result = '<div class="technical-review-history-result"><p class="technical-review-eyebrow">' + (history.historyFound ? 'History found' : 'No previous DLE build history found') + '</p>';
      if (history.historyFound) {
        result += '<div class="technical-review-history-facts"><div><small>Previously built revisions</small><strong>' + history.revisionsFound.map(rev => 'Rev ' + escapeHtml(rev)).join(' · ') + '</strong></div>' +
          '<div><small>Most recent revision built</small><strong>Rev ' + escapeHtml(history.mostRecentRevision) + '</strong></div></div>' +
          '<ul class="technical-review-builds">' + history.records.map(row => '<li><strong>Rev ' + escapeHtml(row.revision) + '</strong><span>' + escapeHtml(row.builtAt) + ' · Qty ' + escapeHtml(row.quantity) + '</span><small>' + escapeHtml(row.recordId) + '</small></li>').join('') + '</ul>';
      } else result += '<p>This assembly has no matching records in the synthetic SIM history source.</p>';
      result += '<p class="technical-review-source">SIM synthetic build history · ' + history.records.length + ' build records</p></div>';
      if (confirmed) result += '<div class="technical-review-question-complete" role="status"><strong>' + (history.assemblyClassification === 'EXISTING_ASSEMBLY' ? 'Existing Assembly — History Found' : 'New Assembly') + '</strong><p>Assembly determination saved. The item remains active.</p></div>' + (materialsEligible(record) ? '<button type="button" class="technical-review-primary" data-technical-review-action="package" ' + disabled + '>Continue to Technical Package Inventory</button>' : '<p>This is the end of the current guided review for this assembly/revision.</p>');
      else result += '<button type="button" class="technical-review-primary" data-technical-review-action="confirm-history" ' + disabled + '>' + (history.historyFound ? 'Existing Assembly — History Found' : 'New Assembly') + '</button>';
    } else if (!state.saving && state.messageState === 'error') {
      result = '<button type="button" class="technical-review-secondary" data-technical-review-action="retry-history">Retry history lookup</button>';
    }
    return '<section class="technical-review-question" aria-labelledby="technicalReviewQuestion"><div class="technical-review-question-progress">Question 1 · Assembly history' + (confirmed ? ' · Complete' : '') + '</div>' +
      '<h3 id="technicalReviewQuestion" tabindex="-1">Have we built this assembly before?</h3><p class="technical-review-question-intro">We check the selected customer and assembly against DLE build history.</p>' + result +
      '<p class="technical-review-message" data-state="' + escapeHtml(state.messageState) + '" role="status">' + escapeHtml(state.message) + '</p>' +
      '<button type="button" class="technical-review-back" data-technical-review-action="review-back" ' + (state.saving ? 'disabled' : '') + '>← Back to review choices</button></section>';
  }

  async function updateHistory(confirm) {
    if (state.saving || !state.selected?.record?.intakeId) return;
    const record = state.selected.record;
    const history = record.technicalReview?.assemblyHistory;
    if (confirm && !history) return;
    state.saving = true;
    state.message = confirm ? "Saving assembly determination…" : "";
    state.messageState = "";
    renderDetail();
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(record.intakeId) + (confirm ? '/assembly-classification' : '/assembly-history'), {
        method: confirm ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        ...(confirm ? { body: JSON.stringify({ assemblyClassification: history.historyFound ? 'EXISTING_ASSEMBLY' : 'NEW_ASSEMBLY' }) } : {})
      });
      state.message = "";
    } catch (error) {
      state.message = error?.message || "The history lookup could not be completed. Please retry.";
      state.messageState = "error";
    } finally {
      state.saving = false;
      renderDetail();
    }
    if (confirm && state.messageState !== "error" && materialsEligible(state.selected?.record)) enterPackage();
  }

  function materialsEligible(record) {
    const history = record?.technicalReview?.assemblyHistory;
    const revision = String(record?.assemblies?.[0]?.revision || "").trim().toUpperCase();
    return history?.assemblyClassification === 'EXISTING_ASSEMBLY' && history.revisionsFound.some(value => value.toUpperCase() === revision);
  }

  async function reviewMaterials() {
    if (state.saving || !materialsEligible(state.selected?.record)) return;
    state.materials = true;
    state.step = '';
    state.message = "";
    state.messageState = "";
    if (state.selected.record.technicalReview.materialsDefinition) { renderDetail(); return; }
    state.saving = true;
    renderDetail();
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/materials-definition', { method: 'POST' });
    } catch (error) {
      state.message = error?.message || 'Materials comparison is unavailable.';
      state.messageState = 'error';
    } finally { state.saving = false; renderDetail(); }
  }

  function renderMaterials(record) {
    const result = record.technicalReview?.materialsDefinition;
    const assembly = record.assemblies?.[0] || {};
    let content = '<p role="status">Identifying the current customer BOM and prior-build BOM…</p>';
    if (result) {
      const labels = { LOOKS_CONSISTENT: 'Material Definition — Looks Consistent', DIFFERENCES_FOUND: 'Material Definition — Differences Found', NEEDS_INFORMATION: 'Material Definition — Information Needed' };
      const bom = (label, value) => '<div class="technical-review-bom-source"><small>' + label + '</small><strong>' + (value ? escapeHtml(value.assemblyNumber) + ' · Rev ' + escapeHtml(value.revision) : 'Not identified') + '</strong><span>' + (value ? escapeHtml(value.reference) : 'A single BOM must be identified in the customer package.') + '</span></div>';
      content = '<div class="technical-review-bom-sources">' + bom('Current customer BOM · ' + (result.currentBom?.sourceKind === 'EMBEDDED_IN_ASSEMBLY_DRAWING' ? 'BOM embedded in Assembly Drawing' : 'Standalone BOM'), result.currentBom) + bom('Prior DLE build BOM', result.priorBom) + '</div>';
      content += '<div class="technical-review-material-result" data-result="' + escapeHtml(result.result) + '" role="status"><h4>' + escapeHtml(labels[result.result] || result.result) + '</h4>';
      if (result.comparisonCompleted) {
        content += '<p>Parent assembly ' + (result.parentAssemblyMatch ? 'matches' : 'differs') + ' · Revision ' + (result.revisionMatch ? 'matches' : 'differs') + '</p><p>' + result.currentLineCount + ' current / ' + result.priorLineCount + ' prior BOM lines · ' + result.unchangedParts.length + ' unchanged · ' + result.addedParts.length + ' added · ' + result.removedParts.length + ' removed · ' + result.quantityChanges.length + ' quantity changes</p>';
        content += '<p>Current parts: ' + (result.currentBom.lines || []).map(line => escapeHtml(line.partNumber)).join(' · ') + '</p>';
        const facts = [...result.addedParts.map(part => 'Added: ' + part), ...result.removedParts.map(part => 'Removed: ' + part), ...result.quantityChanges.map(line => line.partNumber + ': qty ' + line.priorQuantity + ' → ' + line.currentQuantity + ' per assembly')];
        if (facts.length) content += '<ul>' + facts.map(text => '<li>' + escapeHtml(text) + '</li>').join('') + '</ul>';
      } else content += '<p>Comparison is incomplete. The current BOM was not unambiguously identified.</p>';
      content += '</div>';
      content += '<button class="technical-review-primary" data-technical-review-action="coverage">Continue to Subassembly Coverage</button><p class="technical-review-source">Synthetic SIM BOM comparison · uploaded file contents are not parsed.</p><p class="technical-review-inline-note">Materials Definition saved. Continue to check subassembly coverage. The RFQ remains active and is not qualified.</p>';
    } else if (!state.saving && state.messageState === 'error') content = '<button type="button" class="technical-review-secondary" data-technical-review-action="materials">Retry materials review</button>';
    const candidateAction = '<p><button class="technical-review-primary" data-technical-review-action="candidate" ' + (state.saving ? 'disabled' : '') + '>' + (record.technicalReview?.candidateBom ? 'Resume Candidate BOM — Pilot' : 'Build Candidate BOM') + '</button></p><p>Extract up to 10 rows from the staged governing PDF, page 2. Candidate only; human review required.</p>';
    return '<section class="technical-review-question" aria-labelledby="technicalReviewMaterials"><div class="technical-review-question-progress">History ✓ → Package Inventory ✓ → BOM Review → Subassemblies</div><h3 id="technicalReviewMaterials">Let’s review the BOM ' + escapeHtml(record.customer?.customerName) + ' provided for this Rev ' + escapeHtml(assembly.revision) + ' request.</h3>' + candidateAction + content +
      '<p class="technical-review-message" data-state="' + escapeHtml(state.messageState) + '" role="status">' + escapeHtml(state.message) + '</p><button type="button" class="technical-review-back" data-technical-review-action="governing-back" ' + (state.saving ? 'disabled' : '') + '>← Back to governing BOM selection</button></section>';
  }

  async function buildCandidate() {
    if (state.saving) return;
    const intakeId = state.selected.record.intakeId;
    state.saving = true; state.message = 'Preparing analysis…'; state.messageState = ''; renderDetail();
    try {
      state.analysisJob = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(intakeId) + '/analysis-jobs', { method: 'POST' });
      state.analysisError = ''; startAnalysisClock();
      state.message = '';
      void pollAnalysis(intakeId, true);
    } catch (error) { state.message = error?.message || 'Candidate extraction unavailable.'; state.messageState = 'error'; }
    finally { state.saving = false; renderDetail(); document.getElementById('technicalReviewAnalysisProgress')?.scrollIntoView?.({block:'center'}); }
  }

  let analysisPoll, analysisClock;
  function analysisProgress(job, now = Date.now()) {
    const labels = { QUEUED: 'Preparing analysis', RUNNING: 'Analyzing governing BOM', VALIDATING: 'Validating result and saving Candidate BOM', SUCCEEDED: 'Candidate BOM ready', FAILED: 'Analysis failed', TIMED_OUT: 'Analysis timed out', CANCELLED: 'Analysis cancelled', STALE: 'Analysis source changed' };
    const active = ['QUEUED', 'RUNNING', 'VALIDATING'].includes(job.status);
    const start = Date.parse(job.input?.requestedAtUtc);
    const deadline = Date.parse(job.input?.deadlineUtc);
    const expired = active && Number.isFinite(deadline) && now >= deadline;
    const end = active ? (expired ? deadline : now) : Date.parse(job.updatedAtUtc);
    const seconds = Math.max(0, Math.floor((end - start) / 1000)) || 0;
    return { active, expired, label: expired ? 'Analysis deadline reached' : labels[job.status] || 'Analysis status unavailable',
      elapsed: String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0') };
  }
  function renderAnalysisProgress() {
    const job = state.analysisJob;
    if (!job) return '';
    const progress = analysisProgress(job);
    const running = progress.active && !progress.expired && !state.analysisError;
    const message = state.analysisError || (progress.expired ? 'The configured deadline has elapsed. Checking the final job status; analysis is not shown as still running.' : running ? 'Analysis is running in the background. You can leave this review and return later.' : job.message || 'Candidate only; human review is required.');
    const retry = ['FAILED', 'TIMED_OUT', 'CANCELLED', 'STALE'].includes(job.status);
    return '<section class="technical-review-analysis-progress" aria-label="Analysis progress"><p><span class="analysis-activity ' + (running ? 'is-running' : '') + '" aria-hidden="true"></span><strong>' + escapeHtml(state.analysisError ? 'Analysis status unavailable' : progress.label) + '</strong> · <span aria-label="Elapsed time">' + progress.elapsed + '</span>' + (running ? ' <span class="analysis-running-label">Running</span>' : '') + '</p><p>' + escapeHtml(message) + '</p>' +
      (retry ? '<button class="technical-review-secondary" data-technical-review-action="analysis-retry" ' + (state.saving ? 'disabled' : '') + '>Retry analysis</button>' : '') + '</section>';
  }
  function updateAnalysisProgress() {
    const host = document.getElementById('technicalReviewAnalysisProgress');
    if (host) host.innerHTML = renderAnalysisProgress();
  }
  function startAnalysisClock() {
    clearInterval(analysisClock);
    analysisClock = setInterval(updateAnalysisProgress, 1000);
  }
  async function pollAnalysis(intakeId, followResult) {
    clearTimeout(analysisPoll);
    try {
      const response = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(intakeId) + '/analysis-jobs/latest');
      if (state.selected?.record?.intakeId !== intakeId || !response.job) return;
      const job = response.job;
      state.analysisJob = job; state.analysisError = ''; updateAnalysisProgress();
      const messages = { QUEUED: 'Preparing analysis…', RUNNING: 'Analyzing governing BOM…', VALIDATING: 'Validating result…' };
      if (messages[job.status]) {
        startAnalysisClock();
        analysisPoll = setTimeout(() => void pollAnalysis(intakeId, true), 1500);
      } else if (job.status === 'SUCCEEDED' && followResult) {
        const selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(intakeId));
        if (state.selected?.record?.intakeId !== intakeId) return;
        clearInterval(analysisClock);
        state.selected = selected; state.candidateDraft = null; state.candidateIndex = null;
        state.guided = true; state.step = 'candidate'; state.materials = false;
        state.message = 'Candidate BOM ready for review'; state.messageState = ''; renderDetail();
      } else if (job.status !== 'SUCCEEDED') {
        clearInterval(analysisClock);
        state.message = job.message || 'Analysis did not finish. Use Build Candidate BOM to retry.';
        state.messageState = 'error'; renderDetail();
      } else { clearInterval(analysisClock); updateAnalysisProgress(); }
    } catch (error) {
      if (state.selected?.record?.intakeId === intakeId) { clearInterval(analysisClock); state.analysisError = 'Unable to check the job. Reopen this review to reconnect; no new job has been submitted.'; updateAnalysisProgress(); }
    }
  }

  function analysisEvidence(field) {
    if (!field) return '';
    const source = field.evidence;
    const supporting = field.supportingEvidence;
    return '<small>Evidence: ' + escapeHtml(source.documentId) + ' · page ' + escapeHtml(source.page || '—') + ' · ' + escapeHtml(source.location) + (source.sheet ? ' · sheet ' + escapeHtml(source.sheet) : '') +
      '</small><small>Uncertainty: ' + escapeHtml(field.uncertainty || 'None reported; human review still required') +
      '</small><small>Supporting: ' + escapeHtml(field.supportingValue ?? '—') + (supporting ? ' · ' + escapeHtml(supporting.documentId) + ' · ' + escapeHtml(supporting.location) + (supporting.page ? ' · page ' + escapeHtml(supporting.page) : '') + (supporting.sheet ? ' · sheet ' + escapeHtml(supporting.sheet) : '') : '') + '</small>';
  }

  const candidateFields = { lineNumber: 'BOM line number', partNumber: 'Part number', quantity: 'Quantity per assembly', designators: 'Designator(s)', description: 'Description' };
  const componentTypes = {STANDARD_COTS:'Standard / COTS',SUBASSEMBLY:'Subassembly',REFERENCE_ONLY:'Reference Only',OTHER:'Other'};
  function componentSelect(row, index) {
    const value = componentTypes[row.componentType] ? row.componentType : 'STANDARD_COTS';
    return '<select class="candidate-component-type" aria-label="Component Type for row ' + (index + 1) + '" data-component-row="' + index + '" ' + (state.saving ? 'disabled' : '') + '>' + Object.entries(componentTypes).map(([key,label]) => '<option value="' + key + '" ' + (key === value ? 'selected' : '') + '>' + label + '</option>').join('') + '</select>';
  }
  async function saveComponentType(control) {
    const rowIndex = Number(control.dataset.componentRow);
    const bom = state.selected.record.technicalReview.candidateBom;
    const row = bom.rows[rowIndex];
    const componentChange = {componentType:control.value,expectedRevision:row.componentTypeRevision || 0};
    // Preserve any unsaved row-detail inputs while refreshing the saved table status.
    const drafts = Array.from(document.querySelectorAll('.candidate-detail-row input, .candidate-detail-row select')).map(input => [input.id,input.value]);
    state.saving = true; control.disabled = true;
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/candidate-bom', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex,componentChange})});
      state.message = 'Component Type saved.'; state.messageState = '';
    } catch (error) { state.message = error?.message || 'Component Type could not be saved.'; state.messageState = 'error'; }
    finally {
      state.saving = false; renderDetail();
      for (const [id,value] of drafts) { const input = document.getElementById(id); if (input) input.value = value; }
    }
  }
  function candidateStatus(row) {
    if ((row.alternates || []).some(a => !a.removedAtUtc && a.reviewStatus !== 'CONFIRMED')) return 'Uncertain';
    if ((row.alternates || []).some(a => a.history?.length)) return 'Manually Corrected';
    if (row.corrections?.length) return 'Manually Corrected';
    if (row.confirmed) return 'Reviewed';
    const comparisons = Object.keys(candidateFields).map(key => row.comparison?.[key]);
    if (comparisons.includes('CONFLICT')) return 'Conflict';
    const uncertain = Object.values(row.analysisFields || {}).some(field => field.uncertainty?.trim() && !/^none[.!]?$/i.test(field.uncertainty.trim()));
    return comparisons.every(value => value === 'MATCH') && !uncertain ? 'Match' : 'Uncertain';
  }
  function renderCandidate(record) {
    const accepted = (record.technicalReview.bomAcceptances || []).find(a => state.acceptedVersion ? a.version === state.acceptedVersion : a.candidate.id === record.technicalReview.candidateBom?.id);
    const bom = accepted?.candidate || record.technicalReview.candidateBom;
    const counts = { Match: 0, Conflict: 0, Uncertain: 0, Reviewed: 0, 'Manually Corrected': 0 };
    bom.rows.forEach(row => counts[candidateStatus(row)]++);
    const fileUrl = '/api/sim/rfq-intakes/' + encodeURIComponent(record.intakeId) + '/documents/' + encodeURIComponent(bom.governingDocumentId) + '#page=' + bom.page;
    const rows = bom.rows.map((row, index) => {
      const status = candidateStatus(row);
      const expanded = state.candidateIndex === index;
      const conflict = status !== 'Conflict' && Object.values(row.comparison || {}).includes('CONFLICT');
      return '<tr><td>' + escapeHtml(row.values.lineNumber || '—') + '</td><td class="candidate-part">' + escapeHtml(row.values.partNumber || '—') + '</td><td>' + alternateSummary(row) + '</td><td>' + escapeHtml(row.values.quantity || '—') + '</td><td>' + escapeHtml(componentTypes[row.componentType] || componentTypes.STANDARD_COTS) + '</td><td>' + escapeHtml(row.values.designators || '—') + '</td><td>' + escapeHtml(row.values.description || '—') + '</td><td><span class="candidate-status" data-status="' + status + '">' + status + '</span>' + (conflict ? '<small>Source conflict retained</small>' : '') + '<button class="candidate-details-button" data-technical-review-action="candidate-detail" data-candidate-row="' + index + '" aria-expanded="' + expanded + '" aria-controls="candidate-detail-' + index + '" ' + (state.saving ? 'disabled' : '') + '>' + (expanded ? 'Close Details' : accepted ? 'View Details' : 'Edit / Add Details') + '<span class="candidate-sr-only"> for row ' + (index + 1) + '</span></button></td></tr>' +
        (expanded ? '<tr class="candidate-detail-row"><td colspan="8"><section id="candidate-detail-' + index + '" aria-label="Row ' + (index + 1) + ' details">' + renderCandidateRow(bom, row, index, !!accepted) + '</section></td></tr>' : '');
    }).join('');
    return '<section class="technical-review-question technical-review-candidate"><h3>' + (accepted ? 'BOM Review Complete' : 'Candidate BOM — Pilot') + '</h3>' + (accepted ? '<p>Materials definition qualified for this RFQ. Accepted version ' + accepted.version + '.</p>' + (record.technicalReview.materialsReviewStatus === 'QUALIFIED' ? '<p>Next: Manufacturing / Labor Review</p>' : '<p>Historical acceptance. The current source package or candidate requires a new BOM review.</p>') : '') + '<p class="candidate-summary">' + bom.rows.length + ' rows extracted · ' + counts.Match + ' matched · ' + counts.Conflict + ' conflict · ' + counts.Uncertain + ' uncertain · ' + counts['Manually Corrected'] + ' manually corrected' + (counts.Reviewed ? ' · ' + counts.Reviewed + ' reviewed' : '') + '</p>' +
      (accepted ? '<p>RFQ materials acceptance only. This is not a production release.</p>' : '<p class="candidate-review-note">Partial / pilot · Needs Review · Not an approved DLE BOM. Review source conflicts and uncertain rows before proceeding.</p>') + '<a href="' + fileUrl + '" target="_blank" rel="noopener">View governing PDF · page ' + bom.page + '</a>' +
      '<div class="candidate-table-scroll" role="region" aria-label="Candidate BOM table" tabindex="0"><table class="candidate-table"><caption class="candidate-sr-only">Candidate BOM rows for human review</caption><thead><tr><th scope="col">Line</th><th scope="col">Part Number</th><th scope="col">Alternate Part(s)</th><th scope="col">Qty / Assy</th><th scope="col">Component Type</th><th scope="col">Designators</th><th scope="col">Description</th><th scope="col">Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="technical-review-message" role="status">' + escapeHtml(state.message) + '</p><details class="candidate-analysis-details"><summary>Analysis scope and history</summary><p>' + escapeHtml(bom.analysis?.coverageReason || bom.supportingComparison) + '</p><p>' + (record.technicalReview.candidateBomVersions || []).length + ' prior versions preserved. No canonical BOM or downstream work is created.</p></details>' + acceptedLinks(record) + '<div class="candidate-editor-actions"><button class="technical-review-back" data-technical-review-action="governing-back">← Back to governing BOM selection</button>' + (!accepted ? '<button class="technical-review-primary" data-technical-review-action="complete-bom" ' + (state.saving ? 'disabled' : '') + '>Complete BOM Review</button>' : '') + '</div></section>';
  }
  function renderCandidateRow(bom, row, index, readOnly = false) {
    const disabled = state.saving ? 'disabled' : '';
    const content = '<div class="candidate-editor-heading"><h4>Row ' + (index + 1) + ' · Edit / Add Details</h4></div><div class="candidate-edit-grid"><label class="technical-review-candidate-field">Component Type' + componentSelect(row, index) + '</label>' + Object.entries(candidateFields).map(([key, label]) => '<label class="technical-review-candidate-field candidate-field-' + key + '">' + ({lineNumber:'Line',partNumber:'Part Number',quantity:'Qty / Assy',designators:'Designators',description:'Description'}[key]) + '<input id="candidate-' + key + '" value="' + escapeHtml((state.candidateDraft || row.values)[key]) + '" maxlength="2000" ' + disabled + '></label>').join('') + '</div>' + renderAlternates(row) + '<div class="candidate-editor-actions"><button class="technical-review-primary" data-technical-review-action="candidate-confirm" ' + disabled + '>Save Changes</button><button data-technical-review-action="candidate-detail" data-candidate-row="' + index + '" ' + disabled + '>Close</button><small>Component Type saves automatically. Save alternates individually.</small></div>' +
      '<details class="candidate-evidence"><summary>Source / History</summary>' + (row.reviewer ? '<p>Reviewed by ' + escapeHtml(row.reviewer) + ' · ' + escapeHtml(row.reviewedAtUtc) + '</p>' : '') + renderAlternates(row, true) + Object.entries(candidateFields).map(([key, label]) => '<div class="candidate-evidence-field"><strong>' + label + '</strong><p>Governing extracted value: ' + escapeHtml(row.extracted[key] || '—') + ' · Supporting relationship: ' + escapeHtml(row.comparison[key]) + '</p>' + analysisEvidence(row.analysisFields?.[key]) + '</div>').join('') +
      '<p>Governing document: ' + escapeHtml(bom.governingDocumentId) + ' · Page ' + bom.page + ' · Bounds: ' + escapeHtml((row.bounds || []).join(', ')) + '</p><p>SHA-256: ' + escapeHtml(bom.governingSha256) + '</p>' + row.corrections.map(c => '<p>' + escapeHtml(candidateFields[c.field] || (c.field === 'componentType' ? 'Component Type' : c.field)) + ': ' + escapeHtml(c.previous) + ' → ' + escapeHtml(c.value) + ' · ' + escapeHtml(c.reviewer) + ' · ' + escapeHtml(c.atUtc) + '</p>').join('') + '</details>';
    return readOnly ? content.slice(content.indexOf('<details class="candidate-evidence">')) : content;
  }

  function renderAcceptedBom(record) {
    const acceptance = (record.technicalReview?.bomAcceptances || []).find(a => Number(a.version) === state.acceptedVersion);
    const back = '<button type="button" class="technical-review-back" data-technical-review-action="accepted-back">← Back to Technical Review</button>';
    if (!acceptance?.candidate) return '<section class="technical-review-question"><h3 id="acceptedBomTitle" tabindex="-1">Accepted BOM unavailable</h3><p role="alert">The selected accepted version was not found. Return to Technical Review and reopen the saved version.</p>' + back + '</section>';
    const bom = acceptance.candidate;
    const title = 'Accepted BOM Version ' + acceptance.version;
    const rows = bom.rows.map((row, index) => {
      const values = row.values;
      const status = candidateStatus(row);
      const alternates = (row.alternates || []).filter(a => !a.removedAtUtc).map(a => escapeHtml(a.partNumber)).join('<br>') || '—';
      return '<tr><td>' + escapeHtml(values.lineNumber || '—') + '</td><td class="candidate-part">' + escapeHtml(values.partNumber || '—') + '</td><td>' + alternates + '</td><td>' + escapeHtml(values.quantity || '—') + '</td><td>' + escapeHtml(componentTypes[row.componentType] || componentTypes.STANDARD_COTS) + '</td><td>' + escapeHtml(values.designators || '—') + '</td><td>' + escapeHtml(values.description || '—') + '</td><td><span class="candidate-status" data-status="' + status + '">' + status + '</span></td></tr>' +
        '<tr class="candidate-detail-row"><td colspan="8">' + renderCandidateRow(bom, row, index, true) + '</td></tr>';
    }).join('');
    return '<section class="technical-review-question technical-review-candidate" aria-labelledby="acceptedBomTitle"><h3 id="acceptedBomTitle" tabindex="-1">' + escapeHtml(title) + '</h3>' +
      '<p>BOM Review Complete · Read-only snapshot</p><p>Accepted by ' + escapeHtml(acceptance.reviewedBy || 'Not recorded') + ' · <time datetime="' + escapeHtml(acceptance.reviewedAtUtc) + '">' + escapeHtml(new Date(acceptance.reviewedAtUtc).toLocaleString()) + '</time></p>' +
      '<p>This is the BOM accepted at that time. Later Candidate BOM changes do not change this version.</p>' + back +
      '<div class="candidate-table-scroll" role="region" aria-label="' + escapeHtml(title) + '" tabindex="0"><table class="candidate-table"><caption class="candidate-sr-only">' + escapeHtml(title) + ' · immutable accepted rows</caption><thead><tr><th scope="col">Line</th><th scope="col">Part Number</th><th scope="col">Alternate Part(s)</th><th scope="col">Qty / Assy</th><th scope="col">Component Type</th><th scope="col">Designators</th><th scope="col">Description</th><th scope="col">Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<details class="candidate-analysis-details"><summary>Analysis scope and history</summary><p>' + escapeHtml(bom.analysis?.coverageReason || bom.supportingComparison) + '</p></details>' + acceptedLinks(record) + '</section>';
  }

  function acceptedLinks(record) {
    return (record.technicalReview?.bomAcceptances || []).map(a => '<p><button data-technical-review-action="accepted-bom" data-accepted-version="' + a.version + '">View accepted BOM · version ' + a.version + '</button><small> Accepted by ' + escapeHtml(a.reviewedBy) + ' · ' + escapeHtml(new Date(a.reviewedAtUtc).toLocaleString()) + '</small></p>').join('');
  }
  async function completeBom() {
    if (state.saving) return;
    if (state.candidateIndex != null) {
      state.message = 'Save your row and alternate changes, then close the editor before completing BOM Review.';
      const message = document.querySelector('.technical-review-candidate .technical-review-message');
      if (message) message.textContent = state.message;
      return;
    }
    state.saving = true;
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/complete-bom-review', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate:state.selected.record.technicalReview.candidateBom})});
      state.message = 'BOM Review Complete. Materials definition qualified for this RFQ.';
    } catch (error) { state.message = error?.message || 'BOM Review could not be completed.'; }
    finally { state.saving = false; renderDetail(); }
  }

  function alternateSummary(row) {
    const active = (row.alternates || []).filter(a => !a.removedAtUtc);
    return active.length ? escapeHtml(active[0].partNumber) + (active.length > 1 ? ' <small>+' + (active.length - 1) + ' more</small>' : '') : '—';
  }
  function alternateEvidence(evidence) {
    return evidence ? escapeHtml([evidence.documentId, evidence.page ? 'page ' + evidence.page : '', evidence.sheet, evidence.location].filter(Boolean).join(' · ')) : 'Not supplied';
  }
  function renderAlternates(row, historyOnly = false) {
    const disabled = state.saving ? 'disabled' : '';
    const labels = {NEEDS_REVIEW:'Needs Review',CONFIRMED:'Reviewed / Confirmed',UNCERTAIN:'Uncertain'};
    const entries = (row.alternates || []).map(a => {
      const id = escapeHtml(a.id);
      const history = '<details><summary>Alternate evidence and history</summary><p>' + (a.origin === 'MANUAL' ? 'Manually added; no extracted value.' : 'Original extracted value: ' + escapeHtml(a.originalPartNumber || '—')) + '</p><p>Source context: ' + escapeHtml(a.sourceContext || 'Not supplied') + '</p><p>Source: ' + alternateEvidence(a.sourceEvidence) + '</p><p>Supporting: ' + alternateEvidence(a.supportingEvidence) + '</p><p>Approval evidence: ' + alternateEvidence(a.approvalEvidence) + ' — evidence alone is not DLE approval.</p><p>Uncertainty: ' + escapeHtml(a.uncertainty || 'None supplied') + '</p>' + (a.history || []).map(h => '<p>' + escapeHtml(h.action) + ': ' + escapeHtml(h.previous ?? '—') + ' → ' + escapeHtml(h.value ?? '—') + ' · ' + escapeHtml(labels[h.reviewStatus] || h.reviewStatus) + ' · ' + escapeHtml(h.reviewer) + ' · ' + escapeHtml(h.atUtc) + '</p>').join('') + '</details>';
      if (historyOnly) return '<h5>' + (a.removedAtUtc ? 'Removed alternate: ' : 'Alternate: ') + escapeHtml(a.partNumber) + '</h5>' + history;
      if (a.removedAtUtc) return '';
      return '<div class="candidate-alternate"><label>Alternate part number<input id="alternate-number-' + id + '" value="' + escapeHtml(a.partNumber) + '" maxlength="200" ' + disabled + '></label><label>Alternate review state<select id="alternate-status-' + id + '" ' + disabled + '>' + Object.entries(labels).map(([value,label]) => '<option value="' + value + '" ' + (value === a.reviewStatus ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label><button data-technical-review-action="alternate-edit" data-alternate-id="' + id + '" ' + disabled + '>Save alternate</button><button data-technical-review-action="alternate-remove" data-alternate-id="' + id + '" ' + disabled + '>Remove alternate</button></div>';
    }).join('');
    if (historyOnly) return entries;
    return '<section class="candidate-alternates"><h4>Alternate Part(s)</h4>' + entries + '<div class="candidate-alternate-add"><label>New alternate part number<input id="alternate-new" maxlength="200" ' + disabled + '></label><button data-technical-review-action="alternate-add" ' + disabled + '>Add alternate</button></div><small>Reviewing an alternate does not approve its use.</small></section>';
  }
  async function saveAlternate(action, id = null) {
    if (state.saving) return;
    const bom = state.selected.record.technicalReview.candidateBom;
    const rowIndex = state.candidateIndex;
    const row = bom.rows[rowIndex];
    const alternateChange = {action,id,expectedRevision:row.alternateRevision || 0,
      partNumber: action === 'REMOVE' ? null : document.getElementById(action === 'ADD' ? 'alternate-new' : 'alternate-number-' + id).value,
      reviewStatus: action === 'EDIT' ? document.getElementById('alternate-status-' + id).value : 'NEEDS_REVIEW'};
    state.candidateDraft = Object.fromEntries(Object.keys(candidateFields).map(key => [key,document.getElementById('candidate-' + key).value]));
    state.saving = true;
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/candidate-bom', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex,alternateChange})});
      state.message = 'Alternate saved. Candidate only; no engineering approval was granted.';
      state.messageState = '';
      state.saving = false; renderDetail();
    } catch (error) {
      state.message = error?.message || 'Alternate could not be saved.'; state.messageState = 'error';
      // Leave entered values in place when validation/network fails.
      const message = document.querySelector('.technical-review-candidate .technical-review-message');
      if (message) message.textContent = state.message;
    } finally { state.saving = false; }
  }

  async function confirmCandidate() {
    if (state.saving) return;
    const bom = state.selected.record.technicalReview.candidateBom;
    const rowIndex = Math.min(state.candidateIndex || 0, bom.rows.length - 1);
    const values = Object.fromEntries(Object.keys(candidateFields).map(key => [key, document.getElementById('candidate-' + key).value]));
    state.candidateDraft = values;
    state.saving = true; state.message = 'Saving candidate review…'; renderDetail();
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/candidate-bom', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId: bom.id, rowIndex, values }) });
      state.candidateDraft = null; state.candidateIndex = rowIndex; state.message = 'Row saved. Candidate remains separate from the production BOM.';
    } catch (error) { state.message = error?.message || 'Candidate review could not be saved.'; }
    finally { state.saving = false; renderDetail(); }
  }

  function laborFirst(record) {
    return record?.technicalReview?.reviewPhaseOrder?.[0] === 'MANUFACTURING_LABOR_REVIEW';
  }

  function renderLaborFirstEntry(record) {
    const disabled = state.saving || window.DleOsCapabilities?.can?.('technical_review.disposition') !== true ? 'disabled' : '';
    return '<section class="technical-review-question" aria-labelledby="laborFirstTitle"><h3 id="laborFirstTitle" tabindex="-1">Manufacturing / Labor Review</h3>' +
      '<p>First, identify the assembly type. Then continue with the technical package review.</p>' +
      '<label class="technical-review-field" for="technicalReviewAssemblyType"><span>What type of assembly is this?</span><select id="technicalReviewAssemblyType" ' + disabled + '><option value="">Select assembly type</option><option value="PCB_ASSEMBLY" ' + (record.technicalReview?.assemblyType === 'PCB_ASSEMBLY' ? 'selected' : '') + '>PCB Assembly</option></select></label>' +
      '<p><button type="button" class="technical-review-primary" data-technical-review-action="save-assembly-type" ' + disabled + '>Save and continue</button></p>' + packageMessage() +
      '<button type="button" class="technical-review-back" data-technical-review-action="review-back" ' + disabled + '>← Back to Technical Review</button></section>';
  }

  async function saveAssemblyType() {
    if (state.saving || !laborFirst(state.selected?.record) || window.DleOsCapabilities?.can?.('technical_review.disposition') !== true) return;
    const assemblyType = document.getElementById('technicalReviewAssemblyType')?.value;
    if (assemblyType !== 'PCB_ASSEMBLY') { state.message = 'Select PCB Assembly to continue.'; state.messageState = 'error'; renderDetail(); return; }
    state.saving = true; state.message = ''; state.messageState = ''; renderDetail();
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/assembly-type', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assemblyType }) });
    } catch (error) { state.message = error.message; state.messageState = 'error'; }
    finally { state.saving = false; }
    if (state.messageState === 'error') { renderDetail(); return; }
    await resumeGuidedBaseline();
  }

  function renderLaborFirstSummary(record) {
    const review = record.technicalReview;
    const labels = { NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', QUALIFIED: 'Complete' };
    return '<section class="technical-review-phases" aria-label="Review progress">' +
      [['Manufacturing / Labor Review', review.manufacturingReviewStatus], ['Material / BOM Review', review.materialsReviewStatus]].map(([name, status]) =>
        '<section class="technical-review-phase"><h4>' + name + '</h4><p class="technical-review-phase-status">' + escapeHtml(labels[status] || 'Not Started') + '</p></section>').join('') + '</section>';
  }

  function manufacturingIsNext(record) {
    return record?.technicalReview?.materialsReviewStatus === 'QUALIFIED' &&
      record.technicalReview.nextReviewPhase === 'MANUFACTURING_LABOR_REVIEW' &&
      !['NO_LONGER_REQUIRED', 'READY_FOR_RFQ_WORKING_QUEUE'].includes(record.status);
  }

  function renderManufacturingHandoff(record) {
    if (!manufacturingIsNext(record)) return renderEntryActions(record, window.DleOsCapabilities?.can?.('technical_review.disposition') === true);
    return '<section class="technical-review-question" aria-labelledby="manufacturingReviewTitle"><h3 id="manufacturingReviewTitle" tabindex="-1">Manufacturing / Labor Review</h3>' +
      '<p>Materials definition qualified.</p><p>Next, identify and review the technical information that governs how this assembly is manufactured.</p>' +
      '<p>The review questions are not available yet. Overall Technical Review remains in progress; this RFQ is not ready for quote.</p>' +
      acceptedLinks(record) + '<button type="button" class="technical-review-back" data-technical-review-action="review-back">← Back to Technical Review</button></section>';
  }

  function renderEntryActions(record, canDisposition) {
    const message = '<p class="technical-review-message" data-state="' + escapeHtml(state.messageState) + '" role="status">' + escapeHtml(state.message) + '</p>';
    if (record.status === "NO_LONGER_REQUIRED") return message + '<p>This review is closed. The intake record is preserved.</p>';
    if (record.status === "READY_FOR_RFQ_WORKING_QUEUE") return message + '<p>This review has been handed off to RFQ.</p>';
    const disabled = !canDisposition || state.saving ? "disabled" : "";
    if (state.closing) return renderCloseChoices(disabled, message);
    const qualified = record.technicalReview?.materialsReviewStatus === 'QUALIFIED';
    const nextManufacturing = manufacturingIsNext(record);
    const summary = laborFirst(record) ? renderLaborFirstSummary(record) : qualified ? '<section class="technical-review-phases" aria-label="Review progress"><section class="technical-review-phase" aria-labelledby="materialPhaseTitle"><h4 id="materialPhaseTitle">Material / BOM Review</h4><p class="technical-review-phase-status">Complete</p><div class="technical-review-phase-acceptances">' + acceptedLinks(record) + '</div></section><section class="technical-review-phase" aria-labelledby="manufacturingPhaseTitle"><h4 id="manufacturingPhaseTitle">Manufacturing / Labor Review</h4><p class="technical-review-phase-status">' + (nextManufacturing ? 'Next · Not Started' : 'Next phase not specified') + '</p></section></section>' : '';
    const primary = nextManufacturing ? '<button type="button" class="technical-review-primary" data-technical-review-action="manufacturing" ' + disabled + '>Start Manufacturing / Labor Review</button><p>Continue with the next phase. The accepted BOM is retained.</p>' :
      qualified ? '<p>The materials review is complete. The next review phase is not available.</p>' :
      '<button type="button" class="technical-review-primary" data-technical-review-action="start" ' + disabled + '>Start Technical Review</button><p>I am going to work this item.</p>';
    return summary + (record.technicalReview?.assemblyType === 'PCB_ASSEMBLY' ? '<p class="technical-review-source">Assembly type: PCB Assembly</p>' : '') + (qualified ? '' : acceptedLinks(record)) + '<section class="technical-review-card"><h3>Choose how to proceed</h3>' +
      '<div class="technical-review-field-grid"><div>' + primary + '</div>' +
      '<div><button type="button" class="technical-review-secondary" data-technical-review-action="close" ' + disabled + '>No Longer Required</button><p>Close this review without proceeding.</p></div></div>' +
      (!canDisposition ? '<p>Disposition permission required.</p>' : '') + message + '</section>';
  }

  function renderCloseChoices(disabled, message) {
    return '<section class="technical-review-card" aria-labelledby="technicalReviewClosePrompt">' +
      '<h3 id="technicalReviewClosePrompt" tabindex="-1">What would you like to do with this intake?</h3>' +
      '<div class="technical-review-field-grid"><div><button type="button" class="technical-review-secondary" data-technical-review-action="delete" ' + disabled + '>Delete</button><p>Permanently delete this early-stage intake and review.</p></div>' +
      '<div><button type="button" class="technical-review-primary" data-technical-review-action="save-close" ' + disabled + '>Save</button><p>Close as No Longer Required and preserve for history.</p></div></div>' + message + '</section>';
  }

  async function deleteReview() {
    if (state.saving || !state.selected?.record?.intakeId) return;
    const intakeId = state.selected.record.intakeId;
    state.saving = true;
    state.message = "Deleting intake and review…";
    state.messageState = "";
    renderDetail();
    try {
      await fetchJson("/api/sim/technical-reviews/" + encodeURIComponent(intakeId), { method: "DELETE" });
      showQueue();
      document.getElementById("technicalReviewDetail").innerHTML = "";
      await loadQueue();
      if (!state.error) setStatus(intakeId + " deleted", "ready");
    } catch (error) {
      state.message = error?.message || "The intake could not be deleted.";
      state.messageState = "error";
      setStatus("Unable to delete intake", "error");
    } finally {
      state.saving = false;
      if (state.selected) renderDetail();
    }
  }

  async function saveEntryDisposition(disposition) {
    if (state.saving || !state.selected?.record?.intakeId) return;
    const intakeId = state.selected.record.intakeId;
    state.saving = true;
    state.message = "Saving Technical Review state…";
    state.messageState = "";
    renderDetail();
    try {
      state.selected = await fetchJson("/api/sim/technical-reviews/" + encodeURIComponent(intakeId) + "/disposition", {
        method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ disposition })
      });
      state.guided = disposition === "START_TECHNICAL_REVIEW";
      if (state.guided && laborFirst(state.selected.record)) { state.step = state.selected.record.technicalReview.assemblyType ? '' : 'labor-first'; state.materials = false; }
      state.message = state.guided ? "" : "Closed as No Longer Required. The intake record is preserved.";
      state.messageState = "success";
      await refreshQueueModel();
      setStatus(state.selected.reviewStatusLabel, "ready");
    } catch (error) {
      state.message = error?.message || "Technical Review state could not be saved.";
      state.messageState = "error";
      setStatus("Unable to save review", "error");
    } finally {
      state.saving = false;
      renderDetail();
      document.getElementById("technicalReviewDetailTitle")?.focus?.();
    }
    if (state.guided && laborFirst(state.selected.record) && !state.selected.record.technicalReview.assemblyType) return;
    if (state.guided) await resumeGuidedBaseline();
  }

  async function resumeGuidedBaseline() {
    state.guided = true; state.step = ''; state.materials = false; state.message = ''; state.messageState = '';
    renderDetail();
    if (state.guided && !state.selected?.record?.technicalReview?.assemblyHistory) await updateHistory(false);
    else if (state.guided && state.selected?.record?.technicalReview?.candidateBom) { state.step = 'candidate'; state.candidateIndex = null; renderDetail(); }
    else if (state.guided && materialsEligible(state.selected?.record)) enterPackage();
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

  function documentStateLabel(value) { if (value === "BINARIES_VERIFIED_SIM") return "Verified SIM files"; return value === "METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED" ? "Metadata preserved · source placement required" : value === "NOT_PROVIDED" ? "Not provided" : value || "Unknown"; }
  function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value || "—" : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" }); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }

  document.addEventListener("dle:workspace-navigation", event => {
    if (event.detail?.workspace?.id !== WORKSPACE_ID || !event.detail?.requestedState?.intakeId) return;
    void openReview(event.detail.requestedState.intakeId);
  });
  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({ id: WORKSPACE_ID, render: renderWorkspace, refresh: loadQueue, openReview });
})(window, document);

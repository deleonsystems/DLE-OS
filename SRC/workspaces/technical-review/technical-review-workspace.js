(function registerTechnicalReviewWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "technical-review";
  const TEMPLATE_PATH = "SRC/workspaces/technical-review/technical-review-workspace.html";
  const state = { items: [], selected: null, loading: false, guided: false, materials: false, step: '', packageDraft: null, documentIndex: 0, closing: false, saving: false, error: "", message: "", messageState: "" };
  let mount = null;
  let identityChanges = {};
  let packageRowErrors = {};
  let addingDocuments = false;
  let reviewUploads = [];
  let reviewUploadRowTarget = null;
  let interactionsBound = false;
  let scanWorkbenchObserver = null;

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
    mount.addEventListener('dragenter', reviewDragOver);
    mount.addEventListener('dragover', reviewDragOver);
    mount.addEventListener('dragleave', reviewDragLeave);
    mount.addEventListener('drop', reviewDrop);
    mount.addEventListener('input', updateScannedSetup);
    mount.addEventListener('change', updateScannedSetup);
    mount.addEventListener('focusin', focusScannedCell);
    mount.addEventListener('click', focusScannedCell);
    mount.addEventListener('click', scanSourceActivation);
    mount.addEventListener('focusin', scanSourceActivation);
    mount.addEventListener('keydown', scanSourceKey);
    mount.addEventListener('dblclick', event=>beginScanEdit(event.target));
    mount.addEventListener('focusout', event=>{if(state.scanEdit?.input===event.target)finishScanEdit(true);});
    mount.addEventListener('keydown', scanGridKey);
    mount.addEventListener('pointerdown', startScanColumnResize);
    mount.addEventListener('pointermove', moveScanColumnResize);
    mount.addEventListener('pointerup', endScanColumnResize);
    mount.addEventListener('pointercancel', endScanColumnResize);
    mount.addEventListener('lostpointercapture', endScanColumnResize);
    mount.addEventListener('keydown', scanColumnResizeKey);
    mount.addEventListener('keydown', event=>{
      if(event.key==='Escape' && state.scanLeavePrompt){event.preventDefault();setScanLeavePrompt(false);}
    });
    mount.addEventListener('input', updateScannedWorksheet);
    mount.addEventListener('change', updateScannedWorksheet);
    mount.addEventListener("click", event => {
      const packageRow = event.target.closest?.("[data-package-row]");
      if (packageRow) state.documentIndex = Number(packageRow.dataset.packageRow);
      const actionButton = event.target.closest?.("[data-technical-review-action]");
      const action = actionButton?.dataset.technicalReviewAction;
      if (completedReview(state.selected?.record)) {
        if (action === 'rfq-back') { window.DleWorkspaceShell.navigate({workspaceId:'rfqs',requestedState:{intakeId:state.selected.record.intakeId}}); return; }
        if (action?.startsWith('view-')) { state.step = action.slice(5); state.candidateIndex = null; state.acceptedVersion = null; renderDetail(); return; }
        if (action && !['back','refresh','accepted-bom','accepted-back','candidate-detail','worksheet-options'].includes(action)) return;
      }
      if (action?.startsWith('scan-sheet-')) { void scannedWorksheetAction(action, actionButton); return; }
      if (action?.startsWith('scan-')) { void scannedSetupAction(action, actionButton); return; }
      if (state.step === 'accepted-bom' && ['candidate-confirm', 'complete-bom', 'alternate-add', 'alternate-edit', 'alternate-remove'].includes(action)) return;
      if (action === 'add-document' && !state.saving) { reviewUploads=[]; reviewUploadRowTarget=null; addingDocuments = true; state.guided = true; enterPackage(); return; }
      if (action === 'row-add-file' && !state.saving && activeRowDocumentTarget()) { addingDocuments=true; renderDetail(); return; }
      if (action === 'upload-documents' && !state.saving) { void uploadReviewDocuments(); return; }
      if (action === 'cancel-upload' && !state.saving) { addingDocuments = false; reviewUploads = []; renderDetail(); return; }
      if (action === 'remove-upload' && !state.saving) {
        const index = Number(actionButton.dataset.uploadRemove);
        if (Number.isInteger(index) && index >= 0 && index < reviewUploads.length) reviewUploads.splice(index,1);
        renderDetail(); return;
      }
      if (action === "refresh") void loadQueue();
      if (action === "back" && !state.saving) showQueue();
      if (action === 'start' && unifiedEligible(state.selected?.record)) { void workflowAction('START'); return; }
      if (action === 'flow-back-package') { enterPackage(); return; }
      if (action?.startsWith('flow-')) { void workflowAction(action.slice(5)); return; }
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
      if (action === 'identity-change') { const d=packageDraft().documents[state.documentIndex||0]; identityChanges[d.documentId]={type:identityType(d),otherDescription:d.identityReview?.otherDescription||''}; renderDetail(); }
      if (action === 'identity-confirm') confirmIdentity();
      if (action === 'accept-package-row') void acceptPackageRow();
      if (action === "save-package") void savePackage(false);
      if (action === 'confirm-package' || action === 'hold-package') { void saveUnifiedPackage(action === 'confirm-package'); return; }
      if (action === "compare-package") void savePackage(true);
      if (action === "governing-back" && state.selected?.record?.technicalReview?.workflow) { void enterPackage(); return; }
      if (action === "governing-back") { state.materials = false; state.step = 'governing'; renderDetail(); }
      if (action === "coverage") { state.materials = false; state.step = 'coverage'; renderDetail(); }
      const fileButton = event.target.closest?.('[data-package-index]');
      if (fileButton && !state.saving) { state.documentIndex = Number(fileButton.dataset.packageIndex); renderDetail(); }
      if (action === "materials") void reviewMaterials();
      if (action === "candidate") {
        if(scannedMainBom()&&(state.step!=='inventory'||state.selected?.scannedCandidate?.status!=='READY'||packageCandidateState().dirty))return;
        state.acceptedVersion = null;
        if (state.selected?.record?.technicalReview?.candidateBom) { state.message = ''; state.messageState = ''; state.candidateIndex = null; state.step = 'candidate'; state.materials = false; renderDetail(); }
        else void buildCandidate();
      }
      if (action === 'analysis-retry') void buildCandidate();
      if (action === 'candidate-detail' && !state.saving) {
        const index = Number(event.target.closest('[data-candidate-row]').dataset.candidateRow);
        reviewUploads=[];reviewUploadRowTarget=null;addingDocuments=false; const row=state.selected.record.technicalReview.candidateBom?.rows[index];if(row)rowReviewUi(row).editing=false; state.candidateDraft = null; state.candidateIndex = state.candidateIndex === index ? null : index; renderDetail();
      }
      if (action === "candidate-from-source") void savePackage(false).then(() => { if (state.messageState !== 'error') return buildCandidate(); });
      if (action === 'complete-bom') void completeBom();
      if (action === 'accepted-bom' && !state.saving) {
        state.acceptedVersion = Number(actionButton.dataset.acceptedVersion);
        state.candidateIndex = null; state.guided = true; state.step = 'accepted-bom';
        renderDetail();
        document.getElementById('acceptedBomTitle')?.focus?.();
      }
      if (action === 'accepted-back' && !state.saving) {
        if (state.selected.record.technicalReview?.workflow) {
          state.acceptedVersion = null; state.candidateIndex = null; state.materials = false;
          state.guided = true; state.step = completedReview(state.selected.record) ? 'package' : 'inventory';
          renderDetail();
        } else void openReview(state.selected.record.intakeId);
      }
      if (action === "candidate-confirm") void confirmCandidate();
      if (action === 'mfg-confirm' || action === 'mfg-reject') void reviewManufacturer(actionButton.dataset.proposalId, action === 'mfg-confirm' ? 'CONFIRMED' : 'REJECTED');
      if (action === 'mfg-approve') void quickApproveManufacturer(Number(actionButton.dataset.candidateRow));
      if(action==='worksheet-reject'){void reviewManufacturer(actionButton.dataset.proposalId,'REJECTED',Number(actionButton.dataset.candidateRow));return;}
      if(action==='worksheet-accept'){void acceptWorksheetRow(Number(actionButton.dataset.candidateRow));return;}
      if(action==='worksheet-options'){
        if(state.candidateIndex!==Number(actionButton.dataset.candidateRow))state.candidateDraft=null;
        state.candidateIndex=Number(actionButton.dataset.candidateRow);state.rowOption=actionButton.dataset.panel;
        const review=state.selected.record.technicalReview;const row=(review.bomAcceptances?.find(a=>state.acceptedVersion?a.version===state.acceptedVersion:a.candidate.id===review.candidateBom?.id)?.candidate||review.candidateBom).rows[state.candidateIndex];
        if(state.rowOption==='edit')rowReviewUi(row).editing=true;
        renderDetail();return;
      }
      if (action === 'alternate-approve') void saveCompactAlternate();
      if (action === 'alternate-not-approved') void saveCompactAlternate(false);
      if (action === 'primary-accept') void acceptPrimaryRow();
      if (action === 'alternate-add') void saveAlternate('ADD');
      if (action === 'alternate-edit' || action === 'alternate-remove') void saveAlternate(action === 'alternate-edit' ? 'EDIT' : 'REMOVE', event.target.closest('[data-alternate-id]').dataset.alternateId);
      if (action === "candidate-previous" && !state.saving) { state.candidateDraft = null; state.candidateIndex = Math.max(0, (state.candidateIndex || 0) - 1); renderDetail(); }
      if (action === "candidate-next" && !state.saving) { state.candidateDraft = null; state.candidateIndex = (state.candidateIndex || 0) + 1; renderDetail(); }
      if (action === "history-back" && !state.saving && state.selected?.record?.technicalReview?.workflow) { state.guided = false; renderDetail(); return; }
      if (action === "history-back" && !state.saving) { state.materials = false; state.step = ""; state.message = ""; state.messageState = ""; renderDetail(); }
      if (action === "retry-history") void updateHistory(false);
      if (action === "confirm-history") void updateHistory(true);
      if (action === "review-back" && !state.saving) { state.guided = false; state.message = ""; renderDetail(); }
      const row = event.target.closest?.("[data-technical-review-intake]");
      if (row) void openReview(row.dataset.technicalReviewIntake);
    });
    mount.addEventListener('input', event => {
      if(event.target.dataset?.worksheetField && !state.saving && !completedReview(state.selected?.record)) {
        const row=state.selected?.record?.technicalReview?.candidateBom?.rows[Number(event.target.dataset.worksheetRow)];
        if(row)rowReviewUi(row)[event.target.dataset.worksheetField]=event.target.value;
      }
      if (event.target.id === 'packageMissing') { packageAnswers().missing = event.target.value; return; }
      if (updateReviewUpload(event.target)) return;
      if (event.target.id?.startsWith('candidate-') && state.candidateIndex != null && !state.saving) { const field=event.target.id.slice(10); if(candidateFields[field])state.candidateDraft={...(state.candidateDraft||state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex].values),[field]:event.target.value}; }
      const packageRow=event.target.closest?.('[data-package-row]'); if(packageRow)state.documentIndex=Number(packageRow.dataset.packageRow);
      if (event.target.dataset?.identityOther !== undefined && !completedReview(state.selected?.record)) { const d=packageDraft().documents[state.documentIndex||0]; identityChanges[d.documentId] ||= {type:identityType(d),otherDescription:''}; identityChanges[d.documentId].otherDescription=event.target.value; }
      if (!completedReview(state.selected?.record) && !state.saving && ['subassemblyPartNumber','proposedSubassemblyIdentity'].includes(event.target.dataset?.packageField)) packageDraft().documents[state.documentIndex || 0][event.target.dataset.packageField] = event.target.value;
    });
    mount.addEventListener('change', event => {
      const packageRow=event.target.closest?.('[data-package-row]'); if(packageRow)state.documentIndex=Number(packageRow.dataset.packageRow);
      if (completedReview(state.selected?.record) || state.saving || !state.selected || state.step === 'accepted-bom') return;
      if (event.target.name === 'packageComplete') { packageAnswers().complete = event.target.value; renderDetail(); return; }
      if(event.target.dataset?.worksheetField){
        const index=Number(event.target.dataset.worksheetRow),row=state.selected.record.technicalReview.candidateBom.rows[index];
        const ui=rowReviewUi(row);ui[event.target.dataset.worksheetField]=event.target.value;
        if(state.candidateIndex===index && document.getElementById('candidate-partNumber'))state.candidateDraft=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])]));
        if(event.target.tagName==='SELECT')renderDetail();return;
      }
      if(['primaryChoice','alternateChoice'].includes(event.target.id)) {
        const row=state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex];
        state.candidateDraft=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])]));
        rememberPrimaryInputs(row);rowReviewUi(row)[event.target.id]=event.target.value;renderDetail();return;
      }
      if (event.target.dataset?.packageUse) {
        const pack=unifiedPackageDraft(), doc=pack.documents[state.documentIndex||0], field=event.target.dataset.packageUse;
        identityChanges[doc.documentId] ||= {type:identityType(doc),otherDescription:doc.identityReview?.otherDescription||''};
        doc[field]=event.target.value;
        if(field==='productionUse' && doc[field]==='PRIMARY_DRAWING') pack.documents.forEach(d=>{if(d!==doc&&d.productionUse==='PRIMARY_DRAWING')d.productionUse='NOT_FOR_PRODUCTION';});
        if(field==='bomUse') {
          if(doc[field]==='GOVERNING_BOM') { pack.documents.forEach(d=>{if(d!==doc&&d.bomUse==='GOVERNING_BOM')d.bomUse='NO_BOM_ROLE';});pack.governingBomDocumentId=doc.documentId; }
          else if(pack.governingBomDocumentId===doc.documentId)pack.governingBomDocumentId=null;
        }
        renderDetail();return;
      }
      if (event.target.id === 'reviewDocumentFiles') {
        queueReviewFiles(event.target.files); return;
      }
      if (updateReviewUpload(event.target)) { if (event.target.tagName === 'SELECT') renderDetail(); return; }
      if (event.target.dataset?.componentRow !== undefined) { void saveComponentType(event.target); return; }
      if (event.target.id === 'flowDrawing') { void workflowAction('SELECT_MANUFACTURING_DRAWING'); return; }
      if (event.target.dataset?.pnField) { const d=packageDraft().documents[state.documentIndex||0]; if(state.selected.record.technicalReview?.workflow)identityChanges[d.documentId] ||= {type:identityType(d),otherDescription:d.identityReview?.otherDescription||''}; d.partNumberReview={...(d.partNumberReview||{}),[event.target.dataset.pnField]:event.target.dataset.pnField==='basis'?event.target.value||null:event.target.value===''?null:event.target.value==='yes',reviewedBy:null,reviewedAtUtc:null}; state.message='Part-number review updated. Save the package to preserve your answers.';renderDetail();return; }
      if (event.target.dataset?.identityType !== undefined) { const d=packageDraft().documents[state.documentIndex||0]; identityChanges[d.documentId] ||= {type:identityType(d),otherDescription:d.identityReview?.otherDescription||''}; identityChanges[d.documentId].type=event.target.value;
        if(state.selected.record.technicalReview?.workflow) {
          d.documentType=({DRAWING:'ASSEMBLY_DRAWING',DRAWING_AND_BOM:'ASSEMBLY_DRAWING',BOM_ONLY:'BOM',GERBER_FILES:'GERBER',DATASHEET:'SUPPORTING_DOCUMENT',SPECIFICATION:'SUPPORTING_DOCUMENT',OTHER:'SUPPORTING_DOCUMENT',UNKNOWN:'UNKNOWN'})[event.target.value];
          d.embeddedBom=event.target.value==='DRAWING_AND_BOM';d.partNumberReview=null;
          if(!bomBearing(d)){d.bomUse='NO_BOM_ROLE';if(packageDraft().governingBomDocumentId===d.documentId)packageDraft().governingBomDocumentId=null;}
          if(d.documentType!=='ASSEMBLY_DRAWING')d.productionUse='NOT_FOR_PRODUCTION';
        }
        renderDetail(); return; }
      const field = event.target.dataset?.packageField;
      const pack = packageDraft();
      if (field) {
        const doc = pack.documents[state.documentIndex || 0]; doc[field] = field === 'embeddedBom' ? event.target.checked : event.target.value;
        if (state.selected.record.technicalReview?.workflow) {
          identityChanges[doc.documentId] ||= {type:identityType(doc),otherDescription:doc.identityReview?.otherDescription||''};
          if(doc.applicability!=='PARENT_ASSEMBLY' && doc.productionUse==='PRIMARY_DRAWING')doc.productionUse='NOT_FOR_PRODUCTION';
          if(doc.applicability!=='PARENT_ASSEMBLY' && doc.bomUse==='GOVERNING_BOM'){doc.bomUse='NO_BOM_ROLE';pack.governingBomDocumentId=null;}
          renderDetail();return;
        }
        if (field === 'embeddedBom') { doc.partNumberReview=null; if(doc.identityReview)doc.identityReview={type:doc.embeddedBom?'DRAWING_AND_BOM':'DRAWING',decision:'CORRECTED'}; }
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
  const applicability = { PARENT_ASSEMBLY: 'Main Assembly', SUBASSEMBLY: 'Subassembly', SUPPORTING_REFERENCE: 'Reference' };
  function isBomSource(doc) { return doc.documentType === 'BOM' || (doc.documentType === 'ASSEMBLY_DRAWING' && doc.embeddedBom === true); }
  function bomSourceLabel(doc) { return doc.documentType === 'ASSEMBLY_DRAWING' ? 'BOM embedded in Assembly Drawing' : 'Standalone BOM'; }
  function packageDraft() {
    return state.packageDraft ||= JSON.parse(JSON.stringify(state.selected.record.technicalReview?.technicalPackage || { documents: (state.selected.record.technicalFiles || []).map((file, i) => ({ documentId: file.documentId || 'DOC-' + String(i + 1).padStart(3, '0'), name: file.name, documentType: ({DRAWING:'ASSEMBLY_DRAWING',DRAWING_AND_BOM:'ASSEMBLY_DRAWING',BOM_ONLY:'BOM',OTHER:'SUPPORTING_DOCUMENT'})[file.initialIdentification?.type] || 'UNKNOWN', embeddedBom:file.initialIdentification?.type === 'DRAWING_AND_BOM', role: 'UNRESOLVED', applicability: 'SUPPORTING_REFERENCE', subassemblyPartNumber: null })), governingBomDocumentId: null }));
  }
  async function enterPackage() {
    if (state.saving) return;
    if (state.selected?.record?.technicalReview?.workflow && state.step !== 'inventory') {
      try { state.selected = await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)); state.packageDraft=null;state.packageAnswers=null; }
      catch(error) { state.message=error.message;state.messageState='error';renderDetail();return; }
    }
    state.materials = false; state.step = 'inventory'; state.message = ''; state.messageState = ''; renderDetail();
  }
  function progress(current) { if (state.selected?.record?.technicalReview?.workflow) return '<div class="technical-review-question-progress">' + escapeHtml(current) + '</div>'; return '<div class="technical-review-question-progress">History ✓ → ' + ['Technical Package Review', 'BOM Review', 'Subassemblies'].map(label => label === current ? '<strong>' + label + '</strong>' : label).join(' → ') + '</div>'; }
  function packageSelect(label, field, options, value) { return '<label>' + label + '<select aria-label="' + label + '" data-package-field="' + field + '" ' + (state.saving ? 'disabled' : '') + '>' + Object.entries(options).map(([key, text]) => '<option value="' + key + '" ' + (key === value ? 'selected' : '') + '>' + text + '</option>').join('') + '</select></label>'; }
  function reviewDropZone(event) { return event.target.closest?.('[data-review-drop-zone]'); }
  function reviewDragOver(event) {
    const zone=reviewDropZone(event); if(!zone)return;
    event.preventDefault();
    if(state.saving || completedReview(state.selected?.record)) { if(event.dataTransfer)event.dataTransfer.dropEffect='none';return; }
    if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    zone.classList.add('is-dragging');
  }
  function reviewDragLeave(event) {
    const zone=reviewDropZone(event); if(zone && !zone.contains(event.relatedTarget))zone.classList.remove('is-dragging');
  }
  function reviewDrop(event) {
    const zone=reviewDropZone(event);if(!zone)return;
    event.preventDefault();zone.classList.remove('is-dragging');
    if(state.saving || completedReview(state.selected?.record))return;
    const files=Array.from(event.dataTransfer?.files||[]);
    if(!files.length) { state.message='No browser files were available from that drop. Save email attachments to this device, then drop them here or click to browse.';state.messageState='error';renderDetail();return; }
    queueReviewFiles(files);
  }
  function queueReviewFiles(files) {
    if(state.saving || completedReview(state.selected?.record))return;
    // Match Intake's session duplicate identity; keep existing classification answers.
    const identity=file=>[file.name,file.size,file.type||'application/octet-stream',file.lastModified].join('\u0000');
    if(!reviewUploads.length) reviewUploadRowTarget=activeRowDocumentTarget();
    const known=new Set(reviewUploads.map(u=>identity(u.file)));
    let duplicates=0;
    for(const file of Array.from(files||[])) {
      const key=identity(file);if(known.has(key)){duplicates++;continue;}known.add(key);
      reviewUploads.push({file,type:'',applicability:'PARENT_ASSEMBLY',subassemblyPartNumber:'',proposedSubassemblyIdentity:'',note:''});
    }
    state.message=duplicates?'Already-selected files were skipped. Existing files and classifications are preserved.':'';
    state.messageState='';renderDetail();
  }
  function updateReviewUpload(target) {
    const field = target.dataset?.uploadField, index = target.closest?.('[data-upload-index]')?.dataset.uploadIndex;
    if (!field || index === undefined || state.saving || completedReview(state.selected?.record)) return false;
    if (reviewUploads[index]) reviewUploads[index][field] = target.value;
    return true;
  }
  function renderReviewUploads(rowMode=false) {
    if (!addingDocuments && !rowMode) return '';
    const disabled = state.saving ? 'disabled' : '';
    return '<section class="review-document-upload"><h4>'+ (rowMode?'Attach Technical Files':'Add Package-Level Document') +'</h4><p>'+ (rowMode?'Association comes from this saved BOM row. Save row edits before attaching files.':'For main assembly and package-wide files. Add component/subassembly files from Candidate BOM row details.') +' Select one or more files and identify each document. Files are preserved with this review; analysis starts only when requested.</p><label class="review-file-drop" data-review-drop-zone aria-disabled="'+(state.saving?'true':'false')+'"><input id="reviewDocumentFiles" type="file" aria-label="Select technical files" multiple '+disabled+'><span>Drop technical files here</span><small>or click to browse</small></label><p>Up to 20 MB per file. Selected files are saved only when you choose '+(rowMode?'Save Files':'Save Documents')+'.</p>' + reviewUploads.map((upload,index) => {
      const select = (label,field,options) => '<label>'+label+'<select aria-label="'+label+' for '+escapeHtml(upload.file.name)+'" data-upload-field="'+field+'" required '+disabled+'><option value="">Select…</option>'+Object.entries(options).map(([key,text])=>'<option value="'+key+'" '+(upload[field]===key?'selected':'')+'>'+text+'</option>').join('')+'</select></label>';
      const input = (label,field,limit,required=false) => '<label>'+label+'<input aria-label="'+label+' for '+escapeHtml(upload.file.name)+'" data-upload-field="'+field+'" maxlength="'+limit+'" '+(required?'required ':'')+disabled+' value="'+escapeHtml(upload[field])+'"></label>';
      return '<fieldset data-upload-index="'+index+'" '+disabled+'><legend>'+escapeHtml(upload.file.name)+'</legend><button type="button" data-technical-review-action="remove-upload" data-upload-remove="'+index+'" aria-label="Remove '+escapeHtml(upload.file.name)+'" '+disabled+'>Remove</button><div class="technical-review-package-fields">'+select('Document type','type',identityLabels)+input('Note / description (optional)','note',500)+'</div></fieldset>';
    }).join('')+'<div class="package-page-actions"><button class="technical-review-primary" data-technical-review-action="upload-documents" '+(state.saving||!reviewUploads.length?'disabled':'')+'>'+(state.saving?'Saving documents…':rowMode?'Save Files':'Save Documents')+'</button><button data-technical-review-action="cancel-upload" '+disabled+'>Cancel</button></div></section>';
  }
  async function uploadReviewDocuments() {
    if (state.saving || completedReview(state.selected?.record) || !reviewUploads.length) return;
    if (reviewUploads.some(u=>!identityLabels[u.type])) {
      state.message='Select a document type for every file.'; state.messageState='error'; renderDetail(); return;
    }
    const target=activeRowDocumentTarget();
    if (reviewUploadRowTarget && (!target || JSON.stringify(target)!==JSON.stringify(reviewUploadRowTarget))) { state.message='The row context changed. Remove and reselect queued files from the current row.'; state.messageState='error';renderDetail();return; }
    if (target && state.candidateDraft && JSON.stringify(state.candidateDraft)!==JSON.stringify(state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex].values)) { state.message='Save row changes before attaching technical files.';state.messageState='error';renderDetail();return; }
    state.saving = true; state.message = ''; state.messageState = ''; renderDetail();
    let saved = 0;
    try {
      while (reviewUploads.length) {
        const {file,...metadata} = reviewUploads[0], form = new window.FormData();
        form.append('file',file,file.name); form.append('metadata',JSON.stringify({...metadata,applicability:'PARENT_ASSEMBLY',subassemblyPartNumber:null,proposedSubassemblyIdentity:null,rowTarget:reviewUploadRowTarget})); form.append('lastModified',String(file.lastModified||0));
        const response = await window.fetch('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/documents',{method:'POST',credentials:'same-origin',headers:{'X-SIM-Document-Upload':'1'},body:form});
        const payload = await response.json(); if (!response.ok) throw new Error(payload.message||'The document could not be saved.');
        const draft = state.packageDraft;
        state.selected = payload;
        // Keep any existing unsaved classification edits while appending the persisted new document.
        state.packageDraft = draft ? {...draft,documents:payload.record.technicalReview.technicalPackage.documents.map(d=>draft.documents.find(old=>old.documentId===d.documentId)||d)} : null;
        reviewUploads.shift(); saved++;
      }
      addingDocuments = false; state.message = saved+' technical document'+(saved===1?'':'s')+' saved. Candidate BOM and existing review decisions are unchanged.';
      if (state.selected.record.technicalReview?.workflow) state.selected = await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId));
    } catch (error) { state.message = (saved?saved+' file(s) saved. ':'')+(error.message||'Upload failed.')+' Remaining files are still selected.'; state.messageState='error'; }
    finally { state.saving = false; renderDetail(); }
  }
  const identityLabels = {DRAWING:'Drawing',DRAWING_AND_BOM:'Drawing + BOM',BOM_ONLY:'BOM Only',GERBER_FILES:'Gerber Files',DATASHEET:'Datasheet',SPECIFICATION:'Specification / Supporting Document',UNKNOWN:'Unknown / Not Determined',OTHER:'Other'};
  function identityType(doc) { if(['DATASHEET','SPECIFICATION'].includes(doc.identityReview?.type))return doc.identityReview.type; return doc.documentType === 'ASSEMBLY_DRAWING' ? (doc.embeddedBom ? 'DRAWING_AND_BOM' : 'DRAWING') : ['BOM','SUBASSEMBLY_BOM'].includes(doc.documentType) ? 'BOM_ONLY' : doc.documentType === 'GERBER' ? 'GERBER_FILES' : doc.documentType === 'UNKNOWN' ? 'UNKNOWN' : 'OTHER'; }
  function identityReviewed(doc) { return !!doc.identityReview || !!state.selected.record.technicalReview?.technicalPackage?.documents.some(d=>d.documentId===doc.documentId && d.documentType!=='UNKNOWN'); }
  function confirmIdentity() {
    if (state.saving || completedReview(state.selected?.record)) return;
    const doc=packageDraft().documents[state.documentIndex||0], source=state.selected.record.technicalFiles.find(f=>f.documentId===doc.documentId), initial=source?.initialIdentification;
    const previousType=identityType(doc);
    const choice=identityChanges[doc.documentId] || {type:initial?.type||'UNKNOWN',otherDescription:initial?.otherDescription};
    if (choice.type !== identityType(doc)) { doc.documentType=({DRAWING:'ASSEMBLY_DRAWING',DRAWING_AND_BOM:'ASSEMBLY_DRAWING',BOM_ONLY:'BOM',GERBER_FILES:'GERBER',DATASHEET:'SUPPORTING_DOCUMENT',SPECIFICATION:'SUPPORTING_DOCUMENT',UNKNOWN:'UNKNOWN',OTHER:'SUPPORTING_DOCUMENT'})[choice.type]; doc.embeddedBom=choice.type==='DRAWING_AND_BOM'; }
    if (choice.type!==previousType) doc.partNumberReview=null;
    if (!isBomSource(doc) && doc.documentType!=='SUBASSEMBLY_BOM' && doc.partNumberReview) doc.partNumberReview={...doc.partNumberReview,basis:null};
    doc.identityReview={type:choice.type,otherDescription:choice.type==='OTHER'?(choice.otherDescription||'').trim()||null:null,decision:choice.type===initial?.type && (choice.type!=='OTHER'||(choice.otherDescription||'')===(initial?.otherDescription||''))?'CONFIRMED':'CORRECTED'};
    const pack=packageDraft();
    if (pack.governingBomDocumentId===doc.documentId && !isBomSource(doc)) pack.governingBomDocumentId=null;
    if(!bomBearing(doc))doc.bomUse='NO_BOM_ROLE';
    if(doc.documentType!=='ASSEMBLY_DRAWING'&&doc.productionUse==='PRIMARY_DRAWING')doc.productionUse='NOT_FOR_PRODUCTION';
    delete identityChanges[doc.documentId]; state.message='Review updated. Save the package to preserve changes.';renderDetail();
  }
  const pnLabels={MANUFACTURER:'MFG P/N',CUSTOMER_INTERNAL:'Customer P/N',MIXED:'Mixed',UNKNOWN:'Unknown'};
  function bomBearing(doc) { return isBomSource(doc)||doc.documentType==='SUBASSEMBLY_BOM'; }
  function rowAccepted(doc) { return identityReviewed(doc)&&(!bomBearing(doc)||!!doc.partNumberReview?.basis); }
  function pnIssue() {
    const docs=packageDraft().documents,bom=docs.filter(d=>!d.rowAssociation&&bomBearing(d));
    if(bom.some(d=>!d.partNumberReview?.basis))return 'Review the BOM P/N Type for each document containing a BOM before continuing.';
    if(bom.some(d=>d.partNumberReview.basis==='UNKNOWN'))return 'Resolve the Unknown BOM P/N Type before continuing, or place the package On Hold.';
    if(bom.some(d=>['CUSTOMER_INTERNAL','MIXED'].includes(d.partNumberReview.basis))&&!docs.some(d=>identityReviewed(d)&&d.partNumberReview?.providesManufacturerPartNumbers===true))return 'This BOM uses customer/internal or mixed part numbers. Identify a reviewed document that provides manufacturer part numbers before continuing.';
    return '';
  }
  function renderInventory() {
    if (state.selected.record.technicalReview?.workflow) return renderUnifiedPackage();
    const docs=packageDraft().documents;
    const rows=docs.map((doc,index)=>{
      const source=state.selected.record.technicalFiles.find(f=>f.documentId===doc.documentId),initial=source?.initialIdentification,choice=identityChanges[doc.documentId],reviewed=identityReviewed(doc),disabled=state.saving?'disabled':'';
      const status=rowAccepted(doc)?'Accepted':'Needs Review';
      const proposal=escapeHtml(identityLabels[source?.reviewOrigin ? doc.identityReview?.type : initial?.type]||identityLabels.UNKNOWN)+(initial?.type==='OTHER'&&initial.otherDescription?'<small>'+escapeHtml(initial.otherDescription)+'</small>':'');
      let controls=choice?'<label>Classification<select aria-label="Classification for '+escapeHtml(doc.name)+'" data-identity-type '+disabled+'>'+Object.entries(identityLabels).map(([k,v])=>'<option value="'+k+'" '+(choice.type===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label>'+(choice.type==='OTHER'?'<label>Other description<input aria-label="Other description for '+escapeHtml(doc.name)+'" data-identity-other maxlength="500" value="'+escapeHtml(choice.otherDescription)+'"></label>':''):'';
      controls+='<div class="package-row-actions">'+(!reviewed||choice?'<button data-technical-review-action="identity-confirm" '+disabled+'>'+(choice?'Accept edit':'Accept')+'</button>':'')+(!choice?'<button data-technical-review-action="identity-change" '+disabled+'>Edit</button>':'')+'</div>';
      if(reviewed)controls+='<small>Reviewed as: <strong>'+escapeHtml(identityLabels[identityType(doc)])+'</strong>'+(doc.identityReview?.otherDescription?' — '+escapeHtml(doc.identityReview.otherDescription):'')+'</small><details class="package-row-context"><summary>Technical context</summary><div class="technical-review-package-fields">'+packageSelect('Document role','role',documentRoles,doc.role)+(doc.rowAssociation?'<small>Scope inherited from Candidate BOM row '+(doc.rowAssociation.rowIndex+1)+'</small>':packageSelect('Applies to','applicability',applicability,doc.applicability))+(doc.documentType==='ASSEMBLY_DRAWING'?'<label><input type="checkbox" data-package-field="embeddedBom" '+(doc.embeddedBom?'checked':'')+' '+disabled+'> BOM embedded in this document</label>':'')+(doc.applicability==='SUBASSEMBLY'&&!doc.rowAssociation?'<label>Customer / BOM P/N<input data-package-field="subassemblyPartNumber" value="'+escapeHtml(doc.subassemblyPartNumber)+'" maxlength="120"></label><label>DLE proposed subassembly identity<input data-package-field="proposedSubassemblyIdentity" value="'+escapeHtml(doc.proposedSubassemblyIdentity)+'" maxlength="120"></label>':'')+'</div></details>';
      if(reviewed){
        if(bomBearing(doc)) controls+=(!doc.partNumberReview?.basis||choice?'<label class="package-pn-question" title="What kind of part numbers are used in the main BOM Part Number field?">Main BOM P/N basis<select aria-label="Part-number basis for '+escapeHtml(doc.name)+'" data-pn-field="basis" '+disabled+'><option value="">Select basis</option>'+Object.entries(pnLabels).map(([k,v])=>'<option value="'+k+'" '+(doc.partNumberReview?.basis===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label>':'<small>Part-number basis: '+escapeHtml(pnLabels[doc.partNumberReview.basis])+'</small>');
        controls+='<label class="package-pn-question">Provides manufacturer P/N information<select aria-label="Manufacturer P/N source for '+escapeHtml(doc.name)+'" data-pn-field="providesManufacturerPartNumbers" '+disabled+'>'+[['','Not reviewed'],['yes','Yes'],['no','No']].map(([k,v])=>'<option value="'+k+'" '+((doc.partNumberReview?.providesManufacturerPartNumbers==null?'':doc.partNumberReview.providesManufacturerPartNumbers?'yes':'no')===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label>';
      }
      const view=source?.binaryStatus==='VERIFIED'?'<a target="'+(source.type==='application/pdf'?'_blank':'_self')+'" rel="noopener noreferrer" href="/api/sim/rfq-intakes/'+encodeURIComponent(state.selected.record.intakeId)+'/documents/'+encodeURIComponent(source.documentId)+'">View File</a>':'<span title="No staged binary is available">File unavailable</span>';
      return '<tr data-package-row="'+index+'"><th scope="row" title="'+escapeHtml(doc.name)+'">'+escapeHtml(doc.name)+(source?.readability?'<small>Document Readability: '+escapeHtml(({TEXT_READABLE:'Text-readable',IMAGE_ONLY:'Scanned / image-only',MIXED:'Mixed — some pages may require image/OCR processing',UNKNOWN:'Unable to determine — Readability check unavailable'})[source.readability.status] || 'Unable to determine')+'</small>':'')+'<small>Source: '+(source?.reviewOrigin?'Technical Review':'Intake')+'</small><small>'+escapeHtml(doc.rowAssociation?'BOM row '+(doc.rowAssociation.rowIndex+1)+' · '+doc.rowAssociation.customerBomPartNumber+' · '+doc.rowAssociation.componentType:applicability[doc.applicability])+(doc.applicability==='SUBASSEMBLY'?' · Customer / BOM P/N: '+escapeHtml(doc.subassemblyPartNumber)+(doc.proposedSubassemblyIdentity?' · DLE proposed: '+escapeHtml(doc.proposedSubassemblyIdentity):''):'')+'</small>'+(source?.reviewOrigin?'<small>Added by '+escapeHtml(source.reviewOrigin.addedBy)+' · '+escapeHtml(formatDateTime(source.reviewOrigin.addedAtUtc))+'</small>'+(source.reviewOrigin.note?'<small>'+escapeHtml(source.reviewOrigin.note)+'</small>':''):'')+'</th><td>'+proposal+'</td><td>'+view+'</td><td>'+controls+'</td><td><strong>'+status+'</strong>'+(doc.identityReview?'<small>'+(doc.identityReview.reviewedBy?escapeHtml(doc.identityReview.reviewedBy)+' · '+escapeHtml(formatDateTime(doc.identityReview.reviewedAtUtc)):'Unsaved')+'</small>':'')+'</td></tr>';
    }).join('');
    return '<section class="technical-review-question package-review-table"><h3>Technical Package Review</h3>'+renderReviewUploads()+'<p role="status">'+docs.length+' files received · '+docs.filter(rowAccepted).length+' reviewed · '+docs.filter(d=>!rowAccepted(d)).length+' need review</p><div class="package-table-scroll"><table><thead><tr>'+['Technical Document','Identified As','View File','Review','Status'].map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+(docs.length?'':'<p>No technical files were received.</p>')+(pnIssue()?'<p role="alert">'+escapeHtml(pnIssue())+'</p>':'')+'<div class="package-page-actions"><button class="technical-review-primary" data-technical-review-action="save-package" '+(state.saving||addingDocuments||docs.some(d=>!rowAccepted(d))||pnIssue()||Object.keys(identityChanges).length?'disabled':'')+'>Save and Continue</button><button class="technical-review-back" data-technical-review-action="history-back">Back to Technical Review</button></div>'+packageMessage()+'</section>';
  }
  function unifiedPackageDraft(pack=packageDraft()) {
    const w=state.selected.record.technicalReview.workflow, m=w.manufacturing;
    for(const d of pack.documents) {
      d.productionUse ??= (m?.governingDocumentId||w.manufacturingDrawingId)===d.documentId?'PRIMARY_DRAWING':
        [m?.supportingDocumentIds,m?.subassemblyDocumentIds,m?.technicalDocumentIds].some(ids=>ids?.includes(d.documentId))?'SUPPORTING_PRODUCTION':'NOT_FOR_PRODUCTION';
      d.bomUse ??= pack.governingBomDocumentId===d.documentId?'GOVERNING_BOM':bomBearing(d)&&['SUPPORTING','REFERENCED'].includes(d.role)?'SUPPORTING_BOM':'NO_BOM_ROLE';
    }
    return pack;
  }
  function packageAnswers() {
    const w=state.selected.record.technicalReview.workflow;
    return state.packageAnswers ||= {complete:w.sufficient?'yes':w.holdReason?'no':'',missing:w.holdReason||''};
  }
  function packageCanBuild() {
    const p=unifiedPackageDraft(), d=p.documents.find(d=>d.documentId===p.governingBomDocumentId);
    return d?.documentType==='ASSEMBLY_DRAWING' && d.embeddedBom && state.selected.record.technicalFiles.some(f=>f.documentId===d.documentId&&f.type==='application/pdf'&&f.binaryStatus==='VERIFIED');
  }
  function unifiedPackageIssue() {
    const docs=unifiedPackageDraft().documents;
    if(docs.some(d=>!d.rowAssociation&&(!packageRowLocked(d)||d.documentType==='UNKNOWN')) || Object.keys(identityChanges).length)return 'Accept each document row before completing the package.';
    if(pnIssue())return pnIssue();
    if(docs.filter(d=>d.productionUse==='PRIMARY_DRAWING'&&d.applicability==='PARENT_ASSEMBLY'&&d.documentType==='ASSEMBLY_DRAWING'&&!d.rowAssociation).length!==1)return 'Select one Main Production Drawing for the Main Assembly.';
    if(docs.filter(d=>d.bomUse==='GOVERNING_BOM'&&d.applicability==='PARENT_ASSEMBLY'&&isBomSource(d)&&!d.rowAssociation).length!==1)return 'Select one Main BOM for the Main Assembly.';
    return '';
  }
  function packageRowIssue(d) {
    if(d.documentType==='UNKNOWN')return 'Choose a document type.';
    if(bomBearing(d)&&(!d.partNumberReview?.basis||d.partNumberReview.basis==='UNKNOWN'))return 'Resolve BOM P/N Type.';
    if(d.partNumberReview?.providesManufacturerPartNumbers==null)return 'Review MFG P/N Source.';
    if(!applicability[d.applicability])return 'Choose Applies To.';
    if(d.applicability==='SUBASSEMBLY'&&!d.subassemblyPartNumber?.trim())return 'Enter the subassembly P/N.';
    return '';
  }
  function packageRowLocked(d) {
    const saved=state.selected.record.technicalReview.technicalPackage?.documents.find(x=>x.documentId===d.documentId);
    return !!saved && identityReviewed(saved) && !packageRowIssue(saved) && !identityChanges[d.documentId];
  }
  async function acceptPackageRow() {
    if(state.saving||completedReview(state.selected.record))return;
    const draft=unifiedPackageDraft(), d=draft.documents[state.documentIndex||0];
    const issue=packageRowIssue(d);
    if(issue){packageRowErrors[d.documentId]=issue;renderDetail();return;}
    const choice=identityChanges[d.documentId];
    const accepted={...d,identityReview:{...(d.identityReview||{}),type:choice?.type||identityType(d),otherDescription:choice?.otherDescription||d.identityReview?.otherDescription||null}};
    state.saving=true;packageRowErrors[d.documentId]='';renderDetail();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/package-review',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:'UNIFIED_PACKAGE_REVIEW_V2',expectedReviewToken:state.selected.packageReviewToken,documents:[accepted],complete:false,acceptDocumentId:d.documentId})});
      delete identityChanges[d.documentId];state.packageDraft=null;
      // Preserve other open row drafts, but never submit them as part of this acceptance.
      const saved=unifiedPackageDraft();
      saved.documents=saved.documents.map(x=>identityChanges[x.documentId]?draft.documents.find(old=>old.documentId===x.documentId)||x:x);
      state.message='Document accepted.';state.messageState='';
    } catch(error){packageRowErrors[d.documentId]=error.message;}
    finally{state.saving=false;renderDetail();}
  }
  function packageCandidateState() {
    const review=state.selected.record.technicalReview;
    const active=['QUEUED','RUNNING','VALIDATING'].includes(state.analysisJob?.status);
    const saved=review.technicalPackage;
    const pendingReview=unifiedPackageDraft().documents.some(d=>!packageRowLocked(d));
    const dirty=pendingReview || Object.keys(identityChanges).length>0 || !!saved && JSON.stringify(unifiedPackageDraft())!==JSON.stringify(unifiedPackageDraft(JSON.parse(JSON.stringify(saved))));
    return {active, dirty, pendingReview, ready:!!review.candidateBom, stale:!review.candidateBom && !!review.candidateBomVersions?.length};
  }
  function packageBuildAction(unsupported, issue) {
    if (scannedMainBom()) return scannedSetupPrompt(issue);
    const c=packageCandidateState();
    if(c.active || (c.ready && !c.dirty && state.selected.record.technicalReview.workflow.sufficient))return '';
    const label=unsupported || c.ready ? 'Save Technical Package' : c.stale ? 'Rebuild Candidate BOM' : 'Save &amp; Build Candidate BOM';
    return '<button class="technical-review-primary" data-technical-review-action="confirm-package" '+(state.saving||addingDocuments||issue?'disabled':'')+'>'+label+'</button>';
  }
  const scannedFields = { FIND_NUMBER:'Find #', CUSTOMER_PART_NUMBER:'Customer P/N', QUANTITY:'Qty', UNIT:'UoM', REFERENCE_DESIGNATORS:'Ref Des', DESCRIPTION:'Description', MANUFACTURER_1:'MFG 1', MANUFACTURER_PART_NUMBER_1:'MFG P/N 1', MANUFACTURER_2:'MFG 2', MANUFACTURER_PART_NUMBER_2:'MFG P/N 2', MANUFACTURER_3:'MFG 3', MANUFACTURER_PART_NUMBER_3:'MFG P/N 3', MANUFACTURER_IDENTITY_1:'Combined MFG identity 1', MANUFACTURER_IDENTITY_2:'Combined MFG identity 2', MANUFACTURER_IDENTITY_3:'Combined MFG identity 3', IGNORE:'Ignore' };
  const scanRowTypes={COMPONENT:'Component',NOT_USED:'Not Used',BLANK:'Blank',CONTINUATION:'Continuation',OTHER:'Other'};
  function scanSheetBase() {
    const w=state.scanSheet;
    return '/api/sim/rfq-intakes/'+encodeURIComponent(state.selected.record.intakeId)+'/documents/'+encodeURIComponent(w.setup.documentId);
  }
  function scanSheetPayload(savedWorksheet=false) {
    const setup=savedWorksheet?state.scanSheet.setup:state.selected.scannedBomSource.setup;
    return {documentId:setup.documentId,sha256:setup.sha256,setupId:setup.id,expectedReviewToken:state.selected.packageReviewToken};
  }
  function scannedCandidateToolbar() {
    const status=state.selected?.scannedCandidate;
    const source=state.selected?.scannedBomSource;
    const w=state.scanSheet;
    const dirty=state.scanSheetDirty||!!state.scanEdit;
    const sourceMatches=source&&source.documentId===w?.setup.documentId&&source.sha256===w?.setup.sha256;
    if(state.scanCandidateBuilding)return '<span role="status">Building Candidate BOM…</span>';
    if(status?.status==='READY'&&!dirty)return '<span role="status">Candidate BOM Ready</span>';
    const rebuild=status?.status==='NEEDS_REBUILD'||status?.status==='READY';
    const blocker=state.scanCandidateError||(dirty?'Save Review before submitting.':!sourceMatches?'The exact source must be verified before submitting.':status?.blocker||'');
    return (rebuild?'<span>Candidate BOM Needs Rebuild</span> ':'')+'<button type="button" class="technical-review-primary" data-technical-review-action="scan-sheet-candidate-submit" '+(state.saving||dirty||!sourceMatches||!status?.canSubmit?'disabled':'')+'>'+(rebuild?'Rebuild Candidate BOM':'Submit to Build Candidate BOM')+'</button>'+(blocker?'<small role="status">'+escapeHtml(blocker)+'</small>':'');
  }
  function syncScannedCandidateToolbar() {
    const toolbar=mount?.querySelector('[data-scan-candidate-toolbar]');if(toolbar)toolbar.innerHTML=scannedCandidateToolbar();
  }
  async function submitScannedCandidate() {
    if(state.scanSheetDirty||state.scanEdit||!state.selected?.scannedCandidate?.canSubmit)return;
    state.scanCandidateBuilding=true;state.scanCandidateError='';state.saving=true;
    const controls=Array.from(mount?.querySelectorAll('.scan-review input:not(:disabled), .scan-review select:not(:disabled), .scan-review button:not(:disabled)')||[]);
    controls.forEach(c=>c.disabled=true);syncScannedCandidateToolbar();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/scanned-bom-review/candidate',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:state.scanSheet.id,expectedVersion:state.scanSheet.version,expectedReviewToken:state.selected.packageReviewToken})});
    } catch(error){state.scanCandidateError=error.message;}
    finally {state.scanCandidateBuilding=false;state.saving=false;controls.forEach(c=>c.disabled=false);syncScannedCandidateToolbar();}
  }
  async function scannedWorksheetAction(action,button) {
    if(state.saving)return;
    if(action==='scan-sheet-reset-widths'){scanColumnWidths={};saveScanColumnWidths();applyScanColumnWidths();return;}
    finishScanEdit(true);
    if(action==='scan-sheet-candidate-submit'){await submitScannedCandidate();return;}
    if(action==='scan-sheet-row-review') {
      const row=state.scanSheet.rows.find(r=>r.position===Number(button.dataset.scanPosition));if(!row)return;
      updateScannedWorksheet({target:{dataset:{scanPosition:String(row.position),scanReviewed:true},checked:!row.reviewed}});
      syncScanRowReview(row);
      return;
    }
    if(action==='scan-sheet-back') {
      if(state.scanSheetDirty)setScanLeavePrompt(true);else leaveScannedWorksheet();
      return;
    }
    if(action==='scan-sheet-leave-cancel'){setScanLeavePrompt(false);return;}
    if(action==='scan-sheet-leave-discard'){leaveScannedWorksheet();return;}
    if(action==='scan-sheet-source') {
      showScannedSource(Number(button.dataset.page), null, '');
      return;
    }
    const opening=action==='scan-sheet-open';
    if(!opening&&!['scan-sheet-save','scan-sheet-leave-save'].includes(action))return;
    // Keep the worksheet DOM mounted while saving: selection, zoom, pan and table scroll stay intact.
    const enabledControls=opening?[]:Array.from(mount?.querySelectorAll('.scan-review input:not(:disabled), .scan-review select:not(:disabled), .scan-review button:not(:disabled)')||[]);
    state.saving=true;state.message=opening?'Opening scanned BOM review…':'Saving review…';state.messageState='';
    if(opening)renderDetail();
    else { enabledControls.forEach(c=>c.disabled=true); const label=mount?.querySelector('[data-scan-sheet-save-state]');if(label)label.textContent=state.message; }
    try {
      const path='/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId);
      let payload,existing=false;
      if(opening) {
        const fresh=await fetchJson(path);
        existing=!!fresh.record.technicalReview?.scannedBomReview;
        if(!existing&&fresh.scannedBomSource?.setup?.id!==state.selected.scannedBomSource?.setup?.id)throw new Error('The saved setup changed. Reopen Technical Review.');
        state.selected=fresh;if(!existing)payload=scanSheetPayload();
      } else {
        const w=state.scanSheet;
        payload={...scanSheetPayload(true),id:w.id,expectedVersion:w.version,rows:w.rows.map(r=>({position:r.position,rowType:r.rowType,
          values:Object.fromEntries(Object.entries(r.cells).map(([f,c])=>[f,c.value])),sourceNote:r.sourceNote,reviewed:r.reviewed}))};
      }
      state.selected=await fetchJson(path+'/scanned-bom-review',existing?undefined:{method:opening?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      state.scanSheet=JSON.parse(JSON.stringify(state.selected.record.technicalReview.scannedBomReview));
      if(opening) {
        state.scanManualZoom=null;state.scanSourceSelection=null;state.scanCandidateError='';
        try { state.scanLayout=await fetchJson('SRC/workspaces/technical-review/scanned-bom-layout.json'); }
        catch { state.scanLayout=null; }
      }
      state.scanSheetDirty=false;state.scanSheetPage=state.scanSheetPage||state.scanSheet.setup.startPage;
      state.scanLeavePrompt=false;
      const leavePrompt=mount?.querySelector('[data-scan-leave-prompt]');if(leavePrompt)leavePrompt.hidden=true;
      state.step='scanned-review';state.guided=true;state.materials=false;
      state.message=opening?'Worksheet ready. Check the source and correct any values that need review.':'Review saved.';
      if(action==='scan-sheet-leave-save')leaveScannedWorksheet(false);
    }catch(error){state.message=error.message;state.messageState='error';}
    finally{
      state.saving=false;
      syncScannedCandidateToolbar();
      if(opening||state.step!=='scanned-review')renderDetail();
      else {
        enabledControls.forEach(c=>c.disabled=false);
        const label=mount?.querySelector('[data-scan-sheet-save-state]');
        if(label)label.textContent=state.messageState==='error'?state.message+' Your edits are still here.':
          'Saved by '+state.scanSheet.savedBy+' · '+formatDateTime(state.scanSheet.savedAtUtc);
      }
    }
  }
  function setScanLeavePrompt(visible) {
    state.scanLeavePrompt=visible;
    window.requestAnimationFrame?.(sizeScanWorkbench);
    const panel=mount?.querySelector('[data-scan-leave-prompt]');if(panel)panel.hidden=!visible;
    mount?.querySelector('[data-technical-review-action="'+(visible?'scan-sheet-leave-cancel':'scan-sheet-back')+'"]')?.focus();
  }
  function leaveScannedWorksheet(render=true) {
    state.scanSheetDirty=false;state.scanLeavePrompt=false;state.scanSheet=null;
    state.packageDraft=null;state.packageAnswers=null;state.materials=false;
    state.step='inventory';state.message='';state.messageState='';
    if(render)renderDetail();
  }
  // Legacy evidence is reconstructed only from the extraction grid's exact original contract.
  function scannedCellBounds(row, field) {
    const w=state.scanSheet, layout=state.scanLayout;
    let bounds=row.cells[field]?.sourceBounds;
    if(!bounds && layout && w.setup.sha256===layout.sha256 && w.extractionMethod===layout.extractionMethod &&
        w.setup.startPage===3 && w.setup.endPage===5 &&
        JSON.stringify(w.setup.columns.map(c=>c.field))===JSON.stringify(layout.fields)) {
      const grid=layout.pages[row.page], column=layout.fields.indexOf(field);
      if(grid && column>=0 && row.position>=grid.first && row.position<grid.first+grid.count) {
        const i=column<7?column:column+1, a=grid.edges[i], b=grid.edges[i+1];
        const ya=grid.top+(a-grid.edges[0])*grid.slope+(row.position-grid.first)*grid.step;
        const yb=grid.top+(b-grid.edges[0])*grid.slope+(row.position-grid.first)*grid.step;
        bounds={x:a/layout.width,y:Math.min(ya,yb)/layout.height,width:(b-a)/layout.width,height:(grid.step+Math.abs(yb-ya))/layout.height};
      }
    }
    return bounds && [bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite) &&
      bounds.x>=0 && bounds.y>=0 && bounds.width>0 && bounds.height>0 &&
      bounds.x+bounds.width<=1 && bounds.y+bounds.height<=1 ? bounds : null;
  }
  function beginScanEdit(input, replacement) {
    if(state.step!=='scanned-review'||state.saving||!input.dataset?.scanField)return;
    if(state.scanSheet?.rows.find(r=>r.position===Number(input.dataset.scanPosition))?.reviewed)return;
    if(state.scanEdit?.input===input)return;
    finishScanEdit(true);
    state.scanEdit={input,before:input.value};
    input.readOnly=false;input.classList.add('scan-cell-editing');
    input.focus({preventScroll:true});
    if(replacement!==undefined){input.value=replacement;input.setSelectionRange(input.value.length,input.value.length);}
    else input.select();
  }
  function finishScanEdit(commit) {
    const edit=state.scanEdit;if(!edit)return;
    state.scanEdit=null;
    if(!commit)edit.input.value=edit.before;
    edit.input.readOnly=true;edit.input.classList.remove('scan-cell-editing');
    if(commit&&edit.input.value!==edit.before)updateScannedWorksheet({target:edit.input});
  }
  function scanGridKey(event) {
    const input=event.target;
    if(state.step!=='scanned-review'||state.saving||!input.dataset?.scanField||event.isComposing)return;
    const editing=state.scanEdit?.input===input;
    if(editing&&event.key==='Escape'){event.preventDefault();finishScanEdit(false);return;}
    if(!editing&&event.key==='F2'){event.preventDefault();beginScanEdit(input);return;}
    if(!editing&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();beginScanEdit(input,event.key);return;}
    const moves={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
    if(editing&&moves[event.key])return;
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const cells=Array.from(mount.querySelectorAll('input[data-scan-field]'));
    const index=cells.indexOf(input);if(index<0)return;
    const columns=state.scanSheet.setup.columns.filter(c=>c.field!=='IGNORE').length;
    let next=index;
    if(event.key==='Tab') {
      next=index+(event.shiftKey?-1:1);
      if(next<0||next>=cells.length){finishScanEdit(true);return;}
    }
    else if(event.key==='Enter')next=index+(event.shiftKey?-columns:columns);
    else if(moves[event.key]) {
      const [row,column]=moves[event.key];
      if(column && (index%columns+column<0||index%columns+column>=columns)){event.preventDefault();return;}
      next=index+row*columns+column;
    } else return;
    event.preventDefault();finishScanEdit(true);
    if(next<0||next>=cells.length)return;
    cells[next].focus({preventScroll:true});
    keepScanCellVisible(cells[next]);
  }
  function keepScanCellVisible(input) {
    const scroll=mount.querySelector('.scan-review-table-scroll');if(!scroll)return;
    const cell=input.getBoundingClientRect(), area=scroll.getBoundingClientRect();
    const header=scroll.querySelector('thead').getBoundingClientRect().height;
    const source=scroll.querySelector('tbody th').getBoundingClientRect().width;
    if(cell.left<area.left+source)scroll.scrollLeft-=area.left+source-cell.left+8;
    else if(cell.right>area.right-12)scroll.scrollLeft+=cell.right-area.right+12;
    if(cell.top<area.top+header)scroll.scrollTop-=area.top+header-cell.top+8;
    else if(cell.bottom>area.bottom-18)scroll.scrollTop+=cell.bottom-area.bottom+18;
  }
  function focusScannedCell(event) {
    const t=event.target;
    if(state.step!=='scanned-review'||!t.dataset?.scanField)return;
    if(state.scanEdit?.input===t)return;
    const row=state.scanSheet?.rows.find(r=>r.position===Number(t.dataset.scanPosition));if(!row)return;
    mount?.querySelectorAll('.scan-cell-selected').forEach(cell=>cell.classList.remove('scan-cell-selected'));
    t.classList.add('scan-cell-selected');
    const cellKey=row.position+':'+t.dataset.scanField;
    if(state.scanSourceSelection?.cellKey===cellKey)return;
    const bounds=scannedCellBounds(row,t.dataset.scanField);
    showScannedSource(row.page,bounds,bounds?'Position '+row.position+' · '+(scannedFields[t.dataset.scanField]||t.dataset.scanField):'Source location unavailable · Page '+row.page,cellKey);
  }
  function scanSourceActivation(event) {
    if(state.step!=='scanned-review')return;
    const viewer=mount?.querySelector('.scan-review-source');if(!viewer)return;
    const active=viewer.contains(event.target);
    viewer.classList.toggle('scan-source-active',active);
    const label=viewer.querySelector('[data-scan-source-active]');if(label)label.hidden=!active;
    if(active&&event.type==='click'&&!event.target.closest('button,select,a,input'))viewer.focus({preventScroll:true});
  }
  function scanSourceKey(event) {
    const viewer=event.target.closest?.('.scan-review-source.scan-source-active');
    if(state.step!=='scanned-review'||!viewer)return;
    if(event.key==='Escape'){
      viewer.classList.remove('scan-source-active');viewer.querySelector('[data-scan-source-active]').hidden=true;
      event.preventDefault();return;
    }
    if(event.target.closest('select,input')||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='+'||event.key==='-'||event.key==='='){
      event.preventDefault();changeScannedZoom(event.key==='-'?-50:50);
    }
  }
  function scanSourceWheel(event) {
    const viewer=event.currentTarget;
    if(state.step!=='scanned-review'||!viewer.classList.contains('scan-source-active')||!viewer.contains(event.target))return;
    const scroll=viewer.querySelector('.scan-review-source-scroll');
    event.preventDefault();event.stopPropagation();
    if(event.ctrlKey){if(event.deltaY)changeScannedZoom(event.deltaY<0?50:-50);return;}
    const scale=event.deltaMode===1?16:event.deltaMode===2?scroll.clientHeight:1;
    if(event.shiftKey)scroll.scrollLeft+=(event.deltaY||event.deltaX)*scale;
    else {scroll.scrollTop+=event.deltaY*scale;scroll.scrollLeft+=event.deltaX*scale;}
  }
  function changeScannedZoom(delta) {
    const control=mount?.querySelector('[data-scan-sheet-zoom]');
    setScannedZoom(Number(control?.value||100)+delta,true);
  }
  function setScannedZoom(zoom,preserveRegion=false) {
    zoom=Math.max(100,Math.min(1000,zoom));
    if(preserveRegion)state.scanManualZoom=zoom;
    const image=mount?.querySelector('[data-scan-sheet-image]');
    const scroll=mount?.querySelector('.scan-review-source-scroll');
    const bounds=state.scanSourceSelection?.bounds;
    const center=preserveRegion&&image&&scroll?{
      x:bounds?bounds.x+bounds.width/2:(scroll.scrollLeft+scroll.clientWidth/2)/(image.clientWidth||1),
      y:bounds?bounds.y+bounds.height/2:(scroll.scrollTop+scroll.clientHeight/2)/(image.clientHeight||1)
    }:null;
    const canvas=mount?.querySelector('[data-scan-source-canvas]');if(canvas)canvas.style.width=zoom+'%';
    const control=mount?.querySelector('[data-scan-sheet-zoom]');if(control)control.value=String(zoom);
    if(center){
      scroll.scrollLeft=center.x*image.clientWidth-scroll.clientWidth/2;
      scroll.scrollTop=center.y*image.clientHeight-scroll.clientHeight/2;
    }
  }
  function showScannedSource(page,bounds,message,cellKey=null) {
    const image=mount?.querySelector('[data-scan-sheet-image]');if(!image)return;
    const changed=state.scanSheetPage!==page;state.scanSheetPage=page;
    const selection={bounds,cellKey};state.scanSourceSelection=selection;
    const outline=mount.querySelector('[data-scan-source-outline]');outline.hidden=true;
    mount.querySelector('[data-scan-source-location]').textContent=message;
    const link=mount.querySelector('[data-scan-sheet-pdf]');
    link.href=scanSheetBase()+'#page='+page;link.textContent='Open Page '+page+' in a separate tab';
    mount.querySelector('[data-scan-sheet-page-label]').textContent='Source · Page '+page;image.alt='Source page '+page;
    // A newer selection replaces any pending load callback; keyboard focus stays in the input.
    const position=()=>{
      if(!bounds)return;
      const scroll=mount.querySelector('.scan-review-source-scroll');
      if(state.scanSourceSelection!==selection)return;
      setScannedZoom(state.scanManualZoom??(bounds.width>.12?300:bounds.width>.06?400:600));
      Object.assign(outline.style,{left:bounds.x*100+'%',top:bounds.y*100+'%',width:bounds.width*100+'%',height:bounds.height*100+'%'});
      outline.hidden=false;
      window.requestAnimationFrame(()=>{
        if(state.scanSourceSelection!==selection||!image.isConnected)return;
        scroll.scrollLeft=(bounds.x+bounds.width/2)*image.clientWidth-scroll.clientWidth/2;
        scroll.scrollTop=(bounds.y+bounds.height/2)*image.clientHeight-scroll.clientHeight/2;
      });
    };
    image.onload=position;
    image.onerror=()=>{outline.hidden=true;mount.querySelector('[data-scan-source-location]').textContent='Source preview unavailable';};
    if(changed){setScannedZoom(state.scanManualZoom??100);image.src=scanSheetBase()+'/pages/'+page;}
    else if(image.complete&&image.naturalWidth)position();
    if(!bounds){setScannedZoom(state.scanManualZoom??100);const scroll=mount.querySelector('.scan-review-source-scroll');scroll.scrollTop=0;scroll.scrollLeft=0;}
  }
  function updateScannedWorksheet(event) {
    if(state.step!=='scanned-review'||state.saving||!state.scanSheet)return;
    const t=event.target;
    if(state.scanEdit?.input===t)return;
    if(t.dataset.scanSheetZoom){setScannedZoom(Number(t.value),true);return;}
    if(t.dataset.scanPosition===undefined)return;
    const row=state.scanSheet.rows.find(r=>r.position===Number(t.dataset.scanPosition));if(!row)return;
    if(row.reviewed && t.dataset.scanReviewed===undefined)return;
    if(t.dataset.scanField&&row.cells[t.dataset.scanField]){if(row.cells[t.dataset.scanField].value===t.value)return;row.cells[t.dataset.scanField].value=t.value;row.cells[t.dataset.scanField].status='CORRECTED';row.reviewed=false;}
    else if(t.dataset.scanRowType!==undefined){if(row.rowType===t.value)return;row.rowType=t.value;row.reviewed=false;}
    else if(t.dataset.scanNote!==undefined){if(row.sourceNote===t.value)return;row.sourceNote=t.value;row.reviewed=false;}
    else if(t.dataset.scanReviewed!==undefined){if(row.reviewed===t.checked)return;row.reviewed=t.checked;}
    else return;
    state.scanSheetDirty=true;
    const tr=t.closest?.('tr');const reviewBox=tr?.querySelector('[data-scan-reviewed]');if(reviewBox)reviewBox.checked=row.reviewed;
    const status=tr?.querySelector('[data-scan-row-status]');if(status)status.textContent=row.reviewed?'Reviewed':'Needs Review';
    t.classList?.remove('scan-cell-uncertain');
    syncScannedCandidateToolbar();
    const saved=mount?.querySelector('[data-scan-sheet-save-state]');if(saved)saved.textContent='Unsaved changes';
  }
  function syncScanRowReview(row) {
    const button=mount?.querySelector('[data-technical-review-action="scan-sheet-row-review"][data-scan-position="'+row.position+'"]');
    const tr=button?.closest('tr');if(!tr)return;
    button.textContent=row.reviewed?'Edit':'Accept';
    button.setAttribute('aria-label',(row.reviewed?'Edit':'Accept')+' transcription row '+row.position);
    tr.querySelector('[data-scan-row-status]').textContent=row.reviewed?'Reviewed':'Needs Review';
    tr.querySelectorAll('[data-scan-field]').forEach(input=>{input.readOnly=true;input.classList.toggle('scan-cell-locked',row.reviewed);input.classList.toggle('scan-cell-uncertain',!row.reviewed&&!['CORRECTED','SOURCE_POSITION'].includes(row.cells[input.dataset.scanField].status));input.title=row.reviewed?'Reviewed transcription — use Edit to unlock this row':'Select to compare with source; F2 or double-click to edit';});
    tr.querySelectorAll('[data-scan-row-type], [data-scan-note]').forEach(input=>input.disabled=row.reviewed);
  }
  function sizeScanWorkbench() {
    if(state.step!=='scanned-review')return;
    const sheet=mount?.querySelector('.scan-review'), layout=sheet?.querySelector('.scan-review-layout');
    if(!layout)return;
    const appHeader=document.querySelector('body > header.dle-app-header');
    const headerHeight=appHeader?.getBoundingClientRect().height||0;
    sheet.style.setProperty('--scan-app-header-height',headerHeight+'px');
    const toolbarHeight=sheet.querySelector('.scan-review-toolbar').getBoundingClientRect().height;
    sheet.style.setProperty('--scan-toolbar-height',toolbarHeight+'px');
    sheet.style.setProperty('--scan-work-height',Math.max(240,window.innerHeight-layout.getBoundingClientRect().top-12)+'px');
  }
  function watchScanWorkbench() {
    mount?.querySelector(".scan-review-source")?.addEventListener("wheel",scanSourceWheel,{passive:false});
    window.requestAnimationFrame?.(sizeScanWorkbench);
    if(!window.ResizeObserver)return;
    scanWorkbenchObserver ||= new window.ResizeObserver(sizeScanWorkbench);
    for(const element of [document.querySelector('body > header.dle-app-header'),...mount.querySelectorAll('.scan-review > header, .scan-review-toolbar, .scan-leave-prompt')]) {
      if(element)scanWorkbenchObserver.observe(element);
    }
  }
  window.addEventListener?.('resize',sizeScanWorkbench);
  const scanWidthPreference='dle.scanned-bom.column-widths.v1';
  let scanColumnWidths=null, scanColumnDrag=null;
  function scanColumnDefault(field) {
    return ({FIND_NUMBER:76,QUANTITY:76,UNIT:76,CUSTOMER_PART_NUMBER:173,REFERENCE_DESIGNATORS:178,DESCRIPTION:298,ROW_TYPE:120,SOURCE_NOTE:298})[field]||148;
  }
  function scanColumnMinimum(field) {
    return ['FIND_NUMBER','QUANTITY','UNIT'].includes(field)?64:field==='DESCRIPTION'||field==='SOURCE_NOTE'?160:100;
  }
  function scanColumnWidth(field) {
    if(scanColumnWidths===null){try{scanColumnWidths=JSON.parse(window.localStorage?.getItem(scanWidthPreference)||'{}');}catch{scanColumnWidths={};}
      if(!scanColumnWidths||typeof scanColumnWidths!=='object'||Array.isArray(scanColumnWidths))scanColumnWidths={};}
    const value=scanColumnWidths[field];
    return Number.isFinite(value)?Math.max(scanColumnMinimum(field),Math.min(1200,value)):scanColumnDefault(field);
  }
  function saveScanColumnWidths(){try{window.localStorage?.setItem(scanWidthPreference,JSON.stringify(scanColumnWidths));}catch{/* Keep session preferences when storage is unavailable. */}}
  function scanColumnHeader(field,label) {
    return '<th scope="col">'+escapeHtml(label)+'<span class="scan-column-resize" data-scan-resize="'+field+'" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize '+escapeHtml(label)+' column" aria-valuemin="'+scanColumnMinimum(field)+'" aria-valuemax="1200" aria-valuenow="'+scanColumnWidth(field)+'" title="Drag to resize; arrow keys adjust width"></span></th>';
  }
  function applyScanColumnWidths() {
    const table=mount?.querySelector('.scan-review-table');if(!table)return;
    let total=132;
    table.querySelectorAll('col[data-scan-column]').forEach(col=>{const width=scanColumnWidth(col.dataset.scanColumn);col.style.width=width+'px';total+=width;});
    table.style.width=total+'px';
    mount.querySelectorAll('[data-scan-resize]').forEach(handle=>handle.setAttribute('aria-valuenow',scanColumnWidth(handle.dataset.scanResize)));
  }
  function startScanColumnResize(event) {
    const handle=event.target.closest?.('[data-scan-resize]');
    if(!handle||state.step!=='scanned-review'||event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    scanColumnDrag={handle,id:event.pointerId,x:event.clientX,field:handle.dataset.scanResize,width:scanColumnWidth(handle.dataset.scanResize)};
    handle.setPointerCapture(event.pointerId);
    mount.querySelector('.scan-review-table').classList.add('scan-column-dragging');
  }
  function moveScanColumnResize(event) {
    const drag=scanColumnDrag;if(!drag||event.pointerId!==drag.id)return;
    event.preventDefault();
    scanColumnWidths[drag.field]=Math.max(scanColumnMinimum(drag.field),Math.min(1200,Math.round(drag.width+event.clientX-drag.x)));
    applyScanColumnWidths();
  }
  function endScanColumnResize(event) {
    const drag=scanColumnDrag;if(!drag||event.pointerId!==drag.id)return;
    scanColumnDrag=null;
    if(drag.handle.hasPointerCapture(drag.id))drag.handle.releasePointerCapture(drag.id);
    mount?.querySelector('.scan-review-table')?.classList.remove('scan-column-dragging');
    saveScanColumnWidths();
  }
  function scanColumnResizeKey(event) {
    const field=event.target.dataset?.scanResize;if(!field)return;
    if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const width=scanColumnWidth(field);
    scanColumnWidths[field]=event.key==='Home'?scanColumnDefault(field):Math.max(scanColumnMinimum(field),Math.min(1200,width+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?32:16)));
    applyScanColumnWidths();saveScanColumnWidths();
  }
  function renderScannedWorksheet() {
    const w=state.scanSheet;if(!w)return '';
    const disabled=state.saving?'disabled':'';
    const columns=w.setup.columns.filter(c=>c.field!=='IGNORE');
    const widthFields=columns.map(c=>c.field);
    const tableWidth=132+widthFields.reduce((sum,field)=>sum+scanColumnWidth(field),0);
    const colgroup='<colgroup><col style="width:132px">'+widthFields.map(field=>'<col data-scan-column="'+field+'" style="width:'+scanColumnWidth(field)+'px">').join('')+'</colgroup>';
    const earlierSetup=w.setup.id!==state.selected.scannedBomSource?.setup?.id;
    const rows=w.rows.map(r=>'<tr><th scope="row"><strong>'+r.position+'</strong><small data-scan-row-status>'+(r.reviewed?'Reviewed':'Needs Review')+'</small><button type="button" '+disabled+' data-technical-review-action="scan-sheet-row-review" data-scan-position="'+r.position+'" aria-label="'+(r.reviewed?'Edit':'Accept')+' transcription row '+r.position+'" title="Accept means this row was transcribed correctly from the scanned customer BOM.">'+(r.reviewed?'Edit':'Accept')+'</button><details class="scan-row-details"><summary>Details</summary><div><label>Row Type<select '+(state.saving||r.reviewed?'disabled':'')+' aria-label="Position '+r.position+' Row Type" data-scan-position="'+r.position+'" data-scan-row-type>'+Object.entries(scanRowTypes).map(([key,label])=>'<option value="'+key+'" '+(r.rowType===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label><label>Source note<input '+(state.saving||r.reviewed?'disabled':'')+' aria-label="Position '+r.position+' Source note" data-scan-position="'+r.position+'" data-scan-note maxlength="2000" value="'+escapeHtml(r.sourceNote)+'"></label></div></details></th>'+
      columns.map(c=>{const cell=r.cells[c.field],pending=!r.reviewed&&!['CORRECTED','SOURCE_POSITION'].includes(cell.status);return '<td><input readonly '+disabled+' class="'+(r.reviewed?'scan-cell-locked':pending?'scan-cell-uncertain':'')+'" aria-label="Position '+r.position+' '+escapeHtml(scannedFields[c.field]||c.header)+'" data-scan-position="'+r.position+'" data-scan-field="'+c.field+'" maxlength="1000" value="'+escapeHtml(cell.value)+'" placeholder="Not read" title="'+escapeHtml(r.reviewed?'Reviewed transcription — use Edit to unlock this row':pending?'Needs Review — compare with the source':cell.status==='SOURCE_POSITION'?'Source position verified from the scan; text remains editable':'Reviewer correction')+'"></td>';}).join('')+'</tr>').join('');
    return '<section class="scan-review"><header><h2>Scanned BOM Review</h2><p class="scan-review-instruction">Copy exactly as written. Fix anything that was not transcribed correctly.</p><p class="scan-review-context">'+escapeHtml(w.intakeId)+' · Pages '+w.setup.startPage+'–'+w.setup.endPage+' · '+w.rows.length+' rows</p></header>'+
      '<div class="scan-review-toolbar"><button type="button" class="technical-review-primary" data-technical-review-action="scan-sheet-save" '+disabled+'>Save Review</button><button type="button" data-technical-review-action="scan-sheet-back" '+disabled+'>Back</button><button type="button" class="scan-reset-widths" data-technical-review-action="scan-sheet-reset-widths">Reset Widths</button>'+
      (earlierSetup?'<details class="scan-earlier-setup"><summary>Earlier setup ⓘ</summary><p>This worksheet uses its original saved mapping and source.</p></details>':'')+
      '<span class="scan-candidate-toolbar" data-scan-candidate-toolbar>'+scannedCandidateToolbar()+'</span><span role="status" data-scan-sheet-save-state>'+(state.scanSheetDirty?'Unsaved changes':'Saved by '+escapeHtml(w.savedBy)+' · '+escapeHtml(formatDateTime(w.savedAtUtc)))+'</span></div>'+
      '<div class="scan-leave-prompt" data-scan-leave-prompt role="group" aria-label="Unsaved worksheet changes" hidden><p>You have unsaved worksheet changes.</p><button type="button" class="technical-review-primary" data-technical-review-action="scan-sheet-leave-save">Save &amp; Leave</button> <button type="button" data-technical-review-action="scan-sheet-leave-discard">Leave Without Saving</button> <button type="button" data-technical-review-action="scan-sheet-leave-cancel">Cancel</button></div>'+
      (state.messageState==='error'?packageMessage():'')+
      '<div class="scan-review-layout"><div class="scan-review-table-scroll" tabindex="0" aria-label="Editable scanned BOM worksheet"><table class="scan-review-table" style="width:'+tableWidth+'px">'+colgroup+'<thead><tr><th scope="col">Source</th>'+columns.map(c=>scanColumnHeader(c.field,scannedFields[c.field]||c.header)).join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<aside class="scan-review-source" tabindex="0" aria-label="Source viewer" title="Click viewer to activate. Ctrl+wheel zooms; Shift+wheel pans horizontally."><span class="scan-source-active-label" data-scan-source-active hidden>Source Viewer Active</span><h3 data-scan-sheet-page-label>Source · Page '+state.scanSheetPage+'</h3><div>'+Array.from({length:w.setup.endPage-w.setup.startPage+1},(_,i)=>'<button type="button" data-technical-review-action="scan-sheet-source" data-page="'+(w.setup.startPage+i)+'">Page '+(w.setup.startPage+i)+'</button>').join(' ')+' <label>Zoom <select data-scan-sheet-zoom="true">'+Array.from({length:19},(_,i)=>'<option>'+(100+i*50)+'</option>').join('')+'</select>%</label></div><p class="scan-review-help" data-scan-source-location role="status">Select a worksheet cell to view its source.</p><div class="scan-review-source-scroll"><div data-scan-source-canvas><img data-scan-sheet-image alt="Source page '+state.scanSheetPage+'" src="'+scanSheetBase()+'/pages/'+state.scanSheetPage+'"><span data-scan-source-outline hidden></span></div></div><a data-scan-sheet-pdf target="_blank" rel="noopener" href="'+scanSheetBase()+'#page='+state.scanSheetPage+'">Open Page '+state.scanSheetPage+' in a separate tab</a></aside></div></section>';
  }
  function scannedMainBom() {
    const record=state.selected?.record;
    const id=state.packageDraft ? state.packageDraft.governingBomDocumentId : record?.technicalReview?.technicalPackage?.governingBomDocumentId;
    const file=record?.technicalFiles?.find(f=>f.documentId===id);
    const source=state.selected?.scannedBomSource;
    return file?.readability?.status==='IMAGE_ONLY' || (source?.documentId===id && source?.readability?.status==='IMAGE_ONLY');
  }
  function scannedSetupPrompt(issue) {
    const source=state.selected?.scannedBomSource, setup=source?.setup;
    const selectedId=state.packageDraft ? state.packageDraft.governingBomDocumentId : state.selected?.record?.technicalReview?.technicalPackage?.governingBomDocumentId;
    const ready=setup && !source.needsConfirmation && source.documentId===selectedId;
    return '<section class="scanned-bom-notice"><h4>'+(ready?'Scanned BOM Setup Ready':'Scanned BOM — Setup Required')+'</h4><p>'+
      (ready?'Pages '+setup.startPage+'–'+setup.endPage+' · '+setup.columns.filter(c=>c.field!=='IGNORE').length+' mapped columns':'This PDF is image-based. Identify the BOM table so DLE-OS can read it locally.')+'</p>'+
      (source?.needsConfirmation?'<p>The source changed. Confirm the pages and columns again before using this setup.</p>':'')+
      '<button type="button" class="technical-review-primary" data-technical-review-action="scan-open" '+(state.saving||addingDocuments||issue?'disabled':'')+'>'+(ready?'Review BOM Setup':'Set Up BOM Extraction')+'</button>'+
      (ready?'<p><button type="button" class="technical-review-primary" data-technical-review-action="scan-sheet-open" '+(state.saving||addingDocuments||issue?'disabled':'')+'>'+(state.selected.record.technicalReview?.scannedBomReview?'Open Scanned BOM Review':'Read BOM')+'</button></p>':'')+'</section>';
  }
  async function openScannedSetup(savePackage) {
    if(state.saving)return;
    if(savePackage) { await saveUnifiedPackage(true,true); if(state.messageState==='error')return; }
    state.saving=true;
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId));
      const source=state.selected.scannedBomSource;
      if(source?.readability?.status!=='IMAGE_ONLY')throw new Error('Select and save a scanned Main BOM PDF first.');
      const saved=source.setup;
      state.scannedDraft={startPage:saved?.startPage||1,endPage:saved?.endPage||1,columns:saved?JSON.parse(JSON.stringify(saved.columns)):[{header:'',field:''}],page:1,zoom:100};
      state.scannedSummary=false; state.step='scanned-setup';state.guided=true;state.message='';state.messageState='';
    }catch(error){state.message=error.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }
  function scannedViewerUrl() {
    const r=state.selected.record,d=state.scannedDraft;
    return '/api/sim/rfq-intakes/'+encodeURIComponent(r.intakeId)+'/documents/'+encodeURIComponent(state.selected.scannedBomSource.documentId)+'#page='+d.page+'&zoom='+d.zoom;
  }
  function scannedPageUrl() { return scannedViewerUrl().split('#')[0]+'/pages/'+state.scannedDraft.page; }
  function scannedSetupIssue() {
    const d=state.scannedDraft, count=state.selected.scannedBomSource.readability.pageCount;
    if(!Number.isInteger(d.startPage)||!Number.isInteger(d.endPage)||d.startPage<1||d.endPage<d.startPage||d.endPage>count)return 'Choose a valid start and end page.';
    if(!d.columns.length || d.columns.some(c=>!c.header.trim()||!scannedFields[c.field]))return 'Give each column a drawing header and a meaning.';
    const fields=d.columns.filter(c=>c.field!=='IGNORE').map(c=>c.field);
    if(!fields.includes('CUSTOMER_PART_NUMBER')||!fields.includes('QUANTITY'))return 'Map Customer P/N and Qty before saving.';
    if(new Set(fields).size!==fields.length)return 'Use each meaning only once, except Ignore.';
    for(let i=1;i<=3;i++)if(fields.includes('MANUFACTURER_IDENTITY_'+i)&&(fields.includes('MANUFACTURER_'+i)||fields.includes('MANUFACTURER_PART_NUMBER_'+i)))return 'Choose combined or separate manufacturer columns for each source.';
    return '';
  }
  function renderScannedSetup() {
    const d=state.scannedDraft,source=state.selected.scannedBomSource, disabled=state.saving?'disabled':'';
    const rows=d.columns.map((c,i)=>'<div class="scanned-column"><span>'+(i+1)+'</span><input aria-label="Drawing header '+(i+1)+'" data-scan-column="'+i+'" data-scan-value="header" maxlength="120" value="'+escapeHtml(c.header)+'" placeholder="Visible drawing header"><select aria-label="What does column '+(i+1)+' mean?" data-scan-column="'+i+'" data-scan-value="field"><option value="">Choose meaning</option>'+Object.entries(scannedFields).map(([key,label])=>'<option value="'+key+'" '+(c.field===key?'selected':'')+'>'+label+'</option>').join('')+'</select><button type="button" aria-label="Remove column '+(i+1)+'" data-technical-review-action="scan-remove" data-column="'+i+'">×</button></div>').join('');
    const summary='<h3>BOM Setup Ready</h3><p>Pages: '+d.startPage+'–'+d.endPage+' · '+d.columns.filter(c=>c.field!=='IGNORE').length+' mapped columns</p><ol>'+d.columns.map(c=>'<li>'+escapeHtml(c.header)+' → '+escapeHtml(scannedFields[c.field])+'</li>').join('')+'</ol><p>This saves the pages and columns. Next, use Read BOM to open the editable review worksheet.</p><button type="button" class="technical-review-primary" data-technical-review-action="scan-save" '+disabled+'>Save BOM Setup</button> <button type="button" data-technical-review-action="scan-edit" '+disabled+'>Edit setup</button>';
    return '<section class="scanned-setup"><h2>Set Up BOM Extraction</h2><div class="scanned-setup-layout"><div class="scanned-viewer"><label>View page <input type="number" data-scan-prop="page" min="1" max="'+source.readability.pageCount+'" value="'+d.page+'"></label><span> of '+source.readability.pageCount+'</span> <label>Zoom <select data-scan-prop="zoom">'+[75,100,125,150,200].map(z=>'<option '+(z===d.zoom?'selected':'')+' value="'+z+'">'+z+'%</option>').join('')+'</select></label><div class="scanned-page-scroll"><img alt="Scanned Main BOM PDF page '+d.page+'" src="'+scannedPageUrl()+'" style="width:'+d.zoom+'%"></div><a target="_blank" rel="noopener" href="'+scannedViewerUrl()+'">Open PDF in a separate tab</a></div><div class="scanned-panel"><fieldset '+disabled+'>'+
      (state.scannedSummary?summary:'<h3>1. Which pages contain the BOM?</h3><label>Start page <input type="number" data-scan-prop="startPage" min="1" max="'+source.readability.pageCount+'" value="'+d.startPage+'"></label><label>End page (same page if no continuation) <input type="number" data-scan-prop="endPage" min="1" max="'+source.readability.pageCount+'" value="'+d.endPage+'"></label><h3>2. Tell DLE-OS what each BOM column means.</h3><p>Add columns from left to right. Repeated headers are allowed. Use Combined MFG identity when manufacturer and P/N share a column.</p>'+rows+'<button type="button" data-technical-review-action="scan-add" '+(d.columns.length>=32?'disabled':'')+'>+ Add column</button><p><button type="button" class="technical-review-primary" data-technical-review-action="scan-review">Review Setup</button></p>')+
      '</fieldset>'+packageMessage()+'<button type="button" data-technical-review-action="scan-back" '+disabled+'>Back to Technical Package Review</button></div></div></section>';
  }
  function updateScannedSetup(event) {
    if(state.step!=='scanned-setup'||state.saving||!state.scannedDraft)return;
    const t=event.target,d=state.scannedDraft;
    if(t.dataset.scanProp) {
      const prop=t.dataset.scanProp;
      if(!['startPage','endPage','page','zoom'].includes(prop))return;
      d[prop]=Number(t.value);
      if(['page','zoom'].includes(prop)&&d.page>=1&&d.page<=state.selected.scannedBomSource.readability.pageCount) {
        const image=mount?.querySelector('.scanned-viewer img');if(image){if(prop==='page')image.src=scannedPageUrl();image.style.width=d.zoom+'%';}
      }
    }
    if(t.dataset.scanColumn!==undefined&&['header','field'].includes(t.dataset.scanValue)) {
      const c=d.columns[Number(t.dataset.scanColumn)];if(c)c[t.dataset.scanValue]=t.value;
    }
  }
  async function scannedSetupAction(action,button) {
    if(state.saving)return;
    if(action==='scan-open')return openScannedSetup(!!state.selected.record.technicalReview?.workflow);
    if(action==='scan-back'){state.scannedDraft=null;enterPackage();return;}
    const d=state.scannedDraft;if(!d)return;
    state.message='';state.messageState='';
    if(action==='scan-add'&&d.columns.length<32)d.columns.push({header:'',field:''});
    if(action==='scan-remove')d.columns.splice(Number(button.dataset.column),1);
    if(action==='scan-edit')state.scannedSummary=false;
    if(action==='scan-review'||action==='scan-save') {
      const issue=scannedSetupIssue();if(issue){state.message=issue;state.messageState='error';renderDetail();return;}
      state.scannedSummary=true;
    }
    if(action==='scan-save') {
      state.saving=true;renderDetail();
      try {
        const source=state.selected.scannedBomSource;
        state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/scanned-bom-setup',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId:source.documentId,sha256:source.sha256,expectedReviewToken:state.selected.packageReviewToken,expectedSetupId:source.setup?.id||null,startPage:d.startPage,endPage:d.endPage,columns:d.columns})});
        state.scannedDraft=null;state.packageDraft=null;state.step='inventory';state.materials=false;state.message='Scanned BOM Setup Ready';
      }catch(error){state.message=error.message;state.messageState='error';}
      finally{state.saving=false;}
    }
    renderDetail();
  }
  let releaseReadiness = null;
  function renderPackageRelease() {
    const r=state.selected.record, c=packageCandidateState();
    if(r.technicalReview.materialsReviewStatus !== 'QUALIFIED' || c.active) return '';
    if(c.dirty || c.pendingReview) return '<p>Accept and save the package changes before release.</p>';
    const key=r.intakeId+':'+state.selected.packageReviewToken;
    if(releaseReadiness?.key !== key) {
      releaseReadiness={key, pending:true};
      fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(r.intakeId)+'/release-readiness')
        .then(result=>{if(releaseReadiness?.key===key)releaseReadiness={key,...result};})
        .catch(error=>{if(releaseReadiness?.key===key)releaseReadiness={key,ready:false,message:error.message};})
        .finally(()=>{if(state.selected?.record?.intakeId===r.intakeId && state.step==='inventory')renderDetail();});
    }
    const accepted=(r.technicalReview.bomAcceptances || []).findLast(a=>a.candidate.id===r.technicalReview.candidateBom?.id);
    const bom=accepted ? '<div><h5>Accepted BOM</h5><p class="release-bom-meta">Version '+accepted.version+' · Accepted by '+escapeHtml(accepted.reviewedBy)+' · '+escapeHtml(formatDateTime(accepted.reviewedAtUtc))+'</p><button type="button" class="technical-review-secondary" data-technical-review-action="accepted-bom" data-accepted-version="'+accepted.version+'">View Accepted BOM</button></div>' : '';
    const ready=releaseReadiness.ready===true;
    return '<section class="technical-review-card technical-review-release"><h4>'+(ready?'Technical Review Ready':'Technical Review Submission')+'</h4><div class="release-summary">'+bom+'<div><h5>Technical Package</h5><p>'+(ready?'Ready':'Awaiting release validation')+'</p></div></div>'+
      (releaseReadiness.pending?'<p role="status">Checking release readiness…</p>':!ready?'<p role="alert">'+escapeHtml(releaseReadiness.message)+'</p>':'<p>Submit the reviewed technical package and accepted BOM to the RFQ workspace for Materials and Labor quotation.</p>'+flowButton('Submit to RFQs','COMPLETE'))+'</section>';
  }

  function renderUnifiedPackage() {
    const pack=unifiedPackageDraft(), docs=pack.documents, answers=packageAnswers(), record=state.selected.record;
    const disabled=state.saving?'disabled':'';
    const editableSelect=(label,attribute,options,value)=>'<select aria-label="'+escapeHtml(label)+'" '+attribute+' '+disabled+'>'+Object.entries(options).map(([k,v])=>'<option value="'+k+'" '+(k===value?'selected':'')+'>'+v+'</option>').join('')+'</select>';
    const rows=docs.map((d,i)=>{
      const f=record.technicalFiles.find(f=>f.documentId===d.documentId), choice=identityChanges[d.documentId],locked=packageRowLocked(d);
      const select=(label,attribute,options,value)=>locked?escapeHtml(options[value]||'—'):editableSelect(label,attribute,options,value);
      const view=f?.binaryStatus==='VERIFIED'?'<a target="'+(f.type==='application/pdf'?'_blank':'_self')+'" rel="noopener noreferrer" href="/api/sim/rfq-intakes/'+encodeURIComponent(record.intakeId)+'/documents/'+encodeURIComponent(d.documentId)+'">View File</a>':'<small>File unavailable</small>';
      let identity=locked?escapeHtml(identityLabels[identityType(d)]):editableSelect('Classification for '+d.name,'data-identity-type',identityLabels,choice?.type||identityType(d))+((choice?.type||identityType(d))==='OTHER'?'<input aria-label="Other description for '+escapeHtml(d.name)+'" data-identity-other maxlength="500" value="'+escapeHtml(choice?.otherDescription||d.identityReview?.otherDescription||'')+'">':'');
      if(bomBearing(d))identity+='<label class="package-pn-question" title="What kind of part number is shown in the BOM&#39;s main P/N field?">BOM P/N Type: '+select('BOM P/N Type for '+d.name,'data-pn-field="basis"',{'':'Select type',...pnLabels},d.partNumberReview?.basis||'')+'</label>';
      const production={NOT_FOR_PRODUCTION:'Not for Production',SUPPORTING_PRODUCTION:'Supporting Production Doc'};
      if(!d.rowAssociation&&d.documentType==='ASSEMBLY_DRAWING'&&d.applicability==='PARENT_ASSEMBLY')production.PRIMARY_DRAWING='Main Production Drawing';
      const bom={NO_BOM_ROLE:'Not for Materials'};
      if(bomBearing(d))bom.SUPPORTING_BOM='Supporting BOM';
      if(!d.rowAssociation&&isBomSource(d)&&d.applicability==='PARENT_ASSEMBLY')bom.GOVERNING_BOM='Main BOM';
      const context=(f?.readability?'<small>Document Readability: '+escapeHtml(({IMAGE_ONLY:'Scanned / image-only',TEXT_READABLE:'Text-readable',MIXED:'Mixed',UNKNOWN:'Unable to determine'})[f.readability.status]||'Unable to determine')+'</small>':'')+'<details class="package-row-context"><summary>Details</summary><small>Source: '+(f?.reviewOrigin?'Technical Review':'Intake')+' · '+escapeHtml(d.documentId)+'</small><small>Intake identified: '+escapeHtml(identityLabels[f?.initialIdentification?.type]||'Not provided')+'</small>'+
        (d.identityReview?'<small>'+(d.identityReview.reviewedBy?escapeHtml(d.identityReview.reviewedBy)+' · '+escapeHtml(formatDateTime(d.identityReview.reviewedAtUtc)):'Unsaved review')+'</small>':'')+
        (d.rowAssociation?'<small>Scope inherited from BOM row '+(d.rowAssociation.rowIndex+1)+' · '+escapeHtml(d.rowAssociation.customerBomPartNumber)+'</small>':'')+
        (d.applicability==='SUBASSEMBLY'?'<label>Customer / BOM P/N<input data-package-field="subassemblyPartNumber" maxlength="120" value="'+escapeHtml(d.subassemblyPartNumber)+'" '+(d.rowAssociation||locked?'readonly':'')+' '+disabled+'></label><label>DLE proposed subassembly identity<input data-package-field="proposedSubassemblyIdentity" maxlength="120" value="'+escapeHtml(d.proposedSubassemblyIdentity)+'" '+(d.rowAssociation||locked?'readonly':'')+' '+disabled+'></label>':'')+
        (f?.reviewOrigin?'<small>Added by '+escapeHtml(f.reviewOrigin.addedBy)+' · '+escapeHtml(formatDateTime(f.reviewOrigin.addedAtUtc))+'</small><small>'+escapeHtml(f.reviewOrigin.note||'')+'</small>':'')+'</details>';
      return '<tr data-package-row="'+i+'"><th scope="row"><span>'+escapeHtml(d.name)+'</span><div>'+view+'</div>'+context+'</th><td>'+identity+'</td><td>'+(d.rowAssociation?escapeHtml(applicability[d.applicability]):select('Applies to for '+d.name,'data-package-field="applicability"',applicability,d.applicability))+'</td><td>'+select('Production Use for '+d.name,'data-package-use="productionUse"',production,d.productionUse)+'</td><td>'+select('Materials Use for '+d.name,'data-package-use="bomUse"',bom,d.bomUse)+'</td><td>'+select('Manufacturer P/N source for '+d.name,'data-pn-field="providesManufacturerPartNumbers" title="Does this document show the manufacturer&#39;s P/N in a dedicated field or column?"',{'':'Not Reviewed',yes:'Yes',no:'No'},d.partNumberReview?.providesManufacturerPartNumbers==null?'':d.partNumberReview.providesManufacturerPartNumbers?'yes':'no')+'</td><td>'+(locked?'Accepted':'Needs Review')+'<div class="package-row-actions"><button data-technical-review-action="'+(locked?'identity-change':'accept-package-row')+'" '+disabled+'>'+(locked?'Edit':identityReviewed(d)?'Accept Changes':'Accept')+'</button></div>'+(packageRowErrors[d.documentId]?'<small role="alert">'+escapeHtml(packageRowErrors[d.documentId])+'</small>':'')+'</td></tr>';
    }).join('');
    const summary=(heading,rolesFor)=>{
      const rows=(record.technicalReview.technicalPackage?.documents||[]).filter(d=>identityReviewed(d)&&!packageRowIssue(d)).map(d=>{const roles=rolesFor(unifiedPackageDraft({documents:[{...d}],governingBomDocumentId:record.technicalReview.technicalPackage.governingBomDocumentId}).documents[0]);return roles.length?'<li><span class="package-summary-name">'+escapeHtml(d.name)+'</span><span class="package-summary-roles">'+roles.map(escapeHtml).join(' · ')+'</span></li>':'';}).join('');
      return '<section><h4>'+heading+'</h4>'+(rows?'<ul class="package-summary-list">'+rows+'</ul>':'<p class="package-summary-empty">None selected</p>')+'</section>';
    };
    const issue=unifiedPackageIssue(), unsupported=pack.governingBomDocumentId&&!packageCanBuild();
    return '<section class="technical-review-question package-review-table unified-package-review"><div class="package-review-heading"><div><h3>Technical Package Review</h3><p>'+docs.length+' files received · '+docs.filter(packageRowLocked).length+' accepted · '+docs.filter(d=>!packageRowLocked(d)).length+' need review</p></div>'+((window.DleOsCapabilities?.can?.("technical_review.disposition")===true && ['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(record.status))?'<button type="button" class="technical-review-secondary" data-technical-review-action="add-document" '+(state.saving||addingDocuments?'disabled':'')+'>+ Add Document</button>':'')+'</div>'+renderReviewUploads()+'<div class="package-table-scroll"><table><thead><tr>'+['Document','What is it?','Applies To','Production Use','Materials Use','MFG P/N Source','Status'].map(x=>'<th scope="col">'+(x==='MFG P/N Source'?'<span class="package-help" tabindex="0" title="Does this document show the manufacturer&#39;s P/N in a dedicated field or column?">'+x+' <span aria-hidden="true">ⓘ</span><span class="package-help-text" role="tooltip">Does this document show the manufacturer&#39;s P/N in a dedicated field or column?</span></span>':x)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="package-authority-summary">'+summary('Production',d=>d.productionUse==='PRIMARY_DRAWING'?['Main Drawing']:d.productionUse==='SUPPORTING_PRODUCTION'?['Supporting']:[])+summary('Materials',d=>[...(d.bomUse==='GOVERNING_BOM'?['Main BOM']:d.bomUse==='SUPPORTING_BOM'?['Supporting BOM']:[]),...(d.partNumberReview?.providesManufacturerPartNumbers===true?['MFG P/N Source']:[])])+'</div>'+
      '<section class="package-history"><h4>Assembly History</h4><p>Coming soon</p><button type="button" disabled>View Assembly History</button><p class="technical-review-inline-note">Prior revision and build history will be available here in a future release.</p></section>'+
      '<fieldset class="package-completeness" '+disabled+'><legend>Is the technical package complete enough to proceed, including the documents Production needs?</legend><label><input name="packageComplete" type="radio" value="yes" '+(answers.complete==='yes'?'checked':'')+'> Yes</label><label><input name="packageComplete" type="radio" value="no" '+(answers.complete==='no'?'checked':'')+'> No</label>'+
      (answers.complete==='no'?'<label class="package-missing">What is missing?<textarea id="packageMissing" maxlength="1000">'+escapeHtml(answers.missing)+'</textarea></label><button class="technical-review-primary" data-technical-review-action="hold-package" '+(state.saving||addingDocuments?'disabled':'')+'>Place On Hold</button>':answers.complete==='yes'?(issue?'<p role="alert">'+escapeHtml(issue)+'</p>':'')+(unsupported?'<p role="note">These document roles can be saved. Candidate BOM extraction currently requires the Main BOM to be embedded in a Main Assembly PDF drawing; extraction from a standalone XLS Main BOM is not supported.</p>':'')+packageBuildAction(unsupported, issue):'')+'</fieldset><div id="technicalReviewAnalysisProgress">'+renderAnalysisProgress()+'</div>'+renderPackageRelease()+packageMessage()+'<button class="technical-review-back" data-technical-review-action="history-back">Back to Technical Review</button></section>';
  }
  async function saveUnifiedPackage(complete, setupOnly = false) {
    if(state.saving || packageCandidateState().active || (complete&&unifiedPackageIssue()))return;
    const hadCandidate=!!state.selected.record.technicalReview.candidateBom;
    const p=unifiedPackageDraft(), answers=packageAnswers(), canBuild=packageCanBuild();
    state.saving=true;state.message='';state.messageState='';renderDetail();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/package-review',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:'UNIFIED_PACKAGE_REVIEW_V2',expectedReviewToken:state.selected.packageReviewToken,documents:p.documents,governingBomDocumentId:p.governingBomDocumentId,complete,missing:answers.missing})});
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId));
      state.packageDraft=null;state.packageAnswers=null;
      state.message=complete?'Technical package saved.':'On Hold — missing information saved.';
      await refreshQueueModel();
    } catch(error) {state.message=error.message;state.messageState='error';}
    finally {state.saving=false;renderDetail();}
    if(complete&&canBuild&&!setupOnly&&!scannedMainBom()&&state.messageState!=='error') {
      if(!hadCandidate && !state.selected.record.technicalReview.candidateBom) await buildCandidate();
    }
  }
  function packageMessage() { return '<p role="status" class="technical-review-message" data-state="' + escapeHtml(state.messageState) + '">' + escapeHtml(state.message) + '</p>'; }
  function renderGoverning() {
    const pack = packageDraft();
    if (state.selected.record.technicalReview?.workflow) return renderUnifiedGoverning(pack);
    const candidates = pack.documents.filter(d => isBomSource(d) && d.applicability === 'PARENT_ASSEMBLY');
    return '<section class="technical-review-question">' + progress('BOM Review') + '<h3>Which BOM governs the parent assembly for this RFQ?</h3><p>Select explicitly. Other BOMs keep their referenced, supporting or unresolved roles.</p>' + (candidates.length ? candidates.map(d => '<label class="technical-review-bom-option"><input type="radio" name="governingBom" data-governing-id="' + d.documentId + '" ' + (pack.governingBomDocumentId === d.documentId ? 'checked' : '') + '> ' + escapeHtml(d.name) + ' — ' + bomSourceLabel(d) + (pack.governingBomDocumentId === d.documentId ? ' · Governing BOM source' : '') + '</label>').join('') : '<p>No parent BOM is classified yet. Return to the inventory to identify one.</p>') + '<label class="technical-review-bom-option"><input type="radio" name="governingBom" data-governing-id="" ' + (!pack.governingBomDocumentId ? 'checked' : '') + '> Unresolved — no governing BOM selected</label><p>Other package documents: ' + pack.documents.filter(d => !candidates.includes(d)).map(d => escapeHtml(d.name) + ' (' + documentRoles[d.role] + ')').join(' · ') + '</p><button class="technical-review-primary" data-technical-review-action="compare-package" ' + (state.saving ? 'disabled' : '') + '>' + (pack.governingBomDocumentId ? 'Save selection and compare BOM' : 'Save as unresolved') + '</button>' + (pack.governingBomDocumentId ? '<p><button class="technical-review-primary" data-technical-review-action="candidate-from-source" ' + (state.saving ? 'disabled' : '') + '>Save selection and build Candidate BOM</button></p>' : '') + packageMessage() + '<button class="technical-review-back" data-technical-review-action="package-back">← Back to Technical Package Review</button></section>';
  }
  async function savePackage(compare) {
    if (state.saving) return;
    const fromInventory = state.step === 'inventory';
    if (fromInventory && (packageDraft().documents.some(d=>!rowAccepted(d)) || pnIssue() || Object.keys(identityChanges).length)) return;
    state.saving = true; state.message = ''; state.messageState = ''; renderDetail();
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/technical-package', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(packageDraft()) });
      state.packageDraft = null; state.step = state.selected.record.technicalReview?.workflow && fromInventory ? 'sufficiency' : 'governing';
      state.message = compare ? 'Governing BOM remains unresolved. Inventory saved.' : 'Technical package review saved.';
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
    addingDocuments = false; reviewUploads = [];
    state.acceptedVersion = null;
    if (state.saving) return;
    identityChanges={};packageRowErrors={};state.packageAnswers=null;
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
      if (!completedReview(state.selected.record)) void pollAnalysis(intakeId, false);
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
    mount?.classList.remove("technical-review-entry");
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
    const entry = !state.guided && !state.closing && !completedReview(record) && record.status !== "NO_LONGER_REQUIRED";
    mount?.classList.toggle("technical-review-entry", entry);
    if (entry) { mount?.classList.remove("technical-review-guided"); host.innerHTML = renderEntryConfirmation(record, canDisposition); return; }
    if (completedReview(record)) { host.innerHTML = state.step === 'submitted' ? renderSubmittedReview(record) : renderCompletedReview(record); return; }
    mount?.classList.toggle("technical-review-guided", state.guided);
    if (state.step === 'scanned-setup') { host.innerHTML = renderScannedSetup(); return; }
    scanWorkbenchObserver?.disconnect();
    if (state.step === 'scanned-review') { host.innerHTML = renderScannedWorksheet(); watchScanWorkbench(); return; }
    if (state.step === 'accepted-bom') { host.innerHTML = renderAcceptedBom(record); return; }
    host.innerHTML = '<div class="technical-review-context"><div><p class="technical-review-eyebrow">RFQ Review · ' + escapeHtml(record.intakeId) + '</p>' +
      '<h2 id="technicalReviewDetailTitle" tabindex="-1">' + escapeHtml(record.customer?.customerName || "Customer") + '</h2>' +
      (!state.guided && record.intakeType === 'NEW_QUOTE_REQUEST' ? renderIntakeSummary(record) : '<p>' + escapeHtml(assembly.assemblyNumber) + ' · Rev ' + escapeHtml(assembly.revision) + ' · Qty ' + escapeHtml(assembly.quantity) + '</p>') + '</div>' +
      '<span class="technical-review-status-pill">' + escapeHtml(envelope.reviewStatusLabel) + '</span></div>' +
      (canDisposition && state.step !== 'candidate' && !(record.technicalReview?.workflow && state.step === 'inventory') && ['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(record.status) ? '<p><button data-technical-review-action="add-document" '+(state.saving||addingDocuments?'disabled':'')+'>Add Technical Document</button></p>' : '') +
      (state.step === 'candidate' || (record.technicalReview?.workflow && state.step === 'inventory') ? '' : '<div id="technicalReviewAnalysisProgress">' + renderAnalysisProgress() + '</div>') +
      (state.guided ? (['sufficiency', 'context', 'definition', 'release'].includes(state.step) ? renderWorkflowStep(record) : state.step === 'labor-first' ? renderLaborFirstEntry(record) : state.step === 'manufacturing' ? renderManufacturingHandoff(record) : state.step === 'accepted-bom' ? renderAcceptedBom(record) : state.step === 'candidate' ? renderCandidate(record) : state.materials ? renderMaterials(record) : state.step === 'inventory' ? renderInventory() : state.step === 'governing' ? renderGoverning() : state.step === 'coverage' ? renderCoverage(record) : renderHistoryQuestion(record, canDisposition)) : renderEntryActions(record, canDisposition));
  }

  function completedReview(record) {
    return record?.status === 'READY_FOR_RFQ_WORKING_QUEUE' || !!record?.technicalReview?.workflow?.outputs;
  }
  function savedFacts(value) {
    if (value == null) return '<p>Not recorded.</p>';
    if (typeof value !== 'object') return escapeHtml(String(value));
    if (Array.isArray(value)) return '<ul>' + value.map(v => '<li>' + savedFacts(v) + '</li>').join('') + '</ul>';
    return '<dl>' + Object.entries(value).map(([key,v]) => '<dt>' + escapeHtml(key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase())) + '</dt><dd>' + savedFacts(v) + '</dd>').join('') + '</dl>';
  }
  function renderSubmittedReview(record) {
    return '<section class="technical-review-entry-card"><h2 id="technicalReviewDetailTitle" tabindex="-1">Technical Review Submitted</h2><p class="technical-review-entry-customer">'+escapeHtml(record.intakeId)+' · '+escapeHtml(record.customer?.customerName || '')+'</p><p role="status">The technical package and accepted BOM have been submitted for Materials and Labor quotation.</p><div class="technical-review-entry-actions"><button type="button" class="technical-review-primary" data-technical-review-action="back">Done</button></div></section>';
  }
  function renderCompletedReview(record) {
    const review = record.technicalReview, w = review.workflow || {}, pack = review.technicalPackage || {documents:[]};
    const section = state.step || 'package';
    let body = '';
    if (section === 'package') body = '<h3>Package Review</h3><p>Package confirmed: ' + (w.packageConfirmed ? 'Yes' : 'Not recorded') + ' · Sufficient to continue: ' + (w.sufficient ? 'Yes' : 'Not recorded') + '</p>' + (pack.documents || []).map(d => '<details open><summary>' + escapeHtml(d.name) + '</summary>' + savedFacts(d) + ((record.technicalFiles || []).some(f => f.documentId === d.documentId && f.binaryStatus === 'VERIFIED') ? '<a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/' + encodeURIComponent(record.intakeId) + '/documents/' + encodeURIComponent(d.documentId) + '">View File</a>' : '') + '</details>').join('');
    if (section === 'history') body = '<h3>Assembly history / context</h3>' + savedFacts(review.assemblyHistory);
    if (section === 'manufacturing') body = '<h3>Manufacturing Definition</h3>' + savedFacts(w.manufacturing);
    if (section === 'materials') body = '<h3>Materials Definition</h3>' + savedFacts({status:review.materialsReviewStatus,governingBomDocumentId:pack.governingBomDocumentId,materialsTarget:w.outputs?.materialsTarget}) + acceptedLinks(record);
    if (section === 'completion') body = '<h3>Completion / review history</h3>' + savedFacts({status:record.status,reviewer:w.outputs?.reviewer,atUtc:w.outputs?.atUtc,events:w.events});
    if (section === 'candidate') body = review.candidateBom ? renderCandidate(record) : '<p>No Candidate BOM recorded.</p>';
    if (section === 'accepted-bom') body = renderAcceptedBom(record);
    return '<section class="technical-review-completed"><button class="technical-review-back" data-technical-review-action="rfq-back">← Back to RFQ</button><h2 id="technicalReviewDetailTitle" tabindex="-1">Completed Technical Review — Read-only</h2><p>' + escapeHtml(record.intakeId) + ' · ' + escapeHtml(record.customer?.customerName) + '</p><p>Technical Review complete — released for quotation.</p><p>Inspection only. The completed review and accepted BOM remain unchanged.</p><nav aria-label="Completed review sections">' + [['package','Package Review'],['history','History Context'],['manufacturing','Manufacturing Definition'],['materials','Materials Definition / Governing BOM'],['candidate','Candidate / Reviewed BOM'],['completion','Completion History']].map(([key,label]) => '<button data-technical-review-action="view-' + key + '" aria-pressed="' + (section === key) + '">' + label + '</button>').join(' ') + '</nav>' + acceptedLinks(record) + '<section class="technical-review-question">' + body + '</section></section>';
  }

  function renderEntryConfirmation(record, canDisposition) {
    const started = !!record.technicalReview?.workflow || record.technicalReview?.disposition === 'START_TECHNICAL_REVIEW' || ['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(record.status);
    const action = record.technicalReview?.workflow ? 'flow-START' : manufacturingIsNext(record) ? 'manufacturing' : 'start';
    const disabled = !canDisposition || state.saving ? 'disabled' : '';
    return '<section class="technical-review-entry-card"><h2 id="technicalReviewDetailTitle" tabindex="-1">Technical Review — ' + escapeHtml(record.intakeId) + '</h2>' +
      '<p class="technical-review-entry-customer">' + escapeHtml(record.customer?.customerName || 'Customer') + '</p>' + renderIntakeSummary(record, true) +
      (record.status === 'ON_HOLD' ? '<p class="technical-review-source">On Hold</p>' : '') +
      '<div class="technical-review-entry-actions"><button type="button" class="technical-review-primary" data-technical-review-action="' + action + '" ' + disabled + '>' + (started ? 'Continue Technical Review' : 'Start Technical Review') + '</button>' +
      '<button type="button" class="technical-review-back" data-technical-review-action="back" ' + (state.saving ? 'disabled' : '') + '>Back to Queue</button></div>' +
      (!canDisposition ? '<p>Disposition permission required.</p>' : '') + packageMessage() + '</section>';
  }

  function renderIntakeSummary(record, compact = false) {
    const assembly = record.assemblies?.[0] || {};
    const scopes = { MATERIAL_AND_LABOR: 'Material + Labor', LABOR_ONLY: 'Labor Only', MATERIAL_ONLY: 'Material Only' };
    const types = { PCB_ASSEMBLY: 'PCB Assembly', CABLE_AND_HARNESS_ASSEMBLY: 'Cable and Harness Assembly', CHASSIS_BOX_BUILD_ASSEMBLY: 'Chassis / Box Build Assembly', OTHER: 'Other' };
    const facts = [
      ['Assembly', assembly.assemblyNumber || 'Not provided'],
      ['Revision', assembly.revision || 'Not provided'],
      ['Qty', assembly.quantity ?? 'Not provided'],
      ['Scope', scopes[record.deLeonScope] || 'Not determined'],
      ['Assembly Type', types[record.technicalReview?.assemblyType || record.preliminaryAssemblyType?.type] || 'Not determined'],
      ['Technical Files Received', (record.technicalFiles?.length || 0) + ' received']
    ];
    return (compact ? '<p class="technical-review-entry-identity">'+escapeHtml(assembly.assemblyNumber || 'Not provided')+' · Rev '+escapeHtml(assembly.revision || 'Not provided')+' · Qty '+escapeHtml(assembly.quantity ?? 'Not provided')+'</p>' : '') + '<dl class="technical-review-intake-summary" aria-label="Intake facts">' + (compact ? facts.slice(3) : facts).map(([label, value]) =>
      '<div><dt>' + label + '</dt><dd>' + escapeHtml(value) + '</dd></div>').join('') + '</dl>';
  }

  function unifiedEligible(record) {
    return record?.intakeType === 'NEW_QUOTE_REQUEST' && (record.technicalReview?.workflow || !(record.technicalReview?.bomAcceptances?.length)) && !['NO_LONGER_REQUIRED','READY_FOR_RFQ_WORKING_QUEUE'].includes(record.status);
  }
  function resumeWorkflow() {
    const r = state.selected.record, w = r.technicalReview.workflow;
    state.guided = true; state.materials = false; state.packageDraft = null;
    state.packageAnswers = null;
    state.step = 'inventory';
    renderDetail();
  }
  function flowButton(label, action) {
    return '<button class="technical-review-primary" data-technical-review-action="flow-' + action + '" ' + (state.saving ? 'disabled' : '') + '>' + label + '</button>';
  }
  async function workflowAction(action) {
    if (state.saving) return;
    const body = {action};
    if (action === 'HOLD') body.needed = document.getElementById('flowNeeded')?.value;
    if (action === 'SELECT_MANUFACTURING_DRAWING') body.governingDocumentId = document.getElementById('flowDrawing')?.value;
    if (action === 'MANUFACTURING') { body.governingDocumentId = document.getElementById('flowDrawing')?.value; body.nothingMissing = document.getElementById('flowNothingMissing')?.checked === true; }
    state.saving = true; state.message = ''; state.messageState = ''; renderDetail();
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/workflow', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if (action === 'SUFFICIENT' && !state.selected.record.technicalReview.assemblyHistory) state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/assembly-history', {method:'POST'});
      // Workflow responses omit verified scanned-source context. Resume from the persisted full review.
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId));
      await refreshQueueModel();
      if (action === 'COMPLETE') { state.guided = false; state.step = 'submitted'; renderDetail(); } else resumeWorkflow();
    } catch (error) { state.message = error.message; state.messageState = 'error'; if(action === 'COMPLETE') { state.step = 'inventory'; if(releaseReadiness)releaseReadiness={...releaseReadiness,ready:false,message:error.message}; } }
    finally { state.saving = false; renderDetail(); }
  }
  function renderWorkflowLanding(record, canDisposition) {
    const w = record.technicalReview.workflow;
    const phase = (title,status) => '<section class="technical-review-phase"><h4>' + title + '</h4><p>' + status + '</p></section>';
    return '<section class="technical-review-phases" aria-label="Definition progress">' + phase('Manufacturing Definition', w.manufacturing ? 'Complete' : w.packageConfirmed ? 'In Progress' : 'Not Started') + phase('Material / BOM Definition', record.technicalReview.materialsReviewStatus === 'QUALIFIED' ? 'Complete' : record.technicalReview.technicalPackage?.governingBomDocumentId ? 'In Progress' : 'Not Started') + '</section>' + acceptedLinks(record) +
      (w.outputs ? '<section class="technical-review-card"><h3>Technical Review Complete</h3><p>Technical Review complete — released for quotation.</p></section>' : '<section class="technical-review-card">' + (w.holdReason ? '<h3>On Hold</h3><p>Needed: ' + escapeHtml(w.holdReason) + '</p>' : '') +
      (canDisposition ? flowButton(w.holdReason ? 'Review hold / resume' : 'Continue Technical Review','START') + '<button class="technical-review-secondary" data-technical-review-action="close">No Longer Required</button>' : '<p>Disposition permission required.</p>') + '</section>') + packageMessage();
  }
  function renderWorkflowStep(record) {
    const w = record.technicalReview.workflow, pack = record.technicalReview.technicalPackage;
    const hold = '<label class="technical-review-field">What is needed?<textarea id="flowNeeded" maxlength="1000"></textarea></label>' + flowButton('Place On Hold','HOLD');
    let body = '';
    if (state.step === 'sufficiency') body = record.status === 'ON_HOLD' ? '<h3>On Hold — information needed</h3><p>' + escapeHtml(w.holdReason) + '</p>' + flowButton('Resume Review','RESUME') : '<h3>Do we have enough technical information to continue?</h3><p>Continue only when the package is sufficient for the next review steps.</p>' + flowButton('Continue Review','SUFFICIENT') + hold;
    if (state.step === 'context') {
      const h = record.technicalReview.assemblyHistory;
      body = '<h3>Assembly history / context</h3>' + (h ? '<p>' + (h.historyFound ? 'Previous revisions: ' + h.revisionsFound.map(escapeHtml).join(', ') + '. Most recent: ' + escapeHtml(h.mostRecentRevision) : 'No previous assembly history found.') + '</p><p>SIM synthetic history is context. New assemblies and new revisions can continue.</p>' : '<p>History is unavailable. Retry the context lookup.</p>') + flowButton(h ? 'Continue to Manufacturing Definition' : 'Load history context', h ? 'HISTORY' : 'SUFFICIENT');
    }
    if (state.step === 'definition') {
      const drawings = (pack?.documents || []).filter(d => (state.selected.manufacturingDrawingIds || []).includes(d.documentId));
      body = '<h3>Manufacturing Definition</h3><p>Establish the trusted technical package for future Quotation — Labor.</p><label class="technical-review-field">Governing assembly / manufacturing drawing<select id="flowDrawing" '+(state.saving?'disabled':'')+'><option value="">Select drawing</option>' + drawings.map(d=>'<option value="'+escapeHtml(d.documentId)+'" '+(w.manufacturingDrawingId===d.documentId?'selected':'')+'>'+escapeHtml(d.name)+'</option>').join('') + '</select></label><p>Selecting a drawing saves it as the governing parent assembly drawing.</p><h4>Supporting and manufacturing references</h4><ul>' + (pack?.documents || []).filter(d=>d.role === 'SUPPORTING' || d.role === 'REFERENCED' || d.applicability === 'SUBASSEMBLY' || d.documentType === 'GERBER').map(d=>'<li>'+escapeHtml(d.name)+' · '+escapeHtml(documentTypes[d.documentType])+'</li>').join('') + '</ul><p>Classify schematics and wire lists as Supporting Documents; their staged references are retained.</p><label><input type="checkbox" id="flowNothingMissing"> Nothing obvious remains missing from the manufacturing package</label><p>' + flowButton('Complete Manufacturing Definition','MANUFACTURING') + '</p>' + hold;
    }
    if (state.step === 'release') return renderUnifiedPackage();
    return '<section class="technical-review-question">' + body + packageMessage() + '<p><button class="technical-review-back" data-technical-review-action="flow-back-package">Review package</button> <button class="technical-review-back" data-technical-review-action="review-back">Back to Technical Review</button></p></section>';
  }
  function renderUnifiedGoverning(pack) {
    const candidates = pack.documents.filter(d=>isBomSource(d) && d.applicability === 'PARENT_ASSEMBLY');
    return '<section class="technical-review-question"><h3>Which BOM governs the parent assembly for this RFQ?</h3><p>Select the authority for Material / BOM Definition.</p>' + candidates.map(d=>'<label class="technical-review-bom-option"><input type="radio" name="governingBom" data-governing-id="'+escapeHtml(d.documentId)+'" '+(pack.governingBomDocumentId === d.documentId ? 'checked' : '')+'> '+escapeHtml(d.name)+' — '+bomSourceLabel(d)+'</label>').join('') + (candidates.length ? '' : '<p>No eligible parent BOM source. Review the package classification.</p>') + '<p>Candidate extraction uses the governing PDF drawing with embedded BOM. Page 2, up to ten rows; supporting XLS is not compared. Human verification is required.</p>' + (pack.governingBomDocumentId ? '<button class="technical-review-primary" data-technical-review-action="candidate-from-source">Save selection and build Candidate BOM</button>' : '') + packageMessage() + '<p><button class="technical-review-back" data-technical-review-action="package-back">Back to Technical Package Review</button> <button class="technical-review-back" data-technical-review-action="review-back">Back to Technical Review</button></p></section>';
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
      if (confirmed) result += '<div class="technical-review-question-complete" role="status"><strong>' + (history.assemblyClassification === 'EXISTING_ASSEMBLY' ? 'Existing Assembly — History Found' : 'New Assembly') + '</strong><p>Assembly determination saved. The item remains active.</p></div>' + (materialsEligible(record) ? '<button type="button" class="technical-review-primary" data-technical-review-action="package" ' + disabled + '>Continue to Technical Technical Package Review</button>' : '<p>This is the end of the current guided review for this assembly/revision.</p>');
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
    const candidateAction = scannedMainBom() ? scannedSetupPrompt() : '<p><button class="technical-review-primary" data-technical-review-action="candidate" ' + (state.saving ? 'disabled' : '') + '>' + (record.technicalReview?.candidateBom ? 'Resume Candidate BOM — Pilot' : 'Build Candidate BOM') + '</button></p><p>Extract up to 10 rows from the staged governing PDF, page 2. Candidate only; human review required.</p>';
    return '<section class="technical-review-question" aria-labelledby="technicalReviewMaterials"><div class="technical-review-question-progress">History ✓ → Technical Package Review ✓ → BOM Review → Subassemblies</div><h3 id="technicalReviewMaterials">Let’s review the BOM ' + escapeHtml(record.customer?.customerName) + ' provided for this Rev ' + escapeHtml(assembly.revision) + ' request.</h3>' + candidateAction + content +
      '<p class="technical-review-message" data-state="' + escapeHtml(state.messageState) + '" role="status">' + escapeHtml(state.message) + '</p><button type="button" class="technical-review-back" data-technical-review-action="governing-back" ' + (state.saving ? 'disabled' : '') + '>← Back to Technical Package Review</button></section>';
  }

  async function buildCandidate() {
    if (scannedMainBom()) { await openScannedSetup(false); return; }
    if (state.saving || ['QUEUED','RUNNING','VALIDATING'].includes(state.analysisJob?.status) || (state.selected.record.technicalReview?.workflow && state.selected.record.technicalReview.candidateBom)) return;
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
  function renderCandidateCard() {
    const c=packageCandidateState(), scanned=scannedMainBom();
    const scan=state.selected?.scannedCandidate;
    const building=scanned?!!state.scanCandidateBuilding:c.active;
    const stale=scanned?scan?.status==='NEEDS_REBUILD':c.stale;
    const ready=scanned?scan?.status==='READY'&&c.ready:c.ready;
    const accepted=state.selected.record.technicalReview.materialsReviewStatus==='QUALIFIED';
    const enabled=ready&&!building&&!stale&&!c.dirty&&!state.saving&&!accepted;
    const label=building?'Building Candidate BOM…':stale?'Candidate BOM Needs Rebuild':ready?'Candidate BOM Ready':'Candidate BOM Not Ready';
    let detail=stale?(scanned?'Open Scanned BOM Review to rebuild from the saved transcription.':'The technical package has changed.'):
      ready&&c.dirty?'Save and accept the package changes before reviewing Candidate BOM.':accepted?'BOM Review is complete. The accepted BOM remains available below.':'';
    if(!building&&state.analysisJob&&['FAILED','TIMED_OUT','CANCELLED'].includes(state.analysisJob.status)&&!ready&&!scanned)detail=state.analysisJob.message||'The build did not complete. Try again.';
    const retry=!scanned&&!building&&!ready&&['FAILED','TIMED_OUT','CANCELLED'].includes(state.analysisJob?.status)?'<button type="button" class="technical-review-secondary" data-technical-review-action="analysis-retry" '+(state.saving?'disabled':'')+'>Retry analysis</button>':'';
    return '<section class="scanned-bom-notice candidate-bom-card" aria-labelledby="candidateBomCardTitle"><h4 id="candidateBomCardTitle">Candidate BOM</h4><p role="status">'+label+'</p>'+
      (detail?'<p>'+escapeHtml(detail)+'</p>':'')+'<button type="button" class="technical-review-primary" data-technical-review-action="candidate" '+(enabled?'':'disabled')+'>Review Candidate BOM</button>'+retry+'</section>';
  }
  function renderAnalysisProgress() {
    if(state.step==='inventory'&&state.selected?.record?.technicalReview?.workflow)return renderCandidateCard();
    if(scannedMainBom())return '';
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
        if (!selected.record.technicalReview?.workflow) { state.guided = true; state.step = 'candidate'; state.materials = false; }
        state.message = ''; state.messageState = ''; renderDetail();
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
    if (row.reviewState) return row.reviewState.reviewed ? 'Reviewed' : 'Uncertain';
    if (row.manufacturerIdentity && (row.manufacturerIdentity.stale || row.manufacturerIdentity.proposals.some(p => manufacturerDecision(row.manufacturerIdentity,p.id) === 'PROPOSED'))) return 'Uncertain';
    if (row.manufacturerIdentity && !row.confirmed && (Object.keys(candidateFields).some(key => row.comparison?.[key] !== 'MATCH') || Object.values(row.analysisFields || {}).some(field => field.uncertainty?.trim() && !/^none[.!]?$/i.test(field.uncertainty.trim())))) return 'Uncertain';
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
    const fileUrl = '/api/sim/rfq-intakes/' + encodeURIComponent(record.intakeId) + '/documents/' + encodeURIComponent(bom.governingDocumentId) + '#page=' + bom.page;
    const rows = bom.rows.map((row, index) => {
      const status = candidateStatus(row);
      const expanded = state.candidateIndex === index;
      const conflict = status !== 'Conflict' && Object.values(row.comparison || {}).includes('CONFLICT');
      const readOnly=!!accepted||completedReview(record), ui=rowReviewUi(row), locked=readOnly||row.reviewState?.reviewed&&!ui.editing;
      const type=ui.componentType||row.componentType||'STANDARD_COTS';
      const options='<details class="candidate-options"><summary>Options</summary>'+['edit','alternates','files','history'].map((panel,i)=>'<button data-technical-review-action="worksheet-options" data-candidate-row="'+index+'" data-panel="'+panel+'">'+['Edit Details','Approved Alternates / Add Alternate','Technical Files','Source / History'][i]+'</button>').join('')+'</details>';
      return '<tr data-worksheet-row="'+index+'"><td>'+escapeHtml(row.values.lineNumber||'—')+'</td><td class="candidate-part">'+escapeHtml(row.values.partNumber||'—')+'</td><td>'+worksheetIdentity(row,index,locked,type)+'</td><td>'+escapeHtml(row.values.description||'—')+'</td><td>'+escapeHtml(row.values.quantity||'—')+'</td><td>'+(locked?escapeHtml(componentTypes[type]):'<select aria-label="Type for row '+(index+1)+'" data-worksheet-field="componentType" data-worksheet-row="'+index+'">'+Object.entries(componentTypes).map(([key,label])=>'<option value="'+key+'" '+(key===type?'selected':'')+'>'+label+'</option>').join('')+'</select>')+'</td><td>'+escapeHtml(row.values.designators||'—')+'</td><td><span class="candidate-status" data-status="'+status+'">'+(locked?'Accepted':'Needs Review')+'</span>'+(!locked?'<button data-technical-review-action="worksheet-accept" data-candidate-row="'+index+'" '+(state.saving?'disabled':'')+'>Accept</button>':'')+'</td><td>'+options+'</td></tr>'+
        (expanded?'<tr class="candidate-detail-row"><td colspan="9"><section id="candidate-detail-'+index+'" aria-label="Row '+(index+1)+' details">'+(state.rowOption==='alternates'?renderAlternates(row,readOnly):state.rowOption==='files'?renderRowTechnicalFiles(bom,row,readOnly):state.rowOption==='history'?renderCandidateRow(bom,row,index,true):renderCandidateRow(bom,row,index,readOnly))+'</section></td></tr>':'');
    }).join('');
    return '<section class="technical-review-question technical-review-candidate">' + (record.technicalReview?.workflow && !completedReview(record) ? '<button class="technical-review-back" data-technical-review-action="governing-back">← Back to Technical Package Review</button>' : '') + '<h3>' + (accepted ? 'BOM Review Complete' : 'Candidate BOM') + '</h3>' + (accepted ? '<p>Accepted BOM version ' + accepted.version + '.</p>' + (completedReview(record) ? '<p>Technical Review complete · Read-only</p>' : record.technicalReview.materialsReviewStatus === 'QUALIFIED' ? (record.technicalReview.workflow ? '<p>Return to Technical Package Review to submit to RFQs</p>' : '<p>Next: Manufacturing / Labor Review</p>') : '<p>Historical acceptance. The current source package or candidate requires a new BOM review.</p>') : '') + '<p class="candidate-summary">' + bom.rows.length + ' Part Numbers</p>' +
      candidateReviewerSummary(bom) + (accepted ? '<p>RFQ materials acceptance only. This is not a production release.</p>' : '<p class="candidate-review-note">Review the BOM below and confirm the part information before approval.</p>') + '<a href="' + fileUrl + '" target="_blank" rel="noopener">View Main BOM · Page ' + bom.page + '</a>' +
      '<div class="candidate-table-scroll" role="region" aria-label="Candidate BOM table" tabindex="0"><table class="candidate-table"><caption class="candidate-sr-only">Candidate BOM rows for human review</caption><thead><tr><th scope="col">Line</th><th scope="col">Customer / BOM P/N</th><th scope="col">Approved P/N</th><th scope="col">Description</th><th scope="col">Qty / Assy</th><th scope="col">Type</th><th scope="col">Designators</th><th scope="col">Status</th><th scope="col">Options</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="technical-review-message" role="status">' + escapeHtml(state.message) + '</p><details class="candidate-analysis-details"><summary>Details</summary><p>' + escapeHtml(bom.analysis?.coverageReason || bom.supportingComparison) + '</p><p>' + (record.technicalReview.candidateBomVersions || []).length + ' prior versions preserved. No canonical BOM or downstream work is created.</p></details>' + acceptedLinks(record) + (completedReview(record) ? '' : '<div class="candidate-editor-actions">' + (record.technicalReview?.workflow ? '' : '<button class="technical-review-back" data-technical-review-action="governing-back">← Back to Technical Package Review</button>') + (!accepted ? '<button class="technical-review-primary" data-technical-review-action="complete-bom" ' + (state.saving ? 'disabled' : '') + '>Complete BOM Review</button>' : '') + '</div>') + '</section>';
  }
  function worksheetIdentity(row,index,locked,type){
    const ui=rowReviewUi(row),identity=row.manufacturerIdentity;
    const confirmed=(identity?.proposals||[]).filter(p=>manufacturerDecision(identity,p.id)==='CONFIRMED');
    const assembly=row.assemblyIdentity?.partNumber||(row.alternates||[]).find(a=>!a.removedAtUtc&&a.origin==='MANUAL'&&a.reviewStatus==='CONFIRMED')?.partNumber||'';
    if(locked && type==='SUBASSEMBLY')return escapeHtml(assembly||'—');
    if(locked)return '<details class="worksheet-mfg-list"><summary>'+escapeHtml(confirmed[0]?.partNumber||'Not resolved')+(confirmed.length>1?' <small>+'+(confirmed.length-1)+' more</small>':'')+'</summary>'+confirmed.map(p=>'<div>'+escapeHtml(p.partNumber+(p.manufacturerName?' — '+p.manufacturerName:''))+' — Approved</div>').join('')+'</details>';
    const attr=' data-worksheet-row="'+index+'" '+(state.saving?'disabled':'');
    if(type==='SUBASSEMBLY')return '<input aria-label="Assembly P/N for row '+(index+1)+'" id="assembly-number-'+index+'" maxlength="200" data-worksheet-field="assemblyNumber" '+attr+' value="'+escapeHtml(ui.assemblyNumber??assembly)+'"><small>Assembly P/N</small>';
    const proposals=(identity?.proposals||[]).filter(p=>p.partNumber?.trim()&&manufacturerDecision(identity,p.id)!=='REJECTED');
    const selected=ui.primaryChoice==='MANUAL'||proposals.some(p=>p.id===ui.primaryChoice)?ui.primaryChoice:confirmed[0]?.id??proposals[0]?.id??'';
    return '<select aria-label="Approved P/N for row '+(index+1)+'" id="approved-choice-'+index+'" data-worksheet-field="primaryChoice" '+attr+'><option value="">Not resolved</option>'+proposals.map(p=>'<option value="'+escapeHtml(p.id)+'" '+(p.id===selected?'selected':'')+'>'+escapeHtml(p.partNumber+(p.manufacturerName?' — '+p.manufacturerName:''))+'</option>').join('')+'<option value="MANUAL" '+(selected==='MANUAL'?'selected':'')+'>Manual Entry…</option></select>'+(proposals.length>1?'<small>+'+(proposals.length-1)+' more</small>':'')+(selected&&selected!=='MANUAL'?'<details class="worksheet-mfg-list"><summary>Review candidate</summary><button data-technical-review-action="worksheet-reject" data-candidate-row="'+index+'" data-proposal-id="'+escapeHtml(selected)+'" '+(state.saving?'disabled':'')+'>Reject this candidate</button></details>':'')+(selected==='MANUAL'?'<input aria-label="Manual MFG P/N for row '+(index+1)+'" id="approved-manual-'+index+'" data-worksheet-field="manualNumber" '+attr+' maxlength="200" value="'+escapeHtml(ui.manualNumber||'')+'">':'');
  }
  async function acceptWorksheetRow(index){
    if(state.saving||completedReview(state.selected.record))return;
    const bom=state.selected.record.technicalReview.candidateBom,row=bom.rows[index],ui=rowReviewUi(row);
    const values=state.candidateIndex===index&&document.getElementById('candidate-partNumber')?Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])])):state.candidateIndex===index&&state.candidateDraft?state.candidateDraft:row.values;
    const selection=document.getElementById('approved-choice-'+index)?.value;
    if(selection==='MANUAL'&&!document.getElementById('approved-manual-'+index)?.value.trim()){state.message='Enter a manual manufacturer P/N before accepting.';state.messageState='error';renderDetail();return;}
    const worksheetAcceptance={expectedToken:row.reviewState.token,componentType:ui.componentType||row.componentType||'STANDARD_COTS',assemblyPartNumber:document.getElementById('assembly-number-'+index)?.value||ui.assemblyNumber||row.assemblyIdentity?.partNumber,proposalId:null,manualPartNumber:document.getElementById('approved-manual-'+index)?.value,manufacturerName:ui.manualMaker};
    state.saving=true;
    try{state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:index,values,worksheetAcceptance})});delete state.rowReviewUi[bom.id+':'+index];state.candidateDraft=null;state.candidateIndex=null;state.rowOption=null;state.message='Row accepted.';state.messageState='';}
    catch(error){state.message=error.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }
  function manufacturerSummary(row) {
    const identity = row.manufacturerIdentity;
    if (!identity) return '—';
    const active = identity.proposals.filter(p => manufacturerDecision(identity, p.id) !== 'REJECTED');
    return (active.map(p => escapeHtml(p.partNumber) + (!identity.stale && manufacturerDecision(identity,p.id) === 'CONFIRMED' ? ' · Confirmed' : '')).join('<br>') || '—') + '<small>' + escapeHtml(identity.state || 'UNRESOLVED') + (active.length > 1 ? ' · Multiple candidates' : '') + '</small>';
  }
  function quickManufacturerCandidates(row) {
    const identity = row?.manufacturerIdentity;
    if (!identity || identity.stale) return [];
    return identity.proposals.filter(p => p.id && p.partNumber?.trim() && manufacturerDecision(identity,p.id) === 'PROPOSED');
  }
  function renderQuickManufacturer(row, index, readOnly = false) {
    if (readOnly || !row.reviewState) return '';
    const review = row.reviewState;
    if (review.reviewed) return '';
    if (!review.canApprove) return '<small class="candidate-row-blockers">' + escapeHtml(review.approvalBlockers.join(' ')) + '</small>';
    const disabled = state.saving ? 'disabled' : '';
    return '<div class="manufacturer-quick"><button data-technical-review-action="mfg-approve" data-candidate-row="' + index + '" aria-label="Approve BOM row ' + (index + 1) + '" title="Accept this entire BOM line as presented, including governing fields and pending manufacturer identities. Does not grant alternate substitution or select sourcing." ' + disabled + '>Approve</button></div>';
  }
  async function quickApproveManufacturer(index) {
    if (state.saving || state.acceptedVersion || state.step === 'accepted-bom' || completedReview(state.selected?.record)) return;
    const bom = state.selected?.record?.technicalReview?.candidateBom;
    const row = bom?.rows[index];
    if (!row?.reviewState?.canApprove || (state.selected.record.technicalReview.bomAcceptances || []).some(a => a.candidate.id === bom.id)) return;
    state.saving = true;
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/candidate-bom', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:index,wholeRowApproval:{expectedToken:row.reviewState.token}})});
      state.message = 'BOM row approved as presented.';
    } catch (error) { state.message = error?.message || 'Row approval could not be saved.'; }
    finally { state.saving = false; renderDetail(); }
  }
  function candidateReviewerSummary(bom) {
    let proposed=0, choices=0, unresolved=0;
    for (const row of bom.rows) {
      if(row.componentType==='SUBASSEMBLY' && (row.assemblyIdentity?.partNumber || (row.alternates||[]).some(a=>!a.removedAtUtc&&a.origin==='MANUAL'&&a.reviewStatus==='CONFIRMED')))continue;
      const identity=row.manufacturerIdentity;
      const active=(identity?.proposals || []).filter(p=>p.partNumber?.trim() && manufacturerDecision(identity,p.id)!=='REJECTED');
      if (!identity || identity.stale || !active.length || identity.state==='UNRESOLVED') { unresolved++; continue; }
      proposed++;
      if (active.length>1) choices++;
    }
    return '<p class="candidate-review-summary">'+proposed+' with proposed MFG P/Ns · '+choices+' with multiple candidates · '+unresolved+' unresolved</p>';
  }
  function manufacturerCounts(bom) {
    const rows = bom.rows.filter(r => r.manufacturerIdentity);
    if (!rows.length) return '';
    const count = state => rows.filter(r => r.manufacturerIdentity.state === state).length;
    const multiple = rows.filter(r => r.manufacturerIdentity.proposals.filter(p => manufacturerDecision(r.manufacturerIdentity,p.id) !== 'REJECTED').length > 1).length;
    return '<p class="candidate-summary">Manufacturer identity: ' + count('PROPOSED') + ' rows proposed · ' + count('CONFIRMED') + ' confirmed · ' + count('UNRESOLVED') + ' unresolved · ' + multiple + ' with multiple candidates</p>';
  }
  function manufacturerDecision(identity, id) {
    return (identity.history || []).filter(h => h.proposalId === id).at(-1)?.decision || 'PROPOSED';
  }
  function rowReviewUi(row) {
    const key=(state.selected?.record?.technicalReview?.candidateBom?.id||'history')+':'+row.index;
    state.rowReviewUi ||= {};
    return state.rowReviewUi[key] ||= {};
  }
  function rememberPrimaryInputs(row) {
    const ui=rowReviewUi(row);
    if(document.getElementById('primaryManual'))ui.manualNumber=document.getElementById('primaryManual').value;
    if(document.getElementById('primaryManufacturer'))ui.manualMaker=document.getElementById('primaryManufacturer').value;
  }
  function renderManufacturer(row, readOnly=false) {
    if(readOnly)return renderManufacturerEvidence(row,true);
    const identity=row.manufacturerIdentity, ui=rowReviewUi(row);
    const proposals=(identity?.proposals||[]).filter(p=>p.partNumber?.trim()&&manufacturerDecision(identity,p.id)!=='REJECTED');
    const choice=ui.primaryChoice ?? proposals.find(p=>manufacturerDecision(identity,p.id)==='CONFIRMED')?.id ?? (proposals.length===1?proposals[0].id:'');
    return '<section class="manufacturer-proposals"><label>MFG P/N<select id="primaryChoice" '+(state.saving||identity?.stale?'disabled':'')+'><option value="">'+(proposals.length?'Select MFG P/N':'Not resolved')+'</option>'+proposals.map(p=>'<option value="'+escapeHtml(p.id)+'" '+(choice===p.id?'selected':'')+'>'+escapeHtml(p.partNumber+(p.manufacturerName?' — '+p.manufacturerName:''))+'</option>').join('')+'<option value="MANUAL" '+(choice==='MANUAL'?'selected':'')+'>Manual Entry…</option></select></label>'+(choice==='MANUAL'?'<label>MFG P/N<input id="primaryManual" maxlength="200" value="'+escapeHtml(ui.manualNumber||'')+'"></label><label>Manufacturer (optional)<input id="primaryManufacturer" maxlength="200" value="'+escapeHtml(ui.manualMaker||'')+'"></label>':'')+'<details><summary>Details</summary>'+renderManufacturerEvidence(row,true)+'</details></section>';
  }
  async function acceptPrimaryRow() {
    if(state.saving)return;
    const bom=state.selected.record.technicalReview.candidateBom,row=bom.rows[state.candidateIndex];
    rememberPrimaryInputs(row);
    const choice=document.getElementById('primaryChoice')?.value;
    if(!choice){state.message='Choose a primary MFG P/N or Manual Entry.';state.messageState='error';renderDetail();return;}
    const values=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])]));
    const primarySelection={proposalId:choice==='MANUAL'?null:choice,partNumber:document.getElementById('primaryManual')?.value,manufacturerName:document.getElementById('primaryManufacturer')?.value,expectedToken:row.reviewState.token};
    state.saving=true;
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:row.index,values,primarySelection})});
      state.candidateDraft=null;delete state.rowReviewUi?.[bom.id+':'+row.index];state.message='Row accepted.';state.messageState='';
    } catch(error){state.message=error.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }
  function renderManufacturerEvidence(row, readOnly = false) {
    const identity = row.manufacturerIdentity;
    if (!identity) return '';
    const disabled = state.saving || identity.stale ? 'disabled' : '';
    return '<section class="manufacturer-proposals"><h4>Manufacturer identity</h4><p>' + escapeHtml(identity.uncertainty) + '</p>' + identity.proposals.map(p => {
      const status = manufacturerDecision(identity, p.id);
      const link = '/api/sim/rfq-intakes/' + encodeURIComponent(state.selected.record.intakeId) + '/documents/' + encodeURIComponent(p.evidence.documentId);
      return '<article class="manufacturer-proposal"><strong>' + escapeHtml(p.partNumber) + '</strong> · ' + escapeHtml(p.manufacturerName || 'Manufacturer not supplied') + ' · <b>' + escapeHtml(status) + '</b>' +
        '<details class="manufacturer-evidence"><summary>Proposal evidence</summary><p>' + escapeHtml(p.sourceLabel) + ' · ' + escapeHtml(p.matchBasis.join('; ')) + '</p><p>' + escapeHtml(p.conflicts.join('; ') || 'No compared-field conflict detected.') + '</p>' +
        '<p>Confidence: ' + escapeHtml(p.confidence) + ' · ' + escapeHtml(p.uncertainty) + '</p><p>Governing evidence: ' + alternateEvidence(p.governingEvidence) + '</p><p>Customer identifier evidence: ' + alternateEvidence(p.customerEvidence) + '</p>' +
        '<p>MFG evidence: ' + alternateEvidence(p.evidence) + ' · <a href="' + link + '" target="_blank" rel="noopener">Open enrichment file</a></p>' +
        '<p>Source matching values: ' + escapeHtml(Object.entries(p.sourceValues).map(([k,v]) => k + ': ' + v).join(' · ')) + '</p></details>' +
        (readOnly ? '' : '<button data-technical-review-action="mfg-confirm" data-proposal-id="' + escapeHtml(p.id) + '" ' + disabled + '>Confirm mapping</button> <button data-technical-review-action="mfg-reject" data-proposal-id="' + escapeHtml(p.id) + '" ' + disabled + '>Reject mapping</button>') + '</article>';
    }).join('') + '<details><summary>Manufacturer history</summary>' + (identity.history || []).map(h => '<small>' + escapeHtml(h.proposalId + ' · ' + h.decision + ' · ' + h.reviewer + ' · ' + h.atUtc) + '</small>').join('') + '</details></section>';
  }
  async function reviewManufacturer(proposalId, decision, rowIndex = state.candidateIndex, confirmAllProposed = false) {
    if (state.saving || state.acceptedVersion || state.step === 'accepted-bom' || completedReview(state.selected?.record)) return;
    const bom = state.selected.record.technicalReview.candidateBom;
    if ((state.selected.record.technicalReview.bomAcceptances || []).some(a => a.candidate.id === bom.id)) return;
    const identity = bom.rows[rowIndex]?.manufacturerIdentity;
    if (!identity || identity.stale) return;
    state.saving = true;
    try {
      state.selected = await fetchJson('/api/sim/technical-reviews/' + encodeURIComponent(state.selected.record.intakeId) + '/candidate-bom', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex,manufacturerChange:{proposalId,decision,expectedRevision:identity.revision,...(confirmAllProposed ? {confirmAllProposed:true} : {})}})});
      state.message = 'Manufacturer mapping review saved.';
    } catch (error) { state.message = error?.message || 'Manufacturer review could not be saved.'; }
    finally { state.saving = false; renderDetail(); }
  }
  function activeRowDocumentTarget() {
    if(state.step!=='candidate' || state.candidateIndex==null || completedReview(state.selected?.record))return null;
    const bom=state.selected?.record?.technicalReview?.candidateBom,row=bom?.rows[state.candidateIndex];
    return row?{candidateId:bom.id,rowId:row.rowId||bom.id+':row:'+row.index,rowIndex:state.candidateIndex,expectedToken:row.reviewState?.token}:null;
  }
  function renderRowTechnicalFiles(bom,row,readOnly=false) {
    const record=state.selected?.record||{};
    const attached=(record.technicalFiles||[]).filter(f=>f.reviewOrigin?.rowContext?.candidateId===bom.id && f.reviewOrigin.rowContext.rowId===(row.rowId||bom.id+':row:'+row.index));
    return '<section class="row-technical-files"><h4>Technical Files</h4><span>'+(attached.length?attached.length+' attached':'No files attached')+'</span>'+(attached.length?'<details class="row-file-list"><summary>View Files</summary>'+attached.map(f=>{
      const doc=record.technicalReview?.technicalPackage?.documents.find(d=>d.documentId===f.documentId),origin=f.reviewOrigin;
      return '<div class="row-technical-file"><strong>'+escapeHtml(f.name)+'</strong><small>'+escapeHtml(identityLabels[doc?.identityReview?.type]||doc?.documentType)+'</small>'+(origin.note?'<p>'+escapeHtml(origin.note)+'</p>':'')+'<a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/'+encodeURIComponent(record.intakeId)+'/documents/'+encodeURIComponent(f.documentId)+'">View File</a><details><summary>Provenance</summary><small>'+escapeHtml(origin.addedBy)+' · '+escapeHtml(formatDateTime(origin.addedAtUtc))+'</small><small>Customer / BOM P/N: '+escapeHtml(origin.rowContext.customerBomPartNumber)+' · DLE proposed: '+escapeHtml((origin.rowContext.proposedSubassemblyIdentities||[]).join(' · ')||'None')+'</small></details></div>';
    }).join('')+'</details>':'')+(readOnly?'':addingDocuments?renderReviewUploads(true):'<button class="row-add-file" data-technical-review-action="row-add-file" '+(state.saving?'disabled':'')+'>Add File</button>')+'</section>';
  }
  function renderCandidateRow(bom, row, index, readOnly = false) {
    const disabled = state.saving ? 'disabled' : '';
    const content = '<div class="candidate-editor-heading"><h4>Row ' + (index + 1) + ' · Edit / Add Details</h4></div><div class="candidate-edit-grid"><label class="technical-review-candidate-field">Component Type' + '<select aria-label="Type in details for row '+(index+1)+'" data-worksheet-field="componentType" data-worksheet-row="'+index+'">'+Object.entries(componentTypes).map(([key,label])=>'<option value="'+key+'" '+(key===(rowReviewUi(row).componentType||row.componentType)?'selected':'')+'>'+label+'</option>').join('')+'</select></label>' + Object.entries(candidateFields).map(([key, label]) => '<label class="technical-review-candidate-field candidate-field-' + key + '">' + ({lineNumber:'Line',partNumber:'Customer / BOM P/N',quantity:'Qty / Assy',designators:'Designators',description:'Description'}[key]) + '<input id="candidate-' + key + '" value="' + escapeHtml((state.candidateDraft || row.values)[key]) + '" maxlength="2000" ' + disabled + '></label>').join('') + '</div>' + '' + '<div class="candidate-editor-actions"><button class="technical-review-primary" data-technical-review-action="worksheet-accept" data-candidate-row="'+index+'" '+disabled+'>Accept</button><button data-technical-review-action="candidate-detail" data-candidate-row="' + index + '" ' + disabled + '>Close</button></div>' +
      '<details class="candidate-evidence"><summary>Source / History</summary>' + (row.reviewer ? '<p>Reviewed by ' + escapeHtml(row.reviewer) + ' · ' + escapeHtml(row.reviewedAtUtc) + '</p>' : '') + renderManufacturer(row, true) + (row.assemblyIdentityHistory||[row.assemblyIdentity].filter(Boolean)).map(a=>'<p>Assembly P/N: '+escapeHtml(a.partNumber)+' · '+escapeHtml(a.reviewer)+' · '+escapeHtml(a.atUtc)+'</p>').join('') + renderAlternates(row, true) + Object.entries(candidateFields).map(([key, label]) => '<div class="candidate-evidence-field"><strong>' + label + '</strong><p>Governing extracted value: ' + escapeHtml(row.extracted[key] || '—') + ' · Supporting relationship: ' + escapeHtml(row.comparison[key]) + '</p>' + analysisEvidence(row.analysisFields?.[key]) + '</div>').join('') +
      '<p>Governing document: ' + escapeHtml(bom.governingDocumentId) + ' · Page ' + bom.page + ' · Bounds: ' + escapeHtml((row.bounds || []).join(', ')) + '</p><p>SHA-256: ' + escapeHtml(bom.governingSha256) + '</p>' + row.corrections.map(c => '<p>' + escapeHtml(candidateFields[c.field] || (c.field === 'componentType' ? 'Component Type' : c.field)) + ': ' + escapeHtml(c.previous) + ' → ' + escapeHtml(c.value) + ' · ' + escapeHtml(c.reviewer) + ' · ' + escapeHtml(c.atUtc) + '</p>').join('') + '</details>';
    return readOnly ? renderRowTechnicalFiles(bom,row,true)+content.slice(content.indexOf('<details class="candidate-evidence">')) : content;
  }

  function renderAcceptedBom(record) {
    const acceptance = (record.technicalReview?.bomAcceptances || []).find(a => Number(a.version) === state.acceptedVersion);
    const back = '<button type="button" class="technical-review-back" data-technical-review-action="accepted-back">← Back to ' + (record.technicalReview?.workflow ? 'Package Review' : 'Technical Review') + '</button>';
    if (!acceptance?.candidate) return '<section class="technical-review-question"><h3 id="acceptedBomTitle" tabindex="-1">Accepted BOM unavailable</h3><p role="alert">The selected accepted version was not found. Return to Technical Review and reopen the saved version.</p>' + back + '</section>';
    const bom = acceptance.candidate;
    const title = 'Accepted BOM · Version ' + acceptance.version;
    const rows = bom.rows.map((row, index) => {
      const v=row.values, identity=row.manufacturerIdentity;
      const approved=(identity?.proposals||[]).filter(p=>manufacturerDecision(identity,p.id)==='CONFIRMED');
      const alternates=(row.alternates||[]).filter(a=>!a.removedAtUtc && ['CONFIRMED','APPROVED'].includes(a.reviewStatus));
      const assembly=row.assemblyIdentity?.partNumber||alternates.find(a=>a.origin==='MANUAL')?.partNumber;
      const pn=row.componentType==='SUBASSEMBLY'?escapeHtml(assembly||'—'):approved.length?'<details class="worksheet-mfg-list"><summary>'+escapeHtml(approved[0].partNumber)+(approved.length>1?' <small>+'+(approved.length-1)+' more</small>':'')+'</summary>'+approved.map(p=>'<div>'+escapeHtml(p.partNumber+(p.manufacturerName?' — '+p.manufacturerName:''))+'</div>').join('')+'</details>':'—';
      const files=(acceptance.package?.documents||[]).filter(d=>d.rowAssociation?.rowId===(row.rowId||bom.id+':row:'+row.index));
      const detail='<details class="accepted-row-details"><summary>Details</summary>'+
        (alternates.length?'<h4>Approved alternates</h4><ul>'+alternates.map(a=>'<li>'+escapeHtml(a.partNumber)+'</li>').join('')+'</ul>':'')+
        (assembly?'<p>Assembly P/N: '+escapeHtml(assembly)+'</p>':'')+
        (files.length?'<details><summary>Technical Files ('+files.length+')</summary>'+files.map(f=>'<p><a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/'+encodeURIComponent(record.intakeId)+'/documents/'+encodeURIComponent(f.documentId)+'">'+escapeHtml(f.name)+'</a></p>').join('')+'</details>':'')+
        '<details><summary>Source / History</summary><p>Governing document: '+escapeHtml(bom.governingDocumentId)+' · Page '+escapeHtml(bom.page)+'</p><p>SHA-256: '+escapeHtml(bom.governingSha256)+'</p>'+Object.entries(candidateFields).map(([key,label])=>'<p>'+escapeHtml(label)+': '+escapeHtml(row.extracted?.[key]||'—')+'</p>'+analysisEvidence(row.analysisFields?.[key])).join('')+(row.corrections||[]).map(c=>'<p>'+escapeHtml(candidateFields[c.field]||c.field)+': '+escapeHtml(c.previous)+' → '+escapeHtml(c.value)+' · '+escapeHtml(c.reviewer)+' · '+escapeHtml(c.atUtc)+'</p>').join('')+'</details></details>';
      return '<tr><td>'+escapeHtml(v.lineNumber||'—')+'</td><td class="candidate-part">'+escapeHtml(v.partNumber||'—')+'</td><td>'+pn+'</td><td>'+escapeHtml(v.description||'—')+'</td><td>'+escapeHtml(v.quantity||'—')+'</td><td>'+escapeHtml(componentTypes[row.componentType]||componentTypes.STANDARD_COTS)+'</td><td>'+escapeHtml(v.designators||'—')+'</td><td>'+detail+'</td></tr>';
    }).join('');
    return '<section class="technical-review-question technical-review-candidate accepted-bom-reference" aria-labelledby="acceptedBomTitle">'+back+'<h3 id="acceptedBomTitle" tabindex="-1">'+escapeHtml(title)+'</h3><p>Accepted by '+escapeHtml(acceptance.reviewedBy||'Not recorded')+' · <time datetime="'+escapeHtml(acceptance.reviewedAtUtc)+'">'+escapeHtml(formatDateTime(acceptance.reviewedAtUtc))+'</time></p><p>Read-only snapshot of the accepted BOM.</p><div class="candidate-table-scroll" role="region" aria-label="'+escapeHtml(title)+'" tabindex="0"><table class="candidate-table"><thead><tr>'+['Line','Customer / BOM P/N','Approved P/N','Description','Qty / Assy','Type','Designators','Details'].map(x=>'<th scope="col">'+x+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div></section>';
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
      state.message = 'BOM accepted. Review the package, then submit to RFQs.';
      if (state.selected.record.technicalReview?.workflow) { state.step = 'inventory'; state.candidateIndex = null; state.packageDraft = null; state.packageAnswers = null; releaseReadiness = null; }
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
  function renderAlternates(row, historyOnly=false) {
    if(historyOnly)return renderLegacyAlternates(row,historyOnly);
    const ui=rowReviewUi(row), selected=ui.alternateChoice||'', entries=(row.alternates||[]).filter(a=>!a.removedAtUtc);
    const status=a=>a.reviewStatus==='APPROVED'?'Approved':a.reviewStatus==='NOT_APPROVED'?'Not Approved':'Proposed';
    const current=entries.find(a=>a.id===selected);
    return '<section class="candidate-alternates"><label>Alternate Parts<select id="alternateChoice" '+(state.saving?'disabled':'')+'><option value="">Select / Add Alternate</option>'+entries.map(a=>'<option value="'+escapeHtml(a.id)+'" '+(selected===a.id?'selected':'')+'>'+escapeHtml(a.partNumber+' — '+status(a))+'</option>').join('')+'<option value="ADD" '+(selected==='ADD'?'selected':'')+'>Add Alternate…</option></select></label>'+(selected?'<div class="candidate-alternate-add"><label>Alternate MFG P/N<input id="compactAlternateNumber" maxlength="200" value="'+escapeHtml(current?.partNumber||'')+'"></label><label>Manufacturer (optional)<input id="compactAlternateManufacturer" maxlength="200" value="'+escapeHtml(current?.manufacturerName||'')+'"></label><label>Note / evidence (optional)<input id="compactAlternateNote" maxlength="2000" value="'+escapeHtml(current?.note||'')+'"></label><button data-technical-review-action="alternate-approve" '+(state.saving?'disabled':'')+'>Approve Alternate</button>'+(current?'<button data-technical-review-action="alternate-not-approved" '+(state.saving?'disabled':'')+'>Not Approved</button>':'')+'</div>':'')+'</section>';
  }
  async function saveCompactAlternate(approve=true) {
    if(state.saving)return;
    const bom=state.selected.record.technicalReview.candidateBom,row=bom.rows[state.candidateIndex],choice=rowReviewUi(row).alternateChoice;
    rememberPrimaryInputs(row);
    const alternateChange={action:approve?'APPROVE':'EDIT',reviewStatus:approve?'APPROVED':'NOT_APPROVED',id:choice==='ADD'?null:choice,expectedRevision:row.alternateRevision||0,partNumber:document.getElementById('compactAlternateNumber').value,manufacturerName:document.getElementById('compactAlternateManufacturer').value,note:document.getElementById('compactAlternateNote').value};
    state.candidateDraft=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])]));state.saving=true;
    try {state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:row.index,alternateChange})});rowReviewUi(row).alternateChoice='';state.message=approve?'Alternate approved.':'Alternate marked Not Approved.';state.messageState='';}
    catch(error){state.message=error.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }
  function renderLegacyAlternates(row, historyOnly = false) {
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
    if(Object.keys(candidateFields).every(k=>values[k]===bom.rows[rowIndex].values[k])){state.message='No part detail changes. Use Accept Changes to confirm the row.';renderDetail();return;}
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

  function intakeAssemblyContext(record) {
    const value = record.preliminaryAssemblyType;
    const labels = { PCB_ASSEMBLY: 'PCB Assembly', CABLE_AND_HARNESS_ASSEMBLY: 'Cable and Harness Assembly', CHASSIS_BOX_BUILD_ASSEMBLY: 'Chassis / Box Build Assembly', OTHER: 'Other', UNKNOWN: 'Unknown / Not Determined' };
    return '<p>Intake identified assembly type as: ' + escapeHtml(labels[value?.type] || labels.UNKNOWN) +
      (value?.type === 'OTHER' && value.otherDescription ? ': ' + escapeHtml(value.otherDescription) : '') +
      '. Preliminary Intake context only.</p><p>Technical Review confirmation: ' + (record.technicalReview?.assemblyType ? escapeHtml(record.technicalReview.assemblyType) : 'Not yet confirmed') + '</p>';
  }

  function renderLaborFirstEntry(record) {
    const disabled = state.saving || window.DleOsCapabilities?.can?.('technical_review.disposition') !== true ? 'disabled' : '';
    return '<section class="technical-review-question" aria-labelledby="laborFirstTitle"><h3 id="laborFirstTitle" tabindex="-1">Manufacturing / Labor Review</h3>' +
      intakeAssemblyContext(record) + '<p>First, identify the assembly type. Then continue with the technical package review.</p>' +
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
    if (record.technicalReview?.workflow && record.status !== 'NO_LONGER_REQUIRED' && !state.closing) return renderWorkflowLanding(record, canDisposition);
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
    if (state.selected?.record?.technicalReview?.workflow) { resumeWorkflow(); return; }
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
    if (completedReview(state.selected?.record) && options?.method && options.method !== 'GET') throw new Error('Completed Technical Review is read-only.');
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

  window.addEventListener?.('beforeunload', event => {
    if(state.scanSheetDirty||(state.scanEdit&&state.scanEdit.input.value!==state.scanEdit.before)){event.preventDefault();event.returnValue='';}
  });
  document.addEventListener('click', event => {
    if(!state.scanSheetDirty||state.step!=='scanned-review')return;
    const target=event.target;
    if(target.closest?.('.scan-review')||!target.closest?.('a,button'))return;
    event.preventDefault();event.stopImmediatePropagation();
    const message=mount?.querySelector('[data-scan-sheet-save-state]');
    if(message)message.textContent='Save Review before leaving this worksheet.';
  },true);
  document.addEventListener("dle:workspace-navigation", event => {
    if (event.detail?.workspace?.id !== WORKSPACE_ID || !event.detail?.requestedState?.intakeId) return;
    void openReview(event.detail.requestedState.intakeId);
  });
  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({ id: WORKSPACE_ID, render: renderWorkspace, refresh: loadQueue, openReview });
})(window, document);

(function registerTechnicalReviewWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "technical-review";
  const TEMPLATE_PATH = "SRC/workspaces/technical-review/technical-review-workspace.html";
  const state = { items: [], completedItems: [], queueBucket:'ACTIVE', selected: null, loading: false, guided: false, materials: false, step: '', packageDraft: null, documentIndex: 0, closing: false, saving: false, error: "", message: "", messageState: "" };
  let mount = null;
  let identityChanges = {};
  let packageRowErrors = {};
  let addingDocuments = false;
  let reviewUploads = [];
  let reviewUploadRowTarget = null;
  let interactionsBound = false;
  let scanWorkbenchObserver = null;
  let candidateWorkbenchObserver = null;
  let partRequestQueue = null;
  let partRequestReview = null;
  let partRequestOpening = false;
  let partRequestGeneration = 0;
  let partRequestCount = 0;
  async function loadPartRequests() {
    if(window.DleMaterialPartRequestReview)return;
    if(!window.DleMaterialPartRequestReviewLoading)window.DleMaterialPartRequestReviewLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/technical-review/material-part-request-review.js';script.onload=resolve;script.onerror=()=>{window.DleMaterialPartRequestReviewLoading=null;reject(Error('Part requests could not load.'));};document.head.append(script);});
    await window.DleMaterialPartRequestReviewLoading;
  }
  function updatePartRequestCount() {
    const completed=state.queueBucket==='COMPLETED',count=document.getElementById('technicalReviewQueueCount');
    if(count)count.textContent=String(completed?state.completedItems.length:state.items.length+partRequestCount);
    const active=mount?.querySelector('[data-review-bucket="ACTIVE"]');if(active)active.textContent='Active ('+(state.items.length+partRequestCount)+')';
  }
  async function loadPartRequestQueue() {
    if(!['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment))return;
    const host=document.getElementById('technicalReviewPartRequestQueue');if(!host)return;
    try {await loadPartRequests();partRequestQueue?.destroy();partRequestQueue=await window.DleMaterialPartRequestReview.queue(host,{role:'technical-review',onCount:count=>{partRequestCount=count;updatePartRequestCount();},onOpen:openPartRequest});if(state.queueBucket==='COMPLETED')host.hidden=true;}
    catch(error){host.hidden=false;host.textContent=error.message;}
  }
  async function openPartRequest(batch,trigger) {
    if(partRequestOpening||state.saving)return;
    const blocked=reviewNavigationBlock();if(blocked){window.alert(blocked);return;}
    partRequestOpening=true;const generation=++partRequestGeneration,scroll={x:window.scrollX,y:window.scrollY};
    try {await loadPartRequests();if(generation!==partRequestGeneration)return;const host=document.getElementById('technicalReviewPartRequestView');if(!host)return;
      document.getElementById('technicalReviewQueueView').hidden=true;document.getElementById('technicalReviewDetailView').hidden=true;host.hidden=false;window.scrollTo(0,0);
      partRequestReview?.destroy();const opened=await window.DleMaterialPartRequestReview.open(host,batch.id,{role:'technical-review',titleId:'technicalReviewPartRequestTitle',back:()=>{showQueue();void partRequestQueue?.refresh();window.scrollTo(scroll.x,scroll.y);trigger?.focus({preventScroll:true});},onChanged:()=>{void partRequestQueue?.refresh();}});
      if(generation!==partRequestGeneration||opened.disposed){opened.destroy();return;}partRequestReview=opened;
      setStatus('Part request','ready');
    }catch(error){if(generation===partRequestGeneration)setStatus(error.message,'error');}finally{if(generation===partRequestGeneration)partRequestOpening=false;}
  }
  let showCandidateDnps = false;

  async function loadPreparation() {
    if(window.DleLibraryPreparation)return;
    if(!window.DleLibraryPreparationLoading)window.DleLibraryPreparationLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/assembly-library/library-preparation.js';script.onload=resolve;script.onerror=()=>{window.DleLibraryPreparationLoading=null;reject(Error('Preparation workspace could not load.'));};document.head.append(script);});
    await window.DleLibraryPreparationLoading;
  }
  async function renderWorkspace() {
    if(partRequestReview&&!partRequestReview.canLeave())return;
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
    const libraryButton=mount.querySelector('[data-technical-review-action="assembly-library"]');
    if(libraryButton)libraryButton.hidden=!['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment);
    if (!state.saving) showQueue();
    await loadQueue();
  }

  function bindInteractions() {
    if (interactionsBound || !mount) return;
    interactionsBound = true;
    mount.addEventListener('click', customerIdentityAction);
    mount.addEventListener('click', drawingFolderAction);
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
    mount.addEventListener('pointerdown', startCandidateColumnResize);
    mount.addEventListener('pointermove', moveCandidateColumnResize);
    mount.addEventListener('pointerup', endCandidateColumnResize);
    mount.addEventListener('pointercancel', endCandidateColumnResize);
    mount.addEventListener('lostpointercapture', endCandidateColumnResize);
    mount.addEventListener('keydown', candidateColumnResizeKey);
    mount.addEventListener('dblclick', beginCandidateDescriptionEdit);
    mount.addEventListener('keydown', candidateDescriptionKey);
    mount.addEventListener('copy', copyCandidatePartNumber);
    mount.addEventListener('focusout', event=>{if(event.target.matches?.('[data-inline-description]')&&event.target.isConnected&&!event.target.dataset.finishing)candidateDescriptionKey({target:event.target,key:'Enter',type:'focusout',preventDefault(){},stopPropagation(){}});});
    mount.addEventListener('click', selectCandidateCell);
    mount.addEventListener('input',event=>{if(!event.target.matches?.('[data-candidate-select-all], [data-candidate-select-row]'))window.queueMicrotask?.(()=>{updateCandidateProgressStatus();if(state.step==='inventory')renderSubmissionStatus();});});
    mount.addEventListener('change',event=>{if(!event.target.matches?.('[data-candidate-select-all], [data-candidate-select-row]'))window.queueMicrotask?.(()=>{updateCandidateProgressStatus();if(state.step==='inventory')renderSubmissionStatus();});});
    mount.addEventListener('keydown', event=>{
      if(event.key==='Escape' && state.scanLeavePrompt){event.preventDefault();setScanLeavePrompt(false);}
    });
    const finalBomInput=event=>{
      const f=state.finalBomReview;if(!f||f.busy)return;
      const choice=event.target.dataset?.finalBomChoice,key=choice||event.target.dataset?.finalBomField;if(!key)return;
      if(choice){if(!event.target.checked)return;f[key]=event.target.value==='yes';f[key+'Answer']=event.target.value;const followup=mount.querySelector('[data-final-followup="'+key+'"]'),help=mount.querySelector('[data-final-choice-help="'+key+'"]');if(followup)followup.hidden=!f[key];if(help)help.hidden=f[key];}
      else f[key]=event.target.value;
      const submit=mount.querySelector('[data-technical-review-action="final-bom-submit"]');if(submit)submit.disabled=!finalBomCanSubmit();
    };
    mount.addEventListener('input',finalBomInput);mount.addEventListener('change',finalBomInput);
    mount.addEventListener('input', updateScannedWorksheet);
    mount.addEventListener('change', updateScannedWorksheet);
    mount.addEventListener("click", event => {
      const packageRow = event.target.closest?.("[data-package-row]");
      if (packageRow) state.documentIndex = Number(packageRow.dataset.packageRow);
      const actionButton = event.target.closest?.("[data-technical-review-action]");
      const action = actionButton?.dataset.technicalReviewAction;
      if(action==='remove-review-document'||action==='restore-review-document'){void changeReviewDocumentRemoval(actionButton.dataset.documentId,action==='restore-review-document');return;}
      if(state.preparationDraft&&action&&!['preparation-save','preparation-cancel'].includes(action)){const message=mount.querySelector('[data-preparation-message]');if(message)message.textContent='Save preparation draft or Cancel edits before continuing.';return;}
      if(action?.startsWith('preparation-')){void preparationAction(action,actionButton);return;}
      if(action==='cancel-reference-selection'&&!state.saving){state.teamDraft=null;const select=mount?.querySelector('#reviewTeamReference');if(select)select.value=state.selected?.record?.technicalReview?.presentationDraft?.teamDocumentId||'';actionButton.hidden=true;return;}
      if(action?.startsWith('source-')){void sourceAction(action);return;}
      if(action==='cancel-package-row'){cancelPackageRow(actionButton.dataset.documentId);return;}
      if(action==='show-incomplete-save'){state.showIncompleteSave=true;renderDetail();mount?.querySelector?.('#packageDraftHoldReason')?.focus?.({preventScroll:true});return;}
      if(action==='use-drawing-for-bom'){stageDrawingForBom();return;}
      if(action==='assembly-library'){openAssemblyLibrary();return;}
      if(action==='library-back'){returnToQueue();return;}
      if(action==='back'&&canReturnToQueue()){returnToQueue();return;}
      if(state.step==='candidate'&&state.saving&&action)return;
      if(action==='final-bom-back'&&!state.saving){cancelFinalBomReview();return;}
      if(action==='final-bom-retry'){void loadFinalBomReview();return;}
      if(action==='final-bom-submit'){void submitFinalBomReview();return;}
      if(action==='complete-bom'&&usesFinalBomReview()){void openFinalBomReview();return;}
      if(action==='vpro-review-load'){void loadVproDecisions();return;}
      if(action==='vpro-baseline-save'){void saveVproDecision('APPROVE_BASELINE');return;}
      if(action==='vpro-discrepancies-save'){void saveVproDecision('COMPLETE_DISCREPANCIES');return;}
      if(action==='vpro-build'){void buildVproDraft(actionButton.dataset.documentId);return;}
      if(action==='vpro-open'){state.guided=true;state.step='candidate';state.candidateIndex=null;renderDetail();return;}
      if(action==='complete-bom'&&!candidateCompletionEnabled())return;
      if(action==='assembly-pn-save'){const index=Number(actionButton.dataset.candidateRow),row=state.selected.record.technicalReview.candidateBom.rows[index];const ui=rowReviewUi(row);if((ui.componentType||row.componentType)!=='SUBASSEMBLY')return;ui.assemblyNumber=document.getElementById('assembly-panel-'+index)?.value??ui.assemblyNumber;if(!ui.assemblyNumber?.trim()){state.message='Enter the approved Assembly P/N.';state.messageState='error';renderDetail();return;}ui.editing=true;void saveCandidateProgress(false,index);return;}
      if(action==='save-team-reference'){void saveTeamReference();return;}
      if(action==='draft-slides'){void openDraftSlides(actionButton);return;}
      if(action==='bom-source'||action==='bom-manual'){state.bomRoute=action==='bom-source'?'source':'manual';const details=mount.querySelector('[data-review-source-details]');if(details)details.open=state.bomRoute==='source';renderDetail();return;}
      if(action==='manual-bom-create'){void createManualBom();return;}
      if(action==='manual-bom-revise'){void reviseManualBom();return;}
      if(action==='submission-requirement'){void resolveSubmissionRequirement(actionButton.dataset.requirement,actionButton);return;}
      if(action==='manual-bom-open'){if(Object.keys(identityChanges).length){state.message='Accept or finish pending document edits before opening the working BOM.';renderDetail();return;}void reopenCandidate();return;}
      if(action==='manual-bom-add-row'){void addManualBomRow();return;}
      if(action==='candidate-save-progress'){void saveCandidateProgress();return;}
      if(action==='candidate-leave-cancel'){state.candidateLeaveIntent=null;renderDetail();return;}
      if(action==='candidate-leave-discard'){const intent=state.candidateLeaveIntent;clearCandidateDrafts();state.candidateLeaveIntent=null;renderDetail();continueCandidateAction(intent);return;}
      if(action==='candidate-leave-save'){void saveCandidateProgress(true);return;}
      if(state.step==='candidate' && action && candidateProgressRows().length && (['back','governing-back','refresh','complete-bom','accepted-bom','candidate-detail'].includes(action) || (actionButton.dataset.candidateRow!==undefined&&Number(actionButton.dataset.candidateRow)!==state.candidateIndex&&state.candidateDraft))) {
        state.candidateLeaveIntent={...actionButton.dataset};renderDetail();const prompt=mount?.querySelector('[data-candidate-leave-prompt]');if(action!=='worksheet-options')prompt?.scrollIntoView?.({block:'nearest'});prompt?.focus?.({preventScroll:true});return;
      }
      if(action==='candidate-row-edit') {
        const row=state.selected.record.technicalReview.candidateBom.rows[Number(actionButton.dataset.candidateRow)];
        if(!state.saving&&!completedReview(state.selected.record)&&!state.acceptedVersion){rowReviewUi(row).editing=true;renderDetail();}return;
      }
      if (action === 'candidate-reset-widths') { candidateColumnWidths={}; saveCandidateColumnWidths(); applyCandidateColumnWidths(); return; }
      if(action==='submitted-done' && !state.saving && state.step==='submitted' && completedReview(state.selected?.record)){window.goHome();return;}
      if (completedReview(state.selected?.record)) {
        if (action === 'review-queue') { returnToQueue(); return; }
        if (action?.startsWith('view-')) { state.step = action.slice(5); state.candidateIndex = null; state.acceptedVersion = null; renderDetail(); return; }
        if (action && !['back','refresh','accepted-bom','accepted-back','candidate-detail','worksheet-options','candidate-panel-close'].includes(action)) return;
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
        if (state.selected?.record?.technicalReview?.candidateBom) void reopenCandidate();
        else void buildCandidate();
      }
      if (action === 'analysis-retry') void buildCandidate();
      if (action === 'candidate-detail' && !state.saving) {
        const index = Number(event.target.closest('[data-candidate-row]').dataset.candidateRow);
        if(state.inlineDescriptionDirty&&state.candidateIndex===index){state.candidateInlineRow=index;renderDetail();return;}
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
      if(action==='bulk-entered-mpn'){void reviewSelectedCandidateRows('USE_ENTERED_MPN');return;}
      if(action==='bulk-accept'){void reviewSelectedCandidateRows('ACCEPT_SELECTED');return;}
      if(action==='source-pn-open'){openSourcePartNumber(actionButton);return;}
      if(action==='source-pn-confirm'){void confirmSourcePartNumber(actionButton);return;}
      if(action?.startsWith('identity-basis-')){void identityBasisAction(action,actionButton);return;}
      if(action?.startsWith('approved-pn-')){void approvedPartAction(action,actionButton);return;}
      if(action==='worksheet-reject'){void reviewManufacturer(actionButton.dataset.proposalId,'REJECTED',Number(actionButton.dataset.candidateRow));return;}
      if(action==='worksheet-accept'){void acceptWorksheetRow(Number(actionButton.dataset.candidateRow));return;}
      if(action==='candidate-panel-close'&&!state.saving){state.rowOption='closed';if(!candidateProgressRows().length&&!reviewUploads.length&&!rowReviewUi(state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex]).alternateDraft)state.candidateIndex=null;renderDetail();return;}
      if(action==='worksheet-options'){
        if(state.saving)return;
        if(state.candidateIndex!=null&&state.candidateIndex!==Number(actionButton.dataset.candidateRow)&&(reviewUploads.length||rowReviewUi(state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex]).alternateDraft)){state.message='Save or cancel pending file or alternate changes before switching rows.';renderDetail();return;}
        state.candidateInlineRow=null;
        if(state.candidateIndex!==Number(actionButton.dataset.candidateRow))state.candidateDraft=null;
        state.candidateIndex=Number(actionButton.dataset.candidateRow);state.rowOption=actionButton.dataset.panel;state.message='';state.messageState='';
        const review=state.selected.record.technicalReview;const row=(review.bomAcceptances?.find(a=>state.acceptedVersion?a.version===state.acceptedVersion:a.candidate.id===review.candidateBom?.id)?.candidate||review.candidateBom).rows[state.candidateIndex];
        if(state.rowOption==='edit')rowReviewUi(row).editing=true;
        renderDetail();
        const selectedRow=mount?.querySelector?.('tr[data-worksheet-row="'+state.candidateIndex+'"]');
        const viewport=mount?.querySelector?.('.candidate-table-scroll');
        if(!['alternates','preparation'].includes(state.rowOption)&&selectedRow&&viewport){const r=selectedRow.getBoundingClientRect(),v=viewport.getBoundingClientRect();if(r.top<v.top+40||r.bottom>v.bottom)viewport.scrollTop+=r.top-v.top-40;}
        if(state.rowOption==='alternates'&&viewport){const panel=mount.querySelector('#candidate-detail-'+state.candidateIndex);if(panel){panel.querySelector('#alternateChoice')?.focus({preventScroll:true});}}
        return;
      }
      if(action==='alternate-draft-cancel'&&!state.saving){const ui=rowReviewUi(state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex]);delete ui.alternateDraft;renderDetail();return;}
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
      if(preparationInput(event))return;
      if(sourceInput(event))return;
      if(event.target.id==='manualBomRevisionReason'){state.manualRevisionReason={intakeId:state.selected.record.intakeId,value:event.target.value};return;}
      if(event.target.dataset?.manualField){
        const row=state.selected.record.technicalReview.candidateBom.rows[Number(event.target.dataset.manualRow)];
        const ui=rowReviewUi(row);ui.manualValues={...(ui.manualValues||row.values),[event.target.dataset.manualField]:event.target.value};
        updateCandidateProgressStatus();return;
      }
      if(event.target.dataset?.worksheetField && !state.saving && !completedReview(state.selected?.record)) {
        const row=state.selected?.record?.technicalReview?.candidateBom?.rows[Number(event.target.dataset.worksheetRow)];
        if(row)rowReviewUi(row)[event.target.dataset.worksheetField]=event.target.value;
      }
      if(event.target.dataset?.identityBasisField&&!state.saving&&state.candidateIndex!=null){const draft=rowReviewUi(state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex]).identityBasisDraft;if(draft){draft.partNumber=event.target.value;updateCandidateProgressStatus();}}
      if(event.target.dataset?.approvedPartField&&!state.saving&&state.candidateIndex!=null) {
        const row=state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex];
        const draft=rowReviewUi(row).approvedPartDraft;if(draft){draft[event.target.dataset.approvedPartField]=event.target.value;updateCandidateProgressStatus();}
      }
      if(['primaryManual','primaryManufacturer','primaryAssembly'].includes(event.target.id)&&state.candidateIndex!=null&&!state.saving)rememberPrimaryInputs(state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex]);
      if(['compactAlternateNumber','compactAlternateManufacturer','compactAlternateNote'].includes(event.target.id)&&state.candidateIndex!=null){const ui=rowReviewUi(state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex]);ui.alternateDraft={partNumber:document.getElementById('compactAlternateNumber').value,manufacturerName:document.getElementById('compactAlternateManufacturer').value,note:document.getElementById('compactAlternateNote').value};const savedStatus=mount.querySelector('.alternate-saved-status');if(savedStatus)savedStatus.textContent='Unsaved edits — choose a decision to save, or Cancel edits.';}
      if (['packageMissing','packageDraftHoldReason'].includes(event.target.id)) { packageAnswers().missing = event.target.value; return; }
      if (updateReviewUpload(event.target)) return;
      if (event.target.id?.startsWith('candidate-') && state.candidateIndex != null && !state.saving) { const field=event.target.id.slice(10); if(candidateFields[field])state.candidateDraft={...(state.candidateDraft||state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex].values),[field]:event.target.value}; }
      const packageRow=event.target.closest?.('[data-package-row]'); if(packageRow)state.documentIndex=Number(packageRow.dataset.packageRow);
      if (event.target.dataset?.identityOther !== undefined && !completedReview(state.selected?.record)) { const d=packageDraft().documents[state.documentIndex||0]; identityChanges[d.documentId] ||= {type:identityType(d),otherDescription:''}; identityChanges[d.documentId].otherDescription=event.target.value; }
      if (!completedReview(state.selected?.record) && !state.saving && ['subassemblyPartNumber','proposedSubassemblyIdentity'].includes(event.target.dataset?.packageField)) packageDraft().documents[state.documentIndex || 0][event.target.dataset.packageField] = event.target.value;
    });
    mount.addEventListener('change', event => {
      if(preparationInput(event))return;
      if(sourceInput(event))return;
      if(['reviewTeamReference','reviewReferenceStatus'].includes(event.target.id)){state.teamDraft={intakeId:state.selected.record.intakeId,teamDocumentId:document.getElementById('reviewTeamReference').value||null,referenceStatus:document.getElementById('reviewReferenceStatus').value};renderSubmissionStatus();const cancel=mount?.querySelector('[data-technical-review-action="cancel-reference-selection"]');if(cancel)cancel.hidden=!pendingReferenceSelection();return;}
      if(event.target.matches?.('[data-candidate-select-all], [data-candidate-select-row]')){selectCandidateRows(event.target);return;}
      if(event.target.dataset?.sourcePnBasis!==undefined){const row=state.selected.record.technicalReview.candidateBom.rows[Number(event.target.dataset.sourcePnBasis)];rowReviewUi(row).sourcePnBasis=event.target.value;const panel=event.target.closest('.source-pn-popover');panel.querySelector('[data-source-pn-result]').textContent=sourcePartNumberResult(event.target.value,row.values.partNumber);panel.querySelector('[data-technical-review-action=source-pn-confirm]').textContent=event.target.value==='UNRESOLVED'?'Mark P/N Unresolved':'Confirm P/N Identity';return;}
      if(event.target.matches?.('[data-candidate-show-dnps]')) {
        showCandidateDnps=event.target.checked;
        mount.querySelectorAll('[data-candidate-dnp]').forEach(row=>{row.hidden=!showCandidateDnps;});
        return;
      }
      const packageRow=event.target.closest?.('[data-package-row]'); if(packageRow)state.documentIndex=Number(packageRow.dataset.packageRow);
      if (completedReview(state.selected?.record) || state.saving || !state.selected || state.step === 'accepted-bom') return;
      if (event.target.name === 'packageComplete') { packageAnswers().complete = event.target.value; renderDetail(); return; }
      if(event.target.dataset?.worksheetField==='primaryChoice'){
        const index=Number(event.target.dataset.worksheetRow),row=state.selected.record.technicalReview.candidateBom.rows[index];
        if(event.target.value.startsWith('ALT:')||row.selectedApprovedAlternate){void chooseApprovedAlternate(index,event.target.value);return;}
      }
      if(event.target.dataset?.worksheetField){
        const index=Number(event.target.dataset.worksheetRow),row=state.selected.record.technicalReview.candidateBom.rows[index];
        const ui=rowReviewUi(row);ui[event.target.dataset.worksheetField]=event.target.value;
        if(event.target.dataset.worksheetField==='primaryChoice')rememberCandidateDisplayChoice(row,event.target.value);
        if(state.candidateIndex===index && document.getElementById('candidate-partNumber'))state.candidateDraft=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])]));
        if(event.target.tagName==='SELECT')renderDetail();
        else {const choice=event.target.closest?.('.candidate-identity-choice');if(choice){choice.querySelector('[data-approved-part]').textContent=event.target.value||'Not resolved';choice.open=false;}}
        return;
      }
      if(['primaryChoice','alternateChoice'].includes(event.target.id)) {
        const row=state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex];
        state.candidateDraft=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])]));
        rememberPrimaryInputs(row);if(event.target.id==='alternateChoice'&&rowReviewUi(row).alternateDraft){state.message='Save the pending alternate before choosing another.';renderDetail();return;}rowReviewUi(row)[event.target.id]=event.target.value;renderDetail();return;
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
          d.documentType=({VPRO5_BOM_EXPORT:'SUPPORTING_DOCUMENT',DRAWING:'ASSEMBLY_DRAWING',DRAWING_AND_BOM:'ASSEMBLY_DRAWING',BOM_ONLY:'BOM',GERBER_FILES:'GERBER',DATASHEET:'SUPPORTING_DOCUMENT',SPECIFICATION:'SUPPORTING_DOCUMENT',OTHER:'SUPPORTING_DOCUMENT',UNKNOWN:'UNKNOWN'})[event.target.value];
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
    return state.packageDraft ||= savedPackageProjection();
  }
  function savedPackageProjection() {
    const record=state.selected.record;
    const initial=file=>({documentId:file.documentId,name:file.name,documentType:({VPRO5_BOM_EXPORT:'SUPPORTING_DOCUMENT',DRAWING:'ASSEMBLY_DRAWING',DRAWING_AND_BOM:'ASSEMBLY_DRAWING',BOM_ONLY:'BOM',OTHER:'SUPPORTING_DOCUMENT'})[file.initialIdentification?.type]||'UNKNOWN',embeddedBom:file.initialIdentification?.type==='DRAWING_AND_BOM',role:'UNRESOLVED',applicability:'SUPPORTING_REFERENCE',subassemblyPartNumber:null});
    const pack=JSON.parse(JSON.stringify(record.technicalReview?.technicalPackage||{documents:[],governingBomDocumentId:null}));
    for(const file of record.technicalFiles||[])if(!pack.documents.some(d=>d.documentId===file.documentId))pack.documents.push(initial(file));
    return pack;
  }
  function pendingPackageValues() {
    return !!state.packageDraft && JSON.stringify(unifiedPackageDraft(state.packageDraft))!==JSON.stringify(unifiedPackageDraft(savedPackageProjection()));
  }
  function pendingReferenceSelection() {
    const record=state.selected.record,draft=state.teamDraft,saved=record.technicalReview.presentationDraft||{};
    return draft?.intakeId===record.intakeId && ((draft.teamDocumentId||null)!==(saved.teamDocumentId||null)||(draft.referenceStatus||'UNKNOWN')!==(saved.referenceStatus||'UNKNOWN'));
  }
  function engineeringReferenceSelected() {
    return state.selected?.record?.technicalReview?.presentationDraft?.referenceStatus==='PRELIMINARY';
  }
  function linkedViewingRendition(doc) {
    const record=state.selected.record,draft=record.technicalReview.presentationDraft;
    return !!draft?.teamDocumentId && draft.renditionDocumentId===doc.documentId && record.technicalFiles.some(f=>f.documentId===doc.documentId&&f.type==='application/pdf'&&f.binaryStatus==='VERIFIED');
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
    return '<section class="review-document-upload"><h4>'+ (rowMode?'Attach Technical Files':'Add Package-Level Document') +'</h4><p>'+ (rowMode?'Association comes from this saved BOM row. Save row edits before attaching files.':'For main assembly and package-wide files. Add component/subassembly files from Candidate BOM row details.') +' Select one or more files and identify each document. Files are preserved with this review; analysis starts only when requested.</p><label class="review-file-drop" data-review-drop-zone aria-disabled="'+(state.saving?'true':'false')+'"><input id="reviewDocumentFiles" type="file" aria-label="Select technical files" multiple '+disabled+'><span>Choose technical files</span><small>Browse files on this device, or drop files here</small></label><p>Up to 20 MB per file. Selected files are saved only when you choose '+(rowMode?'Save Files':'Save Documents')+'.</p>' + reviewUploads.map((upload,index) => {
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
  const identityLabels = {VPRO5_BOM_EXPORT:'VPRO5 BOM Export',DRAWING:'Drawing',DRAWING_AND_BOM:'Drawing + BOM',BOM_ONLY:'BOM Only',GERBER_FILES:'Gerber Files',DATASHEET:'Datasheet',SPECIFICATION:'Specification / Supporting Document',UNKNOWN:'Unknown / Not Determined',OTHER:'Other'};
  function identityType(doc) { if(['VPRO5_BOM_EXPORT','DATASHEET','SPECIFICATION'].includes(doc.identityReview?.type))return doc.identityReview.type; return doc.documentType === 'ASSEMBLY_DRAWING' ? (doc.embeddedBom ? 'DRAWING_AND_BOM' : 'DRAWING') : ['BOM','SUBASSEMBLY_BOM'].includes(doc.documentType) ? 'BOM_ONLY' : doc.documentType === 'GERBER' ? 'GERBER_FILES' : doc.documentType === 'UNKNOWN' ? 'UNKNOWN' : 'OTHER'; }
  function identityReviewed(doc) { return !!doc.identityReview || !!state.selected.record.technicalReview?.technicalPackage?.documents.some(d=>d.documentId===doc.documentId && d.documentType!=='UNKNOWN'); }
  function confirmIdentity() {
    if (state.saving || completedReview(state.selected?.record)) return;
    const doc=packageDraft().documents[state.documentIndex||0], source=state.selected.record.technicalFiles.find(f=>f.documentId===doc.documentId), initial=source?.initialIdentification;
    const previousType=identityType(doc);
    const choice=identityChanges[doc.documentId] || {type:initial?.type||'UNKNOWN',otherDescription:initial?.otherDescription};
    if (choice.type !== identityType(doc)) { doc.documentType=({VPRO5_BOM_EXPORT:'SUPPORTING_DOCUMENT',DRAWING:'ASSEMBLY_DRAWING',DRAWING_AND_BOM:'ASSEMBLY_DRAWING',BOM_ONLY:'BOM',GERBER_FILES:'GERBER',DATASHEET:'SUPPORTING_DOCUMENT',SPECIFICATION:'SUPPORTING_DOCUMENT',UNKNOWN:'UNKNOWN',OTHER:'SUPPORTING_DOCUMENT'})[choice.type]; doc.embeddedBom=choice.type==='DRAWING_AND_BOM'; }
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
      return '<tr data-package-row="'+index+'"><th scope="row" title="'+escapeHtml(doc.name)+'">'+escapeHtml(doc.name)+(source?.readability?'<small>Document Readability: '+escapeHtml(({TEXT_READABLE:'Text-readable',IMAGE_ONLY:'Scanned / image-only',MIXED:'Mixed — some pages may require image/OCR processing',UNKNOWN:'Unable to determine — Readability check unavailable'})[source.readability.status] || 'Unable to determine')+'</small>':'')+'<small>Source: '+(source?.reviewOrigin?'Technical Review':'Intake')+'</small><small>'+escapeHtml(doc.rowAssociation?'BOM row '+(doc.rowAssociation.rowIndex+1)+' · '+doc.rowAssociation.customerBomPartNumber+' · '+doc.rowAssociation.componentType:applicability[doc.applicability])+(doc.applicability==='SUBASSEMBLY'?' · Customer / BOM P/N: '+escapeHtml(doc.subassemblyPartNumber)+(doc.proposedSubassemblyIdentity?' · DLE proposed: '+escapeHtml(doc.proposedSubassemblyIdentity):''):'')+'</small>'+(source?.reviewOrigin?'<small>Added by '+escapeHtml(source.reviewOrigin.addedBy)+' · '+escapeHtml(formatDateTime(source.reviewOrigin.addedAtUtc))+'</small>'+(source.reviewOrigin.note?'<small>'+escapeHtml(source.reviewOrigin.note)+'</small>':''):'')+'</th><td>'+proposal+'</td><td>'+view+reviewDocumentRemoveButton(doc.documentId)+'</td><td>'+controls+'</td><td><strong>'+status+'</strong>'+(doc.identityReview?'<small>'+(doc.identityReview.reviewedBy?escapeHtml(doc.identityReview.reviewedBy)+' · '+escapeHtml(formatDateTime(doc.identityReview.reviewedAtUtc)):'Unsaved')+'</small>':'')+'</td></tr>';
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
    return !!d && isBomSource(d) && !d.rowAssociation && d.applicability==='PARENT_ASSEMBLY' && d.bomUse==='GOVERNING_BOM' && state.selected.record.technicalFiles.some(f=>f.documentId===d.documentId&&f.type==='application/pdf'&&f.binaryStatus==='VERIFIED');
  }
  function unifiedPackageIssue() {
    const docs=unifiedPackageDraft().documents;
    if(docs.some(d=>!d.rowAssociation&&(!packageRowLocked(d)||d.documentType==='UNKNOWN')) || Object.keys(identityChanges).length)return 'Accept each document row before completing the package.';
    if(pnIssue())return pnIssue();
    if(docs.filter(d=>d.productionUse==='PRIMARY_DRAWING'&&d.applicability==='PARENT_ASSEMBLY'&&d.documentType==='ASSEMBLY_DRAWING'&&!d.rowAssociation).length!==1)return 'Select one Main Production Drawing for the Main Assembly.';
    const review=state.selected.record.technicalReview;
    if(review.candidateBom?.manualDraft){
      if(review.materialsReviewStatus!=='QUALIFIED'||!finalBomAccepted(state.selected.record,review.candidateBom.id))return 'Complete BOM Review to accept the DLE-authored BOM for RFQ.';
    }else if(docs.filter(d=>d.bomUse==='GOVERNING_BOM'&&d.applicability==='PARENT_ASSEMBLY'&&isBomSource(d)&&!d.rowAssociation).length!==1)return 'Select one Main BOM for the Main Assembly.';
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
  function unchangedPackageRow(id) {
    const current=unifiedPackageDraft().documents.find(d=>d.documentId===id),saved=unifiedPackageDraft(savedPackageProjection()).documents.find(d=>d.documentId===id),choice=identityChanges[id];
    return !!saved && JSON.stringify(current)===JSON.stringify(saved) && (!choice||(choice.type===identityType(saved)&&(choice.otherDescription||'')===(saved.identityReview?.otherDescription||'')));
  }
  function cancelPackageRow(id) {
    if(state.saving||!identityChanges[id])return;
    const pack=unifiedPackageDraft(),savedPack=unifiedPackageDraft(savedPackageProjection()),saved=savedPack.documents.find(d=>d.documentId===id);
    if(!saved)return;
    if((saved.productionUse==='PRIMARY_DRAWING'&&pack.documents.some(d=>d.documentId!==id&&d.productionUse==='PRIMARY_DRAWING'))||
      (saved.bomUse==='GOVERNING_BOM'&&pack.documents.some(d=>d.documentId!==id&&d.bomUse==='GOVERNING_BOM'))){window.alert('Another row now holds this document’s saved role. Resolve that role change first; other row edits will not be discarded.');return;}
    if(!unchangedPackageRow(id)&&!window.confirm('Cancel unsaved edits to "'+saved.name+'" only? Other document rows, the drawing choice and files are kept.'))return;
    pack.documents=pack.documents.map(d=>d.documentId===id?saved:d);
    if(saved.bomUse==='GOVERNING_BOM')pack.governingBomDocumentId=id;else if(pack.governingBomDocumentId===id)pack.governingBomDocumentId=null;
    delete identityChanges[id];delete packageRowErrors[id];state.message='Unsaved edits to this document row cancelled. Saved file and other edits retained.';renderDetail();
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
  function manualBomPanel() {
    if (!state.selected?.manualBomAvailable || completedReview(state.selected.record)) return '';
    const bom=state.selected.record.technicalReview?.candidateBom;
    if(bom && !bom.manualDraft)return '';
    const accepted=bom&&finalBomAccepted(state.selected.record,bom.id);
    return '<section class="technical-review-question"><h3>DLE-authored BOM</h3><p>'+
      (bom?bom.rows.length+' saved rows · manual revision '+bom.manualDraft.revision+'.':'Start an empty worksheet and enter parts manually.')+
      '</p><button class="technical-review-primary" data-technical-review-action="'+(bom?'manual-bom-open':'manual-bom-create')+'" '+(state.saving?'disabled':'')+'>'+
      (accepted?'View Reviewed BOM':bom?'Open Working BOM':'Create Blank BOM')+'</button>'+
      (accepted?'<details><summary>Revise accepted BOM</summary><label>Reason for revision<textarea id="manualBomRevisionReason" maxlength="1000">'+escapeHtml(state.manualRevisionReason?.intakeId===state.selected.record.intakeId?state.manualRevisionReason.value:'')+'</textarea></label><p>The accepted version is retained. The new revision requires row review, BOM acceptance for RFQ and slide acceptance again.</p><button data-technical-review-action="manual-bom-revise" '+(state.saving?'disabled':'')+'>Start new BOM revision</button></details>':'<p>Accept the rows, then use Complete BOM Review to accept this BOM for RFQ.</p>')+'</section>';
  }
  async function reviseManualBom(){
    if(state.saving)return;
    const bom=state.selected.record.technicalReview.candidateBom,reason=document.getElementById('manualBomRevisionReason')?.value?.trim();
    if(!reason){state.message='Enter a reason for the new BOM revision.';state.messageState='error';renderDetail();return;}
    state.saving=true;renderDetail();
    try{
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/manual-bom/revisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,expectedRevision:bom.manualDraft.revision,reason})});
      clearCandidateDrafts();state.manualRevisionReason=null;state.acceptedVersion=null;state.finalBomReview=null;state.finalBomDraft=null;state.step='candidate';releaseReadiness=null;
      state.message='New BOM revision opened. Prior acceptance is retained in history; review this revision before submitting.';state.messageState='';
    }catch(e){state.message=e.message;state.messageState='error';}finally{state.saving=false;renderDetail();}
  }
  async function createManualBom() {
    if(state.saving)return;
    if(Object.keys(identityChanges).length){state.message='Accept or finish the pending document edits before creating the working BOM.';renderDetail();return;}
    state.saving=true;state.message='';renderDetail();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/manual-bom',
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedReviewToken:state.selected.packageReviewToken})});
      clearCandidateDrafts();state.step='candidate';state.materials=false;state.acceptedVersion=null;
    } catch(e){state.message=e.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }
  async function addManualBomRow() {
    if(state.saving)return;
    if(candidateProgressRows().length){state.message='Save Progress before adding another row.';renderDetail();return;}
    const bom=state.selected.record.technicalReview.candidateBom;
    // Retain the operation ID on a failed request so a retry cannot add the same row twice.
    state.manualRowRequest ||= {candidateId:bom.id,rowId:window.crypto.randomUUID(),expectedRevision:bom.manualDraft.revision};
    state.saving=true;renderDetail();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/manual-bom/rows',
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state.manualRowRequest)});
      state.manualRowRequest=null;clearCandidateDrafts();state.message='Blank row added. Enter the known values; leave unresolved fields blank.';state.messageState='';
    } catch(e){state.message=e.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }
  function manualRow(row,index,readOnly,bom) {
    const ui=rowReviewUi(row),locked=readOnly||row.reviewState?.reviewed&&!ui.editing,values=ui.manualValues||row.values;
    const field=(key,label)=>'<td>'+(locked?escapeHtml(values[key]||'Unresolved'):'<input aria-label="'+label+' for row '+(index+1)+'" data-manual-field="'+key+'" data-manual-row="'+index+'" '+(state.saving?'disabled':'')+' maxlength="2000" placeholder="Unresolved" value="'+escapeHtml(values[key]||'')+'">')+'</td>';
    const type=ui.componentType||row.componentType;
    const types={UNKNOWN:'Not determined',...componentTypes};
    const expanded=state.candidateIndex===index&&state.rowOption==='approved-pns';
    const line=field('lineNumber','Line number');
    return '<tr data-worksheet-row="'+index+'">'+(candidateBulkEnabled(bom,readOnly)?line.replace('<td>','<td class="manual-select-line"><div class="manual-line-content">'+candidateRowCheckbox(bom,row,index)).replace('</td>','</div></td>'):line)+
      '<td><span class="candidate-status">'+(locked?'Accepted':'Needs Review')+'</span>'+
      (readOnly?'':'<button data-technical-review-action="'+(locked?'candidate-row-edit':'worksheet-accept')+'" data-candidate-row="'+index+'" '+(state.saving?'disabled':'')+'>'+(locked?'Edit':'Accept')+'</button>')+candidateBulkRowResult(bom,row)+'</td>'+
      field('partNumber','Part number')+'<td>'+worksheetIdentity(row,index,locked,type)+'</td>'+field('description','Description')+field('quantity','Quantity per assembly')+
      '<td>'+(locked?escapeHtml(types[type]):'<select aria-label="Component type for row '+(index+1)+'" data-worksheet-field="componentType" data-worksheet-row="'+index+'" '+(state.saving?'disabled':'')+'>'+Object.entries(types).map(([k,v])=>'<option value="'+k+'" '+(k===type?'selected':'')+'>'+v+'</option>').join('')+'</select>')+'</td>'+
      field('designators','Connection / wire references')+'<td><button data-technical-review-action="worksheet-options" data-panel="approved-pns" data-candidate-row="'+index+'">Approved P/Ns</button><small>DLE-authored; no extracted source values.</small></td></tr>'+
      (expanded?'<tr><td colspan="9">'+renderCandidateInspector(bom,row,index,readOnly)+'</td></tr>':'');
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
  const candidateWidthPreference='dle.candidate-bom.column-widths.v1';
  let candidateColumnWidths=null, candidateColumnDrag=null;
  const candidateColumns = [['line','Line',68,56],['status','Status',132,120],['customer','Customer / BOM P/N',175,130],['approved','Approved P/N',240,160],['description','Description',300,160],['quantity','Qty / Assy',90,80],['type','FAIR Component Type',160,130],['designators','Designators',180,120],['options','Options',110,100]];
  function candidateColumnDefault(field) { return candidateColumns.find(c=>c[0]===field)?.[2]||150; }
  function candidateColumnMinimum(field) { return candidateColumns.find(c=>c[0]===field)?.[3]||100; }
  function candidateColumnWidth(field) {
    if(candidateColumnWidths===null){try{candidateColumnWidths=JSON.parse(window.localStorage?.getItem(candidateWidthPreference)||'{}');}catch{candidateColumnWidths={};}
      if(!candidateColumnWidths||typeof candidateColumnWidths!=='object'||Array.isArray(candidateColumnWidths))candidateColumnWidths={};}
    const value=candidateColumnWidths[field];
    return Number.isFinite(value)?Math.max(candidateColumnMinimum(field),Math.min(1200,value)):candidateColumnDefault(field);
  }
  function saveCandidateColumnWidths(){try{window.localStorage?.setItem(candidateWidthPreference,JSON.stringify(candidateColumnWidths));}catch{/* Keep session preferences when storage is unavailable. */}}
  function candidateColumnHeader(field,label) {
    return '<th scope="col" data-candidate-heading="'+field+'">'+escapeHtml(label)+'<span class="candidate-column-resize" data-candidate-resize="'+field+'" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize '+escapeHtml(label)+' column" aria-valuemin="'+candidateColumnMinimum(field)+'" aria-valuemax="1200" aria-valuenow="'+candidateColumnWidth(field)+'" title="Drag to resize; arrow keys adjust width"></span></th>';
  }
  function applyCandidateColumnWidths() {
    const table=mount?.querySelector('.candidate-workbench-table');if(!table)return;
    let total=0;
    table.querySelectorAll('col[data-candidate-column]').forEach(col=>{const width=candidateColumnWidth(col.dataset.candidateColumn);col.style.width=width+'px';total+=width;});
    table.style.width=total+'px';
    table.style.setProperty('--candidate-line-width',candidateColumnWidth('line')+'px');
    mount.querySelectorAll('[data-candidate-resize]').forEach(handle=>handle.setAttribute('aria-valuenow',candidateColumnWidth(handle.dataset.candidateResize)));
  }
  function startCandidateColumnResize(event) {
    const handle=event.target.closest?.('[data-candidate-resize]');
    if(!handle||state.step!=='candidate'||event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    candidateColumnDrag={handle,id:event.pointerId,x:event.clientX,field:handle.dataset.candidateResize,width:candidateColumnWidth(handle.dataset.candidateResize)};
    handle.setPointerCapture(event.pointerId);
    mount.querySelector('.candidate-workbench-table').classList.add('candidate-column-dragging');
  }
  function moveCandidateColumnResize(event) {
    const drag=candidateColumnDrag;if(!drag||event.pointerId!==drag.id)return;
    event.preventDefault();
    candidateColumnWidths[drag.field]=Math.max(candidateColumnMinimum(drag.field),Math.min(1200,Math.round(drag.width+event.clientX-drag.x)));
    applyCandidateColumnWidths();
  }
  function endCandidateColumnResize(event) {
    const drag=candidateColumnDrag;if(!drag||event.pointerId!==drag.id)return;
    candidateColumnDrag=null;
    if(drag.handle.hasPointerCapture(drag.id))drag.handle.releasePointerCapture(drag.id);
    mount?.querySelector('.candidate-workbench-table')?.classList.remove('candidate-column-dragging');
    saveCandidateColumnWidths();
  }
  function candidateColumnResizeKey(event) {
    const field=event.target.dataset?.candidateResize;if(!field)return;
    if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const width=candidateColumnWidth(field);
    candidateColumnWidths[field]=event.key==='Home'?candidateColumnDefault(field):Math.max(candidateColumnMinimum(field),Math.min(1200,width+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?32:16)));
    applyCandidateColumnWidths();saveCandidateColumnWidths();
  }
  function sizeCandidateWorkbench() {
    const sheet=mount?.querySelector('.candidate-workbench');
    const scroll=sheet?.querySelector('.candidate-table-scroll');
    if(!scroll)return;
    const footer=sheet.querySelector('.candidate-workbench-footer');
    sheet.style.setProperty('--candidate-work-height',Math.max(200,window.innerHeight-scroll.getBoundingClientRect().top-(footer?.getBoundingClientRect().height||0)-24)+'px');
  }
  function watchCandidateWorkbench() {
    const sheet=mount?.querySelector('.candidate-workbench');if(!sheet)return;
    sizeCandidateWorkbench();
    updateCandidateBulkControls();
    if(!window.ResizeObserver)return;
    candidateWorkbenchObserver ||= new window.ResizeObserver(sizeCandidateWorkbench);
    for(const element of [document.querySelector('body > header.dle-app-header'),sheet.querySelector('.candidate-workbench-toolbar'),sheet.querySelector('.candidate-workbench-footer')])if(element)candidateWorkbenchObserver.observe(element);
  }
  window.addEventListener?.('resize',sizeCandidateWorkbench);
  window.addEventListener?.('beforeunload',event=>{if(state.preparationDraft||state.step==='candidate'&&candidateProgressRows().length){event.preventDefault();event.returnValue='';}});
  function captureCandidatePosition() {
    const scroll=mount?.querySelector('.candidate-workbench .candidate-table-scroll');if(!scroll)return null;
    const active=document.activeElement, activeRow=active?.closest?.('tr[data-worksheet-row]');
    const top=scroll.getBoundingClientRect().top;
    const row=activeRow||Array.from(scroll.querySelectorAll('tr[data-worksheet-row]')).find(r=>r.getBoundingClientRect().bottom>top+40);
    return {inlineAlternate:state.rowOption==='preparation'||!!scroll.querySelector('[data-preparation-editor]')||state.rowOption==='alternates'||!!scroll.querySelector('.alternate-review-compact')||state.candidateLeaveIntent?.technicalReviewAction==='worksheet-options',pageX:window.scrollX,pageY:window.scrollY,focusId:active?.id,focusAction:active?.dataset?.technicalReviewAction,detailId:active?.closest?.('section[id^="candidate-detail-"]')?.id,id:scroll.dataset.candidateId,top:scroll.scrollTop,left:scroll.scrollLeft,row:row?.dataset.worksheetRow,offset:row?row.getBoundingClientRect().top-top:null,focus:!!activeRow};
  }
  function restoreCandidatePosition(position) {
    if(!position)return;
    const scroll=mount?.querySelector('.candidate-workbench .candidate-table-scroll');if(!scroll||scroll.dataset.candidateId!==position.id)return;
    scroll.scrollTop=position.top;scroll.scrollLeft=position.left;
    const row=Array.from(scroll.querySelectorAll('tr[data-worksheet-row]')).find(r=>r.dataset.worksheetRow===position.row);
    if(!position.inlineAlternate&&row&&position.offset!==null)scroll.scrollTop+=row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-position.offset;
    if(position.inlineAlternate){if(position.focusId)document.getElementById(position.focusId)?.focus({preventScroll:true});else if(position.focusAction){const detail=document.getElementById(position.detailId);const control=detail?.querySelector('[data-technical-review-action="'+position.focusAction+'"]')||mount.querySelector('[aria-controls="'+position.detailId+'"][data-panel="alternates"]');control?.focus({preventScroll:true});}window.scrollTo(position.pageX,position.pageY);}else if(position.focus)row?.querySelector('.candidate-row-controls button')?.focus({preventScroll:true});
  }
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
  function pendingSubmissionEdits(){
    return sourceChoicesDirty()||pendingSubmissionRequirements().length>0;
  }
  function pendingSubmissionRequirements(){
    const w=state.selected.record.technicalReview.workflow,a=state.packageAnswers,items=[];
    if(a&&(a.complete!==(w.sufficient?'yes':w.holdReason?'no':'')||(a.complete==='no'&&a.missing!==(w.holdReason||''))))items.push({message:'Save the package decision.',action:a.complete==='no'?'SAVE_HOLD':'SAVE_PACKAGE'});
    if(pendingReferenceSelection())items.push({message:'Save the selected reference.',action:'SAVE_REFERENCE'});
    if(reviewUploads.length)items.push({message:'Save the selected documents.',action:'SAVE_DOCUMENTS'});
    if(Object.keys(identityChanges).length||pendingPackageValues())items.push({message:'Finish the document edits.',action:'REVIEW_DOCUMENTS'});
    return items;
  }
  function renderSubmissionStatus(){
    if(state.step!=='inventory'||!state.selected)return;
    const panel=mount?.querySelector?.('.technical-review-release');
    if(panel)panel.outerHTML=renderPackageRelease();
  }
  async function refreshSubmissionState(returnedFromSlides=false){
    if(state.submissionRefreshing){if(returnedFromSlides)state.submissionRefreshQueued=true;return;}
    if(state.saving||state.step!=='inventory'||!state.selected||completedReview(state.selected.record)||state.finalBomReview||(!returnedFromSlides&&document.querySelector?.('dialog[open]')))return;
    const id=state.selected.record.intakeId,dirty=pendingSubmissionEdits();
    state.submissionRefreshing=true;
    try{
      const latest=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(id));
      if(state.selected?.record?.intakeId!==id||state.step!=='inventory'||state.saving||state.finalBomReview||(!returnedFromSlides&&document.querySelector?.('dialog[open]')))return;
      if(!dirty&&!pendingSubmissionEdits()){
        state.selected=latest;state.packageDraft=null;state.packageAnswers=null;
        if(state.teamDraft?.intakeId===id)state.teamDraft=null;
        releaseReadiness=null;renderDetail();
      }else{releaseReadiness=null;renderSubmissionStatus();}
    }catch(error){
      if(state.selected?.record?.intakeId===id){releaseReadiness=null;renderSubmissionStatus();}
    }finally{state.submissionRefreshing=false;if(state.submissionRefreshQueued){state.submissionRefreshQueued=false;void refreshSubmissionState(true);}}
  }
  async function resolveSubmissionRequirement(action,button){
    if(state.saving||!state.selected)return;
    if(action==='CONFIRM_RFQ_PACKAGE')return workflowAction('CONFIRM_RFQ_PACKAGE');
    if(action==='ACCEPT_BOM')return reopenCandidate();
    if(action==='ACCEPT_SLIDES')return openDraftSlides(button);
    if(action==='RESUME_REVIEW')return workflowAction('RESUME');
    if(action==='SAVE_REFERENCE')return saveTeamReference();
    if(action==='SAVE_DOCUMENTS')return uploadReviewDocuments();
    if(action==='SAVE_HOLD')return saveUnifiedPackage(false);
    if(action==='SAVE_PACKAGE')return saveUnifiedPackage(true);
    if(action==='REVIEW_REFERENCE'){
      const reference=mount?.querySelector('#reviewTeamReference');reference?.scrollIntoView?.({block:'center'});reference?.focus?.();return;
    }
    if(action==='REVIEW_INTAKE'){state.guided=false;state.step='';renderDetail();return;}
    if(action==='REVIEW_DOCUMENTS'||action==='RESTORE_SOURCE'){
      const details=mount?.querySelector('[data-review-source-details]');if(details)details.open=true;
      const table=mount?.querySelector('.unified-package-review');table?.scrollIntoView?.({block:'start'});
      table?.querySelector('select:not([disabled]),button:not([disabled])')?.focus?.();
    }
  }
  function renderPackageRelease() {
    const r=state.selected.record;if(completedReview(r))return '';
    const key=r.intakeId+':'+JSON.stringify(r.technicalReview)+':'+state.selected.packageReviewToken;
    if(releaseReadiness?.key!==key){
      const check={key,pending:true};releaseReadiness=check;
      fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(r.intakeId)+'/release-readiness')
        .then(result=>{if(releaseReadiness===check)releaseReadiness={key,...result};})
        .catch(()=>{if(releaseReadiness===check)releaseReadiness={key,ready:false,unavailable:true};})
        .finally(()=>{if(state.selected?.record?.intakeId===r.intakeId)renderSubmissionStatus();});
    }
    const pending=pendingSubmissionRequirements(),dirty=pending.length>0,ready=releaseReadiness.ready===true&&!dirty;
    const labels={CONFIRM_RFQ_PACKAGE:'Confirm package is sufficient for RFQ',REVIEW_DOCUMENTS:'Review documents',ACCEPT_BOM:'Review BOM',ACCEPT_SLIDES:'Open draft slides',RESUME_REVIEW:'Resume review',REVIEW_REFERENCE:'Review reference',REVIEW_INTAKE:'View intake details',RESTORE_SOURCE:'View source documents',SAVE_REFERENCE:'Save reference selection',SAVE_DOCUMENTS:'Save documents',SAVE_HOLD:'Place on hold',SAVE_PACKAGE:'Save package decision'};
    const requirements=[...(releaseReadiness.requirements||[]),...pending];
    const tasks=requirements.map(item=>'<div class="technical-review-submission-task"><p>'+escapeHtml(item.message)+'</p>'+(labels[item.action]?'<button type="button" data-technical-review-action="submission-requirement" data-requirement="'+item.action+'" '+(state.saving||(item.action==='CONFIRM_RFQ_PACKAGE'&&dirty)?'disabled':'')+'>'+labels[item.action]+'</button>':'')+'</div>').join('');
    return '<section class="technical-review-card technical-review-release"><h3>Submit to RFQs</h3><div class="release-summary"><div><h4>'+(releaseReadiness.bomAccepted===true?'BOM Accepted':'BOM '+(releaseReadiness.pending?'Checking…':'Needs Review'))+'</h4></div><div><h4>'+(releaseReadiness.slidesAccepted===true?'Slides Accepted':'Slides '+(releaseReadiness.pending?'Checking…':'Need Review'))+'</h4></div></div>'+ 
      (releaseReadiness.pending?'<p role="status">Checking readiness…</p>':releaseReadiness.unavailable?'<p role="status">Submission checks are unavailable. Return to this page to try again.</p>':tasks?'<div role="status">'+tasks+'</div>':ready?'':'<p role="status">Finish the remaining Technical Review checks.</p>')+
      '<button class="technical-review-primary" data-technical-review-action="flow-COMPLETE" '+(ready&&!state.saving?'':'disabled')+'>Submit to RFQs</button></section>';
  }

  function useSourceSetup() {
    const r=state.selected?.record;
    return state.selected?.sourceSetupAvailable===true && !state.legacySourceReview && !completedReview(r) && r?.intakeType==='NEW_QUOTE_REQUEST' && r?.technicalReview?.workflow && r?.assemblies?.length===1 &&
      (r?.reviewSourceSetup || !r?.technicalReview?.candidateBom || r.technicalReview.candidateBom.vproImport);
  }
  function sourceChoices() {
    const r=state.selected.record,saved=r.reviewSourceSetup?.current;
    if(state.sourceChoices?.id!==r.intakeId){
      const txt=r.technicalFiles.filter(f=>/\.txt$/i.test(f.name)&&f.binaryStatus==='VERIFIED');
      state.sourceChoices={id:r.intakeId,drawingId:saved?.drawingDocumentId||r.technicalReview?.presentationDraft?.teamDocumentId||'',bomId:saved?.bomDocumentId||(txt.length===1?txt[0].documentId:''),dirty:false};
    }
    return state.sourceChoices;
  }
  function sourceChoicesDirty(){return !!state.selected?.sourceSetupAvailable && state.sourceChoices?.id===state.selected.record.intakeId && (!!state.sourceChoices.dirty||!!state.sourceUpload||!!state.sourceConfirmReason||!!state.sourceConfirm);}
  function renderSourceSetup() {
    const r=state.selected.record,c=sourceChoices(),busy=(state.saving||window.DleOsCapabilities?.can?.('technical_review.disposition')!==true)?'disabled':'',candidate=r.technicalReview?.candidateBom;
    const selector=(role,label,accept,predicate,id)=>'<section class="technical-review-question" data-review-step="'+(role==='DRAWING_REFERENCE'?'drawing':'bom')+'" tabindex="-1"><h3>'+label+'</h3><label>Saved review file<select data-source-choice="'+(role==='DRAWING_REFERENCE'?'drawingId':'bomId')+'" '+busy+'><option value="">Choose a file</option>'+r.technicalFiles.filter(predicate).map(f=>'<option value="'+escapeHtml(f.documentId)+'" '+(f.documentId===id?'selected':'')+'>'+escapeHtml(f.name)+' (copy '+escapeHtml(f.documentId.slice(0,8))+')</option>').join('')+'</select></label>'+linkedFileButtons(role)+'<label>Or choose a file from this device<input type="file" data-source-upload="'+role+'" accept="'+accept+'" '+busy+'></label>'+inlineFilePicker(role)+'</section>';
    const identity=state.sourceIdentity, mismatch=identity?.source&&!identity.sourceMatches;
    const reconciliation=identity?'<section class="technical-review-question" data-source-identity tabindex="-1"><h3>'+(mismatch?'Check that this BOM applies to this job':'Source identity')+'</h3>'+(identity.sourceProblem?'<p role="alert">'+escapeHtml(identity.sourceProblem)+'</p>':'')+
      (identity.source?'<p>Export: <strong>'+escapeHtml(identity.source.drawing)+'</strong></p><p>Job: <strong>'+escapeHtml(identity.target)+'</strong></p><ul>'+identity.source.notes.filter(n=>n.text.trim()).map(n=>'<li>Source line '+escapeHtml(n.sequence)+': '+escapeHtml(n.text)+'</li>').join('')+'</ul><details><summary>Exact source version</summary><code>'+escapeHtml(identity.bomSha256)+'</code></details>':'')+
      (mismatch?'<p>Nothing is assumed equivalent. Confirm only if this exact export applies to this job, including its revision and change notes.</p><label><input type="checkbox" data-source-confirm '+(state.sourceConfirm?'checked':'')+' '+busy+'> I confirm this source applies to the displayed job</label><label>Reason<textarea data-source-reason maxlength="2000" '+busy+'>'+escapeHtml(state.sourceConfirmReason||'')+'</textarea></label>':'')+'</section>':'';
    return '<div class="review-flow"><p>Choose the production drawing and the BOM source. Folder files and uploads are saved as separate review copies; originals are unchanged. Replacing a selection keeps the prior file and its history.</p>'+
      selector('DRAWING_REFERENCE','1. Production drawing','.pdf',f=>f.type==='application/pdf'&&f.binaryStatus==='VERIFIED',c.drawingId)+
      selector('BOM_REFERENCE','2. BOM source (VPRO5 TXT)','.txt',f=>/\.txt$/i.test(f.name)&&f.binaryStatus==='VERIFIED',c.bomId)+
      (state.sourceUpload?'<section class="technical-review-question"><p>'+escapeHtml(state.sourceUpload.file.name)+' will be saved as a review copy for '+(state.sourceUpload.role==='DRAWING_REFERENCE'?'Production drawing':'BOM source')+'.</p><button data-technical-review-action="source-upload-save" '+busy+'>Use this file</button><button data-technical-review-action="source-upload-cancel" '+busy+'>Cancel file selection</button></section>':'')+
      '<p>The selected TXT supplies the candidate BOM, even when the production drawing also contains a BOM. No P/N classification is needed to save these choices.</p>'+reconciliation+
      '<p role="status">'+escapeHtml(state.sourceMessage||'')+'</p>'+
      '<button data-technical-review-action="source-save" '+busy+'>Save Draft</button> <button class="technical-review-primary" data-technical-review-action="source-build" '+(busy||!c.drawingId||!c.bomId?'disabled':'')+'>Save &amp; Build Candidate</button>'+
      (candidate?'<button data-technical-review-action="source-review" '+(state.saving||c.dirty||(r.reviewSourceSetup&&r.reviewSourceSetup.builtCandidateId!==candidate.id)?'disabled':'')+'>Review Candidate BOM</button>':'')+
      '<p>Save Draft keeps incomplete choices without putting the review On Hold or approving anything. Save &amp; Build resumes an On Hold review and creates a working candidate. Final BOM acceptance remains explicit.</p>'+
      (sourceChoicesDirty()?'<button data-technical-review-action="source-discard" '+busy+'>Discard unsaved choices</button> ':'')+'<button data-technical-review-action="source-reload" '+busy+'>Reload saved status (keep choices)</button> <button data-technical-review-action="source-other" '+busy+'>Other BOM formats / existing review tools</button></div>';
  }
  function sourceInput(event) {
    if(!useSourceSetup()||state.saving||window.DleOsCapabilities?.can?.('technical_review.disposition')!==true)return false;
    const el=event.target;
    if(el.dataset?.sourceChoice){if(sourceChoices()[el.dataset.sourceChoice]===el.value)return true;sourceChoices()[el.dataset.sourceChoice]=el.value;sourceChoices().dirty=true;state.sourceIdentity=null;state.sourceConfirm=false;state.sourceConfirmReason='';state.sourceMessage='Choice changed. Save Draft or Save & Build Candidate.';renderDetail();return true;}
    if(el.dataset?.sourceUpload){if(el.files?.[0]){state.sourceUpload={file:el.files[0],role:el.dataset.sourceUpload};renderDetail();}return true;}
    if(el.hasAttribute?.('data-source-confirm')){state.sourceConfirm=el.checked;return true;}
    if(el.hasAttribute?.('data-source-reason')){state.sourceConfirmReason=el.value;return true;}
    return false;
  }
  async function sourceAction(action) {
    if(state.saving)return;
    const r=state.selected.record,c=sourceChoices();
    if(!['source-review','source-reload','source-other','source-upload-cancel'].includes(action)&&window.DleOsCapabilities?.can?.('technical_review.disposition')!==true){state.sourceMessage='This persona can view sources but cannot save or build.';renderDetail();return;}
    if(action==='source-discard'){if(!window.confirm('Discard only the unsaved source choices and pending file selection? Saved review copies and existing candidates will remain.'))return;state.sourceChoices=null;state.sourceUpload=null;state.sourceIdentity=null;state.sourceConfirm=false;state.sourceConfirmReason='';state.sourceMessage='Unsaved choices discarded. Saved files and candidates are unchanged.';renderDetail();return;}
    if(action==='source-upload-cancel'){state.sourceUpload=null;renderDetail();return;}
    if(action==='source-other'){if(sourceChoicesDirty()){state.sourceMessage='Save your source choices or cancel the pending file selection before switching workflows.';renderDetail();return;}state.legacySourceReview=true;renderDetail();return;}
    if(action==='source-review'){if(c.dirty||(r.reviewSourceSetup&&r.reviewSourceSetup.builtCandidateId!==r.technicalReview?.candidateBom?.id)){state.sourceMessage='Save source choices before reviewing the existing candidate.';renderDetail();return;}state.guided=true;state.step='candidate';renderDetail();return;}
    if(state.sourceUpload&&action!=='source-upload-save'){state.sourceMessage='Use or cancel the selected file first. Your current choices are retained.';renderDetail();return;}
    state.saving=true;state.sourceMessage='';renderDetail();
    try {
      const base='/api/sim/technical-reviews/'+encodeURIComponent(r.intakeId);
      if(action==='source-upload-save'){
        const upload=state.sourceUpload,form=new window.FormData();form.append('file',upload.file,upload.file.name);form.append('lastModified',String(upload.file.lastModified||0));
        form.append('metadata',JSON.stringify({type:upload.role==='DRAWING_REFERENCE'?'DRAWING':'VPRO5_BOM_EXPORT',applicability:'PARENT_ASSEMBLY'}));
        const response=await window.fetch(base+'/documents',{method:'POST',credentials:'same-origin',headers:{'X-SIM-Document-Upload':'1'},body:form});const payload=await response.json();if(!response.ok)throw Error(payload.message||'File copy could not be saved.');
        const file=payload.record.technicalFiles.find(f=>!r.technicalFiles.some(old=>old.documentId===f.documentId));if(!file)throw Error('Reopen saved status to identify the saved file; no second copy was requested.');
        state.selected=payload;c[upload.role==='DRAWING_REFERENCE'?'drawingId':'bomId']=file.documentId;c.dirty=true;state.sourceUpload=null;state.sourceIdentity=null;state.sourceMessage='Review copy saved. Choose Save Draft or Save & Build Candidate.';return;
      }
      if(action==='source-reload'){state.selected=await fetchJson(base);state.sourceIdentity=null;state.sourceConfirm=false;state.sourceConfirmReason='';state.sourceMessage='Saved status reloaded. Your source choices are retained; check them before saving.';return;}
      const view=await fetchJson(base+'/source-setup?'+new URLSearchParams({drawingId:c.drawingId,bomId:c.bomId}));
      if(view.token!==state.selected.sourceSetupToken)throw Error('The saved review changed. Use Reload saved status to inspect it while keeping your choices, then retry.');
      let replace=false;
      if(action==='source-build'){
        if(view.sourceProblem)throw Error(view.sourceProblem);
        if(!view.sourceMatches){
          if(state.sourceIdentity?.sourceToken!==view.sourceToken){state.sourceConfirm=false;state.sourceConfirmReason='';}
          state.sourceIdentity=view;
          if(!state.sourceConfirm||!state.sourceConfirmReason?.trim()){state.sourceMessage='Check the displayed source and job identities. Confirm applicability and give a reason before building.';return;}
        }
        if(r.technicalReview.candidateBom&&r.reviewSourceSetup?.builtCandidateId!==r.technicalReview.candidateBom.id||r.technicalReview.candidateBom&&c.dirty){replace=window.confirm('Replace the current working candidate with these selected sources? The prior version will remain in history. Accepted BOMs cannot be replaced here.');if(!replace)return;}
      }
      const payload=await fetchJson(base+'/source-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedToken:view.token,drawingDocumentId:c.drawingId||null,bomDocumentId:c.bomId||null,action:action==='source-build'?'BUILD':'SAVE_DRAFT',expectedSourceToken:view.sourceToken,confirmIdentity:action==='source-build'&&!!state.sourceConfirm,identityReason:state.sourceConfirmReason||null,replaceCandidate:replace})});
      state.selected=payload;c.dirty=false;state.sourceIdentity=null;state.sourceConfirm=false;state.sourceConfirmReason='';state.packageDraft=null;state.teamDraft=null;releaseReadiness=null;
      state.sourceMessage=action==='source-build'?'Candidate built. Review the rows and source notes; no BOM was accepted.':'Draft saved. Review status and approvals are unchanged.';
      if(action==='source-build'){state.guided=true;state.step='candidate';}
    }catch(e){state.sourceMessage=e.message||'Unable to save. Your choices are retained.';}
    finally{state.saving=false;renderDetail();if(state.sourceIdentity)mount?.querySelector('[data-source-identity]')?.focus?.({preventScroll:true});}
  }

  function reviewFlow(packageHtml) {
    if(useSourceSetup())return renderSourceSetup();
    if(!state.selected?.presentationAvailable)return packageHtml;
    const r=state.selected.record,d=state.teamDraft?.intakeId===r.intakeId?state.teamDraft:(r.technicalReview?.presentationDraft||{}),docs=r.technicalFiles||[],mode=state.bomRoute||(r.technicalReview?.candidateBom?.manualDraft?'manual':'source');
    const shown=mount?.querySelector?.('[data-review-source-details]'),sourceOpen=shown?.dataset.intakeId===r.intakeId?shown.open:mode==='source';
    const options='<option value="">No drawing / reference selected</option>'+docs.filter(f=>f.documentId!==r.technicalReview?.presentationDraft?.renditionDocumentId).map(f=>'<option value="'+escapeHtml(f.documentId)+'" '+(f.documentId===d.teamDocumentId?'selected':'')+'>'+escapeHtml(f.name)+(docs.filter(x=>x.name===f.name).length>1?' (copy '+escapeHtml(f.documentId.slice(0,8))+')':'')+'</option>').join('');
    return '<div class="review-flow"><section class="technical-review-question" data-review-step="drawing" tabindex="-1"><h3>1. Select Drawing / Reference</h3><label>Drawing / Reference<select id="reviewTeamReference" '+(state.saving?'disabled':'')+'>'+options+'</select></label><label>Drawing Status<select id="reviewReferenceStatus" disabled>'+Object.entries({UNKNOWN:'Unknown',PRELIMINARY:'Engineering / Test / Prototype',CUSTOMER_RELEASED:'Released Drawing'}).map(([v,l])=>'<option value="'+v+'" '+((d.referenceStatus||'UNKNOWN')===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label><button data-technical-review-action="save-team-reference" '+(state.saving?'disabled':'')+'>Save reference selection</button> <button data-technical-review-action="add-document">Add document</button>'+'<button data-technical-review-action="cancel-reference-selection" '+(pendingReferenceSelection()?'':'hidden')+' '+(state.saving?'disabled':'')+'>Cancel reference selection</button>'+linkedFileButtons('DRAWING_REFERENCE')+inlineFilePicker('DRAWING_REFERENCE')+renderReviewUploads()+'<p class="technical-review-message" role="status">'+escapeHtml(state.message||'')+'</p></section>'+ 
      '<section class="technical-review-question" data-review-step="bom" tabindex="-1"><h3>2. Select BOM file(s)</h3>'+'<p>Choose the BOM source separately. Use a VPRO5 BMM export when that is your source, or explicitly use the drawing when it contains the BOM.</p>'+linkedFileButtons('BOM_REFERENCE')+inlineFilePicker('BOM_REFERENCE')+bomSelectionSummary()+renderVproImport()+'<div class="review-route"><button data-technical-review-action="bom-source" aria-pressed="'+(mode==='source')+'">Extract / Import from documents</button><button data-technical-review-action="bom-manual" aria-pressed="'+(mode==='manual')+'">Build manually</button></div>'+(mode==='manual'?manualBomPanel()+(r.technicalReview?.candidateBom&&!r.technicalReview.candidateBom.manualDraft?'<button data-technical-review-action="manual-bom-open">Open working BOM</button>':''):'')+'<details data-review-source-details data-intake-id="'+escapeHtml(r.intakeId)+'" '+(sourceOpen?'open':'')+'><summary>Source documents</summary>'+packageHtml+'</details></section>'+ 
      '<section class="technical-review-question"><h3>3. Production Slides</h3><button data-technical-review-action="draft-slides">Open draft slides</button></section>'+renderPackageRelease()+'</div>';
  }
  async function saveTeamReference() {
    if(state.saving)return;
    if(Object.keys(identityChanges).length||reviewUploads.length){state.message='Finish pending document edits before saving the reference selection.';renderDetail();return;}
    if(pendingPackageValues()){state.message='Finish the document edits before saving the reference.';renderDetail();return;}
    const teamDocumentId=document.getElementById('reviewTeamReference').value||null;
    const pendingAnswers=pendingSubmissionRequirements().some(x=>x.action==='SAVE_PACKAGE'||x.action==='SAVE_HOLD');
    state.saving=true;
    state.message='Preparing reference pages…';
    renderDetail();
    try {const base='/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/presentation';const v=await fetchJson(base);const saved=await fetchJson(base+'/reference',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:v.draft.revision,expectedBomToken:v.bomToken,teamDocumentId})});state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId));state.packageDraft=null;releaseReadiness=null;state.teamDraft=null;state.message=saved.warning||'Reference saved.';state.messageState='';if(!pendingAnswers)state.packageAnswers=null;}
    catch(e){state.message=e.message;state.messageState='error';}finally{state.saving=false;renderDetail();focusReviewStep('DRAWING_REFERENCE');}
  }
  async function refreshAfterPresentation(){
    return refreshSubmissionState(true);
  }
  async function openDraftSlides(trigger) {
    if(state.saving)return;
    if(pendingReferenceSelection()){state.message='Save the reference selection before opening slides.';renderDetail();return;}
    if(Object.keys(identityChanges).length||reviewUploads.length){state.message='Save or finish pending document edits before opening slides.';renderDetail();return;}
    try{if(!window.DleTechnicalSlides)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/SRC/workspaces/technical-review/review-draft-slides.js';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('Draft slides could not load. Retry.'));};document.head.append(s);});await window.DleTechnicalSlides.open({intakeId:state.selected.record.intakeId,entryContext:'technical-review',trigger,onError:e=>{state.message=e.message;state.messageState='error';renderDetail();},onClose:()=>{void refreshAfterPresentation();},onSaved:r=>{state.selected.record.technicalReview.presentationDraft=r.technicalReview.presentationDraft;releaseReadiness=null;}});}catch(e){state.message=e.message;state.messageState='error';renderDetail();}
  }
  function renderUnifiedPackage() {
    const pack=unifiedPackageDraft(), docs=pack.documents, answers=packageAnswers(), record=state.selected.record;
    const disabled=state.saving?'disabled':'';
    const editableSelect=(label,attribute,options,value)=>'<select aria-label="'+escapeHtml(label)+'" '+attribute+' '+disabled+'>'+Object.entries(options).map(([k,v])=>'<option value="'+k+'" '+(k===value?'selected':'')+'>'+v+'</option>').join('')+'</select>';
    const rows=docs.map((d,i)=>{
      const f=record.technicalFiles.find(f=>f.documentId===d.documentId), choice=identityChanges[d.documentId],locked=packageRowLocked(d);
      if(linkedViewingRendition(d))return '<tr><th scope="row">'+escapeHtml(d.name)+'</th><td colspan="5">PDF viewing copy of the selected reference</td><td><a target="_blank" rel="noopener noreferrer" href="/api/sim/rfq-intakes/'+encodeURIComponent(record.intakeId)+'/documents/'+encodeURIComponent(d.documentId)+'">View PDF</a></td></tr>';
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
        (f?.reviewOrigin?.linkedSource?'<small>Saved source copy: '+escapeHtml(f.reviewOrigin.linkedSource.rootId+' / '+f.reviewOrigin.linkedSource.relativePath)+'</small><small>Source SHA-256: '+escapeHtml(f.reviewOrigin.linkedSource.sha256)+' · Modified '+escapeHtml(formatDateTime(f.reviewOrigin.linkedSource.lastWriteUtc))+'</small><small>Source changes do not update this copy.</small>':'')+(f?.reviewOrigin?'<small>Added by '+escapeHtml(f.reviewOrigin.addedBy)+' · '+escapeHtml(formatDateTime(f.reviewOrigin.addedAtUtc))+'</small><small>'+escapeHtml(f.reviewOrigin.note||'')+'</small>':'')+'</details>';
      return '<tr data-package-row="'+i+'"><th scope="row"><span>'+escapeHtml(d.name)+'</span>'+(record.technicalReview.presentationDraft?.teamDocumentId===d.documentId?'<small>Current drawing reference</small>':'')+(record.technicalFiles.filter(x=>x.name===d.name).length>1?'<small>Copy '+escapeHtml(d.documentId.slice(0,8))+'</small>':'')+(record.technicalReview.presentationDraft?.renditionDocumentId===d.documentId?'<small>Linked PDF viewing rendition · original retained</small>':'')+'<div>'+view+'</div>'+context+'</th><td>'+identity+'</td><td>'+(d.rowAssociation?escapeHtml(applicability[d.applicability]):select('Applies to for '+d.name,'data-package-field="applicability"',applicability,d.applicability))+'</td><td>'+select('Production Use for '+d.name,'data-package-use="productionUse"',production,d.productionUse)+'</td><td>'+select('Materials Use for '+d.name,'data-package-use="bomUse"',bom,d.bomUse)+'</td><td>'+select('Manufacturer P/N source for '+d.name,'data-pn-field="providesManufacturerPartNumbers" title="Does this document show the manufacturer&#39;s P/N in a dedicated field or column?"',{'':'Not Reviewed',yes:'Yes',no:'No'},d.partNumberReview?.providesManufacturerPartNumbers==null?'':d.partNumberReview.providesManufacturerPartNumbers?'yes':'no')+'</td><td>'+(locked?'Accepted':'Needs Review')+'<div class="package-row-actions"><button data-technical-review-action="'+(locked?'identity-change':'accept-package-row')+'" '+disabled+'>'+(locked?'Edit':identityReviewed(d)?'Accept Changes':'Accept')+'</button>'+(identityChanges[d.documentId]?'<button type="button" data-technical-review-action="cancel-package-row" data-document-id="'+escapeHtml(d.documentId)+'" '+disabled+'>Cancel row edits</button>':'')+reviewDocumentRemoveButton(d.documentId)+'</div>'+(packageRowErrors[d.documentId]?'<small role="alert">'+escapeHtml(packageRowErrors[d.documentId])+'</small>':'')+'</td></tr>';
    }).join('');
    const summary=(heading,rolesFor)=>{
      const rows=(record.technicalReview.technicalPackage?.documents||[]).filter(d=>identityReviewed(d)&&!packageRowIssue(d)).map(d=>{const roles=rolesFor(unifiedPackageDraft({documents:[{...d}],governingBomDocumentId:record.technicalReview.technicalPackage.governingBomDocumentId}).documents[0]);return roles.length?'<li><span class="package-summary-name">'+escapeHtml(d.name)+'</span><span class="package-summary-roles">'+roles.map(escapeHtml).join(' · ')+'</span></li>':'';}).join('');
      return '<section><h4>'+heading+'</h4>'+(rows?'<ul class="package-summary-list">'+rows+'</ul>':'<p class="package-summary-empty">None selected</p>')+'</section>';
    };
    const issue=unifiedPackageIssue(), unsupported=!record.technicalReview.candidateBom?.manualDraft&&pack.governingBomDocumentId&&!packageCanBuild();
    const packageHtml = '<section class="technical-review-question package-review-table unified-package-review"><div class="package-review-heading"><div><h3>Technical Package Review</h3><p>'+docs.length+' files received · '+docs.filter(packageRowLocked).length+' accepted · '+docs.filter(d=>!packageRowLocked(d)&&!linkedViewingRendition(d)).length+' need review</p></div>'+((window.DleOsCapabilities?.can?.("technical_review.disposition")===true && ['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(record.status))?'<button type="button" class="technical-review-secondary" data-technical-review-action="add-document" '+(state.saving||addingDocuments?'disabled':'')+'>+ Add Document</button>':'')+'</div>'+renderIncompleteSave()+(state.selected?.presentationAvailable?'':renderVproImport())+(state.selected?.presentationAvailable?'':manualBomPanel()+renderReviewUploads())+'<div class="package-table-scroll"><table><thead><tr>'+['Document','What is it?','Applies To','Production Use','Materials Use','MFG P/N Source','Status'].map(x=>'<th scope="col">'+(x==='MFG P/N Source'?'<span class="package-help" tabindex="0" title="Does this document show the manufacturer&#39;s P/N in a dedicated field or column?">'+x+' <span aria-hidden="true">ⓘ</span><span class="package-help-text" role="tooltip">Does this document show the manufacturer&#39;s P/N in a dedicated field or column?</span></span>':x)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="package-authority-summary">'+summary('Production',d=>d.productionUse==='PRIMARY_DRAWING'?['Main Drawing']:d.productionUse==='SUPPORTING_PRODUCTION'?['Supporting']:[])+(record.technicalReview.candidateBom?.manualDraft?'<section><h4>Materials</h4><p>DLE-authored BOM · '+(record.technicalReview.materialsReviewStatus==='QUALIFIED'?'accepted for RFQ':'RFQ acceptance pending')+'</p></section>':summary('Materials',d=>[...(d.bomUse==='GOVERNING_BOM'?['Main BOM']:d.bomUse==='SUPPORTING_BOM'?['Supporting BOM']:[]),...(d.partNumberReview?.providesManufacturerPartNumbers===true?['MFG P/N Source']:[])]))+'</div>'+
      (engineeringReferenceSelected()?'':'<section class="package-history"><h4>Assembly History</h4><p>Coming soon</p><button type="button" disabled>View Assembly History</button><p class="technical-review-inline-note">Prior revision and build history will be available here in a future release.</p></section>')+
      (engineeringReferenceSelected()&&!pendingSubmissionRequirements().some(x=>x.action==='SAVE_PACKAGE'||x.action==='SAVE_HOLD')?'':'<fieldset class="package-completeness" '+disabled+'><legend>Is the technical package complete enough to proceed, including the documents Production needs?</legend><label><input name="packageComplete" type="radio" value="yes" '+(answers.complete==='yes'?'checked':'')+'> Yes</label><label><input name="packageComplete" type="radio" value="no" '+(answers.complete==='no'?'checked':'')+'> No</label>'+
      (answers.complete==='no'?'<label class="package-missing">What is missing?<textarea id="packageMissing" maxlength="1000">'+escapeHtml(answers.missing)+'</textarea></label><button class="technical-review-primary" data-technical-review-action="hold-package" '+(state.saving||addingDocuments?'disabled':'')+'>Place On Hold</button>':answers.complete==='yes'?(issue?'<p role="alert">'+escapeHtml(issue)+'</p>':'')+(unsupported?'<p role="note">These document roles can be saved. Candidate BOM extraction requires a verified Main BOM PDF, either standalone or embedded in an Assembly Drawing. A spreadsheet Main BOM is not supported.</p>':'')+packageBuildAction(unsupported, issue):'')+'</fieldset>')+'<div id="technicalReviewAnalysisProgress">'+renderAnalysisProgress()+'</div>'+(state.selected?.presentationAvailable?'':renderPackageRelease())+packageMessage()+'<button class="technical-review-back" data-technical-review-action="history-back">Back to Technical Review</button></section>';
    return reviewFlow(packageHtml);
  }
  async function saveUnifiedPackage(complete, setupOnly = false) {
    if(!complete && (pendingReferenceSelection()||reviewUploads.length||drawingFolderBrowser?.selection)){window.alert('Save or cancel the Step 1 drawing choice, selected folder file and pending uploads before saving setup. Your edits remain here.');return;}
    if(!complete && Object.entries(identityChanges).some(([id,c])=>{const old=state.selected.record.technicalReview.technicalPackage.documents.find(d=>d.documentId===id);return c.type!==identityType(old||{})||(c.type==='OTHER'&&(c.otherDescription||'')!==(old?.identityReview?.otherDescription||''));})){window.alert('A document classification change is still unsaved. This backend cannot save it as an independent draft. Keep the tab open; do not guess review answers to accept it.');return;}
    const holdInput=mount?.querySelector?.('#packageDraftHoldReason');if(!complete&&holdInput)packageAnswers().missing=holdInput.value;
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
    if(!state.selected.record.technicalReview?.candidateBom?.manualDraft&&complete&&canBuild&&!setupOnly&&!scannedMainBom()&&state.messageState!=='error') {
      if(!hadCandidate && !state.selected.record.technicalReview.candidateBom) await buildCandidate();
    }
  }
  function renderIncompleteSave() {
    if(!canManageReviewDocuments())return '';
    return '<section class="technical-review-question"><button type="button" data-technical-review-action="show-incomplete-save" '+(state.saving?'disabled':'')+'>Save incomplete setup (On Hold)</button><p>Accept Changes confirms a document row. Generate draft creates a candidate for review. Final BOM acceptance is separate. There is no independent draft-save mode yet; incomplete setup can be saved by deliberately placing this review On Hold. Unknown P/N answers may remain unresolved.</p>'+
      (state.showIncompleteSave?'<label>Reason for holding this review<textarea id="packageDraftHoldReason" maxlength="1000">'+escapeHtml(packageAnswers().missing||'')+'</textarea></label><button type="button" data-technical-review-action="hold-package" '+(state.saving?'disabled':'')+'>Save setup and place On Hold</button><p>This saves document setup and the hold reason, not a candidate or final BOM approval. Save or cancel the drawing choice and pending uploads separately first.</p>':'')+'</section>';
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

  async function loadLibraryBomQueue() {
    if(!['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment))return;
    const host=document.getElementById('technicalReviewLibraryBomQueue');if(!host)return;
    try {
      if(!document.querySelector('link[data-library-bom-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='SRC/workspaces/assembly-library/assembly-library-workspace.css';link.dataset.libraryBomStyle='true';document.head.append(link);}
      if(!window.DleLibraryBom){
        if(!window.DleLibraryBomLoading)window.DleLibraryBomLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/assembly-library/library-bom.js';script.onload=resolve;script.onerror=()=>{window.DleLibraryBomLoading=null;reject(Error('Library review queue could not load.'));};document.head.append(script);});
        await window.DleLibraryBomLoading;
      }
      await window.DleLibraryBom.queue(host,{excludePackageIds:state.finalReviewRoundtrip===true?[...state.items,...state.completedItems].filter(i=>i.projectId&&i.finalReview).map(i=>i.finalReview.packageId):[],getExcludePackageIds:()=>state.finalReviewRoundtrip===true?[...state.items,...state.completedItems].filter(i=>i.projectId&&i.finalReview).map(i=>i.finalReview.packageId):[]});
    } catch(error){host.textContent=error.message;}
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
      state.finalReviewRoundtrip = payload.finalReviewRoundtrip===true;
      state.rfqProjectHandoff = payload.rfqProjectHandoff===true;
      state.completedItems = state.rfqProjectHandoff && Array.isArray(payload.completedItems) ? payload.completedItems : [];
      if(!state.rfqProjectHandoff)state.queueBucket='ACTIVE';
      renderQueue();
      void loadLibraryBomQueue();
      void loadPartRequestQueue();
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
    const completed=state.queueBucket==='COMPLETED',values=completed?state.completedItems:state.items;
    if(count){count.textContent=String(values.length+(completed?0:partRequestCount));if(count.nextElementSibling)count.nextElementSibling.textContent=completed?'completed reviews':'active review items';}
    if(!host)return;
    const controls=state.rfqProjectHandoff?'<div class="technical-review-history-tabs" role="group" aria-label="Review queue"><button type="button" data-review-bucket="ACTIVE" aria-pressed="'+!completed+'">Active ('+(state.items.length+partRequestCount)+')</button><button type="button" data-review-bucket="COMPLETED" aria-pressed="'+completed+'">Completed / history ('+state.completedItems.length+')</button></div>':'';
    host.innerHTML=controls+(values.length?values.map(renderQueueRow).join(''):'<div class="technical-review-empty">'+(completed?'No completed reviews yet.':'No active reviews.')+'</div>');
    for(const button of host.querySelectorAll('[data-review-bucket]'))button.onclick=e=>{e.stopPropagation();state.queueBucket=button.dataset.reviewBucket;renderQueue();};
    const other=document.getElementById('technicalReviewLibraryBomQueue');if(other)other.hidden=completed;
    const parts=document.getElementById('technicalReviewPartRequestQueue');if(parts)parts.hidden=completed;
    if(['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment))void loadPreparation().then(()=>window.DleLibraryPreparation.attachQueue(host,values,{finalReviewRoundtrip:state.finalReviewRoundtrip===true,rfqProjectHandoff:state.rfqProjectHandoff===true})).catch(error=>{const p=document.createElement('p');p.textContent=error.message;host.append(p);});
  }

  function renderQueueRow(item) {
    const assembly = item.assembly || {};
    if(item.projectId)return '<button type="button" class="technical-review-row" data-preparation-intake="'+escapeHtml(item.intakeId)+'" data-preparation-project="'+escapeHtml(item.projectId)+'">'+queueCell('Assembly project',item.displayId,true)+queueCell('Customer',item.customer?.customerName,true)+queueCell('Assembly',assembly.assemblyNumber,true)+queueCell('Revision',assembly.revision,true)+queueCell('Qty',assembly.quantity,true)+queueCell('Status',state.rfqProjectHandoff&&item.rfqReceipt?'Sent to RFQs':state.finalReviewRoundtrip===true&&item.finalReview?.status==='SUBMITTED'?'Ready for final review':item.reviewStatusLabel,true)+'<span>'+(state.finalReviewRoundtrip===true&&item.finalReview?'Open review':'Initial assessment')+'</span></button>';
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
    state.finalBomReview=null;state.candidateBulk=null;
    clearCandidateDrafts();state.candidateLeaveIntent=null;
    identityChanges={};packageRowErrors={};state.packageAnswers=null;
    state.guided = false;
    state.materials = false; state.step = ""; state.packageDraft = null; state.documentIndex = 0;
    state.sourceChoices=null;state.sourceUpload=null;state.sourceIdentity=null;state.sourceConfirm=false;state.sourceConfirmReason='';state.sourceMessage='';state.legacySourceReview=false;
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

  function canReturnToQueue() {
    return ['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment) && (!!state.selected || !!state.assemblyLibrary || !!partRequestReview);
  }
  function selectValueChanged(input) {
    const options=Array.from(input.options);
    if(input.multiple)return options.some(option=>option.selected!==option.defaultSelected);
    const defaults=options.map((option,index)=>option.defaultSelected?index:-1).filter(index=>index>=0);
    return input.selectedIndex!==(defaults.length?defaults[defaults.length-1]:(options.length?0:-1));
  }
  function reviewNavigationBlock() {
    if(partRequestOpening)return 'Wait for the part request to open.';
    if(partRequestReview?.blockMessage)return partRequestReview.blockMessage;
    if(state.preparationDraft)return 'Save preparation draft or Cancel edits before leaving.';
    if(state.saving || drawingFolderBrowser?.busy)return 'Wait for the current operation to finish before returning to Technical Review.';
    if(!state.selected)return '';
    if(sourceChoicesDirty())return 'Save Draft or finish the pending source choice before leaving this review.';
    if((drawingFolderBrowser?.mode==='change' && drawingFolderBrowser.listing)||drawingFolderBrowser?.selection)return 'Save your selection or close the folder selector before returning to Technical Review.';
    if(state.scanSheetDirty || (state.scanEdit && state.scanEdit.input.value!==state.scanEdit.before))return 'Save Review or cancel your worksheet edits before leaving.';
    if(state.step==='scanned-setup' || state.finalBomReview)return 'Finish or cancel the current review panel before returning to Technical Review.';
    const rows=state.selected.record.technicalReview?.candidateBom?.rows||[];
    if(candidateProgressRows().length || rows.some(row=>rowReviewUi(row).alternateDraft))return 'Save Progress or cancel pending BOM row edits before leaving.';
    if(reviewUploads.length || Object.keys(identityChanges).length || pendingReferenceSelection() || pendingPackageValues() ||
      (state.selected.record.technicalReview?.workflow && pendingSubmissionEdits()))return 'Save or cancel your pending document, reference, or package edits before returning to Technical Review.';
    // Catch text/select fields in legacy review forms without replacing or re-rendering the editor.
    const inputs=mount?.querySelectorAll?.('#technicalReviewDetail input, #technicalReviewDetail textarea, #technicalReviewDetail select')||[];
    if(Array.from(inputs).some(input=>!input.disabled && (input.tagName==='SELECT' ? selectValueChanged(input) :
      ['checkbox','radio'].includes(input.type) ? input.checked!==input.defaultChecked : !['button','submit','hidden','search'].includes(input.type) && input.value!==input.defaultValue)))
      return 'Save or cancel your pending edits before returning to Technical Review.';
    return '';
  }
  function returnToQueue() {
    if(!canReturnToQueue())return false;
    const blocked=reviewNavigationBlock();
    if(blocked){window.alert(blocked);return false;}
    showQueue();
    document.getElementById('technicalReviewQueueTitle')?.focus?.();
    return true;
  }
  function openAssemblyLibrary() {
    if(!['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)||state.selected||state.saving)return;
    window.DleWorkspaceShell?.navigate?.({workspaceId:'assembly-library',screenId:'home'});
  }

  function showQueue() {
    partRequestGeneration++;partRequestOpening=false;
    partRequestReview?.destroy();partRequestReview=null;
    const partView=document.getElementById('technicalReviewPartRequestView');if(partView)partView.hidden=true;
    clearTimeout(analysisPoll); clearInterval(analysisClock);
    state.analysisJob = null; state.analysisError = '';
    state.guided = false;
    mount?.classList.remove("technical-review-guided");
    mount?.classList.remove("technical-review-entry");
    state.selected = null;
    state.assemblyLibrary = false;
    drawingFolderBrowser = null;
    state.closing = false;
    state.message = "";
    document.getElementById("technicalReviewDetailView").hidden = true;
    document.getElementById("technicalReviewQueueView").hidden = false;
    const library=document.getElementById('technicalReviewLibraryView');if(library)library.hidden=true;
    window.DleWorkspaceShell?.refreshBackButton?.();
    setStatus("Technical Review queue current", "ready");
  }

  function renderOriginalCustomerRequest(record) {
    const docs=record.customerRequestDocuments||[];
    if(!docs.length)return '';
    return '<section class="technical-review-card" aria-label="Original Customer Request"><h3>Original Customer Request</h3><p>Owned by Intake · Commercial source · Read-only</p><ul>'+docs.map(a=>'<li><a target="_blank" rel="noopener noreferrer" href="/api/sim/rfq-intakes/'+encodeURIComponent(record.intakeId)+'/customer-request-documents/'+encodeURIComponent(a.document.documentId)+'">'+escapeHtml(a.document.name)+'</a> · Customer RFQ / Request</li>').join('')+'</ul></section>';
  }
  function renderDetail() {
    window.DleWorkspaceShell?.refreshBackButton?.();
    const host = document.getElementById("technicalReviewDetail");
    const envelope = state.selected || {};
    const record = envelope.record || {};
    const assembly = record.assemblies?.[0] || {};
    const canDisposition = window.DleOsCapabilities?.can?.("technical_review.disposition") === true;
    if (!host) return;
    const candidatePosition=captureCandidatePosition();
    for(const panel of host.querySelectorAll('[data-candidate-panel]'))(state.candidatePanels ||= {})[panel.dataset.candidatePanel]=panel.open;
    const candidateFocused=['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)&&state.guided&&state.step==='candidate'&&!completedReview(record);
    mount?.classList.toggle('candidate-focused',candidateFocused);
    candidateWorkbenchObserver?.disconnect();
    const entry = !state.guided && !state.closing && !completedReview(record) && record.status !== "NO_LONGER_REQUIRED";
    mount?.classList.toggle("technical-review-entry", entry);
    if (entry) { mount?.classList.remove("technical-review-guided"); host.innerHTML = renderEntryConfirmation(record, canDisposition)+renderOriginalCustomerRequest(record); return; }
    if (completedReview(record)) {
      host.innerHTML = state.step === 'submitted' ? renderSubmittedReview(record) : renderCompletedReview(record)+renderCustomerAmendmentEntry(record)+renderOriginalCustomerRequest(record);
      return;
    }
    mount?.classList.toggle("technical-review-guided", state.guided);
    if (state.step === 'scanned-setup') { host.innerHTML = renderScannedSetup(); return; }
    scanWorkbenchObserver?.disconnect();
    if (state.step === 'scanned-review') { host.innerHTML = renderScannedWorksheet(); watchScanWorkbench(); return; }
    if (state.step === 'accepted-bom') { host.innerHTML = renderAcceptedBom(record); return; }
    if(candidateFocused&&state.finalBomReview){host.innerHTML=renderFinalBomReview(record,record.technicalReview.candidateBom);return;}
    if(candidateFocused){host.innerHTML=renderCandidate(record);watchCandidateWorkbench();void checkCandidateCompletion();restoreCandidatePosition(candidatePosition);return;}
    host.innerHTML = '<div class="technical-review-context"><div><p class="technical-review-eyebrow">RFQ Review · ' + escapeHtml(record.intakeId) + '</p>' +
      '<h2 id="technicalReviewDetailTitle" tabindex="-1">' + escapeHtml(record.customer?.customerName || "Customer") + '</h2>' +
      (!state.guided && record.intakeType === 'NEW_QUOTE_REQUEST' ? renderIntakeSummary(record) : '<p>' + escapeHtml(assembly.assemblyNumber) + ' · Rev ' + escapeHtml(assembly.revision) + ' · Qty ' + escapeHtml(assembly.quantity) + '</p>') + '</div>' +
      '<span class="technical-review-status-pill">' + escapeHtml(envelope.reviewStatusLabel) + '</span></div>' +
      renderDrawingFolders(record) +
      renderOriginalCustomerRequest(record) +
      (canDisposition && state.step !== 'candidate' && !(record.technicalReview?.workflow && state.step === 'inventory') && ['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(record.status) ? '<p><button data-technical-review-action="add-document" '+(state.saving||addingDocuments?'disabled':'')+'>Add Technical Document</button></p>' : '') +
      (state.step === 'candidate' || (record.technicalReview?.workflow && state.step === 'inventory') ? '' : '<div id="technicalReviewAnalysisProgress">' + renderAnalysisProgress() + '</div>') +
      (state.guided ? (['sufficiency', 'context', 'definition', 'release'].includes(state.step) ? renderWorkflowStep(record) : state.step === 'labor-first' ? renderLaborFirstEntry(record) : state.step === 'manufacturing' ? renderManufacturingHandoff(record) : state.step === 'accepted-bom' ? renderAcceptedBom(record) : state.step === 'candidate' ? renderCandidate(record) : state.materials ? renderMaterials(record) : state.step === 'inventory' ? renderInventory() : state.step === 'governing' ? renderGoverning() : state.step === 'coverage' ? renderCoverage(record) : renderHistoryQuestion(record, canDisposition)) : renderEntryActions(record, canDisposition));
    watchCandidateWorkbench();
    void checkCandidateCompletion();
    restoreCandidatePosition(candidatePosition);
  }

  let drawingFolderBrowser = null;
  let drawingFoldersAvailable = false;
  let documentRemovalAvailable=false;
  function canManageReviewDocuments() {
    documentRemovalAvailable ||= state.selected?.documentRemovalAvailable===true;
    const r=state.selected?.record;
    return documentRemovalAvailable && ['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment) && window.DleOsCapabilities?.can?.('technical_review.disposition')===true &&
      ['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(r?.status) && !completedReview(r);
  }
  function reviewDocumentRemoveButton(id) {
    const file=state.selected?.record?.technicalFiles?.find(f=>f.documentId===id),name=file?.name||'file';
    return canManageReviewDocuments()?'<button type="button" class="technical-review-secondary" title="Remove from review (original retained)" aria-label="Remove '+escapeHtml(name)+' from review" data-technical-review-action="remove-review-document" data-document-id="'+escapeHtml(id)+'" '+(state.saving?'disabled':'')+'><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button><small role="alert" tabindex="-1" data-removal-message="'+escapeHtml(id)+'"></small>':'';
  }
  function renderRemovedReviewDocuments() {
    const removed=(state.selected?.record?.reviewDocumentRemovals||[]).filter(x=>!x.restoredAtUtc);
    if(!removed.length)return '';
    return '<details class="technical-review-question"><summary>Removed files ('+removed.length+')</summary><p>Copies and provenance are retained in SIM. Originals on the server are untouched.</p>'+removed.map(x=>
      '<div><strong>'+escapeHtml(x.file.name)+'</strong><small> Removed by '+escapeHtml(x.removedBy)+' · '+escapeHtml(formatDateTime(x.removedAtUtc))+'</small> '+
      (canManageReviewDocuments()?'<button type="button" data-technical-review-action="restore-review-document" data-document-id="'+escapeHtml(x.file.documentId)+'" '+(state.saving?'disabled':'')+'>Restore to review</button>':'')+'</div>').join('')+'</details>';
  }
  async function changeReviewDocumentRemoval(id, restore) {
    if(state.saving||!canManageReviewDocuments())return;
    if(identityChanges[id]&&unchangedPackageRow(id))delete identityChanges[id]; // Opening Edit alone is not a changed document.
    const blocked=pendingReferenceSelection()?'Save or cancel the drawing choice in Step 1 before removing a file.':reviewNavigationBlock();if(blocked){reportRemovalIssue(id,blocked.replace(/before returning to Technical Review\./g,'before removing a file.'));return;}
    const r=state.selected.record, file=restore?(r.reviewDocumentRemovals||[]).find(x=>x.file.documentId===id&&!x.restoredAtUtc)?.file:r.technicalFiles.find(f=>f.documentId===id);
    if(!file)return;
    removalIssue=null;state.saving=true;renderDetail();
    const base='/api/sim/technical-reviews/'+encodeURIComponent(r.intakeId)+'/documents/'+encodeURIComponent(id)+'/removal';
    try {
      const eligibility=await fetchJson(base);
      if(!(restore?eligibility.canRestore:eligibility.canRemove)){reportRemovalIssue(id,eligibility.reason||'This file cannot be changed. Reopen the review.');return;}
      const message=restore?'Restore "'+file.name+'" to this review? Existing review decisions stay unchanged.':'Remove "'+file.name+'" from this review? Its copy and history are retained for Restore. The original server file will not be deleted.';
      if(!window.confirm(message))return;
      const payload=await fetchJson(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedToken:eligibility.token,action:restore?'RESTORE':'REMOVE'})});
      state.selected=payload;state.packageDraft=null;state.teamDraft=null;releaseReadiness=null;
      state.message=restore?'File restored to review.':'File removed from active review. The copy and recovery history are retained.';state.messageState='';
    }catch(error){reportRemovalIssue(id,error.message||'Could not change the file. Reopen the package before retrying.');}
    finally{state.saving=false;renderDetail();if(removalIssue?.id===id)reportRemovalIssue(id,removalIssue.message);}
  }

  let removalIssue=null;
  function reportRemovalIssue(id,message) {
    removalIssue={id,message};
    const el=Array.from(mount?.querySelectorAll?.('[data-removal-message]')||[]).find(e=>e.dataset?.removalMessage===id);
    if(el){el.textContent=message;el.focus?.({preventScroll:true});}else window.alert(message);
  }
  function focusReviewStep(role) {
    const step=mount?.querySelector('[data-review-step="'+(role==='DRAWING_REFERENCE'?'drawing':'bom')+'"]');
    step?.scrollIntoView?.({block:'nearest'});step?.focus?.({preventScroll:true});
  }
  function fileBrowserHost(b) {
    if(!b)return null;
    return (b.mode==='file'?mount?.querySelector('[data-linked-file-browser="'+b.role+'"]'):null)||mount?.querySelector('[data-drawing-folder-browser="'+b.line+'"]');
  }
  function inlineFilePicker(role) {
    const b=drawingFolderBrowser,r=state.selected.record;
    return '<div data-linked-file-browser="'+role+'">'+(b?.mode==='file'&&b.role===role?drawingFolderBrowserHtml(r,b.line):'')+'</div>';
  }
  function bomSelectionSummary() {
    const r=state.selected.record,pack=unifiedPackageDraft(),drawing=r.technicalReview?.presentationDraft?.teamDocumentId;
    const sources=pack.documents.filter(d=>d.bomUse==='GOVERNING_BOM'||d.bomUse==='SUPPORTING_BOM'||identityType(d)==='VPRO5_BOM_EXPORT'||r.technicalFiles.find(f=>f.documentId===d.documentId)?.reviewOrigin?.linkedSource?.role==='BOM_REFERENCE');
    return '<p>Selected BOM files: '+(sources.length?sources.map(d=>escapeHtml(d.name)+(identityChanges[d.documentId]?' (pending Accept changes)':'')).join('; '):'None')+'</p>'+
      (drawing?'<button type="button" data-technical-review-action="use-drawing-for-bom" '+(state.saving?'disabled':'')+'>Use the selected drawing for BOM review too</button>':'')+'<p>Review each file and accept its changes below. File selection does not accept or build a BOM.</p>';
  }
  function stageDrawingForBom() {
    if(state.saving||!canManageReviewDocuments())return;
    const r=state.selected.record,id=r.technicalReview?.presentationDraft?.teamDocumentId,pack=unifiedPackageDraft(),doc=pack.documents.find(d=>d.documentId===id);
    if(!doc){window.alert('Save the drawing reference in Step 1 first.');return;}
    if(doc.rowAssociation||doc.applicability!=='PARENT_ASSEMBLY'){window.alert('Choose a main assembly drawing in package review before assigning its BOM role.');return;}
    if(reviewNavigationBlock()){window.alert('Save or cancel pending edits before assigning the drawing as a BOM source.');return;}
    if(r.technicalReview.candidateBom||r.technicalReview.bomAcceptances?.length){window.alert('A BOM review already exists. Keep its source history; use the existing source-change workflow.');return;}
    if(pack.governingBomDocumentId&&pack.governingBomDocumentId!==id){window.alert('Another Main BOM is selected. Change its Materials Use explicitly before choosing the drawing.');return;}
    identityChanges[id]={type:'DRAWING_AND_BOM',otherDescription:''};doc.documentType='ASSEMBLY_DRAWING';doc.embeddedBom=true;doc.bomUse='GOVERNING_BOM';pack.governingBomDocumentId=id;
    state.message='Drawing also selected for BOM review. Review its Materials Use and Accept changes below; nothing has been saved or extracted.';
    renderDetail();focusReviewStep('BOM_REFERENCE');
  }

  function linkedFileButtons(role) {
    const r=state.selected?.record;
    if(!state.selected?.linkedDrawingFilesAvailable || !['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment) ||
      !window.DleOsCapabilities?.can?.('technical_review.disposition') || !['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(r?.status) || completedReview(r))return '';
    return (r.assemblies||[]).filter(a=>r.drawingFolders?.some(f=>f.lineNumber===a.lineNumber)).map(a=>
      '<button type="button" data-drawing-folder="'+(role==='DRAWING_REFERENCE'?'pick-drawing':'pick-bom')+'" data-line="'+a.lineNumber+'" '+(state.saving?'disabled':'')+'>'+
      'Choose '+(role==='DRAWING_REFERENCE'?'drawing / reference':'BOM reference')+' from linked folder'+(r.assemblies.length>1?' — '+escapeHtml(a.assemblyNumber):'')+'</button>').join(' ');
  }
  function linkedFileConfirmation(b) {
    if(!b.selection)return '';
    if(useSourceSetup())return '<section class="technical-review-question"><strong>'+escapeHtml(b.selection.name)+'</strong><p>Use this file as '+(b.role==='DRAWING_REFERENCE'?'the production drawing':'the VPRO5 BOM source')+'? A verified review copy will be saved. The original and any previous source stay unchanged.</p><button type="button" data-drawing-folder="save-file" data-line="'+b.line+'" '+(b.busy?'disabled':'')+'>Use this file</button><button type="button" data-drawing-folder="clear-file" data-line="'+b.line+'" '+(b.busy?'disabled':'')+'>Choose another file</button></section>';
    const f=b.selection, choices=b.role==='DRAWING_REFERENCE'?{DRAWING:'Drawing',DRAWING_AND_BOM:'Drawing + BOM'}:{BOM_ONLY:'BOM Only',DRAWING_AND_BOM:'Drawing + BOM',VPRO5_BOM_EXPORT:'VPRO5 BOM Export'};
    return '<section class="technical-review-question"><strong>'+escapeHtml(f.name)+'</strong><p>'+escapeHtml(b.role==='DRAWING_REFERENCE'?'Drawing / Reference':'BOM reference')+' · '+f.source.size+' bytes · Source modified '+escapeHtml(formatDateTime(f.source.lastWriteUtc))+'</p>'+
      '<p>Save one verified copy in SIM for this review. The original stays on the share. Later source changes will not update this copy. This does not approve a document, release a drawing, or extract a BOM.</p>'+
      '<label>Document type<select data-linked-file-type '+(b.busy?'disabled':'')+'><option value="">Select document type</option>'+Object.entries(choices).map(([v,l])=>'<option value="'+v+'" '+(b.type===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
      '<button type="button" data-drawing-folder="clear-file" data-line="'+b.line+'" '+(b.busy?'disabled':'')+'>Clear file selection</button><button type="button" data-drawing-folder="save-file" data-line="'+b.line+'" '+(b.busy?'disabled':'')+'>Save selected copy to review</button></section>';
  }
  function renderDrawingFolders(record) {
    drawingFoldersAvailable ||= state.selected?.drawingFoldersAvailable === true;
    if (!drawingFoldersAvailable || !['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)) return '';
    return (record.assemblies || []).map(a => {
      const link = record.drawingFolders?.find(f => f.lineNumber === a.lineNumber);
      const editable = window.DleOsCapabilities?.can?.('technical_review.disposition') === true &&
        ['READY_FOR_RFQ_QUALIFICATION','TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(record.status) && !completedReview(record);
      const button = (action, label) => '<button type="button" data-drawing-folder="'+action+'" data-line="'+a.lineNumber+'" '+(state.saving?'disabled':'')+'>'+label+'</button>';
      return '<section class="drawing-folder-link" data-drawing-folder-panel="'+a.lineNumber+'" aria-label="Drawing / Prints Folder for '+escapeHtml(a.assemblyNumber)+'">'+
        ((record.assemblies.length>1)?'<strong>'+escapeHtml(a.assemblyNumber+' · Rev '+a.revision)+'</strong>':'')+
        '<div class="drawing-folder-summary"><span>Drawing / Prints Folder'+(link?': <strong>'+escapeHtml(link.folderName)+'</strong>':'')+'</span> '+
        (link?button('browse','Browse Folder'):'')+' '+(editable?button('change',link?'Change Folder':'Link Drawing / Prints Folder'):'')+'</div>'+
        (link?'<small>Linked by '+escapeHtml(link.linkedBy)+' · '+escapeHtml(formatDateTime(link.linkedAtUtc))+'</small>':'')+
        '<div data-drawing-folder-browser="'+a.lineNumber+'">'+(drawingFolderBrowser?.mode==='file'?'':drawingFolderBrowserHtml(record,a.lineNumber))+'</div></section>';
    }).join('');
  }
  function drawingFolderBrowserHtml(record, line) {
    const b=drawingFolderBrowser;
    if(!b||b.id!==record.intakeId||b.line!==line)return '';
    const e=escapeHtml, disabled=b.busy?'disabled':'';
    const button=(action,label,root='',relative='')=>'<button type="button" data-drawing-folder="'+action+'" data-line="'+line+'" data-root="'+e(root)+'" data-relative="'+e(relative)+'" '+disabled+'>'+e(label)+'</button>';
    let html='<div class="drawing-folder-browser"><div class="drawing-folder-browser-title"><strong>'+(b.mode==='change'?'Choose Drawing / Prints Folder':'Drawing / Prints Folder')+'</strong>'+button('close','Close')+'</div>';
    if(b.busy)html+='<p role="status">Loading…</p>';
    if(b.error)html+='<p role="alert">'+e(b.error)+'</p>';
    if(b.view) {
      if(!b.view.roots.length)html+='<p>Drawing folder browsing is not configured. Ask the SIM administrator to configure an approved source root.</p>';
      else if(!b.listing)html+='<div class="drawing-folder-roots">'+b.view.roots.map(r=>button('root',r.label,r.id)).join('')+'</div>';
      if(b.listing){
        const l=b.listing, parts=l.relativePath?l.relativePath.split('/'):[];
        const boundary=b.mode==='file'?(b.view.review.association?.relativePath||''):'';
        html+='<nav aria-label="Folder location">'+(b.mode==='file'?button('folder',b.view.review.association.folderName,l.rootId,boundary):button('roots','Sources')+button('root',l.rootLabel,l.rootId))+
          parts.map((p,i)=>{const relative=parts.slice(0,i+1).join('/');return b.mode==='file'&&(relative===boundary||!relative.startsWith(boundary?boundary+'/':''))?'':button('folder',p,l.rootId,relative);}).join('')+'</nav>';
        html+='<ul class="drawing-folder-entries">'+l.entries.filter(f=>!useSourceSetup()||b.mode!=='file'||f.isDirectory||(b.role==='DRAWING_REFERENCE'?/\.pdf$/i:/\.txt$/i).test(f.name)).map(f=>'<li>'+(f.isDirectory?button('folder',f.name,l.rootId,f.relativePath):(b.mode==='file'?button('select-file',f.name,l.rootId,f.relativePath):'<span>'+e(f.name)+'</span><small>File</small>'))+'</li>').join('')+'</ul>';
        if(!l.entries.length)html+='<p>No supported entries in this folder.</p>';
        if(l.truncated)html+='<p role="status">Only the first 200 entries were checked. This listing is incomplete; a narrower configured source may be needed.</p>';
        html+=b.mode==='file'?(useSourceSetup()?'<p>Choose a PDF drawing (up to 20 MB) or an ASCII tab-delimited VPRO5 TXT BOM (up to 1 MB), according to this step.</p>':'<p>Choose one file. Drawing references: PDF or DOCX. BOM references: PDF, DOCX, XLS, XLSX, CSV or TXT. Maximum 20 MB. Preview and extraction follow existing format support.</p>')+linkedFileConfirmation(b):'<p class="drawing-folder-note">Folder reference only. Files are not imported or approved.</p>';
        if(b.mode==='change'&&b.view.review.canChange)html+=button('save','Save Folder Link',l.rootId,l.relativePath);
      }
    }
    return html+'</div>';
  }
  function refreshDrawingFolderPanel() {
    const b=drawingFolderBrowser, record=state.selected?.record;
    if(!b||record?.intakeId!==b.id)return;
    const host=fileBrowserHost(b);
    if(host)host.innerHTML=drawingFolderBrowserHtml(record,b.line);
  }
  async function drawingFolderAction(event) {
    const button=event.target.closest?.('[data-drawing-folder]');
    if(!button||button.disabled||state.saving)return;
    const action=button.dataset.drawingFolder,line=Number(button.dataset.line),r=state.selected?.record;
    if(!r||!r.assemblies?.some(a=>a.lineNumber===line))return;
    if(drawingFolderBrowser?.busy)return;
    if((action==='pick-drawing'||action==='pick-bom')&&!state.selected?.linkedDrawingFilesAvailable)return;
    if(action==='clear-file'&&drawingFolderBrowser){drawingFolderBrowser.selection=null;drawingFolderBrowser.type='';refreshDrawingFolderPanel();return;}
    if(action==='close') {const old=drawingFolderBrowser,host=fileBrowserHost(old);drawingFolderBrowser=null;if(host)host.innerHTML='';if(old?.mode==='file')focusReviewStep(old.role);return;}
    if(['pick-drawing','pick-bom','change','browse'].includes(action)){const previous=fileBrowserHost(drawingFolderBrowser);if(previous)previous.innerHTML='';}
    if(action==='pick-drawing'||action==='pick-bom'){drawingFolderBrowser={id:r.intakeId,line,mode:'file',role:action==='pick-drawing'?'DRAWING_REFERENCE':'BOM_REFERENCE',busy:false,error:''};}
    if(action==='change'||action==='browse')drawingFolderBrowser={id:r.intakeId,line,mode:action==='browse'?'browse':'change',busy:false,error:''};
    const b=drawingFolderBrowser;
    if(!b||b.id!==r.intakeId||b.line!==line)return;
    const base='/api/sim/technical-reviews/'+encodeURIComponent(r.intakeId)+'/drawing-folder';
    if(action==='save-file'){
      b.type=useSourceSetup()?(b.role==='DRAWING_REFERENCE'?'DRAWING':'VPRO5_BOM_EXPORT'):mount?.querySelector('[data-linked-file-type]')?.value||'';
      if(!b.type){b.error='Choose the document type before saving.';refreshDrawingFolderPanel();return;}
      if(reviewUploads.length||Object.keys(identityChanges).length||pendingPackageValues()||pendingReferenceSelection()||candidateProgressRows().length||state.scanSheetDirty||state.scanEdit||state.finalBomReview){b.error='Save or cancel pending review edits before adding this copy.';refreshDrawingFolderPanel();return;}
    }
    b.busy=true;b.error='';refreshDrawingFolderPanel();
    try {
      if(['change','browse','pick-drawing','pick-bom'].includes(action)) {
        b.view=await fetchJson(base+'?line='+line);
        if((action==='browse'||b.mode==='file')&&b.view.review.association){const a=b.view.review.association;b.listing=await fetchJson(base+'/contents?'+new URLSearchParams({line,rootId:a.rootId,relativePath:a.relativePath}));}
      } else if(action==='select-file'&&b.mode==='file') {
        b.selection=null;b.type='';
        b.selection=await fetchJson(base+'/file?'+new URLSearchParams({line,relativePath:button.dataset.relative,role:b.role}));
        b.selectionId=window.crypto.randomUUID();
      } else if(action==='save-file'&&b.mode==='file'&&b.selection) {
        state.saving=true;
        const payload=await fetchJson(base+'/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineNumber:line,expectedFolderToken:b.selection.folderToken,relativePath:b.selection.source.relativePath,role:b.role,sourceToken:b.selection.source.sourceToken,selectionId:b.selectionId,type:b.type})});
        if(state.selected?.record===r){
          state.selected={...state.selected,...payload};state.packageDraft=null;releaseReadiness=null;
          const file=payload.record.technicalFiles.find(f=>f.reviewOrigin?.linkedSource?.selectionId===b.selectionId);
          if(useSourceSetup()&&file){sourceChoices()[b.role==='DRAWING_REFERENCE'?'drawingId':'bomId']=file.documentId;sourceChoices().dirty=true;state.sourceIdentity=null;state.sourceConfirm=false;state.sourceConfirmReason='';state.sourceMessage='File selected. Save Draft or Save & Build Candidate.';}
          else if(b.role==='DRAWING_REFERENCE'&&file)state.teamDraft={intakeId:r.intakeId,teamDocumentId:file.documentId,referenceStatus:payload.record.technicalReview?.presentationDraft?.referenceStatus||'UNKNOWN'};
          state.message=b.role==='DRAWING_REFERENCE'?'Copy saved. Choose Save reference selection to use it as the drawing reference.':'BOM reference copy saved in Source documents. Choose its Materials Use and review it before requesting extraction.';
          drawingFolderBrowser=null;state.saving=false;renderDetail();focusReviewStep(b.role);
        }
      } else if(action==='roots') {b.listing=null;b.selection=null;}
      else if(action==='root'||action==='folder') {b.selection=null;b.listing=null;b.listing=await fetchJson(base+'/contents?'+new URLSearchParams({line,rootId:button.dataset.root,relativePath:button.dataset.relative||''}));}
      else if(action==='save'&&b.mode==='change'&&b.listing&&b.view.review.canChange){
        const link=await fetchJson(base,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineNumber:line,expectedToken:b.view.review.token,rootId:b.listing.rootId,relativePath:b.listing.relativePath})});
        // Do not replace the review envelope or any unsaved working data.
        if(state.selected?.record===r){r.drawingFolders=[...(r.drawingFolders||[]).filter(f=>f.lineNumber!==line),link];
          drawingFolderBrowser=null;const panel=mount?.querySelector('[data-drawing-folder-panel="'+line+'"]');
          if(panel){const temp=document.createElement('div');temp.innerHTML=renderDrawingFolders(r);panel.replaceWith(temp.querySelector('[data-drawing-folder-panel="'+line+'"]'));}}
      }
    } catch(error){b.error=error.message||'Folder access is unavailable.';}
    finally {if(action==='save-file')state.saving=false;b.busy=false;if(drawingFolderBrowser===b){refreshDrawingFolderPanel();if(action==='pick-drawing'||action==='pick-bom')fileBrowserHost(b)?.scrollIntoView?.({block:'nearest'});}}
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
    return '<section class="technical-review-entry-card"><h2 id="technicalReviewDetailTitle" tabindex="-1">Technical Review Submitted</h2><p class="technical-review-entry-customer">'+escapeHtml(record.intakeId)+' · '+escapeHtml(record.customer?.customerName || '')+'</p><p role="status">Submitted for Materials and Labor quotation.</p><div class="technical-review-entry-actions"><button type="button" class="technical-review-primary" data-technical-review-action="submitted-done">Done</button></div></section>';
  }
    function renderCustomerAmendmentEntry(record) {
    return '<section class="technical-review-question" id="customerIdentityAmendment"><h3>Customer / internal part numbers</h3><p>Correct customer identities through a reviewed amendment. Original BOM versions stay available.</p><button type="button" data-customer-identity="open">Review customer numbers</button> <button type="button" data-customer-identity="new">Correct a customer number</button><p role="status" data-identity-message></p></section>';
  }
  async function customerIdentityAction(event) {
    const action=event.target.closest('[data-customer-identity]')?.dataset.customerIdentity;
    if(!action)return;
    const panel=document.getElementById('customerIdentityAmendment');
    if(!panel || panel.dataset.busy==='true')return;
    if(action==='back'){returnToQueue();return;}
    const record=state.selected?.record;
    const url='/api/sim/technical-reviews/'+encodeURIComponent(record.intakeId)+'/customer-identities';
    const message=panel.querySelector('[data-identity-message]');
    panel.dataset.busy='true';
    panel.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      let options={credentials:'same-origin',cache:'no-store'}, suffix='';
      if(action==='save') {
        const view=state.customerIdentityView;
        const changes=[...panel.querySelectorAll('[data-identity-row]')].filter(el=>el.querySelector('[data-number]').value.trim()).map(el=>{
          const row=view.accepted.candidate.rows.find(r=>r.index===Number(el.dataset.identityRow));
          const source=view.sources.find(s=>s.documentId===el.querySelector('[data-source]').value);
          if(!source)throw Error('Choose the source document for each changed number.');
          const number=el.querySelector('[data-number]').value.trim();
          return {index:row.index,rowId:row.rowId,sourcePartNumber:row.values.partNumber,customerPartNumber:number,
            evidence:customerCorrectionEvidence(view,row.index,number,source,el.querySelector('[data-location]').value.trim())};
        });
        options={...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedToken:view.token,reason:panel.querySelector('[data-reason]').value,changes})};
      } else if(action==='accept') {
        const view=state.customerIdentityView, draft=view.history.at(-1);
        if(!panel.querySelector('[data-reviewed]').checked || !panel.querySelector('[data-saved]').checked)throw Error('Confirm source review and that every quotation editor has saved their work.');
        suffix='/accept';options={...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedToken:view.token,draftId:draft.id,mappingsReviewed:true,quotationWorkSaved:true})};
      }
      const response=await window.fetch(url+suffix,options), data=await response.json();
      if(!response.ok)throw Error(data.message||'The amendment could not be saved.');
      state.customerIdentityView=data;renderCustomerIdentityPanel(panel,data,action==='new');
      if(action==='accept'){panel.scrollIntoView({block:'start'});panel.querySelector('h3')?.focus({preventScroll:true});}
      const status=panel.querySelector('[data-identity-message]');
      if(status)status.textContent=action==='accept'?'Accepted BOM version '+data.accepted.version+'. Customer identities updated; quotation records retained.':action==='save'?'Draft saved. Review each source before accepting.':'';
    } catch(error) { message.textContent=error.message; }
    finally {panel.dataset.busy='false';panel.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  function customerCorrectionEvidence(view,index,number,source,location) {
    const draft=view.history.at(-1),previous=draft?.acceptedVersion==null?draft?.changes.find(c=>c.index===index):null;
    if(previous?.customerPartNumber===number && previous.evidence[0]?.documentId===source.documentId && previous.evidence[0]?.sha256===source.sha256 && previous.evidence[0]?.location===location)return previous.evidence;
    return [{documentId:source.documentId,sha256:source.sha256,location,quotedNumber:number}];
  }
  function renderCustomerIdentityPanel(panel, view, editing=false) {
    const e=escapeHtml,draft=view.history.at(-1),pending=draft && draft.acceptedVersion==null && draft.baseVersion===view.accepted.version;
    const completed=!editing && !pending && view.history.some(d=>d.acceptedVersion===view.accepted.version);
    const current=r=>r.customerIdentity?.partNumber||(r.identityBasis==='CUSTOMER_PN'?r.primaryIdentity?.partNumber:'')||'Not recorded';
    const sourceLink=proof=>'<a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/'+encodeURIComponent(state.selected.record.intakeId)+'/documents/'+encodeURIComponent(proof.documentId)+'">'+e(view.sources.find(s=>s.documentId===proof.documentId)?.name||proof.documentId)+'</a> - '+e(proof.location);
    let body=completed?'<div class="customer-identity-success"><h3 tabindex="-1">Customer numbers updated</h3><p><strong>BOM v'+view.accepted.version+' is accepted.</strong> No further action is required here.</p><button type="button" class="technical-review-primary" data-customer-identity="back">Back to reviews</button></div>':'<h3 tabindex="-1">Customer / internal part numbers - BOM v'+view.accepted.version+'</h3>';
    if(completed) {
      const accepted=view.history.find(d=>d.acceptedVersion===view.accepted.version);
      body+='<p class="customer-identity-updated">'+accepted.changes.map(c=>{const r=view.accepted.candidate.rows.find(r=>r.index===c.index);return 'Find '+e(r.values.lineNumber)+': <strong>'+e(c.customerPartNumber)+'</strong>';}).join(' &middot; ')+'</p>';
      panel.innerHTML=body;return;
    } else if(!pending)body+='<p>No customer-number correction is waiting for review. Start a correction only if a customer number needs changing.</p><button type="button" class="technical-review-primary" data-customer-identity="back">Back to reviews</button>';
    if(pending) {
      body+='<h4>Review these customer-number changes</h4><p>This draft has not been applied. Compare the proposed numbers with the source documents, then accept when ready.</p><p>'+e(draft.reason)+'</p><div style="overflow:auto"><table><thead><tr><th>Find</th><th>Current customer number</th><th>Proposed customer number</th><th>Source</th></tr></thead><tbody>'+draft.changes.map(c=>{
        const r=view.accepted.candidate.rows.find(r=>r.index===c.index);
        return '<tr><td data-label="Find">'+e(r.values.lineNumber)+'</td><td data-label="Current">'+e(current(r))+'</td><td data-label="Proposed">'+e(c.customerPartNumber)+'</td><td data-label="Source"><span>'+c.evidence.map(sourceLink).join('<br>')+'</span></td></tr>';
      }).join('')+'</tbody></table></div>';
      if(view.canAmend)body+='<p><label><input type="checkbox" data-reviewed> I compared every proposed customer number with its cited source and resolved ambiguity.</label></p><p><label><input type="checkbox" data-saved> All quotation editors have saved their work and are ready to reopen after acceptance.</label></p><button type="button" class="technical-review-primary" data-customer-identity="accept">Accept customer-number amendment</button>';
    }
    if(view.canAmend && (editing||pending))body+='<details class="customer-identity-editor" '+(editing?'open':'')+'><summary>'+(pending?'Edit this draft':completed?'Make another correction':'Start a customer-number correction')+'</summary><p>Open only the rows you need to correct. Enter the customer\'s internal number, then choose the document and page or cell that shows it. Manufacturer/source numbers will not change.</p><label>Why are these customer numbers changing?<input data-reason maxlength="1000" value="'+e(pending?draft.reason:'')+'"></label>'+view.accepted.candidate.rows.map(r=>{
      const change=pending?draft.changes.find(c=>c.index===r.index):null,proof=change?.evidence[0];
      return '<details class="customer-identity-row"><summary>Find '+e(r.values.lineNumber)+' &mdash; Customer: <strong>'+e(current(r))+'</strong>'+(change?' &rarr; '+e(change.customerPartNumber):'')+'</summary><p>Manufacturer/source number: <strong>'+e(r.values.partNumber)+'</strong></p><fieldset data-identity-row="'+r.index+'"><legend>Correction for Find '+e(r.values.lineNumber)+'</legend><label>New customer / internal number<input data-number maxlength="200" value="'+e(change?.customerPartNumber||'')+'"></label><label>Document showing this number<select data-source><option value="">Choose source</option>'+view.sources.map(s=>'<option value="'+e(s.documentId)+'" '+(proof?.documentId===s.documentId?'selected':'')+'>'+e(s.name)+'</option>').join('')+'</select></label><label>Where in the document? (page / row or sheet / cell)<input data-location maxlength="500" value="'+e(proof?.location||'')+'"></label></fieldset></details>';
    }).join('')+'<p>Saving creates a draft for review. It does not update the accepted BOM.</p><button type="button" data-customer-identity="save">Save draft for review</button></details>';
    else if(view.canAmend && !pending)body+='<button type="button" data-customer-identity="new">Correct a customer number</button>';
    else if(!completed)body+='<p>This quotation is unavailable for a customer-only amendment.</p>';
    body+='<details><summary>Correction history ('+view.history.length+')</summary>'+view.history.map(d=>'<p>'+e(d.reason)+' - '+(d.acceptedVersion?'Accepted as v'+d.acceptedVersion+' by '+e(d.acceptedBy):'Unaccepted draft')+'</p>').join('')+'</details><button type="button" data-customer-identity="open">Reload correction status</button><p role="status" data-identity-message></p>';
    panel.innerHTML=body;
  }

  function renderCompletedReview(record) {
    const review = record.technicalReview, w = review.workflow || {}, pack = review.technicalPackage || {documents:[]};
    const section = state.step || 'package';
    const slides = w.outputs?.productionSlides && review.presentationDraft && window.DleOsCapabilities?.can?.('technical_review.view') === true ? '<p><button data-technical-review-action="draft-slides" '+(state.saving?'disabled':'')+'>View accepted production slides</button></p>' : '';
    let body = '';
    if (section === 'package') body = '<h3>Package Review</h3>' + (w.rfqPackageAcceptance?'<p>Package accepted for RFQ · '+escapeHtml(w.rfqPackageAcceptance.reviewer)+' · '+escapeHtml(formatDateTime(w.rfqPackageAcceptance.atUtc))+'</p>':'<p>Package confirmed: ' + (w.packageConfirmed ? 'Yes' : 'Not recorded') + ' · Sufficient to continue: ' + (w.sufficient ? 'Yes' : 'Not recorded') + '</p>') + (pack.documents || []).map(d => '<details open><summary>' + escapeHtml(d.name) + '</summary>' + savedFacts(d) + ((record.technicalFiles || []).some(f => f.documentId === d.documentId && f.binaryStatus === 'VERIFIED') ? '<a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/' + encodeURIComponent(record.intakeId) + '/documents/' + encodeURIComponent(d.documentId) + '">View File</a>' : '') + '</details>').join('');
    if (section === 'history') body = '<h3>Assembly history / context</h3>' + savedFacts(review.assemblyHistory);
    if (section === 'manufacturing') body = w.rfqPackageAcceptance&&!w.manufacturing?'<h3>Engineering reference for RFQ</h3><p>'+escapeHtml((record.technicalFiles||[]).find(f=>f.documentId===w.rfqPackageAcceptance.referenceDocumentId)?.name||'Saved reference')+' · Engineering / Test / Prototype</p>':'<h3>Manufacturing Definition</h3>' + savedFacts(w.manufacturing);
    if (section === 'materials') body = '<h3>Materials Definition</h3>' + savedFacts({status:review.materialsReviewStatus,governingBomDocumentId:pack.governingBomDocumentId,materialsTarget:w.outputs?.materialsTarget}) + acceptedLinks(record);
    if (section === 'completion') body = '<h3>Completion / review history</h3>' + savedFacts({status:record.status,reviewer:w.outputs?.reviewer,atUtc:w.outputs?.atUtc,events:w.events});
    if (section === 'candidate') body = review.candidateBom ? renderCandidate(record) : '<p>No Candidate BOM recorded.</p>';
    if (section === 'accepted-bom') body = renderAcceptedBom(record);
    return '<section class="technical-review-completed"><button class="technical-review-back" data-technical-review-action="review-queue">← Back to reviews</button><h2 id="technicalReviewDetailTitle" tabindex="-1">Completed Technical Review — Read-only</h2><p>' + escapeHtml(record.intakeId) + ' · ' + escapeHtml(record.customer?.customerName) + '</p><p>Technical Review complete — released for quotation.</p><p>Inspection only. The completed review and accepted BOM remain unchanged.</p><nav aria-label="Completed review sections">' + [['package','Package Review'],['history','History Context'],['manufacturing',w.rfqPackageAcceptance&&!w.manufacturing?'Engineering Reference':'Manufacturing Definition'],['materials','Materials Definition / Governing BOM'],['candidate','Candidate / Reviewed BOM'],['completion','Completion History']].map(([key,label]) => '<button data-technical-review-action="view-' + key + '" aria-pressed="' + (section === key) + '">' + label + '</button>').join(' ') + '</nav>' + acceptedLinks(record) + slides + '<section class="technical-review-question">' + body + '</section></section>';
  }

  function renderEntryConfirmation(record, canDisposition) {
    const started = !!record.technicalReview?.workflow || record.technicalReview?.disposition === 'START_TECHNICAL_REVIEW' || ['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(record.status);
    const action = record.technicalReview?.workflow ? 'flow-START' : manufacturingIsNext(record) ? 'manufacturing' : 'start';
    const disabled = !canDisposition || state.saving ? 'disabled' : '';
    return '<section class="technical-review-entry-card"><h2 id="technicalReviewDetailTitle" tabindex="-1">Technical Review — ' + escapeHtml(record.intakeId) + '</h2>' +
      '<p class="technical-review-entry-customer">' + escapeHtml(record.customer?.customerName || 'Customer') + '</p>' + renderIntakeSummary(record, true) +
      renderDrawingFolders(record) +
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
    if(action==='COMPLETE'||action==='CONFIRM_RFQ_PACKAGE'){
      if(pendingSubmissionEdits()||!releaseReadiness?.submissionToken||(action==='COMPLETE'&&!releaseReadiness.ready)||(action==='CONFIRM_RFQ_PACKAGE'&&!releaseReadiness.packageAcceptanceRequired)){state.message='Finish the items shown before continuing.';renderDetail();return;}
      body.expectedSubmissionToken=releaseReadiness.submissionToken;
    }
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
      releaseReadiness=null;
      if (action === 'COMPLETE') { state.guided = false; state.step = 'submitted'; renderDetail(); } else resumeWorkflow();
    } catch (error) { state.message = error.message; state.messageState = 'error'; if(action==='COMPLETE'||action==='CONFIRM_RFQ_PACKAGE'){state.step='inventory';releaseReadiness=null;} }
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
    return '<section class="technical-review-question"><h3>Which BOM governs the parent assembly for this RFQ?</h3><p>Select the authority for Material / BOM Definition.</p>' + candidates.map(d=>'<label class="technical-review-bom-option"><input type="radio" name="governingBom" data-governing-id="'+escapeHtml(d.documentId)+'" '+(pack.governingBomDocumentId === d.documentId ? 'checked' : '')+'> '+escapeHtml(d.name)+' — '+bomSourceLabel(d)+'</label>').join('') + (candidates.length ? '' : '<p>No eligible parent BOM source. Review the package classification.</p>') + '<p>Candidate extraction uses the selected Main BOM PDF. Standalone BOM PDFs use full-table extraction; the legacy embedded-BOM pilot reads page 2, up to ten rows unless enrichment is selected. Human verification is required.</p>' + (pack.governingBomDocumentId ? '<button class="technical-review-primary" data-technical-review-action="candidate-from-source">Save selection and build Candidate BOM</button>' : '') + packageMessage() + '<p><button class="technical-review-back" data-technical-review-action="package-back">Back to Technical Package Review</button> <button class="technical-review-back" data-technical-review-action="review-back">Back to Technical Review</button></p></section>';
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


  function renderVproDecisions(bom,readOnly=false) {
    const v=bom.vproImport;if(!v)return '';
    const s=state.vproDecisionState?.candidateId===bom.id?state.vproDecisionState:null;
    const history=[...(v.baselineHistory||[]),...(v.discrepancyHistory||[])];
    const recorded='<p>Baseline approval: '+escapeHtml(v.baselineDecision?('Recorded by '+v.baselineDecision.reviewer+': '+v.baselineDecision.reason):'Not recorded')+'</p><p>Discrepancy review: '+escapeHtml(v.discrepancyDecision?('Recorded by '+v.discrepancyDecision.reviewer+': '+v.discrepancyDecision.notes):'Not recorded')+'</p>';
    if(readOnly)return '<section class="scanned-bom-notice"><h4>Accepted VPRO source decisions</h4>'+recorded+'<p>Source SHA-256: '+escapeHtml(v.sha256)+'</p></section>';
    return '<section class="scanned-bom-notice"><h4>VPRO baseline and discrepancy review</h4><p>Finish in order: approve the exact TXT baseline, record your customer-source discrepancy review, then Complete BOM Review. Saving or accepting rows does not make these decisions.</p>'+recorded+
      (history.length?'<details><summary>Earlier decisions ('+history.length+')</summary>'+history.map(d=>'<p>'+escapeHtml(d.reviewer+' — '+d.atUtc+' — '+(d.reason||d.notes))+'</p>').join('')+'</details>':'')+
      '<button type="button" data-technical-review-action="vpro-review-load" '+(state.saving?'disabled':'')+'>Check source decisions</button>'+
      (s?'<div data-vpro-decisions><p>'+escapeHtml(s.assembly+' Rev '+s.revision)+'. Baseline: '+(s.baselineCurrent?'current':'approval required')+'. Discrepancy review: '+(s.discrepanciesCurrent?'current':'completion required')+'.</p><p>Open every relevant source and review differences manually. Customer sources do not replace VPRO values automatically. Review row identities, alternates, quantities and units before recording completion.</p><ul>'+s.documents.map(d=>'<li><a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/'+encodeURIComponent(state.selected.record.intakeId)+'/documents/'+encodeURIComponent(d.documentId)+'">'+escapeHtml(d.name)+'</a> <small title="SHA-256">'+escapeHtml(d.sha256)+'</small></li>').join('')+'</ul><label>Decision reason / discrepancy outcomes<textarea data-vpro-decision-notes maxlength="4000">'+escapeHtml(state.vproDecisionNotes||'')+'</textarea></label><label><input type="checkbox" data-vpro-decision-confirm> I explicitly confirm the decision selected below.</label><p><button type="button" data-technical-review-action="vpro-baseline-save" '+(state.saving?'disabled':'')+'>Approve this exact TXT as baseline</button> <button type="button" data-technical-review-action="vpro-discrepancies-save" '+(state.saving||!s.baselineCurrent||!s.rowsReviewed?'disabled':'')+'>Complete discrepancy review</button></p><p>Accept every row first, then complete discrepancy review. Later row or evidence changes require review again. Final BOM acceptance remains a separate action.</p></div>':'')+'</section>';
  }
  async function loadVproDecisions() {
    if(state.saving)return;
    state.saving=true;
    try{state.vproDecisionState=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/vpro-source-decisions');state.message='Source decision status refreshed.';state.messageState='';}
    catch(e){state.message=e.message;state.messageState='error';state.vproDecisionState=null;}
    finally{state.saving=false;renderDetail();}
  }
  async function saveVproDecision(action) {
    if(state.saving)return;
    const panel=mount.querySelector('[data-vpro-decisions]'),s=state.vproDecisionState;
    if(!panel||!s)return;
    const notes=panel.querySelector('[data-vpro-decision-notes]').value,confirm=panel.querySelector('[data-vpro-decision-confirm]').checked;
    state.vproDecisionNotes=notes;
    if(!confirm||!notes.trim()){state.message='Check the confirmation box and record the reason or discrepancy outcomes.';state.messageState='error';renderDetail();return;}
    if(candidateProgressRows().length){state.message='Save pending row edits before recording a source decision.';state.messageState='error';renderDetail();return;}
    state.saving=true;
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/vpro-source-decisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:s.candidateId,expectedToken:s.token,action,confirm,notes})});
      state.vproDecisionState=null;state.vproDecisionNotes='';state.completionReadiness=null;state.message='Decision recorded. No BOM acceptance or advancement occurred.';state.messageState='';
    }catch(e){state.message=e.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }

  function renderVproImport() {
    const record=state.selected.record, bom=record.technicalReview?.candidateBom;
    if(completedReview(record))return '';
    if(bom?.vproImport)return '<section class="scanned-bom-notice"><h4>VPRO5 BOM draft</h4><p>Imported legacy data requires customer-document, source freshness, alternate and UOM review.</p><button type="button" data-technical-review-action="vpro-open">Open VPRO5 BOM draft</button></section>';
    if(bom)return '';
    const files=record.technicalFiles.filter(f=>f.binaryStatus==='VERIFIED'&&/\.txt$/i.test(f.name));
    return files.length?'<section class="scanned-bom-notice" data-vpro-generation><h4>Generate Candidate from VPRO5 TXT</h4>'+(state.messageState==='error'?'<p role="alert">'+escapeHtml(state.message)+'</p>':'')+'<p>The export must identify '+escapeHtml(record.assemblies?.[0]?.assemblyNumber+' REV '+record.assemblies?.[0]?.revision)+' exactly. Combined assembly names or other revision markings require review; classification choices cannot override an identity mismatch.</p>'+'<h4>VPRO5 BOM Export</h4><p>Build a working draft from a tab-delimited VPRO5 export. This classifies only the selected file; customer documents and their authority stay separate. Save or cancel pending package edits first.</p>'+files.map(f=>'<button type="button" data-technical-review-action="vpro-build" data-document-id="'+escapeHtml(f.documentId)+'" '+(state.saving?'disabled':'')+'>Generate draft from '+escapeHtml(f.name)+'</button>').join('')+'</section>':'';
  }
  async function buildVproDraft(documentId) {
    if(state.saving)return;
    if(Object.keys(identityChanges).length||reviewUploads.length||JSON.stringify(unifiedPackageDraft())!==JSON.stringify(unifiedPackageDraft(JSON.parse(JSON.stringify(state.selected.record.technicalReview.technicalPackage))))){state.message='Save or cancel pending package changes before generating. Incomplete setup can be placed On Hold; generation then requires resuming the review. No P/N guesses are needed to save a hold.';state.messageState='error';renderDetail();focusReviewStep('BOM_REFERENCE');return;}
    state.saving=true;state.message='Reading VPRO5 export.';renderDetail();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/vpro-bom-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId,expectedReviewToken:state.selected.packageReviewToken})});
      state.packageDraft=null;state.guided=true;state.step='candidate';state.candidateIndex=null;state.message='Working draft saved. No BOM acceptance or review advancement occurred.';state.messageState='';
    }catch(e){state.message=e.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();if(state.messageState==='error')focusReviewStep('BOM_REFERENCE');}
  }
  function renderVproEvidence(bom) {
    if(!bom.vproImport)return '';
    const source=bom.vproImport;
    return '<section class="scanned-bom-notice vpro-import-evidence"><h4>VPRO5 source notes — candidate only</h4>'+(source.identityConfirmation?'<p>Source applicability confirmed by '+escapeHtml(source.identityConfirmation.reviewer)+': '+escapeHtml(source.identityConfirmation.sourceDrawing)+'; job '+escapeHtml(source.identityConfirmation.assembly+' REV '+source.identityConfirmation.revision)+'. Reason: '+escapeHtml(source.identityConfirmation.reason)+'</p>':'')+((source.sourceNotes||[]).length?'<details open><summary>Drawing, Find and installation notes</summary><ul>'+source.sourceNotes.filter(n=>n.text.trim()).map(n=>'<li>'+escapeHtml(n.sequence+' · '+n.kind+': '+n.text)+'</li>').join('')+'</ul></details>':'')+'<ul>'+source.concerns.map(c=>'<li>'+escapeHtml(c)+'</li>').join('')+'</ul><p>'+bom.rows.flatMap(r=>(r.alternates||[]).map(a=>'Find '+r.values.lineNumber+': proposed alternate '+a.partNumber+' (requires review)')).map(escapeHtml).join('; ')+'</p><details><summary>Original VPRO5 rows, aliases and numeric evidence</summary><div class="vpro-source-scroll"><table><thead><tr>'+source.headers.map(h=>'<th>'+escapeHtml(h)+'</th>').join('')+'</tr></thead><tbody>'+source.rawRows.map(r=>'<tr>'+r.map(v=>'<td>'+escapeHtml(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details></section>';
  }

  async function buildCandidate() {
    if(state.selected?.record?.technicalReview?.candidateBom?.manualDraft){await reopenCandidate();return;}
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
    if(state.selected?.record?.technicalReview?.candidateBom?.manualDraft)return '';
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
  const componentTypes = {STANDARD_COTS:'Standard / COTS',SUBASSEMBLY:'Subassembly',DNP:'DNP / Do Not Populate',OTHER:'Other',REFERENCE_ONLY:'Reference Only'};
  function componentSelect(row, index) {
    const value = componentTypes[row.componentType] ? row.componentType : 'STANDARD_COTS';
    return '<select class="candidate-component-type" aria-label="FAIR Component Type for row ' + (index + 1) + '" data-component-row="' + index + '" ' + (state.saving ? 'disabled' : '') + '>' + Object.entries(componentTypes).map(([key,label]) => '<option value="' + key + '" ' + (key === value ? 'selected' : '') + '>' + label + '</option>').join('') + '</select>';
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
      state.message = 'FAIR Component Type saved.'; state.messageState = '';
    } catch (error) { state.message = error?.message || 'FAIR Component Type could not be saved.'; state.messageState = 'error'; }
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

  function candidateBulkEnabled(bom,readOnly=false) {
    const record=state.selected?.record;
    return ['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)&&!!bom?.manualDraft&&!readOnly&&
      !state.acceptedVersion&&!completedReview(record)&&['TECHNICAL_REVIEW_IN_PROGRESS','ON_HOLD'].includes(record?.status)&&
      !(record.technicalReview?.bomAcceptances||[]).some(a=>a.candidate.id===bom.id)&&
      window.DleOsCapabilities?.can?.('technical_review.disposition')===true;
  }
  function candidateBulkState(bom) {
    const key=state.selected.record.intakeId+':'+bom.id;
    if(state.candidateBulk?.key!==key)state.candidateBulk={key,selected:new Set(),results:new Map()};
    const ids=new Set(bom.rows.map(r=>r.rowId));
    for(const id of state.candidateBulk.selected)if(!ids.has(id))state.candidateBulk.selected.delete(id);
    return state.candidateBulk;
  }
  function candidateBulkPendingIssue(bom) {
    if(candidateProgressRows().length)return 'Save Progress or cancel pending row edits before using bulk actions.';
    if(reviewUploads.length||addingDocuments)return 'Save or cancel pending file changes before using bulk actions.';
    if(bom.rows.some(r=>{const ui=rowReviewUi(r);return ui.alternateDraft||ui.approvedPartDraft||ui.identityBasisDraft;}))
      return 'Save or cancel open P/N or alternate edits before using bulk actions.';
    return '';
  }
  function candidateRowCheckbox(bom,row,index) {
    const bulk=candidateBulkState(bom);
    return '<input type="checkbox" aria-label="Select BOM row '+(index+1)+'" data-candidate-select-row="'+escapeHtml(row.rowId||'')+'" '+(bulk.selected.has(row.rowId)?'checked ':'')+(state.saving||!row.rowId?'disabled':'')+'>';
  }
  function candidateBulkRowResult(bom,row) {
    if(!candidateBulkEnabled(bom))return '';
    const result=candidateBulkState(bom).results.get(row.rowId);
    if(!result||result.token!==row.reviewState?.token)return '';
    return '<small class="candidate-bulk-row-result" data-bulk-row-status="'+escapeHtml(result.status)+'">'+escapeHtml(result.message)+'</small>';
  }
  function candidateBulkControls(bom) {
    const bulk=candidateBulkState(bom),rows=bom.rows.filter(r=>r.rowId),selected=rows.filter(r=>bulk.selected.has(r.rowId));
    const issue=candidateBulkPendingIssue(bom),disabled=state.saving||!selected.length||!!issue;
    const exceptions=selected.filter(r=>['DNP','SUBASSEMBLY'].includes(r.componentType)||r.identityBasis==='ASSEMBLY_PN');
    const eligible=selected.filter(r=>!exceptions.includes(r));
    const changed=eligible.filter(r=>r.identityBasis==='CUSTOMER_PN');
    const labels={CUSTOMER_PN:'Customer P/N',ASSEMBLY_PN:'Assembly P/N'};
    const changes=changed.slice(0,8).map(r=>'Row '+r.values.lineNumber+': '+labels[r.identityBasis]+' → Manufacturer P/N').join('; ')+(changed.length>8?'; '+(changed.length-8)+' more':'');
    const resets=eligible.filter(r=>r.reviewState?.reviewed&&!(r.sourcePartNumberReview?.current?.status==='CONFIRMED'&&r.sourcePartNumberReview.current.basis==='MFG')).length;
    return '<div class="candidate-bulk-actions"><label><input type="checkbox" data-candidate-select-all aria-label="Select all BOM rows" '+(rows.length&&selected.length===rows.length?'checked ':'')+(state.saving||!rows.length?'disabled':'')+'> Select All</label><span data-bulk-selected-count>'+selected.length+' selected</span>'+
      '<button type="button" data-technical-review-action="bulk-entered-mpn" '+(disabled?'disabled':'')+'>Use entered numbers as Manufacturer P/N</button>'+
      '<button type="button" data-technical-review-action="bulk-accept" '+(disabled?'disabled':'')+'>Accept selected</button></div>'+
      (selected.length?'<p class="candidate-bulk-notice" data-bulk-classification-notice>'+escapeHtml([changes,exceptions.length?'Rows '+exceptions.slice(0,8).map(r=>r.values.lineNumber).join(', ')+(exceptions.length>8?' and '+(exceptions.length-8)+' more':'')+': DNP / assembly identity requires individual classification review.':'',resets?resets+' accepted row'+(resets===1?' will':'s will')+' require acceptance again after classification.':'','Identity confirmation does not verify a catalog or accept the row.'].filter(Boolean).join(' '))+'</p>':'')+
      (issue?'<p class="candidate-bulk-notice" role="status">'+escapeHtml(issue)+'</p>':'');
  }
  function candidateBulkToolbar(bom,readOnly) {
    return candidateBulkEnabled(bom,readOnly)?'<div class="candidate-bulk-toolbar" data-candidate-bulk>'+candidateBulkControls(bom)+'</div>':'';
  }
  function updateCandidateBulkControls() {
    const toolbar=mount?.querySelector?.('[data-candidate-bulk]'),bom=state.selected?.record?.technicalReview?.candidateBom;
    if(!toolbar||!candidateBulkEnabled(bom))return;
    toolbar.innerHTML=candidateBulkControls(bom);
    const selected=candidateBulkState(bom).selected,rows=bom.rows.filter(r=>r.rowId);
    const all=toolbar.querySelector('[data-candidate-select-all]');
    if(all)all.indeterminate=selected.size>0&&selected.size<rows.length;
    for(const box of mount.querySelectorAll('[data-candidate-select-row]'))box.checked=selected.has(box.dataset.candidateSelectRow);
    sizeCandidateWorkbench();
  }
  function selectCandidateRows(control) {
    const bom=state.selected?.record?.technicalReview?.candidateBom;
    if(state.saving||!candidateBulkEnabled(bom))return;
    const bulk=candidateBulkState(bom),all=control.matches('[data-candidate-select-all]');
    const rows=all?bom.rows:bom.rows.filter(r=>r.rowId===control.dataset.candidateSelectRow);
    for(const row of rows)if(row.rowId){if(control.checked)bulk.selected.add(row.rowId);else bulk.selected.delete(row.rowId);}
    updateCandidateBulkControls();
  }
  async function reviewSelectedCandidateRows(action) {
    const bom=state.selected?.record?.technicalReview?.candidateBom;
    if(state.saving||!candidateBulkEnabled(bom)||!['USE_ENTERED_MPN','ACCEPT_SELECTED'].includes(action))return;
    const issue=candidateBulkPendingIssue(bom);
    if(issue){state.message=issue;state.messageState='error';renderDetail();return;}
    const bulk=candidateBulkState(bom),rows=bom.rows.filter(r=>bulk.selected.has(r.rowId));
    if(!rows.length)return;
    state.saving=true;state.message='';state.messageState='';renderDetail();
    try {
      const selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:-1,values:null,
          bulkReview:{action,rows:rows.map(r=>({rowId:r.rowId,expectedToken:r.reviewState.token}))}})});
      state.selected=selected;
      const result=selected.bulkResult,updated=selected.record.technicalReview.candidateBom;
      if(!result?.results)throw new Error('The server did not return bulk review results. Reopen the BOM to check its saved state.');
      // The preflight rejected all unsaved edits; discard clean caches after refreshing saved rows.
      clearCandidateDrafts();
      for(const outcome of result.results){
        const row=updated.rows.find(r=>r.rowId===outcome.rowId);
        bulk.results.set(outcome.rowId,{...outcome,token:row?.reviewState?.token});
        if(outcome.status!=='BLOCKED'){
          if(action==='ACCEPT_SELECTED')bulk.selected.delete(outcome.rowId);
          if(row)delete state.rowReviewUi[updated.id+':'+row.index];
        }
      }
      state.completionReadiness=null;
      const count=status=>result.results.filter(r=>r.status===status).length;
      state.message=(action==='USE_ENTERED_MPN'?count('UPDATED')+' classified as Manufacturer P/N':count('ACCEPTED')+' accepted')+
        ' · '+count('ALREADY')+' already '+(action==='USE_ENTERED_MPN'?'confirmed':'accepted')+' · '+count('BLOCKED')+' blocked.';
      state.messageState=count('BLOCKED')?'error':'';
    }catch(error){state.message=error.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }

  function candidateReviewHint(bom) {
    if(bom.preparationStatus)return bom.preparationStatus;
    if(bom.manualDraft)return 'Save edits and accept the rows, then Complete BOM Review to accept this DLE-authored BOM for RFQ.';
    const remaining=bom.rows.filter(r=>!r.reviewState?.reviewed||rowReviewUi(r).editing).length;
    const conflicts=bom.rows.filter(r=>Object.values(r.comparison||{}).includes('CONFLICT')).length;
    if(candidateProgressRows().length)return 'Save your pending row edits before final review.';
    if(remaining)return remaining+' of '+bom.rows.length+' rows need review'+(conflicts?' · '+conflicts+' with source conflicts':'')+'. Use Accept or Options on each row.';
    if(usesFinalBomReview())return 'All rows reviewed. Complete BOM Review opens the final source and document check.';
    return state.completionReadiness?.key===candidateCompletionKey()?state.completionReadiness.message:'Checking final acceptance requirements…';
  }
  function candidateCompactHeader(record,bom,accepted,fileUrl) {
    const a=record.assemblies?.[0]||{},readOnly=!!accepted||completedReview(record);
    const file=record.technicalFiles?.find(f=>f.documentId===bom.governingDocumentId);
    return '<div class="candidate-workbench-toolbar candidate-compact-toolbar">'+
      '<div class="candidate-heading"><h2 id="technicalReviewDetailTitle" tabindex="-1">'+(accepted?'BOM Review Complete':bom.manualDraft?'DLE-authored working BOM':'Candidate BOM')+'</h2><span>'+escapeHtml(record.intakeId)+' · '+escapeHtml(record.customer?.customerName||'')+'</span></div>'+
      '<div class="candidate-identity"><strong>'+escapeHtml(a.assemblyNumber)+' · Rev '+escapeHtml(a.revision)+' · Qty '+escapeHtml(a.quantity)+'</strong>'+(bom.manualDraft?'<span>'+(accepted?'DLE-authored · accepted for RFQ':'Manual entry - working draft, not released')+'</span>':'<a target="_blank" rel="noopener" href="'+fileUrl+'">'+escapeHtml(file?.name||'View source')+'</a>')+'</div>'+
      '<div class="candidate-compact-actions"><button data-technical-review-action="governing-back" '+(state.saving?'disabled':'')+'>Back to package</button><button data-technical-review-action="back" '+(state.saving?'disabled':'')+'>Close</button>'+
      (!readOnly&&bom.manualDraft?'<button data-technical-review-action="manual-bom-add-row" '+(state.saving?'disabled':'')+'>Add Row</button>':'')+
      (readOnly?'': '<button class="technical-review-secondary" data-technical-review-action="candidate-save-progress" '+(state.saving?'disabled':'')+'>Save Progress</button><button class="technical-review-primary" data-technical-review-action="complete-bom" '+((usesFinalBomReview()?finalBomEntryEnabled():candidateCompletionEnabled())?'':'disabled')+'>Complete BOM Review</button>')+'</div>'+
      '<div class="candidate-review-line"><span data-candidate-review-hint role="status">'+escapeHtml(readOnly?(bom.manualDraft&&accepted?'Accepted for RFQ — read-only.':'Accepted BOM — read-only.'):candidateReviewHint(bom))+'</span>'+
      (readOnly?'':'<span class="candidate-progress-status" data-candidate-progress-status>'+candidateProgressStatus()+'</span>')+'</div>'+
      '<div class="candidate-view-tools"><details><summary>Table options</summary><button data-technical-review-action="candidate-reset-widths">Reset Widths</button>'+(readOnly?'':'<label><input type="checkbox" data-candidate-show-dnps '+(showCandidateDnps?'checked':'')+'> Show DNPs</label>')+'</details><span class="technical-review-mobile-hint">Scroll sideways for all columns.</span></div>'+
      candidateBulkToolbar(bom,readOnly)+candidateLeavePrompt()+'</div>';
  }

  function renderCandidate(record) {
    const accepted = (record.technicalReview.bomAcceptances || []).find(a => state.acceptedVersion ? a.version === state.acceptedVersion : a.candidate.id === record.technicalReview.candidateBom?.id);
    const bom = accepted?.candidate || record.technicalReview.candidateBom;
    const fileUrl = '/api/sim/rfq-intakes/' + encodeURIComponent(record.intakeId) + '/documents/' + encodeURIComponent(bom.governingDocumentId) + '#page=' + bom.page;
    const entries=bom.rows.map((row,index)=>({row,index}));
    const sourceOnly=(bom.reviewedScanSource?.worksheet?.rows||[]).filter(r=>r.rowType==='CONTINUATION');
    for(const source of sourceOnly)entries.push({source});
    const sourcePositions=new Map((bom.reviewedScanSource?.worksheet?.rows||[]).map(r=>['scan-'+bom.reviewedScanSource.worksheet.id+'-'+r.position,r.position]));
    if(sourceOnly.length)entries.sort((a,b)=>(a.source?.position??sourcePositions.get(a.row.rowId)??a.index)-(b.source?.position??sourcePositions.get(b.row.rowId)??b.index));
    const pieceGroups=new Map((bom.preparationGroups||[]).flatMap(g=>g.pieces.map(p=>[p.rowId,g])));
    const groupedEntries=entries.filter(e=>!e.row||!pieceGroups.has(e.row.rowId)).flatMap(e=>{const g=e.row&&preparationGroup(bom,e.row);return g?[e,...g.pieces.map(p=>entries.find(x=>x.row?.rowId===p.rowId)).filter(Boolean)]:[e];});
    const rows = groupedEntries.map(({row,index,source}) => {
      if(row&&pieceGroups.has(row.rowId)&&!state.preparationExpanded?.[pieceGroups.get(row.rowId).id])return '';
      if(bom.manualDraft)return manualRow(row,index,!!accepted||completedReview(record),bom);
      if(source)return '<tr data-candidate-dnp'+(showCandidateDnps?'':' hidden')+'><td class="candidate-line">'+escapeHtml(source.cells?.FIND_NUMBER?.value||'—')+'</td><td colspan="8">Resolved continuation · Source evidence only · <a target="_blank" rel="noopener" href="'+fileUrl.split('#')[0]+'#page='+source.page+'">View source · Page '+source.page+'</a></td></tr>';
      const unusedSource=['NOT_USED','BLANK'].includes(row.sourcePositionKind)||(row.sourcePositionKind==='OTHER'&&!row.manufacturerIdentity?.proposals?.some(p=>p.partNumber?.trim()&&p.partNumber.trim()!=='-')&&!row.values.partNumber?.trim());
      const dnpVisibility=!accepted&&!completedReview(record)&&(row.componentType==='DNP'||unusedSource&&!row.reviewState?.reviewed)?' data-candidate-dnp'+(showCandidateDnps?'':' hidden'):'';
      const status = candidateStatus(row);
      const expanded = state.candidateIndex === index && state.candidateInlineRow !== index && state.rowOption !== 'closed';
      const conflict = status !== 'Conflict' && Object.values(row.comparison || {}).includes('CONFLICT');
      const readOnly=!!accepted||completedReview(record), ui=rowReviewUi(row), locked=readOnly||row.reviewState?.reviewed&&!ui.editing;
      const type=ui.componentType||row.componentType||'STANDARD_COTS';
      const sectionSelector=(panel,label)=>'<button type="button" class="candidate-section-selector" aria-label="'+label+'" aria-expanded="'+(expanded&&(state.rowOption||'edit')===panel)+'" aria-controls="candidate-detail-'+index+'" data-technical-review-action="worksheet-options" data-candidate-row="'+index+'" data-panel="'+panel+'">'+label+'</button>';
      const pendingAlternates=(row.alternates||[]).filter(a=>!a.removedAtUtc&&!['CONFIRMED','APPROVED','NOT_APPROVED'].includes(a.reviewStatus));
      const alternateAction=!locked&&(row.alternates||[]).some(a=>!a.removedAtUtc)?sectionSelector('alternates',pendingAlternates.length?'Review alternates':'Alternates reviewed').replace('candidate-section-selector','candidate-alternate-shortcut')+'<small>'+escapeHtml(pendingAlternates.length?pendingAlternates.length+' awaiting decision':'Decisions saved')+'</small>':'';
      const preparationOption=bom.preparationAvailable&&!readOnly&&row.rowId&&!pieceGroups.has(row.rowId)?sectionSelector('preparation','Preparation / cut pieces'):'';
      const options='<details class="candidate-options"><summary>Options</summary>'+preparationOption+['edit','approved-pns','files','history'].map((panel,i)=>sectionSelector(panel,['BOM Fields','Approved P/Ns','Technical Files','Source / Evidence'][i])).join('')+'<details class="candidate-advanced"><summary>Advanced</summary>'+sectionSelector('alternates','Technical Alternates')+'</details></details>';
      return '<tr'+dnpVisibility+' data-worksheet-row="'+index+'" class="'+(locked?'candidate-row-locked':'')+'"><td class="candidate-line">'+escapeHtml(row.values.lineNumber||'—')+'</td><td class="candidate-row-controls"><span class="candidate-status" data-status="'+status+'">'+(locked?'Accepted':'Needs Review')+'</span>'+(!readOnly?'<button data-technical-review-action="'+(locked?'candidate-row-edit':'worksheet-accept')+'" data-panel="edit" data-candidate-row="'+index+'" '+(state.saving?'disabled':'')+'>'+(locked?'Edit':'Accept')+'</button>':'')+alternateAction+'</td><td class="candidate-part">'+escapeHtml(row.values.partNumber||'—')+preparationBadge(bom,row,index)+(pieceGroups.has(row.rowId)?'<small class="preparation-piece-label">'+escapeHtml('Piece of customer Find '+pieceGroups.get(row.rowId).customerFind+' · '+(pieceGroups.get(row.rowId).pieces.find(p=>p.rowId===row.rowId).method==='MAKE_FROM_STOCK'?'Make from stock':'Buy precut'))+'</small>':'')+renderSourcePartNumber(row,index,locked,record)+((row.alternates||[]).some(a=>!a.removedAtUtc)?'<div class="candidate-alternate-numbers" aria-label="Alternate part numbers"><small>Alternates</small>'+row.alternates.filter(a=>!a.removedAtUtc).map(a=>'<div>'+escapeHtml(a.partNumber)+' <small>'+escapeHtml(a.reviewStatus==='NOT_APPROVED'?'Not Approved':['APPROVED','CONFIRMED'].includes(a.reviewStatus)?'Approved':'Awaiting review')+'</small></div>').join('')+'</div>':'')+'</td><td tabindex="0" data-candidate-copy="'+index+'" aria-label="Approved P/N for row '+(index+1)+'; Ctrl+C to copy">'+worksheetIdentity(row,index,locked,type)+'</td>'+candidateDescriptionCell(row,index,locked)+'<td>'+escapeHtml(row.values.quantity||'—')+'</td><td>'+(locked?escapeHtml(componentTypes[type]):'<select aria-label="FAIR Component Type for row '+(index+1)+'" data-worksheet-field="componentType" data-worksheet-row="'+index+'">'+Object.entries(componentTypes).map(([key,label])=>'<option value="'+key+'" '+(key===type?'selected':'')+'>'+label+'</option>').join('')+'</select>')+'</td>'+candidateDescriptionCell(row,index,locked,'designators')+'<td>'+options+'</td></tr>'+
        (candidateLeavePrompt(index)?'<tr class="candidate-detail-row candidate-inline-guard"><td colspan="9">'+candidateLeavePrompt(index)+'</td></tr>':'')+
        (expanded?'<tr'+dnpVisibility+' class="candidate-detail-row'+(state.rowOption==='alternates'?' candidate-alternate-detail':'')+'"><td colspan="9"><section id="candidate-detail-'+index+'" aria-label="Row '+(index+1)+' details">'+renderCandidateInspector(bom,row,index,readOnly)+'</section></td></tr>':'');
    }).join('');
    if(['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)){
    return '<section class="technical-review-question technical-review-candidate candidate-workbench">'+candidateCompactHeader(record,bom,accepted,fileUrl)+
      '<p class="technical-review-message candidate-message" role="status">'+escapeHtml(state.message)+'</p>'+
      '<div class="candidate-table-scroll" role="region" aria-label="BOM worksheet, horizontally scrollable" tabindex="0" data-candidate-id="'+escapeHtml(bom.id||'')+'"><table class="candidate-table candidate-workbench-table" style="width:'+candidateColumns.reduce((n,c)=>n+candidateColumnWidth(c[0]),0)+'px;--candidate-line-width:'+candidateColumnWidth('line')+'px"><caption class="candidate-sr-only">Candidate BOM rows for human review</caption><colgroup>'+candidateColumns.map(c=>'<col data-candidate-column="'+c[0]+'" style="width:'+candidateColumnWidth(c[0])+'px">').join('')+'</colgroup><thead><tr>'+candidateColumns.map(c=>candidateColumnHeader(c[0],c[1])).join('')+'</tr></thead><tbody>' + rows + '</tbody></table></div>'+
      '<div class="candidate-workbench-footer"><details class="candidate-provenance" data-candidate-panel="provenance" '+(state.candidatePanels?.provenance?'open':'')+'><summary>Source details &amp; review history</summary>'+renderVproEvidence(bom)+candidateReviewerSummary(bom)+'<p>'+escapeHtml(bom.analysis?.coverageReason||bom.supportingComparison)+'</p><p>'+(record.technicalReview.candidateBomVersions||[]).length+' prior versions preserved.</p>'+renderOriginalCustomerRequest(record)+'</details>'+acceptedLinks(record)+'</div></section>';
    }
    return '<section class="technical-review-question technical-review-candidate candidate-workbench"><div class="candidate-workbench-toolbar">' + (record.technicalReview?.workflow && !completedReview(record) ? '<button class="technical-review-back" data-technical-review-action="governing-back">← Back to Technical Package Review</button>' : '') + '<h3>' + (accepted ? 'BOM Review Complete' : 'Candidate BOM') + '</h3>' + (accepted ? '<p>Accepted BOM version ' + accepted.version + '.</p>' + (completedReview(record) ? '<p>Technical Review complete · Read-only</p>' : record.technicalReview.materialsReviewStatus === 'QUALIFIED' ? (record.technicalReview.workflow ? '<p>Return to Technical Package Review to submit to RFQs</p>' : '<p>Next: Manufacturing / Labor Review</p>') : '<p>Historical acceptance. The current source package or candidate requires a new BOM review.</p>') : '') + '<p class="candidate-summary">' + bom.rows.length + ' review rows'+(sourceOnly.length?' · '+sourceOnly.length+' source-only':'')+'</p>' +
      renderVproEvidence(bom) + renderVproDecisions(bom) + candidateReviewerSummary(bom) + (accepted ? '<p>RFQ materials acceptance only. This is not a production release.</p>' : '<p class="candidate-review-note">Review the BOM below and confirm the part information before approval.</p>') + '<a href="' + fileUrl + '" target="_blank" rel="noopener">View source · Page ' + bom.page + '</a>' +
      (accepted||completedReview(record)?'':'<button type="button" class="technical-review-primary" data-technical-review-action="candidate-save-progress" '+(state.saving?'disabled':'')+'>Save Progress</button><span class="candidate-progress-status" role="status" data-candidate-progress-status>'+candidateProgressStatus()+'</span>')+'<button type="button" data-technical-review-action="candidate-reset-widths">Reset Widths</button>'+(accepted||completedReview(record)?'':'<label class="candidate-dnp-toggle"><input type="checkbox" data-candidate-show-dnps '+(showCandidateDnps?'checked':'')+'> Show DNPs</label>')+candidateLeavePrompt()+'</div><p class="technical-review-mobile-hint">Swipe the BOM table sideways to reach all columns and row options.</p><div class="candidate-table-scroll" role="region" aria-label="BOM worksheet, horizontally scrollable" tabindex="0" data-candidate-id="'+escapeHtml(bom.id||'')+'" role="region" aria-label="Candidate BOM table" tabindex="0"><table class="candidate-table candidate-workbench-table" style="width:'+candidateColumns.reduce((n,c)=>n+candidateColumnWidth(c[0]),0)+'px;--candidate-line-width:'+candidateColumnWidth('line')+'px"><caption class="candidate-sr-only">Candidate BOM rows for human review</caption><colgroup>'+candidateColumns.map(c=>'<col data-candidate-column="'+c[0]+'" style="width:'+candidateColumnWidth(c[0])+'px">').join('')+'</colgroup><thead><tr>'+candidateColumns.map(c=>candidateColumnHeader(c[0],c[1])).join('')+'</tr></thead><tbody>' + rows + '</tbody></table></div><div class="candidate-workbench-footer">' +
      '<p class="technical-review-message" role="status">' + escapeHtml(state.message) + '</p><details class="candidate-analysis-details"><summary>Details</summary><p>' + escapeHtml(bom.analysis?.coverageReason || bom.supportingComparison) + '</p><p>' + (record.technicalReview.candidateBomVersions || []).length + ' prior versions preserved. No canonical BOM or downstream work is created.</p></details>' + acceptedLinks(record) + (completedReview(record) ? '' : '<div class="candidate-editor-actions">' + (record.technicalReview?.workflow ? '' : '<button class="technical-review-back" data-technical-review-action="governing-back">← Back to Technical Package Review</button>') + (!accepted ? '<button class="technical-review-primary" data-technical-review-action="complete-bom" ' + (candidateCompletionEnabled() ? '' : 'disabled') + '>Complete BOM Review</button>' : '') + '</div>') + '</div></section>';
  }
  function candidateCompletionKey() { return JSON.stringify(state.selected?.record?.technicalReview?.candidateBom); }
  function candidateCompletionEnabled() {
    const bom=state.selected?.record?.technicalReview?.candidateBom;
    return !state.saving && !!bom?.rows?.length && bom.rows.every(r=>r.reviewState?.reviewed&&!rowReviewUi(r).editing) &&
      !candidateProgressRows().length && state.completionReadiness?.key===candidateCompletionKey() && state.completionReadiness.ready===true;
  }
  function updateCandidateCompletionButton() {
    const button=mount?.querySelector?.('[data-technical-review-action="complete-bom"]');if(!button)return;
    const hint=mount?.querySelector('[data-candidate-review-hint]');if(hint)hint.textContent=candidateReviewHint(state.selected.record.technicalReview.candidateBom);
    button.disabled=!(usesFinalBomReview()?finalBomEntryEnabled():candidateCompletionEnabled());
    if(usesFinalBomReview()){button.title=button.disabled?'Save edits and accept every row before final review.':'Review the source and documents, then confirm acceptance.';return;}
    button.title=button.disabled?(state.completionReadiness?.message||'Accept every required row before completing BOM Review.'):'Complete BOM Review';
  }
  async function checkCandidateCompletion() {
    if(usesFinalBomReview())return;
    if(state.step!=='candidate'||state.acceptedVersion||completedReview(state.selected?.record))return;
    const bom=state.selected?.record?.technicalReview?.candidateBom;
    updateCandidateCompletionButton();
    if(state.saving||!bom?.rows?.length||!bom.rows.every(r=>r.reviewState?.reviewed&&!rowReviewUi(r).editing)||candidateProgressRows().length)return;
    const key=candidateCompletionKey();if(state.completionReadiness?.key===key)return;
    state.completionReadiness={key,ready:false,message:'Checking completion readiness…'};
    try {
      const result=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/bom-completion-readiness',
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate:bom})});
      if(candidateCompletionKey()===key)state.completionReadiness={key,ready:result.ready===true,message:result.message};
    } catch(error){if(candidateCompletionKey()===key)state.completionReadiness={key,ready:false,message:error.message};}
    updateCandidateCompletionButton();
  }
  async function reopenCandidate() {
    if(state.saving)return;
    state.saving=true;
    try {
      const latest=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId));
      state.selected=latest;state.completionReadiness=null;clearCandidateDrafts();state.candidateLeaveIntent=null;
      state.message='';state.messageState='';state.candidateIndex=null;state.step='candidate';state.materials=false;
    } catch(error){state.message=error.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }
  function candidateProgressRows() {
    const bom=state.selected?.record?.technicalReview?.candidateBom;if(!bom||state.acceptedVersion||completedReview(state.selected.record))return [];
    return bom.rows.flatMap((row,index)=>{
      const ui=rowReviewUi(row),working=row.workingState||{};
      let values=ui.manualValues||(state.candidateIndex===index&&state.candidateDraft?state.candidateDraft:row.values);
      const input=mount?.querySelector?.('[data-inline-description="'+index+'"]');if(input)values={...values,[input.dataset.candidateField||'description']:input.value};
      const type=ui.componentType||row.componentType||'STANDARD_COTS';
      if(type==='DNP'&&row.componentType!=='DNP')values={...values,description:'DO NOT POPULATE'};
      const assembly=ui.assemblyNumber??working.assemblyPartNumber??row.assemblyIdentity?.partNumber;
      const manual=ui.manualNumber??working.manualPartNumber, maker=ui.manualMaker??working.manufacturerName;
      const primaryAllowed=type!=='DNP'&&!assemblyIdentityRoute(row,type);
      const changed=Object.keys(candidateFields).some(k=>values[k]!==row.values[k])||type!==(row.componentType||'STANDARD_COTS')||
        (assembly??'')!==(working.assemblyPartNumber??row.assemblyIdentity?.partNumber??'')||(manual??'')!==(working.manualPartNumber??'')||(maker??'')!==(working.manufacturerName??'')||
        (ui.editing&&row.reviewState?.reviewed)||primaryAllowed&&(approvedPartDirty(row)||!!ui.identityBasisDraft);
      return changed?[{rowIndex:index,expectedToken:row.reviewState.token,values:Object.fromEntries(Object.keys(candidateFields).map(k=>[k,values[k]])),componentType:type,assemblyPartNumber:assembly,manualPartNumber:!primaryAllowed||ui.identityBasisDraft?null:manual,manufacturerName:!primaryAllowed||ui.identityBasisDraft?null:maker,...(primaryAllowed&&ui.identityBasisDraft?{identityBasisChange:{...ui.identityBasisDraft,expectedToken:row.reviewState.token}}:{}),...(primaryAllowed&&approvedPartDirty(row)?{approvedPartChange:{...ui.approvedPartDraft,expectedToken:row.reviewState.token}}:{})}]:[];
    });
  }
  function candidateProgressStatus() {
    if(state.saving)return 'Saving…';
    if(candidateProgressRows().length)return 'Unsaved changes';
    const stamp=state.selected?.record?.technicalReview?.candidateBom?.progress;
    return stamp?'Saved by '+escapeHtml(stamp.savedBy)+' · '+escapeHtml(formatDateTime(stamp.savedAtUtc)):'No unsaved changes';
  }
  function updateCandidateProgressStatus() {
    const label=mount?.querySelector?.('[data-candidate-progress-status]');if(label)label.innerHTML=candidateProgressStatus();
    updateCandidateCompletionButton();
    updateCandidateBulkControls();
  }
  function clearCandidateDrafts() {state.candidateDraft=null;state.candidateInlineRow=null;state.inlineDescriptionDirty=false;state.rowReviewUi={};}
  function candidateLeavePrompt(inlineRow=null) {
    const intent=state.candidateLeaveIntent;if(!intent)return '';
    const inline=intent.technicalReviewAction==='worksheet-options';if(inline?(inlineRow!==Number(intent.candidateRow)):inlineRow!==null)return ''; 
    const switching=intent.technicalReviewAction==='worksheet-options',alternates=switching&&intent.panel==='alternates';
    const row=state.selected?.record?.technicalReview?.candidateBom?.rows[state.candidateIndex];
    return '<div class="scan-leave-prompt candidate-leave-prompt" data-candidate-leave-prompt tabindex="-1" role="group" aria-label="Unsaved candidate edits"><p>You have unsaved edits'+(row?' on Line '+escapeHtml(row.values.lineNumber):'')+'. '+(alternates?'Save those edits before opening the alternate review. Saving progress does not accept the row.':'Choose whether to save before continuing.')+'</p><button data-technical-review-action="candidate-leave-save">'+(alternates?'Save Progress &amp; Review Alternates':switching?'Save Progress &amp; Continue':'Save &amp; Leave')+'</button> <button data-technical-review-action="candidate-leave-discard">'+(switching?'Discard unsaved edits &amp; Continue':'Leave Without Saving')+'</button> <button data-technical-review-action="candidate-leave-cancel">Keep Editing</button></div>';
  }
  function continueCandidateAction(intent) {
    if(!intent)return;
    // Reuse the existing action routing and guards after the leave decision.
    const button=document.createElement('button');Object.assign(button.dataset,intent);button.hidden=true;mount.append(button);button.click();button.remove();
  }
  async function saveCandidateProgress(leave=false,onlyIndex=null) {
    if(state.saving||state.acceptedVersion||completedReview(state.selected?.record))return;
    const bom=state.selected.record.technicalReview.candidateBom,rows=candidateProgressRows().filter(r=>onlyIndex===null||r.rowIndex===onlyIndex),intent=state.candidateLeaveIntent;
    // Capture the active inline input before disabling the workbench.
    if(state.candidateIndex!=null){const input=mount?.querySelector?.('[data-inline-description="'+state.candidateIndex+'"]');if(input)state.candidateDraft={...(state.candidateDraft||bom.rows[state.candidateIndex].values),[input.dataset.candidateField||'description']:input.value};}
    state.saving=true;renderDetail();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:-1,values:null,progressRows:rows})});
      if(onlyIndex===null)clearCandidateDrafts();else{delete state.rowReviewUi[bom.id+':'+onlyIndex];if(state.candidateIndex===onlyIndex){state.candidateDraft=null;state.candidateInlineRow=null;state.inlineDescriptionDirty=false;}}state.candidateLeaveIntent=null;state.message=onlyIndex===null?'Progress saved. Candidate review is not complete.':'Assembly P/N changes saved. Accept the row to confirm.';state.messageState='';
      state.saving=false;renderDetail();if(leave)continueCandidateAction(intent);
    } catch(error){state.message=error.message;state.messageState='error';state.saving=false;renderDetail();}
  }
  function candidateDescriptionCell(row,index,locked,field="description") {
    const label=field==='description'?'Description':'Ref Des';
    const value=field==='description'&&rowReviewUi(row).componentType==='DNP'&&row.componentType!=='DNP'?'DO NOT POPULATE':state.candidateIndex===index&&state.candidateDraft?state.candidateDraft[field]:row.values[field];
    const pending=state.candidateIndex===index&&state.inlineDescriptionDirty&&state.candidateDraft?.[field]!==row.values[field];
    return '<td tabindex="0" data-candidate-'+field+'="'+index+'" data-candidate-field="'+field+'" data-description-locked="'+locked+'" aria-label="'+label+' for row '+(index+1)+'" title="'+(locked?'Use row Edit to unlock':'Double-click or press F2 to edit; Enter commits; Save Progress or Accept saves')+'"><span>'+escapeHtml(value||'—')+'</span>'+(pending?'<small class="candidate-description-pending">Unsaved · Save Progress or Accept</small>':'')+'</td>';
  }
  function selectCandidateCell(event) {
    const cell=event.target.closest?.('[data-candidate-description], [data-candidate-designators], [data-candidate-copy]');if(!cell)return;
    mount.querySelectorAll('.candidate-cell-selected').forEach(c=>c.classList.remove('candidate-cell-selected'));
    cell.classList.add('candidate-cell-selected');
    if(!event.target.closest('input,select,button,a,summary'))cell.focus({preventScroll:true});
  }
  function beginCandidateDescriptionEdit(event) {
    const cell=event.target.closest?.('[data-candidate-description], [data-candidate-designators]');
    if(!cell||cell.dataset.descriptionLocked==='true'||state.saving||cell.querySelector('input')||completedReview(state.selected?.record)||state.acceptedVersion)return;
    const field=cell.dataset.candidateField||'description',index=Number(cell.dataset.candidateDescription??cell.dataset.candidateDesignators);
    if(state.inlineDescriptionDirty&&state.candidateIndex!==index){state.message='Save Progress or Accept the pending edit before editing another row.';renderDetail();return;}
    const row=state.selected.record.technicalReview.candidateBom.rows[index];
    const value=field==='description'&&rowReviewUi(row).componentType==='DNP'&&row.componentType!=='DNP'?'DO NOT POPULATE':state.candidateIndex===index&&state.candidateDraft?state.candidateDraft[field]:row.values[field];
    cell.innerHTML='<input class="candidate-description-input" data-inline-description="'+index+'" data-candidate-field="'+field+'" aria-label="Edit '+(field==='description'?'Description':'Ref Des')+' for row '+(index+1)+'" maxlength="2000" value="'+escapeHtml(value)+'">';
    const input=cell.querySelector('input');input.focus({preventScroll:true});input.select();
  }
  function candidateDescriptionKey(event) {
    const input=event.target.closest?.('[data-inline-description]');
    if(!input){if(event.key==='F2'&&event.target.matches?.('[data-candidate-description], [data-candidate-designators]')){event.preventDefault();beginCandidateDescriptionEdit(event);}return;}
    if(event.isComposing||!['Enter','Escape'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const field=input.dataset.candidateField||'description',index=Number(input.dataset.inlineDescription),row=state.selected.record.technicalReview.candidateBom.rows[index],cell=input.closest('td');
    if(event.key==='Enter'){
      const draft=state.candidateIndex===index&&state.candidateDraft?state.candidateDraft:row.values;
      state.candidateDraft=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,k===field?input.value:draft[k]]));state.candidateIndex=index;state.candidateInlineRow=index;
      state.inlineDescriptionDirty=Object.keys(candidateFields).some(k=>state.candidateDraft[k]!==row.values[k]);
    }
    input.dataset.finishing='true';
    cell.outerHTML=candidateDescriptionCell(row,index,false,field);
    const restored=mount.querySelector('[data-candidate-'+field+'="'+index+'"]');restored.classList.add('candidate-cell-selected');if(event.type!=='focusout')restored.focus({preventScroll:true});updateCandidateProgressStatus();
  }
  function copyCandidatePartNumber(event) {
    // Text selections and input editing retain native clipboard behavior.
    if(event.target.closest?.('input,textarea')||window.getSelection?.()?.toString())return;
    const cell=event.target.closest?.('[data-candidate-copy]');if(!cell||!event.clipboardData)return;
    const value=cell.querySelector('[data-approved-part]')?.textContent;
    if(value&&value!=='Not resolved'&&value!=='—'){event.preventDefault();event.clipboardData.setData('text/plain',value);}
  }
  const candidateDisplayPreference='dle.candidate-bom.display-choices.v1';
  let candidateDisplayChoices=null;
  function candidateDisplayKey(row) { return (state.selected?.record?.intakeId||'')+':'+(state.selected?.record?.technicalReview?.candidateBom?.id||'')+':'+row.index; }
  function loadCandidateDisplayChoices() {
    if(candidateDisplayChoices!==null)return;
    try{candidateDisplayChoices=JSON.parse(window.localStorage?.getItem(candidateDisplayPreference)||'{}');}catch{candidateDisplayChoices={};}
    if(!candidateDisplayChoices||typeof candidateDisplayChoices!=='object'||Array.isArray(candidateDisplayChoices))candidateDisplayChoices={};
  }
  function rememberCandidateDisplayChoice(row,id) {
    loadCandidateDisplayChoices();
    const proposal=row.manufacturerIdentity?.proposals?.find(p=>p.id===id);
    if(proposal)candidateDisplayChoices[candidateDisplayKey(row)]={id,partNumber:proposal.partNumber,manufacturerName:proposal.manufacturerName};
    else delete candidateDisplayChoices[candidateDisplayKey(row)];
    try{window.localStorage?.setItem(candidateDisplayPreference,JSON.stringify(candidateDisplayChoices));}catch{/* Session-only preference if storage is unavailable. */}
  }
  function preferredCandidateDisplay(row,eligible) {
    loadCandidateDisplayChoices();const saved=candidateDisplayChoices[candidateDisplayKey(row)];
    if(!saved)return null;
    return eligible.find(p=>p.id===saved.id)||eligible.find(p=>p.partNumber===saved.partNumber&&p.manufacturerName===saved.manufacturerName)||null;
  }
  function candidateIdentityChoice(number,count,content,open=false) {
    const value='<span data-approved-part>'+escapeHtml(number||'Not resolved')+'</span>';
    return '<details class="candidate-identity-choice" '+(open?'open':'')+'><summary title="Inspect or change candidate identity">'+value+(count>1?' <small aria-label="'+(count-1)+' more manufacturer identities">▾ +'+(count-1)+'</small>':'')+'</summary><div class="candidate-identity-controls">'+content+'</div></details>';
  }
  function approvedPartDirty(row) {
    const draft=rowReviewUi(row).approvedPartDraft;if(!draft)return false;
    const original=currentCandidateIdentities(row).find(p=>p.id===draft.id);
    return draft.partNumber!==(original?.partNumber||'')||draft.manufacturerName!==(original?.manufacturerName||'');
  }
  function sourcePartNumberDefault(record=state.selected?.record) {
    const review=record?.technicalReview||{},bom=review.candidateBom||{};
    const basis=bom.analysis?.sourceSnapshot?.sources?.find(s=>s.documentId===bom.governingDocumentId)?.profile?.partNumberContext?.basis
      ??review.technicalPackage?.documents?.find(d=>d.documentId===bom.governingDocumentId)?.partNumberReview?.basis;
    return basis==='MANUFACTURER'?'MFG':basis==='CUSTOMER_INTERNAL'?'CUSTOMER':'UNRESOLVED';
  }
  function renderSourcePartNumber(row,index,locked,record=state.selected?.record) {
    if(row.componentType==='DNP')return '';
    const current=row.sourcePartNumberReview?.current,ui=rowReviewUi(row);
    if(locked&&!current)return row.componentType==='SUBASSEMBLY'?'<small>Assembly P/N approval</small>':'';
    const existing=!current&&(row.primaryIdentity||row.assemblyIdentity||currentCandidateIdentities(row).some(p=>manufacturerDecision(row.manufacturerIdentity,p.id)==='CONFIRMED'));
    const basis=ui.sourcePnBasis??current?.basis??(existing?'UNRESOLVED':sourcePartNumberDefault(record));
    const status=current?.status==='CONFIRMED'?'confirmed':['INVALIDATED','OVERRIDDEN'].includes(current?.status)?'review required':existing?'existing identity retained':basis==='UNRESOLVED'?'unresolved':'inherited';
    if(locked)return '<small>'+escapeHtml(basis+' · '+status)+'</small>';
    const labels={MFG:'Manufacturer P/N',CUSTOMER:'Customer P/N',ASSEMBLY:'Assembly P/N',UNRESOLVED:'Unresolved'};
    const label=basis==='UNRESOLVED'?'unresolved':basis+' · '+status;
    const id='source-pn-editor-'+index;
    return '<div class="source-pn-review"><button class="source-pn-badge" type="button" data-technical-review-action="source-pn-open" data-source-pn-target="'+id+'" title="'+escapeHtml(status)+'" aria-haspopup="dialog" aria-controls="'+id+'" aria-label="Source P/N basis for row '+(index+1)+': '+escapeHtml(label)+'" '+(state.saving?'disabled':'')+'>'+escapeHtml(label)+' <span aria-hidden="true">▾</span></button><div id="'+id+'" class="source-pn-popover" popover="auto" role="dialog" aria-label="Review source P/N identity"><label>P/N Basis<select aria-label="Source P/N basis for row '+(index+1)+'" data-source-pn-basis="'+index+'" '+(state.saving?'disabled':'')+'>'+Object.entries(labels).map(([key,text])=>'<option value="'+key+'" '+(key===basis?'selected':'')+'>'+text+'</option>').join('')+'</select></label><dl><dt>Source</dt><dd>'+escapeHtml(row.values.partNumber)+'</dd><dt>Result</dt><dd data-source-pn-result>'+escapeHtml(sourcePartNumberResult(basis,row.values.partNumber))+'</dd></dl><button class="source-pn-confirm" data-technical-review-action="source-pn-confirm" data-candidate-row="'+index+'" '+(state.saving?'disabled':'')+'>'+(basis==='UNRESOLVED'?'Mark P/N Unresolved':'Confirm P/N Identity')+'</button><details class="source-pn-help"><summary>Why?</summary><p>Confirm what the supplied identifier represents. Identity confirmation does not accept the row. Assembly P/N does not establish customer or manufacturer ownership.</p></details></div></div>';
  }
  function sourcePartNumberResult(basis,number) {
    return basis==='UNRESOLVED'?'No approved identity':'Approved P/N → '+number;
  }
  function openSourcePartNumber(button) {
    const panel=document.getElementById(button.dataset.sourcePnTarget);
    if(!panel||state.saving)return;
    if(panel.matches(':popover-open')){panel.hidePopover();return;}
    panel.showPopover({source:button});
    const place=()=>{
      const anchor=button.getBoundingClientRect(),box=panel.getBoundingClientRect(),gap=6,edge=8;
      panel.style.left=Math.max(edge,Math.min(anchor.left,window.innerWidth-box.width-edge))+'px';
      const below=anchor.bottom+gap;
      panel.style.top=Math.max(edge,Math.min(below+box.height<=window.innerHeight-edge?below:anchor.top-box.height-gap,window.innerHeight-box.height-edge))+'px';
    };
    place();panel.querySelector('select').focus({preventScroll:true});
    // Keep the overlay anchored without changing table geometry. Native popover handles Escape/light dismissal.
    window.addEventListener('resize',place);
    document.addEventListener('scroll',place,true);
    panel.addEventListener('toggle',function closed(event){if(event.newState==='closed'){
      window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);panel.querySelector('.source-pn-help').removeEventListener('toggle',place);panel.removeEventListener('toggle',closed);
    }});
    panel.querySelector('.source-pn-help').addEventListener('toggle',place);
  }

  async function confirmSourcePartNumber(button) {
    if(state.saving||state.acceptedVersion||completedReview(state.selected?.record))return;
    const bom=state.selected.record.technicalReview.candidateBom,index=Number(button.dataset.candidateRow),row=bom.rows[index],ui=rowReviewUi(row);
    if(row.reviewState?.reviewed&&!ui.editing)return;
    if(candidateProgressRows().some(e=>e.rowIndex!==index||Object.keys(candidateFields).some(k=>e.values[k]!==row.values[k])||e.componentType!==row.componentType||e.manualPartNumber||e.approvedPartChange||e.identityBasisChange)){state.message='Save or cancel pending row edits before confirming source P/N identity.';state.messageState='error';renderDetail();return;}
    const existing=!row.sourcePartNumberReview&&(row.primaryIdentity||row.assemblyIdentity||currentCandidateIdentities(row).some(p=>manufacturerDecision(row.manufacturerIdentity,p.id)==='CONFIRMED'));
    const basis=ui.sourcePnBasis??row.sourcePartNumberReview?.current?.basis??(existing?'UNRESOLVED':sourcePartNumberDefault());
    state.saving=true;state.message='';renderDetail();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:index,values:null,sourcePartNumberChange:{basis,expectedToken:row.reviewState.token}})});
      delete state.rowReviewUi[bom.id+':'+index];
      state.message=basis==='UNRESOLVED'?'P/N marked unresolved. Row remains unaccepted.':'P/N identity confirmed. Review and Accept the row separately.';state.messageState='';
    }catch(error){state.message=error.message;state.messageState='error';}finally{state.saving=false;renderDetail();}
  }
  function sourceIdentityConfirmed(row){return row.sourcePartNumberReview?.current?.status==='CONFIRMED';}
  function assemblyIdentityRoute(row,type=row.componentType){return sourceIdentityConfirmed(row)?row.sourcePartNumberReview.current.basis==='ASSEMBLY':row.sourcePartNumberReview&&row.primaryIdentity?row.primaryIdentity.basis==='ASSEMBLY_PN':type==='SUBASSEMBLY';}
  function customerIdentity(row){return row.componentType!=='DNP'&&(sourceIdentityConfirmed(row)?row.sourcePartNumberReview.current.basis==='CUSTOMER':(row.componentType!=='SUBASSEMBLY'||row.sourcePartNumberReview)&&row.primaryIdentity?.basis==='CUSTOMER_PN');}
  async function identityBasisAction(action,button){
    if(state.saving||state.acceptedVersion||completedReview(state.selected?.record))return;
    const bom=state.selected.record.technicalReview.candidateBom,index=Number(button.dataset.candidateRow),row=bom.rows[index],ui=rowReviewUi(row);
    if((ui.componentType||row.componentType)==='DNP'||((ui.componentType||row.componentType)==='SUBASSEMBLY'&&!row.sourcePartNumberReview)||(state.selected.record.technicalReview.bomAcceptances||[]).some(a=>a.candidate.id===bom.id))return;
    if(action==='identity-basis-cancel'){delete ui.identityBasisDraft;renderDetail();return;}
    if(action==='identity-basis-customer'||action==='identity-basis-manufacturer'){
      if(approvedPartDirty(row)){state.message='Save or cancel the current P/N edit first.';renderDetail();return;}
      ui.identityBasisDraft={basis:action==='identity-basis-customer'?'CUSTOMER_PN':'MANUFACTURER_PN',partNumber:action==='identity-basis-customer'?(row.primaryIdentity?.partNumber||row.values.partNumber):null};
      renderDetail();return;
    }
    if(action!=='identity-basis-save'||!ui.identityBasisDraft)return;
    if(state.candidateDraft&&state.candidateDraft.partNumber!==row.values.partNumber||ui.componentType&&ui.componentType!==row.componentType){state.message='Save BOM P/N or type changes before changing identity basis.';renderDetail();return;}
    state.saving=true;state.message='';renderDetail();
    try{state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:index,values:null,identityBasisChange:{...ui.identityBasisDraft,expectedToken:row.reviewState.token}})});delete ui.identityBasisDraft;delete ui.approvedPartDraft;delete ui.primaryChoice;delete ui.manualNumber;delete ui.manualMaker;state.message='Identity saved. Review and Accept the row.';state.messageState='';}
    catch(error){state.message=error.message;state.messageState='error';}finally{state.saving=false;renderDetail();}
  }
  function renderIdentityBasis(row,index,readOnly){
    const ui=rowReviewUi(row),draft=ui.identityBasisDraft,disabled=state.saving?'disabled':'';
    const action=(name,label)=>'<button data-technical-review-action="identity-basis-'+name+'" data-candidate-row="'+index+'" '+disabled+'>'+label+'</button>';
    if(draft)return '<section class="identity-basis-form"><p>Approved P/N Basis: <strong>'+(draft.basis==='CUSTOMER_PN'?'Customer P/N':'Manufacturer P/N')+'</strong></p>'+(draft.basis==='CUSTOMER_PN'?'<label>Approved P/N<input aria-label="Customer approved P/N" data-identity-basis-field="partNumber" maxlength="200" value="'+escapeHtml(draft.partNumber||'')+'"></label><p>Confirms the customer-controlled identifier only. Supply responsibility is unchanged.</p>':'<p>Use manufacturer identities for this row. Existing manufacturer records are retained; review them before accepting.</p>')+action('save','Save')+action('cancel','Cancel')+'</section>';
    if(customerIdentity(row))return '<p>Approved P/N Basis: <strong>Customer P/N</strong></p><p>'+escapeHtml(row.primaryIdentity.partNumber)+'</p>'+(readOnly?'':action('customer','Edit Customer P/N')+'<details><summary>Change identity basis</summary>'+action('manufacturer','Use Manufacturer P/N')+'</details>');
    if(readOnly)return '';
    if(!currentCandidateIdentities(row).length)return '<p>No manufacturer P/N is available.</p><button data-technical-review-action="approved-pn-add" data-candidate-row="'+index+'" '+disabled+'>Add Manufacturer P/N</button>'+action('customer','Use Customer P/N');
    return '<details><summary>Change identity basis</summary><p>Existing manufacturer identities will be retained but will not be the active primary identity.</p>'+action('customer','Use Customer P/N')+'</details>';
  }
  function renderApprovedPartManager(row,index,readOnly=false) {
    if((rowReviewUi(row).componentType||row.componentType)==='DNP')return '<p>DNP / Do Not Populate. No Approved P/N is required. Existing identity evidence is retained.</p>';
    const ui=rowReviewUi(row),type=ui.componentType||row.componentType;
    if(assemblyIdentityRoute(row,type)){
      const number=ui.assemblyNumber??row.assemblyIdentity?.partNumber??(row.alternates||[]).find(a=>!a.removedAtUtc&&a.origin==='MANUAL'&&a.reviewStatus==='CONFIRMED')?.partNumber??row.values.partNumber??'';
      return '<section class="approved-part-manager"><h4>Approved P/Ns</h4><p>Identity type: Assembly P/N</p><label>Assembly P/N<input id="assembly-panel-'+index+'" aria-label="Assembly P/N" data-worksheet-field="assemblyNumber" data-worksheet-row="'+index+'" maxlength="200" value="'+escapeHtml(number)+'" '+(readOnly||state.saving?'disabled':'')+'></label>'+(readOnly?'':'<p>Save changes, then Accept the row to confirm this assembly identifier.</p><button data-technical-review-action="assembly-pn-save" data-candidate-row="'+index+'" '+(state.saving?'disabled':'')+'>Save changes</button>')+'</section>';
    }
    row={...row,componentType:type};
    if(customerIdentity(row)||rowReviewUi(row).identityBasisDraft)return '<section class="approved-part-manager" aria-label="Approved P/N manager">'+renderIdentityBasis(row,index,readOnly)+'</section>';
    const entries=currentCandidateIdentities(row),draft=rowReviewUi(row).approvedPartDraft,disabled=state.saving?'disabled':'';
    return '<section class="approved-part-manager" aria-label="Approved P/N manager"><h4>Approved P/Ns</h4><table><thead><tr><th>Approved P/N</th><th>Manufacturer</th><th>Action</th></tr></thead><tbody>'+entries.map(p=>'<tr><td>'+escapeHtml(p.partNumber)+'</td><td>'+escapeHtml(p.manufacturerName||'—')+'</td><td>'+(readOnly?'':'<button data-technical-review-action="approved-pn-edit" data-candidate-row="'+index+'" data-proposal-id="'+escapeHtml(p.id)+'" '+disabled+'>Edit</button>')+'</td></tr>').join('')+'</tbody></table>'+(draft?'':renderIdentityBasis(row,index,readOnly))+(readOnly?'':draft?'<div class="approved-part-form"><label>P/N<input aria-label="Approved P/N" data-approved-part-field="partNumber" maxlength="200" value="'+escapeHtml(draft.partNumber)+'" '+disabled+'></label><label>Manufacturer<input aria-label="Approved P/N manufacturer" data-approved-part-field="manufacturerName" maxlength="200" value="'+escapeHtml(draft.manufacturerName)+'" '+disabled+'></label><button class="technical-review-primary" data-technical-review-action="approved-pn-save" data-candidate-row="'+index+'" '+disabled+'>Save</button><button data-technical-review-action="approved-pn-cancel" data-candidate-row="'+index+'" '+disabled+'>Cancel</button></div>':entries.length?'<button data-technical-review-action="approved-pn-add" data-candidate-row="'+index+'" '+disabled+'>Add Approved P/N</button>':'')+'</section>';
  }
  async function approvedPartAction(action,button) {
    if(state.saving||state.acceptedVersion||completedReview(state.selected?.record))return;
    const bom=state.selected.record.technicalReview.candidateBom,index=Number(button.dataset.candidateRow),row=bom.rows[index],ui=rowReviewUi(row);
    if((state.selected.record.technicalReview.bomAcceptances||[]).some(a=>a.candidate.id===bom.id)||['SUBASSEMBLY','DNP'].includes(ui.componentType||row.componentType))return;
    if(action==='approved-pn-cancel'){delete ui.approvedPartDraft;renderDetail();return;}
    if(action==='approved-pn-edit'||action==='approved-pn-add') {
      if(approvedPartDirty(row)){state.message='Save or cancel the current P/N edit first.';renderDetail();return;}
      const part=currentCandidateIdentities(row).find(p=>p.id===button.dataset.proposalId);
      ui.approvedPartDraft={id:part?.id||null,partNumber:part?.partNumber||'',manufacturerName:part?.manufacturerName||''};renderDetail();return;
    }
    if(action!=='approved-pn-save'||!ui.approvedPartDraft)return;
    const draft={...ui.approvedPartDraft};if(!draft.partNumber.trim()){state.message='Enter an approved P/N.';state.messageState='error';renderDetail();return;}
    state.saving=true;state.message='';renderDetail();
    try {
      state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',
        {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:index,values:null,approvedPartChange:{...draft,expectedToken:row.reviewState.token}})});
      delete ui.approvedPartDraft;delete ui.manualNumber;delete ui.manualMaker;
      const saved=state.selected.record.technicalReview.candidateBom.rows[index];
      const part=currentCandidateIdentities(saved).find(p=>p.partNumber===draft.partNumber.trim()&&(p.manufacturerName||'')===draft.manufacturerName.trim());
      if(part&&draft.id){rememberCandidateDisplayChoice(saved,part.id);ui.primaryChoice=part.id;}
      state.message='Approved P/N saved. Accept the row after reviewing it.';state.messageState='';
    } catch(error){state.message=error.message;state.messageState='error';}
    finally{state.saving=false;renderDetail();}
  }
  function currentCandidateIdentities(row) {
    const identity=row.manufacturerIdentity, distinct=new Map();
    for(const proposal of identity?.proposals||[]) {
      const decision=manufacturerDecision(identity,proposal.id);
      if(!proposal.partNumber?.trim()||!['CONFIRMED','PROPOSED'].includes(decision))continue;
      // Presentation only: keep a real proposal ID for the existing decision actions.
      const key=JSON.stringify([proposal.partNumber.trim(),(proposal.manufacturerName||'').trim()]);
      const previous=distinct.get(key);
      if(!previous||decision==='CONFIRMED'&&manufacturerDecision(identity,previous.id)!=='CONFIRMED')distinct.set(key,proposal);
    }
    return [...distinct.values()];
  }
  function worksheetIdentity(row,index,locked,type){
    const ui=rowReviewUi(row),identity=row.manufacturerIdentity;
    if(type==='DNP')return '<span data-approved-part>DNP</span>';
    if(customerIdentity({...row,componentType:type}))return '<span data-approved-part>'+escapeHtml(row.primaryIdentity.partNumber||'Not resolved')+'</span>';
    const current=currentCandidateIdentities(row),confirmed=current.filter(p=>manufacturerDecision(identity,p.id)==='CONFIRMED');
    const assembly=row.assemblyIdentity?.partNumber||(row.alternates||[]).find(a=>!a.removedAtUtc&&a.origin==='MANUAL'&&a.reviewStatus==='CONFIRMED')?.partNumber||'';
    if(locked && assemblyIdentityRoute(row,type))return '<span data-approved-part>'+escapeHtml(assembly||'—')+'</span>';
    if(locked&&row.approvedAlternateSelectionCurrent)return '<span data-approved-part>'+escapeHtml(row.selectedApprovedAlternate.partNumber)+'</span>';
    if(locked){const choices=confirmed;return candidateIdentityChoice((preferredCandidateDisplay(row,confirmed)||confirmed[0])?.partNumber,choices.length,choices.map(p=>'<div>'+escapeHtml(p.partNumber+(p.manufacturerName?' — '+p.manufacturerName:''))+' — '+escapeHtml(manufacturerDecision(identity,p.id)==='CONFIRMED'?'Approved':manufacturerDecision(identity,p.id))+'</div>').join(''));}
    const attr=' data-worksheet-row="'+index+'" '+(state.saving?'disabled':'');
    if(assemblyIdentityRoute(row,type))return candidateIdentityChoice(ui.assemblyNumber??assembly,1,'<input aria-label="Assembly P/N for row '+(index+1)+'" id="assembly-number-'+index+'" maxlength="200" data-worksheet-field="assemblyNumber" '+attr+' value="'+escapeHtml(ui.assemblyNumber??assembly)+'"><small>Assembly P/N</small>');
    const alternatives=row.approvedAlternates||[];
    if(locked&&row.approvedAlternateSelectionCurrent)return '<span data-approved-part>'+escapeHtml(row.selectedApprovedAlternate.partNumber)+'</span>';
    const proposals=current;
    const selected=ui.primaryChoice?.startsWith('ALT:')&&alternatives.some(a=>'ALT:'+a.id===ui.primaryChoice)?ui.primaryChoice:row.approvedAlternateSelectionCurrent?'ALT:'+row.selectedApprovedAlternate.alternateId:ui.primaryChoice==='MANUAL'||proposals.some(p=>p.id===ui.primaryChoice)?ui.primaryChoice:preferredCandidateDisplay(row,proposals)?.id??confirmed[0]?.id??proposals[0]?.id??'';
    const number=selected?.startsWith('ALT:')?alternatives.find(a=>'ALT:'+a.id===selected)?.partNumber:selected==='MANUAL'?ui.manualNumber:proposals.find(p=>p.id===selected)?.partNumber;
    const controls='<select aria-label="Approved P/N for row '+(index+1)+'" id="approved-choice-'+index+'" data-worksheet-field="primaryChoice" '+attr+'><option value="">Not resolved</option>'+proposals.map(p=>'<option value="'+escapeHtml(p.id)+'" '+(p.id===selected?'selected':'')+'>'+escapeHtml(p.partNumber+(p.manufacturerName?' — '+p.manufacturerName:''))+'</option>').join('')+alternatives.map(a=>'<option value="ALT:'+escapeHtml(a.id)+'" '+(selected==='ALT:'+a.id?'selected':'')+'>'+escapeHtml(a.partNumber+(a.manufacturerName?' - '+a.manufacturerName:'')+' (approved alternate)')+'</option>').join('')+'<option value="MANUAL" '+(selected==='MANUAL'?'selected':'')+'>Manual Entry…</option></select>'+(selected&&selected!=='MANUAL'&&!selected.startsWith('ALT:')?'<button data-technical-review-action="worksheet-reject" data-candidate-row="'+index+'" data-proposal-id="'+escapeHtml(selected)+'" '+(state.saving?'disabled':'')+'>Reject this candidate</button>':'')+(selected==='MANUAL'?'<input aria-label="Manual MFG P/N for row '+(index+1)+'" id="approved-manual-'+index+'" data-worksheet-field="manualNumber" '+attr+' maxlength="200" value="'+escapeHtml(ui.manualNumber||'')+'">':'');
    return candidateIdentityChoice(number,confirmed.length+alternatives.length,controls,selected==='MANUAL'&&!ui.manualNumber)+(row.selectedApprovedAlternate&&!row.approvedAlternateSelectionCurrent?'<small>Previous alternate selection is no longer current. Select an approved P/N again.</small>':'');
  }
  async function chooseApprovedAlternate(index,value){
    if(state.saving)return;
    const bom=state.selected.record.technicalReview.candidateBom,row=bom.rows[index];
    if(candidateProgressRows().length){state.message='Save Progress before changing the Approved P/N selection. Your edits are retained.';renderDetail();return;}
    state.saving=true;renderDetail();
    try{state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:index,values:null,approvedAlternateSelection:{alternateId:value.startsWith('ALT:')?value.slice(4):null,expectedToken:row.reviewState.token}})});rowReviewUi(state.selected.record.technicalReview.candidateBom.rows[index]).primaryChoice=value;state.message='Approved P/N selection saved. Review the row, then Accept.';state.messageState='';}
    catch(error){state.message=error.message;state.messageState='error';}finally{state.saving=false;renderDetail();}
  }
  async function acceptWorksheetRow(index){
    if(state.selected?.record?.technicalReview?.candidateBom?.manualDraft && candidateProgressRows().length){state.message='Save Progress before accepting a manually authored row.';renderDetail();return;}
    if(state.saving||completedReview(state.selected.record))return;
    const bom=state.selected.record.technicalReview.candidateBom,row=bom.rows[index],ui=rowReviewUi(row);
    if(approvedPartDirty(row)||ui.identityBasisDraft){state.message='Save or cancel the Approved P/N changes before accepting this row.';state.messageState='error';renderDetail();return;}
    const values=state.candidateIndex===index&&document.getElementById('candidate-partNumber')?Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])])):state.candidateIndex===index&&state.candidateDraft?state.candidateDraft:row.values;
    const acceptedValues=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,values[k]]));
    const selection=document.getElementById('approved-choice-'+index)?.value;
    if(selection==='MANUAL'&&!document.getElementById('approved-manual-'+index)?.value.trim()){state.message='Enter a manual manufacturer P/N before accepting.';state.messageState='error';renderDetail();return;}
    const worksheetAcceptance={expectedToken:row.reviewState.token,componentType:ui.componentType||row.componentType||'STANDARD_COTS',assemblyPartNumber:ui.assemblyNumber??document.getElementById('assembly-number-'+index)?.value??row.assemblyIdentity?.partNumber,proposalId:null,manualPartNumber:document.getElementById('approved-manual-'+index)?.value,manufacturerName:ui.manualMaker};
    state.saving=true;
    try{state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:index,values:acceptedValues,worksheetAcceptance})});delete state.rowReviewUi[bom.id+':'+index];state.candidateDraft=null;state.inlineDescriptionDirty=false;state.candidateInlineRow=null;state.candidateIndex=null;state.rowOption=null;state.message='Row accepted.';state.messageState='';}
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
      if(row.componentType==='DNP')continue;
      if(customerIdentity(row)){if(!row.primaryIdentity.partNumber?.trim()||row.primaryIdentity.customerBomPartNumber!==row.values.partNumber)unresolved++;continue;}
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
    return state.rowReviewUi[key] ||= {primaryChoice:row.workingState?.manualPartNumber!=null?'MANUAL':undefined,assemblyNumber:row.workingState?.assemblyPartNumber,manualNumber:row.workingState?.manualPartNumber,manualMaker:row.workingState?.manufacturerName};
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
  function descriptionProvenance(row) {
    const customer=row.extracted?.description,reviewed=row.values?.description;
    const correction=[...(row.corrections||[])].reverse().find(c=>c.field==='description'&&c.value===reviewed);
    return '<section class="candidate-description-provenance" aria-label="Description provenance"><dl><dt>Customer Description</dt><dd>'+escapeHtml(customer??'Not recorded')+'</dd><dt>Reviewed Description</dt><dd>'+escapeHtml(reviewed??'Not recorded')+'</dd></dl>'+
      (customer!==reviewed&&correction?'<small>Updated by '+escapeHtml(correction.reviewer)+' · '+escapeHtml(formatDateTime(correction.atUtc))+'</small>':'')+analysisEvidence(row.analysisFields?.description)+'</section>';
  }
    function preparationGroup(bom,row) {return (bom.preparationGroups||[]).find(g=>g.parentRowId===row.rowId);}
  function preparationBadge(bom,row,index) {
    const g=preparationGroup(bom,row);if(!g)return '';
    const expanded=!!state.preparationExpanded?.[g.id];
    return '<div class="preparation-mark"><span>Preparation required</span><button data-technical-review-action="preparation-toggle" data-group="'+escapeHtml(g.id)+'" aria-expanded="'+expanded+'">'+(g.pieces.some(p=>p.method==='MAKE_FROM_STOCK')?'Cut from stock':'Precut sourcing')+' · '+g.pieces.length+' pieces</button><small>Preparation details pending</small></div>';
  }
  function preparationInput(event) {
    if(!event.target.closest?.('[data-preparation-editor]'))return false;
    state.preparationDraft=readPreparationForm();return true;
  }
  function readPreparationForm() {
    const form=mount.querySelector('[data-preparation-editor]');if(!form)return state.preparationDraft;
    return {parentRowId:form.dataset.parent,groupId:form.dataset.group||null,expectedToken:form.dataset.token,
      customerFind:form.querySelector('[data-prep-find]').value,stockIdentityBasis:form.querySelector('[data-prep-basis]').value,
      instructionReference:form.querySelector('[data-prep-instructions]').value,
      pieces:Array.from(form.querySelectorAll('[data-prep-row]')).filter(e=>e.querySelector('[data-prep-include]').checked).map(e=>({rowId:e.dataset.prepRow,method:e.querySelector('[data-prep-method]').value,positions:e.querySelector('[data-prep-positions]').value?Number(e.querySelector('[data-prep-positions]').value):null}))};
  }
  function renderPreparation(bom,row,readOnly) {
    const g=preparationGroup(bom,row),draft=state.preparationDraft?.parentRowId===row.rowId?state.preparationDraft:null;
    const value=draft||g||{customerFind:'',stockIdentityBasis:'INTERNAL_UNKNOWN',pieces:[],instructionReference:''};
    const disabled=readOnly||state.saving||window.DleOsCapabilities?.can?.('technical_review.disposition')!==true?'disabled':'';
    const others=new Set((bom.preparationGroups||[]).filter(x=>x.id!==g?.id).flatMap(x=>[x.parentRowId,...x.pieces.map(p=>p.rowId)]));
    return '<section class="preparation-editor" data-preparation-editor data-parent="'+escapeHtml(row.rowId)+'" data-group="'+escapeHtml(g?.id||'')+'" data-token="'+escapeHtml(draft?.expectedToken||bom.preparationToken)+'"><p>Explicitly link this stock row to its finished pieces. No relationship is inferred from Find numbers.</p><div class="preparation-fields"><label>Customer Find<input data-prep-find maxlength="9" value="'+escapeHtml(value.customerFind)+'" '+disabled+'></label><label>Stock identifier<select data-prep-basis '+disabled+'><option value="INTERNAL_UNKNOWN" '+(value.stockIdentityBasis==='INTERNAL_UNKNOWN'?'selected':'')+'>Internal — owner unknown</option><option value="CUSTOMER" '+(value.stockIdentityBasis==='CUSTOMER'?'selected':'')+'>Customer P/N</option></select></label></div><p>Piece identifiers remain provisional internal references, owner/origin unknown. Existing identity decisions and historical precut evidence are retained separately.</p><div class="preparation-piece-list">'+bom.rows.filter(r=>r.rowId&&r.rowId!==row.rowId&&!others.has(r.rowId)&&!['DNP','SUBASSEMBLY','REFERENCE_ONLY'].includes(r.componentType)).map(r=>{
      const piece=value.pieces.find(p=>p.rowId===r.rowId),label='Find '+r.values.lineNumber+' · '+r.values.partNumber+' · '+(r.values.designators||'no refdes');
      return '<div data-prep-row="'+escapeHtml(r.rowId)+'"><label><input type="checkbox" data-prep-include '+(piece?'checked':'')+' '+disabled+'> '+escapeHtml(label)+'</label><span>'+escapeHtml(r.values.quantity+' '+(r.values.unit||'')+' / assembly')+'</span><label class="candidate-sr-only" for="prep-method-'+r.index+'">Sourcing for '+escapeHtml(label)+'</label><select id="prep-method-'+r.index+'" data-prep-method '+disabled+'><option value="MAKE_FROM_STOCK" '+(piece?.method==='MAKE_FROM_STOCK'?'selected':'')+'>Make from stock</option><option value="BUY_PRECUT" '+(piece?.method==='BUY_PRECUT'?'selected':'')+'>Buy precut</option></select><input aria-label="Positions for '+escapeHtml(label)+'" type="number" min="1" max="10000" placeholder="Positions pending" data-prep-positions value="'+escapeHtml(piece?.positions??'')+'" '+disabled+'></div>';
    }).join('')+'</div><label>Preparation instruction reference (optional)<input data-prep-instructions maxlength="2000" value="'+escapeHtml(value.instructionReference)+'" '+disabled+'></label><p>Preparation details pending. Stock consumption is not calculated from position totals or source quantities. Grouped BOM acceptance and downstream material export remain blocked.</p><p role="status" data-preparation-message>'+escapeHtml(state.preparationMessage||'')+'</p><button data-technical-review-action="preparation-save" '+disabled+'>Save preparation draft</button> <button data-technical-review-action="preparation-cancel" '+disabled+'>Cancel edits</button>'+(g?'<details><summary>Saved sourcing summary &amp; history</summary><p>Draft only — not purchasing requirements.</p><ul>'+bom.preparationDemand.filter(d=>[g.parentRowId,...g.pieces.map(p=>p.rowId)].includes(d.rowId)).map(d=>{const r=bom.rows.find(r=>r.rowId===d.rowId);return '<li>'+escapeHtml('Find '+r?.values.lineNumber+': '+d.kind+' · '+(d.quantity??'quantity pending')+' '+(d.unit||'')+' · '+d.status)+'</li>';}).join('')+'</ul><p>Source version: '+escapeHtml(g.sourceHash)+'</p><p>'+escapeHtml((bom.preparationHistory||[]).filter(h=>h.group.id===g.id).map(h=>h.action+' by '+h.reviewer+' at '+formatDateTime(h.atUtc)).join('; '))+'</p></details>':'')+'</section>';
  }
  async function preparationAction(action,button) {
    if(state.saving)return;
    if(action==='preparation-toggle'){state.preparationExpanded||={};state.preparationExpanded[button.dataset.group]=!state.preparationExpanded[button.dataset.group];renderDetail();return;}
    if(action==='preparation-cancel'){state.preparationDraft=null;state.preparationMessage='';renderDetail();return;}
    const bom=state.selected.record.technicalReview.candidateBom;
    if(candidateProgressRows().length){state.preparationMessage='Save Progress for pending row edits before saving preparation.';state.preparationDraft=readPreparationForm();renderDetail();return;}
    state.preparationDraft=readPreparationForm();state.saving=true;
    try{state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:state.candidateIndex,values:null,preparationChange:state.preparationDraft})});state.preparationDraft=null;state.preparationMessage='Preparation draft saved. No part identity, row acceptance or stock quantity was changed.';}
    catch(error){state.preparationMessage=error.message;}
    finally{state.saving=false;renderDetail();}
  }

  function renderCandidateInspector(bom,row,index,readOnly) {
    const titles={preparation:'Preparation / cut pieces','approved-pns':'Approved P/Ns',edit:'BOM Fields',files:'Technical Files',history:'Source / Evidence',alternates:'Technical Alternates'};
    const panel=state.rowOption||'edit';
    const body=panel==='preparation'?renderPreparation(bom,row,readOnly):panel==='approved-pns'?renderApprovedPartManager(row,index,readOnly):panel==='alternates'?renderAlternates(row,readOnly):panel==='files'?renderRowTechnicalFiles(bom,row,readOnly):panel==='history'?renderCandidateEvidence(bom,row):renderCandidateRow(bom,row,index,readOnly);
    return '<div class="candidate-row-inspector"><div class="candidate-inspector-heading"><h4 tabindex="-1">Line '+escapeHtml(row.values.lineNumber)+' · '+escapeHtml(titles[panel]||titles.edit)+'</h4><button data-technical-review-action="candidate-panel-close" '+(state.saving?'disabled':'')+'>Close</button></div>'+body+'</div>';
  }
  function renderCandidateEvidence(bom,row) {
    const url='/api/sim/rfq-intakes/'+encodeURIComponent(state.selected?.record?.intakeId||'')+'/documents/';
    const evidence=e=>e?'<a target="_blank" rel="noopener" href="'+url+encodeURIComponent(e.documentId)+'#page='+(e.page||bom.page)+'">View source'+(e.page?' · Page '+escapeHtml(e.page):'')+(e.sheet?' · sheet '+escapeHtml(e.sheet):'')+'</a>':'';
    return '<section class="candidate-source-evidence">'+(['SUBASSEMBLY','DNP'].includes(row.componentType)?'':'<p>Approved P/N Basis: '+(customerIdentity(row)?'Customer P/N':'Manufacturer P/N')+'</p>')+evidence({documentId:bom.governingDocumentId,page:bom.page})+
      '<table><thead><tr><th>Field</th><th>Source value</th><th>Reviewed value</th></tr></thead><tbody>'+Object.entries(candidateFields).map(([key,label])=>'<tr><th>'+escapeHtml(label)+'</th><td>'+escapeHtml(row.extracted[key]||'—')+'</td><td>'+escapeHtml(row.values[key]||'—')+'</td></tr>').join('')+'</tbody></table>'+
      (row.reviewer?'<p>Reviewed by '+escapeHtml(row.reviewer)+' · '+escapeHtml(formatDateTime(row.reviewedAtUtc))+'</p>':'')+
      Object.entries(row.analysisFields||{}).map(([key,f])=>'<p>'+escapeHtml(candidateFields[key]||key)+': '+evidence(f.evidence)+(f.supportingEvidence?' · Supporting: '+evidence(f.supportingEvidence):'')+(row.comparison[key]==='CONFLICT'?' · Conflicting source values':'')+(f.uncertainty?' · '+escapeHtml(f.uncertainty):'')+'</p>').join('')+
      (row.manufacturerIdentity?.proposals||[]).map(p=>'<p>'+escapeHtml(p.partNumber)+' · '+escapeHtml(p.manufacturerName||'Manufacturer not supplied')+' · '+escapeHtml(manufacturerDecision(row.manufacturerIdentity,p.id))+' '+evidence(p.evidence)+(p.conflicts?.length?' · '+escapeHtml(p.conflicts.join('; ')):'')+'</p>').join('')+
      (row.alternates||[]).filter(a=>!a.removedAtUtc).map(a=>'<p>Alternate: '+escapeHtml(a.partNumber)+' · '+escapeHtml(a.reviewStatus)+(a.note?' · '+escapeHtml(a.note):'')+'</p>').join('')+
      '<details><summary>Review records</summary><p>Retained decisions and corrections; not a complete edit history.</p>'+(row.manufacturerIdentity?.history||[]).map(h=>'<p>'+escapeHtml(row.manufacturerIdentity.proposals.find(p=>p.id===h.proposalId)?.partNumber||'Identity')+' · '+escapeHtml(h.decision)+' · '+escapeHtml(h.reviewer||'')+' · '+escapeHtml(h.atUtc?formatDateTime(h.atUtc):'')+'</p>').join('')+(row.corrections||[]).map(c=>'<p>'+escapeHtml(candidateFields[c.field]||c.field)+': '+escapeHtml(c.previous)+' → '+escapeHtml(c.value)+' · '+escapeHtml(c.reviewer)+'</p>').join('')+(row.assemblyIdentityHistory||[]).map(a=>'<p>Assembly P/N: '+escapeHtml(a.partNumber)+' · '+escapeHtml(a.reviewer)+'</p>').join('')+'</details>'+
      '<details class="candidate-technical-details"><summary>Technical details</summary><p>Document: '+escapeHtml(bom.governingDocumentId)+' · Bounds: '+escapeHtml((row.bounds||[]).join(', '))+'</p><p>SHA-256: '+escapeHtml(bom.governingSha256)+'</p>'+renderManufacturer(row,true)+renderAlternates(row,true)+'</details></section>';
  }
  function renderCandidateRow(bom, row, index, readOnly = false) {
    if(readOnly)return renderCandidateEvidence(bom,row);
    const disabled=state.saving?'disabled':'';
    return '<div class="candidate-edit-grid">'+['lineNumber','partNumber','quantity','unit'].map(key=>'<label>'+({lineNumber:'Line / Find #',partNumber:'Customer / BOM P/N',quantity:'Qty / Assy',unit:'Unit'}[key])+'<input id="candidate-'+key+'" value="'+escapeHtml((state.candidateDraft||row.values)[key])+'" maxlength="2000" '+disabled+(key==='unit'?' readonly aria-readonly="true"':'')+'></label>').join('')+'</div><p>Unit is preserved from the imported source and cannot be changed here. Resolve quantity and unit differences before accepting; editing quantity does not convert units.</p><div class="candidate-editor-actions"><button class="technical-review-primary" data-technical-review-action="worksheet-accept" data-candidate-row="'+index+'" '+disabled+'>Accept</button></div>';
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
      const pn=row.componentType==='DNP'?'DNP':row.componentType==='SUBASSEMBLY'?escapeHtml(assembly||'—'):customerIdentity(row)?escapeHtml(row.primaryIdentity.partNumber):approved.length?'<details class="worksheet-mfg-list"><summary>'+escapeHtml(approved[0].partNumber)+(approved.length>1?' <small>+'+(approved.length-1)+' more</small>':'')+'</summary>'+approved.map(p=>'<div>'+escapeHtml(p.partNumber+(p.manufacturerName?' — '+p.manufacturerName:''))+'</div>').join('')+'</details>':'—';
      const files=(acceptance.package?.documents||[]).filter(d=>d.rowAssociation?.rowId===(row.rowId||bom.id+':row:'+row.index));
      const detail='<details class="accepted-row-details"><summary>Details</summary>'+(['SUBASSEMBLY','DNP'].includes(row.componentType)?'':'<p>Approved P/N Basis: '+(customerIdentity(row)?'Customer P/N':'Manufacturer P/N')+'</p>')+descriptionProvenance(row)+
        (alternates.length?'<h4>Approved alternates</h4><ul>'+alternates.map(a=>'<li>'+escapeHtml(a.partNumber)+'</li>').join('')+'</ul>':'')+
        (assembly?'<p>Assembly P/N: '+escapeHtml(assembly)+'</p>':'')+
        (files.length?'<details><summary>Technical Files ('+files.length+')</summary>'+files.map(f=>'<p><a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/'+encodeURIComponent(record.intakeId)+'/documents/'+encodeURIComponent(f.documentId)+'">'+escapeHtml(f.name)+'</a></p>').join('')+'</details>':'')+
        '<details><summary>Source / History</summary><p>Governing document: '+escapeHtml(bom.governingDocumentId)+' · Page '+escapeHtml(bom.page)+'</p><p>SHA-256: '+escapeHtml(bom.governingSha256)+'</p>'+Object.entries(candidateFields).filter(([key])=>key!=='description').map(([key,label])=>'<p>'+escapeHtml(label)+': '+escapeHtml(row.extracted?.[key]||'—')+'</p>'+analysisEvidence(row.analysisFields?.[key])).join('')+(row.corrections||[]).map(c=>'<p>'+escapeHtml(candidateFields[c.field]||c.field)+': '+escapeHtml(c.previous)+' → '+escapeHtml(c.value)+' · '+escapeHtml(c.reviewer)+' · '+escapeHtml(c.atUtc)+'</p>').join('')+'</details></details>';
      return '<tr><td>'+escapeHtml(v.lineNumber||'—')+'</td><td class="candidate-part">'+escapeHtml(v.partNumber||'—')+'</td><td>'+pn+'</td><td>'+escapeHtml(v.description||'—')+'</td><td>'+escapeHtml(v.quantity||'—')+'</td><td>'+escapeHtml(componentTypes[row.componentType]||componentTypes.STANDARD_COTS)+'</td><td>'+escapeHtml(v.designators||'—')+'</td><td>'+detail+'</td></tr>';
    }).join('');
    return '<section class="technical-review-question technical-review-candidate accepted-bom-reference" aria-labelledby="acceptedBomTitle">'+back+'<h3 id="acceptedBomTitle" tabindex="-1">'+escapeHtml(title)+'</h3><p>Accepted by '+escapeHtml(acceptance.reviewedBy||'Not recorded')+' · <time datetime="'+escapeHtml(acceptance.reviewedAtUtc)+'">'+escapeHtml(formatDateTime(acceptance.reviewedAtUtc))+'</time></p><p>Read-only snapshot of the accepted BOM.</p>'+renderVproDecisions(bom,true)+'<div class="candidate-table-scroll" role="region" aria-label="'+escapeHtml(title)+'" tabindex="0"><table class="candidate-table"><thead><tr>'+['Line','Customer / BOM P/N','Approved P/N','Description','Qty / Assy','FAIR Component Type','Designators','Details'].map(x=>'<th scope="col">'+x+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div></section>';
  }

  function acceptedLinks(record) {
    return (record.technicalReview?.bomAcceptances || []).map(a => '<p><button data-technical-review-action="accepted-bom" data-accepted-version="' + a.version + '">View accepted BOM · version ' + a.version + '</button><small> Accepted by ' + escapeHtml(a.reviewedBy) + ' · ' + escapeHtml((window.DleDateFormat?.dateTime(a.reviewedAtUtc,{seconds:true,empty:'Invalid Date'}) ?? new Date(a.reviewedAtUtc).toLocaleString())) + '</small></p>').join('');
  }
  function usesFinalBomReview() {
    return ['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)&&!!(state.selected?.record?.technicalReview?.candidateBom?.vproImport||state.selected?.record?.technicalReview?.candidateBom?.manualDraft);
  }
  function finalBomEntryEnabled() {
    const bom=state.selected?.record?.technicalReview?.candidateBom;
    return !state.saving&&!!bom?.rows?.length&&bom.rows.every(r=>r.reviewState?.reviewed&&!rowReviewUi(r).editing&&!rowReviewUi(r).alternateDraft&&!rowReviewUi(r).identityBasisDraft)&&!candidateProgressRows().length&&!reviewUploads.length;
  }
  function finalBomCanSubmit() {
    const f=state.finalBomReview,s=f?.info;
    if(state.selected?.record?.technicalReview?.candidateBom?.manualDraft)return !!s&&!f.busy&&!f.blocked&&!s.accepted&&!s.blockers?.length&&!s.rowBlockers?.length&&finalBomEntryEnabled()&&(f.reviewNotes||'').length<=4000;
    return !!s&&!f.busy&&!f.blocked&&s.rowsReviewed&&
      (s.baselineCurrent||(f.sourceConfirmed&&f.sourceReason.trim()))&&
      (s.discrepanciesCurrent||(f.documentsConfirmed&&f.documentNotes.trim()));
  }
  function finalBomAccepted(record,id) { return (record.technicalReview?.bomAcceptances||[]).some(a=>a.candidate?.id===id); }
  function cancelFinalBomReview() {
    if(state.saving)return;
    state.finalBomDraft=state.finalBomReview;state.finalBomReview=null;renderDetail();mount.querySelector('[data-technical-review-action="complete-bom"]')?.focus();
  }
  function finishFinalBomReview() {
    state.finalBomReview=null;state.message=state.selected.record.technicalReview.candidateBom?.manualDraft?'BOM accepted for RFQ. Review the package, then submit to RFQs.':'BOM accepted. Review the package, then submit to RFQs.';
    state.candidateIndex=null;state.completionReadiness=null;
    if(state.selected.record.technicalReview?.workflow){state.step='inventory';state.packageDraft=null;state.packageAnswers=null;releaseReadiness=null;}
  }
  async function loadFinalBomReview() {
    const f=state.finalBomReview;if(!f||f.busy)return;
    f.busy=true;f.error='';state.saving=true;renderDetail();
    try {
      const base='/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId);
      const latest=await fetchJson(base);
      if(!latest.record.technicalReview?.candidateBom?.manualDraft&&finalBomAccepted(latest.record,f.candidateId)){state.selected=latest;finishFinalBomReview();return;}
      if(latest.record.technicalReview?.candidateBom?.id!==f.candidateId)throw new Error('The BOM changed. Return to the worksheet and reopen the current BOM.');
      const info=await fetchJson(base+(latest.record.technicalReview.candidateBom.manualDraft?'/manual-bom/completion-info':'/vpro-source-decisions'));
      if(f.info&&(info.evidenceFingerprint!==f.info.evidenceFingerprint||info.candidateFingerprint!==f.info.candidateFingerprint||info.revision!==f.info.revision)){
        if(latest.record.technicalReview.candidateBom.manualDraft)f.error='The saved review changed. Check the current information before accepting.';
        else {f.sourceConfirmed=false;f.documentsConfirmed=false;f.error='The source package or rows changed. Review the current information and confirm again.';}
      }
      state.selected=latest;f.info=info;f.blocked=false;
    } catch(e){f.error=e.message;f.blocked=true;}
    finally{f.busy=false;state.saving=false;renderDetail();mount.querySelector('#finalBomTitle')?.focus();}
  }
  async function openFinalBomReview() {
    if(!finalBomEntryEnabled())return;
    const id=state.selected.record.technicalReview.candidateBom.id;
    state.candidateIndex=null;state.candidateInlineRow=null;
    if(state.finalBomDraft?.candidateId===id)state.finalBomReview=state.finalBomDraft;
    else state.finalBomReview={candidateId:id,...(state.selected.record.technicalReview.candidateBom.manualDraft?{reviewNotes:''}:{sourceConfirmed:false,documentsConfirmed:false,sourceReason:'',documentNotes:''}),info:null,busy:false,blocked:false,error:''};
    await loadFinalBomReview();
  }
  function renderFinalBomReview(record,bom) {
    if(bom.manualDraft)return renderManualFinalBomReview(record,bom);
    const f=state.finalBomReview,s=f.info,a=record.assemblies?.[0]||{},v=bom.vproImport;
    const source=(s?.documents||record.technicalFiles||[]).find(d=>d.documentId===v.documentId);
    const link=d=>'<a href="/api/sim/rfq-intakes/'+encodeURIComponent(record.intakeId)+'/documents/'+encodeURIComponent(d.documentId)+'" target="_blank" rel="noopener">'+escapeHtml(d.name||'Open file')+'</a>';
    const busy=f.busy?'disabled':'';
    const choice=(key,yes,no)=>'<div class="final-bom-choices"><label><input type="radio" name="'+key+'" data-final-bom-choice="'+key+'" value="yes" '+(f[key]?'checked':'')+' '+busy+'> '+yes+'</label><label><input type="radio" name="'+key+'" data-final-bom-choice="'+key+'" value="no" '+(!f[key]&&f[key+'Answer']==='no'?'checked':'')+' '+busy+'> '+no+'</label></div>';
    const conflicts=bom.rows.flatMap(r=>Object.entries(r.comparison||{}).filter(([,value])=>value==='CONFLICT').map(([field])=>'Line '+r.values.lineNumber+': the files disagree about '+(candidateFields[field]||field)+'.'));
    const decisions=bom.rows.filter(r=>(r.alternates||[]).some(x=>!x.removedAtUtc)||r.corrections?.length||r.identityBasis==='CUSTOMER_PN');
    return '<section class="final-bom-review final-bom-plain" aria-labelledby="finalBomTitle"><header><div><h2 id="finalBomTitle" tabindex="-1">Finish BOM review</h2><p>'+escapeHtml(a.assemblyNumber+' · Rev '+a.revision+' · '+a.quantity+' assemblies')+'</p></div><button data-technical-review-action="final-bom-back" '+busy+'>Back to BOM</button></header>'+
      (f.busy?'<p role="status">'+(f.submitting?'Saving your answers and accepting the BOM…':'Opening your saved review…')+'</p>':'')+
      (f.error?'<p class="final-bom-error" role="alert">'+escapeHtml(f.error)+'</p>'+(f.blocked?'<button data-technical-review-action="final-bom-retry" '+busy+'>Try again</button>':''):'')+
      '<section class="final-bom-source"><h3>Use this VPRO BOM for '+escapeHtml((s?.assembly||a.assemblyNumber)+' Rev '+(s?.revision||a.revision))+'?</h3><p>'+(source?link(source):'BOM file unavailable')+'</p>'+
      (s?.baselineCurrent?'<p class="final-bom-recorded">Already answered: use this BOM.</p>':s?choice('sourceConfirmed','Yes, use this BOM','Not sure')+
      '<p data-final-choice-help="sourceConfirmed" '+(f.sourceConfirmedAnswer==='no'&&!f.sourceConfirmed?'':'hidden')+'>Go back to the BOM and check which file to use.</p>'+
      '<div data-final-followup="sourceConfirmed" '+(f.sourceConfirmed?'':'hidden')+'><label>Why this BOM? <span class="final-bom-note-hint">A short note is enough.</span><textarea data-final-bom-field="sourceReason" maxlength="4000" '+busy+'>'+escapeHtml(f.sourceReason)+'</textarea></label></div>':'')+'</section>'+
      '<section><h3>Have you checked the customer files against this BOM?</h3><div class="final-bom-links">'+(s?.documents||[]).filter(d=>d.documentId!==v.documentId).map(link).join('')+'</div>'+
      (conflicts.length?'<ul>'+conflicts.map(c=>'<li>'+escapeHtml(c)+'</li>').join('')+'</ul>':'')+
      (s?.discrepanciesCurrent?'<p class="final-bom-recorded">Already checked for these files and BOM rows.</p>':s?choice('documentsConfirmed','Yes, and any differences are resolved','Not yet')+
      '<p data-final-choice-help="documentsConfirmed" '+(f.documentsConfirmedAnswer==='no'&&!f.documentsConfirmed?'':'hidden')+'>Check the files above. If anything is unresolved, go back to the BOM.</p>'+
      '<div data-final-followup="documentsConfirmed" '+(f.documentsConfirmed?'':'hidden')+'><label>What did you find, and what did you decide?<textarea data-final-bom-field="documentNotes" maxlength="4000" placeholder="Briefly describe the differences and your decisions. If there were none, write No differences." '+busy+'>'+escapeHtml(f.documentNotes)+'</textarea></label></div>':'')+
      (decisions.length?'<details><summary>View your saved part decisions</summary><ul>'+decisions.map(r=>'<li><strong>Line '+escapeHtml(r.values.lineNumber)+': '+escapeHtml(r.values.partNumber)+'</strong> · '+escapeHtml(r.values.quantity+' '+(r.values.unit||'')+' per assembly')+(r.alternates||[]).filter(x=>!x.removedAtUtc).map(x=>' · Alternate '+escapeHtml(x.partNumber)+': '+escapeHtml(({APPROVED:'approved',CONFIRMED:'approved',NOT_APPROVED:'not approved'})[x.reviewStatus]||'needs review')).join('')+'</li>').join('')+'</ul></details>':'')+'</section>'+
      (s&&!s.rowsReviewed?'<p role="alert">Some rows still need review. Go back to the BOM.</p>':'')+
      '<details class="final-bom-reference"><summary>File and review details</summary><p>'+escapeHtml(record.intakeId)+' · '+bom.rows.filter(r=>r.reviewState?.reviewed).length+' of '+bom.rows.length+' rows reviewed.</p><p>These answers are saved for this exact file version and these BOM rows. Accepting individual rows does not answer the file-check question.</p><p>File SHA-256: '+escapeHtml(v.sha256)+'</p></details>'+
      '<footer><button class="technical-review-primary" data-technical-review-action="final-bom-submit" '+(finalBomCanSubmit()?'':'disabled')+'>Accept BOM</button><button data-technical-review-action="final-bom-back" '+busy+'>Cancel</button></footer></section>';
  }

  function renderManualFinalBomReview(record,bom){
    const f=state.finalBomReview,info=f.info,busy=f.busy?'disabled':'';
    const blockers=[...(info?.blockers||[]),...(info?.rowBlockers||[]).map(x=>'Row '+x.lineNumber+': '+x.message)];
    if(info?.accepted)blockers.push(info.currentAcceptance?'This BOM is already accepted for RFQ.':'The accepted BOM or its sources changed. Start a new BOM revision from Technical Review.');
    return '<section class="final-bom-review final-bom-plain" aria-labelledby="finalBomTitle"><header><div><h2 id="finalBomTitle" tabindex="-1">Accept this BOM for RFQ?</h2><p>'+escapeHtml(info?.assemblyNumber||record.assemblies?.[0]?.assemblyNumber)+' · Rev '+escapeHtml(info?.assemblyRevision||record.assemblies?.[0]?.revision)+' · '+bom.rows.filter(r=>r.reviewState?.reviewed).length+' of '+bom.rows.length+' rows reviewed</p></div></header>'+
      (f.busy?'<p role="status">'+(f.submitting?'Recording BOM acceptance…':'Checking saved BOM…')+'</p>':'')+
      (f.error?'<p role="alert">'+escapeHtml(f.error)+'</p><button data-technical-review-action="final-bom-retry" '+busy+'>Reload checks</button>':'')+
      (blockers.length?'<ul role="alert">'+blockers.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>':'')+
      '<label>Review notes (optional)<textarea data-final-bom-field="reviewNotes" maxlength="4000" '+busy+'>'+escapeHtml(f.reviewNotes||'')+'</textarea></label>'+
      '<footer><button class="technical-review-primary" data-technical-review-action="final-bom-submit" '+(finalBomCanSubmit()?'':'disabled')+'>Accept BOM</button><button data-technical-review-action="final-bom-back" '+busy+'>Cancel</button></footer></section>';
  }
  async function submitManualFinalBomReview(){
    if(!finalBomCanSubmit()||state.saving)return;
    const f=state.finalBomReview,expected=f.info,base='/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId);
    f.busy=true;f.submitting=true;f.error='';state.saving=true;renderDetail();
    try{
      const latest=await fetchJson(base),info=await fetchJson(base+'/manual-bom/completion-info');
      if(info.candidateId!==expected.candidateId||info.revision!==expected.revision||info.evidenceFingerprint!==expected.evidenceFingerprint||info.expectedReviewToken!==expected.expectedReviewToken)throw new Error('The saved review changed. Reload checks and confirm the current information again.');
      const payload={candidate:latest.record.technicalReview.candidateBom,manualSource:{confirm:true,expectedReviewToken:info.expectedReviewToken,evidenceFingerprint:info.evidenceFingerprint,reviewNotes:f.reviewNotes||''}};
      const ready=await fetchJson(base+'/bom-completion-readiness',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!ready.ready)throw new Error(ready.message||'Resolve the remaining BOM checks.');
      await fetchJson(base+'/complete-bom-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      state.selected=await fetchJson(base);finishFinalBomReview();state.finalBomDraft=null;
    }catch(e){f.error=e.message;f.blocked=true;}
    finally{f.busy=false;f.submitting=false;state.saving=false;renderDetail();}
  }

  async function submitFinalBomReview() {
    if(state.selected.record.technicalReview.candidateBom?.manualDraft){await submitManualFinalBomReview();return;}
    if(!finalBomCanSubmit()||state.saving)return;
    const f=state.finalBomReview,expected=f.info,base='/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId);
    f.busy=true;f.submitting=true;f.error='';state.saving=true;renderDetail();
    const requireSame=info=>{if(info.candidateId!==f.candidateId||info.evidenceFingerprint!==expected.evidenceFingerprint||info.candidateFingerprint!==expected.candidateFingerprint){f.sourceConfirmed=false;f.documentsConfirmed=false;throw new Error('The source package or rows changed. Review the current information and confirm again.');}if(!info.rowsReviewed)throw new Error('Some rows require review. Return to the worksheet.');};
    try {
      let info=await fetchJson(base+'/vpro-source-decisions');requireSame(info);
      for(const [needed,action,notes] of [[!info.baselineCurrent,'APPROVE_BASELINE',f.sourceReason],[!info.discrepanciesCurrent,'COMPLETE_DISCREPANCIES',f.documentNotes]]){
        if(!needed)continue;
        if(action==='APPROVE_BASELINE'&&!f.sourceConfirmed||action==='COMPLETE_DISCREPANCIES'&&!f.documentsConfirmed)throw new Error('Confirm the remaining source and document decisions before accepting.');
        state.selected=await fetchJson(base+'/vpro-source-decisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:info.candidateId,expectedToken:info.token,action,confirm:true,notes})});
        info=await fetchJson(base+'/vpro-source-decisions');requireSame(info);f.info=info;
      }
      const latest=await fetchJson(base);state.selected=latest;
      info=await fetchJson(base+'/vpro-source-decisions');requireSame(info);
      const ready=await fetchJson(base+'/bom-completion-readiness',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate:latest.record.technicalReview.candidateBom})});
      if(!ready.ready)throw new Error(ready.message||'The BOM still has unresolved checks.');
      // This write occurs only after the explicit Confirm and accept BOM action above.
      state.selected=await fetchJson(base+'/complete-bom-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate:latest.record.technicalReview.candidateBom})});
      finishFinalBomReview();state.finalBomDraft=null;
    } catch(e){
      f.error=e.message+' Any successfully saved confirmations are retained; the BOM has not been confirmed as accepted.';
      try {
        const latest=await fetchJson(base);state.selected=latest;
        if(finalBomAccepted(latest.record,f.candidateId)){finishFinalBomReview();state.finalBomDraft=null;}
        else {const info=await fetchJson(base+'/vpro-source-decisions');try{requireSame(info);}catch(changed){f.error=changed.message;}f.info=info;f.blocked=false;}
      }catch(readError){f.blocked=true;f.error+=' Could not verify the saved result. Retry loading review before any further submission.';}
    } finally {f.busy=false;f.submitting=false;state.saving=false;renderDetail();}
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
    const ui=rowReviewUi(row), entries=(row.alternates||[]).filter(a=>!a.removedAtUtc);
    const resolved=a=>['CONFIRMED','APPROVED','NOT_APPROVED'].includes(a.reviewStatus);
    const pending=entries.filter(a=>!resolved(a));
    const selected=ui.alternateChoice??pending[0]?.id??entries[0]?.id??'';
    if(ui.alternateChoice===undefined&&selected)ui.alternateChoice=selected;
    const status=a=>a.reviewStatus==='NOT_APPROVED'?'Not Approved':resolved(a)?'Approved':'Awaiting decision';
    const saved=entries.find(a=>a.id===selected), current=ui.alternateDraft||saved;
    const record=state.selected.record, files=record.technicalFiles||[], disabled=state.saving?'disabled':'';
    const link=(id,label)=>'<a target="_blank" rel="noopener" href="/api/sim/rfq-intakes/'+encodeURIComponent(record.intakeId)+'/documents/'+encodeURIComponent(id)+'">'+escapeHtml(label)+'</a>';
    const evidence=e=>e?link(e.documentId,files.find(f=>f.documentId===e.documentId)?.name||'Open source')+' <span>'+escapeHtml([e.page?'page '+e.page:'',e.sheet,e.location].filter(Boolean).join(' / '))+'</span>':'No evidence supplied';
    const index=state.candidateIndex;
    return '<section class="candidate-alternates alternate-review-compact" aria-label="Alternate decision review">'+
      '<label>Alternate<select id="alternateChoice" title="'+escapeHtml(current?.partNumber||'Choose alternate')+'" '+disabled+'><option value="">Choose alternate</option>'+entries.map(a=>'<option value="'+escapeHtml(a.id)+'" '+(selected===a.id?'selected':'')+'>'+escapeHtml(a.partNumber)+'</option>').join('')+'<option value="ADD" '+(selected==='ADD'?'selected':'')+'>Add alternate</option></select></label>'+
      (selected?'<div class="alternate-inline-actions"><button data-technical-review-action="alternate-approve" '+disabled+'>Approve</button>'+(saved?'<button data-technical-review-action="alternate-not-approved" '+disabled+'>Not Approved</button>':'')+'<button data-technical-review-action="alternate-draft-cancel" '+disabled+'>Cancel edits</button></div><small class="alternate-saved-status" role="status">'+(saved?.reviewStatus==='APPROVED'?'Approved — choose it separately in Approved P/N. Row acceptance remains separate.':'Approval makes this exact part available in Approved P/N; it does not select or accept it.')+'</small>'+
      '<details '+(!saved?'open':'')+'><summary>Part details &amp; evidence</summary><label>Alternate P/N<input id="compactAlternateNumber" maxlength="200" value="'+escapeHtml(current?.partNumber||'')+'" '+disabled+'></label><label>Manufacturer (optional)<input id="compactAlternateManufacturer" maxlength="200" value="'+escapeHtml(current?.manufacturerName||'')+'" '+disabled+'></label><label>Decision note<input id="compactAlternateNote" maxlength="2000" value="'+escapeHtml(current?.note||'')+'" '+disabled+'></label>'+(saved?'<p>'+evidence(saved.sourceEvidence)+'</p><p>'+escapeHtml(saved.sourceContext||'')+'</p><p>'+escapeHtml(saved.uncertainty||'')+'</p>'+ (saved.supportingEvidence?'<p>Supporting: '+evidence(saved.supportingEvidence)+'</p>':'')+(saved.approvalEvidence?'<p>Approval evidence: '+evidence(saved.approvalEvidence)+'</p>':''):'')+'</details>':'')+'</section>';
  }

  async function saveCompactAlternate(approve=true) {
    if(state.saving)return;
    const bom=state.selected.record.technicalReview.candidateBom,row=bom.rows[state.candidateIndex],choice=rowReviewUi(row).alternateChoice;
    rememberPrimaryInputs(row);
    const alternateChange={action:approve?'APPROVE':'EDIT',reviewStatus:approve?'APPROVED':'NOT_APPROVED',id:choice==='ADD'?null:choice,expectedRevision:row.alternateRevision||0,partNumber:document.getElementById('compactAlternateNumber').value,manufacturerName:document.getElementById('compactAlternateManufacturer').value,note:document.getElementById('compactAlternateNote').value};
    state.candidateDraft=Object.fromEntries(Object.keys(candidateFields).map(k=>[k,(document.getElementById('candidate-'+k)?.value??state.candidateDraft?.[k]??row.values[k])]));state.saving=true;
    try {state.selected=await fetchJson('/api/sim/technical-reviews/'+encodeURIComponent(state.selected.record.intakeId)+'/candidate-bom',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:bom.id,rowIndex:row.index,alternateChange})});delete rowReviewUi(row).alternateDraft;const savedRow=state.selected.record.technicalReview.candidateBom.rows[state.candidateIndex];rowReviewUi(row).alternateChoice=choice==='ADD'?(savedRow.alternates||[]).find(a=>!a.removedAtUtc&&a.partNumber===alternateChange.partNumber.trim())?.id||'':choice;state.message=approve?'Alternate decision saved: Approved. Row acceptance is still separate.':'Alternate decision saved: Not Approved. Row acceptance is still separate.';state.messageState='';}
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
      state.finalReviewRoundtrip = payload.finalReviewRoundtrip===true;
      state.rfqProjectHandoff = payload.rfqProjectHandoff===true;
      state.completedItems = state.rfqProjectHandoff && Array.isArray(payload.completedItems) ? payload.completedItems : [];
      if(!state.rfqProjectHandoff)state.queueBucket='ACTIVE';
      renderQueue();
    } catch (_) { /* saved detail remains authoritative for this view */ }
  }

  async function fetchJson(url, options) {
    if (completedReview(state.selected?.record) && options?.method && options.method !== 'GET') throw new Error('Completed Technical Review is read-only.');
    const response = await window.fetch(url, { credentials: "include", cache: "no-store", ...(options || {}) });
    let body = null;
    try { body = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok) throw new Error(body?.message || "SIM returned HTTP " + response.status + ".");
    if(body?.record?.intakeId===state.selected?.record?.intakeId&&body.sourceSetupAvailable===undefined&&state.selected?.sourceSetupAvailable){body.sourceSetupAvailable=true;body.sourceSetupToken=state.selected.sourceSetupToken;}
    return body;
  }

  function setStatus(message, status) {
    const target = document.getElementById("technicalReviewWorkspaceStatus");
    if (!target) return;
    target.textContent = message;
    target.dataset.state = status || "";
  }

  function documentStateLabel(value) { if (value === "BINARIES_VERIFIED_SIM") return "Verified SIM files"; return value === "METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED" ? "Metadata preserved · source placement required" : value === "NOT_PROVIDED" ? "Not provided" : value || "Unknown"; }
  function formatDateTime(value) { const date = new Date(value); return (window.DleDateFormat?.dateTime(value,{empty:value || "—"}) ?? (Number.isNaN(date.getTime()) ? value || "—" : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" }))); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }

  window.addEventListener?.('focus',()=>{void refreshSubmissionState();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshSubmissionState();});
  window.addEventListener?.('beforeunload', event => {
    if(partRequestReview?.dirty||partRequestReview?.busy||sourceChoicesDirty()||state.scanSheetDirty||(state.scanEdit&&state.scanEdit.input.value!==state.scanEdit.before)){event.preventDefault();event.returnValue='';}
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
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({ id: WORKSPACE_ID, render: renderWorkspace, refresh: loadQueue, openReview, canReturnToQueue, returnToQueue });
})(window, document);

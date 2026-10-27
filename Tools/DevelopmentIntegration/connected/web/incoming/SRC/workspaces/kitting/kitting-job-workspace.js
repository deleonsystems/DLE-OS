(function registerKittingJobWorkspace(window, document) {
  'use strict';

  const TEMPLATE_PATH = '/incoming/SRC/workspaces/kitting/kitting-job-workspace.html';
  const RELEASED_BOM_RETURN_PARAMETER = 'dleKittingReportReturn';
  const RELEASED_BOM_RETURN_STORAGE_PREFIX = 'dle-os:kitting-released-bom:return:';
  const originalLocations = new Map();
  let activePrimaryTool = null;
  let coordinatingPrimaryTools = false;
  let pendingNavigation = null;
  let navigationResolutionBusy = false;
  const primaryIds = [
    'workOrderDashboardReleasedBom',
    'workOrderDashboardKitReleasedBom',
    'workOrderDashboardKittingCaseSummary',
    'workOrderDashboardKittedBomPlaceholder',
    'workOrderDashboardKittedBomEvidence'
  ];

  async function loadKittingJobWorkspace() {
    const placeholder = document.getElementById('kittingJobWorkspace');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;
    const response = await window.DleIntegration.request(TEMPLATE_PATH, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load Kitting Job Workspace.');
    placeholder.outerHTML = await response.text();
  }

  function initializeKittingJobWorkspace() {
    rememberOriginalLocations();
    const workspace = document.getElementById('kittingJobWorkspace');
    if (workspace && workspace.dataset.reportAuthorizationBound !== 'true') {
      workspace.dataset.reportAuthorizationBound = 'true';
      document.addEventListener('dle:capabilities-ready', event => applyReportVisibility(event.detail));
    }
    if (workspace && workspace.dataset.focusedLayoutBound !== 'true') {
      workspace.dataset.focusedLayoutBound = 'true';
      window.addEventListener('resize', updateFocusedModeLayout);
    }
    bindNavigationGuard();
    applyReportVisibility();
  }

  function bindNavigationGuard() {
    const dialog = document.getElementById('kittingNavigationGuard');
    if (!dialog || dialog.dataset.bound === 'true') return;
    dialog.dataset.bound = 'true';
    dialog.querySelectorAll('[data-kitting-navigation-choice]').forEach(button => {
      button.addEventListener('click', () => resolveKittingNavigation(button.dataset.kittingNavigationChoice));
    });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      cancelKittingNavigation();
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) cancelKittingNavigation();
    });
  }

  function requestKittingNavigation(action) {
    if (typeof action !== 'function' ||
        window.WorkOrderDashboardModule?.isActiveKittingEditing?.() !== true) return false;
    if (pendingNavigation) return true;
    const dialog = document.getElementById('kittingNavigationGuard');
    if (!dialog?.showModal) return false;
    pendingNavigation = action;
    window.WorkOrderDashboardModule.pauseActiveKittingAutosaveForNavigation?.();
    setNavigationGuardError('');
    setNavigationGuardBusy(false);
    dialog.showModal();
    dialog.querySelector('[data-kitting-navigation-choice="save"]')?.focus();
    return true;
  }

  function cancelKittingNavigation() {
    if (navigationResolutionBusy || !pendingNavigation) return false;
    pendingNavigation = null;
    window.WorkOrderDashboardModule?.resumeActiveKittingAutosaveAfterNavigationCancel?.();
    const dialog = document.getElementById('kittingNavigationGuard');
    if (dialog?.open) dialog.close();
    return true;
  }

  async function resolveKittingNavigation(choice) {
    if (choice === 'cancel') return cancelKittingNavigation();
    if (navigationResolutionBusy || !pendingNavigation || !['save', 'leave'].includes(choice)) return false;
    navigationResolutionBusy = true;
    setNavigationGuardBusy(true);
    setNavigationGuardError('');
    const module = window.WorkOrderDashboardModule;
    const completed = choice === 'save'
      ? await module?.saveAndExitActiveKitting?.()
      : await module?.abandonActiveKittingWithoutSaving?.();
    if (!completed) {
      navigationResolutionBusy = false;
      setNavigationGuardBusy(false);
      setNavigationGuardError(module?.getActiveKittingSaveState?.() ||
        'Unable to leave Kitting. Stay here and try again.');
      return false;
    }
    const navigate = pendingNavigation;
    pendingNavigation = null;
    const dialog = document.getElementById('kittingNavigationGuard');
    if (dialog?.open) dialog.close();
    navigationResolutionBusy = false;
    setNavigationGuardBusy(false);
    await Promise.resolve().then(navigate);
    return true;
  }

  function setNavigationGuardBusy(busy) {
    const dialog = document.getElementById('kittingNavigationGuard');
    dialog?.querySelectorAll('[data-kitting-navigation-choice]').forEach(button => {
      button.disabled = busy;
    });
  }

  function setNavigationGuardError(message) {
    const error = document.getElementById('kittingNavigationGuardError');
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  }

  function rememberOriginalLocations() {
    [...primaryIds, 'workOrderDashboardActiveKitting'].forEach(remember);
    rememberSection('[data-work-order-dashboard-section="kitting-workspace"]', 'legacyKittingWorkspaceSection');
  }

  function remember(id) {
    const node = document.getElementById(id);
    if (node && !originalLocations.has(id)) {
      originalLocations.set(id, { node, parent: node.parentNode, next: node.nextSibling });
    }
  }

  function rememberSection(selector, key) {
    const node = document.querySelector(selector);
    if (node && !originalLocations.has(key)) {
      originalLocations.set(key, { node, parent: node.parentNode, next: node.nextSibling });
    }
  }

  function setPresentationMode(mode) {
    rememberOriginalLocations();
    if (mode === 'kitting-job') mountDedicatedSurface();
    else restoreDashboardSurface();
  }

  function mountDedicatedSurface() {
    const actions = document.getElementById('kittingJobPrimaryActions');
    const releasedBom = document.getElementById('kittingJobReleasedBomReport');
    const active = document.getElementById('kittingJobActiveCase');
    const documents = document.getElementById('kittingJobDocumentHistory');
    const development = document.getElementById('kittingJobDevelopmentHistory');
    const disposition = document.getElementById('kittingJobDispositionHistory');
    if (!actions || !releasedBom || !active || !documents || !development || !disposition) return;
    prependById(actions, 'workOrderDashboardKitReleasedBom');
    appendById(releasedBom, 'workOrderDashboardReleasedBom');
    primaryIds.slice(3).forEach(id => appendById(documents, id));
    if (!document.getElementById('workOrderDashboardActiveKitting')?.closest('.job-instruction-viewer'))
      appendById(productionSlidesOpen ? document.getElementById('kittingProductionBom') : active, 'workOrderDashboardActiveKitting');
    initializeProductionSlides();
    const legacy = originalLocations.get('legacyKittingWorkspaceSection')?.node;
    if (legacy) disposition.appendChild(legacy);
    applyReportVisibility();
  }

  let startingSlides = false;
  let legacyInstructionWorkOrder = '';
  async function startKitting() {
    if (!['SIM', 'SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)) return false;
    if (startingSlides) return false;
    startingSlides = true;
    try {
      const wo = clean(window.WorkOrderDashboardModule?.getSelectedHandoff?.()?.workOrderNumber);
      const probe = await window.DleIntegration.request('/api/production/v1/work-orders/' + encodeURIComponent(wo) + '/instructions', {credentials:'same-origin',cache:'no-store'});
      if (probe.status === 404) {
        // Legacy jobs without accepted instruction decks retain their governed form.
        legacyInstructionWorkOrder = wo;
        document.getElementById('kittingJobWorkspace')?.classList.remove('uses-production-slides');
        return await window.WorkOrderDashboardModule.openActiveKitting();
      }
      if (!probe.ok) throw Error('Production Slides unavailable (' + probe.status + '). Please retry.');
      const opened = await window.WorkOrderDashboardModule.openActiveKitting();
      if (!opened) throw Error(window.WorkOrderDashboardModule.getActiveKittingSaveState?.() || 'Kitting could not start or resume. Please retry.');
      toggleProductionSlides(true);
      return true;
    } catch (error) {
      window.alert(error.message || 'Kitting could not open.');
      return false;
    } finally { startingSlides = false; }
  }
  let productionSlidesOpen = false;
  let productionSlide = 0;
  let productionSlideWorkOrder = '';

  function toggleProductionSlides(forceOpen) {
    if (!['SIM', 'SIMULATION'].includes(window.DleOsRuntimeConfig?.environment)) return false;
    const open = typeof forceOpen === 'boolean' ? forceOpen : !productionSlidesOpen;
    const panel = document.getElementById('kittingProductionSlides');
    const active = document.getElementById('workOrderDashboardActiveKitting');
    if (!panel || !active) return false;
    productionSlidesOpen = open;
    if (!open) { previewLoad++; setPrimaryTool('kitting', false); }
    document.getElementById('kittingJobWorkspace')?.classList.toggle('has-production-slides', open);
    document.getElementById('kittingProductionSlidesToggle')?.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    // Move the actual form. Its draft, events, dialogs, lease and save actions remain owned by Kitting.
    document.getElementById(open ? 'kittingProductionBom' : 'kittingJobActiveCase')?.appendChild(active);
    if (open) {
      productionSlide = 0;
      productionSlideWorkOrder = clean(window.WorkOrderDashboardModule?.getSelectedHandoff?.()?.workOrderNumber);
      closeReportsPanel();
      showProductionSlide(0);
      void loadAcceptedProductionPreview();
      panel.scrollIntoView({ block: 'start' });
    }
    return open;
  }

  function showProductionSlide(index) {
    productionSlide = Math.max(0, Math.min(document.querySelectorAll('[data-kitting-production-slide]').length - 1, Number(index) || 0));
    document.querySelectorAll('[data-kitting-production-slide]').forEach(node => {
      node.hidden = Number(node.dataset.kittingProductionSlide) !== productionSlide;
    });
    const picker = document.getElementById('kittingProductionSlidePicker');
    if (picker) picker.value = String(productionSlide);
    document.getElementById('kittingProductionPrevious').disabled = productionSlide === 0;
    document.getElementById('kittingProductionNext').disabled = productionSlide === document.querySelectorAll('[data-kitting-production-slide]').length - 1;
    setText('kittingProductionSlideCount', (productionSlide + 1) + ' / ' + document.querySelectorAll('[data-kitting-production-slide]').length);
    refreshProductionTraveler();
    const selected = document.querySelector('[data-kitting-production-slide="' + productionSlide + '"][data-accepted-drawing]');
    if (selected) void renderAcceptedDrawing(selected);
  }

  let previewLoad = 0;
  const previewScripts = new Map();
  async function previewScript(name, global) {
    if (window[global]) return;
    if (!previewScripts.has(name)) previewScripts.set(name, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/incoming/SRC/workspaces/rfqs/' + name + '.js';
      script.onload = resolve;
      script.onerror = () => { previewScripts.delete(name); script.remove(); reject(Error('The existing traveler renderer could not load. Reopen to retry.')); };
      document.head.append(script);
    }));
    await previewScripts.get(name);
  }
  async function previewJson(url) {
    const response = await window.DleIntegration.request(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw Error('Accepted source unavailable (' + response.status + '). This preview requires access to the retained accepted order and technical documents.');
    return response.json();
  }
  function previewRequire(ok, message) { if (!ok) throw Error(message); }
  function stepProductionSlide(delta) { showProductionSlide(productionSlide + delta); }
  function refreshProductionTraveler() {
    if (productionSlidesOpen) {
      const empty = document.getElementById('kittingProductionBomEmpty');
      if (empty) empty.hidden = !document.getElementById('workOrderDashboardActiveKitting')?.hidden;
    }
  }
  async function loadAcceptedProductionPreview() {
    const ticket = ++previewLoad;
    const host = document.getElementById('kittingProductionSlides');
    host.querySelectorAll('[data-accepted-drawing]').forEach(node => node.remove());
    const picker = document.getElementById('kittingProductionSlidePicker');
    while (picker.options.length > 2) picker.remove(2);
    showProductionSlide(0);
    const frame = document.getElementById('kittingAcceptedTraveler');
    frame.removeAttribute('srcdoc');
    setText('kittingAcceptedSource', 'Loading the retained accepted Labor plan and verified drawing references...');
    try {
      const wo = productionSlideWorkOrder;
      previewRequire(/^\d{7}$/.test(wo), 'Select a canonical work order.');
      const job = await previewJson('/api/production/v1/work-orders/' + wo);
      const order = await previewJson('/api/quoting/v1/order-entry/' + encodeURIComponent(job.source.acceptedIntakeId));
      const acceptance = order.orderEntry?.acceptance, baseline = acceptance?.package?.technicalSource?.baseline;
      previewRequire(acceptance && baseline && acceptance.id === job.source.acceptanceId &&
        acceptance.packageRevision === job.source.acceptedRevision && acceptance.sourceToken === job.source.sourceToken,
        'The accepted order does not match this work order. No substitute traveler was loaded.');
      previewRequire(order.orderEntry.bridge?.state?.identifiers?.workOrder === wo, 'The accepted order is linked to a different work order.');
      const labor = baseline.labor, line = acceptance.package.facts.lines[0];
      previewRequire(labor.version === job.source.laborVersion && labor.definitionId === job.source.manufacturingDefinitionId &&
        baseline.quote.approvalId === job.source.quoteApprovalId && baseline.quote.approvalVersion === job.source.quoteApprovalVersion &&
        line.assembly === job.context.assembly && line.revision === job.context.revision && labor.quantity === job.context.quantity,
        'Accepted Labor identity or quantity changed. Reopen after source review.');
      await previewScript('labor-workbench', 'DleLaborWorkbench');
      await previewScript('labor-traveler-print', 'DleLaborTravelerPrint');
      await previewScript('labor-drawing-notes', 'DleLaborDrawingNotes');
      const plan = { ...labor, revision: labor.version };
      const rfq = { customer: order.customer, assemblies: [{ assemblyNumber: line.assembly, revision: line.revision, description: line.description || '' }] };
      // Use the actual Labor traveler builder. Only identity/release labels differ for this accepted preview.
      const material = await window.DleLaborTravelerPrint.loadMaterialEvidence(wo);
      const definition = window.DleLaborTravelerPrint.build(plan, rfq, window.DleLaborWorkbench, {material});
      const doc = new DOMParser().parseFromString(definition.html, 'text/html');
      doc.querySelector('.quote-header h1').textContent = 'ACCEPTED INSTRUCTION PREVIEW';
      doc.querySelector('.quote-header p').textContent = 'Not a released production traveler';
      const fields = doc.querySelectorAll('.quote-field strong');
      fields[0].textContent = order.orderEntry.bridge.state.identifiers.salesOrder;
      fields[1].textContent = wo;
      fields[2].textContent = acceptance.package.poNumber;
      doc.querySelector('.quote-facts th').textContent = 'Order Qty';
      doc.querySelectorAll('.quote-repeat span').forEach(node => { node.textContent = node.textContent.replace('PRELIMINARY / QUOTE', 'ACCEPTED PREVIEW'); });
      doc.querySelector('.quote-footer').textContent = 'Accepted Labor v' + labor.version + ' — not a production release.  Kitting status is from the saved case; completion requires a retained Kit Complete submission. Production completion is not recorded by viewing instructions.';
      if (ticket !== previewLoad || !productionSlidesOpen) return;
      frame.srcdoc = '<!doctype html><html><head><base href="' + escapeHtml(document.baseURI) + '"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + definition.css + '</style></head><body><div class="dle-print-page">' + doc.body.innerHTML + '</div></body></html>';
      const sourceLabel = 'Accepted order ' + order.intakeId + ', revision ' + acceptance.packageRevision + ' · Labor v' + labor.version + ' · ' +
        (job.boundTraveler ? 'Accepted instructions shown; a separately bound production traveler exists.' : 'No production traveler is bound to this job.');
      setText('kittingAcceptedSource', sourceLabel);
      await previewScript('../kitting/production-instruction-editor', 'DleJobInstructions');
      if(await window.DleJobInstructions.open({wo,job,order,frame,material,trigger:document.getElementById(document.getElementById('kittingProductionSlidesToggle')?.hidden?'workOrderDashboardKitReleasedBom':'kittingProductionSlidesToggle')}))return;
      const references = new Map((job.technicalDocuments || []).map(ref => [ref.documentId, ref]));
      let index = 2;
      for (const operation of labor.operations) for (const card of operation.slides || []) {
        if (card.kind !== 'DRAWING') continue;
        const ref = references.get(card.source?.documentId);
        previewRequire(ref && ref.sha256 === card.source.sha256 && card.source.definitionId === labor.definitionId,
          'A frozen drawing reference no longer matches the verified job source. Remaining drawing slides were not loaded.');
        for (const [stageIndex, stage] of (card.stages || []).entries()) {
          const section = document.createElement('section');
          section.dataset.kittingProductionSlide = String(index);
          section.dataset.acceptedDrawing = card.id;
          section.hidden = true;
          const title = operation.name + ' · ' + ref.name + ' · p' + card.page + ' · stage ' + (stageIndex + 1);
          section.innerHTML = '<p class="kitting-production-note">' + escapeHtml(title) + '<br>' + escapeHtml(sourceLabel) + '</p><p data-drawing-status role="status">Verified accepted drawing; loading when selected.</p><iframe sandbox="allow-same-origin" class="kitting-accepted-document" title="' + escapeHtml(title) + '"></iframe>';
          section.acceptedDrawing = { ref, card, stage, sourceRfq: baseline.quote.intakeId, title };
          host.append(section);
          picker.add(new Option(title, String(index++)));
        }
      }
      showProductionSlide(productionSlide);

    } catch (error) {
      if (ticket === previewLoad && productionSlidesOpen) setText('kittingAcceptedSource', error.message);
    }
  }
  async function renderAcceptedDrawing(section) {
    if (!section || section.dataset.loading === 'true' || section.querySelector('iframe')?.hasAttribute('srcdoc')) return;
    section.dataset.loading = 'true';
    const { ref, card, stage, sourceRfq, title } = section.acceptedDrawing;
    const status = section.querySelector('[data-drawing-status]');
    try {
      // The existing page endpoint verifies these exact PDF bytes on every request.
      // No mutable Labor plan or annotation endpoint is read.
      const base = '/api/quoting/v1/rfqs/' + encodeURIComponent(sourceRfq) + '/labor/drawing-notes/pages/' + encodeURIComponent(ref.documentId) + '/' + encodeURIComponent(ref.sha256);
      const pages = await previewJson(base + '/info');
      previewRequire(card.page >= 1 && card.page <= pages.pageCount, 'The accepted drawing page is unavailable.');
      previewRequire(!(stage.photos || []).length, 'This stage needs a verified photo mapping before display.');
      const response = await window.DleIntegration.request(base + '/' + card.page, { credentials: 'same-origin', cache: 'no-store' });
      previewRequire(response.ok, 'The exact accepted drawing page could not be rendered.');
      const blob = await response.blob();
      previewRequire(blob.type.startsWith('image/'), 'The exact drawing renderer returned no image.');
      const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      const image = new Image(); image.src = url; await image.decode();
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), group = document.createElementNS(ns, 'g');
      const paper = { width: image.naturalWidth, height: image.naturalHeight };
      svg.setAttribute('viewBox', '0 0 960 624'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', title);
      const matrix = window.DleLaborDrawingNotes.transform(stage.savedView, paper, { width: 960, height: 624 });
      group.setAttribute('transform', 'matrix(' + [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(' ') + ')');
      const baseImage = document.createElementNS(ns, 'image'); baseImage.setAttribute('href', url);
      baseImage.setAttribute('width', paper.width); baseImage.setAttribute('height', paper.height); group.append(baseImage); svg.append(group);
      for (const mark of stage.marks || []) if (mark.page === card.page) window.DleLaborDrawingNotes.appendMark(group, mark, paper);
      section.querySelector('iframe').srcdoc = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:white;color:#172d3d;font:14px Arial}svg{display:block;width:100%;height:auto}p{padding:12px}</style></head><body><p>Accepted instruction preview — not a production release</p>' + (card.body ? '<p>' + escapeHtml(card.body) + '</p>' : '') + svg.outerHTML + '</body></html>';
      status.textContent = 'Verified accepted drawing · page ' + card.page;
      status.title = 'PDF SHA-256 ' + ref.sha256 + ' · frozen stage ' + stage.id;
    } catch (error) { status.textContent = error.message + ' Select this slide again to retry.'; }
    finally { section.dataset.loading = 'false'; }
  }

  const completedDeckAccess = new Map();
  async function refreshCompletedSlidesEntry() {
    const bar = document.getElementById('kittingProductionViewBar');
    if (!bar) return;
    const wo = clean(window.WorkOrderDashboardModule?.getSelectedHandoff?.()?.workOrderNumber);
    const eligible = () => ['SIM', 'SIMULATION'].includes(window.DleOsRuntimeConfig?.environment) &&
      wo === clean(window.WorkOrderDashboardModule?.getSelectedHandoff?.()?.workOrderNumber) &&
      document.getElementById('kittingJobMaterialStatus')?.dataset.status === 'KIT_COMPLETE';
    bar.hidden = true;
    const button = document.getElementById('kittingProductionSlidesToggle');
    const workspace = document.getElementById('kittingJobWorkspace');
    if (button) button.hidden = true;
    workspace?.classList.remove('completed-slides-entry');
    if (!eligible() || !/^\d{7}$/.test(wo)) return;
    if (!completedDeckAccess.has(wo)) completedDeckAccess.set(wo,
      window.DleIntegration.request('/api/production/v1/work-orders/' + encodeURIComponent(wo) + '/instructions',
        {credentials:'same-origin',cache:'no-store'})
        .then(async response => { if (!response.ok) return false; const deck = await response.json(); return Array.isArray(deck.operations) && deck.operations.length > 0; })
        .catch(() => false));
    const allowed = await completedDeckAccess.get(wo);
    if (eligible() && allowed && button) {
      const action = document.getElementById('workOrderDashboardKitReleasedBom');
      action?.parentNode?.insertBefore(button, action);
      button.innerHTML = '<strong>Production Slides</strong><span>View completed kit instructions</span>';
      button.hidden = false;
      workspace?.classList.add('completed-slides-entry');
    }
  }

  function initializeProductionSlides() {
    const sim = ['SIM', 'SIMULATION'].includes(window.DleOsRuntimeConfig?.environment);
    void refreshCompletedSlidesEntry();
    const statusBadge = document.getElementById('kittingJobMaterialStatus');
    if (statusBadge && !statusBadge.dataset.slidesEntryObserved) {
      statusBadge.dataset.slidesEntryObserved = 'true';
      new MutationObserver(refreshCompletedSlidesEntry).observe(statusBadge, {attributes:true,attributeFilter:['data-status']});
    }
    document.getElementById('kittingJobWorkspace')?.classList.toggle('uses-production-slides', sim && legacyInstructionWorkOrder !== clean(window.WorkOrderDashboardModule?.getSelectedHandoff?.()?.workOrderNumber));
    if (sim) {
      const action = document.getElementById('workOrderDashboardKitReleasedBom');
      if (action) action.setAttribute('onclick', 'KittingJobWorkspace.startKitting()');
    }
    const active = document.getElementById('workOrderDashboardActiveKitting');
    if (active && active.dataset.slidesObserved !== 'true' && typeof window.MutationObserver === 'function') {
      active.dataset.slidesObserved = 'true';
      new window.MutationObserver(refreshProductionTraveler).observe(active, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    }
  }

  function canViewDevelopmentReports(capabilities = window.DleOsCapabilities) {
    return window.DleOsRuntimeConfig?.environment === 'ISOLATED_DEVELOPMENT' &&
      capabilities?.isSuperAdmin === true;
  }

  function applyReportVisibility(capabilities = window.DleOsCapabilities) {
    const development = document.getElementById('kittingJobDevelopmentReports');
    if (!development) return false;
    const visible = canViewDevelopmentReports(capabilities);
    development.hidden = !visible;
    if (!visible) development.open = false;
    return visible;
  }

  function closeReportsPanel() {
    const reports = document.getElementById('kittingJobReports');
    const toggle = document.getElementById('kittingJobReportsToggle');
    if (reports) reports.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function closePrintLabelsPanel() {
    const menu = document.querySelector('#kittingJobWorkspace .kitting-job-action-slot .kitting-label-menu');
    if (menu) menu.open = false;
  }

  function updatePrimaryToolPresentation() {
    const workspace = document.getElementById('kittingJobWorkspace');
    const kitting = document.getElementById('workOrderDashboardKitReleasedBom');
    const reports = document.getElementById('kittingJobReportsToggle');
    const printMenu = document.querySelector('#kittingJobWorkspace .kitting-job-action-slot .kitting-label-menu');
    const printSummary = printMenu?.querySelector('summary');
    if (workspace) workspace.dataset.activePrimaryTool = activePrimaryTool || '';
    if (workspace) workspace.classList.toggle('is-focused-kitting', activePrimaryTool === 'kitting' && !workspace.classList.contains('uses-production-slides'));
    [[kitting, 'kitting'], [reports, 'reports'], [printMenu, 'print-labels']].forEach(([control, tool]) => {
      control?.classList.toggle('is-active', activePrimaryTool === tool);
    });
    if (kitting) kitting.setAttribute('aria-pressed', String(activePrimaryTool === 'kitting'));
    if (printSummary) printSummary.setAttribute('aria-expanded', String(activePrimaryTool === 'print-labels'));
    updateFocusedModeLayout();
  }

  function updateFocusedModeLayout() {
    const workspace = document.getElementById('kittingJobWorkspace');
    if (!workspace?.classList.contains('is-focused-kitting')) return false;
    const globalHeader = document.querySelector('body > header.dle-app-header');
    const stickyTop = Math.max(0, Math.ceil(globalHeader?.getBoundingClientRect?.().height || 0));
    workspace.style?.setProperty('--kitting-focused-sticky-top', stickyTop + 'px');
    return true;
  }

  function refreshPrimaryToolPresentation() {
    const printMenu = document.querySelector('#kittingJobWorkspace .kitting-job-action-slot .kitting-label-menu');
    if (activePrimaryTool === 'print-labels' && printMenu) printMenu.open = true;
    updatePrimaryToolPresentation();
    return activePrimaryTool;
  }

  function setPrimaryTool(tool, open = true) {
    if (!['kitting', 'print-labels', 'reports'].includes(tool)) return activePrimaryTool;
    if (open && activePrimaryTool === 'kitting' && tool !== 'kitting' && !document.getElementById('kittingJobWorkspace')?.classList.contains('uses-production-slides')) {
      closeReportsPanel();
      closePrintLabelsPanel();
      updatePrimaryToolPresentation();
      return activePrimaryTool;
    }
    if (coordinatingPrimaryTools) {
      if (!open && activePrimaryTool === tool) activePrimaryTool = null;
      return activePrimaryTool;
    }
    coordinatingPrimaryTools = true;
    try {
      if (open) {
        if (tool !== 'reports') closeReportsPanel();
        if (tool !== 'print-labels') closePrintLabelsPanel();
        if (tool === 'print-labels') {
          const currentMenu = document.querySelector('#kittingJobWorkspace .kitting-job-action-slot .kitting-label-menu');
          if (currentMenu) currentMenu.open = true;
        }
        activePrimaryTool = tool;
      } else if (activePrimaryTool === tool) {
        activePrimaryTool = null;
      }
      updatePrimaryToolPresentation();
      return activePrimaryTool;
    } finally {
      coordinatingPrimaryTools = false;
    }
  }

  function handlePrintLabelsToggle(menu) {
    if (!menu?.closest('#kittingJobWorkspace')) return false;
    if (productionSlidesOpen) return menu.open;
    setPrimaryTool('print-labels', menu.open);
    return menu.open;
  }

  function toggleReports(forceOpen) {
    const reports = document.getElementById('kittingJobReports');
    const toggle = document.getElementById('kittingJobReportsToggle');
    if (!reports || !toggle) return false;
    const open = typeof forceOpen === 'boolean' ? forceOpen : reports.hidden;
    const selectedTool = setPrimaryTool('reports', open);
    const reportsOpen = open && selectedTool === 'reports';
    reports.hidden = !reportsOpen;
    toggle.setAttribute('aria-expanded', String(reportsOpen));
    if (reportsOpen) reports.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return reportsOpen;
  }

  function appendById(parent, id) {
    const node = originalLocations.get(id)?.node || document.getElementById(id);
    if (node) parent.appendChild(node);
  }

  function prependById(parent, id) {
    const node = originalLocations.get(id)?.node || document.getElementById(id);
    if (node) parent.prepend(node);
  }

  function restoreDashboardSurface() {
    if (productionSlidesOpen) toggleProductionSlides(false);
    Array.from(originalLocations.values()).forEach(location => {
      if (!location.parent?.isConnected || !location.node) return;
      if (location.next?.parentNode === location.parent) location.parent.insertBefore(location.node, location.next);
      else location.parent.appendChild(location.node);
    });
  }

  function open(handoff) {
    completedDeckAccess.delete(clean(handoff?.workOrderNumber));
    if (productionSlidesOpen) toggleProductionSlides(false);
    if (!handoff || typeof window.WorkOrderDashboardModule?.setSelectedWorkOrder !== 'function' || typeof window.go !== 'function') {
      return false;
    }
    window.DleWorkspaceShell?.setWorkspaceView?.('kitting');
    window.WorkOrderDashboardModule.setSelectedWorkOrder({ ...handoff, preferredPresentation: 'kitting-job' });
    window.go('kittingJobWorkspace');
    activePrimaryTool = null;
    closePrintLabelsPanel();
    toggleReports(false);
    return true;
  }

  function createReleasedBomReturnPath(handoff) {
    const fallback = window.location.pathname + window.location.search + window.location.hash;
    if (!handoff) return fallback;
    const token = window.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    try {
      window.sessionStorage.setItem(RELEASED_BOM_RETURN_STORAGE_PREFIX + token, JSON.stringify(handoff));
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set(RELEASED_BOM_RETURN_PARAMETER, token);
      return returnUrl.pathname + returnUrl.search + returnUrl.hash;
    } catch (_error) {
      return fallback;
    }
  }

  function restoreReleasedBomReturn() {
    const returnUrl = new URL(window.location.href);
    const token = returnUrl.searchParams.get(RELEASED_BOM_RETURN_PARAMETER);
    if (!token) return false;
    returnUrl.searchParams.delete(RELEASED_BOM_RETURN_PARAMETER);
    window.history.replaceState(null, '', returnUrl.pathname + returnUrl.search + returnUrl.hash);
    let handoff = null;
    try {
      const storageKey = RELEASED_BOM_RETURN_STORAGE_PREFIX + token;
      handoff = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null');
      window.sessionStorage.removeItem(storageKey);
    } catch (_error) {
      handoff = null;
    }
    return handoff ? open(handoff) : false;
  }

  function render(payload) {
    const selection = payload?.selection || null;
    if (!selection) return;
    if (productionSlidesOpen && productionSlideWorkOrder !== clean(selection.workOrderNumber)) toggleProductionSlides(false);
    initializeProductionSlides();
    const canonical = selection.canonicalWorkOrder || {};
    setText('kittingJobWorkOrder', clean(selection.workOrderNumber || selection.official?.workOrder) || 'Work Order');
    const item = clean(selection.itemNumber || canonical.itemNumber || selection.official?.partNumber) || 'Assembly not selected';
    const revision = clean(canonical.drawingRevision || canonical.bomRevision || canonical.revision || canonical.revisionLevel || selection.revision);
    setText('kittingJobAssembly', item + (revision ? ' Rev ' + revision : ''));
    setText('kittingJobQuantity', formatQuantity(selection.workOrderQuantity ?? canonical.schProdQuantity ?? selection.originQuantity));
    setText('kittingJobDueDate', formatKittingJobDueDate(selection.originDueDate || selection.official?.dueDate));
    setText('kittingJobCustomer', clean(selection.originCustomerName || selection.official?.customer) || 'N/A');
    setText('kittingJobSalesOrder', formatSalesOrder(selection));
    setText('kittingJobCustomerPo', clean(selection.originCustomerPurchaseOrderNumber || canonical.customerPurchaseOrderNumber || selection.official?.customerPo) || 'N/A');
    setText('kittingJobCanonicalAnchor', formatCanonicalAnchor(selection));
    setText('kittingJobRelationship', clean(selection.relationshipStatus) || 'N/A');
    setText('kittingJobGoverningSource', clean(selection.governingSource) || 'N/A');
    const materialStatus = materialStatusLabel(payload.materialStatus || selection.materialStatusProjection || selection.materialStatus);
    setText('kittingJobMaterialStatus', materialStatus);
    const badge = document.getElementById('kittingJobMaterialStatus');
    if (badge) badge.dataset.status = normalizeStatus(payload.materialStatus || selection.materialStatusProjection || selection.materialStatus);
    void refreshCompletedSlidesEntry();
    renderRelatedRows(payload.relatedRows || selection.relatedRows || []);
    refreshProductionTraveler();
  }

  function renderRelatedRows(rows) {
    setText('kittingJobReleaseCount', String(rows.length));
    const body = document.getElementById('kittingJobRelatedRows');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6">No scheduled releases loaded.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(row => {
      const official = row.official || row;
      const master = row.masterRecord || {};
      return '<tr><td>' + escapeHtml(official.workOrder || '') + '</td><td>' + escapeHtml(official.partNumber || '') +
        '</td><td>' + escapeHtml(official.revision || master.vpro5?.revision || master.dle?.revision || master.revision || master.revisionLevel || '') + '</td><td>' +
        escapeHtml(official.opQtyOpen || official.quantityOrdered || '') + '</td><td>' + escapeHtml(formatKittingJobDueDate(official.dueDate, '')) +
        '</td><td>' + escapeHtml(official.operationalStatus || official.status || master.status || master.workOrderStatus || '') + '</td></tr>';
    }).join('');
  }

  function returnToQueue() {
    return window.WorkOrderDashboardModule?.returnToKitting?.() || false;
  }

  function formatSalesOrder(selection) {
    const salesOrder = clean(selection.originSalesOrderNumber || selection.official?.salesOrder);
    const line = clean(selection.originSalesOrderLine || selection.official?.sequenceLine);
    return salesOrder ? salesOrder + (line ? ' / ' + line : '') : 'N/A';
  }

  function formatCanonicalAnchor(selection) {
    const customer = clean(selection.canonicalCustomerNumber);
    const salesOrder = clean(selection.canonicalSalesOrderNumber);
    const line = clean(selection.canonicalAnchorLine);
    return [customer, salesOrder, line].filter(Boolean).join(' / ') || 'N/A';
  }

  function normalizeStatus(value) {
    return clean(value?.machineValue || value?.materialStatus || value?.status || value?.label || value).toUpperCase().replace(/\s+/g, '_');
  }

  function materialStatusLabel(value) {
    const status = normalizeStatus(value);
    return ({ NEEDS_KITTING: 'NEW', KITTING_IN_PROGRESS: 'IN PROGRESS', KIT_SHORT: 'KIT SHORT', KIT_COMPLETE: 'KIT COMPLETE' })[status] || status.replace(/_/g, ' ') || 'NEW';
  }

  function formatKittingJobDueDate(value, fallback = 'N/A') {
    const text = clean(value);
    if (!text) return fallback;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text;
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const isValid = parsed.getUTCFullYear() === Number(match[1]) &&
      parsed.getUTCMonth() === Number(match[2]) - 1 && parsed.getUTCDate() === Number(match[3]);
    return isValid ? (window.DleIntegration.enabled
      ? `${match[2]}-${match[3]}-${match[1].slice(-2)}` : `${match[2]}/${match[3]}/${match[1]}`) : text;
  }

  function formatQuantity(value) {
    const quantity = Number(value);
    return Number.isFinite(quantity) ? String(quantity) : '0';
  }

  function setText(id, value) {
    const target = document.getElementById(id);
    if (target) target.textContent = value;
  }

  function clean(value) { return String(value ?? '').trim(); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  window.KittingJobWorkspace = Object.freeze({
    open, render, setPresentationMode, returnToQueue, toggleReports,
    startKitting, toggleProductionSlides, showProductionSlide, stepProductionSlide,
    applyReportVisibility, canViewDevelopmentReports, setPrimaryTool, handlePrintLabelsToggle,
    refreshPrimaryToolPresentation, updateFocusedModeLayout,
    createReleasedBomReturnPath, restoreReleasedBomReturn
  });
  window.DleOsKittingNavigationGuard = Object.freeze({ request: requestKittingNavigation });
  window.loadKittingJobWorkspace = loadKittingJobWorkspace;
  window.initializeKittingJobWorkspace = initializeKittingJobWorkspace;
  window.returnToKittingJobQueue = returnToQueue;
  window.toggleKittingJobReports = toggleReports;
  window.handleKittingJobPrintLabelsToggle = handlePrintLabelsToggle;
})(window, document);

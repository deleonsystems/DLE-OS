(function registerKittingWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "kitting";
  const TEMPLATE_PATH = "SRC/workspaces/kitting/kitting-workspace.html";
  const LOOKUP_CONCURRENCY = 8;
  const TEMPLATE_FETCH_TIMEOUT_MS = 10000;
  const TEMPLATE_FETCH_ATTEMPTS = 2;
  const workspaceState = {
    activeQueue: "NEEDS_KITTING",
    loading: false,
    model: null,
    canonicalRows: [],
    approvalWarnings: 0,
    loadError: ""
  };
  let operationalStateSubscription = null;
  let materialStatusSubscription = null;

  async function loadKittingWorkspace() {
    workspaceState.activeQueue = "NEEDS_KITTING";
    ensureOperationalStateSubscription();
    const mount = document.querySelector('[data-workspace-mount="kitting"]');
    if (!mount) return;
    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Kitting Workspace</h3><p>Preparing the governed read model...</p></div>';
      try {
        const response = await fetchWorkspaceTemplate();
        mount.innerHTML = await response.text();
        mount.dataset.workspaceLoaded = "true";
        enableLegacyRecoveryPanel();
      } catch (error) {
        renderWorkspaceBootstrapFailure(mount, error);
        return;
      }
    }

    if (workspaceState.model) {
      renderWorkspace();
      return;
    }
    await refreshKittingWorkspace();
  }

  async function fetchWorkspaceTemplate() {
    let lastError = null;
    for (let attempt = 1; attempt <= TEMPLATE_FETCH_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), TEMPLATE_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(TEMPLATE_PATH, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal
        });
        if (response.status === 401 ||
            response.headers?.get("X-DLE-OS-Authentication-Required") === "true") {
          const sessionError = new Error("The authenticated DEV session is no longer active.");
          sessionError.code = "SESSION_REQUIRED";
          throw sessionError;
        }
        if (!response.ok) {
          throw new Error("Kitting workspace template returned HTTP " + response.status + ".");
        }
        return response;
      } catch (error) {
        lastError = error;
        if (error?.code === "SESSION_REQUIRED") throw error;
        if (attempt < TEMPLATE_FETCH_ATTEMPTS) await delay(250);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    throw lastError || new Error("Unable to load Kitting Workspace.");
  }

  function renderWorkspaceBootstrapFailure(mount, error) {
    const sessionRequired = error?.code === "SESSION_REQUIRED";
    const primaryAction = sessionRequired
      ? '<button type="button" data-kitting-bootstrap-signin>Sign in again</button>'
      : '<button type="button" data-kitting-bootstrap-retry>Retry Kitting</button>';
    mount.dataset.workspaceLoaded = "false";
    mount.innerHTML = [
      '<div class="workspace-dashboard-card kitting-workspace-bootstrap-error" role="alert">',
      '<h3>Kitting Workspace could not start</h3>',
      '<p>', sessionRequired
        ? 'Your authenticated DEV session is no longer active. Reload DEV and sign in again.'
        : 'The Kitting workspace template could not be retrieved. A DEV deployment may have interrupted the active session.',
      '</p>',
      '<div class="kitting-workspace-bootstrap-actions">',
      primaryAction,
      '<button type="button" data-kitting-bootstrap-reload>Reload DEV</button>',
      '</div></div>'
    ].join("");
    mount.querySelector('[data-kitting-bootstrap-retry]')?.addEventListener("click", () => {
      void loadKittingWorkspace();
    });
    mount.querySelector('[data-kitting-bootstrap-signin]')?.addEventListener("click", () => {
      window.location.assign("/auth/signin");
    });
    mount.querySelector('[data-kitting-bootstrap-reload]')?.addEventListener("click", () => {
      window.location.reload();
    });
    console.error("Unable to load the Kitting workspace template.", error);
  }

  function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function enableLegacyRecoveryPanel() {
    const panel = document.getElementById("legacyKittingRecovery");
    if (panel && window.DleOsRuntimeConfig?.environment === "ISOLATED_DEVELOPMENT") panel.hidden = false;
  }

  async function assessLegacyKittingMaterialStatus() {
    const target = document.getElementById("legacyKittingRecoveryResult");
    if (target) target.textContent = "Scanning governed legacy evidence...";
    try {
      const assessment = await window.DleApiClient.assessLegacyKittingMaterialStatus();
      renderLegacyRecoveryResult({ action: "ASSESSMENT", assessment });
      return assessment;
    } catch (error) {
      if (target) target.textContent = "Assessment failed: " + (error?.message || String(error));
      throw error;
    }
  }

  async function backfillLegacyKittingMaterialStatus() {
    const target = document.getElementById("legacyKittingRecoveryResult");
    if (target) target.textContent = "Reassessing evidence and applying only high-confidence DEV records...";
    try {
      const result = await window.DleApiClient.backfillLegacyKittingMaterialStatus();
      window.MaterialStatus?.invalidate?.(result.insertedWorkOrders || []);
      renderLegacyRecoveryResult({ action: "BACKFILL", result });
      workspaceState.model = null;
      await refreshKittingWorkspace();
      return result;
    } catch (error) {
      if (target) target.textContent = "Backfill failed: " + (error?.message || String(error));
      throw error;
    }
  }

  function renderLegacyRecoveryResult(payload) {
    const target = document.getElementById("legacyKittingRecoveryResult");
    if (!target) return;
    const assessment = payload.assessment || payload.result?.assessment || {};
    target.textContent = JSON.stringify({
      action: payload.action,
      verdict: payload.result?.verdict,
      assessmentCorrelationId: assessment.assessmentCorrelationId,
      assessedAtUtc: assessment.assessedAtUtc,
      inventory: assessment.inventory,
      counts: assessment.counts,
      insertedCount: payload.result?.insertedCount,
      insertedWorkOrders: payload.result?.insertedWorkOrders,
      highConfidence: (assessment.highConfidence || []).map(item => ({
        workOrderNumber: item.workOrderNumber,
        materialStatus: item.materialStatus,
        evidenceSource: item.evidenceSource,
        classification: item.classification,
        completeEvidence: item.completeEvidence?.path || null,
        shortageEvidence: item.shortageEvidence?.path || null,
        manualDisposition: item.manualDisposition?.resultingDisposition || null
      })),
      conflicts: (assessment.conflicts || []).map(item => ({
        workOrderNumber: item.workOrderNumber,
        category: item.category,
        detail: item.detail,
        manualDisposition: item.manualDisposition?.resultingDisposition || null,
        completeEvidence: (item.completeEvidence || []).map(file => file.path),
        shortageEvidence: (item.shortageEvidence || []).map(file => file.path)
      })),
      ambiguousOrUnmatchedFiles: (assessment.files || [])
        .filter(file => file.associationConfidence !== "HIGH")
        .map(file => ({ fileName: file.fileName, evidenceType: file.evidenceType,
          path: file.path, associationConfidence: file.associationConfidence,
          associationRule: file.associationRule, workOrderNumber: file.workOrderNumber }))
    }, null, 2);
  }

  function ensureOperationalStateSubscription() {
    if (operationalStateSubscription || !window.DleApiClient?.subscribeOperationalLineStateChange) return;
    operationalStateSubscription = window.DleApiClient.subscribeOperationalLineStateChange(detail => {
      workspaceState.model = null;
      const mount = document.querySelector('[data-workspace-mount="kitting"]');
      if (mount?.dataset.workspaceLoaded !== "true") return;
      const refresh = refreshKittingWorkspace();
      detail.waitUntil?.(refresh);
      return refresh;
    });
    if (!materialStatusSubscription && window.MaterialStatus?.subscribe) {
      materialStatusSubscription = window.MaterialStatus.subscribe(() => {
        workspaceState.model = null;
        const mount = document.querySelector('[data-workspace-mount="kitting"]');
        if (mount?.dataset.workspaceLoaded === "true") void refreshKittingWorkspace();
      });
    }
  }

  async function refreshKittingWorkspace(options = {}) {
    if (workspaceState.loading) return;
    const forceMaterialStatus = options.forceMaterialStatus === true;
    workspaceState.loading = true;
    workspaceState.loadError = "";
    setRefreshButtonState(true);
    setStatus("Loading canonical and governed evidence", "");
    renderQueueMessage("Loading canonical Sales Orders, relationship decisions, and Work Orders...");

    try {
      const canonicalRows = await loadCanonicalSalesOrderRows();
      const lines = canonicalRows.map(buildReadModelLine);
      const hasEmbeddedProjections = lines.every(hasEmbeddedGovernedProjections);
      const rmaReworkByLineKey = hasEmbeddedProjections
        ? buildEmbeddedRmaReworkMemberships(lines)
        : await loadActiveRmaReworkMemberships();
      const approvalsByLineKey = hasEmbeddedProjections
        ? buildEmbeddedApprovalReviews(lines)
        : await loadApprovalReviews(lines);
      const workOrderNumbers = window.KittingReadModel.collectActionableWorkOrderNumbers(
        lines, approvalsByLineKey, rmaReworkByLineKey
      );
      const [workOrdersByNumber, materialStatusesByWorkOrder] = await Promise.all([
        loadCanonicalWorkOrders(workOrderNumbers),
        hasEmbeddedProjections && !forceMaterialStatus
          ? Promise.resolve(buildEmbeddedMaterialStatuses(lines, workOrderNumbers))
          : loadMaterialStatuses(workOrderNumbers, { force: forceMaterialStatus })
      ]);
      workspaceState.canonicalRows = canonicalRows;
      workspaceState.model = window.KittingReadModel.buildReadModel({
        lines,
        approvalsByLineKey,
        workOrdersByNumber,
        materialStatusesByWorkOrder,
        rmaReworkByLineKey
      });
      renderWorkspace();
      setStatus(
        workspaceState.approvalWarnings
          ? "Loaded with " + workspaceState.approvalWarnings + " approval evidence warning(s)"
          : "Governed read model current",
        workspaceState.approvalWarnings ? "warning" : "ready"
      );
    } catch (error) {
      workspaceState.model = null;
      workspaceState.loadError = error?.message || "The governed Kitting read model could not be loaded.";
      setStatus("Governed data unavailable", "error");
      renderQueueMessage(workspaceState.loadError);
    } finally {
      workspaceState.loading = false;
      setRefreshButtonState(false);
    }
  }

  function refreshKittingQueue() {
    return refreshKittingWorkspace({ forceMaterialStatus: true });
  }

  async function loadCanonicalSalesOrderRows() {
    const loader = window.OperationsCenter?.dataService?.loadCanonicalRows;
    if (typeof loader === "function") {
      const result = await loader({ requestScope: "kitting" });
      if (!Array.isArray(result?.rows)) {
        throw new Error("Canonical Sales Orders returned an invalid read model.");
      }
      return result.rows;
    }
    const existing = window.OperationsCenter?.viewModel?.getMasterRecords?.();
    if (Array.isArray(existing) && existing.length) return existing.slice();
    throw new Error("The canonical Sales Orders read service is unavailable.");
  }

  function buildReadModelLine(record) {
    const viewModel = window.OperationsCenter?.viewModel;
    const shipmentProjection = viewModel?.getShipmentProjection?.(record) || null;
    const customerNumber = cleanText(record?.customerNumber || record?.vpro5?.customerNumber);
    const salesOrderNumber = cleanText(record?.salesOrderNumber || record?.vpro5?.salesOrder);
    const salesOrderLineNumber = cleanText(record?.lineNumber || record?.vpro5?.sequenceLine);
    return {
      lineKey: [customerNumber, salesOrderNumber, salesOrderLineNumber].join("|"),
      customerNumber,
      customerName: cleanText(record?.customerName || record?.vpro5?.customer),
      salesOrderNumber,
      salesOrderLineNumber,
      customerPurchaseOrderNumber: cleanText(record?.customerPurchaseOrderNumber || record?.official?.customerPo),
      itemNumber: cleanText(record?.itemNumber || record?.vpro5?.partNumber),
      quantityOrdered: record?.quantityOrdered,
      operationalQuantityOpen: viewModel?.getOfficialField
        ? viewModel.getOfficialField(record, "opQtyOpen")
        : record?.erpQuantityOpen,
      stagedQuantity: shipmentProjection?.stagedQuantity || 0,
      shipmentOperationalRoute: shipmentProjection?.operationalRoute || "",
      shipmentOperationalStatus: shipmentProjection?.operationalStatus || "",
      dueDate: cleanText(record?.estimatedShipDate || record?.vpro5?.dueDate),
      relationship: record?.workOrderRelationship || {},
      rmaReworkMembership: record?.rmaReworkMembership || null,
      workOrderApprovalReview: record?.workOrderApprovalReview || null,
      materialStatus: record?.materialStatus || null,
      materialStatusWorkOrderNumber: cleanText(record?.materialStatusWorkOrderNumber),
      sourceRecord: record
    };
  }

  function hasEmbeddedGovernedProjections(line) {
    const record = line?.sourceRecord;
    return Boolean(record) &&
      Object.prototype.hasOwnProperty.call(record, "rmaReworkMembership") &&
      Object.prototype.hasOwnProperty.call(record, "workOrderApprovalReview") &&
      Object.prototype.hasOwnProperty.call(record, "materialStatus") &&
      Object.prototype.hasOwnProperty.call(record, "materialStatusWorkOrderNumber");
  }

  function buildEmbeddedRmaReworkMemberships(lines) {
    return new Map(lines
      .filter(line => line.rmaReworkMembership)
      .map(line => [line.lineKey, line.rmaReworkMembership]));
  }

  function buildEmbeddedApprovalReviews(lines) {
    workspaceState.approvalWarnings = 0;
    return new Map(lines.map(line => [line.lineKey, line.workOrderApprovalReview || {}]));
  }

  function buildEmbeddedMaterialStatuses(lines, workOrderNumbers) {
    const actionable = new Set(workOrderNumbers);
    const statuses = new Map();
    lines.forEach(line => {
      const workOrderNumber = normalizeWorkOrderNumber(line.materialStatusWorkOrderNumber);
      if (workOrderNumber && actionable.has(workOrderNumber)) {
        statuses.set(workOrderNumber, line.materialStatus || null);
      }
    });
    return statuses;
  }

  async function loadApprovalReviews(lines) {
    const getter = window.DleApiClient?.getWorkOrderApprovalReview;
    if (typeof getter !== "function") {
      throw new Error("Current governed Work Order approval decisions are unavailable.");
    }
    workspaceState.approvalWarnings = 0;
    const results = new Map();
    await mapWithConcurrency(lines, LOOKUP_CONCURRENCY, async line => {
      try {
        const review = await getter(
          line.customerNumber,
          line.salesOrderNumber,
          line.salesOrderLineNumber
        );
        results.set(line.lineKey, review || {});
      } catch (error) {
        workspaceState.approvalWarnings += 1;
        results.set(line.lineKey, { loadError: true, errorMessage: error?.message || "Approval lookup failed." });
      }
    });
    return results;
  }

  async function loadCanonicalWorkOrders(workOrderNumbers) {
    const getter = window.DleApiClient?.liveCanonical?.getCanonicalWorkOrders;
    if (typeof getter !== "function") {
      throw new Error("The canonical Work Orders read service is unavailable.");
    }
    const results = new Map();
    await mapWithConcurrency(workOrderNumbers, LOOKUP_CONCURRENCY, async workOrderNumber => {
      const response = await getter({ page: 1, pageSize: 2, workOrderNumber });
      const items = Array.isArray(response?.items) ? response.items : [];
      const exact = items.filter(item =>
        normalizeWorkOrderNumber(item?.workOrderNumber) === workOrderNumber
      );
      if (exact.length === 1 && Number(response?.totalItems ?? exact.length) === 1) {
        results.set(workOrderNumber, exact[0]);
      }
    });
    return results;
  }

  async function loadKittingDispositions(workOrderNumbers) {
    const getter = window.DleApiClient?.getKittingDisposition;
    if (typeof getter !== "function") throw new Error("The governed kitting disposition service is unavailable.");
    const results = new Map();
    await mapWithConcurrency(workOrderNumbers, LOOKUP_CONCURRENCY, async workOrderNumber => {
      try { results.set(workOrderNumber, await getter(workOrderNumber)); }
      catch (error) { results.set(workOrderNumber, { currentDisposition: "NOT_DISPOSITIONED", loadError: true }); }
    });
    return results;
  }

  async function loadKittingCases(workOrderNumbers) {
    const getter = window.DleApiClient?.getKittingCase;
    if (typeof getter !== "function") throw new Error("The governed Kitting Case service is unavailable.");
    const results = new Map();
    const failures = [];
    await mapWithConcurrency(workOrderNumbers, Math.min(2, LOOKUP_CONCURRENCY), async workOrderNumber => {
      try {
        const response = await getter(workOrderNumber);
        if (response?.kittingCase) results.set(workOrderNumber, response.kittingCase);
      } catch (error) {
        failures.push({
          workOrderNumber,
          message: error?.message || "Unknown Kitting Case lookup failure."
        });
      }
    });
    if (failures.length) {
      const first = failures[0];
      throw new Error(
        `Kitting Case projection failed for ${failures.length} Work Order(s). ` +
        `First failure: ${first.workOrderNumber}: ${first.message}`
      );
    }
    return results;
  }

  async function loadMaterialStatuses(workOrderNumbers, options = {}) {
    if (!window.MaterialStatus?.getMany) throw new Error("The shared Material Status projection is unavailable.");
    if (options.force) {
      window.MaterialStatus.invalidate?.(workOrderNumbers, { notify: false });
    }
    return window.MaterialStatus.getMany(workOrderNumbers, {
      concurrency: 2,
      force: options.force === true
    });
  }

  async function loadActiveRmaReworkMemberships() {
    const getter = window.DleApiClient?.getRmaReworkCases;
    if (typeof getter !== "function") throw new Error("Active RMA/Rework membership is unavailable.");
    const pageSize = 200;
    const cases = [];
    let page = 1;
    let expectedTotal = null;
    while (expectedTotal === null || cases.length < expectedTotal) {
      const response = await getter({ status: "ACTIVE", page, pageSize });
      const items = Array.isArray(response?.items) ? response.items : null;
      const totalItems = Number(response?.totalItems);
      if (!items || !Number.isInteger(totalItems) || totalItems < 0)
        throw new Error("Active RMA/Rework membership returned an incomplete read model.");
      if (expectedTotal === null) expectedTotal = totalItems;
      else if (expectedTotal !== totalItems)
        throw new Error("Active RMA/Rework membership changed during paging. Refresh before routing Kitting work.");
      cases.push(...items);
      if (!items.length && cases.length < expectedTotal)
        throw new Error("Active RMA/Rework membership paging ended before all cases were loaded.");
      page += 1;
    }
    const caseIds = new Set(cases.map(caseRecord => cleanText(caseRecord?.caseId)).filter(Boolean));
    if (cases.length !== expectedTotal || caseIds.size !== cases.length)
      throw new Error("Active RMA/Rework membership could not be verified completely.");
    const results = new Map();
    cases.forEach(caseRecord => (caseRecord.members || []).forEach(member => {
      const key = [member.customerNumber, member.salesOrderNumber, member.salesOrderLineNumber].join("|");
      if (results.has(key)) throw new Error("An active Sales Order line belongs to more than one RMA/Rework case.");
      results.set(key, { caseId: caseRecord.caseId, caseReference: caseRecord.caseReference,
        caseType: caseRecord.caseType, caseStatus: caseRecord.caseStatus, member, caseRecord });
    }));
    return results;
  }

  function renderWorkspace() {
    const model = workspaceState.model;
    if (!model) return;
    renderOperatorQueues();
  }

  function selectQueue(queueName) {
    if (!Object.values(window.KittingReadModel.PRIMARY_QUEUES).includes(queueName)) return;
    workspaceState.activeQueue = queueName;
    renderWorkspace();
  }

  function renderActiveQueue() {
    renderOperatorQueues();
  }

  function renderOperatorQueues() {
    if (!workspaceState.model) return;
    const queues = workspaceState.model.queues || {};
    const searchActive = Boolean(cleanText(document.getElementById("kittingSearch")?.value));
    const needsKitting = filterAndSortRows([
      ...(queues.needsKitting || []),
      ...(queues.kittingInProgress || []),
    ]);
    const kitShort = filterAndSortRows(queues.kitShort || []);
    const kitComplete = filterAndSortRows(queues.kitComplete || []);
    const allKittingSearchRows = searchActive ? filterAndSortRows([
      ...(queues.needsKitting || []),
      ...(queues.kittingInProgress || []),
      ...(queues.kitShort || []),
      ...(queues.kitComplete || [])
    ]) : [];
    setCount("kittingNeedsKittingTabCount", needsKitting.length);
    setCount("kittingKitShortTabCount", kitShort.length);
    setCount("kittingKitCompleteTabCount", kitComplete.length);
    const views = {
      NEEDS_KITTING: {
        title: "Needs Kitting",
        description: "New and in-progress jobs that have not been established as Kit Short or Kit Complete.",
        rows: needsKitting,
        empty: "No jobs currently need Kitting."
      },
      KIT_SHORT: {
        title: "Kit Short / Awaiting Parts",
        description: "Jobs with an established material shortage that still need Kitting attention.",
        rows: kitShort,
        empty: "No kits are currently awaiting parts."
      },
      KIT_COMPLETE: {
        title: "Kit Complete",
        description: "Completed kits still associated with active/open canonical demand.",
        rows: kitComplete,
        empty: "No active/open jobs are currently Kit Complete."
      }
    };
    const selected = searchActive ? {
      title: "Search Results \u2014 " + allKittingSearchRows.length,
      description: "Searching all Kitting lifecycle states.",
      rows: allKittingSearchRows,
      empty: "No Kitting jobs match this search."
    } : views[workspaceState.activeQueue] || views.NEEDS_KITTING;
    const tabs = document.querySelector(".kitting-lifecycle-tabs");
    tabs?.classList.toggle("searching", searchActive);
    document.getElementById("kittingSelectedQueueTitle").textContent = selected.title;
    document.getElementById("kittingSelectedQueueDescription").textContent = selected.description;
    document.querySelectorAll("[data-kitting-lifecycle-tab]").forEach(button => {
      const active = !searchActive && button.dataset.kittingLifecycleTab === workspaceState.activeQueue;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderOperatorQueue("kittingSelectedJobs", "", selected.rows, selected.empty);
  }

  function renderOperatorQueue(targetId, countId, rows, emptyMessage) {
    const target = document.getElementById(targetId);
    if (countId) setCount(countId, rows.length);
    if (!target) return;
    target.innerHTML = rows.length
      ? '<div class="kitting-compact-list">' + rows.map(renderCompactQueueRow).join("") + '</div>'
      : '<div class="kitting-kit-queue-empty">' + escapeHtml(emptyMessage) + '</div>';
  }

  function getActiveQueueRows() {
    const queues = workspaceState.model?.queues || {};
    return {
      NOT_CLASSIFIED: queues.notClassified,
      NEEDS_RESOLUTION: queues.needsResolution,
      NEEDS_KITTING: queues.needsKitting,
      KITTING_IN_PROGRESS: queues.kittingInProgress,
      KIT_SHORT: queues.kitShort,
      KIT_COMPLETE: queues.kitComplete,
      RMA_REWORK: queues.rmaRework
    }[workspaceState.activeQueue] || [];
  }

  function filterAndSortRows(rows) {
    const search = cleanText(document.getElementById("kittingSearch")?.value).toLowerCase();
    const filtered = (rows || []).filter(row => {
      const haystack = [
        row.workOrderNumber,
        row.rmaCaseReference,
        row.rmaCaseType,
        row.customerNumber,
        row.customerName,
        row.assemblyItemNumber,
        row.canonicalWorkOrder?.customerPurchaseOrderNumber,
        ...(row.candidateWorkOrderNumbers || []),
        ...row.relatedLines.flatMap(line => [line.salesOrderNumber, line.salesOrderLineNumber,
          line.itemNumber, line.customerPurchaseOrderNumber])
      ].join(" ").toLowerCase();
      return !search || haystack.includes(search);
    });
    return filtered.sort((left, right) => {
      return left.earliestDueDateTime - right.earliestDueDateTime || left.queueKey.localeCompare(right.queueKey);
    });
  }

  function formatQueueDueDate(value) {
    const text = cleanText(value);
    if (!text) return "N/A";
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text;
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const isValid = parsed.getUTCFullYear() === Number(match[1]) &&
      parsed.getUTCMonth() === Number(match[2]) - 1 && parsed.getUTCDate() === Number(match[3]);
    return isValid ? `${match[2]}/${match[3]}/${match[1]}` : text;
  }

  function renderCompactQueueRow(row) {
    const customer = [row.customerNumber, row.customerName].filter(Boolean).join(" \u00b7 ") || "Customer N/A";
    const revision = row.revision ? "Rev " + row.revision : "Rev N/A";
    const quantity = row.canonicalWorkOrderQuantity === null
      ? "N/A" : formatQuantity(row.canonicalWorkOrderQuantity);
    const dueDate = formatQueueDueDate(row.earliestDueDate);
    return [
      '<button type="button" class="kitting-compact-row" data-kitting-queue-key="',
      escapeHtml(row.queueKey), '" onclick="openKittingWorkOrder(event)">',
      '<span class="kitting-compact-wo">WO ', escapeHtml(row.workOrderNumber), '</span>',
      '<span class="kitting-compact-assembly"><strong>', escapeHtml(row.assemblyItemNumber || "Part N/A"),
      '</strong><small>', escapeHtml(revision), '</small></span>',
      '<span class="kitting-compact-metric kitting-compact-quantity"><small>QTY</small><strong>',
      escapeHtml(quantity), '</strong></span>',
      '<span class="kitting-compact-metric kitting-compact-due"><small>DUE</small><strong>',
      escapeHtml(dueDate), '</strong></span>',
      '<span class="kitting-compact-customer">', escapeHtml(customer), '</span>',
      '<span class="kitting-compact-state">', escapeHtml(operatorStatus(row.materialStatus)), '</span>',
      '<span class="kitting-compact-arrow" aria-hidden="true">\u2192</span>',
      '</button>'
    ].join("");
  }

  function operatorStatus(status) {
    return status === "KITTING_IN_PROGRESS" ? "IN PROGRESS" :
      status === "KIT_SHORT" ? "KIT SHORT" :
      status === "KIT_COMPLETE" ? "KIT COMPLETE" : "NEW";
  }

  function renderQueueTable(rows) {
    return [
      '<div class="operations-center-table-wrap kitting-kit-queue-table-wrap">',
      '<table class="operations-center-table"><thead><tr>',
      '<th>Work Order</th><th>Customer</th><th>Assembly</th><th>Revision</th>',
      '<th>WO Qty</th><th>Total OP Qty Open</th><th>Earliest Due</th><th>Open Lines</th>',
      '<th>Governing Source</th><th>Relationship</th><th>Documents</th><th>Material Status</th><th>Sales Order Lines</th>',
      '</tr></thead><tbody>',
      rows.map(renderQueueRow).join(""),
      '</tbody></table></div>'
    ].join("");
  }

  function renderQueueRow(row) {
    return [
      '<tr data-kitting-queue-key="', escapeHtml(row.queueKey), '">',
      '<td>', renderWorkOrderCell(row), '</td>',
      '<td>', escapeHtml([row.customerNumber, row.customerName].filter(Boolean).join(" · ") || "N/A"), '</td>',
      '<td>', escapeHtml(row.assemblyItemNumber || "N/A"), '</td>',
      '<td>', escapeHtml(row.revision || "N/A"), '</td>',
      '<td>', escapeHtml(row.canonicalWorkOrderQuantity === null ? "N/A" : formatQuantity(row.canonicalWorkOrderQuantity)), '</td>',
      '<td>', escapeHtml(formatQuantity(row.totalOperationalOpenQuantity)), '</td>',
      '<td>', escapeHtml(row.earliestDueDate || "N/A"), '</td>',
      '<td>', escapeHtml(row.relatedOpenSalesOrderLineCount), '</td>',
      '<td>', escapeHtml(row.governingSource), '</td>',
      '<td><span class="kitting-state-badge">', escapeHtml(row.relationshipState), '</span></td>',
      '<td>', renderDocumentEvidence(row.documentPresence), '</td>',
      '<td><span class="kitting-state-badge">', escapeHtml(row.materialStatusLabel), '</span>', renderRmaAwareness(row), '</td>',
      '<td>', renderRelatedLines(row.relatedLines), '</td>',
      '</tr>'
    ].join("");
  }

  function renderRmaReworkQueueTable(rows) {
    return [
      '<div class="operations-center-table-wrap kitting-kit-queue-table-wrap">',
      '<table class="operations-center-table"><thead><tr>',
      '<th>Case</th><th>Customer</th><th>Sales Order / Line</th><th>Assembly</th><th>Quantity</th>',
      '<th>Case Type / Status</th><th>Work Order Decision</th><th>Next Action</th><th>Review</th>',
      '</tr></thead><tbody>', rows.map(renderRmaReworkQueueRow).join(''), '</tbody></table></div>'
    ].join('');
  }

  function renderRmaReworkQueueRow(row) {
    return [
      '<tr data-kitting-queue-key="', escapeHtml(row.queueKey), '">',
      '<td><strong>', escapeHtml(row.rmaCaseReference), '</strong></td>',
      '<td>', escapeHtml([row.customerNumber, row.customerName].filter(Boolean).join(' · ')), '</td>',
      '<td>', renderRmaReworkMembers(row.relatedLines, 'identity'), '</td>',
      '<td>', renderRmaReworkMembers(row.relatedLines, 'assembly'), '</td>',
      '<td>', escapeHtml(formatQuantity(row.totalOperationalOpenQuantity)), '</td>',
      '<td>', escapeHtml(row.rmaCaseType + ' · ' + row.rmaCaseStatus), '</td>',
      '<td><span class="kitting-state-badge">', escapeHtml(row.workOrderDecision), '</span></td>',
      '<td>', escapeHtml(row.nextRequiredAction), '</td>',
      '<td>', renderRmaReworkReview(row), '</td>',
      '</tr>'
    ].join('');
  }

  function renderRmaReworkMembers(lines, mode) {
    const values = (lines || []).map(line => mode === 'identity'
      ? line.salesOrderNumber + ' / ' + line.salesOrderLineNumber
      : line.itemNumber || 'N/A');
    return escapeHtml(Array.from(new Set(values)).join(', '));
  }

  function renderRmaReworkReview(row) {
    const historical = Array.from(new Set((row.relatedLines || []).flatMap(line =>
      (line.operationalRelationship?.historicalWorkOrders || []).map(item =>
        item.workOrderNumber + ' · ' +
        (item.relationshipRole === 'ORIGINAL_BUILD' ? 'Original Build' : 'Historical reference only')))));
    return '<details class="kitting-related-lines"><summary>Review ' + escapeHtml(row.relatedLines.length) +
      ' line' + (row.relatedLines.length === 1 ? '' : 's') + '</summary><div class="kitting-rma-review-detail">' +
      '<strong>Historical Work Order evidence</strong><p>' +
      escapeHtml(historical.length ? historical.join(', ') : 'No historical Work Order evidence') + '</p>' +
      renderRelatedLines(row.relatedLines) +
      '<p>RMA/return review controls operational routing. No BOM, shortage, purchasing, or production demand is generated here.</p>' +
      '</div></details>';
  }

  function renderRmaAwareness(row) {
    const lines = row.rmaReworkLines || [];
    if (!lines.length) return '';
    const references = Array.from(new Set(lines.map(line => line.rmaReworkCase?.caseReference).filter(Boolean)));
    return '<small class="kitting-rma-awareness">RMA/Rework: ' + escapeHtml(references.join(', ')) +
      ' · ' + escapeHtml(lines.length) + ' line' + (lines.length === 1 ? '' : 's') + ' excluded from demand</small>';
  }

  function renderWorkOrderCell(row) {
    if (row.actionable && row.workOrderNumber) {
      return '<button type="button" class="operations-center-sales-order-link kitting-work-order-button" ' +
        'data-kitting-queue-key="' + escapeHtml(row.queueKey) + '" onclick="openKittingWorkOrder(event)">' +
        escapeHtml(row.workOrderNumber) + '</button>';
    }
    const candidates = row.candidateWorkOrderNumbers || [];
    return '<span class="kitting-resolution-label">' + escapeHtml(
      candidates.length ? "Candidate: " + candidates.join(", ") : "Work Order not resolved"
    ) + '</span>';
  }

  function renderDocumentEvidence(evidence) {
    return '<div class="kitting-document-evidence"><strong>' + escapeHtml(evidence.state) +
      '</strong><small>' + escapeHtml(evidence.label) + '</small></div>';
  }

  function renderRelatedLines(lines) {
    return [
      '<details class="kitting-related-lines"><summary>', escapeHtml(lines.length),
      ' related line', lines.length === 1 ? '' : 's', '</summary>',
      '<table><thead><tr><th>Sales Order</th><th>Line</th><th>Assembly</th><th>Qty Ordered</th>',
      '<th>OP Qty Open</th><th>Due Date</th><th>Relationship</th><th>Source</th></tr></thead><tbody>',
      lines.map(line => [
        '<tr><td>', escapeHtml(line.salesOrderNumber), '</td><td>', escapeHtml(line.salesOrderLineNumber),
        '</td><td>', escapeHtml(line.itemNumber || "N/A"), '</td><td>', escapeHtml(formatQuantity(line.quantityOrdered)),
        '</td><td>', escapeHtml(formatQuantity(line.operationalQuantityOpen)), '</td><td>', escapeHtml(line.dueDate || "N/A"),
        '</td><td>', escapeHtml(line.authority.relationshipState), '</td><td>',
        escapeHtml(line.authority.governingSource), '</td></tr>'
      ].join("")).join(""),
      '</tbody></table></details>'
    ].join("");
  }

  function openGovernedWorkOrder(event) {
    event?.preventDefault?.();
    const queueKey = event?.currentTarget?.dataset?.kittingQueueKey || "";
    const row = workspaceState.model?.readyRows?.find(item => item.queueKey === queueKey);
    if (!row?.actionable || !row.workOrderNumber || !row.canonicalWorkOrder) return false;
    const originLine = row.relatedLines.find(line => Number(line.operationalQuantityOpen) > 0) || row.relatedLines[0];
    const handoff = buildGovernedHandoff(row, originLine);
    if (typeof window.KittingJobWorkspace?.open !== "function") {
      setStatus("Kitting Job Workspace navigation is unavailable", "error");
      return false;
    }
    return window.KittingJobWorkspace.open(handoff);
  }

  function buildGovernedHandoff(row, originLine) {
    const canonical = { ...row.canonicalWorkOrder };
    const originRow = buildDashboardRow(originLine, row.workOrderNumber);
    return {
      canonicalWorkOrder: canonical,
      originRow,
      relatedRows: row.relatedLines.map(line => buildDashboardRow(line, row.workOrderNumber)),
      workOrderNumber: row.workOrderNumber,
      canonicalCustomerNumber: cleanText(canonical.customerNumber),
      canonicalSalesOrderNumber: cleanText(canonical.salesOrderNumber),
      canonicalAnchorLine: cleanText(canonical.salesOrderLineNumber),
      itemNumber: cleanText(canonical.itemNumber),
      workOrderQuantity: canonical.schProdQuantity,
      workOrderStatus: cleanText(canonical.workOrderStatus),
      originCustomerNumber: originLine.customerNumber,
      originCustomerName: originLine.customerName,
      originSalesOrderNumber: originLine.salesOrderNumber,
      originSalesOrderLine: originLine.salesOrderLineNumber,
      originCustomerPurchaseOrderNumber: cleanText(
        originLine.customerPurchaseOrderNumber || originLine.sourceRecord?.customerPurchaseOrderNumber ||
        originLine.sourceRecord?.customerPo || originLine.sourceRecord?.purchaseOrderNumber
      ),
      originItemNumber: originLine.itemNumber,
      originQuantity: originLine.operationalQuantityOpen,
      originDueDate: originLine.dueDate,
      relationshipStatus: originLine.authority.relationshipState,
      approvalDecisionId: originLine.authority.decisionId,
      governingSource: row.governingSource,
      materialStatus: row.materialStatusProjection,
      operationalRelationship: originLine.operationalRelationship || null,
      preferredDashboardView: "kitting",
      preferredPresentation: "kitting-job",
      sourceWorkspaceId: WORKSPACE_ID,
      returnWorkspaceId: WORKSPACE_ID
    };
  }

  function buildDashboardRow(line, workOrderNumber) {
    return {
      masterRecordKey: line.lineKey,
      official: {
        customerNumber: line.customerNumber,
        customer: line.customerName,
        salesOrder: line.salesOrderNumber,
        sequenceLine: line.salesOrderLineNumber,
        workOrder: workOrderNumber,
        partNumber: line.itemNumber,
        quantityOrdered: formatQuantity(line.quantityOrdered),
        opQtyOpen: formatQuantity(line.operationalQuantityOpen),
        dueDate: line.dueDate
      },
      masterRecord: line.sourceRecord
    };
  }

  function queueDefinition(queueName) {
    return {
      NOT_CLASSIFIED: {
        title: "Needs Disposition",
        explanation: "Legacy queue retained for historical compatibility. Eligible Work Orders now receive system-derived Material Status.",
        emptyMessage: "No governed Work Orders require a manual normal-lifecycle disposition."
      },
      NEEDS_KITTING: {
        title: "Needs Kitting",
        explanation: "Eligible Work Orders with no active persistent Kitting Case.",
        emptyMessage: "No governed Work Orders currently need kitting."
      },
      KITTING_IN_PROGRESS: {
        title: "Kitting In Progress",
        explanation: "Persistent Kitting Cases with saved work that have not reached an immutable submission.",
        emptyMessage: "No governed Work Orders currently have Kitting in progress."
      },
      NEEDS_RESOLUTION: {
        title: "Needs Resolution",
        explanation: "Candidate, ambiguous, unresolved, or otherwise unsafe Work Order relationships. These entries cannot open Work Order Dashboard.",
        emptyMessage: "No Sales Order lines currently require Work Order relationship resolution under the selected filters."
      },
      KIT_SHORT: {
        title: "Kit Short",
        explanation: "Persistent Kitting Cases whose latest immutable submission has unresolved shortages.",
        emptyMessage: "No governed Work Orders currently have a Kit Short Material Status."
      },
      KIT_COMPLETE: {
        title: "Kit Complete",
        explanation: "Terminal persistent Kitting Cases with a complete immutable submission.",
        emptyMessage: "No governed Work Orders currently have a Kit Complete Material Status."
      },
      RMA_REWORK: {
        title: "RMA / Rework",
        explanation: "Active RMA/Rework cases control these Sales Order lines. Work Order decisions remain pending and normal Kitting demand is suppressed.",
        emptyMessage: "No active RMA/Rework cases contain current Sales Order lines."
      }
    }[queueName];
  }

  function renderQueueMessage(message) {
    ["kittingSelectedJobs"].forEach(id => {
      const target = document.getElementById(id);
      if (target) target.innerHTML = '<div class="kitting-kit-queue-empty">' + escapeHtml(message) + '</div>';
    });
  }

  function setStatus(message, state) {
    const target = document.getElementById("kittingWorkspaceStatus");
    if (!target) return;
    target.textContent = message;
    target.dataset.state = state || "";
  }

  function setRefreshButtonState(refreshing) {
    const button = document.querySelector(".kitting-refresh");
    if (!button) return;
    button.disabled = refreshing;
    button.setAttribute("aria-busy", String(refreshing));
    button.textContent = refreshing ? "Refreshing..." : "↻ Refresh Queue";
  }

  function setCount(id, value) {
    const target = document.getElementById(id);
    if (target) target.textContent = String(value ?? 0);
  }

  async function mapWithConcurrency(items, concurrency, task) {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        await task(items[index], index);
      }
    });
    await Promise.all(workers);
  }

  function normalizeWorkOrderNumber(value) {
    return cleanText(value).toUpperCase();
  }

  function formatQuantity(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "0";
    return Number.isInteger(parsed) ? String(parsed) : String(Number(parsed.toFixed(2)));
  }

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  window.refreshKittingWorkspace = refreshKittingWorkspace;
  window.refreshKittingQueue = refreshKittingQueue;
  window.filterKittingWorkspace = renderActiveQueue;
  window.selectKittingQueue = selectQueue;
  window.openKittingWorkOrder = openGovernedWorkOrder;
  window.renderKittingKitQueue = renderActiveQueue;
  window.assessLegacyKittingMaterialStatus = assessLegacyKittingMaterialStatus;
  window.backfillLegacyKittingMaterialStatus = backfillLegacyKittingMaterialStatus;

  window.DleWorkspaces = window.DleWorkspaces || {};
  ensureOperationalStateSubscription();
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: loadKittingWorkspace,
    refresh: refreshKittingWorkspace,
    getModel: () => workspaceState.model,
    buildGovernedHandoff,
    loadActiveRmaReworkMemberships
  });
})(window, document);

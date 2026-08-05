(function registerKittingWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "kitting";
  const TEMPLATE_PATH = "SRC/workspaces/kitting/kitting-workspace.html";
  const LOOKUP_CONCURRENCY = 8;
  const workspaceState = {
    activeQueue: "NOT_CLASSIFIED",
    loading: false,
    model: null,
    canonicalRows: [],
    approvalWarnings: 0,
    loadError: ""
  };

  async function loadKittingWorkspace() {
    const mount = document.querySelector('[data-workspace-mount="kitting"]');
    if (!mount) return;
    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Kitting Workspace</h3><p>Preparing the governed read model...</p></div>';
      const response = await fetch(TEMPLATE_PATH, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load Kitting Workspace.");
      mount.innerHTML = await response.text();
      mount.dataset.workspaceLoaded = "true";
    }

    if (workspaceState.model) {
      renderWorkspace();
      return;
    }
    await refreshKittingWorkspace();
  }

  async function refreshKittingWorkspace() {
    if (workspaceState.loading) return;
    workspaceState.loading = true;
    workspaceState.loadError = "";
    setStatus("Loading canonical and governed evidence", "");
    renderQueueMessage("Loading canonical Sales Orders, relationship decisions, and Work Orders...");

    try {
      const canonicalRows = await loadCanonicalSalesOrderRows();
      const lines = canonicalRows.map(buildReadModelLine);
      const rmaReworkByLineKey = await loadActiveRmaReworkMemberships();
      const approvalsByLineKey = await loadApprovalReviews(lines);
      const workOrderNumbers = window.KittingReadModel.collectActionableWorkOrderNumbers(
        lines, approvalsByLineKey, rmaReworkByLineKey
      );
      const workOrdersByNumber = await loadCanonicalWorkOrders(workOrderNumbers);
      const documentsByWorkOrder = buildDocumentEvidence(workOrderNumbers);
      const dispositionsByWorkOrder = await loadKittingDispositions(workOrderNumbers);

      workspaceState.canonicalRows = canonicalRows;
      workspaceState.model = window.KittingReadModel.buildReadModel({
        lines,
        approvalsByLineKey,
        workOrdersByNumber,
        documentsByWorkOrder,
        dispositionsByWorkOrder,
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
    }
  }

  async function loadCanonicalSalesOrderRows() {
    const loader = window.OperationsCenter?.dataService?.loadCanonicalRows;
    if (typeof loader === "function") {
      const result = await loader();
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
    const customerNumber = cleanText(record?.customerNumber || record?.vpro5?.customerNumber);
    const salesOrderNumber = cleanText(record?.salesOrderNumber || record?.vpro5?.salesOrder);
    const salesOrderLineNumber = cleanText(record?.lineNumber || record?.vpro5?.sequenceLine);
    return {
      lineKey: [customerNumber, salesOrderNumber, salesOrderLineNumber].join("|"),
      customerNumber,
      customerName: cleanText(record?.customerName || record?.vpro5?.customer),
      salesOrderNumber,
      salesOrderLineNumber,
      itemNumber: cleanText(record?.itemNumber || record?.vpro5?.partNumber),
      quantityOrdered: record?.quantityOrdered,
      operationalQuantityOpen: viewModel?.getOfficialField
        ? viewModel.getOfficialField(record, "opQtyOpen")
        : record?.erpQuantityOpen,
      dueDate: cleanText(record?.estimatedShipDate || record?.vpro5?.dueDate),
      relationship: record?.workOrderRelationship || {},
      sourceRecord: record
    };
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

  function buildDocumentEvidence(workOrderNumbers) {
    const documents = new Map();
    const service = window.OperationsCenter?.documentLinks;
    workOrderNumbers.forEach(workOrderNumber => {
      if (typeof service?.getDocumentState !== "function") {
        documents.set(workOrderNumber, unavailableDocumentEvidence());
        return;
      }
      const kitShort = service.getDocumentState("kitShort", workOrderNumber);
      const kitComplete = service.getDocumentState("kitComplete", workOrderNumber);
      const connected = kitShort?.connected || kitComplete?.connected;
      const present = kitShort?.exists || kitComplete?.exists;
      documents.set(workOrderNumber, {
        state: present ? "PRESENT" : connected ? "ABSENT" : "UNAVAILABLE",
        label: present
          ? [kitShort?.exists ? "Kit Short PDF" : "", kitComplete?.exists ? "Kit Complete PDF" : ""]
              .filter(Boolean).join("; ") + " available"
          : connected ? "No matching kitting document" : "Document folders not connected",
        kitShortPresent: kitShort?.exists === true,
        kitCompletePresent: kitComplete?.exists === true
      });
    });
    return documents;
  }

  function unavailableDocumentEvidence() {
    return {
      state: "UNAVAILABLE",
      label: "Document folders not connected",
      kitShortPresent: false,
      kitCompletePresent: false
    };
  }

  function renderWorkspace() {
    const model = workspaceState.model;
    if (!model) return;
    renderSummary(model.counts);
    setCount("kittingNotClassifiedCount", model.counts.notClassified);
    setCount("kittingNeedsResolutionCount", model.counts.needsResolution);
    setCount("kittingNeedsKittingCount", model.counts.needsKitting);
    setCount("kittingKitShortCount", model.counts.kitShort);
    setCount("kittingKitCompleteCount", model.counts.kitComplete);
    setCount("kittingRmaReworkCount", model.counts.rmaRework);
    document.querySelectorAll("[data-kitting-queue-button]").forEach(button => {
      button.classList.toggle("active", button.dataset.kittingQueueButton === workspaceState.activeQueue);
    });
    renderActiveQueue();
  }

  function renderSummary(counts) {
    const target = document.getElementById("kittingReadinessSummary");
    if (!target) return;
    target.innerHTML = [
      summaryCard("Ready", counts.ready),
      summaryCard("Exact Work Orders", counts.exactWorkOrders),
      summaryCard("Approved Work Orders", counts.approvedWorkOrders),
      summaryCard("Needs Resolution", counts.needsResolution),
      summaryCard("Open SO Lines", counts.openSalesOrderLinesEvaluated),
      summaryCard("RMA/Rework Lines Excluded", counts.rmaReworkExcludedLines),
      summaryCard("Multi-line WOs", counts.uniqueWorkOrdersWithMultipleLines)
    ].join("");
  }

  function summaryCard(label, value) {
    return '<div class="kitting-summary-card"><span>' + escapeHtml(label) + '</span><strong>' +
      escapeHtml(value) + '</strong></div>';
  }

  function selectQueue(queueName) {
    if (!Object.values(window.KittingReadModel.PRIMARY_QUEUES).includes(queueName)) return;
    workspaceState.activeQueue = queueName;
    renderWorkspace();
  }

  function renderActiveQueue() {
    const target = document.getElementById("kittingQueue");
    const title = document.getElementById("kittingQueueTitle");
    const explanation = document.getElementById("kittingQueueExplanation");
    if (!target || !title || !explanation || !workspaceState.model) return;
    const definition = queueDefinition(workspaceState.activeQueue);
    title.textContent = definition.title;
    explanation.textContent = definition.explanation;
    const rows = filterAndSortRows(getActiveQueueRows());
    if (!rows.length) {
      renderQueueMessage(definition.emptyMessage);
      return;
    }
    target.innerHTML = workspaceState.activeQueue === "RMA_REWORK"
      ? renderRmaReworkQueueTable(rows) : renderQueueTable(rows);
  }

  function getActiveQueueRows() {
    const queues = workspaceState.model?.queues || {};
    return {
      NOT_CLASSIFIED: queues.notClassified,
      NEEDS_RESOLUTION: queues.needsResolution,
      NEEDS_KITTING: queues.needsKitting,
      KIT_SHORT: queues.kitShort,
      KIT_COMPLETE: queues.kitComplete,
      RMA_REWORK: queues.rmaRework
    }[workspaceState.activeQueue] || [];
  }

  function filterAndSortRows(rows) {
    const search = cleanText(document.getElementById("kittingSearch")?.value).toLowerCase();
    const relationship = cleanText(document.getElementById("kittingRelationshipFilter")?.value || "ALL");
    const documentFilter = cleanText(document.getElementById("kittingDocumentFilter")?.value || "ALL");
    const sort = cleanText(document.getElementById("kittingSort")?.value || "DUE_ASC");
    const filtered = (rows || []).filter(row => {
      const haystack = [
        row.workOrderNumber,
        row.rmaCaseReference,
        row.rmaCaseType,
        row.customerNumber,
        row.customerName,
        row.assemblyItemNumber,
        ...(row.candidateWorkOrderNumbers || []),
        ...row.relatedLines.flatMap(line => [line.salesOrderNumber, line.salesOrderLineNumber, line.itemNumber])
      ].join(" ").toLowerCase();
      const relationshipMatch = workspaceState.activeQueue === "RMA_REWORK" || relationship === "ALL" ||
        (relationship === "READY" && row.ready) || row.relationshipStates.includes(relationship);
      const documentMatch = workspaceState.activeQueue === "RMA_REWORK" ||
        documentFilter === "ALL" || row.documentPresence.state === documentFilter;
      return (!search || haystack.includes(search)) && relationshipMatch && documentMatch;
    });
    return filtered.sort((left, right) => {
      if (sort === "WORK_ORDER") return (left.workOrderNumber || left.queueKey)
        .localeCompare(right.workOrderNumber || right.queueKey);
      if (sort === "CUSTOMER") return left.customerName.localeCompare(right.customerName) ||
        left.queueKey.localeCompare(right.queueKey);
      return left.earliestDueDateTime - right.earliestDueDateTime || left.queueKey.localeCompare(right.queueKey);
    });
  }

  function renderQueueTable(rows) {
    return [
      '<div class="operations-center-table-wrap kitting-kit-queue-table-wrap">',
      '<table class="operations-center-table"><thead><tr>',
      '<th>Work Order</th><th>Customer</th><th>Assembly</th><th>Revision</th>',
      '<th>WO Qty</th><th>Total OP Qty Open</th><th>Earliest Due</th><th>Open Lines</th>',
      '<th>Governing Source</th><th>Relationship</th><th>Documents</th><th>Classification</th><th>Sales Order Lines</th>',
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
      '<td>', escapeHtml(row.currentKittingClassification), renderRmaAwareness(row), '</td>',
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
    return '<details class="kitting-related-lines"><summary>Review ' + escapeHtml(row.relatedLines.length) +
      ' line' + (row.relatedLines.length === 1 ? '' : 's') + '</summary><div class="kitting-rma-review-detail">' +
      '<strong>Historical Work Order evidence</strong>' + renderRelatedLines(row.relatedLines) +
      '<p>Active RMA/Rework membership controls operational routing. No BOM, shortage, purchasing, or production demand is generated here.</p>' +
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
    if (typeof window.WorkOrderDashboardModule?.setSelectedWorkOrder !== "function" || typeof window.go !== "function") {
      setStatus("Work Order Dashboard navigation is unavailable", "error");
      return false;
    }
    window.WorkOrderDashboardModule.setSelectedWorkOrder(handoff);
    window.go("workOrderDashboardModule");
    return true;
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
      originItemNumber: originLine.itemNumber,
      originQuantity: originLine.operationalQuantityOpen,
      originDueDate: originLine.dueDate,
      relationshipStatus: originLine.authority.relationshipState,
      approvalDecisionId: originLine.authority.decisionId,
      governingSource: row.governingSource,
      preferredDashboardView: "kitting",
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
        explanation: "Ready exact or approved Work Orders with open Sales Order lines and no current manual kitting disposition.",
        emptyMessage: "No governed Work Orders match the current filters. Document presence never creates a kitting classification."
      },
      NEEDS_KITTING: {
        title: "Needs Kitting",
        explanation: "Eligible Work Orders intentionally confirmed as active work requiring kitting.",
        emptyMessage: "No governed Work Orders have a current manual Needs Kitting disposition."
      },
      NEEDS_RESOLUTION: {
        title: "Needs Resolution",
        explanation: "Candidate, ambiguous, unresolved, or otherwise unsafe Work Order relationships. These entries cannot open Work Order Dashboard.",
        emptyMessage: "No Sales Order lines currently require Work Order relationship resolution under the selected filters."
      },
      KIT_SHORT: {
        title: "Kit Short",
        explanation: "Eligible Work Orders with a current authoritative manual Kit Short disposition.",
        emptyMessage: "No governed Work Orders have a current manual Kit Short disposition."
      },
      KIT_COMPLETE: {
        title: "Kit Complete",
        explanation: "Eligible Work Orders with a current authoritative manual Kit Complete disposition.",
        emptyMessage: "No governed Work Orders have a current manual Kit Complete disposition."
      },
      RMA_REWORK: {
        title: "RMA / Rework",
        explanation: "Active RMA/Rework cases control these Sales Order lines. Work Order decisions remain pending and normal Kitting demand is suppressed.",
        emptyMessage: "No active RMA/Rework cases contain current Sales Order lines."
      }
    }[queueName];
  }

  function renderQueueMessage(message) {
    const target = document.getElementById("kittingQueue");
    if (target) target.innerHTML = '<div class="kitting-kit-queue-empty">' + escapeHtml(message) + '</div>';
  }

  function setStatus(message, state) {
    const target = document.getElementById("kittingWorkspaceStatus");
    if (!target) return;
    target.textContent = message;
    target.dataset.state = state || "";
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
  window.filterKittingWorkspace = renderActiveQueue;
  window.selectKittingQueue = selectQueue;
  window.openKittingWorkOrder = openGovernedWorkOrder;
  window.renderKittingKitQueue = renderActiveQueue;

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: loadKittingWorkspace,
    refresh: refreshKittingWorkspace,
    getModel: () => workspaceState.model,
    buildGovernedHandoff,
    loadActiveRmaReworkMemberships
  });
})(window, document);

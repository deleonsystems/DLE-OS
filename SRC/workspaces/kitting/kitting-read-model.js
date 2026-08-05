(function registerKittingReadModel(window) {
  "use strict";

  const RELATIONSHIP_STATES = Object.freeze({
    EXACT: "EXACT",
    APPROVED: "APPROVED",
    CANDIDATE: "CANDIDATE",
    AMBIGUOUS: "AMBIGUOUS",
    UNRESOLVED: "UNRESOLVED"
  });

  const PRIMARY_QUEUES = Object.freeze({
    NOT_CLASSIFIED: "NOT_CLASSIFIED",
    NEEDS_RESOLUTION: "NEEDS_RESOLUTION",
    NEEDS_KITTING: "NEEDS_KITTING",
    KIT_SHORT: "KIT_SHORT",
    KIT_COMPLETE: "KIT_COMPLETE",
    RMA_REWORK: "RMA_REWORK"
  });

  function buildReadModel(options = {}) {
    const lines = Array.isArray(options.lines) ? options.lines.map(normalizeLine) : [];
    const approvalsByLineKey = asLookup(options.approvalsByLineKey);
    const workOrdersByNumber = asLookup(options.workOrdersByNumber);
    const documentsByWorkOrder = asLookup(options.documentsByWorkOrder);
    const dispositionsByWorkOrder = asLookup(options.dispositionsByWorkOrder);
    const rmaReworkByLineKey = asLookup(options.rmaReworkByLineKey);
    const governedGroups = new Map();
    const needsResolution = [];
    const rmaAwarenessByWorkOrder = new Map();
    const rmaGroups = new Map();
    const directFulfillmentLines = [];

    lines.forEach(line => {
      const approvalReview = approvalsByLineKey.get(line.lineKey);
      const authority = resolveLineAuthority(line, approvalReview);
      const rmaMembership = rmaReworkByLineKey.get(line.lineKey);
      const operational = approvalReview?.operationalRelationship || null;
      const protectedReturn = ["RMA_REWORK", "RETURN_RMA_REVIEW_REQUIRED"]
        .includes(cleanText(operational?.operationalRoute));
      if (rmaMembership || protectedReturn) {
        const caseKey = cleanText(rmaMembership?.caseId || rmaMembership?.caseReference ||
          operational?.rmaReworkControl?.caseId || "RETURN|" + line.lineKey);
        const group = rmaGroups.get(caseKey) || {
          caseId: cleanText(rmaMembership?.caseId || operational?.rmaReworkControl?.caseId),
          caseReference: cleanText(rmaMembership?.caseReference ||
            operational?.rmaReworkControl?.caseReference) || "Return Review Required",
          caseType: cleanText(rmaMembership?.caseType) || (rmaMembership ? "RMA / Rework" :
            (operational?.operationalRoute === "RMA_REWORK" ? "RMA / Rework" : "Protected Return")),
          caseStatus: cleanText(rmaMembership?.caseStatus) || (rmaMembership ? "ACTIVE" :
            (operational?.operationalRoute === "RMA_REWORK" ? "ACTIVE" : "REVIEW_REQUIRED")),
          customerNumber: line.customerNumber,
          customerName: line.customerName,
          lines: []
        };
        group.lines.push({ ...line, authority, operationalRelationship: operational,
          rmaReworkCase: rmaMembership || operational?.rmaReworkControl || null });
        rmaGroups.set(caseKey, group);
        if (authority.actionable && authority.workOrderNumber) {
          const awareness = rmaAwarenessByWorkOrder.get(authority.workOrderNumber) || [];
          awareness.push({ ...line, authority, rmaReworkCase: rmaMembership });
          rmaAwarenessByWorkOrder.set(authority.workOrderNumber, awareness);
        }
        return;
      }
      if (cleanText(operational?.operationalRoute) === "DIRECT_FULFILLMENT" &&
          cleanText(operational?.operationalStatus) === "NO_WORK_ORDER_REQUIRED") {
        directFulfillmentLines.push({ ...line, authority,
          operationalRelationship: operational });
        return;
      }
      const canonicalWorkOrder = authority.workOrderNumber
        ? workOrdersByNumber.get(authority.workOrderNumber)
        : null;

      if (authority.actionable && canonicalWorkOrder) {
        const group = governedGroups.get(authority.workOrderNumber) || {
          workOrderNumber: authority.workOrderNumber,
          canonicalWorkOrder: normalizeWorkOrder(canonicalWorkOrder),
          lines: [],
          sources: new Set(),
          relationshipStates: new Set()
        };
        group.lines.push({ ...line, authority });
        group.sources.add(authority.governingSource);
        group.relationshipStates.add(authority.relationshipState);
        governedGroups.set(authority.workOrderNumber, group);
        return;
      }

      needsResolution.push(buildResolutionRow(
        line,
        authority,
        authority.actionable && !canonicalWorkOrder
          ? "The governed Work Order is missing from the canonical Work Orders contract."
          : authority.reason
      ));
    });

    const governedRows = Array.from(governedGroups.values())
      .map(group => buildGovernedRow(group, documentsByWorkOrder.get(group.workOrderNumber),
        dispositionsByWorkOrder.get(group.workOrderNumber), rmaAwarenessByWorkOrder.get(group.workOrderNumber) || []))
      .sort(compareQueueRows);
    const notClassified = governedRows.filter(row => row.primaryQueue === PRIMARY_QUEUES.NOT_CLASSIFIED);
    const needsKitting = governedRows.filter(row => row.primaryQueue === PRIMARY_QUEUES.NEEDS_KITTING);
    const kitShort = governedRows.filter(row => row.primaryQueue === PRIMARY_QUEUES.KIT_SHORT);
    const kitComplete = governedRows.filter(row => row.primaryQueue === PRIMARY_QUEUES.KIT_COMPLETE);
    needsResolution.sort(compareQueueRows);
    const rmaRework = Array.from(rmaGroups.values()).map(buildRmaReworkRow).sort(compareQueueRows);

    const queues = {
      notClassified,
      needsResolution,
      needsKitting,
      kitShort,
      kitComplete,
      rmaRework
    };
    const counts = buildCounts(lines, queues, rmaReworkByLineKey, directFulfillmentLines);

    return Object.freeze({
      generatedAt: new Date().toISOString(),
      relationshipStates: RELATIONSHIP_STATES,
      primaryQueues: PRIMARY_QUEUES,
      readyRows: governedRows,
      directFulfillmentLines: Object.freeze(directFulfillmentLines.slice()),
      queues,
      counts
    });
  }

  function collectActionableWorkOrderNumbers(lines, approvalsByLineKey, rmaReworkByLineKey) {
    const approvals = asLookup(approvalsByLineKey);
    const rmaMemberships = asLookup(rmaReworkByLineKey);
    return Array.from(new Set((Array.isArray(lines) ? lines : []).map(normalizeLine)
      .filter(line => !rmaMemberships.has(line.lineKey))
      .map(line => resolveLineAuthority(line, approvals.get(line.lineKey)))
      .filter(authority => authority.actionable && authority.workOrderNumber)
      .map(authority => authority.workOrderNumber)))
      .sort();
  }

  function resolveLineAuthority(line, approvalReview) {
    const relationship = line.relationship || {};
    const operational = approvalReview?.operationalRelationship;
    if (operational) {
      const route = cleanText(operational.operationalRoute);
      const active = normalizeWorkOrderNumber(operational.activeWorkOrderNumber);
      if (route === "NORMAL_PRODUCTION" && active) {
        return {
          relationshipState: operational.activeWorkOrderSource === "APPROVED"
            ? RELATIONSHIP_STATES.APPROVED : RELATIONSHIP_STATES.EXACT,
          governingSource: operational.activeWorkOrderSource === "APPROVED" ? "APPROVED" : "EXACT",
          workOrderNumber: active,
          actionable: true,
          decisionId: cleanText(approvalReview?.currentApproval?.decisionId),
          reason: cleanText(operational.reason)
        };
      }
      if (["RMA_REWORK", "RETURN_RMA_REVIEW_REQUIRED"].includes(route)) {
        return blockedAuthority(route === "RMA_REWORK" ? "RMA_REWORK" : "RETURN_REVIEW_REQUIRED",
          cleanText(operational.reason) || "RMA/return review controls this Sales Order line.");
      }
      if (route === "DIRECT_FULFILLMENT" &&
          cleanText(operational.operationalStatus) === "NO_WORK_ORDER_REQUIRED") {
        return blockedAuthority("NO_WORK_ORDER_REQUIRED",
          cleanText(operational.reason) || "Direct fulfillment does not require production kitting.");
      }
    }
    const approvedWorkOrder = normalizeWorkOrderNumber(
      approvalReview?.currentApproval?.approvedWorkOrderNumber
    );
    if (approvedWorkOrder) {
      return {
        relationshipState: RELATIONSHIP_STATES.APPROVED,
        governingSource: "APPROVED",
        workOrderNumber: approvedWorkOrder,
        actionable: true,
        decisionId: cleanText(approvalReview?.currentApproval?.decisionId),
        reason: "Current governed operational Work Order approval."
      };
    }

    const status = cleanText(relationship.status || relationship.resolutionStatus).toUpperCase();
    const exactWorkOrder = normalizeWorkOrderNumber(relationship.actionableWorkOrderNumber);
    if (status === "EXACT_LINE_UNIQUE" && exactWorkOrder) {
      return {
        relationshipState: RELATIONSHIP_STATES.EXACT,
        governingSource: "EXACT",
        workOrderNumber: exactWorkOrder,
        actionable: true,
        decisionId: "",
        reason: "ERP exact Sales Order line relationship."
      };
    }

    if (status === "SALES_ORDER_ITEM_UNIQUE_CANDIDATE" ||
        status === "SALES_ORDER_LEVEL_CANDIDATE") {
      return blockedAuthority(RELATIONSHIP_STATES.CANDIDATE,
        "Candidate evidence requires an approved operational decision.");
    }
    if (status === "AMBIGUOUS") {
      return blockedAuthority(RELATIONSHIP_STATES.AMBIGUOUS,
        "Multiple Work Orders are supported by the current evidence.");
    }
    return blockedAuthority(RELATIONSHIP_STATES.UNRESOLVED,
      approvalReview?.loadError
        ? "Approval evidence could not be loaded; navigation remains blocked."
        : "No governed Work Order relationship is available.");
  }

  function blockedAuthority(relationshipState, reason) {
    return {
      relationshipState,
      governingSource: "NONE",
      workOrderNumber: "",
      actionable: false,
      decisionId: "",
      reason
    };
  }

  function buildGovernedRow(group, documentEvidence, dispositionReview, rmaReworkLines) {
    const canonical = group.canonicalWorkOrder;
    const lines = group.lines.slice().sort(compareLines);
    const sources = Array.from(group.sources).sort();
    const governingSource = sources.includes("APPROVED") ? "APPROVED" : "EXACT";
    const relationshipState = governingSource;
    const due = earliestDueDate(lines);
    const customerNumbers = unique(lines.map(line => line.customerNumber));
    const customerNames = unique(lines.map(line => line.customerName));

    const disposition = normalizeDisposition(dispositionReview);
    const primaryQueue = disposition.currentDisposition === "NEEDS_KITTING"
      ? PRIMARY_QUEUES.NEEDS_KITTING : disposition.currentDisposition === "KIT_SHORT"
        ? PRIMARY_QUEUES.KIT_SHORT : disposition.currentDisposition === "KIT_COMPLETE"
          ? PRIMARY_QUEUES.KIT_COMPLETE : PRIMARY_QUEUES.NOT_CLASSIFIED;
    return Object.freeze({
      queueKey: "WO|" + group.workOrderNumber,
      primaryQueue,
      currentKittingClassification: primaryQueue === PRIMARY_QUEUES.NEEDS_KITTING
        ? "Needs Kitting" : primaryQueue === PRIMARY_QUEUES.KIT_SHORT
          ? "Kit Short" : primaryQueue === PRIMARY_QUEUES.KIT_COMPLETE ? "Kit Complete" : "Needs Disposition",
      manualKittingDisposition: disposition,
      ready: true,
      actionable: true,
      workOrderNumber: group.workOrderNumber,
      customerNumber: cleanText(canonical.customerNumber) || joinIdentity(customerNumbers),
      customerName: joinIdentity(customerNames),
      assemblyItemNumber: cleanText(canonical.itemNumber) || lines[0]?.itemNumber || "",
      revision: cleanText(canonical.drawingRevision || canonical.bomRevision),
      canonicalWorkOrderQuantity: parseQuantity(canonical.schProdQuantity),
      totalOperationalOpenQuantity: lines.reduce(
        (total, line) => total + parseQuantity(line.operationalQuantityOpen), 0
      ),
      earliestDueDate: due.value,
      earliestDueDateTime: due.time,
      relatedOpenSalesOrderLineCount: lines.length,
      governingSource,
      relationshipState,
      relationshipStates: Array.from(group.relationshipStates).sort(),
      documentPresence: normalizeDocumentEvidence(documentEvidence),
      canonicalWorkOrder: { ...canonical },
      relatedLines: lines,
      rmaReworkLines: rmaReworkLines || []
    });
  }

  function buildResolutionRow(line, authority, reason) {
    const candidates = Array.isArray(line.relationship?.candidates)
      ? unique(line.relationship.candidates.map(candidate =>
          normalizeWorkOrderNumber(candidate?.workOrderNumber)))
      : [];
    const due = normalizeDueDate(line.dueDate);
    return Object.freeze({
      queueKey: "LINE|" + line.lineKey,
      primaryQueue: PRIMARY_QUEUES.NEEDS_RESOLUTION,
      currentKittingClassification: "Needs Resolution",
      ready: false,
      actionable: false,
      workOrderNumber: "",
      candidateWorkOrderNumbers: candidates,
      customerNumber: line.customerNumber,
      customerName: line.customerName,
      assemblyItemNumber: line.itemNumber,
      revision: "",
      canonicalWorkOrderQuantity: null,
      totalOperationalOpenQuantity: parseQuantity(line.operationalQuantityOpen),
      earliestDueDate: line.dueDate,
      earliestDueDateTime: due.time,
      relatedOpenSalesOrderLineCount: 1,
      governingSource: authority.governingSource,
      relationshipState: authority.relationshipState,
      relationshipStates: [authority.relationshipState],
      documentPresence: normalizeDocumentEvidence(null),
      resolutionReason: reason,
      canonicalWorkOrder: null,
      relatedLines: [{ ...line, authority }]
    });
  }

  function buildRmaReworkRow(group) {
    const lines = group.lines.slice().sort(compareLines);
    const due = earliestDueDate(lines);
    const pendingMembership = group.caseStatus === "ACTIVE";
    return Object.freeze({
      queueKey: "RMA|" + (group.caseId || group.caseReference),
      primaryQueue: PRIMARY_QUEUES.RMA_REWORK,
      currentKittingClassification: "RMA / Rework",
      ready: false,
      actionable: false,
      workOrderNumber: "",
      customerNumber: group.customerNumber,
      customerName: group.customerName,
      assemblyItemNumber: joinIdentity(unique(lines.map(line => line.itemNumber))),
      revision: "",
      canonicalWorkOrderQuantity: null,
      totalOperationalOpenQuantity: lines.reduce(
        (total, line) => total + parseQuantity(line.operationalQuantityOpen), 0),
      earliestDueDate: due.value,
      earliestDueDateTime: due.time,
      relatedOpenSalesOrderLineCount: lines.length,
      governingSource: "RMA_REWORK",
      relationshipState: "RMA_REWORK",
      relationshipStates: ["RMA_REWORK"],
      documentPresence: normalizeDocumentEvidence(null),
      canonicalWorkOrder: null,
      relatedLines: lines,
      rmaReworkLines: lines,
      rmaCaseId: group.caseId,
      rmaCaseReference: group.caseReference,
      rmaCaseType: group.caseType,
      rmaCaseStatus: group.caseStatus,
      workOrderDecision: pendingMembership ? "Decision Pending" : "Return Review Required",
      nextRequiredAction: pendingMembership
        ? "Review RMA/Rework disposition" : "Create or confirm RMA/Rework membership"
    });
  }

  function buildCounts(lines, queues, rmaReworkByLineKey, directFulfillmentLines = []) {
    const primaryRows = [
      ...queues.notClassified,
      ...queues.needsResolution,
      ...queues.needsKitting,
      ...queues.kitShort,
      ...queues.kitComplete
    ];
    const membership = new Map();
    primaryRows.forEach(row => {
      const set = membership.get(row.queueKey) || new Set();
      set.add(row.primaryQueue);
      membership.set(row.queueKey, set);
    });
    const governed = [...queues.notClassified, ...queues.needsKitting, ...queues.kitShort, ...queues.kitComplete];
    const exact = governed.filter(row => row.governingSource === "EXACT");
    const approved = governed.filter(row => row.governingSource === "APPROVED");
    const resolutionLines = queues.needsResolution.flatMap(row => row.relatedLines);
    const knownStates = new Set(Object.values(RELATIONSHIP_STATES));

    return Object.freeze({
      openSalesOrderLinesEvaluated: lines.length,
      rmaReworkExcludedLines: queues.rmaRework.reduce(
        (total, row) => total + row.relatedOpenSalesOrderLineCount, 0),
      directFulfillmentExcludedLines: directFulfillmentLines.length,
      uniqueGovernedWorkOrders: governed.length,
      exactWorkOrders: exact.length,
      approvedWorkOrders: approved.length,
      candidateRecords: resolutionLines.filter(line =>
        line.authority.relationshipState === RELATIONSHIP_STATES.CANDIDATE).length,
      ambiguousRecords: resolutionLines.filter(line =>
        line.authority.relationshipState === RELATIONSHIP_STATES.AMBIGUOUS).length,
      unresolvedRecords: resolutionLines.filter(line =>
        line.authority.relationshipState === RELATIONSHIP_STATES.UNRESOLVED).length,
      uniqueWorkOrdersWithMultipleLines: governed.filter(row =>
        row.relatedOpenSalesOrderLineCount > 1).length,
      ready: governed.length,
      notClassified: queues.notClassified.length,
      needsResolution: queues.needsResolution.length,
      needsKitting: queues.needsKitting.length,
      kitShort: queues.kitShort.length,
      kitComplete: queues.kitComplete.length,
      rmaRework: queues.rmaRework.length,
      duplicatePrimaryQueueMembership: Array.from(membership.values())
        .filter(queueNames => queueNames.size > 1).length,
      blankActionableWorkOrders: primaryRows.filter(row => row.actionable && !row.workOrderNumber).length,
      legacyFallbackRecords: 0,
      temporaryBrowserStateDependencies: 0,
      kitShortInferredFromDocumentPresence: 0,
      kitCompleteInferredWithoutAuthoritativeStatus: 0,
      unclassifiedRelationshipStates: primaryRows.reduce((count, row) =>
        count + row.relationshipStates.filter(state => !knownStates.has(state)).length, 0)
    });
  }

  function normalizeLine(line = {}) {
    const customerNumber = cleanText(line.customerNumber);
    const salesOrderNumber = cleanText(line.salesOrderNumber);
    const salesOrderLineNumber = cleanText(line.salesOrderLineNumber || line.lineNumber);
    return {
      ...line,
      lineKey: cleanText(line.lineKey) ||
        [customerNumber, salesOrderNumber, salesOrderLineNumber].join("|"),
      customerNumber,
      customerName: cleanText(line.customerName),
      salesOrderNumber,
      salesOrderLineNumber,
      itemNumber: cleanText(line.itemNumber),
      quantityOrdered: parseQuantity(line.quantityOrdered),
      operationalQuantityOpen: parseQuantity(line.operationalQuantityOpen),
      dueDate: cleanText(line.dueDate),
      relationship: line.relationship || {},
      sourceRecord: line.sourceRecord || null
    };
  }

  function normalizeWorkOrder(workOrder = {}) {
    return Object.fromEntries(Object.entries(workOrder).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value
    ]));
  }

  function normalizeDocumentEvidence(evidence) {
    const state = cleanText(evidence?.state).toUpperCase();
    return Object.freeze({
      state: ["PRESENT", "ABSENT", "UNAVAILABLE"].includes(state) ? state : "UNAVAILABLE",
      label: cleanText(evidence?.label) || "Document folders not connected",
      kitShortPresent: evidence?.kitShortPresent === true,
      kitCompletePresent: evidence?.kitCompletePresent === true
    });
  }

  function normalizeDisposition(review) {
    const value = cleanText(review?.currentDisposition).toUpperCase();
    return Object.freeze({
      currentDisposition: ["NEEDS_KITTING", "KIT_SHORT", "KIT_COMPLETE"].includes(value) ? value : "NOT_DISPOSITIONED",
      currentEvent: review?.currentEvent || null,
      loadError: review?.loadError === true
    });
  }

  function normalizeWorkOrderNumber(value) {
    const text = cleanText(value).toUpperCase();
    return text && text !== "UNKNOWN" ? text : "";
  }

  function earliestDueDate(lines) {
    return lines.map(line => normalizeDueDate(line.dueDate))
      .filter(item => item.value)
      .sort((left, right) => left.time - right.time)[0] || { value: "", time: Number.POSITIVE_INFINITY };
  }

  function normalizeDueDate(value) {
    const text = cleanText(value);
    const time = text ? Date.parse(text) : NaN;
    return { value: text, time: Number.isFinite(time) ? time : Number.POSITIVE_INFINITY };
  }

  function compareLines(left, right) {
    return left.salesOrderNumber.localeCompare(right.salesOrderNumber) ||
      left.salesOrderLineNumber.localeCompare(right.salesOrderLineNumber);
  }

  function compareQueueRows(left, right) {
    return left.earliestDueDateTime - right.earliestDueDateTime ||
      left.workOrderNumber.localeCompare(right.workOrderNumber) ||
      left.queueKey.localeCompare(right.queueKey);
  }

  function joinIdentity(values) {
    return values.length === 1 ? values[0] : values.length ? "Multiple" : "";
  }

  function unique(values) {
    return Array.from(new Set(values.map(cleanText).filter(Boolean)));
  }

  function parseQuantity(value) {
    const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function asLookup(value) {
    if (value && typeof value.get === "function" && typeof value.set === "function") return value;
    return new Map(Object.entries(value || {}));
  }

  window.KittingReadModel = Object.freeze({
    RELATIONSHIP_STATES,
    PRIMARY_QUEUES,
    buildReadModel,
    collectActionableWorkOrderNumbers,
    resolveLineAuthority
  });
})(window);

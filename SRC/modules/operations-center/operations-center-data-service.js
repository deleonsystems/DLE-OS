/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER CANONICAL DATA SERVICE
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const PAGE_SIZE = 200;
  const SOURCE_NAME = 'DLE_OS_CANONICAL_LIVE';
  const SOURCE_ENDPOINT = '/api/platform/live/v1/sales-orders';
  const RELATIONSHIP_ENDPOINT = '/api/platform/live/v1/sales-order-work-order-relationships';
  const LOOKUP_CONCURRENCY = 8;
  const activeControllers = new Map();
  const requestSequences = new Map();

  async function loadCanonicalRows(options = {}) {
    const client = window.DleApiClient?.liveCanonical;
    if (!client?.getCanonicalSalesOrders) {
      throw new Error('The governed canonical Sales Orders API client is unavailable.');
    }

    const requestScope = String(options.requestScope || 'operations-center');
    activeControllers.get(requestScope + '-enrichment')?.abort();
    activeControllers.get(requestScope)?.abort();
    const controller = new AbortController();
    activeControllers.set(requestScope, controller);
    const requestId = (requestSequences.get(requestScope) || 0) + 1;
    requestSequences.set(requestScope, requestId);
    const items = [];
    let page = 1;
    let expectedTotal = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await client.getCanonicalSalesOrders({
        page,
        pageSize: PAGE_SIZE,
        signal: controller.signal
      });
      validatePage(response, page);

      if (expectedTotal === null) expectedTotal = response.totalItems;
      if (response.totalItems !== expectedTotal) {
        throw new Error('Canonical Sales Orders total changed while pages were loading.');
      }

      items.push(...response.items);
      hasNextPage = response.hasNextPage;
      page += 1;
      if (hasNextPage && page > response.totalPages) {
        throw new Error('Canonical Sales Orders pagination did not terminate correctly.');
      }
    }

    if (requestId !== requestSequences.get(requestScope) || controller.signal.aborted) {
      throw new DOMException('Stale Operations Center request.', 'AbortError');
    }
    if (items.length !== expectedTotal) {
      throw new Error('Canonical Sales Orders returned ' + items.length + ' of ' + expectedTotal + ' records.');
    }

    const relationships = await loadAllRelationships(client, controller.signal);
    const relationshipByKey = new Map(relationships.map(relationship => [
      relationshipKey(relationship.customerNumber, relationship.salesOrderNumber, relationship.salesOrderLineNumber),
      relationship
    ]));
    const rows = items.map(source => {
      const key = relationshipKey(source.customerNumber, source.salesOrderNumber, source.lineNumber);
      const relationship = relationshipByKey.get(key);
      if (!relationship) {
        throw new Error('The governed Work Order relationship API omitted Sales Order line ' + key + '.');
      }
      return normalizeRow(source, relationship);
    });
    validateUniqueIdentities(rows);
    return {
      rows,
      requestId,
      recordCount: rows.length,
      totalItems: expectedTotal,
      loadedAt: new Date().toISOString(),
      source: SOURCE_NAME,
      endpoint: SOURCE_ENDPOINT
    };
  }

  async function loadOperationalEnrichment(canonicalResult, options = {}) {
    const sourceRows = Array.isArray(canonicalResult?.rows) ? canonicalResult.rows : [];
    const requestScope = String(options.requestScope || 'operations-center') + '-enrichment';
    activeControllers.get(requestScope)?.abort();
    const controller = new AbortController();
    activeControllers.set(requestScope, controller);
    // Probe the single paged operational source first. When 5054 is offline this
    // fails before launching one approval request per canonical line.
    const rmaReworkByLineKey = await loadAllActiveRmaReworkMemberships(controller.signal);
    const approvalsByLineKey = await loadAllApprovalReviews(sourceRows, controller.signal);
    if (controller.signal.aborted) throw new DOMException('Stale Operations Center enrichment request.', 'AbortError');
    const operationalRows = sourceRows.map(source => {
      const key = relationshipKey(source.customerNumber, source.salesOrderNumber, source.salesOrderLineNumber);
      return {
        ...source,
        rmaReworkMembership: rmaReworkByLineKey.get(key) || null,
        workOrderApprovalReview: approvalsByLineKey.get(key) || null
      };
    });
    const rows = await applyMaterialStatusProjection(operationalRows, controller.signal);
    validateUniqueIdentities(rows);
    return {
      ...canonicalResult,
      rows,
      recordCount: rows.length,
      loadedAt: new Date().toISOString()
    };
  }

  async function applyMaterialStatusProjection(rows, signal) {
    const projection = window.MaterialStatus;
    if (!projection?.getMany) throw new Error('The shared Material Status projection is unavailable.');
    const workOrderNumbers = rows.map(resolveMaterialStatusWorkOrder).filter(Boolean);
    const statuses = await projection.getMany(workOrderNumbers, { signal, concurrency: 4 });
    return rows.map(row => {
      const workOrderNumber = resolveMaterialStatusWorkOrder(row);
      return {
        ...row,
        materialStatus: workOrderNumber ? statuses.get(workOrderNumber) || null : null,
        materialStatusWorkOrderNumber: workOrderNumber
      };
    });
  }

  function resolveMaterialStatusWorkOrder(row) {
    const operational = row?.workOrderApprovalReview?.operationalRelationship;
    const route = cleanText(operational?.operationalRoute);
    const active = cleanText(operational?.activeWorkOrderNumber);
    if (route === 'NORMAL_PRODUCTION' && active) return normalizeWorkOrderNumber(active);
    if (['RMA_REWORK', 'RETURN_RMA_REVIEW_REQUIRED'].includes(route)) return '';
    const approved = cleanText(row?.workOrderApprovalReview?.currentApproval?.approvedWorkOrderNumber);
    if (approved) return normalizeWorkOrderNumber(approved);
    return row?.workOrderRelationship?.status === 'EXACT_LINE_UNIQUE'
      ? normalizeWorkOrderNumber(row.workOrderRelationship.actionableWorkOrderNumber) : '';
  }

  function normalizeWorkOrderNumber(value) {
    const text = cleanText(value);
    return /^\d+$/.test(text) ? text.padStart(7, '0') : '';
  }

  async function loadAllRelationships(client, signal) {
    if (!client?.getCanonicalSalesOrderWorkOrderRelationships) {
      throw new Error('The governed Sales Order to Work Order relationship API client is unavailable.');
    }
    const items = [];
    let page = 1;
    let expectedTotal = null;
    let hasNextPage = true;
    while (hasNextPage) {
      const response = await client.getCanonicalSalesOrderWorkOrderRelationships({
        page,
        pageSize: PAGE_SIZE,
        signal
      });
      validatePage(response, page);
      if (expectedTotal === null) expectedTotal = response.totalItems;
      if (response.totalItems !== expectedTotal) {
        throw new Error('Work Order relationship total changed while pages were loading.');
      }
      items.push(...response.items.map(normalizeRelationship));
      hasNextPage = response.hasNextPage;
      page += 1;
    }
    if (items.length !== expectedTotal) {
      throw new Error('Work Order relationships returned ' + items.length + ' of ' + expectedTotal + ' records.');
    }
    return items;
  }

  async function loadAllActiveRmaReworkMemberships(signal) {
    const getter = window.DleApiClient?.getRmaReworkCases;
    if (typeof getter !== 'function') {
      throw new Error('Active RMA/Rework membership is unavailable. Operations Center routing is blocked.');
    }

    const cases = [];
    let page = 1;
    let expectedTotal = null;
    while (expectedTotal === null || cases.length < expectedTotal) {
      const response = await getter({ status: 'ACTIVE', page, pageSize: PAGE_SIZE, signal });
      const pageItems = Array.isArray(response?.items) ? response.items : null;
      const totalItems = Number(response?.totalItems);
      if (!pageItems || !Number.isInteger(totalItems) || totalItems < 0) {
        throw new Error('Active RMA/Rework membership returned an incomplete read model.');
      }
      if (expectedTotal === null) expectedTotal = totalItems;
      else if (expectedTotal !== totalItems) {
        throw new Error('Active RMA/Rework membership changed during paging. Refresh Operations Center.');
      }
      cases.push(...pageItems);
      if (!pageItems.length && cases.length < expectedTotal) {
        throw new Error('Active RMA/Rework membership paging ended before all cases were loaded.');
      }
      page += 1;
    }

    const caseIds = new Set(cases.map(caseRecord => cleanText(caseRecord?.caseId)).filter(Boolean));
    if (cases.length !== expectedTotal || caseIds.size !== cases.length) {
      throw new Error('Active RMA/Rework membership could not be verified completely.');
    }

    const memberships = new Map();
    cases.forEach(caseRecord => (caseRecord.members || []).forEach(member => {
      const key = relationshipKey(
        member.customerNumber,
        member.salesOrderNumber,
        member.salesOrderLineNumber
      );
      if (memberships.has(key)) {
        throw new Error('An active Sales Order line belongs to more than one RMA/Rework case.');
      }
      memberships.set(key, {
        caseId: cleanText(caseRecord.caseId),
        caseReference: cleanText(caseRecord.caseReference),
        caseType: cleanText(caseRecord.caseType),
        caseStatus: cleanText(caseRecord.caseStatus),
        member: { ...member }
      });
    }));
    return memberships;
  }

  async function loadAllApprovalReviews(rows, signal) {
    const getter = window.DleApiClient?.getWorkOrderApprovalReview;
    if (typeof getter !== 'function') {
      throw new Error('Current governed Work Order approvals are unavailable. Operations Center routing is blocked.');
    }
    const reviews = new Map();
    await mapWithConcurrency(rows, LOOKUP_CONCURRENCY, async source => {
      const lineNumber = source.salesOrderLineNumber || source.lineNumber;
      const key = relationshipKey(source.customerNumber, source.salesOrderNumber, lineNumber);
      const review = await getter(
        source.customerNumber,
        source.salesOrderNumber,
        lineNumber,
        { signal }
      );
      reviews.set(key, review || {});
    });
    return reviews;
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    let index = 0;
    const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
      while (index < items.length) {
        const current = index++;
        await worker(items[current], current);
      }
    });
    await Promise.all(runners);
  }

  function validatePage(response, page) {
    if (!response || typeof response !== 'object' || !Array.isArray(response.items)) {
      throw new Error('Canonical Sales Orders returned a malformed page.');
    }
    if (!Number.isInteger(response.page) || response.page !== page ||
        !Number.isInteger(response.totalItems) || response.totalItems < 0 ||
        !Number.isInteger(response.totalPages) || response.totalPages < 0 ||
        typeof response.hasNextPage !== 'boolean') {
      throw new Error('Canonical Sales Orders pagination metadata is malformed.');
    }
  }

  function normalizeRow(source, workOrderRelationship = null, rmaReworkMembership = null, approvalReview = null) {
    if (!source || typeof source !== 'object') {
      throw new Error('Canonical Sales Orders contains a malformed record.');
    }

    const customerNumber = requiredText(source.customerNumber, 'customerNumber');
    const salesOrderNumber = requiredText(source.salesOrderNumber, 'salesOrderNumber');
    const lineNumber = requiredText(source.lineNumber, 'lineNumber');
    const salesOrderLineId = requiredText(source.salesOrderLineId, 'salesOrderLineId');
    const quantityOrdered = requiredNumber(source.quantityOrdered, 'quantityOrdered');
    const erpQuantityOpen = requiredNumber(source.erpQuantityOpen, 'erpQuantityOpen');
    const unitPrice = requiredNumber(source.unitPrice, 'unitPrice');
    const extendedPrice = requiredNumber(source.extendedPrice, 'extendedPrice');
    const masterRecordKey = [customerNumber, salesOrderNumber, lineNumber].join('|');
    const relationship = workOrderRelationship || normalizeRelationship({
      customerNumber,
      salesOrderNumber,
      salesOrderLineNumber: lineNumber,
      salesOrderItemNumber: source.itemNumber,
      resolutionStatus: 'UNRESOLVED',
      resolutionBasis: 'NO_SUPPORTED_RELATIONSHIP',
      candidateCount: 0,
      candidates: []
    });
    const workOrder = relationship.status === 'EXACT_LINE_UNIQUE'
      ? cleanText(relationship.actionableWorkOrderNumber)
      : '';
    const itemNumber = cleanText(source.itemNumber);
    const description = cleanText(source.description);
    const orderDate = cleanText(source.orderDate);
    const dueDate = cleanText(source.estimatedShipDate);

    return {
      salesOrderLineId,
      masterRecordKey,
      compatibilityKey: masterRecordKey,
      orderDate,
      customerNumber,
      customerName: cleanText(source.customerName),
      customerPurchaseOrderNumber: cleanText(source.customerPurchaseOrderNumber),
      salesOrderNumber,
      salesOrderLineNumber: lineNumber,
      workOrderNumber: workOrder,
      workOrderRelationship: relationship,
      rmaReworkMembership: rmaReworkMembership ? { ...rmaReworkMembership } : null,
      workOrderApprovalReview: approvalReview ? { ...approvalReview } : null,
      itemNumber,
      description,
      estimatedShipDate: dueDate,
      quantityOrdered,
      erpQuantityOpen,
      unitPrice,
      extendedPrice,
      scheduledProductionQuantity: optionalNumber(source.scheduledProductionQuantity),
      billNumber: cleanText(source.billNumber),
      drawingNumber: cleanText(source.drawingNumber),
      drawingRevision: cleanText(source.drawingRevision),
      bomRevision: cleanText(source.bomRevision),
      orderMemo: cleanText(source.orderMemo),
      id: masterRecordKey,
      vpro5: {
        orderDate: formatLegacyDate(orderDate),
        customerNumber,
        customer: cleanText(source.customerName),
        customerPo: cleanText(source.customerPurchaseOrderNumber),
        salesOrder: salesOrderNumber,
        sequenceLine: lineNumber,
        workOrder,
        qtyOpen: formatNumber(erpQuantityOpen),
        partNumber: itemNumber,
        description,
        dueDate: formatLegacyDate(dueDate),
        price: formatNumber(unitPrice),
        extendedPrice: formatNumber(extendedPrice),
        billNumber: cleanText(source.billNumber),
        drawingNumber: cleanText(source.drawingNumber),
        drawingRevision: cleanText(source.drawingRevision),
        revisionCode: cleanText(source.drawingRevision || source.bomRevision)
      },
      canonical: { ...source }
    };
  }

  function normalizeRelationship(source) {
    const allowed = new Set([
      'EXACT_LINE_UNIQUE',
      'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',
      'SALES_ORDER_LEVEL_CANDIDATE',
      'AMBIGUOUS',
      'UNRESOLVED'
    ]);
    const status = cleanText(source?.resolutionStatus);
    if (!allowed.has(status)) throw new Error('Work Order relationship has an invalid resolutionStatus.');
    const candidates = Array.isArray(source?.candidates)
      ? source.candidates.map(candidate => ({
          workOrderNumber: cleanText(candidate.workOrderNumber),
          itemNumber: cleanText(candidate.itemNumber),
          scheduledProductionQuantity: optionalNumber(candidate.scheduledProductionQuantity),
          anchorSalesOrderLine: cleanText(candidate.anchorSalesOrderLine),
          bomRevision: cleanText(candidate.bomRevision),
          drawingNumber: cleanText(candidate.drawingNumber),
          drawingRevision: cleanText(candidate.drawingRevision),
          source: cleanText(candidate.relationshipSource),
          sourceSnapshotId: cleanText(candidate.sourceSnapshotId),
          sourceImportRunId: cleanText(candidate.sourceImportRunId)
        }))
      : [];
    const actionableWorkOrderNumber = cleanText(source?.actionableWorkOrderNumber);
    if (status === 'EXACT_LINE_UNIQUE' && !actionableWorkOrderNumber) {
      throw new Error('An exact Work Order relationship is missing its actionable Work Order.');
    }
    if (status !== 'EXACT_LINE_UNIQUE' && actionableWorkOrderNumber) {
      throw new Error('A non-exact Work Order relationship cannot be actionable.');
    }
    return {
      customerNumber: cleanText(source?.customerNumber),
      salesOrderNumber: cleanText(source?.salesOrderNumber),
      salesOrderLineNumber: cleanText(source?.salesOrderLineNumber),
      salesOrderItemNumber: cleanText(source?.salesOrderItemNumber),
      status,
      basis: cleanText(source?.resolutionBasis),
      anchorSalesOrderLine: cleanText(source?.anchorSalesOrderLine),
      actionableWorkOrderNumber,
      candidateCount: Number.isInteger(source?.candidateCount)
        ? source.candidateCount
        : candidates.length,
      candidates
    };
  }

  function relationshipKey(customerNumber, salesOrderNumber, lineNumber) {
    return [cleanText(customerNumber), cleanText(salesOrderNumber), cleanText(lineNumber)].join('|');
  }

  function validateUniqueIdentities(rows) {
    const canonicalIds = new Set();
    const compatibilityKeys = new Set();
    rows.forEach(row => {
      if (canonicalIds.has(row.salesOrderLineId)) {
        throw new Error('Duplicate canonical Sales Order Line ID: ' + row.salesOrderLineId);
      }
      if (compatibilityKeys.has(row.masterRecordKey)) {
        throw new Error('Duplicate Operations Center compatibility key: ' + row.masterRecordKey);
      }
      canonicalIds.add(row.salesOrderLineId);
      compatibilityKeys.add(row.masterRecordKey);
    });
  }

  function requiredText(value, field) {
    const normalized = cleanText(value);
    if (!normalized) throw new Error('Canonical Sales Orders record is missing ' + field + '.');
    return normalized;
  }

  function cleanText(value) {
    return String(value ?? '').trim();
  }

  function requiredNumber(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error('Canonical Sales Orders record has invalid ' + field + '.');
    }
    return number;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  function formatLegacyDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? match[2] + '/' + match[3] + '/' + match[1].slice(-2) : String(value || '');
  }

  function cancel() {
    activeControllers.forEach(controller => controller.abort());
    activeControllers.clear();
  }

  window.OperationsCenter.dataService = {
    loadCanonicalRows,
    loadOperationalEnrichment,
    normalizeRow,
    normalizeRelationship,
    cancel,
    sourceName: SOURCE_NAME,
    sourceEndpoint: SOURCE_ENDPOINT
  };
})();

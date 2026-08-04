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
  let activeController = null;
  let requestSequence = 0;

  async function loadCanonicalRows() {
    const client = window.DleApiClient?.liveCanonical;
    if (!client?.getCanonicalSalesOrders) {
      throw new Error('The governed canonical Sales Orders API client is unavailable.');
    }

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const requestId = ++requestSequence;
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

    if (requestId !== requestSequence || controller.signal.aborted) {
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

  function normalizeRow(source, workOrderRelationship = null) {
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
      dle: { operationalStatus: '' },
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
    activeController?.abort();
    activeController = null;
  }

  window.OperationsCenter.dataService = {
    loadCanonicalRows,
    normalizeRow,
    normalizeRelationship,
    cancel,
    sourceName: SOURCE_NAME,
    sourceEndpoint: SOURCE_ENDPOINT
  };
})();

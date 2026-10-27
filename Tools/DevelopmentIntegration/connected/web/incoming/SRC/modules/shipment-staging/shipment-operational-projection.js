(function registerShipmentOperationalProjection(window) {
  "use strict";

  const ACTIVE_STATUSES = Object.freeze(new Set([
    "AWAITING_ERP_EVIDENCE",
    "POSSIBLE_MATCH_FOUND",
    "MATCH_REVIEW_REQUIRED",
    "MISMATCH_EXCEPTION",
    "ERP_CONFIRMED",
    "PENDING INVOICE"
  ]));
  const CONFIRMED_STATUS = "ERP_CONFIRMED";

  function normalize(value, width = 0) {
    const text = String(value ?? "").trim();
    return width && /^\d+$/.test(text) ? text.padStart(width, "0") : text;
  }

  function number(value) {
    const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function lineKey(customerNumber, salesOrderNumber, lineNumber) {
    return [normalize(customerNumber, 6), normalize(salesOrderNumber, 7), normalize(lineNumber, 3)].join("|");
  }

  function recordLineKey(record) {
    return lineKey(
      record?.customerNumber || record?.vpro5?.customerNumber,
      record?.salesOrderNumber || record?.salesOrder || record?.vpro5?.salesOrder,
      record?.salesOrderLineNumber || record?.salesOrderLine || record?.lineNumber || record?.vpro5?.sequenceLine
    );
  }

  function isActiveStatus(status) {
    return ACTIVE_STATUSES.has(normalize(status).toUpperCase());
  }

  function getRecords(records) {
    if (Array.isArray(records)) return records;
    if (typeof shipmentStagingState !== "undefined" && Array.isArray(shipmentStagingState.records)) {
      return shipmentStagingState.records;
    }
    return Array.isArray(window.shipmentStagingState?.records) ? window.shipmentStagingState.records : [];
  }

  function projectLine(line, records) {
    const key = recordLineKey(line);
    const canonicalOpenQuantity = number(
      line?.erpQuantityOpen ?? line?.erpQtyOpen ?? line?.official?.erpQtyOpen ?? line?.vpro5?.qtyOpen
    );
    const quantityOrdered = number(
      line?.quantityOrdered ?? line?.official?.quantityOrdered ?? line?.vpro5?.quantityOrdered
    );
    const activeRecords = getRecords(records).filter(record =>
      recordLineKey(record) === key && isActiveStatus(record?.status || record?.operationalStatus || record?.currentStatus)
    );
    const stagedQuantity = activeRecords.reduce((sum, record) => sum + number(
      record?.quantityShipped ?? record?.quantityProcessed
    ), 0);
    const confirmedRecords = activeRecords.filter(record =>
      normalize(record?.status || record?.operationalStatus || record?.currentStatus).toUpperCase() === CONFIRMED_STATUS
    );
    const confirmedQuantity = confirmedRecords.reduce((sum, record) => sum + number(
      record?.confirmedQuantity ?? record?.quantityShipped ?? record?.quantityProcessed
    ), 0);
    const pendingQuantity = Math.max(stagedQuantity - confirmedQuantity, 0);

    const baselines = confirmedRecords.map(record => number(
      record?.canonicalOpenQuantityAtShipment ?? record?.originalOpenQuantity
    )).filter(value => value > 0);
    const recognizedConfirmedQuantity = baselines.length
      ? Math.min(confirmedQuantity, Math.max(Math.max(...baselines) - canonicalOpenQuantity, 0))
      : 0;
    const unreflectedConfirmedQuantity = Math.max(confirmedQuantity - recognizedConfirmedQuantity, 0);
    const deductibleStagedQuantity = pendingQuantity + unreflectedConfirmedQuantity;
    const operationalRemainingQuantity = Math.max(canonicalOpenQuantity - deductibleStagedQuantity, 0);
    const isFullyStaged = stagedQuantity > 0 && operationalRemainingQuantity === 0;
    const isPartiallyStaged = stagedQuantity > 0 && operationalRemainingQuantity > 0;

    return Object.freeze({
      lineKey: key,
      quantityOrdered,
      canonicalOpenQuantity,
      stagedQuantity,
      pendingQuantity,
      confirmedQuantity,
      recognizedConfirmedQuantity,
      deductibleStagedQuantity,
      operationalRemainingQuantity,
      isFullyStaged,
      isPartiallyStaged,
      operationalRoute: stagedQuantity > 0 ? "SHIPMENT_RECONCILIATION" : "",
      operationalStatus: isFullyStaged
        ? "SHIPPED_AWAITING_ERP_EVIDENCE"
        : isPartiallyStaged ? "PARTIALLY_SHIPPED_AWAITING_ERP_EVIDENCE" : "",
      statusLabel: isFullyStaged
        ? "Shipped — Awaiting ERP Evidence"
        : isPartiallyStaged ? "Partially Shipped — Awaiting ERP Evidence" : "",
      activeRecords: Object.freeze(activeRecords.slice())
    });
  }

  function validateShipmentQuantity(line, requestedQuantity, records) {
    const projection = projectLine(line, records);
    const requested = number(requestedQuantity);
    return Object.freeze({
      valid: requested > 0 && requested <= projection.operationalRemainingQuantity,
      requestedQuantity: requested,
      ...projection
    });
  }

  window.ShipmentOperationalProjection = Object.freeze({
    activeStatuses: ACTIVE_STATUSES,
    isActiveStatus,
    lineKey,
    recordLineKey,
    projectLine,
    validateShipmentQuantity
  });
})(window);

(function registerShippingWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "shipping";
  const TEMPLATE_PATH = "SRC/modules/shipping/shipping-workspace.html";
  let operationalStateSubscription = null;
  const state = {
    requests: [],
    packingRequests: [],
    selectedShippingRequest: null,
    selectedPackingRequest: null,
    returnDialogRequest: null,
    processingPackingRequest: null,
    shipmentStagingLoading: false,
    shipmentStagingError: null,
    expandedShippingRequests: new Set(),
    expandedPackingRequests: new Set()
  };

  async function loadShippingWorkspace() {
    const mount = document.querySelector('[data-workspace-mount="shipping"]');
    if (!mount) return;

    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Shipping Workspace</h3><p>Preparing workspace layout...</p></div>';

      const response = await fetch(TEMPLATE_PATH);
      if (!response.ok) {
        throw new Error("Unable to load Shipping Workspace.");
      }

      mount.innerHTML = await response.text();
      mount.dataset.workspaceLoaded = "true";
    }

    ensureShipmentStagingSubscription();
    renderShippingWorkspace();
    await initializeShippingShipmentStaging();
  }

  function ensureShipmentStagingSubscription() {
    if (operationalStateSubscription || !window.DleApiClient?.subscribeOperationalLineStateChange) return;
    operationalStateSubscription = window.DleApiClient.subscribeOperationalLineStateChange(detail => {
      if (!isShippingWorkspaceActive()) return;
      if (detail.source === "shipment-staging-read-model-change") {
        renderShippingShipmentStaging();
        return;
      }
      const refresh = initializeShippingShipmentStaging();
      detail.waitUntil?.(refresh);
      return refresh;
    });
  }

  function isShippingWorkspaceActive() {
    return document.body?.dataset?.workspaceView === WORKSPACE_ID &&
      !!document.getElementById("shippingShipmentStaging");
  }

  async function initializeShippingShipmentStaging() {
    state.shipmentStagingLoading = true;
    state.shipmentStagingError = null;
    renderShippingShipmentStaging();
    try {
      if (window.usesOperationalShipmentStaging?.()) {
        if (typeof window.refreshOperationalShipmentStaging !== "function") {
          throw new Error("The governed Shipment Staging read service is unavailable.");
        }
        await window.refreshOperationalShipmentStaging();
      }
    } catch (error) {
      state.shipmentStagingError = error;
    } finally {
      state.shipmentStagingLoading = false;
      renderShippingShipmentStaging();
    }
  }

  function openRequest(requestToShip) {
    enqueueRequest(requestToShip);

    if (typeof go === "function") {
      go("home");
    }

    if (typeof setWorkspaceView === "function") {
      setWorkspaceView(WORKSPACE_ID);
    } else {
      window.DleWorkspaceShell?.setWorkspaceView(WORKSPACE_ID);
    }
  }

  function enqueueRequest(requestToShip) {
    if (!requestToShip) return;
    state.requests.push(requestToShip);
    state.selectedShippingRequest = requestToShip;
    renderShippingWorkspace();
  }

  function renderShippingWorkspace() {
    renderShippingShipmentStaging();
    renderShippingQueue();
    renderPackingQueue();
    renderShippingActions();
  }

  function renderShippingShipmentStaging() {
    const host = document.getElementById("shippingShipmentStaging");
    const table = document.getElementById("shippingShipmentStagingTable");
    const status = document.getElementById("shippingShipmentStagingStatus");
    const refreshButton = document.getElementById("shippingShipmentStagingRefreshButton");
    if (!host || !table || !status) return;

    host.setAttribute("aria-busy", state.shipmentStagingLoading ? "true" : "false");
    if (refreshButton) refreshButton.disabled = state.shipmentStagingLoading;
    if (state.shipmentStagingLoading) {
      status.dataset.state = "loading";
      status.textContent = "Loading current governed Shipment Staging from the isolated development service…";
    } else if (state.shipmentStagingError) {
      status.dataset.state = "error";
      status.textContent = "Shipment Staging could not be loaded: " +
        (state.shipmentStagingError.message || "unknown service error") +
        (state.shipmentStagingError.requestId ? " Request " + state.shipmentStagingError.requestId + "." : "");
    } else {
      status.dataset.state = "ready";
    }

    const records = typeof shipmentStagingState !== "undefined" && Array.isArray(shipmentStagingState.records)
      ? shipmentStagingState.records
      : [];
    const lines = typeof window.getShipmentStagingDisplayLines === "function"
      ? window.getShipmentStagingDisplayLines(records)
      : [];
    configureShippingShipmentStagingStatuses(lines);

    if (!lines.length) {
      table.innerHTML = '<div class="shipping-shipment-staging-empty">' +
        (state.shipmentStagingError
          ? "No cached Shipment Staging rows are available. Use Refresh after the service is restored."
          : state.shipmentStagingLoading
            ? "Loading Shipment Staging records…"
            : "Shipment Staging is empty. No operational shipments are currently staged.") +
        '</div>';
      updateShippingShipmentStagingCount(0, 0);
      if (!state.shipmentStagingLoading && !state.shipmentStagingError) {
        status.textContent = "Shipment Staging loaded successfully with no current records.";
      }
      return;
    }

    table.innerHTML = [
      '<table class="operations-center-table shipping-shipment-staging-table">',
      '<thead><tr>',
      '<th>Processed</th><th>Shipment ID</th><th>Customer</th><th>Sales Order</th><th>Line</th>',
      '<th>Item</th><th>Staged Quantity</th><th>Operational Remaining</th><th>ERP Evidence Status</th><th>Proposed Invoice</th><th>Action</th>',
      '</tr></thead><tbody>',
      lines.map((line, index) => renderShippingShipmentStagingRow(line, index)).join(""),
      '</tbody></table>'
    ].join("");
    filterShippingShipmentStaging();
    if (!state.shipmentStagingLoading && !state.shipmentStagingError) {
      status.textContent = lines.length + " authoritative Shipment Staging line" +
        (lines.length === 1 ? " is" : "s are") + " available from the operational read model.";
    }
  }

  function renderShippingShipmentStagingRow(line, index) {
    const status = line.operationalStatus || line.status || "";
    const invoice = line.proposedInvoiceNumber
      ? line.proposedInvoiceNumber + (line.proposedInvoiceLineNumber ? " / " + line.proposedInvoiceLineNumber : "")
      : "None";
    const customer = [line.customerNumber, line.customerName].filter(Boolean).join(" - ");
    const operationalLine = (window.OperationsCenter?.state?.canonicalRows || []).find(record =>
      window.ShipmentOperationalProjection?.recordLineKey?.(record) ===
        window.ShipmentOperationalProjection?.recordLineKey?.(line)
    );
    const operationalRemaining = operationalLine && window.ShipmentOperationalProjection?.projectLine
      ? window.ShipmentOperationalProjection.projectLine(operationalLine).operationalRemainingQuantity
      : null;
    return [
      '<tr class="', index % 2 === 0 ? 'rowEven' : 'rowOdd',
      ' shipping-shipment-staging-row" tabindex="0" data-shipment-id="', escapeHtml(line.shipmentId),
      '" data-status="', escapeHtml(status),
      '" onclick="openShippingShipmentStagingReview(event)" onkeydown="handleShippingShipmentStagingRowKeydown(event)">',
      renderCell(formatShippingTimestamp(line.processedTimestamp || line.shipmentDateTime)),
      renderCell(line.shipmentId || "N/A"),
      renderCell(customer || "N/A"),
      renderCell(line.salesOrder || "N/A"),
      renderCell(line.salesOrderLine || "N/A"),
      renderCell(line.itemNumber || "N/A"),
      renderCell(formatQuantity(line.quantityShipped)),
      renderCell(operationalRemaining == null ? "N/A" : formatQuantity(operationalRemaining)),
      renderCell(status || "Awaiting ERP evidence"),
      renderCell(invoice),
      '<td><button type="button" data-shipment-id="', escapeHtml(line.shipmentId),
      '" onclick="openShippingShipmentStagingReview(event)">Review</button></td>',
      '</tr>'
    ].join("");
  }

  function configureShippingShipmentStagingStatuses(lines) {
    const select = document.getElementById("shippingShipmentStagingStatusFilter");
    if (!select) return;
    const selected = select.value;
    const statuses = Array.from(new Set(lines.map(line => line.operationalStatus || line.status).filter(Boolean))).sort();
    select.innerHTML = '<option value="">All statuses</option>' + statuses.map(status =>
      '<option value="' + escapeHtml(status) + '">' + escapeHtml(status) + '</option>'
    ).join("");
    select.value = statuses.includes(selected) ? selected : "";
  }

  function filterShippingShipmentStaging() {
    const search = String(document.getElementById("shippingShipmentStagingSearch")?.value || "").trim().toUpperCase();
    const selectedStatus = document.getElementById("shippingShipmentStagingStatusFilter")?.value || "";
    const rows = Array.from(document.querySelectorAll("#shippingShipmentStagingTable tbody tr"));
    let visible = 0;
    rows.forEach(row => {
      const matches = (!search || row.textContent.toUpperCase().includes(search)) &&
        (!selectedStatus || row.dataset.status === selectedStatus);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    updateShippingShipmentStagingCount(visible, rows.length);
  }

  function updateShippingShipmentStagingCount(visible, total) {
    const count = document.getElementById("shippingShipmentStagingCount");
    if (!count) return;
    count.textContent = visible === total
      ? total + (total === 1 ? " shipment" : " shipments")
      : visible + " of " + total + " shown";
  }

  async function refreshShippingShipmentStaging() {
    await initializeShippingShipmentStaging();
  }

  function openShippingShipmentStagingReview(event) {
    event?.stopPropagation?.();
    const shipmentId = event?.currentTarget?.dataset?.shipmentId || "";
    if (!shipmentId) return;
    window.selectShipmentStagingTransaction?.(null, shipmentId);
    window.openShipmentStagingReview?.();
  }

  function handleShippingShipmentStagingRowKeydown(event) {
    if (event?.target !== event?.currentTarget || !["Enter", " "].includes(event?.key)) return;
    event.preventDefault();
    openShippingShipmentStagingReview(event);
  }

  function formatShippingTimestamp(value) {
    if (!value) return "N/A";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function renderShippingQueue() {
    renderRequestQueue({
      queueName: "shipping",
      targetId: "shippingQueue",
      countId: "shippingQueueCount",
      requests: state.requests,
      selectedRequest: state.selectedShippingRequest,
      expandedRequests: state.expandedShippingRequests,
      emptyMessage: "Create a Request to Ship from the Sales Order Dashboard to populate the Shipping Queue.",
      defaultStatus: "Pending Shipping"
    });
    const printButton = document.getElementById("shippingPrintQueueButton");
    if (printButton) printButton.disabled = !state.requests.length;
  }

  function renderPackingQueue() {
    renderRequestQueue({
      queueName: "packing",
      targetId: "packingQueue",
      countId: "packingQueueCount",
      requests: state.packingRequests,
      selectedRequest: state.selectedPackingRequest,
      expandedRequests: state.expandedPackingRequests,
      emptyMessage: "Accept a selected Shipping Queue request to begin packing.",
      defaultStatus: "Packing"
    });
  }

  function renderRequestQueue(options) {
    const target = document.getElementById(options.targetId);
    const count = document.getElementById(options.countId);
    const requestCount = options.requests.length;
    if (count) {
      count.textContent = requestCount + (requestCount === 1 ? " request" : " requests");
    }
    if (!target) return;

    if (!requestCount) {
      target.innerHTML = '<div class="shipping-queue-empty">' + escapeHtml(options.emptyMessage) + '</div>';
      return;
    }

    target.innerHTML = [
      '<div class="operations-center-table-wrap shipping-queue-table-wrap">',
      '<table class="operations-center-table shipping-request-queue-table">',
      '<thead><tr>',
      '<th>Request ID</th>',
      '<th>Customer</th>',
      '<th>Sales Order</th>',
      '<th>Detail Lines</th>',
      '<th>Requested Ship Window</th>',
      '<th>Status</th>',
      '</tr></thead>',
      '<tbody>',
      options.requests.map((requestToShip, index) => renderRequestQueueRows(requestToShip, index, options)).join(""),
      '</tbody>',
      '</table>',
      '</div>'
    ].join("");
  }

  function renderRequestQueueRows(requestToShip, index, options) {
    const expanded = options.expandedRequests.has(requestToShip);
    const selected = requestToShip === options.selectedRequest;
    const detailLines = getRequestDisplayLines(requestToShip);
    const requestId = requestToShip.requestId || "N/A";
    const detailsId = options.queueName + '-request-details-' + index;
    const rowClass = options.queueName === "packing" ? "packing-queue-row" : "shipping-queue-row";
    const selectedClass = options.queueName === "packing" ? "packing-queue-row-selected" : "shipping-queue-row-selected";
    const selectHandler = options.queueName === "packing" ? "selectPackingQueueRow" : "selectShippingQueueRow";
    const keyHandler = options.queueName === "packing" ? "handlePackingQueueRowKeydown" : "handleShippingQueueRowKeydown";

    return [
      '<tr class="', index % 2 === 0 ? 'rowEven' : 'rowOdd',
      ' shipping-request-parent-row ', rowClass,
      selected ? ' ' + selectedClass : '',
      '" data-request-index="', String(index),
      '" tabindex="0" aria-selected="', selected ? 'true' : 'false',
      '" onclick="', selectHandler, '(event)" onkeydown="', keyHandler, '(event)">',
      '<td class="operations-center-official-cell shipping-request-id-cell">',
      '<div class="shipping-request-id-group">',
      '<button type="button" class="shipping-request-expand-button" data-request-queue="', options.queueName,
      '" data-request-index="', String(index),
      '" aria-expanded="', expanded ? 'true' : 'false',
      '" aria-controls="', detailsId,
      '" aria-label="', expanded ? 'Collapse' : 'Expand', ' Request ', escapeHtml(requestId),
      '" onclick="toggleShippingRequestDetails(event)">',
      '<span class="shipping-request-expand-icon" aria-hidden="true">', expanded ? '&#9662;' : '&#9656;', '</span>',
      '<span>', expanded ? 'Collapse' : 'Expand', '</span>',
      '</button>',
      '<span>', escapeHtml(requestId), '</span>',
      '</div>',
      '</td>',
      renderCell(requestToShip.customer || detailLines[0]?.customer || "N/A"),
      renderCell(requestToShip.salesOrder || detailLines[0]?.salesOrder || "N/A"),
      renderCell(String(detailLines.length)),
      renderCell(requestToShip.requestedShipWindow || "Not specified"),
      '<td>', renderOperationalStatus(requestToShip.status || options.defaultStatus), '</td>',
      '</tr>',
      renderRequestDetailRow(requestToShip, detailLines, detailsId, expanded)
    ].join("");
  }

  function renderRequestDetailRow(requestToShip, detailLines, detailsId, expanded) {
    return [
      '<tr id="', detailsId, '" class="shipping-request-detail-row"', expanded ? '' : ' hidden', '>',
      '<td colspan="6">',
      '<div class="shipping-request-detail-panel">',
      '<table class="shipping-request-detail-table" aria-label="Request details for ', escapeHtml(requestToShip.requestId || "request"), '">',
      '<thead><tr>',
      '<th>Sales Order Line</th>',
      '<th>Work Order</th>',
      '<th>Assembly / Part Number</th>',
      '<th>Qty Requested</th>',
      '</tr></thead>',
      '<tbody>',
      detailLines.map((line, lineIndex) => [
        '<tr class="', lineIndex % 2 === 0 ? 'rowEven' : 'rowOdd', '">',
        renderCell(line?.salesOrderLine || line?.sequenceLine || requestToShip.salesOrderLine || "N/A"),
        renderCell(line?.workOrder || line?.workOrderDecision || requestToShip.workOrder || "Unknown"),
        renderCell(line?.assembly || line?.partNumber || requestToShip.assembly || "N/A"),
        renderCell(formatQuantity(line?.qtyRequested ?? requestToShip.qtyRequested)),
        '</tr>'
      ].join("")).join(""),
      '</tbody>',
      '</table>',
      '</div>',
      '</td>',
      '</tr>'
    ].join("");
  }

  function getRequestLines(request) {
    return Array.isArray(request?.lines) && request.lines.length
      ? request.lines
      : [];
  }

  function getRequestDisplayLines(request) {
    const detailLines = getRequestLines(request);
    return detailLines.length ? detailLines : request ? [request] : [];
  }

  function selectShippingQueueRow(event) {
    const dataset = event?.currentTarget?.dataset || {};
    const requestIndex = Number(dataset.requestIndex);
    const selectedRequest = state.requests[requestIndex];
    if (!selectedRequest) return;

    state.selectedShippingRequest = selectedRequest;
    state.selectedPackingRequest = null;
    renderShippingWorkspace();
  }

  function handleShippingQueueRowKeydown(event) {
    if (event?.target !== event?.currentTarget) return;
    if (!['Enter', ' '].includes(event?.key)) return;
    event.preventDefault();
    selectShippingQueueRow(event);
  }

  function selectPackingQueueRow(event) {
    const index = Number(event?.currentTarget?.dataset?.requestIndex);
    const selected = state.packingRequests[index];
    if (!selected) return;

    state.selectedPackingRequest = selected;
    state.selectedShippingRequest = null;
    renderShippingWorkspace();
  }

  function handlePackingQueueRowKeydown(event) {
    if (event?.target !== event?.currentTarget) return;
    if (!['Enter', ' '].includes(event?.key)) return;
    event.preventDefault();
    selectPackingQueueRow(event);
  }

  function toggleShippingRequestDetails(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const button = event?.currentTarget;
    const queueName = button?.dataset?.requestQueue;
    const requestIndex = Number(button?.dataset?.requestIndex);
    const requests = queueName === "packing" ? state.packingRequests : state.requests;
    const expandedRequests = queueName === "packing"
      ? state.expandedPackingRequests
      : state.expandedShippingRequests;
    const request = requests[requestIndex];
    if (!request || !["shipping", "packing"].includes(queueName)) return;

    const expanded = !expandedRequests.has(request);
    if (expanded) {
      expandedRequests.add(request);
    } else {
      expandedRequests.delete(request);
    }

    const detailsId = button.getAttribute?.("aria-controls") || queueName + "-request-details-" + requestIndex;
    const detailsRow = document.getElementById(detailsId);
    if (detailsRow) detailsRow.hidden = !expanded;
    button.setAttribute?.("aria-expanded", expanded ? "true" : "false");
    button.setAttribute?.(
      "aria-label",
      (expanded ? "Collapse" : "Expand") + " Request " + (request.requestId || "N/A")
    );
    if (button) {
      button.innerHTML = [
        '<span class="shipping-request-expand-icon" aria-hidden="true">', expanded ? '&#9662;' : '&#9656;', '</span>',
        '<span>', expanded ? 'Collapse' : 'Expand', '</span>'
      ].join("");
    }
  }

  function acceptShippingRequest() {
    const selected = state.selectedShippingRequest;
    if (!selected) return;

    const selectedIndex = state.requests.indexOf(selected);
    if (selectedIndex < 0) return;

    state.requests.splice(selectedIndex, 1);
    state.expandedShippingRequests.delete(selected);
    state.expandedPackingRequests.delete(selected);
    selected.status = "Packing";
    state.packingRequests.push(selected);
    state.selectedShippingRequest = null;
    state.selectedPackingRequest = selected;
    renderShippingWorkspace();
  }

  function renderShippingActions() {
    const selectedLabel = document.getElementById("shippingSelectedRequest");
    const createButton = document.getElementById("shippingCreateRequestToShipButton");
    const acceptButton = document.getElementById("shippingAcceptRequestButton");
    const returnButton = document.getElementById("shippingReturnToOperationsButton");
    const printButton = document.getElementById("shippingPrintRequestToShipButton");
    const processedButton = document.getElementById("shippingShipmentProcessedButton");
    const activeSelection = state.selectedPackingRequest || state.selectedShippingRequest;
    const requestId = String(activeSelection?.requestId || "").trim();
    const processing = !!state.processingPackingRequest;
    const canStage = window.DleOsCapabilities?.can('shipments.stage') !== false;

    if (selectedLabel) selectedLabel.textContent = requestId || "None selected";
    if (createButton) createButton.disabled = true;
    if (acceptButton) acceptButton.disabled = !state.selectedShippingRequest;
    if (returnButton) returnButton.disabled = !state.selectedShippingRequest;
    if (printButton) printButton.disabled = !state.selectedPackingRequest || processing;
    if (processedButton) {
      processedButton.disabled = !state.selectedPackingRequest || processing || !canStage;
      processedButton.hidden = !canStage;
      processedButton.textContent = processing ? "Persisting Shipment..." : "Shipment Processed";
    }
  }

  async function processPackingShipment() {
    const request = state.selectedPackingRequest;
    if (!request || state.processingPackingRequest) return null;

    if (typeof shipmentStagingState === "undefined" ||
        !Array.isArray(shipmentStagingState.records)) {
      console.error("Shipment Staging is not available.");
      setShippingWorkspaceStatus("Shipment Staging is not available.");
      return null;
    }
    const operationalStaging = window.usesOperationalShipmentStaging?.() === true;
    if (typeof window.buildShipmentStagingRecordsFromShippingRequest !== "function" ||
        (!operationalStaging && typeof window.persistShipmentStagingDataset !== "function") ||
        (operationalStaging && typeof window.DleApiClient?.createShipmentStaging !== "function")) {
      console.error("Shipment Staging persistence service is not available.");
      setShippingWorkspaceStatus("Shipment Staging persistence service is not available.");
      return null;
    }

    const requestIndex = state.packingRequests.indexOf(request);
    if (requestIndex < 0) return null;

    const previousStagingRecords = shipmentStagingState.records.slice();
    const previousStagingLastUpdated = shipmentStagingState.lastUpdated;
    const processedDate = new Date();
    const processedTimestamp = processedDate.toISOString();
    const stagingRecords = window.buildShipmentStagingRecordsFromShippingRequest(request, {
      processedDate,
      operationalStatus: "Pending Invoice"
    });
    if (!stagingRecords.length) {
      setShippingWorkspaceStatus("Shipment Processed was not completed because no shipment detail lines were available.");
      return null;
    }
    const invalidStagingRecord = stagingRecords.find(record => {
      const validation = window.ShipmentOperationalProjection?.validateShipmentQuantity?.({
        customerNumber: record.customerNumber,
        salesOrderNumber: record.salesOrder,
        salesOrderLineNumber: record.salesOrderLine,
        erpQuantityOpen: record.originalOpenQuantity,
        quantityOrdered: record.originalOpenQuantity
      }, record.quantityShipped);
      return validation && !validation.valid;
    });
    if (invalidStagingRecord) {
      setShippingWorkspaceStatus(
        "Shipment Processed was not completed because the requested quantity exceeds the current operational remaining quantity. Refresh Shipping Workspace and review the Sales Order line."
      );
      return null;
    }

    state.processingPackingRequest = request;
    renderShippingActions();
    setShippingWorkspaceStatus("Persisting " + stagingRecords.length + " shipment line" + (stagingRecords.length === 1 ? "" : "s") + "...");
    let persistedResult = null;
    try {
      if (operationalStaging) {
        const correlationId = window.DleApiClient.createRequestCorrelationId();
        persistedResult = await window.DleApiClient.createShipmentStaging({
          requestId: String(request.requestId || '').trim(),
          idempotencyKey: 'packing-request:' + String(request.requestId || '').trim(),
          requestCorrelationId: correlationId,
          lines: stagingRecords.map(record => ({
            customerNumber: record.customerNumber,
            customerName: record.customerName,
            salesOrderNumber: record.salesOrder,
            salesOrderLineNumber: record.salesOrderLine,
            itemNumber: record.itemNumber,
            revision: record.revision || null,
            quantityProcessed: Number(record.quantityShipped),
            canonicalOpenQuantityAtShipment: Number(record.originalOpenQuantity),
            unitOfMeasure: record.unitOfMeasure || null,
            shipmentReference: request.packingSlipNumber || request.shipmentReference || null
          }))
        });
        await window.refreshOperationalShipmentStaging?.();
      } else {
        shipmentStagingState.records.push(...stagingRecords);
        shipmentStagingState.lastUpdated = processedTimestamp;
        await window.persistShipmentStagingDataset("Shipment Processed");
      }
    } catch (error) {
      if (!operationalStaging) {
        shipmentStagingState.records = previousStagingRecords;
        shipmentStagingState.lastUpdated = previousStagingLastUpdated;
      }
      state.processingPackingRequest = null;
      renderShippingWorkspace();
      if (typeof renderShipmentStagingModule === "function") {
        renderShipmentStagingModule();
      }
      setShippingWorkspaceStatus("Shipment was not processed: " +
        (error?.message || "the governed Shipment Staging write failed.") +
        (error?.requestId ? " Request " + error.requestId + "." : ""));
      console.error("Shipment Staging persistence failed:", error);
      return null;
    }

    state.packingRequests.splice(requestIndex, 1);
    state.expandedPackingRequests.delete(request);
    request.status = "Pending Invoice";
    request.shipmentId = persistedResult?.shipments?.[0]?.shipmentNumber || stagingRecords[0].shipmentId;
    state.selectedPackingRequest = null;
    state.processingPackingRequest = null;

    renderShippingWorkspace();
    if (typeof renderShipmentStagingModule === "function") {
      renderShipmentStagingModule();
    }
    window.OperationsCenter?.table?.renderModule?.();
    setShippingWorkspaceStatus(
      "Shipment " + request.shipmentId + " processed and persisted with " + stagingRecords.length +
      " detail line" + (stagingRecords.length === 1 ? "." : "s.")
    );
    return stagingRecords;
  }

  function setShippingWorkspaceStatus(message) {
    const status = document.getElementById("shippingWorkspaceStatus");
    if (status) status.textContent = message;
  }

  async function printPackingRequestToShip() {
    const request = state.selectedPackingRequest;
    if (!request) return null;

    if (typeof buildRequestToShipPrintDefinition !== "function" ||
        typeof DlePrintEngine === "undefined" ||
        typeof DlePrintEngine.print !== "function") {
      console.error("The existing Request to Ship print process is not available.");
      return null;
    }

    const preparation = buildLegacyRequestToShipPreparation(request);
    const definition = buildRequestToShipPrintDefinition(preparation);

    try {
      return await DlePrintEngine.print(definition);
    } catch (error) {
      console.error("Unable to print Request to Ship:", error);
      return null;
    }
  }

  async function printShippingQueue() {
    if (!state.requests.length) {
      setShippingWorkspaceStatus("There are no Shipping Queue line items to print.");
      return null;
    }
    if (typeof DlePrintEngine === "undefined" || typeof DlePrintEngine.print !== "function") {
      setShippingWorkspaceStatus("The print process is not available.");
      console.error("The DLE-OS Print Engine is not available.");
      return null;
    }

    const definition = buildShippingQueuePrintDefinition();
    setShippingWorkspaceStatus(
      "Opening Shipping Queue report with " + definition.data.lines.length + " line item" +
      (definition.data.lines.length === 1 ? "..." : "s...")
    );

    try {
      const result = await DlePrintEngine.print(definition);
      setShippingWorkspaceStatus(
        "Shipping Queue report opened with " + definition.data.lines.length + " line item" +
        (definition.data.lines.length === 1 ? "." : "s.")
      );
      return result;
    } catch (error) {
      setShippingWorkspaceStatus("Unable to print the Shipping Queue report.");
      console.error("Unable to print Shipping Queue:", error);
      return null;
    }
  }

  function buildShippingQueuePrintDefinition() {
    const generatedAt = new Date();
    const lines = state.requests.flatMap(request => getRequestDisplayLines(request).map(line => ({
      requestId: request?.requestId || "",
      requestDateTime: formatReportDateTime(request?.requestDateTime),
      requestedBy: request?.requestedBy || "",
      customerNumber: line?.customerNumber || request?.customerNumber || "",
      customer: line?.customer || request?.customer || "",
      salesOrder: line?.salesOrder || request?.salesOrder || "",
      salesOrderLine: line?.salesOrderLine || line?.sequenceLine || request?.salesOrderLine || "",
      workOrder: line?.workOrder || request?.workOrder || "",
      partNumber: line?.assembly || line?.partNumber || request?.assembly || "",
      description: line?.description || request?.description || "",
      openQuantity: formatQuantity(line?.openQuantity ?? request?.openQuantity),
      requestedQuantity: formatQuantity(line?.qtyRequested ?? request?.qtyRequested),
      dueDate: line?.dueDate || request?.dueDate || "",
      requestedShipWindow: request?.requestedShipWindow || "",
      status: request?.status || "Pending Shipping"
    })));

    return {
      documentName: "Shipping Queue Report",
      paperSize: "letter",
      orientation: "landscape",
      margins: ".3in",
      html: buildShippingQueuePrintHtml(lines, generatedAt),
      css: buildShippingQueuePrintCss(),
      data: {
        reportType: "shippingQueue",
        generatedAt: generatedAt.toISOString(),
        requestCount: state.requests.length,
        lines
      }
    };
  }

  function buildShippingQueuePrintHtml(lines, generatedAt) {
    const columns = [
      ["requestId", "Request ID"],
      ["requestDateTime", "Requested"],
      ["requestedBy", "Requested By"],
      ["customerNumber", "Customer #"],
      ["customer", "Customer"],
      ["salesOrder", "Sales Order"],
      ["salesOrderLine", "SO Line"],
      ["workOrder", "Work Order"],
      ["partNumber", "Assembly / Part #"],
      ["description", "Description"],
      ["openQuantity", "Open Qty"],
      ["requestedQuantity", "Qty Requested"],
      ["dueDate", "Due Date"],
      ["requestedShipWindow", "Ship Window"],
      ["status", "Status"]
    ];

    return [
      '<section class="dle-controlled-document shipping-queue-print-report">',
      '<header class="shipping-queue-print-header">',
      '<div><h1>Shipping Queue Report</h1>',
      '<p>Expanded line-item detail for requests awaiting Shipping.</p></div>',
      '<dl>',
      '<dt>Generated</dt><dd>', escapeHtml(generatedAt.toLocaleString()), '</dd>',
      '<dt>Requests</dt><dd>', escapeHtml(state.requests.length), '</dd>',
      '<dt>Line Items</dt><dd>', escapeHtml(lines.length), '</dd>',
      '</dl>',
      '</header>',
      '<table class="shipping-queue-print-table">',
      '<thead><tr>',
      columns.map(column => '<th>' + escapeHtml(column[1]) + '</th>').join(""),
      '</tr></thead>',
      '<tbody>',
      lines.map(line => [
        '<tr>',
        columns.map(column => '<td>' + escapeHtml(line[column[0]] || "") + '</td>').join(""),
        '</tr>'
      ].join("")).join(""),
      '</tbody>',
      '</table>',
      '</section>'
    ].join("");
  }

  function buildShippingQueuePrintCss() {
    return `
.shipping-queue-print-report {
  break-inside: auto;
  page-break-inside: auto;
  color: #111827;
  font-family: Arial, Helvetica, sans-serif;
}

.shipping-queue-print-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 7px;
  margin-bottom: 9px;
  border-bottom: 2px solid #1e3a5f;
  break-after: avoid;
  page-break-after: avoid;
}

.shipping-queue-print-header h1 {
  margin: 0;
  font-size: 18px;
}

.shipping-queue-print-header p {
  margin: 3px 0 0;
  color: #4b5563;
  font-size: 8px;
}

.shipping-queue-print-header dl {
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 8px;
  margin: 0;
  font-size: 7px;
}

.shipping-queue-print-header dt {
  font-weight: 700;
}

.shipping-queue-print-header dd {
  margin: 0;
}

.shipping-queue-print-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 6.5px;
}

.shipping-queue-print-table thead {
  display: table-header-group;
}

.shipping-queue-print-table tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

.shipping-queue-print-table th,
.shipping-queue-print-table td {
  border: 1px solid #9ca3af;
  padding: 3px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.shipping-queue-print-table th {
  background: #dbeafe;
  color: #111827;
  font-weight: 800;
}

.shipping-queue-print-table tbody tr:nth-child(even) td {
  background: #f8fafc;
}

.shipping-queue-print-table th:nth-child(1) { width: 8%; }
.shipping-queue-print-table th:nth-child(2) { width: 7%; }
.shipping-queue-print-table th:nth-child(3) { width: 5%; }
.shipping-queue-print-table th:nth-child(4) { width: 5%; }
.shipping-queue-print-table th:nth-child(5) { width: 8%; }
.shipping-queue-print-table th:nth-child(6) { width: 6%; }
.shipping-queue-print-table th:nth-child(7) { width: 4%; }
.shipping-queue-print-table th:nth-child(8) { width: 6%; }
.shipping-queue-print-table th:nth-child(9) { width: 8%; }
.shipping-queue-print-table th:nth-child(10) { width: 12%; }
.shipping-queue-print-table th:nth-child(11) { width: 5%; }
.shipping-queue-print-table th:nth-child(12) { width: 5%; }
.shipping-queue-print-table th:nth-child(13) { width: 6%; }
.shipping-queue-print-table th:nth-child(14) { width: 7%; }
.shipping-queue-print-table th:nth-child(15) { width: 8%; }
`;
  }

  function formatReportDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function buildLegacyRequestToShipPreparation(request) {
    const detailLines = getRequestLines(request);
    const sourceLines = detailLines.length ? detailLines : [request || {}];
    const lines = sourceLines.map(line => {
      const openQuantity = Number(line?.openQuantity) || 0;
      const requestedQuantity = Number(line?.qtyRequested) || 0;
      return {
        masterRecordKey: line?.masterRecordKey || line?.sourceWorkOrder?.masterRecordKey || "",
        customerNumber: line?.customerNumber || request?.customerNumber || line?.customer || request?.customer || "",
        customer: line?.customer || request?.customer || "",
        salesOrder: line?.salesOrder || request?.salesOrder || "",
        sequenceLine: line?.salesOrderLine || line?.sequenceLine || request?.salesOrderLine || "",
        workOrder: line?.workOrder || request?.workOrder || "",
        partNumber: line?.assembly || line?.partNumber || request?.assembly || "",
        description: line?.description || "",
        openQuantity,
        shipQuantity: requestedQuantity,
        remainingOpenQuantity: Math.max(openQuantity - requestedQuantity, 0)
      };
    });

    return {
      valid: true,
      requestId: request?.requestId || "",
      lines,
      totalShipQuantity: lines.reduce((total, line) => total + line.shipQuantity, 0),
      requestToShip: request
    };
  }

  function openReturnToOperationsDialog() {
    const selected = state.selectedShippingRequest;
    const dialog = document.getElementById("returnToOperationsDialog");
    const reason = document.getElementById("returnToOperationsReason");
    const comments = document.getElementById("returnToOperationsComments");
    if (!selected || !dialog || !reason || !comments) return;

    state.returnDialogRequest = selected;
    reason.value = "";
    comments.value = "";
    dialog.hidden = false;
    validateReturnToOperationsDialog();
    reason.focus();
  }

  function cancelReturnToOperationsDialog() {
    const dialog = document.getElementById("returnToOperationsDialog");
    if (dialog) dialog.hidden = true;
    state.returnDialogRequest = null;
    setDialogValidationMessage("");
  }

  function validateReturnToOperationsDialog() {
    const reason = document.getElementById("returnToOperationsReason");
    const confirmButton = document.getElementById("confirmReturnToOperationsButton");
    const message = reason?.value ? "" : "Select a reason before returning the request.";

    setDialogValidationMessage(message);
    if (confirmButton) confirmButton.disabled = !!message;
    return { valid: !message, reason: reason?.value || "" };
  }

  function submitReturnToOperations(event) {
    event?.preventDefault?.();
    const validation = validateReturnToOperationsDialog();
    const request = state.returnDialogRequest;
    if (!validation.valid || !request) return;

    const comments = document.getElementById("returnToOperationsComments")?.value || "";
    const returnResponse = {
      requestId: request.requestId || "",
      customer: request.customer || "",
      salesOrder: request.salesOrder || "",
      workOrder: request.workOrder || "",
      qtyRequested: request.qtyRequested,
      lineCount: getRequestLines(request).length || 1,
      lines: getRequestLines(request).map(line => ({
        salesOrderLine: line.salesOrderLine || line.sequenceLine || "",
        workOrder: line.workOrder || "",
        assembly: line.assembly || line.partNumber || "",
        qtyRequested: line.qtyRequested
      })),
      selectedReason: validation.reason,
      comments
    };

    console.log("Return to Operations - Shipping response:", returnResponse);
    cancelReturnToOperationsDialog();
  }

  function handleReturnToOperationsDialogKeydown(event) {
    const dialog = document.getElementById("returnToOperationsDialog");
    if (event?.key === "Escape" && dialog && !dialog.hidden) {
      cancelReturnToOperationsDialog();
    }
  }

  function setDialogValidationMessage(message) {
    const validation = document.getElementById("returnToOperationsValidation");
    if (validation) validation.textContent = message;
  }

  function formatQuantity(value) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity)) return "0";
    return Number.isInteger(quantity) ? String(quantity) : String(quantity);
  }

  function renderOperationalStatus(value) {
    const presentation = window.OperationsCenter?.viewModel?.getOperationalStatusPresentation?.(value) || {
      label: String(value || ""),
      className: ""
    };
    const classes = ["shipping-status-pill", presentation.className].filter(Boolean).join(" ");
    return '<span class="' + classes + '">' + escapeHtml(presentation.label) + '</span>';
  }

  function renderCell(value) {
    return '<td class="operations-center-official-cell">' + escapeHtml(value) + '</td>';
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));
  }

  window.ShippingWorkspace = Object.freeze({
    id: WORKSPACE_ID,
    openRequest,
    enqueueRequest,
    render: loadShippingWorkspace,
    renderShipmentStaging: renderShippingShipmentStaging,
    refreshShipmentStaging: initializeShippingShipmentStaging,
    getState: () => ({
      requests: state.requests.slice(),
      packingRequests: state.packingRequests.slice(),
      selectedRequest: state.selectedShippingRequest,
      selectedShippingRequest: state.selectedShippingRequest,
      selectedShippingLine: null,
      selectedPackingRequest: state.selectedPackingRequest,
      expandedShippingRequests: Array.from(state.expandedShippingRequests),
      expandedPackingRequests: Array.from(state.expandedPackingRequests)
    })
  });

  window.selectShippingQueueRow = selectShippingQueueRow;
  window.filterShippingShipmentStaging = filterShippingShipmentStaging;
  window.refreshShippingShipmentStaging = refreshShippingShipmentStaging;
  window.openShippingShipmentStagingReview = openShippingShipmentStagingReview;
  window.handleShippingShipmentStagingRowKeydown = handleShippingShipmentStagingRowKeydown;
  window.handleShippingQueueRowKeydown = handleShippingQueueRowKeydown;
  window.selectPackingQueueRow = selectPackingQueueRow;
  window.handlePackingQueueRowKeydown = handlePackingQueueRowKeydown;
  window.toggleShippingRequestDetails = toggleShippingRequestDetails;
  window.acceptShippingRequest = acceptShippingRequest;
  window.printPackingRequestToShip = printPackingRequestToShip;
  window.printShippingQueue = printShippingQueue;
  window.processPackingShipment = processPackingShipment;
  window.openReturnToOperationsDialog = openReturnToOperationsDialog;
  window.cancelReturnToOperationsDialog = cancelReturnToOperationsDialog;
  window.validateReturnToOperationsDialog = validateReturnToOperationsDialog;
  window.submitReturnToOperations = submitReturnToOperations;

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = window.ShippingWorkspace;

  document.addEventListener("keydown", handleReturnToOperationsDialogKeydown);
})(window, document);

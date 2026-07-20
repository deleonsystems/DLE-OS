(function registerShippingWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "shipping";
  const TEMPLATE_PATH = "SRC/modules/shipping/shipping-workspace.html";
  const state = {
    requests: [],
    packingRequests: [],
    selectedShippingRequest: null,
    selectedPackingRequest: null,
    returnDialogRequest: null,
    processingPackingRequest: null,
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

    renderShippingWorkspace();
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
    renderShippingQueue();
    renderPackingQueue();
    renderShippingActions();
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
        renderCell(line?.workOrder || requestToShip.workOrder || "Unknown"),
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
    applyPackingOperationalStatus(selected);
    state.packingRequests.push(selected);
    state.selectedShippingRequest = null;
    state.selectedPackingRequest = selected;
    renderShippingWorkspace();
    refreshOperationalStatusDisplays();
  }

  function applyPackingOperationalStatus(request) {
    const sourceWorkOrders = getRequestSourceWorkOrders(request);
    const failedRecordKeys = [];

    sourceWorkOrders.forEach(sourceWorkOrder => {
      const masterRecordKey = String(sourceWorkOrder?.masterRecordKey || "").trim();
      if (sourceWorkOrder?.official) {
        sourceWorkOrder.official.operationalStatus = "Packing";
      }
      if (sourceWorkOrder?.masterRecord) {
        sourceWorkOrder.masterRecord.dle = sourceWorkOrder.masterRecord.dle || {};
        sourceWorkOrder.masterRecord.dle.operationalStatus = "Packing";
      }

      const updated = window.OperationsCenter?.viewModel?.setPackingOperationalStatus?.(masterRecordKey);
      if (!updated) failedRecordKeys.push(masterRecordKey || "Unknown");
    });

    if (!sourceWorkOrders.length || failedRecordKeys.length) {
      console.warn("Packing operational status could not be linked to an active Master Data record.");
    }
  }

  function getRequestSourceWorkOrders(request) {
    const detailSources = getRequestLines(request)
      .map(line => line?.sourceWorkOrder)
      .filter(Boolean);
    const requestSources = Array.isArray(request?.sourceWorkOrders)
      ? request.sourceWorkOrders.filter(Boolean)
      : [];
    const sources = detailSources.length
      ? detailSources
      : requestSources.length
        ? requestSources
        : request?.sourceWorkOrder
          ? [request.sourceWorkOrder]
          : [];
    const seenKeys = new Set();

    return sources.filter(source => {
      const key = String(source?.masterRecordKey || "").trim();
      if (!key || seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
  }

  function refreshOperationalStatusDisplays() {
    window.OperationsCenter?.table?.renderModule?.();
    window.SalesOrderDashboard?.render?.();
    window.WorkOrderDashboardModule?.render?.();
    if (typeof renderDleMasterDataViewer === "function") {
      renderDleMasterDataViewer();
    }
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

    if (selectedLabel) selectedLabel.textContent = requestId || "None selected";
    if (createButton) createButton.disabled = true;
    if (acceptButton) acceptButton.disabled = !state.selectedShippingRequest;
    if (returnButton) returnButton.disabled = !state.selectedShippingRequest;
    if (printButton) printButton.disabled = !state.selectedPackingRequest || processing;
    if (processedButton) {
      processedButton.disabled = !state.selectedPackingRequest || processing;
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
    if (typeof window.buildShipmentStagingRecordsFromShippingRequest !== "function" ||
        typeof window.persistShipmentStagingDataset !== "function") {
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

    state.processingPackingRequest = request;
    renderShippingActions();
    setShippingWorkspaceStatus("Persisting " + stagingRecords.length + " shipment line" + (stagingRecords.length === 1 ? "" : "s") + "...");
    shipmentStagingState.records.push(...stagingRecords);
    shipmentStagingState.lastUpdated = processedTimestamp;

    try {
      await window.persistShipmentStagingDataset("Shipment Processed");
    } catch (error) {
      shipmentStagingState.records = previousStagingRecords;
      shipmentStagingState.lastUpdated = previousStagingLastUpdated;
      state.processingPackingRequest = null;
      renderShippingWorkspace();
      if (typeof renderShipmentStagingModule === "function") {
        renderShipmentStagingModule();
      }
      setShippingWorkspaceStatus("Shipment was not processed because Shipment Staging could not be persisted.");
      console.error("Shipment Staging persistence failed:", error);
      return null;
    }

    state.packingRequests.splice(requestIndex, 1);
    state.expandedPackingRequests.delete(request);
    request.status = "Pending Invoice";
    request.shipmentId = stagingRecords[0].shipmentId;
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
  window.handleShippingQueueRowKeydown = handleShippingQueueRowKeydown;
  window.selectPackingQueueRow = selectPackingQueueRow;
  window.handlePackingQueueRowKeydown = handlePackingQueueRowKeydown;
  window.toggleShippingRequestDetails = toggleShippingRequestDetails;
  window.acceptShippingRequest = acceptShippingRequest;
  window.printPackingRequestToShip = printPackingRequestToShip;
  window.processPackingShipment = processPackingShipment;
  window.openReturnToOperationsDialog = openReturnToOperationsDialog;
  window.cancelReturnToOperationsDialog = cancelReturnToOperationsDialog;
  window.validateReturnToOperationsDialog = validateReturnToOperationsDialog;
  window.submitReturnToOperations = submitReturnToOperations;

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = window.ShippingWorkspace;

  document.addEventListener("keydown", handleReturnToOperationsDialogKeydown);
})(window, document);

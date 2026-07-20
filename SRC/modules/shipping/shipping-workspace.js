(function registerShippingWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "shipping";
  const TEMPLATE_PATH = "SRC/modules/shipping/shipping-workspace.html";
  const state = {
    requests: [],
    packingRequests: [],
    selectedShippingRequest: null,
    selectedPackingRequest: null,
    returnDialogRequest: null
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
    const target = document.getElementById("shippingQueue");
    const count = document.getElementById("shippingQueueCount");
    if (count) {
      count.textContent = state.requests.length + (state.requests.length === 1 ? " request" : " requests");
    }
    if (!target) return;

    if (!state.requests.length) {
      target.innerHTML = '<div class="shipping-queue-empty">Create a Request to Ship from the Sales Order Dashboard to populate the Shipping Queue.</div>';
      return;
    }

    target.innerHTML = [
      '<div class="operations-center-table-wrap shipping-queue-table-wrap">',
      '<table class="operations-center-table">',
      '<thead><tr>',
      '<th>Customer</th>',
      '<th>Sales Order</th>',
      '<th>Work Order</th>',
      '<th>Assembly</th>',
      '<th>Qty Requested</th>',
      '<th>Due Date</th>',
      '<th>Status</th>',
      '</tr></thead>',
      '<tbody>',
      state.requests.map((requestToShip, index) => renderQueueRow(requestToShip, index, "shipping")).join(""),
      '</tbody>',
      '</table>',
      '</div>'
    ].join("");
  }

  function renderPackingQueue() {
    const target = document.getElementById("packingQueue");
    const count = document.getElementById("packingQueueCount");
    if (count) {
      count.textContent = state.packingRequests.length + (state.packingRequests.length === 1 ? " request" : " requests");
    }
    if (!target) return;

    if (!state.packingRequests.length) {
      target.innerHTML = '<div class="shipping-queue-empty">Accept a selected Shipping Queue request to begin packing.</div>';
      return;
    }

    target.innerHTML = [
      '<div class="operations-center-table-wrap shipping-queue-table-wrap">',
      '<table class="operations-center-table">',
      '<thead><tr>',
      '<th>Customer</th>',
      '<th>Sales Order</th>',
      '<th>Work Order</th>',
      '<th>Assembly</th>',
      '<th>Qty Requested</th>',
      '<th>Due Date</th>',
      '<th>Status</th>',
      '</tr></thead>',
      '<tbody>',
      state.packingRequests.map((requestToShip, index) => renderQueueRow(requestToShip, index, "packing")).join(""),
      '</tbody>',
      '</table>',
      '</div>'
    ].join("");
  }

  function renderQueueRow(requestToShip, index, queueName) {
    const isPackingQueue = queueName === "packing";
    const selected = isPackingQueue
      ? requestToShip === state.selectedPackingRequest
      : requestToShip === state.selectedShippingRequest;
    const rowClass = isPackingQueue ? "packing-queue-row" : "shipping-queue-row";
    const selectedClass = isPackingQueue ? "packing-queue-row-selected" : "shipping-queue-row-selected";
    const selectHandler = isPackingQueue ? "selectPackingQueueRow" : "selectShippingQueueRow";
    const keyHandler = isPackingQueue ? "handlePackingQueueRowKeydown" : "handleShippingQueueRowKeydown";
    const indexAttribute = isPackingQueue ? "data-packing-queue-index" : "data-shipping-queue-index";

    return [
      '<tr class="',
      index % 2 === 0 ? 'rowEven' : 'rowOdd',
      ' ', rowClass,
      selected ? ' ' + selectedClass : '',
      '" ', indexAttribute, '="',
      String(index),
      '" tabindex="0" aria-selected="',
      selected ? 'true' : 'false',
      '" onclick="', selectHandler, '(event)" onkeydown="', keyHandler, '(event)">',
      renderCell(requestToShip.customer || "N/A"),
      renderCell(requestToShip.salesOrder || "N/A"),
      renderCell(requestToShip.workOrder || "Unknown"),
      renderCell(requestToShip.assembly || "N/A"),
      renderCell(formatQuantity(requestToShip.qtyRequested)),
      renderCell(requestToShip.dueDate || "N/A"),
      '<td><span class="shipping-status-pill">', escapeHtml(requestToShip.status || "Pending Shipping"), '</span></td>',
      '</tr>'
    ].join("");
  }

  function selectShippingQueueRow(event) {
    const index = Number(event?.currentTarget?.dataset?.shippingQueueIndex);
    const selected = state.requests[index];
    if (!selected) return;

    state.selectedShippingRequest = selected;
    renderShippingWorkspace();
  }

  function handleShippingQueueRowKeydown(event) {
    if (!['Enter', ' '].includes(event?.key)) return;
    event.preventDefault();
    selectShippingQueueRow(event);
  }

  function selectPackingQueueRow(event) {
    const index = Number(event?.currentTarget?.dataset?.packingQueueIndex);
    const selected = state.packingRequests[index];
    if (!selected) return;

    state.selectedPackingRequest = selected;
    renderShippingWorkspace();
  }

  function handlePackingQueueRowKeydown(event) {
    if (!['Enter', ' '].includes(event?.key)) return;
    event.preventDefault();
    selectPackingQueueRow(event);
  }

  function acceptShippingRequest() {
    const selected = state.selectedShippingRequest;
    if (!selected) return;

    const selectedIndex = state.requests.indexOf(selected);
    if (selectedIndex < 0) return;

    state.requests.splice(selectedIndex, 1);
    selected.status = "Packing";
    state.packingRequests.push(selected);
    state.selectedShippingRequest = null;
    state.selectedPackingRequest = selected;
    renderShippingWorkspace();
  }

  function renderShippingActions() {
    const selectedLabel = document.getElementById("shippingSelectedWorkOrder");
    const createButton = document.getElementById("shippingCreateRequestToShipButton");
    const acceptButton = document.getElementById("shippingAcceptRequestButton");
    const returnButton = document.getElementById("shippingReturnToOperationsButton");
    const printButton = document.getElementById("shippingPrintRequestToShipButton");
    const processedButton = document.getElementById("shippingShipmentProcessedButton");
    const activeSelection = state.selectedShippingRequest || state.selectedPackingRequest;
    const workOrder = String(activeSelection?.workOrder || "").trim();

    if (selectedLabel) selectedLabel.textContent = workOrder || "None selected";
    if (createButton) createButton.disabled = true;
    if (acceptButton) acceptButton.disabled = !state.selectedShippingRequest;
    if (returnButton) returnButton.disabled = !state.selectedShippingRequest;
    if (printButton) printButton.disabled = !state.selectedPackingRequest;
    if (processedButton) processedButton.disabled = !state.selectedPackingRequest;
  }

  function processPackingShipment() {
    const request = state.selectedPackingRequest;
    if (!request) return;

    if (typeof shipmentStagingState === "undefined" ||
        !Array.isArray(shipmentStagingState.records)) {
      console.error("Shipment Staging is not available.");
      return;
    }

    const requestIndex = state.packingRequests.indexOf(request);
    if (requestIndex < 0) return;

    state.packingRequests.splice(requestIndex, 1);
    request.status = "Awaiting ERP Reconciliation";
    shipmentStagingState.records.push(request);
    shipmentStagingState.lastUpdated = new Date().toLocaleString();
    state.selectedPackingRequest = null;

    renderShippingWorkspace();
    if (typeof renderShipmentStagingModule === "function") {
      renderShipmentStagingModule();
    }
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
    const openQuantity = Number(request?.openQuantity) || 0;
    const requestedQuantity = Number(request?.qtyRequested) || 0;

    return {
      valid: true,
      requestId: request?.requestId || "",
      lines: [{
        customerNumber: request?.customerNumber || request?.customer || "",
        customer: request?.customer || "",
        salesOrder: request?.salesOrder || "",
        workOrder: request?.workOrder || "",
        partNumber: request?.assembly || "",
        openQuantity,
        shipQuantity: requestedQuantity,
        remainingOpenQuantity: Math.max(openQuantity - requestedQuantity, 0)
      }],
      totalShipQuantity: requestedQuantity,
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
      selectedPackingRequest: state.selectedPackingRequest
    })
  });

  window.selectShippingQueueRow = selectShippingQueueRow;
  window.handleShippingQueueRowKeydown = handleShippingQueueRowKeydown;
  window.selectPackingQueueRow = selectPackingQueueRow;
  window.handlePackingQueueRowKeydown = handlePackingQueueRowKeydown;
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

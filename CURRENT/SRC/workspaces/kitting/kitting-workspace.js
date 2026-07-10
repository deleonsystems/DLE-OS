(function registerKittingWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "kitting";
  const TEMPLATE_PATH = "SRC/workspaces/kitting/kitting-workspace.html";
  const temporaryKittingQueueByRecordKey = {};
  const TEMPORARY_KITTING_FIELDS = [
    "kitStatus",
    "dateKitStatusSubmitted",
    "notes"
  ];

  async function loadKittingWorkspace() {
    const mount = document.querySelector('[data-workspace-mount="kitting"]');
    if (!mount) return;
    if (mount.dataset.workspaceLoaded === "true") {
      renderKitQueue();
      return;
    }

    mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Kitting Workspace</h3><p>Preparing workspace layout...</p></div>';

    const response = await fetch(TEMPLATE_PATH);
    if (!response.ok) {
      throw new Error("Unable to load Kitting Workspace.");
    }

    mount.innerHTML = await response.text();
    mount.dataset.workspaceLoaded = "true";
    renderKitQueue();
  }

  function renderKitQueue() {
    const newOrdersTarget = document.getElementById("kittingNewOrdersQueue");
    const approvedModifiedTarget = document.getElementById("kittingApprovedModifiedQueue");
    const shortsTarget = document.getElementById("kittingShortsQueue");
    if (!newOrdersTarget || !approvedModifiedTarget || !shortsTarget) return;

    const viewModel = window.OperationsCenter?.viewModel;
    if (!viewModel?.getMasterRecords || !viewModel?.getOfficialField) {
      renderQueueMessage(newOrdersTarget, "Operations Center data is not available yet.");
      renderQueueMessage(approvedModifiedTarget, "Operations Center data is not available yet.");
      renderQueueMessage(shortsTarget, "Operations Center data is not available yet.");
      return;
    }

    const records = viewModel.getMasterRecords();
    if (!records.length) {
      renderQueueMessage(newOrdersTarget, "Load DLE Master Data from System Center to view Kitting work queues.");
      renderQueueMessage(approvedModifiedTarget, "Load DLE Master Data from System Center to view Kitting work queues.");
      renderQueueMessage(shortsTarget, "Load DLE Master Data from System Center to view Kitting work queues.");
      return;
    }

    const queues = categorizeKittingRecords(records, viewModel);
    renderWorkQueue(newOrdersTarget, queues.newOrders, viewModel, "No New Order records currently require Kitting attention.");
    renderWorkQueue(approvedModifiedTarget, queues.approvedModifiedOrders, viewModel, "No Approved Modified Order records currently require Kitting attention.");
    renderWorkQueue(shortsTarget, queues.kitShorts, viewModel, "No active Kit Short records currently require Kitting attention.");
  }

  function categorizeKittingRecords(records, viewModel) {
    return records.reduce((queues, record) => {
      const masterRecordKey = viewModel.getMasterRecordKey(record);
      const kitStatus = getTemporaryKittingField(masterRecordKey, "kitStatus");
      if (isKitCompleteStatus(kitStatus)) return queues;

      if (isKitShortStatus(kitStatus)) {
        queues.kitShorts.push(record);
        return queues;
      }

      const operationalStatus = normalizeStatus(viewModel.getOfficialField(record, "operationalStatus"));
      if (operationalStatus === "new order") {
        queues.newOrders.push(record);
        return queues;
      }
      if (operationalStatus === "approved modified order") {
        queues.approvedModifiedOrders.push(record);
      }

      return queues;
    }, {
      newOrders: [],
      approvedModifiedOrders: [],
      kitShorts: []
    });
  }

  function renderWorkQueue(target, records, viewModel, emptyMessage) {
    if (!records.length) {
      renderQueueMessage(target, emptyMessage);
      return;
    }

    const rows = records.map((record, index) => renderKitQueueRow(record, viewModel, index)).join("");
    target.innerHTML = [
      '<div class="operations-center-table-wrap kitting-kit-queue-table-wrap">',
      '<table class="operations-center-table">',
      '<thead><tr>',
      '<th>Order Date</th>',
      '<th>Customer Name</th>',
      '<th>Sales Order</th>',
      '<th>Work Order</th>',
      '<th>Due Date</th>',
      '<th>Operational Status</th>',
      '<th>Kit Status</th>',
      '<th>Date Kit Status Submitted</th>',
      '<th>Kit Shortage</th>',
      '<th>Notes</th>',
      '</tr></thead>',
      '<tbody>',
      rows,
      '</tbody>',
      '</table>',
      '</div>'
    ].join("");
  }

  function renderQueueMessage(target, message) {
    target.innerHTML = '<div class="kitting-kit-queue-empty">' + escapeHtml(message) + '</div>';
  }

  function renderKitQueueRow(record, viewModel, index) {
    const masterRecordKey = viewModel.getMasterRecordKey(record);
    const temporaryFields = temporaryKittingQueueByRecordKey[masterRecordKey] || {};

    return [
      '<tr class="', index % 2 === 0 ? 'rowEven' : 'rowOdd', '" data-master-record-key="', escapeHtml(masterRecordKey), '">',
      renderOfficialCell(viewModel.getOfficialField(record, "orderDate")),
      renderOfficialCell(viewModel.getOfficialField(record, "customer")),
      renderSalesOrderCell(masterRecordKey, viewModel.getOfficialField(record, "salesOrder")),
      renderOfficialCell(viewModel.getOfficialField(record, "workOrder")),
      renderOfficialCell(viewModel.getOfficialField(record, "dueDate")),
      renderOfficialCell(viewModel.getOfficialField(record, "operationalStatus")),
      renderEditableCell(masterRecordKey, "kitStatus", temporaryFields.kitStatus || "", "Kit Status"),
      renderEditableCell(masterRecordKey, "dateKitStatusSubmitted", temporaryFields.dateKitStatusSubmitted || "", "Date Kit Status Submitted"),
      renderKitShortageCell(),
      renderEditableCell(masterRecordKey, "notes", temporaryFields.notes || "", "Notes"),
      '</tr>'
    ].join("");
  }

  function renderOfficialCell(value) {
    return '<td class="operations-center-official-cell">' + escapeHtml(value) + '</td>';
  }

  function renderSalesOrderCell(masterRecordKey, value) {
    return [
      '<td class="operations-center-official-cell">',
      '<button type="button" class="operations-center-sales-order-link" data-master-record-key="',
      escapeHtml(masterRecordKey),
      '" onclick="openOperationsCenterSalesOrderDashboard(event)">',
      escapeHtml(value),
      '</button>',
      '</td>'
    ].join("");
  }

  function renderEditableCell(masterRecordKey, field, value, label) {
    return [
      '<td class="operations-center-overlay-cell">',
      '<div class="operations-center-editable" contenteditable="true" data-master-record-key="',
      escapeHtml(masterRecordKey),
      '" data-kitting-queue-field="',
      escapeHtml(field),
      '" oninput="updateTemporaryKittingQueueField(event)" onblur="renderKittingKitQueue()" aria-label="',
      escapeHtml(label),
      '">',
      escapeHtml(value),
      '</div>',
      '</td>'
    ].join("");
  }

  function renderKitShortageCell() {
    return [
      '<td class="operations-center-overlay-cell operations-center-document-cell">',
      '<a class="operations-center-sales-order-link" href="#" onclick="return false;" aria-label="Kit Shortage PDF placeholder">.pdf</a>',
      '</td>'
    ].join("");
  }

  function updateTemporaryKittingQueueField(event) {
    const target = event?.target;
    const masterRecordKey = target?.dataset?.masterRecordKey || "";
    const field = target?.dataset?.kittingQueueField || "";
    if (!masterRecordKey || !TEMPORARY_KITTING_FIELDS.includes(field)) return;

    temporaryKittingQueueByRecordKey[masterRecordKey] = {
      ...(temporaryKittingQueueByRecordKey[masterRecordKey] || {}),
      [field]: target.textContent || ""
    };
  }

  function getTemporaryKittingField(masterRecordKey, field) {
    return String(temporaryKittingQueueByRecordKey[masterRecordKey]?.[field] || "");
  }

  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isKitCompleteStatus(value) {
    const status = normalizeStatus(value);
    return status === "kit complete" || status === "complete";
  }

  function isKitShortStatus(value) {
    const status = normalizeStatus(value);
    return /\b(short|shorts|shortage|incomplete|partial|missing|hold|blocked)\b/.test(status);
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

  document.addEventListener("dle:master-data-change", renderKitQueue);
  window.updateTemporaryKittingQueueField = updateTemporaryKittingQueueField;
  window.renderKittingKitQueue = renderKitQueue;

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: loadKittingWorkspace,
    renderKitQueue
  });
})(window, document);

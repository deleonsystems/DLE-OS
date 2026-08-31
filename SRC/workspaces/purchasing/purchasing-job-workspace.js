(function registerPurchasingJobWorkspace(window, document) {
  "use strict";

  const SCREEN_ID = "purchasingJobWorkspace";
  const TEMPLATE_PATH = "SRC/workspaces/purchasing/purchasing-job-workspace.html";
  let templatePromise = null;
  let selectedRow = null;

  async function open(row) {
    if (!row?.workOrderNumber || !row.canonicalWorkOrder) return false;
    selectedRow = row;
    await ensureScreen();
    render(row);
    window.DleWorkspaceShell?.setWorkspaceView?.("purchasing");
    if (typeof window.go !== "function") return false;
    window.go(SCREEN_ID);
    window.scrollTo?.({ top: 0, behavior: "auto" });
    return true;
  }

  async function ensureScreen() {
    if (document.getElementById(SCREEN_ID)) return;
    if (!templatePromise) {
      templatePromise = fetch(TEMPLATE_PATH, { cache: "no-store", credentials: "same-origin" })
        .then(response => {
          if (!response.ok) throw new Error("Purchasing Job Workspace template returned HTTP " + response.status + ".");
          return response.text();
        })
        .then(markup => {
          const main = document.querySelector("main");
          if (!main) throw new Error("The DLE-OS application workspace is unavailable.");
          main.insertAdjacentHTML("beforeend", markup);
        })
        .catch(error => {
          templatePromise = null;
          throw error;
        });
    }
    await templatePromise;
  }

  function render(row = selectedRow) {
    if (!row) return false;
    setText("purchasingJobWorkOrder", row.workOrderNumber || "N/A");
    setText("purchasingJobAssembly", row.assemblyItemNumber || "N/A");
    setText("purchasingJobRevision", row.revision || "N/A");
    setText("purchasingJobQuantity", formatQuantity(row.canonicalWorkOrderQuantity));
    setText("purchasingJobDueDate", formatDueDate(row.earliestDueDate));
    setText("purchasingJobCustomer", [row.customerNumber, row.customerName].filter(Boolean).join(" \u00b7 ") || "N/A");
    const materialStatus = row.materialStatusLabel || "Kit Short";
    setText("purchasingJobMaterialStatusCard", materialStatus.toUpperCase());
    setText("purchasingJobMaterialStatus", materialStatus);
    return true;
  }

  function setText(id, value) {
    const target = document.getElementById(id);
    if (target) target.textContent = String(value ?? "N/A");
  }

  function formatQuantity(value) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity)) return "N/A";
    return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(2)));
  }

  function formatDueDate(value) {
    const text = String(value ?? "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    return match ? `${match[2]}/${match[3]}/${match[1]}` : text || "N/A";
  }

  window.PurchasingJobWorkspace = Object.freeze({ open, render, getSelectedRow: () => selectedRow });
})(window, document);

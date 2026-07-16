(function registerKittingWorkbench(window, document) {
  "use strict";

  const WORKBENCH_ID = "kitting";
  const TEMPLATE_PATH = "SRC/workbenches/kitting/kitting-workbench.html";

  async function render(context = {}) {
    const mount = document.querySelector('[data-workbench-mount="kitting"]');
    if (!mount) return;

    if (mount.dataset.workbenchLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Kitting Workbench</h3><p>Preparing selected work order context...</p></div>';

      const response = await fetch(TEMPLATE_PATH);
      if (!response.ok) {
        throw new Error("Unable to load Kitting Workbench.");
      }

      mount.innerHTML = await response.text();
      mount.dataset.workbenchLoaded = "true";
    }

    mount.hidden = false;
    populateWorkbenchFields(context);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function close() {
    const mount = document.querySelector('[data-workbench-mount="kitting"]');
    if (mount) mount.hidden = true;
  }

  function populateWorkbenchFields(context) {
    const fields = {
      workOrder: context.workOrder,
      customer: context.customer,
      partNumber: context.partNumber,
      revision: context.revision,
      description: context.description
    };

    Object.entries(fields).forEach(([field, value]) => {
      const target = document.querySelector(`[data-kitting-workbench-field="${field}"]`);
      if (target) target.textContent = value || "N/A";
    });
  }

  window.closeKittingWorkbench = function closeKittingWorkbench() {
    window.DleWorkbenchShell?.close(WORKBENCH_ID);
  };

  window.DleWorkbenches = window.DleWorkbenches || {};
  window.DleWorkbenches[WORKBENCH_ID] = Object.freeze({
    id: WORKBENCH_ID,
    render,
    close
  });
})(window, document);

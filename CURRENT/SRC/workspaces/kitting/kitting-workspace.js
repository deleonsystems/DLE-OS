(function registerKittingWorkspace(window, document) {
  "use strict";

  const WORKSPACE_ID = "kitting";
  const TEMPLATE_PATH = "SRC/workspaces/kitting/kitting-workspace.html";

  async function loadKittingWorkspace() {
    const mount = document.querySelector('[data-workspace-mount="kitting"]');
    if (!mount || mount.dataset.workspaceLoaded === "true") return;

    mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Kitting Workspace</h3><p>Preparing workspace layout...</p></div>';

    const response = await fetch(TEMPLATE_PATH);
    if (!response.ok) {
      throw new Error("Unable to load Kitting Workspace.");
    }

    mount.innerHTML = await response.text();
    mount.dataset.workspaceLoaded = "true";
  }

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: loadKittingWorkspace
  });
})(window, document);

(function registerDleWorkspaceShell(window, document) {
  "use strict";

  let selectedWorkspaceId = null;

  function registry() {
    return window.DleWorkspaceRegistry;
  }

  function getSelector() {
    return document.getElementById("workspaceViewSelect");
  }

  function getWorkspacePanels() {
    return Array.from(document.querySelectorAll("[data-workspace-home]"));
  }

  function renderActiveWorkspace(workspace) {
    const workspaceController = window.DleWorkspaces?.[workspace.id];
    if (!workspaceController?.render) return;

    Promise.resolve(workspaceController.render(workspace)).catch(error => {
      console.error("Unable to render DLE-OS workspace.", error);
    });
  }

  function getCurrentWorkspace() {
    return registry().resolve(selectedWorkspaceId);
  }

  function renderWorkspaceSelector() {
    const selector = getSelector();
    if (!selector || !registry()) return;

    selector.innerHTML = registry().all().map(workspace => (
      `<option value="${workspace.id}">${workspace.label}</option>`
    )).join("");

    selector.value = selectedWorkspaceId || registry().defaultWorkspaceId;
  }

  function activateWorkspace(value) {
    const workspace = registry().resolve(value);
    const activeWorkbenchId = window.DleWorkbenchShell?.getCurrent?.()?.workbenchId;
    if (activeWorkbenchId) {
      window.DleWorkbenchShell.close(activeWorkbenchId);
    }

    selectedWorkspaceId = workspace.id;

    document.body.dataset.workspaceView = workspace.id;
    document.body.dataset.workspaceLabel = workspace.label;

    const selector = getSelector();
    if (selector && selector.value !== workspace.id) {
      selector.value = workspace.id;
    }

    getWorkspacePanels().forEach(panel => {
      panel.classList.toggle("active", panel.dataset.workspaceHome === workspace.id);
    });

    document.dispatchEvent(new CustomEvent("dle:workspace-change", {
      detail: { workspace }
    }));

    renderActiveWorkspace(workspace);

    return workspace;
  }

  function initWorkspaceShell() {
    selectedWorkspaceId = registry().defaultWorkspaceId;
    renderWorkspaceSelector();
    activateWorkspace(selectedWorkspaceId);
  }

  window.DleWorkspaceShell = Object.freeze({
    init: initWorkspaceShell,
    setWorkspaceView: activateWorkspace,
    updateWorkspaceHomeView() {
      activateWorkspace(selectedWorkspaceId || registry().defaultWorkspaceId);
    },
    getCurrentWorkspace
  });
})(window, document);

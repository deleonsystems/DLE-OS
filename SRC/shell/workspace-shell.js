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

  function updateWorkAreaChrome(workspace) {
    const isHome = workspace.id === "dle-home";
    const mode = document.getElementById("activeWorkAreaLabel");
    const change = document.getElementById("changeWorkAreaButton");
    const selector = document.querySelector(".workspace-selector");
    if (mode) {
      mode.textContent = isHome ? "" : "\u2022 " + workspace.label.toUpperCase();
      mode.hidden = isHome;
    }
    if (change) change.hidden = isHome;
    if (selector) selector.hidden = !window.DleOsCapabilities?.isSuperAdmin;
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
    updateWorkAreaChrome(workspace);

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

  document.addEventListener("dle:capabilities-ready", () => {
    updateWorkAreaChrome(getCurrentWorkspace());
  });
})(window, document);

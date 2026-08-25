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

  function ensureWorkspacePanel(workspace) {
    let panel = document.querySelector('[data-workspace-home="' + workspace.id + '"]');
    if (panel || !workspace.modulePath) return panel;
    const home = document.getElementById("home");
    if (!home) return null;
    panel = document.createElement("div");
    panel.className = "workspace-home";
    panel.dataset.workspaceHome = workspace.id;
    panel.innerHTML = '<div data-workspace-mount="' + workspace.id + '"></div>';
    home.appendChild(panel);
    return panel;
  }

  async function ensureWorkspaceAssets(workspace) {
    ensureWorkspacePanel(workspace);
    if (workspace.stylePath && !document.querySelector('link[data-workspace-style="' + workspace.id + '"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = workspace.stylePath;
      link.dataset.workspaceStyle = workspace.id;
      document.head.appendChild(link);
    }
    if (!workspace.modulePath || window.DleWorkspaces?.[workspace.id]) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = workspace.modulePath;
      script.dataset.workspaceModule = workspace.id;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Unable to load " + workspace.label + " workspace module."));
      document.head.appendChild(script);
    });
  }

  async function renderActiveWorkspace(workspace) {
    await ensureWorkspaceAssets(workspace);
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
    const selector = document.querySelector(".workspace-selector");
    if (mode) {
      mode.textContent = isHome ? "HOME" : workspace.label.toUpperCase();
      mode.hidden = false;
    }
    if (selector) selector.hidden = !window.DleOsCapabilities?.isSuperAdmin;
  }

  function activateWorkspace(value) {
    const workspace = registry().resolve(value);
    const activeWorkbenchId = window.DleWorkbenchShell?.getCurrent?.()?.workbenchId;
    if (activeWorkbenchId) {
      window.DleWorkbenchShell.close(activeWorkbenchId);
    }

    selectedWorkspaceId = workspace.id;
    ensureWorkspacePanel(workspace);

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

    renderActiveWorkspace(workspace).catch(error => {
      console.error("Unable to activate DLE-OS workspace.", error);
    });

    return workspace;
  }

  function initWorkspaceShell() {
    selectedWorkspaceId = registry().defaultWorkspaceId;
    renderWorkspaceSelector();
    return getCurrentWorkspace();
  }

  function activateInitialWorkspace() {
    return activateWorkspace(selectedWorkspaceId || registry().defaultWorkspaceId);
  }

  window.DleWorkspaceShell = Object.freeze({
    init: initWorkspaceShell,
    activateInitialWorkspace,
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

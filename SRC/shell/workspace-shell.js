(function registerDleWorkspaceShell(window, document) {
  "use strict";

  let selectedWorkspaceId = null;
  const contextualNavigationHistory = [];

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
    if (selector) {
      const workspaceSelect = getSelector();
      const hasAuthorizedWorkspace = Array.from(workspaceSelect?.options || []).some(option =>
        option.value !== registry().defaultWorkspaceId && !option.disabled);
      selector.hidden = !hasAuthorizedWorkspace;
    }
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

  function activeScreenId() {
    return document.querySelector(".screen.active")?.id || "home";
  }

  function updateContextualBackButton() {
    window.updateBackButton?.();
    const backButton = document.querySelector(".back-btn");
    if (backButton && contextualNavigationHistory.length) backButton.disabled = false;
  }

  function navigate(request, addToHistory = true) {
    const destination = registry().resolve(request?.workspaceId);
    if (!destination) return null;
    const destinationScreenId = request?.screenId || destination.home?.screenId || "home";
    const previous = { workspaceId:selectedWorkspaceId || registry().defaultWorkspaceId, screenId:activeScreenId() };
    if (addToHistory && (previous.workspaceId !== destination.id || previous.screenId !== destinationScreenId)) {
      contextualNavigationHistory.push(previous);
    }
    if (request?.viewMode) window.DleOperatorHeader?.setViewMode?.(request.viewMode);
    const workspace = activateWorkspace(destination.id);
    if (typeof window.go === "function") window.go(destinationScreenId, false);
    const requestedState = request?.requestedState && typeof request.requestedState === "object"
      ? Object.freeze({ ...request.requestedState }) : null;
    document.dispatchEvent(new CustomEvent("dle:workspace-navigation", {
      detail: Object.freeze({ workspace, screenId:destinationScreenId, viewMode:request?.viewMode || null, requestedState })
    }));
    updateContextualBackButton();
    return workspace;
  }

  function navigateBack() {
    const previous = contextualNavigationHistory.pop();
    if (!previous) return null;
    return navigate(previous, false);
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
    navigate,
    navigateBack,
    canNavigateBack: () => contextualNavigationHistory.length > 0,
    getCurrentWorkspace
  });

  document.addEventListener("click", event => {
    if (!contextualNavigationHistory.length || !event.target?.closest?.(".back-btn")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigateBack();
  }, true);

  document.addEventListener("dle:capabilities-ready", () => {
    updateWorkAreaChrome(getCurrentWorkspace());
  });
})(window, document);

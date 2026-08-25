(function registerWorkAreaHome(window, document) {
  "use strict";

  const MOBILE_READY_WORKSPACE_IDS = new Set(["operations-center", "invoice-history"]);

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function render() {
    const root = document.getElementById("dleWorkAreaHome");
    if (!root) return;
    const session = window.DleOsSession;
    const capabilities = window.DleOsCapabilities;
    if (!session || !capabilities) {
      root.innerHTML = '<div class="work-area-home-loading">Loading your assigned work areas\u2026</div>';
      return;
    }

    const firstName = String(session.user?.displayName || "").trim().split(/\s+/)[0] || "there";
    const workAreas = window.DleWorkspaceRegistry.all().filter(workspace => {
      const assignment = workspace.home;
      return assignment && capabilities.can(assignment.requiredPermission);
    });

    if (window.DleOperatorHeader?.isMobileView?.() || document.body?.dataset?.viewMode === "mobile") {
      renderMobile(root, firstName, workAreas);
      return;
    }

    root.innerHTML = [
      '<section class="work-area-home-hero">',
      '<p class="work-area-home-kicker">DLE-OS HOME</p>',
      '<h1>', escapeHtml(greeting()), ', ', escapeHtml(firstName), '</h1>',
      '<p>What are you working on?</p>',
      '</section>',
      '<section class="work-area-home-grid" aria-label="Assigned work areas">',
      workAreas.length ? workAreas.map(workspace => [
        '<button type="button" class="work-area-card" data-work-area="', escapeHtml(workspace.id), '">',
        '<span class="work-area-card-mark" aria-hidden="true">', escapeHtml(workspace.home.mark || workspace.home.label.slice(0, 2)), '</span>',
        '<span><strong>', escapeHtml(workspace.home.label.toUpperCase()), '</strong>',
        '<small>', escapeHtml(workspace.home.description), '</small></span>',
        '<span class="work-area-card-arrow" aria-hidden="true">\u2192</span>',
        '</button>'
      ].join("")).join("") : '<p class="work-area-home-empty">No operational work areas are currently assigned.</p>',
      '</section>'
    ].join("");

    root.querySelectorAll("[data-work-area]").forEach(button => {
      button.addEventListener("click", () => enter(button.dataset.workArea));
    });
  }

  function renderMobile(root, firstName, workAreas) {
    root.innerHTML = [
      '<section class="mobile-home" aria-label="DLE-OS Mobile Home">',
      '<header class="mobile-home-intro">',
      '<p class="mobile-home-kicker">DLE-OS MOBILE</p>',
      '<h1>', escapeHtml(greeting()), ', ', escapeHtml(firstName), '</h1>',
      '<p>What are you working on?</p>',
      '</header>',
      '<section class="mobile-home-launchers" aria-label="Assigned mobile work areas">',
      workAreas.length ? workAreas.map(renderMobileLauncher).join("") : '<p class="work-area-home-empty">No operational work areas are currently assigned.</p>',
      '</section>',
      '</section>'
    ].join("");

    root.querySelectorAll("[data-mobile-work-area]").forEach(button => {
      button.addEventListener("click", () => enter(button.dataset.mobileWorkArea));
    });
  }

  function renderMobileLauncher(workspace) {
    const mobileReady = MOBILE_READY_WORKSPACE_IDS.has(workspace.id);
    const element = mobileReady ? "button" : "div";
    const action = mobileReady
      ? ' type="button" data-mobile-work-area="' + escapeHtml(workspace.id) + '"'
      : ' role="status" aria-label="' + escapeHtml(workspace.home.label) + ' Mobile View Coming Soon"';
    return [
      '<', element, action, ' class="mobile-home-card', mobileReady ? ' mobile-ready' : ' mobile-coming-soon', '">',
      '<span class="mobile-home-card-mark" aria-hidden="true">', escapeHtml(workspace.home.mark || workspace.home.label.slice(0, 2)), '</span>',
      '<span class="mobile-home-card-copy"><strong>', escapeHtml(workspace.home.label), '</strong>',
      '<small>', escapeHtml(workspace.home.description), '</small>',
      '<span class="mobile-home-card-state">', mobileReady ? 'Open Mobile View' : 'Mobile View Coming Soon', '</span></span>',
      mobileReady ? '<span class="mobile-home-card-arrow" aria-hidden="true">\u2192</span>' : '',
      '</', element, '>'
    ].join("");
  }

  function enter(workspaceId) {
    const workspace = window.DleWorkspaceRegistry.getById(workspaceId);
    const screenId = workspace?.home?.screenId || "home";
    window.setWorkspaceView(workspaceId);
    window.go(screenId, false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = String(value || "");
    return node.innerHTML;
  }

  window.changeWorkArea = function changeWorkArea() {
    window.DleWorkbenchShell?.close?.();
    window.setWorkspaceView("dle-home");
    window.go("home", false);
    render();
  };
  window.DleWorkAreaHome = Object.freeze({ render, enter });
  document.addEventListener("dle:capabilities-ready", render);
  document.addEventListener("dle:view-mode-change", render);
})(window, document);

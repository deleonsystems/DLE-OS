(function registerWorkAreaHome(window, document) {
  "use strict";

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

    root.innerHTML = [
      '<section class="work-area-home-hero">',
      '<p class="work-area-home-kicker">DLE-OS HOME</p>',
      '<h1>', escapeHtml(greeting()), ', ', escapeHtml(firstName), '</h1>',
      '<p>What are you working on?</p>',
      '</section>',
      '<section class="work-area-home-grid" aria-label="Assigned work areas">',
      workAreas.length ? workAreas.map(workspace => [
        '<button type="button" class="work-area-card" data-work-area="', escapeHtml(workspace.id), '">',
        '<span class="work-area-card-mark" aria-hidden="true">KT</span>',
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

  function enter(workspaceId) {
    window.setWorkspaceView(workspaceId);
    window.go("home", false);
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
})(window, document);

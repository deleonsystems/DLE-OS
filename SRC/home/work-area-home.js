(function registerWorkAreaHome(window, document) {
  "use strict";

  const MOBILE_READY_WORKSPACE_IDS = new Set(["operations-center", "invoice-history", "rfq-quoting"]);
  const HOME_WORKSPACE_ORDER = ["technical-review", "rfqs", "order-entry", "operations-center",
    "quality", "kitting", "purchasing", "receiving", "production", "shipping", "invoice-history"];
  const INTAKE_WIZARD_HOME_ENTRY = Object.freeze({
    id: "rfq-quoting",
    home: Object.freeze({
      label: "INTAKE WIZARD",
      description: "Guided Intake \u2022 Customer \u2022 Quote Request",
      mark: "IW",
      preserveLabelCase: true
    })
  });

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good evening";
  }

  let flowObserver;

  function render() {
    const root = document.getElementById("dleWorkAreaHome");
    if (!root) return;
    flowObserver?.disconnect();
    flowObserver = null;
    root.classList.remove("uses-admin-flow");
    const session = window.DleOsSession;
    const capabilities = window.DleOsCapabilities;
    if (!session || !capabilities) {
      root.innerHTML = '<div class="work-area-home-loading">Loading your assigned work areas\u2026</div>';
      return;
    }

    const firstName = String(session.user?.displayName || "").trim().split(/\s+/)[0] || "there";
    const workAreas = window.DleWorkspaceRegistry.all().filter(workspace => {
      const assignment = workspace.home;
      return assignment && (!workspace.simOnly || isSimIntakeEnabled()) && capabilities.can(assignment.requiredPermission);
    });
    workAreas.sort((a, b) => {
      const rank = id => {
        const index = HOME_WORKSPACE_ORDER.indexOf(id);
        return index < 0 ? HOME_WORKSPACE_ORDER.length : index;
      };
      return rank(a.id) - rank(b.id);
    });
    const homeEntries = isSimIntakeEnabled()
      ? [INTAKE_WIZARD_HOME_ENTRY, ...workAreas]
      : workAreas;

    if (window.DleOperatorHeader?.isMobileView?.() || document.body?.dataset?.viewMode === "mobile") {
      renderMobile(root, firstName, homeEntries);
      return;
    }

    if (usesAdminFlow(session, capabilities)) {
      renderAdminFlow(root, firstName, homeEntries);
      return;
    }

    root.innerHTML = [
      '<section class="work-area-home-hero">',
      '<p class="work-area-home-kicker">DLE-OS HOME</p>',
      '<h1>', escapeHtml(greeting()), ', ', escapeHtml(firstName), '</h1>',
      '<p>What are you working on?</p>',
      '</section>',
      '<section class="work-area-home-grid" aria-label="Assigned work areas">',
      homeEntries.length ? homeEntries.map(workspace => [
        '<button type="button" class="work-area-card" data-work-area="', escapeHtml(workspace.id), '">',
        '<span class="work-area-card-mark" aria-hidden="true">', escapeHtml(workspace.home.mark || workspace.home.label.slice(0, 2)), '</span>',
        '<span><strong>', escapeHtml(homeLabel(workspace)), '</strong>',
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

  // This is navigation only. The module registry and existing capability filters
  // remain authoritative; an arrow never grants access or advances a job.
  function usesAdminFlow(session, capabilities) {
    const mode = window.DleOperatorHeader?.getViewMode?.() || document.body?.dataset?.viewMode;
    return isSimIntakeEnabled() && mode === "desktop" &&
      session.user?.accountStatus === "ACTIVE" &&
      (capabilities.isSuperAdmin === true || (Array.isArray(session.roles) && session.roles.includes("ADMIN")));
  }

  function renderAdminFlow(root, firstName, entries) {
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    // Both QC entry points use the existing Quality permission, only in this
    // admin desktop presentation. Inspection has no business workflow yet.
    const quality = byId.get("quality");
    if (quality) {
      byId.set("quality", {...quality, home:{...quality.home, label:"QC - Packet Review/Release", preserveLabelCase:true}});
      byId.set("quality-inspection", {id:"quality-inspection", home:{
        label:"QC - Inspection", description:"Open jobs · Packet · Slides · BOM", mark:quality.home.mark, preserveLabelCase:true
      }});
    }
    const used = new Set();
    const card = id => {
      const workspace = byId.get(id);
      if (!workspace) return "";
      used.add(id);
      return '<button type="button" class="work-area-card" data-work-area="' + escapeHtml(id) + '">' +
        '<span class="work-area-card-mark" aria-hidden="true">' + escapeHtml(workspace.home.mark || workspace.home.label.slice(0, 2)) + '</span>' +
        '<span><strong>' + escapeHtml(homeLabel(workspace)) + '</strong><small>' + escapeHtml(workspace.home.description) + '</small></span></button>';
    };
    const materials = ["kitting", "purchasing", "receiving"].map(card).join("");
    const main = ["rfq-quoting", "technical-review", "rfqs", "order-entry", "quality"].map(card).join("");
    const production = ["production", "quality-inspection"].map(card).join("");
    const downstream = card("shipping");
    const supporting = ["operations-center", "invoice-history"].map(card).join("");
    const remaining = entries.filter(entry => !used.has(entry.id)).map(entry => card(entry.id)).join("");
    root.classList.add("uses-admin-flow");
    root.innerHTML = '<section class="work-area-home-hero"><p class="work-area-home-kicker">DLE-OS HOME</p>' +
      '<h1>' + escapeHtml(greeting()) + ', ' + escapeHtml(firstName) + '</h1><p>What are you working on?</p></section>' +
      '<p class="home-flow-help" id="homeFlowHelp">Navigation map. Lines show general process relationships, not job status or required steps.</p>' +
      '<section class="home-flow-map" aria-label="Assigned work areas" aria-describedby="homeFlowHelp">' +
      '<svg class="home-flow-lines" aria-hidden="true" focusable="false"></svg>' + main +
      (materials ? '<section class="home-flow-materials" aria-label="Materials"><h2>Materials</h2>' + materials + '</section>' : '') +
      (production ? '<section class="home-flow-production" aria-label="Production"><h2>Production</h2>' + production + '</section>' : '') +
      downstream + (supporting ? '<aside class="home-flow-support" aria-label="Overview and history">' + supporting + '</aside>' : '') +
      (remaining ? '<section class="home-flow-other" aria-label="Other assigned work areas">' + remaining + '</section>' : '') + '</section>';
    root.querySelectorAll("[data-work-area]").forEach(button => {
      button.addEventListener("click", () => {
        enter(button.dataset.workArea);
      });
    });
    const map = root.querySelector(".home-flow-map");
    const svg = root.querySelector(".home-flow-lines");
    const draw = () => {
      if (!map.isConnected) return;
      const bounds = map.getBoundingClientRect();
      const rect = id => {
        const node = map.querySelector('[data-work-area="' + id + '"]');
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return {left:box.left-bounds.left,right:box.right-bounds.left,top:box.top-bounds.top,bottom:box.bottom-bounds.top,
          x:(box.left+box.right)/2-bounds.left,y:(box.top+box.bottom)/2-bounds.top};
      };
      const paths = [];
      const edge = (from, to, kind = "down") => {
        const a = rect(from), b = rect(to);
        if (!a || !b) return; // Never connect around a missing / unauthorized module.
        let d;
        if (kind === "left" || kind === "forward-left") d = `M${a.left},${a.y} H${b.right+2}`;
        else if (kind === "return") {
          const gap = (a.right+b.left)/2, target = b.bottom-18;
          d = `M${a.right},${a.y} H${gap} V${target} H${b.left-2}`;
        } else {
          const middle = (a.bottom+b.top)/2;
          d = `M${a.x},${a.bottom} V${middle} H${b.x} V${b.top-2}`;
        }
        paths.push('<path data-from="'+from+'" data-to="'+to+'" class="home-flow-edge'+(kind === "left" ? ' conditional' : '')+'" d="'+d+'"/>');
      };
      edge("rfq-quoting", "technical-review");
      edge("technical-review", "rfqs");
      edge("technical-review", "order-entry");
      edge("order-entry", "quality");
      edge("quality", "kitting");
      edge("kitting", "purchasing", "left");
      edge("purchasing", "receiving");
      edge("receiving", "kitting", "return");
      edge("kitting", "production");
      edge("production", "quality-inspection", "forward-left");
      edge("quality-inspection", "shipping");
      svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
      svg.innerHTML = '<defs><marker id="homeFlowArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#60a5fa"/></marker></defs>' + paths.join("");
    };
    if (window.ResizeObserver) {
      flowObserver = new window.ResizeObserver(draw);
      flowObserver.observe(map);
      map.querySelectorAll("[data-work-area]").forEach(node => flowObserver.observe(node));
    }
    draw();
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
    const mobileReady = MOBILE_READY_WORKSPACE_IDS.has(workspace.id) ||
      (["technical-review", "rfqs", "quality"].includes(workspace.id) && isSimIntakeEnabled());
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

  function isSimIntakeEnabled() {
    return document.body?.dataset?.simRuntime === "true" &&
      window.DleOsRuntimeConfig?.rfqIntakeMode === "SIM_PHASE1";
  }

  function homeLabel(workspace) {
    return workspace.home.preserveLabelCase
      ? workspace.home.label
      : workspace.home.label.toUpperCase();
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

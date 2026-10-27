(function registerDleWorkspaceRegistry(window) {
  "use strict";

  const WORKSPACE_DEFINITIONS = [
    {
      id: "rfqs", label: "RFQs", simOnly: true,
      purpose: "Shared quotation work with Materials and Labor lanes.",
      modulePath: "/incoming/SRC/workspaces/rfqs/rfqs-workspace.js",
      stylePath: "/incoming/SRC/workspaces/rfqs/rfqs-workspace.css",
      home: Object.freeze({ label: "RFQs", description: "Qualified RFQs • Materials • Labor", mark: "RQ", requiredPermission: "technical_review.view", preserveLabelCase: true })
    },
    {
      id: "dle-home",
      label: "DLE-OS Home",
      purpose: "Choose an assigned operational work area."
    },
    {
      id: "administration",
      label: "Administration",
      purpose: "Development, system management, ERP import, reconciliation, configuration, and developer tools."
    },
    {
      id: "ceo-dashboard",
      label: "CEO Dashboard",
      purpose: "Executive operational view, company health, production overview, KPIs, and daily priorities."
    },
    {
      id: "rfq-quoting",
      label: "RFQ / Quoting",
      purpose: "Incoming opportunities, customer quotations, and estimating workflow."
    },
    {
      id: "technical-review",
      label: "Technical Review",
      purpose: "Trained review of technical packages before downstream work begins.",
      modulePath: "/incoming/SRC/workspaces/technical-review/technical-review-workspace.js",
      stylePath: "/incoming/SRC/workspaces/technical-review/technical-review-workspace.css",
      home: Object.freeze({
        label: "TECHNICAL REVIEW",
        description: "Review Queue \u2022 Technical Package \u2022 Disposition",
        mark: "TR",
        requiredPermission: "technical_review.view",
        preserveLabelCase: true
      })
    },
    {
      id: "assembly-library", label: "Library", simOnly: true,
      purpose: "Reusable forms and existing assembly records.",
      modulePath: "/incoming/SRC/workspaces/assembly-library/assembly-library-workspace.js",
      stylePath: "/incoming/SRC/workspaces/assembly-library/assembly-library-workspace.css",
      home: Object.freeze({label:"Library",description:"Forms Library \u2022 Assembly Library",mark:"LI",requiredPermission:"assembly_library.view",preserveLabelCase:true})
    },
    {
      id: "order-entry",
      label: "Order Entry (VPRO 5 Bridge)", simOnly: true,
      purpose: "Accepted New Orders and manual VPRO setup, awaiting Operations recognition.",
      modulePath: "/incoming/SRC/workspaces/order-entry/order-entry-workspace.js",
      stylePath: "/incoming/SRC/workspaces/order-entry/order-entry-workspace.css",
      home: Object.freeze({label:"Order Entry (VPRO 5 Bridge)",description:"Final Acceptance • VPRO Setup • Sync Handoff",mark:"OE",requiredPermission:"order_entry.view",preserveLabelCase:true})
    },
    {
      id: "contract-review",
      label: "Contract Review",
      purpose: "Technical review, contract verification, and release approval."
    },
    {
      id: "operations-center",
      label: "Operations Center",
      purpose: "Released jobs, scheduling, production priorities, and company-wide operational visibility.",
      home: Object.freeze({
        label: "Operations Center",
        description: "Schedule \u2022 Priorities \u2022 Sync \u2022 Visibility",
        mark: "OC",
        screenId: "operationsCenter",
        requiredPermission: "sync.operations"
      })
    },
    {
      id: "invoice-history",
      label: "Invoice History",
      purpose: "Read-only historical customer invoice lines, invoiced totals, and dedicated synchronization.",
      modulePath: "/incoming/SRC/modules/invoice-history/invoice-history.js",
      stylePath: "/incoming/SRC/modules/invoice-history/invoice-history.css",
      home: Object.freeze({
        label: "Invoice History",
        description: "History \u2022 Invoiced Totals \u2022 Dedicated Sync",
        mark: "IH",
        screenId: "home",
        requiredPermission: "sync.operations"
      })
    },
    {
      id: "purchasing",
      label: "Purchasing",
      purpose: "Material procurement, vendor management, and material shortages.",
      modulePath: "/incoming/SRC/workspaces/purchasing/purchasing-workspace.js",
      stylePath: "/incoming/SRC/workspaces/purchasing/purchasing-workspace.css",
      home: Object.freeze({
        label: "Purchasing",
        description: "Shortages \u2022 POs \u2022 Due Dates \u2022 Receiving",
        mark: "PU",
        requiredPermission: "kitting.view"
      })
    },
    {
      id: "vendors", label: "Vendors", simOnly: true,
      purpose: "Read-only vendor names and numbers from the VPRO5 snapshot.",
      modulePath: "/incoming/SRC/workspaces/vendors/vendors-workspace.js",
      stylePath: "/incoming/SRC/workspaces/vendors/vendors-workspace.css",
      home: Object.freeze({
        label: "Vendors", description: "Vendor names and numbers", mark: "VE",
        requiredPermission: "sync.operations", preserveLabelCase: true
      })
    },
    {
      id: "receiving", label: "Receiving", simOnly: true,
      purpose: "Expected purchased PO lines and read-only incoming material context.",
      modulePath: "/incoming/SRC/workspaces/receiving/receiving-workspace.js",
      stylePath: "/incoming/SRC/workspaces/receiving/receiving-workspace.css",
      home: Object.freeze({
        label: "Receiving", description: "Expected Material \u2022 PO Lines \u2022 Job Coverage",
        mark: "RC", requiredPermission: "receiving.view"
      })
    },
    {
      id: "kitting",
      label: "Kitting",
      purpose: "Kit preparation, kit shortages, and material issue to production.",
      home: Object.freeze({
        label: "Kitting",
        description: "Pick \u2022 Count \u2022 Shortages \u2022 Traceability",
        mark: "KT",
        requiredPermission: "kitting.view"
      })
    },
    {
      id: "production",
      label: "Production",
      purpose: "Select Kit Complete and Kit Short work orders for production execution.",
      modulePath: "/incoming/SRC/workspaces/production/production-workspace.js",
      stylePath: "/incoming/SRC/workspaces/production/production-workspace.css",
      home: Object.freeze({
        label: "Production",
        description: "Kit Complete \u2022 Kit Short \u2022 Work Order Launch",
        mark: "PR",
        requiredPermission: "kitting.view"
      })
    },
    {
      id: "quality-inspection", label: "QC - Inspection", simOnly: true,
      purpose: "Quality inspection, pending Production additions and controlled instruction release.",
      home: Object.freeze({label:"QC - Inspection",description:"Review Production additions and instruction drafts",mark:"QC",requiredPermission:"quality.review"}),
      modulePath: "/incoming/SRC/workspaces/quality-inspection/quality-inspection-workspace.js",
      stylePath: "/incoming/SRC/workspaces/quality-inspection/quality-inspection-workspace.css"
    },
    {
      id: "quality",
      label: "Quality",
      purpose: "Inspection, FAIRs, nonconformances, and corrective actions.",
      get modulePath() { return window.document?.body?.dataset?.simRuntime === "true" ? "/incoming/SRC/workspaces/quality/quality-workspace.js" : undefined; },
      get stylePath() { return window.document?.body?.dataset?.simRuntime === "true" ? "/incoming/SRC/workspaces/quality/quality-workspace.css" : undefined; },
      get home() { return window.document?.body?.dataset?.simRuntime === "true" ? Object.freeze({
        label: "Quality", description: "Awaiting Review / Release", mark: "QA",
        requiredPermission: "order_entry.view", preserveLabelCase: true
      }) : undefined; }
    },
    {
      id: "shipping",
      label: "Shipping Workspace",
      purpose: "Request to Ship preparation and customer shipment operations.",
      home: Object.freeze({
        label: "Shipping", description: "Released Work \u2022 Job Context \u2022 Print Previews",
        mark: "SH", requiredPermission: "shipments.view"
      })
    },
    {
      id: "platform",
      label: "Platform",
      purpose: "Read-only inspection of governed canonical platform data."
    },
    {
      id: "reports",
      label: "Reports",
      purpose: "Reporting, analytics, and historical data."
    }
  ];

  const workspaceById = new Map(WORKSPACE_DEFINITIONS.map(workspace => [workspace.id, workspace]));
  const workspaceByLabel = new Map(WORKSPACE_DEFINITIONS.map(workspace => [workspace.label, workspace]));
  // Existing saved navigation labels still resolve to the same workspace identity.
  workspaceByLabel.set("Assembly Library", workspaceById.get("assembly-library"));
  const inspectionAvailable = () => {
    const session = window.DleOsSession, capabilities = window.DleOsCapabilities;
    return window.document?.body?.dataset?.simRuntime === "true" &&
      window.DleOsRuntimeConfig?.rfqIntakeMode === "SIM_PHASE1" &&
      ["desktop", "ipad"].includes(window.DleOperatorHeader?.getViewMode?.() || window.document?.body?.dataset?.viewMode) &&
      session?.user?.accountStatus === "ACTIVE" &&
      (capabilities?.isSuperAdmin === true || capabilities?.can?.("quality.review") === true || (Array.isArray(session?.roles) && session.roles.includes("ADMIN"))) &&
      capabilities?.can?.("order_entry.view") === true;
  };
  const vendorsAvailable = () => window.document?.body?.dataset?.simRuntime === "true" &&
    window.DleOsRuntimeConfig?.rfqIntakeMode === "SIM_PHASE1" &&
    window.DleOsSession?.user?.accountStatus === "ACTIVE" &&
    window.DleOsCapabilities?.isSuperAdmin === true &&
    window.DleOsCapabilities?.can?.("sync.operations") === true;
  const available = workspace => workspace && (!Array.isArray(window.DleOsSession?.allowedWorkspaces)||window.DleOsSession.allowedWorkspaces.includes(workspace.id)) && (!workspace.simOnly || window.document?.body?.dataset?.simRuntime === "true") &&
    (workspace.id !== "quality-inspection" || inspectionAvailable()) &&
    (workspace.id !== "vendors" || vendorsAvailable());

  window.DleWorkspaceRegistry = Object.freeze({
    defaultWorkspaceId: "dle-home",
    all() {
      const workspaces = WORKSPACE_DEFINITIONS.filter(available);
      if (window.document?.body?.dataset?.simRuntime !== "true") return workspaces;
      const ordered = workspaces.filter(workspace => !["quality", "kitting"].includes(workspace.id));
      const afterOperations = ordered.findIndex(workspace => workspace.id === "operations-center") + 1;
      ordered.splice(afterOperations, 0, ...[workspaceById.get("quality"), workspaceById.get("kitting")].filter(available));
      return ordered;
    },
    getById(id) {
      const workspace = workspaceById.get(id); return available(workspace) ? workspace : null;
    },
    getByLabel(label) {
      const workspace = workspaceByLabel.get(label); return available(workspace) ? workspace : null;
    },
    resolve(value) {
      return this.getById(value) || this.getByLabel(value) || workspaceById.get(this.defaultWorkspaceId);
    }
  });
})(window);

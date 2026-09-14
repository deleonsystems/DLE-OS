(function registerDleWorkspaceRegistry(window) {
  "use strict";

  const WORKSPACE_DEFINITIONS = [
    {
      id: "rfqs", label: "RFQs", simOnly: true,
      purpose: "Shared quotation work with Materials and Labor lanes.",
      modulePath: "SRC/workspaces/rfqs/rfqs-workspace.js",
      stylePath: "SRC/workspaces/rfqs/rfqs-workspace.css",
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
      modulePath: "SRC/workspaces/technical-review/technical-review-workspace.js",
      stylePath: "SRC/workspaces/technical-review/technical-review-workspace.css",
      home: Object.freeze({
        label: "TECHNICAL REVIEW",
        description: "Review Queue \u2022 Technical Package \u2022 Disposition",
        mark: "TR",
        requiredPermission: "technical_review.view",
        preserveLabelCase: true
      })
    },
    {
      id: "order-entry",
      label: "Order Entry",
      purpose: "New customer orders, sales order processing, and initial job creation."
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
      modulePath: "SRC/modules/invoice-history/invoice-history.js",
      stylePath: "SRC/modules/invoice-history/invoice-history.css",
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
      modulePath: "SRC/workspaces/purchasing/purchasing-workspace.js",
      stylePath: "SRC/workspaces/purchasing/purchasing-workspace.css",
      home: Object.freeze({
        label: "Purchasing",
        description: "Shortages \u2022 POs \u2022 Due Dates \u2022 Receiving",
        mark: "PU",
        requiredPermission: "kitting.view"
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
      modulePath: "SRC/workspaces/production/production-workspace.js",
      stylePath: "SRC/workspaces/production/production-workspace.css",
      home: Object.freeze({
        label: "Production",
        description: "Kit Complete \u2022 Kit Short \u2022 Work Order Launch",
        mark: "PR",
        requiredPermission: "kitting.view"
      })
    },
    {
      id: "quality",
      label: "Quality",
      purpose: "Inspection, FAIRs, nonconformances, and corrective actions."
    },
    {
      id: "shipping",
      label: "Shipping Workspace",
      purpose: "Request to Ship preparation and customer shipment operations."
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
  const available = workspace => workspace && (!workspace.simOnly || window.document?.body?.dataset?.simRuntime === "true");

  window.DleWorkspaceRegistry = Object.freeze({
    defaultWorkspaceId: "dle-home",
    all() {
      return WORKSPACE_DEFINITIONS.filter(available);
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

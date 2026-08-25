(function registerDleWorkspaceRegistry(window) {
  "use strict";

  const WORKSPACE_DEFINITIONS = [
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
      purpose: "Material procurement, vendor management, and material shortages."
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
      purpose: "Active work orders, operator workflow, labor reporting, and build status."
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

  window.DleWorkspaceRegistry = Object.freeze({
    defaultWorkspaceId: "dle-home",
    all() {
      return WORKSPACE_DEFINITIONS.slice();
    },
    getById(id) {
      return workspaceById.get(id) || null;
    },
    getByLabel(label) {
      return workspaceByLabel.get(label) || null;
    },
    resolve(value) {
      return workspaceById.get(value) || workspaceByLabel.get(value) || workspaceById.get(this.defaultWorkspaceId);
    }
  });
})(window);

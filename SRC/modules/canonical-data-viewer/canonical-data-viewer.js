(function registerCanonicalDataViewer(window, document) {
  "use strict";

  const WORKSPACE_ID = "platform";
  const TEMPLATE_PATH = "SRC/modules/canonical-data-viewer/canonical-data-viewer.html";
  const REQUEST_TIMEOUT_MS = 15000;
  const WORK_ORDER_SEARCH_DEBOUNCE_MS = 300;
  const PAGE_SIZES = Object.freeze([25, 50, 100, 200]);
  const NULL_MARKER = "—";
  const VIEWER_PROFILES = Object.freeze({
    historical: Object.freeze({
      key: "historical",
      apiProperty: null,
      title: "Canonical Data Viewer — Test Data",
      description: "Read-only inspection of Canonical Contract v1.2 data from the historical test SQL snapshot.",
      environment: "HISTORICAL_TEST",
      database: "DLE_OS_PLATFORM_LAB",
      bannerTitle: "HISTORICAL TEST DATA",
      bannerKind: "Read-only canonical snapshot",
      bannerNote: "Not live Add" + "+ON data"
    }),
    live: Object.freeze({
      key: "live",
      apiProperty: "liveCanonical",
      title: "Canonical Data Viewer — Live Snapshot",
      description: "Read-only inspection of the latest qualified live-source canonical snapshot. This is not real-time data.",
      environment: "LIVE",
      database: "DLE_OS_CANONICAL_LIVE",
      bannerTitle: "LIVE SOURCE SNAPSHOT — READ ONLY",
      bannerKind: "Qualified canonical snapshot · not real-time",
      bannerNote: "No writes or direct source-system access"
    })
  });

  const ENTITIES = Object.freeze({
    workOrders: Object.freeze({
      title: "Work Orders",
      singular: "Work Order",
      identifier: "workOrderNumber",
      listMethod: "getCanonicalWorkOrders",
      lookupMethod: "getCanonicalWorkOrder",
      filters: Object.freeze([
        Object.freeze({
          name: "workOrderNumber",
          label: "Work Order Number",
          placeholder: "Leading zeros optional, e.g. 5 or 0000005",
          liveSearch: true
        }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "status", label: "Status" })
      ]),
      columns: Object.freeze([
        Object.freeze({ name: "workOrderNumber", label: "Work Order" }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "itemDescription", label: "Resolved Inventory Description" }),
        Object.freeze({ name: "nonStockDescriptionLine1", label: "Non-Stock Description Line 1" }),
        Object.freeze({ name: "nonStockDescriptionLine2", label: "Non-Stock Description Line 2" }),
        Object.freeze({ name: "workOrderStatus", label: "Status" }),
        Object.freeze({ name: "workOrderOpenedDateIso", label: "Opened Date", isoDate: true }),
        Object.freeze({ name: "schProdQuantity", label: "Scheduled Quantity" })
      ]),
      fields: Object.freeze([
        Object.freeze({ name: "workOrderNumber", label: "Work Order Number" }),
        Object.freeze({ name: "workOrderType", label: "Work Order Type" }),
        Object.freeze({ name: "workOrderStatus", label: "Work Order Status" }),
        Object.freeze({ name: "workOrderOpenedDateIso", label: "Work Order Opened Date", isoDate: true }),
        Object.freeze({ name: "workOrderClosedDateIso", label: "Work Order Closed Date", isoDate: true }),
        Object.freeze({ name: "workOrderOpenedDate", label: "Work Order Opened Date (Raw)", rawDate: true }),
        Object.freeze({ name: "workOrderClosedDate", label: "Work Order Closed Date (Raw)", rawDate: true }),
        Object.freeze({ name: "customerNumber", label: "Customer Number" }),
        Object.freeze({ name: "salesOrderNumber", label: "Sales Order Number" }),
        Object.freeze({ name: "salesOrderLineNumber", label: "Sales Order Line Number" }),
        Object.freeze({ name: "unitOfMeasure", label: "Unit of Measure" }),
        Object.freeze({ name: "bomRevision", label: "BOM Revision" }),
        Object.freeze({ name: "warehouseId", label: "Warehouse ID" }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "itemDescription", label: "Resolved Inventory Description" }),
        Object.freeze({ name: "drawingNumber", label: "Drawing Number" }),
        Object.freeze({ name: "drawingRevision", label: "Drawing Revision" }),
        Object.freeze({ name: "schProdQuantity", label: "Scheduled Production Quantity", decimalText: true }),
        Object.freeze({ name: "nonStockDescriptionLine1", label: "Non-Stock Description Line 1" }),
        Object.freeze({ name: "nonStockDescriptionLine2", label: "Non-Stock Description Line 2" })
      ])
    }),
    inventoryItems: Object.freeze({
      title: "Inventory Items",
      singular: "Inventory Item",
      identifier: "itemNumber",
      listMethod: "getCanonicalInventoryItems",
      lookupMethod: "getCanonicalInventoryItem",
      filters: Object.freeze([
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "itemDescription", label: "Item Description" })
      ]),
      columns: Object.freeze([
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "itemDescription", label: "Item Description" }),
        Object.freeze({ name: "productType", label: "Product Type" }),
        Object.freeze({ name: "salesUnitOfMeasure", label: "Sales UOM" }),
        Object.freeze({ name: "purchaseUnitOfMeasure", label: "Purchase UOM" }),
        Object.freeze({ name: "vendorNumber", label: "Vendor Number" }),
        Object.freeze({ name: "lastReceiptDate", label: "Last Receipt Raw Date" })
      ]),
      fields: Object.freeze([
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "itemDescription", label: "Item Description" }),
        Object.freeze({ name: "productType", label: "Product Type" }),
        Object.freeze({ name: "salesUnitOfMeasure", label: "Sales Unit of Measure" }),
        Object.freeze({ name: "purchaseUnitOfMeasure", label: "Purchase Unit of Measure" }),
        Object.freeze({ name: "vendorNumber", label: "Vendor Number" }),
        Object.freeze({ name: "lastReceiptDate", label: "Last Receipt Date", rawDate: true })
      ])
    }),
    billsOfMaterial: Object.freeze({
      title: "Bills of Material",
      singular: "Bill of Material",
      identifier: "billNumber",
      listMethod: "getCanonicalBillsOfMaterial",
      lookupMethod: "getCanonicalBillOfMaterial",
      filters: Object.freeze([
        Object.freeze({ name: "billNumber", label: "Bill Number" }),
        Object.freeze({ name: "drawingNumber", label: "Drawing Number" }),
        Object.freeze({ name: "drawingRevision", label: "Drawing Revision" }),
        Object.freeze({ name: "bomRevision", label: "BOM Revision" })
      ]),
      columns: Object.freeze([
        Object.freeze({ name: "billNumber", label: "Bill Number" }),
        Object.freeze({ name: "drawingNumber", label: "Drawing Number" }),
        Object.freeze({ name: "drawingRevision", label: "Drawing Revision" }),
        Object.freeze({ name: "bomRevision", label: "BOM Revision" }),
        Object.freeze({ name: "bomRevisionDate", label: "BOM Revision Raw Date" })
      ]),
      fields: Object.freeze([
        Object.freeze({ name: "billNumber", label: "Bill Number" }),
        Object.freeze({ name: "drawingNumber", label: "Drawing Number" }),
        Object.freeze({ name: "drawingRevision", label: "Drawing Revision" }),
        Object.freeze({ name: "bomRevisionDate", label: "BOM Revision Date", rawDate: true }),
        Object.freeze({ name: "bomRevision", label: "BOM Revision" })
      ])
    }),
    generalLedgerAccounts: Object.freeze({
      title: "General Ledger Accounts",
      singular: "General Ledger Account",
      identifier: "generalLedgerAccountNumber",
      listMethod: "getCanonicalGeneralLedgerAccounts",
      lookupMethod: "getCanonicalGeneralLedgerAccount",
      filters: Object.freeze([
        Object.freeze({ name: "accountNumber", label: "Account Number" }),
        Object.freeze({ name: "accountDescription", label: "Account Description" })
      ]),
      columns: Object.freeze([
        Object.freeze({ name: "generalLedgerAccountNumber", label: "Account Number" }),
        Object.freeze({ name: "generalLedgerAccountDescription", label: "Account Description" }),
        Object.freeze({ name: "generalLedgerAccountType", label: "Account Type" })
      ]),
      fields: Object.freeze([
        Object.freeze({ name: "generalLedgerAccountNumber", label: "General Ledger Account Number" }),
        Object.freeze({ name: "generalLedgerAccountDescription", label: "General Ledger Account Description" }),
        Object.freeze({ name: "generalLedgerAccountType", label: "General Ledger Account Type" })
      ])
    }),
    salesOrders: Object.freeze({
      title: "Sales Orders",
      singular: "Sales Order Line",
      identifier: "salesOrderLineId",
      listMethod: "getCanonicalSalesOrders",
      lookupMethod: "getCanonicalSalesOrder",
      liveOnly: true,
      filters: Object.freeze([
        Object.freeze({ name: "customerNumber", label: "Customer Number" }),
        Object.freeze({ name: "customerName", label: "Customer Name" }),
        Object.freeze({ name: "salesOrderNumber", label: "Sales Order Number" }),
        Object.freeze({ name: "customerPurchaseOrderNumber", label: "Customer PO" }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "workOrderNumber", label: "Work Order Number" }),
        Object.freeze({ name: "estimatedShipDate", label: "Estimated Ship Date (YYYY-MM-DD)" }),
        Object.freeze({
          name: "negativeQuantity",
          label: "Quantity Sign",
          options: Object.freeze([
            Object.freeze({ value: "", label: "All quantities" }),
            Object.freeze({ value: "true", label: "Negative only" }),
            Object.freeze({ value: "false", label: "Zero or positive" })
          ])
        }),
        Object.freeze({
          name: "unresolvedWorkOrder",
          label: "Work Order Relationship",
          options: Object.freeze([
            Object.freeze({ value: "", label: "All relationships" }),
            Object.freeze({ value: "true", label: "Unresolved only" }),
            Object.freeze({ value: "false", label: "Resolved only" })
          ])
        })
      ]),
      columns: Object.freeze([
        Object.freeze({ name: "orderDate", label: "Order Date", isoDate: true }),
        Object.freeze({ name: "customerNumber", label: "Customer Number" }),
        Object.freeze({ name: "customerName", label: "Customer Name" }),
        Object.freeze({ name: "customerPurchaseOrderNumber", label: "Customer PO" }),
        Object.freeze({ name: "salesOrderNumber", label: "Sales Order Number" }),
        Object.freeze({ name: "lineNumber", label: "Line Number" }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "description", label: "Description" }),
        Object.freeze({ name: "estimatedShipDate", label: "Estimated Ship Date", isoDate: true }),
        Object.freeze({ name: "quantityOrdered", label: "Quantity Ordered" }),
        Object.freeze({ name: "unitPrice", label: "Unit Price" }),
        Object.freeze({ name: "extendedPrice", label: "Extended Price" }),
        Object.freeze({ name: "workOrderNumber", label: "Work Order Number" }),
        Object.freeze({ name: "scheduledProductionQuantity", label: "Scheduled Production Quantity" }),
        Object.freeze({ name: "billNumber", label: "Bill Number" }),
        Object.freeze({ name: "drawingNumber", label: "Drawing Number" }),
        Object.freeze({ name: "drawingRevision", label: "Drawing Revision" }),
        Object.freeze({ name: "bomRevision", label: "BOM Revision" })
      ]),
      fields: Object.freeze([
        Object.freeze({ name: "orderDate", label: "Order Date", isoDate: true }),
        Object.freeze({ name: "customerNumber", label: "Customer Number" }),
        Object.freeze({ name: "customerName", label: "Customer Name" }),
        Object.freeze({ name: "customerPurchaseOrderNumber", label: "Customer PO" }),
        Object.freeze({ name: "salesOrderNumber", label: "Sales Order Number" }),
        Object.freeze({ name: "lineNumber", label: "Line Number" }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "orderMemo", label: "Order Memo" }),
        Object.freeze({ name: "description", label: "Resolved Description" }),
        Object.freeze({ name: "estimatedShipDate", label: "Estimated Ship Date", isoDate: true }),
        Object.freeze({ name: "quantityOrdered", label: "Quantity Ordered" }),
        Object.freeze({ name: "unitPrice", label: "Unit Price" }),
        Object.freeze({ name: "extendedPrice", label: "Extended Price (Derived)" }),
        Object.freeze({ name: "workOrderNumber", label: "Work Order Number" }),
        Object.freeze({ name: "scheduledProductionQuantity", label: "Scheduled Production Quantity" }),
        Object.freeze({ name: "billNumber", label: "Bill Number" }),
        Object.freeze({ name: "drawingNumber", label: "Drawing Number" }),
        Object.freeze({ name: "drawingRevision", label: "Drawing Revision" }),
        Object.freeze({ name: "bomRevision", label: "BOM Revision" })
      ])
    }),
    invoiceHistory: Object.freeze({
      title: "Invoice History",
      singular: "Invoice History Line",
      identifier: "invoiceHistoryLineId",
      listMethod: "getCanonicalInvoiceHistory",
      lookupMethod: "getCanonicalInvoiceHistoryLine",
      liveOnly: true,
      filters: Object.freeze([
        Object.freeze({ name: "invoiceDateFrom", label: "Invoice Date From (YYYY-MM-DD)" }),
        Object.freeze({ name: "invoiceDateTo", label: "Invoice Date To (YYYY-MM-DD)" }),
        Object.freeze({
          name: "customerNumber",
          label: "Customer Number",
          placeholder: "Leading zeros optional, e.g. 1148 or 001148"
        }),
        Object.freeze({
          name: "invoiceNumber",
          label: "Invoice Number",
          placeholder: "Leading zeros optional"
        }),
        Object.freeze({
          name: "salesOrderNumber",
          label: "Sales Order Number",
          placeholder: "Leading zeros optional"
        }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({
          name: "workOrderNumber",
          label: "Work Order Number",
          placeholder: "Leading zeros optional"
        })
      ]),
      columns: Object.freeze([
        Object.freeze({ name: "customerNumber", label: "Customer" }),
        Object.freeze({ name: "invoiceNumber", label: "Invoice Number" }),
        Object.freeze({ name: "invoiceDate", label: "Invoice Date", isoDate: true }),
        Object.freeze({
          name: "accountsReceivablePurchaseOrderNumber",
          label: "Customer PO"
        }),
        Object.freeze({ name: "salesOrderNumber", label: "Sales Order" }),
        Object.freeze({ name: "salesOrderLineNumber", label: "SO Line" }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "itemDescription", label: "Description" }),
        Object.freeze({ name: "quantityShipped", label: "Quantity Shipped" }),
        Object.freeze({ name: "unitPrice", label: "Unit Price" }),
        Object.freeze({ name: "extendedPrice", label: "Extended Price" }),
        Object.freeze({ name: "workOrderNumber", label: "Work Order" }),
        Object.freeze({ name: "billNumber", label: "Bill Number" }),
        Object.freeze({ name: "drawingNumber", label: "Drawing Number" }),
        Object.freeze({ name: "drawingRevision", label: "Drawing Revision" })
      ]),
      fields: Object.freeze([
        Object.freeze({ name: "firmId", label: "Firm ID" }),
        Object.freeze({ name: "arType", label: "A/R Type" }),
        Object.freeze({ name: "customerNumber", label: "Customer Number" }),
        Object.freeze({ name: "customerName", label: "Customer Name" }),
        Object.freeze({
          name: "customerNameResolutionType",
          label: "Customer Name Source"
        }),
        Object.freeze({ name: "invoiceNumber", label: "Invoice Number" }),
        Object.freeze({ name: "invoiceLineNumber", label: "Invoice Line Number" }),
        Object.freeze({ name: "invoiceDate", label: "Invoice Date", isoDate: true }),
        Object.freeze({
          name: "accountsReceivablePurchaseOrderNumber",
          label: "Customer Purchase Order Number"
        }),
        Object.freeze({ name: "salesOrderNumber", label: "Sales Order Number" }),
        Object.freeze({ name: "salesOrderLineNumber", label: "Sales Order Line" }),
        Object.freeze({ name: "lineCode", label: "Line Code" }),
        Object.freeze({ name: "itemNumber", label: "Item Number" }),
        Object.freeze({ name: "itemDescription", label: "Item Description" }),
        Object.freeze({
          name: "itemDescriptionResolutionType",
          label: "Item Description Source"
        }),
        Object.freeze({
          name: "estimatedShipDate",
          label: "Estimated Ship Date",
          isoDate: true
        }),
        Object.freeze({ name: "onTimeIndicator", label: "On-Time Indicator" }),
        Object.freeze({ name: "quantityShipped", label: "Quantity Shipped" }),
        Object.freeze({ name: "unitPrice", label: "Unit Price" }),
        Object.freeze({ name: "extendedPrice", label: "Extended Price" }),
        Object.freeze({ name: "workOrderNumber", label: "Work Order Number" }),
        Object.freeze({
          name: "workOrderResolutionStatus",
          label: "Work Order Resolution"
        }),
        Object.freeze({
          name: "workOrderCandidateCount",
          label: "Work Order Candidate Count"
        }),
        Object.freeze({ name: "billNumber", label: "Bill Number" }),
        Object.freeze({ name: "bomRevision", label: "BOM Revision" }),
        Object.freeze({ name: "drawingNumber", label: "Drawing Number" }),
        Object.freeze({ name: "drawingRevision", label: "Drawing Revision" }),
        Object.freeze({ name: "revisionCode", label: "Revision Code" }),
        Object.freeze({
          name: "manufacturingResolutionType",
          label: "Manufacturing Source"
        }),
        Object.freeze({
          name: "invoiceHistoryImportRunId",
          label: "Invoice History Import Run ID"
        }),
        Object.freeze({
          name: "sourceExtractionRunId",
          label: "Source Extraction Run ID"
        }),
        Object.freeze({
          name: "sourceQualificationRunId",
          label: "Source Qualification Run ID"
        }),
        Object.freeze({ name: "packageContentHash", label: "Package SHA-256" }),
        Object.freeze({ name: "activatedAtUtc", label: "Baseline Activated At" })
      ])
    })
  });

  let mount = null;
  let mounted = false;
  let active = false;
  let statusRequest = null;
  let lastFocusedRow = null;
  let workOrderSearchTimer = null;
  let refreshStatusTimer = null;

  const viewerStates = Object.fromEntries(
    Object.keys(VIEWER_PROFILES).map(profileKey => [profileKey, createViewerState()])
  );
  let activeProfileKey = "historical";
  let state = viewerStates[activeProfileKey];

  function createViewerState() {
    return {
      activeEntity: "workOrders",
      readiness: "checking",
      readinessPayload: null,
      snapshot: "checking",
      snapshotPayload: null,
      invoiceHistoryAvailable: false,
      refresh: {
        authorized: false,
        available: false,
        running: false,
        status: "CHECKING",
        phase: null,
        message: "Checking operator authorization and refresh status.",
        lastSourceCheckUtc: null,
        lastSuccessfulRefreshUtc: null,
        activeImportRunId: null,
        lastResult: null,
        lastFailureReason: null
      },
      statusMessage: "Checking the configured canonical API.",
      entities: Object.fromEntries(Object.keys(ENTITIES).map(entityKey => [entityKey, {
        filters: {},
        page: 1,
        pageSize: 50,
        items: [],
        totalItems: 0,
        totalPages: 0,
        hasPreviousPage: false,
        hasNextPage: false,
        status: "idle",
        message: "Waiting for API readiness.",
        selectedRecord: null,
        request: null,
        requestSequence: 0
      }]))
    };
  }

  async function renderWorkspace() {
    mount = document.querySelector('[data-workspace-mount="' + WORKSPACE_ID + '"]');
    if (!mount) return;

    active = true;
    if (!mounted) {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Canonical Data Viewer</h3><p>Preparing the read-only workspace.</p></div>';
      const response = await fetch(TEMPLATE_PATH, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load the Canonical Data Viewer template.");
      mount.innerHTML = await response.text();
      mount.dataset.workspaceLoaded = "true";
      bindEvents();
      mounted = true;
      renderProfile();
      renderAll();
      await refreshStatus({ loadDefaultEntity: true });
      return;
    }

    renderAll();
    if (!statusRequest && state.readiness === "checking") {
      await refreshStatus({ loadDefaultEntity: true });
      return;
    }
    if (state.readiness === "ready" && ["idle", "cancelled"].includes(state.entities[state.activeEntity].status)) {
      await loadEntity(state.activeEntity);
    }
  }

  function bindEvents() {
    mount.addEventListener("click", handleClick);
    mount.addEventListener("submit", handleSubmit);
    mount.addEventListener("input", handleInput);
    mount.addEventListener("change", handleChange);
    mount.addEventListener("keydown", handleKeydown);
    document.addEventListener("dle:workspace-change", handleWorkspaceChange);
  }

  function unbindEvents() {
    if (!mounted || !mount) return;
    mount.removeEventListener("click", handleClick);
    mount.removeEventListener("submit", handleSubmit);
    mount.removeEventListener("input", handleInput);
    mount.removeEventListener("change", handleChange);
    mount.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("dle:workspace-change", handleWorkspaceChange);
  }

  function handleWorkspaceChange(event) {
    active = event.detail?.workspace?.id === WORKSPACE_ID;
    if (!active) {
      cancelDebouncedWorkOrderSearch();
      abortAllRequests();
      closeDetail({ restoreFocus: false });
    }
  }

  function handleClick(event) {
    const profileButton = event.target.closest("[data-canonical-profile]");
    if (profileButton) {
      selectProfile(profileButton.dataset.canonicalProfile);
      return;
    }

    const tab = event.target.closest("[data-canonical-tab]");
    if (tab) {
      selectEntity(tab.dataset.canonicalTab, { focusTab: false });
      return;
    }

    const row = event.target.closest("[data-canonical-row]");
    if (row) {
      lastFocusedRow = row;
      openDetail(row.dataset.canonicalIdentifier);
      return;
    }

    const action = event.target.closest("[data-canonical-action]")?.dataset.canonicalAction;
    if (!action) return;
    if (action === "refresh-status" || action === "retry-status") refreshStatus({ loadDefaultEntity: false });
    if (action === "run-erp-refresh") runErpSnapshotRefresh();
    if (action === "clear-filters") clearFilters();
    if (action === "previous-page") changePage(-1);
    if (action === "go-to-page") goToPage();
    if (action === "next-page") changePage(1);
    if (action === "close-detail") closeDetail();
  }

  async function selectProfile(profileKey) {
    if (!VIEWER_PROFILES[profileKey] || profileKey === activeProfileKey) return;
    cancelDebouncedWorkOrderSearch();
    abortStatusRequest();
    Object.values(state.entities).forEach(abortEntityRequest);
    closeDetail({ restoreFocus: false });
    activeProfileKey = profileKey;
    state = viewerStates[activeProfileKey];
    renderProfile();
    renderAll();

    if (state.readiness === "checking") {
      await refreshStatus({ loadDefaultEntity: true });
      return;
    }
    if (state.readiness === "ready" && ["idle", "cancelled"].includes(currentEntityState().status)) {
      await loadEntity(state.activeEntity);
    }
  }

  function handleSubmit(event) {
    if (!event.target.matches("[data-canonical-filters]")) return;
    event.preventDefault();
    submitFilters(event.target);
  }

  function submitFilters(form) {
    cancelDebouncedWorkOrderSearch();
    const entityState = currentEntityState();
    const definition = currentDefinition();
    entityState.filters = readFilters(form, definition);
    entityState.page = 1;
    loadEntity(state.activeEntity);
  }

  function handleInput(event) {
    const input = event.target;
    if (input.matches("[data-canonical-page-input]")) {
      if (input.value !== String(currentEntityState().page)) setPageValidation("");
      return;
    }
    if (!input.matches('[data-canonical-live-search="true"]')) return;
    if (state.activeEntity !== "workOrders" || state.readiness !== "ready") return;

    const form = input.closest("[data-canonical-filters]");
    if (!form) return;

    const entityState = currentEntityState();
    entityState.filters = readFilters(form, currentDefinition());
    entityState.page = 1;
    cancelDebouncedWorkOrderSearch();
    workOrderSearchTimer = window.setTimeout(() => {
      workOrderSearchTimer = null;
      if (active && state.activeEntity === "workOrders" && state.readiness === "ready") {
        loadEntity("workOrders");
      }
    }, WORK_ORDER_SEARCH_DEBOUNCE_MS);
  }

  function handleChange(event) {
    if (!event.target.matches("[data-canonical-page-size]")) return;
    cancelDebouncedWorkOrderSearch();
    const pageSize = Number(event.target.value);
    if (!PAGE_SIZES.includes(pageSize)) {
      event.target.value = String(currentEntityState().pageSize);
      return;
    }
    currentEntityState().pageSize = pageSize;
    currentEntityState().page = 1;
    loadEntity(state.activeEntity);
  }

  function handleKeydown(event) {
    const pageInput = event.target.closest("[data-canonical-page-input]");
    if (pageInput && event.key === "Enter") {
      event.preventDefault();
      goToPage(pageInput.value);
      return;
    }

    const filterForm = event.target.closest("[data-canonical-filters]");
    if (filterForm && event.target.matches("input") && event.key === "Enter") {
      event.preventDefault();
      submitFilters(filterForm);
      return;
    }

    const tab = event.target.closest("[data-canonical-tab]");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const keys = Object.keys(ENTITIES);
      const currentIndex = keys.indexOf(tab.dataset.canonicalTab);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? keys.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length;
      selectEntity(keys[nextIndex], { focusTab: true });
      return;
    }

    const row = event.target.closest("[data-canonical-row]");
    if (row && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      lastFocusedRow = row;
      openDetail(row.dataset.canonicalIdentifier);
      return;
    }

    if (event.key === "Escape") closeDetail();
  }

  async function refreshStatus(options = {}) {
    abortStatusRequest();
    const request = createTimedRequest();
    statusRequest = request;
    state.readiness = "checking";
    state.snapshot = "checking";
    state.statusMessage = "Checking readiness and snapshot metadata.";
    renderStatus();

    const api = currentApi();
    if (!api?.getPlatformReadiness || !api?.getPlatformSnapshot) {
      state.readiness = "unavailable";
      state.snapshot = "unavailable";
      state.statusMessage = activeProfileKey === "live"
        ? "The LIVE API client is unavailable. No historical fallback will be used."
        : "The shared canonical API client is unavailable. No alternate source will be used.";
      request.finish();
      statusRequest = null;
      renderStatus();
      return;
    }

    const [readinessResult, snapshotResult, invoiceHistoryResult] =
      await Promise.allSettled([
      api.getPlatformReadiness({ signal: request.controller.signal }),
      api.getPlatformSnapshot({ signal: request.controller.signal }),
      activeProfileKey === "live" &&
        api.getCanonicalInvoiceHistoryMetadata
        ? api.getCanonicalInvoiceHistoryMetadata({
            signal: request.controller.signal
          })
        : Promise.resolve(null)
      ]);

    if (statusRequest !== request || request.controller.signal.aborted) return;
    request.finish();
    statusRequest = null;

    if (readinessResult.status === "fulfilled") {
      state.readinessPayload = readinessResult.value;
      state.readiness = readinessVerdict(readinessResult.value) === "Ready" ? "ready" : "not-ready";
    } else {
      state.readinessPayload = null;
      state.readiness = readinessResult.reason?.status === 503 ? "not-ready" : "unavailable";
    }

    if (snapshotResult.status === "fulfilled") {
      state.snapshotPayload = snapshotResult.value;
      state.snapshot = snapshotIsReady(snapshotResult.value) ? "ready" : "not-ready";
    } else {
      state.snapshotPayload = null;
      state.snapshot = "unavailable";
    }
    state.invoiceHistoryAvailable =
      activeProfileKey === "live" &&
      invoiceHistoryResult.status === "fulfilled" &&
      Number(invoiceHistoryResult.value?.customerInvoiceLineCount) > 0;

    const freshness = snapshotFreshness();
    if (state.readiness === "ready" && state.snapshot === "ready" && activeProfileKey === "live" && freshness === "Stale") {
      state.statusMessage = "Warning: this Live Source Snapshot is stale. It remains read-only and is not real-time.";
    } else if (state.readiness === "ready" && state.snapshot === "ready") {
      state.statusMessage = activeProfileKey === "live"
        ? "Ready. Entity requests use only the qualified Live Source Snapshot; this is not real-time data."
        : "Ready. Entity requests use the qualified historical canonical snapshot only.";
    } else if (state.readiness === "not-ready") {
      state.statusMessage = activeProfileKey === "live"
        ? "The LIVE canonical platform is Not Ready. Entity requests are disabled; no historical fallback is available."
        : "The canonical platform is Not Ready. Entity requests are disabled; no fallback source is available.";
    } else {
      state.statusMessage = activeProfileKey === "live"
        ? "The LIVE API is unavailable. Entity requests are disabled; no historical fallback is available."
        : "The canonical API is unavailable. Entity requests are disabled; no fallback source is available.";
    }
    renderProfile();
    renderStatus();
    renderEntity();

    if (options.loadDefaultEntity && state.readiness === "ready" && currentEntityState().status === "idle") {
      await loadEntity(state.activeEntity);
    }
    if (activeProfileKey === "live") await loadRefreshStatus();
  }

  async function loadRefreshStatus() {
    if (activeProfileKey !== "live" || !currentApi()?.getSnapshotRefreshStatus) return;
    try {
      const payload = await currentApi().getSnapshotRefreshStatus();
      state.refresh = {
        ...state.refresh,
        ...payload,
        authorized: payload?.authorized === true,
        available: true,
        running: payload?.running === true || payload?.status === "RUNNING"
      };
    } catch (error) {
      state.refresh = {
        ...state.refresh,
        authorized: false,
        available: false,
        running: false,
        status: error?.status === 401 || error?.status === 403 ? "DENIED" : "UNAVAILABLE",
        message: error?.status === 401 || error?.status === 403
          ? "The current Windows user is not authorized to run ERP snapshot refresh."
          : "The governed refresh control is unavailable."
      };
    }
    renderRefreshControl();
    if (state.refresh.running) scheduleRefreshStatusPoll();
  }

  async function runErpSnapshotRefresh() {
    if (activeProfileKey !== "live" || state.refresh.running || !state.refresh.authorized) return;
    const confirmed = window.confirm(
      "This will read the qualified ERP source files and create a new Live Snapshot. " +
      "The current snapshot will remain active unless the refresh completes successfully."
    );
    if (!confirmed) return;

    state.refresh.running = true;
    state.refresh.status = "RUNNING";
    state.refresh.phase = "STARTING";
    state.refresh.message =
      "The governed refresh runner is starting. The current viewer data will not reload automatically.";
    renderRefreshControl();
    try {
      const payload = await currentApi().runSnapshotRefresh();
      state.refresh = {
        ...state.refresh,
        ...payload,
        authorized: true,
        available: true,
        running: payload?.running !== false
      };
      scheduleRefreshStatusPoll();
    } catch (error) {
      state.refresh.running = false;
      state.refresh.status = error?.status === 409 ? "ALREADY_RUNNING" : "FAILED";
      state.refresh.message = error?.status === 409
        ? "A governed ERP snapshot refresh is already running."
        : safeErrorMessage(error, "refresh");
      renderRefreshControl();
    }
  }

  function scheduleRefreshStatusPoll() {
    if (refreshStatusTimer) window.clearTimeout(refreshStatusTimer);
    refreshStatusTimer = window.setTimeout(async () => {
      refreshStatusTimer = null;
      if (!active || activeProfileKey !== "live") return;
      await loadRefreshStatus();
    }, 1500);
  }

  async function loadEntity(entityKey) {
    if (!active || state.readiness !== "ready") {
      const entityState = state.entities[entityKey];
      entityState.status = "blocked";
      entityState.message = "Entity requests require API readiness. No fallback source is available.";
      renderEntity();
      return;
    }

    const definition = ENTITIES[entityKey];
    const entityState = state.entities[entityKey];
    abortEntityRequest(entityState);
    const request = createTimedRequest();
    const sequence = ++entityState.requestSequence;
    entityState.request = request;
    entityState.status = "loading";
    entityState.message = "Loading " + definition.title + " from the canonical API.";
    renderEntity();

    const options = {
      page: entityState.page,
      pageSize: entityState.pageSize,
      signal: request.controller.signal
    };
    definition.filters.forEach(filter => {
      const value = entityState.filters[filter.name];
      if (value !== undefined && value !== "") options[filter.name] = value;
    });

    try {
      const result = await currentApi()[definition.listMethod](options);
      if (!active || entityState.request !== request || sequence !== entityState.requestSequence) return;
      entityState.items = Array.isArray(result?.items) ? result.items : [];
      entityState.page = Number(result?.page) || entityState.page;
      entityState.pageSize = Number(result?.pageSize) || entityState.pageSize;
      entityState.totalItems = Number(result?.totalItems) || 0;
      entityState.totalPages = Number(result?.totalPages) || 0;
      entityState.hasPreviousPage = Boolean(result?.hasPreviousPage);
      entityState.hasNextPage = Boolean(result?.hasNextPage);
      entityState.status = entityState.items.length ? "ready" : "empty";
      entityState.message = entityState.items.length
        ? "Showing " + entityState.items.length.toLocaleString() + " of " + entityState.totalItems.toLocaleString() + " canonical records."
        : "No canonical records matched the current filters.";
    } catch (error) {
      if (entityState.request !== request || sequence !== entityState.requestSequence) return;
      if (error?.name === "AbortError") {
        entityState.status = "cancelled";
        entityState.message = request.timedOut
          ? "The canonical request timed out. Refine the query and try again."
          : "The canonical request was cancelled.";
      } else {
        entityState.status = "error";
        entityState.message = safeErrorMessage(error, "list");
      }
    } finally {
      request.finish();
      if (entityState.request === request) entityState.request = null;
      if (active && state.activeEntity === entityKey) renderEntity();
    }
  }

  async function openDetail(identifier) {
    if (state.readiness !== "ready") return;
    const definition = currentDefinition();
    const entityState = currentEntityState();
    const detail = query("[data-canonical-detail]");
    const detailStatus = query("[data-canonical-detail-status]");
    const detailList = query("[data-canonical-detail-list]");
    const detailTitle = query("[data-canonical-detail-title]");

    detail.hidden = false;
    detail.setAttribute("aria-hidden", "false");
    detailTitle.textContent = definition.singular + " · " + identifier;
    detailStatus.textContent = "Loading exact canonical record.";
    detailList.replaceChildren();
    query('[data-canonical-action="close-detail"]').focus();

    abortEntityRequest(entityState);
    const request = createTimedRequest();
    const sequence = ++entityState.requestSequence;
    entityState.request = request;

    try {
      const record = await currentApi()[definition.lookupMethod](identifier, {
        signal: request.controller.signal
      });
      if (!active || entityState.request !== request || sequence !== entityState.requestSequence) return;
      entityState.selectedRecord = record;
      detailTitle.textContent = definition.singular + " · " + String(record?.[definition.identifier] ?? identifier);
      detailStatus.textContent = "Every approved canonical member is shown below. Values are read-only.";
      renderDetailFields(definition, record);
    } catch (error) {
      if (entityState.request !== request || sequence !== entityState.requestSequence) return;
      detailStatus.textContent = error?.name === "AbortError" && request.timedOut
        ? "The exact-record request timed out."
        : safeErrorMessage(error, "lookup");
    } finally {
      request.finish();
      if (entityState.request === request) entityState.request = null;
    }
  }

  function renderDetailFields(definition, record) {
    const list = query("[data-canonical-detail-list]");
    const fragment = document.createDocumentFragment();
    definition.fields.forEach(field => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = field.label;
      if (field.rawDate || field.decimalText) {
        const note = document.createElement("small");
        note.textContent = field.rawDate
          ? "Encoded source value retained for traceability"
          : "Exact unscaled text · preserved source value";
        term.appendChild(note);
      }
      setCanonicalText(value, field.isoDate
        ? formatCanonicalIsoDate(record?.[field.name])
        : record?.[field.name]);
      row.append(term, value);
      fragment.appendChild(row);
    });
    list.replaceChildren(fragment);
  }

  function closeDetail(options = {}) {
    const detail = query("[data-canonical-detail]");
    if (!detail || detail.hidden) return;
    abortEntityRequest(currentEntityState());
    detail.hidden = true;
    detail.setAttribute("aria-hidden", "true");
    if (options.restoreFocus !== false) lastFocusedRow?.focus?.();
  }

  function selectEntity(entityKey, options = {}) {
    if (!ENTITIES[entityKey]) return;
    cancelDebouncedWorkOrderSearch();
    closeDetail({ restoreFocus: false });
    state.activeEntity = entityKey;
    renderEntity();
    const tab = query('[data-canonical-tab="' + entityKey + '"]');
    if (options.focusTab) tab?.focus();
    if (state.readiness === "ready" && state.entities[entityKey].status === "idle") {
      loadEntity(entityKey);
    }
  }

  function clearFilters() {
    cancelDebouncedWorkOrderSearch();
    const entityState = currentEntityState();
    entityState.filters = {};
    entityState.page = 1;
    renderFilters();
    loadEntity(state.activeEntity);
  }

  function changePage(direction) {
    cancelDebouncedWorkOrderSearch();
    setPageValidation("");
    const entityState = currentEntityState();
    const targetPage = entityState.page + direction;
    if (targetPage < 1 || (entityState.totalPages && targetPage > entityState.totalPages)) return;
    entityState.page = targetPage;
    loadEntity(state.activeEntity);
  }

  function goToPage(rawValue = query("[data-canonical-page-input]").value) {
    cancelDebouncedWorkOrderSearch();
    const entityState = currentEntityState();
    const pageInput = query("[data-canonical-page-input]");
    const targetPage = resolvePageTarget(rawValue, entityState.totalPages);

    if (targetPage === null) {
      pageInput.value = String(entityState.page);
      pageInput.focus();
      setPageValidation(
        "Enter a whole page number between 1 and " + Math.max(1, entityState.totalPages) + "."
      );
      return;
    }

    const requestedPage = Number(String(rawValue).trim());
    pageInput.value = String(targetPage);
    setPageValidation(
      targetPage === requestedPage
        ? ""
        : "Page " + requestedPage + " is outside the available range. Using page " + targetPage + "."
    );
    if (targetPage === entityState.page) return;

    entityState.page = targetPage;
    loadEntity(state.activeEntity);
  }

  function resolvePageTarget(rawValue, totalPages) {
    const text = String(rawValue ?? "").trim();
    if (text === "") return null;
    const requestedPage = Number(text);
    if (!Number.isInteger(requestedPage)) return null;
    return Math.min(Math.max(1, totalPages || 1), Math.max(1, requestedPage));
  }

  function setPageValidation(message) {
    const validation = query("[data-canonical-page-validation]");
    if (validation) validation.textContent = message;
  }

  function renderAll() {
    if (!mounted) return;
    renderStatus();
    renderRefreshControl();
    renderEntity();
  }

  function renderProfile() {
    if (!mounted) return;
    const profile = currentProfile();
    const root = query(".canonical-viewer");
    root.dataset.canonicalActiveProfile = activeProfileKey;
    root.dataset.canonicalFreshness = "";
    queryAll("[data-canonical-profile]").forEach(button => {
      const selected = button.dataset.canonicalProfile === activeProfileKey;
      if (selected) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    query("[data-canonical-viewer-title]").textContent = profile.title;
    query("[data-canonical-viewer-description]").textContent = profile.description;
    query("[data-canonical-banner-title]").textContent = profile.bannerTitle;
    query("[data-canonical-banner-kind]").textContent = profile.bannerKind;
    query("[data-canonical-banner-environment]").textContent = "Data environment: " + profile.environment;
    query("[data-canonical-banner-database]").textContent = activeProfileKey === "live"
      ? "Database: " + profile.database
      : "Source: " + profile.database + " · Database: " + profile.database;
    query("[data-canonical-banner-contract]").textContent = "Contract: V1.2";
    query("[data-canonical-banner-note]").textContent = profile.bannerNote;
    query("[data-canonical-banner]").setAttribute(
      "aria-label",
      activeProfileKey === "live" ? "Live Source Snapshot read-only warning" : "Historical test-data warning"
    );
    query("[data-canonical-detail-banner-title]").textContent = profile.bannerTitle;
    query("[data-canonical-detail-banner-environment]").textContent = "Data environment: " + profile.environment;
    query("[data-canonical-detail-banner-database]").textContent = "Database: " + profile.database;
    query("[data-canonical-detail-banner-note]").textContent = profile.bannerKind;
    query("[data-canonical-detail-banner]").setAttribute(
      "aria-label",
      activeProfileKey === "live"
        ? "Live Source Snapshot read-only warning in record detail"
        : "Historical test-data warning in record detail"
    );
    queryAll('[data-canonical-tab="salesOrders"]').forEach(tab => {
      tab.hidden = activeProfileKey !== "live";
    });
    queryAll('[data-canonical-tab="invoiceHistory"]').forEach(tab => {
      tab.hidden =
        activeProfileKey !== "live" || !state.invoiceHistoryAvailable;
    });
    renderRefreshControl();
  }

  function renderRefreshControl() {
    if (!mounted) return;
    const isLive = activeProfileKey === "live";
    const control = query("[data-canonical-refresh-control]");
    const button = query('[data-canonical-action="run-erp-refresh"]');
    if (!control || !button) return;
    control.hidden = !isLive;
    button.hidden = !isLive || !state.refresh.authorized;
    button.disabled = state.refresh.running || !state.refresh.available;
    query("[data-canonical-refresh-message]").textContent =
      state.refresh.message || refreshResultMessage(state.refresh);
    query("[data-canonical-refresh-status]").textContent =
      refreshStatusLabel(state.refresh.status);
    query("[data-canonical-refresh-phase]").textContent =
      state.refresh.phase || NULL_MARKER;
    query("[data-canonical-refresh-last-check]").textContent =
      state.refresh.lastSourceCheckUtc || NULL_MARKER;
    query("[data-canonical-refresh-last-success]").textContent =
      state.refresh.lastSuccessfulRefreshUtc || NULL_MARKER;
    query("[data-canonical-refresh-import-run-id]").textContent =
      state.refresh.activeImportRunId || NULL_MARKER;
    query("[data-canonical-refresh-last-result]").textContent =
      state.refresh.lastResult || NULL_MARKER;
  }

  function refreshStatusLabel(value) {
    const labels = {
      READY: "Ready",
      RUNNING: "Running",
      SUCCESS: "Completed",
      NO_SOURCE_CHANGES: "No Source Changes",
      ALREADY_RUNNING: "Already Running",
      FAILED: "Failed",
      DENIED: "Not Authorized",
      UNAVAILABLE: "Unavailable",
      CHECKING: "Checking"
    };
    return labels[String(value || "").toUpperCase()] || value || "Ready";
  }

  function refreshResultMessage(refresh) {
    if (refresh.lastFailureReason) return refresh.lastFailureReason;
    if (refresh.status === "SUCCESS") {
      return "A qualified snapshot was promoted. Select Refresh View when you are ready to load it.";
    }
    if (refresh.status === "NO_SOURCE_CHANGES") {
      return "The qualified ERP source indicators have not changed. The active snapshot was retained.";
    }
    return "Ready to run the governed read-only ERP snapshot process.";
  }

  function renderStatus() {
    if (!mounted) return;
    const ready = state.readiness === "ready" && state.snapshot === "ready";
    const profile = currentProfile();
    const metadata = state.snapshotPayload || state.readinessPayload || {};
    const freshness = snapshotFreshness();
    const snapshotTimestamp = metadata.snapshotTimestampUtc ?? metadata.importedAtUtc;
    const snapshotAge = activeProfileKey === "live"
      ? formatSnapshotAge(metadata.snapshotAgeSeconds)
      : "Historical test fixture";
    const statusState = freshness === "Stale" ? "error" : ready ? "ready" : "";

    query(".canonical-viewer").dataset.canonicalFreshness = String(freshness || "").toLowerCase();
    setStatusText("readiness", statusLabel(state.readiness), state.readiness === "ready" ? "ready" : state.readiness === "checking" ? "" : "error");
    setStatusText("snapshot", statusLabel(state.snapshot), state.snapshot === "ready" ? "ready" : state.snapshot === "checking" ? "" : "error");
    setStatusText("environment", metadata.dataEnvironment ?? profile.environment, ready ? "ready" : "");
    setStatusText("database", metadata.database ?? profile.database, ready ? "ready" : "");
    setStatusText("contract", metadata.contractVersion ?? NULL_MARKER, ready ? "ready" : "");
    setStatusText("total", formatCount(metadata.totalCount), ready ? "ready" : "");
    setStatusText("snapshot-at", snapshotTimestamp ?? NULL_MARKER, ready ? "ready" : "");
    setStatusText("snapshot-age", snapshotAge, statusState);
    setStatusText("freshness", freshness, statusState);

    const platformState = query("[data-canonical-platform-state]");
    platformState.dataset.state = ready && freshness !== "Stale"
      ? "ready"
      : state.readiness === "checking" ? "checking" : "error";
    query("[data-canonical-platform-message]").textContent = state.statusMessage;
    query('[data-canonical-action="retry-status"]').hidden = state.readiness === "checking" || ready;

    const counts = metadata.entityCounts || {};
    ["billOfMaterial", "inventoryItem", "workOrder", "generalLedgerAccount"].forEach(name => {
      query('[data-canonical-count="' + name + '"]').textContent = formatCount(counts[name]);
    });
    const packageHash = metadata.packageHash;
    const hashTarget = query("[data-canonical-package-hash]");
    hashTarget.textContent = packageHash || NULL_MARKER;
    hashTarget.title = packageHash ? String(packageHash) : "";
    query("[data-canonical-mirror-run-id]").textContent = metadata.mirrorRunId ?? NULL_MARKER;
    query("[data-canonical-import-run-id]").textContent =
      metadata.currentImportRunId ?? metadata.importRunId ?? NULL_MARKER;
  }

  function renderEntity() {
    if (!mounted) return;
    const definition = currentDefinition();
    const entityState = currentEntityState();
    const queryEnabled = state.readiness === "ready";

    queryAll("[data-canonical-tab]").forEach(tab => {
      const selected = tab.dataset.canonicalTab === state.activeEntity;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    const panel = query("#canonicalEntityPanel");
    panel.setAttribute("aria-labelledby", query('[data-canonical-tab="' + state.activeEntity + '"]').id);

    query("[data-canonical-entity-title]").textContent = definition.title;
    renderFilters();
    query("[data-canonical-page-size]").value = String(entityState.pageSize);
    query("[data-canonical-page-size]").disabled = !queryEnabled || entityState.status === "loading";
    query("[data-canonical-result-summary]").textContent = entityState.message;
    query("[data-canonical-page-label]").textContent = "Page " + entityState.page + (entityState.totalPages ? " of " + entityState.totalPages : "");

    const previous = query('[data-canonical-action="previous-page"]');
    const pageInput = query("[data-canonical-page-input]");
    const pageGo = query('[data-canonical-action="go-to-page"]');
    const next = query('[data-canonical-action="next-page"]');
    pageInput.value = String(entityState.page);
    pageInput.min = "1";
    pageInput.max = String(Math.max(1, entityState.totalPages));
    pageInput.disabled = !queryEnabled || entityState.status === "loading" || entityState.totalPages < 1;
    pageGo.disabled = pageInput.disabled;
    previous.disabled = !queryEnabled || entityState.status === "loading" || !entityState.hasPreviousPage;
    next.disabled = !queryEnabled || entityState.status === "loading" || !entityState.hasNextPage;
    renderTable(definition, entityState);
  }

  function renderFilters() {
    const definition = currentDefinition();
    const entityState = currentEntityState();
    const container = query("[data-canonical-filter-fields]");
    const activeInput = document.activeElement?.closest?.("[data-canonical-filter-fields] input");
    const activeInputName = activeInput?.name || "";
    const activeSelectionStart = activeInput?.selectionStart;
    const activeSelectionEnd = activeInput?.selectionEnd;
    const fragment = document.createDocumentFragment();
    definition.filters.forEach(filter => {
      const label = document.createElement("label");
      const labelText = document.createElement("span");
      const input = filter.options
        ? document.createElement("select")
        : document.createElement("input");
      labelText.textContent = filter.label;
      if (!filter.options) input.type = "text";
      input.name = filter.name;
      if (filter.options) {
        filter.options.forEach(optionDefinition => {
          const option = document.createElement("option");
          option.value = optionDefinition.value;
          option.textContent = optionDefinition.label;
          input.appendChild(option);
        });
      }
      input.value = entityState.filters[filter.name] ?? "";
      input.autocomplete = "off";
      input.disabled = state.readiness !== "ready";
      if (filter.placeholder) input.placeholder = filter.placeholder;
      if (filter.liveSearch) input.dataset.canonicalLiveSearch = "true";
      label.append(labelText, input);
      fragment.appendChild(label);
    });
    container.replaceChildren(fragment);
    if (activeInputName) {
      const replacement = Array.from(container.querySelectorAll("input"))
        .find(input => input.name === activeInputName);
      if (replacement && !replacement.disabled) {
        replacement.focus();
        if (Number.isInteger(activeSelectionStart) && Number.isInteger(activeSelectionEnd)) {
          replacement.setSelectionRange(activeSelectionStart, activeSelectionEnd);
        }
      }
    }
    queryAll("[data-canonical-filters] button").forEach(button => {
      button.disabled = state.readiness !== "ready" || entityState.status === "loading";
    });
  }

  function renderTable(definition, entityState) {
    const head = query("[data-canonical-table-head]");
    const body = query("[data-canonical-table-body]");
    const headerRow = document.createElement("tr");
    definition.columns.forEach(column => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = column.label;
      headerRow.appendChild(cell);
    });
    head.replaceChildren(headerRow);

    const fragment = document.createDocumentFragment();
    entityState.items.forEach(record => {
      const row = document.createElement("tr");
      const identifier = record?.[definition.identifier];
      row.tabIndex = 0;
      row.dataset.canonicalRow = "";
      row.dataset.canonicalIdentifier = identifier == null ? "" : String(identifier);
      row.setAttribute("aria-label", "Open read-only " + definition.singular + " detail");
      definition.columns.forEach(column => {
        const cell = document.createElement("td");
        setCanonicalText(cell, column.isoDate
          ? formatCanonicalIsoDate(record?.[column.name])
          : record?.[column.name]);
        row.appendChild(cell);
      });
      fragment.appendChild(row);
    });
    body.replaceChildren(fragment);

    const resultState = query("[data-canonical-result-state]");
    const showState = entityState.status !== "ready";
    resultState.hidden = !showState;
    resultState.querySelector("p").textContent = entityState.message;
    body.hidden = showState;
  }

  function setCanonicalText(target, value) {
    target.classList.remove("canonical-viewer__null");
    if (value === null || value === undefined) {
      target.textContent = NULL_MARKER;
      target.classList.add("canonical-viewer__null");
      target.title = "Null canonical value";
      return;
    }
    target.textContent = String(value);
    target.title = "";
  }

  function formatCanonicalIsoDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (!match) return String(value);
    return Number(match[2]) + "/" + Number(match[3]) + "/" + match[1];
  }

  function setStatusText(name, value, status) {
    const target = query('[data-canonical-status="' + name + '"]');
    target.textContent = value;
    target.dataset.state = status;
  }

  function statusLabel(status) {
    return ({
      checking: "Checking",
      ready: "Ready",
      "not-ready": "Not Ready",
      unavailable: "Unavailable"
    })[status] || "Unavailable";
  }

  function formatCount(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : NULL_MARKER;
  }

  function safeErrorMessage(error, context) {
    if (error?.status === 400) return "The canonical query is invalid. Review the filter and pagination values.";
    if (error?.status === 404) return "The canonical record was not found in this snapshot.";
    if (error?.status === 409) return "The exact canonical identifier is ambiguous and cannot be opened safely.";
    if (error?.status === 503) return "The canonical database or snapshot is unavailable. No fallback source will be used.";
    if (error?.status >= 500) return "The canonical API could not complete the request.";
    return context === "lookup"
      ? "The exact canonical record could not be loaded."
      : "The canonical records could not be loaded. Check API readiness and retry.";
  }

  function createTimedRequest() {
    const controller = new AbortController();
    const request = {
      controller,
      timedOut: false,
      timeoutId: null,
      finish() {
        window.clearTimeout(request.timeoutId);
      }
    };
    request.timeoutId = window.setTimeout(() => {
      request.timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    return request;
  }

  function abortStatusRequest() {
    if (!statusRequest) return;
    statusRequest.finish();
    statusRequest.controller.abort();
    statusRequest = null;
  }

  function abortEntityRequest(entityState) {
    if (!entityState?.request) return;
    entityState.request.finish();
    entityState.request.controller.abort();
    entityState.request = null;
    if (entityState.status === "loading") {
      entityState.status = "cancelled";
      entityState.message = "The canonical request was cancelled.";
    }
  }

  function abortAllRequests() {
    abortStatusRequest();
    Object.values(viewerStates).forEach(viewerState => {
      Object.values(viewerState.entities).forEach(abortEntityRequest);
    });
  }

  function readFilters(form, definition) {
    const formData = new FormData(form);
    return Object.fromEntries(definition.filters.map(filter => [
      filter.name,
      String(formData.get(filter.name) ?? "")
    ]));
  }

  function cancelDebouncedWorkOrderSearch() {
    if (workOrderSearchTimer === null) return;
    window.clearTimeout(workOrderSearchTimer);
    workOrderSearchTimer = null;
  }

  function destroy() {
    cancelDebouncedWorkOrderSearch();
    abortAllRequests();
    unbindEvents();
    active = false;
    mounted = false;
    if (mount) {
      mount.replaceChildren();
      delete mount.dataset.workspaceLoaded;
    }
    mount = null;
  }

  function currentDefinition() {
    return ENTITIES[state.activeEntity];
  }

  function currentProfile() {
    return VIEWER_PROFILES[activeProfileKey];
  }

  function currentApi() {
    const sharedClient = window.DleApiClient;
    const apiProperty = currentProfile().apiProperty;
    return apiProperty ? sharedClient?.[apiProperty] : sharedClient;
  }

  function readinessVerdict(payload) {
    return payload?.readinessVerdict ?? payload?.status ?? "Unavailable";
  }

  function snapshotIsReady(payload) {
    return activeProfileKey === "live"
      ? Boolean(payload?.snapshotTimestampUtc) && payload?.readinessVerdict === "Ready"
      : payload?.importStatus === "SUCCESS";
  }

  function snapshotFreshness() {
    if (activeProfileKey !== "live") return "Historical";
    return state.snapshotPayload?.freshnessStatus
      ?? state.readinessPayload?.freshnessStatus
      ?? "Unavailable";
  }

  function formatSnapshotAge(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return NULL_MARKER;
    if (seconds < 60) return Math.floor(seconds) + " sec";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + " min";
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + " hr " + (minutes % 60) + " min";
    const days = Math.floor(hours / 24);
    return days + " d " + (hours % 24) + " hr";
  }

  function currentEntityState() {
    return state.entities[state.activeEntity];
  }

  function query(selector) {
    return mount?.querySelector(selector) || null;
  }

  function queryAll(selector) {
    return Array.from(mount?.querySelectorAll(selector) || []);
  }

  function getQualificationState() {
    return {
      activeProfile: activeProfileKey,
      activeEntity: state.activeEntity,
      readiness: state.readiness,
      snapshot: state.snapshot,
      entityStatuses: Object.fromEntries(Object.entries(state.entities).map(([key, value]) => [key, value.status])),
      approvedMemberCount: Object.values(ENTITIES)
        .filter(entity => !entity.liveOnly)
        .reduce((sum, entity) => sum + entity.fields.length, 0),
      salesOrderMemberCount: ENTITIES.salesOrders.fields.length,
      invoiceHistoryMemberCount: ENTITIES.invoiceHistory.fields.length,
      profiles: Object.keys(VIEWER_PROFILES)
    };
  }

  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({
    id: WORKSPACE_ID,
    render: renderWorkspace,
    destroy,
    getQualificationState
  });
})(window, document);

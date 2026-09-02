(function registerInvoiceHistoryWorkspace(window, document) {
  "use strict";
  const WORKSPACE_ID = "invoice-history";
  const TEMPLATE_PATH = "SRC/modules/invoice-history/invoice-history.html";
  const WORKING_YEAR = 2026;
  const PAGE_SIZE = 200;
  const SYNC_POLL_MS = 2000;
  let syncPollTimer = null;
  let syncStartedHere = false;
  let syncCompletionHandled = false;
  const state = { rows: [], filteredRows: [], loading: false, error: null, syncAvailable: null, committedRefresh: null, selectedMonth: defaultSelectedMonth(), monthRowCount: 0 };
  function api() { return window.DleApiClient?.liveCanonical; }

  async function loadWorkspace() {
    const mount = document.querySelector('[data-workspace-mount="invoice-history"]');
    if (!mount) return;
    if (mount.dataset.workspaceLoaded !== "true") {
      mount.innerHTML = '<div class="workspace-dashboard-card"><h3>Loading Invoice History</h3></div>';
      const response = await fetch(TEMPLATE_PATH);
      if (!response.ok) throw new Error("Unable to load Invoice History workspace.");
      mount.innerHTML = await response.text();
      mount.dataset.workspaceLoaded = "true";
      bindEvents();
    }
    await Promise.all([loadRows(), loadSyncStatus()]);
  }

  function bindEvents() {
    document.getElementById("invoiceHistorySearch")?.addEventListener("input", applySearch);
    document.getElementById("invoiceHistoryTable")?.addEventListener("click", event => {
      const control = event.target.closest?.("[data-invoice-history-row-toggle]");
      if (control) toggleMobileRow(control);
    });
    document.getElementById("invoiceHistoryAllYearFilter")?.addEventListener("click", () => selectMonth(null));
    document.getElementById("invoiceHistoryMonthlyTotals")?.addEventListener("click", event => {
      const control = event.target.closest?.("[data-invoice-history-month]");
      if (control) selectMonth(Number(control.dataset.invoiceHistoryMonth));
    });
    document.querySelector('[data-invoice-history-action="sync"]')?.addEventListener("click", startSync);
    document.querySelector('[data-invoice-history-action="reload"]')?.addEventListener("click", reloadWorkspace);
    document.querySelector('[data-invoice-history-action="view-projection"]')?.addEventListener("click", navigateToProjection);
  }

  function navigateToProjection() {
    return window.DleWorkspaceShell?.navigate?.({
      workspaceId:"operations-center",
      viewMode:"mobile",
      requestedState:{ mode:"projection" }
    }) || null;
  }

  async function fetchWorkingYearRows() {
    if (!api()?.getCanonicalInvoiceHistory) throw new Error("The canonical Invoice History API is unavailable.");
    const common = { pageSize: PAGE_SIZE, invoiceDateFrom: WORKING_YEAR + "-01-01", invoiceDateTo: WORKING_YEAR + "-12-31" };
    const first = await api().getCanonicalInvoiceHistory({ ...common, page: 1 });
    const rows = Array.isArray(first?.items) ? first.items.slice() : [];
    const totalPages = Math.max(1, Number(first?.totalPages || 1));
    for (let page = 2; page <= totalPages; page += 1) {
      const result = await api().getCanonicalInvoiceHistory({ ...common, page });
      if (Array.isArray(result?.items)) rows.push(...result.items);
    }
    return rows;
  }

  async function loadRows() {
    state.loading = true; state.error = null; renderTable();
    try { state.rows = await fetchWorkingYearRows(); state.filteredRows = state.rows.slice(); state.committedRefresh = findCommittedRefresh(state.rows); }
    catch (error) { state.error = error; state.rows = []; state.filteredRows = []; }
    finally { state.loading = false; renderSummary(); applySearch(); }
    return !state.error;
  }

  async function reloadWorkspace() {
    const button = document.getElementById("invoiceHistoryReloadButton");
    if (button) button.disabled = true;
    try { await loadRows(); await loadSyncStatus(); }
    finally { if (button) button.disabled = false; }
  }

  function rowSearchText(row) {
    return [row.customerNumber, row.customerName, row.salesOrderNumber, row.workOrderNumber,
      row.itemNumber, row.invoiceNumber, row.itemDescription]
      .map(value => String(value || "").toLowerCase()).join(" ");
  }
  function applySearch() {
    const query = String(document.getElementById("invoiceHistorySearch")?.value || "").trim().toLowerCase();
    const monthRows = filterRowsByMonth(state.rows, state.selectedMonth);
    state.monthRowCount = monthRows.length;
    state.filteredRows = query ? monthRows.filter(row => rowSearchText(row).includes(query)) : monthRows;
    renderTable();
  }

  function filterRowsByMonth(rows, month) {
    if (month === null) return rows.slice();
    return rows.filter(row => {
      const date = parseIsoDate(row.invoiceDate);
      return date?.getUTCFullYear() === WORKING_YEAR && date.getUTCMonth() === month;
    });
  }

  function selectMonth(month) {
    const normalized = month === null || month === "all" ? null : Number(month);
    if (normalized !== null && (!Number.isInteger(normalized) || normalized < 0 || normalized > 11)) return;
    state.selectedMonth = normalized;
    renderSummary();
    applySearch();
  }

  function summarizeRows(rows, now = new Date()) {
    const monthly = Array(12).fill(0);
    for (const row of rows) {
      const date = parseIsoDate(row.invoiceDate);
      if (date?.getUTCFullYear() === WORKING_YEAR) monthly[date.getUTCMonth()] += number(row.extendedPrice);
    }
    return { monthly, currentMonth: now.getFullYear() === WORKING_YEAR ? monthly[now.getMonth()] : 0, year: monthly.reduce((sum, value) => sum + value, 0) };
  }
  function renderSummary() {
    const summary = summarizeRows(state.rows);
    const selectedTotal = state.selectedMonth === null ? summary.year : summary.monthly[state.selectedMonth];
    setText("invoiceHistorySelectedPeriodLabel", state.selectedMonth === null ? "All " + WORKING_YEAR + " Invoiced" : monthLongName(state.selectedMonth) + " " + WORKING_YEAR + " Invoiced");
    setText("invoiceHistoryMonthTotal", money(selectedTotal));
    setText("invoiceHistoryYearTotal", money(summary.year));
    const allYear = document.getElementById("invoiceHistoryAllYearFilter");
    if (allYear) allYear.setAttribute("aria-pressed", state.selectedMonth === null ? "true" : "false");
    const host = document.getElementById("invoiceHistoryMonthlyTotals");
    if (host) host.innerHTML = summary.monthly.map((value, index) => '<button type="button" class="invoice-history-month-button" data-invoice-history-month="' + index + '" aria-pressed="' + (state.selectedMonth === index ? "true" : "false") + '" aria-label="Show ' + monthLongName(index) + ' ' + WORKING_YEAR + ' invoice lines"><b>' + monthName(index) + '</b><small>' + escapeHtml(money(value)) + '</small></button>').join("");
  }

  function renderTable() {
    const host = document.getElementById("invoiceHistoryTable");
    if (!host) return;
    host.setAttribute("aria-busy", state.loading ? "true" : "false");
    if (state.loading) host.innerHTML = '<div class="invoice-history-state">Loading authoritative canonical invoice rows…</div>';
    else if (state.error) host.innerHTML = '<div class="invoice-history-state error">Invoice History is unavailable. ' + escapeHtml(state.error.message || state.error) + '</div>';
    else if (!state.filteredRows.length) host.innerHTML = '<div class="invoice-history-state">No matching ' + escapeHtml(tablePeriodLabel()) + ' invoice lines.</div>';
    else host.innerHTML = '<table class="invoice-history-table"><thead><tr>' +
      ['Customer','Sales Order','SO Line','Work Order','Item / Assembly','Description','Quantity Shipped','Invoice Number','Invoiced Date','Extended Amount'].map(label => '<th scope="col">' + label + '</th>').join("") +
      '</tr></thead><tbody>' + state.filteredRows.map(renderRow).join("") + '</tbody></table>';
    const count = state.filteredRows.length;
    setText("invoiceHistoryTableTitle", tablePeriodLabel() + " Invoice History — " + count + " line" + (count === 1 ? "" : "s"));
    setText("invoiceHistoryStatus", state.error ? "Unable to load Invoice History." : count + " of " + state.monthRowCount + " line" + (state.monthRowCount === 1 ? "" : "s") + (count === state.monthRowCount ? " displayed" : " matching search"));
  }

  function tablePeriodLabel() { return state.selectedMonth === null ? "All " + WORKING_YEAR : monthLongName(state.selectedMonth) + " " + WORKING_YEAR; }
  function defaultSelectedMonth(now = new Date()) { return now.getFullYear() === WORKING_YEAR ? now.getMonth() : null; }
  function renderRow(row) {
    const customer = [row.customerNumber, row.customerName].filter(Boolean).join(" — ");
    return '<tr data-mobile-expanded="false">' + customerCell(row,customer) + cell(row.salesOrderNumber,"invoice-history-identifier","Sales Order") + cell(row.salesOrderLineNumber,"invoice-history-identifier","SO Line") +
      cell(row.workOrderNumber,"invoice-history-identifier","Work Order") + cell(row.itemNumber,"invoice-history-identifier","Item / Assembly") + cell(row.itemDescription,"invoice-history-description","Description") +
      cell(formatNumber(row.quantityShipped),"invoice-history-number","Quantity Shipped") + cell(row.invoiceNumber,"invoice-history-identifier","Invoice Number") + cell(formatDate(row.invoiceDate),"invoice-history-identifier","Invoiced Date") +
      cell(money(number(row.extendedPrice)),"invoice-history-number","Extended Amount") + '</tr>';
  }

  function customerCell(row,customer) {
    const invoice = row.invoiceNumber || "—";
    const date = formatDate(row.invoiceDate);
    const amount = money(number(row.extendedPrice));
    return '<td class="invoice-history-identifier invoice-history-customer" data-label="Customer"><span class="invoice-history-desktop-value">' + escapeHtml(customer || "—") + '</span>' +
      '<button type="button" class="invoice-history-mobile-row-toggle" data-invoice-history-row-toggle aria-expanded="false" aria-label="Expand invoice ' + escapeHtml(invoice) + ' for ' + escapeHtml(customer || "customer") + '">' +
      '<span class="invoice-history-mobile-row-copy"><b>' + escapeHtml(customer || "—") + '</b><small>Invoice ' + escapeHtml(invoice) + ' · ' + escapeHtml(date) + '</small></span>' +
      '<strong>' + escapeHtml(amount) + '</strong><span class="invoice-history-mobile-row-chevron" aria-hidden="true">⌄</span></button></td>';
  }

  function toggleMobileRow(control) {
    const row = control?.closest?.("tr");
    if (!row) return false;
    const expand = control.getAttribute("aria-expanded") !== "true";
    document.querySelectorAll?.("[data-invoice-history-row-toggle][aria-expanded=\"true\"]").forEach(openControl => {
      if (openControl === control) return;
      openControl.setAttribute("aria-expanded","false");
      const openRow = openControl.closest?.("tr");
      if (openRow?.dataset) openRow.dataset.mobileExpanded = "false";
    });
    control.setAttribute("aria-expanded",String(expand));
    if (row.dataset) row.dataset.mobileExpanded = String(expand);
    return expand;
  }

  async function loadSyncStatus() {
    if (!api()?.getInvoiceHistoryRefreshStatus) return renderManualSyncMode();
    try { renderSyncStatus(await api().getInvoiceHistoryRefreshStatus()); }
    catch (error) { isSyncServiceUnavailable(error) ? renderManualSyncMode() : renderSyncError(error); }
  }
  async function startSync() {
    const button = document.getElementById("invoiceHistorySyncButton");
    if (button) button.disabled = true;
    syncStartedHere = true; syncCompletionHandled = false;
    try { renderSyncStatus(await api().runInvoiceHistoryRefresh()); scheduleSyncPoll(); }
    catch (error) { syncStartedHere = false; isExecutionDisabled(error) ? renderExecutionDisabled(error) : isSyncServiceUnavailable(error) ? renderManualSyncMode() : renderSyncError(error); if (button && !isExecutionDisabled(error)) button.disabled = false; }
  }
  function scheduleSyncPoll() { clearTimeout(syncPollTimer); syncPollTimer = window.setTimeout(pollSync, SYNC_POLL_MS); }
  async function pollSync() {
    try {
      const payload = await api().getInvoiceHistoryRefreshStatus();
      renderSyncStatus(payload);
      const status = rawSyncValue(payload,"status").toUpperCase();
      if (["RUNNING","QUEUED","STARTING"].includes(status)) return scheduleSyncPoll();
      if (syncStartedHere && !syncCompletionHandled && ["SUCCEEDED","SUCCESS","SUCCESS_WITH_CLARIFICATIONS","NO_SOURCE_CHANGES"].includes(status)) {
        syncCompletionHandled = true;
        await loadRows();
      }
      syncStartedHere = false;
    } catch (error) { isSyncServiceUnavailable(error) ? renderManualSyncMode() : renderSyncError(error); syncStartedHere = false; }
  }
  function renderSyncStatus(payload) {
    state.syncAvailable = true;
    setManualSyncVisibility(false);
    const status = rawSyncValue(payload,"status").toUpperCase() || "READY";
    const running = ["RUNNING","QUEUED","STARTING"].includes(status);
    const success = ["SUCCEEDED","SUCCESS","SUCCESS_WITH_CLARIFICATIONS","NO_SOURCE_CHANGES"].includes(status);
    const node = document.getElementById("invoiceHistorySyncStatus");
    if (node) { node.className = "invoice-history-sync-status " + (running ? "running" : success ? "success" : status === "FAILED" ? "error" : ""); node.textContent = rawSyncValue(payload,"message") || (status === "FAILED" ? "Refresh failed. Previous committed Invoice History remains available." : status.replaceAll("_"," ")); }
    const button = document.getElementById("invoiceHistorySyncButton"); if (button) { button.hidden = false; button.disabled = running; }
    renderAttemptEvidence(payload, status);
    renderCommittedEvidence(payload, success);
  }

  function renderManualSyncMode() {
    state.syncAvailable = false;
    setManualSyncVisibility(true);
    const node = document.getElementById("invoiceHistorySyncStatus");
    if (node) { node.className = "invoice-history-sync-status"; node.textContent = "Refresh service temporarily unavailable; committed Invoice History remains available"; }
    setText("invoiceHistoryLastAttempt", "Last attempted refresh: unavailable while the governed refresh service is offline");
    setOptionalText("invoiceHistoryRefreshWindow", "");
    setOptionalText("invoiceHistoryRefreshChanges", "");
    renderCommittedEvidence(null, false);
  }

  function renderExecutionDisabled(error) {
    state.syncAvailable = true;
    setManualSyncVisibility(false);
    const node = document.getElementById("invoiceHistorySyncStatus");
    if (node) { node.className = "invoice-history-sync-status"; node.textContent = String(error?.message || "Invoice History refresh is available but execution is currently disabled."); }
    const button = document.getElementById("invoiceHistorySyncButton"); if (button) { button.hidden = false; button.disabled = true; }
    renderCommittedEvidence(null, false);
  }

  function renderSyncError(error) {
    state.syncAvailable = true;
    setManualSyncVisibility(false);
    const node = document.getElementById("invoiceHistorySyncStatus");
    if (node) { node.className = "invoice-history-sync-status error"; node.textContent = error?.status === 403 ? "Not authorized to sync Invoice History." : String(error?.message || error); }
    const button = document.getElementById("invoiceHistorySyncButton"); if (button) { button.hidden = false; button.disabled = error?.status === 403; }
  }

  function setManualSyncVisibility(manual) {
    const button = document.getElementById("invoiceHistorySyncButton"); if (button) button.hidden = manual;
    const details = document.getElementById("invoiceHistoryManualSync"); if (details) details.hidden = !manual;
  }

  function renderAttemptEvidence(payload, status) {
    const attempted = rawSyncValue(payload,"startedAtUtc") || rawSyncValue(payload,"updatedAtUtc") || rawSyncValue(payload,"completedAtUtc") || rawSyncValue(payload,"endedAtUtc");
    setText("invoiceHistoryLastAttempt", "Last attempted refresh: " + (attempted ? formatDateTime(attempted) + " — " + displayStatus(status) : "unavailable"));
    const windowStart = rawSyncValue(payload,"windowStart");
    const windowEnd = rawSyncValue(payload,"windowEnd");
    setOptionalText("invoiceHistoryRefreshWindow", windowStart || windowEnd ? "Refresh window: " + (windowStart || "?") + " through " + (windowEnd || "?") : "");
    const counts = nestedValue(payload,"details","import","expectedCounts") || nestedValue(payload,"details","Import","ExpectedCounts");
    const inserted = objectValue(counts,"lineInsert");
    const updated = objectValue(counts,"lineUpdate");
    const unchanged = objectValue(counts,"lineUnchanged");
    const missing = objectValue(counts,"lineMissing");
    const values = [["Inserted",inserted],["Updated",updated],["Unchanged",unchanged],["Missing / retained",missing]].filter(([,value]) => value !== undefined && value !== null && value !== "");
    setOptionalText("invoiceHistoryRefreshChanges", values.length ? values.map(([label,value]) => label + ": " + value).join(" · ") : "");
  }

  function renderCommittedEvidence(payload, payloadIsSuccess) {
    const evidence = state.committedRefresh;
    const completed = payloadIsSuccess && (rawSyncValue(payload,"completedAtUtc") || rawSyncValue(payload,"updatedAtUtc") || rawSyncValue(payload,"endedAtUtc"));
    const committedAt = completed || evidence?.activatedAtUtc;
    setText("invoiceHistoryLastSync", "Last successful committed refresh: " + (committedAt ? formatDateTime(committedAt) : "unavailable"));
    const importId = (payloadIsSuccess && (nestedValue(payload,"details","import","invoiceHistoryImportRunId") || nestedValue(payload,"details","Import","InvoiceHistoryImportRunId"))) || evidence?.invoiceHistoryImportRunId;
    const refreshId = (payloadIsSuccess && (rawSyncValue(payload,"refreshRunId") || nestedValue(payload,"details","import","invoiceHistoryRefreshRunId") || nestedValue(payload,"details","Import","InvoiceHistoryRefreshRunId"))) || evidence?.sourceExtractionRunId;
    const identities = [["Refresh",refreshId],["Import",importId]].filter(([,value]) => value);
    setOptionalText("invoiceHistoryRefreshIdentity", identities.length ? "Committed identity: " + identities.map(([label,value]) => label + " " + value).join(" · ") : "");
  }

  function findCommittedRefresh(rows) {
    return rows.reduce((latest, row) => {
      if (!row?.activatedAtUtc || (!row.invoiceHistoryImportRunId && !row.sourceExtractionRunId)) return latest;
      if (!latest || new Date(row.activatedAtUtc) > new Date(latest.activatedAtUtc)) return { activatedAtUtc:row.activatedAtUtc, invoiceHistoryImportRunId:row.invoiceHistoryImportRunId, sourceExtractionRunId:row.sourceExtractionRunId };
      return latest;
    }, null);
  }

  function isSyncServiceUnavailable(error) {
    const status = Number(error?.status || error?.statusCode || 0);
    return !status || [404,502,503,504].includes(status);
  }

  function isExecutionDisabled(error) { return error?.code === "INVOICE_HISTORY_EXECUTION_DISABLED"; }

  function displayStatus(status) {
    if (["SUCCEEDED","SUCCESS","SUCCESS_WITH_CLARIFICATIONS","NO_SOURCE_CHANGES"].includes(status)) return "Successful";
    if (["RUNNING","QUEUED","STARTING"].includes(status)) return "Running";
    if (status === "FAILED") return "Failed";
    return status.replaceAll("_"," ").toLowerCase().replace(/^./,value => value.toUpperCase());
  }
  function objectValue(value,key) { if (!value || typeof value !== "object") return undefined; const match = Object.keys(value).find(name => name.toLowerCase() === key.toLowerCase()); return match ? value[match] : undefined; }
  function nestedValue(value,...keys) { return keys.reduce((current,key) => objectValue(current,key),value); }
  function setOptionalText(id,value) { const node = document.getElementById(id); if (node) { node.textContent = value; node.hidden = !value; } }

  function rawSyncValue(value,key) { return String(value?.[key] ?? value?.[key.charAt(0).toUpperCase()+key.slice(1)] ?? ""); }
  function parseIsoDate(value) { const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||"")); return match ? new Date(Date.UTC(+match[1],+match[2]-1,+match[3])) : null; }
  function formatDate(value) { const date = parseIsoDate(value); return date ? date.toLocaleDateString(undefined,{timeZone:"UTC"}) : "—"; }
  function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(); }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function formatNumber(value) { return number(value).toLocaleString(undefined,{maximumFractionDigits:4}); }
  function money(value) { return number(value).toLocaleString("en-US",{style:"currency",currency:"USD"}); }
  function monthName(index) { return new Date(Date.UTC(WORKING_YEAR,index,1)).toLocaleString("en-US",{month:"short",timeZone:"UTC"}); }
  function monthLongName(index) { return new Date(Date.UTC(WORKING_YEAR,index,1)).toLocaleString("en-US",{month:"long",timeZone:"UTC"}); }
  function setText(id,value) { const node = document.getElementById(id); if (node) node.textContent = value; }
  function cell(value,className,label) { return '<td class="'+className+'" data-label="'+escapeHtml(label)+'">'+escapeHtml(value||"—")+'</td>'; }
  function escapeHtml(value) { return String(value??"").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]); }

  window.InvoiceHistoryWorkspace = Object.freeze({ load:loadWorkspace, reload:reloadWorkspace, applySearch, selectMonth, state, test:Object.freeze({ rowSearchText, filterRowsByMonth, summarizeRows, defaultSelectedMonth, toggleMobileRow, navigateToProjection, pollSync, startSync, loadSyncStatus, renderSyncStatus, renderManualSyncMode, findCommittedRefresh }) });
  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({ render:loadWorkspace });
})(window,document);

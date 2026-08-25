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
  const state = { rows: [], filteredRows: [], loading: false, error: null };
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
    document.querySelector('[data-invoice-history-action="sync"]')?.addEventListener("click", startSync);
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
    try { state.rows = await fetchWorkingYearRows(); state.filteredRows = state.rows.slice(); }
    catch (error) { state.error = error; state.rows = []; state.filteredRows = []; }
    finally { state.loading = false; renderSummary(); applySearch(); }
    return !state.error;
  }

  function rowSearchText(row) {
    return [row.customerNumber, row.customerName, row.salesOrderNumber, row.workOrderNumber,
      row.itemNumber, row.invoiceNumber, row.itemDescription]
      .map(value => String(value || "").toLowerCase()).join(" ");
  }
  function applySearch() {
    const query = String(document.getElementById("invoiceHistorySearch")?.value || "").trim().toLowerCase();
    state.filteredRows = query ? state.rows.filter(row => rowSearchText(row).includes(query)) : state.rows.slice();
    renderTable();
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
    setText("invoiceHistoryMonthTotal", money(summary.currentMonth));
    setText("invoiceHistoryYearTotal", money(summary.year));
    const host = document.getElementById("invoiceHistoryMonthlyTotals");
    if (host) host.innerHTML = summary.monthly.map((value, index) => '<div><b>' + monthName(index) + '</b><small>' + escapeHtml(money(value)) + '</small></div>').join("");
  }

  function renderTable() {
    const host = document.getElementById("invoiceHistoryTable");
    if (!host) return;
    host.setAttribute("aria-busy", state.loading ? "true" : "false");
    if (state.loading) host.innerHTML = '<div class="invoice-history-state">Loading authoritative canonical invoice rows…</div>';
    else if (state.error) host.innerHTML = '<div class="invoice-history-state error">Invoice History is unavailable. ' + escapeHtml(state.error.message || state.error) + '</div>';
    else if (!state.filteredRows.length) host.innerHTML = '<div class="invoice-history-state">No matching 2026 invoice lines.</div>';
    else host.innerHTML = '<table class="invoice-history-table"><thead><tr>' +
      ['Customer','Sales Order','SO Line','Work Order','Item / Assembly','Description','Quantity Shipped','Invoice Number','Invoiced Date','Extended Amount'].map(label => '<th scope="col">' + label + '</th>').join("") +
      '</tr></thead><tbody>' + state.filteredRows.map(renderRow).join("") + '</tbody></table>';
    setText("invoiceHistoryStatus", state.error ? "Unable to load Invoice History." : state.filteredRows.length + " of " + state.rows.length + " line" + (state.rows.length === 1 ? "" : "s"));
  }
  function renderRow(row) {
    const customer = [row.customerNumber, row.customerName].filter(Boolean).join(" — ");
    return '<tr>' + cell(customer,"invoice-history-identifier") + cell(row.salesOrderNumber,"invoice-history-identifier") + cell(row.salesOrderLineNumber,"invoice-history-identifier") +
      cell(row.workOrderNumber,"invoice-history-identifier") + cell(row.itemNumber,"invoice-history-identifier") + cell(row.itemDescription,"invoice-history-description") +
      cell(formatNumber(row.quantityShipped),"invoice-history-number") + cell(row.invoiceNumber,"invoice-history-identifier") + cell(formatDate(row.invoiceDate),"invoice-history-identifier") +
      cell(money(number(row.extendedPrice)),"invoice-history-number") + '</tr>';
  }

  async function loadSyncStatus() {
    if (!api()?.getInvoiceHistoryRefreshStatus) return;
    try { renderSyncStatus(await api().getInvoiceHistoryRefreshStatus()); } catch (error) { renderSyncError(error); }
  }
  async function startSync() {
    const button = document.getElementById("invoiceHistorySyncButton");
    if (button) button.disabled = true;
    syncStartedHere = true; syncCompletionHandled = false;
    try { renderSyncStatus(await api().runInvoiceHistoryRefresh()); scheduleSyncPoll(); }
    catch (error) { syncStartedHere = false; renderSyncError(error); if (button) button.disabled = false; }
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
    } catch (error) { renderSyncError(error); syncStartedHere = false; }
  }
  function renderSyncStatus(payload) {
    const status = rawSyncValue(payload,"status").toUpperCase() || "READY";
    const running = ["RUNNING","QUEUED","STARTING"].includes(status);
    const success = ["SUCCEEDED","SUCCESS","SUCCESS_WITH_CLARIFICATIONS","NO_SOURCE_CHANGES"].includes(status);
    const node = document.getElementById("invoiceHistorySyncStatus");
    if (node) { node.className = "invoice-history-sync-status " + (running ? "running" : success ? "success" : status === "FAILED" ? "error" : ""); node.textContent = rawSyncValue(payload,"message") || status.replaceAll("_"," "); }
    const button = document.getElementById("invoiceHistorySyncButton"); if (button) button.disabled = running;
    if (success) { const completed = rawSyncValue(payload,"completedAtUtc") || rawSyncValue(payload,"updatedAtUtc") || rawSyncValue(payload,"endedAtUtc"); if (completed) setText("invoiceHistoryLastSync","Last successful sync: " + formatDateTime(completed)); }
  }
  function renderSyncError(error) { const node = document.getElementById("invoiceHistorySyncStatus"); if (node) { node.className = "invoice-history-sync-status error"; node.textContent = error?.status === 403 ? "Not authorized to sync Invoice History." : String(error?.message || error); } }

  function rawSyncValue(value,key) { return String(value?.[key] ?? value?.[key.charAt(0).toUpperCase()+key.slice(1)] ?? ""); }
  function parseIsoDate(value) { const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||"")); return match ? new Date(Date.UTC(+match[1],+match[2]-1,+match[3])) : null; }
  function formatDate(value) { const date = parseIsoDate(value); return date ? date.toLocaleDateString(undefined,{timeZone:"UTC"}) : "—"; }
  function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(); }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function formatNumber(value) { return number(value).toLocaleString(undefined,{maximumFractionDigits:4}); }
  function money(value) { return number(value).toLocaleString("en-US",{style:"currency",currency:"USD"}); }
  function monthName(index) { return new Date(Date.UTC(WORKING_YEAR,index,1)).toLocaleString("en-US",{month:"short",timeZone:"UTC"}); }
  function setText(id,value) { const node = document.getElementById(id); if (node) node.textContent = value; }
  function cell(value,className) { return '<td class="'+className+'">'+escapeHtml(value||"—")+'</td>'; }
  function escapeHtml(value) { return String(value??"").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]); }

  window.InvoiceHistoryWorkspace = Object.freeze({ load:loadWorkspace, reload:loadRows, applySearch, state, test:Object.freeze({ rowSearchText, summarizeRows, pollSync, startSync }) });
  window.DleWorkspaces = window.DleWorkspaces || {};
  window.DleWorkspaces[WORKSPACE_ID] = Object.freeze({ render:loadWorkspace });
})(window,document);

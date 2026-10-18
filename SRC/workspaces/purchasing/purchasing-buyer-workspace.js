(function registerSimPurchasing(window, document) {
  "use strict";

  const API = "/api/sim/purchasing";
  const stages = [["shortages", "Material Shortages"], ["sorting", "Sorting"], ["shop", "Shop List"], ["purchased", "Supply Tracking"]];
  const state = { mount: null, model: null, history: [], planning: null, stage: "shortages", search: "", busy: false, message: "", error: false, selected: null, dirty: false, copySelection: new Set() };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qty = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(value)) : "—";
  const date = value => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "")); return match ? `${match[2]}/${match[3]}/${match[1]}` : "Not Established"; };
  const money = (value, currency = "USD") => value === null || value === undefined || value === "" ? "Not Set" : `${currency} ${Number(value).toFixed(2)}`;
  const byId = id => state.model?.demands?.find(demand => demand.demandId === id);
  const canManage = () => state.model?.canManage === true;
  const disabled = () => state.busy || !canManage() ? " disabled" : "";
  const coverage = item => (item.coverage || []).map(link => ({ ...byId(link.demandId), ...link }));
  const planDemands = (model, plan) => (plan.coverage || []).map(link => ({ ...model.demands.find(d => d.demandId === link.demandId), ...link }));
  const demandText = demand => [demand.customerSupply?.customerPartNumber, demand.customerSupply ? "C/S Customer supplied" : "", demand.partNumber, demand.approvedPartNumber, demand.description, demand.workOrderNumber, demand.salesOrderNumber, demand.salesOrderLineNumber, demand.customer, demand.assemblyItemNumber, demand.revision].join(" ");

  const currentCustomerShortage = d => !!d?.customerSupply && d.sourceCurrent === true &&
    ["INCOMING", "ACCEPTED"].includes(d.state) && Number(d.remainingShortQuantity ?? d.shortQuantity) > 0;
  const currentAcknowledgment = d => currentCustomerShortage(d) && !!d.customerContact &&
    d.customerContact.submissionId === (d.currentSubmissionId || d.submissionId) &&
    d.customerContact.sourceFingerprint === d.sourceFingerprint &&
    Number(d.customerContact.shortQuantity) === Number(d.remainingShortQuantity ?? d.shortQuantity);
  const followupEnabled = () => state.model?.customerFollowupSupported === true;
  // Use the reviewed customer identity only: approved/manufacturer P/N is not a substitute.
  function emailPayload(rows) {
    const clean = value => String(value ?? "").replace(/[\r\n\t]+/g, " ").trim() || "Not recorded";
    const headers = ["Find No.", "Customer P/N", "Description", "Qty Short", "UOM"];
    const groups = new Map();
    for (const d of rows) {
      const po = d.customerPoNumber || d.customerSupply?.poNumber;
      const key = JSON.stringify([d.customerNumber, d.customer, po, d.salesOrderNumber, d.salesOrderLineNumber, d.workOrderNumber, d.assemblyItemNumber, d.revision]);
      if (!groups.has(key)) groups.set(key, { d, po, rows: [] });
      groups.get(key).rows.push(d);
    }
    const text = [], html = [];
    const cellStyle = "border:1px solid #808080;padding:6px 8px;vertical-align:top;text-align:left;";
    for (const { d, po, rows: groupRows } of groups.values()) {
      const context = `Customer: ${clean(d.customer)}; Customer PO: ${clean(po)}; Assembly: ${clean(d.assemblyItemNumber)} / Rev ${clean(d.revision)}`;
      const reference = `SO: ${clean(d.salesOrderNumber)} / ${clean(d.salesOrderLineNumber)}; WO: ${clean(d.workOrderNumber)}`;
      const cells = groupRows.map(row => [clean(row.customerSupply?.findNumber || row.findNumber),
        clean(row.customerSupply?.customerPartNumber), clean(row.description),
        qty(row.remainingShortQuantity ?? row.shortQuantity), clean(row.uom)]);
      text.push([context, reference, headers.join("\t"), ...cells.map(row => row.join("\t"))].join("\r\n"));
      // Semantic table and inline styles are retained by rich-text email paste. No external CSS or assets.
      html.push(`<p style="margin:0 0 4px;font-weight:bold;">${esc(context)}</p><p style="margin:0 0 8px;font-size:11px;color:#555555;">${esc(reference)}</p>` +
        `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #808080;font-family:Arial,sans-serif;font-size:12px;color:#000000;background-color:#ffffff;"><thead><tr>${headers.map(h => `<th scope="col" style="${cellStyle}background-color:#eeeeee;font-weight:bold;">${esc(h)}</th>`).join("")}</tr></thead><tbody>${cells.map(row => `<tr>${row.map((value, index) => `<td style="${cellStyle}${index === 3 ? "text-align:right;" : ""}">${esc(value)}</td>`).join("")}</tr>`).join("")}</tbody></table><p style="margin:0;height:12px;"></p>`);
    }
    return { text: text.join("\r\n\r\n"), html: `<div style="font-family:Arial,sans-serif;font-size:12px;color:#000000;background-color:#ffffff;">${html.join("")}</div>` };
  }
  function emailText(rows) { return emailPayload(rows).text; }
  function contactSummary(d) {
    const c = currentAcknowledgment(d) ? d.customerContact : null;
    return c ? `<div class="buyer-contact-summary"><strong>C/S - Emailed / Awaiting Customer Material</strong><small>Emailed by ${esc(c.actor)} at ${esc(c.atUtc)}</small>${c.expectedDate ? `<small>Expected ${date(c.expectedDate)}</small>` : ""}</div>` : "";
  }
  async function copyForEmail(ids) {
    if (!ids.length) return;
    try {
      // Refresh quantities and identities immediately before copying. This is a read-only action.
      const model = await request();
      const rows = ids.map(id => model.demands.find(d => d.demandId === id));
      if (!model.customerFollowupSupported || rows.some(d => !currentCustomerShortage(d))) throw new Error("A selected shortage changed. Refresh and review your selection before copying.");
      const payload = emailPayload(rows);
      try {
        if (!window.navigator.clipboard?.write || !window.ClipboardItem) throw new Error("Rich clipboard unavailable");
        await window.navigator.clipboard.write([new window.ClipboardItem({
          "text/html": new Blob([payload.html], { type: "text/html" }),
          "text/plain": new Blob([payload.text], { type: "text/plain" })
        })]);
        state.message = `Copied formatted table for ${rows.length} shortage(s). Contact has not been marked.`; state.error = false; showMessage();
      } catch (_) {
        let plainCopied = false;
        try { await window.navigator.clipboard.writeText(payload.text); plainCopied = true; } catch (_) { /* Manual selection remains available. */ }
        const dialog = state.mount.querySelector("#buyerCopyDialog");
        dialog.querySelector("#buyerCopyHelp").textContent = plainCopied
          ? "Tab-separated text copied. The formatted table was not copied automatically. For email, select the table below and copy it, or use the text for Excel."
          : "Clipboard access is unavailable. Select the table below and copy it for email, or select the tab-separated text for Excel. Contact has not been marked.";
        dialog.querySelector("#buyerCopyTable").innerHTML = payload.html;
        const field = dialog.querySelector("textarea"); field.value = payload.text;
        state.message = plainCopied ? "Copied tab-separated text only. Formatted table is available in the copy dialog; contact has not been marked." : "Automatic copy unavailable. Use the copy dialog; contact has not been marked.";
        state.error = false; showMessage(); dialog.showModal(); field.focus(); field.select(); dialog.scrollTop = 0;
      }
    } catch (error) { state.message = error.message; state.error = true; showMessage(); }
  }

  // Views project the same demand/plan records; moving stages never copies records.
  function buildViewModel(model, search = "") {
    const data = { demands: [], plans: [], purchases: [], ...model };
    const planned = new Map();
    data.plans.forEach(plan => (plan.coverage || []).forEach(link => planned.set(link.demandId, (planned.get(link.demandId) || 0) + Number(link.quantity || 0))));
    const unplanned = data.demands.filter(d => d.state === "ACCEPTED" && !d.customerSupply).map(d => ({ ...d, unplanned: true,
      uncoveredQuantity: Math.max(0, Math.min(Number(d.remainingShortQuantity ?? d.shortQuantity), Number(d.shortQuantity) - (planned.get(d.demandId) || 0))) })).filter(d => d.uncoveredQuantity > 0);
    const all = {
      shortages: data.demands.filter(d => (d.state === "INCOMING" || (d.customerSupply && d.state === "ACCEPTED")) && !currentAcknowledgment(d)),
      sorting: [...unplanned, ...data.plans.filter(p => p.state === "DRAFT")],
      shop: data.plans.filter(p => p.state === "READY_FOR_PO"),
      purchased: [...data.purchases, ...data.demands.filter(currentAcknowledgment).map(d => ({ ...d, customerFollowup: true }))]
    };
    const needle = String(search || "").trim().toLowerCase();
    const counts = Object.fromEntries(stages.map(([key]) => [key, all[key].length]));
    const matches = item => !needle || [demandText(item), item.customerFollowup ? "C/S Emailed Awaiting Customer Material" : (item.purchaseId || item.poLineId) ? purchaseStatus(item) : "", item.customerContact?.actor, item.customerContact?.expectedDate, item.customerPoNumber, item.supplier, item.vendorPartNumber, item.poNumber, item.poLine, item.state, item.status, ...planDemands(data, item).map(demandText)].join(" ").toLowerCase().includes(needle);
    return { counts, ...Object.fromEntries(stages.map(([key]) => [key, all[key].filter(matches)])) };
  }

  async function request(path = "", options = {}) {
    const response = await window.fetch(API + path, { credentials: "same-origin", cache: "no-store", ...options });
    const contentType = response.headers?.get?.("content-type") || "";
    if (contentType && !contentType.includes("json")) throw new Error("Purchasing session is unavailable. Unlock SIM and refresh.");
    const body = await response.json();
    if (!response.ok) {
      const message = body.message || body.error || `Purchasing request failed (${response.status}).`;
      const error = new Error(typeof message === "string" ? message : JSON.stringify(message));
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function render(mount) {
    state.mount = mount;
    if (!mount) return;
    if (!state.dirty) await refresh(); else draw();
  }
  async function refresh() {
    if (state.busy) return state.model;
    state.busy = true;
    state.message = "Loading buyer workflow…";
    draw();
    try { [state.model, state.history] = await Promise.all([request(), request("/history")]); await loadPlanning(); state.message = "Purchasing current"; state.error = false; }
    catch (error) { state.message = error.message; state.error = true; }
    finally { state.busy = false; draw(); }
    return state.model;
  }
  async function loadPlanning() {
    try { state.planning = await window.MaterialStatus?.getSupplyProgress(); }
    catch (_) { state.planning = null; }
  }
  function planningFor(item) {
    const ids = item.demandId ? [item.demandId] : (item.coverage || []).map(c => c.demandId);
    return (state.planning?.workOrders || []).flatMap(w => w.demands || []).filter(d => ids.includes(d.demandId));
  }
  function purchaseStatus(p) {
    if (Number(p.receivedQuantity) > 0) return Number(p.openQuantity) === 0 ? "Received / Complete" : "Partially Received";
    return "Ordered / Awaiting Receipt";
  }
  function materialOutcome(p) {
    const demands = planningFor(p);
    const lines = demands.map(d => `WO ${d.workOrderNumber} · ${d.materialStatus === "KIT_COMPLETE" ? "Kit Complete" : d.progress || "Material status unavailable"}`);
    const applied = demands.flatMap(d => d.orders || []).filter(o => o.purchaseId === p.purchaseId).reduce((n, o) => n + Number(o.appliedQuantity || 0), 0);
    if (applied > 0) lines.unshift(`Applied to Kit ${qty(applied)} ${p.purchasingUom}`);
    return lines.map(line => `<small>${esc(line)}</small>`).join("");
  }
  function needBy(item) {
    const dates = [...new Set(planningFor(item).map(d => d.schedule?.materialNeedBy).filter(Boolean))];
    return dates.length ? dates.map(date).join(" / ") : "Not Established";
  }
  function planningFacts(item) {
    const demands = planningFor(item);
    if (!demands.length) return '<p class="buyer-muted">Material planning unavailable.</p>';
    return demands.map(d => `<div class="buyer-facts" aria-label="Read-only material planning">${fact("WO", d.workOrderNumber)}${fact("Customer Due", date(d.schedule?.customerDueDate))}${fact("Manufacturing Lead", d.schedule ? d.schedule.lead.value + " " + (d.schedule.lead.unit === "DAYS" ? "Days" : "Weeks") : "Not Established")}${fact("Material Need-By", date(d.schedule?.materialNeedBy))}${(d.orders || []).filter(p => !item.purchaseId || p.purchaseId === item.purchaseId).map(p => fact("Supplier ETA", date(p.expectedDate)) + fact("Buffer", p.risk.bufferWorkingDays == null ? "Not Established" : p.risk.bufferWorkingDays + " working days") + fact("Supply Status", p.risk.status)).join("")}${d.unavailableReason ? fact("Review", d.unavailableReason) : ""}</div>`).join("");
  }
  function button(action, label, id = "", attributes = "") {
    return `<button type="button" class="buyer-button" data-buyer-action="${action}" data-id="${esc(id)}"${attributes}>${esc(label)}</button>`;
  }
  function badge(text, extra = "") { return `<span class="buyer-badge ${extra}">${esc(text)}</span>`; }
  function context(demand) {
    return `<span>WO <strong>${esc(demand.workOrderNumber)}</strong></span><span>SO ${esc(demand.salesOrderNumber)} / ${esc(demand.salesOrderLineNumber)}</span><span>${esc(demand.assemblyItemNumber)} · Rev ${esc(demand.revision)}</span><span>${esc(demand.customer)}</span><span>Build Qty ${qty(demand.buildQuantity)}</span>`;
  }
  function customerDates(item) {
    const values = [...new Set(coverage(item).map(d => d.customerDueDate).filter(Boolean))];
    return values.length ? values.sort().map(date).join(" · ") : "Not Established";
  }
  function works(item) { return [...new Set(coverage(item).map(d => d.workOrderNumber).filter(Boolean))].join(", ") || "—"; }
  function table(headers, rows, empty) {
    return `<div class="buyer-table-scroll"><table class="buyer-table"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="buyer-empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  }
  function shortageRows(rows) {
    return (followupEnabled() ? `<div class="buyer-copy-toolbar">${button("copy-selected", "Copy Selected for Email")}<span id="buyerCopyCount">${state.copySelection.size} selected</span></div>` : "") + table([...(followupEnabled() ? ["Select C/S"] : []), "Find", "DLE P/N / Approved P/N", "Description", "Required", "Kitted", "Short", "UOM", "Customer Due", "Material Need-By", "WO / SO", "Customer / Assembly", "Buyer State", "Action"], rows.map(d => `<tr>
      ${followupEnabled() ? `<td>${currentCustomerShortage(d) ? `<input type="checkbox" class="buyer-copy-check" data-copy-id="${esc(d.demandId)}" aria-label="Select Find ${esc(d.customerSupply?.findNumber || d.findNumber)} WO ${esc(d.workOrderNumber)} for email"${state.copySelection.has(d.demandId) ? " checked" : ""}>` : ""}</td>` : ""}
      <td>${esc(d.customerSupply?.findNumber || d.findNumber)}</td><td><strong>${esc(d.partNumber)}</strong><small>${esc(d.approvedPartNumber || d.partNumber)}</small>${d.customerSupply ? `<small>C/S (Customer supplied) · ${esc(d.customerSupply.customerPartNumber)}</small>` : ""}</td><td class="buyer-description">${esc(d.description)}${(d.supplyConflicts || []).map(c=>`<small role="status">${esc(c)}</small>`).join("")}</td>
      <td class="buyer-number">${qty(d.requiredQuantity)}</td><td class="buyer-number">${qty(d.kittedQuantity)}</td><td class="buyer-number buyer-short">${qty(d.remainingShortQuantity ?? d.shortQuantity)}</td><td>${esc(d.uom)}</td>
      <td>${date(d.customerDueDate)}</td><td>${needBy(d)}</td><td>WO ${esc(d.workOrderNumber)}<small>SO ${esc(d.salesOrderNumber)} / ${esc(d.salesOrderLineNumber)}</small></td>
      <td>${esc(d.customer)}<small>${esc(d.assemblyItemNumber)} / ${esc(d.revision)}</small></td><td>${badge(d.sourceCurrent === false ? "Source changed" : currentAcknowledgment(d) ? "Awaiting Customer" : d.customerSupply ? "C/S - Customer follow-up" : "Incoming", d.sourceCurrent === false ? "buyer-warning" : "")}</td>
      <td class="buyer-actions">${d.customerSupply ? "" : button("accept", "Accept", d.demandId, disabled() || (d.sourceCurrent === false ? " disabled" : ""))}${followupEnabled() && currentCustomerShortage(d) ? button("copy-email", "Copy for Email", d.demandId) + button("customer-emailed", "Customer Emailed", d.demandId, disabled()) : ""}${button("demand", d.customerSupply ? "Contact / Details" : "Details", d.demandId)}</td></tr>`), "No incoming material shortages. Accepted demand appears in Sorting.");
  }
  function planRows(rows, shop = false) {
    return table(["DLE / Approved P/N", "Description", "Vendor / Vendor P/N", "Demand Qty", "Buy Qty", "UOM", "Unit Cost", "Extended", "Customer Due", "Material Need-By", "Expected", "WO(s)", "Status / Action"], rows.map(item => {
      const unplanned = item.unplanned;
      const demands = unplanned ? [item] : coverage(item);
      return `<tr><td><strong>${esc(item.partNumber)}</strong><small>${esc(item.approvedPartNumber || item.partNumber)}</small></td><td class="buyer-description">${esc(item.description)}</td>
        <td>${esc(item.supplier || "Not Set")}<small>${esc(item.vendorPartNumber || "")}</small></td><td class="buyer-number">${qty(unplanned ? item.uncoveredQuantity : demands.reduce((sum, d) => sum + Number(d.quantity || 0), 0))}${unplanned && item.uncoveredQuantity < item.shortQuantity ? `<small>Unplanned · Source short ${qty(item.shortQuantity)}</small>` : ""}</td>
        <td class="buyer-number">${unplanned ? "Not Set" : qty(item.buyQuantity)}</td><td>${esc(item.purchasingUom || item.uom || "—")}</td><td class="buyer-number">${money(item.unitCost, item.currency)}</td><td class="buyer-number">${unplanned ? "—" : money(item.extendedCost, item.currency)}</td>
        <td>${unplanned ? date(item.customerDueDate) : customerDates(item)}</td><td>${needBy(item)}</td><td>${date(item.expectedDate)}</td><td>${unplanned ? esc(item.workOrderNumber) : esc(works(item))}</td>
        <td class="buyer-actions">${badge(demands.some(d => d.sourceCurrent === false) ? "Source changed · Review required" : shop ? "Ready for PO" : unplanned ? "Accepted" : "Sorting")}${button(unplanned ? "create" : "plan", unplanned ? "Create Buying Plan" : "Open Plan", unplanned ? item.demandId : item.planId, unplanned ? disabled() || (item.sourceCurrent === false ? " disabled" : "") : "")}</td></tr>`;
    }), shop ? "No plans are ready for PO entry." : "Accept a material shortage to begin Sorting.");
  }
  function purchasedRows(rows) {
    return table(["PO / Line", "Supplier", "DLE / Vendor P/N", "Description", "Ordered", "Received", "Open", "Unit Cost", "Extended", "Requested", "Expected", "Customer Due", "WO(s)", "Status / Action"], rows.map(p => `<tr>
      <td><strong>${esc(p.poNumber)} / ${esc(p.poLine)}</strong></td><td>${esc(p.supplier)}</td><td>${esc(p.partNumber)}<small>${esc(p.vendorPartNumber)}</small></td><td class="buyer-description">${esc(p.description)}</td>
      <td class="buyer-number">${qty(p.orderedQuantity)} ${esc(p.purchasingUom)}</td><td class="buyer-number">${qty(p.receivedQuantity)}</td><td class="buyer-number">${qty(p.openQuantity)}</td><td class="buyer-number">${money(p.unitCost, p.currency)}</td><td class="buyer-number">${money(p.extendedCost, p.currency)}</td>
      <td>${date(p.requestedDate)}</td><td>${date(p.expectedDate)}</td><td>${customerDates(p)}</td><td>${esc(works(p))}</td><td class="buyer-actions">${badge(purchaseStatus(p))}${materialOutcome(p)}${button("purchase", "Details", p.purchaseId || p.poLineId)}</td></tr>`), "No purchases recorded. Shop List contains plans ready for PO entry.");
  }
  function trackingRows(rows) {
    const customers = rows.filter(row => row.customerFollowup);
    const purchases = rows.filter(row => !row.customerFollowup);
    return `<section aria-label="Customer-supplied tracking"><h2>Customer-supplied material</h2>${table(
      ["Find No.", "Customer P/N", "Description", "Remaining", "UOM", "Customer / PO", "Assembly / WO", "Emailed By / Date", "Expected Delivery", "Status / Action"],
      customers.map(d => `<tr data-customer-tracking="${esc(d.demandId)}"><td>${esc(d.customerSupply?.findNumber || d.findNumber)}</td><td>${esc(d.customerSupply?.customerPartNumber || "Not recorded")}</td><td class="buyer-description">${esc(d.description)}${(d.supplyConflicts || []).map(c => `<small>${esc(c)}</small>`).join("")}</td><td class="buyer-number">${qty(d.remainingShortQuantity ?? d.shortQuantity)}</td><td>${esc(d.uom)}</td><td>${esc(d.customer)}<small>${esc(d.customerPoNumber || d.customerSupply?.poNumber || "Not recorded")}</small></td><td>${esc(d.assemblyItemNumber)} / ${esc(d.revision)}<small>WO ${esc(d.workOrderNumber)}</small></td><td>${esc(d.customerContact.actor)}<small>${esc(d.customerContact.atUtc)}</small></td><td>${date(d.customerContact.expectedDate)}</td><td class="buyer-actions">${badge("C/S - Emailed / Awaiting Customer Material")}${button("demand", "Details", d.demandId)}${button("copy-email", "Copy for Email", d.demandId)}</td></tr>`), "No customer-supplied material awaiting delivery.")}</section><section aria-label="Purchase order tracking"><h2>Purchase orders</h2>${purchasedRows(purchases)}</section>`;
  }
  function draw() {
    if (!state.mount) return;
    const view = buildViewModel(state.model);
    state.mount.innerHTML = `<div class="production-workspace purchasing-workspace buyer-workspace">
      <header class="production-workspace-header"><div><h1>Purchasing</h1><p>Buyer decisions, orders and incoming material.</p></div><span class="buyer-badge">SIM · Developmental</span></header>
      <div class="buyer-toolbar"><label class="buyer-search"><span class="sr-only">Search Purchasing</span><input id="buyerSearch" type="search" value="${esc(state.search)}" placeholder="Search part, supplier, PO, WO, SO, customer…"></label>${button("refresh", "↻ Refresh", "", state.busy ? " disabled" : "")}</div>
      <nav class="production-lifecycle-tabs purchasing-lifecycle-tabs buyer-tabs" aria-label="Purchasing stages">${stages.map(([key, label]) => `<button type="button" data-buyer-stage="${key}" class="${state.stage === key ? "active" : ""}" aria-pressed="${state.stage === key}">${label} · ${view.counts[key]}</button>`).join("")}</nav>
      <div class="buyer-status ${state.error ? "buyer-error" : ""}" role="${state.error ? "alert" : "status"}" aria-live="polite">${esc(state.message)}${state.model && !canManage() ? " · Read-only access" : ""}</div>
      <section aria-label="Purchasing work"><div id="buyerRows"></div></section><div id="buyerDetails"></div>
      <dialog class="buyer-dialog" id="buyerBomDialog" aria-labelledby="buyerBomTitle"><div id="buyerBomContent"></div></dialog>
      <dialog class="buyer-dialog" id="buyerCopyDialog" aria-labelledby="buyerCopyTitle"><div class="buyer-dialog-header"><h2 id="buyerCopyTitle">Copy for Email</h2>${button("copy-close", "Close")}</div><p id="buyerCopyHelp"></p>${button("copy-select-table", "Select Table")}<div id="buyerCopyTable" tabindex="0" aria-label="Formatted customer shortage table"></div><label for="buyerCopyText">Tab-separated text (Excel / plain text)</label><textarea id="buyerCopyText" rows="8" readonly aria-label="Tab-separated customer shortages"></textarea>${button("copy-select-text", "Select Text")}</dialog>
      </div>`;
    drawRows(); drawDetail();
    const root = state.mount.querySelector(".buyer-workspace");
    root.addEventListener("click", handleClick);
    root.addEventListener("submit", handleSubmit);
    root.addEventListener("change", event => {
      const id = event.target.dataset.copyId;
      if (!id) return;
      if (event.target.checked) state.copySelection.add(id); else state.copySelection.delete(id);
      const counter = state.mount.querySelector("#buyerCopyCount"); if (counter) counter.textContent = `${state.copySelection.size} selected`;
    });
    root.addEventListener("input", event => {
      if (event.target.id === "buyerSearch") { state.search = event.target.value; drawRows(); }
      else if (event.target.closest("form")) { state.dirty = true; updatePreview(); }
    });
  }
  function drawRows() {
    const target = state.mount?.querySelector("#buyerRows");
    if (!target) return;
    state.copySelection = new Set([...state.copySelection].filter(id => currentCustomerShortage(byId(id)) && !currentAcknowledgment(byId(id))));
    const view = buildViewModel(state.model, state.search);
    target.innerHTML = state.stage === "shortages" ? shortageRows(view.shortages) : state.stage === "sorting" ? planRows(view.sorting) : state.stage === "shop" ? planRows(view.shop, true) : trackingRows(view.purchased);
  }
  function fact(label, value) { return `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`; }
  function audit(item) {
    const ids = [item.demandId, item.planId, item.purchaseId, ...(item.coverage || []).map(c => c.demandId)].filter(Boolean);
    const events = state.history.filter(event => ids.includes(event.entityId));
    return `<details class="buyer-audit"><summary>History / provenance</summary><p>${esc(item.provenance || "SIM buyer workflow")} · Version ${esc(item.version ?? item.planVersion ?? "—")}</p>${events.length ? `<ul>${events.map(e => `<li>${esc(e.eventType)} · ${esc(e.actor)} · ${esc(e.atUtc)} · ${esc(e.priorState)} → ${esc(e.newState)} · v${esc(e.expectedVersion)} → ${esc(e.resultingVersion)}</li>`).join("")}</ul>` : `<p>Created / accepted by ${esc(item.createdBy || item.acceptedBy || item.buyer || "—")} · ${esc(item.createdAtUtc || item.acceptedAtUtc || "—")}</p>`}</details>`;
  }
  function quality(item) {
    const q = item.qualityRequirements;
    if (!q) return "";
    const known = value => value === true ? "Required" : value === false ? "Not Required" : "Not Established";
    return `<details class="buyer-audit"><summary>Reviewed receiving requirements</summary><div class="buyer-facts">${fact("Material / PO Traceability", known(q.poTraceabilityRequired) + (q.traceabilityAmendmentId ? " · Amended" : ""))}${fact("CoC", known(q.cocRequired))}${fact("Material Cert", known(q.materialCertRequired))}${fact("Inspection", known(q.inspectionRequired))}</div>${q.specialReceivingNotes ? `<p>${esc(q.specialReceivingNotes)}</p>` : ""}<p>Requirements are inherited read-only from reviewed source evidence.</p></details>`;
  }
  function supplyDetail(d) {
    const c=d.customerSupply;if(!c)return '';
    return `<section aria-label="C/S (Customer supplied)"><h3>C/S (Customer supplied)</h3><p>Customer follow-up for the recorded shortage. Copying does not send an email or mark contact.</p><div class="buyer-facts">${fact("Customer P/N",c.customerPartNumber)}${fact("Approved P/N",c.approvedPartNumber)}${fact("Per assembly",qty(c.requiredEach)+' '+c.uom)}${fact("Job minimum",qty(c.requiredQuantity)+' '+c.uom)}${fact("Source quote",c.quoteNumber)}${fact("Customer PO",d.customerPoNumber || c.poNumber)}${fact("PO evidence",(c.poDocumentNames||[]).join(", "))}</div><p>Supply responsibility does not record receipt, availability or kit completion.</p>
      ${contactSummary(d)}
      ${followupEnabled() && currentCustomerShortage(d) ? `<div class="buyer-copy-toolbar">${button("copy-email", "Copy for Email", d.demandId)}</div><form id="buyerContactForm" data-demand-id="${esc(d.demandId)}"><fieldset${disabled()}><div class="buyer-contact-controls"><label>Expected delivery (optional)<input name="expectedDate" type="date" value="${esc(d.customerContact?.expectedDate || "")}"></label><button class="buyer-button" type="submit">${currentAcknowledgment(d) ? "Record Another Email" : "Customer Emailed"}</button></div></fieldset><p class="buyer-muted">Acknowledges an email you already sent. Moves this item to Supply Tracking; the shortage stays open until material is covered.</p></form>` : ""}</section>`;
  }
  function balanceChoice(d) {
    if (!state.model?.mixedSourcesSupported || !d.sourceCurrent || Number(d.remainingShortQuantity ?? d.shortQuantity) <= 0) return '';
    return button(d.customerSupply ? 'buy-balance' : 'customer-balance', d.customerSupply ? 'Buy remaining balance' : 'Customer supplies remaining balance', d.demandId, disabled()) +
      (d.balanceSource ? `<p>Balance source recorded by ${esc(d.balanceSource.actor)} at ${esc(d.balanceSource.atUtc)}. Existing counts and purchase commitments are retained.</p>` : '');
  }
  function demandDetail(d) {
    return `<h2>${esc(d.partNumber)} <span class="buyer-muted">${esc(d.description)}</span></h2><div class="buyer-context">${context(d)}</div><div class="buyer-facts">${fact("Required", qty(d.requiredQuantity))}${fact(d.customerSupply && d.remainingShortQuantity != null ? "Originally kitted" : "Kitted", qty(d.kittedQuantity))}${fact("Short", qty(d.remainingShortQuantity ?? d.shortQuantity))}${d.customerSupply && d.remainingShortQuantity != null ? fact("Original short", qty(d.shortQuantity)) : ""}${fact("Customer Due", date(d.customerDueDate))}${fact("Material Need-By", needBy(d))}${fact("Original Material Status", "KIT SHORT")}${fact("Current Material Status", planningFor(d)[0]?.materialStatus === "KIT_COMPLETE" ? "Kit Complete" : planningFor(d)[0]?.progress || "Not Established")}</div>${planningFacts(d)}${supplyDetail(d)}${balanceChoice(d)}
      <p class="buyer-muted">Accept assigns buyer ownership. The submitted shortage remains unchanged until material is received and applied through Kitting.</p><div class="buyer-actions">${d.state === "INCOMING" && !d.customerSupply ? button("accept", "Accept", d.demandId, disabled() || (d.sourceCurrent === false ? " disabled" : "")) : ""}${button("bom", "View Kitted BOM", d.demandId)}</div>${d.supplyDisposition ? `<p>Job supply disposition: ${esc(d.supplyDisposition.responsibility)} — ${esc(d.supplyDisposition.actor)} / ${esc(d.supplyDisposition.atUtc)}. Original: ${esc(d.supplyDisposition.originalResponsibility)}.</p>` : ""}${(d.supplyConflicts || []).map(c=>`<p role="status">${esc(c)}</p>`).join("")}${quality(d)}${audit(d)}`;
  }
  function field(label, name, value, type = "text", extra = "") {
    return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value ?? "")}"${extra}></label>`;
  }
  function coverageTable(links, edit = false) {
    return table(["WO", "SO / Line", "Customer / Assembly", "Customer Due", "Source Short", "Coverage", "Evidence"], links.map(d => `<tr><td>${esc(d.workOrderNumber)}</td><td>${esc(d.salesOrderNumber)} / ${esc(d.salesOrderLineNumber)}</td><td>${esc(d.customer)}<small>${esc(d.assemblyItemNumber)} / ${esc(d.revision)}</small></td><td>${date(d.customerDueDate)}</td><td class="buyer-number">${qty(d.remainingShortQuantity ?? d.shortQuantity)}</td><td class="buyer-number">${edit ? `<input aria-label="Coverage for WO ${esc(d.workOrderNumber)}" name="coverage-${esc(d.demandId)}" type="number" min="0.000001" max="${esc(d.shortQuantity)}" step="any" required value="${esc(d.quantity)}">` : qty(d.quantity)}</td><td>${button("bom", "View Kitted BOM", d.demandId)}</td></tr>`), "No demand coverage.");
  }
  function planDetail(plan, demand) {
    const isNew = !plan;
    const unplanned = isNew ? buildViewModel(state.model).sorting.find(d => d.unplanned && d.demandId === demand.demandId)?.uncoveredQuantity || 0 : 0;
    const links = isNew ? [{ ...demand, quantity: unplanned }] : coverage(plan);
    const p = plan || { partNumber: demand.partNumber, approvedPartNumber: demand.approvedPartNumber, description: demand.description, buyQuantity: unplanned, purchasingUom: demand.uom, currency: "USD" };
    const readOnly = !canManage() || p.state === "ORDERED" || state.busy;
    return `<h2>${isNew ? "Buying Plan" : p.state === "READY_FOR_PO" ? "Shop List · Ready for PO" : "Buying Plan"} <span class="buyer-muted">${esc(p.partNumber)}</span></h2><p class="buyer-muted">${esc(p.description)} · Approved P/N ${esc(p.approvedPartNumber || p.partNumber)}</p>
      ${planningFacts(isNew ? demand : plan)}<form id="buyerPlanForm"><fieldset${readOnly ? " disabled" : ""}><div class="buyer-form-grid">
      ${field("Supplier", "supplier", p.supplier, "text", ' maxlength="160" required placeholder="Synthetic supplier for this SIM"')}${field("Vendor P/N", "vendorPartNumber", p.vendorPartNumber, "text", ' maxlength="160" required')}
      ${field("Proposed Buy Qty", "buyQuantity", p.buyQuantity, "number", ' min="0.000001" step="any" required')}${field("Purchasing UOM", "purchasingUom", p.purchasingUom, "text", ' maxlength="20" required')}
      ${field("Unit Cost / Purchasing UOM", "unitCost", p.unitCost, "number", ' min="0" step="any" required')}${field("Currency", "currency", p.currency || "USD", "text", ' minlength="3" maxlength="3" required')}
      ${field("Supplier Requested Date", "requestedDate", p.requestedDate, "date")}${field("Supplier Promised / Expected", "expectedDate", p.expectedDate, "date")}
      </div><div class="buyer-plan-preview" id="buyerPlanPreview">${fact("Extended Cost", money(p.extendedCost, p.currency))}${fact("Excess", qty(p.excessQuantity || 0))}</div>
      <h3>Demand Coverage</h3>${coverageTable(links, true)}<div class="buyer-form-grid buyer-notes-grid"><label>Excess purpose (required when buying extra)<input name="excessPurpose" maxlength="1000" value="${esc(p.excessPurpose || "")}"></label><label>Buyer notes<textarea name="notes" rows="2" maxlength="4000">${esc(p.notes || "")}</textarea></label></div>
      <p class="buyer-muted">Expected date is required before moving to Shop List. Other blank dates remain Not Established. Price is per purchasing UOM; no pack conversion is inferred. Source shortage quantities are read-only.</p>
      ${p.state === "READY_FOR_PO" ? '<p class="buyer-warning">Saving edits returns this plan to Sorting and requires a new Ready for PO review.</p>' : ""}
      <div class="buyer-actions"><button class="buyer-button buyer-primary" type="submit">Save Buying Plan</button>${!isNew && p.state === "DRAFT" ? button("ready", "Move to Shop List", p.planId, links.some(d => d.sourceCurrent === false) ? " disabled" : "") : ""}${p.state === "READY_FOR_PO" ? button("record", "Record Purchase", p.planId, links.some(d => d.sourceCurrent === false) ? " disabled" : "") : ""}</div></fieldset></form>${quality(p)}${audit(p)}`;
  }
  function purchaseForm(plan) {
    return `<h2>Record Purchase <span class="buyer-muted">${esc(plan.partNumber)}</span></h2><p class="buyer-warning">SIM-only developmental evidence. This action records an expected PO line; it does not place a real supplier order or receive material.</p>
      <div class="buyer-facts">${fact("Supplier", plan.supplier)}${fact("Ordered Qty", `${qty(plan.buyQuantity)} ${plan.purchasingUom}`)}${fact("Unit Cost", money(plan.unitCost, plan.currency))}${fact("Extended", money(plan.extendedCost, plan.currency))}${fact("Supplier Requested", date(plan.requestedDate))}${fact("Supplier Expected", date(plan.expectedDate))}</div>
      <form id="buyerPurchaseForm"><fieldset${disabled()}><div class="buyer-form-grid">${field("Synthetic PO Number", "poNumber", "", "text", ' required maxlength="40"')}${field("PO Line", "poLine", "010", "text", ' required maxlength="10"')}${field("Order Date", "orderDate", "", "date", " required")}${field("Confirmation / Acknowledgment", "confirmation", "", "text", ' maxlength="200"')}</div><label class="buyer-wide-label">Purchase notes<textarea name="notes" rows="2" maxlength="4000" placeholder="Scenario date and supplier context"></textarea></label><h3>Demand Coverage</h3>${coverageTable(coverage(plan))}<div class="buyer-actions"><button class="buyer-button buyer-primary" type="submit">Record SIM Purchase</button>${button("plan", "Back to Plan", plan.planId)}</div></fieldset></form>`;
  }
  function purchaseDetail(p) {
    return `<h2>PO ${esc(p.poNumber)} / ${esc(p.poLine)} ${badge(purchaseStatus(p))}${materialOutcome(p)}</h2><p>${esc(p.partNumber)} · ${esc(p.description)}</p><div class="buyer-facts">${fact("Supplier", p.supplier)}${fact("Vendor P/N", p.vendorPartNumber)}${fact("Ordered", `${qty(p.orderedQuantity)} ${p.purchasingUom}`)}${fact("Received", qty(p.receivedQuantity))}${fact("Open", qty(p.openQuantity))}${fact("Unit Cost", money(p.unitCost, p.currency))}${fact("Extended", money(p.extendedCost, p.currency))}${fact("Order Date", date(p.orderDate))}${fact("Supplier Requested", date(p.requestedDate))}${fact("Supplier Expected", date(p.expectedDate))}${fact("Material Need-By", needBy(p))}${fact("Acknowledgment", p.confirmation || "Not recorded")}</div>
      ${planningFacts(p)}<p class="buyer-warning">SIMULATED DEVELOPMENTAL · Purchase history is retained. Receipt quantities and current Kitting outcomes are shown separately.</p><h3>Demand Coverage</h3>${coverageTable(coverage(p))}${p.excessQuantity ? `<p>Excess ${qty(p.excessQuantity)} · ${esc(p.excessPurpose)}</p>` : ""}${p.notes ? `<p><strong>Original purchase notes (at order entry):</strong> ${esc(p.notes)}</p>` : ""}${quality(p)}${audit(p)}`;
  }
  function drawDetail() {
    const target = state.mount?.querySelector("#buyerDetails");
    if (!target) return;
    const selection = state.selected;
    if (!selection) { target.innerHTML = ""; return; }
    let body = "";
    const plan = state.model?.plans?.find(p => p.planId === selection.id);
    const demand = byId(selection.id);
    if (selection.kind === "demand" && demand) body = demandDetail(demand);
    else if (selection.kind === "create" && demand) body = planDetail(null, demand);
    else if (selection.kind === "plan" && plan) body = planDetail(plan);
    else if (selection.kind === "record" && plan) body = purchaseForm(plan);
    else if (selection.kind === "purchase") { const p = state.model?.purchases?.find(p => (p.purchaseId || p.poLineId) === selection.id); if (p) body = purchaseDetail(p); }
    target.innerHTML = body ? `<section class="buyer-detail" aria-label="Selected Purchasing record"><div class="buyer-detail-close">${button("close", "Close Details")}</div>${body}</section>` : "";
  }
  function discardAllowed() { return !state.dirty || window.confirm("Discard unsaved changes?"); }
  function select(kind, id) {
    if (!discardAllowed()) return;
    state.selected = { kind, id }; state.dirty = false; state.error = false; state.message = "Purchasing current";
    draw(); state.mount.querySelector("#buyerDetails")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }
  function updatePreview() {
    const form = state.mount.querySelector("#buyerPlanForm");
    const target = state.mount.querySelector("#buyerPlanPreview");
    if (!form || !target) return;
    const fields = new FormData(form), buy = Number(fields.get("buyQuantity") || 0), cost = fields.get("unitCost"), currency = String(fields.get("currency") || "USD").toUpperCase();
    const totalCoverage = [...fields.entries()].filter(([key]) => key.startsWith("coverage-")).reduce((sum, [, value]) => sum + Number(value || 0), 0);
    target.innerHTML = fact("Estimated Extended Cost", cost === "" ? "Not Set" : money(buy * Number(cost), currency)) + fact("Excess", qty(buy - totalCoverage));
  }
  async function mutate(path, method, payload, next) {
    if (state.busy || !canManage()) return;
    state.busy = true;
    const activeForm = state.mount.querySelector("form");
    activeForm?.querySelectorAll("fieldset").forEach(fieldset => { fieldset.disabled = true; });
    activeForm?.querySelectorAll("button").forEach(button => { button.disabled = true; });
    state.mount.querySelectorAll('[data-buyer-action="accept"]').forEach(button => { button.disabled = true; });
    try {
      const result = await request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: window.crypto.randomUUID() }) });
      [state.model, state.history] = await Promise.all([request(), request("/history")]); state.dirty = false; state.error = false; state.message = "Saved · " + next.message;
      state.stage = next.stage || state.stage; state.selected = next.selection ? next.selection(result) : null;
      state.busy = false; draw();
    } catch (error) {
      // Retain typed values on validation or concurrency failure. Refresh is explicit.
      state.busy = false; state.error = true; state.message = error.message + (error.status === 409 ? " Refresh to review the current record before trying again." : "");
      activeForm?.querySelectorAll("button").forEach(button => { button.disabled = false; });
      activeForm?.querySelectorAll("fieldset").forEach(fieldset => { fieldset.disabled = false; });
      const status = state.mount.querySelector(".buyer-status");
      if (status) { status.textContent = state.message; status.classList.add("buyer-error"); status.setAttribute("role", "alert"); }
      drawRows();
    }
  }
  async function handleClick(event) {
    const stage = event.target.closest?.("[data-buyer-stage]");
    if (stage && !state.busy && discardAllowed()) { state.stage = stage.dataset.buyerStage; state.selected = null; state.dirty = false; draw(); return; }
    const control = event.target.closest?.("[data-buyer-action]");
    if (!control || control.disabled || state.busy) return;
    const { buyerAction: action, id } = control.dataset;
    if (action === "copy-email" || action === "copy-selected") { await copyForEmail(action === "copy-email" ? [id] : [...state.copySelection]); return; }
    if (action === "copy-close") { state.mount.querySelector("#buyerCopyDialog").close(); return; }
    if (action === "copy-select-table") {
      const table = state.mount.querySelector("#buyerCopyTable"), range = document.createRange();
      table.focus(); range.selectNodeContents(table); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
    }
    if (action === "copy-select-text") { const field = state.mount.querySelector("#buyerCopyDialog textarea"); field.focus(); field.select(); return; }
    if (action === "customer-emailed") {
      if (!discardAllowed()) return;
      const d = byId(id); if (currentCustomerShortage(d) && !currentAcknowledgment(d)) await acknowledgeEmail(d);
      return;
    }
    if (action === "refresh") { if (discardAllowed()) { state.selected = null; state.dirty = false; await refresh(); } }
    else if (["demand", "create", "plan", "purchase"].includes(action)) select(action, id);
    else if (action === "close") { if (discardAllowed()) { state.selected = null; state.dirty = false; drawDetail(); } }
    else if (action === "bom-close") state.mount.querySelector("#buyerBomDialog").close();
    else if (action === "bom") await openBom(id);
    else if (action === 'buy-balance' || action === 'customer-balance') {
      const demand=byId(id);if(demand)await mutate(`/demands/${encodeURIComponent(id)}/balance-source`, 'POST', {expectedVersion:demand.version,responsibility:action==='buy-balance'?'PURCHASED':'CUSTOMER_SUPPLIED'}, {stage:action==='buy-balance'?'sorting':'shortages',message:'Remaining balance source saved; no receipt recorded.',selection:()=>({kind:'demand',id})});
    }
    else if (action === "accept") { const demand = byId(id); if (demand) await mutate(`/demands/${encodeURIComponent(id)}/accept`, "POST", { expectedVersion: demand.version }, { stage: "sorting", message: "Demand accepted. Create a buying plan when ready." }); }
    else if (action === "ready") {
      if (state.dirty) { state.message = "Save buying-plan changes before moving to Shop List."; showMessage(); return; }
      const plan = state.model.plans.find(p => p.planId === id);
      await mutate(`/plans/${encodeURIComponent(id)}/ready`, "POST", { expectedVersion: plan.version }, { stage: "shop", message: "Ready for PO.", selection: () => ({ kind: "plan", id }) });
    } else if (action === "record") {
      if (state.dirty) { state.message = "Save and review your changes before recording a purchase."; showMessage(); return; }
      select("record", id);
    }
  }
  function showMessage() { const status = state.mount.querySelector(".buyer-status"); if (status) status.textContent = state.message; }
  function planPayload(fields, plan, demand) {
    const links = plan ? coverage(plan) : [{ ...demand, quantity: demand.shortQuantity }];
    return { expectedVersion: plan?.version || 0,
      supplier: String(fields.get("supplier") || "").trim(), vendorPartNumber: String(fields.get("vendorPartNumber") || "").trim(),
      buyQuantity: Number(fields.get("buyQuantity")), purchasingUom: String(fields.get("purchasingUom") || "").trim(), unitCost: fields.get("unitCost") === "" ? null : Number(fields.get("unitCost")),
      currency: String(fields.get("currency") || "").trim().toUpperCase(), requestedDate: fields.get("requestedDate") || "", expectedDate: fields.get("expectedDate") || "", materialNeedBy: plan?.materialNeedBy || "", notes: fields.get("notes") || "", excessPurpose: fields.get("excessPurpose") || "",
      coverage: links.map(d => ({ demandId: d.demandId, quantity: Number(fields.get("coverage-" + d.demandId)), expectedDemandVersion: byId(d.demandId)?.version ?? d.version })) };
  }
  async function acknowledgeEmail(d, expectedDate = "") {
    await mutate(`/demands/${encodeURIComponent(d.demandId)}/customer-contact`, "POST", {
      expectedVersion: d.version, expectedSubmissionId: d.currentSubmissionId || d.submissionId,
      expectedSourceFingerprint: d.sourceFingerprint, expectedShortQuantity: d.remainingShortQuantity ?? d.shortQuantity,
      expectedDate
    }, { stage: "purchased", message: "Customer email acknowledged. Awaiting customer material in Supply Tracking; shortage remains open.", selection: () => ({ kind: "demand", id: d.demandId }) });
  }
  async function handleSubmit(event) {
    if (event.target.id === "buyerContactForm") {
      event.preventDefault(); if (state.busy || !canManage() || !event.target.reportValidity()) return;
      const d = byId(event.target.dataset.demandId); if (!currentCustomerShortage(d)) return;
      await acknowledgeEmail(d, new FormData(event.target).get("expectedDate") || "");
      return;
    }
    if (!event.target.matches("#buyerPlanForm, #buyerPurchaseForm")) return;
    event.preventDefault(); if (state.busy || !canManage() || !event.target.reportValidity()) return;
    const fields = new FormData(event.target), selection = state.selected;
    const plan = state.model.plans.find(p => p.planId === selection.id);
    if (event.target.id === "buyerPlanForm") {
      const payload = planPayload(fields, plan, byId(selection.id));
      await mutate(plan ? `/plans/${encodeURIComponent(plan.planId)}` : "/plans", plan ? "PUT" : "POST", payload,
        { stage: "sorting", message: "Buying plan saved.", selection: result => ({ kind: "plan", id: result.planId || result.plan?.planId }) });
    } else await mutate(`/plans/${encodeURIComponent(plan.planId)}/purchase`, "POST", { expectedVersion: plan.version, poNumber: fields.get("poNumber"), poLine: fields.get("poLine"), orderDate: fields.get("orderDate"), confirmation: fields.get("confirmation") || "", notes: fields.get("notes") || "" }, { stage: "purchased", message: "SIM purchase recorded. Expected material is now available to Receiving; the WO remains Kit Short." });
  }
  async function openBom(id) {
    try {
      const result = await request(`/demands/${encodeURIComponent(id)}/kitted-bom`);
      const groups = result.snapshot?.draft?.groups || [];
      const dialog = state.mount.querySelector("#buyerBomDialog");
      dialog.querySelector("#buyerBomContent").innerHTML = `<div class="buyer-dialog-header"><h2 id="buyerBomTitle">Submitted Kitted BOM · WO ${esc(result.workOrderNumber || byId(id)?.workOrderNumber)}</h2>${button("bom-close", "Close")}</div><p class="buyer-muted">Read-only submitted evidence. No counts or allocations can be changed here.</p>${table(["Find", "Part", "Description", "Required", "Kitted", "Short", "Result"], groups.map(group => `<tr><td>${esc(group.sequence)}</td><td>${esc(group.partNumber)}</td><td class="buyer-description">${esc(group.description)}</td><td class="buyer-number">${qty(group.requiredQuantity)}</td><td class="buyer-number">${group.entry?.result === "COMPLETE" ? "Complete" : qty(group.entry?.pickedQuantity ?? group.pickedQuantity)}</td><td class="buyer-number">${qty(group.entry?.shortageQuantity ?? group.shortageQuantity)}</td><td>${esc(String(group.entry?.result || group.result || "").replaceAll("_", " "))}</td></tr>`), "No submitted rows returned.")}`;
      dialog.showModal();
    } catch (error) { state.message = error.message; state.error = true; showMessage(); }
  }
  function openWorkOrder(wo) {
    state.search = wo; state.stage = "shortages"; state.selected = null; state.dirty = false; draw();
    window.DleWorkspaceShell?.setWorkspaceView?.("purchasing");
    window.go?.("home", false);
    return true;
  }
  window.SimPurchasingWorkspace = Object.freeze({ emailPayload, emailText, currentCustomerShortage, currentAcknowledgment, purchaseStatus, render, refresh, openWorkOrder, buildViewModel, formatDate: date, planPayload, getModel: () => state.model });
})(window, document);

(function registerRfqAssemblyHistory(window) {
  "use strict";

  function text(value) {
    return String(value ?? "").trim();
  }

  function normalizeAssemblyNumber(value) {
    return text(value).toUpperCase();
  }

  function normalizeCustomerNumber(value) {
    const valueText = text(value);
    return /^\d+$/.test(valueText) && valueText.length < 6
      ? valueText.padStart(6, "0")
      : valueText;
  }

  function invoiceRecord(row) {
    return {
      source: "Invoice",
      assemblyNumber: text(row?.itemNumber),
      revision: text(row?.revisionCode || row?.drawingRevision || row?.bomRevision),
      customerNumber: normalizeCustomerNumber(row?.customerNumber),
      customerName: text(row?.customerName),
      date: text(row?.invoiceDate),
      invoiceNumber: text(row?.invoiceNumber),
      salesOrderNumber: text(row?.salesOrderNumber),
      workOrderNumber: text(row?.workOrderNumber),
      sourceId: text(row?.invoiceHistoryLineId)
    };
  }

  function shipmentRecord(row) {
    return {
      source: "Shipment",
      assemblyNumber: text(row?.itemNumber || row?.item?.partNumber),
      revision: text(row?.revision || row?.item?.revision),
      customerNumber: normalizeCustomerNumber(
        row?.customerNumber || row?.customer?.customerNumber),
      customerName: text(row?.customerName || row?.customer?.customerName),
      date: text(
        row?.shipmentDateTime || row?.dates?.shipmentConfirmationDate ||
        row?.dates?.shipDate || row?.archivedAt),
      shipmentId: text(row?.shipmentId || row?.identifiers?.shipmentId),
      salesOrderNumber: text(row?.salesOrder || row?.order?.salesOrder),
      workOrderNumber: text(row?.workOrder || row?.order?.workOrder),
      sourceId: text(row?.shipmentId || row?.identifiers?.shipmentId)
    };
  }

  function dateValue(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sharedReference(left, right) {
    return ["salesOrderNumber", "workOrderNumber"].some(field => {
      const leftValue = text(left[field]).toUpperCase();
      const rightValue = text(right[field]).toUpperCase();
      return leftValue && leftValue !== "UNKNOWN" && leftValue === rightValue;
    });
  }

  function familyHasConflict(records) {
    const shipments = records.filter(record => record.source === "Shipment");
    const invoices = records.filter(record => record.source === "Invoice");
    return shipments.some(shipment => invoices.some(invoice => (
      shipment.revision && invoice.revision &&
      shipment.revision.toUpperCase() !== invoice.revision.toUpperCase() &&
      sharedReference(shipment, invoice)
    )));
  }

  function latestReference(record) {
    if (record.source === "Shipment" && record.shipmentId) {
      return "Shipment " + record.shipmentId;
    }
    if (record.source === "Invoice" && record.invoiceNumber) {
      return "Invoice " + record.invoiceNumber;
    }
    if (record.salesOrderNumber) return "Sales Order " + record.salesOrderNumber;
    if (record.workOrderNumber) return "Work Order " + record.workOrderNumber;
    return record.sourceId || record.source;
  }

  function buildSearchResponse(options = {}) {
    const query = normalizeAssemblyNumber(options.assemblyNumber);
    const rfqCustomerNumber = normalizeCustomerNumber(options.rfqCustomerNumber);
    const records = [
      ...(Array.isArray(options.invoiceRecords) ? options.invoiceRecords : [])
        .map(invoiceRecord),
      ...(Array.isArray(options.shipmentRecords) ? options.shipmentRecords : [])
        .map(shipmentRecord)
    ].filter(record => record.assemblyNumber && record.customerNumber);

    const exact = records.filter(record =>
      normalizeAssemblyNumber(record.assemblyNumber) === query);
    const matching = exact.length
      ? exact
      : records.filter(record =>
        normalizeAssemblyNumber(record.assemblyNumber).includes(query));
    const matchType = exact.length ? "EXACT" : "PARTIAL";

    const families = new Map();
    matching.forEach(record => {
      const key = record.customerNumber + "\u001f" +
        normalizeAssemblyNumber(record.assemblyNumber);
      if (!families.has(key)) families.set(key, []);
      families.get(key).push(record);
    });

    const results = [];
    families.forEach(familyRecords => {
      const revisions = new Set(
        familyRecords.map(record => record.revision.toUpperCase()).filter(Boolean));
      const conflict = familyHasConflict(familyRecords);
      const groups = new Map();
      familyRecords.forEach(record => {
        const key = record.revision.toUpperCase() || "<BLANK>";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
      });
      groups.forEach(groupRecords => {
        const latest = groupRecords.slice().sort((left, right) =>
          dateValue(right.date) - dateValue(left.date))[0];
        const sources = new Set(groupRecords.map(record => record.source));
        let revisionState = "Revision Identified";
        if (!latest.revision) revisionState = "Revision Not Recorded";
        else if (conflict) revisionState = "Historical Revision Conflict";
        else if (revisions.size > 1) revisionState = "Multiple Historical Revisions";
        const matchScope = latest.customerNumber === rfqCustomerNumber
          ? "Same RFQ Customer"
          : "Different Customer";
        results.push({
          resultId: [latest.customerNumber,
            normalizeAssemblyNumber(latest.assemblyNumber),
            latest.revision.toUpperCase() || "BLANK"].join("\u001f"),
          assemblyNumber: latest.assemblyNumber,
          revision: latest.revision,
          revisionState,
          historicalCustomerNumber: latest.customerNumber,
          historicalCustomerName: latest.customerName,
          matchScope,
          matchType,
          historicalSource: sources.size > 1 ? "Both" : Array.from(sources)[0],
          mostRecentHistoricalDate: latest.date || null,
          historicalOccurrenceCount: groupRecords.length,
          selectedHistoricalReference: latestReference(latest),
          selectable: matchType === "EXACT"
        });
      });
    });

    results.sort((left, right) =>
      Number(right.matchScope === "Same RFQ Customer") -
        Number(left.matchScope === "Same RFQ Customer") ||
      dateValue(right.mostRecentHistoricalDate) -
        dateValue(left.mostRecentHistoricalDate) ||
      left.historicalCustomerNumber.localeCompare(right.historicalCustomerNumber) ||
      left.revision.localeCompare(right.revision));
    return {
      query: text(options.assemblyNumber),
      normalizedQuery: query,
      matchType: results.length ? matchType : "NONE",
      results
    };
  }

  window.DleRfqAssemblyHistory = Object.freeze({
    normalizeAssemblyNumber,
    normalizeCustomerNumber,
    buildSearchResponse
  });
})(window);

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..", "..");
const viewer = fs.readFileSync(
  path.join(root, "SRC/modules/canonical-data-viewer/canonical-data-viewer.js"),
  "utf8"
);
const template = fs.readFileSync(
  path.join(root, "SRC/modules/canonical-data-viewer/canonical-data-viewer.html"),
  "utf8"
);
const client = fs.readFileSync(
  path.join(root, "SRC/api/dle-api-client.js"),
  "utf8"
);
const refresh = fs.readFileSync(
  path.join(root, "Tools/LiveSnapshotRefresh/Invoke-LiveSnapshotRefresh.ps1"),
  "utf8"
);

assert.match(
  client,
  /canonicalInvoiceHistory:\s*'\/api\/platform\/live\/v1\/invoice-history'/
);
assert.match(client, /getCanonicalInvoiceHistory\(options = \{\}\)/);
assert.match(
  client,
  /getCanonicalInvoiceHistoryLine\(invoiceHistoryLineId, options = \{\}\)/
);
assert.match(
  template,
  /data-canonical-tab="invoiceHistory">Invoice History<\/button>/
);
assert.match(viewer, /title:\s*"Invoice History"/);
assert.match(viewer, /liveOnly:\s*true/);
assert.match(viewer, /name:\s*"workOrderResolutionStatus"/);
assert.match(viewer, /name:\s*"manufacturingResolutionType"/);
assert.match(viewer, /label:\s*"Manufacturing Source"/);
assert.match(viewer, /name:\s*"quantityShipped"/);
assert.match(viewer, /name:\s*"extendedPrice"/);
assert.match(
  viewer,
  /activeProfileKey !== "live" \|\| !state\.invoiceHistoryAvailable/
);
assert.doesNotMatch(refresh, /InvoiceHistory|CustomerInvoice/i);

let requestedUrl = "";
const browserContext = {
  URLSearchParams,
  encodeURIComponent,
  localStorage: { getItem() { return null; } },
  fetch: async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      async json() {
        return {
          items: [],
          page: 1,
          pageSize: 50,
          totalItems: 0,
          totalPages: 0
        };
      }
    };
  },
  window: {
    location: {
      hostname: "dle-os-host",
      origin: "http://DLE-OS-HOST:5041"
    }
  }
};
vm.createContext(browserContext);
vm.runInContext(client, browserContext);

const typed = {
  page: 3,
  pageSize: 100,
  invoiceDateFrom: "2016-03-01",
  invoiceDateTo: "2016-03-31",
  customerNumber: " 1148 ",
  invoiceNumber: " 169292 ",
  salesOrderNumber: " 9422 ",
  itemNumber: "277-4169",
  workOrderNumber: " 111450 "
};
await browserContext.window.DleApiClient.liveCanonical
  .getCanonicalInvoiceHistory(typed);
assert.match(requestedUrl, /page=3(?:&|$)/);
assert.match(requestedUrl, /pageSize=100(?:&|$)/);
assert.match(requestedUrl, /invoiceDateFrom=2016-03-01(?:&|$)/);
assert.match(requestedUrl, /invoiceDateTo=2016-03-31(?:&|$)/);
assert.match(requestedUrl, /customerNumber=001148(?:&|$)/);
assert.match(requestedUrl, /invoiceNumber=0169292(?:&|$)/);
assert.match(requestedUrl, /salesOrderNumber=0009422(?:&|$)/);
assert.match(requestedUrl, /itemNumber=277-4169(?:&|$)/);
assert.match(requestedUrl, /workOrderNumber=0111450(?:&|$)/);
assert.equal(typed.customerNumber, " 1148 ");
assert.equal(typed.invoiceNumber, " 169292 ");
assert.equal(typed.itemNumber, "277-4169");

console.log("INVOICE-HISTORY-PLATFORM-001 frontend tests: PASS (26 assertions)");

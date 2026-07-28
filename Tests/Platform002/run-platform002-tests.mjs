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

assert.match(client, /canonicalSalesOrders:\s*'\/api\/platform\/live\/v1\/sales-orders'/);
assert.match(client, /getCanonicalSalesOrders\(options = \{\}\)/);
assert.match(client, /getCanonicalSalesOrder\(salesOrderLineId, options = \{\}\)/);
assert.match(template, /data-canonical-tab="salesOrders">Sales Orders<\/button>/);
assert.match(viewer, /title:\s*"Sales Orders"/);
assert.match(viewer, /liveOnly:\s*true/);
assert.match(viewer, /label:\s*"Quantity Ordered"/);
assert.doesNotMatch(viewer, /label:\s*"Quantity Open"/);
assert.doesNotMatch(viewer, /Quantity Shipped/);
assert.match(viewer, /name:\s*"negativeQuantity"/);
assert.match(viewer, /name:\s*"unresolvedWorkOrder"/);
assert.match(viewer, /name:\s*"estimatedShipDate"/);
assert.match(viewer, /name:\s*"customerPurchaseOrderNumber"/);
assert.match(viewer, /name:\s*"workOrderNumber"/);
assert.match(viewer, /name:\s*"extendedPrice", label:\s*"Extended Price"/);
assert.match(viewer, /tab\.hidden = activeProfileKey !== "live"/);

let requestedUrl = "";
const browserContext = {
  URLSearchParams,
  encodeURIComponent,
  localStorage: {
    getItem() {
      return null;
    }
  },
  fetch: async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      async json() {
        return { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0 };
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

const paddedInput = { page: 1, pageSize: 50, customerNumber: "001148" };
await browserContext.window.DleApiClient.liveCanonical.getCanonicalSalesOrders(paddedInput);
assert.match(requestedUrl, /customerNumber=001148(?:&|$)/);
assert.equal(paddedInput.customerNumber, "001148");

const paddedSalesOrderInput = {
  page: 1,
  pageSize: 50,
  salesOrderNumber: "0012046"
};
await browserContext.window.DleApiClient.liveCanonical.getCanonicalSalesOrders(
  paddedSalesOrderInput
);
assert.match(requestedUrl, /salesOrderNumber=0012046(?:&|$)/);
assert.equal(paddedSalesOrderInput.salesOrderNumber, "0012046");

await browserContext.window.DleApiClient.liveCanonical.getCanonicalSalesOrders({
  page: 1,
  pageSize: 50,
  customerNumber: " 1148 ",
  salesOrderNumber: " 12046 ",
  itemNumber: "500144-103",
  negativeQuantity: true
});
assert.match(requestedUrl, /customerNumber=001148(?:&|$)/);
assert.match(requestedUrl, /salesOrderNumber=0012046(?:&|$)/);
assert.match(requestedUrl, /itemNumber=500144-103(?:&|$)/);
assert.match(requestedUrl, /negativeQuantity=true(?:&|$)/);

console.log("PLATFORM-002 frontend tests: PASS (23 assertions)");

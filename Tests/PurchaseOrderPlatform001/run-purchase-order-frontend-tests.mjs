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
  path.join(root, "SRC/api/dle-api-client.js"), "utf8"
);
const frontendHost = fs.readFileSync(
  path.join(
    root,
    "Tools/PurchaseOrder/ServerOverlay/Hosting/FrontendApplicationExtensions.cs"
  ),
  "utf8"
);
const erpRefresh = fs.readFileSync(
  path.join(root, "Tools/LiveSnapshotRefresh/Invoke-LiveSnapshotRefresh.ps1"),
  "utf8"
);
const invoiceRefresh = fs.readFileSync(
  path.join(root, "Tools/InvoiceHistory/Invoke-InvoiceHistoryRefresh.ps1"),
  "utf8"
);

assert.match(
  client,
  /canonicalPurchaseOrders:\s*'\/api\/platform\/live\/v1\/purchase-orders'/
);
assert.match(
  client,
  /canonicalPurchaseOrderMetadata:\s*'\/api\/platform\/live\/v1\/purchase-orders\/metadata'/
);
assert.match(client, /getCanonicalPurchaseOrders\(options = \{\}\)/);
assert.match(client, /getCanonicalPurchaseOrderLine\(purchaseOrderLineId/);
assert.match(client, /getCanonicalPurchaseOrderMetadata\(options = \{\}\)/);
assert.match(
  template,
  /data-canonical-tab="purchaseOrders">Purchase Orders<\/button>/
);
assert.match(
  frontendHost,
  /no-store, no-cache, must-revalidate, max-age=0/
);
assert.match(
  frontendHost,
  /app\.MapGet\(\$"\/\{options\.EntryFile\}", ServeEntryFile\)/
);
assert.match(frontendHost, /app\.MapGet\("\/app", ServeEntryFile\)/);
assert.match(viewer, /title:\s*"Purchase Orders"/);
assert.match(viewer, /identifier:\s*"purchaseOrderLineId"/);
assert.match(viewer, /name:\s*"quantityOpen"/);
assert.match(viewer, /name:\s*"vendorResolutionStatus"/);
assert.match(
  viewer,
  /activeProfileKey !== "live" \|\| !state\.purchaseOrderAvailable/
);
assert.doesNotMatch(erpRefresh, /PurchaseOrderImportRun|PurchaseOrderLine/);
assert.doesNotMatch(invoiceRefresh, /PurchaseOrderImportRun|PurchaseOrderLine/);

let requestedUrl = "";
const context = {
  URLSearchParams,
  encodeURIComponent,
  localStorage: { getItem() { return null; } },
  fetch: async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      async json() {
        return {
          items: [], page: 1, pageSize: 50,
          totalItems: 0, totalPages: 0
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
vm.createContext(context);
vm.runInContext(client, context);

const typed = {
  page: 3,
  pageSize: 100,
  purchaseOrderNumber: " 44118 ",
  vendorNumber: " 31 ",
  vendorName: " IEC ",
  itemNumber: "312651MM",
  workOrderNumber: " 5 ",
  salesOrderNumber: " 12046 ",
  lineType: "NonStock",
  openOnly: "true"
};
await context.window.DleApiClient.liveCanonical
  .getCanonicalPurchaseOrders(typed);
assert.match(requestedUrl, /page=3(?:&|$)/);
assert.match(requestedUrl, /pageSize=100(?:&|$)/);
assert.match(requestedUrl, /purchaseOrderNumber=0044118(?:&|$)/);
assert.match(requestedUrl, /vendorNumber=000031(?:&|$)/);
assert.match(requestedUrl, /vendorName=IEC(?:&|$)/);
assert.match(requestedUrl, /itemNumber=312651MM(?:&|$)/);
assert.match(requestedUrl, /workOrderNumber=0000005(?:&|$)/);
assert.match(requestedUrl, /salesOrderNumber=0012046(?:&|$)/);
assert.match(requestedUrl, /lineType=NonStock(?:&|$)/);
assert.match(requestedUrl, /openOnly=true(?:&|$)/);
assert.equal(typed.purchaseOrderNumber, " 44118 ");
assert.equal(typed.vendorNumber, " 31 ");

await context.window.DleApiClient.liveCanonical
  .getCanonicalPurchaseOrderLine("010000310044118005");
assert.match(
  requestedUrl,
  /\/purchase-orders\/01\/000031\/0044118\/lines\/005$/
);

console.log("PURCHASE-ORDER-PLATFORM-001 frontend tests: PASS");

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..", "..");
const client = fs.readFileSync(
  path.join(root, "SRC/api/dle-api-client.js"), "utf8"
);
const viewer = fs.readFileSync(
  path.join(root, "SRC/modules/canonical-data-viewer/canonical-data-viewer.js"),
  "utf8"
);
const template = fs.readFileSync(
  path.join(root, "SRC/modules/canonical-data-viewer/canonical-data-viewer.html"),
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
  /canonicalReceivingHistory:\s*'\/api\/platform\/live\/v1\/receiving-history'/
);
assert.match(
  client,
  /canonicalReceivingHistoryMetadata:\s*'\/api\/platform\/live\/v1\/receiving-history\/metadata'/
);
assert.match(client, /getCanonicalReceivingHistory\(options = \{\}\)/);
assert.match(client, /getCanonicalReceivingHistoryLine\(purchaseReceiptLineId/);
assert.match(client, /getCanonicalReceivingHistoryMetadata\(options = \{\}\)/);
assert.match(
  template,
  /data-canonical-tab="receivingHistory">Receiving History<\/button>/
);
assert.match(viewer, /title:\s*"Receiving History"/);
assert.match(viewer, /identifier:\s*"purchaseReceiptLineId"/);
assert.match(viewer, /name:\s*"quantityPostedSigned"/);
assert.match(viewer, /name:\s*"quantityDispositionStatus"/);
assert.match(viewer, /name:\s*"orderDateIso",\s*label:\s*"Order Date",\s*isoDate:\s*true/);
assert.match(viewer, /name:\s*"orderDateRaw",[\s\S]*label:\s*"Order Date Raw",[\s\S]*rawDate:\s*true/);
assert.match(viewer, /name:\s*"orderDateResolutionStatus",[\s\S]*label:\s*"Order Date Resolution"/);
assert.match(viewer, /name:\s*"orderDateResolutionReason",[\s\S]*label:\s*"Order Date Resolution Detail"/);
assert.match(viewer, /name:\s*"receiptDateRaw",[\s\S]*label:\s*"Receipt Date Raw"/);
assert.match(viewer, /name:\s*"receiptDateResolutionStatus",[\s\S]*label:\s*"Receipt Date Resolution"/);
assert.match(viewer, /name:\s*"requiredDateRaw",[\s\S]*label:\s*"Required Date Raw"/);
assert.match(viewer, /name:\s*"requiredDateResolutionStatus",[\s\S]*label:\s*"Required Date Resolution"/);
assert.match(viewer, /Invalid source value/);
assert.match(
  viewer,
  /Missing PO reference \(source value blank\)/
);
assert.match(
  viewer,
  /activeProfileKey !== "live" \|\| !state\.receivingHistoryAvailable/
);
assert.doesNotMatch(erpRefresh, /ReceivingHistoryImportRun|PurchaseReceipt/);
assert.doesNotMatch(invoiceRefresh, /ReceivingHistoryImportRun|PurchaseReceipt/);

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
  page: 4,
  pageSize: 100,
  receiverNumber: " 819 ",
  purchaseOrderNumber: " 44118 ",
  purchaseOrderLineNumber: " 5 ",
  vendorNumber: " 31 ",
  vendorName: " IEC ",
  itemNumber: "500144-103",
  packingSlipNumber: " PS-100 ",
  workOrderNumber: " 5 ",
  warehouseId: " 01 ",
  rejectedOnly: "true",
  returnedOnly: "false"
};
await context.window.DleApiClient.liveCanonical
  .getCanonicalReceivingHistory(typed);
assert.match(requestedUrl, /page=4(?:&|$)/);
assert.match(requestedUrl, /pageSize=100(?:&|$)/);
assert.match(requestedUrl, /receiverNumber=0000819(?:&|$)/);
assert.match(requestedUrl, /purchaseOrderNumber=0044118(?:&|$)/);
assert.match(requestedUrl, /purchaseOrderLineNumber=005(?:&|$)/);
assert.match(requestedUrl, /vendorNumber=000031(?:&|$)/);
assert.match(requestedUrl, /vendorName=IEC(?:&|$)/);
assert.match(requestedUrl, /itemNumber=500144-103(?:&|$)/);
assert.match(requestedUrl, /packingSlipNumber=PS-100(?:&|$)/);
assert.match(requestedUrl, /workOrderNumber=0000005(?:&|$)/);
assert.match(requestedUrl, /warehouseId=01(?:&|$)/);
assert.match(requestedUrl, /rejectedOnly=true(?:&|$)/);
assert.match(requestedUrl, /returnedOnly=false(?:&|$)/);
assert.equal(typed.receiverNumber, " 819 ");
assert.equal(typed.itemNumber, "500144-103");

await context.window.DleApiClient.liveCanonical
  .getCanonicalReceivingHistoryLine(
    "30313030303137342020202020202030303330353131303130"
  );
assert.match(
  requestedUrl,
  /\/receiving-history\/30313030303137342020202020202030303330353131303130$/
);

assert.throws(
  () => context.window.DleApiClient.liveCanonical
    .getCanonicalReceivingHistoryLine("not-a-receipt"),
  /50-character hexadecimal/
);

console.log("RECEIVING-HISTORY-PLATFORM-001 frontend tests: PASS");

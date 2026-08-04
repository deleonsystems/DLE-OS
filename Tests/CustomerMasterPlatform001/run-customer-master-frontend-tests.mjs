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
const invoiceRefresh = fs.readFileSync(
  path.join(root, "Tools/InvoiceHistory/Invoke-InvoiceHistoryRefresh.ps1"),
  "utf8"
);

assert.match(
  client,
  /canonicalCustomerMaster:\s*'\/api\/platform\/live\/v1\/customer-master'/
);
assert.match(
  client,
  /canonicalCustomerMasterMetadata:\s*'\/api\/platform\/live\/v1\/customer-master\/metadata'/
);
assert.match(client, /getCanonicalCustomerMaster\(options = \{\}\)/);
assert.match(client, /getCanonicalCustomer\(customerMasterId, options = \{\}\)/);
assert.match(client, /getCanonicalCustomerAddresses\(customerMasterId, options = \{\}\)/);
assert.match(client, /getCanonicalCustomerMasterMetadata\(options = \{\}\)/);
assert.match(template, /data-canonical-tab="customerMaster">Customer Master<\/button>/);
assert.match(viewer, /title:\s*"Customer Master"/);
assert.match(viewer, /identifier:\s*"customerMasterId"/);
assert.match(viewer, /listMethod:\s*"getCanonicalCustomerMaster"/);
assert.match(viewer, /lookupMethod:\s*"getCanonicalCustomer"/);
assert.match(viewer, /name:\s*"customerNumber"/);
assert.match(viewer, /name:\s*"postalCode"/);
assert.match(viewer, /name:\s*"contactName"/);
assert.match(viewer, /name:\s*"alternateShipToCount"/);
assert.match(viewer, /name:\s*"customerMasterImportRunId"/);
assert.match(
  viewer,
  /activeProfileKey !== "live" \|\| !state\.customerMasterAvailable/
);
assert.doesNotMatch(refresh, /CustomerMaster|CustomerAddress/i);
assert.doesNotMatch(invoiceRefresh, /CustomerMaster|CustomerAddress/i);

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
  page: 4,
  pageSize: 100,
  customerNumber: " 1148 ",
  customerName: " Hughey ",
  postalCode: " 32321 ",
  contactName: " Sales ",
  salespersonCode: " 01 ",
  territoryCode: " WEST "
};
await browserContext.window.DleApiClient.liveCanonical
  .getCanonicalCustomerMaster(typed);

assert.match(requestedUrl, /page=4(?:&|$)/);
assert.match(requestedUrl, /pageSize=100(?:&|$)/);
assert.match(requestedUrl, /customerNumber=001148(?:&|$)/);
assert.match(requestedUrl, /customerName=Hughey(?:&|$)/);
assert.match(requestedUrl, /postalCode=32321(?:&|$)/);
assert.match(requestedUrl, /contactName=Sales(?:&|$)/);
assert.match(requestedUrl, /salespersonCode=01(?:&|$)/);
assert.match(requestedUrl, /territoryCode=WEST(?:&|$)/);
assert.equal(typed.customerNumber, " 1148 ");
assert.equal(typed.customerName, " Hughey ");

await browserContext.window.DleApiClient.liveCanonical
  .getCanonicalCustomer("01001148");
assert.match(requestedUrl, /\/customer-master\/01001148$/);

await browserContext.window.DleApiClient.liveCanonical
  .getCanonicalCustomerAddresses("01001148");
assert.match(requestedUrl, /\/customer-master\/01001148\/addresses$/);

console.log("CUSTOMER-MASTER-PLATFORM-001 frontend tests: PASS (31 assertions)");

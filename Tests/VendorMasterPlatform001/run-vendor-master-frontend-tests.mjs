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
  /canonicalVendorMaster:\s*'\/api\/platform\/live\/v1\/vendor-master'/
);
assert.match(
  client,
  /canonicalVendorMasterMetadata:\s*'\/api\/platform\/live\/v1\/vendor-master\/metadata'/
);
assert.match(client, /getCanonicalVendorMaster\(options = \{\}\)/);
assert.match(client, /getCanonicalVendor\(vendorMasterId, options = \{\}\)/);
assert.match(client, /getCanonicalVendorAddresses\(vendorMasterId, options = \{\}\)/);
assert.match(client, /getCanonicalVendorMasterMetadata\(options = \{\}\)/);
assert.match(template, /data-canonical-tab="vendorMaster">Vendor Master<\/button>/);
assert.match(viewer, /title:\s*"Vendor Master"/);
assert.match(viewer, /identifier:\s*"vendorMasterId"/);
assert.match(viewer, /listMethod:\s*"getCanonicalVendorMaster"/);
assert.match(viewer, /lookupMethod:\s*"getCanonicalVendor"/);
assert.match(viewer, /name:\s*"vendorNumber"/);
assert.match(viewer, /name:\s*"postalCode"/);
assert.match(viewer, /name:\s*"contactName"/);
assert.match(viewer, /name:\s*"purchasingAddressCount"/);
assert.match(viewer, /name:\s*"vendorMasterImportRunId"/);
assert.match(
  viewer,
  /activeProfileKey !== "live" \|\| !state\.vendorMasterAvailable/
);
assert.doesNotMatch(refresh, /VendorMaster|VendorAddress/i);
assert.doesNotMatch(invoiceRefresh, /VendorMaster|VendorAddress/i);

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
  vendorNumber: " 34 ",
  vendorName: " IEC ",
  postalCode: " 32321 ",
  contactName: " TOM ",
  paymentTermsCode: " 01 "
};
await browserContext.window.DleApiClient.liveCanonical
  .getCanonicalVendorMaster(typed);

assert.match(requestedUrl, /page=4(?:&|$)/);
assert.match(requestedUrl, /pageSize=100(?:&|$)/);
assert.match(requestedUrl, /vendorNumber=000034(?:&|$)/);
assert.match(requestedUrl, /vendorName=IEC(?:&|$)/);
assert.match(requestedUrl, /postalCode=32321(?:&|$)/);
assert.match(requestedUrl, /contactName=TOM(?:&|$)/);
assert.match(requestedUrl, /paymentTermsCode=01(?:&|$)/);
assert.equal(typed.vendorNumber, " 34 ");
assert.equal(typed.vendorName, " IEC ");

await browserContext.window.DleApiClient.liveCanonical
  .getCanonicalVendor("01000034");
assert.match(requestedUrl, /\/vendor-master\/01000034$/);

await browserContext.window.DleApiClient.liveCanonical
  .getCanonicalVendorAddresses("01000034");
assert.match(requestedUrl, /\/vendor-master\/01000034\/addresses$/);

console.log("VENDOR-MASTER-PLATFORM-001 frontend tests: PASS");

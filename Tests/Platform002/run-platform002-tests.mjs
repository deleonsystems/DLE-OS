import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

console.log("PLATFORM-002 frontend tests: PASS (15 assertions)");

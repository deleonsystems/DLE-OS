import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const client = fs.readFileSync(path.join(root, "SRC/api/dle-api-client.js"), "utf8");
const viewer = fs.readFileSync(
  path.join(root, "SRC/modules/canonical-data-viewer/canonical-data-viewer.js"),
  "utf8"
);
const template = fs.readFileSync(
  path.join(root, "SRC/modules/canonical-data-viewer/canonical-data-viewer.html"),
  "utf8"
);
const shell = fs.readFileSync(path.join(root, "DLE_Work_Center_v4.0.0.html"), "utf8");

assert.match(client, /canonicalReferenceCodes:\s*'\/api\/platform\/live\/v1\/reference-codes'/);
assert.match(client, /getCanonicalReferenceCodes\(options = \{\}\)/);
assert.match(client, /getCanonicalReferenceCode\(referenceCodeId, options = \{\}\)/);
assert.match(client, /getCanonicalReferenceCodeMetadata\(options = \{\}\)/);
assert.match(client, /'codeDomain', 'codeType', 'codeValue', 'description'/);
assert.match(template, /data-canonical-tab="referenceCodes">Code References<\/button>/);
assert.match(viewer, /title:\s*"Code References"/);
assert.match(viewer, /identifier:\s*"referenceCodeId"/);
assert.match(viewer, /label:\s*"Domain"/);
assert.match(viewer, /label:\s*"Code Type"/);
assert.match(viewer, /label:\s*"Resolution Status"/);
assert.match(viewer, /name:\s*"sourceType",\s*label:\s*"Source Type"/);
assert.match(viewer, /name:\s*"usageCount",\s*label:\s*"Usage Count"/);
assert.match(viewer, /referenceCodesAvailable:\s*false/);
assert.match(viewer, /getCanonicalReferenceCodeMetadata/);
assert.match(viewer, /referenceCodeResult\.value\?\.referenceCodeCount/);
assert.match(viewer, /\[data-canonical-tab="referenceCodes"\]/);
assert.match(viewer, /name:\s*"paymentTermsDescription"/);
assert.match(viewer, /name:\s*"lineCodeDescription"/);
assert.match(viewer, /name:\s*"unitOfMeasureResolutionStatus"/);
assert.match(shell, /dle-api-client\.js\?v=20260730-02/);
assert.match(shell, /canonical-data-viewer\.js\?v=20260730-02/);
assert.doesNotMatch(client, /method:\s*['"]POST['"].*reference-codes/s);
assert.doesNotMatch(viewer, /contenteditable/i);

console.log("Supporting Code Tables frontend tests: 24/24 PASS");

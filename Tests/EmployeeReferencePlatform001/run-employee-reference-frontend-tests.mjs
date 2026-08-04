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
const shell = fs.readFileSync(
  path.join(root, "DLE_Work_Center_v4.0.0.html"), "utf8"
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
  /canonicalEmployeeReference:\s*'\/api\/platform\/live\/v1\/employee-reference'/
);
assert.match(
  client,
  /canonicalEmployeeReferenceMetadata:\s*'\/api\/platform\/live\/v1\/employee-reference\/metadata'/
);
assert.match(client, /getCanonicalEmployeeReference\(options = \{\}\)/);
assert.match(client, /getCanonicalEmployee\(employeeReferenceId/);
assert.match(client, /getCanonicalEmployeeCodes\(employeeReferenceId/);
assert.match(client, /getCanonicalEmployeeReferenceMetadata\(options = \{\}\)/);
assert.match(
  template,
  /data-canonical-tab="employeeReference">Employee Reference<\/button>/
);
assert.match(viewer, /title:\s*"Employee Reference"/);
assert.match(viewer, /identifier:\s*"employeeReferenceId"/);
assert.match(viewer, /name:\s*"employeeNumber"/);
assert.match(viewer, /name:\s*"operationalCodes"/);
assert.match(
  viewer,
  /activeProfileKey !== "live" \|\| !state\.employeeReferenceAvailable/
);
assert.match(shell, /dle-api-client\.js\?v=20260730-01/);
assert.match(shell, /canonical-data-viewer\.js\?v=20260730-01/);
assert.doesNotMatch(
  viewer + client,
  /socialSecurity|payRate|salary|birthDate|homeAddress|password|deduction/i
);
assert.doesNotMatch(
  erpRefresh + invoiceRefresh,
  /EmployeeReferenceImportRun|employee-reference/
);

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
  page: 2,
  pageSize: 25,
  employeeNumber: " 54 ",
  employeeName: " Smith-Jones ",
  department: " OPS ",
  jobTitle: " Lead ",
  isActive: "true",
  operationalCode: " A-B ",
  codeType: "Operator"
};
await context.window.DleApiClient.liveCanonical
  .getCanonicalEmployeeReference(typed);
assert.match(requestedUrl, /page=2(?:&|$)/);
assert.match(requestedUrl, /pageSize=25(?:&|$)/);
assert.match(requestedUrl, /employeeNumber=000000054(?:&|$)/);
assert.match(requestedUrl, /employeeName=Smith-Jones(?:&|$)/);
assert.match(requestedUrl, /department=OPS(?:&|$)/);
assert.match(requestedUrl, /jobTitle=Lead(?:&|$)/);
assert.match(requestedUrl, /isActive=true(?:&|$)/);
assert.match(requestedUrl, /operationalCode=A-B(?:&|$)/);
assert.match(requestedUrl, /codeType=Operator(?:&|$)/);
assert.equal(typed.employeeNumber, " 54 ");
assert.equal(typed.employeeName, " Smith-Jones ");

await context.window.DleApiClient.liveCanonical
  .getCanonicalEmployee("01000000054");
assert.match(requestedUrl, /\/employee-reference\/01000000054$/);
await context.window.DleApiClient.liveCanonical
  .getCanonicalEmployeeCodes("01000000054");
assert.match(requestedUrl, /\/employee-reference\/01000000054\/codes$/);
assert.throws(
  () => context.window.DleApiClient.liveCanonical
    .getCanonicalEmployee("54"),
  /firm and employee number/
);

console.log("EMPLOYEE-REFERENCE-PLATFORM-001 frontend tests: PASS");

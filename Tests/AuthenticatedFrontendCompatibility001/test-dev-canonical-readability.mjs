import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const repository = path.resolve(import.meta.dirname, "..", "..");
const clientSource = fs.readFileSync(
  path.join(repository, "SRC", "api", "dle-api-client.js"), "utf8");
const viewerSource = fs.readFileSync(
  path.join(repository, "SRC", "modules", "canonical-data-viewer",
    "canonical-data-viewer.js"), "utf8");

const requestedUrls = [];
const readiness = {
  dataEnvironment: "LIVE",
  database: "DLE_OS_CANONICAL_LIVE",
  contractVersion: "1.2",
  readinessVerdict: "NotReady",
  readinessState: "NotReadySourceCheckExpired",
  sourceChangeStatus: "Qualified",
  currentImportRunId: "906483ce-5774-4aba-bbb5-9a43e0afa8d2",
  packageHash: "DAAD29207D2BC1B23317F2645FE7B73BC7AC22A965A440EAEA4FB76F06744BE2",
  snapshotTimestampUtc: "2026-08-04T21:36:10.6282654Z",
  totalCount: 42326
};
const snapshot = { ...readiness };
const fetchImplementation = async url => {
  requestedUrls.push(String(url));
  const pathName = new URL(String(url)).pathname;
  if (pathName.endsWith("/readiness")) {
    return new Response(JSON.stringify(readiness), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (pathName.endsWith("/snapshot")) {
    return Response.json(snapshot);
  }
  return Response.json({
    items: [{ id: "representative" }],
    page: 1,
    pageSize: 1,
    totalItems: 1,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
  });
};
const window = {
  DleOsRuntimeConfig: { environment: "ISOLATED_DEVELOPMENT" },
  location: new URL("https://dev.dle-os.internal.dlemfg.com/shared"),
  setTimeout,
  clearTimeout
};
vm.runInNewContext(clientSource, {
  window,
  localStorage: { getItem: () => null },
  fetch: fetchImplementation,
  URL,
  URLSearchParams,
  AbortController,
  console
}, { filename: "dle-api-client.js" });

await assert.rejects(
  window.DleApiClient.liveCanonical.getPlatformReadiness(),
  error => error.status === 503 &&
    error.payload?.readinessState === "NotReadySourceCheckExpired");
await window.DleApiClient.liveCanonical.getPlatformSnapshot();
await window.DleApiClient.liveCanonical.getCanonicalSalesOrders({ page: 1, pageSize: 1 });
await window.DleApiClient.liveCanonical.getCanonicalWorkOrders({ page: 1, pageSize: 1 });
assert.ok(requestedUrls.every(url =>
  new URL(url).origin === "https://dev.dle-os.internal.dlemfg.com"));

function extractFunction(name) {
  const match = viewerSource.match(
    new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}"));
  assert.ok(match, name + " is present");
  return match[0];
}
const functions = [
  extractFunction("readinessVerdict"),
  extractFunction("snapshotIsReady"),
  extractFunction("canonicalReadAvailability")
].join("\n");
function evaluateAvailability({ development = true, profile = "live",
  readinessPayload = readiness, snapshotPayload = snapshot } = {}) {
  const context = {
    IS_ISOLATED_DEVELOPMENT: development,
    activeProfileKey: profile,
    readinessPayload,
    snapshotPayload
  };
  vm.runInNewContext(functions +
    "\nresult = canonicalReadAvailability(readinessPayload, snapshotPayload);", context);
  return context.result;
}

assert.equal(evaluateAvailability(), "qualified-stale");
assert.equal(evaluateAvailability({ development: false }), "blocked");
assert.equal(evaluateAvailability({ profile: "historical" }), "blocked");
assert.equal(evaluateAvailability({
  readinessPayload: { ...readiness, readinessState: "NotReadyIntegrityFailure" }
}), "blocked");
assert.equal(evaluateAvailability({
  snapshotPayload: { ...snapshot, sourceChangeStatus: "Unqualified" }
}), "blocked");
assert.equal(evaluateAvailability({
  readinessPayload: { ...readiness, readinessVerdict: "Ready" },
  snapshotPayload: { ...snapshot, readinessVerdict: "Ready" }
}), "ready");

console.log("PASS: isolated DEV canonical readability remains fail-closed except for the exact qualified stale snapshot state.");

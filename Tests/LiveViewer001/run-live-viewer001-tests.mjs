import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { performance } from "node:perf_hooks";

const root = path.resolve(import.meta.dirname, "..", "..");
const serverRoot = process.env.DLE_OS_SERVER_ROOT || "C:\\DLE-OS\\Repositories\\DLE-OS-Server";
const historicalBaseUrl = process.env.LIVE_VIEWER_HISTORICAL_BASE_URL || "http://DLE-OS-HOST:5041";
const liveBaseUrl = "http://DLE-OS-HOST:5042";
const allowedOrigin = "http://dle-os-host:5041";
const expectedPackageHash = "BFEAAAF09C6690120CF85E64BEBECBBADB3C049214CCCF9BB993D19363110E77";
const expectedImportRunId = "e66391d9-7422-4c6f-9992-feed3d401a75";
const artifactDirectory = path.join(root, "Artifacts", "LiveViewer001", "AutomatedTests");
const files = {
  shell: readRoot("DLE_Work_Center_v4.0.0.html"),
  client: readRoot("SRC/api/dle-api-client.js"),
  viewerHtml: readRoot("SRC/modules/canonical-data-viewer/canonical-data-viewer.html"),
  viewerCss: readRoot("SRC/modules/canonical-data-viewer/canonical-data-viewer.css"),
  viewerJs: readRoot("SRC/modules/canonical-data-viewer/canonical-data-viewer.js"),
  serverProgram: readServer("Program.cs"),
  liveConfig: readServer("appsettings.Live.json"),
  liveBaseConfig: readServer("appsettings.Live.Base.json"),
  launcher: readServer("DleOs.PlatformApi.Tests/Start-LiveCanonicalApiAsDedicatedIdentity.ps1")
};
const results = [];

function readRoot(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readServer(relativePath) {
  return fs.readFileSync(path.join(serverRoot, relativePath), "utf8");
}

function makeClient(fetchImplementation = fetch) {
  const window = {
    DLE_API_CONFIG: { enabled: true, baseUrl: historicalBaseUrl },
    location: new URL(allowedOrigin),
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext({
    window,
    localStorage: { getItem: () => null },
    fetch: fetchImplementation,
    URLSearchParams,
    AbortController,
    console
  });
  vm.runInContext(files.client, context, { filename: "dle-api-client.js" });
  return window.DleApiClient;
}

async function test(name, action) {
  const started = performance.now();
  try {
    await action();
    results.push({
      name,
      result: "PASS",
      elapsedMilliseconds: Math.round(performance.now() - started),
      detail: "PASS"
    });
  } catch (error) {
    results.push({
      name,
      result: "FAIL",
      elapsedMilliseconds: Math.round(performance.now() - started),
      detail: String(error?.message || error).replace(/[\r\n]+/g, " ")
    });
  }
}

await test("01_separate_platform_navigation", () => {
  assert.match(files.viewerHtml, /Canonical Data Viewer\s+—\s+Test Data/);
  assert.match(files.viewerHtml, /Canonical Data Viewer\s+—\s+Live Snapshot/);
  assert.match(files.viewerHtml, /data-canonical-profile="historical"/);
  assert.match(files.viewerHtml, /data-canonical-profile="live"/);
  assert.match(files.viewerJs, /viewerStates/);
  assert.match(files.viewerJs, /activeProfileKey = "historical"/);
});

await test("02_unavoidable_live_read_only_banner", () => {
  assert.ok(files.viewerJs.includes("LIVE SOURCE SNAPSHOT — READ ONLY"));
  assert.ok(files.viewerJs.includes("This is not real-time data."));
  assert.match(files.viewerCss, /\[data-canonical-active-profile="live"\][\s\S]*?canonical-viewer__warning/);
  assert.doesNotMatch(files.viewerJs, /dismiss.*banner|hide.*banner/i);
});

await test("03_complete_live_metadata_surface", () => {
  for (const expected of [
    'data-canonical-status="environment"',
    'data-canonical-status="database"',
    'data-canonical-status="contract"',
    'data-canonical-status="snapshot-at"',
    'data-canonical-status="snapshot-age"',
    'data-canonical-status="freshness"',
    "data-canonical-mirror-run-id",
    "data-canonical-import-run-id",
    "data-canonical-package-hash",
    'data-canonical-count="billOfMaterial"',
    'data-canonical-count="inventoryItem"',
    'data-canonical-count="workOrder"',
    'data-canonical-count="generalLedgerAccount"',
    'data-canonical-status="total"'
  ]) {
    assert.ok(files.viewerHtml.includes(expected), expected);
  }
});

await test("04_explicit_live_client_boundary", async () => {
  const urls = [];
  const methods = [];
  const client = makeClient(async (url, options) => {
    urls.push(String(url));
    methods.push(options?.method);
    return new Response(JSON.stringify({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 0,
      hasPreviousPage: false,
      hasNextPage: false
    }), { headers: { "Content-Type": "application/json" } });
  });
  await client.liveCanonical.getCanonicalWorkOrders({ workOrderNumber: "5" });
  assert.equal(
    urls[0],
    liveBaseUrl + "/api/platform/live/v1/work-orders?page=1&pageSize=50&workOrderNumber=0000005"
  );
  assert.deepEqual(methods, ["GET"]);
  assert.equal(client.liveCanonical.baseUrl, liveBaseUrl);
  assert.doesNotMatch(files.client, /live.*fallback|fallback.*live/i);
});

await test("05_work_order_normalization_and_visible_value", async () => {
  const cases = [
    ["5", "0000005"],
    ["102362", "0102362"],
    ["0000005", "0000005"],
    ["0102362", "0102362"],
    ["", null],
    ["  5  ", "0000005"],
    ["12345678", "12345678"]
  ];
  for (const [input, expected] of cases) {
    let requestedUrl = "";
    const client = makeClient(async url => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0 }));
    });
    await client.liveCanonical.getCanonicalWorkOrders({ workOrderNumber: input });
    assert.equal(new URL(requestedUrl).searchParams.get("workOrderNumber"), expected);
  }
  assert.match(files.viewerJs, /input\.value = entityState\.filters\[filter\.name\] \?\? ""/);
  assert.doesNotMatch(files.viewerJs, /input\.value = .*padStart/);
});

await test("06_preserved_viewer_behavior", () => {
  for (const expected of [
    "WORK_ORDER_SEARCH_DEBOUNCE_MS = 300",
    "data-canonical-live-search",
    "requestSequence",
    "controller.abort()",
    "resolvePageTarget",
    "goToPage(pageInput.value)",
    "submitFilters(filterForm)",
    "root.dataset.canonicalActiveProfile = activeProfileKey",
    "PAGE_SIZES = Object.freeze([25, 50, 100, 200])"
  ]) {
    assert.ok(files.viewerJs.includes(expected), expected);
  }
  assert.match(files.viewerHtml, /data-canonical-action="previous-page"/);
  assert.match(files.viewerHtml, /data-canonical-action="next-page"/);
  assert.match(files.viewerHtml, /data-canonical-action="go-to-page"/);
  assert.match(files.viewerHtml, /data-canonical-action="clear-filters"/);
  assert.match(files.viewerHtml, />Search<\/button>/);
  assert.doesNotMatch(files.viewerCss, /\.canonical-viewer\[data-canonical-profile=/);
});

await test("07_get_only_and_no_direct_sources", () => {
  const combined = files.client + files.viewerJs + files.viewerHtml;
  assert.doesNotMatch(files.viewerJs + files.viewerHtml, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(files.client, /method:\s*['"](?:PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(combined, /X:\\|SqlConnection|LiveMirror|backup/i);
  assert.equal((files.client.match(/method:\s*['"]GET['"]/g) || []).length, 1);
});

await test("08_exact_origin_cors_configuration", () => {
  const liveConfig = JSON.parse(files.liveConfig);
  assert.equal(new URL(liveConfig.LiveApi.AllowedBrowserOrigin).origin, allowedOrigin);
  assert.equal(liveConfig.Kestrel.Endpoints.Http.Url, liveBaseUrl);
  assert.equal(liveConfig.AllowedHosts, "DLE-OS-HOST");
  assert.equal(JSON.parse(files.liveBaseConfig).AllowedHosts, "DLE-OS-HOST");
  assert.match(files.serverProgram, /\.WithOrigins\("http:\/\/dle-os-host:5041"\)/);
  assert.match(files.serverProgram, /\.WithMethods\(HttpMethods\.Get\)/);
  assert.doesNotMatch(files.serverProgram, /AllowAnyOrigin|WithOrigins\([^)]*\*/);
  assert.match(files.launcher, /AllowedBrowserOrigin[\s\S]*?'http:\/\/dle-os-host:5041'/);
});

await test("09_live_readiness_and_snapshot", async () => {
  const client = makeClient();
  const [readiness, snapshot] = await Promise.all([
    client.liveCanonical.getPlatformReadiness(),
    client.liveCanonical.getPlatformSnapshot()
  ]);
  for (const payload of [readiness, snapshot]) {
    assert.equal(payload.dataEnvironment, "LIVE");
    assert.equal(payload.database, "DLE_OS_CANONICAL_LIVE");
    assert.equal(payload.contractVersion, "1.2");
    assert.equal(payload.readinessVerdict, "Ready");
    assert.equal(payload.packageHash, expectedPackageHash);
    assert.equal(String(payload.currentImportRunId).toLowerCase(), expectedImportRunId);
    assert.equal(payload.totalCount, 42322);
    assert.deepEqual(
      JSON.parse(JSON.stringify(payload.entityCounts)),
      { billOfMaterial: 1290, inventoryItem: 28662, workOrder: 12113, generalLedgerAccount: 257 }
    );
  }
  assert.equal(readiness.freshnessStatus, "Fresh");
  assert.equal(snapshot.freshnessStatus, "Fresh");
});

await test("10_all_four_live_lists_and_counts", async () => {
  const client = makeClient();
  const responses = await Promise.all([
    client.liveCanonical.getCanonicalBillsOfMaterial({ page: 1, pageSize: 25 }),
    client.liveCanonical.getCanonicalInventoryItems({ page: 1, pageSize: 25 }),
    client.liveCanonical.getCanonicalWorkOrders({ page: 1, pageSize: 25 }),
    client.liveCanonical.getCanonicalGeneralLedgerAccounts({ page: 1, pageSize: 25 })
  ]);
  assert.deepEqual(responses.map(response => response.totalItems), [1290, 28662, 12113, 257]);
  assert.ok(responses.every(response => response.page === 1 && response.pageSize === 25));
});

await test("11_live_work_order_exact_search", async () => {
  const client = makeClient();
  const [shortValue, fullValue, containsProbe] = await Promise.all([
    client.liveCanonical.getCanonicalWorkOrders({ workOrderNumber: "5", page: 1, pageSize: 50 }),
    client.liveCanonical.getCanonicalWorkOrders({ workOrderNumber: "0000005", page: 1, pageSize: 50 }),
    client.liveCanonical.getCanonicalWorkOrders({ workOrderNumber: "0000005x", page: 1, pageSize: 50 })
  ]);
  assert.equal(shortValue.totalItems, 1);
  assert.equal(shortValue.items[0]?.workOrderNumber, "0000005");
  assert.equal(fullValue.totalItems, 1);
  assert.equal(fullValue.items[0]?.workOrderNumber, "0000005");
  assert.equal(containsProbe.totalItems, 0);
});

await test("12_work_order_detail_lookup_and_schema_parity", async () => {
  const client = makeClient();
  const [liveShort, liveFive, livePadded, historicalFive, historicalPadded] =
    await Promise.all([
      client.liveCanonical.getCanonicalWorkOrder("115617"),
      client.liveCanonical.getCanonicalWorkOrder("5"),
      client.liveCanonical.getCanonicalWorkOrder("0115617"),
      client.getCanonicalWorkOrder("5"),
      client.getCanonicalWorkOrder("0102362")
    ]);

  assert.equal(liveShort.workOrderNumber, "0115617");
  assert.equal(liveFive.workOrderNumber, "0000005");
  assert.equal(livePadded.workOrderNumber, "0115617");
  assert.equal(historicalFive.workOrderNumber, "0000005");
  assert.equal(historicalPadded.workOrderNumber, "0102362");

  const expectedFields = [
    "workOrderNumber",
    "workOrderType",
    "workOrderStatus",
    "workOrderOpenedDate",
    "workOrderClosedDate",
    "workOrderOpenedDateIso",
    "workOrderClosedDateIso",
    "customerNumber",
    "salesOrderNumber",
    "salesOrderLineNumber",
    "unitOfMeasure",
    "bomRevision",
    "warehouseId",
    "itemNumber",
    "itemDescription",
    "drawingNumber",
    "drawingRevision",
    "schProdQuantity",
    "nonStockDescriptionLine1",
    "nonStockDescriptionLine2"
  ].sort();
  assert.deepEqual(Object.keys(liveShort).sort(), expectedFields);
  assert.deepEqual(Object.keys(historicalPadded).sort(), expectedFields);
  assert.equal(liveShort.salesOrderNumber, "0012095");
  assert.equal(liveShort.salesOrderLineNumber, "010");
});

await test("13_live_direct_pagination", async () => {
  const client = makeClient();
  const first = await client.liveCanonical.getCanonicalWorkOrders({ page: 1, pageSize: 50 });
  const page75 = await client.liveCanonical.getCanonicalWorkOrders({ page: 75, pageSize: 50 });
  const last = await client.liveCanonical.getCanonicalWorkOrders({ page: first.totalPages, pageSize: 50 });
  assert.equal(first.page, 1);
  assert.equal(page75.page, 75);
  assert.equal(page75.pageSize, 50);
  assert.equal(last.page, first.totalPages);
  assert.ok(last.items.length > 0);
});

await test("14_historical_viewer_regression_count", async () => {
  const client = makeClient();
  const snapshot = await client.getPlatformSnapshot();
  assert.equal(snapshot.totalCount, 26902);
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshot.entityCounts)),
    { billOfMaterial: 523, inventoryItem: 20257, workOrder: 5868, generalLedgerAccount: 254 }
  );
});

await test("15_item_number_exact_search_both_profiles", async () => {
  const captured = [];
  const fakeClient = makeClient(async url => {
    captured.push(String(url));
    return new Response(JSON.stringify({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 0
    }));
  });
  await fakeClient.liveCanonical.getCanonicalInventoryItems({
    itemNumber: "500144-103"
  });
  await fakeClient.liveCanonical.getCanonicalWorkOrders({
    itemNumber: "500144-103"
  });
  assert.equal(
    new URL(captured[0]).searchParams.get("itemNumber"),
    "500144-103".padEnd(20)
  );
  assert.equal(
    new URL(captured[1]).searchParams.get("itemNumber"),
    "500144-103".padEnd(20)
  );
  assert.ok(captured.every(url => url.includes("500144-103")));

  const client = makeClient();
  const [liveInventory, liveWorkOrders, livePartial, livePageTwo,
    historicalInventory, historicalWorkOrders] = await Promise.all([
    client.liveCanonical.getCanonicalInventoryItems({
      itemNumber: "500144-103",
      page: 1,
      pageSize: 50
    }),
    client.liveCanonical.getCanonicalWorkOrders({
      itemNumber: "500144-103",
      page: 1,
      pageSize: 50
    }),
    client.liveCanonical.getCanonicalInventoryItems({
      itemNumber: "500144-10",
      page: 1,
      pageSize: 50
    }),
    client.liveCanonical.getCanonicalWorkOrders({
      itemNumber: "500144-103",
      page: 2,
      pageSize: 10
    }),
    client.getCanonicalInventoryItems({
      itemNumber: "500144-103",
      page: 1,
      pageSize: 50
    }),
    client.getCanonicalWorkOrders({
      itemNumber: "500144-103",
      page: 1,
      pageSize: 50
    })
  ]);
  assert.equal(liveInventory.totalItems, 1);
  assert.equal(liveWorkOrders.totalItems, 39);
  assert.ok(
    liveWorkOrders.items.some(item => item.workOrderNumber === "0115617")
  );
  assert.equal(livePartial.totalItems, 0);
  assert.equal(livePageTwo.totalItems, 39);
  assert.equal(livePageTwo.page, 2);
  assert.equal(livePageTwo.pageSize, 10);
  assert.equal(historicalInventory.totalItems, 1);
  assert.equal(historicalWorkOrders.totalItems, 21);
  assert.ok(
    [
      ...liveInventory.items,
      ...liveWorkOrders.items,
      ...livePageTwo.items,
      ...historicalInventory.items,
      ...historicalWorkOrders.items
    ].every(item => item.itemNumber === "500144-103".padEnd(20))
  );
});

fs.mkdirSync(artifactDirectory, { recursive: true });
const report = {
  mission: "LIVE-VIEWER-001",
  completedAtUtc: new Date().toISOString(),
  allowedOrigin,
  historicalBaseUrl,
  liveBaseUrl,
  passed: results.filter(result => result.result === "PASS").length,
  failed: results.filter(result => result.result === "FAIL").length,
  results
};
fs.writeFileSync(
  path.join(artifactDirectory, "qualification-results.json"),
  JSON.stringify(report, null, 2) + "\n"
);

for (const result of results) {
  console.log(result.result.padEnd(4), result.name, "(" + result.elapsedMilliseconds + " ms)");
}
console.log(`LIVE-VIEWER-001 automated qualification: ${report.passed} passed, ${report.failed} failed.`);
if (report.failed) process.exitCode = 1;

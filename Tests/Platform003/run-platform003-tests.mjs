import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { performance } from "node:perf_hooks";

const root = path.resolve(import.meta.dirname, "..", "..");
const artifactDirectory = path.join(root, "Artifacts", "Platform003", "Tests");
const apiBaseUrl = process.env.PLATFORM003_API_BASE_URL || "http://127.0.0.1:5041";
const files = {
  shell: read("DLE_Work_Center_v4.0.0.html"),
  registry: read("SRC/shell/workspace-registry.js"),
  apiClient: read("SRC/api/dle-api-client.js"),
  moduleHtml: read("SRC/modules/canonical-data-viewer/canonical-data-viewer.html"),
  moduleCss: read("SRC/modules/canonical-data-viewer/canonical-data-viewer.css"),
  moduleJs: read("SRC/modules/canonical-data-viewer/canonical-data-viewer.js")
};
const results = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function makeClient(fetchImplementation = fetch) {
  const window = {
    DLE_API_CONFIG: { enabled: true, baseUrl: apiBaseUrl },
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
  vm.runInContext(files.apiClient, context, { filename: "dle-api-client.js" });
  return window.DleApiClient;
}

function makeModuleController() {
  const window = { DleWorkspaces: {}, setTimeout, clearTimeout };
  const document = {};
  const context = vm.createContext({
    window,
    document,
    AbortController,
    FormData,
    console
  });
  vm.runInContext(files.moduleJs, context, { filename: "canonical-data-viewer.js" });
  return window.DleWorkspaces.platform;
}

function getModuleFunction(name) {
  const match = files.moduleJs.match(new RegExp("function " + name + "\\([\\s\\S]*?\\n  \\}"));
  assert.ok(match, name + " function is present");
  return vm.runInNewContext("(" + match[0] + ")");
}

async function test(name, action) {
  const started = performance.now();
  try {
    await action();
    results.push({ name, result: "PASS", elapsedMilliseconds: Math.round(performance.now() - started), detail: "PASS" });
  } catch (error) {
    results.push({
      name,
      result: "FAIL",
      elapsedMilliseconds: Math.round(performance.now() - started),
      detail: String(error?.message || error).replace(/[\r\n]+/g, " ")
    });
  }
}

await test("01_navigation_registration", () => {
  assert.match(files.registry, /id:\s*"platform"[\s\S]*?label:\s*"Platform"/);
  assert.match(files.shell, /data-workspace-home="platform"/);
  assert.match(files.moduleHtml, /Canonical Data Viewer — Test Data/);
});

await test("02_module_load_once", () => {
  assert.equal((files.shell.match(/canonical-data-viewer\.css/g) || []).length, 1);
  assert.equal((files.shell.match(/canonical-data-viewer\.js/g) || []).length, 1);
  assert.match(files.moduleJs, /dataset\.workspaceLoaded = "true"/);
  assert.match(files.moduleJs, /if \(!mounted\)/);
});

await test("03_test_data_banner_persistent", () => {
  for (const text of ["HISTORICAL TEST DATA", "Read-only canonical snapshot", "Source: DLE_OS_PLATFORM_LAB", "Contract: V1.2", "Not live Add+ON data"]) {
    assert.ok(files.moduleHtml.includes(text), text);
  }
  assert.doesNotMatch(files.moduleHtml, /dismiss|hide warning/i);
});

await test("04_readiness_ready_live", async () => {
  const value = await makeClient().getPlatformReadiness();
  assert.equal(value.status, "Ready");
  assert.equal(value.contractVersion, "V1.2");
});

await test("05_readiness_failure_has_no_fallback", async () => {
  const client = makeClient(async () => new Response(JSON.stringify({
    code: "snapshot_unavailable",
    message: "Canonical snapshot is unavailable."
  }), { status: 503, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(client.getPlatformReadiness(), error => error.status === 503 && error.code === "snapshot_unavailable");
  assert.doesNotMatch(files.moduleJs, /getJsonWithFallback|DATA\/|\.csv|mirror engine/i);
});

await test("06_snapshot_metadata_live", async () => {
  const value = await makeClient().getPlatformSnapshot();
  assert.equal(value.contractVersion, "V1.2");
  assert.equal(value.importStatus, "SUCCESS");
  assert.deepEqual(
    JSON.parse(JSON.stringify(value.entityCounts)),
    { billOfMaterial: 523, inventoryItem: 20257, workOrder: 5868, generalLedgerAccount: 254 }
  );
  assert.equal(value.totalCount, 26902);
});

await test("07_work_orders_default_tab", () => {
  assert.match(files.moduleJs, /activeEntity:\s*"workOrders"/);
  assert.match(files.moduleHtml, /id="canonicalTabWorkOrders"[\s\S]*?aria-selected="true"/);
});

await test("08_work_order_pagination_live", async () => {
  const value = await makeClient().getCanonicalWorkOrders({ page: 2, pageSize: 25 });
  assert.equal(value.page, 2);
  assert.equal(value.pageSize, 25);
  assert.equal(value.items.length, 25);
});

await test("09_work_order_stocked_description_live", async () => {
  const value = await makeClient().getCanonicalWorkOrder("0000001");
  assert.equal(value.workOrderType, "S ");
  assert.equal(typeof value.itemDescription, "string");
  assert.ok(value.itemDescription.length > 0);
});

await test("10_work_order_nonstock_description_live", async () => {
  const value = await makeClient().getCanonicalWorkOrder("0000005");
  assert.equal(value.workOrderType, "N ");
  assert.equal(value.itemDescription, null);
  assert.equal(value.nonStockDescriptionLine1, "VACATION PAY CODE             ");
  assert.equal(value.nonStockDescriptionLine2, "                              ");
  assert.doesNotMatch(files.moduleJs, /nonStockDescriptionLine1\s*\+/);
});

await test("11_inventory_search_canonical_parameters", async () => {
  let requestedUrl = "";
  const client = makeClient(async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0 }));
  });
  await client.getCanonicalInventoryItems({ page: 1, pageSize: 50, itemNumber: "A+B", itemDescription: "BOARD", ignored: "no" });
  const url = new URL(requestedUrl);
  assert.deepEqual([...url.searchParams.keys()], ["page", "pageSize", "itemNumber", "itemDescription"]);
  assert.equal(url.searchParams.get("itemNumber"), "A+B".padEnd(20));
});

await test("12_bom_reserved_identifier_encoding_and_lookup", async () => {
  const captured = [];
  const fakeClient = makeClient(async url => {
    captured.push(String(url));
    return new Response(JSON.stringify({ billNumber: String(url) }));
  });
  await fakeClient.getCanonicalBillOfMaterial("+A*B ");
  assert.match(captured[0], /%2BA%2AB%20$/);

  const liveClient = makeClient();
  const plus = await liveClient.getCanonicalBillOfMaterial("+019057-1           ");
  const star = await liveClient.getCanonicalBillOfMaterial("*277-4163           ");
  assert.equal(plus.billNumber, "+019057-1           ");
  assert.equal(star.billNumber, "*277-4163           ");
});

await test("13_gl_three_member_boundary_live", async () => {
  const value = await makeClient().getCanonicalGeneralLedgerAccount("1000000000");
  assert.deepEqual(Object.keys(value), [
    "generalLedgerAccountNumber",
    "generalLedgerAccountDescription",
    "generalLedgerAccountType"
  ]);
});

await test("14_page_size_maximum", async () => {
  const client = makeClient();
  assert.throws(
    () => client.getCanonicalInventoryItems({ page: 1, pageSize: 201 }),
    error => error?.name === "RangeError"
  );
  assert.deepEqual(JSON.parse(JSON.stringify([25, 50, 100, 200])), [25, 50, 100, 200]);
  assert.match(files.moduleJs, /PAGE_SIZES = Object\.freeze\(\[25, 50, 100, 200\]\)/);
});

await test("15_stale_response_protection", () => {
  assert.match(files.moduleJs, /requestSequence/);
  assert.match(files.moduleJs, /sequence !== entityState\.requestSequence/);
  assert.match(files.moduleJs, /entityState\.request !== request/);
});

await test("16_safe_structured_error", async () => {
  const client = makeClient();
  await assert.rejects(
    client.getCanonicalWorkOrder("__PLATFORM003_MISSING__"),
    error => error.status === 404 && error.code === "canonical_record_not_found" && !/traceId|stack|server path/i.test(error.message)
  );
  assert.match(files.moduleJs, /safeErrorMessage/);
});

await test("17_no_write_http_methods", () => {
  const combined = files.apiClient + files.moduleJs;
  assert.doesNotMatch(combined, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.equal((combined.match(/method:\s*['"]GET['"]/g) || []).length, 1);
});

await test("18_no_direct_data_source_access", () => {
  assert.doesNotMatch(files.moduleJs, /getJsonWithFallback|connectionStrings|SqlConnection|X:\\|\.csv|Visual PRO\/5|Add\+ON/i);
  assert.doesNotMatch(files.apiClient, /DLE_OS_PLATFORM_LAB|X:\\|\.csv|SqlConnection/i);
});

await test("19_no_legacy_public_labels", () => {
  assert.doesNotMatch(files.moduleHtml + files.moduleJs, /DDM|SourceFile|MirrorColumn|Legacy Field|Field ID/i);
});

await test("20_module_cleanup", () => {
  for (const expected of ["removeEventListener", "abortAllRequests", "controller.abort()", "destroy"]) {
    assert.ok(files.moduleJs.includes(expected), expected);
  }
});

await test("21_all_35_v12_members", () => {
  assert.equal(makeModuleController().getQualificationState().approvedMemberCount, 35);
});

await test("22_raw_date_exact_display_policy", async () => {
  const value = await makeClient().getCanonicalWorkOrder("0000001");
  assert.equal(value.workOrderOpenedDate, "902836");
  assert.match(files.moduleJs, /Encoded source value retained for traceability/);
  assert.doesNotMatch(files.moduleJs, /toLocaleDateString|new Date\(record/);
});

await test("23_unscaled_decimal_exact_display_policy", async () => {
  const value = await makeClient().getCanonicalWorkOrder("0000001");
  assert.equal(value.schProdQuantity, "1");
  assert.match(files.moduleJs, /Exact unscaled text · preserved source value/);
  assert.doesNotMatch(files.moduleJs, /parseFloat|toFixed/);
});

await test("24_filter_allowlist_work_orders", async () => {
  let requestedUrl = "";
  const client = makeClient(async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0 }));
  });
  await client.getCanonicalWorkOrders({ workOrderNumber: "0000001", itemNumber: "A", status: "O", category: "forbidden" });
  const keys = [...new URL(requestedUrl).searchParams.keys()];
  assert.deepEqual(keys, ["page", "pageSize", "workOrderNumber", "itemNumber", "status"]);
});

await test("25_five_tabs_exact_order", () => {
  const labels = [...files.moduleHtml.matchAll(/data-canonical-tab="[^"]+">([^<]+)<\/button>/g)].map(match => match[1].trim());
  assert.deepEqual(labels, ["Work Orders", "Inventory Items", "Bills of Material", "General Ledger Accounts", "Sales Orders"]);
});

await test("26_get_only_live_list_and_lookup", async () => {
  const methods = [];
  const forwardingFetch = async (url, options) => {
    methods.push(options?.method);
    return fetch(url, options);
  };
  const client = makeClient(forwardingFetch);
  await client.getCanonicalBillsOfMaterial({ page: 1, pageSize: 1 });
  await client.getCanonicalGeneralLedgerAccount("1000000000");
  assert.deepEqual(methods, ["GET", "GET"]);
});

await test("27_no_display_count_constants", () => {
  assert.doesNotMatch(files.moduleHtml + files.moduleJs, /20,257|5,868|26,902|523|254/);
});

await test("28_accessibility_baseline", () => {
  for (const expected of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-live="polite"', 'aria-label="Result pages"']) {
    assert.ok(files.moduleHtml.includes(expected), expected);
  }
  assert.match(files.moduleJs, /event\.key === "Escape"/);
  assert.match(files.moduleCss, /:focus-visible/);
});

await test("29_responsive_desktop_and_narrow_css", () => {
  assert.match(files.moduleCss, /@media \(max-width: 1100px\)/);
  assert.match(files.moduleCss, /@media \(max-width: 760px\)/);
  assert.match(files.moduleCss, /overflow-x: auto|overflow: auto/);
});

await test("30_existing_workspace_shell_unchanged_by_module", () => {
  assert.doesNotMatch(files.moduleJs, /DleWorkspaceShell\s*=/);
  assert.match(files.moduleJs, /window\.DleWorkspaces\[WORKSPACE_ID\]/);
});

await test("31_work_order_number_debounced_server_search", () => {
  assert.match(files.moduleJs, /WORK_ORDER_SEARCH_DEBOUNCE_MS = 300/);
  assert.match(files.moduleJs, /data-canonical-live-search/);
  assert.match(files.moduleJs, /mount\.addEventListener\("input", handleInput\)/);
  assert.match(files.moduleJs, /mount\.removeEventListener\("input", handleInput\)/);
  assert.match(files.moduleJs, /entityState\.page = 1/);
  assert.match(files.moduleJs, /loadEntity\("workOrders"\)/);
  assert.match(files.moduleJs, /cancelDebouncedWorkOrderSearch/);
});

await test("32_work_order_number_normalization_matrix", async () => {
  const cases = [
    { input: "5", expected: "0000005" },
    { input: "102362", expected: "0102362" },
    { input: "0000005", expected: "0000005" },
    { input: "0102362", expected: "0102362" },
    { input: "", expected: null },
    { input: "  5  ", expected: "0000005" },
    { input: "   ", expected: null },
    { input: "12345678", expected: "12345678" },
    { input: "  A5  ", expected: "A5" }
  ];

  for (const testCase of cases) {
    let requestedUrl = "";
    const client = makeClient(async url => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0 }));
    });
    await client.getCanonicalWorkOrders({ workOrderNumber: testCase.input });
    assert.equal(new URL(requestedUrl).searchParams.get("workOrderNumber"), testCase.expected, testCase.input);
  }
});

await test("33_work_order_detail_identifier_normalization", async () => {
  const requestedUrls = [];
  const client = makeClient(async url => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({ workOrderNumber: "0000005" }));
  });

  await client.getCanonicalWorkOrder("5");
  await client.getCanonicalWorkOrder("0000005");
  assert.deepEqual(requestedUrls, [
    apiBaseUrl + "/api/platform/v1/work-orders/0000005",
    apiBaseUrl + "/api/platform/v1/work-orders/0000005"
  ]);
});

await test("34_short_work_order_numbers_live", async () => {
  const client = makeClient();
  const five = await client.getCanonicalWorkOrders({ workOrderNumber: "5", page: 1, pageSize: 50 });
  const oneHundredTwoThousand = await client.getCanonicalWorkOrders({
    workOrderNumber: "102362",
    page: 1,
    pageSize: 50
  });
  assert.equal(five.totalItems, 1);
  assert.equal(five.items[0]?.workOrderNumber, "0000005");
  assert.equal(oneHundredTwoThousand.totalItems, 1);
  assert.equal(oneHundredTwoThousand.items[0]?.workOrderNumber, "0102362");
});

await test("35_visible_work_order_input_retains_typed_value", () => {
  assert.match(files.moduleJs, /entityState\.filters = readFilters/);
  assert.match(files.moduleJs, /input\.value = entityState\.filters\[filter\.name\] \?\? ""/);
  assert.doesNotMatch(files.moduleJs, /input\.value = .*padStart/);
  assert.match(files.apiClient, /normalizeCanonicalFilterValue\(endpointKey, filterName, options\[filterName\]\)/);
});

await test("36_direct_page_target_validation", () => {
  const resolvePageTarget = getModuleFunction("resolvePageTarget");
  assert.equal(resolvePageTarget("75", 118), 75);
  assert.equal(resolvePageTarget("1", 118), 1);
  assert.equal(resolvePageTarget("118", 118), 118);
  assert.equal(resolvePageTarget("0", 118), 1);
  assert.equal(resolvePageTarget("-4", 118), 1);
  assert.equal(resolvePageTarget("119", 118), 118);
  assert.equal(resolvePageTarget("999", 118), 118);
  assert.equal(resolvePageTarget("", 118), null);
  assert.equal(resolvePageTarget("2.5", 118), null);
});

await test("37_direct_page_navigation_live", async () => {
  const client = makeClient();
  const first = await client.getCanonicalWorkOrders({ page: 1, pageSize: 50 });
  const direct = await client.getCanonicalWorkOrders({ page: 75, pageSize: 50 });
  const last = await client.getCanonicalWorkOrders({ page: first.totalPages, pageSize: 50 });
  assert.equal(first.page, 1);
  assert.equal(direct.page, 75);
  assert.equal(last.page, first.totalPages);
  assert.ok(last.items.length > 0);
});

await test("38_page_input_enter_and_validation_controls", () => {
  assert.match(files.moduleHtml, /type="number"[\s\S]*?min="1"[\s\S]*?data-canonical-page-input/);
  assert.match(files.moduleHtml, /data-canonical-action="go-to-page"/);
  assert.match(files.moduleHtml, /data-canonical-page-validation[\s\S]*?aria-live="polite"/);
  assert.match(files.moduleJs, /pageInput && event\.key === "Enter"[\s\S]*?goToPage\(pageInput\.value\)/);
  assert.match(files.moduleJs, /filterForm[\s\S]*?event\.key === "Enter"[\s\S]*?submitFilters\(filterForm\)/);
  assert.match(files.moduleJs, /pageInput\.max = String\(Math\.max\(1, entityState\.totalPages\)\)/);
  assert.match(files.moduleJs, /query\("\[data-canonical-page-label\]"\)\.textContent = "Page " \+ entityState\.page/);
  assert.match(files.moduleJs, /outside the available range\. Using page/);
});

await test("39_direct_page_preserves_filters_and_page_size", async () => {
  let requestedUrl = "";
  const client = makeClient(async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      items: [],
      page: 75,
      pageSize: 25,
      totalItems: 0,
      totalPages: 118
    }));
  });
  await client.getCanonicalWorkOrders({
    page: 75,
    pageSize: 25,
    workOrderNumber: "102362",
    itemNumber: "08-1701-01",
    status: "C"
  });
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("page"), "75");
  assert.equal(url.searchParams.get("pageSize"), "25");
  assert.equal(url.searchParams.get("workOrderNumber"), "0102362");
  assert.equal(url.searchParams.get("itemNumber"), "08-1701-01".padEnd(20));
  assert.equal(url.searchParams.get("status"), "C");
  assert.doesNotMatch(files.moduleJs, /function (?:changePage|goToPage)[\s\S]*?filters\s*=\s*\{\}/);
});

await test("40_item_number_exact_padding_and_hyphen_preservation", async () => {
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
  await fakeClient.getCanonicalInventoryItems({ itemNumber: " 500144-103 " });
  await fakeClient.getCanonicalWorkOrders({ itemNumber: "500144-103" });
  await fakeClient.getCanonicalInventoryItems({ itemNumber: "   " });
  assert.equal(
    new URL(captured[0]).searchParams.get("itemNumber"),
    "500144-103".padEnd(20)
  );
  assert.equal(
    new URL(captured[1]).searchParams.get("itemNumber"),
    "500144-103".padEnd(20)
  );
  assert.equal(new URL(captured[2]).searchParams.has("itemNumber"), false);
  assert.ok(captured[0].includes("500144-103"));
  assert.ok(files.apiClient.includes("padEnd(canonicalWidth, ' ')"));

  const client = makeClient();
  const [inventory, workOrders, pageTwo] = await Promise.all([
    client.getCanonicalInventoryItems({
      itemNumber: "500144-103",
      page: 1,
      pageSize: 50
    }),
    client.getCanonicalWorkOrders({
      itemNumber: "500144-103",
      page: 1,
      pageSize: 50
    }),
    client.getCanonicalWorkOrders({
      itemNumber: "500144-103",
      page: 2,
      pageSize: 10
    })
  ]);
  assert.equal(inventory.totalItems, 1);
  assert.equal(workOrders.totalItems, 21);
  assert.equal(pageTwo.totalItems, 21);
  assert.equal(pageTwo.page, 2);
  assert.equal(pageTwo.pageSize, 10);
  assert.ok(
    [...inventory.items, ...workOrders.items, ...pageTwo.items]
      .every(item => item.itemNumber === "500144-103".padEnd(20))
  );
});

fs.mkdirSync(artifactDirectory, { recursive: true });
const completedAtUtc = new Date().toISOString();
const report = {
  platform: "PLATFORM-003",
  completedAtUtc,
  apiBaseUrl,
  passed: results.filter(result => result.result === "PASS").length,
  failed: results.filter(result => result.result === "FAIL").length,
  results
};
fs.writeFileSync(path.join(artifactDirectory, "qualification-results.json"), JSON.stringify(report, null, 2) + "\n");
const csv = [
  "name,result,elapsedMilliseconds,detail",
  ...results.map(result => [result.name, result.result, result.elapsedMilliseconds, result.detail]
    .map(value => '"' + String(value).replaceAll('"', '""') + '"').join(","))
].join("\n") + "\n";
fs.writeFileSync(path.join(artifactDirectory, "qualification-results.csv"), csv);

for (const result of results) {
  console.log(result.result.padEnd(4), result.name, "(" + result.elapsedMilliseconds + " ms)");
}
console.log(`PLATFORM-003 automated qualification: ${report.passed} passed, ${report.failed} failed.`);
if (report.failed) process.exitCode = 1;

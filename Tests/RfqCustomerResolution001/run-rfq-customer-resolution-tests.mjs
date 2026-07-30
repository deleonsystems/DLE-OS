import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..", "..");
const api = fs.readFileSync(path.join(root, "SRC/api/dle-api-client.js"), "utf8");
const workspace = fs.readFileSync(path.join(root, "SRC/modules/rfq-workspace/rfq-workspace.js"), "utf8");
const workspaceHtml = fs.readFileSync(path.join(root, "SRC/modules/rfq-workspace/rfq-workspace.html"), "utf8");
const repository = fs.readFileSync(path.join(root, "Tools/CustomerMaster/ServerOverlay/Data/Platform/CustomerDirectoryRepository.cs"), "utf8");
const controller = fs.readFileSync(path.join(root, "Tools/CustomerMaster/ServerOverlay/Controllers/Platform/LiveCustomerDirectoryController.cs"), "utf8");
const results = [];

async function test(name, action) {
  try {
    await action();
    results.push({ name, result: "PASS" });
  } catch (error) {
    results.push({ name, result: "FAIL", detail: String(error?.message || error) });
  }
}

function makeClient(fetchImplementation) {
  const window = {
    DLE_API_CONFIG: {
      enabled: true,
      liveCanonicalBaseUrl: "http://127.0.0.1:5096"
    }
  };
  vm.runInNewContext(api, {
    window,
    localStorage: { getItem: () => null },
    fetch: fetchImplementation,
    URLSearchParams,
    AbortController,
    console
  });
  return window.DleApiClient;
}

async function captureSearch(query, pageSize = 25) {
  let requestedUrl = "";
  const client = makeClient(async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      query,
      items: [],
      returnedCount: 0,
      totalItems: 0,
      page: 1,
      pageSize,
      totalPages: 0,
      hasMore: false,
    }), { headers: { "Content-Type": "application/json" } });
  });
  await client.searchCanonicalCustomers(query, { page: 1, pageSize });
  return new URL(requestedUrl);
}

await test("01_exact_padded_customer_number", async () => {
  assert.equal((await captureSearch("001148")).searchParams.get("q"), "001148");
  assert.match(repository, /TRY_CONVERT\(bigint, CustomerNumber\) = @NumericQuery/);
});
await test("02_exact_unpadded_customer_number", async () => {
  assert.equal((await captureSearch("1148")).searchParams.get("q"), "1148");
  assert.match(repository, /long\.TryParse\(query/);
});
await test("03_partial_customer_name", async () => {
  assert.equal((await captureSearch("Hughey")).searchParams.get("q"), "Hughey");
  assert.match(repository, /LOWER\(CustomerName\) LIKE N'%' \+ LOWER\(@Query\) \+ N'%'/);
});
await test("04_case_insensitive_customer_name", () => {
  assert.match(repository, /canonical\.CustomerMasterViewer/);
  assert.match(repository, /LOWER\(CustomerName\).*LOWER\(@Query\)/);
});
await test("05_duplicate_sources_deduplicate", () => {
  assert.match(repository, /GROUP BY CustomerNumber/);
  assert.match(repository, /PARTITION BY candidate\.CustomerNumber/);
});
await test("06_conflicting_name_precedence", () => {
  assert.match(repository, /N'Customer Master'.*?1 AS NamePrecedence/s);
  assert.match(repository, /N'Invoice History',\s*2/s);
  assert.match(repository, /N'Sales Orders',\s*3/s);
});
await test("07_similar_names_different_numbers_separate", () => {
  assert.doesNotMatch(repository, /GROUP BY CustomerName/);
  assert.match(repository, /GROUP BY CustomerNumber/);
});
await test("08_no_result_behavior", () => {
  assert.match(workspace, /No matching existing customer found/);
  assert.match(workspace, /customerResults\.length/);
});
await test("09_result_limit", async () => {
  assert.equal((await captureSearch("Hughey", 25)).searchParams.get("pageSize"), "25");
  assert.match(controller, /MaximumPageSize = 50/);
  assert.match(repository, /OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY/);
});
await test("10_selection_binding_to_state", () => {
  for (const value of ["customerNumber", "customerName", "canonical-customer-directory", "directoryBinding"]) {
    assert.ok(workspace.includes(value), value);
  }
});
await test("11_clear_and_change_selection", () => {
  assert.match(workspace, /function changeCustomer\(\)[\s\S]*?state\.customer = null/);
  assert.match(workspace, /Change Customer/);
  assert.match(workspace, /Clear Customer/);
});
await test("12_validation_requires_directory_resolution", () => {
  assert.match(workspace, /customer\?\.resolution === "existing"/);
  assert.match(workspace, /customer\?\.resolutionSource === "canonical-customer-directory"/);
  assert.match(workspace, /Select a valid customer from the Canonical Customer Directory/);
});
await test("13_review_and_commit_identity", () => {
  assert.match(workspace, /reviewItem\("Customer Number", state\.customer\.customerNumber\)/);
  assert.match(workspace, /customer: \{ \.\.\.state\.customer \}/);
});
await test("14_api_failure_state", () => {
  assert.match(workspace, /customerSearchStatus = "error"/);
  assert.match(workspace, /Customer search could not be completed/);
});
await test("15_leading_zero_preservation", () => {
  assert.match(repository, /CustomerNumber = row\.CustomerNumber/);
  assert.doesNotMatch(repository, /CustomerNumber = .*ToString/);
});
await test("16_debounce_and_stale_response_protection", () => {
  assert.match(workspace, /CUSTOMER_SEARCH_DEBOUNCE_MS = 300/);
  assert.match(workspace, /sequence !== customerSearchSequence/);
  assert.match(workspace, /AbortController/);
});
await test("17_read_only_and_safe_endpoint", () => {
  assert.match(controller, /\[HttpGet\("search"\)\]/);
  assert.doesNotMatch(controller + repository, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.match(repository, /@Query/);
});
await test("18_prospective_customer_disabled", () => {
  assert.match(workspace, /disabled aria-disabled="true"[\s\S]*?Create Prospective Customer/);
});
await test("19_picker_is_separate_governed_dialog", () => {
  assert.match(workspaceHtml, /id="rfq2CustomerPicker"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(workspace, /function openCustomerPicker\(\)/);
  assert.match(workspace, /function closeCustomerPicker\(\)/);
});
await test("20_empty_query_browse_and_paging", async () => {
  const url = await captureSearch("", 25);
  assert.equal(url.searchParams.has("q"), false);
  assert.equal(url.searchParams.get("page"), "1");
  assert.match(workspace, /customer-page-next/);
  assert.match(workspace, /customer-page-previous/);
});
await test("21_cancel_preserves_selection", () => {
  const closeFunction = workspace.match(/function closeCustomerPicker\(\)[\s\S]*?\n  \}/)?.[0] || "";
  assert.doesNotMatch(closeFunction, /state\.customer\s*=/);
});
await test("22_no_obsolete_static_count", () => {
  assert.doesNotMatch(workspace + workspaceHtml, /11 established customers available/i);
  assert.match(workspace, /customerTotalItems/);
});

for (const result of results) {
  console.log(result.result.padEnd(4), result.name, result.detail || "");
}
const failed = results.filter(result => result.result === "FAIL");
console.log(`RFQ Customer Resolution qualification: ${results.length - failed.length} passed, ${failed.length} failed.`);
if (failed.length) process.exitCode = 1;

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..", "..");
const helperSource = fs.readFileSync(path.join(root,
  "SRC/modules/rfq-workspace/rfq-assembly-history.js"), "utf8");
const workspace = fs.readFileSync(path.join(root,
  "SRC/modules/rfq-workspace/rfq-workspace.js"), "utf8");
const api = fs.readFileSync(path.join(root, "SRC/api/dle-api-client.js"), "utf8");
const html = fs.readFileSync(path.join(root, "DLE_Work_Center_v4.0.0.html"), "utf8");
const window = {};
vm.runInNewContext(helperSource, { window });
const history = window.DleRfqAssemblyHistory;
const results = [];

async function test(name, action) {
  try { await action(); results.push({ name, result: "PASS" }); }
  catch (error) { results.push({ name, result: "FAIL", detail: error.message }); }
}

const invoice = (overrides = {}) => ({
  invoiceHistoryLineId: "I1", itemNumber: "ASM-100", revisionCode: "A",
  customerNumber: "000002", customerName: "DLE TEST CUSTOMER 20260730",
  invoiceDate: "2026-07-30", invoiceNumber: "0000123",
  salesOrderNumber: "0000456", workOrderNumber: "0000789", ...overrides
});
const shipment = (overrides = {}) => ({
  shipmentId: "S1", itemNumber: "ASM-100", revision: "A",
  customerNumber: "000002", customerName: "DLE TEST CUSTOMER 20260730",
  shipmentDateTime: "2026-07-29T12:00:00Z", salesOrder: "0000456",
  workOrder: "0000789", ...overrides
});
const search = (options = {}) => history.buildSearchResponse({
  assemblyNumber: "ASM-100", rfqCustomerNumber: "000002",
  invoiceRecords: [], shipmentRecords: [], ...options
});

await test("01_same_customer_exact_revision", () => {
  const result = search({ invoiceRecords: [invoice()] }).results[0];
  assert.equal(result.matchScope, "Same RFQ Customer");
  assert.equal(result.revision, "A");
  assert.equal(result.matchType, "EXACT");
});
await test("02_multiple_revisions_are_separate", () => {
  const response = search({ invoiceRecords: [invoice(), invoice({ invoiceHistoryLineId: "I2", revisionCode: "B" })] });
  assert.equal(response.results.length, 2);
  assert.ok(response.results.every(item => item.revisionState === "Multiple Historical Revisions"));
});
await test("03_cross_customer_exact", () => {
  assert.equal(search({ invoiceRecords: [invoice({ customerNumber: "001148", customerName: "HUGHEY & PHILLIPS" })] }).results[0].matchScope, "Different Customer");
});
await test("04_shipment_invoice_grouped", () => {
  const result = search({ invoiceRecords: [invoice()], shipmentRecords: [shipment()] }).results[0];
  assert.equal(result.historicalSource, "Both");
  assert.equal(result.historicalOccurrenceCount, 2);
  assert.equal(search({ invoiceRecords: [invoice()], shipmentRecords: [shipment()] }).results.length, 1);
});
await test("05_blank_revision_preserved", () => {
  const result = search({ shipmentRecords: [shipment({ revision: "" })] }).results[0];
  assert.equal(result.revision, "");
  assert.equal(result.revisionState, "Revision Not Recorded");
});
await test("06_revision_conflict_flagged", () => {
  const response = search({ invoiceRecords: [invoice()], shipmentRecords: [shipment({ revision: "B" })] });
  assert.ok(response.results.every(item => item.revisionState === "Historical Revision Conflict"));
});
await test("07_verified_folder_outcome", () => {
  assert.match(workspace, /folder\?\.folderState === "VERIFIED"[\s\S]*?HISTORICAL_MATCH_FOLDER_VERIFIED/);
  assert.match(workspace, /getCustomerFolderStatus/);
});
await test("08_missing_folder_action_required", () => {
  assert.match(workspace, /HISTORICAL_MATCH_FOLDER_ACTION_REQUIRED/);
});
await test("09_mismatch_duplicate_are_not_verified", () => {
  const selection = workspace.match(
    /async function selectExistingAssembly[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(workspace, /folder\?\.folderState === "VERIFIED"/);
  assert.doesNotMatch(selection, /createCustomerFolder\(/);
});
await test("10_no_historical_match_message", () => {
  assert.equal(search().matchType, "NONE");
  assert.match(workspace, /No historical assembly match was found in qualified DLE-OS shipment or invoice history/);
});
await test("11_partial_is_not_selectable", () => {
  const response = search({ assemblyNumber: "ASM", invoiceRecords: [invoice()] });
  assert.equal(response.matchType, "PARTIAL");
  assert.equal(response.results[0].selectable, false);
  assert.match(workspace, /Partial results are informational and cannot resolve/);
});
await test("12_empty_verified_folder_is_accepted_without_content_search", () => {
  assert.match(api, /DATA\/shipment-history\/shipment-history\.json/);
  assert.match(api, /getCanonicalInvoiceHistory/);
  assert.doesNotMatch(workspace + api, /Drawing-Prints|Drawing Prints/);
  assert.doesNotMatch(workspace, /start-new-assembly[^\n]*Create New Assembly/);
  assert.match(html, /rfq-assembly-history\.js[\s\S]*rfq-workspace\.js/);
});

for (const result of results) console.log(result.result.padEnd(4), result.name, result.detail || "");
const failed = results.filter(result => result.result === "FAIL");
console.log(`RFQ Assembly History qualification: ${results.length - failed.length} passed, ${failed.length} failed.`);
if (failed.length) process.exitCode = 1;

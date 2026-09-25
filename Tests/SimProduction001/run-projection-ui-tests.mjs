import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Consume the isolated backend's real bound projection, including frozen E2E source evidence.
// No server requests or mutations are made by this integration check.
const fixturePath = process.argv[2];
if (!fixturePath) throw new Error("Usage: node run-projection-ui-tests.mjs <isolated bound.json>");
const root = path.resolve(import.meta.dirname, "../..");
const source = fs.readFileSync(path.join(root, "SRC/workspaces/production/production-workspace.js"), "utf8");
const template = fs.readFileSync(path.join(root, "SRC/workspaces/production/production-workspace.html"), "utf8");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")), before = JSON.stringify(fixture);
let checks = 0;
const check = (value, name) => { assert.ok(value, name); checks++; };
class Node {
  constructor() { this.innerHTML = ""; this.textContent = ""; this.value = ""; this.disabled = false; this.hidden = false; this.dataset = {}; this.events = {}; this.classList = { toggle() {} }; }
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute() {} closest() { return null; }
  querySelector(selector) { return selectors.get(selector) || null; }
  querySelectorAll() { return []; }
}
const selectors = new Map(), ids = new Map(), mount = new Node(), queueView = new Node();
for (const id of ["productionWorkspaceSearch", "productionWorkspaceRefresh", "productionWorkspaceStatus", "productionSelectedJobs",
  "productionKitCompleteCount", "productionKitShortCount", "productionSelectedQueueTitle", "productionSelectedQueueDescription", "productionManagement",
  "productionDetailMessage"]) { const node = new Node(); ids.set(id, node); selectors.set("#" + id, node); }
selectors.set('[data-workspace-mount="production"]', mount); selectors.set("[data-production-queue-view]", queueView);
const row = { queueKey: "WO|0999999", actionable: true, workOrderNumber: "0999999", canonicalWorkOrder: { workOrderNumber: "0999999" },
  assemblyItemNumber: "SIM-ASSY-001", revision: "A", customerName: "DLE-SIM-CUSTOMER", canonicalWorkOrderQuantity: 10, earliestDueDate: "2026-10-14" };
const calls = [];
const window = { fetch: async (url, options = {}) => {
  calls.push({ url, options }); assert.equal(options.method, undefined, "Renderer must not send commands");
  return { ok: true, headers: { get: () => "application/json" }, json: async () => JSON.parse(before) };
}, DleWorkspaces: { kitting: { loadReadModel: async () => ({ queues: { kitComplete: [row], kitShort: [] } }) } }, DleWorkspaceShell: { setWorkspaceView() {} } };
const document = { getElementById: id => ids.get(id), querySelector: selector => selectors.get(selector), querySelectorAll: () => [] };
vm.runInNewContext(source, { window, document, fetch: async () => ({ ok: true, text: async () => template }), console, Map, Set, Date, JSON, Number, String, Array, Object, Promise, encodeURIComponent });
const app = window.DleWorkspaces.production, html = () => ids.get("productionManagement").innerHTML;
const panel = name => mount.events.click({ target: { closest: selector => selector === "[data-production-panel]" ? { dataset: { productionPanel: name } } : null } });
await app.render(); await app.openWorkOrder(row);
check(fixture.source.sourceOperations.length === 13 && fixture.operations.length === 13, "All thirteen source operations retained");
check(fixture.operations.filter(op => op.classification === "PRODUCTION" && op.enabled).length === 12, "Twelve active Production operations");
check((html().match(/class="production-operation"/g) || []).length === 12, "Actual projection renders twelve active route rows");
check(html().includes("20 — PCB Preparation") && html().includes("Ready · Not Started"), "First operation is PCB Preparation Ready / Not Started");
check(html().includes("Materials prerequisite / excluded from active Production") && html().includes("View retained Materials source"), "Kitting source retained outside active route");
check(html().includes("Approved / Frozen") && html().includes("Ready to Start Production"), "Approved frozen readiness displayed");
check(html().includes("10/14/2026") && html().includes("Frozen Labor v2"), "Actual accepted due and frozen labor shown");
check(/class="production-start" disabled[^>]*>Start PCB Preparation/.test(html()), "No execution is enabled");
check(!html().includes("INTERNAL_RFQ"), "Internal RFQ notes do not leak");
for (const op of fixture.operations) {
  const rendered = app.renderOperationDetails(op);
  check(op.productionNotes.filter(n => n.purpose === "PRODUCTION" && !n.removed).every(n => rendered.includes(n.text.slice(0, 30).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))),
    "Actual production notes retained for " + op.sourceOperationId);
}
const visualOps = fixture.operations.filter(op => op.visuals.length);
check(visualOps.map(op => op.sourceOperationId).join(",") === "op-5,op-7,op-8,op-11", "Four existing visual operations retained");
check(visualOps.every(op => html().includes(op.visuals[0].url) && html().includes(op.visuals[0].name)), "Four verified visual links render");
check(fixture.operations.find(op => op.sourceOperationId === "op-9").visuals.length === 0 &&
  app.renderOperationDetails(fixture.operations.find(op => op.sourceOperationId === "op-9")).includes("Text-only operation"), "Hand Solder remains text-only");
check(html().includes("T1-T6") && html().includes("EVERY serial") && html().includes("Only after passing Test"), "Specific Test and Packaging source requirements retained");
await panel("bom");
check((html().match(/<tbody>/g) || []).length === 1 && (html().match(/<tr>/g) || []).length === 13, "BOM has twelve released requirement rows plus header");
check(html().includes("Original Kitting: 12") && html().includes("Accepted Material Applied: 8") && html().includes("Recorded: 20"), "Actual SIM-OPTO-4 original12 + applied8 = final20");
check(html().includes("SIM-AM-0000001"), "Actual accepted material ID preserved");
const opto = fixture.bom.find(row => row.partNumber === "SIM-OPTO-4");
if (opto.acceptedMaterials[0].purchaseOrderNumber) check(html().includes("SIM-PO-0001 / 010"), "Actual supplier PO evidence displayed");
else console.log("NOTE: supplied backend fixture predates supplier-PO alias correction; current UI consumes purchaseOrderNumber / purchaseOrderLine.");
check(html().includes("Complete disposition · no measured count"), "Actual completion-only rows never invent measured quantities");
check(fixture.bom.every(row => row.shortage === 0), "All final governed shortage quantities are zero");
await panel("technical");
check(html().includes("Technical Drawing") && html().includes(">BOM<"), "Backend document types use readable labels");
check(fixture.technicalDocuments.every(doc => html().includes(doc.name) && html().includes(doc.url)), "Both existing technical documents render verified links");
await panel("customer");
check(html().includes("Traveler required") && html().includes("Required"), "Accepted Traveler requirement displayed");
check(html().includes("Certificate of Conformance") && !html().includes("CERTIFICATE_OF_CONFORMANCE"), "Actual CoC requirement is understandable");
check(!html().includes("traceabilityDeliverables") && !html().includes("aerospaceRequirements"), "No raw customer-contract property names");
await panel("kitting");
check(html().includes(fixture.kitting.submissionId) && html().includes("SIM-AM-0000001"), "Final submission and actual application identity render");
check(html().includes("Retained allocation evidence") && html().includes("SIM-PO-0001") && html().includes("SIM Administrator"), "Read-only final allocations expose recorded PO/operator evidence");
await panel("history");
check(html().includes("WO Traveler Frozen") && html().includes("Traveler Draft Created"), "Actual audit actions have understandable labels");
check(calls.every(call => !call.options.method) && JSON.stringify(fixture) === before, "Projection rendering is read-only and preserves source fixture");
console.log("SIM Production actual-projection UI: " + checks + " checks PASS");

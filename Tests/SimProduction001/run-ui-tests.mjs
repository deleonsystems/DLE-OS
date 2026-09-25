import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");
const source = fs.readFileSync(path.join(root, "SRC/workspaces/production/production-workspace.js"), "utf8");
const template = fs.readFileSync(path.join(root, "SRC/workspaces/production/production-workspace.html"), "utf8");
const css = fs.readFileSync(path.join(root, "SRC/workspaces/production/production-workspace.css"), "utf8");
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions++; };
const clone = value => JSON.parse(JSON.stringify(value));
const names = ["Kitting", "PCB Preparation", "SMT Setup", "Solder Paste", "SMT Placement", "Reflow",
  "First Piece / In-Process Inspection", "Thru-Hole Assembly", "Hand Solder", "Cleaning", "Final Inspection", "Test", "Packaging"];
const sourceOperations = names.map((name, index) => ({
  id: "traveler-op-" + (index + 1), sourceOperationId: "op-" + (index + 1), sequence: (index + 1) * 10, name,
  classification: "UNCLASSIFIED", enabled: true, instructions: "Retained source instruction for " + name,
  productionNotes: [{ purpose: "PRODUCTION", text: "Production note " + name }, { purpose: "INTERNAL_RFQ", text: "PRIVATE PRICING ASSUMPTION" },
    { purpose: "PRODUCTION", text: "REMOVED NOTE", removed: true }],
  visuals: [5, 7, 8, 11].includes(index + 1) ? [{ documentId: "visual-" + (index + 1), name: "op-" + (index + 1) + "-reference.png",
    url: "/api/production/v1/work-orders/0999999/visuals/visual-" + (index + 1) }] : [],
  estimatingBasis: { operationQuantity: 1, runSeconds: 60, setupMinutes: 0, timeBasis: "PER_UNIT" },
  technicalReferences: [], shopInstructions: "", managementNotes: "", inspectionRequirements: "", department: "", workCenter: ""
}));
const bom = Array.from({ length: 12 }, (_, i) => ({
  requirementId: "G" + String(i + 1).padStart(3, "0"), find: String(i + 1), partNumber: i === 4 ? "SIM-OPTO-4" : "PART-" + i,
  description: "Released material", references: ["R" + i], requiredEach: i === 4 ? 2 : 1, requiredQuantity: i === 4 ? 20 : 10, uom: "EA",
  eligibleParts: [], result: i === 0 ? "COMPLETE" : "COUNTED_EXACT", recordedKittedQuantity: i === 0 ? null : i === 4 ? 20 : 10,
  originalKittedQuantity: i === 4 ? 12 : null, acceptedMaterialApplied: i === 4 ? 8 : 0, shortage: 0,
  acceptedMaterials: i === 4 ? [{ materialId: "SIM-AM-0000001", purchaseOrderNumber: "SIM-PO-0001", purchaseOrderLine: "010", quantity: 8 }] : []
}));
let model = {
  workOrderNumber: "0999999", sourceToken: "frozen-source", canManage: true, materialStatus: "KIT_COMPLETE",
  productionStatus: "TRAVELER_REVIEW_REQUIRED", ready: false, context: { customer: "DLE-SIM-CUSTOMER", assembly: "SIM-ASSY-001",
    revision: "A", quantity: 10, customerDueDate: "2026-10-14", sourceQuote: "SIM-Q-0042-R01" },
  source: { laborVersion: 2, releasedBomIdentity: "released-hash" }, definition: null, boundTraveler: null, operations: clone(sourceOperations),
  validationErrors: ["An approved, bound Traveler is required."], bom: clone(bom), currentOperations: [], executionStarted: false,
  kitting: { caseId: "case-unchanged", state: "KIT_COMPLETE", workingVersion: 61, submissionId: "final-submission", submissionVersion: 1,
    submittedBy: "Material Reviewer", submittedAtUtc: "2026-09-25T10:00:00Z", pdfUrl: "/api/production/v1/work-orders/0999999/kitting.pdf", applications: [] },
  technicalDocuments: [{ documentId: "bom-document", name: "02_SIM-ASSY-001_BOM_A.pdf", type: "BOM",
    url: "/api/production/v1/work-orders/0999999/documents/bom-document" }, { documentId: "drawing", name: "03_SIM-ASSY-001_Technical_A.pdf",
    type: "DRAWING", url: "/api/production/v1/work-orders/0999999/documents/drawing" }],
  customerRequirements: { travelerRequired: true, traceabilityDeliverables: ["CoC"], specialRequirements: "Test before packaging" }, history: []
};
const preserved = JSON.stringify({ bom, sourceOperations, kitting: model.kitting });
const queueRow = { queueKey: "WO|0999999", actionable: true, workOrderNumber: "0999999", customerNumber: "SIM", customerName: "DLE-SIM-CUSTOMER",
  assemblyItemNumber: "SIM-ASSY-001", revision: "A", canonicalWorkOrderQuantity: 10, earliestDueDate: "2026-10-14",
  canonicalWorkOrder: { workOrderNumber: "0999999" }, relatedLines: [] };
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
let selectedPrerequisites = [], failNext = false, allowDiscard = false, calls = [], navigation = [];
const response = (data, status = 200) => ({ ok: status === 200, status, headers: { get: () => "application/json" }, json: async () => clone(data) });
const api = async (url, options = {}) => {
  const method = options.method || "GET", body = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, method, body });
  if (method === "GET") return response(model);
  if (failNext) { failNext = false; return response({ code: "STALE", message: "Traveler changed in another session." }, 409); }
  if (url.endsWith("/seed")) {
    check(body.sourceToken === "frozen-source", "Seed carries frozen-source fingerprint");
    check(JSON.stringify(body.materialsPrerequisiteSourceIds) === '["op-1"]', "Only reviewed source prerequisite is submitted");
    model.operations = model.operations.map(op => ({ ...op, classification: op.sourceOperationId === "op-1" ? "MATERIALS_PREREQUISITE" : "PRODUCTION",
      enabled: op.sourceOperationId !== "op-1", exclusionReason: op.sourceOperationId === "op-1" ? "Materials prerequisite" : "" }));
    model.definition = { id: "definition", workingVersion: 1, version: 0, status: "DRAFT", operations: clone(model.operations), lease: null };
  } else if (url.endsWith("/lease")) {
    check(body.expectedWorkingVersion === model.definition.workingVersion, "Lease uses current expected version");
    model.definition.lease = { id: "lease", actor: "Test Manager", expiresAt: "2026-09-25T23:59:00Z" };
  } else if (url.endsWith("/draft")) {
    check(body.leaseId === "lease" && body.expectedWorkingVersion === model.definition.workingVersion, "Draft save carries lease and expected version");
    check(body.operations.every(op => !("instructions" in op) && !("productionNotes" in op) && !("visuals" in op)), "Edit cannot rewrite source instructions, notes or visuals");
    model.definition.operations = model.definition.operations.map(op => ({ ...op, ...body.operations.find(row => row.id === op.id) }));
    model.definition.workingVersion++; model.definition.status = "DRAFT"; model.operations = clone(model.definition.operations);
  } else if (url.endsWith("/approve")) {
    check(body.leaseId === "lease" && body.expectedWorkingVersion === model.definition.workingVersion, "Approval carries lease and expected version");
    model.definition.status = "APPROVED"; model.definition.version++;
    model.definition.approval = { actor: "Test Manager", atUtc: "2026-09-25T10:00:00Z", version: model.definition.version };
  } else if (url.endsWith("/bind")) {
    check(body.approvedVersion === model.definition.version && body.expectedWorkingVersion === model.definition.workingVersion, "Bind references exact approved version");
    model.boundTraveler = { id: "bound-traveler", version: 1, definitionVersion: model.definition.version, operations: clone(model.definition.operations),
      createdBy: "Test Manager", createdAt: "2026-09-25T10:00:00Z" };
    model.productionStatus = "READY_TO_START_PRODUCTION"; model.ready = true; model.validationErrors = []; model.firstOperation = clone(model.operations[1]);
  } else throw new Error("Unexpected mutation: " + url);
  return response(model);
};
const document = { getElementById: id => ids.get(id) || null, querySelector: selector => selectors.get(selector) || null,
  querySelectorAll: selector => selector === "[data-production-prerequisite]:checked" ? selectedPrerequisites.map(value => ({ value })) : [] };
const window = { fetch: api, confirm: () => allowDiscard, DleWorkspaces: { kitting: { loadReadModel: async () => ({ queues: { kitComplete: [queueRow], kitShort: [] } }) } },
  DleWorkspaceShell: { setWorkspaceView: id => navigation.push(id) }, go: () => { throw new Error("Must not route to generic Kitting dashboard"); } };
vm.runInNewContext(source, { window, document, fetch: async () => ({ ok: true, text: async () => template }), console, Map, Set, Date, JSON, Number, String, Array, Object, Promise, encodeURIComponent });
const app = window.DleWorkspaces.production, html = () => ids.get("productionManagement").innerHTML;
const action = name => mount.events.click({ target: { closest: selector => selector === "[data-production-action]" ? { dataset: { productionAction: name } } : null } });
const panel = name => mount.events.click({ target: { closest: selector => selector === "[data-production-panel]" ? { dataset: { productionPanel: name } } : null } });

await app.render();
check(calls.every(call => call.method === "GET"), "Opening queue performs reads only");
check(ids.get("productionSelectedJobs").innerHTML.includes("Traveler Review Required"), "Kit Complete alone does not imply Production readiness");
await app.openWorkOrder(queueRow);
check(queueView.hidden && !ids.get("productionManagement").hidden, "WO opens dedicated Production management inside workspace");
check(navigation.every(item => item === "production"), "No generic Kitting navigation");
check(html().includes("10/14/2026") && html().includes("SIM-ASSY-001 / A"), "Header shows date-only MM/DD/YYYY and assembly context");
check(!html().includes("PRIVATE PRICING ASSUMPTION") && !html().includes("REMOVED NOTE"), "Internal RFQ and removed notes never render");
check(calls.every(call => call.method === "GET"), "Management navigation does not seed, approve, bind or start");
check(!/data-production-prerequisite[^>]+checked/.test(html()), "Prerequisite selection is never inferred or auto-confirmed");
selectedPrerequisites = ["op-1"]; await action("seed");
check(html().includes("Materials prerequisite / excluded from active Production"), "Kitting retained as explicit Materials prerequisite");
check((html().match(/class="production-operation"/g) || []).length === 12, "Only twelve active operations render");
check(!/production-operation"><summary><span><small>10<\/small>/.test(html()), "Sequence 10 never active after reviewed exclusion");
await action("approve"); await action("bind");
check(html().includes("Ready to Start Production") && html().includes("Approved / Frozen"), "Approved bound valid package displays readiness");
check(html().includes("20 — PCB Preparation"), "PCB Preparation is first available operation");
check(/class="production-start" disabled[^>]*>Start PCB Preparation/.test(html()), "Start option visible and honestly disabled in no-execution slice");
check(html().includes("Execution controls are not enabled in this foundation slice."), "No fake functional Start affordance");
check((html().match(/reference.png/g) || []).length === 4, "All four frozen visuals remain accessible");
check(html().includes("/traveler.pdf") && html().includes("Non-Controlled Copy"), "Traveler print opens existing read-only projection endpoint");
await panel("bom");
check(html().includes("SIM-OPTO-4") && html().includes("Original Kitting: 12") && html().includes("Accepted Material Applied: 8") && html().includes("Recorded: 20"), "BOM projects original12 + accepted8 = final20");
check(html().includes("SIM-AM-0000001") && html().includes("SIM-PO-0001 / 010"), "BOM retains accepted-material and supplier-PO identity");
check(html().includes("Complete disposition · no measured count"), "Completion disposition never invents a measured count");
check(html().includes("/bom.pdf"), "BOM print uses read-only PDF endpoint");
await panel("kitting");
check(html().includes("final-submission") && html().includes("/kitting.pdf"), "Kitting reference identifies final governed submission");
await panel("technical");
check(html().includes("02_SIM-ASSY-001_BOM_A.pdf") && html().includes("03_SIM-ASSY-001_Technical_A.pdf"), "Both controlled technical documents are linked");
await panel("customer");
check(html().includes("Traveler required") && html().includes("Required") && html().includes("Test before packaging"), "Accepted requirements use user-facing labels");
check(!html().includes("traceabilityDeliverables") && !html().includes('["CoC"]'), "No raw contract keys or array JSON in normal view");
await panel("traveler");
const frozenRoute = JSON.stringify(model.boundTraveler.operations);
await action("edit");
check(html().includes("frozen WO Traveler remains unchanged") && html().includes("Source instructions · read-only"), "Definition editor separates source authority and frozen WO");

function formFixture() {
  const form = new Node(); form.id = "productionDraftForm"; form.reportValidity = () => true;
  const reason = { value: "Reviewed shop guidance", disabled: false };
  const sections = model.definition.operations.map(op => {
    const values = new Map(Object.entries({ sequence: op.sequence, department: "", workCenter: "", shopInstructions: op.sourceOperationId === "op-2" ? "New draft shop instruction" : "",
      managementNotes: "", inspectionRequirements: "", exclusionReason: op.exclusionReason || "" }).map(([key, value]) => [key, { value, disabled: false }]));
    values.set("enabled", { checked: op.enabled, disabled: op.classification === "MATERIALS_PREREQUISITE" });
    return { dataset: { productionEditOperation: op.id }, values, querySelector: selector => values.get(selector.match(/name="([^"]+)"/)?.[1]) || null };
  });
  form.querySelector = selector => selector === '[name="reason"]' ? reason : null;
  form.querySelectorAll = selector => selector === "[data-production-edit-operation]" ? sections :
    selector === "button,input,textarea" ? [reason, ...sections.flatMap(section => Array.from(section.values.values()))] : [];
  ids.set(form.id, form);
  return { form, reason, sections };
}
let draft = formFixture(); failNext = true;
mount.events.input({ target: { closest: selector => selector === "#productionDraftForm" ? draft.form : null } });
const writesBeforeFailure = calls.filter(call => call.method !== "GET").length;
await mount.events.submit({ target: draft.form, preventDefault() {} });
check(calls.filter(call => call.method !== "GET").length === writesBeforeFailure + 1, "Stale draft rejects without automatic retry");
check(ids.get("productionDetailMessage").textContent.includes("edits are retained"), "Conflict explains preserved input");
check(draft.sections[1].values.get("shopInstructions").value === "New draft shop instruction", "Unsaved draft text survives stale conflict");
check(draft.sections[0].values.get("enabled").disabled, "Prerequisite checkbox remains disabled after failed save");
const beforeTab = html(); await panel("bom");
check(html() === beforeTab, "Dirty editor cannot be lost by navigating tabs without confirmation");
await mount.events.submit({ target: draft.form, preventDefault() {} });
check(JSON.stringify(model.boundTraveler.operations) === frozenRoute, "Saved definition revision leaves frozen WO route unchanged");
check(!app.renderRoute(model.boundTraveler.operations).includes("New draft shop instruction"), "Frozen route does not float to new draft guidance");
model.canManage = false; await action("refresh-detail");
check(!html().includes("data-production-action=\"edit\"") && !html().includes("data-production-action=\"approve\""), "Server permission removes management controls");
const readonlyWrites = calls.filter(call => call.method !== "GET").length; await action("seed"); await action("edit");
check(calls.filter(call => call.method !== "GET").length === readonlyWrites, "Read-only persona cannot dispatch commands");
check(!calls.some(call => /start|execution|receiv|purchas|kitting-cases/.test(call.url)), "UI never calls execution, Kitting, Purchasing or Receiving mutations");
check(!model.executionStarted && model.currentOperations.length === 0, "No execution state fabricated");
check(JSON.stringify({ bom, sourceOperations, kitting: model.kitting }) === preserved, "Original source and material evidence preserved");
check(app.renderBom({ bom: [{ ...bom[0], result: "PENDING" }] }).includes("No measured count recorded"), "Pending row is never labeled completed");
check(app.renderBom({ bom: [{ ...bom[0], requiredEach: 0.12345678, recordedKittedQuantity: 0.01234567 }] }).includes("0.12345678") &&
  app.renderBom({ bom: [{ ...bom[0], requiredEach: 0.12345678, recordedKittedQuantity: 0.01234567 }] }).includes("0.01234567"), "Read-only BOM retains fractional quantities without two-decimal rounding");
check(!app.renderOperationDetails({ visuals: [{ name: "unsafe", url: "javascript:alert(1)" }] }).includes('href="javascript:'), "Reference URLs cannot execute scripts");
check(css.includes("@media(max-width:800px)") && css.includes("@media(max-width:620px)") && css.includes(".production-table-scroll{overflow-x:auto"), "Responsive route/card layouts and bounded BOM scrolling are defined");
console.log("SIM Production UI: " + assertions + " checks PASS (isolated API; no live state changed)");

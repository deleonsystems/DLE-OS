import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const registry = read("SRC/shell/workspace-registry.js");
const home = read("SRC/home/work-area-home.js");
const workspace = read("SRC/workspaces/technical-review/technical-review-workspace.js");
const markup = read("SRC/workspaces/technical-review/technical-review-workspace.html");
const styles = read("SRC/workspaces/technical-review/technical-review-workspace.css");
const intake = read("SRC/modules/rfq-workspace/intake-wizard.js");
const endpoints = read("Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeEndpoints.cs");
const store = read("Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeStore.cs");
const personas = read("Tools/SimRuntime/DleOs.SimHost/SimPersonaCatalog.cs");

assert.match(registry, /id: "technical-review"[\s\S]*?label: "Technical Review"/);
assert.match(registry, /id: "technical-review"[\s\S]*?home: Object\.freeze\(\{[\s\S]*?label: "TECHNICAL REVIEW"/);
assert.match(registry, /modulePath: "SRC\/workspaces\/technical-review\/technical-review-workspace\.js"/);
assert.match(registry, /stylePath: "SRC\/workspaces\/technical-review\/technical-review-workspace\.css"/);
assert.match(registry, /description: "Review Queue \\u2022 Technical Package \\u2022 Disposition"/);
assert.match(registry, /mark: "TR"[\s\S]*?requiredPermission: "technical_review\.view"/);
assert.match(home, /workAreas = window\.DleWorkspaceRegistry\.all\(\)\.filter/);
assert.match(home, /window\.setWorkspaceView\(workspaceId\)/);

for (const text of ["Technical Review", "Review Queue", "PRIMARY WORKLIST"]) assert.ok(markup.includes(text));
assert.match(markup, /<h1 id="technicalReviewTitle">Technical Review<\/h1>/);
for (const text of [
  "RFQ Review", "PCB Assembly", "Assembly Drawing", "BOM", "Gerber",
  "Sub-assembly document", "Full turnkey", "Customer-supplied material",
  "Hybrid / partially customer-supplied", "Qualified — Ready for RFQ",
  "Needs Customer Clarification", "Missing Technical Documents",
  "Revision / Document Conflict", "Blocked / Needs Escalation"
]) assert.ok(workspace.includes(text), text);
for (const heading of [
  "Review Type", "Intake ID", "Customer", "Assembly", "Revision", "Qty",
  "Received", "Technical documents", "Review status"
]) assert.ok(workspace.includes(heading), heading);
assert.match(workspace, /\/api\/sim\/technical-reviews/);
assert.match(workspace, /method: "PUT"/);
assert.match(workspace, /READY_FOR_RFQ_WORKING_QUEUE/);
assert.match(workspace, /governed binary placement and document viewing are not available/);
assert.match(workspace, /No Materials, Labor, pricing, lead-time, or customer-response work was started/);
assert.match(workspace, /if \(action === "back"\) showQueue\(\)/);
assert.match(workspace, /function showQueue\(\) \{[\s\S]*?state\.selected = null;[\s\S]*?technicalReviewDetailView"\)\.hidden = true;[\s\S]*?technicalReviewQueueView"\)\.hidden = false;/);
assert.doesNotMatch(workspace, /documentIntake|rfqProcessing|bomExtraction/);
assert.match(styles, /\.technical-review-row/);
assert.match(styles, /\.technical-review-form/);
assert.match(styles, /\.technical-review-view\[hidden\]\{display:none\}/);
assert.match(styles, /@media\(max-width:720px\)/);

assert.match(intake, /Submit for Technical Review/);
assert.match(intake, /Submitted for Technical Review/);
assert.match(intake, /Technical Review · RFQ Review/);
assert.doesNotMatch(intake, /Send to RFQ Qualification/);

assert.match(endpoints, /MapGet\("\/api\/sim\/technical-reviews"/);
assert.match(endpoints, /MapGet\("\/api\/sim\/technical-reviews\/\{intakeId\}"/);
assert.match(endpoints, /MapPut\("\/api\/sim\/technical-reviews\/\{intakeId\}\/disposition"/);
assert.match(endpoints, /technical_review\.view/);
assert.match(endpoints, /technical_review\.disposition/);
assert.match(personas, /"technical_review\.view", "technical_review\.disposition"/);
assert.match(store, /"READY_FOR_RFQ_QUALIFICATION"/);
assert.match(store, /"READY_FOR_RFQ_WORKING_QUEUE"/);
assert.match(store, /"RFQs"/);
assert.match(store, /METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED/);
assert.match(store, /Gerbers are required for this full-turnkey PCB package before qualification/);
assert.match(store, /Identify the customer-supplied material or components/);

console.log("PASS: Technical Review workspace, queue, guided review, and handoff UI contracts.");

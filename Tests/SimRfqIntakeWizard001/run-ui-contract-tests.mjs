import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const wizard = fs.readFileSync(path.join(root, "SRC/modules/rfq-workspace/intake-wizard.js"), "utf8");
const workspace = fs.readFileSync(path.join(root, "SRC/modules/rfq-workspace/rfq-workspace.js"), "utf8");
const css = fs.readFileSync(path.join(root, "SRC/modules/rfq-workspace/rfq-workspace.css"), "utf8");
const renderer = fs.readFileSync(path.join(root, "Tools/SimRuntime/DleOs.SimHost/SimShellRenderer.cs"), "utf8");
const home = fs.readFileSync(path.join(root, "SRC/home/work-area-home.js"), "utf8");

assert.match(workspace, /loadIntakeWizardScript/);
assert.match(workspace, /DleIntakeWizard\.mount/);
assert.match(workspace, /dataset\?\.simRuntime === "true"/);
assert.match(workspace, /rfqIntakeMode === "SIM_PHASE1"/);
assert.match(renderer, /rfqIntakeMode = "SIM_PHASE1"/);
assert.match(home, /label: "INTAKE WIZARD"/);
assert.match(wizard, /<h1>Intake Wizard<\/h1>/);
assert.match(home, /id: "rfq-quoting"/);
assert.match(home, /dataset\?\.simRuntime === "true"/);
assert.match(home, /rfqIntakeMode === "SIM_PHASE1"/);
assert.match(home, /\[INTAKE_WIZARD_HOME_ENTRY, \.\.\.workAreas\]/);
for (const prompt of [
  "What intake are we working on?", "Who did you get it from?",
  "How many different assemblies are they asking us to quote?", "What is the assembly number?",
  "What revision are they asking for?", "What quantity are they asking us to quote?",
  "What is De Leon expected to provide?", "Did the customer send technical files?",
  "What does the customer need back?"
]) assert.ok(wizard.includes(prompt), prompt);
for (const value of ["NEW_QUOTE_REQUEST", "MATERIAL_AND_LABOR", "PRICE", "LEAD_TIME",
  "Submit for Technical Review", "DleOsSession", "/api/sim/rfq-intakes"])
  assert.ok(wizard.includes(value), value);
assert.match(wizard, /data-intake-edit/);
assert.match(wizard, /technicalFiles: state\.technicalFiles/);
assert.match(wizard, /resolutionSource: "sim-canonical-customer-directory"/);
assert.match(wizard, /Count distinct assemblies or part numbers here\. Piece quantity is captured separately for each assembly\./);
assert.doesNotMatch(wizard, /How many assemblies are they asking us to quote\?/);
assert.match(wizard, /Drop customer technical files here/);
assert.match(wizard, /or click to browse/);
assert.match(wizard, /data-intake-drop-zone/);
assert.match(wizard, /handleFileDrop/);
assert.match(wizard, /dataTransfer\?\.files/);
assert.match(wizard, /Save email attachments to this device/);
assert.match(wizard, /state\.technicalFiles = \[\.\.\.state\.technicalFiles, \.\.\.additions\.filter/);
assert.match(wizard, /new Set\(state\.technicalFiles\.map\(technicalFileIdentity\)\)/);
assert.match(wizard, /\[file\.name, file\.size, file\.type, file\.lastModified\]/);
assert.match(wizard, /event\.target\.value = ""/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard/);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard-header/);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-answers \{[^}]*display: none;/s);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-conversation-card/);
assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
assert.match(css, /touch-action: pan-x/);
assert.match(css, /overflow-wrap: anywhere/);
assert.match(css, /min-height: 44px/);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard \{[^}]*padding: 0 10px 24px;/s);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard \{[^}]*margin-top: 0;/s);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard-header \{[^}]*min-height: 0;/s);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard-header \.intake-sim-badge \{[^}]*padding: 6px 8px;[^}]*font-size: 10px;/s);
assert.match(css, /body\[data-view-mode="desktop"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard-header \.intake-sim-badge,[^}]*align-self: center;/s);
assert.match(css, /body\[data-view-mode="desktop"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard \{[^}]*margin-top: 0;[^}]*padding-top: 0;/s);
assert.match(css, /body\[data-view-mode="ipad"\]\[data-workspace-view="rfq-quoting"\] \.intake-wizard \{[^}]*margin-top: 0;[^}]*padding-top: 0;/s);
assert.equal((wizard.match(/class="intake-progress"/g) || []).length, 1);
assert.match(wizard, /function restoreProgressBeforeLayout\(\)/);
assert.match(wizard, /function syncProgressPlacement\(\)/);
assert.match(wizard, /document\.body\?\.dataset\?\.viewMode === "mobile"/);
assert.match(wizard, /stepLabel\.insertAdjacentElement\("afterend", progress\)/);
assert.match(wizard, /layout\.insertAdjacentElement\("beforebegin", progress\)/);
assert.match(wizard, /document\.addEventListener\?\.\("dle:view-mode-change", syncProgressPlacement\)/);
assert.match(css, /body\[data-view-mode="mobile"\]\[data-workspace-view="rfq-quoting"\] \.intake-conversation-card > \.intake-progress \{[^}]*width: 100%;[^}]*max-width: none;[^}]*margin: 6px 0 0;/s);
assert.doesNotMatch(wizard, /pricing|margin|send email/i);
console.log("PASS: 62 SIM Intake Wizard UI and responsive contract checks.");

await import('./run-document-identification-tests.mjs');
await import('./run-assembly-identification-tests.mjs');

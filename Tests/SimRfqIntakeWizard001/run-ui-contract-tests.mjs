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
assert.match(home, /label: "Intake Wizard"/);
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
assert.doesNotMatch(wizard, /pricing|margin|traveler|send email/i);
console.log("PASS: 39 SIM Intake Wizard UI contract checks.");

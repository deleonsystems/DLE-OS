import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const repository = path.resolve(import.meta.dirname, "..", "..");
const source = fs.readFileSync(path.join(repository, "SRC/modules/rfq-workspace/intake-wizard.js"), "utf8");
const listeners = new Map();
const progress = { style: {} };
const answers = { innerHTML: "" };
const conversation = { innerHTML: "" };
const answerControl = { insertAdjacentHTML() {} };
const root = {
  html: "",
  set innerHTML(value) { this.html = value; },
  get innerHTML() { return this.html; },
  addEventListener(type, listener) { listeners.set(type, listener); },
  querySelector(selector) {
    if (selector === "[data-intake-wizard]") return this.html.includes("data-intake-wizard") ? this : null;
    if (selector === "#intakeProgressBar") return progress;
    if (selector === "#intakeAnswers") return answers;
    if (selector === "#intakeConversation") return conversation;
    if (selector === ".intake-answer-control") return answerControl;
    return null;
  },
  querySelectorAll() { return []; }
};

const window = {
  DleOsSession: { user: { displayName: "Adan Mena" } },
  DleApiClient: {
    async searchCanonicalCustomers() {
      return { items: [{ customerId: "C-001", customerNumber: "00001", customerName: "Abbott" }] };
    }
  },
  clearTimeout() {},
  setTimeout(callback) { callback(); return 1; }
};
vm.runInNewContext(source, { window, document: {} }, { filename: "intake-wizard.js" });
window.DleIntakeWizard.mount(root);

function click(candidate) {
  listeners.get("click")({
    target: {
      closest(selector) { return candidate[selector] || null; }
    }
  });
}

function choose(field, value) {
  click({ "[data-intake-choice]": { dataset: { intakeChoice: field, intakeValue: value } } });
}

function chooseCustomer(customerNumber) {
  click({ "[data-intake-customer]": { dataset: { intakeCustomer: customerNumber } } });
}

function submit(field, value) {
  const form = {
    dataset: { intakeForm: field },
    querySelector() { return { value: String(value) }; }
  };
  listeners.get("submit")({ target: { closest: () => form }, preventDefault() {} });
}

function back() {
  click({ "[data-intake-action]": { dataset: { intakeAction: "back" } } });
}

choose("intake-type", "NEW_QUOTE_REQUEST");
await new Promise(resolve => setImmediate(resolve));
chooseCustomer("00001");
submit("assembly-count", 1);
submit("assembly-number", "B11283-17");

assert.match(answers.innerHTML, /B11283-17/, "the completed assembly answer is initially summarized");
back();
assert.doesNotMatch(answers.innerHTML, /B11283-17/, "Back clears the answer for the question returned to");
assert.match(answers.innerHTML, /New Quote Request/, "Back preserves the earlier intake answer");
assert.match(answers.innerHTML, /Abbott/, "Back preserves the earlier customer answer");
assert.match(answers.innerHTML, /Assemblies/, "Back preserves the immediately earlier assembly-count answer");

submit("assembly-number", "C44500");
assert.match(answers.innerHTML, /C44500/, "a replacement answer is summarized and forward navigation resumes");

back();
back();
assert.doesNotMatch(answers.innerHTML, /Assemblies/, "repeated Back clears only the next question being reconsidered");
assert.match(answers.innerHTML, /New Quote Request/, "repeated Back still preserves Question 1");
assert.match(answers.innerHTML, /Abbott/, "repeated Back still preserves Question 2");

submit("assembly-count", 1);
submit("assembly-number", "D55000");
assert.match(answers.innerHTML, /D55000/, "the wizard continues forward normally after re-answering");

console.log("PASS: 10 Intake Wizard Back-navigation state checks.");

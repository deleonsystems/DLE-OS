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
const inlineErrors = [];
const answerControl = { insertAdjacentHTML(_position, html) { inlineErrors.push(html); } };
const root = {
  html: "",
  set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; },
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
  DleApiClient: { async searchCanonicalCustomers() { return { items: [{ customerId: "C-001", customerNumber: "00001", customerName: "Abbott" }] }; } },
  clearTimeout() {}, setTimeout(callback) { callback(); return 1; }
};
vm.runInNewContext(source, { window, document: {} }, { filename: "intake-wizard.js" });
window.DleIntakeWizard.mount(root);

function click(candidate) { listeners.get("click")({ target: { closest(selector) { return candidate[selector] || null; } } }); }
function choose(field, value) { click({ "[data-intake-choice]": { dataset: { intakeChoice: field, intakeValue: value } } }); }
function chooseCustomer(value) { click({ "[data-intake-customer]": { dataset: { intakeCustomer: value } } }); }
function action(value) { click({ "[data-intake-action]": { dataset: { intakeAction: value } } }); }
function submit(field, value) {
  const form = { dataset: { intakeForm: field }, querySelector() { return { value: String(value) }; } };
  listeners.get("submit")({ target: { closest(selector) { return selector === "[data-intake-form]" ? form : null; } }, preventDefault() {} });
}
function multi(field, values) {
  const form = { dataset: { intakeMultiselect: field }, querySelectorAll() { return values.map(value => ({ value })); } };
  listeners.get("submit")({ target: { closest(selector) { return selector === "[data-intake-multiselect]" ? form : null; } }, preventDefault() {} });
}
function additional() {
  const form = { dataset: { intakeAdditionalRequirements: "true" }, elements: {
    qualityRequirements: { value: "Quality note" }, specialRequirements: { value: "Special note" }, identifiedOnDocument: { checked: true }
  } };
  listeners.get("submit")({ target: { closest(selector) { return selector === "[data-intake-additional-requirements]" ? form : null; } }, preventDefault() {} });
}
function expectStep(text, message) { assert.match(conversation.innerHTML, new RegExp(text), message); }

expectStep("New Quote Request[\\s\\S]*New Order", "scenario screen places New Order below New Quote Request");
choose("intake-type", "NEW_ORDER"); await new Promise(resolve => setImmediate(resolve));
expectStep("Who did you get it from", "New Order reuses governed customer selection");
chooseCustomer("00001"); submit("customer-po-number", "PO-100");
expectStep("Customer PO[\\s\\S]*Verbal PO", "Customer PO is available and Verbal PO is visible");
assert.match(conversation.innerHTML, /intake-choice-disabled" disabled aria-disabled="true"[\s\S]*Verbal PO/, "Verbal PO cannot be selected");
choose("customer-po-type", "CUSTOMER_PO");
action("continue");
assert.match(inlineErrors.pop(), /Attach the customer PO/, "attachment is required before continuing");
listeners.get("change")({ target: { matches: () => true, files: [{ name: "po.pdf", size: 12, type: "application/pdf", lastModified: 1 }], value: "x" } });
action("continue"); choose("payment-terms", "yes");
expectStep("billing address", "matching payment terms skips the action note");
action("back"); expectStep("payment terms", "Back skips hidden payment note and returns to payment terms");
choose("payment-terms", "no"); expectStep("Notify A/R Department", "payment mismatch triggers A/R action");
submit("payment-terms-note", "A/R note"); choose("address-match", "no");
expectStep("Verify and highlight the Ship To address", "address mismatch triggers Ship To action");
submit("shipping-note", "Verified"); choose("shipping-method", "UPS_CHARGE");
expectStep("classified", "non-Collect shipping skips UPS account");
action("back"); expectStep("shipping method", "Back skips hidden UPS account step");
choose("shipping-method", "UPS_COLLECT"); expectStep("UPS account number", "UPS Collect requires account number");
submit("ups-account", "UPS-100"); choose("order-classification", "NEW_ASSEMBLY");
choose("delivery-date", "no"); expectStep("Contact customer", "unmet delivery date triggers action");
submit("delivery-date-note", "Delivery note"); choose("price-match", "no");
expectStep("Review the quote", "price mismatch triggers action"); submit("price-note", "Price note");
choose("traceability", "true");
// The UI sends yes/no values; correct the deliberate branch through the visible choice contract.
action("back"); choose("traceability", "yes");
expectStep("traceability records", "traceability Yes opens deliverable selection");
multi("traceability-records", ["TRAVELER", "MATERIAL_CERTS"]);
multi("aerospace-requirements", ["FAIR", "ITAR"]);
submit("po-flowdowns", "Clause A"); additional();
expectStep("New Order Contract Review", "completed answers reach the Contract Review summary");
for (const value of ["Notify A/R Department", "Verify and highlight the Ship To address", "Contact customer", "Review the quote", "FAIR", "ITAR", "Reviewed By", "Adan Mena"])
  assert.ok(conversation.innerHTML.includes(value), `summary includes ${value}`);
assert.match(answers.innerHTML, /New Order/, "Answers So Far reflects the selected scenario");

console.log("PASS: 27 New Order guided-navigation and summary checks.");

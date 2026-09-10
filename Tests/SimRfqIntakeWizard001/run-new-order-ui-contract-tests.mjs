import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const wizard = fs.readFileSync(path.join(root, "SRC/modules/rfq-workspace/intake-wizard.js"), "utf8");
const store = fs.readFileSync(path.join(root, "Tools/SimRuntime/DleOs.SimHost/SimRfqIntakeStore.cs"), "utf8");
const css = fs.readFileSync(path.join(root, "SRC/modules/rfq-workspace/rfq-workspace.css"), "utf8");

const checks = [];
function check(condition, message) { assert.ok(condition, message); checks.push(message); }

check(wizard.indexOf('choice("New Order", "NEW_ORDER", "intake-type")') > wizard.indexOf('choice("New Quote Request", "NEW_QUOTE_REQUEST", "intake-type")'), "New Order follows New Quote Request");
for (const text of [
  "Customer PO", "Verbal PO", "Planned for a future release", "Do the payment terms match the customer’s current terms?",
  "Notify A/R Department", "Is the billing address the same as the ship-to address?", "Verify and highlight the Ship To address",
  "Will Call", "DLE Delivery", "UPS Charge", "UPS Collect", "Repeat Order", "New Assembly", "New Revision",
  "Create new BOM/router and check FAIR requirement", "Update BOM/router and check FAIR requirement",
  "Can we meet the delivery date?", "Contact customer to discuss the delivery date",
  "Does the price match the price quoted?", "Review the quote and contact the customer",
  "Is traceability required?", "Traveler", "Material Certs", "Certificate of Conformance", "FAIR", "ITAR", "DPAS Rated",
  "PO flowdowns and quality clauses", "Additional contract quality requirements", "Special requirements",
  "Requirements identified on attached document", "Reviewed By", "Review date"
]) check(wizard.includes(text), `New Order UI includes: ${text}`);
check(/intake-choice-disabled[^>]*" disabled aria-disabled="true"/.test(wizard), "Verbal PO is visibly disabled");
check(wizard.includes("Attach the customer PO before continuing."), "Customer PO attachment is required in the guided flow");
check(wizard.includes('shippingMethod !== "UPS_COLLECT"'), "UPS account step is conditional");
check(wizard.includes("isSkippedNewOrderStep"), "hidden conditional steps do not block forward or Back navigation");
check(wizard.includes("renderNewOrderReview"), "New Order has a final Contract Review summary");
check(wizard.includes("triggeredActions"), "review summary highlights triggered actions");
check(wizard.includes("contractReview: isNewOrder ? state.contractReview : null"), "New Order submits structured Contract Review state");
check(store.includes('request.IntakeType is not ("NEW_QUOTE_REQUEST" or "NEW_ORDER")'), "SIM store accepts only the two supported scenarios");
for (const code of [
  "DLE_OS_SIM_NEW_ORDER_CUSTOMER_PO_REQUIRED", "DLE_OS_SIM_NEW_ORDER_UPS_ACCOUNT_REQUIRED",
  "DLE_OS_SIM_NEW_ORDER_PAYMENT_NOTE_REQUIRED", "DLE_OS_SIM_NEW_ORDER_SHIPPING_NOTE_REQUIRED",
  "DLE_OS_SIM_NEW_ORDER_DELIVERY_NOTE_REQUIRED", "DLE_OS_SIM_NEW_ORDER_PRICE_NOTE_REQUIRED"
]) check(store.includes(code), `server validation includes ${code}`);
check(css.includes(".intake-choice-disabled"), "disabled option uses existing Intake visual language");
check(css.includes(".intake-triggered-summary"), "triggered actions use scoped Intake styling");
check(!/fetch\([^)]*(email|notification)/i.test(wizard), "New Order adds no email or notification automation");

console.log(`PASS: ${checks.length} New Order Intake UI and contract checks.`);

# Quoted New Order foundation — E2E-SIM-001

Implemented 2026-09-22. No customer PO or live New Order was generated.

The canonical New Order flow captures actual PO facts separately from an exact submitted approval. Search defaults to SUBMITTED and offers HISTORY, including retained superseded submitted revisions. Search/preview/selection do not save drafts, change the source RFQ, or award quotations.

## Persistence and state boundary

Optional `OrderIntake` on the existing intake record contains actual facts, quote reference and baseline, server-calculated comparisons/discrepancies, questionnaire, Intake-owned CUSTOMER_PO evidence with verified SHA256, revision and append-only actor/time/request history. Binaries use existing staged document storage. No new binary store.

Explicit save creates or updates DRAFT. Submission validates evidence and questionnaire and sets READY_FOR_CONTRACT_REVIEW with HandoffTarget Contract Review. New records are excluded from Technical Review. This foundation does not implement Contract Review acceptance/exception-resolution controls, award, or SO/WO release. Older records deserialize without migration. The obsolete NEW_ORDER submission through the generic RFQ-create endpoint now directs callers to the canonical New Order API, preventing a second creation path.

Customer + trimmed case-insensitive PO identity resumes existing records. Exact request retry is a no-op; changed request reuse and stale revisions are rejected. Quote-reference lookup lets either entry door find existing intakes; different POs can reuse a quote. The Submitted-page shortcut itself is not added in this foundation.

## APIs

- GET `/api/sim/new-orders/quotes?customerId=...&query=...&bucket=SUBMITTED|HISTORY`
- POST `/api/sim/new-orders/preview` (read-only)
- GET `/api/sim/new-orders?customerId=...&po=...&approvalId=...`
- POST `/api/sim/new-orders` (explicit save or submit, revision/idempotency checked)
- GET `/api/sim/new-orders/{id}/documents/{documentId}` (verified Intake PO retrieval)

## Verification

Live browser: Intake Wizard > New Order > DLE-SIM-CUSTOMER > Browse prior quotes (read-only). Search by `SIM-ASSY-001 A` found SIM-Q-0042-R01 under SUBMITTED. Exact selection displayed:

- Source RFQI-SIM-0042
- Approval 706605ce-c034-4a8f-ad6c-f2c3a0c98868 / version 1
- SIM-ASSY-001 / A, quantity 10, USD 70.64 each, USD 706.40 extended, 3 Weeks
- Actual unentered fields MISSING; delivery/payment/shipping NOT_COMPARABLE
- HISTORY available, no current match for this customer

Authenticated read-only checks on the final restarted host confirmed the same values. Before/after SHA256 checks passed for both `.sim-state/data/rfq-intakes.json` and `rfq-lanes.json`. No live order was saved. Verification evidence: `tmp/new-order-live-preview.json`, `tmp/new-order-before-hashes.json`.

37 isolated server assertions passed, covering searches and exact versions, historical/superseded versions, core/charge comparisons, missing/manual terms, no-quote submission, durable resume, duplicate/concurrent starts, retry/stale protection, evidence verification/retrieval, distinct review routing, and preservation of every pre-existing record and quote lane.

UI suites passed: run-new-order-navigation-tests.mjs; run-new-order-ui-contract-tests.mjs (50 checks); run-ui-contract-tests.mjs (62 checks plus its identification checks); run-back-navigation-tests.mjs (10 checks); run-customer-request-tests.mjs; run-assembly-identification-tests.mjs. JavaScript syntax check passed.

Build succeeded. NuGet vulnerability lookup emitted NU1900 because api.nuget.org was unavailable; compilation and tests passed.

Run the focused suite with `Tests/SimRfqIntakeWizard001/run-new-order-tests.ps1`. It uses an isolated copy of the submitted E2E checkpoint; it never resets/replaces live business data. If dependencies have not been restored, restore Tests/SimNewOrder001 first.

## Resume

Unlock SIM if requested after restart. Intake Wizard > New Order > select customer. Use Browse prior quotes to inspect without creating a record. Stop before generating or uploading the E2E customer PO until the next authorized walkthrough step.

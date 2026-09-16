# SIM Quotation Final Review V1

Internal approval review with customer quote preview and approved-snapshot PDF generation. No email, payment workflow, or contract engine.
The supplied QF-7.2.2.1 checklist excerpt guides this V1; the source form was not available in the repository, so this is not a claim of complete form compliance.

- Open from an RFQ. Server computes pricing from latest completed Materials/Labor snapshots for current BOM, manufacturing definition and quantity. NRE is separate; total is combined unit price × quantity.
- Quote Due remains unavailable. Completed Labor supplies Manufacturing Lead; Materials and Manufacturing leads provide the delivery suggestion described below. Assembly type supplies the available description. The reviewer confirms quoted delivery.
- Delivery is required; notes are optional. The six deferred Quality/Risk fields are no longer displayed or required; legacy answers remain preserved.
- POST `/api/sim/rfqs/{id}/final-review/approve` uses existing SIM authentication and technical_review.disposition capability; GET uses technical_review.view. Prices, identity and time come from the server.
- `rfq-lanes.json` retains optional `finalReviews[]` (QUOTATION_FINAL_REVIEW_V1). Approval appends under the existing store gate with verified atomic replacement. No update/delete approval endpoint exists. The snapshot includes frozen commercial summary, separate NRE lines, answers, source versions/token, reviewer identity and UTC time.
- Expected source fingerprint and approval count prevent stale and duplicate approvals. Subsequent source edits retain history and require reapproval after completion. Source history is not rewritten. RFQs displays Quote Approved only for a current approval.
- Answers remain in browser working state until approval; Back warns before abandoning unsaved answers. V1 has no separate draft-save workflow.
- RFQI-SIM-0037 is the synthetic runtime qualification fixture. Never approve real Abbott records as an automated test.

## Derived lead guidance
Completed source leads are converted to exact days before addition. Display uses Days below seven and rounds up to whole Weeks otherwise. Stock contributes zero; a missing lead leaves the suggestion unavailable. Source units and versions remain unchanged.

Quoted Delivery uses a whole-number Days/Weeks pair (0-36500), defaulted only when no prior reviewer delivery exists. Legacy text decisions remain readable and are never silently replaced. A changed source requires fresh Final Check answers. As before, answers persist on approval, not as unapproved drafts. The immutable approval retains exact source days, derived suggestion and reviewer value/unit.

## Customer supplied material
The Materials row CustomerSupplied flag is the sole editable source. Final Review joins flagged saved rows through the accepted CandidateId/BomVersion and Index to lineNumber (Find No.) and partNumber (Internal P/N); it reports saved draft designations while keeping completion/approval gates intact. Approved summaries freeze the resulting identity list. Customer quote preview uses the same summary, or the immutable summary for a current approval, and excludes internal risk notes, costs, markup and review answers. Unapproved previews are clearly marked Draft. No customer transmission is implemented.

## Quote-line presentation
Final Review groups the current single assembly pricing, delivery, customer-supplied identities and completed Labor NRE in one line section. The canonical intake identifier is the Quote No. Current Materials and Labor contracts explicitly support one assembly; this layout does not enable unsupported multi-assembly pricing. NRE is safely associated through the completed Labor DefinitionId and the single assembly in its RFQ. Description retains the existing summary source (Technical Review assembly type); missing values display Not provided.

The six deferred Quality/Risk fields are no longer displayed or required. Legacy answers remain in persistence; delivery, source-completion, authorization, stale-source and immutable approval checks remain. Quoted Delivery still persists upon approval, not as an unapproved draft.

Total remains the unchanged production subtotal. Read-only QuoteTotal adds decimal Total + NreTotal for overall quote presentation. NRE is not added to unit prices and its individual records remain unchanged.

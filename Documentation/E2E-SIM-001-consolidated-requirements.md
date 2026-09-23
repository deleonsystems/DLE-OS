# Consolidated New Order requirements

Flow version 3 removes the PO-flowdowns question. The optional **Other customer requirements** input uses `questionnaire.specialRequirements` for new entries. `poFlowdowns` and `additionalContractQualityRequirements` are retained unchanged and displayed as labeled prior notes whenever nonempty.

An older record may already have nonempty `specialRequirements`. On restoration from a pre-v3 flow, the UI leaves that property untouched, displays it as **Prior special requirements**, and uses optional `questionnaire.otherCustomerRequirements` for the consolidated entry. The presence of that optional property preserves this distinction on later saves. It is omitted for normal new entries. There is no bulk migration, silent concatenation, or business-state write on rendering/restoration.

The existing `requirementsIdentifiedOnAttachedDocument` property is reused for the explicit final-review acknowledgment: **I reviewed the customer PO and captured its requirements.** It is never inferred from an attachment. The existing server submission guard remains unchanged. Editing the consolidated text clears acknowledgment; Save draft remains permitted without acknowledgment.

Stable saved step keys map `po-flowdowns` to `additional-requirements`. Version 2 numeric positions use the former step list; pre-versioned positions also account for the earlier technical-source and quote/facts ordering changes. New saves carry `flowVersion: 3` and `wizardStepKey`.

Verified PO filenames and retrieval links appear beside the requirements field and in final review. Structured requirement selections appear separately in the summary, with explicit Yes/No entries. This change does not populate scenario-specific requirements, alter quote/PO facts, accept a contract, or release an order.

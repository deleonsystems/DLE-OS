# SIM material supplemental child charges

Charges live on each Material quote row under optional `charges`, keyed by a GUID. Parent identity is the plan CandidateId + BomVersion + row Index, never the displayed Find/child sequence. Existing charge IDs cannot move between parents, including IDs in completed history. Child sequence is display-only and does not change the accepted BOM.

Each charge stores description, category, raw cost, treatment (BLEND / SEPARATE / NRE), markup treatment (MATERIAL / CUSTOM / NONE), optional custom markup and notes. Save requests use chargeContractVersion 1; outdated clients cannot erase saved charges. Up to 200 charges per quote, nonnegative costs up to 1 billion and markup up to 10000 percent are supported, with six decimal places for charge inputs. Draft descriptions/amounts can be blank; completion requires them.

Sell amount is raw cost times the selected markup factor, rounded to cents away from zero. BLEND sell is added to the existing marked-up BOM order cost before division by Qty Quoted and final unit cent rounding. SEPARATE and NRE amounts are never divided by quantity or included in unit sale. Explicit child charges remain chargeable even on customer-supplied/reference parents; only the existing BOM cost exclusion is automatic.

The footer exposes BOM cost, blended raw cost, recurring cost basis, unit sale, separate sell charges and material NRE independently. Completed snapshots retain charge rows and SupplementalTotals. Business idempotency includes normalized charge content; historical snapshots remain immutable. Absent optional persistence fields remain absent in legacy snapshots.

Final Review retains MaterialSupplemental from the completed Materials version. Minimal existing quote presentation/projection additions identify separate material charges and material NRE, and QuoteTotal adds those amounts once. Internal raw costs/markup/notes are excluded from customer output. Existing PDF artifacts are not regenerated or overwritten.

Synthetic backend and UI tests cover arithmetic, all markup modes, validation, parent ownership, save/reopen, completed history, idempotency, legacy-client rejection and removal. No Labor calculations or accepted BOM records are changed.

UX pass 2: + Charge appears beside Total Cost. Category leads the child controls; only Other reveals Description. Known category selections supply the existing persisted description field. Existing saved descriptions are not rewritten on load. New charges default to Tariff / Duty; category changes suggest BLEND or NRE until the buyer explicitly chooses Customer Pricing. Existing saved pricing is never defaulted again. Standard markup labels follow current Material Markup; CUSTOM and NONE retain existing calculation semantics. No persistence or downstream contract changes.

Fee quantity: the compact costing line now has editable positive Qty (default 1; up to 1,000,000 with six decimal places), fixed EA, unit Cost, calculated Qty x Cost Ext Cost, and marked-up Sell. Legacy omitted Quantity means 1; unit quantity normalizes to omitted persistence. Quantity participates in completion comparison and immutable snapshots. Contract version 2 protects non-unit quantities from older clients. All three pricing treatments use the extended fee cost.

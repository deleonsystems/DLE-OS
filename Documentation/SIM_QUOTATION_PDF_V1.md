# SIM quotation PDF V1

PDF generation accepts an existing immutable Final Review approval version, never live Materials or Labor. The customer projection explicitly allows customer, assembly/revision/quantity, combined sale price, product total, one-time charges, approved delivery and customer-supplied identities. Internal notes, risk answers, costs, rates and markup are excluded. Missing buyer/contact/reference/contact information is omitted rather than invented.

Customer number is derived deterministically from the canonical SIM RFQ and approval version: RFQI-SIM-0036 approval 1 becomes SIM-Q-0036-R01. No separate sequence or identity mutation occurs.

Authenticated POST/GET `/api/sim/rfqs/{id}/final-review/{version}/pdf` generate/view the selected approved version. POST requires disposition permission; GET requires review access. Unapproved versions are rejected. Previously approved versions remain reproducible after later working edits.

Artifacts reside under `.sim-state/data/quotation-pdfs/{approval.Id}/`: `quotation.pdf` and `manifest.json`. The manifest retains exact approval, approver/time, source versions, renderer revision and SHA-256. Existing PDFs are reused and verified on retrieval. Each revision has a separate folder. No customer email is sent.

ReportLab runs through the existing SIM Python runtime convention (`DLE_OS_SIM_BOM_PYTHON`, otherwise the bundled user runtime), with no shell, bounded timeout, hidden process and temporary-input cleanup. Install reportlab in that runtime if deploying elsewhere. The exact supplied logo is packaged in Quotation; T: is not needed after packaging. Its original is untouched.

The renderer uses US Letter, restrained navy/blue typography, unchanged logo aspect ratio, repeating page footer and separate recurring/NRE totals. Content paginates instead of shrinking. The footer omits contact details because no approved company contact source exists in this snapshot contract.

## Commercial layout v2
The polished layout groups quote number/date in the right header, shows NRE below the assembly in the commercial table, frames delivery/customer-supply in a restrained callout, and right-aligns emphasized grand totals. No new customer data is inferred. Layout v2 is stored separately in each approval folder under `layout-v2/`; original v1 PDF and manifest remain untouched. Generated View URLs include `?layout=2`; old URLs without the parameter still retrieve original v1. Quote identity, approved commercial data and approval version do not change for a presentation-only revision.

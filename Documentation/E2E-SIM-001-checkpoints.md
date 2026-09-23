# E2E-SIM-001 checkpoint trail

Objective: one synthetic job through real DLE-OS transitions to Shipping and Ready to Invoice. Update this file at each observed checkpoint; never fill future IDs or completion evidence prospectively.

## Identity register

| Role | Alias | Canonical identity |
|---|---|---|
| Scenario | E2E-SIM-001 | External mission alias; runtime scenario remains baseline, generation 154 |
| Customer | DLE-SIM-CUSTOMER | SIM-CUSTOMER-E2E-001; number 990901 |
| Assembly | SIM-ASSY-001 | Requested customer assembly identity; revision A, quantity 10 |
| RFQ | SIM-E2E-001-RFQ | Not created; capture actual RFQI-SIM-nnnn at submission |
| Quote / approval | SIM-E2E-001-QUOTE | Not created |
| Award / customer PO | SIM-E2E-001-PO | Not created |
| SO / WO | SIM-E2E-001-SO / SIM-E2E-001-WO | Not created; preserve required canonical ID formats |
| Demand / procurement / receipt | Future aliases within E2E-SIM-001 | Not created |
| Production / shipment / Ready to Invoice | Future aliases within E2E-SIM-001 | Not created |

The Intake Wizard has no dedicated mission-alias field. Preserve the alias in all source PDFs and this mapping; do not replace runtime scenarioId baseline or generated IDs.

## CP-001 - source package and customer prerequisite

- Scenario: E2E-SIM-001.
- User action: authorized mission start, customer prerequisite and RFQ package; reserved actual walkthrough for Miguel.
- System action: generated three native-text PDFs, manifest, ZIP and validation evidence; added one SIM in-memory customer fixture; restarted existing SIM through governed stop/start tools.
- Canonical IDs: customer SIM-CUSTOMER-E2E-001 / 990901 only. No intake, quotation, PO, inventory or job created.
- Source: branch feature/miguel-new-order-intake; HEAD c1a990d08a2d3e5f0610b616ad739adf763976a0. Existing uncommitted intake-wizard.js/rfq-workspace.css edits, Tests/SimRfqs001/install-demo.py and output artifacts were retained.
- Versions/hashes: package release A; exact PDF SHA-256 values in output/pdf/E2E-SIM-001/manifest.json. Generator Tools/E2ESim001/build_package.py.
- Validation evidence: all eight PDF pages rendered by Poppler and visually reviewed; BOM round-trip 12/12; 25 material designators, 23 placed items plus PCB/bag; 40 electrical pins each assigned once; 12 SMT placements, 6 through-hole components / 12 pins per unit. Existing enriched parser returns TABLES_COMPLETE / 12 rows; no accepted candidate was fabricated.
- Regression evidence: Tests/SimRfqIntakeWizard001/run-tests.ps1 passed in isolated copy 87bc884b903b4c9386c1932095f5011f: 62 UI contract checks and 38 intake checks plus document/assembly identification checks. Build passed; NuGet vulnerability-feed query emitted NU1900 warnings because the feed was unavailable. Active SIM state was byte-for-byte unchanged by tests.
- Runtime evidence: authenticated normal-TLS status READY, SIM, PRIVATE_LAN_HTTPS, generation 154, SQLite schema 4, no outbound providers. New customer resolves by display name, customer number and customer ID; Abbott still resolves. 96 files under data, state and intake-documents match pre-restart SHA-256 values. See runtime-validation.json and business-state-before.json beside package.
- Resulting state: PACKAGE_READY / CUSTOMER_SELECTABLE / AWAITING_MIGUEL_INTAKE. No business workflow completion asserted.
- Next expected transition: Miguel opens Home > INTAKE WIZARD > New Quote Request and selects DLE-SIM-CUSTOMER.
- Missing capability/limits: alias-array-only directory search is not implemented; use display name or number. Old local extraction path reads ten rows; use the existing enriched full-table path during Technical Review and require 12/12. Human BOM/identity review remains required. Purchased supplier-controlled bare PCB is intentional; this is assembly procurement, not a PCB fabrication engineering job. Final Ready-to-Invoice boundary is deferred until Shipping.
- Stop point: prepared starting point only. No intake submission or Technical Review performed for this mission.

## CP-002 - expected first Intake checkpoint (PENDING)

- Scenario: E2E-SIM-001.
- User action: choose New Quote Request, customer, 1 assembly, SIM-ASSY-001 / A / 10, PCB Assembly, Material + Labor, technical files Yes; attach all three PDFs, request Price + Lead Time; review and submit once.
- System action expected: preserve verified document binaries and metadata; create intake with idempotency correlation and server-owned audit.
- Canonical IDs: pending; record actual intake ID, request correlation, each document ID and stored hash after successful submission.
- Source versions: package release A; compare stored document bytes/hashes with package manifest.
- Validation evidence: pending; inspect actual POST response and read the same intake back, verifying identity, scope, quantity, all 3 files and hashes.
- Expected resulting state: intakeType NEW_QUOTE_REQUEST; handoffTarget Technical Review; status READY_FOR_RFQ_QUALIFICATION; documentPreservationState BINARIES_VERIFIED_SIM; technicalReview.nextReviewPhase MANUFACTURING_LABOR_REVIEW; materials/manufacturing review statuses NOT_STARTED.
- Next transition: Technical Review - RFQ Review, manufacturing review first, then material/BOM review.
- Missing capability: none currently identified for intake submission; record actual failures before continuing.

Future checkpoint records must include scenario ID, user action, system action, canonical IDs, source versions/hashes, validation evidence, resulting state, next transition and missing capability. Freeze actual quote approval/BOM/labor/document/commercial values before any exact award or PO generation. Never infer shipping or Ready to Invoice from manually assigned statuses.

## CP-002 observed / BLOCKER-001 resolved - 2026-09-20 Pacific

- Scenario: E2E-SIM-001; same canonical intake RFQI-SIM-0042, correlation ebda5f17-ccae-4e2f-b3cb-28b765f9dd89; assembly SIM-ASSY-001 / A / 10.
- User action: completed Intake and accepted separate production drawing and standalone BOM in Technical Review; reported embedded-only extraction blocker; authorized smallest fix and safe resume.
- Observed source state: two stored files, BOM and Technical PDFs. The RFQ cover letter is not attached to this intake, despite its mention in the user report. No attachment was silently added or reclassified. Initial drawing identification was DRAWING_AND_BOM; the accepted Technical Review correction to DRAWING is preserved.
- Root cause: UI packageCanBuild and server AnalysisDocuments/CandidateBomAsync required ASSEMBLY_DRAWING + EmbeddedBom. Full-table local analysis was selected only for a separate MANUFACTURER_ENRICHMENT source. The package already supported standalone authority correctly.
- System action: broadened candidate eligibility to reviewed governing parent BOM PDFs, kept separate production authority, selected existing local V2 full-table parser for standalone PDFs, retained embedded behavior and PDF/workflow/hash gates. Restarted SIM; submitted the normal analysis-jobs command once for RFQI-SIM-0042. No direct candidate-state write.
- Generated IDs: analysis job 987c20b1-a7b2-4174-8829-51ecc1605746; candidate bf7cf8ee-c819-4ced-9e94-8d25dbab8c2f.
- Governing BOM: 5c8db6b9-eb37-499c-a168-b65f292fd6a7, 02_SIM-ASSY-001_BOM_A.pdf, SHA-256 45855a7832c50d0a032d66280b9805bf18f3d5f4ed43900e44a4dbca1d4b2418 (unchanged release A).
- Production authority: a8a9b54d-0f07-476f-a215-402a2e7bfe4f, 03_SIM-ASSY-001_Technical_A.pdf; saved manufacturing snapshot and technical package unchanged.
- Validation: normal job SUCCEEDED, LOCAL_DOCUMENT, V2; TABLES_COMPLETE; all 12 P/N/quantity/designator triples match supplied BOM. Candidate remains unapproved. Live response rendered through current UI exposes Candidate BOM Ready and enabled Review Candidate BOM. No operator browser clicks automated.
- Preservation: 11 unrelated intakes, all prior analysis jobs and 100 other business files unchanged; document metadata/binaries, accepted technical package, manufacturing snapshot/workflow and prior BOM acceptances unchanged. Only normal candidate/job persistence updated rfq-intakes.json. Runtime restart changed process/session/log metadata, without reset.
- Tests: clean final build; SimAnalysis001 complete isolated suite, 1159 PASS assertions; five focused Technical Review JS suites; UI projection against live response. Earlier local test runs identified an old unsupported-standalone assertion (updated) and missing sandbox Python override (set for final run). Evidence under output/E2E-SIM-001-blocker-001: final-tests.log, verification.json, review-after.json, submitted-job.json and before snapshots.
- Resulting state: TECHNICAL_REVIEW_IN_PROGRESS; Candidate BOM Ready, unapproved, 12 rows. No accepted BOM, quotation or downstream completion manufactured.
- Next action: Miguel refreshes/reopens RFQI-SIM-0042 and selects Review Candidate BOM; review and approve rows through existing workflow. No intake replay or document reacceptance required.
- Remaining scope limit: arbitrary PDF layouts, standalone spreadsheets and scan workflows are not expanded by this fix. RFQ cover-letter attachment discrepancy remains visible for a later explicit document-completeness decision.
- Stop: blocker resolved; waiting for live Technical Review walkthrough.

## BLOCKER-002 resolved - Intake-owned original customer request

- Scenario: E2E-SIM-001; same intake RFQI-SIM-0042, SIM-ASSY-001 / A / 10.
- User action: authorized adding CustomerRequestDocuments ownership and appending the original RFQ through the new existing-intake command; no candidate approvals or downstream work.
- System action: optional commercial attachment collection, existing verified storage, Intake-authorized append endpoint and dedicated retrieval; small existing-intake UI and read-only Original Customer Request in Technical Review. Commercial collection never enters TechnicalFiles or technical package inventory. SHA-256 duplicate detection returns the original attachment without writing state. Changed content appends rather than replaces.
- Attachment: bbf3bdc0-797a-47dc-84df-d2d71106f3a6, 01_SIM-E2E-001_RFQ_A.pdf; owner Intake; type CUSTOMER_RFQ_REQUEST; added by SIM Administrator through normal API.
- SHA-256: ED0A3C3FA691A64B749DC1754AFB8898213766A3B29B3190519EF5C1F2456B8D; matches original package release A. GET returned 200 application/pdf with identical bytes; duplicate POST returned same ID and unchanged dataset hash.
- Preservation: after excluding only the new CustomerRequestDocuments field, every original field of RFQI-SIM-0042 is identical to its pre-attachment record. This includes full Technical Review, candidate, confirmations, authority decisions, manufacturing snapshot and document metadata. Eleven other intakes, all analysis jobs and 100 other existing business files unchanged. Only two new storage files (binary and manifest) added, plus normal intake dataset update. Runtime metadata/logs changed on activation restart; no reset.
- Candidate: bf7cf8ee-c819-4ced-9e94-8d25dbab8c2f, 12 rows, zero confirmed. No analysis rerun. BOM and Production authority IDs remain those recorded under BLOCKER-001.
- Validation: clean build, complete isolated SimAnalysis001 suite (1176 PASS assertions), dedicated customer-request JS behavioral tests, existing Intake UI/identification checks, unified package and entry-confirmation UI suites. Saved live response renders request in Intake and read-only Technical Review; technical package excludes it and Review Candidate BOM remains enabled. No operator browser actions performed.
- Evidence: output/E2E-SIM-001-blocker-002/verification.json, attachment-response.json, review-after.json, retrieved-request.pdf, intakes-before.json, hashes-before.json and tests.log.
- Resulting state: original customer commercial source preserved under existing Intake; Technical Review unchanged and ready to resume.
- Next action: refresh/reopen RFQI-SIM-0042; view Original Customer Request if desired, then Review Candidate BOM.
- Missing capability: none for this blocker. No commercial-term extraction or reconciliation implemented.
- Stop: before any Candidate BOM approval or Materials Quotation.

## End-of-day checkpoint - 2026-09-21 (current resume authority)

Full user-approved handoff: [E2E-SIM-001-EOD-2026-09-21.md](E2E-SIM-001-EOD-2026-09-21.md). This supersedes earlier pending/resume descriptions above; historical entries remain unchanged.

- Scenario E2E-SIM-001; intake RFQI-SIM-0042; SIM-ASSY-001 / A / quantity 10.
- Read-only checkpoint verification: Materials COMPLETE, version 1; Labor COMPLETE, version 2; quotation approvals 0.
- Branch feature/miguel-new-order-intake; HEAD 6b54b24cb8cf1fb053dc2979519c5b334aebb101. Existing uncommitted work remains; no checkpoint commit made.
- Commercial checkpoint: Materials $37.04/unit + Labor $33.60/unit = $70.64/unit; ten assemblies $706.40; delivery 3 Weeks; NRE $0.00.
- Intake owns original CUSTOMER_RFQ_REQUEST; standalone BOM and Production drawing remain distinct authorities. Candidate ID bf7cf8ee-c819-4ced-9e94-8d25dbab8c2f, 12 rows.
- Four Labor visuals and notes are stored. Hand Solder is text-only. Later propagation through accepted Labor Definition, Production Routing and operator presentation remains UNPROVEN and must be tested during execution.
- True quotation preview shares the final PDF model/layout. Embedded watermarks, no final actions, and no approval writes. Live API/PDF/page-pixel checks passed; final corrected browser display review remains for Miguel next session.
- Known template gaps: payment terms, shipping terms and quote validity. User explicitly accepts these as nonblocking for this E2E unless Miguel decides otherwise.
- Exact resume: RFQs > RFQI-SIM-0042 > Quotation Final Review > Preview Customer Quote. Review visually, return to Final Review, then approve/freeze only as the next authorized live checkpoint.
- Before a synthetic customer PO, preserve approved quotation ID/version, BOM snapshot/version/hash, Labor snapshot/version, visual IDs/hashes, price, quantity, revision, delivery, commercial definition and source lineage. Then derive the exact award/PO from that approved definition.
- Future shortage plan only: SIM-OPTO-4 required 20, available 12, short 8. No shortage or inventory is to be fabricated at quotation stage.
- No award, customer PO, New Order, SO/WO, production demand/inventory, Kitting, Purchasing/Receiving, Production routing/completion, shipment or invoice-ready state was advanced for this checkpoint.
- Operating rule: record cosmetic/minor issues and continue; stop to fix changes in business meaning, lost traceability/source information, fake workflow, or incorrect downstream data.
- This end-of-day action changes documentation only. Quotation remains UNAPPROVED. Stop for the day; no approval or downstream execution authorized by recording this handoff.

## Commercial submission checkpoint - 2026-09-22

- Authorized scope: implement Active / Completed commercial lifecycle and initialize only RFQI-SIM-0042 / SIM-Q-0042-R01 submission.
- Result: ACTIVE / Submitted; lifecycle revision 1; approval 706605ce-c034-4a8f-ad6c-f2c3a0c98868, version 1, preserved exactly.
- SubmittedAt: 2026-09-22T13:36:36.9866414Z (06:36:36 PDT). ExpiresAt: 2026-10-22T13:36:36.9866414Z (06:36:36 PDT). Business timezone America/Los_Angeles; 30 calendar days.
- Price remains $70.64/unit; quantity 10; total $706.40; delivery 3 Weeks. No customer communication was sent.
- Preservation: 117 existing business files checked; only rfq-lanes.json changed, solely by adding RFQI-SIM-0042.commercial. All prior lane fields, approval, Intake/Technical Review/BOM, document binaries and unrelated state unchanged; no new business files.
- Tests: 34 isolated C# assertions plus lifecycle UI, RFQ navigation/workbench UI and Final Review UI suites pass. Test awards/closures occur only in disposable copies.
- Evidence: output/E2E-SIM-001-lifecycle/submission-request.json, submission-result.json, list-after.json, approval-before.json, approval-after.json, preservation-verification.json.
- List currently shows 12 Active, 0 Completed. Expiring Soon is derived at seven calendar days. Overdue submissions project as Completed / Expired; Record Expiration invokes the idempotent audited transition. No background expiration job is installed.
- OrderLinks is empty. No award, customer PO, New Order, SO/WO, Kitting or downstream execution created.
- Resume: RFQs > ACTIVE > SIM-Q-0042-R01 / RFQI-SIM-0042 > Commercial Lifecycle. Stop after submission; award remains a later authorized checkpoint.

## Three-view RFQ projection - 2026-09-22

- Current RFQ views supersede the earlier two-bucket description: ACTIVE (internal processing), SUBMITTED (Submitted / Expiring Soon), HISTORY (Awarded / Expired / Lost / Closed).
- Default ACTIVE. Verified live counts: Active 11, Submitted 1, History 0. RFQI-SIM-0042 / SIM-Q-0042-R01 appears only in SUBMITTED.
- All 117 business files remained byte-for-byte unchanged. No lifecycle transition, date, price, approval, or downstream state changed.
- Build, 34 isolated lifecycle assertions, lifecycle UI tests and RFQ UI navigation tests pass. Evidence: output/E2E-SIM-001-three-views/verification.json.
- Resume: RFQs > SUBMITTED > RFQI-SIM-0042 / SIM-Q-0042-R01. No award or order created.

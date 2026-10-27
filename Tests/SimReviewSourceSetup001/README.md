# Technical Review source setup

For single-assembly new-quote reviews, the capability-gated screen provides Production drawing (PDF) and BOM source (VPRO5 TXT) selectors, using existing bounded linked-folder copies or the same saved-document upload pipeline. Each copy retains existing provenance. No original files are modified.

Save Draft stores incomplete source choices, exact saved-copy hashes and reviewer/time history. It does not change Hold, classification, sufficiency, document approval, candidate or release status. Save & Build Candidate verifies current review/source tokens, requires both files, and explicitly resumes an On Hold review. A literal source/job identity mismatch requires a fresh reviewer confirmation and reason bound to exact bytes and target identity. No suffix normalization or inferred equivalence is used.

An unaccepted candidate replacement requires explicit confirmation and archives the previous candidate. Accepted BOMs/slides and drawing annotations block unsafe replacement. No prior source acceptance carries onto new bytes. Existing non-VPRO candidates and other BOM formats retain the existing workflow. The new source setup does not itself confirm the RFQ package, approve production documents, accept a BOM or submit an RFQ; those remain separate existing review steps.

Supported TXT: ASCII, at most 1 MiB, the exact 13-column tab-delimited VPRO5 export, bounded to 2,000 data rows. Primary quantity divisor must be 1. Integer/decimal Finds and NOB installation notes are preserved; leading drawing/change notes and separators remain separate evidence. Exact DO NOT POPULATE placeholders remain visible DNP positions requiring review, with suppressed quantity retained as evidence. Up to two suppressed alternate proposals per Find require divisor 10, quantity .0001, alternate factor 1 or .0001, zero scrap and matching or blank literal unit. Pairings remain unapproved. Unknown/ambiguous grouping fails without a write; raw rows, aliases and numeric fields remain available.

Tests:
- Build this project, then run SimAnalysis001.dll with a newly created empty temporary fixture directory. It uses synthetic records only.
- Run node Tests/SimReviewSourceSetup001/run-source-ui-tests.mjs.
- Optional --inspect-format <path> reads an existing TXT in memory against its own literal identity, reports counts and checks bytes unchanged. It does not create any record, persist a candidate or reconcile a real job identity.

Activation requires a supported SIM backend rebuild/restart. Source UI remains gated off against the older runtime. Do not refresh a user tab with unsaved work. Runtime/browser acceptance must be checked after authorized activation.

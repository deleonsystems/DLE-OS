# Scanned BOM review qualification

Scanned BOM Review preserves a reviewed transcription tied to its original document hash, setup and worksheet version. Candidate builds consume only saved, accepted transcription; no OCR or provider is invoked during a Candidate build. Non-component rows remain evidence. Accepted continuation rows without remaining content are excluded without inferring a merge; populated continuations block the build.

The local extraction layout is qualified only for the hash and geometry in `SRC/workspaces/technical-review/scanned-bom-layout.json`. Other layouts fail closed. Manufacturer identities remain separate proposals. Saving upstream edits archives the current derived Candidate; explicit rebuild creates fresh decisions, and identical retries reuse the current result.

## Checks

- Build `SimScannedBomReview001.csproj` into a temporary output directory. Pass the repository path and `--preserved` for open/save/setup persistence, or `--candidate` for corrected source mapping, provenance, fresh rebuild and idempotency. These modes do not invoke OCR. They copy local RFQI-SIM-0041 and Scenario-1 documents into disposable test storage; the local scenarios must exist. Candidate tests clear only the disposable copy's derived history.
- The default executable mode exercises the existing local OCR qualification. It requires Windows OCR and the original local scenarios.
- `test_structure.py` checks row retention, cell bounds and rejection of ambiguous OCR boxes without running OCR.
- `../SimTechnicalReview001/run-scanned-review-tests.mjs` covers transcription, persistence, source inspection, zoom/pan, navigation, resizing, row acceptance and Candidate handoff states.
- `../SimTechnicalReview001/run-scanned-setup-tests.mjs` covers setup reuse and scanned/text routing.
- The unified-package, Candidate, accepted-BOM and other Technical Review UI suites cover integration and navigation.

All test mutations use disposable storage. Customer source files, OCR output and runtime state are not committed as fixtures. Set `DLE_OS_SIM_BOM_PYTHON` when the installed PDFium runtime differs from the default local runtime.

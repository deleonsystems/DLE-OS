# Quotation preview contract

Run against an unapproved E2E-SIM-001 checkpoint with Materials and Labor complete. The executable copies the two required datasets into a unique output directory before exercising any writes. It never approves the source intake. It uses the real final approval/PDF path only in that disposable copy.

Build with an isolated output directory while the SIM host is running:

```powershell
dotnet build Tests/SimQuotationPreview001/SimQuotationPreview001.csproj -o output/quotation-preview-tests -p:UseAppHost=false
$env:DLE_OS_SIM_BOM_PYTHON='<Python with reportlab, pdfplumber and Pillow>'
dotnet output/quotation-preview-tests/SimAnalysis001.dll .sim-state output/quotation-preview-verification
& $env:DLE_OS_SIM_BOM_PYTHON Tests/SimQuotationPreview001/verify-pdfs.py output/quotation-preview-verification
node Tests/SimRfqs001/run-final-review-ui-tests.mjs
```

Checks include stale source/history rejection, delivery validation, unapproved final-document rejection, preview state preservation, commercial projection equality, internal-field exclusion, immutable approved PDF caching, approved-answer authority, exact preview-page pixels, and identical seven-page text positions/pagination except preview markings. Rendered PNGs support visual inspection.

The existing final quotation form does not model payment terms, shipping terms, validity, or customer addresses. This change deliberately does not manufacture those fields. Browser preview displays rasterized pages of the same PDF, with no independent pricing or commercial layout.

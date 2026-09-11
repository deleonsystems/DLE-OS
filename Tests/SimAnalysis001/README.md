# SIM Analysis Job Bridge — Phase 1

The normal Technical Review build button submits a DLE job and polls its status.
The existing synchronous candidate endpoint remains for the original local parser
regression suite; the UI does not use it to start a new extraction.

Contracts and correction/persistence types are DLE-owned. `IAnalysisProvider`
accepts approved byte arrays plus the DLE job and instructions; only
`CodexAppServerAnalysisProvider` knows App Server protocol messages. The isolated
offline test provider exercises the same service and persistence boundary.

## Scope and safety

This experimental provider accepts only hashes explicitly listed server-side in
`DLE_OS_SIM_ANALYSIS_APPROVED_SHA256` (comma separated). Leave it unset to disable
transmission. Filenames, customer names, and browser flags cannot authorize files.
**Do not add controlled/customer document hashes for this phase.**

Set `DLE_OS_SIM_CODEX_EXECUTABLE` to the absolute installed Codex executable path
in the SIM process environment. Authentication uses the existing server-side
Codex account. No credentials belong in these variables, job JSON, or source.
The normal MichaelDesk profile, certificates, access code and bindings are unchanged.

The adapter uses App Server stdio, an ephemeral thread, a filesystem profile that
denies root reads except minimal runtime and the empty job workspace, disabled
network access for tools, and disabled shell/apps/plugins/browser capabilities.
Only approved PDF page images/text are included in the analysis prompt. No source
filesystem paths are part of the business contract. Provider traffic itself is
hosted; this is not offline AI. Pin/qualify the installed App Server version before
broader deployment. Routine logs and the browser do not receive raw conversations.

Governing PDF page 2 and supporting PDF page 1 are the bounded representations in
this proof. Unsupported supporting formats produce NOT_COMPARED. Legacy XLS
reading, OCR, arbitrary page selection, universal extraction, approved BOM
promotion and actual Abbott extraction are out of scope.

The fixture generator creates two deterministic PDFs with six invented parts and
a deliberate quantity conflict on line 2. It uses no actual customer documents.
Test providers with fabricated outputs exist only in the isolated test executable;
production never falls back to them when Codex fails.

## Qualification

1. Run `fixture.py <temporary-fixture-directory>` using the existing Python runtime
   with reportlab.
2. Build `SimAnalysis001.csproj` with `UseAppHost=false` and an isolated OutputPath
   while the normal SIM host is running. Invoke the resulting DLL with that fixture
   directory. Do not use the default output path against a running host.
3. Add `--real` only for the approved synthetic App Server round trip. Configure
   the executable in the test process; this test owns its synthetic hash allowlist.

The test executable uses a unique temporary state root. It checks persisted jobs,
deduplication, replacement-provider compatibility, evidence, corrections and prior
versions, restart recovery, failure/retry, timeout, unlocked provider execution,
closed/deleted/source-changed stale results and rejection of unapproved sources.
The optional real run asserts six returned rows and the deliberate conflict.

Existing Intake/Technical Review host suites should be run in an isolated copy of
the relevant source/tests and tracked SIM scenario fixtures. Their legacy scripts
back up/restore their workspace dataset; do not point concurrent tests at the normal
MichaelDesk dataset. Keep the normal port 5177 for the final UI qualification.

Jobs live in the existing RFQ intake dataset's `analysisJobs` collection. Candidate
versions remain under each review, preserving original extraction and correction
audit. A terminal provider success never approves a BOM: candidates stay NEEDS_REVIEW.
Interrupted running jobs become FAILED on startup; retry creates a new job. Queued
jobs resume if their deadline and source approval remain valid. Late source/review
changes prevent publication. Only the host store writes business state.

# Existing Qualification Tooling Consolidation Report

Captured before reusable-harness implementation.

## Inventory

| Area | Representative tooling | Useful controls | Divergence or gap |
|---|---|---|---|
| Customer Master | `Invoke-CustomerMasterSourceQualification.ps1`, `Invoke-CustomerMasterQualifiedAttempt.ps1` | Fresh attempt directories, compiler text checks, current-attempt timestamp/hash checks, startup/progress/hard-runtime bounds, exact started-PID cleanup | Dataset-specific paths and output parsing; first implementation used broad VPro overlap detection; duplicate wrappers; no common event protocol |
| Invoice History bounded qualification | `Invoke-InvoiceHistoryBoundedWindowQualification.ps1`, completion and process-state scripts | Fixed source scope, bounded window, operator-visible state | Separate waiting parent and manual stale-waiter cleanup; process ownership split between scripts; different evidence/verdict shapes |
| Sales Orders / Open Orders | Platform002 qualifier source and refresh helpers | Fixed source list, two-pass qualification, local outputs | Compilation, launch, supervision, and evidence are embedded in mission tooling rather than reusable |
| Live mirror / snapshot refresh | live mirror engine and `Invoke-LiveSnapshotRefresh.ps1` | File lock, fixed allowlists, read-only source profile, transactional downstream boundary | Python/VPro orchestration and package promotion are coupled; not a reusable compiler/runtime supervision boundary |
| Earlier live qualification | mission-specific launch scripts and artifact evidence | Source identity and fingerprint capture | Inconsistent timeout, cleanup, overlap, and manifest conventions |

## Consolidation decision

One repository runner will own:

- exact non-elevated operator/source preflight;
- fixed configuration validation;
- fresh attempt directories;
- conservative Visual PRO/5 variable-name scan;
- compiler launch and text/artifact validation;
- direct process ledger and parent/start-time/path verification;
- startup, first-marker, progress, hard-runtime, completion, and exit gates;
- graceful close followed by exact-PID-only termination when policy permits;
- lock acquisition and evidence-backed stale-lock recovery;
- bounded retry eligibility;
- source identity-before/after comparison;
- JSON Lines protocol validation;
- cleanup/safety evidence, attempt verdict, and manifests.

Dataset-specific tooling will retain only business logic, fixed source lists, output definitions, timeouts, and acceptance rules. Existing direct wrappers remain in place until migrated configurations pass.

## Behaviors explicitly rejected

- Compiler exit code as sole success evidence.
- Reuse of any prior compiled artifact.
- Process-name-wide overlap or termination.
- Age-only stale-lock removal.
- Elevated source reads, drive remapping, UNC substitution, or credential duplication.
- Successful verdict without a single valid completion event, stable source identity, zero writes, zero locks, and zero owned processes remaining.

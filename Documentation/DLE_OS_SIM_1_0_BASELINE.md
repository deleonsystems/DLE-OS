# DLE-OS SIM 1.0 Baseline

## 1. Purpose

DLE-OS SIM 1.0 is the supported local developer environment for safe DLE-OS application development. It provides a deterministic, synthetic, resettable runtime that lets developers build and qualify shared application behavior before governed DEV qualification.

The environment model is:

SIM -> DEV -> LIVE

SIM does not replace DEV. SIM proves local product intent, shared frontend behavior, deterministic state, and bounded workflow contracts. DEV remains the required environment for real integrations, canonical infrastructure, and deployment qualification.

## 2. SIM 1.0 Source Baseline

Canonical branch:

`sim/recovery-phases-2-13`

Canonical SHA:

`8de94ddecf439890896c720377b5aa098fb9fff5`

This exact source baseline qualified on both MichaelDesk and DLE-OS-JRDEV01.

## 3. Supported Developer Machines

MichaelDesk:

- Developer: Miguel
- LAN IP: `192.168.0.201`
- Hostname: `sim-miguel.dle-os.internal.dlemfg.com`
- HTTPS port: `5177`

DLE-OS-JRDEV01:

- Developer: Adan
- LAN IP: `192.168.0.202`
- Hostname: `sim-adan.dle-os.internal.dlemfg.com`
- HTTPS port: `5177`

Permanent SIM access-code values are machine/user-local secrets and are not recorded in this document or in Git.

## 4. Architecture

SIM 1.0 runs a local ASP.NET Core/Kestrel host from the shared repository source. The SIM host serves shared DLE-OS frontend modules, not copied application logic.

The runtime uses synthetic/local providers and a deterministic SQLite state model. Runtime state is stored under `.sim-state`, which is disposable, ignored by Git, and local to each developer machine.

Machine-specific profiles and shortcuts live outside Git. They invoke shared Git tooling and provide local values such as hostname, IP address, certificate thumbprint, and firewall rule name.

LAN HTTPS mode is explicit. SIM does not depend on DEV availability and does not call DEV as a runtime fallback.

SIM identities are synthetic personas served by the SIM host. They exercise shared permission gates without importing LIVE users or DEV identity state.

## 5. Supported Functional Surface

SIM 1.0 supports:

- Shared Home and shell
- Operations Center
- Invoice History
- Purchasing Material Shortages read surface
- Kitting read surfaces
- Production read surfaces
- Work Order Verified Status stateful workflow
- Deterministic workflow failure simulation
- Documents, labels, and print preview
- Synthetic personas
- Deterministic reset and state recreation
- Desktop and LAN browser access
- Developer tooling for Start, Stop, Open, Status, Reset, and Test

## 6. Synthetic Data / State Model

SIM uses deterministic synthetic fixtures tracked in source and local SQLite state generated from those fixtures.

Representative deterministic data includes:

- Synthetic sales orders and sales-order lines
- Synthetic work orders and sales-order/work-order relationships
- Synthetic invoice history headers and lines
- Synthetic Kitting read states
- Synthetic Work Order Verified Status events
- Synthetic document and label preview evidence

Runtime state is resettable and disposable. State generation increments after governed reset operations. The supported scenario is `baseline`, with scenario version `5` at the SIM 1.0 baseline.

`.sim-state` must never be copied between developers. Source and fixtures matter; generated runtime state does not.

## 7. Personas / Permissions

SIM 1.0 supports these synthetic personas:

- SIM Administrator
- Operations Manager
- Kitting Operator
- Shipping Operator
- Read-Only Viewer
- No-Access User
- Disabled User

The current Invoice History permission mapping remains intentionally documented as an ambiguity: Invoice History is gated by `sync.operations` in the qualified baseline. SIM 1.0 records this behavior; it does not claim the permission model is resolved.

## 8. Developer Tooling

Shared Git tooling:

- `Tools/SimRuntime/Start-DleOsSim.ps1`
- `Tools/SimRuntime/Stop-DleOsSim.ps1`
- `Tools/SimRuntime/Open-DleOsSim.ps1`
- `Tools/SimRuntime/Get-DleOsSimStatus.ps1`
- `Tools/SimRuntime/Reset-DleOsSim.ps1`
- `Tools/SimRuntime/Test-DleOsSim.ps1`

Machine-local helper scripts and shortcuts may wrap these commands for convenience, but they must not copy or fork application logic. Profiles and shortcut wrappers remain outside Git.

The supported test entry points are:

- `Tools/SimRuntime/Test-DleOsSim.ps1 -Mode Quick`
- `Tools/SimRuntime/Test-DleOsSim.ps1 -Mode Full`

## 9. Security / Isolation

SIM 1.0 security and isolation boundaries:

- Loopback-only is the default mode.
- LAN mode requires an explicit launcher switch.
- LAN mode binds to an exact private address.
- LAN requests enforce the exact configured hostname.
- LAN mode uses HTTPS.
- LAN browser access is guarded by a SIM access-code flow.
- Windows Firewall is Private-profile and LAN-scoped.
- SIM identities are synthetic only.
- Production secrets are not committed to Git.
- `.sim-state` is ignored by Git.
- Certificate private keys remain local to the workstation.
- Access-code values remain outside Git.
- No public tunnel is part of SIM 1.0.
- No router forwarding is part of SIM 1.0.
- No DEV runtime dependency is part of SIM 1.0.

Certificate thumbprints and hostnames may be documented as operational identifiers. Secret values, credential blobs, tokens, private keys, and access-code values must not be committed.

## 10. Developer Workflow

Canonical daily flow:

1. Fetch the shared SIM baseline.
2. Create a feature branch from the supported baseline or its governed successor.
3. Develop locally in SIM.
4. Run focused tests and the appropriate SIM qualification suite.
5. Commit feature work on the feature branch.
6. Push the feature branch for review.
7. Reconcile through governed review.
8. Qualify in DEV when promotion is intended.
9. Integrate through the governed project process.

Developers must not develop directly on `main` or directly on the shared SIM baseline branch.

## 11. Multi-Developer Model

The multi-developer model is:

same Git source + different local profiles/state

MichaelDesk and DLE-OS-JRDEV01 use the same source baseline SHA and separate local configuration:

- local `sim-profile.json`
- local certificate and private-key ACL
- local firewall rule
- local access-code environment
- local `.sim-state`

Developers must never copy `.sim-state` between machines.

JRDEV Phase 17B proved the canonical SHA reproduced on DLE-OS-JRDEV01 without JRDEV-specific source, runtime, tooling, or LAN defects.

## 12. SIM -> DEV Promotion

Phase 16 proved the promotion model:

SIM feature intent -> Git -> DEV-portable qualification -> immutable DEV frontend release -> authenticated DEV visual acceptance

The original SIM promotion proof commit was:

`a23fa7530848e8082410ba43d1e1b437881adbd7`

The DEV-portable promotion commit was:

`1742528024598b3bc25acc47fa5c4a98e9548782`

The immutable DEV release was:

`20260904T230955Z`

Authenticated DEV visual acceptance confirmed the visible Home tile text:

`History - Price Reference - Dedicated Sync`

Phase 16 also established an important DEV architecture improvement: port `5051` no longer serves frontend content from a mutable Git checkout. This baseline document records that proof model but is not the full DEV deployment record.

## 13. DEV-Required Boundaries

The following remain DEV-required and are not claimed as SIM 1.0 proofs:

- Canonical SQL
- Real ERP/source integrations
- Real Sync Operations
- Real Invoice History refresh
- Real Keycloak/service identity qualification
- Network shares and native Explorer behavior
- Real printers
- Windows service, reboot, and recovery proof
- Infrastructure-specific qualification

## 14. Known SIM 1.0 Conditions

KNOWN CONDITION - NON-BLOCKING FOR SIM 1.0:

A. `Reset-DleOsSim.ps1 -ConfirmReset -Json` may encounter expected HTTP `302 Found` behavior during LAN access-code session handling in the current PowerShell environment. Reset behavior itself qualified through the SIM endpoint and official suites.

B. `Tests/WorkAreaHomeOperationsCenter001/run-tests.mjs` contains a stale exact-string assertion related to current workspace identity mappings. Current source includes Shipping and Invoice History workspace mappings, and SIM synthetic identity qualification covers the current mapping.

C. `Tests/KittingAcceptedMaterialLabel001/run-tests.mjs` and `Tests/KittingBagLabel001/run-tests.mjs` depend on absent `Artifacts/WorkOrderReleasedBom004` inputs. The official SIM document/label/preview suite qualified the self-contained synthetic SIM document and label surface.

D. Manual mobile revalidation remained pending at Phase 17A. Automated LAN readiness passed; physical iPad/iPhone revalidation should be recorded separately when performed.

## 15. Qualification Evidence

MichaelDesk Phase 17A:

- Result: PASS WITH CONDITIONS
- Candidate: `sim/recovery-phases-2-13` at `8de94ddecf439890896c720377b5aa098fb9fff5`
- Full official SIM suite: PASS
- Quick after reset: PASS
- Relevant local evidence:
  - `.sim-state/qualification/phase17a/full-sim-qualification-20260904-171609.log`
  - `.sim-state/qualification/phase17a/reset-quick-after-reset-20260904-172438.log`

MichaelDesk Full suite counts:

- `SimDeveloperTools001`: 10 checks
- `SimShellIsolation001`: 34 checks
- `SimUiParity001`: 29 checks
- `SimSyntheticIdentity001`: 53 checks
- `SimStateReset001`: 45 checks
- `SimOperationsCenter001`: 61 checks
- `SimInvoiceHistory001`: 63 checks
- `SimBroaderReadOnly001`: 58 checks
- `SimVerifiedStatus001`: 66 checks
- `SimWorkflowFailure001`: 60 checks
- `SimDocumentsPrint001`: 44 checks
- `SimDesktopVisual001`: 3 SIM wrapper checks and 21 shared responsive contracts
- `SimLanMode001`: 51 checks

JRDEV Phase 17B:

- Result: PASS WITH CONDITIONS
- Exact source parity: `8de94ddecf439890896c720377b5aa098fb9fff5`
- Quick: 140/140 PASS
- Full primary qualification: 577/577 PASS
- No JRDEV-only source, runtime, tooling, or LAN defects
- Same known conditions reproduced
- JRDEV working tree was clean
- No source files were copied from MichaelDesk

## 16. Recovery / Onboarding

Developer recovery and onboarding flow:

1. Obtain the DLE-OS Git source.
2. Checkout the canonical SIM baseline or its governed successor.
3. Install required local runtime/tooling: .NET, PowerShell 7, Node.js where required by tests, and browser tooling required by the machine workflow.
4. Create a local machine profile outside Git.
5. Configure local DNS, certificate, firewall, and access-code environment.
6. Start SIM through the shared launcher or approved local wrapper.
7. Run `Tools/SimRuntime/Test-DleOsSim.ps1 -Mode Quick`.
8. Run `Tools/SimRuntime/Test-DleOsSim.ps1 -Mode Full` when qualifying a new machine or baseline.

Runtime state can be reset and recreated. `.sim-state` is disposable.

## 17. SIM 1.0 Acceptance Statement

DLE-OS SIM 1.0 is the supported local development environment for DLE-OS application development on the qualified MichaelDesk and DLE-OS-JRDEV01 machines.

Source baseline:

`sim/recovery-phases-2-13`

Source SHA:

`8de94ddecf439890896c720377b5aa098fb9fff5`

This declaration is bounded by the supported surface, DEV-required boundaries, and known non-blocking conditions recorded above.

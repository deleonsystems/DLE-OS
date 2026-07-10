# DLE-OS Core Standards

Product: DLE-OS  
Lifecycle: Alpha  
Version: v1.0.0  
Last Updated: 2026-07-10

## Purpose Statement

This document is the permanent architectural reference for DLE-OS. It defines approved project standards that guide workflow design, data ownership, transaction identity, reconciliation behavior, and future module development.

Before implementing any major workflow or module, this document should be consulted. If a new architectural decision affects future development, propose adding a new standard before implementation.

## Table of Contents

- [Architecture Decision Records](#architecture-decision-records)
- [DOC-001 - Documentation Governance](#doc-001---documentation-governance)
- [TXN-001 - Transaction Identifier Standard](#txn-001---transaction-identifier-standard)
- [ERP-001 - ERP System of Record](#erp-001---erp-system-of-record)
- [DATA-001 - Master Data Source](#data-001---master-data-source)
- [DATA-002 - Data Ownership Model](#data-002---data-ownership-model)
- [DATA-003 - Operational Record Identity](#data-003---operational-record-identity)
- [DATA-004 - Dataset Schema and Version Metadata](#data-004---dataset-schema-and-version-metadata)
- [PERSIST-001 - Persistence and Write Verification](#persist-001---persistence-and-write-verification)
- [LIFE-001 - Master Record Lifecycle](#life-001---master-record-lifecycle)
- [UI-001 - Workspace Navigation Precedence](#ui-001---workspace-navigation-precedence)
- [MOD-001 - Module Boundaries and State Ownership](#mod-001---module-boundaries-and-state-ownership)
- [REC-001 - Reconciliation Review and Approval](#rec-001---reconciliation-review-and-approval)
- [SHP-001 - Shipment Workflow Philosophy](#shp-001---shipment-workflow-philosophy)
- [Future Development Rule](#future-development-rule)

---

# Architecture Decision Records

Formal architectural decisions are recorded as ADRs and should be consulted when evaluating major lifecycle, platform, data, deployment, or integration changes.

- [ADR-001 - DLE-OS Alpha Declaration](../ADR/ADR-001_DLE-OS_Alpha_Declaration.md)

---

# DOC-001 - Documentation Governance

**Status:** Approved  
**Effective Date:** 2026-07-10

Core Standards define permanent engineering rules that should remain true across modules and lifecycle phases.

Architecture Decision Records define significant decisions, the context behind those decisions, and their long-term consequences.

Use Core Standards for rules that guide ongoing implementation.

Use ADRs for historical decisions, major tradeoffs, lifecycle declarations, deployment strategy decisions, platform migrations, or other choices where the reasoning matters as much as the rule.

---

# TXN-001 - Transaction Identifier Standard

**Status:** Approved  
**Effective Date:** 2026-07-01

## Purpose

All DLE-OS generated business transactions shall use a standardized, human-readable transaction identifier.

## Standard Format

```text
<PREFIX>-<Customer#>-<SalesOrder>-<YYMMDD>-<Sequence>
```

## Example

```text
SHP-1025-45231-260701-01
```

## Components

- PREFIX = Transaction Type (SHP, RCV, NCR, RMA, etc.)
- Customer# = ERP Customer Number
- SalesOrder = ERP Sales Order Number
- YYMMDD = Transaction Creation Date
- Sequence = Automatically generated increment for multiple transactions created for the same Sales Order on the same day.

## Rules

- Generated once.
- Never changes.
- Used for searching, reconciliation, reporting, printing, and history.
- Human readable by design.
- Internal UUIDs/database IDs may exist but are never shown to users as the operational transaction number.

---

# ERP-001 - ERP System of Record

**Status:** Approved  
**Effective Date:** 2026-07-01

VPro5 remains the official System of Record.

DLE-OS must never directly modify imported ERP data.

All user actions shall be stored separately and reconciled against future ERP imports.

ERP-owned values imported from VPro5 shall remain distinguishable from DLE-owned operational values.

---

# DATA-001 - Master Data Source

**Status:** Approved  
**Effective Date:** 2026-07-01

DLE Master Data shall serve as the central operational dataset for ERP-derived order records used by DLE-OS.

In the current Alpha implementation, DLE Master Data is stored as a project JSON file.

The current Alpha JSON file is named using the DLE Master Data convention, such as:

```text
DLE_MASTER_DATA_<timestamp>.json
```

DLE Master Data records represent operational order lines imported from VPro5 and enriched with DLE-owned operational fields.

Modules that display or act on active ERP-derived order records should read from DLE Master Data rather than maintaining independent copies of those order records.

Module-owned datasets may exist for workflow state, overlays, archive records, and transient planning state when that data is not the authoritative ERP-derived order record.

---

# DATA-002 - Data Ownership Model

**Status:** Approved  
**Effective Date:** 2026-07-10

DLE-OS shall separate ERP-owned data from DLE-owned operational data.

ERP-owned fields imported from VPro5 shall be stored under a VPro5-owned record area.

DLE-owned fields created or maintained by DLE-OS shall be stored separately from ERP-owned fields.

The ownership model shall explicitly identify ERP-owned and DLE-owned fields when the dataset format supports it.

Current Alpha DLE Master Data uses:

```text
ownershipModel.vpro5Owned
ownershipModel.dleOwned
record.vpro5
record.dle
```

Reconciliation and operational update workflows must preserve DLE-owned fields unless a user-approved DLE-OS workflow intentionally changes them.

---

# DATA-003 - Operational Record Identity

**Status:** Approved  
**Effective Date:** 2026-07-10

DLE Master Data records shall use a stable operational record identity based on the ERP order line.

The standard identity is:

```text
Customer Number + Sales Order + Sequence Line
```

The current Alpha key format is:

```text
<CustomerNumber>|<SalesOrder>|<SequenceLine>
```

This record identity is used to match Master Data records, ERP import candidates, operations overlays, shipment staging records, reconciliation events, and shipment history source snapshots.

This operational record identity is separate from generated transaction identifiers defined by TXN-001.

---

# DATA-004 - Dataset Schema and Version Metadata

**Status:** Approved  
**Effective Date:** 2026-07-10

Persistent DLE-OS datasets shall identify their schema and version when they store operational or workflow state.

Dataset schema names should be explicit and human-readable, such as:

```text
DLE_MASTER_DATA_V1
DLE_SHIPMENT_STAGING_V1
DLE_SHIPMENT_HISTORY_V1
DLE_OPERATIONS_OVERLAY_V1
```

Version values describe the dataset format, not necessarily the product version.

Dataset-level record counts, timestamps, and source metadata should be maintained when practical.

When writing a dataset, record counts should reflect the actual number of records being persisted.

---

# PERSIST-001 - Persistence and Write Verification

**Status:** Approved  
**Effective Date:** 2026-07-10

Operational persistence shall prefer explicit project files over silent browser-only storage.

In the current Alpha implementation, writable operational changes use browser file handles when available.

Read-only project JSON files may be loaded for inspection and workflow context, but workflows that approve operational changes must require a writable persistence path.

When an operational JSON dataset is written, DLE-OS should verify the write before treating the operation as complete.

Browser storage may be used as a fallback or convenience layer for non-authoritative state, but it must not silently replace project-file persistence for authoritative operational data.

If persistence fails during an operational workflow, DLE-OS should preserve or restore the previous in-memory state before reporting failure.

---

# LIFE-001 - Master Record Lifecycle

**Status:** Approved  
**Effective Date:** 2026-07-10

DLE Master Data records shall carry lifecycle state when their operational status affects whether they remain active.

Current Alpha lifecycle states are:

```text
OPEN
STAGED
ARCHIVED
```

Active operational views should include records that are open or staged.

Shipment confirmation may move a Master Data record into a staged state while the shipment awaits reconciliation.

Approved reconciliation may archive completed shipment records into Shipment History and remove completed records from the active operational Master Data set.

Lifecycle state changes should include enough metadata to understand when and why the state changed.

---

# UI-001 - Workspace Navigation Precedence

**Status:** Approved  
**Effective Date:** 2026-07-10

DLE-OS shall present workspace views in a consistent order across the application.

The workspace order represents enterprise-level access first, followed by the operational lifecycle from opportunity through shipment, then reporting.

The approved workspace order is:

1. Administration
2. CEO Dashboard
3. RFQ / Quoting
4. Order Entry
5. Contract Review
6. Operations Center
7. Purchasing
8. Kitting
9. Production
10. Quality
11. Shipping
12. Reports

Administration remains the primary development, system management, ERP import, reconciliation, configuration, and developer-tools workspace during Alpha.

The CEO Dashboard is reserved for executive operational visibility, company health, production overview, financial and operational KPIs, and daily priorities.

Operational workspaces should evolve into role-specific landing pages rather than duplicate module navigation menus.

Workspace ordering should not be changed casually because it encodes the intended operational flow of De Leon Enterprises.

---

# MOD-001 - Module Boundaries and State Ownership

**Status:** Approved  
**Effective Date:** 2026-07-10

DLE-OS modules may own their own UI state, workflow state, and module-specific persisted datasets.

Modules must not create independent authoritative copies of ERP-derived order records.

Module-owned state should reference DLE Master Data records by standard operational record identity when it relates to an ERP order line.

Current Alpha examples of module-owned state include:

- Shipment Staging records
- Shipment History records
- Operations Center overlay records
- Operations projection selections
- Reconciliation review queue state

Module-owned datasets should remain scoped to the workflow or subsystem that owns them.

Shared operational record data should remain sourced from DLE Master Data.

---

# REC-001 - Reconciliation Review and Approval

**Status:** Approved  
**Effective Date:** 2026-07-10

Reconciliation shall compare DLE Master Data against the current ERP import candidate and identify differences that require review.

Reconciliation must preserve DLE-owned fields while evaluating ERP-owned fields.

Reconciliation events may include new ERP records, missing ERP records, modified ERP-owned fields, missing ERP-owned fields, work order synchronization candidates, validation issues, and pending shipment invoice/archive candidates.

Operational changes detected by reconciliation should require explicit review and approval before they are applied to authoritative datasets.

Approval workflows should block unsafe transitions when pending shipment transactions or unresolved reconciliation events are not properly dispositioned.

After approved changes are applied, DLE-OS should persist affected datasets, verify writes, refresh operational views, and rerun or refresh reconciliation status as appropriate.

---

# SHP-001 - Shipment Workflow Philosophy

**Status:** Approved  
**Effective Date:** 2026-07-01  
**Updated:** 2026-07-10

The initial shipment workflow shall be:

```text
Import VPro5 Open Orders
        |
        v
Load DLE Master Data
        |
        v
User selects one or more line items
        |
        v
Create Shipment
        |
        v
Display Shipment Preview
        |
        v
Confirm Shipment
        |
        v
Generate Transaction ID (TXN-001)
        |
        v
Create Shipment Transaction
        |
        v
Persist Shipment Staging
        |
        v
Mark Master Data record STAGED
        |
        v
Next ERP Import / Reconciliation Run
        |
        v
Review Pending Invoice / Archive Candidate
        |
        v
Approve Reconciliation Disposition
        |
        v
Archive Shipment to Shipment History
        |
        v
Remove Completed Record from Active Master Data
```

A shipment may contain one or many sales order lines.

A sales order line may also participate in multiple shipments (partial shipments).

For this reason, Shipments are independent transaction objects that reference ERP order lines rather than modifying or replacing them.

Shipment Staging is the holding area for confirmed shipment transactions that are pending reconciliation.

Shipment History is the archive for shipment records approved through reconciliation.

Shipment archive records should preserve source snapshots sufficient to understand the staging record and Master Data record at the time of archive.

---

# Future Development Rule

Before implementing any major workflow or module, consult this document.

If a new architectural decision affects future development, propose adding a new standard before implementation.

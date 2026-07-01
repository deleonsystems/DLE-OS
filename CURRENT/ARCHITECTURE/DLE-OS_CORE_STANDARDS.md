# DLE-OS Core Standards

Version 1.0  
Last Updated: 2026-07-01

## Purpose Statement

This document is the permanent architectural reference for DLE-OS. It defines approved project standards that guide workflow design, data ownership, transaction identity, reconciliation behavior, and future module development.

Before implementing any major workflow or module, this document should be consulted. If a new architectural decision affects future development, propose adding a new standard before implementation.

## Table of Contents

- [TXN-001 - Transaction Identifier Standard](#txn-001---transaction-identifier-standard)
- [ERP-001 - ERP System of Record](#erp-001---erp-system-of-record)
- [DATA-001 - Master Data Source](#data-001---master-data-source)
- [SHP-001 - Shipment Workflow Philosophy](#shp-001---shipment-workflow-philosophy)
- [Future Development Rule](#future-development-rule)

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

VPro5 remains the official System of Record.

DLE-OS must never directly modify imported ERP data.

All user actions shall be stored separately and reconciled against future ERP imports.

---

# DATA-001 - Master Data Source

DLE_MASTER_DATA.json shall serve as the single operational data source used by DLE-OS.

All modules should read from this dataset rather than maintaining independent copies of ERP data.

---

# SHP-001 - Shipment Workflow Philosophy

The initial shipment workflow shall be:

```text
Import VPro5 Open Orders
        |
        v
Load DLE_MASTER_DATA.json
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
Mark Shipment Pending Reconciliation
        |
        v
Next ERP Import
        |
        v
Automatic Reconciliation
        |
        v
Move to Shipment History
```

A shipment may contain one or many sales order lines.

A sales order line may also participate in multiple shipments (partial shipments).

For this reason, Shipments are independent transaction objects that reference ERP order lines rather than modifying or replacing them.

---

# Future Development Rule

Before implementing any major workflow or module, consult this document.

If a new architectural decision affects future development, propose adding a new standard before implementation.

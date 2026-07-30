# SUPPORTING-CODE-TABLES-PLATFORM-001 Final Report

## Verdict

**PASS WITH CLARIFICATIONS**

The consolidated Code References baseline was discovered, qualified, imported,
published, and accepted as the twelfth read-only Platform Viewer section.

## Qualified result

- Reference Code contract: `REFERENCE_CODE_1.0`
- Natural key: `FirmId + CodeDomain + CodeType + CodeValue`
- Accepted source attempt:
  `SUPPORTING_CODE_TABLES_PLATFORM_001-20260730T134103634Z-A0F9F84F`
- Package SHA-256:
  `1372431D5A281E0104D1D54B1F3C2013E3BCA0488A804FA05ABC831C088E8EAD`
- Reference Code ImportRunId:
  `36c23ba1-b09d-4df8-a794-6e324f46b483`
- Imported reference codes: 1,209
- Usage evidence rows: 1,448
- Duplicate natural keys: 0
- Namespace collisions safely separated: 53
- Prohibited fields: 0

## Safety and transactional evidence

Both source passes used `MODE="O_RDONLY"` and matched on identity, counts, key
order, and safe decoded projections. Source writes and locks were zero.
Identical import returned `NO-OP`; an induced failure rolled back and retained
the prior committed baseline. `DLE_OS` and `DLE_OS_PLATFORM_LAB` remained
unchanged.

The actual LIVE API identity can SELECT the approved view and metadata. SQL
writes and protected-database access are denied. There are no API or viewer
write operations and no request-time access to X:, VPro, mirror, or backup data.

## Runtime and browser

The governed deployment passed with exact-origin CORS and the dedicated LIVE
identity. Build `20260730T142754Z-857ACDFE80E3` exposes twelve viewer sections.
Code References returned 1,209 records, exact filtering and direct lookup
passed, detail provenance passed, and pagination passed. Existing Purchase
Orders received additive resolution descriptions without replacing raw codes.

## Clarifications

- 868 values remain explicitly unresolved because no authoritative code master
  was proven, principally transaction-derived locations, units, and shipping
  methods.
- Relationship/hierarchy count is zero because no hierarchy was proven.
- Active/inactive state is null where the sources provide no qualified state.
- Existing shell fallback warnings for unrelated shipment/operations endpoints
  remain outside this milestone; Platform Viewer and Code References emitted no
  errors.
- Reference Codes are not added to the existing automated ERP refresh until a
  separate refresh-boundary qualification is approved.

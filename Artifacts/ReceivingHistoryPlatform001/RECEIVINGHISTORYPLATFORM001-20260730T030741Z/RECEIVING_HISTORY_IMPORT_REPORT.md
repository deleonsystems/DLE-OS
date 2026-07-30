# Receiving History Import Report

## Qualified additive-date import

- Verdict: PASS
- Database: `DLE_OS_CANONICAL_LIVE`
- ImportRunId: `034f0f72-8713-4163-b20d-fb9d421a7961`
- Package SHA-256:
  `84A4267E17412B373DC8868B98C1775134ED497FF1A5EF4EB2930BA4B9CC492E`
- Headers: 39,564
- Lines: 189,272
- Rejections: 0
- Malformed Order Dates: 5
- Malformed Receipt Dates: 1
- Malformed Required Dates: 26
- Missing Purchase Order headers: 1
- Effective principal: `dle_receiving_history_import_executor`
- Identical re-import: NO-OP
- Induced-failure rollback: PASS; counts and ImportRunId unchanged

Status: **NOT RUN**

No Receiving History schema was applied and no SQL transaction was opened.
`DLE_OS_CANONICAL_LIVE`, `DLE_OS_PLATFORM_LAB`, and `DLE_OS` were not mutated
by this mission.

The package was rejected before construction due to cross-pass source FIN
identity mismatches. Consequently there is no Receiving History ImportRunId,
package SHA-256, initial import, no-op result, or rollback result.

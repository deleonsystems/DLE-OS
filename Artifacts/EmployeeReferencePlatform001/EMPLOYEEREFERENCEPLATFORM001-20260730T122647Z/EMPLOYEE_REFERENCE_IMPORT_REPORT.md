# Employee Reference Import Report

- Database: `DLE_OS_CANONICAL_LIVE`
- ImportRunId: `783a4bc2-1871-4dfb-ad7a-e0beea797841`
- Package SHA-256:
  `515C6C8F66FECC4B33406D02B7AB66C1B9FD6171F6B0FD1FE5329687115ED369`
- Employees: 11
- Operational codes: 18
- Departments: 10
- Job titles: 24
- Initial/final import: PASS
- Identical re-import: `NO-OP`, same ImportRunId
- Induced failure after deletes: nonzero exit; transaction rollback PASS
- Post-failure counts and ImportRunId: unchanged

Protected database boundary:

- `DLE_OS`: 1 table, 115 rows, object-modification timestamp unchanged
- `DLE_OS_PLATFORM_LAB`: 8 tables, 26,948 rows, object-modification timestamp
  unchanged

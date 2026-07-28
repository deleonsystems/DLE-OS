# PLATFORM-002 Sales Order Import Report

Verdict: **PASS**

- Fixed package profile:
  `C:\DLE-OS\Canonical\LiveMirror\Platform002\Current`
- Package hash:
  `8035F2C5A66C02136C3EADA949904223648B1470838E089C66DD57CBC221B229`
- Parent live ImportRunId:
  `1dd2bfcb-62e5-485a-ad17-1a3f62a4e872`
- SalesOrderExtensionRunId:
  `788326d3-2b64-4862-9567-91c5732583bb`

Imported counts:

| Entity | Rows |
|---|---:|
| Customer | 380 |
| SalesOrder | 139 |
| SalesOrderLine | 109 |
| Read-only SalesOrderViewer projection | 109 |

The importer accepts no source path, database name, or connection string from
normal operator input. It verifies every package hash before opening the SQL
transaction. The three new canonical tables are deleted and replaced inside
one serializable transaction, linked to the current committed live ImportRun,
and reconciled to manifest counts before commit.

A controlled failure after delete rolled back to zero extension rows and zero
extension-run rows. The successful import then committed all expected rows. A
same-package reimport returned `NO-OP` without mutation.

`DLE_OS` remained at 8,122 total physical rows and
`DLE_OS_PLATFORM_LAB` remained at 35,371. Only
`DLE_OS_CANONICAL_LIVE` changed.

# Employee Reference SQL Schema

Database: `DLE_OS_CANONICAL_LIVE`

Objects added:

- `platform.EmployeeReferenceImportRun`
- `canonical.EmployeeReference`
- `canonical.EmployeeOperationalCode`
- `canonical.DepartmentReference`
- `canonical.JobTitleReference`
- `canonical.EmployeeReferenceViewer`
- `liveapi.EmployeeReferenceMetadata`

The import replaces all four Employee Reference tables within one transaction.
The import-run record stores qualification ID, package and manifest hashes,
contract, counts, statuses, and timestamps.

`dle_live_api_reader` receives SELECT only on the approved viewer, operational
code table, and metadata view. The actual runtime identity has no writer or
server role and cannot access `DLE_OS` or `DLE_OS_PLATFORM_LAB`.

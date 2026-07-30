# Employee Reference Read-Only API Contract

Base: `/api/platform/live/v1/employee-reference`

- `GET /` — bounded paginated list
- `GET /metadata` — dataset/import counts and identity
- `GET /{employeeReferenceId}` — one safe employee record
- `GET /{employeeReferenceId}/codes` — resolved codes for that employee

List filters: employee number, employee name, department, job title, active
status, operational code, and code type. Employee numbers use exact matching;
numeric values shorter than nine characters are left-padded for the API while
the browser retains the typed text.

The DTO contains only approved identity/reference fields. No payroll, contact,
credential, or sensitive HR property is present. Invalid parameters return
400; write methods are absent and POST returns 405. Historical routes do not
fallback to the live dataset.

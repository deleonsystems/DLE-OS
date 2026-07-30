# SQL Schema

Implementation: `Tools\SupportingCodeTables\Database\034_AddSupportingCodeTablesPlatform.sql`

- `canonical.ReferenceCode`
- `canonical.ReferenceCodeViewer`
- `platform.ReferenceCodeImportRun`
- `liveapi.ReferenceCodeMetadata`

The import replaces the bounded reference baseline transactionally and records
the package/run identity. Exact package re-import returns `NO-OP`. An induced
failure rolled back and retained the committed 1,209-row baseline and ImportRunId
`36c23ba1-b09d-4df8-a794-6e324f46b483`.

The LIVE API role receives SELECT only on the approved view and metadata view,
with explicit write denial on the canonical table.

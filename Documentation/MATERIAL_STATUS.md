# Material Status

Material Status is the shared operational projection for the material-readiness
lifecycle. The current machine states are:

- `NEEDS_KITTING`
- `KITTING_IN_PROGRESS`
- `KIT_SHORT`
- `KIT_COMPLETE`

The persistent Kitting Case lifecycle is always authoritative. An active case
projects its current state. Once any modern Kitting Case history exists for a
Work Order, legacy evidence can never override or reappear for that Work
Order; when no run is active, normal eligibility projects `NEEDS_KITTING`.

For Work Orders with no modern Kitting Case history, the append-only
`operational.LegacyKittingMaterialEvidence` bridge may project `KIT_SHORT` or
`KIT_COMPLETE`. Backfill requires a unique high-confidence legacy PDF plus a
matching prior verified manual disposition. A later Kit Complete PDF
supersedes an older Kit Short PDF; ambiguous names, duplicate evidence,
contradictory chronology, PDF-only evidence, and manual-only evidence remain
review findings and are not silently migrated. Stored references point to the
unchanged canonical PDFs; the bridge does not create modern cases or
submissions.

An otherwise eligible governed Work Order with neither modern history nor a
qualified bridge record projects `NEEDS_KITTING`. The shared browser projection is implemented by
`SRC/shared/material-status.js`; Operations Center, Sales Order Dashboard,
Kitting Workspace, and Work Order Dashboard consume that projection rather
than maintaining separate status fields. Kitting Case mutations publish an
invalidation event so visible consumers reload the governed projection.

Legacy manual Kitting disposition events remain historical evidence. They are
supporting reconciliation evidence only and are not independently
authoritative for the normal Material Status lifecycle.

## Reserved sibling: Production Status

`Production Status` is reserved for the future labor and manufacturing
lifecycle. It is intentionally not implemented by the Material Status work:
there is no Production Status schema, state list, UI field, or transition
mapping yet. Future work must keep the two concepts distinct.

# Employee Reference Refresh Assessment

The complete Employee Reference source projection reads 1,026 physical records
across five small reference files and completes two passes in under five
seconds on the qualified host.

Recommendation: add Employee Reference to the governed full snapshot refresh
as a small, two-pass, fail-closed component. Preserve exact source paths,
`MODE="O_RDONLY"`, identity comparison, safe-projection fingerprints, package
validation, transactional replacement, rollback, and qualified-boundary
promotion.

Do not create an independent high-frequency scheduler. Employee/reference
changes are low volume and should move with the governed live snapshot after a
separate refresh integration milestone. Existing ERP and Invoice History
refresh paths were not changed by this mission.

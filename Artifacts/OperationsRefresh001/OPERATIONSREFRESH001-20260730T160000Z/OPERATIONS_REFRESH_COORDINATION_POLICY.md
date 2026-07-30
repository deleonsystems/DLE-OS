# Operations Refresh Coordination Policy

Order is Customer Master, Open Sales Orders, Invoice History. Each step has an
independent process, package, transaction, rollback, status, and evidence
boundary. The coordinator never opens VPro files or executes SQL itself.

Customer failure permits later steps only with retained prior data. Sales
failure does not block Invoice History. Invoice failure does not roll back
prior successes. Mixed results are `PartialSuccess`; three unchanged steps are
`NoSourceChanges`.

The coordinator and all dataset readers share the governed live-source
exclusion model and return `ALREADY_RUNNING` rather than terminating another
process.

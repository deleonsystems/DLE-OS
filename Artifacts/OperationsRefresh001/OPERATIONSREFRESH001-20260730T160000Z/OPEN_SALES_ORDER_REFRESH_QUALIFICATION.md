# Open Sales Order Refresh Qualification

Status: **IMPLEMENTED; LIVE ACCEPTANCE PENDING DEPLOYMENT**

The routine reads ARE-03, ARE-13, ARM-01, and ARM-10 once with
`MODE="O_RDONLY"`, derives current qualifying Standard-line relationship
prefixes, and seeks WOE-03 by the proven 19-character
`Firm+B+Customer+SalesOrder+Line` key.

It records source identity before and after, performs zero complete WOE-03
scans, fails closed on identity change, validates the candidate with the
existing qualified builder, compares canonical rows, and uses the existing
transactional Sales Order importer. Private package activation is restored
before return on import failure; SQL remains the only API-visible boundary.

The VPro base reader compiled and listed successfully. Exact bounded-seek,
prefix verification, source guards, no-force-full behavior, rollback paths,
and candidate comparisons pass automated tests. Live parity, duration, and
source-safety evidence remain pending because deployment did not begin.

# RFQ commercial lifecycle qualification

The C# suite copies the supplied SIM data into unique output subdirectories. Use the E2E-SIM-001 R01 approved, pre-submission checkpoint. It never writes to the source root; closures, revised approval and concurrency checks run only in fixture copies.

```powershell
dotnet build Tests/SimRfqCommercial001/SimRfqCommercial001.csproj -o output/commercial-tests -p:UseAppHost=false
dotnet output/commercial-tests/SimAnalysis001.dll <pre-submission-state-root> output/commercial-test-state
node Tests/SimRfqCommercial001/ui-tests.mjs
node Tests/SimRfqs001/run-ui-tests.mjs
node Tests/SimRfqs001/run-final-review-ui-tests.mjs
```

Checks: legacy defaults, broad read-only listing with narrow workbench eligibility, one RFQ per row, exact approved-version submission, persisted calendar deadline, audit identity, stable request retries, concurrency, seven-day warning, overdue projection, explicit expiration, award/version checks, closed buckets, empty execution links, source-state preservation, DST, revised work and resubmission history.

The commercial list is `/api/sim/rfqs/commercial`. The transition endpoint is `POST /api/sim/rfqs/{id}/commercial`, guarded by `technical_review.disposition`; request includes a GUID request ID, expected lifecycle revision, action, governing approval ID/version and reason. Supported actions: SUBMIT, EXPIRE, AWARD, LOSE, CLOSE. No endpoint accepts client-supplied timestamps or order identifiers.

Expiration is explicit: overdue records immediately project into History without a GET write. The Record Expiration action records the audited transition. No background worker or automatic mass mutation is installed. America/Los_Angeles governs calendar addition; persisted timestamps are UTC. Spring DST gaps advance to the first valid minute; ambiguous fall times use standard offset.

Order-link fields are reserved for a later validated, reciprocal order handoff. This change does not create execution records or expose an arbitrary order-link write API. Existing issued PDFs and approval records remain immutable; validity presentation on future quotation artifacts is deferred.

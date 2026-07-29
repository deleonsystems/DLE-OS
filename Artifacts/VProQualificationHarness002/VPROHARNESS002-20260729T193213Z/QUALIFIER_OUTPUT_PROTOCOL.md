# Qualifier Output Protocol

Protocol `1.0` is UTF-8 JSON Lines. Every record has
`protocolVersion`, `mission`, `attemptId`, `timestampUtc`, `processId`,
`eventType`, `sourceAccessMode`, `writeCount`, and `lockCount`.

Events are `HARNESS_PROTOCOL`, `QUALIFIER_STARTED`,
`SOURCE_PREFLIGHT_COMPLETE`, `SOURCE_OPENED`, `PROGRESS`, `SOURCE_CLOSED`,
`QUALIFIER_COMPLETE`, and `QUALIFIER_ERROR`. Progress may add counts, a safe
key, and elapsed time; credentials and business record content are forbidden.

Success requires exactly one `QUALIFIER_COMPLETE` with verdict, source counts
and fingerprints, before/after identity evidence, zero writes/locks, elapsed
time, output list, and hashes. Exit alone is not success.

The migration adapter translates existing local marker/output files into this
protocol while their qualified business logic remains unchanged. New
qualifiers should emit protocol records natively.

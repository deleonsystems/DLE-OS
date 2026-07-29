# Overlap and Retry Policy

The lock is local to the configured harness instance and records mission,
attempt, root, creation time, and process ledger. An active verified ledger
process returns `ALREADY_RUNNING`. Age never clears a lock. A lock is recoverable
only after every recorded PID fails the exact start-time/path ownership check;
the old lock is retained as stale evidence.

Unrelated VPro activity does not establish overlap and is neither blocked nor
terminated merely by name.

Automatic retry is capped at one and requires an explicitly retryable category,
stable source identity, zero writes/locks, completed cleanup, and zero remaining
owned processes. Retry uses a fresh directory. Syntax, reserved names, invalid
contracts, missing sources, identity changes, and any safety failure do not
retry. Tests proved one transient retry and no compiler-defect retry.

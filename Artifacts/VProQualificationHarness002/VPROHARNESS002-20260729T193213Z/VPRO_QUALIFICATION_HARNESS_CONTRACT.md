# VPro Qualification Harness Contract v1.0

## Boundary and inputs

The versioned JSON configuration fixes the mission, qualifier source,
executables, source allowlist, required identity/elevation state, mapped-path
preconditions, local attempt root, compiler artifact contract, timeouts,
completion rules, and retry policy. It is data only; arbitrary commands, UNC
sources, remapping, and unknown tokens are rejected.

The production boundary is the normal, non-elevated
`DLE-OS-HOST\DLE-OS` session with the existing `X:` mapping. All record sources
must be listed and opened by the qualifier with `MODE="O_RDONLY"`. Generated
content is local.

## Lifecycle

1. Acquire the mission-root lock or return `ALREADY_RUNNING`.
2. Create a never-reused attempt directory.
3. Verify identity, non-elevation, mapped paths, and fixed source paths.
4. Capture source metadata identities.
5. Copy and parameterize the approved qualifier locally.
6. run the conservative variable-name preflight;
7. compile locally and apply every compiler gate;
8. directly launch and ledger the qualifier process;
9. enforce first-marker, progress, hard-runtime, and completion gates;
10. validate exactly one completion, O_RDONLY, zero writes/locks, outputs, and
    source identity after;
11. perform graceful then exact-PID-only cleanup if needed;
12. verify zero owned processes, write the verdict, and release the lock.

## Ownership

A process is owned only when directly returned by the current launch and
recorded with attempt ID, PID, start time, executable path, parent wrapper PID,
arguments, and role. Name-only ownership is invalid.

## Verdict

`PASS` requires all technical and safety gates. `PASS WITH CLARIFICATIONS`
requires the same gates plus a noncritical stated limitation. `BLOCKED` means a
required precondition was unavailable before source work. `FAILED` means a
controlled attempt failure. `ALREADY_RUNNING` is the concurrency response and
does not create a second attempt.

## Retry

At most one automatic retry is permitted, only for an explicitly configured
category after stable source identity, zero writes/locks, complete cleanup, and
zero owned processes. Each retry is fresh. Compiler, contract, source,
identity, and safety defects are nonretryable.

## Evidence

Every attempt retains the source copy, compiler streams and combined output,
variable scan, compile metadata, artifact hash/size/time, process ledger,
runtime streams, JSONL events, cleanup evidence, source identities, activity
counts, and attempt verdict.

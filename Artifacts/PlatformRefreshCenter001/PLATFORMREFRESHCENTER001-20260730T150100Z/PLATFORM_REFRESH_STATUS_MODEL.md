# Refresh Status Model

Normalized states include `Ready`, `ReadyWithWarning`, `Running`, `NoSourceChanges`, `Completed`, `FailedRetainingPriorData`, `Unavailable`, and `AwaitingOperator`.

Each dataset carries its registry capability, method, row counts, import/package identity where its existing metadata contract supplies them, snapshot/import time, source check, qualification time, latest runner state, warning/unresolved/ambiguous counts, dependencies, read-only source mode, duration class, and deterministic recommendation.

One unavailable metadata provider produces `Unavailable` only for that dataset. Other dataset statuses and shared readiness still return.

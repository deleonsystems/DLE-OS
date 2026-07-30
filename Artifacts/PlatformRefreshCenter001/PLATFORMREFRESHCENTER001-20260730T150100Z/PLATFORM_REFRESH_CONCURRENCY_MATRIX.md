# Concurrency Matrix

All currently enabled source-reading actions belong to `vpro-live-read`.

| Existing operation | Core source check/full | Invoice overlap | Core force-full |
|---|---:|---:|---:|
| Core source check/full | Block | Block | Block |
| Invoice overlap | Block | Block | Block |
| Core force-full | Block | Block | Block |

This conservative matrix preserves each existing runner lock and also blocks incompatible shared-source overlap at the control boundary. Focused master, PO, Receiving, and reconciliation operations remain disabled until their concurrency behavior is independently qualified. No unrelated process is terminated.

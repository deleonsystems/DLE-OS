# Operations Refresh Concurrency Matrix

| Combination | Result |
|---|---|
| Operations vs Operations | ALREADY_RUNNING |
| Scheduled vs manual Operations | ALREADY_RUNNING |
| Operations vs Core full/force-full | ALREADY_RUNNING |
| Customer vs Core or Operations | ALREADY_RUNNING |
| Sales vs Core or Operations | ALREADY_RUNNING |
| Invoice vs Core or Operations | ALREADY_RUNNING |
| Dataset steps within Operations | Serial |

All live readers use the `vpro-live-read` policy. Locks are local and no broad
process termination is implemented.

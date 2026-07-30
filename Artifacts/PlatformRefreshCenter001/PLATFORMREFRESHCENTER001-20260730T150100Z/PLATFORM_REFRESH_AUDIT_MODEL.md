# Refresh Audit Model

Append-only JSON Lines are stored at the protected fixed path `C:\ProgramData\DLE-OS\PlatformRefreshCenter\refresh-runs.jsonl`.

Request events record request ID, dataset, action, Windows identity, timestamps, fixed control route, before identities where available, quiet-window confirmation, and force-full intent. Completion reconciliation appends result, source run, after identities, failure, and prior-data-retention result from the existing runner state. GET routes merge events by request ID for recent-list and detail views.

Credentials and arbitrary filesystem content are never recorded or served.

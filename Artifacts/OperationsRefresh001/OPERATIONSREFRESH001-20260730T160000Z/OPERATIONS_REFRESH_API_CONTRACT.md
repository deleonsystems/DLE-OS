# Operations Refresh API Contract

Authenticated routes on port 5043:

- `GET /api/platform/operations-refresh/v1/status`
- `GET /api/platform/operations-refresh/v1/runs`
- `GET /api/platform/operations-refresh/v1/runs/{runId}`
- `POST /api/platform/operations-refresh/v1/run`
- `GET /api/platform/operations-refresh/v1/schedule`
- `POST /api/platform/operations-refresh/v1/schedule/enable`
- `POST /api/platform/operations-refresh/v1/schedule/disable`

Dataset actions continue through the Refresh Center’s fixed dataset routes.
POST actions accept only bounded confirmation values. No path, script,
command, source, database, or arbitrary argument is accepted.

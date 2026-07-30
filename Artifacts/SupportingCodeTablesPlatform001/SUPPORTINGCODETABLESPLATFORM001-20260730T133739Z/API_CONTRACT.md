# Read-Only API Contract

- `GET /api/platform/live/v1/reference-codes`
- `GET /api/platform/live/v1/reference-codes/metadata`
- `GET /api/platform/live/v1/reference-codes/{domain}/{type}/{value}`
- `GET /api/platform/live/v1/reference-codes/{id}`

List filters: `codeDomain`, `codeType`, exact `codeValue`, description text,
`resolutionStatus`, and `sourceType`, plus existing bounded pagination.

There are no write routes and no live-to-historical fallback. Requests use SQL
only and never access `X:`, VPro, mirror packages, or backup files.

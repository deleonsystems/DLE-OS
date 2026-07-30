# Refresh Center API Contract

Base: `http://DLE-OS-HOST:5043/api/platform/refresh-center/v1`

- `GET /status`
- `GET /datasets/{datasetId}`
- `GET /runs`
- `GET /runs/{runId}`
- `POST /datasets/{datasetId}/check-source`
- `POST /datasets/{datasetId}/refresh`
- `POST /datasets/{datasetId}/reconcile`
- `POST /core/force-full`

All routes use the existing exact Windows authorization policy. POST bodies are bounded models. Dataset IDs resolve only through the static registry. Unsupported actions return HTTP 409 and `RefreshNotImplemented`. Force-full requires `forceFullIntent=true`, `quietWindowReady=true`, and exact confirmation `FORCE FULL ERP SNAPSHOT`.

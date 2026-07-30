# Frontend Deployment and Rollback

The governed deployment completed with PASS in
`DEPLOYMENT_20260730T022614Z.json`.

It proved:

- verified COPY_ONLY SQL backup before backend mutation;
- atomic build A and build B publication;
- HTTP delivery of each build's own assets;
- rollback B to A;
- roll-forward A to B;
- shell no-store and asset immutable headers;
- historical and LIVE runtime restart with qualified owners.

Two corrected frontend-only builds were later published through
`Deploy-VersionedFrontend.ps1` after browser acceptance found the multiple-head
injection defect. The wrapper fixes source and destination paths, requires UAC
and `DLE-OS-HOST\DLE-OS`, and performs no SQL or source access.

Final active build:
`20260730T025221Z-A51EA451D31E`.

An already-open build `20260730T025142Z-A51EA451D31E` tab upgraded through one
ordinary navigation and bounded automatic reload to canonical `/`, with no
query string. No hard refresh, cache clear, query-string workaround, or
alternate application route was used.

Earlier failed deployments are retained. Each created and verified a backup,
failed closed, restored source/configuration/runtime/frontend/database state,
and restarted the prior runtimes.

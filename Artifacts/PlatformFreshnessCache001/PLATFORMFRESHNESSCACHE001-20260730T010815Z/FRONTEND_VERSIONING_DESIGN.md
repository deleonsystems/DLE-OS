# Frontend Versioning Design

- Build ID: `yyyyMMddTHHmmssZ-<first 12 uppercase SHA-256 characters>`.
- Build root: `C:\ProgramData\DLE-OS\Frontend\Builds\<BuildId>`.
- Canonical route: `/`.
- Compatibility routes: `/app` and the legacy HTML filename return a permanent
  redirect to `/`.
- Shell: `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`.
- Assets: `/assets/<BuildId>/...` with
  `Cache-Control: public, max-age=31536000, immutable`.
- Publication: stage, validate manifest, move complete build atomically, then
  replace the current pointer atomically.
- Rollback: exchange current and previous pointers only after both complete
  builds validate.
- Diagnostics: served build, loaded build, publication time, and API contract.
- Recovery: one session-scoped reload when loaded and expected IDs differ;
  a second mismatch is reported and does not loop.

Final build: `20260730T025221Z-A51EA451D31E`.

Previous complete build:
`20260730T025142Z-A51EA451D31E`.

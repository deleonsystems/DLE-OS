# Force-Full LIVE ERP Refresh Result

Verdict: PASS

Run ID: `LIVEREFRESH-20260729T232138Z-AF742233`

The explicitly authorized `-ForceFullExtraction` run bypassed only the
metadata-based `NO_SOURCE_CHANGES` return. Normal-mode behavior remains
unchanged, and the browser's ordinary refresh button does not invoke
force-full mode.

## Source qualification

- Execution identity: `DLE-OS-HOST\DLE-OS`
- Source mode: `MODE="O_RDONLY"`
- Four-entity base extraction: PASS
- Sales Order source passes: 2 complete sequential passes
- WOE-03 pass 1 records: 370,689
- WOE-03 pass 2 records: 370,689
- Source identity stability: PASS
- Key order: PASS
- Two-pass semantic comparison: PASS
- Writes or locks beneath `X:`: none

## Promotion

The initial post-extraction promotion failed closed because an identical
canonical package hash with a new mirror run ID was incorrectly treated as a
normal importer no-op. The prior package and qualified boundary were retained.

The importer was repaired with a LIVE-only internal `refresh-import` operation.
Normal `import` still returns `NO-OP` for the current package. `refresh-import`
requires the current package hash and a new nonblank mirror run ID, executes the
same serializable four-table transaction, creates a genuine ImportRunId, and
records an `IDENTICAL_CONTENT_REFRESH` audit event. An induced failure proved
complete rollback with the prior canonical fingerprint unchanged.

The already completed and qualified local pass outputs were then resumed
without additional source access. Package, SQL, boundary, API restart, and
readiness promotion all passed.

## Active qualified boundary

- ImportRunId: `27f0ed25-adcc-46aa-96f4-f0cc7d6ae8b6`
- Mirror run ID: `LIVEMIRROR001-20260729T232139Z-7CAB3382`
- Base package SHA-256:
  `BFEAAAF09C6690120CF85E64BEBECBBADB3C049214CCCF9BB993D19363110E77`
- Snapshot timestamp: `2026-07-30T00:37:50.691511Z`
- Source checked at: `2026-07-29T23:21:38.8421838Z`
- LIVE readiness: `Ready`
- Freshness: `Fresh`
- Core canonical count: 42,322
- Purchase Order lines: 1,384

The unchanged base package hash truthfully indicates identical canonical
content; the new mirror run ID, ImportRunId, and snapshot timestamp identify
the genuine completed extraction and transactional promotion.

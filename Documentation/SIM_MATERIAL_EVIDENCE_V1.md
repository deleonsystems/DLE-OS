# SIM Material evidence v1

Material Options exposes Add/View Note, Visual, and File on accepted BOM parent rows and supplemental fee children. It shares the Materials working-state save, optimistic revision guard, and immutable completed snapshots. No customer-facing fields or projections are added.

Owner identity is `CandidateId:BomVersion:Index:parent` or `CandidateId:BomVersion:Index:FeeId`, within the RFQ. Notes are append-only with server-owned author/time and Sourcing/Purchasing or Internal Quote purpose. Existing plain notes remain readable. A sourcing note can satisfy the existing customer-supply assumption requirement.

Binaries use the existing intake-document staging boundary and write/hash verification. A `.material.json` upload journal binds each document to its RFQ, owner, kind, category, original filename, SHA-256 and uploader/time. Saving references re-verifies bytes and uses journal metadata rather than browser-supplied metadata. PNG/JPEG visuals are limited to 8 MB; allowlisted document files to 20 MB. Authenticated controlled endpoints serve images/PDF inline and other supported files as attachments with private/no-store, nosniff and sandbox headers. No source path is needed.

EvidenceContractVersion 1 prevents older clients dropping evidence. Removal is a working-state tombstone with server-owned remover/time; bytes and completed references remain available. Abandoned uploads remain journaled under their owner, as with Labor visuals. Fee deletion follows existing fee behavior; previously completed versions retain all evidence. Evidence content participates in completion comparison; audit stamps do not create duplicate completed versions.

Tests: MaterialEvidenceChecks uses isolated state for parent/fee notes, visuals/files, stale and cross-owner rejection, invalid uploads, trusted metadata, fresh-store persistence, snapshot/idempotency, removal retention, corruption rejection and customer projection exclusion. Existing Materials and Labor regression checks remain applicable.

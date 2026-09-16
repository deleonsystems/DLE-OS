# SIM Labor visual references V1

Each operation's Options menu provides Add Visual and View Visuals to open that row's Visuals drawer. Parent and child operations have independent images. Paste a screenshot with Ctrl+V while the drawer has focus, or use Choose Image. Both routes upload PNG/JPEG files through the same authenticated SIM endpoint (8 MB per image). No clipboard permission prompt or workstation source path is needed.

Thumbnails and controlled View links become available after verified staging. Captions are optional (500 characters). Save Labor preserves attachment/caption/removal changes with the working plan. Complete Labor Quote also snapshots the operation references and captions. The table retains one Options control and a passive content indicator; counts appear in its tooltip and menu. Close or Escape dismisses the drawer without expanding a row.

## Persistence and ownership

- `POST /api/sim/rfqs/{id}/labor/visuals`: multipart `file` and `metadata`; existing Technical Review disposition permission and explicit upload header. Metadata binds the upload to an expected Labor revision, Manufacturing Definition, stable row ID, and sequence/name/parent context. Unsaved new rows are supported.
- `GET /api/sim/rfqs/{id}/labor/visuals/{documentId}`: existing Technical Review view permission, verified RFQ ownership and SHA-256, inline PNG/JPEG, private/no-store and nosniff headers. No arbitrary path endpoint.
- Existing `SimIntakeDocuments` stages and rereads/hash-verifies the bytes under `.sim-state/intake-documents/{intake-correlation-guid}/{document-guid}.bin`, with the existing `.json` staging manifest. A verified immutable `.labor.json` upload journal records intake/definition/row context, assembly/revision, filename, size, MIME type, SHA-256, stable SIM reference, reviewer and time.
- Save Labor validates every referenced image against that journal and rebuilds trusted metadata; client-supplied provenance cannot replace it. Cross-row/definition references and stale revisions are blocked. `visualContractVersion: 1` protects saved visuals from older clients. The existing `LABOR_BATCH_ALLOCATION_V6` calculation contract is unchanged.
- `operations[].visuals[]` persists captions and removal tombstones. Removing a row moves its visual tombstones into `plan.removedVisuals`. Completed snapshots retain their original references and captions. Removed images are excluded from active counts but binaries remain available to history; this feature does not purge files.
- Staged uploads abandoned before Save remain explicitly owned by the immutable upload journal; they are not linked into the saved plan. No automatic cleanup deletes potentially referenced images. An upload journal write failure removes that upload's newly staged binary/manifest before returning failure.

These are Labor visual references, separate from Technical Package Inventory and Accepted BOM. There is no OCR, hosted analysis, drawing modification, classification, or Production traveler publishing. Existing Labor calculations and Materials persistence remain unchanged.

## Qualification

`LaborVisualChecks.cs` covers isolated staging, hash retrieval/tampering, bounded uploads/captions, row ownership, trusted provenance, legacy-client protection, parent/child attachments, save/reopen/restart, removal audit and completed history. `run-labor-ui-tests.mjs` exercises clipboard/file event handlers, counts, thumbnails, captions, failure handling, read-only protection and existing Labor arithmetic/hierarchy. Normal 5177 qualification uses a clearly named synthetic RFQ and synthetic PNG/JPEG fixtures; real Abbott records are not edited.

## Step notes and Options

Options also provides Add Note and View Notes. Add Note opens a compact editor with exactly Production and Internal RFQ purposes. Notes are independent of the general Instructions cell. Add/Update Note applies a working edit; Save Labor persists it. Row View Notes supports edit/remove. View All Notes is a consolidated read-only view in current parent/child traveler order, including sequence, operation, purpose, text and authorship/time. Internal RFQ notes do not automatically become production instructions.

`operations[].notes[]` stores stable note/row IDs, purpose, text, original sequence/operation context, server-assigned author/creation time, optional last-editor/time and removal audit. Current sequence is derived from current row order. Text is limited to 2000 characters, with 50 notes per row. `noteContractVersion: 1` prevents older clients from erasing notes. New optional fields are omitted when absent so existing rows retain their representation.

Complete Labor snapshots notes with the existing operations and visuals. Later edits do not rewrite completed versions. Removing a row retains note tombstones in `plan.removedNotes`. No traveler release, advanced search, or pricing changes are introduced. `LaborNoteChecks.cs` and the extended UI suite cover both purposes, stable row scoping/reorder, provenance, save/reopen/restart, completed history, removal and read-only behavior.

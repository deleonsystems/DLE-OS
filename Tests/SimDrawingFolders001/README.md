# SIM assembly drawing-folder references

This feature stores a folder reference per intake assembly line. It never imports, opens, copies, extracts, classifies or approves the files shown in the listing. File rows are names only; directory rows navigate. An explicit Save Folder Link creates or replaces that assembly's association. Other assemblies and existing review fields are preserved.

## Configuration and activation

The default is unconfigured. No root or customer-specific association is installed by this change. On opening the selector, an unconfigured host explains that an approved root must be configured.

The host reads `DLE_OS_SIM_DRAWING_ROOTS` once at startup as a JSON array of `{ "id": "stable-logical-id", "label": "Reviewer-facing name", "path": "absolute local or UNC source root" }`. The supported developer runner derives it from the optional `drawingSourceRoots` array in the installed `sim-profile.json`, clearing inherited mappings when that property is absent. Only an authorized host administrator should configure it. Do not put credentials in it. Repository-local SIM state remains unchanged. Do not enable a real root until its access scope and the actual runtime identity have been verified and approved.

GET routes require `technical_review.view`; PUT requires `technical_review.disposition`. This uses the existing synthetic SIM persona authorization and LAN access guard. It is not per-customer authorization and does not impersonate the browser's Windows user. Any viewer can list names beneath any configured root, regardless of the selected customer. Configure the smallest approved roots. A common Drawing-Prints root would expose names across its customer subfolders to authorized SIM viewers; that scope requires approval before activation.

The new frontend checks the backend's `drawingFoldersAvailable` capability. An older running backend therefore continues to hide the new controls. Backend activation requires a separate approved SIM restart; this change does not perform one. Refresh the browser after activation.

Persistent associations contain a logical root ID and slash-separated relative path, never a drive letter or physical root. They also capture assembly line, customer ID, assembly number, revision, actor and time. Selection does not infer a revision from the folder name. Changing the root's physical location supports NAS migration when the relative hierarchy is retained. Folder renames or hierarchy changes require deliberate relinking. The association is a mutable-location reference, not a snapshot or revision approval.

## Boundaries

Root configuration is allowlisted; callers cannot submit arbitrary absolute paths. Paths reject traversal, device names, alternate data streams, ambiguous separators and trailing dots/spaces. Ancestor and selected-directory reparse points are rejected; reparse entries are omitted. Directory chains are checked before and after enumeration. The source must not be an adversarial concurrently retargeted tree: filesystem access is not an OS-level read-only mount or a transactional directory snapshot.

Each request checks at most 201 immediate directory entries and returns at most 200, clearly marking incomplete listings. No recursive traversal or indexing occurs. Large directories may require a narrower configured root. File content access is not implemented. Access failures return a generic message without physical paths. Saving requires a current assembly/context token and an editable SIM review. A lost save response must be resolved by reopening the selector, not by blind retries.

## Tests

`SimDrawingFolders001.csproj` is a console harness referencing the SIM host. Build and run against an isolated source copy, passing a new empty synthetic fixture directory. It never reads the active `.sim-state` dataset. It tests path attacks, unknown roots, bounded listing, save/reload/change, stale saves, separate assembly associations, existing-field preservation, closed/non-SIM records and root migration.

Create a synthetic junction named `linked` beneath a synthetic source root, pointing to a synthetic sibling directory, then run `SimAnalysis001.dll --reparse <synthetic-source-root>` to verify listing omission and rejection as both a child and configured root. Do not use actual source shares for these tests.

Run `node Tests/SimDrawingFolders001/run-ui-tests.mjs` plus the existing Technical Review UI-contract, entry-confirmation and review-document tests. The UI test covers capability gating, unconfigured state, explicit save/change, cancellation, escaped names, independent assembly selection and preservation of unsaved review data.

## Linked-file selection (backend activation required)

The file picker extends the linked folder with explicit Drawing / Reference and BOM reference actions in their existing review sections. It saves ONE reviewer-selected, typed file into the existing immutable, hash-verified SIM document store. The confirmation panel explains the local snapshot before Save selected copy to review. There is no bulk copying, automatic classification, source revision choice, BOM extraction, document acceptance or release. The original share is opened read-only and is never changed by this feature.

Drawing references support PDF/DOCX; BOM reference copies support PDF/DOCX/XLS/XLSX/CSV/TXT, maximum 20 MB each. Copy support does not imply extraction support: the existing format-specific workflow still applies. Drawing preview uses the existing PDF path or Word DOCX-to-PDF conversion when the reviewer separately saves the drawing reference. This conversion depends on the existing local conversion setup. The original copy stays preserved. Drawing snapshot save stages the drawing choice in the browser; Save reference selection remains explicit. BOM copies appear under Source documents for explicit Materials Use and review before any requested analysis.

Every snapshot records logical root, relative filename, folder association ID, assembly line/customer/assembly/revision, chosen role, byte size, source creation/last-write timestamps and SHA-256, plus the existing reviewer/time/document provenance. Physical roots and mapped drives are not persisted in the document's source metadata. The selected file is bounded to that assembly's saved folder. Files and ancestors are checked for reparse points. Files are read under a share mode that denies concurrent write/delete while open, bounded to 20 MB, with directory/file metadata checks around the read. As with the folder browser, this is not a transactional defense against an adversarial directory tree.

Selection reads one file to establish its fingerprint without persisting it. Save re-reads and compares the fingerprint and current folder/context token before staging; missing, inaccessible, changed or relinked sources fail without adding a document. A stable per-selection ID makes a repeated save return the original saved copy instead of duplicating it. After saving, the copy remains usable even if the source moves or changes. Source freshness is recorded at capture, not continuously monitored; opening an existing saved copy does not query the share or silently update it.

GET file description requires technical_review.view, POST snapshot requires technical_review.disposition, using existing SIM/LAN guards. New controls require linkedDrawingFilesAvailable from the updated backend and remain hidden on older hosts. No restart is performed by source installation. A separately approved SIM restart and then browser refresh are needed for activation and live UI qualification.

Additional tests: the existing synthetic console harness calls LinkedFileChecks; node Tests/SimDrawingFolders001/run-linked-file-ui-tests.mjs tests explicit role-specific selection, cancel/no writes, stale errors, immutable-copy wording, staged drawing choice and BOM guidance. Tests do not select or save on RFQI-SIM-0048.

## Recoverable review-file removal (backend activation required)

Technical Package Review offers Remove from review for an editable SIM review with disposition permission. The server checks dependencies before an explicit confirmation. Removal only archives the active file/package metadata; stored binaries, provenance, review decisions and original source files are retained. Removed files offers Restore to review after reopening, with reviewer/time audit for both actions. There is no permanent-delete operation. Restore checks the preserved verified binary before reactivating it.

Current drawing/rendition and Production/Materials roles must be explicitly changed and saved first. Extraction history, saved BOM/slides/annotations, cross-record references and released/closed reviews block removal. Accepted production-slide history conservatively blocks every file removal in that review. No dependency is cascaded away. Full-record and extraction-job tokens reject stale requests; dependency checks run again within the store write gate. A retry of an old linked-file snapshot selection cannot recreate an archived copy.

Unsaved reference choices can be cancelled and unsaved linked-folder file choices can be cleared without saving a copy. Saved-copy removal refuses pending editor changes. The new server capability gates Remove controls; installation alone does not activate the backend. Obtain separate approval for a supported SIM restart, then refresh/sign in for live qualification.

The synthetic console harness includes RemovalChecks (remove/reload/restore, bytes and audit preservation, dependency/role/release blocks, stale tokens and concurrent changes). Run run-removal-ui-tests.mjs for explicit confirm/cancel, restore, unsaved edit protection, stale errors and permission checks. No test changes an actual intake or source share.

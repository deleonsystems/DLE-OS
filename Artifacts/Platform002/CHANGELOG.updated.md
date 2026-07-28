# DLE Visual PRO/5 Engineering Lab Changelog

## 2026-07-23 — Initial workspace discovery

Reason: Inventory the isolated T0 test workspace and document its architecture,
startup path, program/data separation, ADATA role, naming conventions,
dictionary resources, potentially unsafe external references, and next steps
for understanding core business records.

Changes:

- Created `C:\Add-On\Lab\Documentation\VPROLAB_ARCHITECTURE.md`.
- Created `C:\Add-On\Lab\CHANGELOG.md`.

Method:

- Read `C:\Add-On\AGENTS.md` completely before discovery.
- Performed read-only directory/file metadata inventory.
- Inspected selected BBx program and data headers and readable strings.
- Searched local test files for readable production-drive/share, printer, and
  external-utility references.
- Did not launch Visual PRO/5, execute application programs, access production
  paths, contact external systems, or modify existing programs or test data.

Result: Discovery documentation created. No existing file was modified,
renamed, or deleted.

## 2026-07-23 — VPROLAB-002 business data and program relationship map

Reason: Map local T0 Add+ON programs to prioritized ADATA business files,
identify detectable file-operation evidence and dictionary/layout resources,
and select evidence-backed candidates for core business identifiers.

Changes:

- Created `C:\Add-On\Lab\Documentation\BUSINESS_DATA_MAP.md`.
- Created `C:\Add-On\Lab\Documentation\PROGRAM_DATA_RELATIONSHIPS.md`.
- Updated `C:\Add-On\Lab\CHANGELOG.md` with this entry.

Method:

- Read `C:\Add-On\AGENTS.md` and the existing architecture report before
  beginning.
- Enumerated 219 prioritized local ADATA files.
- Read local type-04 BBx program containers and matched exact ADATA filename
  literals without executing them.
- Searched DDM dictionary/layout resources for supported field, type, length,
  record, and business-identifier evidence.
- Separated confirmed findings, strong inferences, and runtime unknowns.

Result: Two discovery reports created and this changelog updated. No existing
application program, configuration file, or test-data file was modified,
renamed, deleted, or executed. No network or production path was accessed.

## 2026-07-23 — VPROLAB-003 BMM-01 read-only extraction proof

Reason: Prove the relationship between DDM-06 layout A and actual local test
BMM-01 records with a standalone, bounded, read-only Visual PRO/5 extractor.

Changes:

- Created `C:\Add-On\Lab\Programs\BMM01_READONLY.src`.
- Created compiled program `C:\Add-On\Lab\Programs\BMM01_READONLY`.
- Created `C:\Add-On\Lab\Exports\BMM01_SAMPLE.csv`.
- Created `C:\Add-On\Lab\Documentation\BMM01_READONLY_PROOF.md`.
- Updated `C:\Add-On\Lab\CHANGELOG.md` with this entry.
- Created and removed temporary compiler tests, program listings, and extracted
  BASIS manual files beneath `C:\Add-On\Lab`.
- A `pro5lst` command initially omitted its Lab destination and transiently
  created `C:\Add-On\aontest\aon\MFG\BMM`. It was a new text listing, did not
  overwrite an existing file, and was immediately deleted.

Method:

- Read all required governance and prior discovery documents first.
- Decoded every known DDM-06 BMM-01 layout-A field.
- Inspected existing BMM/BMR/SYC program logic with local BASIS listing tools.
- Used channel 1 with `MODE="O_RDONLY"` for the hard-coded local BMM-01 path.
- Validated MKEYED type, 256-byte file-declared record length, 22-character
  key length, and key equality with layout-A firm-plus-bill fields.
- Exported exactly 25 validated records through channel 2 to the Lab CSV.
- Ran only under the T0/configTEST Visual PRO/5 argument set.

Result:

- The CSV contains 25 layout-A records and the requested bill/drawing/revision
  fields plus supported non-date attributes.
- Before and after BMM-01 were identical: 159,744 bytes, timestamp
  `2012-08-29 11:04:56.3670000 -07:00`, SHA-256
  `7FB34AEF5273285D0F7C205F7C73ACC2579512F9363C6BE59B3DA2385D42778C`.
- No existing application program, configuration file, or ADATA/test-data file
  was modified. No network drive, DeLeon-Server path, printer, external
  network system, or T8 production environment was accessed.

## 2026-07-23 — VPROLAB-004 ADATA file inventory

Mission: Legacy ERP Survey, Part 1.

Purpose:

- Create one physical inventory row for every file beneath
  `C:\Add-On\aontest\aon\ADATA`.
- Record filesystem metadata, SHA-256, safe BBx header properties, DDM-06
  layout-token evidence, literal type-04 program references, conservative
  domain/priority classifications, confidence, and investigation status.

Files created:

- `C:\Add-On\Lab\Exports\ADATA_FILE_INVENTORY.csv`
- `C:\Add-On\Lab\Documentation\ADATA_FILE_INVENTORY.md`
- `C:\Add-On\Lab\Documentation\ADATA_SURVEY_METHOD.md`
- `C:\Add-On\Lab\Evidence\ADATA_SURVEY_COMMANDS.txt`
- `C:\Add-On\Lab\Evidence\AON_INVENTORY_BEFORE.csv`
- `C:\Add-On\Lab\Evidence\AON_INVENTORY_AFTER.csv`
- `C:\Add-On\Lab\Evidence\AON_INVENTORY_COMPARISON.txt`
- `C:\Add-On\Lab\Scripts\survey_adata.py`
- `C:\Add-On\Lab\Scripts\build_adata_reports.py`

File updated:

- `C:\Add-On\Lab\CHANGELOG.md`

Source paths inspected:

- `C:\Add-On\AGENTS.md`
- all existing Markdown/text documentation beneath `C:\Add-On\Lab`
- every physical file beneath `C:\Add-On\aontest\aon\ADATA`
- every local type-04 BBx program detected beneath
  `C:\Add-On\aontest\aon`, excluding ADATA from program scanning

Method and result:

- Captured a recursive path/size/modified-time baseline for all 2,981 files
  beneath `C:\Add-On\aontest\aon`.
- Inventoried 531 ADATA files totaling 1,082,929,929 bytes.
- Calculated and validated 531 SHA-256 hashes.
- Identified 494 BBx MKEYED files, 36 BBx SERIAL files, and one BBx KEYED file.
- Found exact DDM-06 file/layout tokens for 385 files.
- Found literal program references for 387 files.
- Did not execute Visual PRO/5 or any Add+ON program or utility.
- Captured the same recursive source inventory after the survey. Before and
  after both contain 2,981 files and 1,158,796,923 bytes, with zero created,
  deleted, size-changed, or modified-time-changed source paths.

Safety verification:

- All generated output paths were explicitly fixed beneath `C:\Add-On\Lab`.
- No temporary file or utility output was created beneath
  `C:\Add-On\aontest`.
- No production/network path, printer, external system, or T8 session was
  accessed.
- No existing Add+ON application, configuration, program, or data file was
  modified.

Known exceptions: none.

## 2026-07-23 — VPROLAB-005 DDM architecture and schema catalog

Purpose:

- Prove the roles and relationships of local test `DDM-03` through `DDM-06`.
- Determine their physical structures and default keys read-only.
- Build a supported file/layout/field/primary-key schema catalog.
- Validate the model against BMM-01, IVM-01, and WOE-01.

Files created:

- `C:\Add-On\Lab\Programs\DDM_SURVEY_READONLY.src`
- `C:\Add-On\Lab\Programs\DDM_SURVEY_READONLY`
- `C:\Add-On\Lab\Exports\DDM03_SAMPLE.csv`
- `C:\Add-On\Lab\Exports\DDM04_SAMPLE.csv`
- `C:\Add-On\Lab\Exports\DDM05_SAMPLE.csv`
- `C:\Add-On\Lab\Exports\DDM06_SAMPLE.csv`
- `C:\Add-On\Lab\Exports\DDM_FILE_CATALOG.csv`
- `C:\Add-On\Lab\Exports\DDM_LAYOUT_CATALOG.csv`
- `C:\Add-On\Lab\Exports\DDM_FIELD_CATALOG.csv`
- `C:\Add-On\Lab\Exports\DDM_KEY_CATALOG.csv`
- `C:\Add-On\Lab\Documentation\DDM_ARCHITECTURE.md`
- `C:\Add-On\Lab\Documentation\DDM03_ANALYSIS.md`
- `C:\Add-On\Lab\Documentation\DDM04_ANALYSIS.md`
- `C:\Add-On\Lab\Documentation\DDM05_ANALYSIS.md`
- `C:\Add-On\Lab\Documentation\DDM06_ANALYSIS.md`
- `C:\Add-On\Lab\Documentation\DDM_SCHEMA_CATALOG_METHOD.md`
- `C:\Add-On\Lab\Documentation\DDM_RELATIONSHIP_PROOF.md`
- `C:\Add-On\Lab\Evidence\DDM_SURVEY_COMMANDS.txt`
- `C:\Add-On\Lab\Evidence\DDM_SOURCE_BASELINE_BEFORE.csv`
- `C:\Add-On\Lab\Evidence\DDM_SOURCE_BASELINE_AFTER.csv`
- `C:\Add-On\Lab\Evidence\AON_INVENTORY_VPROLAB005_BEFORE.csv`
- `C:\Add-On\Lab\Evidence\AON_INVENTORY_VPROLAB005_AFTER.csv`
- `C:\Add-On\Lab\Evidence\AON_INVENTORY_VPROLAB005_COMPARISON.txt`
- `C:\Add-On\Lab\Evidence\DDM_RUNTIME_METADATA.csv`
- `C:\Add-On\Lab\Evidence\DDM_CATALOG_VALIDATION.json`

File updated:

- `C:\Add-On\Lab\CHANGELOG.md`

Method:

- Read all existing Lab Markdown/text documentation before DDM interpretation.
- Captured source metadata/hash and recursive source-tree baselines.
- Listed all local ADM DDC/DDM/DDR/DDX programs and two SCN shadows to
  explicit Lab temporary directories.
- Confirmed record templates and joins from Add+ON maintenance/report/export
  program logic.
- Compiled and preflight-listed a standalone Lab reader.
- Opened DDM-03/04/05/06 on T0 channels 1/2/3/4 exclusively with
  `MODE="O_RDONLY"`.
- Exported exactly 100 sample rows per file and read all definition records to
  construct the requested schema catalogs.
- Used the bundled spreadsheet artifact runtime to import, count, inspect, and
  visually QA all four catalog CSVs.
- Removed all VPROLAB-005 temporary listings, staging files, QA renders,
  compiler outputs, builder, and dependency junction.

Results:

- DDM-03: 611 file/layout definitions.
- DDM-04: 6,787 ordered field definitions.
- DDM-05: 517 comment lines across 126 layouts.
- DDM-06: 6,787 resolved where-used rows with an exact one-to-one DDM-04
  identifier match.
- Catalogs: 471 file IDs, 611 layouts, 6,787 field definitions, and 2,333
  DDM-defined primary-key segments.
- BMM-01 reproduced layout A, record length 256, key length 22, and all five
  required field definitions with no mismatch.
- IVM-01 and WOE-01 primary-key segment sums match their physical key lengths.

Integrity:

- DDM-03 through DDM-06 match their before size, creation time, modified time,
  and SHA-256.
- Recursive source inventory before and after is identical: 2,981 files,
  1,158,796,923 bytes, zero created/deleted/size-changed/modified-time-changed
  paths.
- No existing Add+ON application program, configuration file, or test-data
  file was changed.
- No production/network path, printer, external system, or T8 session was
  accessed.

Known exceptions:

- The first Lab CSV run retained an escape mnemonic in the final column. A
  second shorter overwrite left stale tail bytes in those generated Lab files.
  Only the nine generated VPROLAB-005 CSV outputs were deleted, and the final
  clean T0 run regenerated them successfully.
- The spreadsheet artifact runtime returned Windows status `-1073740791`
  during shutdown after completing output and QA. Independent re-import and
  row-count validation passed.
# 2026-07-23 — VPROLAB-006 DDM-01 catalog and physical key validation

- Read `C:\Add-On\AGENTS.md`, the attached VPROLAB-006 request, and all
  existing VPROLAB Markdown/text documentation beneath `C:\Add-On\Lab`.
- Captured before/after metadata and SHA-256 for DDM-01 plus ten selected
  business files, and recursive before/after inventories of the 2,981-file
  local `aontest\aon` source tree.
- Listed 14 existing dictionary/GEN4 programs only to explicit destinations
  beneath `C:\Add-On\Lab\Temporary`.
- Created the standalone T0 Lab reader:
  - `C:\Add-On\Lab\Programs\DDM01_READONLY`
  - `C:\Add-On\Lab\Programs\DDM01_READONLY.src`
- Created:
  - `C:\Add-On\Lab\Exports\DDM01_SAMPLE.csv`
  - `C:\Add-On\Lab\Exports\DDM01_CATALOG.csv`
  - `C:\Add-On\Lab\Exports\DDM_FIN_KEY_VALIDATION.csv`
  - `C:\Add-On\Lab\Documentation\DDM01_ANALYSIS.md`
  - `C:\Add-On\Lab\Documentation\DDM01_RELATIONSHIP_MAP.md`
  - `C:\Add-On\Lab\Documentation\DDM_FIN_VALIDATION_METHOD.md`
  - `C:\Add-On\Lab\Documentation\SCHEMA_DRIVEN_READER_ASSESSMENT.md`
  - `C:\Add-On\Lab\Evidence\VPROLAB006_COMMANDS.txt`
  - VPROLAB-006 runtime, FIN audit, selected DDM-05, catalog-validation,
    source-baseline, and source-inventory evidence beneath
    `C:\Add-On\Lab\Evidence`.
- DDM-01 was confirmed as a 1,658-record reusable logical data-element
  dictionary: 96-byte runtime records, 12-character data-name key, one layout,
  and no exposed alternate-key entries.
- Validation results: 7 Exact Match, 3 Mismatch (`SYS-01` layouts), and 2
  Insufficient Evidence (zero-record `POE-01` and `POE-11`).
- Every existing input was opened with `MODE="O_RDONLY"`. No Add+ON
  application program, T8 session, production path, network path, printer, or
  external system was used.
- Final recursive integrity comparison: 2,981 files and 1,158,796,923 bytes
  before and after; zero created/deleted/size/modified-time paths; all 11
  selected size/creation/modified/hash tuples identical.
- No existing Add+ON application, configuration, or test-data file was
  created, changed, moved, renamed, or deleted.

# 2026-07-23 — VPROLAB-007 guarded schema-driven reader prototype

- Read `C:\Add-On\AGENTS.md`, the attached VPROLAB-007 request, and all
  existing VPROLAB documentation beneath `C:\Add-On\Lab`.
- Captured before/after metadata and SHA-256 for DDM-01/03/04/05/06,
  BMM-01, IVM-01, and WOE-01, plus recursive before/after inventories of all
  2,981 paths beneath the local source tree.
- Listed only `MFG\BMM.MA`, `DIS\IVM.MA`, and `MFG\WOE.AA`, with utility
  output fixed beneath `C:\Add-On\Lab\Temporary`.
- Created three JSON reader specifications from the DDM catalogs and one
  generated standalone T0 Lab program:
  - `C:\Add-On\Lab\Programs\SCHEMA_READER_PROTOTYPE`
  - `C:\Add-On\Lab\Programs\SCHEMA_READER_PROTOTYPE.src`
- Created the required validation, BMM/IVM/WOE sample, BMM comparison, and
  repeatability CSVs beneath `C:\Add-On\Lab\Exports`.
- Created the specification-format, proof, failure-mode, generation-log,
  static-audit, command, baseline, inventory, and comparison evidence beneath
  `C:\Add-On\Lab`.
- Both final T0 runs exited 0. Each file validated as
  `PASS WITH APPROVED OVERRIDE` for an explicit program-supported IOLIST
  grouping adapter.
- Exported exactly 25 rows: BMM-01 39 columns, IVM-01 66 columns, and WOE-01
  57 columns.
- BMM comparison: 325 matches and zero mismatches.
- Repeatability: identical keys, decoded values, record hashes, source
  hashes, row counts, and column counts; only run IDs/timestamps differed.
- Static source audit: PASS. All source opens use `MODE="O_RDONLY"` on
  channel 10; Lab-only outputs use channels 20–23; no unsafe executable token,
  production/network path, printer, external system, or T8 reference exists.
- Final integrity: all eight governed files are unchanged by physical type,
  size, creation time, modification time, and SHA-256. The full source
  inventory remains 2,981 paths with zero non-unchanged rows.
- Preserved source/compiled listings and both runs beneath Evidence; removed
  all VPROLAB-007 manual, compile, runtime, QA, and dependency-junction
  temporary artifacts.
- No existing Add+ON application program, configuration file, dictionary, or
  business-data file was modified.

# 2026-07-23 — VPROLAB-008 negative qualification and fourth-file expansion

- Read `C:\Add-On\AGENTS.md`, the attached VPROLAB-008 request, and the
  existing VPROLAB documentation and schema-reader specification format.
- Captured before/after physical metadata, size, creation/modified timestamps,
  and SHA-256 for nine governed sources; captured recursive before/after
  inventories for all 2,981 local `aontest\aon` paths.
- Created 12 isolated negative fixtures and specifications beneath
  `C:\Add-On\Lab`; no negative test opened an existing `aontest` business file.
- Created, compiled, listed, and statically audited:
  - `C:\Add-On\Lab\Programs\SCHEMA_READER_NEGATIVE_HARNESS[.src]`
  - `C:\Add-On\Lab\Programs\SCHEMA_READER_FOURTH_PROTOTYPE[.src]`
  - `C:\Add-On\Lab\Programs\VPROLAB008_FINAL_METADATA[.src]`
- Negative qualification: PASS 12, FAIL 0, BLOCKED 0, INSUFFICIENT EVIDENCE
  0. All 11 required safety failures returned controller exit 1; early EOF
  returned 0 with exactly three fixture rows; no failed pre-read gate was
  followed by a record read; no safety failure committed a final output.
- Preserved the first bootstrap-diagnostic evidence beneath
  `C:\Add-On\Lab\Evidence\VPROLAB008_Negative_Attempt1`.
- Selected `GLM-01` (General Ledger / Accounting), generated its reader
  specification from DDM catalogs, and validated it as
  `PASS WITH APPROVED OVERRIDE` for the `[12,40]` IOLIST grouping.
- Two approved T0 runs exported 25 rows and 19 columns. Repeatability was
  `EXPECTED METADATA DIFFERENCE ONLY`; keys, values, record hashes, source
  hashes, and shape matched.
- Created the VPROLAB-008 negative result, gate trace, GLM sample,
  repeatability, selection, qualification, generation, static-audit, runtime,
  command, and integrity evidence beneath `C:\Add-On\Lab`.
- Updated `SCHEMA_READER_VALIDATION.csv` by preserving the three VPROLAB-007
  rows and appending the GLM-01 row; updated
  `SCHEMA_READER_FAILURE_MODES.md` with observed behavior and untested cases.
- Final integrity: all nine governed files are unchanged, and the recursive
  source tree has zero created, deleted, size-changed, or modified-time-changed
  paths.
- No existing Add+ON application, configuration, dictionary, program, or test
  data file was modified.

# 2026-07-23 — VPROLAB-009 Legacy Mirror Engine Alpha

- Read `C:\Add-On\AGENTS.md`, the attached VPROLAB-009 request, all existing
  Lab documentation, the schema-reader format, and the four qualified reader
  specifications before implementation.
- Captured before/after physical metadata, size, creation/modified timestamps,
  and SHA-256 for DDM-01/03/04/05/06 plus BMM-01, IVM-01, WOE-01, and GLM-01;
  captured recursive before/after inventories of all 2,981 local source paths.
- Created the fixed four-file Mirror configuration, standalone compiled/source
  program, controller/generator/qualification/audit/integrity scripts, design,
  package, hashing, proof, and operator documentation beneath
  `C:\Add-On\Lab`.
- Statically audited the Visual PRO/5 source and all supporting scripts before
  runtime. Result: PASS; all four sources use `MODE="O_RDONLY"`, mutation is
  Lab-only, the allowlist is exact, and no production/network/T8/printer/SQL/
  API/scheduler/arbitrary-source logic exists.
- Ran three approved T0 full extractions. Each validated FID/FIN and exported
  BMM-01 523 rows/39 columns, IVM-01 20,257/66, WOE-01 5,868/57, and GLM-01
  254/19. All counts reconciled, unique-key counts matched, and duplicate/
  blank key counts were zero.
- Qualified first-, second-, and third-success Current/Previous behavior,
  artificial disk-space failure, controlled commit failure, controlled
  pre-commit interruption, six-run failed-evidence retention, and successful
  recovery after stale staging. All expected controller exit codes and
  retention assertions passed.
- Final state: Current is SUCCESS3, Previous is SUCCESS2, exactly two complete
  eight-file packages, five compact failure directories, nine permanent
  manifests/logs, and empty Staging.
- Repeatability between SUCCESS2 and SUCCESS3 matched keys, decoded business
  values, record/source hashes, deterministic output hashes, counts, columns,
  and package structure. Only approved run ID/timestamp metadata differs. The
  deterministic package hash is
  `BA056E4AB3850CFD46BB76A171CCD1B0D50C3C1B532F766886A923F8EB6289E1`.
- Final source integrity: all nine governed files are unchanged; the recursive
  source inventory remains 2,981 paths with zero created, deleted, resized, or
  modified-time-changed paths.
- No existing Add+ON program, configuration, dictionary, or test-data file was
  modified. No production, network, T8, printer, SQL, or API access occurred.

# 2026-07-24 — VPROLAB-010 Canonical Candidate Catalog

- Read `C:\Add-On\AGENTS.md`, the attached VPROLAB-010 request, all existing
  Lab documentation, the six priority catalogs, exported DDM-05 evidence, the
  four qualified reader specifications, and the schema-reader format.
- Captured size, local/UTC modified timestamps, and SHA-256 for all 11 governed
  inputs before catalog processing; final verification reports all 11
  unchanged.
- Created a deterministic 6,787-row authoritative candidate CSV with one row
  per DDM field definition. No source row was omitted or merged.
- Created a 12-sheet artifact-tool Excel review workbook with filters, frozen
  headers, source/proposal/human-review color bands, validation lists, 6,787
  complete field rows, and no macros, external links, pivot caches, hidden
  sheets, or formula errors.
- Created the naming standard, review instructions, 1,658-row logical-element
  catalog, 705-group shared-concept catalog, R0-R4 partition queues,
  terminology/uncertainty/exclusion queues, summary report, generators, and
  validation evidence beneath `C:\Add-On\Lab`.
- R0 contains all 116 fields from BMM-01, IVM-01, WOE-01, and GLM-01.
- Proposal validation: PASS (23 checks). Independent deliverable validation:
  PASS. All 12 rendered worksheet previews passed visual review.
- Human approval fields remain blank except `review_status=Unreviewed`.
  Suggested names and meanings remain proposals only.
- The bundled artifact runtime returns native teardown status `3221226505`
  after writing the workbook and QA. The outer generator accepts this only
  when the workbook exists, stderr is empty, and independent QA proves exactly
  12 sheets, exact row counts, and zero formula errors. This limitation remains
  documented in `VPROLAB010_GENERATION_LOG.txt`.
- Created the exact file/change manifest and command record:
  - `C:\Add-On\Lab\Evidence\VPROLAB010_CREATED_UPDATED_FILES.txt`
  - `C:\Add-On\Lab\Evidence\VPROLAB010_COMMANDS.txt`
- Removed the VPROLAB-010 dependency junction, temporary builder inputs,
  failed-launch logs, generated bytecode, unwanted inspection sidecars, and
  the empty task temporary directory. The bundled dependency target was not
  modified.
- No Visual PRO/5 program was executed. No existing Add+ON application,
  configuration, dictionary, reader specification, mirror package, or test
  data file was modified. No production, network, T8, printer, SQL, API, or
  external-system access occurred.

# 2026-07-26 — R0 Canonical Catalog Approval Completion

- Treated the 116 completed business-owner decisions in `R0 Qualified Mirror`
  as authoritative and preserved `dle_uses_field`,
  `include_in_canonical_model`, and `approved_canonical_name` exactly.
- Created a byte-identical pre-change backup:
  `C:\Add-On\Lab\Backups\20260726_R0_CANONICAL_APPROVAL\CANONICAL_CANDIDATE_CATALOG.pre-r0-approval.xlsx`.
- Completed the remaining R0 approval columns with reviewer
  `Miguel De Leon` and review date `2026-07-26`.
- Final R0 result: 116 reviewed, 31 included, and 85 excluded.
- Included rows received concise meanings, source-owner domains/entities,
  conservative data types, future modules, completed statuses, and notes.
- Excluded rows received no canonical name, domain, entity, data type, or
  future module; status is `Rejected`, with governed-source/raw-mirror
  retention noted.
- Mechanically synchronized the R0 human-review state into matching R0 rows in
  `Complete Field Catalog`. No non-R0 Complete Catalog row or R1-R4 worksheet
  value changed.
- Preserved shared concepts across source entities. Repeated approved names
  `BomRevision`, `DrawingNumber`, `DrawingRevision`, `ItemDescription`, and
  `ItemNumber` are intentional shared concepts, not naming collisions.
- Validation result: PASS. All decision completeness/consistency checks,
  source-owner entity/domain checks, formula hashes, sheet order/counts, table
  counts/ranges, non-R0 hashes, final workbook hash, and all 12 visual previews
  passed.
- Remaining technical uncertainty is limited to four included `RawDate`
  conversion rules and one included Decimal scale; no row requires additional
  business judgment from Miguel.
- Created the completion report, preflight/validation/structure evidence,
  exact command/change records, and 12 final workbook previews beneath
  `C:\Add-On\Lab`.
- The artifact runtime emitted its known post-completion native teardown status.
  The result was accepted only after independent validation and hash
  reconciliation passed.
- Removed the task dependency junction, staged workbook, temporary script copy,
  and empty temporary directory. The bundled dependency target was untouched.
- The authoritative CSV was not modified. No Visual PRO/5, Add+ON application,
  production, network, T8, printer, SQL, API, integration, or external-system
  operation was performed.

# 2026-07-26 — MIRROR-001 Canonical Data Contract v1.0

- Used `C:\Add-On\Lab\Canonical\CANONICAL_CANDIDATE_CATALOG.xlsx`, worksheet
  `R0 Qualified Mirror`, as the authoritative business approval source.
- Preserved Miguel De Leon's approved canonical names, meanings, domains,
  entities, data types, future modules, decisions, and statuses exactly.
- Created the seven requested versioned deliverables beneath
  `C:\Add-On\Lab\Canonical\Contracts\V1.0`.
- Contract membership contains exactly 31 approved fields across four entities:
  BillOfMaterial (5), GeneralLedgerAccount (3), InventoryItem (7), and
  WorkOrder (16).
- Documented all 85 R0 exclusions in the Markdown/JSON contract and
  traceability matrix without admitting them to either canonical field catalog.
- Preserved four fields as `RawDate` with no conversion and preserved
  `WorkOrder.SchProdQuantity` as `Decimal` with no inferred scale.
- Resolved exact source-mirror columns through the four qualified reader
  specifications. Preserved the two-column mirror trace for
  `WorkOrder.ItemDescription` without inventing a consolidation rule.
- Added a nine-row evidence-based relationship catalog. Cardinality, joins,
  physical SQL names, API paths, and implementation bindings remain
  deliberately unspecified.
- Validation result: PASS. All five CSVs imported successfully through the
  approved spreadsheet runtime; required counts, source mappings, approval
  parity, exclusion separation, type constraints, future-consumer trace
  targets, and source-input integrity passed.
- Created the input baseline, validation evidence, exact inspected-file record,
  command record, and created/changed-file record beneath
  `C:\Add-On\Lab\Evidence`.
- No SQL, API, synchronization, UI, or Visual PRO/5 implementation was
  generated or executed. No application, configuration, test-data, production,
  network, T8, printer, or external-system access occurred.

# 2026-07-27 — MIRROR-001A WorkOrder Description Contract Revision

- Used the completed PLATFORM-001A lineage investigation and approved
  MIRROR-001A business decision as the authority for Contract v1.1.
- Preserved Contract v1.0 byte-for-byte and created a separate
  `C:\Add-On\Lab\Canonical\Contracts\V1.1` contract set.
- Added exactly two direct canonical members:
  `WorkOrder.NonStockDescriptionLine1` and
  `WorkOrder.NonStockDescriptionLine2`.
- Reclassified `WorkOrder.ItemDescription` as a resolved field. For a
  nonblank `ItemNumber`, it resolves from the matching
  `InventoryItem.ItemDescription`. For a blank `ItemNumber`, no single
  resolved string is defined; the two non-stock lines remain separate and
  source ordered.
- Removed the direct WOE two-column mapping from
  `WorkOrder.ItemDescription`. No historical-snapshot, separator, or
  concatenation rule is claimed.
- Contract membership increased from 31 to 33; WorkOrder increased from 16 to
  18 fields. All 85 R0 exclusions, four RawDate policies, and the unscaled
  Decimal policy remain unchanged.
- Revised relationship DCR-008 to carry the approved InventoryItem resolution
  rule without adding a new relationship.
- Validation result: PASS. JSON, CSV, Markdown, catalogs, relationship data,
  and 118 traceability rows reconcile; v1.0 and all 34 governed inputs remain
  unchanged except this changelog's authorized append.
- No Visual PRO/5, mirror, reader specification, Add+ON, DLE-OS, SQL, API, UI,
  synchronization, production, network, T8, printer, or external-system
  operation occurred.
## 2026-07-27 — WORKORDER-DATE-002

- Added Canonical Contract v1.2 with derived `WorkOrderOpenedDateIso` and
  `WorkOrderClosedDateIso` fields while retaining both raw date members.
- Defined strict Add+ON date decoding, the 1995-through-snapshot-year century
  policy, null sentinel handling, and fail-closed validation.
- Kept the qualified historical v1.1 mirror package unchanged; the platform
  importer derives v1.2 ISO values locally during transactional import.
## 2026-07-27 — VPRO-LIVE-ACCESS-002

- Updated `C:\Add-On\AGENTS.md` to replace the blanket X: prohibition and
  mission-by-mission read exception with standing Level 2 read-only access.
- Preserved the permanent prohibition on live filesystem, record,
  configuration, dictionary, program, temporary, spool, log, and lock writes.
- Added repository policy and policy-change audit artifacts under
  `C:\DLE-OS\Repositories\DLE-OS`.

## 2026-07-28 — OPEN-ORDER-CANONICAL-VALIDATION-001

- Used the completed `OPEN-ORDER-FIELD-MAP-001` evidence without rerunning or
  retracing `OPR.SA` or `OPR.SB`.
- Validated all 22 Shared Concepts marked
  `SELECTED FOR OPEN ORDER VALIDATION`; operator selections remain selections
  and were not changed to approvals.
- Added validation-only columns N:T on the `Shared Concepts` worksheet for
  physical source, report use, canonical owner, reference status, recommended
  canonical name, recommendation, and reason.
- Recorded 6 `APPROVE SHARED CONCEPT`, 11
  `APPROVE WITH CLARIFICATION`, 1 `SUPPORTING DEPENDENCY ONLY`, and 4 `REJECT`
  recommendations. No selected concept was classified `DERIVED ONLY`.
- Confirmed Open Order export Order Date is `ARE-03A240 ORDER3 DATE` and export
  Ship Date is `ARE-13A140 EST SHP DATE`; rejected the selected `DueDate`,
  `OrderDate`, `OrderedDate`, and `ShipDate` groups for this report.
- Confirmed `ARE-13A210 QTY ORDERED` is the physical business fact and the
  report's Quantity Open label is an unchanged alias, not a proven open-quantity
  calculation.
- Verified the Complete Field Catalog's 414,068 semantic cells and all original
  Shared Concepts columns A:M remained unchanged.
- No Canonical Contract approval, SQL, API, UI, mirror, ERP, VPro5, or X: change
  was performed.

## 2026-07-28 — PLATFORM-002 Sales Orders Platform Viewer

- Qualified `ARE-03`, `ARE-13`, `ARM-01`, `ARM-10`, and `WOE-03` through two
  complete sequential Visual PRO/5 passes using only `MODE="O_RDONLY"` and
  fixed approved source paths. Source identity, length, timestamp, attributes,
  counts, ordered keys, raw-record fingerprints, and decoded-record
  fingerprints matched between passes.
- The qualification program and all generated output remained under
  `C:\Add-On\Lab\Platform002`; no file, record, lock, repair, report, or
  configuration write occurred under `X:\AON`.
- Built and promoted the isolated local Sales Order extension package under
  `C:\DLE-OS\Canonical\LiveMirror\Platform002\Current`. The historical mirror
  and the qualified four-entity live mirror remained unchanged.
- Applied the validated Sales Order extension transactionally only to
  `DLE_OS_CANONICAL_LIVE`, proved induced-failure rollback and same-package
  no-op behavior, and verified that `DLE_OS` and `DLE_OS_PLATFORM_LAB`
  remained unchanged.
- Added read-only live Sales Order API routes and the fifth Live Snapshot
  viewer section. Existing historical API and four-section Historical Test
  viewer behavior remain unchanged.
- Report parity passed for all 109 qualifying exported Sales Order lines with
  no unexplained mismatch. Intentional semantic corrections are documented:
  `QuantityOrdered` is not relabeled as Quantity Open, `QuantityShipped` is
  not fabricated, and `ExtendedPrice` is derived from full-precision values.
- The approved LIVE API publish passed. Final data-bearing browser acceptance
  remains pending because the elevated dedicated-identity launcher was
  canceled; the startup gate, exact-origin CORS policy, and least-privilege
  identity requirements were not weakened.

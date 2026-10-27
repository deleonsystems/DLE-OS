# SIM customer reference directory

The existing intake customer search now combines the two unchanged synthetic fixtures with a local, versioned reference directory. Question 2 shows matches while typing; Open customer list provides a separate searchable, paginated browser. Choices show only customer number and name. Number, name and alias searches remain supported. Names are not identities. Real references use their exact `dle-customer:<customerNumber>` source IDs; leading zeros remain significant.

## Persistence and isolation

Storage is `.sim-state/reference/customer-directory/`:

- `versions/<SHA256>.json`: immutable snapshot bytes, merged customer references and source package manifests/ledger hashes.
- `current.json`: atomic pointer to the active version, or `"none"`.
- `import.lock`: exclusive writer lock.

No upstream credentials, network client, background sync, SQL access or source folder traversal is added to normal SIM operation. The importer reads only explicitly supplied package ledger entries. Real reference data is gitignored through the existing `.sim-state/` rule. Do not commit packages, generated snapshots, screenshots containing customer data, or manifests into source control.

Existing scenario reset clears `data`, `documents`, `generated`, and `temp`; it leaves `reference` intact. This survival was tested with an isolated real `SimStateStore.ResetAsync`. Deleting the entire `.sim-state` directory manually would still remove the reference store. Include `reference` in future whole-state backups.

The two fixtures retain their IDs and numbers:
`SIM-CUSTOMER-ABBOTT` / `990100`; `SIM-CUSTOMER-E2E-001` / `990901`.
Number collisions with these fixtures, duplicate source keys, invalid IDs and changed content under an already known package ID are rejected.

Refresh merges explicitly supplied references and retains absent references with their earlier source provenance. It does not rewrite saved RFQs, orders, notes, attachments or any other business records. The picker saves optional `referenceVersion` and `sourcePackageId` on new real-reference selections; older records remain valid.

## Explicit import workflow

Build the local tool (no running-host build is needed):

```powershell
dotnet build Tools/SimRuntime/CustomerReferenceTool --nologo
```

Use the built `CustomerReferenceTool.dll` with these commands:

```text
status <local SIM repository>
preview <local SIM repository> <explicit package directory>
apply <local SIM repository> <same package directory> <expected current version or none>
activate <local SIM repository> <previous version or none> <expected current version>
```

Run `dotnet <tool DLL> <command> ...`; quote paths with spaces.

Preview verifies all declared file sizes/hashes and the fixed v1 customer contract, reports adds/updates/retained references and name/alias collision groups, and changes nothing. Review provenance, counts and collisions before applying. Apply repeats verification, acquires the local writer lock, checks the expected version and writes a content-addressed snapshot before atomically replacing the pointer. Reimporting a known identical package is a no-op. Failed activation may leave an unselected complete snapshot, never a partially active directory.

`activate` restores a retained snapshot atomically. `activate ... none ...` returns the picker to the two synthetic fixtures without deleting snapshots or changing any saved business record. Future imports and activation/rollback are read on each search and do not require a restart. Initial installation of the new backend does require a SIM-only restart.

This tool accepts the qualified `DLE_SIM_CUSTOMER_REFERENCE_PACKAGE_V1` manifest and `PASS_OPTIMISTIC_VERSION_BRACKETED` status. Hashes detect corruption; they are not a cryptographic signature establishing who supplied the package. Obtain packages through the approved handoff route.

## Freshness

The API and reference snapshots retain package capture time and the available Customer Master snapshot, Sales Orders/operations snapshot, and Invoice History activation dates. The streamlined picker and directory intentionally display only customer number and name; provenance is not removed from storage. These are source timestamps, not a promise of current ERP state. Business activity dates are not used as freshness. Original package limitations remain in the stored manifest.

## Verification

The focused C# tests generate only synthetic packages. Build outside the running host output:

```powershell
dotnet build Tests/SimCustomerReferences001 -p:UseAppHost=false -o <isolated build folder>
dotnet <isolated build folder>/SimAnalysis001.dll <new empty fixture directory>
```

Coverage includes repeat import, duplicate and fixture conflicts, invalid fields, changed package identity, missing/tampered files, expected-version conflicts, retained absent customers, rollback, injected pointer-write failure, offline reload and real isolated scenario reset.

The repository's `Tests/SimRfqIntakeWizard001/run-tests.ps1` uses its existing isolated-copy wrapper. Do not run destructive qualification directly against active SIM state.

Browser qualification must use a separate synthetic SIM fixture and test paging, aliases, fixture preservation, number/name-only results, modal dismissal, keyboard selection, selecting a real-reference-shaped fixture and saving/reopening its source version. Do not create a real RFQ merely to test installation.

## Developer promotion notes

Promote reviewed code and contracts, not `.sim-state` or customer packages. DEV already has a canonical customer directory and its own authentication; retain those providers. The reusable contracts are exact string identity, explicit reference provenance, pagination and collision handling. The SIM local provider/import tool must not replace DEV's canonical source or acquire upstream write privileges.

No annotations, work products or synthetic business records are exported to DEV. No customer maintenance UI, drawings integration, automatic HOST publisher, credential storage or permanent network dependency is introduced.

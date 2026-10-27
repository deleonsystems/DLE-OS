# Offline DEV integration candidate

This directory is an isolated executable candidate, not a deployment. It layers the
Intake, Technical Review, Library and RFQ workflows from checkpoint
`66251559a3b062020101956971b02b0adbf05829` onto the preserved DEV frontend baseline
`20260904T230955Z` / source `1742528024598b3bc25acc47fa5c4a98e9548782`.
Existing `Phase1Review/` is earlier design material and is not modified or used by
the executable projects.

## Deliberate source boundaries

- `baseline-source/` contains unchanged frontend C# inputs from the pinned DEV base.
  `frontend-host/Program.cs` is the separate reviewed host overlay: explicit inactive
  configuration guard, adapter registration/routing and conditional Home injection.
- `baseline-frontend/` is the unchanged 103-file public frontend snapshot, including
  five static image assets. It is never overlaid onto repository-root `SRC/`.
- `connected/domain/` contains explicit workflow overrides. Project exclusions
  replace only those checkpoint files; other workflow code is compiled from this
  repository. `connected/web/` is the separate incoming frontend candidate.
- `runtime/` compiles without `REHEARSAL`; fixture selectors are disabled.
  `auth-tests/` and `connected/` are separate synthetic test executables. Their
  admission routes and test users are not in the production host project.
- `connected/roles.json` describes three responsibility roles and synthetic persona
  equivalence. It contains no real employee numbers, account records or UserIds.
  The SQL proposal is review-only, defaults to refusal/rollback, and has not been
  executed against any database.

The baseline source/snapshot hashes are recorded in `baseline-provenance.json`.
Source preservation does not prove bitwise equivalence to the deployed binary or
replace staging regression testing.

## Reproduce the offline package

Requires Windows, an existing .NET 8 SDK, Node.js, an existing Python with the
previously qualified reportlab/pdfplumber dependencies, and a populated NuGet cache.
`NuGet.Config` disables remote feeds: no installer or dependency download is run.
The committed tree deliberately excludes compiled assemblies. Supply the exact
allowlisted public assemblies described by `shared-assemblies/manifest.json` from
an authorized local copy; this is an explicit reproducibility dependency.

From this directory, with absolute paths appropriate to the local machine:

```powershell
./package-tools/Prepare-AssemblyInputs.ps1 -AssemblyDirectory $qualifiedAssemblies
./package-tools/Build-OfflinePackage.ps1 -OutputDirectory "$PWD/packages/review" -PythonExecutable $python -NuGetPackages $nugetCache
./packages/review/Run-Qualification.ps1 -PythonExecutable $python
./run-connected.ps1 -PythonExecutable $python -NuGetPackages $nugetCache
./run-connected.ps1 -Supporting -PythonExecutable $python -NuGetPackages $nugetCache
node ./connected/roles-ui.test.mjs
node ./auth-tests/transport.test.mjs
```

The generator creates only synthetic PDF/XLS inputs. Package qualification uses
temporary loopback Kestrel listeners, synthetic users and ephemeral test protection
keys. It cleans its generated disposable directories. Broader domain test receipts
remain in ignored output directories for review. No live SQL, OIDC account, Windows
service registration, deployment script or browser upload is part of these commands.

## Security and activation limits

The BFF uses the existing cookie/current-user/antiforgery contracts. The backend
validates the trusted service identity and signed assertion, rereads active roles
by immutable UserId and rejects replayed write assertions. Workspace availability
is derived on the server. The three roles grant no technical approval, Kitting or
administrator rights. Existing SUPER_ADMIN behavior is preserved.

Executables require explicit activation settings; shipped templates are unset.
The runtime requires dedicated storage, a qualified Python hash, the separate
quoting audience and the existing integrated-security DEV user resolver. Missing
bindings fail closed. The configuration health route does not claim external
dependency readiness. Vendor sourcing remains unavailable until its exact approved
reference contract is supplied and qualified.

The preserved frontend release validator still requires a clean committed source
identity. This offline package does not produce valid activation metadata or install
anything. A reviewed commit alone does not authorize account grants, SQL migration,
storage/ACL/trust provisioning, real source binding, service startup or cutover.
Real HTTP.sys/Negotiate/OIDC/TLS and full browser acceptance remain external gates.
Draft PDFs and manual-send annotations do not constitute formal customer issuance.

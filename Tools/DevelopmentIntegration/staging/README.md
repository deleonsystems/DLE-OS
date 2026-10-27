# Quoting service staging review

No file in this directory executes installation, SQL, ACL changes, service actions,
or rollback. Review-Install.ps1 and Review-Rollback.ps1 consume an explicit JSON
observation and print a plan. Test-StagingPlan.ps1 tests synthetic observations;
these are not evidence of real machine state. There is deliberately no Execute switch.

## Fixed proposal

Service: DleOsDevelopmentQuoting, virtual identity NT SERVICE\DleOsDevelopmentQuoting,
Manual startup. Release/config root: C:\ProgramData\DLE-OS\DevelopmentQuotingService.
Data root: C:\ProgramData\DLE-OS\DevelopmentQuoting (only state and source writable).
The executable is QuotingRuntime.exe with --config <absolute path> --windows-service.
It must run under SCM and that exact identity; passing the flag from a console fails.
Framework WindowsServiceLifetime handles SCM start/stop. Content root is the immutable
executable directory. Shutdown drains admitted requests for at most 30 seconds;
new requests are refused after stopping begins. Failure exits nonzero. No event-log
source is automatically installed. The protected readiness route reports process
state, not successful live dependency qualification. Real SCM signals, stop timeout,
virtual-account network identity and HTTP.sys authentication remain staging tests.

Use 127.0.0.1:5060, superseding the older 5058 proposal. Neither is a committed
operating binding; no source contract pins 5058. A permitted TCP probe did not
confirm a listener on either port, but that is NOT proof of free HTTP.sys reservation
or exclusive future availability. Before registration, an authorized fresh inventory
must verify 5060 and its exact URL prefix are free; conflict means stop, not select a
new port automatically. Keep 5051/5052/5053/5054/5056/5057 and 5041-5043 untouched.

## Preconditions and boundaries

Pin final release artifact digest, file manifest and dirty-source digest. Validate
all ancestor paths are local, non-reparse, and administrator controlled. Refuse any
unknown existing service, nonmatching release, occupied prefix, or interrupted step
without an authoritative receipt. Each future mutation needs a before/after receipt;
repeat matching stopped registration is a no-op, uncertainty is never a blind retry.
The virtual account and URL reservation require future specific approval; no stored
password is proposed. Path B requires NO quoting SQL connection, login, user or grant.
Resolver-Grants.REVIEW.sql is retired and throws unconditionally. Unknown legacy SQL
settings are rejected, not silently ignored. The existing frontend continues its
established security database access; its local SQL encryption posture is inherited,
not repaired or certified by this change. No live SQL is performed by preparation.

Trust only the existing frontend service identity and dedicated quoting assertion
audience. Pin the matching ES256 public key hash; do not copy or rotate its private
key. Require approved reviewer UserIds, valid Library snapshot/hash, canonical customer
read access on 5052 and qualified Python path/hash/components. Vendor sourcing remains
unavailable without its approved reference. These live values stay unset in templates. The new authorizationEndpoint must be
the exact /internal/quoting/v1/authorization path on an approved existing frontend
loopback listener; no listener or reservation is added by this package. Both sides
require matching approved reviewer IDs. See PATH_B_TRUST.md for transport gates.

The preserved shared-assembly SQL client binary dependency uses cached Microsoft.Data.SqlClient 6.0.2, matching the original
security project. Its Windows runtime DLL SHA-256 is
6FD84BCAD321F66DBB6ED1DEDD9E5B77E21E195BD3C3DDFE6484E1CF8FA6BEBC, matching the deployed
release. A bare top-level DLL reference omitted runtime assets and was corrected.
Windows service hosting uses the existing cached Microsoft.Extensions.Hosting.WindowsServices
8.0.1. IdentityModel packages are coherently pinned to cached 7.7.3, as required by
SqlClient's dependency graph, rather than mixing the old 7.5.0 copied DLLs with 7.7.3
package references. This is a candidate-only dependency delta, not binary equivalence
to deployed IdentityModel; full OIDC acceptance remains required. The build verifies
cached package hashes in dependency-lock.json. Package file manifests include platform
assets and dependency files. No packages are downloaded or installed.

## Staged approval order

1. Review this source diff and exact package; checkpoint/publication remain separate.
2. Authorize exact setup only after preconditions have concrete verified values:
   stopped/manual service, immutable release/config, narrow storage/URL access,
   public trust and reference bindings. Leave frontend and activation disabled.
3. Separately authorize synthetic SCM/HTTP.sys staging start and real authenticated
   browser acceptance. Verify valid identity, stop/drain, failure/recovery and cleanup.
4. Separate governed 49.2 reconstruction and final frontend cutover require file
   provenance and approval; no customer issuance is implied by Draft PDF/manual send.

Data has no automatic purge. Proposed initial retention: preserve every evidence and
archive record pending an explicit retention policy; snapshot the complete stopped
data tree plus manifest to a separately approved protected backup destination before
any upgrade, and perform restore rehearsal before real 49.2 admission. Backup destination
is not yet selected. Rollback removes only an owned stopped registration/reservation
and preserves data, configuration, releases and receipts. It never blindly reopens
new-format records with an older executable or deletes shared roles/accounts/grants.

Ray's requested login is ray (employee 0004), Michelle michelle (0081), Adan adan (0088).
Provision via the existing editable Username UI only after separate account approval.
Do not use these human labels as immutable IDs. Capture the normal administration GET
projection before/after, without credential responses. Current Miguel SUPER_ADMIN
stays unchanged; second Miguel Jr. is deferred. No accounts are created by this package.

Path B transport: direct numeric loopback, proxies/cookies/redirects disabled; HTTP.sys callback requires exact DleOsDevelopmentQuoting name AND PrimarySid documented in PATH_B_TRUST.md. Probe success does not authorize registration. Quoting has no SQL grants or fallback. Rollback removes no business records or accounts.

## Source and activation metadata

Build-OfflinePackage.ps1 defaults to a dirty working-checkout build. It writes
schema-2 runtime-build-info.json and schema-1 frontend-manifest.json, but the
unchanged runtime validator rejects SourceDirty=true. Templates stay inactive.
For a clean build, first commit/review the packaging code, export that exact commit
with git archive outside its new extraction directory, and supply SourceArchive,
VerificationRepository, ExpectedCommit and ExpectedTree. The verification repository
is read through normal Git ownership checks; no trust exception is added. The archive
must match a fresh export of that commit/tree, and every extracted file must match.
Only the 12 hash-pinned external assemblies may be added before the build. Cached
NuGet dependencies are pinned separately; nothing is installed or downloaded.
Source and dependencies are checked again after compilation. New generated output
directories are explicitly enumerated; source overlays are never accepted as clean.

Runtime metadata binds the actual baseline frontend content, service identity,
commit and source digest. The package-wide manifest also covers quoting-assets,
dependency evidence and both runtime/frontend manifests. Publishing disables default
content globbing so old test result JSON cannot enter the payload. Test results belong
under fixtures after qualification, not in distributable executable directories.
Clean provenance does not authorize installation, change service bindings or imply
browser acceptance. While these packaging edits remain uncommitted, only dirty
candidate packages and isolated clean-provenance function tests are valid outcomes.

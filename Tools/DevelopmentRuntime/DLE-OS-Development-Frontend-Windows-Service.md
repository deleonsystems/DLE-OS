# DLE-OS Development Frontend Windows Service

## Decision and scope

The DEV frontend moves to the native SCM service `DleOsDevelopmentFrontend`. SCM launches `DleOs.DevelopmentFrontend.exe` directly as `DLE-OS-HOST\DLE-OS-DEV-FRONTEND`; the service creates no detached child.

This is DEV-only. Ports 5041/5042/5043/5052/5053/5054, LIVE, Keycloak metadata, production databases, Daniel state, and Git publication are immutable boundaries.

No WinRM, TrustedHosts, Basic authentication, or other remote-administration facility participates. The genuine workgroup machine boundary is handled by two local transactions.

## Actual rollback baseline

The working rollback runtime is not currently owned by a Scheduled Task. PID 24520 was launched at `2026-08-10T16:08:49Z` by `Start-DevelopmentFrontend.ps1` under `DLE-OS-HOST\DLE-OS`. The launching PowerShell/Scheduled Task action exited after its 30-second ownership window, leaving the `dotnet.exe` worker detached. The Scheduled Task itself is now absent, so this mechanism provides no durable automatic restart.

Before migration, the host transaction must rediscover rather than hard-code the PID and prove:

- exactly one frontend worker exists;
- its Windows owner is `DLE-OS-HOST\DLE-OS`;
- `5051-service-worker-launch.json` names that PID, identity, and a successful non-`AlreadyRunning` launch;
- the hash of `Start-DevelopmentFrontend.ps1` is captured;
- the Scheduled Task remains absent; and
- every HTTP.sys prefix attached to that worker is captured.

Rollback restores the captured binaries and runs that exact start script through `Start-Process -Credential DLE-OS-HOST\DLE-OS`. It then proves one DLE-OS-owned worker and the auth gateway registration. It does not create or restore a Scheduled Task.

## One-time secure handoff

`New-DleOsDevelopmentFrontendFileServerBootstrapRequest.ps1` runs on DLE-OS-HOST before either infrastructure transaction. It generates an RSA-3072 key pair through the Windows RSA/AES CSP and a transaction nonce. Only the public key is carried to DELEON-SERVER. The private parameters are protected with DPAPI CurrentUser and restricted to the originating user, Administrators, and SYSTEM.

DELEON-SERVER is Windows Server 2008 R2 with Windows PowerShell 2. Transaction A therefore runs as a .NET Framework 4 console executable with a `requireAdministrator` manifest; it does not require PowerShell, LocalAccounts, SmbShare, WinRM, or installed management modules. The transaction generates a 48-character password in memory and encrypts its byte representation with RSA-3072 OAEP through the legacy CSP (OAEP-SHA1, the OAEP mode natively available on this OS). The random password is never written or placed in a command line. HMAC-SHA256 remains the tamper-evidence mechanism for the complete canonical payload. The response includes:

- the encrypted password;
- the originating transaction ID, nonce, and request SHA-256;
- the exact account/share/path boundary;
- a SHA-256 payload digest;
- an HMAC-SHA256 evidence signature keyed by the one-time password; and
- a SHA-256 sidecar for the response file.

The host transaction decrypts the password using its DPAPI-protected private key, validates all bindings, checksum, and HMAC, converts it to a SecureString, and clears byte buffers. Simulation evidence is explicitly forbidden from authorizing migration.

## Transaction A: local DELEON-SERVER bootstrap

The sealed `DleOsLegacyFileServerBootstrap.exe bootstrap` transaction must run locally and elevated on `DELEON-SERVER`. The launcher propagates the executable's native nonzero failure code and pauses on failure.

Its preflight validates the request checksum/expiry, computer name, absent account and share ACE, and the exact existing Kitting paths. Only then it:

1. creates `DELEON-SERVER\DLE-OS-DEV-FRONTEND` through the legacy WinNT ADSI provider with the generated password;
2. removes it from every local group;
3. denies interactive and Remote Desktop logon;
4. adds one read-only `Production` share ACE through `Win32_LogicalShareSecuritySetting`, which is only the SMB share gate;
5. grants NTFS Read/Execute through .NET ACL APIs on `KITTING`, inherited Read/Execute only on `KIT-SHORTAGES` and `KIT-COMPLETE`; and
6. emits the encrypted, signed, checksummed response.

Effective access remains Kitting-only because unrelated Production paths receive no NTFS grant. The host preflight later proves both approved roots are enumerable and `Customer Files` is not.

If Transaction A fails after mutation, it immediately restores captured NTFS SDDL and the complete prior share DACL, removes its logon denies, and deletes its account. It also writes DPAPI LocalMachine-protected rollback state. `DleOsLegacyFileServerBootstrap.exe rollback` is the local-only rollback mode if the staged server boundary must be removed after a host failure.

## Transaction B: local DLE-OS-HOST migration

`Invoke-DleOsDevelopmentFrontendServiceMigration.ps1` runs locally and elevated on `DLE-OS-HOST`, after the response files are copied back.

Before mutation it:

1. validates and decrypts the one-time handoff;
2. proves the Kitting-only boundary over ordinary SMB using `DELEON-SERVER\DLE-OS-DEV-FRONTEND`;
3. validates the existing `DLE-OS-HOST\DLE-OS` credential directly for local SQL bootstrap and rollback only;
4. proves the dedicated host account, service, and DEV SQL principal are absent;
5. captures the actual detached-runtime baseline, URL ACL SDDL, SSL bindings, runtime binaries, protected PIDs, Git state, and filesystem ACLs; and
6. publishes the candidate into an isolated work directory.

After approval it:

1. creates `DLE-OS-HOST\DLE-OS-DEV-FRONTEND` with the decrypted matching password;
2. removes all local-group memberships, grants Log on as a service, and denies interactive/RDP logon;
3. creates only the approved `DLE_OS_SECURITY_DEV` login/user and SELECT/EXECUTE grants through the existing DLE-OS SQL bootstrap identity;
4. installs the service stopped, Automatic, with two bounded delayed recovery restarts;
5. applies Read/Execute to the release/repository and only exact read/traverse access to required key/secret files;
6. stops the captured detached worker and independently waits for all frontend processes, TCP 5051, and every captured HTTP.sys prefix to disappear;
7. transfers only the four approved DEV URL ACLs;
8. starts the service and proves its SCM PID is the only frontend process and owns all four registrations; and
9. validates DEV `/shared`, auth discovery, the 5051 path, 5052, 5054, Kitting access, and protected-port invariance.

The four service URL ACLs are:

- `http://dle-os-host:5051/`
- `http://192.168.0.105:5051/`
- `https://dev.dle-os.internal.dlemfg.com:443/`
- `https://auth.internal.dlemfg.com:443/`

SSL bindings remain unchanged; HTTP.sys owns certificate private-key use, so no application private-key ACL is added.

## Host rollback

Failure after host mutation independently attempts service removal, URL/filesystem ACL restoration, prior-runtime binary restoration, dedicated SQL-principal removal, account-right and account removal, the exact detached-runtime launch, and protected-port verification.

The DELEON-SERVER bootstrap is intentionally not controlled remotely. A host failure reports that the local file-server rollback is required if the service migration is abandoned. This is the only non-atomic boundary between the two machines.

After a successful migration, `Restore-DleOsDevelopmentFrontendDetachedRuntime.ps1` can consume the migration evidence to remove the service and restore the actual detached runtime. File-server cleanup, when authorized, remains a separate local DELEON-SERVER rollback.

## Future DEV deployment

`Deploy-DleOsDevelopmentFrontendWindowsService.ps1` refuses to run if the rejected Scheduled Task reappears. It stops SCM, confirms service/PID/TCP/prefix release, switches to a versioned release, validates singleton ownership, and restores the previous service ImagePath on failure.

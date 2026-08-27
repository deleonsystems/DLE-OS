# Production Assembly Drawing Desktop Access (DEV)

## Status

The qualified Windows desktop architecture is:

`Production View -> Edge extension -> Native Messaging -> ProgramData native host -> governed capability redemption -> Windows Explorer`

DEV qualification used work order `0115591` (`Meggitt / 6834-03 / Rev J`). Three true Microsoft Edge cold-start cycles opened the governed `REV J` folder without extension reload, registration repair, permission changes, or other intervention.

This record is DEV-only. It does not authorize a LIVE deployment.

## Decisions

- The browser custom-protocol path is not the primary desktop architecture. Direct Windows dispatch worked, but normal Edge did not reliably dispatch the custom scheme from Production View.
- Microsoft Edge Native Messaging is the qualified Windows bridge. The extension accepts only the fixed `open-drawing-folder` operation from the exact DEV origin.
- The native host is installed under `C:\ProgramData\DLE-OS\GovernedDesktopCapabilities\DEV\host`. A machine-scoped installation matches the machine-scoped Edge registration and survived three zero-process Edge restarts.
- Edge uses the exact HKLM 32-bit registration at `HKLM\Software\WOW6432Node\Microsoft\Edge\NativeMessagingHosts\com.dlemfg.dleos.dev.desktop_capabilities`. No HKLM 64-bit, Chrome, or Chromium fallback registration is part of the design.
- The earlier HKCU registration is not part of the final architecture. On this workstation, true Edge cold starts did not durably discover the user-profile AppData host through that arrangement.
- The extension ID is `gappmnmcjliadjleocigmndgalflgffd`; its only site scope is `https://dev.dle-os.internal.dlemfg.com/*`.
- The host is one-shot, non-elevated, and accepts a bounded Native Messaging frame. It cannot execute arbitrary commands or open arbitrary paths.
- The frontend issues an opaque, expiring, single-redemption capability. The native host redeems it through the same-host DEV endpoint and independently enforces the fixed Drawing-Prints root, traversal rejection, alternate-root rejection, directory existence, and reparse-point rejection.
- `Drawing-Prints` remains authoritative, read-only production information. This feature does not create, modify, move, rename, or delete its content.
- Kitting remains browser-based and unchanged. Browser document access and governed desktop capabilities are separate architecture boundaries.
- iPad support is intentionally deferred. A later iPadOS Files presentation may reuse the manufacturing identity and resolver contract, but it must not depend on Windows Explorer or Edge Native Messaging.

## Installation and recovery

Build/publish the native host into a governed staging directory, then run the installer through a normal elevated Miguel UAC session:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\GovernedDesktopCapabilities\Install-DleOsDevGovernedDesktopCapabilities.ps1" -PublishedHostPath "<qualified-publish-directory>"
```

The installer:

- copies the published host to ProgramData;
- creates a BOM-free manifest with the exact host name and extension origin;
- applies a protected ACL: SYSTEM and Administrators Full Control, Miguel Read & Execute;
- writes only the Edge HKLM 32-bit native-host registration;
- removes only the obsolete exact HKCU registration that could shadow HKLM; and
- reports SHA-256 values for installed files.

The Edge extension remains an unpacked DEV extension loaded from:

`C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\GovernedDesktopCapabilities\EdgeExtension`

After a browser or workstation recovery, verify the extension ID, enabled state, and exact DEV site permission before testing a governed work order.

## Rollback

### Edge extension

In `edge://extensions`, remove or disable only `DLE-OS Governed Desktop Capabilities (DEV)` with ID `gappmnmcjliadjleocigmndgalflgffd`. Do not reset Edge or alter unrelated extensions/policies.

### Machine-scoped native host

Run the installer with `-Unregister` through a normal elevated Miguel UAC session:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\GovernedDesktopCapabilities\Install-DleOsDevGovernedDesktopCapabilities.ps1" -Unregister
```

This removes only the exact HKLM 32-bit DEV host key and the ProgramData `DEV\host` package. It does not add an HKCU fallback, alter Edge policy, or touch Drawing-Prints.

The controlled qualification transaction also captured its exact pre-state in:

`C:\ProgramData\DLE-OS\GovernedDesktopCapabilities\DEV\evidence\programdata-native-host-transaction.json`

Use that evidence only if restoration of the former AppData/HKCU test arrangement is explicitly authorized. That arrangement is not the qualified steady state.

### Drawing-Prints directory-read ACL

The DELEON-SERVER ACL transaction is separately governed by:

- `Tools\DevelopmentRuntime\New-DleOsDrawingPrintsDirectoryReadPackage.ps1`
- `Tools\DevelopmentRuntime\Invoke-DleOsDrawingPrintsDirectoryReadTransaction.ps1`

Rollback must be run locally and elevated on DELEON-SERVER using the sealed transaction package's generated `Rollback-On-DELEON-SERVER.cmd` and its persistent evidence directory. Do not reconstruct or broaden the ACL manually. The transaction targets only `C:\Groups\Production\Drawing-Prints` and the exact `DELEON-SERVER\DLE-OS-DEV-FRONTEND` SID.

## Deprecated fallback

`Tools\DevelopmentRuntime\DrawingPrintsLauncher` contains the earlier `dle-drawing-prints://` proof. It is retained as deprecated fallback/evidence only. Production View must not depend on it, and it should be removed in a separate isolated cleanup after the Native Messaging architecture has an established release/recovery record.

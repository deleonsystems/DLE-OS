# PLATFORM-002 Unresolved Items

## 1. Dedicated LIVE API runtime relaunch

The approved publisher completed with PASS and deployed assembly SHA-256
`3868ED1F90FEE22078CC5FB6A6AE2EA75365A769DAAB1295AA5D3DCC89E5FB60`.
The prior qualified process on port 5042 was stopped after its owner was proven
as `DLE-OS-HOST\DLE-OS-LIVE-API`.

The separate approved launcher requires a Windows UAC-elevated operator token.
The UAC launch was canceled, so port 5042 is currently not listening. The
startup gate, dedicated identity, integrated authentication, SQL read-only
permissions, and exact-origin CORS were not weakened or bypassed.

Required operator action:

Run the approved launcher from an elevated PowerShell window:

`C:\DLE-OS\Repositories\DLE-OS-Server\DleOs.PlatformApi.Tests\Start-LiveCanonicalApiAsDedicatedIdentity.ps1`

Then complete live HTTP checks for readiness, list, detail, filters, pagination,
and CORS. SQL proves the endpoint's backing projection contains exactly 109
rows and the actual API identity can SELECT it while INSERT/UPDATE/DELETE are
denied.

No source, package, SQL, API code, or viewer-data blocker remains.

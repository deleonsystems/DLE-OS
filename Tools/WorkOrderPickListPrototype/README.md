# Work Order 0115621 pick-list prototype

Development-only, single-Work-Order prototype for `0115621` (`115621`). It does not support arbitrary Work Orders, edits, commitments, allocation, SQL persistence, or production deployment.

## Build the standalone report

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tools\WorkOrderPickListPrototype\Build-SingleWorkOrderPickListPrototype.ps1
```

The builder fails unless the qualified extraction contains exactly 100 source-ordered rows: 52 `COMPONENT`, 48 `MESSAGE`, and zero `UNRESOLVED`. It also validates sequences `026`, `027`, `030`, and `031`.

The output is written to:

```text
Artifacts\WorkOrderReleasedBom004\WORKORDER-RELEASED-BOM-004\index.html
```

## Optional local browser server

Build and run the repository-local static server when a browser does not permit direct `file:` navigation:

```powershell
dotnet build .\Tools\WorkOrderPickListPrototype\PrototypeServer\PrototypeServer.csproj -c Release -o .\Artifacts\WorkOrderReleasedBom004\WORKORDER-RELEASED-BOM-004\server-bin
.\Artifacts\WorkOrderReleasedBom004\WORKORDER-RELEASED-BOM-004\server-bin\PrototypeServer.exe
```

Open `http://127.0.0.1:8765/index.html`. Add `?print=1` for the print-friendly preview. The server is loopback-only and serves only the approved prototype artifact directory.

## Source boundary

`WOE22-0115621-ReadOnly-Cursor.src` fixes the target prefix to `01  0115621B`, opens only `X:\AON\ADATA\WOE-22` with `MODE="O_RDONLY"`, positions by the 12-byte prefix, retrieves each 15-byte key, and stops when the prefix changes. All generated reader output is directed to `C:\Add-On\Lab\WorkOrderReleasedBom004`.

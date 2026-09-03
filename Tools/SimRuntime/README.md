# DLE-OS SIM runtime

The SIM runtime provides the shared DLE-OS shell, its frozen isolation
boundary, deterministic synthetic personas, a disposable state/reset
foundation, read-only synthetic Operations Center, Invoice History,
Purchasing, Kitting, and Production slices, and one stateful Operations Center
Verified Status workflow. A small deterministic fault overlay can exercise
that workflow's failure boundaries without changing the normal business
contracts. The Home-backed Kitting path also provides one shared Kit ID label
preview and one local synthetic Kitted BOM PDF. It does not provide refresh
execution, other business writes, external integration, native Explorer, or
physical printing. Phase 13 adds an explicit, HTTPS-only private-LAN mode for
trusted mobile-device qualification; loopback remains the default.

From the repository root:

```powershell
& .\Tools\SimRuntime\Start-DleOsSim.ps1
```

Open `http://127.0.0.1:5177`. Press Ctrl+C in the starting terminal to stop.
An alternate non-governed local port may be selected with `-Port`.

LAN mode requires an assigned RFC1918 IPv4 address on a Windows `Private`
network profile, an exact DNS hostname, and a current exact-SAN certificate in
`LocalMachine\My` or `CurrentUser\My` whose private key is readable by the
developer. It never falls back to HTTP, a wildcard listener, or a certificate
warning bypass:

```powershell
& .\Tools\SimRuntime\Start-DleOsSim.ps1 -Lan `
  -LanAddress 192.168.0.105 `
  -LanHostName sim-miguel.dle-os.internal.dlemfg.com `
  -CertificateThumbprint <SIM_CERTIFICATE_THUMBPRINT>
```

The launcher prints the HTTPS URL and either a generated one-run access code
or a configured permanent-code status. A device must enter the SIM access code
before the shared shell or any SIM API is available. The secure, HttpOnly,
same-site session remains scoped to the running SIM process.
LAN mode accepts only the exact configured Host header, serves all data
same-origin, and binds only the stated private address. See
`Documentation/SIM_LAN_MODE.md` for the DNS, certificate, firewall, and VPN
boundary work.

The host serves the shared root document and the tracked `SRC` and `ASSETS`
trees directly. Runtime state is created automatically in the ignored,
per-clone `.sim-state` directory:

```text
.sim-state/
  runtime/    host process metadata
  state/      baseline scenario metadata and generation watermark
  data/       disposable SQLite business state
  documents/  resettable synthetic scenario documents
  generated/  future generated scenario artifacts
  logs/       local SIM logs and qualification output
  temp/       disposable reset staging
```

Scenario definitions remain tracked JSON, while Phase 6 materializes its
synthetic sales-order lines, work orders, line relationships, invoice history,
and authoritative Kitting material states into local
SQLite at `.sim-state/data/dle-os-sim.db`. The host uses
`Microsoft.Data.Sqlite`; it configures no external provider or connection.
The shared Operations Center reads the existing canonical sales-order,
work-order, and relationship routes with stable server paging and filters.
The complete governed read projections are embedded in the canonical SIM
records, so Operations Center does not probe external enrichment services.
Its existing Work Order Verified Status control reads and appends deterministic
local events using the normal DLE-OS contracts.

Verified Status events are append-only and store Work Order, previous and new
text, deterministic event identity/order/time, actor and persona, evidence,
request correlation, scenario, and generation. Status text follows the current
contract: trimmed, required, and at most 1,000 characters. Reusing a request
correlation ID returns the original event without appending a duplicate.
`operations-center.verified-status.write` is enforced server-side. Individual
line status writes remain unavailable in this phase.

The SIM panel also exposes these local, deterministic fault profiles:

- `verified-status-response-lost` commits the next valid, authorized Verified
  Status append exactly once, then returns an intentionally ambiguous `503`.
  Retrying with the same correlation ID returns the committed event without a
  duplicate.
- `verified-status-write-unavailable` persistently rejects valid, authorized
  Verified Status appends before ordinal allocation or commit. Removing the
  fault permits a clean retry with no sequence gap.
- `verified-status-read-unavailable` persistently rejects only Verified Status
  latest/history reads. Canonical Operations Center rows and unrelated modules
  remain available, while the shared UI explicitly labels status as
  unavailable instead of showing stale or absent data.
- `none` removes the overlay.

Fault state is in-memory and reports whether a profile is armed, triggered, or
consumed, along with its occurrence count. Normal persona authorization is
evaluated before a fault can trigger. Selecting or observing a fault does not
add a business capability, route traffic externally, or alter DEV behavior.

The shared Invoice History workspace reads its established canonical list,
detail, and metadata routes. Its 2026 month selection, broad local search, and
signed financial summaries operate on deterministic invoice-line records. A
narrow synthetic refresh-status response explains that refresh is unavailable;
the execution route always fails locally and never launches a worker.

The Home-backed Purchasing, Kitting, and Production workspaces reuse one
shared governed Kitting read model. Scenario version 5 gives Work Orders
`9700001`, `9700002`, and `9700003` deterministic Kit Complete, Kit Short,
and Needs Kitting states. Purchasing intentionally presents the current
buyer-facing Kit Short queue; Production presents Kit Complete and Kit Short
queues. Kitting Case reads are local and synthetic. Editing, leases, saves,
submissions, dispositions, receiving, and production transitions stay
unavailable.

Phase 11 enables the existing shared 4-by-4-inch Kit ID label template for an
actionable SIM Kitting Work Order. Its browser preview calls `window.print()`
only after the developer selects Print Kit ID; SIM never selects a printer or
contacts the Windows spooler. The QR area remains visibly `UNASSIGNED` because
the current template reserves that space but does not define a governed QR
payload. No production URL or identifier is fabricated.

WO `9700001` resolves a deterministic synthetic Kit Complete summary through
the existing `/api/development/kitting-documents/v1/work-orders/...` contract.
The tracked source PDF is copied to
`.sim-state/documents/KIT-COMPLETE/9700001.pdf` during startup and reset, and
is served same-origin with range support for the browser's native PDF viewer.
The endpoint requires `kitting.view`; missing and malformed references fail
locally without searching a share. The Production Assembly Drawing control was
not selected because its current contract resolves a native folder capability,
which remains intentionally unavailable in SIM. PDF.js/Tesseract CDN assets
are not required for these native browser previews and remain deferred.

Phase 12 qualifies the shared desktop shell and the Home, Operations Center,
Invoice History, Purchasing, Kitting, Production, Work Order Dashboard, Kit ID,
and Kit Complete PDF surfaces at 1440x900, 1280x800, 1024x768, and the current
768px compact-desktop threshold. The qualification uses the same shared HTML,
CSS, JavaScript, API contracts, and synthetic records as DEV; there is no SIM-
specific desktop stylesheet or parallel rendering path. Wide operational tables
remain intentionally contained by their workspace scrollers. The focused suite
guards the four-row shell, compact Invoice History layout, Production View
selector, and fixed-label long-value containment.

Use the `SIM` control in the application header to switch personas. Selection
is held in an opaque, in-memory browser session and resets to `SIM
Administrator` when the host restarts. Disabled-persona recovery remains
available in the authorization screen; no external login is involved.

The same `SIM` panel reports the built-in `baseline` scenario and its generation.
Reset requires two deliberate clicks. A successful reset atomically restores
scenario version 5/state version 1, resets deterministic clock/ID counters,
recreates only the SIM-owned `data`, `documents`, `generated`, and `temp`
directories, clears the fault overlay to `none`, increments generation, clears
all persona sessions, and reloads as `SIM Administrator`.

Browser cleanup is restricted to the current SIM origin and the repository-
evidenced keys `DLE_OS_API_CONFIG`, `DLE_OS_OPERATIONS_PROJECTION_V1`,
`DLE_OS_SHIPMENT_HISTORY_V1`, the session key prefix
`dle-os:kitting-released-bom:return:`, and IndexedDB database
`DLE_OS_SHIPMENT_STAGING_HANDLES`. Unrelated browser storage is never cleared.

Missing state is recreated automatically. Invalid or incompatible metadata is
reported explicitly and blocks business boundaries until the reset endpoint
rebuilds the baseline. Reset request UUIDs make retries idempotent for the life
of the host. Every distinct successful reset advances the durable generation.

The host is loopback-only and does not accept downstream URLs, SQL settings,
credentials, identity keys, worker execution settings, or DEV/LIVE runtime
configuration. Unknown `/api` routes return a local `501` contract rather than
being forwarded. Permission-mapped routes first enforce the selected synthetic
persona server-side.

Run the focused qualification suite with:

```powershell
& .\Tests\SimShellIsolation001\run-tests.ps1
& .\Tests\SimUiParity001\run-tests.ps1
& .\Tests\SimSyntheticIdentity001\run-tests.ps1
& .\Tests\SimStateReset001\run-tests.ps1
& .\Tests\SimOperationsCenter001\run-tests.ps1
& .\Tests\SimInvoiceHistory001\run-tests.ps1
& .\Tests\SimBroaderReadOnly001\run-tests.ps1
& .\Tests\SimVerifiedStatus001\run-tests.ps1
& .\Tests\SimWorkflowFailure001\run-tests.ps1
& .\Tests\SimDocumentsPrint001\run-tests.ps1
& .\Tests\SimDesktopVisual001\run-tests.ps1
& .\Tests\SimLanMode001\run-tests.ps1
```

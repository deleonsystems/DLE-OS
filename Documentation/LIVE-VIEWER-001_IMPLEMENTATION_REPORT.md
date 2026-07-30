# LIVE-VIEWER-001 — Implementation and Qualification Report

Date: 2026-07-27  
Verdict: **PASS**

## 1. Files changed

### DLE-OS frontend repository

- `DLE_Work_Center_v4.0.0.html`
- `SRC/api/dle-api-client.js`
- `SRC/modules/canonical-data-viewer/canonical-data-viewer.html`
- `SRC/modules/canonical-data-viewer/canonical-data-viewer.css`
- `SRC/modules/canonical-data-viewer/canonical-data-viewer.js`
- `Tests/LiveViewer001/run-live-viewer001-tests.mjs`
- `Tests/LiveViewer001/Run-HistoricalViewerRuntime.ps1`
- `Tests/LiveViewer001/Start-HistoricalViewerRuntime.ps1`
- `Tests/LiveViewer001/Capture-LiveRuntimeEvidence.ps1`

Qualification artifacts were written under `Artifacts/LiveViewer001`.

### DLE-OS server repository

- `Program.cs`
- `Options/LiveApiOptions.cs`
- `appsettings.Live.json`
- `appsettings.Live.Base.json`
- `DleOs.PlatformApi.Tests/Start-LiveCanonicalApiAsDedicatedIdentity.ps1`
- `DleOs.PlatformApi.Tests/Qualify-LiveApiHttp.ps1`
- `DleOs.PlatformApi.Tests/Qualify-LiveViewerCors.ps1`

No canonical data, mirror package, import, scheduler, service, or write route was changed.

## 2. Exact allowed browser origin

The only allowed browser origin is:

`http://DLE-OS-HOST:5041`

Browser origin serialization and the returned CORS header normalize the hostname to:

`http://dle-os-host:5041`

These are the same origin. Wildcard and arbitrary origins are not allowed.

## 3. Runtime and identity status

Both existing qualified runtimes were preserved.

| Runtime | Port | PID | Windows identity | Readiness | Log |
|---|---:|---:|---|---|---|
| Historical test API | 5041 | 31860 | `DLE-OS-HOST\DLE-OS` | Ready | `Artifacts/LiveViewer001/HistoricalRuntime/historical-api.log` |
| Live canonical API | 5042 | 30428 | `DLE-OS-HOST\DLE-OS-LIVE-API` | Ready | `C:\ProgramData\DLE-OS\LiveCanonicalApi\Logs\live-api.stdout.log` |

Both PIDs remain bound to their qualified ports. The live command line uses the approved published assembly with the `Live` environment. The live launch evidence and permission gate remain PASS.

Detached historical launch uses `Win32_Process.Create`, returns independently of the ASP.NET lifetime, and records PID, owner, port, readiness, log path, and launch disposition. It preserves an already-qualified listener rather than replacing it.

Evidence:

- `Artifacts/LiveViewer001/HistoricalRuntime/historical-runtime-evidence.json`
- `Artifacts/LiveViewer001/RuntimeEvidence/live-runtime-evidence.json`

## 4. Navigation and viewer boundary

The Platform workspace now contains two separate choices:

- Canonical Data Viewer — Test Data
- Canonical Data Viewer — Live Snapshot

The historical viewer remains the default and retains `/api/platform/v1/...`.

The live viewer uses an explicit client boundary fixed to `http://DLE-OS-HOST:5042/api/platform/live/v1/...`. There is no historical-to-live fallback and no direct browser access to SQL, `X:\AON`, mirrors, or backups.

## 5. Live metadata displayed

The live viewer displays:

- `LIVE SOURCE SNAPSHOT — READ ONLY`
- Data environment `LIVE`
- Database `DLE_OS_CANONICAL_LIVE`
- Contract version `1.1`
- Snapshot timestamp and age
- Freshness status
- Mirror run ID
- ImportRunId
- Package hash
- Four entity counts and total count

The viewer explicitly states that the snapshot is not real-time and exposes stale and unavailable states.

Verified identifiers:

- Mirror run ID: `LIVEMIRROR001-20260727T201259Z-43274A71`
- ImportRunId: `38e41174-6bbc-4a93-b1a4-153821d1d2c6`
- Package hash: `882EFDBD9E1ADC1CF37F346F8D5B9AA8692AB13C6365E13A3B10068E8ED75141`

## 6. Live counts verified

| Entity | API/viewer count |
|---|---:|
| BillOfMaterial | 1,290 |
| InventoryItem | 28,662 |
| WorkOrder | 12,113 |
| GeneralLedgerAccount | 257 |
| **Total** | **42,322** |

All four browser tabs and the live readiness/snapshot responses returned these exact values.

## 7. Search and pagination results

Browser qualification passed:

- `5` remained visible as typed and returned exact Work Order `0000005`.
- Full value `0000005` returned the same exact record.
- Nonnumeric `0000005x` returned no records; contains matching was not introduced.
- The 300 ms debounce, Search button, Enter, and Clear behavior passed.
- Direct page entry with Enter navigated to page 75.
- Previous and Next navigated 75 → 76 → 75.
- Entry below page 1 corrected to page 1.
- Entry above the last filtered page corrected to the last page.
- Active server-side filters and page size were preserved during page navigation.

During visual QA, a frontend selector collision was found and fixed: the viewer root used the same `data-canonical-profile` attribute as the two profile buttons. Delegated clicks therefore treated tabs, Clear, and pagination buttons as same-profile selections. The root state attribute is now `data-canonical-active-profile`, preserving the delegated event architecture.

## 8. Historical viewer regression

The historical viewer remained separate, Ready, and displayed exactly 26,902 records:

- BillOfMaterial: 523
- InventoryItem: 20,257
- WorkOrder: 5,868
- GeneralLedgerAccount: 254

No historical API route or database behavior was changed.

## 9. CORS qualification

Result: **5 passed, 0 failed**

- Exact-origin GET returned `Access-Control-Allow-Origin: http://dle-os-host:5041`.
- The disallowed `http://127.0.0.1:5041` probe received no CORS grant.
- Approved preflight allowed only GET and the `Accept` header.
- POST was not granted by the preflight method list.
- No wildcard origin was present.

Evidence: `Artifacts/LiveViewer001/CorsQualification/cors-qualification-results.json`

## 10. Automated, HTTP, and performance results

- LIVE-VIEWER-001 automated qualification: **13 passed, 0 failed**
- PLATFORM-003 regression qualification: **38 passed, 0 failed**
- JavaScript syntax check: **PASS**
- Prior LIVE-API-001 HTTP qualification: **13 passed, 0 failed**
- CORS HTTP qualification: **5 passed, 0 failed**

Live API latency sample from the qualified HTTP run:

- Samples: 43
- Minimum: 1.8164 ms
- Median: 10.5922 ms
- P95: 23.2899 ms
- Maximum: 55.881 ms
- Average: 13.1673 ms

Evidence:

- `Artifacts/LiveViewer001/AutomatedTests/qualification-results.json`
- `Artifacts/Platform003/Tests/qualification-results.json`
- `C:\DLE-OS\Repositories\DLE-OS-Server\Artifacts\LiveApi001\HttpQualification\http-qualification-results.json`

## 11. Visual QA and remaining blockers

Visual QA passed inside the existing DLE-OS shell at the qualified browser origin. The live warning is unavoidable, profile identity is clear, readiness and freshness are prominent, complete snapshot identifiers are available, all four entity tabs work, and the viewer remains read-only.

No technical blocker remains before user acceptance. No commit was created.

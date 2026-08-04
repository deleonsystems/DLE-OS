import json
import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]
REGISTRY_PATH = ROOT / "Tools/PlatformRefreshCenter/PlatformRefreshRegistry.json"
PROGRAM_PATH = ROOT / "Tools/LiveSnapshotRefresh/ControlHost/Program.cs"
CENTER_PATH = ROOT / "Tools/LiveSnapshotRefresh/ControlHost/PlatformRefreshCenter.cs"
CLIENT_PATH = ROOT / "SRC/api/dle-api-client.js"
HTML_PATH = ROOT / "SRC/modules/system-center/system-center.html"
JS_PATH = ROOT / "SRC/modules/system-center/system-center.js"
CSS_PATH = ROOT / "SRC/modules/system-center/system-center.css"

checks = []


def check(name, condition):
    checks.append((name, bool(condition)))


registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
datasets = registry["datasets"]
by_id = {item["datasetId"]: item for item in datasets}
program = PROGRAM_PATH.read_text(encoding="utf-8")
center = CENTER_PATH.read_text(encoding="utf-8")
client = CLIENT_PATH.read_text(encoding="utf-8")
html = HTML_PATH.read_text(encoding="utf-8")
javascript = JS_PATH.read_text(encoding="utf-8")
css = CSS_PATH.read_text(encoding="utf-8")

# Registry and model (1-20)
check("registry contract version", registry["contractVersion"] == "platform-refresh-center-v1")
check("registry version", registry["registryVersion"] == "1.1.0")
check("exact dataset count", len(datasets) == 12)
check("unique dataset IDs", len(by_id) == len(datasets))
check("all dataset IDs bounded", all(re.fullmatch(r"[a-z]+(?:-[a-z]+)*", item["datasetId"]) for item in datasets))
check("all visible", all(item["isEnabled"] for item in datasets))
check("all require authentication", all(item["requiresAuthentication"] for item in datasets))
check("all exact identity", all(item["authorizedIdentity"] == r"DLE-OS-HOST\DLE-OS" for item in datasets))
check("all source read only represented in service", 'MODE=\\"O_RDONLY\\"' in center)
check("all concurrency grouped", all(item["concurrencyGroup"] == "vpro-live-read" for item in datasets))
check("all status providers bounded", all(item["statusProvider"] for item in datasets))
check("all metadata providers bounded", all(item["currentImportMetadataProvider"].startswith("/api/platform/live/v1/") for item in datasets))
check("all refresh methods present", all(item["refreshMethod"] for item in datasets))
check("all capability values present", all(item["refreshCapability"] for item in datasets))
check("all operator messages present", all(item["operatorMessage"] for item in datasets))
check("all dependency arrays", all(isinstance(item["dependencies"], list) for item in datasets))
check("all source arrays", all(isinstance(item["authoritativeSources"], list) and item["authoritativeSources"] for item in datasets))
check("run order populated", all(isinstance(item["runOrder"], int) for item in datasets))
check("browser origin exact", registry["allowedBrowserOrigin"] == "http://dle-os-host:5041")
check("no wildcard origin", "*" not in registry["allowedBrowserOrigin"])

# Capability truthfulness (21-35)
core_ids = {
    "bill-of-material", "inventory-item", "work-order",
    "general-ledger-account",
}
check("four indivisible core members", sum(item["datasetId"] in core_ids for item in datasets) == 4)
check("core source check qualified", all(by_id[item]["supportsSourceCheck"] for item in core_ids))
check("core routine focused refresh disabled", all(not by_id[item]["supportsRoutineRefresh"] for item in core_ids))
check("core force full relationship", all(by_id[item]["supportsForceFull"] for item in core_ids))
check("sales order quiet window", by_id["sales-order"]["requiresQuietWindow"])
check("invoice routine refresh qualified", by_id["invoice-history"]["supportsRoutineRefresh"])
check("invoice method bounded overlap", by_id["invoice-history"]["refreshMethod"] == "BoundedOverlapUpsert")
check("invoice force full disabled", not by_id["invoice-history"]["supportsForceFull"])
check("customer master refresh enabled", by_id["customer-master"]["supportsRoutineRefresh"])
check("sales order focused refresh enabled", by_id["sales-order"]["supportsRoutineRefresh"])
check("vendor master refresh disabled", not by_id["vendor-master"]["supportsRoutineRefresh"])
check("purchase order refresh disabled", not by_id["purchase-order"]["supportsRoutineRefresh"])
check("receiving refresh disabled", not by_id["receiving-history"]["supportsRoutineRefresh"])
check("employee refresh disabled", not by_id["employee-reference"]["supportsRoutineRefresh"])
check("reference code refresh disabled", not by_id["reference-code"]["supportsRoutineRefresh"])
check("no reconciliation exposed", all(not item["supportsReconciliation"] for item in datasets))

# API/security/concurrency (36-54)
check("status route", '/api/platform/refresh-center/v1/status' in center)
check("dataset route", '/api/platform/refresh-center/v1/datasets/{datasetId}' in center)
check("runs route", '/api/platform/refresh-center/v1/runs' in center)
check("run detail route", '/api/platform/refresh-center/v1/runs/{runId}' in center)
check("source action route", '/check-source' in center)
check("refresh action route", '/refresh' in center)
check("reconcile action route", '/reconcile' in center)
check("force full route", '/api/platform/refresh-center/v1/core/force-full' in center)
check("all center routes authorized", center.count("RequireAuthorization(authorizationPolicy)") >= 8)
check("allowlisted launchers only", "StartAllowlistedLauncher" in center)
check("arbitrary command absent", "ProcessStartInfo(request" not in center)
check("arbitrary path absent", "FileName = request" not in center)
check("unsupported bounded response", '"RefreshNotImplemented"' in center)
check("shared source overlap gate", "AnyLiveSourceOperationRunning()" in center)
check("duplicate overlap response", '"already_running"' in center and '"ALREADY_RUNNING"' in center)
check("force full exact phrase", '"FORCE FULL ERP SNAPSHOT"' in center)
check("force full quiet window required", "request.QuietWindowReady != true" in center)
check("force full intent required", "request.ForceFullIntent != true" in center)
check("ordinary path uses normal launcher", "? NormalLauncher" in center)

# CORS, audit, and status isolation (55-66)
check("exact CORS origin", 'const string allowedOrigin = "http://dle-os-host:5041"' in program)
check("credentialed CORS", ".AllowCredentials()" in program)
check("content type bounded", '.WithHeaders("Accept", "Content-Type")' in program)
check("anonymous host allowed for challenge", "Authentication.AllowAnonymous = true" in program)
check("exact operator policy", 'const string authorizedOperator = @"DLE-OS-HOST\\DLE-OS"' in program)
check("provider failures isolated", "TryGetJsonAsync" in center and "return null" in center)
check("audit path bounded", r"PlatformRefreshCenter\refresh-runs.jsonl" in center)
check("audit identity", '["requestedBy"]' in center)
check("audit before identity", '["importRunIdBefore"]' in center)
check("audit after identity", '["importRunIdAfter"]' in center)
check("audit no credential field", "password" not in center.lower() and "credential" not in center.lower())
check("readiness v2 surfaced", '["sourceCheckReadiness"]' in center)

# Frontend (67-82)
check("refresh center location", 'id="platformRefreshCenterTitle"' in html)
check("not a canonical tab", "canonical-data-tab" not in html[html.index("PLATFORM REFRESH CENTER"):html.index("MASTER DATA DASHBOARD")])
check("status refresh action", "refreshPlatformRefreshCenter()" in html)
check("force full visually separate", "refresh-center-force-button" in html)
check("all datasets rendered dynamically", "renderPlatformRefreshDatasets" in javascript)
check("unsupported source disabled", "This action requires separate qualification." in javascript)
check("unsupported routine disabled", "Routine refresh is not qualified" in javascript)
check("reconcile disabled", "Reconciliation is not qualified" in javascript)
check("force full warning", "two complete WOE-03 passes" in javascript)
check("quiet window text", "quiet window is ready" in javascript)
check("prior snapshot text", "prior snapshot stays active" in javascript.lower())
check("exact typed confirmation", "FORCE FULL ERP SNAPSHOT" in javascript)
check("not color-only state", "${state}" in javascript and "stateReason" in javascript)
check("detail import ID", "importRunId" in javascript)
check("detail package hash", "packageHash" in javascript)
check("recent runs rendered", "renderPlatformRefreshRuns" in javascript)

# API client boundary (83-90)
check("client fixed control base", "http://DLE-OS-HOST:5043" in client)
check("client credentials include", "credentials: 'include'" in client)
check("client JSON body bounded", "JSON.stringify(options.body)" in client)
check("client status method", "getRefreshCenterStatus" in client)
check("client runs method", "getRefreshCenterRuns" in client)
check("client source check method", "checkRefreshCenterDatasetSource" in client)
check("client routine refresh method", "refreshRefreshCenterDataset" in client)
check("client force full method", "runRefreshCenterForceFull" in client)

failed = [name for name, passed in checks if not passed]
for name, passed in checks:
    print(f"{'PASS' if passed else 'FAIL'} | {name}")
print(f"TOTAL={len(checks)} PASS={len(checks) - len(failed)} FAIL={len(failed)}")
if failed:
    sys.exit(1)

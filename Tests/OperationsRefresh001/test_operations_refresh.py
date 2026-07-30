#!/usr/bin/env python3
"""Automated contract and safety qualification for OPERATIONS-REFRESH-001."""

from __future__ import annotations

import csv
import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "Tools/OperationsRefresh"
CONTROL = ROOT / "Tools/LiveSnapshotRefresh/ControlHost"
REGISTRY = json.loads(
    (ROOT / "Tools/PlatformRefreshCenter/PlatformRefreshRegistry.json")
    .read_text(encoding="utf-8"))
FRONTEND = (ROOT / "SRC/modules/system-center/system-center.js").read_text(
    encoding="utf-8")
HTML = (ROOT / "SRC/modules/system-center/system-center.html").read_text(
    encoding="utf-8")
CLIENT = (ROOT / "SRC/api/dle-api-client.js").read_text(encoding="utf-8")
COORDINATOR = (TOOLS / "Invoke-OperationsRefresh.ps1").read_text(
    encoding="utf-8")
CUSTOMER = (TOOLS / "Invoke-CustomerMasterRoutineRefresh.ps1").read_text(
    encoding="utf-8")
SALES = (TOOLS / "Invoke-OpenSalesOrderRoutineRefresh.ps1").read_text(
    encoding="utf-8")
EXTRACTOR = (TOOLS / "focused_sales_order_refresh.py").read_text(
    encoding="utf-8")
VPRO = (TOOLS / "VPro/OPEN_SALES_ORDER_BASE_QUALIFIER.src").read_text(
    encoding="ascii")
OPERATIONS_API = (CONTROL / "OperationsRefreshCenter.cs").read_text(
    encoding="utf-8")
PLATFORM_API = (CONTROL / "PlatformRefreshCenter.cs").read_text(
    encoding="utf-8")
SCHEDULE = json.loads(
    (TOOLS / "OperationsRefreshSchedule.json").read_text(encoding="utf-8"))

results: list[tuple[str, bool]] = []


def check(name: str, condition: bool) -> None:
    results.append((name, bool(condition)))
    if not condition:
        raise AssertionError(name)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


by_id = {item["datasetId"]: item for item in REGISTRY["datasets"]}
check("registry keeps twelve datasets", len(by_id) == 12)
check("registry contract unchanged", REGISTRY["contractVersion"] == "platform-refresh-center-v1")
check("registry version advanced", REGISTRY["registryVersion"] == "1.1.0")
check("operations contract registered", REGISTRY["operationsRefresh"]["contractVersion"] == "operations-refresh-v1")
check("operations dataset order", REGISTRY["operationsRefresh"]["datasets"] == ["customer-master", "sales-order", "invoice-history"])
check("customer routine enabled", by_id["customer-master"]["supportsRoutineRefresh"])
check("customer complete read", by_id["customer-master"]["refreshMethod"] == "CompleteMasterRead")
check("customer short duration", by_id["customer-master"]["estimatedDurationClass"] == "Short")
check("customer not force full", not by_id["customer-master"]["supportsForceFull"])
check("sales routine enabled", by_id["sales-order"]["supportsRoutineRefresh"])
check("sales focused method", by_id["sales-order"]["refreshMethod"] == "OpenTransactionRefresh")
check("sales quiet window", by_id["sales-order"]["requiresQuietWindow"])
check("sales retains force full separately", by_id["sales-order"]["supportsForceFull"])
check("sales exact five sources", by_id["sales-order"]["authoritativeSources"] == ["ARE-03", "ARE-13", "ARM-01", "ARM-10", "WOE-03"])
check("invoice routine remains enabled", by_id["invoice-history"]["supportsRoutineRefresh"])
check("invoice 45 day method remains", by_id["invoice-history"]["refreshMethod"] == "BoundedOverlapUpsert")

check("coordinator exact order", COORDINATOR.index("'customer-master'") < COORDINATOR.index("'sales-order'") < COORDINATOR.index("'invoice-history'"))
check("coordinator global lock", "operations-refresh.lock" in COORDINATOR)
check("coordinator scheduled trigger", "'Manual', 'Scheduled'" in COORDINATOR)
check("coordinator Pacific timezone", "Pacific Standard Time" in COORDINATOR)
check("coordinator weekday guard", "Saturday" in COORDINATOR and "Sunday" in COORDINATOR)
check("coordinator 0430 cutoff", "FromHours(4.5)" in COORDINATOR)
check("coordinator missed window", "MissedQuietWindow" in COORDINATOR)
check("coordinator manual acknowledgement", "QuietWindowReady" in COORDINATOR)
check("coordinator partial success", "'PartialSuccess'" in COORDINATOR)
check("coordinator no changes", "'NoSourceChanges'" in COORDINATOR)
check("coordinator prior retention", "PriorDataRetained" in COORDINATOR)
check("coordinator append audit", "runs.jsonl" in COORDINATOR)
check(
    "coordinator nullable completion safe",
    "$null -ne $CompletedAt" in COORDINATOR
    and "$CompletedAt.HasValue" not in COORDINATOR,
)
check(
    "coordinator import ID scalar",
    "$afterImportRunId = @(" in COORDINATOR
    and "AfterImportRunId = $afterImportRunId" in COORDINATOR,
)
check("coordinator no force full", "ForceFullExtraction" not in COORDINATOR)
check("coordinator no arbitrary path input", "SourcePath" not in COORDINATOR)

check("customer exact identity", "DLE-OS-HOST\\DLE-OS" in CUSTOMER)
check("customer rejects elevation", "Administrator" in CUSTOMER)
check("customer lock", "customer-master-refresh.lock" in CUSTOMER)
check("customer fixed qualifier", "Invoke-CustomerMasterSourceQualification.ps1" in CUSTOMER)
check("customer candidate compare", "compare_packages.py" in CUSTOMER)
check("customer no-op", "NO_SOURCE_CHANGES" in CUSTOMER)
check("customer induced rollback", "QualificationInduceFailure" in CUSTOMER)
check("customer current previous", "$current" in CUSTOMER and "$previous" in CUSTOMER)
check("customer zero writes evidence", "SourceWrites = 0" in CUSTOMER)
check("customer zero locks evidence", "SourceLocksRequested = 0" in CUSTOMER)

check("sales exact identity", "DLE-OS-HOST\\DLE-OS" in SALES)
check("sales rejects elevation", "Administrator" in SALES)
check("sales lock", "open-sales-order-refresh.lock" in SALES)
check("sales candidate compare", "compare_packages.py" in SALES)
check("sales no-op", "NO_SOURCE_CHANGES" in SALES)
check("sales induced rollback", "QualificationInduceFailure" in SALES)
check("sales rollback restores current", "Move-Item -LiteralPath $rollback -Destination $current" in SALES)
check("sales zero writes evidence", "SourceWrites = 0" in SALES)
check("sales zero locks evidence", "SourceLocksRequested = 0" in SALES)
check("sales no core runner", "Invoke-LiveSnapshotRefresh" not in SALES)
check("sales no force full switch", "ForceFullExtraction" not in SALES)

for source in ("ARE-03", "ARE-13", "ARM-01", "ARM-10"):
    check(f"{source} O_RDONLY fixed source", f'X:\\AON\\ADATA\\{source}' in VPRO)
check("base VPro explicit O_RDONLY", 'MODE="O_RDONLY"' in VPRO)
for prohibited in ("WRITE RECORD", "INITFILE", "ERASE", "REMOVE", "EXTRACT"):
    check(f"base VPro excludes {prohibited}", prohibited not in VPRO.upper())
check("WOE exact fixed source", r"X:\\AON\\ADATA\\WOE-03" in EXTRACTOR)
check("WOE bounded prefix length", "len(prefix) != 19" in EXTRACTOR)
check("WOE indexed seek", 'READ (10,KEY=P$[X]' in EXTRACTOR)
check("WOE prefix verification", 'K$(1,19)<>P$[X]' in EXTRACTOR)
check("WOE zero complete scans evidence", '"woe03CompleteScans": 0' in EXTRACTOR)
check("source identity before after", "before = identity()" in EXTRACTOR and "after = identity()" in EXTRACTOR)
check("source identity fail closed", 'raise RuntimeError("source identity changed' in EXTRACTOR)
check("extractor exact run root", "run_root.parent != RUNS.resolve()" in EXTRACTOR)
check("extractor rejects admin", "IsUserAnAdmin" in EXTRACTOR)

check("schedule Monday Friday", SCHEDULE["days"] == ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
check("schedule 2am", SCHEDULE["startLocalTime"] == "02:00:00")
check("schedule Pacific", SCHEDULE["timeZone"] == "America/Los_Angeles")
check("schedule cutoff", SCHEDULE["approvedQuietWindow"]["latestAutomaticStartLocalTime"] == "04:30:00")
check("schedule interactive token", SCHEDULE["logonType"] == "InteractiveToken")
check("schedule limited", SCHEDULE["runLevel"] == "Limited")
check("schedule no credential", not SCHEDULE["storesCredentials"])
check("schedule no start when available", not SCHEDULE["startWhenAvailable"])
check("schedule duplicate ignore", SCHEDULE["multipleInstances"] == "IgnoreNew")
check("schedule fixed launcher", SCHEDULE["launcher"].endswith("Start-ScheduledOperationsRefresh.cmd"))

check("operations GET status", "/api/platform/operations-refresh/v1/status" in OPERATIONS_API)
check("operations GET runs", "/api/platform/operations-refresh/v1/runs" in OPERATIONS_API)
check("operations POST run", "/api/platform/operations-refresh/v1/run" in OPERATIONS_API)
check("operations GET schedule", "/api/platform/operations-refresh/v1/schedule" in OPERATIONS_API)
check(
    "operations schedule parses task state only",
    '"Scheduled Task State:"' in OPERATIONS_API
    and "line.EndsWith(" in OPERATIONS_API,
)
check("operations enable route", "/schedule/enable" in OPERATIONS_API)
check("operations disable route", "/schedule/disable" in OPERATIONS_API)
check("operations auth on routes", ".RequireAuthorization(policy)" in OPERATIONS_API)
check("operations fixed launcher only", "Start-OperationsRefresh.cmd" in OPERATIONS_API)
check("operations no request path field", "Path" not in "OperationsRunRequest")
check("platform routine allowlist exact", '"customer-master" or "sales-order"' in PLATFORM_API)
check("platform global operations concurrency", "OperationsStatePath" in PLATFORM_API)

check("frontend Operations card", 'id="operationsRefreshTitle"' in HTML)
check(
    "frontend coordinated status accepts retained evidence casing",
    "status.OverallState" in FRONTEND
    and "status.StepResults" in FRONTEND,
)
check(
    "frontend coordinated run ID visible",
    "status.OperationsRefreshRunId" in FRONTEND
    and "<span>Run ID</span>" in FRONTEND,
)
check("frontend coordinated button", "Refresh Operations" in HTML)
check("frontend schedule toggle", "operationsRefreshScheduleToggle" in HTML)
check("frontend customer button generated", "supportsRoutineRefresh" in FRONTEND)
check("frontend Sales prompt says not force full", "not the force-full Core ERP qualification" in FRONTEND)
check("frontend 45-day wording retained", "45-day overlapping Invoice History" in FRONTEND)
check("frontend separate force full", "runPlatformForceFullRefresh" in FRONTEND)
check("frontend operations API status", "getOperationsRefreshStatus" in CLIENT)
check("frontend operations API run", "runOperationsRefresh" in CLIENT)
check("frontend schedule API", "setOperationsRefreshScheduleEnabled" in CLIENT)
check("frontend credentials boundary reused", "requestLiveSnapshotRefresh" in CLIENT)

with tempfile.TemporaryDirectory() as temp:
    temp_root = Path(temp)
    current = temp_root / "current"
    candidate = temp_root / "candidate"
    fields = ["FirmId", "CustomerNumber", "CustomerName"]
    address_fields = ["FirmId", "CustomerNumber", "AddressCode", "AddressName"]
    baseline_customer = [{"FirmId": "01", "CustomerNumber": "001148", "CustomerName": "A"}]
    baseline_address = [{"FirmId": "01", "CustomerNumber": "001148", "AddressCode": "000", "AddressName": "A"}]
    for root in (current, candidate):
        write_csv(root / "Customer.csv", fields, baseline_customer)
        write_csv(root / "CustomerAddress.csv", address_fields, baseline_address)
    python = Path(
        r"C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime"
        r"\dependencies\python\python.exe")
    command = [
        str(python), str(TOOLS / "compare_packages.py"),
        "--dataset", "customer", "--candidate", str(candidate),
        "--current", str(current)]
    same = json.loads(subprocess.check_output(command, text=True))
    check("package identical no-op", same["result"] == "NO_SOURCE_CHANGES")
    check("package identical unchanged count", same["unchanged"] == 2)
    write_csv(candidate / "Customer.csv", fields, [
        {"FirmId": "01", "CustomerNumber": "001148", "CustomerName": "B"},
        {"FirmId": "01", "CustomerNumber": "001149", "CustomerName": "C"}])
    changed = json.loads(subprocess.check_output(command, text=True))
    check("package detects insert", changed["inserted"] == 1)
    check("package detects update", changed["updated"] == 1)
    check("package preserves address unchanged", changed["unchanged"] == 1)
    write_csv(candidate / "Customer.csv", fields, [])
    missing = json.loads(subprocess.check_output(command, text=True))
    check("package detects missing", missing["missing"] == 1)
    write_csv(candidate / "Customer.csv", fields, baseline_customer * 2)
    duplicate = subprocess.run(command, text=True, capture_output=True)
    check("package rejects duplicate key", duplicate.returncode != 0)

print(json.dumps({
    "verdict": "PASS",
    "passed": len(results),
    "failed": 0,
    "tests": [name for name, _ in results],
}, indent=2))

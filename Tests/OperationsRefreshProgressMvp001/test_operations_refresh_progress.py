#!/usr/bin/env python3
"""Focused static contract tests for OPERATIONS-REFRESH-PROGRESS-MVP-001."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
COORDINATOR = (
    ROOT / "Tools/OperationsRefresh/Invoke-OperationsRefresh.ps1"
).read_text(encoding="utf-8")
CUSTOMER = (
    ROOT / "Tools/OperationsRefresh/Invoke-CustomerMasterRoutineRefresh.ps1"
).read_text(encoding="utf-8")
SALES = (
    ROOT / "Tools/OperationsRefresh/Invoke-OpenSalesOrderRoutineRefresh.ps1"
).read_text(encoding="utf-8")
EXTRACTOR = (
    ROOT / "Tools/OperationsRefresh/focused_sales_order_refresh.py"
).read_text(encoding="utf-8")
INVOICE = (
    ROOT / "Tools/InvoiceHistory/Invoke-InvoiceHistoryRefresh.ps1"
).read_text(encoding="utf-8")
API = (
    ROOT / "Tools/LiveSnapshotRefresh/ControlHost/OperationsRefreshCenter.cs"
).read_text(encoding="utf-8")
UI = (
    ROOT / "SRC/modules/system-center/system-center.js"
).read_text(encoding="utf-8")
HTML = (ROOT / "DLE_Work_Center_v4.0.0.html").read_text(encoding="utf-8")


def require(label: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(label)
    print(f"PASS {label}")


fields = (
    "OperationsRefreshRunId", "OverallStatus", "CurrentStepNumber",
    "TotalSteps", "CurrentDataset", "CurrentPhase", "RecordsProcessed",
    "RecordsExpected", "StartedAt", "LastProgressAt", "ElapsedSeconds",
    "LastCompletedRunDurationSeconds", "StepResults",
)
require("small status contract", all(field in COORDINATOR for field in fields))
require("three fixed steps", "TotalSteps = $steps.Count" in COORDINATOR)
require("step one phases", all(value in CUSTOMER for value in (
    "Reading Customers", "Comparing Customers", "Updating Customer Master",
    "Complete")))
require("step two phases", all(value in SALES + EXTRACTOR for value in (
    "Reading Open Orders", "Reading Open Order Lines",
    "Resolving Work Orders", "Comparing Sales Orders",
    "Updating Sales Orders", "Complete")))
require("step three phases", all(value in INVOICE for value in (
    "Reading 45-Day Window", "Comparing Invoice History",
    "Updating Invoice History", "Complete")))
require("processed counts emitted", "RecordsProcessed" in CUSTOMER + SALES + INVOICE)
require("expected counts emitted", "RecordsExpected" in CUSTOMER + SALES + INVOICE)
require("unknown counts remain nullable", "$recordsExpected = $null" in COORDINATOR)
require("API merges active child status", "EnrichActiveProgress" in API)
require("API computes live elapsed seconds", 'current["ElapsedSeconds"]' in API)
require("API reads fixed child paths", "StepStatusPaths" in API)
require("sales progress preserves run identity", "status run identity mismatch" in EXTRACTOR)
require("sales progress is local only", 'STATUS = ROOT / "State/status.json"' in EXTRACTOR)
require("browser polls every three seconds", "OPERATIONS_REFRESH_POLL_INTERVAL_MS = 3000" in UI)
require("polling stops after completion", "scheduleOperationsRefreshPoll(running)" in UI)
require("reload requests current status", "refreshOperationsRefreshStatus()" in UI)
require("elapsed display", "formatOperationsRefreshDuration(elapsedSeconds)" in UI)
require("last progress display", "formatOperationsRefreshAge(lastProgressAt)" in UI)
require("last completed duration display", "LastCompletedRunDurationSeconds" in UI)
require("completed results remain visible", "completedByDataset" in UI)
require("coordinator failure is terminal", "Write-OperationsStatus 'Failed'" in COORDINATOR)
require("prior duration ignores nonterminal audit records", "'PartialSuccess', 'Failed'" in COORDINATOR)
require("prior duration tolerates legacy timestamp casing", all(value in COORDINATOR for value in (
    "PSObject.Properties['StartedAt']", "PSObject.Properties['StartedAtUtc']",
    "PSObject.Properties['CompletedAt']", "PSObject.Properties['CompletedAtUtc']")))
require("all three waiting/running rows", "Recent Invoice / Shipment History" in UI)
require("no invented percentage display", "progressPercentage" not in UI)
require("no cancellation", "cancelOperationsRefresh" not in UI + API + COORDINATOR)
require("no event subsystem", all(value not in UI + API for value in (
    "WebSocket", "EventSource", "text/event-stream")))
require("button behavior unchanged", "runOperationsRefresh()" in UI)
require("schedule behavior retained", "'Manual', 'Scheduled'" in COORDINATOR)
require("authentication retained", ".RequireAuthorization(policy)" in API)
require("CORS unchanged by MVP", "AllowAnyOrigin" not in API)
require("source safety retained", all(value in CUSTOMER + SALES + INVOICE for value in (
    "SourceWrites = 0", "SourceLocksRequested = 0")))
require("no new source pass", "ForceFullExtraction" not in COORDINATOR + CUSTOMER + SALES)
require("frontend cache advanced", "system-center.js?v=20260730-02" in HTML)

print("PASS: OPERATIONS-REFRESH-PROGRESS-MVP-001 focused tests")

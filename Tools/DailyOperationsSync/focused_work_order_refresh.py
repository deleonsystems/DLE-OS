#!/usr/bin/env python3
"""Extract WOE-01 read-only and build a governed Work Order candidate."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import os
from datetime import date, datetime, timezone
from pathlib import Path

REPO = Path(r"C:\DLE-OS\Repositories\DLE-OS")
ROOT = Path(r"C:\DLE-OS\Canonical\DailyOperationsSync\Runs")
SOURCE_ROOT = Path(r"\\deleon-server\Add-ON\AON\ADATA")
SOURCE = SOURCE_ROOT / "WOE-01"
CURRENT = Path(r"C:\DLE-OS\Canonical\LiveMirror\Current")
TEMPLATE = REPO / "Tools/DailyOperationsSync/VPro/FOCUSED_WORK_ORDER_READER.src"
COMPILER = Path(r"C:\BASIS\VPRO5\pro5cpl.exe")
VPRO = Path(r"C:\BASIS\VPRO5\vpro5.exe")
RUN_RE = re.compile(r"^DAILYOPSSYNC-\d{8}T\d{6}Z-[A-F0-9]{8}$")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def text(row: dict[str, str], name: str) -> str:
    return bytes.fromhex(row[name]).decode("latin-1")


def addon_date(raw: str) -> str | None:
    if raw == "202020":
        return None
    data = bytes.fromhex(raw)
    yy, month, day = ((value - 0x20) % 100 for value in data)
    years = [year for year in range(1995, datetime.now(timezone.utc).year + 1)
             if year % 100 == yy]
    if len(years) != 1:
        raise ValueError(f"ambiguous VPro date {raw}")
    return date(years[0], month, day).isoformat()


def identity() -> dict[str, object]:
    stat = SOURCE.stat()
    return {"path": str(SOURCE), "length": stat.st_size,
            "lastWriteTimeNs": stat.st_mtime_ns}


def main() -> int:
    lease = Path(r"C:\ProgramData\DLE-OS\SyncOperations\lease.json")
    if lease.exists():
        owner = json.loads(lease.read_text(encoding="utf-8-sig")).get("RunId", "")
        if owner != os.environ.get("DLE_OS_SYNC_OPERATIONS_RUN_ID", ""):
            raise RuntimeError(f"ALREADY_RUNNING: Sync Operations {owner} owns the lease")
    parser = argparse.ArgumentParser()
    parser.add_argument("--sync-run-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not RUN_RE.fullmatch(args.sync_run_id):
        raise ValueError("daily synchronization run ID was rejected")
    output = args.output.resolve()
    expected_parent = (ROOT / args.sync_run_id / "Candidates").resolve()
    if output.parent != expected_parent or output.name != "WorkOrders":
        raise ValueError("Work Order candidate path is outside the fixed run boundary")
    for path in (SOURCE, CURRENT, TEMPLATE, COMPILER, VPRO):
        if not path.exists():
            raise FileNotFoundError(path)

    runtime = output / "Runtime"
    program = output / "Program"
    compile_root = output / "Compile"
    canonical = output / "Canonical"
    for path in (runtime, program, compile_root, canonical):
        path.mkdir(parents=True, exist_ok=False)
    raw = runtime / "WOE01_RUNTIME_RAW.csv"
    failure = runtime / "WOE01_RUNTIME_FAILURE.txt"
    source = compile_root / "FOCUSED_WORK_ORDER_READER.src"
    source.write_text(
        TEMPLATE.read_text(encoding="ascii")
        .replace(r"X:\AON\ADATA", str(SOURCE_ROOT))
        .replace("__RUN_ID__", args.sync_run_id)
        .replace("__OUTPUT__", str(raw))
        .replace("__FAILURE__", str(failure)), encoding="ascii")
    config = program / "configSYNC001.aon"
    config.write_text(
        "ALIASES=4\nFCBS=64\nCIBS=64\nSTBLEN=12000\n"
        f"PREFIX {str(program).replace(chr(92), '/')}/ C:/BASIS/VPRO5/\n"
        "SETOPTS 0000000000000000\nALIAS T0 SYSWINDOW \"\"\n", encoding="ascii")
    before = identity()
    subprocess.run([str(COMPILER), f"-d{program}", str(source)], check=True,
                   cwd=program, timeout=120)
    compiled = program / source.name
    executable = program / source.stem
    if compiled.is_file() and not executable.exists():
        compiled.replace(executable)
    if not executable.is_file():
        raise RuntimeError("focused Work Order compiler output is absent")
    with (output / "vpro.stdout.log").open("wb") as stdout, \
            (output / "vpro.stderr.log").open("wb") as stderr:
        subprocess.run([str(VPRO), "-tT0", "-nT0", "-m1024", f"-c{config}",
                        str(executable)], check=True, cwd=program, timeout=900,
                       stdout=stdout, stderr=stderr)
    if failure.exists():
        raise RuntimeError(
            "focused Work Order reader failed: "
            + failure.read_text(encoding="latin-1").strip())
    after = identity()
    if before != after:
        raise RuntimeError("WOE-01 changed during focused extraction")

    inventory: dict[str, dict[str, str]] = {}
    with (CURRENT / "Canonical/InventoryItem.csv").open(
            newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            inventory[row["ItemNumber"].strip()] = row

    rows: list[dict[str, str | None]] = []
    keys: set[str] = set()
    with raw.open(newline="", encoding="utf-8-sig") as handle:
        for record in csv.DictReader(handle):
            key = bytes.fromhex(record["source_key_raw"]).decode("latin-1")
            if key in keys:
                raise ValueError(f"duplicate WOE-01 key {key!r}")
            keys.add(key)
            item = text(record, "woe_01a190_item_number")
            inventory_row = inventory.get(item.strip())
            if item.strip() and inventory_row is None:
                raise ValueError(f"Work Order item is absent from governed inventory: {item!r}")
            opened = record["woe_01a070_opened_date_raw_hex"].upper()
            closed = record["woe_01a120_closed_date_raw_hex"].upper()
            rows.append({
                "SourceKeyRaw": key,
                "SourceRecordHash": hashlib.sha256(
                    record["record_raw_material"].encode("ascii")).hexdigest().upper(),
                "ContractVersion": "V1.2",
                "WorkOrderNumber": text(record, "woe_01a030_wo_number"),
                "WorkOrderType": text(record, "woe_01a040_wo_type"),
                "WorkOrderStatus": text(record, "woe_01a060_wo_status"),
                "WorkOrderOpenedDate": opened,
                "WorkOrderClosedDate": closed,
                "WorkOrderOpenedDateIso": addon_date(opened),
                "WorkOrderClosedDateIso": addon_date(closed),
                "CustomerNumber": text(record, "woe_01a130_customer_nbr"),
                "SalesOrderNumber": text(record, "woe_01a140_order_number"),
                "SalesOrderLineNumber": text(record, "woe_01a150_line_number"),
                "UnitOfMeasure": text(record, "woe_01a160_unit_measure"),
                "BomRevision": text(record, "woe_01a170_bill_rev"),
                "WarehouseId": text(record, "woe_01a180_warehouse_id"),
                "ItemNumber": item,
                "ItemDescription": (
                    inventory_row["ItemDescription"] if inventory_row else None),
                "DrawingNumber": text(record, "woe_01a210_drawing_nbr"),
                "DrawingRevision": text(record, "woe_01a220_drawing_rev"),
                "SchProdQuantity": record["woe_01a320_sch_prod_qty"],
                "NonStockDescriptionLine1": text(record, "woe_01a200_description_01"),
                "NonStockDescriptionLine2": text(record, "woe_01a200_description_02"),
            })
    prior_count = sum(1 for _ in (CURRENT / "Canonical/WorkOrder.csv").open(
        encoding="utf-8-sig")) - 1
    if len(rows) < prior_count:
        raise RuntimeError(
            f"Work Order population regressed from {prior_count} to {len(rows)}")
    columns = list(rows[0])
    target = canonical / "WorkOrder.csv"
    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)
    base_package = output / "BasePackage"
    shutil.copytree(CURRENT, base_package)
    shutil.copy2(target, base_package / "Canonical/WorkOrder.csv")
    base_manifest_path = base_package / "manifest.json"
    base_manifest = json.loads(base_manifest_path.read_text(encoding="utf-8-sig"))
    base_manifest["run_id"] = args.sync_run_id
    base_manifest["runId"] = args.sync_run_id
    base_manifest.setdefault("entity_counts", {})["WorkOrder"] = len(rows)
    base_manifest["daily_operations_sync"] = {
        "syncRunId": args.sync_run_id,
        "workOrderSource": "WOE-01",
        "workOrderSourceSha256": sha(raw),
        "unchangedEntitiesCarriedForward": [
            "BillOfMaterial", "InventoryItem", "GeneralLedgerAccount"
        ],
    }
    base_manifest_path.write_text(
        json.dumps(base_manifest, indent=2) + "\n", encoding="utf-8")
    active = sum(row["WorkOrderStatus"].strip() == "O" for row in rows)
    manifest = {
        "schema": "dle-daily-operations-work-orders",
        "schemaVersion": "1.0",
        "syncRunId": args.sync_run_id,
        "source": "WOE-01",
        "sourceAccessMode": "O_RDONLY",
        "sourceIdentityBefore": before,
        "sourceIdentityAfter": after,
        "sourceIdentityMatch": True,
        "recordCount": len(rows),
        "activeRecordCount": active,
        "priorRecordCount": prior_count,
        "workOrderCsvSha256": sha(target),
        "sourceExtractSha256": sha(raw),
        "basePackagePath": str(base_package),
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output / "package.sha256").write_text(sha(output / "manifest.json") + "\n")
    print(json.dumps({"Result": "CANDIDATE_READY", "PackagePath": str(output),
                      "RecordCount": len(rows), "ActiveRecordCount": active,
                      "BasePackagePath": str(base_package),
                      "PackageSha256": sha(output / "manifest.json")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

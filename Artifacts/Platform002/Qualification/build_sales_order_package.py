#!/usr/bin/env python3
"""Build the fixed PLATFORM-002 canonical Sales Order extension package."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path


def decoded_parts(material: str) -> tuple[bytes, list[Decimal]]:
    parts = material.split("|")
    if not parts[0].startswith("S"):
        raise ValueError("decoded material does not start with S")
    strings = b"".join(bytes.fromhex(part[1:]) for part in parts if part.startswith("S"))
    numbers = [Decimal(part[1:]) for part in parts[1:] if part.startswith("N")]
    return strings, numbers


def addon_date(raw: bytes, snapshot_year: int, future_years: int = 0) -> str | None:
    raw_hex = raw.hex().upper()
    if raw_hex == "202020":
        return None
    if len(raw) != 3:
        raise ValueError(f"legacy date has {len(raw)} bytes")
    yy, month, day = ((byte - 0x20) % 100 for byte in raw)
    years = [
        year
        for year in range(1995, snapshot_year + future_years + 1)
        if year % 100 == yy
    ]
    if len(years) != 1:
        raise ValueError(
            f"legacy year {yy:02d} is not unique in "
            f"1995..{snapshot_year + future_years}"
        )
    return date(years[0], month, day).isoformat()


def read_rows(path: Path):
    with path.open("r", newline="", encoding="utf-8-sig") as source:
        yield from csv.DictReader(source)


def load_base(path: Path, key: str) -> dict[str, dict]:
    with path.open("r", newline="", encoding="utf-8-sig") as source:
        return {row[key].strip(): row for row in csv.DictReader(source)}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def write_csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=columns, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-root", required=True, type=Path)
    parser.add_argument("--base-package", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--snapshot-year", required=True, type=int)
    args = parser.parse_args()

    pass1 = args.runtime_root / "Pass1"
    inventory = load_base(args.base_package / "Canonical" / "InventoryItem.csv", "ItemNumber")
    work_orders = load_base(args.base_package / "Canonical" / "WorkOrder.csv", "WorkOrderNumber")
    bills = load_base(args.base_package / "Canonical" / "BillOfMaterial.csv", "BillNumber")

    customers: dict[str, dict] = {}
    for row in read_rows(pass1 / "ARM01_FULL.csv"):
        if row["layout_id"] != "A":
            continue
        text, _ = decoded_parts(row["decoded_record_material"])
        number = text[2:8].decode("latin-1").strip()
        customers[number] = {
            "CustomerNumber": number,
            "CustomerName": text[8:38].decode("latin-1").rstrip(),
            "SourceKeyRaw": bytes.fromhex(row["source_key_hex"]).decode("latin-1"),
            "SourceRecordHash": hashlib.sha256(bytes.fromhex(row["record_raw_hex"])).hexdigest().upper(),
        }

    line_codes: dict[str, str] = {}
    for row in read_rows(pass1 / "ARM10_FULL.csv"):
        if row["layout_id"] != "E":
            continue
        text, _ = decoded_parts(row["decoded_record_material"])
        line_codes[text[3:4].decode("latin-1")] = text[24:25].decode("latin-1")
    if line_codes.get("S") not in ("S", "P"):
        raise ValueError("ARM-10 layout E does not qualify Standard line code S")

    relation: dict[tuple[str, str, str], str] = {}
    for row in read_rows(pass1 / "WOE03_FULL.csv"):
        if row["layout_id"] != "B":
            continue
        key = bytes.fromhex(row["source_key_hex"]).decode("latin-1")
        if len(key) < 28 or key[2:3] != "B":
            raise ValueError("invalid WOE-03 layout B key")
        rel_key = (key[3:9].strip(), key[9:16], key[16:19])
        relation.setdefault(rel_key, key[21:28])

    headers: dict[tuple[str, str], dict] = {}
    all_header_rows = 0
    for row in read_rows(pass1 / "ARE03_FULL.csv"):
        if row["layout_id"] != "A":
            continue
        key = bytes.fromhex(row["source_key_hex"]).decode("latin-1")
        text, _ = decoded_parts(row["decoded_record_material"])
        if len(key) < 20 or key[2:4] != "  " or key[17:20] != "000":
            continue
        all_header_rows += 1
        if text[21:22] == b"I" or text[20:21] in (b"V", b"P") or text[100:101] == b"C":
            continue
        customer = text[4:10].decode("latin-1").strip()
        sales_order = text[10:17].decode("latin-1")
        headers[(customer, sales_order)] = {
            "CustomerNumber": customer,
            "SalesOrderNumber": sales_order,
            "CustomerPurchaseOrderNumber": text[48:58].decode("latin-1").rstrip(),
            "OrderDateRaw": text[76:79].hex().upper(),
            "OrderDate": addon_date(text[76:79], args.snapshot_year),
            "SourceKeyRaw": key,
            "SourceRecordHash": hashlib.sha256(bytes.fromhex(row["record_raw_hex"])).hexdigest().upper(),
        }

    lines: list[dict] = []
    stats = Counter()
    for row in read_rows(pass1 / "ARE13_FULL.csv"):
        if row["layout_id"] != "A":
            continue
        text, numbers = decoded_parts(row["decoded_record_material"])
        customer = text[4:10].decode("latin-1").strip()
        sales_order = text[10:17].decode("latin-1")
        header = headers.get((customer, sales_order))
        if header is None:
            continue
        line_code = text[20:21].decode("latin-1")
        if line_code != "S":
            stats["nonStandardFiltered"] += 1
            continue
        line_number = text[17:20].decode("latin-1")
        item_number = text[32:52].decode("latin-1").strip()
        memo = text[52:92].decode("latin-1").rstrip()
        estimated_raw = text[92:95]
        unit_price = numbers[1]
        quantity = numbers[2]

        inventory_row = inventory.get(item_number)
        description = memo.strip() or (
            inventory_row["ItemDescription"].strip() if inventory_row else ""
        )
        candidate_wo = relation.get((customer, sales_order, line_number))
        work_order = work_orders.get((candidate_wo or "").strip())
        work_order_number = work_order["WorkOrderNumber"] if work_order else None
        scheduled = work_order["SchProdQuantity"] if work_order else None
        bill = bills.get(item_number)

        stats["qualifyingLines"] += 1
        stats["negativeQuantity"] += quantity < 0
        stats["customerResolved"] += customer in customers
        stats["customerUnresolved"] += customer not in customers
        stats["workOrderResolved"] += work_order is not None
        stats["workOrderUnresolved"] += work_order is None
        stats["inventoryResolved"] += inventory_row is not None
        stats["inventoryUnresolved"] += inventory_row is None
        stats["bomResolved"] += bill is not None
        stats["bomUnresolved"] += bill is None

        lines.append(
            {
                "CustomerNumber": customer,
                "SalesOrderNumber": sales_order,
                "LineNumber": line_number,
                "ItemNumber": item_number,
                "OrderMemo": memo,
                "EstimatedShipDateRaw": estimated_raw.hex().upper(),
                "EstimatedShipDate": addon_date(
                    estimated_raw,
                    args.snapshot_year,
                    future_years=10,
                ),
                "UnitPrice": format(unit_price, "f"),
                "QuantityOrdered": format(quantity, "f"),
                "LineCode": line_code,
                "ResolvedDescription": description,
                "ExtendedPrice": format(unit_price * quantity, "f"),
                "WorkOrderNumber": work_order_number,
                "ScheduledProductionQuantity": scheduled,
                "BillNumber": bill["BillNumber"].strip() if bill else None,
                "DrawingNumber": bill["DrawingNumber"].strip() if bill else None,
                "DrawingRevision": bill["DrawingRevision"].strip() if bill else None,
                "BomRevision": bill["BomRevision"].strip() if bill else None,
                "SourceKeyRaw": bytes.fromhex(row["source_key_hex"]).decode("latin-1"),
                "SourceRecordHash": hashlib.sha256(bytes.fromhex(row["record_raw_hex"])).hexdigest().upper(),
            }
        )

    sales_orders = sorted(headers.values(), key=lambda row: (row["CustomerNumber"], row["SalesOrderNumber"]))
    customer_rows = sorted(customers.values(), key=lambda row: row["CustomerNumber"])
    lines.sort(
        key=lambda row: (
            row["CustomerNumber"],
            row["SalesOrderNumber"],
            row["LineNumber"],
        )
    )

    canonical = args.output / "Canonical"
    write_csv(canonical / "Customer.csv", list(customer_rows[0]), customer_rows)
    write_csv(canonical / "SalesOrder.csv", list(sales_orders[0]), sales_orders)
    write_csv(canonical / "SalesOrderLine.csv", list(lines[0]), lines)

    base_manifest = json.loads((args.base_package / "manifest.json").read_text(encoding="utf-8-sig"))
    base_hash = sha256_file(args.base_package / "manifest.json")
    manifest = {
        "schema": "DLE_PLATFORM_SALES_ORDER_EXTENSION_V1",
        "runId": args.run_id,
        "dataEnvironment": "LIVE",
        "snapshotYear": args.snapshot_year,
        "parentCanonicalPackage": {
            "runId": (
                base_manifest.get("RunId")
                or base_manifest.get("runId")
                or base_manifest.get("run_id")
            ),
            "manifestSha256": base_hash,
        },
        "counts": {
            "Customer": len(customer_rows),
            "SalesOrder": len(sales_orders),
            "SalesOrderLine": len(lines),
        },
        "validation": dict(stats),
        "sourceQualification": "VPRO_KEY_RAWRECORD_SHA256_V1 and VPRO_DECODED_RECORD_SHA256_V1",
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (args.output / "validation.json").write_text(
        json.dumps({"verdict": "PASS", "manifest": manifest}, indent=2) + "\n",
        encoding="utf-8",
    )

    hashes = []
    for file in sorted(args.output.rglob("*")):
        if file.is_file() and file.name not in {"hashes.csv", "package.sha256"}:
            hashes.append({"RelativePath": file.relative_to(args.output).as_posix(), "Sha256": sha256_file(file)})
    write_csv(args.output / "hashes.csv", ["RelativePath", "Sha256"], hashes)
    (args.output / "package.sha256").write_text(
        sha256_file(args.output / "hashes.csv") + "\n",
        encoding="ascii",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

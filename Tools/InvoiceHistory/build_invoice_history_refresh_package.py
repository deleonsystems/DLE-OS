from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


REPO_ROOT = Path(r"C:\DLE-OS\Repositories\DLE-OS")
APPROVED_OUTPUT_ROOT = Path(
    r"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Runs"
)
BASELINE_BUILDER = (
    REPO_ROOT / "Tools" / "InvoiceHistory" /
    "build_invoice_history_package.py"
)
PLATFORM002 = Path(
    r"C:\Add-On\Lab\Platform002"
    r"\PLATFORM002-20260728T163200Z-SALESORDER4\Runtime\Pass1"
)
LIVE_CANONICAL = Path(
    r"C:\DLE-OS\Canonical\LiveMirror\Current\Canonical"
)

spec = importlib.util.spec_from_file_location(
    "invoice_history_baseline", BASELINE_BUILDER
)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load the qualified baseline mapping.")
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)

HEADER_FIELDS = list(baseline.HEADER_FIELDS)
LINE_FIELDS = list(baseline.LINE_FIELDS)
HEADER_KEY = ("FirmId", "ArType", "CustomerNumber", "InvoiceNumber")
LINE_KEY = HEADER_KEY + ("InvoiceLineNumber",)
HEADER_COMPARE_FIELDS = tuple(
    field for field in HEADER_FIELDS
    if field not in {"SourceKeyRaw"}
)
LINE_COMPARE_FIELDS = tuple(
    field for field in LINE_FIELDS
    if field not in {"SourceKeyRaw"}
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--active-header-csv", type=Path, required=True)
    parser.add_argument("--active-line-csv", type=Path, required=True)
    parser.add_argument("--window-start", type=date.fromisoformat, required=True)
    parser.add_argument("--window-end", type=date.fromisoformat, required=True)
    parser.add_argument("--snapshot-year", type=int, required=True)
    parser.add_argument(
        "--output-root", type=Path, default=APPROVED_OUTPUT_ROOT
    )
    return parser.parse_args()


def clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def decode_hex(value: str) -> str:
    return bytes.fromhex(value).decode("latin-1")


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def record_hash(record_hex: str) -> str:
    return hashlib.sha256(bytes.fromhex(record_hex)).hexdigest().upper()


def decode_date(raw: str, snapshot_year: int) -> str:
    if raw == "   ":
        return ""
    if len(raw) != 3:
        raise ValueError(f"Invalid encoded date length: {raw!r}")
    year2, month, day = ((ord(char) - 0x20) % 100 for char in raw)
    years = [
        year for year in range(1995, snapshot_year + 1)
        if year % 100 == year2
    ]
    if len(years) != 1:
        raise ValueError(
            f"Encoded year {year2:02d} is not unique in 1995..{snapshot_year}."
        )
    try:
        return date(years[0], month, day).isoformat()
    except ValueError as error:
        raise ValueError(f"Invalid encoded calendar date: {raw!r}") from error


def decimal_text(value: str) -> str:
    try:
        number = Decimal(clean(value) or "0")
    except InvalidOperation as error:
        raise ValueError(f"Malformed decimal: {value!r}") from error
    text = format(number, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def write_csv(
    path: Path, fields: list[str], rows: list[dict[str, object]]
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=fields, quoting=csv.QUOTE_ALL
        )
        writer.writeheader()
        writer.writerows(rows)


def load_customer_names() -> dict[str, str]:
    result: dict[str, str] = {}
    with (PLATFORM002 / "ARM01_FULL.csv").open(
        newline="", encoding="utf-8"
    ) as handle:
        for row in csv.DictReader(handle):
            segments = row["decoded_record_material"].split("|")
            key = decode_hex(segments[0][1:])
            name = decode_hex(segments[1][1:])
            result[key[:8]] = name[:30].strip()
    return result


def load_inventory_descriptions() -> dict[str, str]:
    result: dict[str, str] = {}
    with (LIVE_CANONICAL / "InventoryItem.csv").open(
        newline="", encoding="utf-8-sig"
    ) as handle:
        for row in csv.DictReader(handle):
            result[row["ItemNumber"].strip()] = row["ItemDescription"].strip()
    return result


def load_relationships() -> tuple[
    dict[str, list[str]], set[str], dict[str, dict[str, str]]
]:
    relationships: dict[str, list[str]] = defaultdict(list)
    with (PLATFORM002 / "WOE03_FULL.csv").open(
        newline="", encoding="utf-8"
    ) as handle:
        for row in csv.DictReader(handle):
            if row["layout_id"] != "B":
                continue
            key = decode_hex(row["source_key_hex"])
            relationships[key[:19]].append(key[21:28])
    work_order_rows = baseline.load_work_orders()
    return relationships, set(work_order_rows), work_order_rows


def relationship_for(
    customer: str,
    sales_order: str,
    line: str,
    relationships: dict[str, list[str]],
    work_orders: set[str],
) -> tuple[str, str, int]:
    candidates = relationships.get(
        "01B" + customer + sales_order + line, []
    )
    if len(candidates) > 1:
        return "Ambiguous", "", len(candidates)
    if not candidates or candidates[0] not in work_orders:
        return "Unresolved", "", len(candidates)
    return "Unique", candidates[0], 1


def validate_candidate(
    headers: list[dict[str, object]],
    lines: list[dict[str, object]],
) -> None:
    header_keys = [
        tuple(clean(row[field]) for field in HEADER_KEY) for row in headers
    ]
    line_keys = [
        tuple(clean(row[field]) for field in LINE_KEY) for row in lines
    ]
    if len(header_keys) != len(set(header_keys)):
        raise ValueError("Duplicate CustomerInvoice natural keys.")
    if len(line_keys) != len(set(line_keys)):
        raise ValueError("Duplicate CustomerInvoiceLine natural keys.")
    header_set = set(header_keys)
    if any(key[:4] not in header_set for key in line_keys):
        raise ValueError("Orphan CustomerInvoiceLine candidate.")
    for row in lines:
        status = clean(row["WorkOrderResolutionStatus"])
        count = int(row["WorkOrderCandidateCount"])
        number = clean(row["WorkOrderNumber"])
        if status == "Unique" and (count != 1 or not number):
            raise ValueError("Invalid Unique Work Order candidate.")
        if status == "Ambiguous" and (count <= 1 or number):
            raise ValueError("Invalid Ambiguous Work Order candidate.")
        if status == "Unresolved" and number:
            raise ValueError("Unresolved Work Order contains a number.")
        if status not in {"Unique", "Ambiguous", "Unresolved"}:
            raise ValueError(f"Invalid Work Order status: {status}")


def build_candidate(
    input_root: Path, snapshot_year: int
) -> tuple[list[dict[str, object]], list[dict[str, object]], dict]:
    header_source = read_csv(input_root / "BOUNDED_HEADERS.csv")
    line_source = read_csv(input_root / "BOUNDED_LINES.csv")
    customers = load_customer_names()
    inventory = load_inventory_descriptions()
    relationships, work_order_numbers, work_orders = load_relationships()
    bills = baseline.load_bills()

    headers: dict[str, dict[str, object]] = {}
    for row in header_source:
        key = decode_hex(row["key_hex"])
        value = decode_hex(row["a0_hex"])
        if len(key) != 20 or key[17:] != "000":
            raise ValueError(f"Unexpected ART-03 key: {key!r}")
        prefix = key[:17]
        invoice_date = decode_date(value[23:26], snapshot_year)
        headers[prefix] = {
            "FirmId": value[0:2],
            "ArType": value[2:4],
            "CustomerNumber": value[4:10],
            "InvoiceNumber": value[10:17],
            "InvoiceDate": invoice_date,
            "CustomerName": customers.get(
                value[0:2] + value[4:10], "Not On File"
            ),
            "CustomerNameResolutionType": "CurrentMasterResolved",
            "AccountsReceivablePurchaseOrderNumber": value[48:58].strip(),
            "SalesOrderNumber": value[41:48].strip(),
            "SourceFile": "ART-03",
            "SourceKeyRaw": key,
            "SourceRecordHash": record_hash(row["record_hex"]),
        }

    candidate_lines: list[dict[str, object]] = []
    used_headers: set[str] = set()
    filtered_line_counts = Counter()
    for row in line_source:
        key = decode_hex(row["key_hex"])
        if len(key) != 20 or not key[17:].isdigit():
            raise ValueError(f"Unexpected ART-13 key: {key!r}")
        header = headers.get(key[:17])
        if header is None:
            raise ValueError(f"ART-13 row has no selected header: {key!r}")
        w0 = decode_hex(row["w0_hex"])
        w1 = decode_hex(row["w1_hex"])
        values = row["numeric_values"].split("|")
        if len(values) != 15:
            raise ValueError(f"Malformed ART-13 numeric material: {key!r}")
        line_code = w0[20:21]
        quantity = Decimal(clean(values[4]) or "0")
        if line_code not in {"S", "N"}:
            filtered_line_counts["non_report_line_code"] += 1
            continue
        if quantity == 0:
            filtered_line_counts["zero_quantity"] += 1
            continue

        customer = str(header["CustomerNumber"])
        sales_order = str(header["SalesOrderNumber"])
        invoice_line = key[17:20]
        item = w0[32:52].strip()
        description = w1[:40].strip()
        if line_code == "S" and not description:
            description = inventory.get(item, "")
            description_type = (
                "CurrentMasterResolved" if description else "Unavailable"
            )
        else:
            description_type = (
                "HistoricalStored" if description else "Unavailable"
            )
        status, work_order, candidate_count = relationship_for(
            customer,
            sales_order,
            invoice_line,
            relationships,
            work_order_numbers,
        )
        manufacturing = baseline.manufacturing_values(
            item, status, work_order, work_orders, bills
        )
        required_date = decode_date(w1[40:43], snapshot_year)
        unit_price = Decimal(clean(values[1]) or "0")
        invoice_date = str(header["InvoiceDate"])
        candidate_lines.append(
            {
                "FirmId": header["FirmId"],
                "ArType": header["ArType"],
                "CustomerNumber": customer,
                "InvoiceNumber": header["InvoiceNumber"],
                "InvoiceLineNumber": invoice_line,
                "InvoiceDate": invoice_date,
                "SalesOrderNumber": sales_order,
                "SalesOrderLineNumber": w0[17:20],
                "LineCode": line_code,
                "ItemNumber": item,
                "ItemDescription": description,
                "ItemDescriptionResolutionType": description_type,
                "EstimatedShipDate": required_date,
                "OnTimeIndicator": (
                    "Y" if invoice_date <= required_date else "N"
                ) if required_date else "N",
                "QuantityShipped": decimal_text(str(quantity)),
                "UnitPrice": decimal_text(str(unit_price)),
                "ExtendedPrice": decimal_text(str(unit_price * quantity)),
                "WorkOrderNumber": work_order,
                "WorkOrderResolutionStatus": status,
                "WorkOrderCandidateCount": candidate_count,
                **manufacturing,
                "SourceFile": "ART-13",
                "SourceKeyRaw": key,
                "SourceRecordHash": record_hash(row["record_hex"]),
            }
        )
        used_headers.add(key[:17])

    candidate_headers = [headers[key] for key in sorted(used_headers)]
    candidate_lines.sort(key=lambda row: tuple(str(row[x]) for x in LINE_KEY))
    validate_candidate(candidate_headers, candidate_lines)
    return candidate_headers, candidate_lines, {
        "physicalHeaderCount": len(header_source),
        "physicalLineCount": len(line_source),
        "filteredLineCounts": dict(sorted(filtered_line_counts.items())),
    }


def keyed(
    rows: list[dict[str, str]], fields: tuple[str, ...]
) -> dict[tuple[str, ...], dict[str, str]]:
    result: dict[tuple[str, ...], dict[str, str]] = {}
    for row in rows:
        key = tuple(clean(row[field]) for field in fields)
        if key in result:
            raise ValueError(f"Duplicate active SQL key: {key}")
        result[key] = row
    return result


def comparable(field: str, value: object) -> object:
    text = clean(value)
    if field in {"QuantityShipped", "UnitPrice", "ExtendedPrice"}:
        return Decimal(text or "0")
    if field == "WorkOrderCandidateCount":
        return int(text or "0")
    if field in {"InvoiceDate", "EstimatedShipDate"}:
        return text[:10]
    return text


def compare(
    entity: str,
    candidate: list[dict[str, object]],
    active: list[dict[str, str]],
    key_fields: tuple[str, ...],
    compare_fields: tuple[str, ...],
    window_start: date,
    window_end: date,
) -> tuple[list[dict[str, object]], Counter]:
    active_map = keyed(active, key_fields)
    candidate_map = {
        tuple(clean(row[field]) for field in key_fields): row
        for row in candidate
    }
    if len(candidate_map) != len(candidate):
        raise ValueError(f"Duplicate candidate key in {entity}.")
    rows: list[dict[str, object]] = []
    counts = Counter()
    for key, candidate_row in candidate_map.items():
        active_row = active_map.get(key)
        if active_row is None:
            classification = "Insert"
            changed = list(compare_fields)
        else:
            changed = [
                field for field in compare_fields
                if comparable(field, candidate_row[field])
                != comparable(field, active_row.get(field))
            ]
            classification = "Update" if changed else "Unchanged"
        counts[classification] += 1
        rows.append(
            {
                "Entity": entity,
                "NaturalKey": "|".join(key),
                "Classification": classification,
                "ChangedFields": "|".join(changed),
            }
        )
    for key, active_row in active_map.items():
        invoice_date = date.fromisoformat(active_row["InvoiceDate"][:10])
        if (
            window_start <= invoice_date <= window_end
            and key not in candidate_map
        ):
            counts["MissingFromSource"] += 1
            rows.append(
                {
                    "Entity": entity,
                    "NaturalKey": "|".join(key),
                    "Classification": "MissingFromSource",
                    "ChangedFields": "",
                }
            )
    rows.sort(key=lambda row: (str(row["Entity"]), str(row["NaturalKey"])))
    return rows, counts


def main() -> int:
    args = arguments()
    if not re.fullmatch(
        r"INVOICEHISTORYREFRESH-\d{8}T\d{6}Z-[0-9A-F]{8}",
        args.run_id,
    ):
        raise ValueError("Invalid governed refresh run ID.")
    if args.output_root.resolve() != APPROVED_OUTPUT_ROOT.resolve():
        raise ValueError("The package output root is outside the allowlist.")
    if args.window_start > args.window_end:
        raise ValueError("The extraction window is inverted.")

    headers, lines, extraction = build_candidate(
        args.input_root, args.snapshot_year
    )
    active_headers = read_csv(args.active_header_csv)
    active_lines = read_csv(args.active_line_csv)
    header_comparison, header_counts = compare(
        "CustomerInvoice",
        headers,
        active_headers,
        HEADER_KEY,
        HEADER_COMPARE_FIELDS,
        args.window_start,
        args.window_end,
    )
    line_comparison, line_counts = compare(
        "CustomerInvoiceLine",
        lines,
        active_lines,
        LINE_KEY,
        LINE_COMPARE_FIELDS,
        args.window_start,
        args.window_end,
    )

    package = args.output_root / args.run_id / "Package"
    if package.exists():
        raise ValueError(f"Package already exists: {package}")
    canonical = package / "Canonical"
    evidence = package / "Evidence"
    write_csv(canonical / "CustomerInvoice.csv", HEADER_FIELDS, headers)
    write_csv(canonical / "CustomerInvoiceLine.csv", LINE_FIELDS, lines)
    comparison_fields = [
        "Entity", "NaturalKey", "Classification", "ChangedFields"
    ]
    write_csv(
        evidence / "comparison.csv",
        comparison_fields,
        header_comparison + line_comparison,
    )

    work_order_counts = Counter(
        str(row["WorkOrderResolutionStatus"]) for row in lines
    )
    manufacturing_counts = Counter(
        str(row["ManufacturingResolutionType"]) for row in lines
    )
    negative_count = sum(
        Decimal(str(row["QuantityShipped"])) < 0 for row in lines
    )
    source_summary = {
        row["metric"]: row["value"]
        for row in read_csv(args.input_root / "BOUNDED_SUMMARY.csv")
    }
    if (
        source_summary["art03_fid_before_hex"]
        != source_summary["art03_fid_after_hex"]
        or source_summary["art03_fin_before_hex"]
        != source_summary["art03_fin_after_hex"]
        or source_summary["art13_fid_before_hex"]
        != source_summary["art13_fid_after_hex"]
        or source_summary["art13_fin_before_hex"]
        != source_summary["art13_fin_after_hex"]
    ):
        raise ValueError("A source identity changed during extraction.")

    manifest = {
        "schema": "DLE_INVOICE_HISTORY_REFRESH_V1",
        "schemaVersion": 1,
        "contractVersion": "1.2",
        "dataEnvironment": "LIVE",
        "runId": args.run_id,
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "windowStart": args.window_start.isoformat(),
        "windowEnd": args.window_end.isoformat(),
        "sourceIdentity": source_summary,
        "extraction": extraction,
        "counts": {
            "CustomerInvoice": len(headers),
            "CustomerInvoiceLine": len(lines),
        },
        "headerClassifications": dict(sorted(header_counts.items())),
        "lineClassifications": dict(sorted(line_counts.items())),
        "workOrderResolutionCounts": dict(sorted(work_order_counts.items())),
        "manufacturingResolutionCounts": dict(
            sorted(manufacturing_counts.items())
        ),
        "negativeQuantityCount": negative_count,
        "naturalKey": list(LINE_KEY),
        "missingRowsRetained": True,
        "verdict": (
            "PASS WITH CLARIFICATIONS"
            if line_counts["MissingFromSource"]
            or header_counts["MissingFromSource"]
            else "PASS"
        ),
    }
    (package / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    content_paths = [
        canonical / "CustomerInvoice.csv",
        canonical / "CustomerInvoiceLine.csv",
        evidence / "comparison.csv",
    ]
    material = "".join(
        f"{path.relative_to(package).as_posix()}|{file_hash(path)}\n"
        for path in content_paths
    )
    package_hash = hashlib.sha256(material.encode()).hexdigest().upper()
    manifest["packageContentSha256"] = package_hash
    (package / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    hash_rows = []
    for path in sorted(package.rglob("*")):
        if path.is_file() and path.name != "hashes.csv":
            hash_rows.append(
                {
                    "RelativePath": path.relative_to(package).as_posix(),
                    "Bytes": path.stat().st_size,
                    "Sha256": file_hash(path),
                }
            )
    write_csv(
        package / "hashes.csv",
        ["RelativePath", "Bytes", "Sha256"],
        hash_rows,
    )
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

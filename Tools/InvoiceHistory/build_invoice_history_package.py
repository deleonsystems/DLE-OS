from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


REPO_ROOT = Path(r"C:\DLE-OS\Repositories\DLE-OS")
QUALIFICATION_ROOT = (
    REPO_ROOT
    / "Artifacts"
    / "InvoiceHistoryFieldMap001"
    / "INVOICEHISTORY001-20260728T233255Z"
)
LAB_QUALIFICATION_ROOT = Path(
    r"C:\Add-On\Lab\InvoiceHistoryFieldMap001"
    r"\INVOICEHISTORY001-20260728T233255Z\Qualification"
)
LIVE_CANONICAL_ROOT = Path(
    r"C:\DLE-OS\Canonical\LiveMirror\Current\Canonical"
)
PACKAGE_ROOT = Path(r"C:\DLE-OS\Canonical\InvoiceHistory")

SOURCE_IDENTITIES = {
    "ART-03": {
        "path": r"X:\AON\ADATA\ART-03",
        "length": 4_809_216,
        "lastWriteTimeUtc": "2026-07-28T17:14:34.1080000Z",
        "sha256": "2C74E6FE76D5FA6C7506AB7839CEFA32E9C9E60E03356660B80DD4A02B56B9CF",
        "openMode": 'MODE="O_RDONLY"',
    },
    "ART-13": {
        "path": r"X:\AON\ADATA\ART-13",
        "length": 22_113_792,
        "lastWriteTimeUtc": "2026-07-28T17:14:21.0850000Z",
        "sha256": "300266F4C955C9DBF2857E598C2D8F5429EEBA64D8A0637269014AE438C9AEC2",
        "openMode": 'MODE="O_RDONLY"',
    },
}
QUALIFIED_ART13_DECODED_SHA256 = (
    "9A03310D6A26CEBDDA3C81D0674F98F3641F7E63876665883327C4249D7EC92D"
)
QUALIFIED_ART13_KEY_RECORD_SHA256 = (
    "60DFEE6F88BEB363BAFABE3DB58E607E2B2A8F565FD7CE4F67B8ACA9B696E85E"
)

HEADER_FIELDS = [
    "FirmId",
    "ArType",
    "CustomerNumber",
    "InvoiceNumber",
    "InvoiceDate",
    "CustomerName",
    "CustomerNameResolutionType",
    "AccountsReceivablePurchaseOrderNumber",
    "SalesOrderNumber",
    "SourceFile",
    "SourceKeyRaw",
    "SourceRecordHash",
]

LINE_FIELDS = [
    "FirmId",
    "ArType",
    "CustomerNumber",
    "InvoiceNumber",
    "InvoiceLineNumber",
    "InvoiceDate",
    "SalesOrderNumber",
    "SalesOrderLineNumber",
    "LineCode",
    "ItemNumber",
    "ItemDescription",
    "ItemDescriptionResolutionType",
    "EstimatedShipDate",
    "OnTimeIndicator",
    "QuantityShipped",
    "UnitPrice",
    "ExtendedPrice",
    "WorkOrderNumber",
    "WorkOrderResolutionStatus",
    "WorkOrderCandidateCount",
    "BillNumber",
    "BomRevision",
    "DrawingNumber",
    "DrawingRevision",
    "RevisionCode",
    "ManufacturingResolutionType",
    "SourceFile",
    "SourceKeyRaw",
    "SourceRecordHash",
]

WORK_ORDER_STATUSES = {"Unique", "Unresolved", "Ambiguous"}
MANUFACTURING_STATUSES = {
    "HistoricalStored",
    "HistoricalReconstructed",
    "CurrentMasterResolved",
    "Ambiguous",
    "Unavailable",
}
DESCRIPTION_STATUSES = {
    "HistoricalStored",
    "CurrentMasterResolved",
    "Unavailable",
}


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the governed Invoice History baseline package."
    )
    parser.add_argument(
        "--run-id",
        default="INVOICEHISTORYPLATFORM001-"
        + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=PACKAGE_ROOT,
        help="Approved local package root; source paths remain fixed.",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest().upper()


def decode_hex(value: str) -> str:
    return bytes.fromhex(value).decode("latin-1")


def clean(value: str | None) -> str:
    return (value or "").strip()


def nullable(value: str | None) -> str:
    return clean(value)


def decimal_text(value: str) -> str:
    try:
        number = Decimal(clean(value) or "0")
    except InvalidOperation as error:
        raise ValueError(f"Malformed decimal: {value!r}") from error
    result = format(number, "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return result or "0"


def iso_date(value: str) -> str:
    value = clean(value)
    if not value:
        return ""
    parsed = datetime.strptime(value, "%m/%d/%y")
    return parsed.date().isoformat()


def load_csv(path: Path, *, encoding: str = "utf-8") -> list[dict[str, str]]:
    with path.open(newline="", encoding=encoding) as handle:
        return list(csv.DictReader(handle))


def write_csv(
    path: Path, fieldnames: list[str], rows: list[dict[str, object]]
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=fieldnames,
            extrasaction="raise",
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        writer.writerows(rows)


def qualified_art13_fingerprints() -> dict[str, str | int]:
    results: list[dict[str, str | int]] = []
    for pass_name in ("ART13_PASS1.csv", "ART13_PASS2.csv"):
        raw = hashlib.sha256()
        decoded = hashlib.sha256()
        count = 0
        with (LAB_QUALIFICATION_ROOT / pass_name).open(
            newline="", encoding="utf-8"
        ) as handle:
            for row in csv.DictReader(handle):
                raw.update(
                    f"{row['key_hex']}|{row['record_hex']}\n".encode()
                )
                decoded.update(
                    (
                        f"{row['key_hex']}|{row['w0_hex']}|"
                        f"{row['w1_hex']}|{row['numeric_values']}\n"
                    ).encode()
                )
                count += 1
        results.append(
            {
                "count": count,
                "orderedKeyRecordSha256": raw.hexdigest().upper(),
                "orderedDecodedContentSha256": decoded.hexdigest().upper(),
            }
        )
    if results[0] != results[1]:
        raise ValueError("Qualified ART-13 passes do not match.")
    result = results[0]
    if (
        result["count"] != 79_003
        or result["orderedKeyRecordSha256"]
        != QUALIFIED_ART13_KEY_RECORD_SHA256
        or result["orderedDecodedContentSha256"]
        != QUALIFIED_ART13_DECODED_SHA256
    ):
        raise ValueError("ART-13 fingerprints are outside the qualified boundary.")
    return result


def load_source_record_material() -> tuple[dict[str, dict], dict[str, dict]]:
    headers: dict[str, dict] = {}
    with (LAB_QUALIFICATION_ROOT / "ART03_PASS1.csv").open(
        newline="", encoding="utf-8"
    ) as handle:
        for row in csv.DictReader(handle):
            key = decode_hex(row["key_hex"])
            if key[-3:] != "000":
                continue
            headers[key[:17]] = {
                "sourceKey": key,
                "sourceRecordHash": hashlib.sha256(
                    bytes.fromhex(row["record_hex"])
                ).hexdigest().upper(),
            }

    lines: dict[str, dict] = {}
    with (LAB_QUALIFICATION_ROOT / "ART13_PASS1.csv").open(
        newline="", encoding="utf-8"
    ) as handle:
        for row in csv.DictReader(handle):
            key = decode_hex(row["key_hex"])
            w1 = decode_hex(row["w1_hex"])
            lines[key[:20]] = {
                "sourceKey": key,
                "sourceRecordHash": hashlib.sha256(
                    bytes.fromhex(row["record_hex"])
                ).hexdigest().upper(),
                "historicalMemo": w1[:40].strip(),
            }
    return headers, lines


def load_cardinality() -> dict[str, dict[str, str]]:
    rows = load_csv(
        QUALIFICATION_ROOT / "INVOICE_HISTORY_WORK_ORDER_CARDINALITY.csv"
    )
    result: dict[str, dict[str, str]] = {}
    for row in rows:
        key = row["natural_key"]
        if key in result:
            raise ValueError(f"Duplicate cardinality key: {key}")
        result[key] = row
    return result


def load_work_orders() -> dict[str, dict[str, str]]:
    rows = load_csv(
        LIVE_CANONICAL_ROOT / "WorkOrder.csv", encoding="utf-8-sig"
    )
    return {clean(row["WorkOrderNumber"]): row for row in rows}


def load_bills() -> dict[str, list[dict[str, str]]]:
    rows = load_csv(
        LIVE_CANONICAL_ROOT / "BillOfMaterial.csv", encoding="utf-8-sig"
    )
    result: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        result[clean(row["BillNumber"])].append(row)
    return result


def classify_work_order(
    cardinality: dict[str, str],
) -> tuple[str, str, int]:
    candidate_count = int(cardinality["candidate_count"])
    candidates = [
        candidate
        for candidate in cardinality["candidate_work_orders"].split("|")
        if candidate
    ]
    status = cardinality["resolution_status"]
    if status == "UNIQUELY_RESOLVED" and candidate_count == 1:
        return "Unique", candidates[0], candidate_count
    if status == "MULTIPLE_CANDIDATES" and candidate_count > 1:
        return "Ambiguous", "", candidate_count
    if status in {"MISSING_WOE03", "MISSING_WOE01"}:
        return "Unresolved", "", candidate_count
    raise ValueError(
        "Invalid Work Order cardinality/status combination: "
        f"{status}/{candidate_count}"
    )


def manufacturing_values(
    item_number: str,
    work_order_status: str,
    work_order_number: str,
    work_orders: dict[str, dict[str, str]],
    bills: dict[str, list[dict[str, str]]],
) -> dict[str, str]:
    if work_order_status == "Unique":
        work_order = work_orders.get(work_order_number)
        if work_order is None:
            raise ValueError(
                f"Unique Work Order is missing from WOE-01 projection: "
                f"{work_order_number}"
            )
        bill_number = clean(work_order.get("ItemNumber"))
        values = {
            "BillNumber": bill_number,
            "BomRevision": nullable(work_order.get("BomRevision")),
            "DrawingNumber": nullable(work_order.get("DrawingNumber")),
            "DrawingRevision": nullable(work_order.get("DrawingRevision")),
            "RevisionCode": "",
            "ManufacturingResolutionType": "HistoricalReconstructed",
        }
        return values

    matching_bills = bills.get(item_number, []) if item_number else []
    if len(matching_bills) == 1:
        bill = matching_bills[0]
        return {
            "BillNumber": item_number,
            "BomRevision": nullable(bill.get("BomRevision")),
            "DrawingNumber": nullable(bill.get("DrawingNumber")),
            "DrawingRevision": nullable(bill.get("DrawingRevision")),
            "RevisionCode": "",
            "ManufacturingResolutionType": "CurrentMasterResolved",
        }
    if len(matching_bills) > 1:
        return {
            "BillNumber": "",
            "BomRevision": "",
            "DrawingNumber": "",
            "DrawingRevision": "",
            "RevisionCode": "",
            "ManufacturingResolutionType": "Ambiguous",
        }
    return {
        "BillNumber": "",
        "BomRevision": "",
        "DrawingNumber": "",
        "DrawingRevision": "",
        "RevisionCode": "",
        "ManufacturingResolutionType": "Unavailable",
    }


def build_rows() -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    projection = load_csv(
        QUALIFICATION_ROOT / "Qualification" / "CURRENT_SOURCE_PROJECTION.csv"
    )
    cardinality = load_cardinality()
    source_headers, source_lines = load_source_record_material()
    work_orders = load_work_orders()
    bills = load_bills()

    line_rows: list[dict[str, object]] = []
    header_candidates: dict[tuple[str, ...], dict[str, object]] = {}

    for source in projection:
        customer_number = clean(source["Cust#"])
        invoice_number = clean(source["Invc#"])
        sales_order_and_line = clean(source["SlsOrd#"])
        match = re.fullmatch(r"(.{7})-(.{3})", sales_order_and_line)
        if match is None:
            raise ValueError(
                f"Malformed Sales Order/line: {sales_order_and_line!r}"
            )
        sales_order_number, invoice_line_number = match.groups()
        natural_key = (
            f"{customer_number}|{invoice_number}|{invoice_line_number}"
        )
        relationship = cardinality.get(natural_key)
        if relationship is None:
            raise ValueError(f"Missing cardinality row: {natural_key}")

        work_order_status, work_order_number, candidate_count = (
            classify_work_order(relationship)
        )
        source_line_key = (
            "01  "
            + customer_number
            + invoice_number
            + invoice_line_number
        )
        source_line = source_lines.get(source_line_key)
        if source_line is None:
            raise ValueError(f"Missing ART-13 source row: {source_line_key!r}")

        description = nullable(source["Item Desc"])
        historical_memo = source_line["historicalMemo"]
        if historical_memo:
            description_status = "HistoricalStored"
        elif description:
            description_status = "CurrentMasterResolved"
        else:
            description_status = "Unavailable"

        item_number = nullable(source["Assembly#"])
        manufacturing = manufacturing_values(
            item_number,
            work_order_status,
            work_order_number,
            work_orders,
            bills,
        )

        invoice_date = iso_date(source["Ship/Inv Dt"])
        line_row: dict[str, object] = {
            "FirmId": "01",
            "ArType": "  ",
            "CustomerNumber": customer_number,
            "InvoiceNumber": invoice_number,
            "InvoiceLineNumber": invoice_line_number,
            "InvoiceDate": invoice_date,
            "SalesOrderNumber": sales_order_number,
            "SalesOrderLineNumber": invoice_line_number,
            "LineCode": clean(source["_line_code"]),
            "ItemNumber": item_number,
            "ItemDescription": description,
            "ItemDescriptionResolutionType": description_status,
            "EstimatedShipDate": iso_date(source["Dt Reqd"]),
            "OnTimeIndicator": clean(source["OnTime?"]),
            "QuantityShipped": decimal_text(source["Qty Shp'd"]),
            "UnitPrice": decimal_text(source["U.Price"]),
            "ExtendedPrice": decimal_text(source["Ext Price"]),
            "WorkOrderNumber": work_order_number,
            "WorkOrderResolutionStatus": work_order_status,
            "WorkOrderCandidateCount": candidate_count,
            **manufacturing,
            "SourceFile": "ART-13",
            "SourceKeyRaw": source_line["sourceKey"],
            "SourceRecordHash": source_line["sourceRecordHash"],
        }
        line_rows.append(line_row)

        header_source_key = (
            "01  " + customer_number + invoice_number
        )
        header_source = source_headers.get(header_source_key)
        if header_source is None:
            raise ValueError(
                f"Missing ART-03 source row: {header_source_key!r}"
            )
        header_key = ("01", "  ", customer_number, invoice_number)
        header_row: dict[str, object] = {
            "FirmId": "01",
            "ArType": "  ",
            "CustomerNumber": customer_number,
            "InvoiceNumber": invoice_number,
            "InvoiceDate": invoice_date,
            "CustomerName": nullable(source["Name"]),
            "CustomerNameResolutionType": "CurrentMasterResolved",
            "AccountsReceivablePurchaseOrderNumber": nullable(source["PO#"]),
            "SalesOrderNumber": sales_order_number,
            "SourceFile": "ART-03",
            "SourceKeyRaw": header_source["sourceKey"],
            "SourceRecordHash": header_source["sourceRecordHash"],
        }
        existing = header_candidates.get(header_key)
        if existing is not None and existing != header_row:
            raise ValueError(
                "Conflicting header values for natural key: "
                + "|".join(header_key)
            )
        header_candidates[header_key] = header_row

    return (
        sorted(
            header_candidates.values(),
            key=lambda row: (
                row["FirmId"],
                row["ArType"],
                row["CustomerNumber"],
                row["InvoiceNumber"],
            ),
        ),
        sorted(
            line_rows,
            key=lambda row: (
                row["FirmId"],
                row["ArType"],
                row["CustomerNumber"],
                row["InvoiceNumber"],
                row["InvoiceLineNumber"],
            ),
        ),
    )


def validate_rows(
    headers: list[dict[str, object]], lines: list[dict[str, object]]
) -> dict[str, object]:
    header_keys = [
        (
            row["FirmId"],
            row["ArType"],
            row["CustomerNumber"],
            row["InvoiceNumber"],
        )
        for row in headers
    ]
    line_keys = [
        (
            row["FirmId"],
            row["ArType"],
            row["CustomerNumber"],
            row["InvoiceNumber"],
            row["InvoiceLineNumber"],
        )
        for row in lines
    ]
    duplicate_headers = len(header_keys) - len(set(header_keys))
    duplicate_lines = len(line_keys) - len(set(line_keys))
    if duplicate_headers or duplicate_lines:
        raise ValueError("Duplicate natural keys were found.")

    required_header = (
        "FirmId",
        "CustomerNumber",
        "InvoiceNumber",
        "InvoiceDate",
        "SourceKeyRaw",
        "SourceRecordHash",
    )
    required_line = required_header + ("InvoiceLineNumber",)
    if any(not str(row[field]) for row in headers for field in required_header):
        raise ValueError("A required CustomerInvoice key/value is blank.")
    if any(not str(row[field]) for row in lines for field in required_line):
        raise ValueError("A required CustomerInvoiceLine key/value is blank.")

    header_key_set = set(header_keys)
    orphans = [
        key
        for key in line_keys
        if key[:4] not in header_key_set
    ]
    if orphans:
        raise ValueError("Orphan invoice lines were found.")

    for row in lines:
        work_order_status = str(row["WorkOrderResolutionStatus"])
        manufacturing_status = str(row["ManufacturingResolutionType"])
        description_status = str(row["ItemDescriptionResolutionType"])
        candidate_count = int(row["WorkOrderCandidateCount"])
        work_order_number = str(row["WorkOrderNumber"])
        if work_order_status not in WORK_ORDER_STATUSES:
            raise ValueError(f"Invalid Work Order status: {work_order_status}")
        if manufacturing_status not in MANUFACTURING_STATUSES:
            raise ValueError(
                f"Invalid manufacturing status: {manufacturing_status}"
            )
        if description_status not in DESCRIPTION_STATUSES:
            raise ValueError(
                f"Invalid description status: {description_status}"
            )
        if work_order_status == "Unique" and (
            candidate_count != 1 or not work_order_number
        ):
            raise ValueError("Invalid Unique Work Order relationship.")
        if work_order_status == "Ambiguous" and (
            candidate_count <= 1 or work_order_number
        ):
            raise ValueError("Invalid Ambiguous Work Order relationship.")
        if work_order_status == "Unresolved" and work_order_number:
            raise ValueError("Unresolved Work Order contains a selected number.")

    work_order_counts = Counter(
        str(row["WorkOrderResolutionStatus"]) for row in lines
    )
    manufacturing_counts = Counter(
        str(row["ManufacturingResolutionType"]) for row in lines
    )
    description_counts = Counter(
        str(row["ItemDescriptionResolutionType"]) for row in lines
    )
    negative_quantity_count = sum(
        Decimal(str(row["QuantityShipped"])) < 0 for row in lines
    )
    negative_extended_price_count = sum(
        Decimal(str(row["ExtendedPrice"])) < 0 for row in lines
    )

    sample = [
        row
        for row in lines
        if row["CustomerNumber"] == "001148"
        and row["InvoiceNumber"] == "0169292"
        and row["SalesOrderNumber"] == "0009422"
        and row["SalesOrderLineNumber"] == "030"
        and row["ItemNumber"] == "277-4169"
    ]
    if (
        len(sample) != 1
        or sample[0]["WorkOrderNumber"] != "0111450"
        or sample[0]["WorkOrderResolutionStatus"] != "Unique"
    ):
        raise ValueError("The corrected known sample did not reconcile.")

    return {
        "verdict": "PASS",
        "headerCount": len(headers),
        "lineCount": len(lines),
        "duplicateHeaderNaturalKeys": duplicate_headers,
        "duplicateLineNaturalKeys": duplicate_lines,
        "orphanLineCount": len(orphans),
        "workOrderResolutionCounts": dict(sorted(work_order_counts.items())),
        "manufacturingResolutionCounts": dict(
            sorted(manufacturing_counts.items())
        ),
        "itemDescriptionResolutionCounts": dict(
            sorted(description_counts.items())
        ),
        "negativeQuantityCount": negative_quantity_count,
        "negativeExtendedPriceCount": negative_extended_price_count,
        "knownSample": sample[0],
    }


def build_package(run_id: str, output_root: Path) -> Path:
    if not re.fullmatch(
        r"INVOICEHISTORYPLATFORM001-\d{8}T\d{6}Z", run_id
    ):
        raise ValueError("The run ID does not match the governed format.")
    if output_root.resolve() != PACKAGE_ROOT.resolve():
        raise ValueError(
            f"Output root must be the approved fixed root: {PACKAGE_ROOT}"
        )

    fingerprints = qualified_art13_fingerprints()
    headers, lines = build_rows()
    validation = validate_rows(headers, lines)

    staging_root = output_root / "Staging" / run_id
    if staging_root.exists():
        raise ValueError(f"Staging run already exists: {staging_root}")
    canonical_root = staging_root / "Canonical"
    evidence_root = staging_root / "Evidence"
    canonical_root.mkdir(parents=True)
    evidence_root.mkdir(parents=True)

    write_csv(canonical_root / "CustomerInvoice.csv", HEADER_FIELDS, headers)
    write_csv(canonical_root / "CustomerInvoiceLine.csv", LINE_FIELDS, lines)

    relationship_rows = [
        {"classification": name, "count": count}
        for name, count in sorted(
            validation["workOrderResolutionCounts"].items()
        )
    ]
    write_csv(
        evidence_root / "relationship_summary.csv",
        ["classification", "count"],
        relationship_rows,
    )

    source_identity = {
        "qualificationRunId": "INVOICEHISTORY001-20260728T233255Z",
        "sources": SOURCE_IDENTITIES,
        "art13QualifiedRead": fingerprints,
        "noSourceWrites": True,
        "locksRequested": False,
        "reportExecuted": False,
        "note": (
            "The baseline uses the two-pass O_RDONLY qualified projection. "
            "The governed runner independently requires current ART-03 and "
            "ART-13 SHA-256 identities to match before and after packaging."
        ),
    }
    (evidence_root / "source_identity.json").write_text(
        json.dumps(source_identity, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (evidence_root / "validation.json").write_text(
        json.dumps(validation, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    content_hash_material = []
    for relative in (
        Path("Canonical/CustomerInvoice.csv"),
        Path("Canonical/CustomerInvoiceLine.csv"),
        Path("Evidence/source_identity.json"),
        Path("Evidence/relationship_summary.csv"),
        Path("Evidence/validation.json"),
    ):
        content_hash_material.append(
            f"{relative.as_posix()}|{sha256_file(staging_root / relative)}"
        )
    content_hash = sha256_text("\n".join(content_hash_material) + "\n")

    manifest = {
        "schema": "DLE_INVOICE_HISTORY_BASELINE_V1",
        "schemaVersion": 1,
        "contractVersion": "1.2",
        "dataEnvironment": "LIVE",
        "runId": run_id,
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "sourceQualificationRunId": "INVOICEHISTORY001-20260728T233255Z",
        "packageContentSha256": content_hash,
        "counts": {
            "CustomerInvoice": len(headers),
            "CustomerInvoiceLine": len(lines),
        },
        "workOrderResolutionCounts": validation[
            "workOrderResolutionCounts"
        ],
        "manufacturingResolutionCounts": validation[
            "manufacturingResolutionCounts"
        ],
        "negativeQuantityCount": validation["negativeQuantityCount"],
        "naturalKey": [
            "FirmId",
            "ArType",
            "CustomerNumber",
            "InvoiceNumber",
            "InvoiceLineNumber",
        ],
        "verdict": "PASS",
    }
    (staging_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    retained = sorted(
        path
        for path in staging_root.rglob("*")
        if path.is_file() and path.name != "hashes.csv"
    )
    write_csv(
        staging_root / "hashes.csv",
        ["RelativePath", "Bytes", "Sha256"],
        [
            {
                "RelativePath": path.relative_to(staging_root).as_posix(),
                "Bytes": path.stat().st_size,
                "Sha256": sha256_file(path),
            }
            for path in retained
        ],
    )

    candidate_root = output_root / "Candidate"
    if candidate_root.exists():
        shutil.rmtree(candidate_root)
    shutil.copytree(staging_root, candidate_root)
    print(
        json.dumps(
            {
                "verdict": "PASS",
                "runId": run_id,
                "stagingPath": str(staging_root),
                "candidatePath": str(candidate_root),
                "packageContentSha256": content_hash,
                "counts": manifest["counts"],
                "workOrderResolutionCounts": manifest[
                    "workOrderResolutionCounts"
                ],
                "manufacturingResolutionCounts": manifest[
                    "manufacturingResolutionCounts"
                ],
                "negativeQuantityCount": manifest["negativeQuantityCount"],
            },
            indent=2,
            sort_keys=True,
        )
    )
    return candidate_root


def main() -> int:
    arguments = parse_arguments()
    try:
        build_package(arguments.run_id, arguments.output_root)
    except Exception as error:
        print(f"Invoice History package build failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

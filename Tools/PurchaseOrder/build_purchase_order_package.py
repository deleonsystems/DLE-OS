from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


HEADER_FIELDS = [
    "FirmId", "PurchaseOrderNumber", "VendorNumber", "VendorName",
    "WarehouseId", "PurchasingAddressCode", "OrderDateRaw", "OrderDateIso",
    "PromisedDateRaw", "PromisedDateIso", "NotBeforeDateRaw",
    "NotBeforeDateIso", "RequiredDateRaw", "RequiredDateIso",
    "LastReceiptDateRaw", "LastReceiptDateIso", "HoldFlag",
    "PrintStatus", "PaymentTermsCode", "FreightTerms", "ShippingMethod",
    "Acknowledgment", "Fob", "MessageCode", "RequisitionNumber",
    "PurchaseOrderStatus", "IsOpen", "IsClosed", "IsCanceled",
    "VendorResolutionStatus", "SourceRecordIdentity",
]
LINE_FIELDS = [
    "FirmId", "PurchaseOrderNumber", "PurchaseOrderLineNumber",
    "VendorNumber", "LineCode", "LineType", "RequiredDateRaw",
    "RequiredDateIso", "PromisedDateRaw", "PromisedDateIso",
    "NotBeforeDateRaw", "NotBeforeDateIso", "UnitOfMeasure",
    "InventoryLocation", "SourceCode", "MessageCode", "WorkOrderNumber",
    "CustomerNumber", "SalesOrderNumber", "SalesOrderLineNumber",
    "ShipToNumber", "WarehouseId", "ItemNumber", "ItemDescription",
    "OrderMemo", "ConversionFactor", "QuantityRequested",
    "QuantityOrdered", "QuantityReceived", "QuantityOpen",
    "QuantityInQualityWip", "QuantityAcceptedFromQuality",
    "QuantityRejected", "QuantityInvoiced", "LineStatus", "IsOpen",
    "IsClosed", "IsCanceled", "InventoryResolutionStatus",
    "WorkOrderResolutionStatus", "SalesOrderResolutionStatus",
    "SourceRecordIdentity",
]
RESTRICTED_FIELDS = {"UnitCost", "ExtendedCost", "InternalApprovalComments"}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fields, extrasaction="raise", quoting=csv.QUOTE_ALL,
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def optional(value: str) -> str | None:
    value = value.rstrip()
    return value or None


def boolean(value: bool) -> str:
    return "true" if value else "false"


def decimal_value(value: bytes, field: str) -> Decimal:
    text = value.decode("latin-1").strip() or "0"
    try:
        return Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f"Invalid decimal in {field}: {text!r}") from error


def decimal_text(value: Decimal) -> str:
    result = format(value, "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return result or "0"


def legacy_date(raw: str, snapshot_year: int) -> str | None:
    value = raw.strip()
    if not value or value in {"000000", "XXXXXX"}:
        return None
    if len(value) != 6:
        raise ValueError(f"Legacy date has wrong length: {raw!r}")
    first_year = value[0]
    if first_year.isdigit():
        decade = first_year
    elif first_year in "ABCDEFGHIJ":
        decade = str(ord(first_year) - ord("A"))
    else:
        raise ValueError(f"Invalid Add+ON YY21 date prefix: {raw!r}")
    if not value[1:].isdigit():
        raise ValueError(f"Invalid Add+ON YYMMDD date: {raw!r}")
    yy = int(decade + value[1])
    month = int(value[2:4])
    day = int(value[4:6])
    # The governing programs name this routine FNYY21_YY$: A..J encode
    # decades 00..90 and are converted back to a two-digit year for display.
    # Preserve the platform's established lower bound while allowing future
    # PO requirement/promised dates.
    year = 1900 + yy if yy >= 95 else 2000 + yy
    if year < 1995 or year > snapshot_year + 25:
        raise ValueError(f"PO date outside qualified horizon: {raw!r}")
    try:
        return date(year, month, day).isoformat()
    except ValueError as error:
        raise ValueError(f"Invalid legacy calendar date: {raw!r}") from error


def split_record(row: dict[str, str], expected_key_length: int) -> tuple[str, list[bytes]]:
    key = bytes.fromhex(row["key_hex"])
    raw = bytes.fromhex(row["raw_record_hex"])
    if len(key) != expected_key_length or raw[:expected_key_length] != key:
        raise ValueError(f"Key mismatch: {row['key_hex']}")
    if raw[expected_key_length:expected_key_length + 1] != b"\n":
        raise ValueError(f"Missing key delimiter: {row['key_hex']}")
    return key.decode("latin-1"), raw[expected_key_length + 1:].split(b"\n")


def slice_block(block: bytes, specs: list[tuple[str, int]]) -> dict[str, str]:
    position = 0
    result: dict[str, str] = {}
    for field, length in specs:
        result[field] = block[position:position + length].decode("latin-1")
        position += length
    if len(block) != position:
        raise ValueError(f"String block length {len(block)} != {position}")
    return result


def load_vendor(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    return {
        (row["FirmId"], row["VendorNumber"]): row
        for row in read_csv(path)
    }


def load_inventory(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    result: dict[tuple[str, str], dict[str, str]] = {}
    for row in read_csv(path):
        source_key = row["SourceKeyRaw"]
        firm = source_key[:2]
        item = row["ItemNumber"].strip()
        if item:
            result[(firm, item)] = row
    return result


def load_work_orders(path: Path) -> set[tuple[str, str]]:
    return {
        (row["SourceKeyRaw"][:2], row["WorkOrderNumber"].strip())
        for row in read_csv(path)
        if row["WorkOrderNumber"].strip()
    }


def load_sales_orders(path: Path) -> set[tuple[str, str, str, str]]:
    return {
        (
            "01", row["CustomerNumber"].strip(),
            row["SalesOrderNumber"].strip(), row["LineNumber"].strip(),
        )
        for row in read_csv(path)
    }


def build(args: argparse.Namespace) -> dict[str, object]:
    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    snapshot_year = args.snapshot_year
    vendors = load_vendor(args.vendor.resolve())
    inventory = load_inventory(args.inventory.resolve())
    work_orders = load_work_orders(args.work_order.resolve())
    sales_orders = load_sales_orders(args.sales_order_line.resolve())

    header_specs = [
        ("WarehouseId", 2), ("PurchasingAddressCode", 2),
        ("OrderDateRaw", 6), ("PromisedDateRaw", 6),
        ("NotBeforeDateRaw", 6), ("RequiredDateRaw", 6),
        ("LastReceiptDateRaw", 6), ("HoldFlag", 1), ("PrintStatus", 1),
        ("ReservedFlag", 1), ("PaymentTermsCode", 2), ("ReservedArray", 4),
        ("FreightTerms", 15), ("ShippingMethod", 15),
        ("Acknowledgment", 20), ("Fob", 15), ("MessageCode", 3),
        ("RequisitionNumber", 7), ("ReservedTail", 42),
    ]
    line_group1_specs = [
        ("LineCode", 2), ("RequiredDateRaw", 6),
        ("PromisedDateRaw", 6), ("NotBeforeDateRaw", 6),
        ("LeadTimeFlag", 1), ("UnitOfMeasure", 2),
        ("InventoryLocation", 10), ("SourceCode", 1), ("Forecast", 3),
        ("MessageCode", 3),
    ]
    line_group2_specs = [
        ("WorkOrderNumber", 7), ("SequenceNumber", 3),
        ("CustomerNumber", 6), ("SalesOrderNumber", 7),
        ("SalesOrderLineNumber", 3), ("ShipToNumber", 6),
    ]

    header_rows: list[dict[str, object]] = []
    header_keys: set[tuple[str, str, str]] = set()
    physical_header_keys: set[tuple[str, str, str]] = set()
    invalid_header_rows: list[dict[str, object]] = []
    vendor_resolution = Counter()
    blank_physical_headers = 0
    for row in read_csv(source / "POE-02.csv"):
        key, parts = split_record(row, 15)
        if not key.strip():
            blank_physical_headers += 1
            continue
        firm, vendor_number, po_number = key[:2], key[2:8], key[8:15]
        if not firm.strip() or not vendor_number.strip() or not po_number.strip():
            invalid_header_rows.append({
                "FirmId": firm,
                "VendorNumber": vendor_number,
                "PurchaseOrderNumber": po_number,
                "SourceRecordIdentity": row["key_hex"],
                "Classification": "MissingRequiredNaturalKeyExcluded",
                "Reason": "Firm, vendor, and PO number are all required",
            })
            continue
        physical_key = (firm, vendor_number, po_number)
        canonical_key = physical_key
        if physical_key in physical_header_keys:
            raise ValueError(f"Duplicate physical header key: {physical_key}")
        if canonical_key in header_keys:
            raise ValueError(f"Duplicate canonical PO key: {canonical_key}")
        physical_header_keys.add(physical_key)
        header_keys.add(canonical_key)
        if len(parts) < 1 or len(parts[0]) != 160:
            raise ValueError(f"POE-02 block mismatch: {key!r}")
        values = slice_block(parts[0], header_specs)
        vendor = vendors.get((firm, vendor_number))
        resolution = "Resolved" if vendor else "MissingCurrentVendor"
        vendor_resolution[resolution] += 1
        header_rows.append({
            "FirmId": firm,
            "PurchaseOrderNumber": po_number,
            "VendorNumber": vendor_number,
            "VendorName": optional(vendor["VendorName"]) if vendor else None,
            "WarehouseId": optional(values["WarehouseId"]),
            "PurchasingAddressCode": optional(values["PurchasingAddressCode"]),
            "OrderDateRaw": optional(values["OrderDateRaw"]),
            "OrderDateIso": legacy_date(values["OrderDateRaw"], snapshot_year),
            "PromisedDateRaw": optional(values["PromisedDateRaw"]),
            "PromisedDateIso": legacy_date(values["PromisedDateRaw"], snapshot_year),
            "NotBeforeDateRaw": optional(values["NotBeforeDateRaw"]),
            "NotBeforeDateIso": legacy_date(values["NotBeforeDateRaw"], snapshot_year),
            "RequiredDateRaw": optional(values["RequiredDateRaw"]),
            "RequiredDateIso": legacy_date(values["RequiredDateRaw"], snapshot_year),
            "LastReceiptDateRaw": optional(values["LastReceiptDateRaw"]),
            "LastReceiptDateIso": legacy_date(values["LastReceiptDateRaw"], snapshot_year),
            "HoldFlag": optional(values["HoldFlag"]),
            "PrintStatus": optional(values["PrintStatus"]),
            "PaymentTermsCode": optional(values["PaymentTermsCode"]),
            "FreightTerms": optional(values["FreightTerms"]),
            "ShippingMethod": optional(values["ShippingMethod"]),
            "Acknowledgment": optional(values["Acknowledgment"]),
            "Fob": optional(values["Fob"]),
            "MessageCode": optional(values["MessageCode"]),
            "RequisitionNumber": optional(values["RequisitionNumber"]),
            "PurchaseOrderStatus": "ActiveOpenFile",
            "IsOpen": "true", "IsClosed": "false", "IsCanceled": "false",
            "VendorResolutionStatus": resolution,
            "SourceRecordIdentity": row["key_hex"],
        })

    line_rows: list[dict[str, object]] = []
    line_keys: set[tuple[str, str, str, str]] = set()
    physical_line_keys: set[tuple[str, str, str, str]] = set()
    parents: set[tuple[str, str, str]] = set()
    line_statuses = Counter()
    line_types = Counter()
    inventory_resolution = Counter()
    work_order_resolution = Counter()
    sales_order_resolution = Counter()
    negative_quantity_lines = 0
    zero_quantity_lines = 0
    no_receipt_open_lines = 0
    partially_received_lines = 0
    fully_received_lines = 0
    restricted_cost_rows: list[dict[str, object]] = []
    orphan_line_rows: list[dict[str, object]] = []
    for row in read_csv(source / "POE-12.csv"):
        key, parts = split_record(row, 18)
        firm, vendor_number, po_number, line_number = (
            key[:2], key[2:8], key[8:15], key[15:18]
        )
        if (
            not firm.strip() or not vendor_number.strip()
            or not po_number.strip() or not line_number.strip()
        ):
            orphan_line_rows.append({
                "FirmId": firm, "VendorNumber": vendor_number,
                "PurchaseOrderNumber": po_number,
                "PurchaseOrderLineNumber": line_number,
                "SourceRecordIdentity": row["key_hex"],
                "Classification": "MissingRequiredNaturalKeyExcluded",
                "Reason": "Firm, vendor, PO number, and line are all required",
            })
            continue
        physical_key = (firm, vendor_number, po_number, line_number)
        canonical_key = physical_key
        if physical_key in physical_line_keys:
            raise ValueError(f"Duplicate physical line key: {physical_key}")
        if canonical_key in line_keys:
            raise ValueError(f"Duplicate canonical line key: {canonical_key}")
        physical_line_keys.add(physical_key)
        line_keys.add(canonical_key)
        parent = (firm, vendor_number, po_number)
        parents.add(parent)
        if parent not in header_keys:
            orphan_line_rows.append({
                "FirmId": firm, "VendorNumber": vendor_number,
                "PurchaseOrderNumber": po_number,
                "PurchaseOrderLineNumber": line_number,
                "SourceRecordIdentity": row["key_hex"],
                "Classification": "OrphanPhysicalDetailExcluded",
                "Reason": "No exact POE-02 parent for firm/vendor/PO key",
            })
            continue
        if len(parts) < 19:
            raise ValueError(f"POE-12 group collapse: {key!r}")
        if len(parts[0]) not in {48, 64} or parts[0][40:].strip():
            raise ValueError(f"POE-12 legacy string suffix mismatch: {key!r}")
        group1 = slice_block(parts[0][:40], line_group1_specs)
        group2 = slice_block(parts[1], line_group2_specs)
        if len(parts[2]) != 22 or len(parts[3]) != 40:
            raise ValueError(f"POE-12 item/memo block mismatch: {key!r}")
        warehouse_id = parts[2][:2].decode("latin-1")
        item_number = parts[2][2:].decode("latin-1").rstrip()
        order_memo = parts[3].decode("latin-1").rstrip()
        numeric = parts[6:19]
        conversion = decimal_value(numeric[0], "ConversionFactor")
        unit_cost = decimal_value(numeric[1], "UnitCost")
        requested = decimal_value(numeric[2], "QuantityRequested")
        ordered = decimal_value(numeric[3], "QuantityOrdered")
        quality_wip = decimal_value(numeric[4], "QuantityInQualityWip")
        quality_accepted = decimal_value(numeric[5], "QuantityAcceptedFromQuality")
        rejected = decimal_value(numeric[6], "QuantityRejected")
        received = decimal_value(numeric[7], "QuantityReceived")
        invoiced = decimal_value(numeric[8], "QuantityInvoiced")
        quantity_open = ordered - received
        if ordered < 0 or received < 0 or quantity_open < 0:
            negative_quantity_lines += 1
        if ordered == 0:
            zero_quantity_lines += 1
        if received == 0 and quantity_open > 0:
            no_receipt_open_lines += 1
        if received != 0 and quantity_open > 0:
            partially_received_lines += 1
        if received != 0 and quantity_open == 0:
            fully_received_lines += 1
        status = (
            "Open" if quantity_open > 0
            else "FullyReceivedPendingClose" if quantity_open == 0
            else "OverReceivedOrReturn"
        )
        line_statuses[status] += 1
        line_code = group1["LineCode"].strip()
        line_type = (
            "Stock" if line_code == "S"
            else "NonStock" if line_code in {"M", "N"}
            else "Other"
        )
        line_types[line_type] += 1
        inventory_row = inventory.get((firm, item_number)) if item_number else None
        inventory_status = (
            "NotApplicableNonStock" if line_type != "Stock"
            else "Resolved" if inventory_row
            else "MissingCurrentInventory"
        )
        inventory_resolution[inventory_status] += 1
        work_order_number = group2["WorkOrderNumber"].strip()
        work_status = (
            "Resolved" if work_order_number and (firm, work_order_number) in work_orders
            else "MissingCurrentWorkOrder" if work_order_number
            else "NotReferenced"
        )
        work_order_resolution[work_status] += 1
        customer_number = group2["CustomerNumber"].strip()
        sales_order_number = group2["SalesOrderNumber"].strip()
        sales_order_line = group2["SalesOrderLineNumber"].strip()
        sales_reference = bool(customer_number or sales_order_number or sales_order_line)
        sales_key = (firm, customer_number, sales_order_number, sales_order_line)
        sales_status = (
            "Resolved" if sales_reference and sales_key in sales_orders
            else "MissingCurrentSalesOrder" if sales_reference
            else "NotReferenced"
        )
        sales_order_resolution[sales_status] += 1
        item_description = (
            optional(inventory_row["ItemDescription"]) if inventory_row else None
        )
        line_rows.append({
            "FirmId": firm, "PurchaseOrderNumber": po_number,
            "PurchaseOrderLineNumber": line_number,
            "VendorNumber": vendor_number, "LineCode": line_code or None,
            "LineType": line_type,
            "RequiredDateRaw": optional(group1["RequiredDateRaw"]),
            "RequiredDateIso": legacy_date(group1["RequiredDateRaw"], snapshot_year),
            "PromisedDateRaw": optional(group1["PromisedDateRaw"]),
            "PromisedDateIso": legacy_date(group1["PromisedDateRaw"], snapshot_year),
            "NotBeforeDateRaw": optional(group1["NotBeforeDateRaw"]),
            "NotBeforeDateIso": legacy_date(group1["NotBeforeDateRaw"], snapshot_year),
            "UnitOfMeasure": optional(group1["UnitOfMeasure"]),
            "InventoryLocation": optional(group1["InventoryLocation"]),
            "SourceCode": optional(group1["SourceCode"]),
            "MessageCode": optional(group1["MessageCode"]),
            "WorkOrderNumber": work_order_number or None,
            "CustomerNumber": customer_number or None,
            "SalesOrderNumber": sales_order_number or None,
            "SalesOrderLineNumber": sales_order_line or None,
            "ShipToNumber": optional(group2["ShipToNumber"]),
            "WarehouseId": optional(warehouse_id),
            "ItemNumber": item_number or None,
            "ItemDescription": item_description,
            "OrderMemo": optional(order_memo),
            "ConversionFactor": decimal_text(conversion),
            "QuantityRequested": decimal_text(requested),
            "QuantityOrdered": decimal_text(ordered),
            "QuantityReceived": decimal_text(received),
            "QuantityOpen": decimal_text(quantity_open),
            "QuantityInQualityWip": decimal_text(quality_wip),
            "QuantityAcceptedFromQuality": decimal_text(quality_accepted),
            "QuantityRejected": decimal_text(rejected),
            "QuantityInvoiced": decimal_text(invoiced),
            "LineStatus": status,
            "IsOpen": boolean(quantity_open > 0),
            "IsClosed": "false", "IsCanceled": "false",
            "InventoryResolutionStatus": inventory_status,
            "WorkOrderResolutionStatus": work_status,
            "SalesOrderResolutionStatus": sales_status,
            "SourceRecordIdentity": row["key_hex"],
        })
        restricted_cost_rows.append({
            "FirmId": firm, "VendorNumber": vendor_number,
            "PurchaseOrderNumber": po_number,
            "PurchaseOrderLineNumber": line_number,
            "UnitCost": decimal_text(unit_cost),
            "ExtendedCost": decimal_text(unit_cost * quantity_open),
            "AccessClassification": "AccountingRestricted",
        })

    headers_without_lines = header_keys - parents
    if RESTRICTED_FIELDS.intersection(HEADER_FIELDS + LINE_FIELDS):
        raise ValueError("Restricted cost fields leaked into operational package")

    header_rows.sort(key=lambda row: (
        str(row["FirmId"]), str(row["VendorNumber"]),
        str(row["PurchaseOrderNumber"]),
    ))
    line_rows.sort(key=lambda row: (
        str(row["FirmId"]), str(row["VendorNumber"]),
        str(row["PurchaseOrderNumber"]),
        str(row["PurchaseOrderLineNumber"]),
    ))
    write_csv(output / "PurchaseOrder.csv", header_rows, HEADER_FIELDS)
    write_csv(output / "PurchaseOrderLine.csv", line_rows, LINE_FIELDS)
    write_csv(
        output / "RestrictedCostQualification.csv", restricted_cost_rows,
        [
            "FirmId", "VendorNumber", "PurchaseOrderNumber",
            "PurchaseOrderLineNumber",
            "UnitCost", "ExtendedCost", "AccessClassification",
        ],
    )
    write_csv(
        output / "OrphanPurchaseOrderLine.csv", orphan_line_rows,
        [
            "FirmId", "VendorNumber", "PurchaseOrderNumber",
            "PurchaseOrderLineNumber", "SourceRecordIdentity",
            "Classification", "Reason",
        ],
    )
    write_csv(
        output / "InvalidPurchaseOrderHeader.csv", invalid_header_rows,
        [
            "FirmId", "VendorNumber", "PurchaseOrderNumber",
            "SourceRecordIdentity", "Classification", "Reason",
        ],
    )

    source_counts = {
        name: len(read_csv(source / f"{name}.csv"))
        for name in ("POE-02", "POE-12", "POE-04", "POE-14", "POT-04", "POT-14")
    }
    metadata: dict[str, object] = {
        "ContractVersion": "PURCHASE_ORDER_1.0",
        "CreatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "SnapshotYear": snapshot_year,
        "HarnessAttemptId": args.harness_attempt,
        "SourceCounts": source_counts,
        "HeaderCount": len(header_rows),
        "LineCount": len(line_rows),
        "BlankPhysicalHeadersExcluded": blank_physical_headers,
        "InvalidPhysicalHeaderKeysExcluded": len(invalid_header_rows),
        "InvalidPhysicalLineKeysExcluded": sum(
            row["Classification"] == "MissingRequiredNaturalKeyExcluded"
            for row in orphan_line_rows
        ),
        "HeaderNaturalKey": [
            "FirmId", "VendorNumber", "PurchaseOrderNumber"
        ],
        "LineNaturalKey": [
            "FirmId", "VendorNumber", "PurchaseOrderNumber",
            "PurchaseOrderLineNumber"
        ],
        "DuplicateHeaderKeys": 0, "DuplicateLineKeys": 0,
        "SourceOrphanLinesExcluded": len(orphan_line_rows),
        "CanonicalOrphanLines": 0,
        "HeadersWithoutLines": len(headers_without_lines),
        "HeaderStatusCounts": {"ActiveOpenFile": len(header_rows)},
        "LineStatusCounts": dict(line_statuses),
        "OpenLinesNoReceipts": no_receipt_open_lines,
        "PartiallyReceivedLines": partially_received_lines,
        "FullyReceivedLines": fully_received_lines,
        "ClosedLines": 0,
        "CanceledLines": 0,
        "LineTypeCounts": dict(line_types),
        "NegativeQuantityLines": negative_quantity_lines,
        "ZeroQuantityLines": zero_quantity_lines,
        "VendorResolution": dict(vendor_resolution),
        "InventoryResolution": dict(inventory_resolution),
        "WorkOrderResolution": dict(work_order_resolution),
        "SalesOrderResolution": dict(sales_order_resolution),
        "QuantityOpenFormula": "QuantityOrdered - QuantityReceived",
        "ReceiptHistoryEntity": "DeferredToReceivingHistoryPlatform001",
        "RestrictedCostRows": len(restricted_cost_rows),
    }
    (output / "metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    manifest_files = [
        "PurchaseOrder.csv", "PurchaseOrderLine.csv",
        "RestrictedCostQualification.csv", "OrphanPurchaseOrderLine.csv",
        "InvalidPurchaseOrderHeader.csv",
        "metadata.json",
    ]
    manifest = {
        "ContractVersion": "PURCHASE_ORDER_1.0",
        "HarnessAttemptId": args.harness_attempt,
        "Files": [
            {"Path": name, "Sha256": sha256(output / name)}
            for name in manifest_files
        ],
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    package_hash = sha256(manifest_path)
    (output / "package.sha256").write_text(
        package_hash + "  manifest.json\n", encoding="ascii"
    )
    metadata["PackageSha256"] = package_hash
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--vendor", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--work-order", type=Path, required=True)
    parser.add_argument("--sales-order-line", type=Path, required=True)
    parser.add_argument("--harness-attempt", required=True)
    parser.add_argument("--snapshot-year", type=int, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args), indent=2))


if __name__ == "__main__":
    main()

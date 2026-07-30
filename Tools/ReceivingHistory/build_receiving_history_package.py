from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


HEADER_FIELDS = [
    "FirmId", "VendorNumber", "PurchaseOrderNumber", "ReceiverNumber",
    "ReceiptDateRaw", "ReceiptDateIso", "ReceiptDateResolutionStatus",
    "ReceiptDateResolutionReason", "OrderDateRaw", "OrderDateIso",
    "OrderDateResolutionStatus", "OrderDateResolutionReason",
    "WarehouseId", "PurchasingAddressCode", "PackingSlipNumber",
    "PaymentTermsCode", "FreightTerms", "ShippingMethod", "Acknowledgment",
    "Fob", "MessageCode", "ReceiptStatus", "ReceiptType",
    "VendorName", "VendorResolutionStatus", "PurchaseOrderResolutionStatus",
    "SourceRecordIdentity",
]
LINE_FIELDS = [
    "FirmId", "VendorNumber", "PurchaseOrderNumber", "ReceiverNumber",
    "ReceiptLineNumber", "ReceiptDateIso", "LineCode", "LineType",
    "PurchaseOrderLineNumber", "RequiredDateRaw", "RequiredDateIso",
    "RequiredDateResolutionStatus", "RequiredDateResolutionReason",
    "UnitOfMeasure", "InventoryLocation", "WarehouseId", "ItemNumber",
    "ItemDescription", "OrderMemo", "WorkOrderNumber", "SalesOrderNumber",
    "SalesOrderLineNumber", "QuantityPostedSigned", "QuantityReceived",
    "QuantityAccepted", "QuantityRejected", "QuantityReturned",
    "QuantityInvoiced", "QuantityDispositionStatus", "InspectionStatus",
    "PurchaseOrderResolutionStatus", "InventoryResolutionStatus",
    "WorkOrderResolutionStatus", "PurchaseReceiptSourceRecordIdentity",
    "SourceRecordIdentity",
]
REJECTION_FIELDS = [
    "FirmId", "VendorNumber", "PurchaseOrderNumber", "ReceiverNumber",
    "ReceiptLineNumber", "RejectionSequence", "RejectionCode",
    "OperatorCode", "ReturnAuthorizationNumber", "QuantityRejected",
    "PurchaseReceiptLineSourceRecordIdentity", "SourceRecordIdentity",
]


def read_csv(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def decimal_value(value: bytes, field: str) -> Decimal:
    text = value.decode("latin-1").strip() or "0"
    try:
        return Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f"Invalid decimal in {field}: {text!r}") from error


def decimal_text(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def optional(value: str) -> str | None:
    value = value.rstrip()
    return value or None


def legacy_date(raw: str, snapshot_year: int) -> str | None:
    value = raw.strip()
    if not value or value in {"000000", "XXXXXX"}:
        return None
    if len(value) != 6:
        raise ValueError(f"Legacy date has wrong length: {raw!r}")
    prefix = value[0]
    if prefix.isdigit():
        decade = prefix
    elif prefix in "ABCDEFGHIJ":
        decade = str(ord(prefix) - ord("A"))
    else:
        raise ValueError(f"Invalid Add+ON YY21 prefix: {raw!r}")
    if not value[1:].isdigit():
        raise ValueError(f"Invalid Add+ON YYMMDD date: {raw!r}")
    year_two = int(decade + value[1])
    year = 1900 + year_two if year_two >= 95 else 2000 + year_two
    if year < 1995 or year > snapshot_year:
        raise ValueError(f"Receipt date outside qualified horizon: {raw!r}")
    try:
        return date(year, int(value[2:4]), int(value[4:6])).isoformat()
    except ValueError as error:
        raise ValueError(f"Invalid legacy calendar date: {raw!r}") from error


def resolve_optional_legacy_date(
    raw: str, snapshot_year: int
) -> tuple[str | None, str, str | None]:
    value = raw.strip()
    if not value or value in {"000000", "XXXXXX"}:
        return None, "BlankSourceValue", None
    if len(value) != 6:
        raise ValueError(f"Legacy date has wrong length: {raw!r}")
    prefix = value[0]
    if prefix.isdigit():
        decade = prefix
    elif prefix in "ABCDEFGHIJ":
        decade = str(ord(prefix) - ord("A"))
    else:
        raise ValueError(f"Invalid Add+ON YY21 prefix: {raw!r}")
    if not value[1:].isdigit():
        raise ValueError(f"Invalid Add+ON YYMMDD date: {raw!r}")
    year_two = int(decade + value[1])
    year = 1900 + year_two if year_two >= 95 else 2000 + year_two
    try:
        parsed = date(year, int(value[2:4]), int(value[4:6]))
    except ValueError as error:
        raise ValueError(f"Invalid legacy calendar date: {raw!r}") from error
    if year < 1995 or year > snapshot_year:
        return (
            None,
            "InvalidSourceValue",
            "Decoded date exceeds qualified historical/snapshot horizon",
        )
    return parsed.isoformat(), "Resolved", None


def resolve_order_date(
    raw: str, snapshot_year: int
) -> tuple[str | None, str, str | None]:
    value = raw.strip()
    if not value or value in {"000000", "XXXXXX"}:
        return None, "BlankSourceValue", None
    if len(value) != 6:
        raise ValueError(f"Legacy date has wrong length: {raw!r}")
    prefix = value[0]
    if prefix.isdigit():
        decade = prefix
    elif prefix in "ABCDEFGHIJ":
        decade = str(ord(prefix) - ord("A"))
    else:
        raise ValueError(f"Invalid Add+ON YY21 prefix: {raw!r}")
    if not value[1:].isdigit():
        raise ValueError(f"Invalid Add+ON YYMMDD date: {raw!r}")
    year_two = int(decade + value[1])
    year = 1900 + year_two if year_two >= 95 else 2000 + year_two
    try:
        parsed = date(year, int(value[2:4]), int(value[4:6]))
    except ValueError as error:
        raise ValueError(f"Invalid legacy calendar date: {raw!r}") from error
    if year < 1995 or year > snapshot_year:
        return (
            None,
            "InvalidSourceValue",
            "Decoded date exceeds qualified snapshot horizon",
        )
    return parsed.isoformat(), "Resolved", None


def validate_malformed_order_date_count(
    observed: int, expected: int
) -> None:
    if observed != expected:
        raise ValueError(
            "Malformed Order Date count is outside the qualified baseline: "
            f"expected {expected}, observed {observed}"
        )


def validate_missing_purchase_order_count(
    observed: int, expected: int
) -> None:
    if observed != expected:
        raise ValueError(
            "Blank Purchase Order count is outside the qualified baseline: "
            f"expected {expected}, observed {observed}"
        )


def validate_field_date_count(
    field: str, observed: int, expected: int
) -> None:
    if observed != expected:
        raise ValueError(
            f"Malformed {field} count is outside the qualified baseline: "
            f"expected {expected}, observed {observed}"
        )


def require_unique_source_identity(
    identity: str, seen: set[str], entity: str
) -> None:
    if not re.fullmatch(r"[0-9A-F]+", identity) or identity in seen:
        raise ValueError(f"Invalid or duplicate {entity} source key: {identity}")
    seen.add(identity)


def split_record(
    row: dict[str, str], expected_key_length: int
) -> tuple[str, list[bytes]]:
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


def load_vendors(path: Path) -> dict[tuple[str, str], str | None]:
    return {
        (row["FirmId"], row["VendorNumber"]): optional(row["VendorName"])
        for row in read_csv(path)
    }


def load_inventory(path: Path) -> dict[tuple[str, str], str | None]:
    result: dict[tuple[str, str], str | None] = {}
    for row in read_csv(path):
        firm = row["SourceKeyRaw"][:2]
        item = row["ItemNumber"].strip()
        if item:
            result[(firm, item)] = optional(row["ItemDescription"])
    return result


def load_work_orders(path: Path) -> set[tuple[str, str]]:
    return {
        (row["SourceKeyRaw"][:2], row["WorkOrderNumber"].strip())
        for row in read_csv(path)
        if row["WorkOrderNumber"].strip()
    }


def load_purchase_orders(
    header_path: Path, line_path: Path
) -> tuple[set[tuple[str, str, str]], dict[tuple[str, str, str, str], Decimal]]:
    headers = {
        (row["FirmId"], row["VendorNumber"], row["PurchaseOrderNumber"])
        for row in read_csv(header_path)
    }
    lines = {
        (
            row["FirmId"], row["VendorNumber"], row["PurchaseOrderNumber"],
            row["PurchaseOrderLineNumber"],
        ): Decimal(row["QuantityReceived"])
        for row in read_csv(line_path)
    }
    return headers, lines


def write_rows(path: Path, fields: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fields, extrasaction="raise", quoting=csv.QUOTE_ALL,
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def build(args: argparse.Namespace) -> dict[str, object]:
    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    qualification = json.loads(
        args.qualification.resolve().read_text(encoding="utf-8-sig")
    )
    if (
        qualification.get("Verdict") != "PASS"
        or qualification.get("Algorithm") != "VPRO_KEY_RECORD_SHA256_V1"
        or not all(
            row.get("PassesIdentical") is True
            for row in qualification.get("Sources", [])
        )
        or {row.get("Source") for row in qualification.get("Sources", [])}
        != {"POT-03", "POT-04", "POT-14"}
    ):
        raise ValueError("Source qualification is outside the approved boundary")

    vendors = load_vendors(args.vendor.resolve())
    inventory = load_inventory(args.inventory.resolve())
    work_orders = load_work_orders(args.work_order.resolve())
    active_po_headers, active_po_lines = load_purchase_orders(
        args.purchase_order.resolve(), args.purchase_order_line.resolve()
    )

    header_specs = [
        ("WarehouseId", 2), ("PurchasingAddressCode", 2),
        ("OrderDateRaw", 6), ("PromisedDateRaw", 6),
        ("NotBeforeDateRaw", 6), ("RequiredDateRaw", 6),
        ("ReceiptDateRaw", 6), ("HoldFlag", 1), ("PrintStatus", 1),
        ("ReservedFlag", 1), ("PaymentTermsCode", 2), ("ReservedArray", 4),
        ("FreightTerms", 15), ("ShippingMethod", 15),
        ("Acknowledgment", 20), ("Fob", 15), ("MessageCode", 3),
        ("RequisitionNumber", 7), ("PackingSlipNumber", 15),
        ("ReservedTail", 27),
    ]
    line_group1_specs = [
        ("LineCode", 2), ("RequiredDateRaw", 6),
        ("PromisedDateRaw", 6), ("NotBeforeDateRaw", 6),
        ("LeadTimeFlag", 1), ("UnitOfMeasure", 2),
        ("InventoryLocation", 10), ("SourceCode", 1), ("Forecast", 3),
        ("MessageCode", 3),
    ]
    line_group2_specs = [
        ("WorkOrderNumber", 7), ("WorkOrderSequence", 3),
        ("CustomerNumber", 6), ("SalesOrderNumber", 7),
        ("SalesOrderLineNumber", 3), ("ShipToNumber", 6),
    ]

    header_rows: list[dict[str, object]] = []
    header_keys: set[tuple[str, str, str, str]] = set()
    header_source_identities: set[str] = set()
    header_identity_by_key: dict[tuple[str, str, str, str], str] = {}
    header_dates: dict[tuple[str, str, str, str], str | None] = {}
    vendor_resolution = Counter()
    po_header_resolution = Counter()
    order_date_resolution = Counter()
    receipt_date_resolution = Counter()
    malformed_order_dates: list[dict[str, str]] = []
    malformed_receipt_dates: list[dict[str, str]] = []
    missing_purchase_orders: list[dict[str, str]] = []
    for source_row in read_csv(source / "POT-04.csv"):
        key, parts = split_record(source_row, 22)
        firm, vendor, po, receiver = key[:2], key[2:8], key[8:15], key[15:22]
        natural_key = (firm, vendor, po, receiver)
        source_identity = source_row["key_hex"]
        if not firm.strip() or not vendor.strip() or not receiver.strip():
            raise ValueError(f"Missing required receipt-header key: {key!r}")
        require_unique_source_identity(
            source_identity, header_source_identities, "receipt-header"
        )
        if natural_key in header_keys:
            raise ValueError(f"Duplicate receipt-header key: {natural_key}")
        header_keys.add(natural_key)
        header_identity_by_key[natural_key] = source_identity
        if not parts or len(parts[0]) != 160:
            raise ValueError(f"POT-04 header block mismatch: {key!r}")
        values = slice_block(parts[0], header_specs)
        (
            receipt_date,
            receipt_date_status,
            receipt_date_reason,
        ) = resolve_optional_legacy_date(
            values["ReceiptDateRaw"], args.snapshot_year
        )
        receipt_date_resolution[receipt_date_status] += 1
        if receipt_date_status == "InvalidSourceValue":
            malformed_receipt_dates.append({
                "HeaderSourceRecordIdentity": source_identity,
                "FirmId": firm,
                "VendorNumber": vendor,
                "PurchaseOrderNumber": po.strip(),
                "ReceiverNumber": receiver,
                "ReceiptDateRaw": values["ReceiptDateRaw"],
                "ReceiptDateIso": "",
                "ReceiptDateResolutionStatus": receipt_date_status,
                "ReceiptDateResolutionReason": receipt_date_reason or "",
            })
        (
            order_date,
            order_date_status,
            order_date_reason,
        ) = resolve_order_date(values["OrderDateRaw"], args.snapshot_year)
        order_date_resolution[order_date_status] += 1
        if order_date_status == "InvalidSourceValue":
            malformed_order_dates.append({
                "HeaderNaturalKey": "".join(natural_key),
                "FirmId": firm,
                "VendorNumber": vendor,
                "PurchaseOrderNumber": po,
                "ReceiverNumber": receiver,
                "OrderDateRaw": values["OrderDateRaw"],
                "OrderDateIso": "",
                "OrderDateResolutionStatus": order_date_status,
                "OrderDateResolutionReason": order_date_reason or "",
            })
        header_dates[natural_key] = receipt_date
        vendor_name = vendors.get((firm, vendor))
        vendor_status = "Resolved" if (firm, vendor) in vendors else "MissingCurrentVendor"
        if not po.strip():
            po_status = "MissingRequiredSourceValue"
            missing_purchase_orders.append({
                "SourceRecordIdentity": source_identity,
                "FirmId": firm,
                "VendorNumber": vendor,
                "PurchaseOrderNumber": "",
                "ReceiverNumber": receiver,
                "ResolutionStatus": po_status,
                "ResolutionReason": (
                    "Qualified source key contains a blank Purchase Order segment"
                ),
            })
        else:
            po_status = (
                "ResolvedActivePurchaseOrder"
                if (firm, vendor, po) in active_po_headers
                else "AbsentFromActivePurchaseOrders"
            )
        vendor_resolution[vendor_status] += 1
        po_header_resolution[po_status] += 1
        header_rows.append({
            "FirmId": firm, "VendorNumber": vendor,
            "PurchaseOrderNumber": po.strip() or None,
            "ReceiverNumber": receiver,
            "ReceiptDateRaw": optional(values["ReceiptDateRaw"]),
            "ReceiptDateIso": receipt_date,
            "ReceiptDateResolutionStatus": receipt_date_status,
            "ReceiptDateResolutionReason": receipt_date_reason,
            "OrderDateRaw": optional(values["OrderDateRaw"]),
            "OrderDateIso": order_date,
            "OrderDateResolutionStatus": order_date_status,
            "OrderDateResolutionReason": order_date_reason,
            "WarehouseId": optional(values["WarehouseId"]),
            "PurchasingAddressCode": optional(values["PurchasingAddressCode"]),
            "PackingSlipNumber": optional(values["PackingSlipNumber"]),
            "PaymentTermsCode": optional(values["PaymentTermsCode"]),
            "FreightTerms": optional(values["FreightTerms"]),
            "ShippingMethod": optional(values["ShippingMethod"]),
            "Acknowledgment": optional(values["Acknowledgment"]),
            "Fob": optional(values["Fob"]),
            "MessageCode": optional(values["MessageCode"]),
            "ReceiptStatus": "Posted",
            "ReceiptType": "PostedPurchaseReceipt",
            "VendorName": vendor_name,
            "VendorResolutionStatus": vendor_status,
            "PurchaseOrderResolutionStatus": po_status,
            "SourceRecordIdentity": source_identity,
        })

    validate_malformed_order_date_count(
        len(malformed_order_dates),
        args.expected_invalid_order_date_count,
    )
    validate_field_date_count(
        "Receipt Date",
        len(malformed_receipt_dates),
        args.expected_invalid_receipt_date_count,
    )
    validate_missing_purchase_order_count(
        len(missing_purchase_orders),
        args.expected_blank_purchase_order_count,
    )

    rejection_rows: list[dict[str, object]] = []
    rejection_totals: defaultdict[tuple[str, str, str, str, str], Decimal]
    rejection_totals = defaultdict(Decimal)
    rejection_keys: set[tuple[str, str, str, str, str, str]] = set()
    for source_row in read_csv(source / "POT-03.csv"):
        key, parts = split_record(source_row, 28)
        firm = key[:2]
        vendor = key[2:8]
        receiver = key[8:15]
        po = key[15:22]
        line = key[22:25]
        sequence = key[25:28]
        natural_key = (firm, vendor, po, receiver, line, sequence)
        if natural_key in rejection_keys:
            raise ValueError(f"Duplicate rejection key: {natural_key}")
        rejection_keys.add(natural_key)
        if not parts or len(parts[0]) != 41 or len(parts) < 3:
            raise ValueError(f"POT-03 rejection layout mismatch: {key!r}")
        text = parts[0].decode("latin-1")
        # IOLIST A0$(1),A1$(1),A2$,A[ALL]: the first two decoded
        # components are A1$ and A2$; the first numeric array member follows.
        quantity = decimal_value(parts[2], "QuantityRejected")
        rejection_totals[(firm, vendor, po, receiver, line)] += quantity
        rejection_rows.append({
            "FirmId": firm, "VendorNumber": vendor,
            "PurchaseOrderNumber": po.strip() or None,
            "ReceiverNumber": receiver,
            "ReceiptLineNumber": line, "RejectionSequence": sequence,
            "RejectionCode": optional(text[:3]),
            "OperatorCode": optional(text[3:6]),
            "ReturnAuthorizationNumber": optional(text[6:21]),
            "QuantityRejected": decimal_text(quantity),
            "PurchaseReceiptLineSourceRecordIdentity": (
                (firm + vendor + po + receiver + line)
                .encode("latin-1").hex().upper()
            ),
            "SourceRecordIdentity": source_row["key_hex"],
        })

    line_rows: list[dict[str, object]] = []
    line_keys: set[tuple[str, str, str, str, str]] = set()
    parents: set[tuple[str, str, str, str]] = set()
    po_line_resolution = Counter()
    inventory_resolution = Counter()
    work_order_resolution = Counter()
    required_date_resolution = Counter()
    malformed_required_dates: list[dict[str, str]] = []
    disposition = Counter()
    line_type_counts = Counter()
    signed_posted_total = Decimal()
    positive_received_total = Decimal()
    accepted_total = Decimal()
    rejected_total = Decimal()
    returned_total = Decimal()
    po_receipt_totals: defaultdict[tuple[str, str, str, str], Decimal]
    po_receipt_totals = defaultdict(Decimal)
    po_receipt_line_occurrences = Counter()
    restricted_cost_rows = 0
    for source_row in read_csv(source / "POT-14.csv"):
        key, parts = split_record(source_row, 25)
        firm, vendor, po, receiver, line = (
            key[:2], key[2:8], key[8:15], key[15:22], key[22:25]
        )
        natural_key = (firm, vendor, po, receiver, line)
        if (
            not firm.strip()
            or not vendor.strip()
            or not receiver.strip()
            or not line.strip()
        ):
            raise ValueError(f"Missing required receipt-line key: {key!r}")
        if natural_key in line_keys:
            raise ValueError(f"Duplicate receipt-line key: {natural_key}")
        line_keys.add(natural_key)
        parent = natural_key[:4]
        parents.add(parent)
        if parent not in header_keys:
            raise ValueError(f"Orphan receipt line: {natural_key}")
        if len(parts) < 19 or len(parts[0]) not in {48, 64}:
            raise ValueError(f"POT-14 group collapse: {key!r}")
        if parts[0][40:].strip() or len(parts[1]) != 32:
            raise ValueError(f"POT-14 string suffix mismatch: {key!r}")
        if len(parts[2]) != 22 or len(parts[3]) != 40:
            raise ValueError(f"POT-14 item/memo block mismatch: {key!r}")
        group1 = slice_block(parts[0][:40], line_group1_specs)
        group2 = slice_block(parts[1], line_group2_specs)
        numeric = parts[6:19]
        conversion = decimal_value(numeric[0], "ConversionFactor")
        unit_cost = decimal_value(numeric[1], "UnitCost")
        ordered = decimal_value(numeric[3], "QuantityOrdered")
        posted = decimal_value(numeric[7], "QuantityPostedSigned")
        invoiced = decimal_value(numeric[8], "QuantityInvoiced")
        if conversion == 0:
            raise ValueError(f"Zero conversion factor: {natural_key}")
        restricted_cost_rows += int(unit_cost != 0)
        rejected = rejection_totals.get(natural_key, Decimal())
        received = posted if posted > 0 else Decimal()
        accepted = posted if posted > 0 else Decimal()
        returned = -posted if posted < 0 else Decimal()
        status = (
            "PostedReceipt" if posted > 0
            else "NegativeReceiptOrReversal" if posted < 0
            else "ZeroPostedQuantity"
        )
        disposition[status] += 1
        signed_posted_total += posted
        positive_received_total += received
        accepted_total += accepted
        rejected_total += rejected
        returned_total += returned
        po_key = (firm, vendor, po, line)
        if po.strip():
            po_receipt_totals[po_key] += posted
            po_receipt_line_occurrences[po_key] += 1
            po_status = (
                "ResolvedActivePurchaseOrderLine"
                if po_key in active_po_lines
                else "AbsentFromActivePurchaseOrderLines"
            )
        else:
            po_status = "MissingRequiredSourceValue"
        po_line_resolution[po_status] += 1
        line_code = group1["LineCode"].strip()
        line_type = (
            "Stock" if line_code == "S"
            else "NonStock" if line_code in {"M", "N"}
            else "Other"
        )
        line_type_counts[line_type] += 1
        warehouse = parts[2][:2].decode("latin-1")
        item = parts[2][2:].decode("latin-1").rstrip()
        order_memo = parts[3].decode("latin-1").rstrip()
        inventory_row = inventory.get((firm, item)) if item else None
        inventory_status = (
            "NotApplicableNonStock" if line_type != "Stock"
            else "Resolved" if inventory_row is not None
            else "MissingCurrentInventory"
        )
        inventory_resolution[inventory_status] += 1
        work_order = group2["WorkOrderNumber"].strip()
        work_status = (
            "Resolved" if work_order and (firm, work_order) in work_orders
            else "MissingCurrentWorkOrder" if work_order
            else "NotReferenced"
        )
        work_order_resolution[work_status] += 1
        (
            required_date,
            required_date_status,
            required_date_reason,
        ) = resolve_optional_legacy_date(
            group1["RequiredDateRaw"], args.snapshot_year
        )
        required_date_resolution[required_date_status] += 1
        if required_date_status == "InvalidSourceValue":
            malformed_required_dates.append({
                "LineSourceRecordIdentity": source_row["key_hex"],
                "FirmId": firm,
                "VendorNumber": vendor,
                "PurchaseOrderNumber": po.strip(),
                "ReceiverNumber": receiver,
                "ReceiptLineNumber": line,
                "RequiredDateRaw": group1["RequiredDateRaw"],
                "RequiredDateIso": "",
                "RequiredDateResolutionStatus": required_date_status,
                "RequiredDateResolutionReason": required_date_reason or "",
            })
        line_rows.append({
            "FirmId": firm, "VendorNumber": vendor,
            "PurchaseOrderNumber": po.strip() or None,
            "ReceiverNumber": receiver,
            "ReceiptLineNumber": line,
            "ReceiptDateIso": header_dates[parent],
            "LineCode": line_code or None, "LineType": line_type,
            "PurchaseOrderLineNumber": line,
            "RequiredDateRaw": optional(group1["RequiredDateRaw"]),
            "RequiredDateIso": required_date,
            "RequiredDateResolutionStatus": required_date_status,
            "RequiredDateResolutionReason": required_date_reason,
            "UnitOfMeasure": optional(group1["UnitOfMeasure"]),
            "InventoryLocation": optional(group1["InventoryLocation"]),
            "WarehouseId": optional(warehouse),
            "ItemNumber": item or None,
            "ItemDescription": inventory_row if inventory_row else optional(order_memo),
            "OrderMemo": optional(order_memo),
            "WorkOrderNumber": work_order or None,
            "SalesOrderNumber": optional(group2["SalesOrderNumber"]),
            "SalesOrderLineNumber": optional(group2["SalesOrderLineNumber"]),
            "QuantityPostedSigned": decimal_text(posted),
            "QuantityReceived": decimal_text(received),
            "QuantityAccepted": decimal_text(accepted),
            "QuantityRejected": decimal_text(rejected),
            "QuantityReturned": decimal_text(returned),
            "QuantityInvoiced": decimal_text(invoiced),
            "QuantityDispositionStatus": status,
            "InspectionStatus": "UnavailableFromRetainedReceiptHistory",
            "PurchaseOrderResolutionStatus": po_status,
            "InventoryResolutionStatus": inventory_status,
            "WorkOrderResolutionStatus": work_status,
            "PurchaseReceiptSourceRecordIdentity": (
                key[:22].encode("latin-1").hex().upper()
            ),
            "SourceRecordIdentity": source_row["key_hex"],
        })

    validate_field_date_count(
        "Required Date",
        len(malformed_required_dates),
        args.expected_invalid_required_date_count,
    )

    unapplied_rejections = set(rejection_totals) - line_keys
    if unapplied_rejections:
        raise ValueError(f"Rejections without receipt line: {len(unapplied_rejections)}")

    headers_without_lines = header_keys - parents
    if len(headers_without_lines) != args.expected_header_without_line_count:
        raise ValueError(
            "Receipt-header-without-line count is outside the qualified "
            f"baseline: expected {args.expected_header_without_line_count}, "
            f"observed {len(headers_without_lines)}"
        )
    header_without_line_rows = [
        {
            "SourceRecordIdentity": header_identity_by_key[key],
            "FirmId": key[0],
            "VendorNumber": key[1],
            "PurchaseOrderNumber": key[2],
            "ReceiverNumber": key[3],
            "RelationshipStatus": "NoRetainedReceiptLines",
        }
        for key in sorted(headers_without_lines)
    ]

    po_reconciliation = []
    po_match_counts = Counter()
    for po_key, history_total in sorted(po_receipt_totals.items()):
        if po_key not in active_po_lines:
            continue
        active_total = active_po_lines[po_key]
        result = "Exact" if history_total == active_total else "Mismatch"
        po_match_counts[result] += 1
        po_reconciliation.append({
            "FirmId": po_key[0], "VendorNumber": po_key[1],
            "PurchaseOrderNumber": po_key[2],
            "PurchaseOrderLineNumber": po_key[3],
            "ReceivingHistorySignedTotal": decimal_text(history_total),
            "ActivePurchaseOrderQuantityReceived": decimal_text(active_total),
            "ReconciliationResult": result,
            "Difference": decimal_text(history_total - active_total),
        })

    write_rows(output / "PurchaseReceipt.csv", HEADER_FIELDS, header_rows)
    write_rows(output / "PurchaseReceiptLine.csv", LINE_FIELDS, line_rows)
    write_rows(output / "ReceiptRejection.csv", REJECTION_FIELDS, rejection_rows)
    write_rows(
        output / "MalformedOrderDate.csv",
        [
            "HeaderNaturalKey", "FirmId", "VendorNumber",
            "PurchaseOrderNumber", "ReceiverNumber", "OrderDateRaw",
            "OrderDateIso", "OrderDateResolutionStatus",
            "OrderDateResolutionReason",
        ],
        malformed_order_dates,
    )
    write_rows(
        output / "MalformedReceiptDate.csv",
        [
            "HeaderSourceRecordIdentity", "FirmId", "VendorNumber",
            "PurchaseOrderNumber", "ReceiverNumber", "ReceiptDateRaw",
            "ReceiptDateIso", "ReceiptDateResolutionStatus",
            "ReceiptDateResolutionReason",
        ],
        malformed_receipt_dates,
    )
    write_rows(
        output / "MalformedRequiredDate.csv",
        [
            "LineSourceRecordIdentity", "FirmId", "VendorNumber",
            "PurchaseOrderNumber", "ReceiverNumber", "ReceiptLineNumber",
            "RequiredDateRaw", "RequiredDateIso",
            "RequiredDateResolutionStatus", "RequiredDateResolutionReason",
        ],
        malformed_required_dates,
    )
    write_rows(
        output / "MissingPurchaseOrderReference.csv",
        [
            "SourceRecordIdentity", "FirmId", "VendorNumber",
            "PurchaseOrderNumber", "ReceiverNumber", "ResolutionStatus",
            "ResolutionReason",
        ],
        missing_purchase_orders,
    )
    write_rows(
        output / "HeaderWithoutLine.csv",
        [
            "SourceRecordIdentity", "FirmId", "VendorNumber",
            "PurchaseOrderNumber", "ReceiverNumber", "RelationshipStatus",
        ],
        header_without_line_rows,
    )
    write_rows(
        output / "PurchaseOrderReconciliation.csv",
        [
            "FirmId", "VendorNumber", "PurchaseOrderNumber",
            "PurchaseOrderLineNumber", "ReceivingHistorySignedTotal",
            "ActivePurchaseOrderQuantityReceived", "ReconciliationResult",
            "Difference",
        ],
        po_reconciliation,
    )
    shutil.copyfile(
        args.qualification.resolve(),
        output / "source-qualification.json",
    )
    shutil.copyfile(
        args.source_summary.resolve(),
        output / "source-pass-summary.csv",
    )

    metadata = {
        "Contract": "RECEIVING_HISTORY_CANONICAL_V1",
        "SourceQualificationAttempt": args.harness_attempt,
        "GeneratedAtUtc": datetime.now(timezone.utc).isoformat(),
        "Counts": {
            "PurchaseReceipt": len(header_rows),
            "PurchaseReceiptLine": len(line_rows),
            "ReceiptRejection": len(rejection_rows),
        },
        "NaturalKeys": {
            "PurchaseReceipt": (
                "Exact fixed-width POT-04 source key (SourceRecordIdentity)"
            ),
            "PurchaseReceiptLine": (
                "Exact fixed-width POT-14 source key (SourceRecordIdentity)"
            ),
            "ReceiptRejection": (
                "Exact fixed-width POT-03 source key (SourceRecordIdentity)"
            ),
        },
        "QuantityTotals": {
            "QuantityPostedSigned": decimal_text(signed_posted_total),
            "QuantityReceivedPositive": decimal_text(positive_received_total),
            "QuantityAccepted": decimal_text(accepted_total),
            "QuantityRejected": decimal_text(rejected_total),
            "QuantityReturnedDerived": decimal_text(returned_total),
        },
        "QuantitySemantics": {
            "QuantityPostedSigned": "Direct POT-14 numeric slot 7",
            "QuantityAccepted": (
                "Posted positive quantity; QA accepted quantity is the quantity "
                "promoted into receipt history"
            ),
            "QuantityRejected": "Direct POT-03 quantity, aggregated by receipt line",
            "QuantityReturned": (
                "Derived absolute value of negative posted quantity; the legacy "
                "source does not distinguish return from correction/reversal"
            ),
        },
        "Resolution": {
            "OrderDate": dict(order_date_resolution),
            "ReceiptDate": dict(receipt_date_resolution),
            "RequiredDate": dict(required_date_resolution),
            "Vendor": dict(vendor_resolution),
            "PurchaseOrderHeader": dict(po_header_resolution),
            "PurchaseOrderLine": dict(po_line_resolution),
            "Inventory": dict(inventory_resolution),
            "WorkOrder": dict(work_order_resolution),
        },
        "LineTypes": dict(line_type_counts),
        "Disposition": dict(disposition),
        "PurchaseOrderReconciliation": dict(po_match_counts),
        "Population": {
            "MalformedOrderDates": len(malformed_order_dates),
            "ExpectedMalformedOrderDates": (
                args.expected_invalid_order_date_count
            ),
            "MalformedReceiptDates": len(malformed_receipt_dates),
            "ExpectedMalformedReceiptDates": (
                args.expected_invalid_receipt_date_count
            ),
            "MalformedRequiredDates": len(malformed_required_dates),
            "ExpectedMalformedRequiredDates": (
                args.expected_invalid_required_date_count
            ),
            "BlankPurchaseOrderHeaders": len(missing_purchase_orders),
            "ExpectedBlankPurchaseOrderHeaders": (
                args.expected_blank_purchase_order_count
            ),
            "HeadersWithoutLines": len(headers_without_lines),
            "ExpectedHeadersWithoutLines": (
                args.expected_header_without_line_count
            ),
            "BlankReceiptDates": sum(
                not row["ReceiptDateIso"] for row in header_rows
            ),
            "BlankPackingSlips": sum(
                not row["PackingSlipNumber"] for row in header_rows
            ),
            "BlankReceivedByEmployee": len(header_rows),
            "NegativeReceiptOrReversalRows": disposition[
                "NegativeReceiptOrReversal"
            ],
            "ZeroPostedQuantityRows": disposition["ZeroPostedQuantity"],
            "MultipleReceiptTransactionsForOnePoLine": sum(
                count > 1 for count in po_receipt_line_occurrences.values()
            ),
            "LinesWithBlankItem": sum(
                not row["ItemNumber"] for row in line_rows
            ),
            "LinesWithWorkOrder": sum(
                bool(row["WorkOrderNumber"]) for row in line_rows
            ),
        },
        "HeadersWithoutLines": len(headers_without_lines),
        "DuplicateNaturalKeys": 0,
        "OrphanLines": 0,
        "QualifiedOrphanReceipts": len(missing_purchase_orders),
        "RestrictedCostRowsObservedAndExcluded": restricted_cost_rows,
        "InspectionDetail": "Deferred; retained POT-03 population is represented",
        "EmployeeReference": "No received-by employee field physically proven",
    }
    (output / "metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )

    data_files = [
        "PurchaseReceipt.csv", "PurchaseReceiptLine.csv",
        "ReceiptRejection.csv", "MalformedOrderDate.csv",
        "MalformedReceiptDate.csv", "MalformedRequiredDate.csv",
        "PurchaseOrderReconciliation.csv",
        "MissingPurchaseOrderReference.csv",
        "HeaderWithoutLine.csv",
        "source-qualification.json", "source-pass-summary.csv",
        "metadata.json",
    ]
    manifest = {
        "Contract": "RECEIVING_HISTORY_CANONICAL_V1",
        "SourceQualificationAttempt": args.harness_attempt,
        "Files": [
            {
                "Path": name,
                "Bytes": (output / name).stat().st_size,
                "Sha256": sha256(output / name),
            }
            for name in data_files
        ],
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    package_hash = sha256(manifest_path)
    (output / "package.sha256").write_text(package_hash + "\n", encoding="ascii")
    metadata["PackageSha256"] = package_hash
    print(json.dumps(metadata, indent=2))
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--vendor", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--work-order", type=Path, required=True)
    parser.add_argument("--purchase-order", type=Path, required=True)
    parser.add_argument("--purchase-order-line", type=Path, required=True)
    parser.add_argument("--qualification", type=Path, required=True)
    parser.add_argument("--source-summary", type=Path, required=True)
    parser.add_argument("--harness-attempt", required=True)
    parser.add_argument("--snapshot-year", type=int, required=True)
    parser.add_argument(
        "--expected-invalid-order-date-count", type=int, required=True
    )
    parser.add_argument(
        "--expected-blank-purchase-order-count", type=int, required=True
    )
    parser.add_argument(
        "--expected-invalid-receipt-date-count", type=int, required=True
    )
    parser.add_argument(
        "--expected-invalid-required-date-count", type=int, required=True
    )
    parser.add_argument(
        "--expected-header-without-line-count", type=int, required=True
    )
    build(parser.parse_args())


if __name__ == "__main__":
    main()

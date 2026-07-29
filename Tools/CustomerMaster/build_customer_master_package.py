from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


CUSTOMER_FIELDS = [
    "FirmId",
    "CustomerNumber",
    "CustomerName",
    "CustomerStatus",
    "IsActive",
    "AddressLine1",
    "AddressLine2",
    "AddressLine3",
    "AddressLine4",
    "AddressLine5",
    "PostalCode",
    "Country",
    "PrimaryContactName",
    "PrimaryPhone",
    "PrimaryPhoneExtension",
    "SalespersonCode",
    "SalespersonName",
    "TerritoryCode",
    "TerritoryName",
    "PaymentTermsCode",
    "PaymentTermsDescription",
    "ShippingMethodCode",
    "FreightTerms",
    "OrderFreightTermsCode",
    "CustomerTypeCode",
    "CustomerTypeDescription",
    "PricingClassCode",
    "PricingClassDescription",
    "SourceRecordIdentity",
]

ADDRESS_FIELDS = [
    "FirmId",
    "CustomerNumber",
    "AddressCode",
    "AddressType",
    "AddressName",
    "AddressLine1",
    "AddressLine2",
    "AddressLine3",
    "PostalCode",
    "Country",
    "ContactName",
    "Phone",
    "PhoneExtension",
    "SalespersonCode",
    "SalespersonName",
    "TerritoryCode",
    "TerritoryName",
    "IsPrimary",
    "IsActive",
    "SourceRecordIdentity",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(
    path: Path, rows: list[dict[str, object]], fields: list[str]
) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=fields,
            extrasaction="raise",
            quoting=csv.QUOTE_ALL,
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def decoded_segments(material: str) -> tuple[list[str], list[str]]:
    strings: list[str] = []
    numbers: list[str] = []
    for part in material.split("|"):
        if part.startswith("S"):
            strings.append(bytes.fromhex(part[1:]).decode("latin-1"))
        elif part.startswith("N"):
            numbers.append(part[1:])
    return strings, numbers


def sliced(block: str, fields: list[tuple[str, int]]) -> dict[str, str]:
    position = 0
    result: dict[str, str] = {}
    for name, length in fields:
        result[name] = block[position : position + length].rstrip()
        position += length
    if position != len(block) and block[position:].strip():
        raise ValueError(
            f"Decoded block length {len(block)} did not match {position}"
        )
    return result


def normalize_optional(value: str) -> str | None:
    stripped = value.strip()
    return stripped if stripped else None


def load_arm10(rows: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    lookups: dict[str, dict[str, str]] = {}
    supported_layouts = {"A", "F", "H", "L", "M"}
    code_lengths = {"A": 2, "F": 3, "H": 3, "L": 3, "M": 4}
    for row in rows:
        layout = row["layout"]
        if layout not in supported_layouts:
            continue
        key_bytes = bytes.fromhex(row["key_hex"])
        key = key_bytes.decode("latin-1")
        firm_id = key[:2]
        code_start = 3
        code = key[code_start : code_start + code_lengths[layout]].rstrip()
        # ARM-10 is a multi-layout record. The qualifier's decoded_material
        # intentionally records VPro variable boundaries for diagnostics and
        # is not a field projection: its first string contains the key plus
        # the first description byte(s). The complete qualified raw record is
        # authoritative here. Every supported layout stores its display
        # description after the exact physical key and before the first
        # newline-delimited numeric segment.
        raw = bytes.fromhex(row["raw_record_hex"])
        first_segment = raw.split(b"\n", 1)[0]
        if not first_segment.startswith(key_bytes):
            raise ValueError(f"ARM-10 {layout} raw key does not match key_hex")
        description_bytes = first_segment[len(key_bytes):]
        if layout == "A":
            # ARM-10 layout A continues with prox/due flags in the same
            # string segment; its description is the first fixed 20 bytes.
            description_bytes = description_bytes[:20]
        description = description_bytes.decode("latin-1").rstrip()
        values = {"Description": description}
        lookup_key = f"{firm_id}|{layout}|{code}"
        if lookup_key in lookups:
            raise ValueError(f"Duplicate ARM-10 lookup {lookup_key}")
        lookups[lookup_key] = values
    return lookups


def lookup_description(
    lookups: dict[str, dict[str, str]],
    firm_id: str,
    layout: str,
    code: str,
) -> str | None:
    if not code:
        return None
    value = lookups.get(f"{firm_id}|{layout}|{code}")
    return normalize_optional(value["Description"]) if value else None


def build(args: argparse.Namespace) -> dict[str, object]:
    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    arm01 = read_csv(source / "ARM-01.csv")
    arm02 = read_csv(source / "ARM-02.csv")
    arm03 = read_csv(source / "ARM-03.csv")
    arm10 = read_csv(source / "ARM-10.csv")
    lookups = load_arm10(arm10)

    arm01_specs = [
        ("CustomerName", 30),
        ("AddressLine1", 24),
        ("AddressLine2", 24),
        ("AddressLine3", 24),
        ("PostalCode", 9),
        ("PrimaryPhone", 10),
        ("PrimaryPhoneExtension", 4),
        ("ResaleNumber", 20),
        ("AlternateSequence", 10),
        ("OpenedDateRaw", 3),
        ("ShippingMethodCode", 10),
        ("FaxNumber", 10),
        ("AddressLine4", 24),
        ("AddressLine5", 24),
        ("RetainCustomerFlag", 1),
        ("PrimaryContactName", 20),
        ("DunnBradstreetNumber", 9),
        ("SicCode", 8),
        ("Country", 24),
        ("FreightTerms", 15),
        ("OrderFreightTermsCode", 2),
        ("Reserved", 20),
    ]
    arm02_specs = [
        ("SalespersonCode", 3),
        ("PaymentTermsCode", 2),
        ("DiscountCode", 2),
        ("DistributionCode", 2),
        ("FinanceChargeFlag", 1),
        ("SalesAnalysisFlag", 1),
        ("Reserved1", 2),
        ("LastInvoiceDateRaw", 3),
        ("LastPaymentDateRaw", 3),
        ("StatementsFlag", 1),
        ("TerritoryCode", 3),
        ("PricingClassCode", 4),
        ("NumberOfLabels", 2),
        ("MessageCode", 2),
        ("TaxCode", 2),
        ("CustomerTypeCode", 3),
        ("Reserved2", 1),
        ("InvoiceHistoryFlag", 1),
        ("CreditHoldFlag", 1),
        ("Reserved3", 25),
    ]
    arm03_specs = [
        ("AddressName", 30),
        ("AddressLine1", 24),
        ("AddressLine2", 24),
        ("AddressLine3", 24),
        ("PostalCode", 9),
        ("Phone", 10),
        ("PhoneExtension", 4),
        ("ContactName", 20),
        ("SalespersonCode", 3),
        ("TerritoryCode", 3),
        ("TaxCode", 2),
        ("DunnBradstreetNumber", 9),
        ("SicCode", 8),
        ("Reserved", 20),
    ]

    details: dict[tuple[str, str], dict[str, str]] = {}
    hold_counts: dict[str, int] = {}
    for row in arm02:
        strings, _ = decoded_segments(row["decoded_material"])
        key = strings[0]
        firm_id, customer_number = key[:2], key[2:8]
        values = sliced(strings[1], arm02_specs)
        natural_key = (firm_id, customer_number)
        if natural_key in details:
            raise ValueError(f"Duplicate ARM-02 customer key {natural_key}")
        details[natural_key] = values
        hold = values["CreditHoldFlag"].strip() or "BLANK"
        hold_counts[hold] = hold_counts.get(hold, 0) + 1

    customers: list[dict[str, object]] = []
    customer_keys: set[tuple[str, str]] = set()
    restricted_present = {
        "ResaleNumber": 0,
        "DunnBradstreetNumber": 0,
        "SicCode": 0,
        "CreditHoldFlag": 0,
        "AccountingNumericValues": 0,
        "InternalComments": len(read_csv(source / "ARM-05.csv")),
        "PaymentSummary": len(read_csv(source / "ARM-06.csv")),
    }
    blank_names = 0
    for row in arm01:
        strings, _ = decoded_segments(row["decoded_material"])
        key = strings[0]
        firm_id, customer_number = key[:2], key[2:8]
        natural_key = (firm_id, customer_number)
        if natural_key in customer_keys:
            raise ValueError(f"Duplicate ARM-01 customer key {natural_key}")
        customer_keys.add(natural_key)
        values = sliced(strings[1], arm01_specs)
        detail = details.get(natural_key)
        if detail is None:
            raise ValueError(f"Missing ARM-02 detail for {natural_key}")
        customer_name = normalize_optional(values["CustomerName"])
        if customer_name is None:
            blank_names += 1
        for restricted in (
            "ResaleNumber", "DunnBradstreetNumber", "SicCode"
        ):
            if normalize_optional(values[restricted]):
                restricted_present[restricted] += 1
        if normalize_optional(detail["CreditHoldFlag"]):
            restricted_present["CreditHoldFlag"] += 1
        _, numeric_values = decoded_segments(
            next(
                item["decoded_material"]
                for item in arm02
                if bytes.fromhex(
                    item["key_hex"]
                ).decode("latin-1")[:8] == firm_id + customer_number
            )
        )
        if any(value not in {"", "0"} for value in numeric_values):
            restricted_present["AccountingNumericValues"] += 1
        salesperson = detail["SalespersonCode"].strip()
        territory = detail["TerritoryCode"].strip()
        terms = detail["PaymentTermsCode"].strip()
        customer_type = detail["CustomerTypeCode"].strip()
        pricing = detail["PricingClassCode"].strip()
        customers.append({
            "FirmId": firm_id,
            "CustomerNumber": customer_number,
            "CustomerName": customer_name,
            "CustomerStatus": None,
            "IsActive": None,
            "AddressLine1": normalize_optional(values["AddressLine1"]),
            "AddressLine2": normalize_optional(values["AddressLine2"]),
            "AddressLine3": normalize_optional(values["AddressLine3"]),
            "AddressLine4": normalize_optional(values["AddressLine4"]),
            "AddressLine5": normalize_optional(values["AddressLine5"]),
            "PostalCode": normalize_optional(values["PostalCode"]),
            "Country": normalize_optional(values["Country"]),
            "PrimaryContactName": normalize_optional(
                values["PrimaryContactName"]),
            "PrimaryPhone": normalize_optional(values["PrimaryPhone"]),
            "PrimaryPhoneExtension": normalize_optional(
                values["PrimaryPhoneExtension"]),
            "SalespersonCode": normalize_optional(salesperson),
            "SalespersonName": lookup_description(
                lookups, firm_id, "F", salesperson),
            "TerritoryCode": normalize_optional(territory),
            "TerritoryName": lookup_description(
                lookups, firm_id, "H", territory),
            "PaymentTermsCode": normalize_optional(terms),
            "PaymentTermsDescription": lookup_description(
                lookups, firm_id, "A", terms),
            "ShippingMethodCode": normalize_optional(
                values["ShippingMethodCode"]),
            "FreightTerms": normalize_optional(values["FreightTerms"]),
            "OrderFreightTermsCode": normalize_optional(
                values["OrderFreightTermsCode"]),
            "CustomerTypeCode": normalize_optional(customer_type),
            "CustomerTypeDescription": lookup_description(
                lookups, firm_id, "L", customer_type),
            "PricingClassCode": normalize_optional(pricing),
            "PricingClassDescription": lookup_description(
                lookups, firm_id, "M", pricing),
            "SourceRecordIdentity": row["key_hex"],
        })

    detail_orphans = sorted(set(details) - customer_keys)
    if detail_orphans:
        raise ValueError(f"ARM-02 orphan keys: {detail_orphans[:5]}")

    addresses: list[dict[str, object]] = []
    address_keys: set[tuple[str, str, str]] = set()
    address_orphans: list[tuple[str, str, str]] = []
    orphan_address_rows: list[dict[str, object]] = []
    for row in arm03:
        strings, _ = decoded_segments(row["decoded_material"])
        key = strings[0]
        firm_id, customer_number, address_code = (
            key[:2], key[2:8], key[8:14])
        natural_key = (firm_id, customer_number, address_code)
        if natural_key in address_keys:
            raise ValueError(f"Duplicate ARM-03 address key {natural_key}")
        address_keys.add(natural_key)
        if (firm_id, customer_number) not in customer_keys:
            address_orphans.append(natural_key)
            orphan_address_rows.append({
                "FirmId": firm_id,
                "CustomerNumber": customer_number,
                "AddressCode": address_code,
                "SourceRecordIdentity": row["key_hex"],
                "Classification": "OrphanSupportingRecord",
                "Reason": "No matching qualified ARM-01 customer",
            })
            continue
        values = sliced(strings[1], arm03_specs)
        salesperson = values["SalespersonCode"].strip()
        territory = values["TerritoryCode"].strip()
        addresses.append({
            "FirmId": firm_id,
            "CustomerNumber": customer_number,
            "AddressCode": address_code,
            "AddressType": "ShipTo",
            "AddressName": normalize_optional(values["AddressName"]),
            "AddressLine1": normalize_optional(values["AddressLine1"]),
            "AddressLine2": normalize_optional(values["AddressLine2"]),
            "AddressLine3": normalize_optional(values["AddressLine3"]),
            "PostalCode": normalize_optional(values["PostalCode"]),
            "Country": None,
            "ContactName": normalize_optional(values["ContactName"]),
            "Phone": normalize_optional(values["Phone"]),
            "PhoneExtension": normalize_optional(values["PhoneExtension"]),
            "SalespersonCode": normalize_optional(salesperson),
            "SalespersonName": lookup_description(
                lookups, firm_id, "F", salesperson),
            "TerritoryCode": normalize_optional(territory),
            "TerritoryName": lookup_description(
                lookups, firm_id, "H", territory),
            "IsPrimary": False,
            "IsActive": None,
            "SourceRecordIdentity": row["key_hex"],
        })
    customers.sort(key=lambda row: (str(row["FirmId"]),
                                    str(row["CustomerNumber"])))
    addresses.sort(key=lambda row: (
        str(row["FirmId"]),
        str(row["CustomerNumber"]),
        str(row["AddressCode"]),
    ))
    write_csv(output / "Customer.csv", customers, CUSTOMER_FIELDS)
    write_csv(output / "CustomerAddress.csv", addresses, ADDRESS_FIELDS)
    write_csv(
        output / "OrphanCustomerAddress.csv",
        orphan_address_rows,
        [
            "FirmId",
            "CustomerNumber",
            "AddressCode",
            "SourceRecordIdentity",
            "Classification",
            "Reason",
        ],
    )

    known = next(
        (row for row in customers if row["CustomerNumber"] == "001148"),
        None,
    )
    if known is None or known["CustomerName"] != "HUGHEY & PHILLIPS":
        raise ValueError("Known customer 001148 did not validate")

    metadata: dict[str, object] = {
        "schema": "dle-customer-master-package",
        "schemaVersion": "1.0",
        "contractVersion": "CUSTOMER_MASTER_1.0",
        "sourceQualificationRunId": args.source_run_id,
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "naturalKeys": {
            "Customer": ["FirmId", "CustomerNumber"],
            "CustomerAddress": [
                "FirmId", "CustomerNumber", "AddressCode"],
        },
        "counts": {
            "Customer": len(customers),
            "CustomerAddress": len(addresses),
            "Total": len(customers) + len(addresses),
            "BlankCustomerName": blank_names,
            "DuplicateCustomerNaturalKeys": 0,
            "DuplicateAddressNaturalKeys": 0,
            "OrphanCustomerDetails": len(detail_orphans),
            "OrphanAddresses": len(address_orphans),
        },
        "statusQualification": {
            "CustomerStatus": "Unavailable",
            "IsActive": "Unavailable",
            "reason": (
                "No physically proven active/inactive business field exists "
                "in the qualified general-operational source contract."
            ),
        },
        "restrictedFieldPresence": restricted_present,
        "creditHoldAggregateByRawCode": hold_counts,
        "restrictedFieldsExcludedFromDataFiles": True,
        "orphanPolicy": (
            "Excluded from operational CustomerAddress and retained in "
            "OrphanCustomerAddress.csv"
        ),
        "knownCustomer001148": {
            "customerName": known["CustomerName"],
            "validated": True,
        },
    }
    (output / "metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    files = [
        "Customer.csv",
        "CustomerAddress.csv",
        "OrphanCustomerAddress.csv",
        "metadata.json",
    ]
    hashes = {name: sha256(output / name) for name in files}
    package_digest = hashlib.sha256()
    for name in sorted(hashes):
        package_digest.update(f"{name}:{hashes[name]}\n".encode("ascii"))
    package_hash = package_digest.hexdigest().upper()
    manifest = {
        **metadata,
        "files": hashes,
        "packageSha256": package_hash,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "package.sha256").write_text(
        package_hash + "\n", encoding="ascii")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-run-id", required=True)
    args = parser.parse_args()
    result = build(args)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

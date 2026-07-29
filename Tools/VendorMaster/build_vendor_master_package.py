from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


VENDOR_FIELDS = [
    "FirmId", "VendorNumber", "VendorName", "VendorStatus", "IsActive",
    "VendorType", "VendorClass", "AddressLine1", "AddressLine2",
    "AddressLine3", "PostalCode", "Country", "PrimaryContactName",
    "PrimaryPhone", "PrimaryPhoneExtension", "PaymentTermsCode",
    "PaymentTermsDescription", "ApprovedSupplierStatus",
    "SourceRecordIdentity",
]
ADDRESS_FIELDS = [
    "FirmId", "VendorNumber", "AddressCode", "AddressType", "AddressName",
    "AddressLine1", "AddressLine2", "AddressLine3", "PostalCode", "Country",
    "ContactName", "Phone", "PhoneExtension", "IsPrimary", "IsActive",
    "SourceRecordIdentity",
]
RESTRICTED_FIELD_NAMES = {
    "FederalTaxId", "Print1099", "VendorAccountNumber", "FaxNumber",
    "HoldInvoices", "GlAccountNumber", "OpenInvoiceBalance",
    "InternalComments", "LastInvoiceDateRaw", "LastPaymentDateRaw",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(
    path: Path, rows: list[dict[str, object]], fields: list[str]
) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fields, extrasaction="raise", quoting=csv.QUOTE_ALL,
            lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)


def optional(value: str) -> str | None:
    value = value.rstrip()
    return value or None


def raw_segments(row: dict[str, str]) -> list[bytes]:
    return bytes.fromhex(row["raw_record_hex"]).split(b"\n")


def fixed_string_after_key(
    row: dict[str, str], key_length: int, string_length: int
) -> tuple[bytes, bytes]:
    raw = bytes.fromhex(row["raw_record_hex"])
    key = bytes.fromhex(row["key_hex"])
    if raw[:key_length] != key or raw[key_length:key_length + 1] != b"\n":
        raise ValueError(f"Raw record key/delimiter mismatch: {row['key_hex']}")
    start = key_length + 1
    return raw[start:start + string_length], raw[start + string_length:]


def text(segment: bytes) -> str:
    return segment.decode("latin-1")


def slice_fields(
    block: str, specs: list[tuple[str, int]]
) -> dict[str, str]:
    position = 0
    values: dict[str, str] = {}
    for name, length in specs:
        values[name] = block[position:position + length]
        position += length
    if len(block) < position:
        raise ValueError(f"Physical block collapsed: {len(block)} < {position}")
    if block[position:].strip():
        raise ValueError(
            f"Unexpected nonblank physical suffix at byte {position + 1}"
        )
    return values


def load_apm10(rows: list[dict[str, str]]) -> dict[tuple[str, str, str], str]:
    result: dict[tuple[str, str, str], str] = {}
    for row in rows:
        key = bytes.fromhex(row["key_hex"]).decode("latin-1")
        if len(key) < 4:
            continue
        firm, layout, code = key[:2], key[2:3], key[3:].rstrip()
        first = bytes.fromhex(row["raw_record_hex"]).split(b"\n", 1)[0]
        key_bytes = bytes.fromhex(row["key_hex"])
        if not first.startswith(key_bytes):
            raise ValueError(f"APM-10 key mismatch: {key!r}")
        description = first[len(key_bytes):len(key_bytes) + 20]
        value = optional(description.decode("latin-1"))
        lookup_key = (firm, layout, code)
        if lookup_key in result:
            raise ValueError(f"Duplicate APM-10 key: {lookup_key}")
        result[lookup_key] = value or ""
    return result


def build(args: argparse.Namespace) -> dict[str, object]:
    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    apm01 = read_csv(source / "APM-01.csv")
    apm02 = read_csv(source / "APM-02.csv")
    apm05 = read_csv(source / "APM-05.csv")
    apm06 = read_csv(source / "APM-06.csv")
    apm09 = read_csv(source / "APM-09.csv")
    apm10 = read_csv(source / "APM-10.csv")
    ivm10 = read_csv(source / "IVM-10.csv")
    lookups = load_apm10(apm10)

    apm01_specs = [
        ("VendorName", 30), ("AddressLine1", 24), ("AddressLine2", 24),
        ("AddressLine3", 24), ("PostalCode", 9), ("PrimaryPhone", 10),
        ("PrimaryPhoneExtension", 4), ("PrimaryContactName", 20),
        ("AlternateSortSequence", 10), ("OpenedDateRaw", 3),
        ("HoldInvoices", 1), ("FederalTaxId", 15), ("Print1099", 1),
        ("VendorAccountNumber", 10), ("FaxNumber", 10), ("Reserved", 5),
    ]
    address_specs = [
        ("AddressName", 30), ("AddressLine1", 24), ("AddressLine2", 24),
        ("AddressLine3", 24), ("PostalCode", 9), ("Phone", 10),
        ("PhoneExtension", 4), ("ContactName", 20), ("FaxNumber", 10),
        ("Reserved", 5),
    ]
    detail_specs = [
        ("DistributionCode", 2), ("PaymentGroupCode", 2),
        ("PaymentTermsCode", 2), ("LastInvoiceDateRaw", 3),
        ("LastPaymentDateRaw", 3), ("Reserved", 12),
    ]

    detail_terms: dict[tuple[str, str], set[str]] = defaultdict(set)
    detail_keys: set[tuple[str, str, str]] = set()
    detail_parent_keys: set[tuple[str, str]] = set()
    restricted_presence = Counter()
    for row in apm02:
        key = bytes.fromhex(row["key_hex"]).decode("latin-1")
        natural = (key[:2], key[2:8], key[8:10])
        if natural in detail_keys:
            raise ValueError(f"Duplicate APM-02 natural key {natural}")
        detail_keys.add(natural)
        parent = natural[:2]
        detail_parent_keys.add(parent)
        detail_block, detail_remainder = fixed_string_after_key(row, 10, 24)
        values = slice_fields(text(detail_block), detail_specs)
        terms = values["PaymentTermsCode"].strip()
        if terms:
            detail_terms[parent].add(terms)
        if values["LastInvoiceDateRaw"] != "   ":
            restricted_presence["LastInvoiceDateRaw"] += 1
        if values["LastPaymentDateRaw"] != "   ":
            restricted_presence["LastPaymentDateRaw"] += 1
        # The next record string is the G/L account. Remaining values are
        # accounting/history numerics. Neither enters the general package.
        detail_parts = detail_remainder.split(b"\n", 2)
        if detail_parts and detail_parts[0] == b"":
            detail_parts = detail_parts[1:]
        if detail_parts and detail_parts[0].strip(b" 0"):
            restricted_presence["GlAccountNumber"] += 1
        if len(detail_parts) > 1 and detail_parts[1].strip(b"\x00 0\n"):
            restricted_presence["AccountingNumericValues"] += 1

    vendors: list[dict[str, object]] = []
    vendor_keys: set[tuple[str, str]] = set()
    vendor_number_firms: dict[str, set[str]] = defaultdict(set)
    blank_names = 0
    hold_counts = Counter()
    for row in apm01:
        key = bytes.fromhex(row["key_hex"]).decode("latin-1")
        natural = (key[:2], key[2:8])
        if natural in vendor_keys:
            raise ValueError(f"Duplicate APM-01 natural key {natural}")
        vendor_keys.add(natural)
        vendor_number_firms[natural[1]].add(natural[0])
        master_block, _ = fixed_string_after_key(row, 8, 200)
        values = slice_fields(text(master_block), apm01_specs)
        name = optional(values["VendorName"])
        if name is None:
            blank_names += 1
        for restricted in (
            "FederalTaxId", "Print1099", "VendorAccountNumber", "FaxNumber"
        ):
            if values[restricted].strip():
                restricted_presence[restricted] += 1
        hold = values["HoldInvoices"].strip() or "BLANK"
        hold_counts[hold] += 1
        terms_values = detail_terms.get(natural, set())
        terms = next(iter(terms_values)) if len(terms_values) == 1 else None
        vendors.append({
            "FirmId": natural[0],
            "VendorNumber": natural[1],
            "VendorName": name,
            "VendorStatus": None,
            "IsActive": None,
            "VendorType": None,
            "VendorClass": None,
            "AddressLine1": optional(values["AddressLine1"]),
            "AddressLine2": optional(values["AddressLine2"]),
            "AddressLine3": optional(values["AddressLine3"]),
            "PostalCode": optional(values["PostalCode"]),
            "Country": None,
            "PrimaryContactName": optional(values["PrimaryContactName"]),
            "PrimaryPhone": optional(values["PrimaryPhone"]),
            "PrimaryPhoneExtension": optional(
                values["PrimaryPhoneExtension"]
            ),
            "PaymentTermsCode": terms,
            "PaymentTermsDescription": (
                optional(lookups.get((natural[0], "C", terms), ""))
                if terms else None
            ),
            "ApprovedSupplierStatus": None,
            "SourceRecordIdentity": row["key_hex"],
        })

    detail_orphans = sorted(detail_parent_keys - vendor_keys)
    orphan_detail_rows = [
        {
            "FirmId": firm, "VendorNumber": vendor,
            "Classification": "OrphanRestrictedSupportingRecord",
            "Reason": "APM-02 profile has no matching current APM-01 vendor",
        }
        for firm, vendor in detail_orphans
    ]

    addresses: list[dict[str, object]] = []
    orphan_rows: list[dict[str, object]] = []
    address_keys: set[tuple[str, str, str]] = set()
    address_vendor_counts = Counter()
    for row in apm05:
        key = bytes.fromhex(row["key_hex"]).decode("latin-1")
        natural = (key[:2], key[2:8], key[8:10])
        if natural in address_keys:
            raise ValueError(f"Duplicate APM-05 natural key {natural}")
        address_keys.add(natural)
        parent = natural[:2]
        if parent not in vendor_keys:
            orphan_rows.append({
                "FirmId": natural[0], "VendorNumber": natural[1],
                "AddressCode": natural[2],
                "SourceRecordIdentity": row["key_hex"],
                "Classification": "OrphanSupportingRecord",
                "Reason": "No matching qualified APM-01 vendor",
            })
            continue
        address_block, _ = fixed_string_after_key(row, 10, 160)
        values = slice_fields(text(address_block), address_specs)
        address_vendor_counts[parent] += 1
        addresses.append({
            "FirmId": natural[0], "VendorNumber": natural[1],
            "AddressCode": natural[2], "AddressType": "Purchasing",
            "AddressName": optional(values["AddressName"]),
            "AddressLine1": optional(values["AddressLine1"]),
            "AddressLine2": optional(values["AddressLine2"]),
            "AddressLine3": optional(values["AddressLine3"]),
            "PostalCode": optional(values["PostalCode"]), "Country": None,
            "ContactName": optional(values["ContactName"]),
            "Phone": optional(values["Phone"]),
            "PhoneExtension": optional(values["PhoneExtension"]),
            "IsPrimary": False, "IsActive": None,
            "SourceRecordIdentity": row["key_hex"],
        })

    for fields in (VENDOR_FIELDS, ADDRESS_FIELDS):
        leaked = RESTRICTED_FIELD_NAMES.intersection(fields)
        if leaked:
            raise ValueError(f"Restricted fields leaked: {sorted(leaked)}")

    vendors.sort(key=lambda row: (str(row["FirmId"]), str(row["VendorNumber"])))
    addresses.sort(key=lambda row: (
        str(row["FirmId"]), str(row["VendorNumber"]), str(row["AddressCode"])
    ))
    write_csv(output / "Vendor.csv", vendors, VENDOR_FIELDS)
    write_csv(output / "VendorAddress.csv", addresses, ADDRESS_FIELDS)
    write_csv(
        output / "OrphanVendorAddress.csv", orphan_rows,
        [
            "FirmId", "VendorNumber", "AddressCode", "SourceRecordIdentity",
            "Classification", "Reason",
        ],
    )
    write_csv(
        output / "OrphanVendorDetail.csv", orphan_detail_rows,
        ["FirmId", "VendorNumber", "Classification", "Reason"],
    )

    no_address = sum(
        1 for key in vendor_keys if address_vendor_counts[key] == 0
    )
    no_phone = sum(1 for row in vendors if row["PrimaryPhone"] is None)
    no_contact = sum(
        1 for row in vendors if row["PrimaryContactName"] is None
    )
    multiple_addresses = sum(
        1 for count in address_vendor_counts.values() if count > 1
    )
    ambiguous_terms = sum(1 for values in detail_terms.values() if len(values) > 1)
    number_cross_firm_duplicates = sum(
        1 for firms in vendor_number_firms.values() if len(firms) > 1
    )
    representatives = {
        "fullContact": next((
            row["VendorNumber"] for row in vendors
            if row["PrimaryPhone"] and row["PrimaryContactName"]
        ), None),
        "blankContact": next((
            row["VendorNumber"] for row in vendors
            if not row["PrimaryContactName"]
        ), None),
        "punctuationOrLongName": next((
            row["VendorNumber"] for row in vendors
            if row["VendorName"] and (
                any(char in row["VendorName"] for char in "&'.,-/")
                or len(row["VendorName"]) >= 28
            )
        ), None),
        "multipleAddresses": next((
            key[1] for key, count in address_vendor_counts.items()
            if count > 1
        ), None),
    }
    metadata: dict[str, object] = {
        "schema": "dle-vendor-master-package",
        "schemaVersion": "1.0",
        "contractVersion": "VENDOR_MASTER_1.0",
        "sourceQualificationRunId": args.source_run_id,
        "harnessCommit": "0f252d9b1578221947b7cb8f9fbab3e8fe0ba966",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "naturalKeys": {
            "Vendor": ["FirmId", "VendorNumber"],
            "VendorAddress": ["FirmId", "VendorNumber", "AddressCode"],
        },
        "counts": {
            "Vendor": len(vendors), "VendorAddress": len(addresses),
            "Total": len(vendors) + len(addresses),
            "BlankVendorName": blank_names,
            "DuplicateVendorNaturalKeys": 0,
            "DuplicateAddressNaturalKeys": 0,
            "OrphanVendorDetails": len(detail_orphans),
            "OrphanAddresses": len(orphan_rows),
            "MultipleAddressVendors": multiple_addresses,
            "VendorsWithoutPurchasingAddress": no_address,
            "VendorsWithoutPrimaryPhone": no_phone,
            "VendorsWithoutPrimaryContact": no_contact,
            "VendorNumbersUsedAcrossFirms": number_cross_firm_duplicates,
            "DetailProfiles": len(detail_keys),
            "VendorsWithAmbiguousPaymentTerms": ambiguous_terms,
            "VendorBuyerAssignments": len(apm06),
            "RestrictedCommentRecords": len(apm09),
            "Apm10LookupRecords": len(apm10),
            "Ivm10LookupRecords": len(ivm10),
        },
        "statusQualification": {
            "VendorStatus": "Unavailable", "IsActive": "Unavailable",
            "ApprovedSupplierStatus": "Unavailable",
            "reason": (
                "No physical active/inactive or quality-approval field is "
                "proven in the qualified operational source."
            ),
        },
        "holdAggregateByRawCode": dict(sorted(hold_counts.items())),
        "restrictedFieldPresence": dict(sorted(restricted_presence.items())),
        "restrictedFieldsExcludedFromDataFiles": True,
        "paymentTermsRule": (
            "Resolved only when every current APM-02 profile for the vendor "
            "has the same nonblank terms code; otherwise null."
        ),
        "orphanPolicy": (
            "Supporting rows without current APM-01 parents are excluded "
            "from operational entities and retained in classified orphan CSVs."
        ),
        "representativeVendorNumbers": representatives,
    }
    (output / "metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    files = [
        "Vendor.csv", "VendorAddress.csv", "OrphanVendorAddress.csv",
        "OrphanVendorDetail.csv", "metadata.json",
    ]
    hashes = {name: sha256(output / name) for name in files}
    digest = hashlib.sha256()
    for name in sorted(hashes):
        digest.update(f"{name}:{hashes[name]}\n".encode("ascii"))
    package_hash = digest.hexdigest().upper()
    manifest = {**metadata, "files": hashes, "packageSha256": package_hash}
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    (output / "package.sha256").write_text(package_hash + "\n", encoding="ascii")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-run-id", required=True)
    args = parser.parse_args()
    print(json.dumps(build(args), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Build the governed Supporting Code Tables package from qualified safe rows."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


FIELDS = [
    "FirmId", "CodeDomain", "CodeType", "CodeValue", "CodeDescription",
    "ShortDescription", "ParentCodeValue", "SortOrder", "IsActive",
    "SourceType", "AccessClassification", "ResolutionStatus",
    "SourceRecordIdentity", "UsageCount",
]
RELATIONSHIP_FIELDS = [
    "FirmId", "FromDomain", "FromType", "FromValue", "RelationshipType",
    "ToDomain", "ToType", "ToValue",
]
USAGE_FIELDS = [
    "CanonicalTable", "Field", "FirmId", "CodeDomain", "CodeType",
    "CodeValue", "OccurrenceCount", "ResolutionStatus",
]
PROHIBITED = re.compile(
    r"payroll|deduct|withhold|password|security|credential|bank|routing|"
    r"social.?security|federal.?id|tax.?juris|salary|pay.?rate",
    re.IGNORECASE,
)

SOURCE_MAP = {
    ("ARM-10", "A"): ("Sales", "PaymentTerms", "SalesOperational"),
    ("ARM-10", "E"): ("Sales", "SalesOrderLineType", "SalesOperational"),
    ("ARM-10", "F"): ("Sales", "Salesperson", "SalesOperational"),
    ("ARM-10", "H"): ("Customer", "Territory", "GeneralOperational"),
    ("ARM-10", "L"): ("Customer", "CustomerType", "GeneralOperational"),
    ("APM-10", "C"): ("Purchasing", "PaymentTerms", "PurchasingOperational"),
    ("IVM-10", "A"): ("Inventory", "ProductType", "GeneralOperational"),
    ("IVM-10", "B"): ("Inventory", "TransactionType", "GeneralOperational"),
    ("IVM-10", "C"): ("Inventory", "Warehouse", "GeneralOperational"),
    ("IVM-10", "F"): ("Purchasing", "Buyer", "PurchasingOperational"),
    ("IVM-13", "A"): ("Inventory", "ItemClass", "GeneralOperational"),
    ("POM-02", "A"): (
        "Purchasing", "PurchaseOrderLineType", "PurchasingOperational"
    ),
    ("POM-03", "A"): (
        "Quality", "RejectionReason", "QualityOperational"
    ),
    ("PRM-10", "E"): ("Employee", "Department", "GeneralOperational"),
    ("PRM-10", "F"): ("Employee", "JobTitle", "GeneralOperational"),
    ("SYM-02", "A"): ("Employee", "Operator", "GeneralOperational"),
    ("WOM-10", "A"): (
        "Production", "WorkOrderType", "ProductionOperational"
    ),
}

RESTRICTED_SOURCE_MAP = {
    ("ARM-10", "M"): ("Customer", "PricingClass", "AccountingRestricted"),
}

CANONICAL_ENUMS = {
    ("Production", "WorkOrderStatus"),
    ("Accounting", "AccountType"),
    ("Purchasing", "PurchaseOrderStatus"),
    ("Purchasing", "PurchaseOrderLineStatus"),
    ("Receiving", "ReceiptType"),
    ("Receiving", "ReceiptStatus"),
    ("Quality", "InspectionStatus"),
    ("Receiving", "QuantityDispositionStatus"),
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def decode(value: str) -> str:
    if not value:
        return ""
    return bytes.fromhex(value).decode("latin-1").lstrip("\x00\r\n").strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def normalized_pass_fingerprint(rows: list[dict[str, str]]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        material = "|".join(
            row[name] for name in (
                "source", "key_hex", "layout", "firm_id_hex",
                "code_value_hex", "description_hex",
            )
        )
        digest.update(material.encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest().upper()


def write_csv(path: Path, fields: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def resolution(description: str) -> str:
    upper = description.upper()
    if not description:
        return "Unresolved"
    if "UNKNOWN" in upper or upper in {"DEFAULT", "SYSTEM", "GENERIC"}:
        return "GenericSystem"
    return "Resolved"


def build(args: argparse.Namespace) -> dict[str, Any]:
    started = time.perf_counter()
    output: Path = args.output.resolve()
    source: Path = args.source.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    verdict = json.loads(args.attempt_verdict.read_text(encoding="utf-8-sig"))
    if verdict.get("Verdict") != "PASS":
        raise ValueError("Harness attempt did not pass")
    if verdict.get("SourceAccessMode") != "O_RDONLY":
        raise ValueError("Source access was not O_RDONLY")
    if any(verdict.get(name) != 0 for name in (
        "SourceWrites", "SourceLocks", "MissionOwnedProcessesRemaining"
    )):
        raise ValueError("Harness source-safety boundary did not pass")
    if not verdict.get("SourceIdentityStable"):
        raise ValueError("Source identity was not stable")

    fingerprints: dict[str, str] = {}
    source_rows: list[dict[str, str]] = []
    for path1 in sorted((source / "Pass1").glob("*-safe.csv")):
        path2 = source / "Pass2" / path1.name
        rows1, rows2 = read_csv(path1), read_csv(path2)
        fp1 = normalized_pass_fingerprint(rows1)
        fp2 = normalized_pass_fingerprint(rows2)
        if fp1 != fp2:
            raise ValueError(f"Cross-pass projection mismatch: {path1.name}")
        fingerprints[path1.name] = fp1
        source_rows.extend(rows1)

    records: list[dict[str, Any]] = []
    seen: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    blank_source_values = 0
    restricted_source_records_excluded = 0
    for row in source_rows:
        source_key = (row["source"], row["layout"])
        if source_key in RESTRICTED_SOURCE_MAP:
            restricted_source_records_excluded += 1
            continue
        if source_key not in SOURCE_MAP:
            raise ValueError(f"Unexpected source/layout: {source_key}")
        domain, code_type, access = SOURCE_MAP[source_key]
        firm = decode(row["firm_id_hex"]) or "GLOBAL"
        code = decode(row["code_value_hex"])
        description = decode(row["description_hex"])
        if not code:
            blank_source_values += 1
            continue
        if PROHIBITED.search(f"{domain} {code_type} {description}"):
            raise ValueError(
                f"Prohibited description entered general package: {source_key}"
            )
        status = resolution(description)
        record = {
            "FirmId": firm,
            "CodeDomain": domain,
            "CodeType": code_type,
            "CodeValue": code,
            "CodeDescription": description or None,
            "ShortDescription": None,
            "ParentCodeValue": None,
            "SortOrder": None,
            "IsActive": None,
            "SourceType": "SourceMaster",
            "AccessClassification": access,
            "ResolutionStatus": status,
            "SourceRecordIdentity": row["key_hex"],
            "UsageCount": 0,
        }
        natural = (firm, domain, code_type, code)
        prior = seen.get(natural)
        if prior and prior["CodeDescription"] != record["CodeDescription"]:
            prior["CodeDescription"] = None
            prior["ResolutionStatus"] = "Ambiguous"
            continue
        if not prior:
            seen[natural] = record
            records.append(record)

    usage_rows = read_csv(args.usage)
    usage_totals: Counter[tuple[str, str, str, str]] = Counter()
    usage_evidence: list[dict[str, Any]] = []
    for row in usage_rows:
        firm = row["FirmId"].strip() or "01"
        domain, code_type, code = (
            row["CodeDomain"].strip(),
            row["CodeType"].strip(),
            row["CodeValue"].strip(),
        )
        if not code:
            continue
        natural = (firm, domain, code_type, code)
        count = int(row["OccurrenceCount"])
        usage_totals[natural] += count
        source_type = row["Classification"]
        if source_type in {"FreeText", "Restricted"}:
            continue
        matched = seen.get(natural)
        if matched:
            use_status = matched["ResolutionStatus"]
        elif (domain, code_type) in CANONICAL_ENUMS:
            record = {
                "FirmId": firm, "CodeDomain": domain, "CodeType": code_type,
                "CodeValue": code, "CodeDescription": code,
                "ShortDescription": None, "ParentCodeValue": None,
                "SortOrder": None, "IsActive": None,
                "SourceType": "CanonicalEnum",
                "AccessClassification": "InternalOnly",
                "ResolutionStatus": "CanonicalEnum",
                "SourceRecordIdentity": None, "UsageCount": 0,
            }
            seen[natural] = record
            records.append(record)
            use_status = "CanonicalEnum"
        elif source_type in {"TransactionDerived", "Unresolved"}:
            record = {
                "FirmId": firm, "CodeDomain": domain, "CodeType": code_type,
                "CodeValue": code, "CodeDescription": None,
                "ShortDescription": None, "ParentCodeValue": None,
                "SortOrder": None, "IsActive": None,
                "SourceType": source_type,
                "AccessClassification": "GeneralOperational",
                "ResolutionStatus": "Unresolved",
                "SourceRecordIdentity": None, "UsageCount": 0,
            }
            seen[natural] = record
            records.append(record)
            use_status = "Unresolved"
        else:
            use_status = "Unresolved"
        usage_evidence.append({
            "CanonicalTable": row["CanonicalTable"],
            "Field": row["Field"],
            "FirmId": firm,
            "CodeDomain": domain,
            "CodeType": code_type,
            "CodeValue": code,
            "OccurrenceCount": count,
            "ResolutionStatus": use_status,
        })

    for natural, count in usage_totals.items():
        if natural in seen:
            seen[natural]["UsageCount"] = count

    natural_keys = [
        (r["FirmId"], r["CodeDomain"], r["CodeType"], r["CodeValue"])
        for r in records
    ]
    if len(natural_keys) != len(set(natural_keys)):
        raise ValueError("Duplicate canonical ReferenceCode natural key")
    records.sort(key=lambda r: (
        r["FirmId"], r["CodeDomain"], r["CodeType"], r["CodeValue"]
    ))
    usage_evidence.sort(key=lambda r: (
        r["CanonicalTable"], r["Field"], r["CodeValue"]
    ))
    relationships: list[dict[str, Any]] = []

    write_csv(output / "ReferenceCode.csv", FIELDS, records)
    write_csv(
        output / "ReferenceCodeRelationship.csv",
        RELATIONSHIP_FIELDS, relationships
    )
    write_csv(output / "ReferenceCodeUsage.csv", USAGE_FIELDS, usage_evidence)

    statuses = Counter(r["ResolutionStatus"] for r in records)
    for name in (
        "Resolved", "Unresolved", "Ambiguous", "GenericSystem",
        "Deprecated", "CanonicalEnum",
    ):
        statuses.setdefault(name, 0)
    domain_types = Counter(
        f"{r['CodeDomain']}.{r['CodeType']}" for r in records
    )
    collisions = defaultdict(set)
    for record in records:
        collisions[record["CodeValue"]].add(
            (record["CodeDomain"], record["CodeType"])
        )
    namespace_collisions = sum(
        1 for namespaces in collisions.values() if len(namespaces) > 1
    )
    metadata = {
        "schema": "dle-reference-code-package",
        "schemaVersion": "1.0",
        "contractVersion": "REFERENCE_CODE_1.0",
        "sourceQualificationAttemptId": verdict["AttemptId"],
        "harnessCommit": "0f252d9b1578221947b7cb8f9fbab3e8fe0ba966",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "naturalKey": ["FirmId", "CodeDomain", "CodeType", "CodeValue"],
        "sourceAccessMode": "O_RDONLY",
        "privacyBoundary": "OPERATIONAL_ALLOWLIST_ONLY",
        "counts": {
            "ReferenceCode": len(records),
            "ReferenceCodeRelationship": len(relationships),
            "ReferenceCodeUsage": len(usage_evidence),
            "DuplicateCanonicalKeys": 0,
            "BlankSourceValuesExcluded": blank_source_values,
            "RestrictedSourceRecordsExcluded": restricted_source_records_excluded,
            "NamespaceCollisionValuesSafelySeparated": namespace_collisions,
            "ProhibitedFieldsPresent": 0,
            **dict(sorted(statuses.items())),
        },
        "countsByDomainType": dict(sorted(domain_types.items())),
        "safeProjectionFingerprints": fingerprints,
        "restrictedFamiliesExcluded": [
            "Accounting distribution and tax detail",
            "Customer pricing class descriptions",
            "Payroll pay/deduction/tax/contribution/union/W2 codes",
            "Security roles, levels, and credentials",
        ],
        "buildDurationMilliseconds": round(
            (time.perf_counter() - started) * 1000, 3
        ),
    }
    metadata_path = output / "metadata.json"
    metadata_path.write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    files = [
        "ReferenceCode.csv", "ReferenceCodeRelationship.csv",
        "ReferenceCodeUsage.csv", "metadata.json",
    ]
    manifest = {
        "schema": "dle-reference-code-manifest",
        "schemaVersion": "1.0",
        "files": [{"name": name, "sha256": sha256(output / name)} for name in files],
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    package_hash = sha256(manifest_path)
    (output / "package.sha256").write_text(
        package_hash + "\n", encoding="ascii"
    )
    metadata["packageSha256"] = package_hash
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--attempt-verdict", type=Path, required=True)
    parser.add_argument("--usage", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args), indent=2))


if __name__ == "__main__":
    main()

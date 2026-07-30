#!/usr/bin/env python3
"""Build the privacy-bounded Employee Reference canonical package."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


EMPLOYEE_FIELDS = [
    "FirmId", "EmployeeNumber", "DisplayName", "FirstName", "LastName",
    "DepartmentCode", "DepartmentName", "JobTitleCode", "JobTitle",
    "EmployeeStatus", "IsActive", "SourceSystem", "SourceRecordIdentity",
]
CODE_FIELDS = [
    "CodeScope", "FirmId", "EmployeeNumber", "CodeType", "OperationalCode",
    "CodeDescription", "ResolutionStatus", "IsActive", "SourceSystem",
    "SourceRecordIdentity",
]
DEPARTMENT_FIELDS = [
    "FirmId", "DepartmentCode", "DepartmentName", "SourceSystem",
    "SourceRecordIdentity",
]
TITLE_FIELDS = [
    "FirmId", "JobTitleCode", "JobTitle", "SourceSystem",
    "SourceRecordIdentity",
]
PACKAGE_ALLOWLIST = {
    "EmployeeReference.csv": EMPLOYEE_FIELDS,
    "EmployeeOperationalCode.csv": CODE_FIELDS,
    "DepartmentReference.csv": DEPARTMENT_FIELDS,
    "JobTitleReference.csv": TITLE_FIELDS,
}
PROHIBITED_PATTERN = re.compile(
    r"(ssn|socialsecurity|taxid|payrate|salary|bank|routing|deduction|"
    r"withholding|birthdate|homeaddress|password|pin|garnish|benefit|"
    r"insurance|medical|emergency|immigration|citizenship|disciplin|"
    r"attendance|payrollhistory)",
    re.IGNORECASE,
)
GENERIC_CODES = {"+ON"}
GENERIC_WORDS = {
    "SYSTEM", "DEFAULT", "GENERIC", "TEST ACCOUNT", "HOUSE ACCOUNT",
    "CASH SALE", "CONVERSION", "UNASSIGNED",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def decode_hex(value: str) -> str:
    if not value:
        return ""
    return bytes.fromhex(value).decode("latin-1").rstrip()


def optional(value: str) -> str | None:
    value = value.strip()
    return value or None


def normalized_name(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def normalized_projection_fingerprint(path: Path) -> str:
    rows = read_csv(path)
    digest = hashlib.sha256()
    for row in rows:
        row.pop("pass", None)
        material = json.dumps(
            row, sort_keys=True, separators=(",", ":"), ensure_ascii=True
        )
        digest.update(material.encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest().upper()


def verify_two_passes(source: Path) -> dict[str, str]:
    fingerprints: dict[str, str] = {}
    for name in (
        "PRM-01-safe.csv", "PRM-10-safe.csv", "SYM-02-safe.csv",
        "ARM-10-safe.csv", "IVM-10-safe.csv",
    ):
        pass1 = normalized_projection_fingerprint(source / "Pass1" / name)
        pass2 = normalized_projection_fingerprint(source / "Pass2" / name)
        if pass1 != pass2:
            raise ValueError(f"Two-pass safe projection mismatch: {name}")
        fingerprints[name] = pass1
    return fingerprints


def ensure_unique(rows: list[dict[str, Any]], fields: tuple[str, ...], label: str) -> None:
    counts = Counter(tuple(row.get(field) for field in fields) for row in rows)
    duplicates = [key for key, count in counts.items() if count > 1]
    if duplicates:
        raise ValueError(f"Duplicate {label} natural key(s): {len(duplicates)}")


def write_csv(path: Path, fields: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="raise")
        writer.writeheader()
        for row in rows:
            writer.writerow({
                field: (
                    "" if row.get(field) is None
                    else str(row.get(field)).lower()
                    if isinstance(row.get(field), bool)
                    else row.get(field)
                )
                for field in fields
            })


def candidate_matches(
    description: str,
    employees: list[dict[str, Any]],
    firm_id: str | None,
) -> list[dict[str, Any]]:
    needle = normalized_name(description)
    if not needle:
        return []
    candidates: list[dict[str, Any]] = []
    for employee in employees:
        if firm_id and employee["FirmId"] != firm_id:
            continue
        first = str(employee["FirstName"] or "")
        last = str(employee["LastName"] or "")
        variants = {
            normalized_name(first + last),
            normalized_name(last + first),
            normalized_name(str(employee["DisplayName"])),
        }
        variants.discard("")
        if needle in variants or any(
            len(needle) >= 6 and variant.startswith(needle)
            for variant in variants
        ):
            candidates.append(employee)
    return candidates


def build(args: argparse.Namespace) -> dict[str, Any]:
    started = time.perf_counter()
    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)

    verdict = json.loads(args.attempt_verdict.read_text(encoding="utf-8-sig"))
    if verdict.get("Verdict") != "PASS":
        raise ValueError("Harness attempt did not pass")
    if verdict.get("SourceAccessMode") != "O_RDONLY":
        raise ValueError("Harness source access was not O_RDONLY")
    if (
        verdict.get("SourceWrites") != 0
        or verdict.get("SourceLocks") != 0
        or verdict.get("MissionOwnedProcessesRemaining") != 0
    ):
        raise ValueError("Harness safety boundary did not pass")

    fingerprints = verify_two_passes(source)
    prm01 = read_csv(source / "Pass1" / "PRM-01-safe.csv")
    prm10 = read_csv(source / "Pass1" / "PRM-10-safe.csv")
    code_source_rows = []
    for name in ("SYM-02-safe.csv", "ARM-10-safe.csv", "IVM-10-safe.csv"):
        code_source_rows.extend(read_csv(source / "Pass1" / name))

    departments: list[dict[str, Any]] = []
    titles: list[dict[str, Any]] = []
    department_lookup: dict[tuple[str, str], str] = {}
    title_lookup: dict[tuple[str, str], str] = {}
    for row in prm10:
        firm = decode_hex(row["firm_id_hex"])
        code = decode_hex(row["operational_code_hex"])
        description = decode_hex(row["description_hex"])
        if not code:
            continue
        if row["code_type"] == "Department":
            department_lookup[(firm, code)] = description
            departments.append({
                "FirmId": firm,
                "DepartmentCode": code,
                "DepartmentName": optional(description),
                "SourceSystem": "VPRO5_PRM-10E",
                "SourceRecordIdentity": row["key_hex"],
            })
        elif row["code_type"] == "JobTitle":
            title_lookup[(firm, code)] = description
            titles.append({
                "FirmId": firm,
                "JobTitleCode": code,
                "JobTitle": optional(description),
                "SourceSystem": "VPRO5_PRM-10F",
                "SourceRecordIdentity": row["key_hex"],
            })
        else:
            raise ValueError(f"Unexpected PRM-10 code type: {row['code_type']}")

    employees: list[dict[str, Any]] = []
    for row in prm01:
        firm = decode_hex(row["firm_id_hex"])
        number = decode_hex(row["employee_number_hex"])
        first = decode_hex(row["first_name_hex"])
        last = decode_hex(row["last_name_hex"])
        department = decode_hex(row["department_code_hex"])
        title = decode_hex(row["title_code_hex"])
        active = row["is_active"] == "1"
        if not firm or not number:
            raise ValueError("Employee natural key is blank")
        employees.append({
            "FirmId": firm,
            "EmployeeNumber": number,
            "DisplayName": (first + " " + last).strip(),
            "FirstName": optional(first),
            "LastName": optional(last),
            "DepartmentCode": optional(department),
            "DepartmentName": optional(
                department_lookup.get((firm, department), "")
            ),
            "JobTitleCode": optional(title),
            "JobTitle": optional(title_lookup.get((firm, title), "")),
            "EmployeeStatus": "Active" if active else "Inactive",
            "IsActive": active,
            "SourceSystem": "VPRO5_PRM-01",
            "SourceRecordIdentity": row["key_hex"],
        })

    ensure_unique(employees, ("FirmId", "EmployeeNumber"), "employee")
    ensure_unique(departments, ("FirmId", "DepartmentCode"), "department")
    ensure_unique(titles, ("FirmId", "JobTitleCode"), "job title")

    codes: list[dict[str, Any]] = []
    blank_code_count = 0
    resolution_counts: Counter[str] = Counter()
    for row in code_source_rows:
        code_type = row["code_type"]
        code = decode_hex(row["operational_code_hex"])
        description = decode_hex(row["description_hex"])
        firm = (
            decode_hex(row.get("firm_id_hex", ""))
            if row.get("firm_id_hex") else None
        )
        if not code:
            blank_code_count += 1
            continue
        matches = candidate_matches(description, employees, firm)
        if code.upper() in GENERIC_CODES or any(
            word in description.upper() for word in GENERIC_WORDS
        ):
            status = "GenericSystem"
            employee = None
        elif len(matches) == 1:
            status = "ResolvedUnique"
            employee = matches[0]
        elif len(matches) > 1:
            status = "Ambiguous"
            employee = None
        else:
            status = "Unresolved"
            employee = None
        resolution_counts[f"{code_type}:{status}"] += 1
        codes.append({
            "CodeScope": "GLOBAL" if row["source"] == "SYM-02" else "FIRM",
            "FirmId": employee["FirmId"] if employee else firm,
            "EmployeeNumber": (
                employee["EmployeeNumber"] if employee else None
            ),
            "CodeType": code_type,
            "OperationalCode": code,
            "CodeDescription": optional(description),
            "ResolutionStatus": status,
            "IsActive": employee["IsActive"] if employee else None,
            "SourceSystem": f"VPRO5_{row['source']}",
            "SourceRecordIdentity": row["key_hex"],
        })

    ensure_unique(codes, ("CodeScope", "CodeType", "OperationalCode"), "code")
    employees.sort(key=lambda row: (row["FirmId"], row["EmployeeNumber"]))
    codes.sort(key=lambda row: (
        row["CodeType"], str(row["FirmId"] or ""), row["OperationalCode"]
    ))
    departments.sort(key=lambda row: (row["FirmId"], row["DepartmentCode"]))
    titles.sort(key=lambda row: (row["FirmId"], row["JobTitleCode"]))

    datasets = {
        "EmployeeReference.csv": employees,
        "EmployeeOperationalCode.csv": codes,
        "DepartmentReference.csv": departments,
        "JobTitleReference.csv": titles,
    }
    for name, rows in datasets.items():
        write_csv(output / name, PACKAGE_ALLOWLIST[name], rows)

    for name, fields in PACKAGE_ALLOWLIST.items():
        actual = list(read_csv(output / name)[0].keys()) if datasets[name] else fields
        if actual != fields:
            raise ValueError(f"Package allowlist mismatch for {name}")
        for field in actual:
            if PROHIBITED_PATTERN.search(field):
                raise ValueError(f"Prohibited package field: {field}")

    metadata = {
        "schema": "dle-employee-reference-package",
        "schemaVersion": "1.0",
        "contractVersion": "EMPLOYEE_REFERENCE_1.0",
        "sourceQualificationAttemptId": verdict["AttemptId"],
        "sourceAccessMode": "O_RDONLY",
        "privacyBoundary": "ALLOWLIST_ONLY",
        "counts": {
            "EmployeeReference": len(employees),
            "EmployeeOperationalCode": len(codes),
            "DepartmentReference": len(departments),
            "JobTitleReference": len(titles),
            "ActiveEmployees": sum(1 for row in employees if row["IsActive"]),
            "InactiveEmployees": sum(
                1 for row in employees if not row["IsActive"]
            ),
            "BlankEmployeeNames": sum(
                1 for row in employees if not row["DisplayName"]
            ),
            "BlankOperationalCodesExcluded": blank_code_count,
        },
        "codeResolutionCounts": dict(sorted(resolution_counts.items())),
        "safeProjectionFingerprints": fingerprints,
        "prohibitedFieldsPresent": 0,
        "buildDurationMilliseconds": round(
            (time.perf_counter() - started) * 1000, 3
        ),
    }
    metadata_path = output / "metadata.json"
    metadata_path.write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )

    manifest_files = [
        *PACKAGE_ALLOWLIST.keys(),
        "metadata.json",
    ]
    manifest = {
        "schema": "dle-employee-reference-manifest",
        "schemaVersion": "1.0",
        "files": [
            {"name": name, "sha256": sha256(output / name)}
            for name in manifest_files
        ],
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
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args), indent=2))


if __name__ == "__main__":
    main()

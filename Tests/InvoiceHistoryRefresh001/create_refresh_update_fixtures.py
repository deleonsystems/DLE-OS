from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=fields, quoting=csv.QUOTE_ALL
        )
        writer.writeheader()
        writer.writerows(rows)


def finalize(package: Path, manifest: dict) -> None:
    content_paths = [
        package / "Canonical" / "CustomerInvoice.csv",
        package / "Canonical" / "CustomerInvoiceLine.csv",
        package / "Evidence" / "comparison.csv",
    ]
    material = "".join(
        f"{path.relative_to(package).as_posix()}|{sha256(path)}\n"
        for path in content_paths
    )
    manifest["packageContentSha256"] = hashlib.sha256(
        material.encode()
    ).hexdigest().upper()
    (package / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    rows = []
    for path in sorted(package.rglob("*")):
        if path.is_file() and path.name != "hashes.csv":
            rows.append(
                {
                    "RelativePath": path.relative_to(package).as_posix(),
                    "Bytes": str(path.stat().st_size),
                    "Sha256": sha256(path),
                }
            )
    write_csv(
        package / "hashes.csv",
        ["RelativePath", "Bytes", "Sha256"],
        rows,
    )


def create_package(
    base: Path, target: Path, run_id: str, mutate: bool
) -> dict[str, str]:
    package = target / "Package"
    shutil.copytree(base, package)
    line_path = package / "Canonical" / "CustomerInvoiceLine.csv"
    with line_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    selected = rows[0]
    original = selected["ItemDescription"]
    if mutate:
        selected["ItemDescription"] = original + " [REFRESH QUALIFICATION]"
    write_csv(line_path, fields, rows)

    natural_key = "|".join(
        selected[field].strip()
        for field in (
            "FirmId",
            "ArType",
            "CustomerNumber",
            "InvoiceNumber",
            "InvoiceLineNumber",
        )
    )
    comparison_path = package / "Evidence" / "comparison.csv"
    with comparison_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        comparison_fields = list(reader.fieldnames or [])
        comparison = list(reader)
    matches = [
        row for row in comparison
        if row["Entity"] == "CustomerInvoiceLine"
        and row["NaturalKey"] == natural_key
    ]
    if len(matches) != 1:
        raise ValueError("Fixture line comparison row was not unique.")
    matches[0]["Classification"] = "Update"
    matches[0]["ChangedFields"] = "ItemDescription"
    write_csv(comparison_path, comparison_fields, comparison)

    manifest_path = package / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["runId"] = run_id
    manifest["createdAtUtc"] = datetime.now(timezone.utc).isoformat()
    manifest["qualificationFixture"] = True
    manifest["lineClassifications"] = {"Unchanged": 49, "Update": 1}
    finalize(package, manifest)
    return {
        "runId": run_id,
        "package": str(package),
        "naturalKey": natural_key,
        "originalDescription": original,
        "fixtureDescription": selected["ItemDescription"],
    }


def create_missing_package(
    base: Path, target: Path, run_id: str
) -> dict[str, str]:
    package = target / "Package"
    shutil.copytree(base, package)
    line_path = package / "Canonical" / "CustomerInvoiceLine.csv"
    with line_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    removed = rows.pop(0)
    write_csv(line_path, fields, rows)
    natural_key = "|".join(
        removed[field].strip()
        for field in (
            "FirmId",
            "ArType",
            "CustomerNumber",
            "InvoiceNumber",
            "InvoiceLineNumber",
        )
    )
    comparison_path = package / "Evidence" / "comparison.csv"
    with comparison_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        comparison_fields = list(reader.fieldnames or [])
        comparison = list(reader)
    matches = [
        row for row in comparison
        if row["Entity"] == "CustomerInvoiceLine"
        and row["NaturalKey"] == natural_key
    ]
    if len(matches) != 1:
        raise ValueError("Missing-row comparison was not unique.")
    matches[0]["Classification"] = "MissingFromSource"
    matches[0]["ChangedFields"] = ""
    write_csv(comparison_path, comparison_fields, comparison)
    manifest_path = package / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["runId"] = run_id
    manifest["createdAtUtc"] = datetime.now(timezone.utc).isoformat()
    manifest["qualificationFixture"] = True
    manifest["verdict"] = "PASS WITH CLARIFICATIONS"
    manifest["counts"]["CustomerInvoiceLine"] = 49
    manifest["lineClassifications"] = {
        "MissingFromSource": 1,
        "Unchanged": 49,
    }
    finalize(package, manifest)
    return {
        "runId": run_id,
        "package": str(package),
        "naturalKey": natural_key,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--runs-root", type=Path, required=True)
    parser.add_argument("--update-run-id", required=True)
    parser.add_argument("--restore-run-id", required=True)
    parser.add_argument("--missing-run-id")
    args = parser.parse_args()
    result = {
        "update": create_package(
            args.base,
            args.runs_root / args.update_run_id,
            args.update_run_id,
            True,
        ),
        "restore": create_package(
            args.base,
            args.runs_root / args.restore_run_id,
            args.restore_run_id,
            False,
        ),
    }
    if args.missing_run_id:
        result["missing"] = create_missing_package(
            args.base,
            args.runs_root / args.missing_run_id,
            args.missing_run_id,
        )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

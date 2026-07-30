#!/usr/bin/env python3
"""Compare qualified canonical CSV packages without trusting run metadata."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path


DATASETS = {
    "customer": {
        "files": {
            "Customer.csv": ("FirmId", "CustomerNumber"),
            "CustomerAddress.csv": (
                "FirmId", "CustomerNumber", "AddressCode"),
        },
    },
    "sales-order": {
        "files": {
            "Canonical/Customer.csv": ("CustomerNumber",),
            "Canonical/SalesOrder.csv": (
                "CustomerNumber", "SalesOrderNumber"),
            "Canonical/SalesOrderLine.csv": (
                "CustomerNumber", "SalesOrderNumber", "LineNumber"),
        },
    },
}


def rows(path: Path, key_fields: tuple[str, ...]) -> dict[tuple[str, ...], str]:
    result: dict[tuple[str, ...], str] = {}
    with path.open("r", newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames or any(
                field not in reader.fieldnames for field in key_fields):
            raise ValueError(f"{path} is missing its qualified natural key")
        for row in reader:
            key = tuple(row[field] for field in key_fields)
            if key in result:
                raise ValueError(f"duplicate natural key in {path}: {key}")
            material = "\x1f".join(
                f"{name}={row[name]}" for name in reader.fieldnames)
            result[key] = hashlib.sha256(
                material.encode("utf-8")).hexdigest().upper()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", choices=sorted(DATASETS), required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--current", type=Path, required=True)
    args = parser.parse_args()

    totals = {"inserted": 0, "updated": 0, "unchanged": 0, "missing": 0}
    entities: dict[str, dict[str, int]] = {}
    for relative, key_fields in DATASETS[args.dataset]["files"].items():
        candidate = rows(args.candidate / relative, key_fields)
        current_path = args.current / relative
        current = rows(current_path, key_fields) if current_path.is_file() else {}
        counts = {
            "inserted": len(candidate.keys() - current.keys()),
            "missing": len(current.keys() - candidate.keys()),
            "updated": sum(
                candidate[key] != current[key]
                for key in candidate.keys() & current.keys()),
            "unchanged": sum(
                candidate[key] == current[key]
                for key in candidate.keys() & current.keys()),
        }
        for name, value in counts.items():
            totals[name] += value
        entities[relative] = counts
    result = {
        "dataset": args.dataset,
        "result": (
            "NO_SOURCE_CHANGES"
            if totals["inserted"] == totals["updated"] == totals["missing"] == 0
            else "CHANGES_DETECTED"
        ),
        **totals,
        "entities": entities,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

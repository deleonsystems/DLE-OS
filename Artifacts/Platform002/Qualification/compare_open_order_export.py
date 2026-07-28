#!/usr/bin/env python3
"""Compare the PLATFORM-002 projection with the supplied legacy Open Order export."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path


def load_map(path: Path, key: str) -> dict[str, dict]:
    with path.open("r", newline="", encoding="utf-8-sig") as source:
        return {row[key]: row for row in csv.DictReader(source)}


def norm_decimal(value: str) -> Decimal:
    return Decimal(value.strip() or "0")


def legacy_date_to_iso(value: str) -> str | None:
    value = value.strip()
    return datetime.strptime(value, "%m/%d/%y").date().isoformat() if value else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--export", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    canonical = args.package / "Canonical"
    with (canonical / "SalesOrder.csv").open(
        "r", newline="", encoding="utf-8-sig"
    ) as source:
        headers = {
            row["CustomerNumber"] + "|" + row["SalesOrderNumber"]: row
            for row in csv.DictReader(source)
        }
    customers = load_map(canonical / "Customer.csv", "CustomerNumber")
    lines = load_map(
        canonical / "SalesOrderLine.csv",
        "SourceKeyRaw",
    )
    projected = {
        (row["CustomerNumber"], row["SalesOrderNumber"], row["LineNumber"]): row
        for row in lines.values()
    }

    mismatches = []
    checked = 0
    with args.export.open("r", newline="", encoding="utf-8-sig") as source:
        for report in csv.DictReader(source, delimiter="\t"):
            key = (
                report["Cust#"].strip(),
                report["Sls Ord#"].strip(),
                report["Ln#"].strip(),
            )
            line = projected.get(key)
            if line is None:
                mismatches.append({"key": key, "field": "row", "expected": "present", "actual": "missing"})
                continue
            header = headers[line["CustomerNumber"] + "|" + line["SalesOrderNumber"]]
            customer = customers[header["CustomerNumber"]]
            expected = {
                "OrderDate": legacy_date_to_iso(report["Ord Dt"]),
                "CustomerNumber": report["Cust#"].strip(),
                "CustomerName": report["Cust Name"].strip(),
                "CustomerPO": report["P/O"].strip(),
                "ItemNumber": report["Item#"].strip(),
                "Description": report["Description"].strip(),
                "EstimatedShipDate": legacy_date_to_iso(report["Ship Dt"]),
                "QuantityOrdered": norm_decimal(report["Qty Open"]),
                "UnitPriceDisplay": norm_decimal(report["Price"]),
                "ExtendedPriceDisplay": norm_decimal(report["Ext Price"]),
                "WorkOrderNumber": None if report["WorkOrd"].strip() == "UNKNOWN" else report["WorkOrd"].strip(),
                "ScheduledProductionQuantity": norm_decimal(report["WorkOrd Qty"]),
                "BillNumber": report["Bill Number"].strip() or None,
                "DrawingNumber": report["Drawing Number"].strip() or None,
                "DrawingRevision": report["Drawing Revision"].strip() or None,
                "BomRevision": report["Revision Code"].strip() or None,
            }
            actual = {
                "OrderDate": header["OrderDate"] or None,
                "CustomerNumber": header["CustomerNumber"],
                "CustomerName": customer["CustomerName"].strip(),
                "CustomerPO": header["CustomerPurchaseOrderNumber"].strip(),
                "ItemNumber": line["ItemNumber"],
                "Description": line["ResolvedDescription"].strip(),
                "EstimatedShipDate": line["EstimatedShipDate"] or None,
                "QuantityOrdered": norm_decimal(line["QuantityOrdered"]),
                "UnitPriceDisplay": norm_decimal(line["UnitPrice"]).quantize(Decimal("0.01")),
                "ExtendedPriceDisplay": norm_decimal(line["ExtendedPrice"]).quantize(Decimal("0.01")),
                "WorkOrderNumber": line["WorkOrderNumber"] or None,
                "ScheduledProductionQuantity": norm_decimal(line["ScheduledProductionQuantity"] or "0"),
                "BillNumber": line["BillNumber"] or None,
                "DrawingNumber": line["DrawingNumber"] or None,
                "DrawingRevision": line["DrawingRevision"] or None,
                "BomRevision": line["BomRevision"] or None,
            }
            for field, value in expected.items():
                matches = (
                    str(actual[field]).startswith(str(value))
                    if field in {"CustomerName", "Description"}
                    else actual[field] == value
                )
                if not matches:
                    mismatches.append(
                        {
                            "key": {
                                "customerNumber": key[0],
                                "salesOrderNumber": key[1],
                                "lineNumber": key[2],
                            },
                            "field": field,
                            "report": str(value),
                            "canonical": str(actual[field]),
                        }
                    )
            checked += 1

    result = {
        "verdict": "PASS" if not mismatches and checked == len(projected) else "FAIL",
        "reportRows": checked,
        "canonicalQualifyingRows": len(projected),
        "mismatchCount": len(mismatches),
        "mismatches": mismatches[:100],
        "intentionalDifferences": [
            "Quantity Ordered replaces the misleading Quantity Open label.",
            "The hard-coded Quantity Shipped column is omitted.",
            "Unresolved Work Order relationships are null instead of UNKNOWN.",
            "Extended Price is derived from Unit Price multiplied by Quantity Ordered.",
        ],
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if result["verdict"] != "PASS":
        raise SystemExit("Open Order report parity comparison failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

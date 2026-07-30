import csv
import hashlib
import json
import os
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(os.environ.get(
    "PURCHASE_ORDER_PACKAGE",
    ROOT / "Artifacts" / "PurchaseOrderPlatform001"
    / "PURCHASEORDERPLATFORM001-20260729T212157Z" / "BaselinePackage",
))


def rows(name):
    with (PACKAGE / name).open(newline="", encoding="utf-8-sig") as stream:
        return list(csv.DictReader(stream))


def test_manifest_hash_and_counts():
    manifest = json.loads((PACKAGE / "manifest.json").read_text())
    metadata = json.loads((PACKAGE / "metadata.json").read_text())
    assert manifest["ContractVersion"] == "PURCHASE_ORDER_1.0"
    package_hash = (PACKAGE / "package.sha256").read_text().split()[0]
    assert (
        hashlib.sha256((PACKAGE / "manifest.json").read_bytes())
        .hexdigest().upper()
        == package_hash
    )
    for item in manifest["Files"]:
        assert hashlib.sha256((PACKAGE / item["Path"]).read_bytes()).hexdigest().upper() == item["Sha256"]
    assert len(rows("PurchaseOrder.csv")) == metadata["HeaderCount"]
    assert len(rows("PurchaseOrderLine.csv")) == metadata["LineCount"]


def test_harness_configuration_is_fixed_read_only_boundary():
    config = json.loads((
        ROOT / "Tools" / "VProQualificationHarness"
        / "Configurations" / "PurchaseOrder.json"
    ).read_text())
    expected = {
        rf"X:\AON\ADATA\{name}"
        for name in ("POE-02", "POE-12", "POE-04", "POE-14", "POT-04", "POT-14")
    }
    assert config["RequiredIdentity"] == r"DLE-OS-HOST\DLE-OS"
    assert config["RequireNonElevated"] is True
    assert set(config["RequiredSourcePaths"]) == expected
    assert config["Runtime"]["ProgressTimeoutSeconds"] == 900
    assert config["Runtime"]["HardRuntimeTimeoutSeconds"] == 2400


def test_qualifier_source_uses_only_approved_read_mode():
    source = (
        ROOT / "Tools" / "PurchaseOrder" / "VPro"
        / "PURCHASE_ORDER_QUALIFIER.src"
    ).read_text()
    assert source.count('MODE="O_RDONLY"') == 1
    assert 'PATH$="X:\\AON\\ADATA\\' in source
    assert "LOCK " not in source
    assert "WRITE RECORD" not in source
    assert "EXTRACT " not in source


def test_natural_keys_and_parent_integrity():
    headers = rows("PurchaseOrder.csv")
    lines = rows("PurchaseOrderLine.csv")
    header_keys = {
        (r["FirmId"], r["VendorNumber"], r["PurchaseOrderNumber"])
        for r in headers
    }
    line_keys = {
        (
            r["FirmId"], r["VendorNumber"], r["PurchaseOrderNumber"],
            r["PurchaseOrderLineNumber"],
        )
        for r in lines
    }
    assert len(header_keys) == len(headers)
    assert len(line_keys) == len(lines)
    assert all(all(part.strip() for part in key) for key in header_keys)
    assert all(all(part.strip() for part in key) for key in line_keys)
    assert all(key[:3] in header_keys for key in line_keys)


def test_quantities_dates_and_resolution():
    metadata = json.loads((PACKAGE / "metadata.json").read_text())
    lines = rows("PurchaseOrderLine.csv")
    for row in lines:
        assert Decimal(row["QuantityOpen"]) == (
            Decimal(row["QuantityOrdered"]) - Decimal(row["QuantityReceived"])
        )
        for name in ("RequiredDateIso", "PromisedDateIso", "NotBeforeDateIso"):
            assert not row[name] or len(row[name]) == 10
    assert metadata["NegativeQuantityLines"] > 0
    assert metadata["LineTypeCounts"]["Stock"] > 0
    assert metadata["LineTypeCounts"]["NonStock"] > 0
    assert metadata["CanonicalOrphanLines"] == 0
    assert metadata["ClosedLines"] == 0
    assert metadata["CanceledLines"] == 0
    assert sum(metadata["LineStatusCounts"].values()) == len(lines)
    assert metadata["OpenLinesNoReceipts"] > 0
    assert metadata["PartiallyReceivedLines"] > 0
    assert metadata["FullyReceivedLines"] > 0


def test_relationship_reconciliation_is_exhaustive():
    metadata = json.loads((PACKAGE / "metadata.json").read_text())
    for name in (
        "VendorResolution", "InventoryResolution",
        "WorkOrderResolution", "SalesOrderResolution",
    ):
        expected = (
            metadata["HeaderCount"]
            if name == "VendorResolution"
            else metadata["LineCount"]
        )
        assert sum(metadata[name].values()) == expected


def test_restricted_cost_exclusion_and_orphan_classification():
    headers = rows("PurchaseOrder.csv")
    lines = rows("PurchaseOrderLine.csv")
    orphans = rows("OrphanPurchaseOrderLine.csv")
    invalid_headers = rows("InvalidPurchaseOrderHeader.csv")
    assert "UnitCost" not in headers[0]
    assert "UnitCost" not in lines[0]
    assert "ExtendedCost" not in lines[0]
    assert orphans
    assert all(row["Classification"].endswith("Excluded") for row in orphans)
    assert invalid_headers
    assert all(
        row["Classification"] == "MissingRequiredNaturalKeyExcluded"
        for row in invalid_headers
    )


def test_restricted_cost_precision_and_extension_formula():
    lines = {
        (
            row["FirmId"], row["VendorNumber"], row["PurchaseOrderNumber"],
            row["PurchaseOrderLineNumber"],
        ): row
        for row in rows("PurchaseOrderLine.csv")
    }
    costs = rows("RestrictedCostQualification.csv")
    assert len(costs) == len(lines)
    for row in costs:
        key = (
            row["FirmId"], row["VendorNumber"], row["PurchaseOrderNumber"],
            row["PurchaseOrderLineNumber"],
        )
        assert row["AccessClassification"] == "AccountingRestricted"
        assert Decimal(row["ExtendedCost"]) == (
            Decimal(row["UnitCost"]) * Decimal(lines[key]["QuantityOpen"])
        )


def test_sql_and_api_are_live_read_only_boundaries():
    schema = (
        ROOT / "Tools" / "PurchaseOrder" / "Database"
        / "031_AddPurchaseOrderPlatform.sql"
    ).read_text()
    controller = (
        ROOT / "Tools" / "PurchaseOrder" / "ServerOverlay"
        / "Controllers" / "Platform" / "LivePurchaseOrdersController.cs"
    ).read_text()
    dto = (
        ROOT / "Tools" / "PurchaseOrder" / "ServerOverlay"
        / "Contracts" / "Platform" / "PurchaseOrderDtos.cs"
    ).read_text()
    assert "USE [DLE_OS_CANONICAL_LIVE]" in schema
    assert "USE [DLE_OS]" not in schema
    assert "USE [DLE_OS_PLATFORM_LAB]" not in schema
    assert "[HttpGet" in controller
    assert "[HttpPost" not in controller
    assert "[HttpPut" not in controller
    assert "[HttpDelete" not in controller
    assert "UnitCost" not in dto
    assert "ExtendedCost" not in dto


if __name__ == "__main__":
    tests = [
        value for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(
        f"PURCHASE-ORDER-PLATFORM-001 package tests: "
        f"{len(tests)}/{len(tests)} PASS"
    )

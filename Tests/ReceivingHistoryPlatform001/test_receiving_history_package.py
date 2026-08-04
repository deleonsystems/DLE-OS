import csv
import hashlib
import json
import os
import importlib.util
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(os.environ.get(
    "RECEIVING_HISTORY_PACKAGE",
    ROOT / "Artifacts" / "ReceivingHistoryPlatform001"
    / "RECEIVINGHISTORYPLATFORM001-20260730T030741Z" / "BaselinePackage",
))
BUILDER_PATH = (
    ROOT / "Tools" / "ReceivingHistory" / "build_receiving_history_package.py"
)
BUILDER_SPEC = importlib.util.spec_from_file_location(
    "receiving_history_builder", BUILDER_PATH
)
BUILDER = importlib.util.module_from_spec(BUILDER_SPEC)
assert BUILDER_SPEC.loader is not None
BUILDER_SPEC.loader.exec_module(BUILDER)


def rows(name):
    with (PACKAGE / name).open(newline="", encoding="utf-8-sig") as stream:
        return list(csv.DictReader(stream))


def test_manifest_hash_counts_and_files():
    manifest = json.loads((PACKAGE / "manifest.json").read_text())
    metadata = json.loads((PACKAGE / "metadata.json").read_text())
    assert manifest["Contract"] == "RECEIVING_HISTORY_CANONICAL_V1"
    package_hash = (PACKAGE / "package.sha256").read_text().split()[0]
    assert hashlib.sha256(
        (PACKAGE / "manifest.json").read_bytes()
    ).hexdigest().upper() == package_hash
    for item in manifest["Files"]:
        assert hashlib.sha256(
            (PACKAGE / item["Path"]).read_bytes()
        ).hexdigest().upper() == item["Sha256"]
    assert len(rows("PurchaseReceipt.csv")) == metadata["Counts"]["PurchaseReceipt"]
    assert (
        len(rows("PurchaseReceiptLine.csv"))
        == metadata["Counts"]["PurchaseReceiptLine"]
    )
    assert (
        len(rows("ReceiptRejection.csv"))
        == metadata["Counts"]["ReceiptRejection"]
    )
    malformed = rows("MalformedOrderDate.csv")
    assert len(malformed) == 5
    assert metadata["Population"]["MalformedOrderDates"] == 5
    assert metadata["Population"]["ExpectedMalformedOrderDates"] == 5
    assert len(rows("MalformedReceiptDate.csv")) == 1
    assert len(rows("MalformedRequiredDate.csv")) == 26
    assert metadata["Population"]["MalformedReceiptDates"] == 1
    assert metadata["Population"]["ExpectedMalformedReceiptDates"] == 1
    assert metadata["Population"]["MalformedRequiredDates"] == 26
    assert metadata["Population"]["ExpectedMalformedRequiredDates"] == 26
    assert len(rows("HeaderWithoutLine.csv")) == 4
    assert metadata["HeadersWithoutLines"] == 4
    assert metadata["Population"]["HeadersWithoutLines"] == 4
    assert metadata["Population"]["ExpectedHeadersWithoutLines"] == 4


def test_order_date_resolution_for_valid_blank_and_out_of_horizon_values():
    assert BUILDER.resolve_order_date("991123", 2026) == (
        "1999-11-23", "Resolved", None
    )
    assert BUILDER.resolve_order_date("B30125", 2026) == (
        "2013-01-25", "Resolved", None
    )
    assert BUILDER.resolve_order_date("C60228", 2026) == (
        "2026-02-28", "Resolved", None
    )
    for blank in ("", "      ", "000000", "XXXXXX"):
        assert BUILDER.resolve_order_date(blank, 2026) == (
            None, "BlankSourceValue", None
        )
    for malformed_source in ("311029", "490916", "481114"):
        assert BUILDER.resolve_order_date(malformed_source, 2026) == (
            None,
            "InvalidSourceValue",
            "Decoded date exceeds qualified snapshot horizon",
        )


def test_order_date_resolution_rejects_structural_and_calendar_errors():
    for invalid in ("B31301", "B30230", "B90229", "C60229", "not-a-date"):
        try:
            BUILDER.resolve_order_date(invalid, 2026)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid date was accepted: {invalid}")
    assert BUILDER.resolve_order_date("C40229", 2026)[0] == "2024-02-29"


def test_receipt_and_required_date_resolution_is_field_specific():
    assert BUILDER.resolve_optional_legacy_date("B60613", 2026) == (
        "2016-06-13", "Resolved", None
    )
    assert BUILDER.resolve_optional_legacy_date("B30226", 2026) == (
        "2013-02-26", "Resolved", None
    )
    for blank in ("", "      ", "000000", "XXXXXX"):
        assert BUILDER.resolve_optional_legacy_date(blank, 2026) == (
            None, "BlankSourceValue", None
        )
    for raw in ("D01129", "291120", "F50917", "300802", "C70103"):
        assert BUILDER.resolve_optional_legacy_date(raw, 2026) == (
            None,
            "InvalidSourceValue",
            "Decoded date exceeds qualified historical/snapshot horizon",
        )
    for invalid in ("B61301", "B60230", "not-a-date"):
        try:
            BUILDER.resolve_optional_legacy_date(invalid, 2026)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Structurally invalid date accepted: {invalid}")


def test_additive_date_count_gates_are_exact():
    BUILDER.validate_field_date_count("Receipt Date", 1, 1)
    BUILDER.validate_field_date_count("Required Date", 26, 26)
    for field, observed, expected in (
        ("Receipt Date", 2, 1),
        ("Required Date", 27, 26),
    ):
        try:
            BUILDER.validate_field_date_count(field, observed, expected)
        except ValueError as error:
            assert f"expected {expected}, observed {observed}" in str(error)
        else:
            raise AssertionError(f"Unexpected {field} count was accepted")


def test_order_date_baseline_count_is_exact_and_fail_closed():
    BUILDER.validate_malformed_order_date_count(5, 5)
    try:
        BUILDER.validate_malformed_order_date_count(6, 5)
    except ValueError as error:
        assert "expected 5, observed 6" in str(error)
    else:
        raise AssertionError("Unexpected sixth malformed date was accepted")
    try:
        BUILDER.validate_malformed_order_date_count(4, 5)
    except ValueError as error:
        assert "expected 5, observed 4" in str(error)
    else:
        raise AssertionError("Unexpected malformed-date count was accepted")


def test_blank_purchase_order_baseline_count_is_exact_and_fail_closed():
    BUILDER.validate_missing_purchase_order_count(1, 1)
    for observed in (0, 2):
        try:
            BUILDER.validate_missing_purchase_order_count(observed, 1)
        except ValueError as error:
            assert f"expected 1, observed {observed}" in str(error)
        else:
            raise AssertionError(
                "Unexpected blank Purchase Order count was accepted"
            )


def test_duplicate_source_identity_fails_closed():
    seen = set()
    identity = "30313030303137342020202020202030303330353131"
    BUILDER.require_unique_source_identity(identity, seen, "receipt-header")
    try:
        BUILDER.require_unique_source_identity(
            identity, seen, "receipt-header"
        )
    except ValueError as error:
        assert "duplicate receipt-header source key" in str(error)
    else:
        raise AssertionError("Duplicate receipt-header source key was accepted")


def test_malformed_order_dates_preserve_raw_and_never_infer_a_date():
    malformed = rows("MalformedOrderDate.csv")
    assert {row["OrderDateRaw"] for row in malformed} == {
        "311029", "490916", "481114"
    }
    assert all(row["OrderDateIso"] == "" for row in malformed)
    assert all(
        row["OrderDateResolutionStatus"] == "InvalidSourceValue"
        for row in malformed
    )
    assert all(
        row["OrderDateResolutionReason"]
        == "Decoded date exceeds qualified snapshot horizon"
        for row in malformed
    )
    headers = rows("PurchaseReceipt.csv")
    malformed_headers = [
        row for row in headers
        if row["OrderDateResolutionStatus"] == "InvalidSourceValue"
    ]
    assert len(malformed_headers) == 5
    assert all(row["OrderDateIso"] == "" for row in malformed_headers)


def test_additive_malformed_dates_preserve_raw_status_and_null_iso():
    receipt = rows("MalformedReceiptDate.csv")
    required = rows("MalformedRequiredDate.csv")
    assert len(receipt) == 1
    assert receipt[0]["ReceiptDateRaw"] == "D01129"
    assert receipt[0]["ReceiptDateIso"] == ""
    assert receipt[0]["ReceiptDateResolutionStatus"] == "InvalidSourceValue"
    assert len(required) == 26
    assert {row["RequiredDateRaw"] for row in required} == {
        "291120", "F50917", "300802", "C70103"
    }
    assert all(row["RequiredDateIso"] == "" for row in required)
    assert all(
        row["RequiredDateResolutionStatus"] == "InvalidSourceValue"
        for row in required
    )
    reason = "Decoded date exceeds qualified historical/snapshot horizon"
    assert receipt[0]["ReceiptDateResolutionReason"] == reason
    assert all(row["RequiredDateResolutionReason"] == reason for row in required)


def test_order_date_policy_has_no_value_specific_code():
    source = BUILDER_PATH.read_text()
    for value in ("311029", "490916", "481114"):
        assert value not in source


def test_harness_configuration_is_fixed_read_only_boundary():
    config = json.loads((
        ROOT / "Tools" / "VProQualificationHarness"
        / "Configurations" / "ReceivingHistory.json"
    ).read_text())
    assert config["RequiredIdentity"] == r"DLE-OS-HOST\DLE-OS"
    assert config["RequireNonElevated"] is True
    assert set(config["RequiredSourcePaths"]) == {
        rf"X:\AON\ADATA\{name}" for name in ("POT-03", "POT-04", "POT-14")
    }
    assert config["Retry"]["MaximumAutomaticRetries"] == 1
    assert config["Retry"]["RetryableCategories"] == ["RUNTIME_EXIT"]


def test_qualifier_is_fixed_path_and_read_only():
    source = (
        ROOT / "Tools" / "ReceivingHistory" / "VPro"
        / "RECEIVING_HISTORY_QUALIFIER.src"
    ).read_text()
    assert 'MODE="O_RDONLY"' in source
    assert all(
        f'PATH$="X:\\AON\\ADATA\\{name}"' in source
        for name in ("POT-03", "POT-04", "POT-14")
    )
    for prohibited in ("WRITE RECORD", "EXTRACT ", "INITFILE", "ERASE "):
        assert prohibited not in source


def test_natural_keys_and_parent_integrity():
    headers = rows("PurchaseReceipt.csv")
    lines = rows("PurchaseReceiptLine.csv")
    rejections = rows("ReceiptRejection.csv")
    header_keys = {row["SourceRecordIdentity"] for row in headers}
    line_keys = {row["SourceRecordIdentity"] for row in lines}
    rejection_keys = {row["SourceRecordIdentity"] for row in rejections}
    assert len(header_keys) == len(headers)
    assert len(line_keys) == len(lines)
    assert len(rejection_keys) == len(rejections)
    assert all(
        row["PurchaseReceiptSourceRecordIdentity"] in header_keys
        for row in lines
    )
    assert all(
        row["PurchaseReceiptLineSourceRecordIdentity"] in line_keys
        for row in rejections
    )
    header_only = rows("HeaderWithoutLine.csv")
    assert len(header_only) == 4
    assert all(row["SourceRecordIdentity"] in header_keys for row in header_only)
    assert not any(
        row["SourceRecordIdentity"]
        in {line["PurchaseReceiptSourceRecordIdentity"] for line in lines}
        for row in header_only
    )


def test_qualified_blank_purchase_order_is_retained_without_inference():
    headers = rows("PurchaseReceipt.csv")
    lines = rows("PurchaseReceiptLine.csv")
    missing = rows("MissingPurchaseOrderReference.csv")
    blank_headers = [
        row for row in headers if not row["PurchaseOrderNumber"]
    ]
    blank_lines = [
        row for row in lines if not row["PurchaseOrderNumber"]
    ]
    assert len(blank_headers) == 1
    assert len(blank_lines) == 1
    header = blank_headers[0]
    line = blank_lines[0]
    assert header["SourceRecordIdentity"] == (
        "30313030303137342020202020202030303330353131"
    )
    assert line["SourceRecordIdentity"] == (
        "30313030303137342020202020202030303330353131303130"
    )
    assert line["PurchaseReceiptSourceRecordIdentity"] == (
        header["SourceRecordIdentity"]
    )
    assert header["ReceiverNumber"] == "0030511"
    assert line["ItemNumber"] == "77-3714-6"
    assert Decimal(line["QuantityPostedSigned"]) == 0
    assert header["PurchaseOrderResolutionStatus"] == (
        "MissingRequiredSourceValue"
    )
    assert line["PurchaseOrderResolutionStatus"] == (
        "MissingRequiredSourceValue"
    )
    assert len(missing) == 1
    assert missing[0]["SourceRecordIdentity"] == header["SourceRecordIdentity"]
    assert missing[0]["ResolutionStatus"] == "MissingRequiredSourceValue"
    for placeholder in ("UNKNOWN", "MISSING", "0000000"):
        assert header["PurchaseOrderNumber"] != placeholder
        assert line["PurchaseOrderNumber"] != placeholder


def test_blank_purchase_order_is_excluded_from_po_reconciliation():
    reconciliation = rows("PurchaseOrderReconciliation.csv")
    assert all(row["PurchaseOrderNumber"] for row in reconciliation)
    metadata = json.loads((PACKAGE / "metadata.json").read_text())
    assert metadata["Population"]["BlankPurchaseOrderHeaders"] == 1
    assert metadata["Population"]["ExpectedBlankPurchaseOrderHeaders"] == 1
    assert metadata["QualifiedOrphanReceipts"] == 1


def test_purchase_order_natural_key_policy_is_unchanged():
    invalid = list(csv.DictReader((
        ROOT / "Artifacts" / "PurchaseOrderPlatform001"
        / "PURCHASEORDERPLATFORM001-20260729T212157Z"
        / "BaselinePackage" / "InvalidPurchaseOrderHeader.csv"
    ).open(newline="", encoding="utf-8-sig")))
    retained_source_identity = (
        "303130303031373420202020202020"
    )
    source_row = [
        row for row in invalid
        if row["SourceRecordIdentity"] == retained_source_identity
    ]
    assert len(source_row) == 1
    assert source_row[0]["Classification"] == (
        "MissingRequiredNaturalKeyExcluded"
    )


def test_signed_quantity_semantics_and_restricted_cost_exclusion():
    lines = rows("PurchaseReceiptLine.csv")
    assert lines
    assert any(Decimal(row["QuantityPostedSigned"]) < 0 for row in lines)
    for row in lines:
        posted = Decimal(row["QuantityPostedSigned"])
        assert Decimal(row["QuantityReceived"]) == max(posted, Decimal(0))
        assert Decimal(row["QuantityAccepted"]) == max(posted, Decimal(0))
        assert Decimal(row["QuantityReturned"]) == max(-posted, Decimal(0))
        assert "UnitCost" not in row
        assert "ExtendedCost" not in row


def test_sql_and_api_are_live_read_only_boundaries():
    schema = (
        ROOT / "Tools" / "ReceivingHistory" / "Database"
        / "032_AddReceivingHistoryPlatform.sql"
    ).read_text()
    controller = (
        ROOT / "Tools" / "ReceivingHistory" / "ServerOverlay"
        / "Controllers" / "Platform" / "LiveReceivingHistoryController.cs"
    ).read_text()
    dto = (
        ROOT / "Tools" / "ReceivingHistory" / "ServerOverlay"
        / "Contracts" / "Platform" / "ReceivingHistoryDtos.cs"
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
    assert "OrderDateRaw" in dto
    assert "OrderDateIso" in dto
    assert "OrderDateResolutionStatus" in dto
    assert "OrderDateResolutionReason" in dto
    assert "MalformedOrderDateCount" in dto
    assert "MissingPurchaseOrderCount" in dto
    assert "ReceiptDateResolutionStatus" in dto
    assert "RequiredDateResolutionStatus" in dto
    assert "MalformedReceiptDateCount" in dto
    assert "MalformedRequiredDateCount" in dto
    assert (
        "PurchaseOrderNumber nvarchar(7) "
        "COLLATE Latin1_General_100_BIN2 NULL"
    ) in schema
    assert "PRIMARY KEY (SourceRecordIdentity)" in schema


if __name__ == "__main__":
    tests = [
        value for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(
        "RECEIVING-HISTORY-PLATFORM-001 package tests: "
        f"{len(tests)}/{len(tests)} PASS"
    )

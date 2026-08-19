#!/usr/bin/env python3
"""Deterministic contracts for the governed live Open SO shadow harness."""

from __future__ import annotations

import csv
import importlib.util
import json
import tempfile
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
HARNESS_PATH = REPO / "Tools/OperationsRefresh/live_bounded_sales_order_shadow.py"
CENTER_PATH = (
    REPO / "Tools/LiveSnapshotRefresh/ControlHost/"
    "OpenSalesOrderShadowQualificationCenter.cs")


def load():
    spec = importlib.util.spec_from_file_location("live_shadow", HARNESS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("live shadow module cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


shadow = load()
passed = 0


def check(name: str, rule) -> None:
    global passed
    rule()
    passed += 1
    print(f"PASS {name}")


def write_rows(path: Path, rows: list[dict[str, str]]) -> None:
    fields = ["pass", "source_file", "source_key_hex", "record_raw_hex",
              "layout_id", "decoded_record_material"]
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=fields, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)


def row(key: str, material: str | None = None) -> dict[str, str]:
    return {"pass": "1", "source_file": "ARE-13",
            "source_key_hex": key.encode("latin-1").hex().upper(),
            "record_raw_hex": (key + "RAW").encode("latin-1").hex().upper(),
            "layout_id": "A", "decoded_record_material": material or "S"}


def keyed_contract() -> None:
    with tempfile.TemporaryDirectory(prefix="DLE-OS-LiveShadow-Test-") as temp:
        root = Path(temp)
        prefixes = ["01  0000010000001", "01  0000020000002"]
        rows = [row(prefixes[0] + "000"), row(prefixes[0] + "010"),
                row(prefixes[1] + "000"), row(prefixes[1] + "020")]
        write_rows(root / "full.csv", rows)
        write_rows(root / "bounded.csv", rows)
        with (root / "summary.csv").open("w", newline="", encoding="utf-8") as output:
            fields = ["prefix_hex", "requested_key_hex", "first_key_hex",
                      "last_key_hex", "terminating_key_hex", "record_count",
                      "position_status", "termination_status"]
            writer = csv.DictWriter(output, fieldnames=fields)
            writer.writeheader()
            for index, prefix in enumerate(prefixes):
                keys = [prefix + "000", prefix + ("010" if index == 0 else "020")]
                terminal = prefixes[1] + "000" if index == 0 else ""
                writer.writerow({
                    "prefix_hex": prefix.encode().hex(),
                    "requested_key_hex": prefixes[index].encode().hex(),
                    "first_key_hex": keys[0].encode().hex(),
                    "last_key_hex": keys[-1].encode().hex(),
                    "terminating_key_hex": terminal.encode().hex(),
                    "record_count": "2", "position_status": "PASS",
                    "termination_status": "PREFIX_CHANGE" if terminal else "READ_END",
                })
        result = shadow.verify_keyed_behavior(
            root / "full.csv", root / "bounded.csv", root / "summary.csv", prefixes)
        assert result["skippedRecords"] == 0
        assert result["unintendedRecords"] == 0
        assert result["prefixTerminationSafe"] is True


def mismatch_rejected() -> None:
    with tempfile.TemporaryDirectory(prefix="DLE-OS-LiveShadow-Test-") as temp:
        root = Path(temp)
        prefix = "01  0000010000001"
        rows = [row(prefix + "000"), row(prefix + "010")]
        write_rows(root / "full.csv", rows)
        write_rows(root / "bounded.csv", rows[:1])
        (root / "summary.csv").write_text("unused\n", encoding="utf-8")
        try:
            shadow.verify_keyed_behavior(
                root / "full.csv", root / "bounded.csv", root / "summary.csv", [prefix])
        except RuntimeError as error:
            assert str(error).startswith("ARE13_PARITY_MISMATCH")
            return
        raise AssertionError("a skipped record was accepted")


def numeric_material_precision_contract() -> None:
    with tempfile.TemporaryDirectory(prefix="DLE-OS-LiveShadow-Test-") as temp:
        root = Path(temp)
        prefix = "01  0000010000001"
        key = prefix + "010"
        exact = "S00|S00|N0|N-42.8571|N0"
        rounded = "S00|S00|N0|N-42.86|N0"
        write_rows(root / "full.csv", [row(key, exact)])
        write_rows(root / "bounded.csv", [row(key, exact)])
        with (root / "summary.csv").open(
                "w", newline="", encoding="utf-8") as output:
            fields = ["prefix_hex", "requested_key_hex", "first_key_hex",
                      "last_key_hex", "terminating_key_hex", "record_count",
                      "position_status", "termination_status"]
            writer = csv.DictWriter(output, fieldnames=fields)
            writer.writeheader()
            writer.writerow({
                "prefix_hex": prefix.encode().hex(),
                "requested_key_hex": prefix.encode().hex(),
                "first_key_hex": key.encode().hex(),
                "last_key_hex": key.encode().hex(),
                "terminating_key_hex": "", "record_count": "1",
                "position_status": "PASS", "termination_status": "READ_END",
            })
        result = shadow.verify_keyed_behavior(
            root / "full.csv", root / "bounded.csv", root / "summary.csv",
            [prefix])
        assert result["skippedRecords"] == 0
        write_rows(root / "bounded.csv", [row(key, rounded)])
        try:
            shadow.verify_keyed_behavior(
                root / "full.csv", root / "bounded.csv",
                root / "summary.csv", [prefix])
        except RuntimeError as error:
            assert str(error).startswith("ARE13_PARITY_MISMATCH")
            return
        raise AssertionError("rounded negative numeric material was accepted")


def source_change_and_cleanup() -> None:
    identity = [{"path": "synthetic", "length": 1, "lastWriteTimeNs": 1}]
    with tempfile.TemporaryDirectory(prefix="DLE-OS-LiveShadow-Test-") as temp:
        result = shadow.exercise_failure_safety(Path(temp), identity)
        assert result["temporaryPartialRemoved"] is True
        assert result["sourceChangeRejected"] is True
        assert result["interruptedOwnedChild"]["terminated"] is True


def fixed_governance_contract() -> None:
    harness = HARNESS_PATH.read_text(encoding="utf-8")
    center = CENTER_PATH.read_text(encoding="utf-8")
    for value in ("O_RDONLY", "canonicalPromotionAttempted\": False",
                  "normalSyncPathChanged\": False", "require_identity_match",
                  "QUALIFICATION_ROOT.resolve()", "skippedRecords\": 0",
                  "unintendedRecords\": 0"):
        assert value in harness, value
    generated = shadow.candidate.bounded_vpro_source(
        ["01  0000010000001"], Path(r"C:\Qualification"))
    assert "PRECISION 16" in generated
    for value in ("sync/operations/qualification/open-sales-order-shadow",
                  "NormalUserProcess.Start", '"-Samples", "3"',
                  "VPRO_ALREADY_RUNNING", "QUALIFICATION_CONFLICT",
                  "EnsureWorkerStateAccess();", '@"DLE-OS-HOST\\DLE-OS"',
                  "FileSystemRights.Modify | FileSystemRights.Synchronize",
                  "InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit"):
        assert value in center, value


def authoritative_source_is_split_only_by_file() -> None:
    template = shadow.TEMPLATE.read_text(encoding="ascii")
    for number in range(1, 5):
        transformed = shadow.single_file_full_source(
            template, number, "TEST", Path(r"C:\Qualification"))
        assert f"0200 FOR FILE={number} TO {number}" in transformed
        assert 'MODE="O_RDONLY"' in transformed
        assert "READ RECORD" in transformed


check("actual KEY positioning and prefix termination contract", keyed_contract)
check("skipped bounded record is rejected", mismatch_rejected)
check("negative numeric material retains exact precision",
      numeric_material_precision_contract)
check("source-change and interrupted-child cleanup", source_change_and_cleanup)
check("fixed output and governed endpoint boundary", fixed_governance_contract)
check("authoritative full reader logic is preserved", authoritative_source_is_split_only_by_file)
print(f"OPEN-SALES-ORDER-LIVE-SHADOW-001: PASS ({passed} checks)")

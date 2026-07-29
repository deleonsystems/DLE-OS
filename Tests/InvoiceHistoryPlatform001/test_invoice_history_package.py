from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "Tools" / "InvoiceHistory" / "build_invoice_history_package.py"
SPEC = importlib.util.spec_from_file_location("invoice_history_package", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CANDIDATE = Path(r"C:\DLE-OS\Canonical\InvoiceHistory\Candidate")


class InvoiceHistoryPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.headers = MODULE.load_csv(
            CANDIDATE / "Canonical" / "CustomerInvoice.csv"
        )
        cls.lines = MODULE.load_csv(
            CANDIDATE / "Canonical" / "CustomerInvoiceLine.csv"
        )
        cls.manifest = json.loads(
            (CANDIDATE / "manifest.json").read_text(encoding="utf-8")
        )

    def test_candidate_schema_and_counts(self) -> None:
        self.assertEqual(
            self.manifest["schema"], "DLE_INVOICE_HISTORY_BASELINE_V1"
        )
        self.assertEqual(self.manifest["schemaVersion"], 1)
        self.assertEqual(len(self.headers), 19_092)
        self.assertEqual(len(self.lines), 26_036)

    def test_natural_key_uniqueness(self) -> None:
        keys = {
            (
                row["FirmId"],
                row["ArType"],
                row["CustomerNumber"],
                row["InvoiceNumber"],
                row["InvoiceLineNumber"],
            )
            for row in self.lines
        }
        self.assertEqual(len(keys), len(self.lines))

    def test_duplicate_key_rejected(self) -> None:
        duplicate = copy.deepcopy(self.lines[:2])
        duplicate.append(copy.deepcopy(duplicate[0]))
        with self.assertRaisesRegex(ValueError, "Duplicate natural keys"):
            MODULE.validate_rows(
                self.headers,
                duplicate,
            )

    def test_signed_quantity_and_price_preserved(self) -> None:
        negative = [
            row
            for row in self.lines
            if Decimal(row["QuantityShipped"]) < 0
        ]
        self.assertEqual(len(negative), 415)
        self.assertTrue(
            any(Decimal(row["ExtendedPrice"]) < 0 for row in negative)
        )

    def test_unique_work_order(self) -> None:
        sample = next(
            row
            for row in self.lines
            if row["CustomerNumber"] == "001148"
            and row["InvoiceNumber"] == "0169292"
            and row["InvoiceLineNumber"] == "030"
        )
        self.assertEqual(sample["WorkOrderResolutionStatus"], "Unique")
        self.assertEqual(sample["WorkOrderNumber"], "0111450")
        self.assertEqual(sample["WorkOrderCandidateCount"], "1")

    def test_unresolved_work_order_is_null(self) -> None:
        unresolved = [
            row
            for row in self.lines
            if row["WorkOrderResolutionStatus"] == "Unresolved"
        ]
        self.assertEqual(len(unresolved), 9_466)
        self.assertTrue(all(not row["WorkOrderNumber"] for row in unresolved))

    def test_ambiguous_work_order_is_never_guessed(self) -> None:
        ambiguous = [
            row
            for row in self.lines
            if row["WorkOrderResolutionStatus"] == "Ambiguous"
        ]
        self.assertEqual(len(ambiguous), 105)
        self.assertTrue(all(not row["WorkOrderNumber"] for row in ambiguous))
        self.assertTrue(
            all(int(row["WorkOrderCandidateCount"]) > 1 for row in ambiguous)
        )

    def test_current_master_classification(self) -> None:
        current = [
            row
            for row in self.lines
            if row["ManufacturingResolutionType"]
            == "CurrentMasterResolved"
        ]
        self.assertEqual(len(current), 6_389)
        self.assertTrue(all(row["BillNumber"] for row in current))

    def test_invalid_cardinality_rejected(self) -> None:
        lines = copy.deepcopy(self.lines[:1])
        lines[0]["WorkOrderResolutionStatus"] = "Ambiguous"
        lines[0]["WorkOrderCandidateCount"] = "2"
        lines[0]["WorkOrderNumber"] = "0111450"
        with self.assertRaisesRegex(ValueError, "Ambiguous"):
            MODULE.validate_rows(self.headers, lines)

    def test_refresh_pipeline_separation(self) -> None:
        refresh = (
            ROOT
            / "Tools"
            / "LiveSnapshotRefresh"
            / "Invoke-LiveSnapshotRefresh.ps1"
        ).read_text(encoding="utf-8")
        self.assertNotIn("InvoiceHistory", refresh)
        self.assertNotIn("CustomerInvoice", refresh)


if __name__ == "__main__":
    unittest.main(verbosity=2)

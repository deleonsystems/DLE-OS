import csv
import importlib.util
import json
import re
import unittest
from collections import Counter
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
RUN = (
    REPO / "Artifacts" / "SupportingCodeTablesPlatform001"
    / "SUPPORTINGCODETABLESPLATFORM001-20260730T133739Z"
)
PACKAGE = RUN / "BaselinePackage"
MODULE_PATH = (
    REPO / "Tools" / "SupportingCodeTables"
    / "build_supporting_code_package.py"
)
SPEC = importlib.util.spec_from_file_location("reference_builder", MODULE_PATH)
BUILDER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(BUILDER)


def rows(name: str):
    with (PACKAGE / name).open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


class SupportingCodePackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.codes = rows("ReferenceCode.csv")
        cls.usage = rows("ReferenceCodeUsage.csv")
        cls.metadata = json.loads((PACKAGE / "metadata.json").read_text())

    def test_contract(self):
        self.assertEqual("REFERENCE_CODE_1.0", self.metadata["contractVersion"])

    def test_harness_commit(self):
        self.assertEqual(
            "0f252d9b1578221947b7cb8f9fbab3e8fe0ba966",
            self.metadata["harnessCommit"],
        )

    def test_read_only_source(self):
        self.assertEqual("O_RDONLY", self.metadata["sourceAccessMode"])

    def test_count(self):
        self.assertEqual(1209, len(self.codes))

    def test_metadata_count(self):
        self.assertEqual(len(self.codes), self.metadata["counts"]["ReferenceCode"])

    def test_natural_key_unique(self):
        keys = [
            (r["FirmId"], r["CodeDomain"], r["CodeType"], r["CodeValue"])
            for r in self.codes
        ]
        self.assertEqual(len(keys), len(set(keys)))

    def test_case_sensitive_codes_preserved(self):
        product_codes = {
            r["CodeValue"] for r in self.codes
            if r["CodeDomain"] == "Inventory"
            and r["CodeType"] == "ProductType"
        }
        self.assertIn("cpn", product_codes)
        self.assertIn("CPN", product_codes)

    def test_namespace_collision_protected(self):
        by_value = {}
        for row in self.codes:
            by_value.setdefault(row["CodeValue"], set()).add(
                (row["CodeDomain"], row["CodeType"])
            )
        self.assertTrue(any(len(value) > 1 for value in by_value.values()))
        self.assertEqual(
            53,
            self.metadata["counts"]["NamespaceCollisionValuesSafelySeparated"],
        )

    def test_blank_codes_excluded(self):
        self.assertFalse(any(not r["CodeValue"].strip() for r in self.codes))

    def test_resolved(self):
        self.assertTrue(any(r["ResolutionStatus"] == "Resolved" for r in self.codes))

    def test_unresolved(self):
        self.assertTrue(any(r["ResolutionStatus"] == "Unresolved" for r in self.codes))

    def test_generic_system(self):
        self.assertTrue(
            any(r["ResolutionStatus"] == "GenericSystem" for r in self.codes)
        )

    def test_canonical_enum(self):
        self.assertTrue(
            any(r["ResolutionStatus"] == "CanonicalEnum" for r in self.codes)
        )

    def test_no_unclassified_ambiguous_description(self):
        keys = Counter(
            (r["FirmId"], r["CodeDomain"], r["CodeType"], r["CodeValue"])
            for r in self.codes
        )
        self.assertEqual(1, max(keys.values()))

    def test_restricted_source_excluded(self):
        self.assertEqual(
            4, self.metadata["counts"]["RestrictedSourceRecordsExcluded"]
        )
        self.assertFalse(
            any(r["CodeType"] == "PricingClass" for r in self.codes)
        )

    def test_payroll_excluded(self):
        text = "\n".join(str(value) for r in self.codes for value in r.values())
        self.assertIsNone(re.search(r"payroll|deduct|withhold", text, re.I))

    def test_security_excluded(self):
        text = "\n".join(str(value) for r in self.codes for value in r.values())
        self.assertIsNone(re.search(r"password|security|credential", text, re.I))

    def test_payment_terms_namespaces(self):
        pairs = {
            (r["CodeDomain"], r["CodeType"])
            for r in self.codes if r["CodeType"] == "PaymentTerms"
        }
        self.assertEqual(
            {("Sales", "PaymentTerms"), ("Purchasing", "PaymentTerms")},
            pairs,
        )

    def test_warehouse_source_master(self):
        rows_ = [
            r for r in self.codes
            if r["CodeDomain"] == "Inventory"
            and r["CodeType"] == "Warehouse"
        ]
        self.assertTrue(rows_)
        self.assertTrue(all(r["SourceType"] == "SourceMaster" for r in rows_))

    def test_purchase_line_type_source_master(self):
        self.assertTrue(any(
            r["CodeDomain"] == "Purchasing"
            and r["CodeType"] == "PurchaseOrderLineType"
            and r["SourceType"] == "SourceMaster"
            for r in self.codes
        ))

    def test_rejection_reason_quality_classification(self):
        reasons = [
            r for r in self.codes if r["CodeType"] == "RejectionReason"
        ]
        self.assertEqual(6, len(reasons))
        self.assertTrue(all(
            r["AccessClassification"] == "QualityOperational"
            for r in reasons
        ))

    def test_unit_of_measure_unresolved_not_fabricated(self):
        units = [
            r for r in self.codes if r["CodeType"] == "UnitOfMeasure"
        ]
        self.assertTrue(units)
        self.assertTrue(all(not r["CodeDescription"] for r in units))

    def test_shipping_method_unresolved_not_fabricated(self):
        methods = [
            r for r in self.codes if r["CodeType"] == "ShippingMethod"
        ]
        self.assertTrue(methods)
        self.assertTrue(all(not r["CodeDescription"] for r in methods))

    def test_usage_raw_code_preserved(self):
        self.assertTrue(any(r["CodeValue"] == "EA" for r in self.usage))

    def test_source_master_parser(self):
        self.assertEqual("NET 30 DAYS", BUILDER.decode(
            "4E45542033302044415953202020202020202020"
        ))

    def test_program_defined_boundary(self):
        self.assertNotIn(
            "ProgramDefined",
            {r["SourceType"] for r in self.codes},
            "No program-defined code family was qualified for this baseline.",
        )

    def test_relationship_file_is_bounded_empty(self):
        self.assertEqual([], rows("ReferenceCodeRelationship.csv"))

    def test_cross_pass_fingerprints_exist(self):
        self.assertEqual(9, len(self.metadata["safeProjectionFingerprints"]))

    def test_package_hash_shape(self):
        value = (PACKAGE / "package.sha256").read_text().strip()
        self.assertRegex(value, r"^[0-9A-F]{64}$")

    def test_purchase_order_enrichment_is_additive(self):
        dto = (
            REPO / "Tools" / "PurchaseOrder" / "ServerOverlay"
            / "Contracts" / "Platform" / "PurchaseOrderDtos.cs"
        ).read_text()
        self.assertIn("PaymentTermsDescription", dto)
        self.assertIn("LineCodeDescription", dto)
        self.assertIn("UnitOfMeasureResolutionStatus", dto)

    def test_sql_is_transactional_and_read_only_api(self):
        importer = (
            REPO / "Tools" / "SupportingCodeTables"
            / "Import-SupportingCodeTablesBaseline.ps1"
        ).read_text()
        schema = (
            REPO / "Tools" / "SupportingCodeTables" / "Database"
            / "034_AddSupportingCodeTablesPlatform.sql"
        ).read_text()
        self.assertIn("BeginTransaction", importer)
        self.assertIn("Rollback", importer)
        self.assertIn("DENY INSERT, UPDATE, DELETE", schema)


if __name__ == "__main__":
    unittest.main()

import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


extractor = load_module(
    "focused_sales_order_refresh",
    ROOT / "Tools/OperationsRefresh/focused_sales_order_refresh.py",
)


class WorkOrderRelationshipContractTests(unittest.TestCase):
    def test_bounded_reader_uses_qualified_cursor_record_sequence(self):
        source = extractor.bounded_source("OPENSALESREFRESH-20260803T000000Z-1234ABCD", Path("C:/Temp"), ["01B0010820012088010"])
        self.assertIn("READ RECORD(10,ERR=29400)R$", source)
        self.assertNotIn("READ RECORD(10,KEY=K$", source)
        self.assertIn("K$(1,19)<>P$[X]", source)
        self.assertRegex(source, r"GOTO \d+\n\d+ NEXT X")

    def test_relationship_reader_preserves_multiple_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "WOE03_FULL.csv"
            prefix = "01B0011650011824090"
            rows = [
                (prefix + "  " + work_order).encode("latin-1").hex().upper()
                for work_order in ("0115350", "0115417")
            ]
            with path.open("w", newline="", encoding="utf-8") as target:
                writer = csv.DictWriter(target, fieldnames=[
                    "pass", "source_file", "source_key_hex", "record_raw_hex",
                    "layout_id", "decoded_record_material"
                ])
                writer.writeheader()
                for key_hex in rows:
                    writer.writerow({
                        "pass": "1", "source_file": "WOE-03",
                        "source_key_hex": key_hex, "record_raw_hex": "00",
                        "layout_id": "B", "decoded_record_material": "K" + key_hex
                    })
            relationships = extractor.read_woe03_relationships(path)
            self.assertEqual(relationships, {
                (prefix, "0115350"),
                (prefix, "0115417"),
            })

    def test_zero_relationship_result_is_an_explicit_blocker(self):
        source = (ROOT / "Tools/OperationsRefresh/focused_sales_order_refresh.py").read_text(encoding="utf-8")
        self.assertIn("returned zero rows", source)
        self.assertIn("candidate promotion is blocked", source)
        self.assertIn("missing_relationships", source)

    def test_package_builder_has_no_first_candidate_selection(self):
        source = (ROOT / "Artifacts/Platform002/Qualification/build_sales_order_package.py").read_text(encoding="utf-8")
        self.assertNotIn("relation.setdefault", source)
        self.assertIn("candidate_wo = candidates[0] if len(candidates) == 1 else None", source)
        self.assertIn("SalesOrderWorkOrderRelationship.csv", source)


if __name__ == "__main__":
    unittest.main()

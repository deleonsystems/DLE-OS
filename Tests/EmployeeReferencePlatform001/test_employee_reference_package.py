import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "Tools" / "EmployeeReference" / "build_employee_reference_package.py"
SPEC = importlib.util.spec_from_file_location("employee_package", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


def hx(value: str) -> str:
    return value.encode("latin-1").hex().upper()


def write_rows(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


class EmployeeReferencePackageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.verdict = self.root / "attempt-verdict.json"
        self.verdict.write_text(json.dumps({
            "Verdict": "PASS",
            "AttemptId": "ATTEMPT-1",
            "SourceAccessMode": "O_RDONLY",
            "SourceWrites": 0,
            "SourceLocks": 0,
            "MissionOwnedProcessesRemaining": 0,
        }), encoding="utf-8")
        employee_fields = [
            "pass", "source", "key_hex", "firm_id_hex",
            "employee_number_hex", "last_name_hex", "first_name_hex",
            "department_code_hex", "title_code_hex", "is_active",
        ]
        lookup_fields = [
            "pass", "source", "key_hex", "code_type", "firm_id_hex",
            "operational_code_hex", "description_hex",
        ]
        operator_fields = [
            "pass", "source", "key_hex", "code_type",
            "operational_code_hex", "description_hex",
        ]
        base = {
            "source": "PRM-01", "key_hex": hx("01000000001"),
            "firm_id_hex": hx("01"), "employee_number_hex": hx("000000001"),
            "last_name_hex": hx("DOE"), "first_name_hex": hx("JANE"),
            "department_code_hex": hx("10"), "title_code_hex": hx("AA"),
            "is_active": "1",
        }
        prm10 = [
            {
                "source": "PRM-10", "key_hex": hx("01E10"),
                "code_type": "Department", "firm_id_hex": hx("01"),
                "operational_code_hex": hx("10"),
                "description_hex": hx("OPERATIONS"),
            },
            {
                "source": "PRM-10", "key_hex": hx("01FAA"),
                "code_type": "JobTitle", "firm_id_hex": hx("01"),
                "operational_code_hex": hx("AA"),
                "description_hex": hx("LEAD"),
            },
        ]
        sources = {
            "PRM-01-safe.csv": (employee_fields, [base]),
            "PRM-10-safe.csv": (lookup_fields, prm10),
            "SYM-02-safe.csv": (operator_fields, [{
                "source": "SYM-02", "key_hex": hx("JAN"),
                "code_type": "Operator", "operational_code_hex": hx("JAN"),
                "description_hex": hx("JANE DOE"),
            }]),
            "ARM-10-safe.csv": (lookup_fields, [{
                "source": "ARM-10", "key_hex": hx("01FJD"),
                "code_type": "Salesperson", "firm_id_hex": hx("01"),
                "operational_code_hex": hx("JD"),
                "description_hex": hx("JANE DOE"),
            }]),
            "IVM-10-safe.csv": (lookup_fields, [{
                "source": "IVM-10", "key_hex": hx("01FBUY"),
                "code_type": "Buyer", "firm_id_hex": hx("01"),
                "operational_code_hex": hx("BUY"),
                "description_hex": hx("UNKNOWN"),
            }]),
        }
        for pass_number in (1, 2):
            for name, (fields, rows) in sources.items():
                write_rows(
                    self.source / f"Pass{pass_number}" / name,
                    fields,
                    [{"pass": str(pass_number), **row} for row in rows],
                )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def build(self):
        output = self.root / "package"
        args = type("Args", (), {
            "source": self.source,
            "attempt_verdict": self.verdict,
            "output": output,
        })
        return MODULE.build(args), output

    def test_builds_allowlisted_package_and_resolves_unique_codes(self):
        metadata, output = self.build()
        self.assertEqual(1, metadata["counts"]["EmployeeReference"])
        self.assertEqual(3, metadata["counts"]["EmployeeOperationalCode"])
        rows = MODULE.read_csv(output / "EmployeeOperationalCode.csv")
        by_type = {row["CodeType"]: row for row in rows}
        self.assertEqual("ResolvedUnique", by_type["Operator"]["ResolutionStatus"])
        self.assertEqual("ResolvedUnique", by_type["Salesperson"]["ResolutionStatus"])
        self.assertEqual("Unresolved", by_type["Buyer"]["ResolutionStatus"])
        self.assertFalse(MODULE.PROHIBITED_PATTERN.search(
            (output / "manifest.json").read_text(encoding="utf-8")
        ))

    def test_inactive_and_blank_values_are_preserved(self):
        path = self.source / "Pass1" / "PRM-01-safe.csv"
        rows = MODULE.read_csv(path)
        rows[0]["is_active"] = "0"
        rows[0]["department_code_hex"] = hx("  ")
        rows[0]["title_code_hex"] = hx("  ")
        write_rows(path, list(rows[0].keys()), rows)
        path2 = self.source / "Pass2" / "PRM-01-safe.csv"
        rows2 = MODULE.read_csv(path2)
        rows2[0].update(rows[0])
        rows2[0]["pass"] = "2"
        write_rows(path2, list(rows2[0].keys()), rows2)
        _, output = self.build()
        employee = MODULE.read_csv(output / "EmployeeReference.csv")[0]
        self.assertEqual("Inactive", employee["EmployeeStatus"])
        self.assertEqual("", employee["DepartmentCode"])
        self.assertEqual("", employee["JobTitle"])

    def test_duplicate_employee_natural_key_is_rejected(self):
        for pass_number in (1, 2):
            path = self.source / f"Pass{pass_number}" / "PRM-01-safe.csv"
            rows = MODULE.read_csv(path)
            rows.append(dict(rows[0]))
            write_rows(path, list(rows[0].keys()), rows)
        with self.assertRaisesRegex(ValueError, "Duplicate employee"):
            self.build()

    def test_two_pass_mismatch_is_rejected(self):
        path = self.source / "Pass2" / "SYM-02-safe.csv"
        rows = MODULE.read_csv(path)
        rows[0]["description_hex"] = hx("CHANGED")
        write_rows(path, list(rows[0].keys()), rows)
        with self.assertRaisesRegex(ValueError, "Two-pass"):
            self.build()

    def test_ambiguous_and_unresolved_codes_are_not_forced(self):
        for pass_number in (1, 2):
            path = self.source / f"Pass{pass_number}" / "PRM-01-safe.csv"
            rows = MODULE.read_csv(path)
            duplicate_name = dict(rows[0])
            duplicate_name["key_hex"] = hx("01000000002")
            duplicate_name["employee_number_hex"] = hx("000000002")
            rows.append(duplicate_name)
            write_rows(path, list(rows[0].keys()), rows)
        _, output = self.build()
        codes = MODULE.read_csv(output / "EmployeeOperationalCode.csv")
        statuses = {row["CodeType"]: row["ResolutionStatus"] for row in codes}
        self.assertEqual("Ambiguous", statuses["Operator"])
        self.assertEqual("Unresolved", statuses["Buyer"])
        self.assertEqual("", next(
            row["EmployeeNumber"] for row in codes
            if row["CodeType"] == "Operator"
        ))

    def test_package_header_denylist_and_allowlist(self):
        for fields in MODULE.PACKAGE_ALLOWLIST.values():
            self.assertFalse(any(MODULE.PROHIBITED_PATTERN.search(x) for x in fields))
        self.assertNotIn("HireDate", MODULE.EMPLOYEE_FIELDS)
        self.assertNotIn("TerminationDate", MODULE.EMPLOYEE_FIELDS)
        self.assertNotIn("LoginName", MODULE.CODE_FIELDS)

    def test_unsafe_harness_verdict_is_rejected(self):
        data = json.loads(self.verdict.read_text(encoding="utf-8"))
        data["SourceWrites"] = 1
        self.verdict.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "safety boundary"):
            self.build()

    def test_arm10_salesperson_description_uses_first_record_string(self):
        qualifier = (
            ROOT / "Tools" / "EmployeeReference" / "VPro" /
            "EMPLOYEE_REFERENCE_QUALIFIER.src"
        ).read_text(encoding="utf-8")
        self.assertIn("ARM10F: IOLIST T0$,T1$,TN[0]", qualifier)
        self.assertIn("HTA(T0$(7,24))", qualifier)
        self.assertNotIn("HTA(T1$(1,20))", qualifier)


if __name__ == "__main__":
    unittest.main()

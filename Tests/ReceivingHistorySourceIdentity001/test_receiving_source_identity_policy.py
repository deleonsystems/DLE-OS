from __future__ import annotations

import unittest

from Tools.ReceivingHistory.SourceIdentity.receiving_source_identity_policy import (
    RECEIVING_HISTORY_POLICY,
    SourceIdentityPolicy,
    compare_source_identity,
)


POT04 = r"X:\AON\ADATA\POT-04"
UNAPPROVED = r"X:\AON\ADATA\BMM-01"
POLICY = RECEIVING_HISTORY_POLICY


def identity(path: str = POT04) -> dict[str, object]:
    return {
        "path": path,
        "length": 123,
        "creation_time_utc": "2026-01-01T00:00:00Z",
        "last_write_time_utc": "2026-01-02T00:00:00Z",
        "attributes": "Archive",
        "fid_hex": "01020304",
        "fin_hex": "00" * 24,
        "record_count": 10,
        "first_key_hex": "01",
        "last_key_hex": "10",
        "ordered_key_sha256": "A" * 64,
        "ordered_key_record_sha256": "B" * 64,
        "source_layout_sha256": "C" * 64,
        "write_count": 0,
        "lock_count": 0,
        "source_mode": "O_RDONLY",
    }


def changed_fin(value: dict[str, object], *offsets: int) -> dict[str, object]:
    result = dict(value)
    raw = bytearray.fromhex(str(result["fin_hex"]))
    for offset in offsets:
        raw[offset] = 1
    result["fin_hex"] = raw.hex()
    return result


class ReceivingSourceIdentityPolicyTests(unittest.TestCase):
    def assert_fails(self, changed: dict[str, object], reason: str) -> None:
        passed, reasons = compare_source_identity(
            identity(str(changed["path"])), changed, policy=POLICY
        )
        self.assertFalse(passed)
        self.assertIn(reason, reasons)

    def test_01_full_fin_equality_passes(self) -> None:
        self.assertEqual(
            compare_source_identity(identity(), identity(), policy=POLICY),
            (True, ()),
        )

    def test_02_approved_offsets_are_tolerated_for_approved_file(self) -> None:
        self.assertTrue(
            compare_source_identity(
                identity(), changed_fin(identity(), 14, 15, 16, 17), policy=POLICY
            )[0]
        )

    def test_03_same_offsets_on_unapproved_file_fail(self) -> None:
        left = identity(UNAPPROVED)
        self.assertFalse(
            compare_source_identity(
                left, changed_fin(left, 14), policy=POLICY
            )[0]
        )

    def test_04_other_fin_offset_fails(self) -> None:
        self.assert_fails(changed_fin(identity(), 13), "FIN_OFFSET_13")

    def test_05_fid_change_fails(self) -> None:
        changed = identity()
        changed["fid_hex"] = "FF"
        self.assert_fails(changed, "FID_HEX")

    def test_06_file_length_change_fails(self) -> None:
        changed = identity()
        changed["length"] = 124
        self.assert_fails(changed, "LENGTH")

    def test_07_record_count_change_fails(self) -> None:
        changed = identity()
        changed["record_count"] = 11
        self.assert_fails(changed, "RECORD_COUNT")

    def test_08_first_key_change_fails(self) -> None:
        changed = identity()
        changed["first_key_hex"] = "02"
        self.assert_fails(changed, "FIRST_KEY_HEX")

    def test_09_last_key_change_fails(self) -> None:
        changed = identity()
        changed["last_key_hex"] = "11"
        self.assert_fails(changed, "LAST_KEY_HEX")

    def test_10_ordered_key_hash_change_fails(self) -> None:
        changed = identity()
        changed["ordered_key_sha256"] = "D" * 64
        self.assert_fails(changed, "ORDERED_KEY_SHA256")

    def test_11_decoded_record_hash_change_fails(self) -> None:
        changed = identity()
        changed["ordered_key_record_sha256"] = "D" * 64
        self.assert_fails(changed, "ORDERED_KEY_RECORD_SHA256")

    def test_12_source_layout_change_fails(self) -> None:
        changed = identity()
        changed["source_layout_sha256"] = "D" * 64
        self.assert_fails(changed, "SOURCE_LAYOUT_SHA256")

    def test_13_nonzero_write_count_fails(self) -> None:
        changed = identity()
        changed["write_count"] = 1
        self.assert_fails(changed, "AFTER_WRITE_COUNT")

    def test_14_nonzero_lock_count_fails(self) -> None:
        changed = identity()
        changed["lock_count"] = 1
        self.assert_fails(changed, "AFTER_LOCK_COUNT")

    def test_15_missing_identity_evidence_fails(self) -> None:
        changed = identity()
        del changed["fin_hex"]
        self.assert_fails(changed, "MISSING_FIN_HEX")

    def test_16_volatile_change_with_stable_semantics_passes(self) -> None:
        changed = changed_fin(identity(), 14)
        self.assertEqual(
            compare_source_identity(identity(), changed, policy=POLICY),
            (True, ()),
        )

    def test_17_global_fin_check_is_not_weakened(self) -> None:
        left = identity(UNAPPROVED)
        self.assertFalse(
            compare_source_identity(left, changed_fin(left, 14), policy=POLICY)[0]
        )

    def test_18_existing_non_receiving_source_is_strict(self) -> None:
        left = identity(UNAPPROVED)
        self.assertEqual(
            compare_source_identity(left, left, policy=POLICY), (True, ())
        )
        self.assertFalse(
            compare_source_identity(left, changed_fin(left, 14), policy=POLICY)[0]
        )

    def test_19_wrong_source_mode_fails(self) -> None:
        changed = identity()
        changed["source_mode"] = "O_RDWR"
        self.assert_fails(changed, "AFTER_SOURCE_MODE")

    def test_20_two_full_reads_pass_when_only_approved_fin_differs(self) -> None:
        first = identity()
        second = changed_fin(identity(), 14, 15, 17)
        self.assertTrue(
            compare_source_identity(first, second, policy=POLICY)[0]
        )


if __name__ == "__main__":
    unittest.main()

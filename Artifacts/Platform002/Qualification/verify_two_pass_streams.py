#!/usr/bin/env python3
"""Fail-closed verifier for PLATFORM-002 VPro record-stream qualification."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import struct
from pathlib import Path


FILES = ("ARE03", "ARE13", "ARM01", "ARM10", "WOE03")
KEY_RAW_DOMAIN = b"VPRO_KEY_RAWRECORD_SHA256_V1\0"
DECODED_DOMAIN = b"VPRO_DECODED_RECORD_SHA256_V1\0"


def add_blob(hasher: "hashlib._Hash", value: bytes) -> None:
    hasher.update(struct.pack(">Q", len(value)))
    hasher.update(value)


def inspect_stream(path: Path, expected_pass: str) -> dict:
    key_raw = hashlib.sha256(KEY_RAW_DOMAIN)
    decoded = hashlib.sha256(DECODED_DOMAIN)
    count = 0
    first_key = None
    last_key = None

    with path.open("r", newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        expected_columns = {
            "pass",
            "source_file",
            "source_key_hex",
            "record_raw_hex",
            "layout_id",
            "decoded_record_material",
        }
        if set(reader.fieldnames or ()) != expected_columns:
            raise ValueError(f"{path}: unexpected columns {reader.fieldnames}")

        for ordinal, row in enumerate(reader, start=1):
            if row["pass"] != expected_pass:
                raise ValueError(f"{path}:{ordinal + 1}: pass is {row['pass']!r}")
            key = bytes.fromhex(row["source_key_hex"])
            raw = bytes.fromhex(row["record_raw_hex"])
            source_name = row["source_file"].encode("ascii")
            layout = row["layout_id"].encode("ascii")
            material = row["decoded_record_material"].encode("utf-8")

            key_raw.update(struct.pack(">Q", ordinal))
            add_blob(key_raw, source_name)
            add_blob(key_raw, key)
            add_blob(key_raw, raw)

            decoded.update(struct.pack(">Q", ordinal))
            add_blob(decoded, source_name)
            add_blob(decoded, key)
            add_blob(decoded, layout)
            add_blob(decoded, material)

            if last_key is not None and key <= last_key:
                raise ValueError(f"{path}:{ordinal + 1}: key order is not strictly ascending")
            if first_key is None:
                first_key = key
            last_key = key
            count = ordinal

    if count == 0:
        raise ValueError(f"{path}: empty stream")

    return {
        "rowCount": count,
        "firstKeyHex": first_key.hex().upper(),
        "lastKeyHex": last_key.hex().upper(),
        "keyRawRecordFingerprintAlgorithm": "VPRO_KEY_RAWRECORD_SHA256_V1",
        "keyRawRecordFingerprint": key_raw.hexdigest().upper(),
        "decodedFingerprintAlgorithm": "VPRO_DECODED_RECORD_SHA256_V1",
        "decodedFingerprint": decoded.hexdigest().upper(),
    }


def compare_rows(left: Path, right: Path) -> None:
    fields = (
        "source_file",
        "source_key_hex",
        "record_raw_hex",
        "layout_id",
        "decoded_record_material",
    )
    with (
        left.open("r", newline="", encoding="utf-8-sig") as left_file,
        right.open("r", newline="", encoding="utf-8-sig") as right_file,
    ):
        left_rows = csv.DictReader(left_file)
        right_rows = csv.DictReader(right_file)
        ordinal = 0
        while True:
            a = next(left_rows, None)
            b = next(right_rows, None)
            if a is None or b is None:
                if a is not None or b is not None:
                    raise ValueError(f"{left.name}/{right.name}: row-count mismatch")
                return
            ordinal += 1
            for field in fields:
                if a[field] != b[field]:
                    raise ValueError(
                        f"{left.name}/{right.name}: mismatch at row {ordinal}, field {field}"
                    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    result = {
        "mission": "PLATFORM-002",
        "verdict": "PASS",
        "fingerprintNote": (
            "These are ordered logical record-stream fingerprints, not physical-file byte hashes."
        ),
        "files": {},
    }

    try:
        for name in FILES:
            pass1 = args.runtime_root / "Pass1" / f"{name}_FULL.csv"
            pass2 = args.runtime_root / "Pass2" / f"{name}_FULL.csv"
            one = inspect_stream(pass1, "1")
            two = inspect_stream(pass2, "2")
            compare_rows(pass1, pass2)
            if one != two:
                raise ValueError(f"{name}: pass fingerprints or boundaries differ")
            result["files"][name.replace("ARE", "ARE-").replace("ARM", "ARM-").replace("WOE", "WOE-")] = {
                "pass1": one,
                "pass2": two,
                "exactRowComparison": "PASS",
            }
    except Exception as exc:
        result["verdict"] = "FAIL"
        result["error"] = str(exc)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if result["verdict"] != "PASS":
        raise SystemExit(result["error"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

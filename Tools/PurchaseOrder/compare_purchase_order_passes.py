from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path


SOURCES = ("POE-02", "POE-12", "POE-04", "POE-14", "POT-04", "POT-14")


def compare(source_root: Path, name: str) -> dict[str, object]:
    paths = [source_root / f"Pass{number}" / f"{name}.csv" for number in (1, 2)]
    streams = [path.open(encoding="utf-8-sig", newline="") for path in paths]
    try:
        readers = [csv.DictReader(stream) for stream in streams]
        key_hash = hashlib.sha256()
        record_hash = hashlib.sha256()
        count = 0
        first_key = None
        last_key = None
        while True:
            pair = [next(reader, None) for reader in readers]
            if pair[0] is None or pair[1] is None:
                if pair[0] != pair[1]:
                    raise ValueError(f"{name}: pass record counts differ")
                break
            left = (pair[0]["key_hex"], pair[0]["raw_record_hex"])
            right = (pair[1]["key_hex"], pair[1]["raw_record_hex"])
            if left != right:
                raise ValueError(
                    f"{name}: pass mismatch at record {count + 1}, "
                    f"{left[0]} != {right[0]}"
                )
            key_bytes = bytes.fromhex(left[0])
            record_bytes = bytes.fromhex(left[1])
            key_hash.update(len(key_bytes).to_bytes(4, "big"))
            key_hash.update(key_bytes)
            record_hash.update(len(key_bytes).to_bytes(4, "big"))
            record_hash.update(key_bytes)
            record_hash.update(len(record_bytes).to_bytes(8, "big"))
            record_hash.update(record_bytes)
            count += 1
            first_key = first_key or left[0]
            last_key = left[0]
        return {
            "Source": name,
            "Count": count,
            "FirstKeyHex": first_key,
            "LastKeyHex": last_key,
            "OrderedKeySha256": key_hash.hexdigest().upper(),
            "OrderedKeyRecordSha256": record_hash.hexdigest().upper(),
            "PassesIdentical": True,
        }
    finally:
        for stream in streams:
            stream.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    results = [compare(args.source, name) for name in SOURCES]
    evidence = {
        "Verdict": "PASS",
        "Algorithm": "VPRO_KEY_RECORD_SHA256_V1",
        "Framing": (
            "key: uint32 big-endian length + key bytes; "
            "record: uint64 big-endian length + decoded READ RECORD bytes"
        ),
        "Sources": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()

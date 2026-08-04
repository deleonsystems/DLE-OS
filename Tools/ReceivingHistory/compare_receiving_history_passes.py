from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

from SourceIdentity.receiving_source_identity_policy import (
    RECEIVING_HISTORY_POLICY,
    compare_fin_bytes,
)


SOURCES = ("POT-03", "POT-04", "POT-14")


def load_identity_summary(path: Path) -> dict[tuple[int, str], dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    result = {(int(row["pass"]), row["source"]): row for row in rows}
    expected = {
        (pass_number, source)
        for pass_number in (1, 2)
        for source in SOURCES
    }
    if set(result) != expected:
        raise ValueError("Source identity summary is incomplete or duplicated")
    return result


def compare(
    source_root: Path,
    name: str,
    identities: dict[tuple[int, str], dict[str, str]],
) -> dict[str, object]:
    identity_rows = [identities[(number, name)] for number in (1, 2)]
    for row in identity_rows:
        if (
            row["mode"] != "O_RDONLY"
            or row["identity"] != "PASS"
            or row["key_order"] != "PASS"
            or row["fid_before_hex"] != row["fid_after_hex"]
            or row["fin_before_hex"] != row["fin_after_hex"]
        ):
            raise ValueError(
                f"{name}: pass {row['pass']} source identity is not stable"
            )
    if identity_rows[0]["fid_before_hex"] != identity_rows[1]["fid_before_hex"]:
        raise ValueError(f"{name}: source identity differs between passes")
    fin_passed, fin_differences = compare_fin_bytes(
        identity_rows[0]["path"],
        identity_rows[0]["fin_before_hex"],
        identity_rows[1]["fin_before_hex"],
        policy=RECEIVING_HISTORY_POLICY,
    )
    if not fin_passed:
        raise ValueError(
            f"{name}: nonvolatile FIN identity differs between passes at "
            f"{fin_differences}"
        )

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
            "FidHex": identity_rows[0]["fid_before_hex"],
            "FinHex": identity_rows[0]["fin_before_hex"],
            "CrossPassFinExcludedOffsets": [14, 15, 16, 17],
            "PassesIdentical": True,
        }
    finally:
        for stream in streams:
            stream.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-summary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identities = load_identity_summary(args.source_summary)
    results = [compare(args.source, name, identities) for name in SOURCES]
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

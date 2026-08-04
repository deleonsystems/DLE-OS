from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path


SOURCES = ("POT-03", "POT-04", "POT-14")
EXPERIMENTS = ("A", "B", "C", "D", "E", "F", "G")


def sha_stream(path: Path) -> dict[str, object]:
    key_hash = hashlib.sha256()
    record_hash = hashlib.sha256()
    by_source: dict[str, dict[str, object]] = {
        source: {
            "count": 0,
            "first_key_hex": "",
            "last_key_hex": "",
            "ordered_key_sha256": hashlib.sha256(),
            "ordered_key_record_sha256": hashlib.sha256(),
            "key_order": True,
        }
        for source in SOURCES
    }
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            state = by_source[row["source"]]
            key = bytes.fromhex(row["key_hex"])
            record = bytes.fromhex(row["raw_record_hex"])
            framed_key = len(key).to_bytes(4, "big") + key
            framed_record = len(record).to_bytes(8, "big") + record
            state["ordered_key_sha256"].update(framed_key)
            state["ordered_key_record_sha256"].update(framed_key)
            state["ordered_key_record_sha256"].update(framed_record)
            if state["last_key_hex"] and row["key_hex"] <= state["last_key_hex"]:
                state["key_order"] = False
            state["count"] += 1
            if not state["first_key_hex"]:
                state["first_key_hex"] = row["key_hex"]
            state["last_key_hex"] = row["key_hex"]
            key_hash.update(framed_key)
            record_hash.update(framed_key + framed_record)
    for state in by_source.values():
        state["ordered_key_sha256"] = (
            state["ordered_key_sha256"].hexdigest().upper()
        )
        state["ordered_key_record_sha256"] = (
            state["ordered_key_record_sha256"].hexdigest().upper()
        )
    return {
        "sources": by_source,
        "all_ordered_key_sha256": key_hash.hexdigest().upper(),
        "all_ordered_key_record_sha256": record_hash.hexdigest().upper(),
    }


def fin_differences(left_hex: str, right_hex: str) -> list[dict[str, object]]:
    left = bytes.fromhex(left_hex)
    right = bytes.fromhex(right_hex)
    if len(left) != len(right):
        return [
            {
                "offset": "LENGTH",
                "old_byte": len(left),
                "new_byte": len(right),
                "old_numeric": len(left),
                "new_numeric": len(right),
            }
        ]
    return [
        {
            "offset": offset,
            "old_byte": f"{old:02X}",
            "new_byte": f"{new:02X}",
            "old_numeric": old,
            "new_numeric": new,
        }
        for offset, (old, new) in enumerate(zip(left, right))
        if old != new
    ]


def stable_fs(summary: dict[str, object]) -> bool:
    def normalized(rows: list[dict[str, object]]) -> list[tuple[object, ...]]:
        return [
            (
                row["Path"],
                row["Length"],
                row["CreationTimeUtc"],
                row["LastWriteTimeUtc"],
                row["Attributes"],
            )
            for row in rows
        ]

    return normalized(summary["FileSystemIdentityBefore"]) == normalized(
        summary["FileSystemIdentityAfter"]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--differences", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args()

    summaries: dict[str, dict[str, object]] = {}
    observations: dict[str, list[dict[str, str]]] = {}
    stream_results: dict[str, dict[str, object]] = {}
    for experiment in EXPERIMENTS:
        summary_path = args.evidence_root / f"EXPERIMENT_{experiment}_SUMMARY.json"
        summaries[experiment] = json.loads(summary_path.read_text(encoding="utf-8-sig"))
        attempt = Path(str(summaries[experiment]["AttemptRoot"]))
        observation_path = attempt / "Runtime" / "IDENTITY_OBSERVATIONS.csv"
        observations[experiment] = list(
            csv.DictReader(observation_path.open(encoding="utf-8-sig", newline=""))
        )
        stream_path = attempt / "Runtime" / "RECORD_STREAM.csv"
        stream_results[experiment] = sha_stream(stream_path)

    result_rows: list[dict[str, object]] = []
    first_observations: dict[tuple[str, str], dict[str, str]] = {}
    last_observations: dict[tuple[str, str], dict[str, str]] = {}
    for experiment in EXPERIMENTS:
        grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in observations[experiment]:
            grouped[row["source"]].append(row)
        for source in SOURCES:
            rows = grouped[source]
            first = rows[0]
            last = rows[-1]
            first_observations[(experiment, source)] = first
            last_observations[(experiment, source)] = last
            semantic = stream_results[experiment]["sources"][source]
            result_rows.append(
                {
                    "experiment": experiment,
                    "attempt_id": summaries[experiment]["AttemptId"],
                    "source": source,
                    "source_path": first["path"],
                    "vpro_opened": experiment != "A",
                    "read_limit": {
                        "A": 0, "B": 0, "C": 1, "D": 100,
                        "E": "FULL", "F": "FULL", "G": 0,
                    }[experiment],
                    "fid_hex": first["fid_hex"],
                    "fin_first_hex": first["fin_hex"],
                    "fin_last_hex": last["fin_hex"],
                    "fin_length": first["fin_length"],
                    "within_experiment_changed_offsets": ",".join(
                        str(item["offset"])
                        for item in fin_differences(
                            first["fin_hex"], last["fin_hex"]
                        )
                    ) if first["fin_hex"] else "",
                    "record_count": semantic["count"],
                    "first_key_hex": semantic["first_key_hex"],
                    "last_key_hex": semantic["last_key_hex"],
                    "key_order": semantic["key_order"],
                    "ordered_key_sha256": semantic["ordered_key_sha256"],
                    "ordered_key_record_sha256": semantic[
                        "ordered_key_record_sha256"
                    ],
                    "file_system_identity_stable": stable_fs(summaries[experiment]),
                    "source_mode": summaries[experiment]["SourceAccessMode"],
                    "write_count": summaries[experiment]["SourceWrites"],
                    "lock_count": summaries[experiment]["SourceLocks"],
                    "mission_owned_processes_remaining": summaries[experiment][
                        "MissionOwnedProcessesRemaining"
                    ],
                }
            )

    args.results.parent.mkdir(parents=True, exist_ok=True)
    with args.results.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=result_rows[0].keys())
        writer.writeheader()
        writer.writerows(result_rows)

    difference_rows: list[dict[str, object]] = []
    for experiment in EXPERIMENTS:
        if experiment == "A":
            continue
        for source in SOURCES:
            first = first_observations[(experiment, source)]
            last = last_observations[(experiment, source)]
            for item in fin_differences(first["fin_hex"], last["fin_hex"]):
                difference_rows.append(
                    {
                        "source": source,
                        "comparison": f"{experiment}:within-process",
                        "left_experiment": experiment,
                        "right_experiment": experiment,
                        "left_fin_hex": first["fin_hex"],
                        "right_fin_hex": last["fin_hex"],
                        **item,
                        "fid_changed": first["fid_hex"] != last["fid_hex"],
                        "file_system_metadata_changed": not stable_fs(
                            summaries[experiment]
                        ),
                        "record_count_changed": False,
                        "key_hash_changed": False,
                        "decoded_record_hash_changed": False,
                        "write_count": summaries[experiment]["SourceWrites"],
                        "lock_count": summaries[experiment]["SourceLocks"],
                    }
                )

    process_experiments = ("B", "C", "D", "E", "F", "G")
    for left_experiment, right_experiment in zip(
        process_experiments, process_experiments[1:]
    ):
        for source in SOURCES:
            left = first_observations[(left_experiment, source)]
            right = first_observations[(right_experiment, source)]
            left_semantic = stream_results[left_experiment]["sources"][source]
            right_semantic = stream_results[right_experiment]["sources"][source]
            for item in fin_differences(left["fin_hex"], right["fin_hex"]):
                difference_rows.append(
                    {
                        "source": source,
                        "comparison": (
                            f"{left_experiment}->{right_experiment}:cross-process"
                        ),
                        "left_experiment": left_experiment,
                        "right_experiment": right_experiment,
                        "left_fin_hex": left["fin_hex"],
                        "right_fin_hex": right["fin_hex"],
                        **item,
                        "fid_changed": left["fid_hex"] != right["fid_hex"],
                        "file_system_metadata_changed": (
                            not stable_fs(summaries[left_experiment])
                            or not stable_fs(summaries[right_experiment])
                        ),
                        "record_count_changed": (
                            left_semantic["count"] != right_semantic["count"]
                        ),
                        "key_hash_changed": (
                            left_semantic["ordered_key_sha256"]
                            != right_semantic["ordered_key_sha256"]
                        ),
                        "decoded_record_hash_changed": (
                            left_semantic["ordered_key_record_sha256"]
                            != right_semantic["ordered_key_record_sha256"]
                        ),
                        "write_count": (
                            summaries[left_experiment]["SourceWrites"]
                            + summaries[right_experiment]["SourceWrites"]
                        ),
                        "lock_count": (
                            summaries[left_experiment]["SourceLocks"]
                            + summaries[right_experiment]["SourceLocks"]
                        ),
                    }
                )

    with args.differences.open("w", encoding="utf-8", newline="") as stream:
        fields = [
            "source", "comparison", "left_experiment", "right_experiment",
            "left_fin_hex", "right_fin_hex", "offset", "old_byte", "new_byte",
            "old_numeric", "new_numeric", "fid_changed",
            "file_system_metadata_changed", "record_count_changed",
            "key_hash_changed", "decoded_record_hash_changed", "write_count",
            "lock_count",
        ]
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(difference_rows)

    e_sources = stream_results["E"]["sources"]
    f_sources = stream_results["F"]["sources"]
    full_read_match = {
        source: all(
            e_sources[source][field] == f_sources[source][field]
            for field in (
                "count", "first_key_hex", "last_key_hex", "key_order",
                "ordered_key_sha256", "ordered_key_record_sha256",
            )
        )
        for source in SOURCES
    }
    changed_offsets = sorted(
        {
            int(row["offset"])
            for row in difference_rows
            if row["comparison"].endswith("cross-process")
            and isinstance(row["offset"], int)
        }
    )
    output = {
        "verdict": "PASS" if all(full_read_match.values()) else "BLOCKED",
        "algorithm": "VPRO_KEY_RECORD_SHA256_V1",
        "experiments": {
            experiment: {
                "attempt_id": summaries[experiment]["AttemptId"],
                "verdict": summaries[experiment]["Verdict"],
                "file_system_identity_stable": stable_fs(summaries[experiment]),
                "writes": summaries[experiment]["SourceWrites"],
                "locks": summaries[experiment]["SourceLocks"],
                "remaining_processes": summaries[experiment][
                    "MissionOwnedProcessesRemaining"
                ],
            }
            for experiment in EXPERIMENTS
        },
        "cross_process_changed_fin_offsets": changed_offsets,
        "full_read_semantic_match": full_read_match,
        "full_read_sources": {
            source: {
                "count": e_sources[source]["count"],
                "first_key_hex": e_sources[source]["first_key_hex"],
                "last_key_hex": e_sources[source]["last_key_hex"],
                "ordered_key_sha256": e_sources[source][
                    "ordered_key_sha256"
                ],
                "ordered_key_record_sha256": e_sources[source][
                    "ordered_key_record_sha256"
                ],
            }
            for source in SOURCES
        },
    }
    args.summary.write_text(
        json.dumps(output, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()

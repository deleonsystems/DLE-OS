#!/usr/bin/env python3
"""Governed live shadow benchmark for bounded ARE-13 reads.

This qualification tool reads fixed VPro sources O_RDONLY, writes only beneath
the fixed qualification root, and never imports or promotes a package.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
QUALIFICATION_ROOT = Path(
    r"C:\DLE-OS\Qualification\OpenSalesOrderBoundedShadow\Runs")
TEMPLATE = REPO / "Tools/OperationsRefresh/VPro/OPEN_SALES_ORDER_BASE_QUALIFIER.src"
BUILDER = REPO / "Artifacts/Platform002/Qualification/build_sales_order_package.py"
COMPILER = Path(r"C:\BASIS\VPRO5\pro5cpl.exe")
VPRO = Path(r"C:\BASIS\VPRO5\vpro5.exe")
SOURCE_ROOT = Path(r"\\deleon-server\Add-ON\AON\ADATA")
SOURCE_NAMES = ("ARE-03", "ARE-13", "ARM-01", "ARM-10", "WOE-03")
SOURCES = tuple(SOURCE_ROOT / name for name in SOURCE_NAMES)
CANONICAL_FILES = (
    "Customer.csv",
    "SalesOrder.csv",
    "SalesOrderLine.csv",
    "SalesOrderWorkOrderRelationship.csv",
)
PYTHON = Path(
    r"C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime"
    r"\dependencies\python\python.exe")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load module {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


candidate = load_module(
    "bounded_sales_order_shadow",
    REPO / "Tools/OperationsRefresh/bounded_sales_order_shadow.py")
focused = load_module(
    "focused_sales_order_refresh",
    REPO / "Tools/OperationsRefresh/focused_sales_order_refresh.py")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def elapsed_ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 3)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def source_identity() -> list[dict[str, object]]:
    return [{
        "path": str(path),
        "length": path.stat().st_size,
        "lastWriteTimeNs": path.stat().st_mtime_ns,
    } for path in SOURCES]


def require_identity_match(before: list[dict[str, object]],
                           after: list[dict[str, object]]) -> None:
    if before != after:
        raise RuntimeError("SOURCE_GENERATION_CHANGED: live VPro identity changed")


def fixed_file_evidence(paths: list[Path]) -> list[dict[str, object]]:
    result = []
    for path in paths:
        if path.exists() and path.is_file():
            stat = path.stat()
            result.append({
                "path": str(path), "length": stat.st_size,
                "lastWriteTimeNs": stat.st_mtime_ns, "sha256": sha256(path),
            })
        else:
            result.append({"path": str(path), "absent": True})
    return result


def terminate_owned_process(process: subprocess.Popen[bytes]) -> dict[str, object]:
    evidence: dict[str, object] = {"pid": process.pid, "terminated": False}
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        evidence["terminated"] = True
    evidence["exitCode"] = process.returncode
    return evidence


def active_vpro_processes() -> list[str]:
    completed = subprocess.run(
        ["tasklist.exe", "/FI", "IMAGENAME eq vpro5.exe", "/FO", "CSV", "/NH"],
        capture_output=True, text=True, check=True, timeout=15)
    return [line for line in completed.stdout.splitlines()
            if line.lower().startswith('"vpro5.exe"')]


def compile_and_run(source: Path, program_dir: Path, config: Path,
                    label: str) -> dict[str, object]:
    compile_started = time.perf_counter()
    subprocess.run(
        [str(COMPILER), f"-d{program_dir}", str(source)],
        cwd=source.parent, check=True, timeout=120)
    compile_ms = elapsed_ms(compile_started)
    compiled = program_dir / source.name
    program = program_dir / source.stem
    if compiled.exists() and not program.exists():
        compiled.replace(program)
    if not program.is_file():
        raise RuntimeError(f"fresh VPro output is absent for {label}")
    stdout_path = source.with_suffix(".stdout.log")
    stderr_path = source.with_suffix(".stderr.log")
    run_started = time.perf_counter()
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        process = subprocess.Popen(
            [str(VPRO), "-tT0", "-nT0", "-m1024", f"-c{config}", str(program)],
            cwd=program_dir, stdout=stdout, stderr=stderr)
        try:
            return_code = process.wait(timeout=900)
        except subprocess.TimeoutExpired as error:
            cleanup = terminate_owned_process(process)
            raise RuntimeError(
                f"{label} exceeded 900 seconds; cleanup={cleanup}") from error
        except BaseException:
            terminate_owned_process(process)
            raise
    run_ms = elapsed_ms(run_started)
    if return_code != 0:
        raise RuntimeError(f"{label} returned {return_code}")
    return {
        "label": label, "compileMs": compile_ms, "runMs": run_ms,
        "pid": process.pid, "exitCode": return_code,
        "stdout": str(stdout_path), "stderr": str(stderr_path),
    }


def single_file_full_source(template: str, file_number: int, run_id: str,
                            runtime: Path) -> str:
    transformed = (template
        .replace(r"X:\AON\ADATA", str(SOURCE_ROOT))
        .replace("__RUN_ID__", f"{run_id}-FULL-{file_number}")
        .replace("__RUNTIME__", str(runtime))
        .replace("0200 FOR FILE=1 TO 4", f"0200 FOR FILE={file_number} TO {file_number}"))
    if f"0200 FOR FILE={file_number} TO {file_number}" not in transformed:
        raise RuntimeError("the authoritative full source loop was not bounded")
    return transformed


def configure(programs: Path) -> Path:
    config = programs / "configOPENSALESSHADOW.aon"
    config.write_text(
        "ALIASES=4\nFCBS=64\nCIBS=64\nSTBLEN=12000\n"
        f"PREFIX {str(programs).replace(chr(92), '/')}/ C:/BASIS/VPRO5/\n"
        "SETOPTS 0000000000000000\nALIAS T0 SYSWINDOW \"\"\n",
        encoding="ascii")
    return config


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        return list(csv.DictReader(source))


def raw_key(row: dict[str, str]) -> str:
    return bytes.fromhex(row["source_key_hex"]).decode("latin-1")


def verify_keyed_behavior(full_path: Path, bounded_path: Path, summary_path: Path,
                          prefixes: list[str]) -> dict[str, object]:
    prefix_set = set(prefixes)
    full_rows = read_rows(full_path)
    bounded_rows = read_rows(bounded_path)
    expected = [row for row in full_rows if raw_key(row)[:17] in prefix_set]
    expected_material = [(row["source_key_hex"], row["record_raw_hex"],
                          row["decoded_record_material"]) for row in expected]
    actual_material = [(row["source_key_hex"], row["record_raw_hex"],
                        row["decoded_record_material"]) for row in bounded_rows]
    if actual_material != expected_material:
        missing = sorted(set(expected_material) - set(actual_material))[:5]
        extra = sorted(set(actual_material) - set(expected_material))[:5]
        raise RuntimeError(
            f"ARE13_PARITY_MISMATCH missing={missing} extra={extra}")
    keys = [raw_key(row) for row in bounded_rows]
    if keys != sorted(keys) or len(keys) != len(set(keys)):
        raise RuntimeError("bounded ARE-13 output is unordered or duplicated")
    expected_by_prefix = {
        prefix: [raw_key(row) for row in expected if raw_key(row)[:17] == prefix]
        for prefix in prefixes
    }
    summaries = read_rows(summary_path)
    if len(summaries) != len(prefixes):
        raise RuntimeError("one keyed-read summary per prefix was not produced")
    positioning = []
    for prefix, row in zip(prefixes, summaries, strict=True):
        observed_prefix = bytes.fromhex(row["prefix_hex"]).decode("latin-1")
        requested = bytes.fromhex(row["requested_key_hex"]).decode("latin-1")
        first = bytes.fromhex(row["first_key_hex"]).decode("latin-1")
        last = bytes.fromhex(row["last_key_hex"]).decode("latin-1")
        terminal = bytes.fromhex(row["terminating_key_hex"]).decode("latin-1")
        expected_keys = expected_by_prefix[prefix]
        first_matches = (first == expected_keys[0] if expected_keys else
                         (not first or (first >= requested and first[:17] != prefix)))
        last_matches = (last == expected_keys[-1] if expected_keys else not last)
        safe = (observed_prefix == prefix and requested == prefix
                and int(row["record_count"]) == len(expected_keys)
                and first_matches and last_matches
                and (not terminal or terminal[:17] != prefix)
                and row["position_status"] in ("PASS", "NO_RECORD"))
        if not safe:
            raise RuntimeError(f"unsafe KEY/prefix behavior for {prefix!r}: {row}")
        positioning.append({
            "prefix": prefix, "requested": requested, "first": first,
            "last": last, "terminal": terminal,
            "records": len(expected_keys), "safe": True,
        })
    return {
        "fullRecords": len(full_rows), "boundedRecords": len(bounded_rows),
        "eligiblePrefixes": len(prefixes), "skippedRecords": 0,
        "unintendedRecords": 0, "strictOrdering": True,
        "duplicateCount": 0, "positioningSafe": True,
        "prefixTerminationSafe": True, "perPrefix": positioning,
    }


def build_package(runtime_root: Path, base_package: Path, output: Path,
                  run_id: str) -> float:
    started = time.perf_counter()
    subprocess.run([
        str(PYTHON), str(BUILDER), "--runtime-root", str(runtime_root),
        "--base-package", str(base_package), "--output", str(output),
        "--run-id", run_id, "--snapshot-year", "2026",
    ], check=True, timeout=600)
    return elapsed_ms(started)


def canonical_parity(full_package: Path, bounded_package: Path) -> dict[str, object]:
    files = {}
    for name in CANONICAL_FILES:
        full_hash = sha256(full_package / "Canonical" / name)
        bounded_hash = sha256(bounded_package / "Canonical" / name)
        files[name] = {
            "fullSha256": full_hash, "boundedSha256": bounded_hash,
            "match": full_hash == bounded_hash,
        }
    full_manifest = json.loads((full_package / "manifest.json").read_text(
        encoding="utf-8-sig"))
    bounded_manifest = json.loads((bounded_package / "manifest.json").read_text(
        encoding="utf-8-sig"))
    lines = candidate.semantic_lines(
        bounded_package / "Canonical/SalesOrderLine.csv")
    rma = {}
    for line_number, quantity in (("100", "6"), ("105", "-6")):
        row = lines.get(("0012009", line_number))
        rma[line_number] = {
            "present": row is not None,
            "item": row.get("ItemNumber") if row else None,
            "quantity": row.get("QuantityOrdered") if row else None,
            "revision": row.get("BomRevision") if row else None,
            "match": bool(row and row["ItemNumber"] == "H24589"
                          and row["QuantityOrdered"] == quantity
                          and row["BomRevision"] == "J"),
        }
    exact = (all(value["match"] for value in files.values())
             and full_manifest["counts"] == bounded_manifest["counts"]
             and full_manifest["validation"] == bounded_manifest["validation"]
             and all(value["match"] for value in rma.values()))
    return {
        "exact": exact, "files": files,
        "countsMatch": full_manifest["counts"] == bounded_manifest["counts"],
        "validationMatch": (
            full_manifest["validation"] == bounded_manifest["validation"]),
        "counts": bounded_manifest["counts"],
        "validation": bounded_manifest["validation"], "rma0012009": rma,
    }


def run_sample(run_id: str, sample_number: int, run_root: Path,
               base_package: Path) -> dict[str, object]:
    sample_started = time.perf_counter()
    sample_started_at = utc_now()
    sample = run_root / f"Sample-{sample_number:02d}"
    full_root = sample / "Full"
    bounded_root = sample / "Bounded"
    full_runtime = full_root / "Runtime/Pass1"
    bounded_runtime = bounded_root / "Runtime/Pass1"
    programs = sample / "Programs"
    compile_root = sample / "Compile"
    for path in (full_runtime, bounded_runtime, programs, compile_root):
        path.mkdir(parents=True, exist_ok=False)
    config = configure(programs)
    before = source_identity()
    template = TEMPLATE.read_text(encoding="ascii")
    full_steps: dict[str, dict[str, object]] = {}
    for file_number, label in enumerate(
            ("ARE-03", "ARE-13", "ARM-01", "ARM-10"), start=1):
        source = compile_root / f"FULL_{label.replace('-', '')}.src"
        source.write_text(single_file_full_source(
            template, file_number, run_id, full_runtime), encoding="ascii")
        full_steps[label] = compile_and_run(source, programs, config, label)

    prefix_started = time.perf_counter()
    prefixes, are03_local_scan_ms, derivation_internal_ms = (
        candidate.eligible_header_prefixes(full_runtime / "ARE03_FULL.csv"))
    prefix_ms = elapsed_ms(prefix_started)
    (sample / "eligible-prefixes.json").write_text(
        json.dumps(prefixes, indent=2) + "\n", encoding="utf-8")

    post_started = time.perf_counter()
    for name in ("ARE03_FULL.csv", "ARM01_FULL.csv", "ARM10_FULL.csv"):
        shutil.copy2(full_runtime / name, bounded_runtime / name)
    post_ms = elapsed_ms(post_started)

    bounded_source = compile_root / "ARE13_BOUNDED.src"
    bounded_source.write_text(
        candidate.bounded_vpro_source(prefixes, bounded_runtime),
        encoding="ascii")
    bounded_step = compile_and_run(
        bounded_source, programs, config, "ARE-13 bounded")
    keyed = verify_keyed_behavior(
        full_runtime / "ARE13_FULL.csv",
        bounded_runtime / "ARE13_FULL.csv",
        bounded_runtime / "ARE13_KEYED_READ_SUMMARY.csv", prefixes)

    line_prefixes = focused.open_prefixes(bounded_runtime)
    expected_relationships = focused.expected_direct_relationships(
        line_prefixes, base_package)
    seed_by_prefix: dict[str, str] = {}
    for prefix, work_order in sorted(expected_relationships):
        seed_by_prefix.setdefault(prefix, prefix + "  " + work_order)
    seed_keys = sorted(seed_by_prefix.values())
    woe_source = compile_root / "WOE03_BOUNDED.src"
    if seed_keys:
        woe_source.write_text(
            focused.bounded_source(run_id, bounded_runtime, seed_keys),
            encoding="ascii")
        woe_step = compile_and_run(woe_source, programs, config, "WOE-03 bounded")
    else:
        (bounded_runtime / "WOE03_FULL.csv").write_text(
            "pass,source_file,source_key_hex,record_raw_hex,layout_id,"
            "decoded_record_material\n", encoding="utf-8")
        woe_step = {"label": "WOE-03 bounded", "compileMs": 0.0,
                    "runMs": 0.0, "pid": 0, "exitCode": 0}
    actual_relationships = focused.read_woe03_relationships(
        bounded_runtime / "WOE03_FULL.csv")
    missing_relationships = expected_relationships - actual_relationships
    if missing_relationships:
        raise RuntimeError(
            f"WOE relationship evidence is incomplete: {sorted(missing_relationships)[:5]}")
    shutil.copy2(bounded_runtime / "WOE03_FULL.csv",
                 full_runtime / "WOE03_FULL.csv")
    after = source_identity()
    require_identity_match(before, after)

    full_package = full_root / "Package"
    bounded_package = bounded_root / "Package"
    full_package_ms = build_package(
        full_root / "Runtime", base_package, full_package,
        f"{run_id}-S{sample_number:02d}-FULL")
    bounded_package_ms = build_package(
        bounded_root / "Runtime", base_package, bounded_package,
        f"{run_id}-S{sample_number:02d}-BOUNDED")
    parity = canonical_parity(full_package, bounded_package)
    if not parity["exact"]:
        raise RuntimeError("canonical package parity is not exact")

    common_vpro_ms = sum(float(full_steps[name]["runMs"])
                         for name in ("ARE-03", "ARM-01", "ARM-10"))
    woe_ms = float(woe_step["runMs"])
    full_total = (common_vpro_ms + float(full_steps["ARE-13"]["runMs"])
                  + prefix_ms + post_ms + woe_ms + full_package_ms)
    bounded_total = (common_vpro_ms + float(bounded_step["runMs"])
                     + prefix_ms + post_ms + woe_ms + bounded_package_ms)
    result = {
        "sample": sample_number, "result": "PASS",
        "startedAtUtc": sample_started_at, "completedAtUtc": utc_now(),
        "sourceIdentityBefore": before,
        "sourceIdentityAfter": after, "sourceIdentityMatch": True,
        "fullSteps": full_steps, "boundedAre13": bounded_step,
        "are03EligibilityLocalScanMs": are03_local_scan_ms,
        "prefixDerivationInternalMs": derivation_internal_ms,
        "prefixDerivationWallMs": prefix_ms, "postProcessingMs": post_ms,
        "woe": {**woe_step, "seekCount": len(seed_keys),
                "relationshipCount": len(actual_relationships),
                "expectedDirectRelationshipCount": len(expected_relationships),
                "missingCount": len(missing_relationships)},
        "keyedBehavior": keyed, "fullPackageMs": full_package_ms,
        "boundedPackageMs": bounded_package_ms,
        "fullComparablePathMs": round(full_total, 3),
        "boundedComparablePathMs": round(bounded_total, 3),
        "savedMs": round(full_total - bounded_total, 3),
        "improvementPercent": round(
            (full_total - bounded_total) / full_total * 100, 3),
        "parity": parity, "wallQualificationMs": elapsed_ms(sample_started),
    }
    (sample / "sample-result.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def exercise_failure_safety(run_root: Path,
                            identity: list[dict[str, object]]) -> dict[str, object]:
    probe = run_root / "FailureProbes"
    working = probe / "Working"
    working.mkdir(parents=True)
    partial = working / "candidate.partial"
    partial.write_text("qualification-only partial output\n", encoding="utf-8")
    process = subprocess.Popen([
        sys.executable, "-c", "import time; time.sleep(30)"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cleanup = terminate_owned_process(process)
    partial_hash = sha256(partial)
    partial.unlink()
    if partial.exists() or cleanup["exitCode"] is None:
        raise RuntimeError("interrupted-candidate cleanup probe failed")
    changed = deepcopy(identity)
    changed[0]["lastWriteTimeNs"] = int(changed[0]["lastWriteTimeNs"]) + 1
    source_change_rejected = False
    try:
        require_identity_match(identity, changed)
    except RuntimeError as error:
        source_change_rejected = str(error).startswith("SOURCE_GENERATION_CHANGED")
    if not source_change_rejected:
        raise RuntimeError("source-generation change rejection probe failed")
    result = {
        "temporaryPartialRemoved": True, "partialSha256": partial_hash,
        "interruptedOwnedChild": cleanup, "sourceChangeRejected": True,
        "canonicalPathsTouched": 0,
    }
    (probe / "failure-safety-result.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-root", required=True, type=Path)
    parser.add_argument("--base-package", required=True, type=Path)
    parser.add_argument("--samples", type=int, choices=(2, 3), default=3)
    args = parser.parse_args()
    run_root = args.run_root.resolve()
    if (run_root.parent != QUALIFICATION_ROOT.resolve()
            or run_root.name != args.run_id
            or not args.run_id.startswith("OPENSOSHADOW-")):
        raise ValueError("qualification output is outside its fixed boundary")
    identity_name = (
        f"{os.environ.get('USERDOMAIN', '')}\\{os.environ.get('USERNAME', '')}")
    if identity_name.lower() != r"dle-os-host\dle-os":
        raise PermissionError("qualification requires DLE-OS-HOST\\DLE-OS")
    if Path(r"C:\ProgramData\DLE-OS\SyncOperations\lease.json").exists():
        raise RuntimeError("normal Sync Operations owns its lease")
    if active_vpro_processes():
        raise RuntimeError("a VPro5 process is already active")
    if any(path.exists() for path in (
            Path(r"C:\DLE-OS\Canonical\DailyOperationsSync\State\daily-operations-sync.lock"),
            Path(r"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\invoice-history-refresh.lock"),
            Path(r"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\open-sales-order-refresh.lock"))):
        raise RuntimeError("a canonical-changing workflow lock is active")
    if run_root.exists():
        raise FileExistsError(run_root)
    for path in (*SOURCES, TEMPLATE, BUILDER, COMPILER, VPRO, PYTHON,
                 args.base_package):
        if not path.exists():
            raise FileNotFoundError(path)
    run_root.mkdir(parents=False)
    protected = [
        Path(r"C:\ProgramData\DLE-OS\SyncOperations\current.json"),
        Path(r"C:\DLE-OS\Canonical\DailyOperationsSync\State\status.json"),
        Path(r"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json"),
    ]
    protected_before = fixed_file_evidence(protected)
    result: dict[str, object] = {
        "runId": args.run_id, "result": "RUNNING", "startedAtUtc": utc_now(),
        "executionIdentity": identity_name, "sourceOpenMode": "O_RDONLY",
        "sourceWrites": 0, "canonicalPromotionAttempted": False,
        "normalSyncPathChanged": False, "basePackage": str(args.base_package),
    }
    result_path = run_root / "qualification-result.json"
    try:
        samples = [run_sample(
            args.run_id, number, run_root, args.base_package.resolve())
            for number in range(1, args.samples + 1)]
        failure = exercise_failure_safety(
            run_root, samples[-1]["sourceIdentityAfter"])
        protected_after = fixed_file_evidence(protected)
        if protected_before != protected_after:
            raise RuntimeError("a protected normal-Sync/canonical state file changed")
        full_values = [float(value["fullComparablePathMs"]) for value in samples]
        bounded_values = [float(value["boundedComparablePathMs"]) for value in samples]
        result.update({
            "result": "PASS", "completedAtUtc": utc_now(), "samples": samples,
            "failureSafety": failure, "protectedStateBefore": protected_before,
            "protectedStateAfter": protected_after,
            "summary": {
                "sampleCount": len(samples),
                "fullAverageMs": round(sum(full_values) / len(full_values), 3),
                "boundedAverageMs": round(sum(bounded_values) / len(bounded_values), 3),
                "averageSavedMs": round(
                    (sum(full_values) - sum(bounded_values)) / len(samples), 3),
                "averageImprovementPercent": round(
                    (1 - sum(bounded_values) / sum(full_values)) * 100, 3),
                "fullMinMs": min(full_values), "fullMaxMs": max(full_values),
                "boundedMinMs": min(bounded_values),
                "boundedMaxMs": max(bounded_values),
            },
        })
        result_path.write_text(
            json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"result": "PASS", "runId": args.run_id,
                          "summary": result["summary"]}, indent=2))
        return 0
    except Exception as error:
        result.update({"result": "FAIL", "completedAtUtc": utc_now(),
                       "error": str(error)})
        result_path.write_text(
            json.dumps(result, indent=2) + "\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    raise SystemExit(main())

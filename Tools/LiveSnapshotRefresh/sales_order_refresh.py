#!/usr/bin/env python3
"""Reusable fixed-path Sales Order read-only extraction and package builder."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


REFRESH_ROOT = Path(r"C:\DLE-OS\Canonical\LiveMirror\Refresh").resolve()
RUNS_ROOT = Path(r"C:\DLE-OS\Canonical\LiveMirror\RefreshRuns").resolve()
ASSETS = REFRESH_ROOT / "Assets"
TEMPLATE = ASSETS / "PLATFORM002_SALES_ORDER_QUALIFIER.src"
BUILDER = ASSETS / "build_sales_order_package.py"
CONFIG = ASSETS / "configPLATFORM002.aon"
COMPILER = Path(r"C:\BASIS\VPRO5\pro5cpl.exe")
LISTER = Path(r"C:\BASIS\VPRO5\pro5lst.exe")
VPRO = Path(r"C:\BASIS\VPRO5\vpro5.exe")
BASE_PACKAGE = Path(r"C:\DLE-OS\Canonical\LiveMirror\Current")
SOURCE_PATHS = [
    Path(r"X:\AON\ADATA\ARE-03"),
    Path(r"X:\AON\ADATA\ARE-13"),
    Path(r"X:\AON\ADATA\ARM-01"),
    Path(r"X:\AON\ADATA\ARM-10"),
    Path(r"X:\AON\ADATA\WOE-03"),
]
OUTPUT_NAMES = [
    "ARE03_FULL.csv",
    "ARE13_FULL.csv",
    "ARM01_FULL.csv",
    "ARM10_FULL.csv",
    "WOE03_FULL.csv",
]
RUN_ID_RE = re.compile(r"^LIVEREFRESH-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$")


def require_run_root(path: Path, run_id: str) -> Path:
    resolved = path.resolve()
    if resolved.parent != RUNS_ROOT or resolved.name != run_id:
        raise RuntimeError("Sales Order run root is outside the fixed refresh boundary")
    return resolved


def source_identity() -> list[dict[str, object]]:
    result = []
    for path in SOURCE_PATHS:
        stat = path.stat()
        result.append(
            {
                "path": str(path),
                "sizeBytes": stat.st_size,
                "lastWriteTimeNs": stat.st_mtime_ns,
            }
        )
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def compare_passes(runtime: Path) -> dict[str, object]:
    compared = {}
    columns = [
        "source_file",
        "source_key_hex",
        "record_raw_hex",
        "layout_id",
        "decoded_record_material",
    ]
    for name in OUTPUT_NAMES:
        first_path = runtime / "Pass1" / name
        second_path = runtime / "Pass2" / name
        count = 0
        with first_path.open("r", encoding="utf-8-sig", newline="") as first, (
            second_path.open("r", encoding="utf-8-sig", newline="")
        ) as second:
            rows1 = csv.DictReader(first)
            rows2 = csv.DictReader(second)
            if rows1.fieldnames != rows2.fieldnames:
                raise RuntimeError(f"{name} pass headers differ")
            while True:
                row1 = next(rows1, None)
                row2 = next(rows2, None)
                if row1 is None or row2 is None:
                    if row1 is not None or row2 is not None:
                        raise RuntimeError(f"{name} pass row counts differ")
                    break
                count += 1
                if any(row1[column] != row2[column] for column in columns):
                    raise RuntimeError(f"{name} pass mismatch at row {count}")
        compared[name] = {
            "recordCount": count,
            "pass1Sha256": sha256_file(first_path),
            "pass2Sha256": sha256_file(second_path),
            "semanticMatch": True,
        }
    return compared


def build_source(run_id: str, runtime: Path) -> str:
    source = TEMPLATE.read_text(encoding="utf-8")
    source, run_replacements = re.subn(
        r'(?m)^0050 LET RUN\$="[^"]+"$',
        f'0050 LET RUN$="{run_id}"',
        source,
    )
    root_text = str(runtime) + "\\"
    source, root_replacements = re.subn(
        r'(?m)^0060 LET ROOT\$="[^"]+"$',
        lambda _: f'0060 LET ROOT$="{root_text}"',
        source,
    )
    if run_replacements != 1 or root_replacements != 1:
        raise RuntimeError("Qualified Sales Order template identity is invalid")
    required = [
        'MODE="O_RDONLY"',
        r"X:\AON\ADATA\ARE-03",
        r"X:\AON\ADATA\ARE-13",
        r"X:\AON\ADATA\ARM-01",
        r"X:\AON\ADATA\ARM-10",
        r"X:\AON\ADATA\WOE-03",
    ]
    if any(value not in source for value in required):
        raise RuntimeError("Qualified source allowlist or O_RDONLY marker is absent")
    return source


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-root", required=True, type=Path)
    args = parser.parse_args()
    if not RUN_ID_RE.fullmatch(args.run_id):
        raise RuntimeError("Refresh run ID was rejected")
    run_root = require_run_root(args.run_root, args.run_id)
    runtime = run_root / "SalesOrderRuntime"
    compile_root = run_root / "SalesOrderCompile"
    programs = run_root / "SalesOrderPrograms"
    listings = run_root / "SalesOrderListings"
    candidate = run_root / "SalesOrderCandidate"
    for path in [runtime / "Pass1", runtime / "Pass2", compile_root, programs, listings]:
        path.mkdir(parents=True, exist_ok=False)

    before = source_identity()
    source_path = compile_root / "PLATFORM002_SALES_ORDER_QUALIFIER.src"
    source_path.write_text(build_source(args.run_id, runtime), encoding="utf-8")
    shutil.copy2(CONFIG, programs / CONFIG.name)
    subprocess.run(
        [str(COMPILER), f"-d{programs}", str(source_path)],
        check=True,
        cwd=compile_root,
        timeout=120,
    )
    program = programs / "PLATFORM002_SALES_ORDER_QUALIFIER"
    compiled_source_name = programs / source_path.name
    if compiled_source_name.is_file() and not program.exists():
        compiled_source_name.replace(program)
    if not program.is_file():
        raise RuntimeError("Sales Order qualifier compiler output is absent")
    subprocess.run(
        [str(LISTER), f"-d{listings}", "-p", str(program)],
        check=True,
        cwd=listings,
        timeout=120,
    )
    launch = [
        str(VPRO),
        "-tT0",
        "-nT0",
        "-m1024",
        f"-c{programs / CONFIG.name}",
        str(program),
    ]
    completed = subprocess.run(
        launch,
        cwd=programs,
        check=False,
        timeout=7200,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"Sales Order O_RDONLY qualifier returned {completed.returncode}"
        )
    after = source_identity()
    if before != after:
        raise RuntimeError("Sales Order source identity changed during extraction")
    verdict = (runtime / "RUNTIME_VERDICT.txt").read_text(encoding="utf-8")
    if "qualification_verdict=PASS" not in verdict:
        raise RuntimeError("Sales Order qualifier verdict is not PASS")
    pass_comparison = compare_passes(runtime)

    subprocess.run(
        [
            sys.executable,
            str(BUILDER),
            "--runtime-root",
            str(runtime),
            "--base-package",
            str(BASE_PACKAGE),
            "--output",
            str(candidate),
            "--run-id",
            args.run_id,
            "--snapshot-year",
            str(datetime.now(timezone.utc).year),
        ],
        check=True,
        timeout=600,
    )
    result = {
        "runId": args.run_id,
        "sourceAccessMode": "O_RDONLY",
        "sourceIdentityBefore": before,
        "sourceIdentityAfter": after,
        "sourceIdentityMatch": True,
        "passComparison": pass_comparison,
        "candidatePath": str(candidate),
        "candidatePackageSha256": (
            candidate / "package.sha256"
        ).read_text(encoding="ascii").strip(),
        "result": "PASS",
    }
    (run_root / "sales-order-refresh-result.json").write_text(
        json.dumps(result, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

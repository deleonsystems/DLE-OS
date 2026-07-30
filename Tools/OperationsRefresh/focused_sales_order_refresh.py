#!/usr/bin/env python3
"""Fixed-path focused Open Sales Order O_RDONLY extractor."""

from __future__ import annotations

import argparse
import csv
import ctypes
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


REPO = Path(r"C:\DLE-OS\Repositories\DLE-OS")
ROOT = Path(r"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh")
RUNS = ROOT / "Runs"
STATUS = ROOT / "State/status.json"
TEMPLATE = REPO / "Tools/OperationsRefresh/VPro/OPEN_SALES_ORDER_BASE_QUALIFIER.src"
ASSETS = Path(r"C:\DLE-OS\Canonical\LiveMirror\Refresh\Assets")
BUILDER = ASSETS / "build_sales_order_package.py"
BASE = Path(r"C:\DLE-OS\Canonical\LiveMirror\Current")
COMPILER = Path(r"C:\BASIS\VPRO5\pro5cpl.exe")
VPRO = Path(r"C:\BASIS\VPRO5\vpro5.exe")
SOURCES = tuple(Path(rf"X:\AON\ADATA\{name}") for name in (
    "ARE-03", "ARE-13", "ARM-01", "ARM-10", "WOE-03"))
RUN_RE = re.compile(r"^OPENSALESREFRESH-\d{8}T\d{6}Z-[A-F0-9]{8}$")


def decoded_text(material: str) -> bytes:
    first = material.split("|", 1)[0]
    if not first.startswith("S"):
        raise ValueError("decoded string material is absent")
    return bytes.fromhex(first[1:])


def identity() -> list[dict[str, object]]:
    return [{
        "path": str(path),
        "length": path.stat().st_size,
        "lastWriteTimeNs": path.stat().st_mtime_ns,
    } for path in SOURCES]


def write_progress(
        run_id: str,
        phase: str,
        processed: int | None = None,
        expected: int | None = None) -> None:
    current = json.loads(STATUS.read_text(encoding="utf-8-sig"))
    if current.get("RefreshRunId") != run_id:
        raise RuntimeError("focused progress status run identity mismatch")
    current["CurrentPhase"] = phase
    current["RecordsProcessed"] = processed
    current["RecordsExpected"] = expected
    current["UpdatedAtUtc"] = datetime.now(timezone.utc).isoformat()
    stage = STATUS.with_name(f".{run_id}.progress")
    stage.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    stage.replace(STATUS)


def compile_and_run(source: Path, program_dir: Path, config: Path) -> None:
    subprocess.run(
        [str(COMPILER), f"-d{program_dir}", str(source)],
        cwd=source.parent, check=True, timeout=120)
    compiled = program_dir / source.name
    program = program_dir / source.stem
    if compiled.exists() and not program.exists():
        compiled.replace(program)
    if not program.is_file():
        raise RuntimeError("fresh VPro compiler output is absent")
    completed = subprocess.run(
        [str(VPRO), "-tT0", "-nT0", "-m1024", f"-c{config}", str(program)],
        cwd=program_dir, check=False, timeout=900,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if completed.returncode != 0:
        raise RuntimeError(f"focused VPro reader returned {completed.returncode}")


def open_prefixes(runtime: Path) -> list[str]:
    open_headers: set[tuple[str, str, str]] = set()
    with (runtime / "ARE03_FULL.csv").open(
            newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            text = decoded_text(row["decoded_record_material"])
            key = bytes.fromhex(row["source_key_hex"]).decode("latin-1")
            if (len(key) >= 20 and key[2:4] == "  " and key[17:20] == "000"
                    and text[21:22] != b"I" and text[20:21] not in (b"V", b"P")
                    and text[100:101] != b"C"):
                open_headers.add((
                    key[0:2],
                    text[4:10].decode("latin-1"),
                    text[10:17].decode("latin-1")))
    prefixes: set[str] = set()
    with (runtime / "ARE13_FULL.csv").open(
            newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            text = decoded_text(row["decoded_record_material"])
            customer = text[4:10].decode("latin-1")
            order = text[10:17].decode("latin-1")
            firm = bytes.fromhex(
                row["source_key_hex"]).decode("latin-1")[0:2]
            if (firm, customer, order) in open_headers and text[20:21] == b"S":
                prefix = firm + "B" + customer + order + text[17:20].decode("latin-1")
                if len(prefix) != 19 or not prefix[3:].isdigit():
                    raise ValueError(f"invalid bounded WOE-03 prefix: {prefix!r}")
                prefixes.add(prefix)
    return sorted(prefixes)


def bounded_source(run_id: str, runtime: Path, prefixes: list[str]) -> str:
    assignments = "\n".join(
        f'{1000 + i * 10:04d} LET P$[{i + 1}]="{prefix}"'
        for i, prefix in enumerate(prefixes))
    loop_line = 1000 + len(prefixes) * 10
    return f'''0010 REM "OPERATIONS-REFRESH-001 bounded indexed WOE-03 reads"
0020 SETESC 29000
0030 SETERR 29000
0040 LET RUN$="{run_id}",ROOT$="{str(runtime)}\\",Q$=$22$,CH10=0,OUT20=0
0050 DIM P$[{len(prefixes)}]
{assignments}
{loop_line:04d} OPEN (10,MODE="O_RDONLY",ERR=29100)"X:\\AON\\ADATA\\WOE-03";LET CH10=1
{loop_line + 10:04d} LET FID1$=FID(10),FIN1$=FIN(10),ACTIVE1=DEC(FIN1$(77,4))
{loop_line + 20:04d} OPEN (20,MODE="O_CREATE,O_TRUNC",ERR=29200)ROOT$+"WOE03_FULL.csv";LET OUT20=1
{loop_line + 30:04d} PRINT (20)"pass,source_file,source_key_hex,record_raw_hex,layout_id,decoded_record_material"
{loop_line + 40:04d} LET FOUND=0
{loop_line + 50:04d} FOR X=1 TO {len(prefixes)}
{loop_line + 60:04d} READ (10,KEY=P$[X],DOM={loop_line + 110})
{loop_line + 70:04d} LET K$=KEY(10,END={loop_line + 110})
{loop_line + 80:04d} IF K$(1,19)<>P$[X] THEN GOTO {loop_line + 110}
{loop_line + 90:04d} READ RECORD(10,KEY=K$,ERR=29400)R$
{loop_line + 100:04d} PRINT (20)"1,"+Q$+"WOE-03"+Q$+","+Q$+HTA(K$)+Q$+","+Q$+HTA(R$)+Q$+","+Q$+"B"+Q$+","+Q$+"K"+HTA(K$)+Q$;LET FOUND=FOUND+1
{loop_line + 110:04d} NEXT X
{loop_line + 120:04d} LET FID2$=FID(10),FIN2$=FIN(10),ACTIVE2=DEC(FIN2$(77,4))
{loop_line + 130:04d} IF FID1$<>FID2$ OR ACTIVE1<>ACTIVE2 THEN GOTO 29300
{loop_line + 140:04d} CLOSE (10);LET CH10=0
{loop_line + 150:04d} CLOSE (20);LET OUT20=0
{loop_line + 160:04d} RELEASE
29000 GOTO 29500
29100 GOTO 29500
29200 GOTO 29500
29300 GOTO 29500
29400 GOTO 29500
29500 IF CH10=1 THEN CLOSE (10)
29510 IF OUT20=1 THEN CLOSE (20)
29520 ESCAPE
'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-root", required=True, type=Path)
    args = parser.parse_args()
    if not RUN_RE.fullmatch(args.run_id):
        raise ValueError("focused refresh run ID was rejected")
    run_root = args.run_root.resolve()
    if run_root.parent != RUNS.resolve() or run_root.name != args.run_id:
        raise ValueError("focused refresh output is outside its fixed boundary")
    identity_name = (
        f"{os.environ.get('USERDOMAIN', '')}\\{os.environ.get('USERNAME', '')}")
    if identity_name.lower() != r"dle-os-host\dle-os" or ctypes.windll.shell32.IsUserAnAdmin():
        raise PermissionError("focused extraction requires non-elevated DLE-OS-HOST\\DLE-OS")
    for path in (*SOURCES, TEMPLATE, BUILDER, COMPILER, VPRO, BASE):
        if not path.exists():
            raise FileNotFoundError(path)

    runtime = run_root / "Runtime" / "Pass1"
    programs = run_root / "Programs"
    compile_root = run_root / "Compile"
    candidate = run_root / "Package"
    for path in (runtime, programs, compile_root):
        path.mkdir(parents=True, exist_ok=False)
    config = programs / "configOPERATIONSREFRESH.aon"
    config.write_text(
        "ALIASES=4\nFCBS=64\nCIBS=64\nSTBLEN=12000\n"
        f"PREFIX {str(programs).replace(chr(92), '/')}/ C:/BASIS/VPRO5/\n"
        "SETOPTS 0000000000000000\nALIAS T0 SYSWINDOW \"\"\n",
        encoding="ascii")

    before = identity()
    base_source = compile_root / "OPEN_SALES_ORDER_BASE_QUALIFIER.src"
    base_source.write_text(
        TEMPLATE.read_text(encoding="ascii")
        .replace("__RUN_ID__", args.run_id)
        .replace("__RUNTIME__", str(runtime)),
        encoding="ascii")
    compile_and_run(base_source, programs, config)
    if "qualification_verdict=PASS" not in (
            runtime / "RUNTIME_VERDICT.txt").read_text(encoding="utf-8"):
        raise RuntimeError("focused base reader did not return PASS")

    write_progress(args.run_id, "Reading Open Order Lines")
    prefixes = open_prefixes(runtime)
    write_progress(
        args.run_id, "Resolving Work Orders", 0, len(prefixes))
    bounded = compile_root / "OPEN_SALES_ORDER_WOE_BOUNDED.src"
    bounded.write_text(
        bounded_source(args.run_id, runtime, prefixes), encoding="ascii")
    compile_and_run(bounded, programs, config)
    write_progress(
        args.run_id, "Resolving Work Orders", len(prefixes), len(prefixes))
    after = identity()
    if before != after:
        raise RuntimeError("source identity changed during focused extraction")

    subprocess.run([
        os.sys.executable, str(BUILDER),
        "--runtime-root", str(run_root / "Runtime"),
        "--base-package", str(BASE), "--output", str(candidate),
        "--run-id", args.run_id, "--snapshot-year", "2026",
    ], check=True, timeout=600)
    result = {
        "result": "PASS",
        "runId": args.run_id,
        "sourceAccessMode": "O_RDONLY",
        "sourceWrites": 0,
        "sourceLocksRequested": 0,
        "sourceIdentityBefore": before,
        "sourceIdentityAfter": after,
        "sourceIdentityMatch": True,
        "qualifyingLinePrefixCount": len(prefixes),
        "woe03BoundedSeekCount": len(prefixes),
        "woe03CompleteScans": 0,
        "candidatePath": str(candidate),
        "packageSha256": (
            candidate / "package.sha256").read_text(encoding="ascii").strip(),
    }
    (run_root / "focused-sales-order-result.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

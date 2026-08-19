#!/usr/bin/env python3
"""Build and qualify a bounded ARE-13 candidate without changing routine Sync."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
BUILDER = REPO / "Artifacts/Platform002/Qualification/build_sales_order_package.py"
COMPILER = Path(r"C:\BASIS\VPRO5\pro5cpl.exe")
SOURCE = Path(r"\\deleon-server\Add-ON\AON\ADATA\ARE-13")
CANONICAL_FILES = (
    "Customer.csv",
    "SalesOrder.csv",
    "SalesOrderLine.csv",
    "SalesOrderWorkOrderRelationship.csv",
)


def elapsed_ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 3)


def decoded_text(material: str) -> bytes:
    first = material.split("|", 1)[0]
    if not first.startswith("S"):
        raise ValueError("decoded string material is absent")
    return bytes.fromhex(first[1:])


def eligible_header_prefixes(path: Path) -> tuple[list[str], float, float]:
    started = time.perf_counter()
    eligible: list[tuple[str, str, str]] = []
    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            if row["layout_id"] != "A":
                continue
            key = bytes.fromhex(row["source_key_hex"]).decode("latin-1")
            text = decoded_text(row["decoded_record_material"])
            if len(key) < 20 or key[2:4] != "  " or key[17:20] != "000":
                continue
            if (text[21:22] == b"I" or text[20:21] in (b"V", b"P")
                    or text[100:101] == b"C"):
                continue
            eligible.append((
                key[0:2],
                text[4:10].decode("latin-1"),
                text[10:17].decode("latin-1"),
            ))
    scan_ms = elapsed_ms(started)
    derive_started = time.perf_counter()
    prefixes = sorted({firm + "  " + customer + order
                       for firm, customer, order in eligible})
    if any(len(prefix) != 17 for prefix in prefixes):
        raise ValueError("an eligible ARE-13 prefix is not 17 bytes")
    return prefixes, scan_ms, elapsed_ms(derive_started)


def write_bounded_are13(full_path: Path, target: Path,
                        prefixes: list[str]) -> tuple[int, int, float]:
    started = time.perf_counter()
    prefix_set = set(prefixes)
    full_count = 0
    bounded_count = 0
    with full_path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames is None:
            raise ValueError("ARE-13 evidence has no header")
        with target.open("w", newline="", encoding="utf-8") as output:
            writer = csv.DictWriter(
                output, fieldnames=reader.fieldnames, quoting=csv.QUOTE_ALL)
            writer.writeheader()
            previous = ""
            for row in reader:
                full_count += 1
                key = bytes.fromhex(row["source_key_hex"]).decode("latin-1")
                if key <= previous:
                    raise ValueError("ARE-13 evidence is not in strict key order")
                previous = key
                if key[:17] in prefix_set:
                    writer.writerow(row)
                    bounded_count += 1
    return full_count, bounded_count, elapsed_ms(started)


def bounded_vpro_source(prefixes: list[str], runtime: Path) -> str:
    assignments = "\n".join(
        f'{1000 + index * 10:04d} LET P$[{index + 1}]="{prefix}"'
        for index, prefix in enumerate(prefixes))
    line = 1000 + len(prefixes) * 10
    return f'''0010 REM "SHADOW bounded ARE-13 reads; not the routine Sync path"
0020 SETESC 29000
0030 SETERR 29000
0040 LET ROOT$="{runtime}\\",Q$=$22$,CH10=0,CH11=0,OUT20=0,OUT21=0
0050 DIM P$[{len(prefixes)}],D0$(52),D1$(64),DN[14]
0060 ARE13A: IOLIST D0$(1),D1$(1),DN[ALL]
0070 PRECISION 16
{assignments}
{line:04d} OPEN (10,MODE="O_RDONLY",ERR=29100)"{SOURCE}";LET CH10=1
{line + 10:04d} OPEN (11,MODE="O_RDONLY",ERR=29100)"{SOURCE}";LET CH11=1
{line + 20:04d} LET FID1$=FID(10),FID11$=FID(11),FIN1$=FIN(10),OTYPE=MOD(ASC(FID1$(1,1)),32)
{line + 30:04d} LET ORLEN=DEC(FID1$(7,2)),OKLEN=ASC(FID1$(2,1)),ACTIVE1=DEC(FIN1$(77,4))
{line + 40:04d} IF FID1$<>FID11$ OR POS("ARE-13"=FID1$)=0 OR OTYPE<>6 OR ORLEN<>224 OR OKLEN<>20 THEN GOTO 29300
{line + 50:04d} OPEN (20,MODE="O_CREATE,O_TRUNC",ERR=29200)ROOT$+"ARE13_FULL.csv";LET OUT20=1
{line + 60:04d} OPEN (21,MODE="O_CREATE,O_TRUNC",ERR=29200)ROOT$+"ARE13_KEYED_READ_SUMMARY.csv";LET OUT21=1
{line + 70:04d} PRINT (20)"pass,source_file,source_key_hex,record_raw_hex,layout_id,decoded_record_material"
{line + 80:04d} PRINT (21)"prefix_hex,requested_key_hex,first_key_hex,last_key_hex,terminating_key_hex,record_count,position_status,termination_status"
{line + 90:04d} LET COUNT=0,PREV$=""
{line + 100:04d} FOR X=1 TO {len(prefixes)}
{line + 110:04d} LET PCOUNT=0,FIRST$="",LAST$="",TERM$="",POSSTAT$="NO_RECORD",TSTATUS$="NO_RECORD",REQ$=P$[X]
{line + 120:04d} READ (10,KEY=REQ$,DOM={line + 130})
{line + 130:04d} LET K$=KEY(10,END={line + 270})
{line + 140:04d} READ RECORD (10,ERR=29400)R$
{line + 150:04d} IF FIRST$="" THEN LET FIRST$=K$,POSSTAT$="PASS"
{line + 160:04d} IF K$(1,17)<>P$[X] THEN LET TERM$=K$,TSTATUS$="PREFIX_CHANGE";GOTO {line + 270}
{line + 170:04d} IF PREV$<>"" AND K$<=PREV$ THEN GOTO 29300
{line + 180:04d} READ (11,KEY=K$,DOM=29400)IOL=ARE13A
{line + 190:04d} IF LEN(D0$)<52 THEN LET D0$=D0$+FILL(52-LEN(D0$))
{line + 200:04d} IF LEN(D1$)<64 THEN LET D1$=D1$+FILL(64-LEN(D1$))
{line + 210:04d} LET MAT$="S"+HTA(D0$)+"|S"+HTA(D1$)
{line + 220:04d} FOR Y=0 TO 14;LET MAT$=MAT$+"|N"+STR(DN[Y]);NEXT Y
{line + 230:04d} PRINT (20)"1,"+Q$+"ARE-13"+Q$+","+Q$+HTA(K$)+Q$+","+Q$+HTA(R$)+Q$+","+Q$+"A"+Q$+","+Q$+MAT$+Q$
{line + 240:04d} LET COUNT=COUNT+1,PCOUNT=PCOUNT+1,PREV$=K$,LAST$=K$,TSTATUS$="READ_END"
{line + 250:04d} GOTO {line + 130}
{line + 270:04d} PRINT (21)Q$+HTA(P$[X])+Q$+","+Q$+HTA(REQ$)+Q$+","+Q$+HTA(FIRST$)+Q$+","+Q$+HTA(LAST$)+Q$+","+Q$+HTA(TERM$)+Q$+","+STR(PCOUNT)+","+Q$+POSSTAT$+Q$+","+Q$+TSTATUS$+Q$
{line + 280:04d} NEXT X
{line + 290:04d} LET FID2$=FID(10),FIN2$=FIN(10),ACTIVE2=DEC(FIN2$(77,4))
{line + 300:04d} IF FID1$<>FID2$ OR ACTIVE1<>ACTIVE2 THEN GOTO 29300
{line + 310:04d} CLOSE (10);LET CH10=0
{line + 320:04d} CLOSE (11);LET CH11=0
{line + 330:04d} CLOSE (20);LET OUT20=0
{line + 340:04d} CLOSE (21);LET OUT21=0
{line + 350:04d} RELEASE
29000 GOTO 29500
29100 GOTO 29500
29200 GOTO 29500
29300 GOTO 29500
29400 GOTO 29500
29500 IF CH10=1 THEN CLOSE (10)
29510 IF CH11=1 THEN CLOSE (11)
29520 IF OUT20=1 THEN CLOSE (20)
29530 IF OUT21=1 THEN CLOSE (21)
29540 RELEASE
'''


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def semantic_lines(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        return {(row["SalesOrderNumber"], row["LineNumber"]): row
                for row in csv.DictReader(source)}


def main() -> int:
    qualification_started = time.perf_counter()
    parser = argparse.ArgumentParser()
    parser.add_argument("--full-run-root", required=True, type=Path)
    parser.add_argument("--base-package", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--compile", action="store_true")
    args = parser.parse_args()
    full_runtime = args.full_run_root / "Runtime/Pass1"
    full_package = args.full_run_root / "Package"
    if args.output.exists():
        raise FileExistsError("shadow output already exists")
    for path in (full_runtime, full_package, args.base_package, BUILDER):
        if not path.exists():
            raise FileNotFoundError(path)

    args.output.mkdir(parents=True)
    shadow_runtime = args.output / "Runtime/Pass1"
    shadow_runtime.mkdir(parents=True)
    timings: dict[str, float | None] = {}
    prefixes, timings["are03ScanMs"], timings["prefixDerivationMs"] = (
        eligible_header_prefixes(full_runtime / "ARE03_FULL.csv"))
    (args.output / "eligible-prefixes.json").write_text(
        json.dumps(prefixes, indent=2) + "\n", encoding="utf-8")

    local_started = time.perf_counter()
    for name in ("ARE03_FULL.csv", "ARM01_FULL.csv", "ARM10_FULL.csv",
                 "WOE03_FULL.csv"):
        shutil.copy2(full_runtime / name, shadow_runtime / name)
    timings["localPostProcessingMs"] = elapsed_ms(local_started)
    full_count, bounded_count, timings["boundedAre13EvidenceMs"] = (
        write_bounded_are13(
            full_runtime / "ARE13_FULL.csv",
            shadow_runtime / "ARE13_FULL.csv",
            prefixes))

    source_path = args.output / "OPEN_SALES_ORDER_ARE13_BOUNDED_SHADOW.src"
    source_path.write_text(
        bounded_vpro_source(prefixes, shadow_runtime), encoding="ascii")
    timings["boundedAre13CompileMs"] = None
    if args.compile:
        if not COMPILER.exists():
            raise FileNotFoundError(COMPILER)
        programs = args.output / "Programs"
        programs.mkdir()
        compile_started = time.perf_counter()
        subprocess.run(
            [str(COMPILER), f"-d{programs}", str(source_path)],
            cwd=source_path.parent, check=True, timeout=120)
        timings["boundedAre13CompileMs"] = elapsed_ms(compile_started)

    shadow_package = args.output / "Package"
    package_started = time.perf_counter()
    subprocess.run([
        sys.executable, str(BUILDER),
        "--runtime-root", str(args.output / "Runtime"),
        "--base-package", str(args.base_package),
        "--output", str(shadow_package),
        "--run-id", "OPENSALESREFRESH-SHADOW-PARITY",
        "--snapshot-year", "2026",
    ], check=True, timeout=600)
    timings["packageConstructionMs"] = elapsed_ms(package_started)
    timings["woeSeekExecutionMs"] = None

    parity = {
        name: {
            "fullSha256": sha256(full_package / "Canonical" / name),
            "shadowSha256": sha256(shadow_package / "Canonical" / name),
        }
        for name in CANONICAL_FILES
    }
    for value in parity.values():
        value["match"] = value["fullSha256"] == value["shadowSha256"]

    full_manifest = json.loads(
        (full_package / "manifest.json").read_text(encoding="utf-8-sig"))
    shadow_manifest = json.loads(
        (shadow_package / "manifest.json").read_text(encoding="utf-8-sig"))
    counts_match = full_manifest["counts"] == shadow_manifest["counts"]
    validation_match = full_manifest["validation"] == shadow_manifest["validation"]
    lines = semantic_lines(shadow_package / "Canonical/SalesOrderLine.csv")
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

    exact = (all(value["match"] for value in parity.values())
             and counts_match and validation_match
             and all(value["match"] for value in rma.values()))
    timings["candidateQualificationMs"] = elapsed_ms(qualification_started)
    result = {
        "result": "PASS" if exact else "PARITY_MISMATCH",
        "normalSyncPathChanged": False,
        "fullAre13Records": full_count,
        "eligibleOrderPrefixes": len(prefixes),
        "boundedAre13Records": bounded_count,
        "timings": timings,
        "woeSeekTimingEvidence": (
            "Not re-executed in safe local qualification; retained WOE03_FULL.csv "
            "and relationship results were required to hash-match."),
        "canonicalParity": parity,
        "countsMatch": counts_match,
        "validationMatch": validation_match,
        "rma0012009": rma,
    }
    (args.output / "shadow-parity-result.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if exact else 1


if __name__ == "__main__":
    raise SystemExit(main())

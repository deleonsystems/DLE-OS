"""Isolated, deterministic Production reference rendering checks (no SIM writes)."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "production-print"
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("production_pdf", ROOT / "Tools/SimRuntime/DleOs.SimHost/sim_production_pdf.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
checks = 0


def check(condition, message):
    global checks
    assert condition, message
    checks += 1


names = ["Kitting", "PCB Preparation", "SMT Setup", "Solder Paste", "SMT Placement", "Reflow",
         "First Piece / In-Process Inspection", "Thru-Hole Assembly", "Hand Solder", "Cleaning",
         "Final Inspection", "Test", "Packaging"]
instructions = {
    "Reflow": "Use the released profile. The estimate covers active handling, not oven dwell or process settings.",
    "First Piece / In-Process Inspection": "Hold remaining assemblies pending first-piece inspection. Verify orientation against the controlled drawing.",
    "Hand Solder": "Solder specified joints to the controlled workmanship requirement.",
    "Cleaning": "Clean and inspect before installing standoffs. Install standoffs after cleaning.",
    "Test": "Perform per-serial T1-T6 testing and retain the test record for each assembly.",
    "Packaging": "Apply labeling and packaging only after Test passes. Preserve customer packaging requirements.",
}
operations = []
for index, name in enumerate(names, start=1):
    operations.append({
        "id": f"stable-traveler-op-{index}", "sourceOperationId": f"op-{index}", "sequence": index * 10,
        "name": name, "classification": "MATERIALS_PREREQUISITE" if index == 1 else "PRODUCTION",
        "enabled": True, "executionState": "NOT_STARTED", "department": None, "workCenter": None,
        "instructions": instructions.get(name, "Verify identity and revision against the released technical drawing before performing this operation."),
        "shopInstructions": "", "managementNotes": "", "inspectionRequirements": "" if name != "Test" else "Record T1-T6 results by serial.",
        "estimatingBasis": {"operationQuantity": 12 if index == 5 else 1, "runSeconds": 3 if index == 5 else 60,
                            "setupMinutes": None, "timeBasis": "BATCH" if index in (1, 3, 7) else "PER_UNIT",
                            "calculationVersion": "LABOR_BATCH_ALLOCATION_V6"},
        "productionNotes": [{"id": f"note-{index}", "purpose": "PRODUCTION", "text": "Retain source requirements and report any inconsistency for review."},
                            {"id": f"private-{index}", "purpose": "INTERNAL_RFQ", "text": "SECRET_RFQ_PRICING_MARGIN"}],
        "visuals": ([{"documentId": f"visual-{index}", "name": f"op-{index}-reference.png", "caption": f"{name} reference"}]
                    if index in (5, 7, 8, 11) else []),
        "technicalReferences": [{"documentId": "drawing-reference", "name": "03_SIM-ASSY-001_Technical_A.pdf", "type": "Technical Drawing"}],
    })

bom = []
for index in range(1, 13):
    bom.append({"requirementId": f"G{index:03d}", "sourceRowId": f"source-row-{index}", "find": str(index),
                "partNumber": "SIM-OPTO-4" if index == 5 else f"SIM-PART-{index}", "description": "Optocoupler" if index == 5 else "Released component",
                "references": ["U1", "U2"] if index == 5 else [f"R{index}"], "requiredEach": 2 if index == 5 else 1,
                "requiredQuantity": 20 if index == 5 else 10, "uom": "EA", "eligibleParts": [], "dnp": False,
                "method": "COUNT" if index == 5 else "COMPLETE", "result": "Counted Exact" if index == 5 else "Complete (completion disposition)",
                "recordedKittedQuantity": 20 if index == 5 else None, "originalKittedQuantity": 12 if index == 5 else None,
                "acceptedMaterialApplied": 8 if index == 5 else 0, "shortage": 0, "allocations":
                [{"partNumber": "SIM-OPTO-4", "quantity": 12, "purchaseOrder": ""}, {"partNumber": "SIM-OPTO-4", "quantity": 8, "purchaseOrder": "SIM-PO-0001 / 010"}] if index == 5 else [],
                "acceptedMaterials": [{"materialId": "SIM-AM-0000001", "purchaseOrderNumber": "SIM-PO-0001", "purchaseOrderLine": "010", "quantity": 8, "applicationId": "application-reference"}] if index == 5 else []})

package = {
    "workOrderNumber": "0999999", "context": {"customer": "DLE-SIM-CUSTOMER", "assembly": "SIM-ASSY-001", "revision": "A", "quantity": 10,
        "customerDueDate": "2026-10-14", "sourceQuote": "SIM-Q-0042-R01", "sourceIntakeId": "RFQI-SIM-0043"},
    "materialStatus": "KIT_COMPLETE", "productionStatus": "READY_TO_START_PRODUCTION",
    "source": {"laborVersion": 2, "manufacturingDefinitionId": "c545f92b-d0ac-40f6-b072-ff1ce68a1f6b", "acceptanceId": "accepted-package-ref",
               "releasedBomIdentity": "SIM-KITTING-V1:70C5C2F4477060EE2E4C7245C0381AD4BF0DE16D1CAB47451F6E068282B1477F", "releasedBomVersion": 1},
    "boundTraveler": {"id": "WO-TRAVELER-REFERENCE", "version": 1, "definitionId": "TRAVELER-DEFINITION-REFERENCE", "definitionVersion": 1, "operations": operations},
    "definition": {"id": "TRAVELER-DEFINITION-REFERENCE", "version": 2, "workingVersion": 3, "operations": [{"name": "MUTABLE_DEFINITION_MUST_NOT_PRINT"}]},
    "bom": bom, "kitting": {"caseId": "case-reference", "submissionId": "final-submission-reference", "submissionVersion": 1,
                             "submittedBy": "Synthetic reviewer", "submittedAtUtc": "2026-09-25T13:19:24Z"},
    "internalCost": "SECRET_TOTAL_COST",
}
data = {"kind": "traveler", "package": package, "generatedBy": "SIM Verification", "generatedAt": "2026-09-25T16:00:00Z"}


def output(name, value):
    before = copy.deepcopy(value)
    path = OUT / (name + ".pdf")
    renderer.render(value, "", path)
    check(value == before, name + " input projection unchanged")
    reader = PdfReader(path)
    texts = [page.extract_text() for page in reader.pages]
    check(all("NON-CONTROLLED COPY" in t for t in texts), name + " every-page noncontrolled marker")
    check(all("DLE-OS ELECTRONIC RECORD GOVERNS" in t for t in texts), name + " every-page authority marker")
    check(all("Generated by SIM Verification" in t and "09/25/2026 16:00:00 UTC" in t for t in texts), name + " every-page actor/UTC time")
    all_text = " ".join(" ".join(texts).split())
    check("10/14/2026" in all_text, name + " date-only MM/DD/YYYY")
    check("SECRET_" not in all_text, name + " excludes unallowed fields/notes")
    check("MUTABLE_DEFINITION_MUST_NOT_PRINT" not in all_text, name + " uses frozen bound route")
    return path, reader, all_text


traveler, reader, content = output("traveler", data)
for value in names[1:] + ["Active Production route - 12 operations", "op-1", "excluded from the active Production route",
                          "first-piece inspection", "per-serial T1-T6", "standoffs after cleaning", "only after Test passes",
                          "Frozen Labor V2", "APPROVED / FROZEN WO TRAVELER", "NOT STARTED"]:
    check(value.lower() in content.lower(), "Traveler retains " + value)
for index in (5, 7, 8, 11):
    check(f"op-{index}-reference.png" in content, f"Visual reference {index}")
check("op-9-reference" not in content, "Hand Solder stays text-only")
check(len(reader.pages) > 1, "Traveler exercises multipage layout")
repeat, _, _ = output("traveler-repeat", data)
check(hashlib.sha256(traveler.read_bytes()).digest() == hashlib.sha256(repeat.read_bytes()).digest(), "Fixed snapshot/time renders deterministic PDF")

bom_data = copy.deepcopy(data)
bom_data["kind"] = "bom"
_, reader, content = output("bom", bom_data)
for value in ["SIM-OPTO-4", "Original Kitting 12 EA + accepted material applied 8 EA = final recorded 20 EA", "SIM-AM-0000001",
              "SIM-PO-0001 / 010", "Counted Exact", "Not measured", "no numerical measured quantity was recorded", "final-submission-reference", "SIM-KITTING-V1"]:
    check(value in content, "BOM retains " + value)
for index in range(1, 13):
    check(f"Requirement: G{index:03d}" in content, f"BOM requirement {index}")
check(len(reader.pages) > 1, "BOM exercises multipage layout")

draft = copy.deepcopy(data)
draft["package"]["boundTraveler"] = None
draft["package"]["definition"]["operations"] = operations
draft["package"]["productionStatus"] = "TRAVELER_REVIEW_REQUIRED"
_, reader, content = output("traveler-draft", draft)
check(all("DRAFT / NOT BOUND TO WO" in page.extract_text() for page in reader.pages), "Every draft page clearly marked")
check("APPROVED / FROZEN WO TRAVELER" not in content, "Draft does not imply approval")
check("/ approved V" not in content, "Draft version is not labelled approved")

overflow = copy.deepcopy(data)
overflow["package"]["boundTraveler"]["operations"][1]["instructions"] = "Preserve this complete source technical requirement. " * 220 + "END_OF_LONG_SOURCE"
overflow["package"]["boundTraveler"]["operations"][1]["productionNotes"].append({"purpose": "PRODUCTION", "text": "<script> & literal <drawing>"})
_, reader, content = output("traveler-overflow", overflow)
check("END_OF_LONG_SOURCE" in content, "Long instruction not truncated")
check("<script> & literal <drawing>" in content, "User text escaped as literal text")
check(len(reader.pages) > 4, "Long source spans pages")
check(renderer.timestamp("2026-09-25T09:00:00-07:00") == "09/25/2026 16:00:00 UTC", "Non-UTC generation timestamp labeled accurately")
check(renderer.date_only("2026-10-14") == "10/14/2026", "Date-only formatting without timezone conversion")
print(f"PASS: {checks} Production PDF checks; reference and overflow PDFs under {OUT}")

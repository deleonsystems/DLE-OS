"""Non-controlled Production references from an already governed server projection.

No database access, source discovery, pricing projection, or execution mutations.
"""
import json
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal
from html import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, KeepTogether,
)


INK = colors.HexColor("#192d40")
MUTED = colors.HexColor("#536272")
LINE = colors.HexColor("#c8d0d8")
PALE = colors.HexColor("#edf1f5")
WIDTH = 540


def normalize(value):
    if isinstance(value, dict):
        return {k[0].lower() + k[1:]: normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize(v) for v in value]
    return value


def text(value, fallback="Not recorded"):
    if value is None or value == "":
        return fallback
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value).replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-")


def quantity(value):
    if value is None:
        return "Not measured"
    try:
        return format(Decimal(str(value)).normalize(), "f")
    except Exception:
        return text(value)


def date_only(value):
    # Contractual dates are date-only: no parsing as a timestamp or timezone shift.
    value = str(value or "")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value[5:7] + "/" + value[8:10] + "/" + value[:4]
    return text(value)


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return text(value) + " (timezone not recorded)"
        return parsed.astimezone(timezone.utc).strftime("%m/%d/%Y %H:%M:%S UTC")
    except (ValueError, TypeError, AttributeError):
        return text(value)


def label(value):
    return text(value).replace("_", " ").title()


def render(data, logo, output):
    data = normalize(data)
    package = data["package"]
    kind = data["kind"]
    if kind not in ("traveler", "bom"):
        raise ValueError("Unsupported Production reference kind")
    context = package.get("context") or {}
    source = package.get("source") or {}
    bound = package.get("boundTraveler") or {}
    definition = package.get("definition") or {}
    wo = text(package.get("workOrderNumber"))
    title = "PRODUCTION TRAVELER" if kind == "traveler" else "DLE-OS BOM / FINAL KITTING REFERENCE"
    draft = not bool(bound)
    status = "DRAFT / NOT BOUND TO WO" if draft else "APPROVED / FROZEN WO TRAVELER"
    traveler_ref = (f"{text(bound.get('id'))} / V{bound.get('version', 1)}" if bound else
                    f"Draft {text(definition.get('id'), 'not created')} / working V{definition.get('workingVersion', 0)}")
    normal = ParagraphStyle("production-body", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=INK, spaceAfter=0)
    small = ParagraphStyle("production-small", parent=normal, fontSize=7.5, leading=10)
    muted = ParagraphStyle("production-muted", parent=small, textColor=MUTED)
    bold = ParagraphStyle("production-bold", parent=normal, fontName="Helvetica-Bold")
    heading = ParagraphStyle("production-heading", parent=bold, fontSize=10, leading=13, spaceBefore=8, spaceAfter=4, keepWithNext=True)

    def p(value, style=normal):
        return Paragraph(escape(text(value)).replace("\n", "<br/>"), style)

    story = []

    def table(rows, widths, header=False):
        result = Table(rows, colWidths=widths, hAlign="LEFT", repeatRows=1 if header else 0, splitInRow=1)
        style = [("VALIGN", (0, 0), (-1, -1), "TOP"),
                 ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                 ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                 ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE)]
        if header:
            style += [("BACKGROUND", (0, 0), (-1, 0), PALE)]
        result.setStyle(TableStyle(style))
        return result

    def fields(items):
        rows = []
        for i in range(0, len(items), 2):
            pair = items[i:i + 2]
            cells = []
            for key, value in pair:
                cells.extend([p(key, small), p(value, bold)])
            if len(cells) == 2:
                cells.extend([p(" "), p(" ")])
            rows.append(cells)
        story.append(table(rows, [92, 178, 92, 178]))

    def detail(key, value, style=normal):
        if value not in (None, "", []):
            story.append(p(key, bold))
            story.append(p(value, style))
            story.append(Spacer(1, 4))

    fields([
        ("WO", wo), ("Customer", context.get("customer")),
        ("Assembly / Rev", f"{text(context.get('assembly'))} / {text(context.get('revision'))}"),
        ("WO Quantity", quantity(context.get("quantity"))),
        ("Customer Due", date_only(context.get("customerDueDate"))),
        ("Material Status", label(package.get("materialStatus"))),
        ("Production Status", label(package.get("productionStatus"))), ("Traveler Status", status),
    ])
    story += [Spacer(1, 5), p("Traveler: " + traveler_ref, small),
              p((f"Definition: {text(bound.get('definitionId'))} / approved V{bound.get('definitionVersion', 0)}" if bound else
                 f"Definition: {text(definition.get('id'))} / draft working V{definition.get('workingVersion', 0)}"), small),
              p(f"Source quote: {text(context.get('sourceQuote'))} | Accepted intake: {text(context.get('sourceIntakeId'))} | Frozen Labor V{source.get('laborVersion', '?')}", small),
              p("Manufacturing definition: " + text(source.get("manufacturingDefinitionId")), small),
              p("Accepted-order reference: " + text(source.get("acceptanceId")), small),
              p("State as of generation. Reprints do not approve, release, or sign off work. Confirm the current electronic record before use.", muted), Spacer(1, 6)]

    if kind == "traveler":
        # A bound route always wins over a later editable definition.
        operations = bound.get("operations") if bound else definition.get("operations")
        operations = operations if operations is not None else package.get("operations", [])
        operations = sorted(operations, key=lambda op: Decimal(str(op.get("sequence", 0))))
        prerequisites = [o for o in operations if o.get("classification") == "MATERIALS_PREREQUISITE"]
        active = [o for o in operations if o.get("classification") == "PRODUCTION" and o.get("enabled", True)]
        story.append(p("Materials prerequisite", heading))
        story.append(p("Materials Released: " + label(package.get("materialStatus")), bold))
        for op in prerequisites:
            story.append(p(f"Source {text(op.get('sourceOperationId'))} / {op.get('sequence')} {text(op.get('name'))}: retained in lineage, excluded from the active Production route.", small))
        for op in operations:
            if op not in active and op not in prerequisites:
                story.append(p(f"Source {text(op.get('sourceOperationId'))} / {op.get('sequence')} {text(op.get('name'))}: not active. {text(op.get('exclusionReason'), 'Classification review required.')}", small))
        story.append(p(f"Active Production route - {len(active)} operations", heading))
        rows = [[p("SEQ", bold), p("OPERATION", bold), p("WORK CENTER", bold), p("STATE", bold)]]
        for op in active:
            rows.append([p(op.get("sequence")), p(op.get("name"), bold),
                         p(op.get("workCenter") or op.get("department") or "Not Assigned"),
                         p(label(op.get("executionState", "NOT_STARTED")))])
        story.append(table(rows, [36, 265, 132, 107], True))
        story.append(p("Estimating references are planning allowances, not process settings or actual execution time.", muted))
        for op in active:
            block_start = len(story)
            story.append(p(f"{op.get('sequence')} - {text(op.get('name'))}", heading))
            story.append(p(f"Traveler operation {text(op.get('id'))} | Source {text(op.get('sourceOperationId'))} | {label(op.get('executionState', 'NOT_STARTED'))}", muted))
            basis = op.get("estimatingBasis") or {}
            basis_items = []
            if basis.get("operationQuantity") is not None and basis.get("runSeconds") is not None:
                basis_items.append(f"{quantity(basis['operationQuantity'])} x {quantity(basis['runSeconds'])} sec / {'batch' if basis.get('timeBasis') == 'BATCH' else 'assembly'}")
            if basis.get("setupMinutes") is not None:
                basis_items.append(f"setup {quantity(basis['setupMinutes'])} min")
            if basis_items:
                story.append(p("Estimate: " + "; ".join(basis_items), small))
            story.append(Spacer(1, 4))
            detail("Frozen source instruction", op.get("instructions"))
            detail("Traveler / shop instruction", op.get("shopInstructions"))
            for note in op.get("productionNotes") or []:
                # Deliberate allowlist: internal quotation content is never printable.
                if note.get("purpose", "PRODUCTION") == "PRODUCTION" and not note.get("removed", False):
                    detail("Production note", note.get("text"))
            detail("Inspection / test requirement", op.get("inspectionRequirements"))
            detail("Management note (does not override technical authority)", op.get("managementNotes"))
            visuals = op.get("visuals") or []
            if visuals:
                detail("Verified visual references", "\n".join(text(v.get("name")) + (" - " + v["caption"] if v.get("caption") else "") for v in visuals))
            else:
                story.append(p("Visual reference: text-only", muted))
            technical = op.get("technicalReferences") or []
            if technical:
                detail("Controlled technical references", "\n".join(text(r.get("name")) + (" | " + text(r.get("type")) if r.get("type") else "") for r in technical), small)
            # Keep ordinary operations together; oversized instructions can still
            # continue across pages instead of being clipped or reduced to tiny type.
            block = story[block_start:]
            del story[block_start:]
            story.append(KeepTogether(block))
    else:
        render_bom(package, story, p, table, detail, heading, bold, small, muted)

    generated = f"Generated by {text(data.get('generatedBy'))} | {timestamp(data.get('generatedAt'))}"

    def chrome(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(36, 760, "DE LEON ENTERPRISES / DLE-OS")
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawRightString(576, 760, "NON-CONTROLLED COPY")
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(36, 742, title)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(36, 728, f"WO {wo} | {status}")
        version_context = (f"WO Traveler V{bound.get('version', 1)} | Definition V{bound.get('definitionVersion', 0)}" if bound else
                           f"Draft working V{definition.get('workingVersion', 0)}")
        canvas.drawRightString(576, 728, version_context)
        canvas.setStrokeColor(LINE)
        canvas.line(36, 719, 576, 719)
        canvas.line(36, 51, 576, 51)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawString(36, 39, "DLE-OS ELECTRONIC RECORD GOVERNS")
        canvas.setFont("Helvetica", 7)
        canvas.drawRightString(576, 39, f"Page {doc.page}")
        canvas.drawString(36, 27, generated)
        canvas.restoreState()

    doc = SimpleDocTemplate(str(output), pagesize=(612, 792), leftMargin=36, rightMargin=36,
                            topMargin=80, bottomMargin=62, title=f"WO {wo} - {title} - NON-CONTROLLED",
                            author=text(data.get("generatedBy")), invariant=1)
    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)


def render_bom(package, story, p, table, detail, heading, bold, small, muted):
    # Implemented against the read-only final-submission join, never operational stores.
    bom = package.get("bom") or {}
    source = package.get("source") or {}
    final = package.get("kitting") or {}
    story.append(p("Released definition + final governed Kitting result", heading))
    story.append(p(f"Released BOM: {text(source.get('releasedBomIdentity'))} / V{source.get('releasedBomVersion', '?')}", small))
    story.append(p(f"Final submission: {text(final.get('submissionId'))} / V{final.get('submissionVersion', '?')}", small))
    story.append(p(f"Submitted by {text(final.get('submittedBy'))} | {timestamp(final.get('submittedAtUtc'))}", small))
    requirements = bom.get("requirements", []) if isinstance(bom, dict) else bom
    for row in requirements:
        block_start = len(story)
        story.append(p(f"Find {text(row.get('find'))} - {text(row.get('partNumber'))}", heading))
        story.append(p("Requirement: " + text(row.get("requirementId")), muted))
        detail("Description", row.get("description"))
        refs = row.get("references") or []
        detail("Ref Des", ", ".join(refs) if isinstance(refs, list) else refs)
        unit = text(row.get("uom"), "EA")
        story.append(table([[p("QTY / ASSEMBLY", bold), p("REQUIRED", bold), p("RECORDED KITTED", bold), p("SHORT", bold)],
                            [p(quantity(row.get("requiredEach"))), p(quantity(row.get("requiredQuantity")) + " " + unit),
                             p(quantity(row.get("recordedKittedQuantity")) + (" " + unit if row.get("recordedKittedQuantity") is not None else "")),
                             p(quantity(row.get("shortage")))]], [125, 125, 165, 125], True))
        detail("Final result", label(row.get("result")))
        story.append(p("DNP: " + text(row.get("dnp", False)), small))
        related = [part for part in row.get("eligibleParts") or [] if part != row.get("partNumber")]
        if related:
            detail("Approved related / alternate identities", ", ".join(text(r.get("partNumber")) if isinstance(r, dict) else text(r) for r in related), small)
        if row.get("recordedKittedQuantity") is None:
            message = ("Satisfied by the recorded completion disposition; no numerical measured quantity was recorded."
                       if row.get("method") in ("COMPLETE", "COMPLETE_MIN_EXTRA") else
                       "No numerical kitted quantity is recorded in this snapshot.")
            story.append(p(message, muted))
        if row.get("acceptedMaterialApplied", 0):
            detail("Material quantity reconciliation", f"Original Kitting {quantity(row.get('originalKittedQuantity'))} {unit} + accepted material applied {quantity(row.get('acceptedMaterialApplied'))} {unit} = final recorded {quantity(row.get('recordedKittedQuantity'))} {unit}")
        allocations = row.get("allocations") or []
        if allocations:
            detail("Final allocation evidence", "\n".join(
                f"{text(a.get('partNumber'))}: {quantity(a.get('quantity'))} {unit}" +
                (f" | PO {a['purchaseOrder']}" if a.get("purchaseOrder") else "") for a in allocations), small)
        applications = row.get("acceptedMaterials") or []
        if applications:
            detail("Accepted-material application evidence", "\n".join(
                f"{text(a.get('materialId'))} | Applied {quantity(a.get('quantity'))} {unit} | PO {text(a.get('purchaseOrderNumber'))} / {text(a.get('purchaseOrderLine'))} | Application {text(a.get('applicationId'))}"
                for a in applications), small)
        block = story[block_start:]
        del story[block_start:]
        story.append(KeepTogether(block))


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8-sig") as stream:
        render(json.load(stream), sys.argv[2], sys.argv[3])

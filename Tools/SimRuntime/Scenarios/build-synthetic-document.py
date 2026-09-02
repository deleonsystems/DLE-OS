from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


OUTPUT = Path(__file__).with_name("sim-wo-9700001-kit-summary.pdf")


def build() -> None:
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "SimTitle", parent=styles["Title"], fontName="Helvetica-Bold",
        fontSize=20, leading=23, textColor=colors.HexColor("#123B3A"),
        spaceAfter=4,
    )
    eyebrow = ParagraphStyle(
        "Eyebrow", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=8, leading=10, textColor=colors.HexColor("#65737E"),
        tracking=1.2,
    )
    body = ParagraphStyle(
        "Body", parent=styles["BodyText"], fontSize=9, leading=12,
        textColor=colors.HexColor("#17212B"),
    )
    right = ParagraphStyle("Right", parent=body, alignment=TA_RIGHT)
    document = SimpleDocTemplate(
        str(OUTPUT), pagesize=letter, rightMargin=0.55 * inch,
        leftMargin=0.55 * inch, topMargin=0.48 * inch,
        bottomMargin=0.48 * inch, title="DLE-OS SIM WO 9700001 Kit Summary",
        author="DLE-OS SIM", subject="Synthetic Kitting document",
        invariant=1,
    )

    story = [
        Paragraph("DLE-OS SIM - SYNTHETIC DOCUMENT", eyebrow),
        Paragraph("Kit Complete Summary", title),
        Table(
            [[Paragraph("WORK ORDER", eyebrow), Paragraph("DOCUMENT STATUS", eyebrow)],
             [Paragraph("9700001", ParagraphStyle("WO", parent=title, fontSize=28, leading=30)),
              Paragraph("READ-ONLY BROWSER PREVIEW", right)]],
            colWidths=[4.3 * inch, 2.6 * inch],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EAF4F1")),
                ("BOX", (0, 0), (-1, -1), 1.2, colors.HexColor("#123B3A")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9DB7AE")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]),
        ),
        Spacer(1, 0.18 * inch),
    ]

    fields = [
        ("Customer", "SIM Aeronautics Lab"),
        ("Customer P.O.", "SIM-PO-ALPHA"),
        ("Sales Order / Line", "9800001 / 001"),
        ("Assembly", "SIM-ACTUATOR-A"),
        ("Description", "Synthetic flight-control actuator"),
        ("BOM / Revision", "SIM-BOM-A / Rev A"),
        ("Drawing / Revision", "SIM-DWG-A / Rev A"),
        ("Build Quantity", "10 EA"),
        ("Material Status", "KIT COMPLETE"),
        ("Kitting Run", "001 / Working version 2"),
    ]
    data = []
    for index in range(0, len(fields), 2):
        row = []
        for label, value in fields[index:index + 2]:
            row.append(Paragraph(f"<b>{label}</b><br/>{value}", body))
        data.append(row)
    story.append(Table(data, colWidths=[3.45 * inch, 3.45 * inch], style=TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#82958E")),
        ("INNERGRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#BAC8C3")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ])))
    story.extend([
        Spacer(1, 0.2 * inch),
        Paragraph("Synthetic kit contents", styles["Heading2"]),
    ])
    components = [
        ["Seq", "Part", "Description", "Required", "Result"],
        ["010", "SIM-SERVO-CORE", "Synthetic actuator servo core", "10 EA", "Complete"],
        ["020", "SIM-HOUSING-A", "Synthetic anodized housing", "10 EA", "Complete"],
        ["030", "SIM-FASTENER-KIT", "Synthetic controlled fastener kit", "10 KT", "Complete"],
        ["040", "SIM-WIRE-HARNESS", "Synthetic test wire harness", "10 EA", "Complete"],
    ]
    story.append(Table(components, colWidths=[0.5 * inch, 1.55 * inch, 2.85 * inch, 0.85 * inch, 1.15 * inch],
                       repeatRows=1, style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123B3A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#7C8D87")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F6F5")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ])))
    story.extend([
        Spacer(1, 0.24 * inch),
        Table([[Paragraph("SYNTHETIC ONLY", eyebrow),
                Paragraph("No production document, file share, printer, or external system was used.", right)]],
              colWidths=[1.35 * inch, 5.55 * inch], style=TableStyle([
                  ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#B26A00")),
                  ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF4DF")),
                  ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                  ("LEFTPADDING", (0, 0), (-1, -1), 8),
                  ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                  ("TOPPADDING", (0, 0), (-1, -1), 7),
                  ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
              ])),
    ])
    document.build(story)


if __name__ == "__main__":
    build()

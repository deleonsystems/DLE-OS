"""Entirely invented non-customer pilot. Deterministic files authorize exact bytes only."""
import sys
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table, TableStyle

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
for supporting in [False, True]:
    canvas = Canvas(str(folder / ('supporting.pdf' if supporting else 'governing.pdf')), invariant=1)
    if not supporting:
        canvas.drawString(35, 730, 'DLE NON-SENSITIVE SYNTHETIC ANALYSIS FIXTURE - not a customer drawing')
        canvas.showPage()
    canvas.drawString(35, 760, 'Invented supporting BOM' if supporting else 'Invented governing assembly BOM')
    rows = [['Line #', 'P/N', 'Quantity', 'Designator', 'Desc.']]
    for i in range(1, 7):
        rows.append([str(i), 'DEMO-PART-' + str(i), '9' if supporting and i == 2 else str(i), 'R' + str(i), 'Synthetic resistor ' + str(i)])
    table = Table(rows, colWidths=[45, 115, 55, 80, 170], rowHeights=30)
    table.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), .5, 'black')]))
    table.wrapOn(canvas, 530, 700)
    table.drawOn(canvas, 35, 480)
    canvas.save()

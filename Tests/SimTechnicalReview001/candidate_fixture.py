import importlib.util
import io
import sys
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table, TableStyle

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('candidate', root / 'Tools/SimRuntime/DleOs.SimHost/sim_candidate_bom.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(part):
    output = io.BytesIO()
    canvas = Canvas(output)
    canvas.drawString(30, 700, 'Isolated SIM candidate test fixture')
    canvas.showPage()
    data = [['Line #', 'P/N', 'Quantity', 'Designator', 'Desc.']]
    data += [[str(i), part if i in [1, 2] else 'TEST-' + str(i), str(i), 'C' + str(i), 'Test component'] for i in range(1, 13)]
    table = Table(data, colWidths=[45, 100, 60, 80, 130], rowHeights=22)
    table.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.5, 'black')]))
    table.wrapOn(canvas, 550, 750)
    table.drawOn(canvas, 30, 400)
    canvas.save()
    return output.getvalue()


first = fixture('REAL-BYTE-INPUT')
rows = module.extract(first)['rows']
assert len(rows) == 10
assert rows[0]['values'][1] == rows[1]['values'][1] == 'REAL-BYTE-INPUT'
assert rows[9]['values'][0] == '10'
assert rows[0]['bounds'][1] < rows[1]['bounds'][1]
assert module.extract(fixture('CHANGED-BINARY'))['rows'][0]['values'][1] == 'CHANGED-BINARY'
try:
    module.extract(b'%PDF-not-a-real-document')
    raise AssertionError('Malformed PDF accepted')
except (ValueError, Exception) as error:
    assert not isinstance(error, AssertionError)
Path(sys.argv[1]).write_bytes(first)
print('PASS: real byte extraction, ten-row cap, duplicate parts kept separate, locations, changed source and invalid PDF rejection')

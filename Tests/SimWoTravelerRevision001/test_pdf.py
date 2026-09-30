import importlib.util
import json
from pathlib import Path
from pypdf import PdfReader
import pdfplumber

root = Path(__file__).resolve().parents[2]
out = root / 'tmp/wo-traveler-revisions'
spec = importlib.util.spec_from_file_location('production_pdf', root / 'Tools/SimRuntime/DleOs.SimHost/sim_production_pdf.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
checks = 0

def check(condition, label):
    global checks
    assert condition, label
    checks += 1

for name, version in [('baseline', 1), ('draft-saved', 1), ('approved-v2', 2), ('draft-v3', 2)]:
    package = json.loads((out / (name + '.json')).read_text(encoding='utf-8-sig'))
    original = json.dumps(package)
    target = out / (name + '-print.pdf')
    renderer.render(dict(package=package, kind='traveler', generatedBy='Isolated Revision Verification', generatedAt='2026-09-27T18:00:00Z'), '', target)
    pages = PdfReader(target).pages
    text = ' '.join(page.extract_text() for page in pages)
    check(json.dumps(package) == original, name + ' projection unchanged')
    check(all(f'WO Traveler V{version}' in page.extract_text() for page in pages), name + ' effective revision on every page')
    check(all('NON-CONTROLLED COPY' in page.extract_text() and 'DLE-OS ELECTRONIC RECORD GOVERNS' in page.extract_text() for page in pages), name + ' every-page uncontrolled markers')
    check(all('Approved' in page.extract_text() for page in pages), name + ' approval date on every page')
    check(('WO-Specific Revision' if version == 2 else 'As Quoted') in text, name + ' change basis')
    check('Source sequence 30 | WO sequence 20' in text if version == 2 else 'Source sequence 20 | WO sequence 20' in text, name + ' correct source and WO sequence')
    check(text.index('SMT Setup') < text.index('PCB Preparation') if version == 2 else text.index('PCB Preparation') < text.index('SMT Setup'), name + ' approved effective order, never pending draft')
    check('Frozen Labor V2' in text and 'SIM-Q-0042-R01' in text, name + ' retained source lineage')
    with pdfplumber.open(target) as doc:
        for index, page in enumerate(doc.pages):
            check(all(0 <= b['x0'] and b['x1'] <= page.width + 1 and 0 <= b['top'] and b['bottom'] <= page.height + 1 for b in page.chars), name + f' page {index+1} within canvas')
print(f'PASS {checks} revision-aware PDF checks')

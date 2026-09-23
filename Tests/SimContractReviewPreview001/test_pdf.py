import json
from pathlib import Path
from pypdf import PdfReader
p=Path('output/pdf/contract-review/RFQI-SIM-0043-contract-review-preview.pdf')
r=PdfReader(p); t='\n'.join(page.extract_text() for page in r.pages)
assert len(r.pages)==1
for value in ['DLE-SIM-CUSTOMER','SIM-Q-0042-R01','10/14/2026','10/13/2026','70.64','706.40','02_SIM-ASSY-001_BOM_A.pdf','03_SIM-ASSY-001_Technical_A.pdf','Not Yet Submitted']:
    assert value in t,value
assert 'CONTRACT REVIEW ACCEPTED' not in t
print('PASS: Live PDF is one US Letter page with scenario facts, dates, filenames and truthful draft status')
# Long legacy notes must continue without truncation.
import importlib.util
spec=importlib.util.spec_from_file_location('cr','Tools/SimRuntime/DleOs.SimHost/sim_contract_review_pdf.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
d=json.loads(Path('output/pdf/contract-review/projection.json').read_text(encoding='utf-8-sig'))
d['sections'].append({'title':'Other Customer Requirements','fields':[{'label':'Legacy note','value':'Complete requirement text. '*250+'END OF REQUIREMENTS'}]})
m.render(d,'Tools/SimRuntime/DleOs.SimHost/Quotation/no back-black font.png','tmp/contract-review/overflow.pdf')
r=PdfReader('tmp/contract-review/overflow.pdf');assert len(r.pages)>1;assert 'END OF REQUIREMENTS' in ' '.join(' '.join(p.extract_text() for p in r.pages).split())
print('PASS: Long requirements continue onto additional pages without truncation')

"""Verify customer content/layout parity and durable markings across page breaks."""
import sys
import json,base64,io
from PIL import Image
from pathlib import Path
import pdfplumber
folder=Path(sys.argv[1])
def unmarked(page):
    return page.filter(lambda obj: obj.get('non_stroking_color') not in [(0.823529,0.85098,0.870588),(0.607843,0.145098,0.196078)])
def words(page,body=False):
    values=unmarked(page).extract_words()
    if body:values=[w for w in values if 140<w['top']<710]
    return [(w['text'],round(w['x0'],2),round(w['top'],2)) for w in values]
with pdfplumber.open(folder/'preview.pdf') as preview,pdfplumber.open(folder/'isolated-final.pdf') as final:
    images=json.loads((folder/'preview-pages.json').read_text())['pages']
    assert len(images)==len(preview.pages)
    for page,data in zip(preview.pages,images):
        expected=page.to_image(resolution=144).original.convert('RGB')
        actual=Image.open(io.BytesIO(base64.b64decode(data.split(',',1)[1]))).convert('RGB')
        assert actual.size==expected.size and actual.tobytes()==expected.tobytes(),'Displayed page differs from PDF'
    text='\n'.join(p.extract_text() for p in preview.pages)
    for value in ['DLE-SIM-CUSTOMER','SIM-ASSY-001','Rev A','10','$70.64','$706.40','3 Weeks','$0.00','NOT APPROVED - NOT FOR CUSTOMER USE']:
        assert value in text,value
    assert 'INTERNAL-SECRET' not in text
    assert len(preview.pages)==len(final.pages)
    assert all(words(a,True)==words(b,True) for a,b in zip(preview.pages,final.pages)), 'Commercial body geometry differs'
with pdfplumber.open(folder/'approved-preview.pdf') as pdf:
    assert '3 Weeks' in pdf.pages[0].extract_text() and '99 Weeks' not in pdf.pages[0].extract_text()
with pdfplumber.open(folder/'multipage-preview.pdf') as preview,pdfplumber.open(folder/'multipage-final.pdf') as final:
    assert len(preview.pages)==len(final.pages)>1
    for a,b in zip(preview.pages,final.pages):
        assert 'NOT APPROVED - NOT FOR CUSTOMER USE' in a.extract_text()
        assert any(c.get('text')=='P' and c.get('non_stroking_color')==(0.823529,0.85098,0.870588) for c in a.chars),'Missing diagonal watermark'
        assert words(a)==words(b),'Pagination or layout drift'
    print(f'PASS: identical commercial text/coordinates and {len(preview.pages)}-page pagination; watermark on every page.')
for name in ['preview','multipage-preview']:
    with pdfplumber.open(folder/(name+'.pdf')) as pdf:
        for index,page in enumerate(pdf.pages):page.to_image(resolution=90).save(folder/f'{name}-{index+1}.png')
print('PASS: E2E values, internal-data exclusion, approved-answer authority and rendered-page QA outputs.')

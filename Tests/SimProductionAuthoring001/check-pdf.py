from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
for mode in ['draft','approved']:
    path=Path('tmp/production-team/authored-'+mode+'.pdf')
    pages=PdfReader(path).pages
    text='\n'.join(p.extract_text() for p in pages)
    for needle in ['FIRST SUBSTEP sentinel','SECOND SUBSTEP sentinel','PROMOTED NOTE sentinel','TEAM VISUAL caption','DIRECT CONTROLLED caption']:
        assert needle in text,needle
    assert 'UNPROMOTED NOTE sentinel' not in text
    assert 'PRIVATE NOTE sentinel' not in text
    assert ('DRAFT / NOT EFFECTIVE' in text)==(mode=='draft')
    assert all('NON-CONTROLLED COPY' in p.extract_text() for p in pages)
    doc=pdfium.PdfDocument(path)
    for i,p in enumerate(doc):
        if 'FIRST SUBSTEP sentinel' in p.get_textpage().get_text_range():
            p.render(scale=1.2).to_pil().save(path.with_suffix('.png'));break
    print(mode, len(pages),'pages: controlled content, Team exclusion and page markings PASS')

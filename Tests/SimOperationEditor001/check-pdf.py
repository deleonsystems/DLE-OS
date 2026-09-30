from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
for mode in ['draft','approved']:
 p=Path('tmp/operation-editor/editor-'+mode+'.pdf');pages=PdfReader(p).pages;text='\n'.join(x.extract_text() for x in pages)
 assert 'EDITOR_SENTINEL' in text and 'Prep' in text and 'Production' in text
 assert 'Check board revision' in text and 'Inspect finish' in text
 assert ('DRAFT / NOT EFFECTIVE' in text)==(mode=='draft')
 assert all('NON-CONTROLLED COPY' in x.extract_text() and 'DLE-OS ELECTRONIC RECORD GOVERNS' in x.extract_text() for x in pages)
 doc=pdfium.PdfDocument(p)
 for page in doc:
  if 'EDITOR_SENTINEL' in page.get_textpage().get_text_range():page.render(scale=1.2).to_pil().save(p.with_suffix('.png'));break
 print(mode, 'instruction/work-center/substeps/markings PASS;',len(pages),'pages')

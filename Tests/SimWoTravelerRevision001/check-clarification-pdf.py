import json
from pathlib import Path
import pypdfium2 as pdfium
import importlib.util
spec=importlib.util.spec_from_file_location("production_pdf", "Tools/SimRuntime/DleOs.SimHost/sim_production_pdf.py")
renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
out=Path('tmp/traveler-clarification')
for name in ['clarification-draft','clarification-approved']:
    package=json.loads(Path('tmp/wo-traveler-revisions/'+name+'.json').read_text(encoding='utf-8-sig'))
    if name=='clarification-draft':
        package['effectiveRevision']=package['woRevisionDraft'];package['draftPreview']=True
    renderer.render({'package':package,'kind':'traveler','generatedBy':'Isolated Test','generatedAt':'2026-09-27T14:00:00Z'},None,Path('tmp/wo-traveler-revisions/'+name+'.pdf'))
    doc=pdfium.PdfDocument('tmp/wo-traveler-revisions/'+name+'.pdf')
    text='\n'.join(p.get_textpage().get_text_range() for p in doc)
    assert 'Confirm D1 and D2 polarity before releasing the first board.' in text
    assert 'Production clarification - added in Traveler v3' in text
    assert all('NON-CONTROLLED COPY' in p.get_textpage().get_text_range() and 'DLE-OS ELECTRONIC RECORD GOVERNS' in p.get_textpage().get_text_range() for p in doc)
    assert 'Approved Not recorded' not in text
    assert ('DRAFT / NOT EFFECTIVE' in text)==(name=='clarification-draft')
    for i,p in enumerate(doc):
        if 'Production clarification - added' in p.get_textpage().get_text_range():
            p.render(scale=1.4).to_pil().save(out/(name+'.png'));break
    print(name, len(doc), 'pages: clarification, revision and page markings PASS')

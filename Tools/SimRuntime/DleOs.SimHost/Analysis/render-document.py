"""Bounded PDF representation only; no table parser, OCR, macros or external links."""
import base64
import io
import json
import sys
import pdfplumber

data = sys.stdin.buffer.read(20 * 1024 * 1024 + 1)
if len(data) > 20 * 1024 * 1024:
    raise ValueError('document too large')
page_number = int(sys.argv[1])
with pdfplumber.open(io.BytesIO(data)) as pdf:
    if page_number < 1 or page_number > len(pdf.pages):
        raise ValueError('requested page unavailable')
    page = pdf.pages[page_number - 1]
    if page.width > 1500 or page.height > 1500:
        raise ValueError('page dimensions exceed pilot limit')
    image = page.to_image(resolution=110).original
    output = io.BytesIO()
    image.save(output, format='PNG')
    print(json.dumps({'page': page_number, 'text': (page.extract_text() or '')[:40000],
                      'image': base64.b64encode(output.getvalue()).decode('ascii')}))

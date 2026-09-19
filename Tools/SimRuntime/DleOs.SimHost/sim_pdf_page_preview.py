"""Render one local PDF page for the assisted viewer; no OCR or extraction."""
import io
import sys
import pypdfium2 as pdfium

with pdfium.PdfDocument(sys.stdin.buffer.read(20 * 1024 * 1024 + 1)) as pdf:
    number = int(sys.argv[1])
    if not 1 <= number <= min(len(pdf), 200):
        raise ValueError("Page unavailable")
    page = pdf[number - 1]
    width, height = page.get_size()
    bitmap = page.render(scale=min(2, 2200 / max(width, height)))
    image = bitmap.to_pil()
    output = io.BytesIO()
    image.save(output, format="PNG")
    sys.stdout.buffer.write(output.getvalue())
    image.close()
    bitmap.close()
    page.close()

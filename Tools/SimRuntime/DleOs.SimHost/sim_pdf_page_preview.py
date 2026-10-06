"""Render one local PDF page for the assisted viewer; no OCR or extraction."""
import io
import sys
import pypdfium2 as pdfium

with pdfium.PdfDocument(sys.stdin.buffer.read(20 * 1024 * 1024 + 1)) as pdf:
    number = int(sys.argv[1])
    if number == 0:
        sys.stdout.write(str(len(pdf)))
        sys.exit(0)
    if not 1 <= number <= len(pdf):
        raise ValueError("Page unavailable")
    page = pdf[number - 1]
    width, height = page.get_size()
    pixels = int(sys.argv[2]) if len(sys.argv) > 2 else 2200
    if not 512 <= pixels <= 4096:
        raise ValueError("Preview size unavailable")
    # At most 16 megapixels and 8x source scale; never unbounded browser-driven allocation.
    scale = min(8, pixels / max(width, height), (16000000 / (width * height)) ** .5)
    bitmap = page.render(scale=scale)
    image = bitmap.to_pil()
    output = io.BytesIO()
    image.save(output, format="PNG")
    sys.stdout.buffer.write(output.getvalue())
    image.close()
    bitmap.close()
    page.close()

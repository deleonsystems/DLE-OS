"""Local text-layer inspection only: no OCR and no extracted text in the result."""
import json
import sys
import pypdfium2 as pdfium


def inspect(binary):
    with pdfium.PdfDocument(binary) as pdf:
        count = len(pdf)
        if not count or count > 200:
            return {"status": "UNKNOWN", "pageCount": count, "reason": "PAGE_LIMIT"}
        text_pages = image_pages = uncertain_pages = 0
        for page in pdf:
            text_page = page.get_textpage()
            useful = sum(c.isalnum() for c in text_page.get_text_range())
            text_page.close()
            # Ignore tiny text overlays on otherwise scanned pages.
            objects = list(page.get_objects())
            images = [obj for obj in objects if obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE]
            bounds = [obj.get_bounds() for obj in images]
            image_area = max(((r-l)*(t-b) for l,b,r,t in bounds), default=0)
            width, height = page.get_size()
            scanned = image_area >= width * height * 0.5
            if useful >= 40:
                text_pages += 1
            elif scanned:
                image_pages += 1
            elif useful or objects:
                uncertain_pages += 1
            page.close()
        status = ("UNKNOWN" if uncertain_pages else "MIXED" if text_pages and image_pages
                  else "TEXT_READABLE" if text_pages else "IMAGE_ONLY" if image_pages else "UNKNOWN")
        return {"status": status, "pageCount": count, "textPageCount": text_pages,
                "imageOnlyPageCount": image_pages, "reason": "TEXT_LAYER_CHECK"}


if __name__ == "__main__":
    try:
        data = sys.stdin.buffer.read(20 * 1024 * 1024 + 1)
        result = inspect(data) if len(data) <= 20 * 1024 * 1024 else {"status": "UNKNOWN", "reason": "SIZE_LIMIT"}
    except Exception:
        result = {"status": "UNKNOWN", "reason": "CHECK_UNAVAILABLE"}
    print(json.dumps(result))

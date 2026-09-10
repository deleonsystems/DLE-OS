"""SIM pilot: read a verified PDF binary from stdin; emit at most ten candidate rows.

No OCR, filesystem access, spreadsheet fallback, or canonical BOM output.
"""
import io
import json
import sys
import pdfplumber


def extract(binary):
    with pdfplumber.open(io.BytesIO(binary)) as document:
        if len(document.pages) < 2:
            raise ValueError('Governing PDF has no page 2.')
        matches = []
        for table in document.pages[1].find_tables():
            rows = table.extract()
            if rows and rows[0] == ['Line #', 'P/N', 'Quantity', 'Designator', 'Desc.']:
                matches.append((table, rows))
        if len(matches) != 1:
            raise ValueError('Page 2 must contain one unambiguous supported BOM table.')
        table, rows = matches[0]
        candidates = []
        for index, values in enumerate(rows[1:11], 1):
            if len(values) != 5 or any(value is None for value in values):
                raise ValueError('Incomplete table cells require a different extraction method.')
            candidates.append({'values': [value.strip() for value in values],
                               'bounds': table.rows[index].bbox})
        if len(candidates) < 5:
            raise ValueError('Fewer than five candidate rows were found.')
        return {'parser': 'pdfplumber ' + pdfplumber.__version__, 'rows': candidates}


if __name__ == '__main__':
    try:
        print(json.dumps(extract(sys.stdin.buffer.read(20 * 1024 * 1024 + 1)), ensure_ascii=True))
    except Exception:
        # Do not leak document contents or local paths through parser errors.
        sys.exit(2)

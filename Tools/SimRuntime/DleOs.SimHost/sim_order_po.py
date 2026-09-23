"""Conservative local text-layer PO extraction. No quote input, network, or inferred zeros."""
import json
import re
import sys
import pypdfium2 as pdfium


def extract(binary):
    candidates = {}
    def add(key, value, page, evidence):
        candidates.setdefault(key, []).append(dict(value=str(value), page=page, evidence=evidence[:1200]))
    with pdfium.PdfDocument(binary) as pdf:
        if not 0 < len(pdf) <= 50:
            return {"status": "UNAVAILABLE", "fields": {}}
        for index in range(len(pdf)):
            page = pdf[index]
            textpage = page.get_textpage()
            text = textpage.get_text_range().replace('\r', '')
            textpage.close()
            page.close()
            lines = [x.strip() for x in text.splitlines() if x.strip()]
            text = '\n'.join(lines)
            for key, label in [('poNumber', 'PO NUMBER'), ('quoteReference', 'QUOTE REFERENCE')]:
                for m in re.finditer(r'(?im)^' + label + r'\s*:?\s*\n([^\n]+)', text):
                    value = m[1].strip()
                    add(key, value, index + 1, m[0])
            for m in re.finditer(r'(?im)^PURCHASE ORDER\n([^\n]+)', text):
                add('customer', m[1], index + 1, m[0])
            for key, label in [('currency', 'Currency'), ('nre', 'NRE'), ('separateCharges', 'Separate charges')]:
                value_pattern = r'[A-Z]{3}\b' if key == 'currency' else r'[0-9]+(?:,[0-9]{3})*\.[0-9]{2}\b'
                pattern = r'(?im)^' + label + r'\s*:?\s*(' + value_pattern + ')'
                for m in re.finditer(pattern, text): add(key, m[1].replace(',', ''), index + 1, m[0])
            # Recognize a single explicit line table, never sum or choose among multiple lines.
            table = re.search(r'(?is)Line Part number / Description Rev Qty / UOM Unit \([A-Z]{3}\) Extension \([A-Z]{3}\)\n(.*?)\nCurrency:', text)
            if table:
                for currency in re.findall(r'(?:Unit|Extension) \(([A-Z]{3})\)', table[0]):
                    add('currency', currency, index + 1, table[0])
                rows = re.findall(r'(?m)^([0-9]+)\s+([^\s]+)\s*$', table[1])
                tails = re.findall(r'(?m)^([A-Za-z0-9._-]+)\s+([0-9]+)\s+([A-Za-z]+)\s+([0-9,]+\.[0-9]{2})\s+([0-9,]+\.[0-9]{2})\s*$', table[1])
                if len(rows) == len(tails) == 1:
                    values = dict(zip(('revision', 'quantity', 'uom', 'unitPrice', 'extendedValue'), tails[0]))
                    values['assembly'] = rows[0][1]
                    for key, value in values.items(): add(key, value.replace(',', ''), index + 1, table[0])
            for key, start, end in [('requestedDelivery','Requested delivery:', 'Payment:'), ('payment','Payment:', 'Shipping:'), ('shipping','Shipping:', 'Payment and shipping'), ('requirements','Include with shipment:', 'No aerospace')]:
                m = re.search(re.escape(start) + r'\s*(.*?)\s*' + re.escape(end), text, re.S)
                if m: add(key, ' '.join(m[1].split()), index + 1, m[0])
    fields = {}
    for key, found in candidates.items():
        if len({v['value'] for v in found}) == 1:
            fields[key] = {**found[0], 'confidence': 'EXPLICIT_TEXT'}
        # Conflicting occurrences remain unresolved, not first-value-wins.
    return {'status': 'SUGGESTED' if fields else 'UNAVAILABLE', 'fields': fields}


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(20 * 1024 * 1024 + 1)
        result = extract(data) if len(data) <= 20 * 1024 * 1024 else {'status':'UNAVAILABLE','fields':{}}
    except Exception:
        result = {'status':'UNAVAILABLE','fields':{}}
    print(json.dumps(result))

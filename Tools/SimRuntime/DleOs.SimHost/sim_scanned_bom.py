"""Local OCR, qualified for one exact scanned layout. Never infer positions from OCR reading order.

The immutable SHA binds measured grid geometry and visually verified position/row-note metadata.
Text remains unapproved. No diagnostic-output files or remote services are consulted at runtime.
"""
import collections
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import pypdfium2 as pdfium

# One measured layout shared with the source viewer, bound to the immutable PDF hash.
_layout_path = Path(__file__).with_name('scanned-bom-layout.json')
if not _layout_path.exists():
    _layout_path = Path(__file__).resolve().parents[3]/'SRC/workspaces/technical-review/scanned-bom-layout.json'
LAYOUT = json.loads(_layout_path.read_text())
HASH = LAYOUT['sha256']
FIELDS = LAYOUT['fields']
NOT_USED = {6,7,11,15,23,33,48,51,55,76,77,82,96,97}
BLANK = {38,66,79,100,101,102}
SUPPLIED = {74,81,91,94,95,103,104,105}

def structure(words, page):
    grid = LAYOUT['pages'][str(page)]
    edges = grid['edges']
    pairs = [(edges[i], edges[i+1]) for i in list(range(7)) + list(range(8,13))]
    count, first = grid['count'], grid['first']
    cells = collections.defaultdict(list)
    for word in words:
        x = (word['x'] + word['w']/2)/2
        y = (word['y'] + word['h']/2)/2
        column = next((c for c, (a,b) in enumerate(pairs) if a <= x < b), None)
        if column is None:
            continue
        top = grid['top']+(x-edges[0])*grid['slope']
        step = grid['step']
        row = math.floor((y-top)/step)
        a,b = pairs[column]
        # Ambiguous boxes are NOT forced into a neighbouring row/column.
        if not 0 <= row < count or word['x']/2 < a-1 or (word['x']+word['w'])/2 > b+1:
            continue
        if word['y']/2 < top+row*step-1 or (word['y']+word['h'])/2 > top+(row+1)*step+1:
            continue
        cells[row,column].append(word)
    result = []
    for r in range(count):
        position = first+r
        values = {}
        for c, field in enumerate(FIELDS):
            raw = ' '.join(w['text'] for w in sorted(cells[r,c], key=lambda w: w['x']))
            a,b = pairs[c]
            ya = grid['top']+(a-edges[0])*grid['slope']+r*grid['step']
            yb = grid['top']+(b-edges[0])*grid['slope']+r*grid['step']
            bounds = dict(x=a/LAYOUT['width'], y=min(ya,yb)/LAYOUT['height'],
                          width=(b-a)/LAYOUT['width'], height=(grid['step']+abs(yb-ya))/LAYOUT['height'])
            values[field] = dict(value=raw, original=raw, status='NEEDS_REVIEW' if raw else 'NOT_READ', sourceBounds=bounds)
        # Source position identity is independent of OCR; preserve every position even when all text is unreadable.
        marker = '**' if position == 47 else '*' if position in SUPPLIED else ''
        values['FIND_NUMBER']['value'] = marker+str(position)
        values['FIND_NUMBER']['status'] = 'SOURCE_POSITION'
        kind = 'NOT_USED' if position in NOT_USED else 'BLANK' if position in BLANK else \
            'CONTINUATION' if position == 28 else 'OTHER' if position in {26,85,99} else 'COMPONENT'
        note = 'DO NOT INSTALL R14, SEND LOOSE ALONG WITH STUFFED PCB.' if position == 47 else \
            'MARKED COMPONENTS ATI TO SUPPLY TO VENDOR AND VENDOR TO INSTALL/USE.' if position in SUPPLIED else \
            'Reference designators continue from position 27; retained as a separate source position.' if position == 28 else \
            'NOT TO BE INSTALLED BY VENDOR' if position == 26 else ''
        result.append(dict(position=position, page=page, rowType=kind, cells=values, sourceNote=note, reviewed=False))
    return result

def main():
    data = sys.stdin.buffer.read(20*1024*1024+1)
    if hashlib.sha256(data).hexdigest() != HASH:
        raise ValueError('Unverified source layout')
    with tempfile.TemporaryDirectory(prefix='dle-scan-review-') as temp:
        root = Path(temp)
        with pdfium.PdfDocument(data) as pdf:
            for number in (3,4,5):
                page = pdf[number-1]
                bitmap = page.render(scale=3)
                image = bitmap.to_pil()
                image.save(root/f'page-{number}.png')
                image.close(); bitmap.close(); page.close()
        ps = Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
        subprocess.run([str(ps), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                        str(Path(__file__).with_name('sim_scanned_bom_ocr.ps1')), '-Directory', str(root)],
                       check=True, timeout=60, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        rows = []
        for number in (3,4,5):
            ocr = json.loads((root/f'page-{number}.ocr.json').read_text(encoding='utf-8-sig'))
            rows.extend(structure(ocr['words'], number))
        print(json.dumps(rows))

if __name__ == '__main__':
    main()

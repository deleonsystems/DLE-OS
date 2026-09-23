"""Layout only: every business value/decision comes from the server review projection."""
import json
import sys
from html import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, Image


def render(data, logo, output):
    # .NET runner uses record casing; web JSON uses camelCase. Normalize property names only.
    def normalize(x):
        if isinstance(x, dict):
            return {k[0].lower()+k[1:]: normalize(v) for k, v in x.items()}
        if isinstance(x, list):
            return [normalize(v) for v in x]
        return x
    d = normalize(data)
    normal = ParagraphStyle('cell', fontName='Helvetica', fontSize=8.4, leading=10.1, spaceAfter=0)
    bold = ParagraphStyle('label', parent=normal, fontName='Helvetica-Bold')
    title = ParagraphStyle('title', parent=bold, fontSize=12, leading=15, alignment=1)
    def p(s, style=normal):
        return Paragraph(escape(str(s)).replace('\n', '<br/>'), style)
    story = []
    def table(rows, widths):
        t = Table(rows, colWidths=widths, hAlign='LEFT', splitInRow=1)
        t.setStyle(TableStyle([('GRID',(0,0),(-1,-1),0.45,colors.black),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
        story.append(t)
    logo_image = Image(logo, width=105, height=32, kind='proportional')
    table([[logo_image,p('De Leon Enterprises',bold),p('DLE-OS Contract Review\nPreview form v1',bold)]],[160,190,190])
    story += [Spacer(1,6),p(d['title'],title),p(d['status'],title),Spacer(1,5)]
    def heading(text):
        t=Table([[p(text,bold)]],colWidths=[540],hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#eeeeee')),('BOX',(0,0),(-1,-1),0.5,colors.black),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)])); t.keepWithNext=True; story.append(t)
    for section in d['sections']:
        heading(section['title'])
        fields=section['fields']
        rows=[]
        for i in range(0,len(fields),2):
            pair=fields[i:i+2]
            cells=[]
            for f in pair: cells += [p(f['label'],bold),p(f['value'])]
            if len(pair)==1: cells += [p(''),p('')]
            rows.append(cells)
        table(rows,[95,175,95,175])
        if section['title']=='Order':
            table([[p('Customer PO evidence',bold),p('; '.join(f['name'] for f in d['poDocuments']) or 'Not attached')]], [110,430])
        if section['title']=='Technical Source' and d['technicalDocuments']:
            table([[p(f['name']),p(f['type'])] for f in d['technicalDocuments']],[395,145])
    heading('Attention Items')
    table([[p('\n'.join(d['attention']) or 'No unresolved review items.')]], [540])
    heading('Review Acknowledgment')
    table([[p(('[X]' if d['acknowledged'] else '[ ]')+' I reviewed the customer PO and captured its requirements.')]], [540])
    table([[p('Reviewer',bold),p(d['reviewer']),p('Date',bold),p(d['reviewedDate'])]],[60,230,35,215])
    story += [Spacer(1,5),p(d['notice'])]
    def footer(canvas, doc):
        canvas.setFont('Helvetica',7)
        canvas.drawString(36,23,f"{d['intakeId']} | Saved package revision {d['packageRevision']} | Current form preview")
        canvas.drawRightString(576,23,f'Page {doc.page}')
    SimpleDocTemplate(output,pagesize=(612,792),leftMargin=36,rightMargin=36,topMargin=28,bottomMargin=35).build(story,onFirstPage=footer,onLaterPages=footer)


if __name__ == '__main__':
    with open(sys.argv[1],encoding='utf-8-sig') as stream:
        render(json.load(stream),sys.argv[2],sys.argv[3])
